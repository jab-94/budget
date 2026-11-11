"""Import CSV avec correspondance de colonnes (« mapping »).

- Détection automatique de l'encodage (UTF-8 ou Windows-1252) et du séparateur.
- Préréglages reconnus automatiquement (ex. export Boursobank).
- Sinon, l'utilisateur indique quelle colonne contient la date, le libellé,
  le montant (ou débit + crédit). Le mapping est renvoyé au front pour réglage.
"""
from __future__ import annotations

import csv
import io
import unicodedata

from . import trade_republic
from .base import ImportErrorFr, ParsedStatement, ParsedTransaction, parse_amount, parse_date


def _norm(h: str) -> str:
    h = unicodedata.normalize("NFKD", h or "")
    return "".join(c for c in h if not unicodedata.combining(c)).strip().lower()


# Préréglages : en-têtes exacts (normalisés) qui identifient un export de banque.
PRESETS = {
    "boursobank": {
        "label": "Boursobank (export CSV)",
        "signature": {"dateop", "label", "amount"},
        "mapping": {"date": "dateOp", "label": "label", "amount": "amount"},
    },
    # Lecteur dédié : frais/taxes séparés, achats de titres marqués « investissement ».
    "trade_republic": {
        "label": "Trade Republic (export CSV)",
        "signature": trade_republic.SIGNATURE,
        "mapping": {"date": "date", "label": "description", "amount": "amount"},
        "reader": trade_republic.parse_rows,
    },
}

# Synonymes pour deviner le mapping d'un CSV inconnu.
GUESS = {
    "date": ["date operation", "date op", "dateop", "date", "date comptable", "booking date"],
    "label": ["libelle", "libelle operation", "label", "description", "intitule", "detail", "operation"],
    "amount": ["montant", "amount", "montant (eur)", "montant eur", "valeur"],
    "debit": ["debit", "debit (eur)", "debit eur", "sortie"],
    "credit": ["credit", "credit (eur)", "credit eur", "entree"],
}


def decode(raw: bytes) -> str:
    for enc in ("utf-8-sig", "cp1252"):
        try:
            return raw.decode(enc)
        except UnicodeDecodeError:
            continue
    raise ImportErrorFr("Encodage du fichier non reconnu.")


def _unwrap_quoted_lines(text: str) -> str | None:
    """Retire l'enveloppe de guillemets quand CHAQUE ligne est entourée de guillemets en
    entier (les guillemets internes étant doublés), comme après un passage par Excel ou un
    éditeur de texte. Renvoie None si le fichier n'a pas cette forme."""
    lines = [ln for ln in text.splitlines() if ln.strip()]
    if not lines or not all(ln.startswith('"') and ln.rstrip().endswith('"') for ln in lines):
        return None
    inner = [row[0] if row else "" for row in csv.reader(lines)]
    if not any(d in inner[0] for d in ",;\t"):
        return None
    return "\n".join(inner)


def read_rows(raw: bytes) -> tuple[list[str], list[dict]]:
    text = decode(raw)
    unwrapped = _unwrap_quoted_lines(text)
    if unwrapped is not None:
        text = unwrapped
    sample = text[:5000]
    try:
        dialect = csv.Sniffer().sniff(sample, delimiters=";,\t|")
    except csv.Error:
        class dialect(csv.excel):  # sous-classe locale : ne modifie pas csv.excel
            delimiter = ";" if sample.count(";") > sample.count(",") else ","
    reader = csv.DictReader(io.StringIO(text), dialect=dialect)
    headers = [h for h in (reader.fieldnames or []) if h is not None]
    if len(headers) < 2:
        raise ImportErrorFr("Impossible de lire les colonnes de ce CSV.")
    rows = [r for r in reader if any((v or "").strip() for v in r.values() if isinstance(v, str))]
    return headers, rows


def detect_preset(headers: list[str]) -> str | None:
    normed = {_norm(h) for h in headers}
    # Le préréglage le plus spécifique (signature la plus longue) l'emporte.
    for key, p in sorted(PRESETS.items(), key=lambda kv: -len(kv[1]["signature"])):
        if p["signature"] <= normed:
            return key
    return None


def guess_mapping(headers: list[str]) -> dict:
    by_norm = {_norm(h): h for h in headers}
    mapping: dict[str, str] = {}
    for field, names in GUESS.items():
        for n in names:
            if n in by_norm and by_norm[n] not in mapping.values():
                mapping[field] = by_norm[n]
                break
    if "amount" in mapping and ("debit" in mapping or "credit" in mapping):
        mapping.pop("debit", None)
        mapping.pop("credit", None)
    return mapping


def _resolve_preset_mapping(preset: str, headers: list[str]) -> dict:
    by_norm = {_norm(h): h for h in headers}
    return {k: by_norm[_norm(v)] for k, v in PRESETS[preset]["mapping"].items()}


def parse_csv(raw: bytes, mapping: dict | None = None) -> tuple[ParsedStatement, dict]:
    """Renvoie (relevé lu, infos pour le front : colonnes, mapping utilisé, préréglage)."""
    headers, rows = read_rows(raw)
    preset = detect_preset(headers)
    if preset and not mapping and "reader" in PRESETS[preset]:
        st = PRESETS[preset]["reader"](headers, rows)
        return st, {"headers": headers, "mapping": _resolve_preset_mapping(preset, headers), "preset": preset,
                    "preset_label": PRESETS[preset]["label"], "needs_mapping": False}
    if not mapping:
        mapping = _resolve_preset_mapping(preset, headers) if preset else guess_mapping(headers)

    info = {"headers": headers, "mapping": mapping, "preset": preset,
            "preset_label": PRESETS[preset]["label"] if preset else None}
    st = ParsedStatement(source="csv", parser=preset or "csv-generique")

    has_amount = "amount" in mapping
    has_split = "debit" in mapping or "credit" in mapping
    if "date" not in mapping or "label" not in mapping or not (has_amount or has_split):
        info["needs_mapping"] = True
        return st, info

    skipped = 0
    for r in rows:
        try:
            d = parse_date(r.get(mapping["date"], ""))
            label = " ".join((r.get(mapping["label"]) or "").split())
            if has_amount:
                cents = parse_amount(r.get(mapping["amount"], ""))
            else:
                deb = (r.get(mapping.get("debit", ""), "") or "").strip()
                cre = (r.get(mapping.get("credit", ""), "") or "").strip()
                cents = (parse_amount(cre) if cre else 0) - (abs(parse_amount(deb)) if deb else 0)
        except (ValueError, KeyError):
            skipped += 1
            continue
        if not label:
            label = "(sans libellé)"
        st.transactions.append(ParsedTransaction(date=d, label=label, amount_cents=cents))

    if skipped:
        st.warnings.append(f"{skipped} ligne(s) ignorée(s) car illisibles (date ou montant).")
    if st.transactions:
        dates = sorted(t.date for t in st.transactions)
        st.period_start, st.period_end = dates[0], dates[-1]
    info["needs_mapping"] = not st.transactions
    return st, info
