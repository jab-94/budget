"""Tests de confidentialité « statiques » : on relit le code source.

Ces tests échouent si :
- le front (HTML/CSS/JS) contient une URL externe (http://, https://, //cdn…),
  une police ou feuille de style distante, ou un appel réseau vers une adresse absolue ;
- le code Python de l'app importe une bibliothèque capable de faire des requêtes
  sortantes (requests, httpx, urllib.request, aiohttp, smtplib, ftplib…) ;
- le serveur est configuré pour écouter ailleurs que sur 127.0.0.1.
"""
from __future__ import annotations

import ast
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
STATIC = ROOT / "static"
APP = ROOT / "app"

FRONT_FILES = [p for p in STATIC.rglob("*") if p.suffix in {".html", ".js", ".css", ".svg", ".json"}]

FORBIDDEN_FRONT = [
    (re.compile(r"https?://", re.I), "URL http(s) absolue"),
    (re.compile(r"""["'(]\s*//[a-z0-9]""", re.I), "URL sans protocole (//domaine)"),
    (re.compile(r"\bwss?://", re.I), "WebSocket externe"),
    (re.compile(r"@import\s+url\(\s*['\"]?(?!/)", re.I), "@import d'une feuille externe"),
    (re.compile(r"fonts\.googleapis|fonts\.gstatic|cdn\.|unpkg|jsdelivr|cdnjs", re.I), "CDN / police externe"),
    (re.compile(r"navigator\.sendBeacon", re.I), "sendBeacon (télémétrie)"),
    (re.compile(r"new\s+WebSocket|new\s+EventSource", re.I), "connexion persistante"),
    (re.compile(r"\bimportScripts\s*\(", re.I), "chargement de script distant"),
    (re.compile(r"google-analytics|gtag\(|plausible|matomo|sentry|mixpanel|segment\.", re.I), "analytics / télémétrie"),
]

# fetch() n'est autorisé que vers un chemin relatif commençant par "/"
FETCH_CALL = re.compile(r"\bfetch\s*\(\s*([^,)]+)")
XHR_OPEN = re.compile(r"\.open\s*\(\s*['\"][A-Z]+['\"]\s*,\s*([^,)]+)")

FORBIDDEN_IMPORTS = {
    "requests", "httpx", "urllib.request", "urllib3", "aiohttp", "http.client",
    "smtplib", "ftplib", "telnetlib", "poplib", "imaplib", "xmlrpc.client",
    "socket", "ssl", "websocket", "websockets", "paramiko", "boto3",
}


def _strip_comments_js(src: str) -> str:
    src = re.sub(r"/\*.*?\*/", "", src, flags=re.S)
    return re.sub(r"(^|[^:])//[^\n]*", r"\1", src)


def test_front_files_exist():
    assert FRONT_FILES, "aucun fichier front trouvé"


def test_no_external_url_in_front():
    problems = []
    for f in FRONT_FILES:
        text = f.read_text(encoding="utf-8")
        for pat, why in FORBIDDEN_FRONT:
            for m in pat.finditer(text):
                line = text.count("\n", 0, m.start()) + 1
                problems.append(f"{f.relative_to(ROOT)}:{line} — {why}")
    assert not problems, "Référence réseau externe dans le front :\n" + "\n".join(problems)


def test_fetch_only_relative_paths():
    problems = []
    for f in STATIC.rglob("*.js"):
        src = _strip_comments_js(f.read_text(encoding="utf-8"))
        for regex in (FETCH_CALL, XHR_OPEN):
            for m in regex.finditer(src):
                arg = m.group(1).strip()
                # Littéral : doit commencer par "/" (même origine).
                if arg[:1] in "'\"`":
                    if not arg[1:2] == "/" or arg[1:3] == "//":
                        problems.append(f"{f.name}: {arg}")
                # Variable : on n'accepte que le paramètre `path` de notre helper api().
                elif arg != "path":
                    problems.append(f"{f.name}: fetch({arg}) — destination non vérifiable")
    assert not problems, "Appel réseau non relatif :\n" + "\n".join(problems)


def test_api_helper_rejects_absolute():
    """Le helper api() n'est appelé qu'avec des chemins "/api/..."."""
    src = (STATIC / "app.js").read_text(encoding="utf-8")
    calls = re.findall(r"\bapi\(\s*([^,)]+)", src)
    bad = [c for c in calls if not re.match(r"""^\s*(['"`])/api/""", c) and "?" not in c
           and not c.strip().startswith("creating") and c.strip() != "path"]
    assert not bad, f"appels api() suspects : {bad}"


def test_no_network_library_in_app_code():
    problems = []
    for f in APP.rglob("*.py"):
        tree = ast.parse(f.read_text(encoding="utf-8"))
        for node in ast.walk(tree):
            names = []
            if isinstance(node, ast.Import):
                names = [a.name for a in node.names]
            elif isinstance(node, ast.ImportFrom) and node.module:
                names = [node.module] + [f"{node.module}.{a.name}" for a in node.names]
            for n in names:
                if n in FORBIDDEN_IMPORTS or n.split(".")[0] in {"requests", "httpx", "aiohttp", "urllib3"}:
                    problems.append(f"{f.relative_to(ROOT)}:{node.lineno} — import {n}")
    assert not problems, "Bibliothèque réseau importée dans l'app :\n" + "\n".join(problems)


def test_no_external_url_in_app_code():
    pat = re.compile(r"https?://(?!127\.0\.0\.1|localhost|\{config\.HOST\})", re.I)
    problems = []
    for f in APP.rglob("*.py"):
        for i, line in enumerate(f.read_text(encoding="utf-8").splitlines(), 1):
            if pat.search(line):
                problems.append(f"{f.relative_to(ROOT)}:{i}")
    assert not problems, "URL externe dans le code Python :\n" + "\n".join(problems)


def test_server_binds_loopback_only():
    from app import config

    assert config.HOST == "127.0.0.1"
    src = (APP / "__main__.py").read_text(encoding="utf-8")
    assert "0.0.0.0" not in src
    assert "host=config.HOST" in src
    for f in APP.rglob("*.py"):
        assert "0.0.0.0" not in f.read_text(encoding="utf-8"), f"0.0.0.0 trouvé dans {f.name}"


def test_gitignore_protects_data():
    gi = (ROOT / ".gitignore").read_text(encoding="utf-8")
    for needed in ("data/", "*.vault", "*.db", "*.pdf"):
        assert needed in gi, f"{needed} absent de .gitignore"
