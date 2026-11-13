"""Suggestions d'économies, calculées localement par des règles (aucune IA, aucun appel externe).

1. Récurrences : opérations au libellé semblable qui reviennent à intervalle
   régulier (hebdo, mensuel, trimestriel, annuel) avec un montant stable
   -> abonnements et prélèvements, coût annuel, prochaine échéance, hausses de prix,
   abonnements qui semblent arrêtés.
2. Catégories en hausse par rapport à la moyenne des 3 mois précédents.
3. Frais bancaires cumulés sur 12 mois.
4. Doublons suspects : même compte, même montant, même libellé, à 2 jours près.
5. Reste à vivre prévisionnel du mois en cours.

Toutes les opérations des catégories « Hors budget » (virements internes,
placements) sont ignorées.
"""
from __future__ import annotations

import calendar
import json
import sqlite3
import statistics
from datetime import date, timedelta

from . import income
from .categorize import _NOISE_WORDS
from .dashboard import _split, month_add
from .importers.base import normalize_label

# Périodes reconnues : (nom, jours, tolérance en jours, équivalent mensuel = montant × facteur)
CADENCES = [
    ("hebdomadaire", 7, 2, 52 / 12),
    ("mensuel", 30.44, 5, 1.0),
    ("trimestriel", 91.3, 12, 1 / 3),
    ("annuel", 365.25, 25, 1 / 12),
]
MIN_OCCURRENCES = {"hebdomadaire": 4, "mensuel": 3, "trimestriel": 2, "annuel": 2}
FIXED_SPREAD = 0.02         # montants à ±2 % = tarif fixe (abonnement)
STABLE_SPREAD = 0.15        # montants à ±15 % de la médiane = montant stable
VARIABLE_SPREAD = 0.60      # jusqu'à ±60 % pour une facture PRÉLEVÉE variable (énergie été/hiver) — signalée « ≈ »
PRICE_CHANGE_MIN = 0.03     # hausse de prix signalée à partir de 3 %…
PRICE_CHANGE_MIN_CENTS = 50  # …et 0,50 €
INCREASE_PCT = 0.20         # catégorie en hausse : +20 % vs moyenne…
INCREASE_MIN_CENTS = 3000   # …et au moins 30 € d'écart
DUPLICATE_MIN_CENTS = 1000  # doublon suspect à partir de 10 €
DUPLICATE_MAX_DAYS = 2
# Charges fixes qui ne sont pas des « abonnements » qu'on peut résilier d'un clic.
NOT_SUBSCRIPTIONS = {"Logement", "Impôts", "Santé", "Frais bancaires", "Transports"}


def merchant_key(label: str) -> str:
    """Clé de regroupement : 3 premiers mots utiles du libellé (« PRLV SEPA NETFLIX » -> « NETFLIX »)."""
    words = [w for w in normalize_label(label).split()
             if w not in _NOISE_WORDS and not any(c.isdigit() for c in w)]
    return " ".join(words[:3])


def _is_card(label: str) -> bool:
    """Paiement par carte (« CB … », « CARTE … ») plutôt que prélèvement ou virement."""
    words = normalize_label(label).split()[:2]
    return bool(words) and (words[0] in {"CB", "CARTE"} or "CARTE" in words)


def _add_period(d: date, cadence: str, days: float) -> date:
    if cadence == "mensuel":
        y, m = (d.year + (d.month // 12), d.month % 12 + 1)
        return date(y, m, min(d.day, calendar.monthrange(y, m)[1]))
    return d + timedelta(days=round(days))


def _all_rows(conn: sqlite3.Connection, account_id: int | None = None):
    sql = """SELECT t.id, t.date, t.label, t.amount_cents, t.account_id, a.name AS account,
                    t.category_id, c.name AS category, c.kind AS kind, c.color AS color
             FROM transactions t JOIN accounts a ON a.id = t.account_id
             LEFT JOIN categories c ON c.id = t.category_id"""
    args: list = []
    if account_id is not None:
        sql += " WHERE t.account_id = ?"
        args.append(account_id)
    return conn.execute(sql + " ORDER BY t.date", args).fetchall()


# --- 1. Récurrences ---------------------------------------------------------------------------
def detect_recurring(rows, last_date: date) -> list[dict]:
    groups: dict[tuple, list] = {}
    for r in rows:
        if r["kind"] == "transfer":
            continue
        key = merchant_key(r["label"])
        if not key:
            continue
        groups.setdefault((r["account_id"], key, r["amount_cents"] < 0), []).append(r)

    found = []
    for (_, key, is_expense), items in groups.items():
        # Plusieurs opérations le même jour (ex. deux achats) : on garde une par jour.
        by_day: dict[str, list] = {}
        for r in items:
            by_day.setdefault(r["date"], []).append(r)
        if len(by_day) < 2:
            continue
        days = sorted(by_day)
        dates = [date.fromisoformat(d) for d in days]
        amounts = [abs(sum(r["amount_cents"] for r in by_day[d])) for d in days]
        gaps = [(b - a).days for a, b in zip(dates, dates[1:])]
        med_gap = statistics.median(gaps)

        cadence = next((c for c in CADENCES if abs(med_gap - c[1]) <= c[2]), None)
        if cadence is None:
            continue
        name, period, tol, monthly_factor = cadence
        if len(dates) < MIN_OCCURRENCES[name]:
            continue
        regular = sum(1 for g in gaps if abs(g - period) <= tol) / len(gaps)
        if regular < 0.7:
            continue
        # Variabilité mesurée sur les montants AVANT le dernier : une hausse de prix
        # récente ne doit pas faire passer un abonnement fixe pour « variable ».
        history = amounts[:-1][-6:] or amounts
        med_amount = statistics.median(history)
        if med_amount <= 0:
            continue
        spread = max(abs(a - med_amount) for a in history) / med_amount
        card = _is_card(items[-1]["label"])
        if spread > (STABLE_SPREAD if card else VARIABLE_SPREAD):
            # Un achat par carte n'est un « prélèvement » que s'il est à montant fixe ;
            # une facture prélevée (énergie…) peut varier davantage.
            continue
        if name in ("trimestriel", "annuel") and spread > 0.05:
            continue  # peu d'occurrences : on exige un montant quasi fixe

        last = dates[-1]
        next_date = _add_period(last, name, period)
        # « Arrêté » : pas vu depuis 1,5 période alors que des relevés plus récents existent.
        active = (last_date - last).days <= period * 1.5 + tol
        prev = amounts[:-1][-6:]
        prev_med = statistics.median(prev) if prev else amounts[-1]
        change = amounts[-1] - prev_med
        # Hausse de prix : seulement pour un montant jusque-là FIXE (abonnement), pas une facture variable.
        price_change = (
            change if prev and spread <= FIXED_SPREAD
            and abs(change) >= max(PRICE_CHANGE_MIN * prev_med, PRICE_CHANGE_MIN_CENTS) else 0
        )
        sample = items[-1]
        typical = amounts[-1]
        found.append({
            "key": key,
            "label": sample["label"],
            "account": sample["account"],
            "account_id": sample["account_id"],
            "category": sample["category"],
            "color": sample["color"],
            "is_expense": is_expense,
            "cadence": name,
            "occurrences": len(dates),
            "first_date": days[0],
            "last_date": days[-1],
            "next_date": next_date.isoformat(),
            "active": active,
            "amount_cents": typical,
            "variable": spread > STABLE_SPREAD,
            "monthly_cents": round(typical * monthly_factor),
            "yearly_cents": round(typical * monthly_factor * 12),
            "price_change_cents": price_change,
            "previous_amount_cents": prev_med,
            "is_subscription": is_expense and (
                sample["category"] == "Abonnements"
                or (spread <= FIXED_SPREAD and name != "hebdomadaire" and sample["category"] not in NOT_SUBSCRIPTIONS)),
        })
    found.sort(key=lambda x: -x["monthly_cents"])
    return found


# --- 2. Catégories en hausse ---------------------------------------------------------------------
def category_increases(rows, month: str) -> list[dict]:
    by_month: dict[str, list] = {}
    for r in rows:
        by_month.setdefault(r["date"][:7], []).append(r)
    if month not in by_month:
        return []
    prev = [m for m in (month_add(month, -i) for i in (1, 2, 3)) if m in by_month]
    if len(prev) < 2:
        return []  # pas assez d'historique pour parler de moyenne
    cur, _, _, _ = _split(by_month[month])
    sums: dict = {}
    for m in prev:
        e, _, _, _ = _split(by_month[m])
        for k, v in e.items():
            sums[k] = sums.get(k, 0) + v
    names = {r["category_id"]: (r["category"], r["color"]) for r in rows if r["category_id"]}
    out = []
    for cid, amount in cur.items():
        avg = round(sums.get(cid, 0) / len(prev))
        diff = amount - avg
        if diff >= INCREASE_MIN_CENTS and (avg == 0 or diff / avg >= INCREASE_PCT):
            out.append({"category_id": cid, "category": names[cid][0], "color": names[cid][1],
                        "amount_cents": amount, "average_cents": avg, "diff_cents": diff,
                        "pct": round(diff / avg * 100) if avg else None, "months": len(prev)})
    return sorted(out, key=lambda x: -x["diff_cents"])


# --- 3. Frais bancaires ----------------------------------------------------------------------
def bank_fees(rows, last_date: date) -> dict:
    since = (last_date - timedelta(days=365)).isoformat()
    fees = [r for r in rows if r["category"] == "Frais bancaires" and r["date"] > since]
    total = -sum(r["amount_cents"] for r in fees)
    by_label: dict[str, int] = {}
    for r in fees:
        k = merchant_key(r["label"]) or r["label"]
        by_label[k] = by_label.get(k, 0) - r["amount_cents"]
    first = min((r["date"] for r in rows), default=None)
    months = 12 if first is None or first <= since else max(1, round((last_date - date.fromisoformat(first)).days / 30.44))
    return {"total_cents": total, "months": months, "count": len(fees),
            "by_label": sorted(({"label": k, "amount_cents": v} for k, v in by_label.items()), key=lambda x: -x["amount_cents"])}


# --- 4. Doublons suspects --------------------------------------------------------------------
def suspected_duplicates(rows, recurring_keys: set) -> list[dict]:
    out = []
    candidates = [r for r in rows if r["amount_cents"] <= -DUPLICATE_MIN_CENTS and r["kind"] != "transfer"]
    groups: dict[tuple, list] = {}
    for r in candidates:
        groups.setdefault((r["account_id"], r["amount_cents"], normalize_label(r["label"])), []).append(r)
    for (_, _, _), items in groups.items():
        items.sort(key=lambda r: r["date"])
        for a, b in zip(items, items[1:]):
            gap = (date.fromisoformat(b["date"]) - date.fromisoformat(a["date"])).days
            if gap <= DUPLICATE_MAX_DAYS and (a["account_id"], merchant_key(a["label"])) not in recurring_keys:
                out.append({"id": f"dup:{a['id']}-{b['id']}", "ids": [a["id"], b["id"]], "label": a["label"],
                            "amount_cents": a["amount_cents"], "dates": [a["date"], b["date"]], "account": a["account"]})
    return out


# --- 5. Reste à vivre prévisionnel -------------------------------------------------------------
def remaining_to_live(rows, recurring: list[dict], month: str, last_date: date,
                      salary: dict | None = None) -> dict | None:
    """Pour un mois EN COURS (la dernière opération connue tombe dans ce mois).

    salary : résultat de income.analysis(). Si le salaire suivi n'est pas encore
    arrivé ce mois-ci, le revenu de référence PRUDENT est compté comme attendu
    (et les virements récurrents de ces catégories ne sont pas comptés en double).
    """
    if last_date.strftime("%Y-%m") != month:
        return None
    y, m = int(month[:4]), int(month[5:7])
    month_end = date(y, m, calendar.monthrange(y, m)[1])
    cur = [r for r in rows if r["date"].startswith(month)]
    exp, inc, unc_out, unc_in = _split(cur)
    income = sum(inc.values()) + unc_in
    spent = sum(exp.values()) + unc_out
    upcoming = [x for x in recurring
                if x["active"] and last_date.isoformat() < x["next_date"] <= month_end.isoformat()]
    expected_salary = 0
    tracked = set(salary["category_names"]) if salary else set()
    if salary and salary.get("reference") and salary["enough_history"] and not salary["current_received"]:
        expected_salary = salary["reference"]["prudent_cents"]
        upcoming = [x for x in upcoming if x["is_expense"] or x["category"] not in tracked]
    up_exp = sum(x["amount_cents"] for x in upcoming if x["is_expense"])
    up_inc = sum(x["amount_cents"] for x in upcoming if not x["is_expense"]) + expected_salary
    remaining = income + up_inc - spent - up_exp
    days_left = (month_end - last_date).days
    return {
        "as_of": last_date.isoformat(), "month_end": month_end.isoformat(), "days_left": days_left,
        "income_cents": income, "spent_cents": spent,
        "upcoming_expense_cents": up_exp, "upcoming_income_cents": up_inc,
        "expected_salary_cents": expected_salary,
        "remaining_cents": remaining,
        "per_day_cents": round(remaining / days_left) if days_left > 0 and remaining > 0 else None,
        "upcoming": upcoming,
    }


# --- Assemblage ----------------------------------------------------------------------------
def dismissed(conn: sqlite3.Connection) -> set[str]:
    row = conn.execute("SELECT value FROM settings WHERE key='dismissed_insights'").fetchone()
    try:
        return set(json.loads(row[0])) if row else set()
    except ValueError:
        return set()


def set_dismissed(conn: sqlite3.Connection, ids: set[str]) -> None:
    conn.execute(
        "INSERT INTO settings(key, value) VALUES ('dismissed_insights', ?) "
        "ON CONFLICT(key) DO UPDATE SET value=excluded.value",
        (json.dumps(sorted(ids)),),
    )


def insights(conn: sqlite3.Connection, month: str | None = None, account_id: int | None = None) -> dict:
    rows = _all_rows(conn, account_id)
    if not rows:
        return {"month": month, "recurring": [], "suggestions": [], "upcoming": [], "remaining": None,
                "fees": None, "duplicates": [], "dismissed_count": 0}
    last_date = date.fromisoformat(rows[-1]["date"])
    month = month or last_date.strftime("%Y-%m")
    hidden = dismissed(conn)

    recurring = detect_recurring(rows, last_date)
    active = [x for x in recurring if x["active"]]
    subs = [x for x in active if x["is_subscription"]]
    increases = category_increases(rows, month)
    fees = bank_fees(rows, last_date)
    dups = suspected_duplicates(rows, {(x["account_id"], x["key"]) for x in recurring})
    salary = income.analysis(conn, month) if account_id is None else None
    remaining = remaining_to_live(rows, recurring, month, last_date, salary)
    horizon = (last_date + timedelta(days=31)).isoformat()
    upcoming = sorted((x for x in active if x["next_date"] <= horizon), key=lambda x: x["next_date"])

    s: list[dict] = []

    def add(sid, kind, severity, title, detail, saving=None, **extra):
        if sid not in hidden:
            s.append({"id": sid, "kind": kind, "severity": severity, "title": title, "detail": detail,
                      "yearly_saving_cents": saving, **extra})

    for x in active:
        if x["is_expense"] and x["price_change_cents"] > 0:
            add(f"price:{x['account_id']}:{x['key']}:{x['last_date']}", "hausse-prix", "warn",
                f"{x['key'].title()} : le prix a augmenté",
                f"{_eur(x['previous_amount_cents'])} → {_eur(x['amount_cents'])} par échéance "
                f"({x['cadence']}), soit {_eur(round(x['price_change_cents'] * 12 * _factor(x['cadence'])))} de plus par an.",
                round(x["price_change_cents"] * 12 * _factor(x["cadence"])), recurring_key=x["key"])
    if subs:
        total = sum(x["yearly_cents"] for x in subs)
        add(f"subs:{len(subs)}:{total}", "abonnements", "info",
            f"{len(subs)} abonnement(s) actif(s) : {_eur(total)} par an",
            "Passez-les en revue : chacun résilié est une économie sur toute l'année.",
            None, items=[{"label": x["key"].title(), "yearly_cents": x["yearly_cents"], "amount_cents": x["amount_cents"],
                          "cadence": x["cadence"]} for x in subs])
    for x in recurring:
        if not x["active"] and x["is_expense"] and x["last_date"] >= (last_date - timedelta(days=200)).isoformat():
            add(f"stopped:{x['account_id']}:{x['key']}:{x['last_date']}", "arrete", "info",
                f"{x['key'].title()} semble arrêté",
                f"Dernier prélèvement le {_fr(x['last_date'])}. Si c'est voulu, rien à faire ; sinon, vérifiez votre moyen de paiement.")
    for inc in increases:
        pct = f"+{inc['pct']} %" if inc["pct"] is not None else "nouvelle dépense"
        add(f"incr:{month}:{inc['category_id']}", "hausse-categorie", "warn",
            f"{inc['category']} en hausse ce mois-ci ({pct})",
            f"{_eur(inc['amount_cents'])} contre {_eur(inc['average_cents'])} en moyenne sur les {inc['months']} mois précédents "
            f"(+{_eur(inc['diff_cents'])}).", None, category_id=inc["category_id"])
    if fees["total_cents"] > 0:
        add(f"fees:{fees['total_cents']}", "frais", "warn" if fees["total_cents"] >= 6000 else "info",
            f"{_eur(fees['total_cents'])} de frais bancaires sur {fees['months']} mois",
            "Détail : " + ", ".join(f"{f['label'].title()} {_eur(f['amount_cents'])}" for f in fees["by_label"][:4])
            + ". Une offre sans frais ou une renégociation peut les supprimer.",
            fees["total_cents"] if fees["months"] >= 12 else round(fees["total_cents"] * 12 / fees["months"]))
    for d in dups:
        add(d["id"], "doublon", "bad", f"Doublon possible : {d['label']}",
            f"{_eur(-d['amount_cents'])} débité deux fois ({_fr(d['dates'][0])} et {_fr(d['dates'][1])}, {d['account']}). "
            "Si c'est une erreur, contactez la banque ou le commerçant.", None, ids=d["ids"])
    if remaining and remaining["remaining_cents"] < 0:
        add(f"remaining:{month}", "reste-a-vivre", "bad", "Reste à vivre négatif d'ici la fin du mois",
            f"Après les prélèvements attendus, il manquerait {_eur(-remaining['remaining_cents'])}.")

    order = {"bad": 0, "warn": 1, "info": 2}
    s.sort(key=lambda x: (order[x["severity"]], -(x["yearly_saving_cents"] or 0)))
    return {
        "month": month, "as_of": last_date.isoformat(),
        "recurring": recurring, "upcoming": upcoming, "remaining": remaining,
        "fees": fees, "duplicates": dups, "suggestions": s, "dismissed_count": len(hidden),
        "subscriptions_yearly_cents": sum(x["yearly_cents"] for x in subs),
    }


def _factor(cadence: str) -> float:
    return next(c[3] for c in CADENCES if c[0] == cadence)


def _eur(cents: int) -> str:
    sign = "-" if cents < 0 else ""
    e, c = divmod(abs(int(cents)), 100)
    return f"{sign}{e:,}".replace(",", " ") + f",{c:02d} €"


def _fr(iso: str) -> str:
    return f"{iso[8:10]}/{iso[5:7]}/{iso[:4]}"
