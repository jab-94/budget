"""Affiche la STRUCTURE d'un relevé PDF ou d'un export CSV, avec toutes les données masquées.

À lancer sur VOTRE ordinateur. Le script :
- lit le fichier localement (aucune connexion réseau),
- n'écrit aucun fichier,
- remplace chaque chiffre par 9 et chaque lettre par x, SAUF quelques mots
  bancaires génériques (SOLDE, DATE, DÉBIT, CRÉDIT, CB, PRLV, VIR…) qui
  m'aident à repérer les colonnes et les lignes de solde.

Relisez le résultat AVANT de le copier : il ne doit rester ni nom, ni adresse,
ni numéro de compte lisible. Vous pouvez supprimer toute ligne qui vous gêne.

Usage :
    Mac     : .venv/bin/python tools/inspect_pdf.py chemin/vers/releve.pdf
    Windows : .venv\\Scripts\\python tools\\inspect_pdf.py chemin\\vers\\releve.pdf
    (même commande avec un fichier .csv)
"""
from __future__ import annotations

import csv
import io
import re
import sys
import unicodedata

import pdfplumber

# Mots gardés en clair : vocabulaire bancaire générique, jamais personnel.
KEEP = {
    "solde", "soldes", "date", "dates", "valeur", "debit", "debits", "credit", "credits",
    "libelle", "libelles", "operation", "operations", "nature", "montant", "montants",
    "total", "totaux", "ancien", "nouveau", "precedent", "crediteur", "debiteur",
    "au", "du", "le", "la", "de", "des", "en", "et", "a", "par",
    "releve", "compte", "page", "periode", "euros", "eur", "frais", "cotisation",
    "cb", "carte", "prlv", "prelevement", "sepa", "vir", "virement", "inst", "recu", "emis",
    "retrait", "dab", "cheque", "remise", "avoir", "commission", "interets", "agios",
    "report", "reporter", "suite", "fin", "debut", "mouvements", "detail", "sous",
    # Types d'opérations génériques des exports CSV (souvent en anglais)
    "card", "transaction", "transactions", "transfer", "incoming", "outgoing", "interest",
    "buy", "sell", "deposit", "withdrawal", "dividend", "dividends", "fee", "fees", "tax",
    "taxes", "savings", "plan", "payment", "payments", "refund", "reward", "bonus", "trade",
    "order", "booking", "type", "status", "executed", "completed", "pending", "cancelled",
    "in", "out", "sepa", "direct", "debit", "credit", "amount", "currency", "balance",
    "date", "description", "category", "value", "eur", "usd", "true", "false", "none",
}

LETTER = re.compile(r"[^\W\d_]", re.UNICODE)


def _plain(word: str) -> str:
    w = unicodedata.normalize("NFKD", word.lower())
    return "".join(c for c in w if not unicodedata.combining(c))


def mask_token(tok: str) -> str:
    core = re.sub(r"[^\w]", "", tok)
    if core and _plain(core) in KEEP:
        return tok
    # Valeurs du type CARD_TRANSACTION : gardées seulement si CHAQUE morceau est générique.
    parts = [x for x in re.split(r"[_\-/]", _plain(tok)) if x]
    if parts and all(x in KEEP for x in parts):
        return tok
    tok = re.sub(r"\d", "9", tok)
    return LETTER.sub("x", tok)


def mask_line(line: str) -> str:
    # On découpe en gardant les espaces : la mise en colonnes reste visible.
    return "".join(mask_token(t) if not t.isspace() else t for t in re.split(r"(\s+)", line))


def inspect_csv(path: str, max_rows: int = 8) -> None:
    raw = open(path, "rb").read()
    for enc in ("utf-8-sig", "cp1252"):
        try:
            text = raw.decode(enc)
            break
        except UnicodeDecodeError:
            continue
    sample = text[:5000]
    try:
        delim = csv.Sniffer().sniff(sample, delimiters=";,\t|").delimiter
    except csv.Error:
        delim = ";" if sample.count(";") > sample.count(",") else ","
    rows = list(csv.reader(io.StringIO(text), delimiter=delim))
    print(f"# CSV : encodage {enc}, séparateur {delim!r}, {len(rows)} ligne(s)")
    if not rows:
        return
    # Les noms de colonnes sont masqués comme le reste, sauf vocabulaire générique.
    print("# Colonnes :")
    for i, h in enumerate(rows[0]):
        print(f"  {i}: {mask_line(h)}")
    print(f"# {min(max_rows, len(rows) - 1)} premières lignes (masquées) :")
    for r in rows[1 : 1 + max_rows]:
        print(delim.join(mask_line(c) for c in r))


def main() -> None:
    # Terminal Windows : évite un plantage sur les caractères spéciaux (espaces insécables…).
    try:
        sys.stdout.reconfigure(errors="replace")
    except AttributeError:
        pass
    if len(sys.argv) != 2:
        print(__doc__)
        sys.exit(1)
    if sys.argv[1].lower().endswith((".csv", ".txt")):
        inspect_csv(sys.argv[1])
        return
    with pdfplumber.open(sys.argv[1]) as pdf:
        print(f"# Pages : {len(pdf.pages)}")
        for i, page in enumerate(pdf.pages[:3], 1):  # 3 pages suffisent pour calibrer
            print(f"\n# ===== Page {i} (largeur {page.width:.0f}) =====")
            text = page.extract_text(layout=True) or ""
            for line in text.splitlines():
                if line.strip():
                    print(mask_line(line.rstrip()))


if __name__ == "__main__":
    main()
