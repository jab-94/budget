"""Parseurs PDF par banque.

Chaque banque = une petite classe qui hérite du parseur générique et ajuste ses
réglages (mots de détection, indices de crédit…). Ajouter une banque = ajouter
une classe ici et l'inscrire dans PDF_PARSERS.

⚠️ État : ces parseurs ne sont PAS encore calibrés sur de vrais relevés. Ils
reconnaissent la banque et utilisent la logique générique. Ils seront ajustés
avec les extraits masqués produits par tools/inspect_pdf.py.
"""
from __future__ import annotations

from .pdf_generic import GenericPdfParser


class LclParser(GenericPdfParser):
    name = "lcl"
    label = "LCL"
    detect_keywords = ("LCL",)


class BoursobankParser(GenericPdfParser):
    name = "boursobank"
    label = "Boursobank"
    detect_keywords = ("BoursoBank",)


class TradeRepublicParser(GenericPdfParser):
    name = "trade-republic"
    label = "Trade Republic"
    detect_keywords = ("Trade Republic",)
    credit_hints = GenericPdfParser.credit_hints + ("INCOMING", "ENTRANT", "INTERETS", "INTÉRÊTS")


# Ordre = priorité de détection. Le générique sert de repli.
PDF_PARSERS: list[type[GenericPdfParser]] = [LclParser, BoursobankParser, TradeRepublicParser]
