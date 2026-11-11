"""Export CSV Trade Republic — structure calquée sur un extrait masqué, données inventées."""
from __future__ import annotations

import csv
import io

from app.importers.base import parse_dot_decimal
from app.importers.csv_import import parse_csv
from app.importers.trade_republic import classify

HEADERS = ["datetime", "date", "account_type", "category", "type", "asset_class", "name", "symbol",
           "shares", "price", "amount", "fee", "tax", "currency", "original_amount", "original_currency",
           "fx_rate", "description", "transaction_id", "counterparty_name", "counterparty_iban",
           "payment_reference", "mcc_code"]


def _row(date, category, type_, amount, description, fee="", tax="", currency="EUR", **extra):
    r = dict.fromkeys(HEADERS, "")
    r.update(datetime=f"{date}T10:00:00.000000Z", date=date, account_type="DEFAULT", category=category,
             type=type_, amount=amount, fee=fee, tax=tax, currency=currency, description=description,
             transaction_id="00000000-0000-0000-0000-000000000000", **extra)
    return r


ROWS = [
    _row("2026-03-01", "CASH", "CUSTOMER_INPAYMENT", "500.000000", "Ajout par carte"),
    _row("2026-03-02", "CASH", "TRANSFER_INSTANT_INBOUND", "1250.500000", "Incoming transfer from Jean Exemple"),
    _row("2026-03-03", "TRADING", "BUY", "-49.990000", "Buy trade XX0000000000 Fonds Exemple, quantity: 0.5",
         fee="-1.000000", asset_class="FUND", name="Fonds Exemple USD (Acc)", shares="0.5000000000", price="99.980000"),
    _row("2026-03-04", "TRADING", "SAVINGS_PLAN_EXECUTION", "-25.004999", "Savings plan execution XX0000000001"),
    _row("2026-03-05", "CASH", "INTEREST_PAYOUT", "3.125000", "Your interest payment"),
    _row("2026-03-06", "CASH", "CARD_TRANSACTION", "-12.345000", "BOULANGERIE EXEMPLE", mcc_code="5462"),
    _row("2026-03-07", "TRADING", "DIVIDEND", "4.200000", "Dividend XX0000000002", tax="-0.630000"),
    _row("2026-03-08", "CASH", "CARD_TRANSACTION", "-10.000000", "SHOP USA", currency="USD"),
]


def _csv_bytes(rows=ROWS) -> bytes:
    buf = io.StringIO()
    w = csv.DictWriter(buf, fieldnames=HEADERS)
    w.writeheader()
    w.writerows(rows)
    return ("﻿" + buf.getvalue()).encode("utf-8")  # utf-8 avec BOM, comme l'export réel


def test_detected_and_parsed():
    st, info = parse_csv(_csv_bytes())
    assert info["preset"] == "trade_republic" and not info["needs_mapping"]
    got = [(t.date, t.amount_cents, t.hint) for t in st.transactions]
    assert got == [
        ("2026-03-01", 50000, "virement"),
        ("2026-03-02", 125050, "virement"),
        ("2026-03-03", -4999, "investissement"),
        ("2026-03-03", -100, "frais"),        # frais séparés de l'achat
        ("2026-03-04", -2500, "investissement"),  # -25.004999 arrondi au centime
        ("2026-03-05", 313, "interets"),      # 3.125 -> 3,13 (arrondi au plus proche)
        ("2026-03-06", -1235, "carte"),
        ("2026-03-07", 420, "dividende"),
        ("2026-03-07", -63, "impot"),         # taxe séparée du dividende
    ]
    assert st.transactions[3].label.startswith("Frais Trade Republic")
    assert any("autre devise" in w for w in st.warnings)       # ligne USD écartée
    assert any("Investissement" in w for w in st.warnings)


def test_only_visible_columns_required():
    """La reconnaissance ne dépend que des colonnes vues en clair dans l'extrait."""
    from app.importers.trade_republic import SIGNATURE

    minimal = ["date", "category", "type", "amount", "fee", "tax", "currency", "description"]
    assert SIGNATURE == set(minimal)
    raw = ",".join(minimal) + "\n2026-03-05,CASH,INTEREST_PAYOUT,1.500000,,,EUR,Interest\n"
    st, info = parse_csv(raw.encode())
    assert info["preset"] == "trade_republic"
    assert st.transactions[0].amount_cents == 150


def test_parse_dot_decimal():
    assert parse_dot_decimal("999.999999") == 100000
    assert parse_dot_decimal("-0.005") == -1
    assert parse_dot_decimal("12") == 1200
    for bad in ("1,5", "abc", ""):
        try:
            parse_dot_decimal(bad)
        except ValueError:
            continue
        raise AssertionError(bad)


def test_classify():
    assert classify("TRADING", "SELL") == "investissement"
    assert classify("CASH", "TRANSFER_OUTBOUND") == "virement"
    assert classify("CASH", "SOMETHING_NEW") is None


def test_api_keeps_hint(client):
    client.post("/api/vault/create", json={"password": "une phrase de passe assez longue"})
    acc = client.post("/api/accounts", json={"name": "TR", "bank": "Trade Republic"}).json()["id"]
    pv = client.post(f"/api/import/preview?account_id={acc}&fmt=csv", content=_csv_bytes(),
                     headers={"Content-Type": "application/octet-stream"}).json()
    client.post("/api/import/commit", json={"account_id": acc, "source": "csv", "transactions": [
        {k: t[k] for k in ("date", "label", "amount_cents", "fingerprint", "hint")} for t in pv["transactions"]]})
    hints = {t["hint"] for t in client.get("/api/transactions").json()}
    assert {"investissement", "frais", "impot", "interets"} <= hints
    # Réimport : tout est reconnu comme déjà importé
    again = client.post(f"/api/import/preview?account_id={acc}&fmt=csv", content=_csv_bytes(),
                        headers={"Content-Type": "application/octet-stream"}).json()
    assert all(t["duplicate"] == "exact" for t in again["transactions"])


# En-tête exact d'un vrai export, tel que fourni (sans données), avec chaque ligne
# entourée de guillemets comme après un passage par Excel ou un éditeur de texte.
REAL_HEADER_WRAPPED = ('"datetime,""date"",""account_type"",""category"",""type"",""asset_class"",""name"",'
                       '""symbol"",""shares"",""price"",""amount"",""fee"",""tax"",""currency"",""original_amount"",'
                       '""original_currency"",""fx_rate"",""description"",""transaction_id"",""counterparty_name"",'
                       '""counterparty_iban"",""payment_reference"",""mcc_code"""')


def test_real_header_matches_fixture():
    from app.importers.csv_import import _unwrap_quoted_lines

    assert next(csv.reader([_unwrap_quoted_lines(REAL_HEADER_WRAPPED)])) == HEADERS


def test_wrapped_lines_are_unwrapped():
    line = '"2026-03-05T10:00:00Z,""2026-03-05"",""DEFAULT"",""CASH"",""INTEREST_PAYOUT"",' + '"""",' * 5 \
        + '""1.500000"",' + '"""",' * 2 + '""EUR"",' + '"""",' * 3 + '""Interest"",' + '"""",' * 4 + '"""""'
    st, info = parse_csv((REAL_HEADER_WRAPPED + "\n" + line + "\n").encode("utf-8"))
    assert info["preset"] == "trade_republic"
    assert [(t.amount_cents, t.hint) for t in st.transactions] == [(150, "interets")]
