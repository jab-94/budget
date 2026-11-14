"""Abonnements : au moins 3 mois au même montant, préférences de l'utilisateur, alertes."""
from __future__ import annotations

import pytest

from app import categorize
from app.db import _new_connection, init_schema
from app.insights import insights
from app.subscriptions import subscriptions, update_subscription


@pytest.fixture
def conn():
    c = _new_connection()
    init_schema(c)
    c.execute("INSERT INTO accounts(id, name) VALUES (1, 'LCL'), (2, 'Bourso')")
    return c


def add(conn, d, label, cents, account=1):
    conn.execute("INSERT INTO transactions(account_id, date, label, amount_cents, fingerprint) VALUES (?,?,?,?,?)",
                 (account, d, label, cents, f"{d}{label}{cents}{account}{conn.total_changes}"))
    return conn.execute("SELECT last_insert_rowid()").fetchone()[0]


def scenario(conn):
    """Même jeu de données que tests-web/logic.test.mjs (« abonnements »)."""
    for i, m in enumerate(["2026-01", "2026-02", "2026-03", "2026-04", "2026-05", "2026-06"]):
        add(conn, f"{m}-10", "PRLV SEPA NETFLIX", -1349 if i < 4 else -1599)   # hausse de prix en mai
        if i < 2:
            add(conn, f"{m}-12", "PRLV SEPA DEEZER", -1199)                     # seulement 2 mois
        if i < 3:
            add(conn, f"{m}-14", "PRLV SEPA SPOTIFY", -1099)                    # arrêté depuis mars
        add(conn, f"{m}-02", "VIR LOYER APPARTEMENT", -85000)                   # charge fixe, pas un abonnement
        add(conn, f"{m}-03", "PRLV SEPA BASIC FIT", -2999)
        add(conn, f"{m}-{5 + i:02d}", "CB BOULANGERIE DES AMIS", -120)          # 1,20 € plusieurs fois par mois
        add(conn, f"{m}-{20 + i:02d}", "CB BOULANGERIE DES AMIS", -120)
    add(conn, "2026-06-28", "VIR SALAIRE", 250000)
    categorize.categorize_all(conn)


def test_detection(conn):
    scenario(conn)
    out = subscriptions(conn)
    by = {x["key"]: x for x in out["items"]}
    assert set(by) == {"NETFLIX", "SPOTIFY", "BASIC FIT"}
    nf = by["NETFLIX"]
    assert (nf["amount_cents"], nf["price_change_cents"], nf["count"], nf["status"]) == (1599, 250, 6, "actif")
    assert nf["next_date"] == "2026-07-10" and nf["yearly_cents"] == 1599 * 12
    assert by["SPOTIFY"]["status"] == "arrete"
    assert out["totals"] == {"count": 2, "monthly_cents": 1599 + 2999, "yearly_cents": (1599 + 2999) * 12}


def test_preferences_and_alerts(conn):
    scenario(conn)
    by = {x["key"]: x for x in subscriptions(conn)["items"]}
    update_subscription(conn, {"id": by["BASIC FIT"]["id"], "status": "ignored"}, "2026-07-01")
    update_subscription(conn, {"id": by["NETFLIX"]["id"], "status": "cancelled", "cancelled_on": "2026-05-20",
                               "name": "Netflix (famille)"}, "2026-07-01")
    deezer = conn.execute("SELECT id FROM transactions WHERE label LIKE '%DEEZER%' LIMIT 1").fetchone()[0]
    from app.subscriptions import subscription_id_of
    update_subscription(conn, {"id": subscription_id_of("PRLV SEPA DEEZER", 1, -1199), "status": "confirmed"}, "2026-07-01")
    out = subscriptions(conn)
    by = {x["key"]: x for x in out["items"]}
    assert set(by) == {"NETFLIX", "SPOTIFY", "DEEZER"} and [i["name"] for i in out["ignored"]] == ["Basic Fit"]
    nf = by["NETFLIX"]
    assert nf["name"] == "Netflix (famille)" and nf["status"] == "resilie"
    assert nf["charged_after_cancel"] == [{"date": "2026-06-10", "amount_cents": 1599}]
    assert by["DEEZER"]["origin"] == "manuel" and deezer
    s = {x["kind"]: x for x in insights(conn, "2026-06")["suggestions"]}
    assert s["abonnement-resilie"]["severity"] == "bad" and "Netflix (famille)" in s["abonnement-resilie"]["title"]
    with pytest.raises(ValueError):
        update_subscription(conn, {"id": "x", "status": "confirmed"}, "2026-07-01")
    update_subscription(conn, {"id": nf["id"], "status": "auto", "name": ""}, "2026-07-01")
    assert {x["key"]: x for x in subscriptions(conn)["items"]}["NETFLIX"]["status"] == "actif"


def test_new_categories_and_rules(conn):
    for label, cents in (("VIR PRIME EXCEPTIONNELLE", 50000), ("VIR INTERESSEMENT 2025", 120000),
                         ("PRLV ECHEANCE PRET IMMO", -95000), ("CB AMAZON PRIME", -699)):
        add(conn, "2026-03-05", label, cents)
    categorize.categorize_all(conn)
    got = dict(conn.execute("SELECT t.label, c.name FROM transactions t LEFT JOIN categories c ON c.id=t.category_id"))
    assert got == {"VIR PRIME EXCEPTIONNELLE": "Primes", "VIR INTERESSEMENT 2025": "Intéressement et participation",
                   "PRLV ECHEANCE PRET IMMO": "Mensualités de prêt", "CB AMAZON PRIME": "Abonnements"}
    kinds = dict(conn.execute("SELECT name, kind FROM categories"))
    assert kinds["Cadeaux"] == "expense" and kinds["Cadeaux reçus"] == "income"
    assert kinds["Remboursements"] == "income" and kinds["Prêts entre proches"] == "transfer"


def test_existing_vault_gets_new_categories_once(conn):
    conn.execute("DELETE FROM categories WHERE name IN ('Cadeaux', 'Primes')")
    conn.execute("UPDATE meta SET value='3' WHERE key='defaults_version'")
    categorize.seed_defaults(conn)
    names = {r[0] for r in conn.execute("SELECT name FROM categories")}
    assert {"Cadeaux", "Primes"} <= names
    assert conn.execute("SELECT COUNT(*) FROM rules r JOIN categories c ON c.id=r.category_id WHERE c.name='Primes'").fetchone()[0] == 1
    conn.execute("DELETE FROM categories WHERE name='Cadeaux'")  # supprimée par l'utilisateur : pas recréée
    categorize.seed_defaults(conn)
    assert "Cadeaux" not in {r[0] for r in conn.execute("SELECT name FROM categories")}


def test_api(client):
    client.post("/api/vault/create", json={"password": "une phrase de passe assez longue"})
    acc = client.post("/api/accounts", json={"name": "LCL"}).json()["id"]
    for m in ("2026-01", "2026-02", "2026-03"):
        client.post("/api/transactions", json={"account_id": acc, "date": f"{m}-10", "label": "PRLV SEPA NETFLIX",
                                               "amount_cents": -1349})
    client.post("/api/transactions", json={"account_id": acc, "date": "2026-03-15", "label": "PRLV SEPA DEEZER",
                                           "amount_cents": -1199})
    out = client.get("/api/subscriptions").json()
    assert [x["key"] for x in out["items"]] == ["NETFLIX"]
    deezer = next(t for t in client.get("/api/transactions").json() if "DEEZER" in t["label"])
    assert client.post("/api/subscriptions/mark", json={"transaction_id": deezer["id"]}).status_code == 200
    sid = out["items"][0]["id"]
    assert client.post("/api/subscriptions/update", json={"id": sid, "status": "cancelled"}).status_code == 200
    assert client.post("/api/subscriptions/update", json={"id": sid, "cadence": "hebdo"}).status_code == 400
    items = {x["key"]: x for x in client.get("/api/subscriptions").json()["items"]}
    assert items["NETFLIX"]["status"] == "resilie" and items["DEEZER"]["origin"] == "manuel"


def test_api_category_kind_change_and_protected_name(client):
    client.post("/api/vault/create", json={"password": "une phrase de passe assez longue"})
    cats = {c["name"]: c for c in client.get("/api/categories").json()}
    r = client.put(f"/api/categories/{cats['Remboursements']['id']}", json={"name": "Remboursements", "kind": "expense"})
    assert r.status_code == 200
    assert {c["name"]: c for c in client.get("/api/categories").json()}["Remboursements"]["kind"] == "expense"
    r = client.put(f"/api/categories/{cats['Salaire']['id']}", json={"name": "Paie", "kind": "income"})
    assert r.status_code == 400
    assert client.put(f"/api/categories/{cats['Salaire']['id']}", json={"name": "Salaire", "kind": "income",
                                                                         "color": "#123456"}).status_code == 200
