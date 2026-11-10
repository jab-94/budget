"""Importeurs de relevés : PDF (par banque + générique), CSV.

Tout est traité EN MÉMOIRE : le fichier reçu n'est jamais écrit sur le disque.
"""
from __future__ import annotations

import io

from .banks import PDF_PARSERS
from .base import ImportErrorFr, ParsedStatement
from .csv_import import parse_csv
from .pdf_generic import GenericPdfParser, Line

MAX_UPLOAD_BYTES = 20 * 1024 * 1024


def _words_to_lines(words: list[dict]) -> list[Line]:
    """Regroupe les mots d'une page en lignes, en gardant l'abscisse de chaque caractère."""
    words = sorted(words, key=lambda w: (round(w["top"]), w["x0"]))
    rows: list[list[dict]] = []
    for w in words:
        if rows and abs(w["top"] - rows[-1][0]["top"]) <= 3:
            rows[-1].append(w)
        else:
            rows.append([w])

    lines = []
    for row in rows:
        row.sort(key=lambda w: w["x0"])
        text, xs = "", []
        for i, w in enumerate(row):
            t = w["text"]
            char_w = (w["x1"] - w["x0"]) / max(len(t), 1)
            if i:
                gap = w["x0"] - row[i - 1]["x1"]
                # Un grand écart (changement de colonne) devient plusieurs espaces.
                n = 1 if gap < 3 * char_w else 3
                prev = xs[-1]
                for k in range(n):
                    text += " "
                    xs.append(prev + (k + 1) * gap / (n + 1))
            else:
                # Indentation : on reproduit le retrait sous forme d'espaces.
                n = int(w["x0"] // max(char_w, 1))
                text += " " * n
                xs.extend(w["x0"] * k / max(n, 1) for k in range(n))
            text += t
            xs.extend(w["x0"] + (k + 0.5) * char_w for k in range(len(t)))
        lines.append(Line(text, xs))
    return lines


def pdf_pages_lines(raw: bytes) -> list[list[Line]]:
    import pdfplumber  # import tardif : chargé seulement si on importe un PDF

    try:
        with pdfplumber.open(io.BytesIO(raw)) as pdf:
            return [_words_to_lines(p.extract_words(x_tolerance=1.5, y_tolerance=2)) for p in pdf.pages]
    except Exception:
        raise ImportErrorFr("Ce PDF n'a pas pu être lu (fichier protégé ou abîmé ?).") from None


def choose_pdf_parser(first_pages_text: str, forced: str | None = None) -> GenericPdfParser:
    if forced:
        for cls in PDF_PARSERS:
            if cls.name == forced:
                return cls()
        return GenericPdfParser()
    for cls in PDF_PARSERS:
        if cls.detect(first_pages_text):
            return cls()
    return GenericPdfParser()


def parse_pdf(raw: bytes, forced_parser: str | None = None) -> ParsedStatement:
    pages = pdf_pages_lines(raw)
    if not any(line.text.strip() for page in pages for line in page):
        raise ImportErrorFr("Ce PDF ne contient pas de texte (scan ?). Utilisez plutôt l'export CSV de la banque.")
    # La banque est cherchée sur les 2 premières pages ET la dernière (mentions légales en pied).
    sample = [*pages[:2], pages[-1]]
    first_text = "\n".join(line.text for page in sample for line in page)
    parser = choose_pdf_parser(first_text, forced_parser)
    st = parser.parse_lines(pages)
    st.parser = parser.name
    return st


def available_pdf_parsers() -> list[dict]:
    return [{"name": GenericPdfParser.name, "label": GenericPdfParser.label}] + [
        {"name": c.name, "label": c.label} for c in PDF_PARSERS
    ]


__all__ = ["ImportErrorFr", "MAX_UPLOAD_BYTES", "parse_csv", "parse_pdf", "available_pdf_parsers"]
