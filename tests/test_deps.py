"""Le lanceur n'installe les bibliothèques que si requirements.txt a changé."""
from __future__ import annotations

import sys

sys.path.insert(0, str(__import__("pathlib").Path(__file__).resolve().parent.parent / "tools"))
import deps  # noqa: E402


def test_installs_only_when_requirements_change(tmp_path, monkeypatch):
    req = tmp_path / "requirements.txt"
    req.write_text("fastapi==1\n")
    monkeypatch.setattr(deps, "REQUIREMENTS", req)
    monkeypatch.setattr(deps, "MARKER", tmp_path / "marker")
    calls = []
    monkeypatch.setattr(deps.subprocess, "call", lambda cmd: calls.append(cmd) or 0)

    assert deps.main() == 0 and len(calls) == 1          # premier lancement : installation
    assert deps.main() == 0 and len(calls) == 1          # rien n'a changé : aucun accès réseau
    req.write_text("fastapi==1\nreportlab==5\n")
    assert deps.main() == 0 and len(calls) == 2          # mise à jour : nouvelle installation


def test_failed_install_is_retried(tmp_path, monkeypatch):
    req = tmp_path / "requirements.txt"
    req.write_text("x\n")
    monkeypatch.setattr(deps, "REQUIREMENTS", req)
    monkeypatch.setattr(deps, "MARKER", tmp_path / "marker")
    monkeypatch.setattr(deps.subprocess, "call", lambda cmd: 1)
    assert deps.main() == 1 and deps.needs_install()     # échec : on réessaiera au prochain lancement
