"""Parseurs PDF par banque.

Chaque banque = une petite classe qui hérite du parseur générique et ajuste ses
réglages. Ajouter une banque = ajouter une classe ici et l'inscrire dans PDF_PARSERS.

État du calibrage :
- LCL : calibré d'après un extrait masqué (tools/inspect_pdf.py) d'un vrai relevé.
- Boursobank, Trade Republic : l'export CSV est recommandé ; ces parseurs PDF
  ne font que reconnaître la banque et utilisent la logique générique.
"""
from __future__ import annotations

import re

from .pdf_generic import GenericPdfParser, Line


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
    name = "boursobank"
    label = "Boursobank"
    detect_keywords = ("BoursoBank", "Boursorama")


class TradeRepublicParser(GenericPdfParser):
    name = "trade-republic"
    label = "Trade Republic"
    detect_keywords = ("Trade Republic",)
    credit_hints = GenericPdfParser.credit_hints + ("INCOMING", "ENTRANT", "INTERETS", "INTÉRÊTS")


# Ordre = priorité de détection. Le générique sert de repli.
PDF_PARSERS: list[type[GenericPdfParser]] = [LclParser, BoursobankParser, TradeRepublicParser]
