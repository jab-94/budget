"""Importeurs de relevés : PDF (par banque + générique), CSV.

Tout est traité EN MÉMOIRE : le fichier reçu n'est jamais écrit sur le disque.
"""
from __future__ import annotations

import io

from .banks import PDF_PARSERS
from .base import ImportErrorFr, ParsedStatement
from .csv_import import parse_csv
from .pdf_generic import GenericPdfParser

MAX_UPLOAD_BYTES = 20 * 1024 * 1024


def pdf_pages_text(raw: bytes) -> list[str]:
    import pdfplumber  # import tardif : chargé seulement si on importe un PDF

    try:
        with pdfplumber.open(io.BytesIO(raw)) as pdf:
            return [p.extract_text(layout=True) or "" for p in pdf.pages]
    except Exception:
        raise ImportErrorFr("Ce PDF n'a pas pu être lu (fichier protégé ou abîmé ?).") from None


def choose_pdf_parser(pages: list[str], forced: str | None = None) -> GenericPdfParser:
    if forced:
        for cls in PDF_PARSERS:
            if cls.name == forced:
                return cls()
        return GenericPdfParser()
    first = "\n".join(pages[:2])
    for cls in PDF_PARSERS:
        if cls.detect(first):
            return cls()
    return GenericPdfParser()


def parse_pdf(raw: bytes, forced_parser: str | None = None) -> ParsedStatement:
    pages = pdf_pages_text(raw)
    if not any(p.strip() for p in pages):
        raise ImportErrorFr("Ce PDF ne contient pas de texte (scan ?). Utilisez plutôt l'export CSV de la banque.")
    parser = choose_pdf_parser(pages, forced_parser)
    st = parser.parse_pages(pages)
    st.parser = parser.name
    return st


def available_pdf_parsers() -> list[dict]:
    return [{"name": GenericPdfParser.name, "label": GenericPdfParser.label}] + [
        {"name": c.name, "label": c.label} for c in PDF_PARSERS
    ]


__all__ = ["ImportErrorFr", "MAX_UPLOAD_BYTES", "parse_csv", "parse_pdf", "available_pdf_parsers"]
