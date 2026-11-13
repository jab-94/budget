"""Sauvegarde chiffrée et export CSV."""
from __future__ import annotations

from app.vault import Vault, WrongPassword

PW = "une phrase de passe assez longue"


def _setup(client):
    client.post("/api/vault/create", json={"password": PW})
    acc = client.post("/api/accounts", json={"name": "LCL"}).json()["id"]
    client.post("/api/transactions", json={"account_id": acc, "date": "2026-03-05", "label": "CB CARREFOUR; MARKET",
                                           "amount_cents": -4590})
    client.post("/api/transactions", json={"account_id": acc, "date": "2026-03-28", "label": "VIR SALAIRE",
                                           "amount_cents": 250000})


def test_backup_is_encrypted_and_restorable(client, tmp_path):
    _setup(client)
    r = client.get("/api/export/backup")
    assert r.status_code == 200
    assert r.headers["content-disposition"].startswith('attachment; filename="budget-sauvegarde-')
    raw = r.content
    assert b"CARREFOUR" not in raw and b"SQLite" not in raw  # chiffré

    # Restauration : la sauvegarde s'ouvre avec le même mot de passe…
    backup = tmp_path / "restaure" / "budget-sauvegarde.vault"
    backup.parent.mkdir()
    backup.write_bytes(raw)
    try:
        Vault(backup, "x").open("mauvais mot de passe")
        raise AssertionError("aurait dû refuser")
    except WrongPassword:
        pass
    # …et via l'app : verrouiller, choisir le fichier comme emplacement, ouvrir.
    client.post("/api/vault/lock")
    assert client.post("/api/vault/location", json={"path": str(backup)}).status_code == 200
    assert client.post("/api/vault/unlock", json={"password": PW}).status_code == 200
    labels = {t["label"] for t in client.get("/api/transactions").json()}
    assert labels == {"CB CARREFOUR; MARKET", "VIR SALAIRE"}


def test_csv_export(client):
    _setup(client)
    r = client.get("/api/export/csv")
    assert r.status_code == 200 and r.headers["content-type"].startswith("text/csv")
    text = r.content.decode("utf-8-sig")
    lines = text.strip().splitlines()
    assert lines[0] == "date;compte;libelle;montant;categorie;nature"
    assert '2026-03-05;LCL;"CB CARREFOUR; MARKET";-45,90;Alimentation;' in lines  # point-virgule protégé
    assert "2026-03-28;LCL;VIR SALAIRE;2500,00;Salaire;" in lines


def test_exports_need_token_and_unlocked_vault(client):
    _setup(client)
    tok = client.headers.pop("X-Budget-Token")
    assert client.get("/api/export/backup").status_code == 403
    client.headers["X-Budget-Token"] = tok
    client.post("/api/vault/lock")
    assert client.get("/api/export/csv").status_code == 423
