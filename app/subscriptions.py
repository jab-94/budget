"""Abonnements : repérage automatique et préférences de l'utilisateur (même logique que docs/js/analytics.js).

Repérage : même compte, même commerçant, MÊME montant, débité au moins 3 mois différents
à environ un mois d'intervalle. L'utilisateur peut confirmer, ignorer, renommer, déclarer
« résilié » ou marquer lui-même une opération comme abonnement.
Préférences : réglage « subscriptions » = {id: {status, name, cadence, cancelled_on}}.
"""
from __future__ import annotations

import calendar
import json
import re
import sqlite3
import statistics
from datetime import date

SUB_MIN_MONTHS = 3
SUB_CADENCES = {"mensuel": 1, "trimestriel": 3, "annuel": 12}
SUB_STATUSES = {"confirmed", "ignored", "cancelled"}
PRICE_TOLERANCE = 0.35  # une hausse/baisse de prix jusqu'à ±35 % reste le même abonnement
# Charges fixes qui ne sont pas des abonnements : jamais repérées automatiquement (ajout manuel possible).
SUB_EXCLUDED_CATEGORIES = {"Logement", "Impôts", "Mensualités de prêt", "Espèces"}


def _py_round(x: float) -> int:
    return round(x)


def _days(a: str, b: str) -> int:
    return (date.fromisoformat(b) - date.fromisoformat(a)).days


def _add_months(iso: str, n: int) -> str:
    y, m, d = int(iso[:4]), int(iso[5:7]) + n, int(iso[8:10])
    while m > 12:
        m -= 12
        y += 1
    return date(y, m, min(d, calendar.monthrange(y, m)[1])).isoformat()


def subscription_id(account_id: int, key: str, cents: int) -> str:
    return f"{account_id}|{key}|{cents}"


def subscription_id_of(label: str, account_id: int, amount_cents: int) -> str | None:
    from .insights import merchant_key
    key = merchant_key(label)
    return subscription_id(account_id, key, -amount_cents) if key and amount_cents < 0 else None


def load_prefs(conn: sqlite3.Connection) -> dict:
    row = conn.execute("SELECT value FROM settings WHERE key='subscriptions'").fetchone()
    return json.loads(row[0]) if row else {}


def save_prefs(conn: sqlite3.Connection, prefs: dict) -> None:
    conn.execute("INSERT INTO settings(key, value) VALUES ('subscriptions', ?) "
                 "ON CONFLICT(key) DO UPDATE SET value=excluded.value", (json.dumps(prefs, sort_keys=True),))


def _guess_cadence(dates: list[str]) -> str:
    if len(dates) < 2:
        return "mensuel"
    gap = statistics.median(_days(a, b) for a, b in zip(dates, dates[1:]))
    return "annuel" if gap >= 300 else "trimestriel" if gap >= 75 else "mensuel"


def subscriptions(conn: sqlite3.Connection) -> dict:
    from .insights import _all_rows, merchant_key
    prefs = load_prefs(conn)
    all_rows = [dict(r) for r in _all_rows(conn)]
    last_by_account: dict[int, str] = {}
    for r in all_rows:
        if r["date"] > last_by_account.get(r["account_id"], ""):
            last_by_account[r["account_id"]] = r["date"]
    rows = sorted((r for r in all_rows if r["amount_cents"] < 0 and r["kind"] != "transfer"),
                  key=lambda r: (r["date"], r["id"]))
    groups: dict[str, dict] = {}
    by_merchant: dict[str, list] = {}
    for r in rows:
        key = merchant_key(r["label"])
        if not key:
            continue
        sid = subscription_id(r["account_id"], key, -r["amount_cents"])
        groups.setdefault(sid, {"id": sid, "key": key, "cents": -r["amount_cents"], "items": []})["items"].append(r)
        by_merchant.setdefault(f"{r['account_id']}|{key}", []).append(r)
    candidates, ignored = [], []
    for g in groups.values():
        pref = prefs.get(g["id"], {})
        months = {r["date"][:7] for r in g["items"]}
        dates = sorted({r["date"] for r in g["items"]})
        gap = statistics.median(_days(a, b) for a, b in zip(dates, dates[1:])) if len(dates) > 1 else 0
        g["auto"] = (len(months) >= SUB_MIN_MONTHS and len(dates) <= len(months) + 1 and 25 <= gap <= 35
                     and g["items"][-1]["category"] not in SUB_EXCLUDED_CATEGORIES)
        if pref.get("status") == "ignored":
            ignored.append({"id": g["id"], "name": pref.get("name") or g["key"].title(), "amount_cents": g["cents"],
                            "account": g["items"][0]["account"]})
        elif g["auto"] or pref.get("status") in ("confirmed", "cancelled"):
            candidates.append(g)
    candidates.sort(key=lambda g: (g["items"][0]["date"], g["items"][0]["id"]))
    used: set[int] = set()
    items = []
    for g in candidates:
        charges = [r for r in g["items"] if r["id"] not in used]
        if not charges:
            continue  # déjà repris par un autre abonnement (changement de prix)
        pref = prefs.get(g["id"], {})
        cadence = pref.get("cadence") if pref.get("cadence") in SUB_CADENCES else (
            "mensuel" if g["auto"] else _guess_cadence(sorted({r["date"] for r in charges})))
        period = SUB_CADENCES[cadence] * 30.44
        pool = by_merchant[f"{g['items'][0]['account_id']}|{g['key']}"]
        g_last = g["items"][-1]["date"]
        while True:
            last = charges[-1]
            nxt = next((r for r in pool if r["id"] not in used and r not in charges and r["date"] > last["date"]
                        and period * 0.65 <= _days(last["date"], r["date"]) <= period * 1.5
                        and abs(-r["amount_cents"] + last["amount_cents"]) <= PRICE_TOLERANCE * -last["amount_cents"]
                        and not any(c is not g and c["id"] == subscription_id_of(r["label"], r["account_id"], r["amount_cents"])
                                    and c["items"][0]["date"] <= g_last for c in candidates)), None)
            if nxt is None:
                break
            charges.append(nxt)
        used.update(r["id"] for r in charges)
        last = charges[-1]
        amount = -last["amount_cents"]
        n = SUB_CADENCES[cadence]
        if pref.get("status") == "cancelled":
            status = "resilie"
        elif _days(last["date"], last_by_account[last["account_id"]]) > period + 15:
            status = "arrete"
        else:
            status = "actif"
        cancelled_on = pref.get("cancelled_on")
        items.append({
            "id": g["id"], "key": g["key"], "name": pref.get("name") or g["key"].title(), "label": last["label"],
            "account": last["account"], "account_id": last["account_id"], "category": last["category"],
            "color": last["color"], "amount_cents": amount, "cadence": cadence, "monthly_cents": _py_round(amount / n),
            "yearly_cents": _py_round(amount * 12 / n), "first_date": charges[0]["date"], "last_date": last["date"],
            "next_date": _add_months(last["date"], n), "count": len(charges), "status": status,
            "origin": "auto" if g["auto"] else "manuel", "confirmed": pref.get("status") == "confirmed",
            "cancelled_on": cancelled_on,
            "charged_after_cancel": [{"date": r["date"], "amount_cents": -r["amount_cents"]} for r in charges
                                     if status == "resilie" and r["date"] > cancelled_on],
            "price_change_cents": amount - g["cents"], "previous_amount_cents": g["cents"],
            "history": [{"id": r["id"], "date": r["date"], "amount_cents": -r["amount_cents"]} for r in reversed(charges[-12:])],
        })
    order = {"actif": 0, "arrete": 1, "resilie": 2}
    items.sort(key=lambda x: (order[x["status"]], -x["monthly_cents"], x["name"]))
    active = [x for x in items if x["status"] == "actif"]
    return {"items": items, "ignored": ignored, "min_months": SUB_MIN_MONTHS,
            "totals": {"count": len(active), "monthly_cents": sum(x["monthly_cents"] for x in active),
                       "yearly_cents": sum(x["yearly_cents"] for x in active)}}


def update_subscription(conn: sqlite3.Connection, body: dict, today: str) -> dict:
    """status : confirmed | ignored | cancelled | auto (= par défaut). Lève ValueError (message affichable)."""
    sid = str(body.get("id") or "")
    if not sid or len(sid) > 300 or len(sid.split("|")) != 3:
        raise ValueError("Abonnement inconnu.")
    prefs = load_prefs(conn)
    pref = dict(prefs.get(sid, {}))
    if "status" in body and body["status"] is not None:
        st = body["status"]
        if st == "auto":
            pref.pop("status", None)
            pref.pop("cancelled_on", None)
        elif st in SUB_STATUSES:
            pref["status"] = st
            if st == "cancelled":
                co = body.get("cancelled_on") or ""
                pref["cancelled_on"] = co if re.fullmatch(r"\d{4}-\d{2}-\d{2}", co) else today
            else:
                pref.pop("cancelled_on", None)
        else:
            raise ValueError("Statut invalide.")
    if body.get("name") is not None:
        name = str(body["name"]).strip()
        if len(name) > 60:
            raise ValueError("Nom trop long (60 caractères maximum).")
        if name:
            pref["name"] = name
        else:
            pref.pop("name", None)
    if body.get("cadence") is not None:
        cad = body["cadence"]
        if cad and cad not in SUB_CADENCES:
            raise ValueError("Fréquence invalide.")
        if cad:
            pref["cadence"] = cad
        else:
            pref.pop("cadence", None)
    if pref:
        prefs[sid] = pref
    else:
        prefs.pop(sid, None)
    save_prefs(conn, prefs)
    return pref
