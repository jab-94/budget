"""Tests du serveur : en-têtes de sécurité, jeton, hôte, coffre via l'API, journaux."""
from __future__ import annotations

import logging

from app.safe_logging import RedactingFilter, redact
from app.security import SESSION_TOKEN

PW = "une phrase de passe assez longue"


def test_csp_and_headers(client):
    r = client.get("/")
    assert r.status_code == 200
    csp = r.headers["content-security-policy"]
    assert "default-src 'self'" in csp
    assert "connect-src 'self'" in csp
    assert "script-src 'self'" in csp and "unsafe-inline" not in csp and "unsafe-eval" not in csp
    assert r.headers["referrer-policy"] == "no-referrer"
    assert r.headers["x-frame-options"] == "DENY"


def test_token_injected_in_page(client):
    assert SESSION_TOKEN in client.get("/").text


def test_api_requires_token(client):
    del client.headers["X-Budget-Token"]
    assert client.get("/api/status").status_code == 403


def test_foreign_host_rejected(client):
    r = client.get("/", headers={"Host": "evil.example"})
    assert r.status_code == 403


def test_no_interactive_docs(client):
    # La doc FastAPI chargerait des fichiers depuis un CDN : elle doit être coupée.
    for path in ("/docs", "/redoc", "/openapi.json"):
        assert client.get(path).status_code == 404


def test_vault_lifecycle(client):
    s = client.get("/api/status").json()
    assert not s["vault_exists"] and not s["unlocked"]
    assert client.post("/api/vault/create", json={"password": "court"}).status_code == 400
    assert client.post("/api/vault/create", json={"password": PW}).status_code == 200
    assert client.get("/api/categories").status_code == 200
    assert client.post("/api/vault/lock").status_code == 200
    assert client.get("/api/categories").status_code == 423
    assert client.post("/api/vault/unlock", json={"password": "mauvais mot de passe !!"}).status_code == 401
    assert client.post("/api/vault/unlock", json={"password": PW}).status_code == 200
    assert client.get("/api/categories").status_code == 200


def test_auto_lock(client, monkeypatch):
    from app import config, main

    client.post("/api/vault/create", json={"password": PW})
    monkeypatch.setattr(config, "AUTO_LOCK_SECONDS", -1)
    assert client.get("/api/categories").status_code == 423
    assert not main.db.is_unlocked


def test_device_label_has_no_hostname(client):
    import platform

    label = client.get("/api/status").json()["device"]
    assert platform.node() not in label or platform.node() == ""


def test_redaction():
    s = redact("Achat CB 12/03/2026 -45,90 € IBAN FR76 3000 6000 0112 3456 7890 189 carte 4970 1234 5678 9012")
    assert "45,90" not in s and "FR76" not in s and "4970" not in s and "12/03/2026" not in s


def test_log_filter_applies_to_args(caplog):
    logger = logging.getLogger("budget.test")
    logger.addFilter(RedactingFilter())
    with caplog.at_level(logging.INFO, logger="budget.test"):
        logger.info("solde %s", "1 234,56 €")
    assert "1 234,56" not in caplog.text
