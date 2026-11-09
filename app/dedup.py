"""Détection des doublons et contrôle de cohérence d'un relevé.

Deux niveaux de doublons :
- « doublon » (certain) : même compte, même date, même montant, même libellé
  normalisé, et même rang d'apparition (deux cafés identiques le même jour ne
  sont PAS des doublons entre eux, mais la réimportation du même relevé, si).
- « doublon probable » : même compte, même montant, dates à 3 jours près et
  libellés proches. Typique quand on importe le CSV puis le PDF de la même
  période : les libellés diffèrent légèrement d'un format à l'autre.
"""
from __future__ import annotations

import hashlib
import sqlite3
from collections import Counter
from datetime import date

from .importers.base import normalize_label


def base_key(account_id: int, d: str, cents: int, label: str) -> str:
    return f"{account_id}|{d}|{cents}|{normalize_label(label)}"


def fingerprints(account_id: int, txs: list[dict]) -> list[str]:
    """Empreinte stable par opération, rang d'apparition inclus."""
    seen: Counter[str] = Counter()
    out = []
    for t in txs:
        k = base_key(account_id, t["date"], t["amount_cents"], t["label"])
        seen[k] += 1
        out.append(hashlib.sha256(f"{k}|{seen[k]}".encode()).hexdigest()[:24])
    return out


def _tokens(label: str) -> set[str]:
    return {w for w in normalize_label(label).split() if len(w) > 2}


def label_similarity(a: str, b: str) -> float:
    ta, tb = _tokens(a), _tokens(b)
    if not ta or not tb:
        return 0.0
    return len(ta & tb) / min(len(ta), len(tb))


def flag_duplicates(conn: sqlite3.Connection, account_id: int, txs: list[dict]) -> None:
    """Ajoute à chaque opération : fingerprint, duplicate ('exact'|'probable'|None), selected."""
    fps = fingerprints(account_id, txs)
    existing = {
        r[0] for r in conn.execute("SELECT fingerprint FROM transactions WHERE account_id=?", (account_id,))
    }
    for t, fp in zip(txs, fps):
        t["fingerprint"] = fp
        t["duplicate"] = "exact" if fp in existing else None

    pending = [t for t in txs if t["duplicate"] is None]
    if pending:
        dates = sorted(t["date"] for t in pending)
        rows = conn.execute(
            "SELECT date, label, amount_cents FROM transactions WHERE account_id=? "
            "AND date BETWEEN date(?, '-3 day') AND date(?, '+3 day')",
            (account_id, dates[0], dates[-1]),
        ).fetchall()
        by_amount: dict[int, list] = {}
        for r in rows:
            by_amount.setdefault(r["amount_cents"], []).append(r)
        for t in pending:
            for r in by_amount.get(t["amount_cents"], []):
                gap = abs((date.fromisoformat(r["date"]) - date.fromisoformat(t["date"])).days)
                if gap <= 3 and label_similarity(r["label"], t["label"]) >= 0.5:
                    t["duplicate"] = "probable"
                    break
    for t in txs:
        t["selected"] = t["duplicate"] is None


def coherence(opening: int | None, closing: int | None, txs: list[dict]) -> dict:
    """Solde début + somme des opérations = solde fin ? (sur TOUTES les lignes du relevé)."""
    total = sum(t["amount_cents"] for t in txs)
    if opening is None or closing is None:
        return {"status": "unknown", "sum_cents": total}
    diff = opening + total - closing
    return {"status": "ok" if diff == 0 else "mismatch", "sum_cents": total, "diff_cents": diff}
