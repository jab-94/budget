"""Tests du salaire variable : moyennes lissées et revenu de référence prudent."""
from __future__ import annotations

import pytest

from app import categorize
from app.db import _new_connection, init_schema
from app.income import analysis, quantile, set_tracked_categories
from app.insights import insights


@pytest.fixture
def conn():
    c = _new_connection()
    init_schema(c)
    c.execute("INSERT INTO accounts(id, name) VALUES (1, 'LCL')")
    return c


def add(conn, d, label, cents):
    conn.execute("INSERT INTO transactions(account_id, date, label, amount_cents, fingerprint) VALUES (1,?,?,?,?)",
                 (d, label, cents, f"{d}{label}{cents}{conn.total_changes}"))


SALARIES = {"2026-01": 280000, "2026-02": 210000, "2026-03": 350000,
            "2026-04": 190000, "2026-05": 300000, "2026-06": 240000}


def fill(conn, salaries=SALARIES):
    for m, v in salaries.items():
        add(conn, f"{m}-28", "VIR SALAIRE EMPLOYEUR", v)
        add(conn, f"{m}-05", "CB CARREFOUR", -9000)
    categorize.categorize_all(conn)


def test_quantile():
    assert quantile([1, 2, 3, 4, 5], 0.25) == 2
    assert quantile([190000, 210000, 240000, 280000, 300000, 350000], 0.25) == 217500  # entre la 2e et la 3e valeur
    assert quantile([], 0.25) == 0


def test_prudent_reference_rule(conn):
    fill(conn)
    add(conn, "2026-07-03", "CB CARREFOUR", -5000)  # juillet commencé, salaire pas encore versé
    categorize.categorize_all(conn)
    a = analysis(conn, "2026-07")
    ref = a["reference"]
    vals = list(SALARIES.values())
    avg6 = sum(vals) / 6                         # 261 666,67
    assert ref["avg6_cents"] == round(avg6)
    assert ref["avg3_cents"] == round((190000 + 300000 + 240000) / 3)
    assert ref["q25_cents"] == 217500            # dépassé ~3 mois sur 4
    assert ref["avg6_minus_20_cents"] == round(avg6 * 0.8)  # 209 333
    # Le plus petit des deux : ici la moyenne − 20 %
    assert ref["prudent_cents"] == round(avg6 * 0.8) and ref["prudent_rule"] == "moyenne-20"
    assert ref["months"] == list(SALARIES)       # juillet (en cours) exclu de la référence
    assert a["enough_history"] and not a["current_received"]


def test_quartile_wins_when_one_month_is_huge(conn):
    """Un très bon mois gonfle la moyenne : le quartile protège."""
    fill(conn, {"2026-01": 200000, "2026-02": 200000, "2026-03": 200000,
                "2026-04": 200000, "2026-05": 200000, "2026-06": 900000})
    add(conn, "2026-07-01", "CB CARREFOUR", -100)
    categorize.categorize_all(conn)
    ref = analysis(conn, "2026-07")["reference"]
    assert ref["avg6_minus_20_cents"] == round(1900000 / 6 * 0.8)  # 253 333
    assert ref["prudent_cents"] == 200000 and ref["prudent_rule"] == "quartile"


def test_month_without_salary_counts_as_zero_but_month_without_data_is_ignored(conn):
    fill(conn, {"2026-01": 200000, "2026-03": 200000, "2026-04": 200000})
    add(conn, "2026-02-10", "CB CARREFOUR", -100)   # février : données, mais pas de salaire -> 0
    # (pas de données du tout en mai)
    add(conn, "2026-06-10", "CB CARREFOUR", -100)
    categorize.categorize_all(conn)
    ref = analysis(conn, "2026-06")["reference"]
    assert ref["months"] == ["2026-01", "2026-02", "2026-03", "2026-04"]
    assert ref["min_cents"] == 0 and ref["avg6_cents"] == 150000


def test_not_enough_history(conn):
    fill(conn, {"2026-01": 200000, "2026-02": 210000})
    add(conn, "2026-03-02", "CB CARREFOUR", -100)
    categorize.categorize_all(conn)
    a = analysis(conn, "2026-03")
    assert a["history_months"] == 2 and not a["enough_history"]


def test_remaining_to_live_counts_prudent_salary_until_received(conn):
    fill(conn)
    add(conn, "2026-07-03", "CB CARREFOUR", -5000)
    categorize.categorize_all(conn)
    rem = insights(conn, "2026-07")["remaining"]
    prudent = analysis(conn, "2026-07")["reference"]["prudent_cents"]
    assert rem["expected_salary_cents"] == prudent
    assert rem["remaining_cents"] == prudent - 5000 - rem["upcoming_expense_cents"]
    # Une fois le salaire versé, il est compté pour son montant réel, plus comme « attendu ».
    add(conn, "2026-07-04", "VIR SALAIRE EMPLOYEUR", 260000)
    categorize.categorize_all(conn)
    rem = insights(conn, "2026-07")["remaining"]
    assert rem["expected_salary_cents"] == 0 and rem["income_cents"] == 260000


def test_tracked_categories_setting(conn):
    fill(conn)
    other = conn.execute("SELECT id FROM categories WHERE name='Autres revenus'").fetchone()[0]
    add(conn, "2026-06-15", "VIR CAF", 20000)
    categorize.categorize_all(conn)
    set_tracked_categories(conn, [other])
    a = analysis(conn, "2026-07")
    assert a["category_names"] == ["Autres revenus"]
    assert a["series"][-2]["amount_cents"] == 20000  # juin


def test_api(client):
    client.post("/api/vault/create", json={"password": "une phrase de passe assez longue"})
    acc = client.post("/api/accounts", json={"name": "LCL"}).json()["id"]
    for m, v in SALARIES.items():
        client.post("/api/transactions", json={"account_id": acc, "date": f"{m}-28", "label": "VIR SALAIRE", "amount_cents": v})
    r = client.get("/api/income?month=2026-07").json()
    assert r["category_names"] == ["Salaire"] and r["reference"]["prudent_cents"] > 0
    cats = {c["name"]: c["id"] for c in r["income_categories"]}
    assert client.put("/api/income/categories", json={"category_ids": [cats["Salaire"], cats["Autres revenus"]]}).status_code == 200
    expense = {c["name"]: c["id"] for c in client.get("/api/categories").json()}["Alimentation"]
    assert client.put("/api/income/categories", json={"category_ids": [expense]}).status_code == 400
