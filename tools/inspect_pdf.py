"""Affiche la STRUCTURE d'un relevé PDF, avec toutes les données masquées.

À lancer sur VOTRE ordinateur. Le script :
- lit le PDF localement (aucune connexion réseau),
- n'écrit aucun fichier,
- remplace chaque chiffre par 9 et chaque lettre par x, SAUF quelques mots
  bancaires génériques (SOLDE, DATE, DÉBIT, CRÉDIT, CB, PRLV, VIR…) qui
  m'aident à repérer les colonnes et les lignes de solde.

Relisez le résultat AVANT de le copier : il ne doit rester ni nom, ni adresse,
ni numéro de compte lisible. Vous pouvez supprimer toute ligne qui vous gêne.

Usage :
    Mac     : .venv/bin/python tools/inspect_pdf.py chemin/vers/releve.pdf
    Windows : .venv\\Scripts\\python tools\\inspect_pdf.py chemin\\vers\\releve.pdf
"""
from __future__ import annotations

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
}

LETTER = re.compile(r"[^\W\d_]", re.UNICODE)


def _plain(word: str) -> str:
    w = unicodedata.normalize("NFKD", word.lower())
    return "".join(c for c in w if not unicodedata.combining(c))


def mask_token(tok: str) -> str:
    core = re.sub(r"[^\w]", "", tok)
    if core and _plain(core) in KEEP:
        return tok
    tok = re.sub(r"\d", "9", tok)
    return LETTER.sub("x", tok)


def mask_line(line: str) -> str:
    # On découpe en gardant les espaces : la mise en colonnes reste visible.
    return "".join(mask_token(t) if not t.isspace() else t for t in re.split(r"(\s+)", line))


def main() -> None:
    # Terminal Windows : évite un plantage sur les caractères spéciaux (espaces insécables…).
    try:
        sys.stdout.reconfigure(errors="replace")
    except AttributeError:
        pass
    if len(sys.argv) != 2:
        print(__doc__)
        sys.exit(1)
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
