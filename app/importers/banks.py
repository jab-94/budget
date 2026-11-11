"""Parseurs PDF par banque.

Chaque banque = une petite classe qui hérite du parseur générique et ajuste ses
réglages. Ajouter une banque = ajouter une classe ici et l'inscrire dans PDF_PARSERS.

État du calibrage :
- LCL, Boursobank : calibrés d'après un extrait masqué (tools/inspect_pdf.py)
  d'un vrai relevé.
- Trade Republic : l'export CSV est recommandé (lecteur dédié) ; ce parseur PDF
  ne fait que reconnaître la banque et utilise la logique générique.
"""
from __future__ import annotations

import re

from .pdf_generic import GenericPdfParser, Line, _plain


class LclParser(GenericPdfParser):
    """Relevé de compte LCL.

    Structure observée :
        DATE   LIBELLE                          VALEUR    DEBIT     CREDIT
        JJ.MM                ANCIEN SOLDE                           1 234,56
        JJ.MM  PRLV SEPA XXXXX                  JJ.MM.AA  45,90        .
               REF.CLIENT:XXXX                  <- lignes de détail « CLE:valeur »
               NATURE DU VIREMENT:XXXX
        JJ.MM  VIR INST XXXXX                   JJ.MM.AA            2 150,00
                                         TOTAUX           9 999,99  9 999,99
        JJ.MM                         SOLDE EN EUROS                  999,99
    - Un point « . » occupe la colonne CRÉDIT quand l'opération est un débit.
    - Le relevé ne contient pas « LCL » en texte, mais « Crédit Lyonnais ».
    """

    name = "lcl"
    label = "LCL"
    detect_keywords = ("Crédit Lyonnais", "LCL")
    # Lignes de détail dont la valeur n'aide pas à reconnaître l'opération :
    # références (REF.CLIENT, ID.CREANCIER…) et nature du virement.
    _noise_key = re.compile(r"^(?:[A-Z]{2,4}\.[A-Z]+|NATURE\b[^:]*|.*\bREF\b[^:]*|.*MANDAT[^:]*)\s*:", re.I)
    _key_value = re.compile(r"^([^:]{2,40}):\s*(.*)$")

    def sign_hint(self, line: Line, m: re.Match) -> int | None:
        # « 45,90   . » : le point dans la colonne crédit signale un débit.
        rest = line.text[m.end():].strip()
        return -1 if rest == "." else None

    def continuation_text(self, text: str) -> str | None:
        if self._noise_key.match(text):
            return None
        kv = self._key_value.match(text)
        if kv:  # ex. « DE: NOM DU PAYEUR » -> on garde seulement la valeur
            text = kv.group(2).strip()
        # Références techniques longues (lettres + chiffres mêlés) : inutiles.
        words = [w for w in text.split() if not (re.search(r"\d", w) and len(w) >= 10)]
        return super().continuation_text(" ".join(words)) if words else None


class BoursobankParser(GenericPdfParser):
    """Relevé de compte Boursobank.

    Structure observée sur un extrait masqué d'un vrai relevé :
        [en-tête de page]  Date  N° compte … EUR du JJ/MM/AAAA au JJ/MM/AAAA  9,99  9,99%  1/3
                                         MOUVEMENTS EN EUR
        Date / Libellé                              Valeur   <débit> <crédit>
        opération
                                       Solde au : JJ/MM/AAAA          1.234,56
        JJ/MM/AAAA PRLV SEPA XXXX                 JJ/MM/AAAA 45,90
                 NOM DU CRÉANCIER                 <- suite du libellé
                 REF:XXX9999…                     <- référence (ignorée)
        JJ/MM/AAAA CARTE JJ/MM/AA COMMERCE CB*1234 JJ/MM/AAAA 12,00
        JJ/MM/AAAA VIR INST XXXX                  JJ/MM/AAAA            850,00
        [mentions légales en bas de page]
                         Nouveau solde en EUR :                        2.459,88
    - La ligne d'en-tête de page commence par une date et contient un montant :
      on ne lit les opérations qu'après « MOUVEMENTS EN EUR ».
    - Les en-têtes des colonnes débit/crédit ne sont pas reconnaissables en
      texte : ce sont les deux mots qui suivent « Valeur » (gauche = débit).
    - Le texte extrait colle souvent les mots (« Soldeau », « NouveausoldeenEUR ») :
      la détection des soldes cherche « solde » à l'intérieur des mots.
    """

    name = "boursobank"
    label = "Boursobank"
    detect_keywords = ("BoursoBank", "Boursorama")
    start_marker = "mouvements"
    # Lignes de détail sans intérêt : « REF: », « RUM: », « ID: », références de mandat.
    _noise_key = re.compile(r"^[^\s:]{2,6}\s*:")

    def _header_columns(self, line: Line) -> tuple[float, float] | None:
        cols = super()._header_columns(line)
        if cols:
            return cols
        low = _plain(line.text)
        m = re.search(r"\bvaleur\b", low)
        if not m:
            return None
        after = list(re.finditer(r"\S+", line.text[m.end():]))
        if len(after) != 2:
            return None
        base = m.end()
        return line.xs[base + after[0].end() - 1], line.xs[base + after[1].end() - 1]

    def continuation_text(self, text: str) -> str | None:
        if self._noise_key.match(text):
            return None
        words = [w for w in text.split() if not (re.search(r"\d", w) and len(w) >= 10)]
        cleaned = " ".join(words)
        # Ce qui reste d'une ligne de références (« RUM », « X- ») n'aide pas.
        if len(re.sub(r"[\W\d_]", "", cleaned)) < 4:
            return None
        return super().continuation_text(cleaned)


class TradeRepublicParser(GenericPdfParser):
    name = "trade-republic"
    label = "Trade Republic"
    detect_keywords = ("Trade Republic",)
    credit_hints = GenericPdfParser.credit_hints + ("INCOMING", "ENTRANT", "INTERETS", "INTÉRÊTS")


# Ordre = priorité de détection. Le générique sert de repli.
PDF_PARSERS: list[type[GenericPdfParser]] = [LclParser, BoursobankParser, TradeRepublicParser]
