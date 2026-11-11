"""Tests du tableau de bord et des budgets."""
from __future__ import annotations

import pytest

from app import categorize
from app.dashboard import dashboard, month_add
from app.db import _new_connection, init_schema


@pytest.fixture
def conn():
    c = _new_connection()
    init_schema(c)
    c.execute("INSERT INTO accounts(id, name) VALUES (1, 'LCL'), (2, 'Bourso')")
    return c


def add(conn, d, label, cents, account=1):
    conn.execute("INSERT INTO transactions(account_id, date, label, amount_cents, fingerprint) VALUES (?,?,?,?,?)",
                 (account, d, label, cents, f"{d}{label}{cents}{account}"))


def cid(conn, name):
    return conn.execute("SELECT id FROM categories WHERE name=?", (name,)).fetchone()[0]


def by_name(items):
    return {x["name"]: x for x in items}


def test_month_add():
    assert month_add("2026-01", -1) == "2025-12"
    assert month_add("2026-12", 1) == "2027-01"
    assert month_add("2026-03", -14) == "2025-01"


def test_counting_rules(conn):
    add(conn, "2026-03-01", "VIR SALAIRE EMPLOYEUR", 300000)        # revenu (salaire)
    add(conn, "2026-03-02", "CB CARREFOUR", -10000)                 # dépense
    add(conn, "2026-03-03", "CB PHARMACIE", -5000)                  # dépense santé
    add(conn, "2026-03-04", "VIR CPAM REMBOURSEMENT", 3000)         # remboursement santé (règle CPAM)
    add(conn, "2026-03-05", "VIR INST VERS BOURSO", -50000, 1)      # virement interne…
    add(conn, "2026-03-05", "VIR RECU DE LCL", 50000, 2)            # …hors budget
    add(conn, "2026-03-06", "CB MAGASIN INCONNU", -2000)            # non classé
    add(conn, "2026-02-10", "CB CARREFOUR", -8000)                  # mois précédent
    categorize.categorize_all(conn)

    d = dashboard(conn, "2026-03")
    assert d["totals"] == {"income_cents": 300000, "expense_cents": 10000 + 2000 + 2000, "net_cents": 286000}
    exp = by_name(d["expenses_by_category"])
    assert exp["Santé"]["amount_cents"] == 2000          # 50 € - 30 € remboursés
    assert exp["Alimentation"]["avg3_cents"] == 8000     # moyenne des mois précédents avec données
    assert exp["À classer"]["amount_cents"] == 2000
    assert "Virements internes" not in exp
    assert d["previous"]["expense_cents"] == 8000
    assert d["savings_rate"] == round(286000 / 300000 * 100, 1)
    assert d["uncategorized_count"] == 1
    assert [t["label"] for t in d["top_expenses"]][:1] == ["CB CARREFOUR"]  # le virement interne n'y est pas


def test_default_month_is_latest_with_data(conn):
    add(conn, "2025-11-03", "CB CARREFOUR", -100)
    add(conn, "2026-01-03", "CB CARREFOUR", -100)
    d = dashboard(conn, None)
    assert d["month"] == "2026-01"
    assert d["months_available"] == ["2025-11", "2026-01"]


def test_series_and_category_filter(conn):
    for m, v in (("2026-01", -100), ("2026-02", -200), ("2026-03", -300)):
        add(conn, f"{m}-05", "CB CARREFOUR", v)
        add(conn, f"{m}-06", "SALAIRE", 1000)
    categorize.categorize_all(conn)
    d = dashboard(conn, "2026-03", months_back=6, category_id=cid(conn, "Alimentation"))
    assert [p["month"] for p in d["series"]] == ["2025-10", "2025-11", "2025-12", "2026-01", "2026-02", "2026-03"]
    assert [p["category_cents"] for p in d["series"]][-3:] == [100, 200, 300]
    assert [p["has_data"] for p in d["series"]] == [False, False, False, True, True, True]
    assert d["category_filter"] == "Alimentation"


def test_account_filter(conn):
    add(conn, "2026-03-05", "CB CARREFOUR", -100, 1)
    add(conn, "2026-03-05", "CB CARREFOUR", -900, 2)
    categorize.categorize_all(conn)
    assert dashboard(conn, "2026-03", account_id=2)["totals"]["expense_cents"] == 900


def test_budget_status(conn):
    add(conn, "2026-03-05", "CB CARREFOUR", -8500)
    add(conn, "2026-03-05", "CB RESTAURANT", -12000)
    categorize.categorize_all(conn)
    conn.execute("INSERT INTO budgets VALUES (?, 10000)", (cid(conn, "Alimentation"),))
    conn.execute("INSERT INTO budgets VALUES (?, 10000)", (cid(conn, "Restaurants"),))
    conn.execute("INSERT INTO budgets VALUES (?, 10000)", (cid(conn, "Loisirs"),))
    b = by_name(dashboard(conn, "2026-03")["budgets"])
    assert (b["Alimentation"]["budget_status"], b["Alimentation"]["budget_pct"]) == ("warn", 85.0)
    assert b["Restaurants"]["budget_status"] == "over"
    assert (b["Loisirs"]["budget_status"], b["Loisirs"]["spent_cents"]) == ("ok", 0)  # plafond sans dépense


def test_api(client):
    client.post("/api/vault/create", json={"password": "une phrase de passe assez longue"})
    acc = client.post("/api/accounts", json={"name": "LCL"}).json()["id"]
    client.post("/api/transactions", json={"account_id": acc, "date": "2026-03-05", "label": "CB CARREFOUR",
                                           "amount_cents": -4000})
    cats = {c["name"]: c["id"] for c in client.get("/api/categories").json()}
    assert client.put(f"/api/budgets/{cats['Alimentation']}", json={"monthly_limit_cents": 5000}).status_code == 200
    assert client.put(f"/api/budgets/{cats['Salaire']}", json={"monthly_limit_cents": 5000}).status_code == 400
    d = client.get("/api/dashboard").json()
    assert d["month"] == "2026-03" and d["budgets"][0]["budget_status"] == "warn"
    assert client.get("/api/dashboard?month=2026-13").status_code == 400
    client.put(f"/api/budgets/{cats['Alimentation']}", json={"monthly_limit_cents": None})
    assert client.get("/api/dashboard").json()["budgets"] == []
    assert any(b["name"] == "Alimentation" for b in client.get("/api/budgets").json())
