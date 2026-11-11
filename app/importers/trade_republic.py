"""Lecteur de l'export CSV Trade Republic (« exportation de transactions »).

Colonnes confirmées sur un vrai export (en-têtes fournis en clair, sans données) :
    datetime, date, account_type, category, type, asset_class, name, symbol,
    shares, price, amount, fee, tax, currency, original_amount,
    original_currency, fx_rate, description, transaction_id,
    counterparty_name, counterparty_iban, payment_reference, mcc_code
Seules 8 colonnes servent à la reconnaissance (SIGNATURE) ; les autres sont
utilisées si elles sont présentes, sans être obligatoires.

Choix de lecture :
- `amount` a 6 décimales -> arrondi au centime.
- `fee` et `tax` deviennent des opérations séparées : les frais doivent
  apparaître comme tels (suggestions d'économies), et une taxe n'est pas un achat.
  Hypothèse : `amount` n'inclut PAS les frais ni les taxes (à confirmer sur un
  vrai export en comparant avec le solde affiché par l'application).
- Les achats/ventes de titres (catégorie TRADING, types BUY/SELL…) sont marqués
  « investissement » : c'est de l'épargne placée, pas une dépense.
"""
from __future__ import annotations

import unicodedata

from .base import ParsedStatement, ParsedTransaction, parse_date, parse_dot_decimal

# Colonnes vues en clair dans l'extrait : suffisantes et très spécifiques ensemble.
SIGNATURE = {"date", "category", "type", "amount", "fee", "tax", "currency", "description"}


def _norm_key(h: str) -> str:
    h = unicodedata.normalize("NFKD", h or "")
    return "".join(c for c in h if not unicodedata.combining(c)).strip().lower()


def classify(category: str, type_: str) -> str | None:
    """Nature de l'opération d'après les colonnes `category` et `type`."""
    c, t = (category or "").upper(), (type_ or "").upper()
    # Revenus, taxes et frais d'abord : un dividende est classé en TRADING par
    # Trade Republic, mais c'est un revenu, pas un placement.
    if "DIVIDEND" in t:
        return "dividende"
    if "INTEREST" in t:
        return "interets"
    if "TAX" in t:
        return "impot"
    if "FEE" in t:
        return "frais"
    if c == "TRADING" or t in {"BUY", "SELL"} or "SAVINGS_PLAN" in t or "TRADE" in t:
        return "investissement"
    if "CARD" in t:
        return "carte"
    if "TRANSFER" in t or "PAYMENT" in t or "PAYOUT" in t or "DIRECT_DEBIT" in t:
        return "virement"
    return None


def parse_rows(headers: list[str], rows: list[dict]) -> ParsedStatement:
    st = ParsedStatement(source="csv", parser="trade_republic")
    col = {_norm_key(h): h for h in headers}

    def get(r: dict, name: str) -> str:
        h = col.get(name)
        return (r.get(h) or "").strip() if h else ""

    skipped = foreign = 0
    for r in rows:
        try:
            d = parse_date(get(r, "date"))
            amount = parse_dot_decimal(get(r, "amount")) if get(r, "amount") else 0
            fee = parse_dot_decimal(get(r, "fee")) if get(r, "fee") else 0
            tax = parse_dot_decimal(get(r, "tax")) if get(r, "tax") else 0
        except ValueError:
            skipped += 1
            continue
        if get(r, "currency") and get(r, "currency").upper() != "EUR":
            foreign += 1
            continue

        hint = classify(get(r, "category"), get(r, "type"))
        label = " ".join(get(r, "description").split())
        if not label:
            label = " ".join(x for x in (get(r, "counterparty_name"), get(r, "name"), get(r, "type")) if x)
        label = label or "(sans libellé)"

        if amount:
            st.transactions.append(ParsedTransaction(date=d, label=label, amount_cents=amount, hint=hint))
        if fee:
            st.transactions.append(ParsedTransaction(
                date=d, label=f"Frais Trade Republic – {label}"[:200], amount_cents=-abs(fee), hint="frais"))
        if tax:
            # Une taxe peut aussi être un remboursement (montant positif) : on garde son signe.
            st.transactions.append(ParsedTransaction(
                date=d, label=f"Taxe – {label}"[:200], amount_cents=tax, hint="impot"))

    if skipped:
        st.warnings.append(f"{skipped} ligne(s) ignorée(s) car illisibles (date ou montant).")
    if foreign:
        st.warnings.append(f"{foreign} ligne(s) dans une autre devise que l'euro ignorée(s).")
    if any(t.hint == "investissement" for t in st.transactions):
        st.warnings.append(
            "Les achats et ventes de titres sont marqués « Investissement » : ils ne compteront pas "
            "comme des dépenses dans le budget."
        )
    if st.transactions:
        ds = sorted(t.date for t in st.transactions)
        st.period_start, st.period_end = ds[0], ds[-1]
    return st
