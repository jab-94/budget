// Doublons, tableau de bord, suggestions d'économies, salaire variable.
// Portage de app/dedup.py, dashboard.py, insights.py et income.py (mêmes règles, mêmes seuils).

import { addDays, daysBetween, formatCents, lastDayOfMonth, monthAdd, normalizeLabel, sha256Hex, todayIso } from "./core.js";
import { NOISE_WORDS } from "./defaults.js";

/** Arrondi « au pair » comme round() de Python (2,5 -> 2 ; 3,5 -> 4). */
export function pyRound(x) {
  const f = Math.floor(x), diff = x - f;
  if (Math.abs(diff - 0.5) < 1e-9) return f % 2 === 0 ? f : f + 1;
  return Math.round(x);
}
export function median(values) {
  const v = [...values].sort((a, b) => a - b);
  const n = v.length;
  return n % 2 ? v[(n - 1) / 2] : (v[n / 2 - 1] + v[n / 2]) / 2;
}
export const titleCase = (s) => s.toLowerCase().replace(/(^|[^\p{L}])(\p{L})/gu, (_, a, b) => a + b.toUpperCase());
const eur = formatCents;
const fr = (iso) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;

/** Opérations enrichies du compte et de la catégorie (équivalent des jointures SQL). */
export function enrich(data, accountId = null) {
  const cats = new Map(data.categories.map((c) => [c.id, c]));
  const accs = new Map(data.accounts.map((a) => [a.id, a]));
  return data.transactions
    .filter((t) => accountId === null || t.account_id === accountId)
    .map((t) => {
      const c = cats.get(t.category_id);
      return { ...t, account: accs.get(t.account_id)?.name ?? "", category: c ? c.name : null, kind: c ? c.kind : null,
        color: c ? c.color : null };
    });
}

// ================= Doublons et cohérence =================
const baseKey = (accountId, d, cents, label) => `${accountId}|${d}|${cents}|${normalizeLabel(label)}`;

export async function fingerprints(accountId, txs) {
  const seen = new Map();
  const out = [];
  for (const t of txs) {
    const k = baseKey(accountId, t.date, t.amount_cents, t.label);
    seen.set(k, (seen.get(k) || 0) + 1);
    out.push((await sha256Hex(`${k}|${seen.get(k)}`)).slice(0, 24));
  }
  return out;
}

export async function manualFingerprint(data, accountId, d, cents, label) {
  const key = baseKey(accountId, d, cents, label);
  const rank = 1 + data.transactions.filter((t) => t.account_id === accountId && t.date === d && t.amount_cents === cents
    && baseKey(accountId, t.date, t.amount_cents, t.label) === key).length;
  return (await sha256Hex(`${key}|${rank}`)).slice(0, 24);
}

const tokens = (label) => new Set(normalizeLabel(label).split(" ").filter((w) => w.length > 2));
export function labelSimilarity(a, b) {
  const ta = tokens(a), tb = tokens(b);
  if (!ta.size || !tb.size) return 0;
  let inter = 0;
  for (const w of ta) if (tb.has(w)) inter++;
  return inter / Math.min(ta.size, tb.size);
}

/**
 * Marque les doublons : « exact » (même empreinte) ou « probable » (même montant, ±3 jours, libellé proche).
 * batch : opérations des fichiers PRÉCÉDENTS du même lot d'import (même mois sélectionné deux fois…).
 */
export async function flagDuplicates(data, accountId, txs, batch = []) {
  const fps = await fingerprints(accountId, txs);
  const known = [...data.transactions.filter((t) => t.account_id === accountId), ...batch];
  const existing = new Set(known.map((t) => t.fingerprint));
  txs.forEach((t, i) => { t.fingerprint = fps[i]; t.duplicate = existing.has(fps[i]) ? "exact" : null; });
  const pending = txs.filter((t) => t.duplicate === null);
  if (pending.length) {
    const dates = pending.map((t) => t.date).sort();
    const lo = addDays(dates[0], -3), hi = addDays(dates[dates.length - 1], 3);
    const rows = known.filter((t) => t.date >= lo && t.date <= hi);
    for (const t of pending) {
      for (const r of rows) {
        if (r.amount_cents === t.amount_cents && Math.abs(daysBetween(r.date, t.date)) <= 3 && labelSimilarity(r.label, t.label) >= 0.5) {
          t.duplicate = "probable";
          break;
        }
      }
    }
  }
  for (const t of txs) t.selected = t.duplicate === null;
}

export function coherence(opening, closing, txs) {
  const total = txs.reduce((s, t) => s + t.amount_cents, 0);
  if (opening === null || opening === undefined || closing === null || closing === undefined) return { status: "unknown", sum_cents: total };
  const diff = opening + total - closing;
  return { status: diff === 0 ? "ok" : "mismatch", sum_cents: total, diff_cents: diff };
}

// ================= Tableau de bord =================
export const BUDGET_WARN = 0.8;

export function monthsWithData(data, accountId = null) {
  return [...new Set(data.transactions.filter((t) => accountId === null || t.account_id === accountId).map((t) => t.date.slice(0, 7)))].sort();
}

/** [dépenses par catégorie, revenus par catégorie, non classé sortant, non classé entrant]. */
export function split(rows) {
  const exp = new Map(), inc = new Map();
  let uncOut = 0, uncIn = 0;
  for (const r of rows) {
    if (r.kind === "transfer") continue;
    if (r.kind === null) { if (r.amount_cents < 0) uncOut += -r.amount_cents; else uncIn += r.amount_cents; }
    else if (r.kind === "expense") exp.set(r.category_id, (exp.get(r.category_id) || 0) - r.amount_cents);
    else inc.set(r.category_id, (inc.get(r.category_id) || 0) + r.amount_cents);
  }
  return [exp, inc, uncOut, uncIn];
}
const sumMap = (m) => [...m.values()].reduce((a, b) => a + b, 0);

function totals(rows) {
  const [exp, inc, uncOut, uncIn] = split(rows);
  const income = sumMap(inc) + uncIn, expenses = sumMap(exp) + uncOut;
  return { income_cents: income, expense_cents: expenses, net_cents: income - expenses };
}

export function dashboard(data, month, monthsBack = 12, accountId = null, categoryId = null) {
  const available = monthsWithData(data, accountId);
  if (!month) month = available.length ? available[available.length - 1] : todayIso().slice(0, 7);
  const cats = new Map(data.categories.map((c) => [c.id, c]));
  const budgets = new Map(Object.entries(data.budgets).map(([k, v]) => [Number(k), v]));
  const first = monthAdd(month, -(monthsBack - 1));
  const lo = first < monthAdd(month, -3) ? first : monthAdd(month, -3);
  const rows = enrich(data, accountId).filter((r) => r.date.slice(0, 7) >= lo && r.date.slice(0, 7) <= month);
  const byMonth = new Map();
  for (const r of rows) { const m = r.date.slice(0, 7); if (!byMonth.has(m)) byMonth.set(m, []); byMonth.get(m).push(r); }

  const cur = byMonth.get(month) || [];
  const [exp, inc, uncOut, uncIn] = split(cur);
  const tot = totals(cur);
  const prev = totals(byMonth.get(monthAdd(month, -1)) || []);

  const prev3 = [1, 2, 3].map((i) => monthAdd(month, -i)).filter((m) => byMonth.has(m));
  const avg3 = new Map();
  for (const m of prev3) for (const [k, v] of split(byMonth.get(m))[0]) avg3.set(k, (avg3.get(k) || 0) + v);
  for (const [k, v] of avg3) avg3.set(k, pyRound(v / prev3.length));

  const budgetInfo = (cid, spent) => {
    const limit = budgets.get(cid);
    if (!limit) return { budget_cents: null, budget_pct: null, budget_status: null };
    const pct = spent / limit;
    return { budget_cents: limit, budget_pct: Math.round(pct * 1000) / 10, budget_status: pct > 1 ? "over" : pct >= BUDGET_WARN ? "warn" : "ok" };
  };

  const expenses = [...exp].filter(([, v]) => v > 0).map(([cid, v]) => ({ category_id: cid, name: cats.get(cid).name,
    color: cats.get(cid).color, amount_cents: v, avg3_cents: avg3.get(cid) ?? null, ...budgetInfo(cid, v) }));
  if (uncOut) expenses.push({ category_id: null, name: "À classer", color: null, amount_cents: uncOut, avg3_cents: null,
    budget_cents: null, budget_pct: null, budget_status: null });
  expenses.sort((a, b) => b.amount_cents - a.amount_cents);

  const incomes = [...inc].filter(([, v]) => v > 0).map(([cid, v]) => ({ category_id: cid, name: cats.get(cid).name,
    color: cats.get(cid).color, amount_cents: v }));
  if (uncIn) incomes.push({ category_id: null, name: "À classer", color: null, amount_cents: uncIn });
  incomes.sort((a, b) => b.amount_cents - a.amount_cents);

  const budgetList = [...budgets.keys()].filter((cid) => cats.has(cid)).map((cid) => ({ category_id: cid,
    name: cats.get(cid).name, color: cats.get(cid).color, spent_cents: exp.get(cid) || 0, ...budgetInfo(cid, exp.get(cid) || 0) }));
  budgetList.sort((a, b) => (b.budget_pct || 0) - (a.budget_pct || 0));

  const series = [];
  for (let i = monthsBack - 1; i >= 0; i--) {
    const m = monthAdd(month, -i);
    const mrows = byMonth.get(m) || [];
    const point = { month: m, ...totals(mrows), has_data: mrows.length > 0 };
    if (categoryId !== null) point.category_cents = Math.abs(mrows.filter((r) => r.category_id === categoryId).reduce((s, r) => s + r.amount_cents, 0));
    series.push(point);
  }
  const top = cur.filter((r) => r.amount_cents < 0 && r.kind !== "transfer").sort((a, b) => a.amount_cents - b.amount_cents).slice(0, 5);
  return {
    month, months_available: available, totals: tot, previous: prev,
    savings_rate: tot.income_cents > 0 ? Math.round((tot.net_cents / tot.income_cents) * 1000) / 10 : null,
    expenses_by_category: expenses, incomes_by_category: incomes, budgets: budgetList, series,
    category_filter: cats.has(categoryId) ? cats.get(categoryId).name : null,
    top_expenses: top.map((r) => ({ id: r.id, date: r.date, label: r.label, amount_cents: r.amount_cents, account: r.account,
      category: r.category, color: r.color })),
    tx_count: cur.length, uncategorized_count: cur.filter((r) => r.kind === null).length,
  };
}

// ================= Salaire variable =================
const WINDOW = 6, SHORT_WINDOW = 3, PRUDENCE = 0.2, QUANTILE = 0.25, MIN_MONTHS = 3;

export function quantile(values, q) {
  const v = [...values].sort((a, b) => a - b);
  if (!v.length) return 0;
  const pos = (v.length - 1) * q, lo = Math.floor(pos), hi = Math.min(lo + 1, v.length - 1);
  return v[lo] + (v[hi] - v[lo]) * (pos - lo);
}

export function trackedCategories(data) {
  const incomeIds = new Set(data.categories.filter((c) => c.kind === "income").map((c) => c.id));
  let ids = data.settings.irregular_income_categories;
  if (!Array.isArray(ids)) { const s = data.categories.find((c) => c.name === "Salaire"); ids = s ? [s.id] : []; }
  return ids.filter((i) => incomeIds.has(i));
}

export function incomeAnalysis(data, month, monthsBack = 12) {
  const cats = trackedCategories(data);
  const dataMonths = monthsWithData(data);
  if (!month) month = dataMonths.length ? dataMonths[dataMonths.length - 1] : null;
  const names = data.categories.filter((c) => cats.includes(c.id)).map((c) => c.name).sort();
  const base = { month, categories: cats, category_names: names };
  if (!month || !cats.length) return { ...base, series: [], reference: null, enough_history: false, history_months: 0 };
  const perMonth = new Map();
  for (const t of data.transactions) {
    if (!cats.includes(t.category_id)) continue;
    const m = t.date.slice(0, 7);
    perMonth.set(m, (perMonth.get(m) || 0) + t.amount_cents);
  }
  for (const [m, v] of perMonth) perMonth.set(m, Math.max(0, v));
  const has = new Set(dataMonths);
  const history = dataMonths.filter((m) => m < month).slice(-WINDOW);
  const values = history.map((m) => perMonth.get(m) || 0);
  const short = values.slice(-SHORT_WINDOW);
  let reference = null;
  if (values.length) {
    const avg6 = values.reduce((a, b) => a + b, 0) / values.length;
    const avg3 = short.reduce((a, b) => a + b, 0) / short.length;
    const q25 = quantile(values, QUANTILE);
    const prudent = Math.min(avg6 * (1 - PRUDENCE), q25);
    reference = {
      avg3_cents: pyRound(avg3), avg6_cents: pyRound(avg6), min_cents: Math.min(...values), max_cents: Math.max(...values),
      q25_cents: pyRound(q25), avg6_minus_20_cents: pyRound(avg6 * (1 - PRUDENCE)), prudent_cents: pyRound(prudent),
      prudent_rule: q25 < avg6 * (1 - PRUDENCE) ? "quartile" : "moyenne-20", months: history,
      variability_pct: avg6 ? pyRound((values.reduce((s, v) => s + Math.abs(v - avg6), 0) / values.length / avg6) * 100) : null,
    };
  }
  const series = [];
  for (let i = monthsBack - 1; i >= 0; i--) {
    const m = monthAdd(month, -i);
    series.push({ month: m, amount_cents: perMonth.get(m) || 0, has_data: has.has(m) });
  }
  const current = perMonth.get(month) || 0;
  return { ...base, series, reference, current_cents: current, current_received: current > 0,
    history_months: history.length, enough_history: history.length >= MIN_MONTHS };
}

// ================= Suggestions d'économies =================
const CADENCES = [["hebdomadaire", 7, 2, 52 / 12], ["mensuel", 30.44, 5, 1], ["trimestriel", 91.3, 12, 1 / 3], ["annuel", 365.25, 25, 1 / 12]];
const MIN_OCC = { hebdomadaire: 4, mensuel: 3, trimestriel: 2, annuel: 2 };
const FIXED_SPREAD = 0.02, STABLE_SPREAD = 0.15, VARIABLE_SPREAD = 0.6;
const PRICE_CHANGE_MIN = 0.03, PRICE_CHANGE_MIN_CENTS = 50;
const INCREASE_PCT = 0.2, INCREASE_MIN_CENTS = 3000, DUPLICATE_MIN_CENTS = 1000, DUPLICATE_MAX_DAYS = 2;
const NOT_SUBSCRIPTIONS = new Set(["Logement", "Impôts", "Santé", "Frais bancaires", "Transports"]);
const factor = (cadence) => CADENCES.find((c) => c[0] === cadence)[3];

export function merchantKey(label) {
  return normalizeLabel(label).split(" ").filter((w) => w && !NOISE_WORDS.has(w) && !/\d/.test(w)).slice(0, 3).join(" ");
}
function isCard(label) {
  const w = normalizeLabel(label).split(" ").slice(0, 2);
  return Boolean(w[0]) && (w[0] === "CB" || w[0] === "CARTE" || w.includes("CARTE"));
}
function addPeriod(iso, cadence, days) {
  if (cadence === "mensuel") {
    let y = Number(iso.slice(0, 4)), m = Number(iso.slice(5, 7)) + 1;
    if (m === 13) { m = 1; y++; }
    const d = Math.min(Number(iso.slice(8, 10)), lastDayOfMonth(y, m));
    return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  }
  return addDays(iso, Math.round(days));
}

export function detectRecurring(rows, lastDate) {
  const groups = new Map();
  for (const r of rows) {
    if (r.kind === "transfer") continue;
    const key = merchantKey(r.label);
    if (!key) continue;
    const g = `${r.account_id}\u0000${key}\u0000${r.amount_cents < 0}`;
    if (!groups.has(g)) groups.set(g, { key, isExpense: r.amount_cents < 0, items: [] });
    groups.get(g).items.push(r);
  }
  const found = [];
  for (const { key, isExpense, items } of groups.values()) {
    const byDay = new Map();
    for (const r of items) { if (!byDay.has(r.date)) byDay.set(r.date, []); byDay.get(r.date).push(r); }
    if (byDay.size < 2) continue;
    const days = [...byDay.keys()].sort();
    const amounts = days.map((d) => Math.abs(byDay.get(d).reduce((s, r) => s + r.amount_cents, 0)));
    const gaps = days.slice(1).map((d, i) => daysBetween(days[i], d));
    const medGap = median(gaps);
    const cadence = CADENCES.find((c) => Math.abs(medGap - c[1]) <= c[2]);
    if (!cadence) continue;
    const [name, period, tol, monthlyFactor] = cadence;
    if (days.length < MIN_OCC[name]) continue;
    if (gaps.filter((g) => Math.abs(g - period) <= tol).length / gaps.length < 0.7) continue;
    const history = amounts.slice(0, -1).slice(-6).length ? amounts.slice(0, -1).slice(-6) : amounts;
    const medAmount = median(history);
    if (medAmount <= 0) continue;
    const spread = Math.max(...history.map((a) => Math.abs(a - medAmount))) / medAmount;
    const card = isCard(items[items.length - 1].label);
    if (spread > (card ? STABLE_SPREAD : VARIABLE_SPREAD)) continue;
    if ((name === "trimestriel" || name === "annuel") && spread > 0.05) continue;
    const last = days[days.length - 1];
    const active = daysBetween(last, lastDate) <= period * 1.5 + tol;
    const prev = amounts.slice(0, -1).slice(-6);
    const prevMed = prev.length ? median(prev) : amounts[amounts.length - 1];
    const change = amounts[amounts.length - 1] - prevMed;
    const priceChange = prev.length && spread <= FIXED_SPREAD
      && Math.abs(change) >= Math.max(PRICE_CHANGE_MIN * prevMed, PRICE_CHANGE_MIN_CENTS) ? change : 0;
    const sample = items[items.length - 1];
    const typical = amounts[amounts.length - 1];
    found.push({
      key, label: sample.label, account: sample.account, account_id: sample.account_id, category: sample.category,
      color: sample.color, is_expense: isExpense, cadence: name, occurrences: days.length, first_date: days[0],
      last_date: last, next_date: addPeriod(last, name, period), active, amount_cents: typical,
      variable: spread > STABLE_SPREAD, monthly_cents: pyRound(typical * monthlyFactor),
      yearly_cents: pyRound(typical * monthlyFactor * 12), price_change_cents: priceChange, previous_amount_cents: prevMed,
      is_subscription: isExpense && (sample.category === "Abonnements"
        || (spread <= FIXED_SPREAD && name !== "hebdomadaire" && !NOT_SUBSCRIPTIONS.has(sample.category))),
    });
  }
  found.sort((a, b) => b.monthly_cents - a.monthly_cents);
  return found;
}

function categoryIncreases(rows, month) {
  const byMonth = new Map();
  for (const r of rows) { const m = r.date.slice(0, 7); if (!byMonth.has(m)) byMonth.set(m, []); byMonth.get(m).push(r); }
  if (!byMonth.has(month)) return [];
  const prev = [1, 2, 3].map((i) => monthAdd(month, -i)).filter((m) => byMonth.has(m));
  if (prev.length < 2) return [];
  const cur = split(byMonth.get(month))[0];
  const sums = new Map();
  for (const m of prev) for (const [k, v] of split(byMonth.get(m))[0]) sums.set(k, (sums.get(k) || 0) + v);
  const names = new Map(rows.filter((r) => r.category_id).map((r) => [r.category_id, [r.category, r.color]]));
  const out = [];
  for (const [cid, amount] of cur) {
    const avg = pyRound((sums.get(cid) || 0) / prev.length);
    const diff = amount - avg;
    if (diff >= INCREASE_MIN_CENTS && (avg === 0 || diff / avg >= INCREASE_PCT)) {
      out.push({ category_id: cid, category: names.get(cid)[0], color: names.get(cid)[1], amount_cents: amount,
        average_cents: avg, diff_cents: diff, pct: avg ? pyRound((diff / avg) * 100) : null, months: prev.length });
    }
  }
  return out.sort((a, b) => b.diff_cents - a.diff_cents);
}

function bankFees(rows, lastDate) {
  const since = addDays(lastDate, -365);
  const fees = rows.filter((r) => r.category === "Frais bancaires" && r.date > since);
  const total = -fees.reduce((s, r) => s + r.amount_cents, 0);
  const byLabel = new Map();
  for (const r of fees) { const k = merchantKey(r.label) || r.label; byLabel.set(k, (byLabel.get(k) || 0) - r.amount_cents); }
  const first = rows.length ? rows.map((r) => r.date).sort()[0] : null;
  const months = first === null || first <= since ? 12 : Math.max(1, pyRound(daysBetween(first, lastDate) / 30.44));
  return { total_cents: total, months, count: fees.length,
    by_label: [...byLabel].map(([label, amount_cents]) => ({ label, amount_cents })).sort((a, b) => b.amount_cents - a.amount_cents) };
}

function suspectedDuplicates(rows, recurringKeys) {
  const groups = new Map();
  for (const r of rows) {
    if (r.amount_cents > -DUPLICATE_MIN_CENTS || r.kind === "transfer") continue;
    const k = `${r.account_id}|${r.amount_cents}|${normalizeLabel(r.label)}`;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(r);
  }
  const out = [];
  for (const items of groups.values()) {
    items.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
    for (let i = 1; i < items.length; i++) {
      const a = items[i - 1], b = items[i];
      if (daysBetween(a.date, b.date) <= DUPLICATE_MAX_DAYS && !recurringKeys.has(`${a.account_id}|${merchantKey(a.label)}`)) {
        out.push({ id: `dup:${a.id}-${b.id}`, ids: [a.id, b.id], label: a.label, amount_cents: a.amount_cents,
          dates: [a.date, b.date], account: a.account });
      }
    }
  }
  return out;
}

function remainingToLive(rows, recurring, month, lastDate, salary) {
  if (lastDate.slice(0, 7) !== month) return null;
  const y = Number(month.slice(0, 4)), m = Number(month.slice(5, 7));
  const monthEnd = `${month}-${String(lastDayOfMonth(y, m)).padStart(2, "0")}`;
  const [exp, inc, uncOut, uncIn] = split(rows.filter((r) => r.date.startsWith(month)));
  const income = sumMap(inc) + uncIn, spent = sumMap(exp) + uncOut;
  let upcoming = recurring.filter((x) => x.active && x.next_date > lastDate && x.next_date <= monthEnd);
  let expectedSalary = 0;
  const tracked = new Set(salary ? salary.category_names : []);
  if (salary && salary.reference && salary.enough_history && !salary.current_received) {
    expectedSalary = salary.reference.prudent_cents;
    upcoming = upcoming.filter((x) => x.is_expense || !tracked.has(x.category));
  }
  const upExp = upcoming.filter((x) => x.is_expense).reduce((s, x) => s + x.amount_cents, 0);
  const upInc = upcoming.filter((x) => !x.is_expense).reduce((s, x) => s + x.amount_cents, 0) + expectedSalary;
  const remaining = income + upInc - spent - upExp;
  const daysLeft = daysBetween(lastDate, monthEnd);
  return { as_of: lastDate, month_end: monthEnd, days_left: daysLeft, income_cents: income, spent_cents: spent,
    upcoming_expense_cents: upExp, upcoming_income_cents: upInc, expected_salary_cents: expectedSalary,
    remaining_cents: remaining, per_day_cents: daysLeft > 0 && remaining > 0 ? pyRound(remaining / daysLeft) : null, upcoming };
}

export function insights(data, month, accountId = null) {
  const rows = enrich(data, accountId).sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  const hidden = new Set(data.settings.dismissed_insights || []);
  if (!rows.length) return { month, recurring: [], suggestions: [], upcoming: [], remaining: null, fees: null, duplicates: [], dismissed_count: 0 };
  const lastDate = rows[rows.length - 1].date;
  month = month || lastDate.slice(0, 7);
  const recurring = detectRecurring(rows, lastDate);
  const active = recurring.filter((x) => x.active);
  const subs = active.filter((x) => x.is_subscription);
  const increases = categoryIncreases(rows, month);
  const fees = bankFees(rows, lastDate);
  const dups = suspectedDuplicates(rows, new Set(recurring.map((x) => `${x.account_id}|${x.key}`)));
  const salary = accountId === null ? incomeAnalysis(data, month) : null;
  const remaining = remainingToLive(rows, recurring, month, lastDate, salary);
  const horizon = addDays(lastDate, 31);
  const upcoming = active.filter((x) => x.next_date <= horizon).sort((a, b) => (a.next_date < b.next_date ? -1 : a.next_date > b.next_date ? 1 : 0));

  const s = [];
  const add = (id, kind, severity, title, detail, saving = null, extra = {}) => {
    if (!hidden.has(id)) s.push({ id, kind, severity, title, detail, yearly_saving_cents: saving, ...extra });
  };
  for (const x of active) {
    if (x.is_expense && x.price_change_cents > 0) {
      const yearly = pyRound(x.price_change_cents * 12 * factor(x.cadence));
      add(`price:${x.account_id}:${x.key}:${x.last_date}`, "hausse-prix", "warn", `${titleCase(x.key)} : le prix a augmenté`,
        `${eur(Math.round(x.previous_amount_cents))} → ${eur(x.amount_cents)} par échéance (${x.cadence}), soit ${eur(yearly)} de plus par an.`,
        yearly, { recurring_key: x.key });
    }
  }
  if (subs.length) {
    const total = subs.reduce((a, x) => a + x.yearly_cents, 0);
    add(`subs:${subs.length}:${total}`, "abonnements", "info", `${subs.length} abonnement(s) actif(s) : ${eur(total)} par an`,
      "Passez-les en revue : chacun résilié est une économie sur toute l'année.", null,
      { items: subs.map((x) => ({ label: titleCase(x.key), yearly_cents: x.yearly_cents, amount_cents: x.amount_cents, cadence: x.cadence })) });
  }
  const stoppedSince = addDays(lastDate, -200);
  for (const x of recurring) {
    if (!x.active && x.is_expense && x.last_date >= stoppedSince) {
      add(`stopped:${x.account_id}:${x.key}:${x.last_date}`, "arrete", "info", `${titleCase(x.key)} semble arrêté`,
        `Dernier prélèvement le ${fr(x.last_date)}. Si c'est voulu, rien à faire ; sinon, vérifiez votre moyen de paiement.`);
    }
  }
  for (const inc of increases) {
    const pct = inc.pct !== null ? `+${inc.pct} %` : "nouvelle dépense";
    add(`incr:${month}:${inc.category_id}`, "hausse-categorie", "warn", `${inc.category} en hausse ce mois-ci (${pct})`,
      `${eur(inc.amount_cents)} contre ${eur(inc.average_cents)} en moyenne sur les ${inc.months} mois précédents (+${eur(inc.diff_cents)}).`,
      null, { category_id: inc.category_id });
  }
  if (fees.total_cents > 0) {
    add(`fees:${fees.total_cents}`, "frais", fees.total_cents >= 6000 ? "warn" : "info",
      `${eur(fees.total_cents)} de frais bancaires sur ${fees.months} mois`,
      `Détail : ${fees.by_label.slice(0, 4).map((f) => `${titleCase(f.label)} ${eur(f.amount_cents)}`).join(", ")}. Une offre sans frais ou une renégociation peut les supprimer.`,
      fees.months >= 12 ? fees.total_cents : pyRound((fees.total_cents * 12) / fees.months));
  }
  for (const d of dups) {
    add(d.id, "doublon", "bad", `Doublon possible : ${d.label}`,
      `${eur(-d.amount_cents)} débité deux fois (${fr(d.dates[0])} et ${fr(d.dates[1])}, ${d.account}). Si c'est une erreur, contactez la banque ou le commerçant.`,
      null, { ids: d.ids });
  }
  if (remaining && remaining.remaining_cents < 0) {
    add(`remaining:${month}`, "reste-a-vivre", "bad", "Reste à vivre négatif d'ici la fin du mois",
      `Après les prélèvements attendus, il manquerait ${eur(-remaining.remaining_cents)}.`);
  }
  const order = { bad: 0, warn: 1, info: 2 };
  s.sort((a, b) => order[a.severity] - order[b.severity] || (b.yearly_saving_cents || 0) - (a.yearly_saving_cents || 0));
  return { month, as_of: lastDate, recurring, upcoming, remaining, fees, duplicates: dups, suggestions: s,
    dismissed_count: hidden.size, subscriptions_yearly_cents: subs.reduce((a, x) => a + x.yearly_cents, 0) };
}
