"""Parseur PDF générique (repli quand aucune banque n'est reconnue).

Chaque ligne du relevé est représentée par son texte ET la position horizontale
réelle (en points PDF) de chacun de ses caractères. On ne se fie donc pas au
nombre d'espaces : un libellé trop long qui « pousse » le montant vers la droite
dans le texte extrait ne fait pas basculer un débit en crédit.

Principe :
1. Repérer la ligne d'en-tête contenant « Débit » et « Crédit » : leur position
   horizontale indique dans quelle colonne tombe chaque montant.
2. Une ligne d'opération commence par une date (JJ/MM, JJ.MM ou JJ/MM/AAAA) et
   contient au moins un montant.
3. Une ligne plus indentée, sans date ni montant, qui suit une opération
   complète son libellé (libellés sur plusieurs lignes).
4. Les lignes « SOLDE … » donnent le solde de début et de fin.

Les parseurs propres à chaque banque héritent de cette classe et ajustent
quelques réglages (voir banks.py).
"""
from __future__ import annotations

import re
import unicodedata
from dataclasses import dataclass
from datetime import date

from .base import ParsedStatement, ParsedTransaction, parse_amount

DATE_START = re.compile(r"^\s*(\d{2}[/.]\d{2}(?:[/.]\d{2,4})?)(?=\s)")
TRAILING_DATE = re.compile(r"\s+\d{2}[/.]\d{2}(?:[/.]\d{2,4})?\s*$")
AMOUNT = re.compile(r"(?<![\d,.])-?\d{1,3}(?:[   .]\d{3})*,\d{2}(?![\d,%])")
PERIOD = re.compile(r"(\d{2}[/.]\d{2}[/.]\d{4})\D{1,20}?(\d{2}[/.]\d{2}[/.]\d{4})")
PAGE_MARK = re.compile(r"\bpage\s*\d+\s*/\s*\d+\b")


def _plain(s: str) -> str:
    """Minuscules sans accents, MÊME LONGUEUR que l'entrée (indices conservés)."""
    out = []
    for c in s:
        d = unicodedata.normalize("NFKD", c)
        base = "".join(x for x in d if not unicodedata.combining(x))
        out.append((base[:1] or c).lower())
    return "".join(out)


@dataclass
class Line:
    """Une ligne de relevé : texte + abscisse (en points) de chaque caractère."""

    text: str
    xs: list[float]

    @classmethod
    def from_text(cls, text: str) -> "Line":
        # Texte « mis en page » : la position = l'indice du caractère.
        return cls(text, [float(i) for i in range(len(text))])

    @property
    def indent(self) -> float:
        stripped = len(self.text) - len(self.text.lstrip())
        return self.xs[stripped] if stripped < len(self.xs) else 0.0


class GenericPdfParser:
    name = "pdf-generique"
    label = "Format générique"
    # La banque est reconnue si l'UN de ces textes figure sur les premières pages.
    detect_keywords: tuple[str, ...] = ()
    # Libellés indiquant une entrée d'argent (utilisés seulement si les colonnes sont introuvables).
    credit_hints = ("VIR RECU", "VIREMENT RECU", "VIR SEPA RECU", "REMISE", "AVOIR", "REMBOURSEMENT", "SALAIRE")
    skip_line_keywords = ("total des operations", "totaux", "sous-total", "sous total")
    max_label_length = 140

    @classmethod
    def detect(cls, text: str) -> bool:
        t = _plain(text)
        return any(_plain(k) in t for k in cls.detect_keywords)

    # --- points d'entrée ------------------------------------------------------------
    def parse_pages(self, pages: list[str]) -> ParsedStatement:
        """Depuis du texte mis en page (tests, ou repli)."""
        return self.parse_lines([[Line.from_text(t) for t in p.splitlines()] for p in pages])

    def parse_lines(self, pages: list[list[Line]]) -> ParsedStatement:
        st = ParsedStatement(source="pdf", parser=self.name)
        full = "\n".join(line.text for page in pages for line in page)
        self._find_period(full, st)
        year_hint = int(st.period_end[:4]) if st.period_end else date.today().year

        cols: tuple[float, float] | None = None
        current: ParsedTransaction | None = None
        current_indent = 0.0
        balances: list[tuple[str, int]] = []

        for page in pages:
            current = None  # une opération ne continue jamais sur la page suivante
            for line in page:
                text = line.text
                if not text.strip():
                    continue
                low = _plain(text)
                header = self._header_columns(line)
                if header:
                    cols, current = header, None
                    continue
                if PAGE_MARK.search(low) or any(k in low for k in self.skip_line_keywords):
                    current = None
                    continue
                amounts = list(AMOUNT.finditer(text))
                if "solde" in low and amounts:
                    m = amounts[-1]
                    val = abs(parse_amount(m.group()))
                    if m.group().startswith("-") or "debiteur" in low or self._side(line, m, cols) == "debit":
                        val = -val
                    balances.append((low, val))
                    current = None
                    continue

                dm = DATE_START.match(text)
                if dm and amounts:
                    current = self._make_tx(line, dm, amounts, cols, year_hint, st)
                    current_indent = line.indent
                    if current:
                        st.transactions.append(current)
                    continue
                if current is not None and not amounts and not dm and line.indent > current_indent:
                    extra = self.continuation_text(" ".join(text.split()))
                    if extra and len(current.label) + len(extra) < self.max_label_length:
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

    # --- réglages surchargeables par banque -------------------------------------------
    def continuation_text(self, text: str) -> str | None:
        """Texte d'une ligne de suite de libellé à ajouter (None = l'ignorer)."""
        if len(text) <= 1 or re.fullmatch(r"[\d\W]+", text):
            return None
        return text

    def sign_hint(self, line: Line, m: re.Match) -> int | None:
        """Indice propre à une banque sur le sens d'un montant (-1, +1, ou None)."""
        return None

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
    def _header_columns(line: Line) -> tuple[float, float] | None:
        low = _plain(line.text)
        if "solde" in low:
            return None
        d = re.search(r"\bdebit\b", low)
        c = re.search(r"\bcredit\b", low)
        if not d or not c:
            return None
        # Bord droit de chaque mot d'en-tête (les montants sont alignés à droite sous lui).
        return line.xs[d.end() - 1], line.xs[c.end() - 1]

    @staticmethod
    def _side(line: Line, m: re.Match, cols) -> str | None:
        if cols is None:
            return None
        right = line.xs[m.end() - 1]
        debit_x, credit_x = cols
        return "debit" if abs(right - debit_x) < abs(right - credit_x) else "credit"

    def _make_tx(self, line: Line, dm, amounts, cols, year_hint, st) -> ParsedTransaction | None:
        text = line.text
        iso = self._date_with_year(dm.group(1), year_hint, st)
        if iso is None:
            return None
        # Libellé = texte entre la date d'opération et le premier montant,
        # sans la date de valeur (avant ou après le libellé).
        label_part = text[dm.end() : amounts[0].start()]
        label_part = re.sub(r"^\s*\d{2}[/.]\d{2}(?:[/.]\d{2,4})?\s+", " ", label_part)
        label_part = TRAILING_DATE.sub("", label_part)
        label = " ".join(label_part.split()) or "(sans libellé)"

        m = amounts[0]
        value = abs(parse_amount(m.group()))
        uncertain = False
        hint = self.sign_hint(line, m)
        side = self._side(line, m, cols)
        if m.group().startswith("-"):
            sign = -1
        elif hint is not None:
            sign = hint
        elif side is not None:
            sign = -1 if side == "debit" else 1
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
