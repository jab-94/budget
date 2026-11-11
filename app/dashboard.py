"""Calculs du tableau de bord et des budgets (100 % locaux, en centimes).

Règles de comptage :
- Les catégories de type « transfer » (Virements internes, Investissement) sont
  HORS BUDGET : ni dépense ni revenu.
- Catégorie de dépense : on compte le NET (un remboursement CPAM classé en Santé
  réduit la dépense Santé, il ne gonfle pas les revenus).
- Catégorie de revenu : net également.
- Opération non classée : dépense si négative, revenu si positive.
"""
from __future__ import annotations

import sqlite3
from datetime import date

BUDGET_WARN = 0.8  # alerte à 80 % du plafond


def month_add(month: str, delta: int) -> str:
    y, m = int(month[:4]), int(month[5:7])
    idx = y * 12 + (m - 1) + delta
    return f"{idx // 12:04d}-{idx % 12 + 1:02d}"


def months_with_data(conn: sqlite3.Connection, account_id: int | None = None) -> list[str]:
    sql = "SELECT DISTINCT substr(date, 1, 7) FROM transactions"
    args: list = []
    if account_id is not None:
        sql += " WHERE account_id = ?"
        args.append(account_id)
    return sorted(r[0] for r in conn.execute(sql + " ORDER BY 1", args))


def _rows(conn, first_month: str, last_month: str, account_id: int | None):
    sql = """SELECT t.id, t.date, t.label, t.amount_cents, t.account_id, a.name AS account,
                    t.category_id, c.name AS category, c.kind AS kind, c.color AS color
             FROM transactions t
             JOIN accounts a ON a.id = t.account_id
             LEFT JOIN categories c ON c.id = t.category_id
             WHERE substr(t.date, 1, 7) BETWEEN ? AND ?"""
    args: list = [first_month, last_month]
    if account_id is not None:
        sql += " AND t.account_id = ?"
        args.append(account_id)
    return conn.execute(sql, args).fetchall()


def _split(rows) -> tuple[dict, dict, int, int]:
    """(dépenses par catégorie, revenus par catégorie, non classé sortant, non classé entrant)."""
    exp: dict = {}
    inc: dict = {}
    unc_out = unc_in = 0
    for r in rows:
        kind = r["kind"]
        if kind == "transfer":
            continue
        if kind is None:
            if r["amount_cents"] < 0:
                unc_out += -r["amount_cents"]
            else:
                unc_in += r["amount_cents"]
        elif kind == "expense":
            exp[r["category_id"]] = exp.get(r["category_id"], 0) - r["amount_cents"]
        else:
            inc[r["category_id"]] = inc.get(r["category_id"], 0) + r["amount_cents"]
    return exp, inc, unc_out, unc_in


def _totals(rows) -> dict:
    exp, inc, unc_out, unc_in = _split(rows)
    income = sum(inc.values()) + unc_in
    expenses = sum(exp.values()) + unc_out
    return {"income_cents": income, "expense_cents": expenses, "net_cents": income - expenses}


def dashboard(conn: sqlite3.Connection, month: str | None, months_back: int = 12,
              account_id: int | None = None, category_id: int | None = None) -> dict:
    available = months_with_data(conn, account_id)
    if not month:
        month = available[-1] if available else date.today().strftime("%Y-%m")
    cats = {r["id"]: dict(r) for r in conn.execute("SELECT id, name, kind, color FROM categories")}
    budgets = {r[0]: r[1] for r in conn.execute("SELECT category_id, monthly_limit_cents FROM budgets")}

    first = month_add(month, -(months_back - 1))
    rows = _rows(conn, min(first, month_add(month, -3)), month, account_id)
    by_month: dict[str, list] = {}
    for r in rows:
        by_month.setdefault(r["date"][:7], []).append(r)

    cur = by_month.get(month, [])
    exp, inc, unc_out, unc_in = _split(cur)
    totals = _totals(cur)
    prev = _totals(by_month.get(month_add(month, -1), []))

    # Moyenne des 3 mois précédents par catégorie de dépense (mois sans donnée exclus).
    prev3 = [m for m in (month_add(month, -i) for i in (1, 2, 3)) if m in by_month]
    avg3: dict = {}
    for m in prev3:
        e, _, _, _ = _split(by_month[m])
        for k, v in e.items():
            avg3[k] = avg3.get(k, 0) + v
    avg3 = {k: round(v / len(prev3)) for k, v in avg3.items()} if prev3 else {}

    def budget_info(cid: int, spent: int) -> dict:
        limit = budgets.get(cid)
        if not limit:
            return {"budget_cents": None, "budget_pct": None, "budget_status": None}
        pct = spent / limit
        status = "over" if pct > 1 else "warn" if pct >= BUDGET_WARN else "ok"
        return {"budget_cents": limit, "budget_pct": round(pct * 100, 1), "budget_status": status}

    expenses = [
        {"category_id": cid, "name": cats[cid]["name"], "color": cats[cid]["color"], "amount_cents": v,
         "avg3_cents": avg3.get(cid), **budget_info(cid, v)}
        for cid, v in exp.items() if v > 0
    ]
    if unc_out:
        expenses.append({"category_id": None, "name": "À classer", "color": None, "amount_cents": unc_out,
                         "avg3_cents": None, "budget_cents": None, "budget_pct": None, "budget_status": None})
    expenses.sort(key=lambda x: -x["amount_cents"])

    incomes = [{"category_id": cid, "name": cats[cid]["name"], "color": cats[cid]["color"], "amount_cents": v}
               for cid, v in inc.items() if v > 0]
    if unc_in:
        incomes.append({"category_id": None, "name": "À classer", "color": None, "amount_cents": unc_in})
    incomes.sort(key=lambda x: -x["amount_cents"])

    # Budgets : toutes les catégories avec plafond, même sans dépense ce mois-ci.
    budget_list = [
        {"category_id": cid, "name": cats[cid]["name"], "color": cats[cid]["color"],
         "spent_cents": exp.get(cid, 0), **budget_info(cid, exp.get(cid, 0))}
        for cid in budgets if cid in cats
    ]
    budget_list.sort(key=lambda b: -(b["budget_pct"] or 0))

    # Évolution sur N mois (avec, si demandé, une seule catégorie).
    series = []
    for i in range(months_back - 1, -1, -1):
        m = month_add(month, -i)
        mrows = by_month.get(m, [])
        point = {"month": m, **_totals(mrows), "has_data": bool(mrows)}
        if category_id is not None:
            point["category_cents"] = abs(sum(
                r["amount_cents"] for r in mrows if r["category_id"] == category_id))
        series.append(point)

    top = sorted((r for r in cur if r["amount_cents"] < 0 and r["kind"] != "transfer"),
                 key=lambda r: r["amount_cents"])[:5]

    return {
        "month": month,
        "months_available": available,
        "totals": totals,
        "previous": prev,
        "savings_rate": round(totals["net_cents"] / totals["income_cents"] * 100, 1) if totals["income_cents"] > 0 else None,
        "expenses_by_category": expenses,
        "incomes_by_category": incomes,
        "budgets": budget_list,
        "series": series,
        "category_filter": cats[category_id]["name"] if category_id in cats else None,
        "top_expenses": [
            {"id": r["id"], "date": r["date"], "label": r["label"], "amount_cents": r["amount_cents"],
             "account": r["account"], "category": r["category"], "color": r["color"]} for r in top
        ],
        "tx_count": len(cur),
        "uncategorized_count": sum(1 for r in cur if r["kind"] is None),
    }
