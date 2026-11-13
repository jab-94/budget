"""Rapport PDF chiffré pour iPhone."""
from __future__ import annotations

import io

import pytest
from pypdf import PdfReader

PW = "une phrase de passe assez longue"
REPORT_PW = "mot de passe du rapport"


def _setup(client):
    client.post("/api/vault/create", json={"password": PW})
    acc = client.post("/api/accounts", json={"name": "LCL"}).json()["id"]
    for m in ("2026-01", "2026-02", "2026-03", "2026-04"):
        for d, label, cents in (("28", "VIR SALAIRE EMPLOYEUR", 250000), ("10", "PRLV SEPA NETFLIX", -1349),
                                ("05", "CB BOULANGERIE MARTIN", -2350)):
            client.post("/api/transactions", json={"account_id": acc, "date": f"{m}-{d}", "label": label, "amount_cents": cents})


def test_report_encrypted_and_readable_with_password(client):
    _setup(client)
    r = client.post("/api/report", json={"password": REPORT_PW})
    assert r.status_code == 200 and r.headers["content-type"] == "application/pdf"
    assert r.headers["content-disposition"] == 'attachment; filename="Budget-2026-04.pdf"'
    raw = r.content
    assert b"BOULANGERIE" not in raw and b"Netflix" not in raw and b"NETFLIX" not in raw
    reader = PdfReader(io.BytesIO(raw))
    assert reader.is_encrypted
    assert reader.decrypt("mauvais mot de passe") == 0
    reader = PdfReader(io.BytesIO(raw))
    assert reader.decrypt(REPORT_PW) != 0
    text = " ".join(page.extract_text() for page in reader.pages)
    assert "avril 2026" in text and "Alimentation" in text and "Netflix" in text


def test_report_saved_next_to_vault(client, isolated_data_dir):
    _setup(client)
    r = client.post("/api/report", json={"password": REPORT_PW, "month": "2026-03", "save_next_to_vault": True}).json()
    saved = isolated_data_dir / "Rapports" / "Budget-2026-03.pdf"
    assert r["saved_to"] == str(saved) and saved.exists()
    assert PdfReader(io.BytesIO(saved.read_bytes())).is_encrypted


@pytest.mark.parametrize("pw", ["court", ""])
def test_report_password_required(client, pw):
    _setup(client)
    assert client.post("/api/report", json={"password": pw}).status_code == 400


def test_report_empty_vault(client):
    client.post("/api/vault/create", json={"password": PW})
    assert client.post("/api/report", json={"password": REPORT_PW}).status_code == 200
