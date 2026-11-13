"""Installe ou met à jour les bibliothèques de l'app, SEULEMENT si la liste a changé.

Appelé par les lanceurs (lancer-windows.bat, lancer-mac.command) avant de démarrer l'app.
- Si requirements.txt n'a pas changé depuis la dernière installation : ne fait rien
  (aucun accès réseau).
- Sinon (premier lancement, ou mise à jour qui ajoute une bibliothèque) : lance
  « pip install -r requirements.txt », qui télécharge les paquets depuis PyPI.
  C'est le seul moment où Internet est utilisé, et aucune donnée n'est envoyée.
L'app elle-même ne contacte jamais Internet (voir docs/AUDIT.md).
"""
from __future__ import annotations

import hashlib
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
REQUIREMENTS = ROOT / "requirements.txt"
MARKER = Path(sys.prefix) / ".budget-requirements.sha256"  # dans .venv : propre à cet ordinateur


def requirements_hash() -> str:
    return hashlib.sha256(REQUIREMENTS.read_bytes()).hexdigest()


def needs_install() -> bool:
    try:
        return MARKER.read_text().strip() != requirements_hash()
    except FileNotFoundError:
        return True


def main() -> int:
    if not needs_install():
        return 0
    print("Installation des bibliothèques de l'app (Internet nécessaire, uniquement cette fois-ci)…", flush=True)
    code = subprocess.call([sys.executable, "-m", "pip", "install", "--disable-pip-version-check", "-q",
                            "-r", str(REQUIREMENTS)])
    if code != 0:
        print("L'installation a échoué : vérifiez la connexion Internet puis relancez.", flush=True)
        return code
    MARKER.write_text(requirements_hash())
    print("Bibliothèques à jour.", flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
