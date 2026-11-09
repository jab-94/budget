"""Configuration centrale.

Règle n°1 : le serveur n'écoute QUE sur 127.0.0.1. Cette valeur est figée ici et
vérifiée au démarrage (voir app/__main__.py) ; aucune option ne permet de la changer.
"""
from __future__ import annotations

import json
import os
import platform
from pathlib import Path

HOST = "127.0.0.1"
DEFAULT_PORT = 8765

# Noms d'hôte acceptés dans l'en-tête HTTP "Host" (protection contre le
# "DNS rebinding" : un site web malveillant ne peut pas se faire passer pour nous).
ALLOWED_HOST_NAMES = {"127.0.0.1", "localhost"}

ROOT_DIR = Path(__file__).resolve().parent.parent
STATIC_DIR = ROOT_DIR / "static"

# data/ est listé dans .gitignore. Il contient la config locale de CETTE machine
# (chemin du coffre-fort) et éventuellement une copie temporaire des PDF importés.
DATA_DIR = Path(os.environ.get("BUDGET_DATA_DIR", ROOT_DIR / "data"))
CONFIG_FILE = DATA_DIR / "config.json"
IMPORTS_DIR = DATA_DIR / "imports"

VAULT_FILENAME = "budget.vault"

# Durée d'inactivité avant verrouillage automatique du coffre (secondes).
AUTO_LOCK_SECONDS = 15 * 60

# Longueur minimale du mot de passe : le fichier chiffré est synchronisé via
# iCloud, il doit résister à une attaque hors ligne.
MIN_PASSWORD_LENGTH = 12


def icloud_drive_dir() -> Path | None:
    """Dossier iCloud Drive local s'il existe (Mac ou application iCloud pour Windows).

    On ne contacte jamais iCloud : on écrit simplement dans le dossier que
    l'application iCloud d'Apple synchronise elle-même.
    """
    home = Path.home()
    candidates = []
    if platform.system() == "Darwin":
        candidates.append(home / "Library" / "Mobile Documents" / "com~apple~CloudDocs")
    elif platform.system() == "Windows":
        candidates.append(home / "iCloudDrive")
    for c in candidates:
        if c.is_dir():
            return c
    return None


def load_local_config() -> dict:
    try:
        return json.loads(CONFIG_FILE.read_text(encoding="utf-8"))
    except (FileNotFoundError, ValueError):
        return {}


def save_local_config(cfg: dict) -> None:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    tmp = CONFIG_FILE.with_suffix(".tmp")
    tmp.write_text(json.dumps(cfg, indent=2, ensure_ascii=False), encoding="utf-8")
    os.replace(tmp, CONFIG_FILE)


def default_vault_path() -> Path:
    cloud = icloud_drive_dir()
    if cloud is not None:
        return cloud / "Budget" / VAULT_FILENAME
    return DATA_DIR / VAULT_FILENAME


def vault_path() -> Path:
    cfg = load_local_config()
    p = cfg.get("vault_path")
    return Path(p) if p else default_vault_path()
