"""Parcours complet par l'API : compte -> aperçu -> enregistrement -> réimport (doublons)."""
from __future__ import annotations

import tempfile

from app.dedup import coherence, fingerprints, label_similarity
from tests.test_importers import BOURSO_CSV

PW = "une phrase de passe assez longue"


def _setup(client):
    client.post("/api/vault/create", json={"password": PW})
    return client.post("/api/accounts", json={"name": "Perso", "bank": "Boursobank", "kind": "courant"}).json()["id"]


def _preview(client, acc, raw=BOURSO_CSV, fmt="csv"):
    return client.post(f"/api/import/preview?account_id={acc}&fmt={fmt}", content=raw,
                       headers={"Content-Type": "application/octet-stream"})


def test_preview_saves_nothing(client):
    acc = _setup(client)
    r = _preview(client, acc)
    assert r.status_code == 200
    body = r.json()
    assert len(body["transactions"]) == 3
    assert all(t["selected"] and t["duplicate"] is None for t in body["transactions"])
    assert client.get("/api/transactions").json() == []


def test_commit_then_reimport_flags_duplicates(client):
    acc = _setup(client)
    pv = _preview(client, acc).json()
    r = client.post("/api/import/commit", json={
        "account_id": acc, "source": "csv",
        "transactions": [{k: t[k] for k in ("date", "label", "amount_cents", "fingerprint")} for t in pv["transactions"]],
    })
    assert r.json()["inserted"] == 3
    assert len(client.get("/api/transactions").json()) == 3

    again = _preview(client, acc).json()
    assert [t["duplicate"] for t in again["transactions"]] == ["exact"] * 3
    assert not any(t["selected"] for t in again["transactions"])


def test_probable_duplicate_from_other_format(client):
    """Le même achat importé en CSV puis saisi avec un libellé un peu différent."""
    acc = _setup(client)
    client.post("/api/transactions", json={"account_id": acc, "date": "2026-03-02",
                                           "label": "CARTE CARREFOUR MARKET", "amount_cents": -4590})
    pv = _preview(client, acc).json()
    assert pv["transactions"][0]["duplicate"] == "probable"
    assert pv["transactions"][1]["duplicate"] is None


def test_preview_rejects_bad_input(client):
    acc = _setup(client)
    assert _preview(client, acc, raw=b"").status_code == 400
    assert _preview(client, acc, raw=b"%PDF-1.4 pas vraiment un pdf", fmt="pdf").status_code == 400
    assert _preview(client, 999).status_code == 404


def test_upload_never_written_to_disk(client, monkeypatch):
    """Aucun fichier temporaire ne doit être créé pendant un import."""
    acc = _setup(client)
    created = []
    real = tempfile.SpooledTemporaryFile

    def spy(*a, **k):
        created.append(1)
        return real(*a, **k)

    monkeypatch.setattr(tempfile, "SpooledTemporaryFile", spy)
    monkeypatch.setattr(tempfile, "NamedTemporaryFile", lambda *a, **k: created.append(1))
    assert _preview(client, acc).status_code == 200
    assert created == []


def test_manual_and_delete(client):
    acc = _setup(client)
    tid = client.post("/api/transactions", json={"account_id": acc, "date": "2026-04-01",
                                                 "label": "Marché", "amount_cents": -1200}).json()["id"]
    assert client.post("/api/transactions", json={"account_id": acc, "date": "2026-02-30",
                                                  "label": "x", "amount_cents": 1}).status_code == 400
    assert client.get("/api/transactions?month=2026-04").json()[0]["label"] == "Marché"
    client.delete(f"/api/transactions/{tid}")
    assert client.get("/api/transactions").json() == []


def test_delete_account_cascades(client):
    acc = _setup(client)
    client.post("/api/transactions", json={"account_id": acc, "date": "2026-04-01", "label": "x", "amount_cents": -1})
    client.delete(f"/api/accounts/{acc}")
    assert client.get("/api/transactions").json() == []


# --- unitaires -----------------------------------------------------------------------------
def test_fingerprints_keep_identical_same_day_purchases():
    txs = [{"date": "2026-01-01", "label": "CAFE", "amount_cents": -250}] * 2
    a, b = fingerprints(1, txs)
    assert a != b  # deux cafés le même jour = deux opérations
    assert fingerprints(1, txs) == [a, b]  # stable d'un import à l'autre


def test_label_similarity():
    assert label_similarity("CB CARREFOUR MARKET 02/03", "CARTE CARREFOUR MARKET") >= 0.5
    assert label_similarity("CB CARREFOUR", "PRLV FREE MOBILE") == 0


def test_coherence():
    txs = [{"amount_cents": -100}, {"amount_cents": 300}]
    assert coherence(1000, 1200, txs)["status"] == "ok"
    assert coherence(1000, 1300, txs) == {"status": "mismatch", "sum_cents": 200, "diff_cents": -100}
    assert coherence(None, 1200, txs)["status"] == "unknown"
