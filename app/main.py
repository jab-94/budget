"""Application FastAPI : API locale + fichiers du front.

Toutes les routes /api exigent le jeton de session (voir security.py).
Les messages d'erreur renvoyés ne contiennent jamais de donnée personnelle.
"""
from __future__ import annotations

import hashlib
import json
import logging
import platform
import secrets
import time
from datetime import date
from pathlib import Path

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import HTMLResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from . import config, dedup, importers
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


# --- Comptes ---------------------------------------------------------------------------
ACCOUNT_KINDS = {"courant", "joint", "epargne", "investissement"}


class AccountIn(BaseModel):
    name: str
    bank: str | None = None
    kind: str = "courant"


@app.get("/api/accounts")
def list_accounts():
    d = require_unlocked()
    rows = d.conn.execute(
        """SELECT a.id, a.name, a.bank, a.kind,
                  COUNT(t.id) AS tx_count, MIN(t.date) AS first_date, MAX(t.date) AS last_date
           FROM accounts a LEFT JOIN transactions t ON t.account_id = a.id
           GROUP BY a.id ORDER BY a.name"""
    ).fetchall()
    return [dict(r) for r in rows]


@app.post("/api/accounts")
def create_account(body: AccountIn):
    d = require_unlocked()
    name = body.name.strip()
    if not name or len(name) > 60:
        raise HTTPException(400, "Nom de compte invalide.")
    if body.kind not in ACCOUNT_KINDS:
        raise HTTPException(400, "Type de compte invalide.")
    with d.lock:
        cur = d.conn.execute(
            "INSERT INTO accounts(name, bank, kind) VALUES (?,?,?)", (name, (body.bank or "").strip() or None, body.kind)
        )
        save_or_conflict()
    return {"id": cur.lastrowid}


@app.delete("/api/accounts/{account_id}")
def delete_account(account_id: int):
    """Supprime le compte ET toutes ses opérations."""
    d = require_unlocked()
    with d.lock:
        d.conn.execute("DELETE FROM accounts WHERE id=?", (account_id,))
        save_or_conflict()
    return {"ok": True}


def _account_or_404(d: Database, account_id: int) -> None:
    if d.conn.execute("SELECT 1 FROM accounts WHERE id=?", (account_id,)).fetchone() is None:
        raise HTTPException(404, "Compte introuvable.")


# --- Import : aperçu (rien n'est enregistré) puis validation -------------------------------
@app.get("/api/import/parsers")
def import_parsers():
    require_unlocked()
    return importers.available_pdf_parsers()


@app.post("/api/import/preview")
async def import_preview(request: Request, account_id: int, fmt: str, parser: str | None = None,
                         mapping: str | None = None):
    """Lit le fichier envoyé (corps brut de la requête) EN MÉMOIRE et renvoie l'aperçu.

    On n'utilise volontairement pas l'envoi « multipart » : la bibliothèque qui le
    gère recopie les gros fichiers dans un fichier temporaire sur le disque.
    """
    d = require_unlocked()
    _account_or_404(d, account_id)
    raw = await request.body()
    if not raw:
        raise HTTPException(400, "Fichier vide.")
    if len(raw) > importers.MAX_UPLOAD_BYTES:
        raise HTTPException(413, "Fichier trop volumineux (20 Mo maximum).")
    info: dict = {}
    try:
        if fmt == "pdf":
            st = importers.parse_pdf(raw, parser)
        elif fmt == "csv":
            m = json.loads(mapping) if mapping else None
            st, info = importers.parse_csv(raw, m)
        else:
            raise HTTPException(400, "Format inconnu.")
    except importers.ImportErrorFr as e:
        raise HTTPException(400, str(e))
    except (ValueError, TypeError):
        raise HTTPException(400, "Fichier illisible.")
    finally:
        del raw  # le contenu du fichier ne survit pas à la requête

    result = st.to_dict()
    txs = result["transactions"]
    with d.lock:
        dedup.flag_duplicates(d.conn, account_id, txs)
    result["coherence"] = dedup.coherence(st.opening_balance_cents, st.closing_balance_cents, txs)
    result["csv"] = info
    log.info("Aperçu d'import : %d opération(s) lue(s).", len(txs))
    return result


class ImportTx(BaseModel):
    date: str
    label: str
    amount_cents: int
    fingerprint: str


class ImportCommit(BaseModel):
    account_id: int
    source: str
    period_start: str | None = None
    period_end: str | None = None
    opening_balance_cents: int | None = None
    closing_balance_cents: int | None = None
    transactions: list[ImportTx]


def _valid_date(s: str) -> str:
    try:
        return date.fromisoformat(s).isoformat()
    except ValueError:
        raise HTTPException(400, "Date invalide.")


@app.post("/api/import/commit")
def import_commit(body: ImportCommit):
    d = require_unlocked()
    _account_or_404(d, body.account_id)
    if body.source not in {"pdf", "csv"}:
        raise HTTPException(400, "Source invalide.")
    with d.lock:
        cur = d.conn.execute(
            """INSERT INTO statements(account_id, source, period_start, period_end,
                                      opening_balance_cents, closing_balance_cents) VALUES (?,?,?,?,?,?)""",
            (body.account_id, body.source, body.period_start, body.period_end,
             body.opening_balance_cents, body.closing_balance_cents),
        )
        sid = cur.lastrowid
        rows = [
            (body.account_id, sid, _valid_date(t.date), t.label.strip()[:300] or "(sans libellé)",
             t.amount_cents, t.fingerprint[:64])
            for t in body.transactions
        ]
        d.conn.executemany(
            "INSERT INTO transactions(account_id, statement_id, date, label, amount_cents, fingerprint) "
            "VALUES (?,?,?,?,?,?)",
            rows,
        )
        save_or_conflict()
    log.info("Import enregistré : %d opération(s).", len(rows))
    return {"ok": True, "statement_id": sid, "inserted": len(rows)}


# --- Opérations ------------------------------------------------------------------------
class ManualTx(BaseModel):
    account_id: int
    date: str
    label: str
    amount_cents: int


@app.get("/api/transactions")
def list_transactions(account_id: int | None = None, month: str | None = None, limit: int = 500):
    d = require_unlocked()
    sql = """SELECT t.id, t.account_id, a.name AS account, t.date, t.label, t.amount_cents,
                    t.category_id, c.name AS category, c.color AS category_color, t.statement_id
             FROM transactions t JOIN accounts a ON a.id = t.account_id
             LEFT JOIN categories c ON c.id = t.category_id WHERE 1=1"""
    args: list = []
    if account_id is not None:
        sql += " AND t.account_id = ?"
        args.append(account_id)
    if month:
        sql += " AND substr(t.date, 1, 7) = ?"
        args.append(month[:7])
    sql += " ORDER BY t.date DESC, t.id DESC LIMIT ?"
    args.append(max(1, min(limit, 5000)))
    return [dict(r) for r in d.conn.execute(sql, args).fetchall()]


@app.post("/api/transactions")
def create_transaction(body: ManualTx):
    d = require_unlocked()
    _account_or_404(d, body.account_id)
    label = body.label.strip()[:300]
    if not label:
        raise HTTPException(400, "Libellé obligatoire.")
    iso = _valid_date(body.date)
    with d.lock:
        key = dedup.base_key(body.account_id, iso, body.amount_cents, label)
        rank = 1 + sum(
            1 for r in d.conn.execute(
                "SELECT date, amount_cents, label FROM transactions WHERE account_id=? AND date=? AND amount_cents=?",
                (body.account_id, iso, body.amount_cents),
            )
            if dedup.base_key(body.account_id, r["date"], r["amount_cents"], r["label"]) == key
        )
        fp = hashlib.sha256(f"{key}|{rank}".encode()).hexdigest()[:24]
        cur = d.conn.execute(
            "INSERT INTO transactions(account_id, date, label, amount_cents, fingerprint) VALUES (?,?,?,?,?)",
            (body.account_id, iso, label, body.amount_cents, fp),
        )
        save_or_conflict()
    return {"id": cur.lastrowid}


@app.delete("/api/transactions/{tx_id}")
def delete_transaction(tx_id: int):
    d = require_unlocked()
    with d.lock:
        d.conn.execute("DELETE FROM transactions WHERE id=?", (tx_id,))
        save_or_conflict()
    return {"ok": True}


# --- Front -----------------------------------------------------------------------------
_INDEX = (config.STATIC_DIR / "index.html").read_text(encoding="utf-8")


@app.get("/", response_class=HTMLResponse)
def index(_: Request):
    # Le jeton est injecté dans la page : seul un onglet ouvert sur l'app peut le lire.
    return HTMLResponse(_INDEX.replace("__SESSION_TOKEN__", SESSION_TOKEN))


app.mount("/static", StaticFiles(directory=config.STATIC_DIR), name="static")
