"""Tests des suggestions d'économies (récurrences, hausses, frais, doublons, reste à vivre)."""
from __future__ import annotations

from datetime import date

import pytest

from app import categorize
from app.db import _new_connection, init_schema
from app.insights import insights, merchant_key


@pytest.fixture
def conn():
    c = _new_connection()
    init_schema(c)
    c.execute("INSERT INTO accounts(id, name) VALUES (1, 'LCL'), (2, 'Bourso')")
    return c


def add(conn, d, label, cents, account=1):
    conn.execute("INSERT INTO transactions(account_id, date, label, amount_cents, fingerprint) VALUES (?,?,?,?,?)",
                 (account, d, label, cents, f"{d}{label}{cents}{account}{conn.total_changes}"))


MONTHS = ["2026-01", "2026-02", "2026-03", "2026-04", "2026-05", "2026-06"]


def monthly(conn, label, amounts, day=10, account=1):
    for m, a in zip(MONTHS, amounts):
        if a is not None:
            add(conn, f"{m}-{day:02d}", label, a, account)


def by_key(items):
    return {x["key"]: x for x in items}


def test_merchant_key():
    assert merchant_key("PRLV SEPA NETFLIX") == "NETFLIX"
    assert merchant_key("CB CARREFOUR MARKET 02/03") == "CARREFOUR MARKET"
    assert merchant_key("PRLV SEPA FREE MOBILE REF 123456") == "FREE MOBILE"


def test_recurring_detection_and_price_change(conn):
    monthly(conn, "PRLV SEPA NETFLIX", [-1349] * 5 + [-1599])          # hausse de prix au dernier mois
    monthly(conn, "PRLV SEPA EDF", [-4500, -8200, -5900, -6100, -9100, -7000], day=8)  # montant variable (±39 %)
    monthly(conn, "VIR INST LOYER APPARTEMENT", [-85000] * 6, day=2)
    monthly(conn, "VIR SACEM", [180000, 320000, 90000, 410000, 150000, 260000], day=5)  # trop irrégulier
    for m in MONTHS:  # courses hebdomadaires aux montants très variables : PAS un prélèvement
        for d, a in ((4, -2300), (11, -8900), (18, -4100), (25, -12000)):
            add(conn, f"{m}-{d:02d}", "CB CARREFOUR MARKET", a)
    categorize.categorize_all(conn)
    r = by_key(insights(conn)["recurring"])
    assert set(r) == {"NETFLIX", "EDF", "LOYER APPARTEMENT"}
    nf = r["NETFLIX"]
    assert (nf["cadence"], nf["amount_cents"], nf["price_change_cents"], nf["is_subscription"]) == ("mensuel", 1599, 250, True)
    assert nf["next_date"] == "2026-07-10" and nf["active"]
    assert r["EDF"]["variable"] and not r["EDF"]["is_subscription"]
    assert not r["LOYER APPARTEMENT"]["is_subscription"]  # charge fixe, pas un abonnement
    assert r["LOYER APPARTEMENT"]["yearly_cents"] == 85000 * 12


def test_suggestions(conn):
    monthly(conn, "PRLV SEPA NETFLIX", [-1349] * 5 + [-1599])
    monthly(conn, "PRLV SEPA SPOTIFY", [-1099] * 3 + [None] * 3)       # arrêté depuis mars
    monthly(conn, "COTISATION CARTE", [-450] * 6, day=3)
    for m, a in zip(MONTHS, [-9000, -8000, -10000, -9000, -9500, -21000]):
        add(conn, f"{m}-21", "CB RESTAURANT LE PETIT", a)               # restaurants en forte hausse en juin
    add(conn, "2026-06-15", "CB FNAC", -12999)
    add(conn, "2026-06-16", "CB FNAC", -12999)                           # doublon suspect
    categorize.categorize_all(conn)
    out = insights(conn, "2026-06")
    kinds = {s["kind"]: s for s in out["suggestions"]}
    assert "hausse-prix" in kinds and kinds["hausse-prix"]["yearly_saving_cents"] == 250 * 12
    assert "arrete" in kinds and "Spotify" in kinds["arrete"]["title"]
    assert kinds["hausse-categorie"]["category_id"] is not None and "Restaurants" in kinds["hausse-categorie"]["title"]
    assert kinds["frais"]["yearly_saving_cents"] == 450 * 12  # 6 mois d'historique extrapolés à 12 mois
    assert kinds["doublon"]["severity"] == "bad"
    assert out["suggestions"][0]["kind"] == "doublon"  # le plus grave d'abord
    assert kinds["abonnements"]["title"].startswith("1 abonnement")


def test_no_increase_without_history(conn):
    add(conn, "2026-06-05", "CB RESTAURANT", -50000)
    categorize.categorize_all(conn)
    assert not any(s["kind"] == "hausse-categorie" for s in insights(conn)["suggestions"])


def test_internal_transfers_ignored(conn):
    for m in MONTHS:
        add(conn, f"{m}-06", "VIR INST VERS BOURSO", -50000, 1)
        add(conn, f"{m}-06", "VIR RECU DEPUIS LCL", 50000, 2)
    categorize.categorize_all(conn)
    assert insights(conn)["recurring"] == []


def test_remaining_to_live(conn):
    monthly(conn, "PRLV SEPA NETFLIX", [-1349] * 6, day=20)
    monthly(conn, "VIR INST LOYER APPARTEMENT", [-85000] * 6, day=25)
    add(conn, "2026-06-01", "VIR SACEM", 200000)
    add(conn, "2026-06-05", "CB CARREFOUR", -10000)
    # On retire les prélèvements de fin juin : relevé arrêté au 10 juin.
    conn.execute("DELETE FROM transactions WHERE date > '2026-06-10'")
    categorize.categorize_all(conn)
    rem = insights(conn)["remaining"]
    assert rem["as_of"] == "2026-06-05" and rem["days_left"] == 25
    assert rem["upcoming_expense_cents"] == 1349 + 85000
    assert rem["remaining_cents"] == 200000 - 10000 - 1349 - 85000
    assert rem["per_day_cents"] == round(rem["remaining_cents"] / 25)
    upcoming = insights(conn)["upcoming"]
    assert [u["key"] for u in upcoming][:2] == ["NETFLIX", "LOYER APPARTEMENT"]


def test_dismiss_via_api(client):
    client.post("/api/vault/create", json={"password": "une phrase de passe assez longue"})
    acc = client.post("/api/accounts", json={"name": "LCL"}).json()["id"]
    for d in ("2026-06-15", "2026-06-16"):
        client.post("/api/transactions", json={"account_id": acc, "date": d, "label": "CB FNAC", "amount_cents": -12999})
    sug = client.get("/api/insights").json()["suggestions"]
    dup = next(s for s in sug if s["kind"] == "doublon")
    client.post("/api/insights/dismiss", json={"id": dup["id"]})
    after = client.get("/api/insights").json()
    assert not any(s["kind"] == "doublon" for s in after["suggestions"]) and after["dismissed_count"] == 1
    client.delete("/api/insights/dismiss")
    assert any(s["kind"] == "doublon" for s in client.get("/api/insights").json()["suggestions"])


def test_variable_card_purchases_are_not_recurring_nor_price_changes(conn):
    """Restaurant ou train payés par carte chaque mois, montants variables : ni prélèvement, ni « hausse de prix »."""
    monthly(conn, "CB SNCF CONNECT", [-4500, -10500, -4500, -10500, -4500, -10500], day=16)
    monthly(conn, "CB RESTAURANT LE PETIT", [-3800, -6300, -8800, -3800, -6300, -8800], day=21)
    monthly(conn, "PRLV SEPA EDF", [-4500, -8200, -5900, -6100, -9100, -7000], day=8)   # facture prélevée : acceptée
    monthly(conn, "CB SALLE DE SPORT", [-2990] * 6, day=1)                              # carte, montant fixe : acceptée
    categorize.categorize_all(conn)
    out = insights(conn)
    keys = by_key(out["recurring"])
    assert set(keys) == {"EDF", "SALLE SPORT"}
    assert keys["EDF"]["price_change_cents"] == 0       # facture variable : pas de « hausse de prix »
    assert not any(s["kind"] == "hausse-prix" for s in out["suggestions"])


def test_price_rise_keeps_subscription_fixed(conn):
    monthly(conn, "PRLV SEPA NETFLIX", [-1349] * 5 + [-1599])
    categorize.categorize_all(conn)
    nf = by_key(insights(conn)["recurring"])["NETFLIX"]
    assert not nf["variable"] and nf["price_change_cents"] == 250
