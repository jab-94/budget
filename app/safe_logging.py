"""Journalisation sans donnée personnelle.

Principe : on ne journalise que des messages fixes et des compteurs. En filet de
sécurité, ce filtre masque tout ce qui ressemble à un montant, un IBAN, une
carte bancaire ou une date dans un message, avant qu'il ne soit écrit.
Les journaux d'accès HTTP d'Uvicorn sont désactivés (ils contiennent les URL).
"""
from __future__ import annotations

import logging
import re

_PATTERNS = [
    # IBAN (FR76 1234 ... ) et numéros de compte/carte longs
    (re.compile(r"\b[A-Z]{2}\d{2}(?:[ ]?[A-Z0-9]{4}){2,7}(?:[ ]?[A-Z0-9]{1,4})?\b"), "[IBAN]"),
    (re.compile(r"\b(?:\d[ -]?){12,19}\b"), "[NUMÉRO]"),
    # Montants : 1 234,56 / 1234.56 / -12,00 € / 12€
    (re.compile(r"[-+]?\d[\d  .]*[,.]\d{2}\s*(?:€|EUR)?"), "[MONTANT]"),
    (re.compile(r"[-+]?\d+\s*(?:€|EUR)"), "[MONTANT]"),
    # Dates JJ/MM/AAAA
    (re.compile(r"\b\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4}\b"), "[DATE]"),
]


def redact(text: str) -> str:
    for pat, repl in _PATTERNS:
        text = pat.sub(repl, text)
    return text


class RedactingFilter(logging.Filter):
    def filter(self, record: logging.LogRecord) -> bool:
        try:
            msg = record.getMessage()
        except Exception:  # message mal formé : on ne prend aucun risque
            msg = "[message illisible masqué]"
        record.msg = redact(msg)
        record.args = ()
        return True


def setup_logging(level: int = logging.INFO) -> None:
    handler = logging.StreamHandler()
    handler.setFormatter(logging.Formatter("%(asctime)s %(levelname)s %(name)s: %(message)s"))
    handler.addFilter(RedactingFilter())
    root = logging.getLogger()
    root.handlers[:] = [handler]
    root.setLevel(level)
    # Uvicorn : journaux d'erreurs gardés (filtrés), journaux d'accès coupés.
    for name in ("uvicorn", "uvicorn.error"):
        lg = logging.getLogger(name)
        lg.handlers[:] = []
        lg.propagate = True
    logging.getLogger("uvicorn.access").disabled = True
    # pdfminer peut être bavard et citer du contenu de PDF : on le fait taire.
    logging.getLogger("pdfminer").setLevel(logging.ERROR)
