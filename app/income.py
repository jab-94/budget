"""Revenus variables : moyennes lissées et revenu de référence prudent.

Règle validée avec l'utilisateur :
    revenu de référence prudent = le plus petit de
      - la moyenne des 6 derniers mois, diminuée de 20 % ;
      - le montant dépassé environ 3 mois sur 4 (1er quartile des 6 derniers mois).

Les mois de référence sont les 6 mois AVANT le mois affiché : le mois en cours,
souvent incomplet (salaire pas encore versé), ne fausse pas la référence.
Un mois compte s'il contient au moins une opération importée (un mois sans
salaire mais avec des opérations compte pour 0) ; un mois sans aucune donnée
est ignoré.

Catégories suivies : « Salaire » par défaut, modifiable (réglage stocké dans le coffre).
"""
from __future__ import annotations

import json
import sqlite3

from .dashboard import month_add

WINDOW = 6
SHORT_WINDOW = 3
PRUDENCE = 0.20        # moyenne 6 mois − 20 %
QUANTILE = 0.25        # montant dépassé ~3 mois sur 4
MIN_MONTHS = 3         # en dessous : pas assez d'historique pour une référence fiable
SETTING_KEY = "irregular_income_categories"


def quantile(values: list[int], q: float) -> float:
    """Quantile par interpolation linéaire (même méthode que les tableurs)."""
    v = sorted(values)
    if not v:
        return 0.0
    pos = (len(v) - 1) * q
    lo = int(pos)
    hi = min(lo + 1, len(v) - 1)
    return v[lo] + (v[hi] - v[lo]) * (pos - lo)


def tracked_categories(conn: sqlite3.Connection) -> list[int]:
    row = conn.execute("SELECT value FROM settings WHERE key = ?", (SETTING_KEY,)).fetchone()
    ids: list[int] = []
    if row:
        try:
            ids = [int(x) for x in json.loads(row[0])]
        except (ValueError, TypeError):
            ids = []
    else:
        r = conn.execute("SELECT id FROM categories WHERE name = 'Salaire'").fetchone()
        ids = [r[0]] if r else []
    existing = {r[0] for r in conn.execute("SELECT id FROM categories WHERE kind = 'income'")}
    return [i for i in ids if i in existing]


def set_tracked_categories(conn: sqlite3.Connection, ids: list[int]) -> None:
    conn.execute(
        "INSERT INTO settings(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        (SETTING_KEY, json.dumps(sorted(set(ids)))),
    )


def analysis(conn: sqlite3.Connection, month: str | None = None, months_back: int = 12) -> dict:
    cats = tracked_categories(conn)
    data_months = sorted(r[0] for r in conn.execute("SELECT DISTINCT substr(date, 1, 7) FROM transactions"))
    if not month:
        month = data_months[-1] if data_months else None
    names = [r[0] for r in conn.execute(
        f"SELECT name FROM categories WHERE id IN ({','.join('?' * len(cats)) or 'NULL'}) ORDER BY name", cats)]
    base = {"month": month, "categories": cats, "category_names": names}
    if not month or not cats:
        return {**base, "series": [], "reference": None, "enough_history": False, "history_months": 0}

    per_month: dict[str, int] = {}
    q = (f"SELECT substr(date, 1, 7) AS m, SUM(amount_cents) FROM transactions "
         f"WHERE category_id IN ({','.join('?' * len(cats))}) GROUP BY m")
    for m, total in conn.execute(q, cats):
        per_month[m] = max(0, total)
    has_data = set(data_months)

    # Historique de référence : les mois AVEC données, avant le mois affiché.
    history = [m for m in data_months if m < month][-WINDOW:]
    values = [per_month.get(m, 0) for m in history]
    short = values[-SHORT_WINDOW:]

    reference = None
    if values:
        avg6 = sum(values) / len(values)
        avg3 = sum(short) / len(short)
        q25 = quantile(values, QUANTILE)
        prudent = min(avg6 * (1 - PRUDENCE), q25)
        reference = {
            "avg3_cents": round(avg3),
            "avg6_cents": round(avg6),
            "min_cents": min(values),
            "max_cents": max(values),
            "q25_cents": round(q25),
            "avg6_minus_20_cents": round(avg6 * (1 - PRUDENCE)),
            "prudent_cents": round(prudent),
            "prudent_rule": "quartile" if q25 < avg6 * (1 - PRUDENCE) else "moyenne-20",
            "months": history,
            # Variabilité : écart moyen à la moyenne, en % (pour expliquer « à quel point » c'est irrégulier).
            "variability_pct": round(sum(abs(v - avg6) for v in values) / len(values) / avg6 * 100) if avg6 else None,
        }

    series = []
    for i in range(months_back - 1, -1, -1):
        m = month_add(month, -i)
        series.append({"month": m, "amount_cents": per_month.get(m, 0), "has_data": m in has_data})
    current = per_month.get(month, 0)
    return {
        **base,
        "series": series,
        "reference": reference,
        "current_cents": current,
        "current_received": current > 0,
        "history_months": len(history),
        "enough_history": len(history) >= MIN_MONTHS,
    }
