"""Application FastAPI : API locale + fichiers du front.

Toutes les routes /api exigent le jeton de session (voir security.py).
Les messages d'erreur renvoyés ne contiennent jamais de donnée personnelle.
"""
from __future__ import annotations

import json
import logging
import platform
import secrets
import time
from pathlib import Path

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import HTMLResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from . import config
from .db import Database
from .security import SESSION_TOKEN, SecurityMiddleware
from .vault import VaultConflict, VaultError, WrongPassword, find_icloud_conflict_copies

log = logging.getLogger("budget")

db = Database()
_state = {"last_activity": time.monotonic()}

# docs_url/redoc_url désactivés : la doc interactive de FastAPI charge des
# fichiers depuis un CDN, ce qui violerait la règle « aucun appel externe ».
app = FastAPI(title="Budget local", docs_url=None, redoc_url=None, openapi_url=None)
app.add_middleware(SecurityMiddleware)


# --- Identité de l'appareil -------------------------------------------------------
def device_label() -> str:
    """Étiquette neutre de cet ordinateur (ex. « Mac-3f9a »), sans nom d'utilisateur.

    Elle est écrite en clair dans l'en-tête du coffre et dans le fichier verrou
    (pour signaler « ouvert sur un autre appareil »), donc on évite le nom de la
    machine, qui contient souvent un prénom.
    """
    cfg = config.load_local_config()
    if "device_label" not in cfg:
        system = {"Darwin": "Mac", "Windows": "PC"}.get(platform.system(), "Ordinateur")
        cfg["device_label"] = f"{system}-{secrets.token_hex(2)}"
        config.save_local_config(cfg)
    return cfg["device_label"]


def lock_file(path: Path) -> Path:
    return path.with_name(path.name + ".lock")


def _write_open_marker(path: Path) -> None:
    try:
        lock_file(path).write_text(
            json.dumps({"device": device_label(), "since": int(time.time())}), encoding="utf-8"
        )
    except OSError:
        pass


def _remove_open_marker(path: Path) -> None:
    try:
        data = json.loads(lock_file(path).read_text(encoding="utf-8"))
        if data.get("device") == device_label():
            lock_file(path).unlink()
    except (OSError, ValueError):
        pass


def _other_device_open(path: Path) -> str | None:
    try:
        data = json.loads(lock_file(path).read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None
    if data.get("device") != device_label() and time.time() - data.get("since", 0) < 12 * 3600:
        return str(data.get("device"))
    return None


# --- Verrouillage automatique ----------------------------------------------------------
def touch() -> None:
    _state["last_activity"] = time.monotonic()


def require_unlocked() -> Database:
    if db.is_unlocked and time.monotonic() - _state["last_activity"] > config.AUTO_LOCK_SECONDS:
        lock_vault()
    if not db.is_unlocked:
        raise HTTPException(status_code=423, detail="Coffre verrouillé.")
    touch()
    return db


def lock_vault() -> None:
    if db.vault is not None:
        _remove_open_marker(db.vault.path)
    db.lock_now()


def save_or_conflict() -> None:
    try:
        db.save()
    except VaultConflict:
        raise HTTPException(
            status_code=409,
            detail="Le coffre a été modifié sur un autre appareil. Verrouillez puis rouvrez "
            "pour récupérer la dernière version (vos dernières modifications ici ne sont pas enregistrées).",
        )


# --- Modèles ---------------------------------------------------------------------------
class PasswordIn(BaseModel):
    password: str


class VaultPathIn(BaseModel):
    path: str


# --- Routes : coffre ---------------------------------------------------------------
@app.get("/api/status")
def status():
    path = config.vault_path()
    return {
        "unlocked": db.is_unlocked,
        "vault_exists": path.exists(),
        "vault_path": str(path),
        "icloud_available": config.icloud_drive_dir() is not None,
        "icloud_default": str(config.default_vault_path()),
        "device": device_label(),
        "open_elsewhere": _other_device_open(path) if path.exists() else None,
        "conflict_copies": find_icloud_conflict_copies(path),
        "min_password_length": config.MIN_PASSWORD_LENGTH,
        "auto_lock_minutes": config.AUTO_LOCK_SECONDS // 60,
    }


@app.post("/api/vault/create")
def vault_create(body: PasswordIn):
    if len(body.password) < config.MIN_PASSWORD_LENGTH:
        raise HTTPException(400, f"Mot de passe trop court ({config.MIN_PASSWORD_LENGTH} caractères minimum).")
    path = config.vault_path()
    try:
        db.create(path, body.password, device_label())
    except VaultError as e:
        raise HTTPException(400, str(e))
    _write_open_marker(path)
    touch()
    log.info("Coffre créé.")
    return {"ok": True}


@app.post("/api/vault/unlock")
def vault_unlock(body: PasswordIn):
    path = config.vault_path()
    if not path.exists():
        raise HTTPException(404, "Aucun coffre à cet emplacement.")
    try:
        db.unlock(path, body.password, device_label())
    except WrongPassword:
        time.sleep(1)  # ralentit les essais en rafale
        raise HTTPException(401, "Mot de passe incorrect.")
    except VaultError as e:
        raise HTTPException(400, str(e))
    _write_open_marker(path)
    touch()
    log.info("Coffre déverrouillé.")
    return {"ok": True}


@app.post("/api/vault/lock")
def vault_lock():
    lock_vault()
    log.info("Coffre verrouillé.")
    return {"ok": True}


@app.post("/api/vault/location")
def vault_location(body: VaultPathIn):
    """Choisir où vit le coffre (ex. dossier iCloud Drive). Coffre verrouillé uniquement."""
    if db.is_unlocked:
        raise HTTPException(409, "Verrouillez le coffre avant de changer son emplacement.")
    p = Path(body.path).expanduser()
    if p.suffix != ".vault":
        p = p / config.VAULT_FILENAME
    cfg = config.load_local_config()
    cfg["vault_path"] = str(p)
    config.save_local_config(cfg)
    return {"ok": True, "vault_path": str(p)}


@app.post("/api/vault/change-password")
def vault_change_password(body: PasswordIn):
    d = require_unlocked()
    if len(body.password) < config.MIN_PASSWORD_LENGTH:
        raise HTTPException(400, f"Mot de passe trop court ({config.MIN_PASSWORD_LENGTH} caractères minimum).")
    try:
        with d.lock:
            d.conn.commit()
            d.vault.change_password(body.password, d.conn.serialize())
    except VaultConflict:
        raise HTTPException(409, "Le coffre a été modifié sur un autre appareil.")
    return {"ok": True}


@app.post("/api/data/wipe")
def data_wipe():
    """« Tout supprimer » : vide la base et efface les PDF importés gardés localement."""
    d = require_unlocked()
    with d.lock:
        d.wipe_all_data()
    if config.IMPORTS_DIR.is_dir():
        for f in config.IMPORTS_DIR.iterdir():
            if f.is_file():
                f.unlink()
    log.info("Toutes les données ont été supprimées.")
    return {"ok": True}


@app.get("/api/categories")
def list_categories():
    d = require_unlocked()
    rows = d.conn.execute("SELECT id, name, kind, color FROM categories ORDER BY kind, name").fetchall()
    return [dict(r) for r in rows]


# --- Front -----------------------------------------------------------------------------
_INDEX = (config.STATIC_DIR / "index.html").read_text(encoding="utf-8")


@app.get("/", response_class=HTMLResponse)
def index(_: Request):
    # Le jeton est injecté dans la page : seul un onglet ouvert sur l'app peut le lire.
    return HTMLResponse(_INDEX.replace("__SESSION_TOKEN__", SESSION_TOKEN))


app.mount("/static", StaticFiles(directory=config.STATIC_DIR), name="static")
