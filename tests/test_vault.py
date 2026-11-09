"""Tests du coffre chiffré et de la base en mémoire."""
from __future__ import annotations

import pytest

from app.db import Database
from app.vault import Vault, VaultConflict, WrongPassword, find_icloud_conflict_copies

PW = "correct horse battery staple"


def test_roundtrip(tmp_path):
    p = tmp_path / "budget.vault"
    v = Vault(p, "Mac-test")
    v.create(PW, b"hello")
    assert Vault(p, "Mac-test").open(PW) == b"hello"


def test_file_is_not_plaintext(tmp_path):
    p = tmp_path / "budget.vault"
    db = Database()
    db.create(p, PW, "Mac-test")
    db.conn.execute(
        "INSERT INTO transactions(date,label,amount_cents,fingerprint) VALUES ('2026-01-02','BOULANGERIE DUPONT',-450,'x')"
    )
    db.save()
    raw = p.read_bytes()
    assert b"BOULANGERIE" not in raw
    assert b"SQLite format" not in raw
    assert b"Alimentation" not in raw


def test_wrong_password(tmp_path):
    p = tmp_path / "budget.vault"
    Vault(p, "d").create(PW, b"x")
    with pytest.raises(WrongPassword):
        Vault(p, "d").open("mauvais mot de passe")


def test_tampering_detected(tmp_path):
    p = tmp_path / "budget.vault"
    Vault(p, "d").create(PW, b"secret data")
    blob = bytearray(p.read_bytes())
    blob[-1] ^= 1
    p.write_bytes(bytes(blob))
    with pytest.raises(WrongPassword):
        Vault(p, "d").open(PW)


def test_db_persists_across_unlock(tmp_path):
    p = tmp_path / "budget.vault"
    db = Database()
    db.create(p, PW, "d")
    db.conn.execute("INSERT INTO accounts(name) VALUES ('Compte courant')")
    db.save()
    db.lock_now()
    db2 = Database()
    db2.unlock(p, PW, "d")
    assert db2.conn.execute("SELECT name FROM accounts").fetchone()[0] == "Compte courant"
    assert db2.conn.execute("SELECT COUNT(*) FROM categories").fetchone()[0] > 5


def test_conflict_when_other_device_saved(tmp_path):
    """Simule iCloud : le PC a enregistré pendant que le Mac avait le coffre ouvert."""
    p = tmp_path / "budget.vault"
    Vault(p, "Mac").create(PW, b"v1")
    mac = Vault(p, "Mac"); mac.open(PW)
    pc = Vault(p, "PC"); pc.open(PW)
    pc.save(b"v2 du PC")
    with pytest.raises(VaultConflict):
        mac.save(b"v2 du Mac")
    assert Vault(p, "x").open(PW) == b"v2 du PC"  # rien n'a été écrasé


def test_change_password(tmp_path):
    p = tmp_path / "budget.vault"
    v = Vault(p, "d"); v.create(PW, b"data")
    v.change_password("un autre mot de passe long", b"data")
    with pytest.raises(WrongPassword):
        Vault(p, "d").open(PW)
    assert Vault(p, "d").open("un autre mot de passe long") == b"data"


def test_icloud_conflict_copies(tmp_path):
    (tmp_path / "budget.vault").write_bytes(b"x")
    (tmp_path / "budget 2.vault").write_bytes(b"x")
    (tmp_path / "autre.txt").write_bytes(b"x")
    assert find_icloud_conflict_copies(tmp_path / "budget.vault") == ["budget 2.vault"]


def test_wipe(tmp_path):
    p = tmp_path / "budget.vault"
    db = Database(); db.create(p, PW, "d")
    db.conn.execute("INSERT INTO accounts(name) VALUES ('A')")
    db.save()
    db.wipe_all_data()
    assert db.conn.execute("SELECT COUNT(*) FROM accounts").fetchone()[0] == 0
    db.lock_now()
    db2 = Database(); db2.unlock(p, PW, "d")
    assert db2.conn.execute("SELECT COUNT(*) FROM accounts").fetchone()[0] == 0
