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
import sqlite3
import time
from datetime import date
from pathlib import Path

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import HTMLResponse, Response
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from . import categorize, config, dashboard, dedup, importers, income, insights, report
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


HINTS = {"investissement", "dividende", "interets", "impot", "frais", "carte", "virement"}


class ImportTx(BaseModel):
    date: str
    label: str
    amount_cents: int
    fingerprint: str
    hint: str | None = None


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
             t.amount_cents, t.fingerprint[:64], t.hint if t.hint in HINTS else None)
            for t in body.transactions
        ]
        d.conn.executemany(
            "INSERT INTO transactions(account_id, statement_id, date, label, amount_cents, fingerprint, hint) "
            "VALUES (?,?,?,?,?,?,?)",
            rows,
        )
        categorize.categorize_all(d.conn)
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
def list_transactions(account_id: int | None = None, month: str | None = None, category: str | None = None,
                      limit: int = 500):
    d = require_unlocked()
    sql = """SELECT t.id, t.account_id, a.name AS account, t.date, t.label, t.amount_cents, t.hint,
                    t.category_source, t.category_locked,
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
    if category == "none":
        sql += " AND t.category_id IS NULL"
    elif category:
        sql += " AND t.category_id = ?"
        args.append(int(category))
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
        categorize.categorize_all(d.conn)
        save_or_conflict()
    return {"id": cur.lastrowid}


@app.delete("/api/transactions/{tx_id}")
def delete_transaction(tx_id: int):
    d = require_unlocked()
    with d.lock:
        d.conn.execute("DELETE FROM transactions WHERE id=?", (tx_id,))
        save_or_conflict()
    return {"ok": True}


# --- Catégorisation ------------------------------------------------------------------
CATEGORY_KINDS = {"expense", "income", "transfer"}


class CategoryIn(BaseModel):
    name: str
    kind: str = "expense"
    color: str | None = None


def _check_category(body: CategoryIn) -> tuple[str, str, str | None]:
    name = body.name.strip()
    if not name or len(name) > 40:
        raise HTTPException(400, "Nom de catégorie invalide.")
    if body.kind not in CATEGORY_KINDS:
        raise HTTPException(400, "Type de catégorie invalide.")
    color = body.color if body.color and len(body.color) == 7 and body.color.startswith("#") else None
    return name, body.kind, color


@app.get("/api/categories/stats")
def categories_stats():
    d = require_unlocked()
    rows = d.conn.execute(
        """SELECT c.id, c.name, c.kind, c.color,
                  (SELECT COUNT(*) FROM transactions t WHERE t.category_id = c.id) AS tx_count,
                  (SELECT COUNT(*) FROM rules r WHERE r.category_id = c.id) AS rule_count
           FROM categories c ORDER BY c.kind, c.name"""
    ).fetchall()
    uncategorized = d.conn.execute("SELECT COUNT(*) FROM transactions WHERE category_id IS NULL").fetchone()[0]
    return {"categories": [dict(r) for r in rows], "uncategorized": uncategorized}


@app.post("/api/categories")
def create_category(body: CategoryIn):
    d = require_unlocked()
    name, kind, color = _check_category(body)
    with d.lock:
        try:
            cur = d.conn.execute("INSERT INTO categories(name, kind, color) VALUES (?,?,?)", (name, kind, color))
        except sqlite3.IntegrityError:
            raise HTTPException(409, "Une catégorie porte déjà ce nom.")
        save_or_conflict()
    return {"id": cur.lastrowid}


@app.put("/api/categories/{cat_id}")
def update_category(cat_id: int, body: CategoryIn):
    d = require_unlocked()
    name, kind, color = _check_category(body)
    with d.lock:
        try:
            d.conn.execute("UPDATE categories SET name=?, kind=?, color=? WHERE id=?", (name, kind, color, cat_id))
        except sqlite3.IntegrityError:
            raise HTTPException(409, "Une catégorie porte déjà ce nom.")
        save_or_conflict()
    return {"ok": True}


@app.delete("/api/categories/{cat_id}")
def delete_category(cat_id: int):
    """Supprime la catégorie et ses règles ; ses opérations redeviennent « à classer »."""
    d = require_unlocked()
    with d.lock:
        d.conn.execute("UPDATE transactions SET category_locked=0 WHERE category_id=?", (cat_id,))
        d.conn.execute("DELETE FROM categories WHERE id=?", (cat_id,))
        categorize.categorize_all(d.conn)
        save_or_conflict()
    return {"ok": True}


class RuleIn(BaseModel):
    pattern: str
    is_regex: bool = False
    category_id: int
    sign: str | None = None
    priority: int = 10


def _check_rule(d: Database, body: RuleIn) -> str:
    try:
        pattern = categorize.validate_pattern(body.pattern, body.is_regex)
    except ValueError as e:
        raise HTTPException(400, str(e))
    if body.sign not in (None, "+", "-"):
        raise HTTPException(400, "Sens invalide.")
    if d.conn.execute("SELECT 1 FROM categories WHERE id=?", (body.category_id,)).fetchone() is None:
        raise HTTPException(404, "Catégorie introuvable.")
    return pattern


@app.get("/api/rules")
def list_rules():
    d = require_unlocked()
    rows = d.conn.execute(
        """SELECT r.id, r.pattern, r.is_regex, r.sign, r.origin, r.priority, r.category_id,
                  c.name AS category, c.color AS category_color
           FROM rules r JOIN categories c ON c.id = r.category_id
           ORDER BY CASE r.origin WHEN 'default' THEN 1 ELSE 0 END, r.priority, r.id DESC"""
    ).fetchall()
    return [dict(r) for r in rows]


@app.post("/api/rules")
def create_rule(body: RuleIn):
    d = require_unlocked()
    with d.lock:
        pattern = _check_rule(d, body)
        cur = d.conn.execute(
            "INSERT INTO rules(pattern, is_regex, category_id, priority, sign, origin) VALUES (?,?,?,?,?, 'user')",
            (pattern, int(body.is_regex), body.category_id, max(1, min(body.priority, 99)), body.sign),
        )
        changed = categorize.categorize_all(d.conn)
        save_or_conflict()
    return {"id": cur.lastrowid, "changed": changed}


@app.put("/api/rules/{rule_id}")
def update_rule(rule_id: int, body: RuleIn):
    d = require_unlocked()
    with d.lock:
        pattern = _check_rule(d, body)
        d.conn.execute(
            "UPDATE rules SET pattern=?, is_regex=?, category_id=?, sign=?, "
            "origin=CASE origin WHEN 'default' THEN 'user' ELSE origin END WHERE id=?",
            (pattern, int(body.is_regex), body.category_id, body.sign, rule_id),
        )
        changed = categorize.categorize_all(d.conn)
        save_or_conflict()
    return {"ok": True, "changed": changed}


@app.delete("/api/rules/{rule_id}")
def delete_rule(rule_id: int):
    d = require_unlocked()
    with d.lock:
        d.conn.execute("DELETE FROM rules WHERE id=?", (rule_id,))
        changed = categorize.categorize_all(d.conn)
        save_or_conflict()
    return {"ok": True, "changed": changed}


class RulePreviewIn(BaseModel):
    pattern: str
    is_regex: bool = False
    sign: str | None = None


@app.post("/api/rules/preview")
def rule_preview(body: RulePreviewIn):
    d = require_unlocked()
    try:
        pattern = categorize.validate_pattern(body.pattern, body.is_regex)
    except ValueError as e:
        raise HTTPException(400, str(e))
    with d.lock:
        return categorize.preview_rule(d.conn, pattern, body.is_regex, body.sign)


@app.post("/api/rules/recategorize")
def recategorize():
    d = require_unlocked()
    with d.lock:
        changed = categorize.categorize_all(d.conn)
        save_or_conflict()
    return {"changed": changed}


class TxCategoryIn(BaseModel):
    category_id: int | None
    rule_pattern: str | None = None  # si fourni : crée une règle à partir de la correction
    rule_is_regex: bool = False
    rule_sign: str | None = None


@app.get("/api/transactions/{tx_id}/suggest")
def suggest_rule(tx_id: int):
    d = require_unlocked()
    row = d.conn.execute("SELECT label FROM transactions WHERE id=?", (tx_id,)).fetchone()
    if row is None:
        raise HTTPException(404, "Opération introuvable.")
    return {"pattern": categorize.suggest_pattern(row["label"])}


@app.put("/api/transactions/{tx_id}/category")
def set_category(tx_id: int, body: TxCategoryIn):
    """Correction manuelle : l'opération est verrouillée ; une règle peut être créée."""
    d = require_unlocked()
    with d.lock:
        if d.conn.execute("SELECT 1 FROM transactions WHERE id=?", (tx_id,)).fetchone() is None:
            raise HTTPException(404, "Opération introuvable.")
        if body.category_id is not None and d.conn.execute(
            "SELECT 1 FROM categories WHERE id=?", (body.category_id,)
        ).fetchone() is None:
            raise HTTPException(404, "Catégorie introuvable.")
        d.conn.execute(
            "UPDATE transactions SET category_id=?, category_locked=1, category_source='manuel' WHERE id=?",
            (body.category_id, tx_id),
        )
        changed = 0
        if body.rule_pattern and body.category_id is not None:
            rule = RuleIn(pattern=body.rule_pattern, is_regex=body.rule_is_regex,
                          category_id=body.category_id, sign=body.rule_sign)
            pattern = _check_rule(d, rule)
            d.conn.execute(
                "INSERT INTO rules(pattern, is_regex, category_id, priority, created_from_correction, sign, origin) "
                "VALUES (?,?,?,10,1,?, 'correction')",
                (pattern, int(rule.is_regex), rule.category_id, rule.sign),
            )
        changed = categorize.categorize_all(d.conn)
        save_or_conflict()
    return {"ok": True, "changed": changed}


@app.post("/api/transactions/{tx_id}/auto")
def unlock_category(tx_id: int):
    """Rend l'opération au classement automatique."""
    d = require_unlocked()
    with d.lock:
        d.conn.execute("UPDATE transactions SET category_locked=0 WHERE id=?", (tx_id,))
        categorize.categorize_all(d.conn)
        save_or_conflict()
    return {"ok": True}


# --- Tableau de bord et budgets ------------------------------------------------------------
def _month_or_400(month: str | None) -> str | None:
    if month is None:
        return None
    try:
        date.fromisoformat(month[:7] + "-01")
    except ValueError:
        raise HTTPException(400, "Mois invalide.")
    return month[:7]


@app.get("/api/dashboard")
def get_dashboard(month: str | None = None, months: int = 12, account_id: int | None = None,
                  category_id: int | None = None):
    d = require_unlocked()
    with d.lock:
        return dashboard.dashboard(d.conn, _month_or_400(month), max(3, min(months, 36)), account_id, category_id)


class BudgetIn(BaseModel):
    monthly_limit_cents: int | None


@app.put("/api/budgets/{cat_id}")
def set_budget(cat_id: int, body: BudgetIn):
    """Plafond mensuel d'une catégorie de dépense ; vide ou 0 = pas de plafond."""
    d = require_unlocked()
    with d.lock:
        row = d.conn.execute("SELECT kind FROM categories WHERE id=?", (cat_id,)).fetchone()
        if row is None:
            raise HTTPException(404, "Catégorie introuvable.")
        if row["kind"] != "expense":
            raise HTTPException(400, "Un budget ne s'applique qu'à une catégorie de dépense.")
        if not body.monthly_limit_cents or body.monthly_limit_cents <= 0:
            d.conn.execute("DELETE FROM budgets WHERE category_id=?", (cat_id,))
        else:
            d.conn.execute(
                "INSERT INTO budgets(category_id, monthly_limit_cents) VALUES (?,?) "
                "ON CONFLICT(category_id) DO UPDATE SET monthly_limit_cents=excluded.monthly_limit_cents",
                (cat_id, body.monthly_limit_cents),
            )
        save_or_conflict()
    return {"ok": True}


@app.get("/api/budgets")
def list_budgets():
    d = require_unlocked()
    rows = d.conn.execute(
        """SELECT c.id AS category_id, c.name, c.color, b.monthly_limit_cents
           FROM categories c LEFT JOIN budgets b ON b.category_id = c.id
           WHERE c.kind = 'expense' ORDER BY c.name"""
    ).fetchall()
    return [dict(r) for r in rows]


# --- Suggestions d'économies ----------------------------------------------------------------
@app.get("/api/insights")
def get_insights(month: str | None = None, account_id: int | None = None):
    d = require_unlocked()
    with d.lock:
        return insights.insights(d.conn, _month_or_400(month), account_id)


class DismissIn(BaseModel):
    id: str


@app.post("/api/insights/dismiss")
def dismiss_insight(body: DismissIn):
    d = require_unlocked()
    if not body.id or len(body.id) > 200:
        raise HTTPException(400, "Identifiant invalide.")
    with d.lock:
        ids = insights.dismissed(d.conn)
        ids.add(body.id)
        insights.set_dismissed(d.conn, ids)
        save_or_conflict()
    return {"ok": True}


@app.delete("/api/insights/dismiss")
def restore_insights():
    d = require_unlocked()
    with d.lock:
        insights.set_dismissed(d.conn, set())
        save_or_conflict()
    return {"ok": True}


# --- Revenus variables ----------------------------------------------------------------------
@app.get("/api/income")
def get_income(month: str | None = None, months: int = 12):
    d = require_unlocked()
    with d.lock:
        out = income.analysis(d.conn, _month_or_400(month), max(6, min(months, 36)))
        out["income_categories"] = [dict(r) for r in d.conn.execute(
            "SELECT id, name, color FROM categories WHERE kind = 'income' ORDER BY name")]
        out["budgets_total_cents"] = d.conn.execute(
            "SELECT COALESCE(SUM(monthly_limit_cents), 0) FROM budgets").fetchone()[0]
        return out


class IncomeCategoriesIn(BaseModel):
    category_ids: list[int]


@app.put("/api/income/categories")
def set_income_categories(body: IncomeCategoriesIn):
    d = require_unlocked()
    with d.lock:
        valid = {r[0] for r in d.conn.execute("SELECT id FROM categories WHERE kind = 'income'")}
        if not set(body.category_ids) <= valid:
            raise HTTPException(400, "Seules des catégories de revenus peuvent être suivies.")
        income.set_tracked_categories(d.conn, body.category_ids)
        save_or_conflict()
    return {"ok": True}


# --- Sauvegarde et export --------------------------------------------------------------------
def _download(content: bytes, filename: str, media_type: str) -> Response:
    return Response(content, media_type=media_type, headers={
        "Content-Disposition": f'attachment; filename="{filename}"',
        "Cache-Control": "no-store",
    })


@app.get("/api/export/backup")
def export_backup():
    """Copie du coffre CHIFFRÉ (même mot de passe). Restauration : la choisir comme emplacement du coffre."""
    d = require_unlocked()
    with d.lock:
        d.save()  # s'assure que le fichier sur disque est à jour
        raw = d.vault.path.read_bytes()
    log.info("Sauvegarde chiffrée exportée.")
    return _download(raw, f"budget-sauvegarde-{date.today().isoformat()}.vault", "application/octet-stream")


@app.get("/api/export/csv")
def export_csv():
    """Toutes les opérations en CSV (EN CLAIR) : point-virgule et UTF-8 avec BOM pour Excel."""
    import csv
    import io

    d = require_unlocked()
    buf = io.StringIO()
    w = csv.writer(buf, delimiter=";")
    w.writerow(["date", "compte", "libelle", "montant", "categorie", "nature"])
    for r in d.conn.execute(
        """SELECT t.date, a.name, t.label, t.amount_cents, c.name, t.hint FROM transactions t
           JOIN accounts a ON a.id = t.account_id LEFT JOIN categories c ON c.id = t.category_id
           ORDER BY t.date, t.id"""
    ):
        cents = r[3]
        amount = f"{'-' if cents < 0 else ''}{abs(cents) // 100},{abs(cents) % 100:02d}"
        w.writerow([r[0], r[1], r[2], amount, r[4] or "", r[5] or ""])
    log.info("Export CSV généré.")
    return _download(("\ufeff" + buf.getvalue()).encode("utf-8"),
                     f"budget-operations-{date.today().isoformat()}.csv", "text/csv; charset=utf-8")


# --- Rapport PDF chiffré (iPhone) -----------------------------------------------------------
class ReportIn(BaseModel):
    password: str
    month: str | None = None
    save_next_to_vault: bool = False


@app.post("/api/report")
def make_report(body: ReportIn):
    """PDF du mois, chiffré AES-256 avec le mot de passe donné.

    save_next_to_vault : écrit le fichier (chiffré) dans « Rapports » à côté du coffre,
    par exemple iCloud Drive/Budget/Rapports, pour l'ouvrir depuis l'iPhone.
    Sinon, le fichier est renvoyé pour téléchargement.
    """
    d = require_unlocked()
    if len(body.password) < config.MIN_PASSWORD_LENGTH:
        raise HTTPException(400, f"Mot de passe trop court ({config.MIN_PASSWORD_LENGTH} caractères minimum).")
    with d.lock:
        pdf, month = report.build_pdf(d.conn, _month_or_400(body.month))
    data = report.encrypt_pdf(pdf, body.password)
    del pdf
    name = f"Budget-{month}.pdf"
    if body.save_next_to_vault:
        folder = d.vault.path.parent / "Rapports"
        folder.mkdir(parents=True, exist_ok=True)
        target = folder / name
        tmp = target.with_suffix(".tmp")
        tmp.write_bytes(data)
        tmp.replace(target)
        log.info("Rapport chiffré enregistré à côté du coffre.")
        return {"ok": True, "saved_to": str(target)}
    log.info("Rapport chiffré généré.")
    return _download(data, name, "application/pdf")


# --- Front -----------------------------------------------------------------------------
_INDEX = (config.STATIC_DIR / "index.html").read_text(encoding="utf-8")


@app.get("/", response_class=HTMLResponse)
def index(_: Request):
    # Le jeton est injecté dans la page : seul un onglet ouvert sur l'app peut le lire.
    return HTMLResponse(_INDEX.replace("__SESSION_TOKEN__", SESSION_TOKEN))


app.mount("/static", StaticFiles(directory=config.STATIC_DIR), name="static")
