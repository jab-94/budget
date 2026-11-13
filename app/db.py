"""Base SQLite en mémoire, adossée au coffre chiffré.

Au déverrouillage : coffre -> déchiffrement -> sqlite3.deserialize() en mémoire.
À chaque modification : sqlite3.serialize() -> chiffrement -> écriture atomique.
Aucun fichier SQLite en clair n'existe jamais sur le disque.
"""
from __future__ import annotations

import sqlite3
import threading
from pathlib import Path

from .vault import Vault

SCHEMA_VERSION = 5

SCHEMA = """
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);

CREATE TABLE IF NOT EXISTS accounts (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    bank TEXT,
    kind TEXT NOT NULL DEFAULT 'courant'   -- courant | joint | epargne | investissement
);

CREATE TABLE IF NOT EXISTS categories (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    kind TEXT NOT NULL DEFAULT 'expense' CHECK (kind IN ('expense','income','transfer')),
    color TEXT
);

-- Un relevé importé (PDF/CSV) ou un lot de saisies manuelles.
CREATE TABLE IF NOT EXISTS statements (
    id INTEGER PRIMARY KEY,
    account_id INTEGER REFERENCES accounts(id) ON DELETE CASCADE,
    source TEXT NOT NULL CHECK (source IN ('pdf','csv','manual')),
    period_start TEXT,
    period_end TEXT,
    opening_balance_cents INTEGER,
    closing_balance_cents INTEGER,
    imported_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Montants en centimes (entiers) : pas d'erreurs d'arrondi des nombres à virgule.
CREATE TABLE IF NOT EXISTS transactions (
    id INTEGER PRIMARY KEY,
    account_id INTEGER REFERENCES accounts(id) ON DELETE CASCADE,
    statement_id INTEGER REFERENCES statements(id) ON DELETE SET NULL,
    date TEXT NOT NULL,                 -- AAAA-MM-JJ
    label TEXT NOT NULL,
    amount_cents INTEGER NOT NULL,      -- négatif = dépense
    category_id INTEGER REFERENCES categories(id) ON DELETE SET NULL,
    category_locked INTEGER NOT NULL DEFAULT 0,  -- 1 = choisie à la main
    fingerprint TEXT NOT NULL,          -- pour détecter les doublons à la réimportation
    hint TEXT,                          -- nature connue par la source (investissement, frais…)
    category_source TEXT,               -- regle | virement-interne | source | defaut | manuel
    note TEXT
);
CREATE INDEX IF NOT EXISTS idx_tx_date ON transactions(date);
CREATE INDEX IF NOT EXISTS idx_tx_fp ON transactions(fingerprint);

CREATE TABLE IF NOT EXISTS rules (
    id INTEGER PRIMARY KEY,
    pattern TEXT NOT NULL,
    is_regex INTEGER NOT NULL DEFAULT 0,
    category_id INTEGER NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
    priority INTEGER NOT NULL DEFAULT 100,
    created_from_correction INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS budgets (
    category_id INTEGER PRIMARY KEY REFERENCES categories(id) ON DELETE CASCADE,
    monthly_limit_cents INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
"""

DEFAULT_CATEGORIES = [
    ("Alimentation", "expense", "#5b8def"),
    ("Logement", "expense", "#8a6fdf"),
    ("Transports", "expense", "#3fb3a8"),
    ("Abonnements", "expense", "#e0a03a"),
    ("Santé", "expense", "#e2677c"),
    ("Loisirs", "expense", "#6cbf5a"),
    ("Restaurants", "expense", "#d9775c"),
    ("Frais bancaires", "expense", "#9a9a9a"),
    ("Impôts", "expense", "#7a8699"),
    ("Divers", "expense", "#b0b0b0"),
    ("Salaire", "income", "#2e9e6a"),
    ("Autres revenus", "income", "#57a87a"),
    ("Virements internes", "transfer", "#c0c0c0"),
]


def _new_connection() -> sqlite3.Connection:
    conn = sqlite3.connect(":memory:", check_same_thread=False)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


def _columns(conn: sqlite3.Connection, table: str) -> set[str]:
    return {r[1] for r in conn.execute(f"PRAGMA table_info({table})")}


def init_schema(conn: sqlite3.Connection) -> None:
    conn.executescript(SCHEMA)
    row = conn.execute("SELECT value FROM meta WHERE key='schema_version'").fetchone()
    if row is None:
        conn.executemany(
            "INSERT OR IGNORE INTO categories(name, kind, color) VALUES (?,?,?)", DEFAULT_CATEGORIES
        )
    # Migrations : chaque étape est rejouable sans risque.
    if "kind" not in _columns(conn, "accounts"):
        conn.execute("ALTER TABLE accounts ADD COLUMN kind TEXT NOT NULL DEFAULT 'courant'")
    if "hint" not in _columns(conn, "transactions"):
        conn.execute("ALTER TABLE transactions ADD COLUMN hint TEXT")
    if "category_source" not in _columns(conn, "transactions"):
        conn.execute("ALTER TABLE transactions ADD COLUMN category_source TEXT")
    rule_cols = _columns(conn, "rules")
    if "sign" not in rule_cols:
        conn.execute("ALTER TABLE rules ADD COLUMN sign TEXT")  # '+', '-' ou NULL
    for col, ddl in (("match", "TEXT"), ("exclude", "TEXT"), ("min_cents", "INTEGER"), ("max_cents", "INTEGER")):
        if col not in rule_cols:
            conn.execute(f"ALTER TABLE rules ADD COLUMN {col} {ddl}")  # options des règles (v5)
    if "origin" not in rule_cols:
        conn.execute("ALTER TABLE rules ADD COLUMN origin TEXT NOT NULL DEFAULT 'user'")  # user|correction|default
    from .categorize import seed_defaults  # import local : évite un cycle d'imports

    seed_defaults(conn)
    conn.execute(
        "INSERT INTO meta(key, value) VALUES ('schema_version', ?) "
        "ON CONFLICT(key) DO UPDATE SET value=excluded.value",
        (str(SCHEMA_VERSION),),
    )
    conn.commit()


class Database:
    """Base en mémoire + coffre. Un seul verrou : l'app est mono-utilisateur."""

    def __init__(self) -> None:
        self.vault: Vault | None = None
        self.conn: sqlite3.Connection | None = None
        self.lock = threading.RLock()

    @property
    def is_unlocked(self) -> bool:
        return self.conn is not None and self.vault is not None and self.vault.is_open

    def create(self, path: Path, password: str, device: str) -> None:
        with self.lock:
            conn = _new_connection()
            init_schema(conn)
            vault = Vault(path, device)
            vault.create(password, conn.serialize())
            self.vault, self.conn = vault, conn

    def unlock(self, path: Path, password: str, device: str) -> None:
        with self.lock:
            vault = Vault(path, device)
            payload = vault.open(password)
            conn = _new_connection()
            conn.deserialize(payload)
            conn.execute("PRAGMA foreign_keys = ON")
            init_schema(conn)  # migrations futures
            self.vault, self.conn = vault, conn

    def lock_now(self) -> None:
        with self.lock:
            if self.conn is not None:
                self.conn.close()
            if self.vault is not None:
                self.vault.close()
            self.conn, self.vault = None, None

    def save(self) -> None:
        """Chiffre et réécrit le coffre. À appeler après chaque modification."""
        with self.lock:
            assert self.conn is not None and self.vault is not None
            self.conn.commit()
            self.vault.save(self.conn.serialize())

    def wipe_all_data(self) -> None:
        """« Tout supprimer » : vide la base et réécrit un coffre vide."""
        with self.lock:
            assert self.conn is not None
            old = self.conn
            conn = _new_connection()
            init_schema(conn)
            self.conn = conn
            old.close()
            self.save()
