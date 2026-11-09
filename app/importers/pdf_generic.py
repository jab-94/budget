"""Parseur PDF générique (repli quand aucune banque n'est reconnue).

Fonctionne sur le texte « mis en page » extrait par pdfplumber, où l'alignement
des colonnes est conservé avec des espaces. Principe :

1. Repérer la ligne d'en-tête contenant « Débit » et « Crédit » : leur position
   horizontale indique dans quelle colonne tombe chaque montant.
2. Une ligne d'opération commence par une date (JJ/MM ou JJ/MM/AAAA) et finit
   par un ou plusieurs montants.
3. Une ligne sans date ni montant qui suit une opération complète son libellé
   (libellés sur plusieurs lignes).
4. Les lignes « SOLDE … » donnent le solde de début et de fin.

Les parseurs propres à chaque banque héritent de cette classe et ajustent
quelques réglages (voir banks/).
"""
from __future__ import annotations

import re
import unicodedata
from datetime import date

from .base import ParsedStatement, ParsedTransaction, parse_amount

DATE_START = re.compile(r"^\s*(\d{2}[/.]\d{2}(?:[/.]\d{2,4})?)\b")
AMOUNT = re.compile(r"(?<![\d,.])-?\d{1,3}(?:[   .]\d{3})*,\d{2}(?![\d,])")
PERIOD = re.compile(r"(\d{2}[/.]\d{2}[/.]\d{4})\D{1,20}?(\d{2}[/.]\d{2}[/.]\d{4})")


def _plain(s: str) -> str:
    s = unicodedata.normalize("NFKD", s)
    return "".join(c for c in s if not unicodedata.combining(c)).lower()


class GenericPdfParser:
    name = "pdf-generique"
    label = "Format générique"
    # Mots qui, s'ils sont présents dans le texte, identifient la banque.
    detect_keywords: tuple[str, ...] = ()
    # Libellés indiquant une entrée d'argent (utilisés seulement si les colonnes sont introuvables).
    credit_hints = ("VIR RECU", "VIREMENT RECU", "VIR SEPA RECU", "REMISE", "AVOIR", "REMBOURSEMENT", "SALAIRE")
    skip_line_keywords = ("total des operations", "totaux", "sous-total", "sous total")

    @classmethod
    def detect(cls, text: str) -> bool:
        t = _plain(text)
        return bool(cls.detect_keywords) and all(_plain(k) in t for k in cls.detect_keywords)

    # --- point d'entrée -----------------------------------------------------------
    def parse_pages(self, pages: list[str]) -> ParsedStatement:
        st = ParsedStatement(source="pdf", parser=self.name)
        full = "\n".join(pages)
        self._find_period(full, st)
        year_hint = int(st.period_end[:4]) if st.period_end else date.today().year

        debit_col = credit_col = None
        current: ParsedTransaction | None = None
        balances: list[tuple[str, int]] = []

        for page in pages:
            for line in page.splitlines():
                if not line.strip():
                    continue
                low = _plain(line)
                cols = self._header_columns(line)
                if cols:
                    debit_col, credit_col = cols
                    current = None
                    continue
                if any(k in low for k in self.skip_line_keywords):
                    current = None
                    continue
                amounts = list(AMOUNT.finditer(line))
                if "solde" in low and amounts:
                    m = amounts[-1]
                    val = abs(parse_amount(m.group()))
                    if m.group().startswith("-") or self._side(m, debit_col, credit_col) == "debit":
                        val = -val
                    elif "debiteur" in low:
                        val = -val
                    balances.append((low, val))
                    current = None
                    continue

                dm = DATE_START.match(line)
                if dm and amounts:
                    current = self._make_tx(line, dm, amounts, debit_col, credit_col, year_hint, st)
                    if current:
                        st.transactions.append(current)
                    continue
                if current is not None and not amounts and not dm and len(line.strip()) > 1:
                    # Suite du libellé sur la ligne suivante
                    extra = " ".join(line.split())
                    if len(current.label) + len(extra) < 200:
                        current.label = f"{current.label} {extra}"
                    continue
                current = None

        self._assign_balances(balances, st)
        if st.transactions and not st.period_start:
            ds = sorted(t.date for t in st.transactions)
            st.period_start, st.period_end = ds[0], ds[-1]
        if any(t.uncertain_sign for t in st.transactions):
            st.warnings.append(
                "Colonnes Débit/Crédit non trouvées : le sens de certaines opérations a été deviné. Vérifiez-les."
            )
        if not st.transactions:
            st.warnings.append("Aucune opération reconnue dans ce PDF. Ce format de relevé doit être calibré.")
        return st

    # --- détails --------------------------------------------------------------------
    def _find_period(self, text: str, st: ParsedStatement) -> None:
        for m in PERIOD.finditer(text):
            a, b = (self._full_date(x) for x in m.groups())
            if a and b and a <= b:
                st.period_start, st.period_end = a, b
                return

    @staticmethod
    def _full_date(s: str) -> str | None:
        d, m, y = re.split(r"[/.]", s)
        try:
            return date(int(y), int(m), int(d)).isoformat()
        except ValueError:
            return None

    @staticmethod
    def _header_columns(line: str) -> tuple[float, float] | None:
        low = _plain(line)
        di, ci = low.find("debit"), low.find("credit")
        if di == -1 or ci == -1 or "solde" in low:
            return None
        # Centre de chaque mot d'en-tête (les montants sont alignés à droite sous lui).
        return di + 5, ci + 6

    @staticmethod
    def _side(m: re.Match, debit_col, credit_col) -> str | None:
        if debit_col is None or credit_col is None:
            return None
        end = m.end()
        return "debit" if abs(end - debit_col) < abs(end - credit_col) else "credit"

    def _make_tx(self, line, dm, amounts, debit_col, credit_col, year_hint, st) -> ParsedTransaction | None:
        raw_date = dm.group(1)
        iso = self._date_with_year(raw_date, year_hint, st)
        if iso is None:
            return None
        # Le libellé = texte entre la (ou les) date(s) et le premier montant.
        label_part = line[dm.end() : amounts[0].start()]
        label_part = re.sub(r"^\s*\d{2}[/.]\d{2}(?:[/.]\d{2,4})?\s+", " ", label_part)  # date de valeur
        label = " ".join(label_part.split()) or "(sans libellé)"

        # S'il y a deux montants, le second est souvent la colonne de l'autre sens
        # ou une date de valeur mal découpée : on prend le premier montant non nul.
        m = amounts[0]
        value = abs(parse_amount(m.group()))
        side = self._side(m, debit_col, credit_col)
        uncertain = False
        if m.group().startswith("-"):
            sign = -1
        elif side == "debit":
            sign = -1
        elif side == "credit":
            sign = 1
        else:
            uncertain = True
            sign = 1 if any(h in label.upper() for h in self.credit_hints) else -1
        return ParsedTransaction(date=iso, label=label, amount_cents=sign * value, uncertain_sign=uncertain)

    def _date_with_year(self, raw: str, year_hint: int, st: ParsedStatement) -> str | None:
        parts = re.split(r"[/.]", raw)
        try:
            if len(parts) == 3:
                y = int(parts[2]) + (2000 if len(parts[2]) == 2 else 0)
                return date(y, int(parts[1]), int(parts[0])).isoformat()
            d, mth = int(parts[0]), int(parts[1])
            y = year_hint
            # Relevé à cheval sur deux années (ex. décembre -> janvier).
            if st.period_start and st.period_end and st.period_start[:4] != st.period_end[:4]:
                y = int(st.period_start[:4]) if mth >= int(st.period_start[5:7]) else int(st.period_end[:4])
            return date(y, mth, d).isoformat()
        except ValueError:
            return None

    @staticmethod
    def _assign_balances(balances: list[tuple[str, int]], st: ParsedStatement) -> None:
        if not balances:
            return
        opening = [v for low, v in balances if any(k in low for k in ("ancien", "precedent", "debut", "report"))]
        closing = [v for low, v in balances if any(k in low for k in ("nouveau", "final", "fin "))]
        st.opening_balance_cents = opening[0] if opening else balances[0][1]
        if closing:
            st.closing_balance_cents = closing[-1]
        elif len(balances) > 1:
            st.closing_balance_cents = balances[-1][1]
