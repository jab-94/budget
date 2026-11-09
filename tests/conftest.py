"""Configuration commune des tests.

GARDE RÉSEAU : pendant TOUTE la suite de tests, toute tentative d'ouvrir une
connexion vers une adresse autre que la machine locale fait échouer le test.
Si une dépendance ou notre code essayait de « téléphoner à la maison », on le
saurait immédiatement.
"""
from __future__ import annotations

import ipaddress
import os
import socket

import pytest

_real_connect = socket.socket.connect
_real_connect_ex = socket.socket.connect_ex
_real_getaddrinfo = socket.getaddrinfo


class OutboundNetworkError(AssertionError):
    pass


def _is_local(address) -> bool:
    if isinstance(address, (str, bytes)):  # socket Unix : local par nature
        return True
    host = address[0]
    if host in ("localhost", ""):
        return True
    try:
        return ipaddress.ip_address(host).is_loopback
    except ValueError:
        return False


def _guarded_connect(self, address):
    if not _is_local(address):
        raise OutboundNetworkError(f"Connexion réseau sortante interdite : {address!r}")
    return _real_connect(self, address)


def _guarded_connect_ex(self, address):
    if not _is_local(address):
        raise OutboundNetworkError(f"Connexion réseau sortante interdite : {address!r}")
    return _real_connect_ex(self, address)


def _guarded_getaddrinfo(host, *args, **kwargs):
    if host not in (None, "localhost", "127.0.0.1", "::1"):
        try:
            if not ipaddress.ip_address(host).is_loopback:
                raise OutboundNetworkError(f"Résolution DNS interdite : {host!r}")
        except ValueError:
            raise OutboundNetworkError(f"Résolution DNS interdite : {host!r}") from None
    return _real_getaddrinfo(host, *args, **kwargs)


socket.socket.connect = _guarded_connect
socket.socket.connect_ex = _guarded_connect_ex
socket.getaddrinfo = _guarded_getaddrinfo


@pytest.fixture(autouse=True)
def isolated_data_dir(tmp_path, monkeypatch):
    """Chaque test travaille dans un dossier temporaire, jamais dans data/ réel."""
    from app import config

    data = tmp_path / "data"
    monkeypatch.setattr(config, "DATA_DIR", data)
    monkeypatch.setattr(config, "CONFIG_FILE", data / "config.json")
    monkeypatch.setattr(config, "IMPORTS_DIR", data / "imports")
    monkeypatch.setattr(config, "icloud_drive_dir", lambda: None)
    # scrypt plus léger en test pour aller vite (le format stocke les paramètres).
    from app import vault

    monkeypatch.setattr(vault, "SCRYPT_N", 2**10)
    monkeypatch.setattr(vault, "derive_key", _fast_derive(vault.derive_key))
    yield data


def _fast_derive(real):
    def derive(password, salt, n=2**10, r=8, p=1):
        return real(password, salt, min(n, 2**10), r, p)

    return derive


@pytest.fixture
def client():
    from fastapi.testclient import TestClient

    from app import main
    from app.security import SESSION_TOKEN

    main.lock_vault()
    c = TestClient(main.app)
    c.headers["X-Budget-Token"] = SESSION_TOKEN
    yield c
    main.lock_vault()


def pytest_sessionstart(session):
    os.environ.setdefault("BUDGET_TESTING", "1")
