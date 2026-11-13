"""Garde-fous de confidentialité de la version web (docs/, publiée sur GitHub Pages)."""
from __future__ import annotations

import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
WEB = ROOT / "docs"
OUR_JS = sorted((WEB / "js").glob("*.js"))
ALLOWED_HOSTS = {"firestore.googleapis.com", "identitytoolkit.googleapis.com", "securetoken.googleapis.com"}


def _csp() -> str:
    html = (WEB / "index.html").read_text(encoding="utf-8")
    m = re.search(r'<meta http-equiv="Content-Security-Policy" content="([^"]+)"', html)
    assert m, "CSP absente de docs/index.html"
    return m.group(1)


def test_csp_only_allows_firebase():
    csp = dict((d.split()[0], d.split()[1:]) for d in _csp().split("; "))
    assert csp["default-src"] == ["'self'"]
    assert csp["script-src"] == ["'self'"] and csp["style-src"] == ["'self'"]
    assert csp["object-src"] == ["'none'"] and csp["frame-src"] == ["'none'"]
    hosts = {h.removeprefix("https://") for h in csp["connect-src"] if h != "'self'"}
    assert hosts == ALLOWED_HOSTS


def test_page_loads_nothing_external():
    html = (WEB / "index.html").read_text(encoding="utf-8")
    html_wo_csp = re.sub(r'<meta http-equiv="Content-Security-Policy"[^>]+>', "", html)
    assert not re.search(r"https?://|//cdn|fonts\.googleapis", html_wo_csp)
    for tag in re.findall(r'<(?:script|link)[^>]+(?:src|href)="([^"]+)"', html):
        assert not tag.startswith(("http", "//")), tag


def test_our_code_never_calls_the_network_directly():
    """Seul le module Firebase embarqué parle au réseau ; notre code n'appelle jamais fetch & co."""
    for f in OUR_JS + [WEB / "service-worker.js"]:
        src = f.read_text(encoding="utf-8")
        assert not re.search(r"https?://", src), f.name
        for bad in ("XMLHttpRequest", "sendBeacon", "new WebSocket", "EventSource", "importScripts("):
            assert bad not in src, (f.name, bad)
        if f.name != "service-worker.js":
            assert "fetch(" not in src, f.name
        for imp in re.findall(r'from\s+"([^"]+)"|import\("([^"]+)"\)', src):
            path = imp[0] or imp[1]
            assert path.startswith("./") or path.startswith("../"), (f.name, path)


def test_service_worker_ignores_other_origins():
    src = (WEB / "service-worker.js").read_text(encoding="utf-8")
    assert "url.origin !== self.location.origin" in src


def test_firebase_bundle_has_no_analytics_and_only_allowed_hosts():
    src = (WEB / "vendor" / "firebase.js").read_text(encoding="utf-8")
    hosts = set(re.findall(r"[a-z0-9.-]+\.googleapis\.com", src))
    assert hosts <= ALLOWED_HOSTS, hosts - ALLOWED_HOSTS
    for bad in ("google-analytics.com", "googletagmanager", "app-measurement.com", "firebaselogging", "measurementId"):
        assert bad not in src, bad


def test_vault_password_only_used_to_derive_the_key():
    """Le mot de passe du COFFRE ne sert qu'à dériver la clé : jamais stocké, jamais transmis à Firebase.

    (Le mot de passe du COMPTE, lui, est normalement envoyé à Firebase pour se connecter : cloud.login.)
    """
    store = (WEB / "js" / "store.js").read_text(encoding="utf-8")
    allowed = re.compile(r"async (create|unlock|changePassword|restoreBackup)\(|\.length < MIN_PASSWORD_LENGTH|deriveKey\((new)?[pP]assword")
    for line in store.splitlines():
        if re.search(r"\b(password|newPassword)\b", line) and not line.strip().startswith("//"):
            assert allowed.search(line), f"usage inattendu du mot de passe du coffre : {line.strip()}"
    assert "cloud.login" not in store
    # Ce qui part vers Firebase : en-tête non secret + bloc chiffré, rien d'autre.
    cloud = (WEB / "js" / "cloud.js").read_text(encoding="utf-8")
    assert "{ header, data, revision, expectedRevision }" in cloud
    assert "tx.set(metaRef, { header, chunks: chunks.length, revision, updatedAt" in cloud


def test_firestore_rules_restrict_to_owner():
    rules = (ROOT / "firestore.rules").read_text(encoding="utf-8")
    assert "allow read, write: if false;" in rules
    assert rules.count("request.auth.uid == uid") == 2


def test_no_eval_in_pdf_reading():
    assert "isEvalSupported: false" in (WEB / "js" / "pdfparse.js").read_text(encoding="utf-8")
