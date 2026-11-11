"""Tests de la catégorisation par règles locales."""
from __future__ import annotations

import sqlite3

import pytest

from app import categorize
from app.db import _new_connection, init_schema

PW = "une phrase de passe assez longue"


@pytest.fixture
def conn():
    c = _new_connection()
    init_schema(c)
    c.execute("INSERT INTO accounts(id, name) VALUES (1, 'LCL'), (2, 'Bourso')")
    return c


def add(conn, label, cents, account=1, d="2026-03-05", hint=None):
    cur = conn.execute(
        "INSERT INTO transactions(account_id, date, label, amount_cents, fingerprint, hint) VALUES (?,?,?,?,?,?)",
        (account, d, label, cents, f"fp{label}{cents}{account}{d}", hint),
    )
    return cur.lastrowid


def cat_of(conn, tx_id):
    r = conn.execute(
        "SELECT c.name, t.category_source FROM transactions t LEFT JOIN categories c ON c.id=t.category_id "
        "WHERE t.id=?", (tx_id,)).fetchone()
    return r[0], r[1]


def cid(conn, name):
    return conn.execute("SELECT id FROM categories WHERE name=?", (name,)).fetchone()[0]


def test_default_rules(conn):
    ids = {
        add(conn, "CB CARREFOUR MARKET 02/03", -4590): "Alimentation",
        add(conn, "PRLV SEPA FREE MOBILE", -1999): "Abonnements",
        add(conn, "CB UBER EATS PARIS", -2500): "Restaurants",   # plus précis que « UBER »
        add(conn, "CB UBER BV", -1800): "Transports",
        add(conn, "VIR SALAIRE MARS", 215000): "Salaire",
        add(conn, "CB PHARMACIE DU CENTRE", -1200): "Santé",
        add(conn, "COTISATION CARTE", -450): "Frais bancaires",
        add(conn, "RETRAIT DAB 03/03", -5000): "Espèces",
        add(conn, "CB MAGASIN INCONNU", -999): None,
    }
    categorize.categorize_all(conn)
    for tx, expected in ids.items():
        assert cat_of(conn, tx)[0] == expected


def test_whole_words_only(conn):
    tx = add(conn, "CB CARREFOURMARKETXYZ", -100)   # pas le mot entier
    tx2 = add(conn, "CB SUPER UTILE", -100)          # « SUPER U » ne doit pas trouver « SUPER UTILE »
    categorize.categorize_all(conn)
    assert cat_of(conn, tx)[0] is None and cat_of(conn, tx2)[0] is None


def test_sign_restriction(conn):
    pay = add(conn, "VIR SALAIRE MARS", 300000)
    odd = add(conn, "PRLV REGULARISATION SALAIRE", -2000)  # sortie : la règle « Salaire » (revenus seulement) ne s'applique pas
    categorize.categorize_all(conn)
    assert cat_of(conn, pay)[0] == "Salaire"
    assert cat_of(conn, odd)[0] is None


def test_user_rule_beats_default(conn):
    tx = add(conn, "CB CARREFOUR CITY", -500)
    conn.execute("INSERT INTO rules(pattern, category_id, priority, origin) VALUES ('CARREFOUR CITY', ?, 10, 'user')",
                 (cid(conn, "Restaurants"),))
    categorize.categorize_all(conn)
    assert cat_of(conn, tx) == ("Restaurants", "regle")


def test_regex_rule(conn):
    tx = add(conn, "PRLV SEPA ABC-123-ASSUR", -3000)
    conn.execute("INSERT INTO rules(pattern, is_regex, category_id, priority, origin) VALUES (?,1,?,10,'user')",
                 (r"abc-\d+-assur", cid(conn, "Logement")))
    categorize.categorize_all(conn)
    assert cat_of(conn, tx)[0] == "Logement"


def test_internal_transfer_pairs(conn):
    out_ = add(conn, "VIR INST VERS BOURSO", -50000, account=1, d="2026-03-10")
    in_ = add(conn, "VIREMENT RECU DE LCL", 50000, account=2, d="2026-03-11")
    same_acc = add(conn, "VIR REMBOURSEMENT AMI", 50000, account=1, d="2026-03-10")  # même compte : pas interne
    far = add(conn, "VIR VERS LIVRET", -20000, account=1, d="2026-03-01")
    far_in = add(conn, "VIR DEPUIS LCL", 20000, account=2, d="2026-03-20")       # 19 jours : pas une paire
    card = add(conn, "CB RESTAURANT", -3000, account=1)
    card_refund = add(conn, "CB REMB RESTAURANT", 3000, account=2)              # pas un virement
    categorize.categorize_all(conn)
    assert cat_of(conn, out_) == ("Virements internes", "virement-interne")
    assert cat_of(conn, in_) == ("Virements internes", "virement-interne")
    for tx in (same_acc, far, far_in, card_refund):
        assert cat_of(conn, tx)[0] != "Virements internes"
    assert cat_of(conn, card)[0] == "Restaurants"


def test_hints(conn):
    buy = add(conn, "Buy trade XX000 Fonds", -5000, hint="investissement")
    div = add(conn, "Dividend XX000", 420, hint="dividende")
    debit_interest = add(conn, "INTERETS", -123, hint="interets")
    categorize.categorize_all(conn)
    assert cat_of(conn, buy) == ("Investissement", "source")
    assert cat_of(conn, div)[0] == "Revenus financiers"
    assert cat_of(conn, debit_interest)[0] == "Frais bancaires"


def test_locked_never_changed(conn):
    tx = add(conn, "CB CARREFOUR", -100)
    conn.execute("UPDATE transactions SET category_id=?, category_locked=1, category_source='manuel' WHERE id=?",
                 (cid(conn, "Loisirs"), tx))
    categorize.categorize_all(conn)
    assert cat_of(conn, tx) == ("Loisirs", "manuel")


def test_suggest_pattern():
    assert categorize.suggest_pattern("PRLV SEPA FREE MOBILE") == "FREE MOBILE"
    assert categorize.suggest_pattern("CB CARREFOUR MARKET 02/03") == "CARREFOUR MARKET"
    assert categorize.suggest_pattern("VIR INST MARIE DURAND") == "MARIE DURAND"
    assert categorize.suggest_pattern("CB BOULANGERIE DES AMIS") == "BOULANGERIE DES AMIS"
    assert categorize.suggest_pattern("PRLV SEPA ASSURANCE DE LA MAISON") == "ASSURANCE"


@pytest.mark.parametrize("label", [
    "CB BOULANGERIE DES AMIS", "PRLV SEPA FREE MOBILE", "VIR INST MARIE DURAND", "CB CARREFOUR MARKET 02/03",
    "PRLV SEPA COMPAGNIE ASSURANCE DES PARTICULIERS DE FR CONTRAT HABITATION", "Buy trade XX0000000000 Fonds",
    "CB 4970XXXXXX1234 AMAZON EU", "VIR", "Ajout par carte",
])
def test_suggestion_always_matches_its_own_label(label):
    pattern = categorize.suggest_pattern(label)
    if not pattern:
        return
    rule = categorize.Rule(0, pattern, False, 0, None, "user").prepare()
    norm = f" {categorize.normalize_label(label)} "
    assert rule.matches(label, norm, -100), (label, pattern)


def test_validate_pattern():
    with pytest.raises(ValueError):
        categorize.validate_pattern("(", True)
    with pytest.raises(ValueError):
        categorize.validate_pattern("  ", False)
    with pytest.raises(ValueError):
        categorize.validate_pattern("!!!", False)
    assert categorize.validate_pattern(" netflix ", False) == "netflix"


def test_seed_once_and_migration_from_v3():
    """Un coffre créé avant l'étape 3 reçoit les nouvelles catégories et règles, une seule fois."""
    c = sqlite3.connect(":memory:")
    c.row_factory = sqlite3.Row
    c.executescript("""
        CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
        INSERT INTO meta VALUES ('schema_version', '3');
        CREATE TABLE categories (id INTEGER PRIMARY KEY, name TEXT NOT NULL UNIQUE,
            kind TEXT NOT NULL DEFAULT 'expense', color TEXT);
        CREATE TABLE rules (id INTEGER PRIMARY KEY, pattern TEXT NOT NULL, is_regex INTEGER NOT NULL DEFAULT 0,
            category_id INTEGER NOT NULL, priority INTEGER NOT NULL DEFAULT 100,
            created_from_correction INTEGER NOT NULL DEFAULT 0);
        CREATE TABLE accounts (id INTEGER PRIMARY KEY, name TEXT NOT NULL, bank TEXT, kind TEXT NOT NULL DEFAULT 'courant');
        CREATE TABLE transactions (id INTEGER PRIMARY KEY, account_id INTEGER, statement_id INTEGER, date TEXT NOT NULL,
            label TEXT NOT NULL, amount_cents INTEGER NOT NULL, category_id INTEGER, category_locked INTEGER NOT NULL DEFAULT 0,
            fingerprint TEXT NOT NULL, hint TEXT, note TEXT);
    """)
    from app.db import DEFAULT_CATEGORIES  # catégories d'un coffre créé avant l'étape 3

    c.executemany("INSERT INTO categories(name, kind, color) VALUES (?,?,?)", DEFAULT_CATEGORIES)
    init_schema(c)
    names = {r[0] for r in c.execute("SELECT name FROM categories")}
    assert {"Investissement", "Shopping", "Revenus financiers"} <= names
    n = c.execute("SELECT COUNT(*) FROM rules").fetchone()[0]
    assert n > 100
    c.execute("DELETE FROM rules WHERE pattern='NETFLIX'")  # l'utilisateur supprime une règle par défaut
    init_schema(c)                                          # réouverture du coffre
    assert c.execute("SELECT COUNT(*) FROM rules").fetchone()[0] == n - 1  # pas recréée


# --- Par l'API ---------------------------------------------------------------------------------
def _setup(client):
    client.post("/api/vault/create", json={"password": PW})
    acc = client.post("/api/accounts", json={"name": "LCL"}).json()["id"]
    for label, cents in (("CB CARREFOUR", -100), ("CB BOULANGERIE MARTIN", -250),
                         ("CB BOULANGERIE MARTIN", -300), ("CB MAGASIN X", -50)):
        client.post("/api/transactions", json={"account_id": acc, "date": "2026-03-05", "label": label,
                                               "amount_cents": cents})
    return acc, {t["label"] + str(t["amount_cents"]): t for t in client.get("/api/transactions").json()}


def _cats(client):
    return {c["name"]: c["id"] for c in client.get("/api/categories").json()}


def test_api_auto_on_entry(client):
    _, txs = _setup(client)
    assert txs["CB CARREFOUR-100"]["category"] == "Alimentation"
    assert txs["CB MAGASIN X-50"]["category"] is None
    assert len(client.get("/api/transactions?category=none").json()) == 1


def test_api_correction_creates_rule_and_applies_to_similar(client):
    _, txs = _setup(client)
    cats = _cats(client)
    target = txs["CB BOULANGERIE MARTIN-250"]
    assert client.get(f"/api/transactions/{target['id']}/suggest").json()["pattern"] == "BOULANGERIE MARTIN"
    prev = client.post("/api/rules/preview", json={"pattern": "BOULANGERIE MARTIN"}).json()
    assert prev["count"] == 2
    r = client.put(f"/api/transactions/{target['id']}/category",
                   json={"category_id": cats["Restaurants"], "rule_pattern": "BOULANGERIE MARTIN"})
    assert r.status_code == 200
    after = {t["label"] + str(t["amount_cents"]): t for t in client.get("/api/transactions").json()}
    assert after["CB BOULANGERIE MARTIN-250"]["category_source"] == "manuel"
    assert after["CB BOULANGERIE MARTIN-300"]["category"] == "Restaurants"  # la règle s'applique à l'autre
    assert after["CB BOULANGERIE MARTIN-300"]["category_source"] == "regle"
    rules = client.get("/api/rules").json()
    assert rules[0]["origin"] == "correction" and rules[0]["pattern"] == "BOULANGERIE MARTIN"

    # Supprimer la règle : l'autre opération revient au classement par défaut ; la corrigée reste.
    client.delete(f"/api/rules/{rules[0]['id']}")
    after = {t["label"] + str(t["amount_cents"]): t for t in client.get("/api/transactions").json()}
    assert after["CB BOULANGERIE MARTIN-300"]["category"] == "Alimentation"
    assert after["CB BOULANGERIE MARTIN-250"]["category"] == "Restaurants"

    # Retour au classement automatique
    client.post(f"/api/transactions/{target['id']}/auto")
    after = {t["label"] + str(t["amount_cents"]): t for t in client.get("/api/transactions").json()}
    assert after["CB BOULANGERIE MARTIN-250"]["category"] == "Alimentation"


def test_api_category_crud(client):
    _setup(client)
    new = client.post("/api/categories", json={"name": "Animaux", "kind": "expense", "color": "#123456"}).json()["id"]
    assert client.post("/api/categories", json={"name": "Animaux"}).status_code == 409
    assert client.post("/api/categories", json={"name": "X", "kind": "bizarre"}).status_code == 400
    client.post("/api/rules", json={"pattern": "MAGASIN X", "category_id": new})
    assert any(t["category"] == "Animaux" for t in client.get("/api/transactions").json())
    client.delete(f"/api/categories/{new}")
    assert not any(t["category"] == "Animaux" for t in client.get("/api/transactions").json())
    assert not any(r["category"] == "Animaux" for r in client.get("/api/rules").json())


def test_api_rejects_bad_regex(client):
    _setup(client)
    cats = _cats(client)
    assert client.post("/api/rules", json={"pattern": "(", "is_regex": True,
                                           "category_id": cats["Loisirs"]}).status_code == 400
    assert client.post("/api/rules/preview", json={"pattern": "[", "is_regex": True}).status_code == 400


def test_defaults_v2_removes_remboursement_from_existing_vault(conn):
    """Un coffre initialisé en v1 perd la règle « REMBOURSEMENT » à la réouverture."""
    alim = cid(conn, "Autres revenus")
    conn.execute("INSERT INTO rules(pattern, category_id, sign, origin) VALUES ('REMBOURSEMENT', ?, '+', 'default')", (alim,))
    conn.execute("UPDATE meta SET value='1' WHERE key='defaults_version'")
    init_schema(conn)
    assert conn.execute("SELECT COUNT(*) FROM rules WHERE pattern='REMBOURSEMENT'").fetchone()[0] == 0
    tx = add(conn, "VIR CPAM REMBOURSEMENT", 3000)
    categorize.categorize_all(conn)
    assert cat_of(conn, tx)[0] == "Santé"


def test_defaults_v3_removes_author_rights(conn):
    """Coffre initialisé avant la correction : la catégorie « Droits d'auteur » disparaît si elle est inutilisée."""
    conn.execute("INSERT INTO categories(name, kind) VALUES ('Droits d''auteur', 'income')")
    cat = cid(conn, "Droits d'auteur")
    conn.execute("INSERT INTO rules(pattern, category_id, sign, origin) VALUES ('SACEM', ?, '+', 'default')", (cat,))
    tx = add(conn, "VIR EMPLOYEUR", 10000)
    categorize.categorize_all(conn)
    conn.execute("UPDATE meta SET value='2' WHERE key='defaults_version'")
    init_schema(conn)
    assert conn.execute("SELECT COUNT(*) FROM categories WHERE name='Droits d''auteur'").fetchone()[0] == 0
    assert conn.execute("SELECT COUNT(*) FROM rules WHERE pattern='SACEM'").fetchone()[0] == 0
    assert cat_of(conn, tx)[0] is None


def test_defaults_v3_keeps_author_rights_if_used(conn):
    """Si l'utilisateur s'en sert (classement manuel), la catégorie est conservée ; seules les règles par défaut partent."""
    conn.execute("INSERT INTO categories(name, kind) VALUES ('Droits d''auteur', 'income')")
    cat = cid(conn, "Droits d'auteur")
    conn.execute("INSERT INTO rules(pattern, category_id, sign, origin) VALUES ('SACEM', ?, '+', 'default')", (cat,))
    tx = add(conn, "VIR CLIENT", 10000)
    conn.execute("UPDATE transactions SET category_id=?, category_locked=1 WHERE id=?", (cat, tx))
    conn.execute("UPDATE meta SET value='2' WHERE key='defaults_version'")
    init_schema(conn)
    assert cat_of(conn, tx)[0] == "Droits d'auteur"
    assert conn.execute("SELECT COUNT(*) FROM rules WHERE pattern='SACEM'").fetchone()[0] == 0
