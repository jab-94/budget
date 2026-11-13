// « Serveur » local, dans le navigateur : répond aux mêmes demandes que l'API Python
// (/api/...), sur les données déchiffrées en mémoire. Rien ne part sur le réseau ici :
// seules les sauvegardes CHIFFRÉES passent par store.save() -> Firebase.

import { categorizeAll, previewRule, suggestPattern, validatePattern } from "./categorize.js";
import { coherence, dashboard, flagDuplicates, incomeAnalysis, insights, manualFingerprint } from "./analytics.js";
import { parseCsvStatement } from "./csvparse.js";
import { validDate } from "./core.js";
import { availableParsers, parsePdf } from "./pdfparse.js";
import { store } from "./store.js";

export class ApiError extends Error {
  constructor(status, detail) { super(detail); this.status = status; this.detail = detail; }
}
const fail = (status, detail) => { throw new ApiError(status, detail); };

const AUTO_LOCK_MS = 15 * 60 * 1000;
const ACCOUNT_KINDS = new Set(["courant", "joint", "epargne", "investissement"]);
const CATEGORY_KINDS = new Set(["expense", "income", "transfer"]);
const HINTS = new Set(["investissement", "dividende", "interets", "impot", "frais", "carte", "virement"]);
const MAX_UPLOAD = 20 * 1024 * 1024;

function D() {
  if (store.unlocked && Date.now() - store.lastActivity > AUTO_LOCK_MS) store.lock();
  if (!store.unlocked) fail(423, "Coffre verrouillé.");
  store.touch();
  return store.data;
}

async function save() {
  try {
    await store.save();
  } catch (e) {
    if (e.name === "Conflict" || /autre appareil/.test(e.message)) {
      fail(409, "Le coffre a été modifié sur un autre appareil. Verrouillez puis rouvrez pour récupérer la dernière version (vos dernières modifications ici ne sont pas enregistrées).");
    }
    throw e;
  }
}

const isoDate = (s) => {
  const m = String(s || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  try { if (m) return validDate(+m[1], +m[2], +m[3]); } catch (_) { /* invalide */ }
  return fail(400, "Date invalide.");
};
const monthOr400 = (m) => {
  if (!m) return null;
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(m.slice(0, 7))) fail(400, "Mois invalide.");
  return m.slice(0, 7);
};
const intOrNull = (v) => (v === null || v === undefined || v === "" ? null : Number(v));

function accountOr404(d, id) {
  if (!d.accounts.some((a) => a.id === id)) fail(404, "Compte introuvable.");
}

function checkRule(d, body) {
  let pattern;
  try { pattern = validatePattern(body.pattern, Boolean(body.is_regex)); } catch (e) { fail(400, e.message); }
  if (![null, undefined, "+", "-"].includes(body.sign)) fail(400, "Sens invalide.");
  if (!d.categories.some((c) => c.id === body.category_id)) fail(404, "Catégorie introuvable.");
  return pattern;
}

function checkCategory(body) {
  const name = String(body.name || "").trim();
  if (!name || name.length > 40) fail(400, "Nom de catégorie invalide.");
  const kind = body.kind || "expense";
  if (!CATEGORY_KINDS.has(kind)) fail(400, "Type de catégorie invalide.");
  const color = typeof body.color === "string" && /^#[0-9a-fA-F]{6}$/.test(body.color) ? body.color : null;
  return { name, kind, color };
}

function listTransactions(d, q) {
  const cats = new Map(d.categories.map((c) => [c.id, c]));
  const accs = new Map(d.accounts.map((a) => [a.id, a]));
  let rows = d.transactions;
  if (q.get("account_id")) rows = rows.filter((t) => t.account_id === Number(q.get("account_id")));
  if (q.get("month")) rows = rows.filter((t) => t.date.slice(0, 7) === q.get("month").slice(0, 7));
  const cat = q.get("category");
  if (cat === "none") rows = rows.filter((t) => t.category_id === null || t.category_id === undefined);
  else if (cat) rows = rows.filter((t) => t.category_id === Number(cat));
  const limit = Math.max(1, Math.min(Number(q.get("limit") || 500), 5000));
  return [...rows].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : b.id - a.id)).slice(0, limit).map((t) => {
    const c = cats.get(t.category_id);
    return { id: t.id, account_id: t.account_id, account: accs.get(t.account_id)?.name ?? "", date: t.date, label: t.label,
      amount_cents: t.amount_cents, hint: t.hint ?? null, category_source: t.category_source ?? null,
      category_locked: t.category_locked ? 1 : 0, category_id: t.category_id ?? null, category: c ? c.name : null,
      category_color: c ? c.color : null, statement_id: t.statement_id ?? null };
  });
}

/** Point d'entrée : (méthode, chemin avec paramètres, corps JSON ou fichier brut). */
export async function handle(method, fullPath, body, raw) {
  const [p, query = ""] = fullPath.split("?");
  const q = new URLSearchParams(query);
  const seg = p.split("/").filter(Boolean); // ["api", ...]
  const id = (i) => Number(seg[i]);

  // ---------- Comptes ----------
  if (p === "/api/accounts" && method === "GET") {
    const d = D();
    return [...d.accounts].sort((a, b) => a.name.localeCompare(b.name, "fr")).map((a) => {
      const txs = d.transactions.filter((t) => t.account_id === a.id).map((t) => t.date).sort();
      return { ...a, tx_count: txs.length, first_date: txs[0] || null, last_date: txs[txs.length - 1] || null };
    });
  }
  if (p === "/api/accounts" && method === "POST") {
    const d = D();
    const name = String(body.name || "").trim();
    if (!name || name.length > 60) fail(400, "Nom de compte invalide.");
    const kind = body.kind || "courant";
    if (!ACCOUNT_KINDS.has(kind)) fail(400, "Type de compte invalide.");
    const acc = { id: store.nextId(), name, bank: String(body.bank || "").trim() || null, kind };
    d.accounts.push(acc);
    await save();
    return { id: acc.id };
  }
  if (seg[1] === "accounts" && seg.length === 3 && method === "DELETE") {
    const d = D();
    const aid = id(2);
    d.accounts = d.accounts.filter((a) => a.id !== aid);
    d.transactions = d.transactions.filter((t) => t.account_id !== aid);
    d.statements = d.statements.filter((s) => s.account_id !== aid);
    await save();
    return { ok: true };
  }

  // ---------- Catégories ----------
  if (p === "/api/categories" && method === "GET") {
    const order = { expense: 0, income: 1, transfer: 2 };
    return [...D().categories].sort((a, b) => order[a.kind] - order[b.kind] || a.name.localeCompare(b.name, "fr"))
      .map(({ id: cid, name, kind, color }) => ({ id: cid, name, kind, color }));
  }
  if (p === "/api/categories/stats") {
    const d = D();
    const order = { expense: 0, income: 1, transfer: 2 };
    return {
      categories: [...d.categories].sort((a, b) => order[a.kind] - order[b.kind] || a.name.localeCompare(b.name, "fr")).map((c) => ({
        ...c, tx_count: d.transactions.filter((t) => t.category_id === c.id).length,
        rule_count: d.rules.filter((r) => r.category_id === c.id).length })),
      uncategorized: d.transactions.filter((t) => t.category_id === null || t.category_id === undefined).length,
    };
  }
  if (p === "/api/categories" && method === "POST") {
    const d = D();
    const c = checkCategory(body);
    if (d.categories.some((x) => x.name === c.name)) fail(409, "Une catégorie porte déjà ce nom.");
    const cat = { id: store.nextId(), ...c };
    d.categories.push(cat);
    await save();
    return { id: cat.id };
  }
  if (seg[1] === "categories" && seg.length === 3 && method === "PUT") {
    const d = D();
    const c = checkCategory(body);
    const cat = d.categories.find((x) => x.id === id(2));
    if (!cat) fail(404, "Catégorie introuvable.");
    if (d.categories.some((x) => x.name === c.name && x.id !== cat.id)) fail(409, "Une catégorie porte déjà ce nom.");
    Object.assign(cat, c);
    await save();
    return { ok: true };
  }
  if (seg[1] === "categories" && seg.length === 3 && method === "DELETE") {
    const d = D();
    const cid = id(2);
    for (const t of d.transactions) if (t.category_id === cid) { t.category_locked = 0; t.category_id = null; t.category_source = null; }
    d.categories = d.categories.filter((c) => c.id !== cid);
    d.rules = d.rules.filter((r) => r.category_id !== cid);
    delete d.budgets[cid];
    categorizeAll(d);
    await save();
    return { ok: true };
  }

  // ---------- Règles ----------
  if (p === "/api/rules" && method === "GET") {
    const d = D();
    const cats = new Map(d.categories.map((c) => [c.id, c]));
    return [...d.rules].filter((r) => cats.has(r.category_id))
      .sort((a, b) => (a.origin === "default") - (b.origin === "default") || a.priority - b.priority || b.id - a.id)
      .map((r) => ({ ...r, is_regex: r.is_regex ? 1 : 0, category: cats.get(r.category_id).name, category_color: cats.get(r.category_id).color }));
  }
  if (p === "/api/rules" && method === "POST") {
    const d = D();
    const pattern = checkRule(d, body);
    const rule = { id: store.nextId(), pattern, is_regex: Boolean(body.is_regex), category_id: body.category_id,
      priority: Math.max(1, Math.min(body.priority || 10, 99)), sign: body.sign ?? null, origin: "user" };
    d.rules.push(rule);
    const changed = categorizeAll(d);
    await save();
    return { id: rule.id, changed };
  }
  if (p === "/api/rules/preview") {
    const d = D();
    let pattern;
    try { pattern = validatePattern(body.pattern, Boolean(body.is_regex)); } catch (e) { fail(400, e.message); }
    return previewRule(d, pattern, Boolean(body.is_regex), body.sign ?? null);
  }
  if (p === "/api/rules/recategorize") {
    const d = D();
    const changed = categorizeAll(d);
    await save();
    return { changed };
  }
  if (seg[1] === "rules" && seg.length === 3 && method === "PUT") {
    const d = D();
    const pattern = checkRule(d, body);
    const r = d.rules.find((x) => x.id === id(2));
    if (!r) fail(404, "Règle introuvable.");
    Object.assign(r, { pattern, is_regex: Boolean(body.is_regex), category_id: body.category_id, sign: body.sign ?? null,
      origin: r.origin === "default" ? "user" : r.origin });
    const changed = categorizeAll(d);
    await save();
    return { ok: true, changed };
  }
  if (seg[1] === "rules" && seg.length === 3 && method === "DELETE") {
    const d = D();
    d.rules = d.rules.filter((r) => r.id !== id(2));
    const changed = categorizeAll(d);
    await save();
    return { ok: true, changed };
  }

  // ---------- Import ----------
  if (p === "/api/import/parsers") { D(); return availableParsers(); }
  if (p === "/api/import/preview") {
    const d = D();
    const accountId = Number(q.get("account_id"));
    accountOr404(d, accountId);
    if (!raw || !raw.byteLength) fail(400, "Fichier vide.");
    if (raw.byteLength > MAX_UPLOAD) fail(413, "Fichier trop volumineux (20 Mo maximum).");
    const bytes = new Uint8Array(raw);
    let st, info = {};
    try {
      if (q.get("fmt") === "pdf") st = await parsePdf(bytes, q.get("parser") || null);
      else if (q.get("fmt") === "csv") [st, info] = parseCsvStatement(bytes, q.get("mapping") ? JSON.parse(q.get("mapping")) : null);
      else fail(400, "Format inconnu.");
    } catch (e) {
      if (e instanceof ApiError) throw e;
      // Nos messages destinés à l'utilisateur commencent par une majuscule ; le reste est technique.
      if (e && e.message && /^[A-ZÀ-Ý]/.test(e.message) && !(e instanceof TypeError) && !(e instanceof SyntaxError)) fail(400, e.message);
      console.error("Import :", e);
      fail(400, "Fichier illisible.");
    }
    await flagDuplicates(d, accountId, st.transactions);
    st.coherence = coherence(st.opening_balance_cents, st.closing_balance_cents, st.transactions);
    st.csv = info;
    return st;
  }
  if (p === "/api/import/commit") {
    const d = D();
    accountOr404(d, body.account_id);
    if (!["pdf", "csv"].includes(body.source)) fail(400, "Source invalide.");
    const sid = store.nextId();
    d.statements.push({ id: sid, account_id: body.account_id, source: body.source, period_start: body.period_start ?? null,
      period_end: body.period_end ?? null, opening_balance_cents: body.opening_balance_cents ?? null,
      closing_balance_cents: body.closing_balance_cents ?? null, imported_at: new Date().toISOString() });
    const rows = body.transactions.map((t) => ({
      id: store.nextId(), account_id: body.account_id, statement_id: sid, date: isoDate(t.date),
      label: String(t.label || "").trim().slice(0, 300) || "(sans libellé)", amount_cents: Math.trunc(t.amount_cents),
      category_id: null, category_locked: 0, category_source: null, fingerprint: String(t.fingerprint || "").slice(0, 64),
      hint: HINTS.has(t.hint) ? t.hint : null,
    }));
    d.transactions.push(...rows);
    categorizeAll(d);
    await save();
    return { ok: true, statement_id: sid, inserted: rows.length };
  }

  // ---------- Opérations ----------
  if (p === "/api/transactions" && method === "GET") return listTransactions(D(), q);
  if (p === "/api/transactions" && method === "POST") {
    const d = D();
    accountOr404(d, body.account_id);
    const label = String(body.label || "").trim().slice(0, 300);
    if (!label) fail(400, "Libellé obligatoire.");
    const iso = isoDate(body.date);
    const cents = Math.trunc(body.amount_cents);
    const fp = await manualFingerprint(d, body.account_id, iso, cents, label);
    const t = { id: store.nextId(), account_id: body.account_id, statement_id: null, date: iso, label, amount_cents: cents,
      category_id: null, category_locked: 0, category_source: null, fingerprint: fp, hint: null };
    d.transactions.push(t);
    categorizeAll(d);
    await save();
    return { id: t.id };
  }
  if (seg[1] === "transactions" && seg.length === 3 && method === "DELETE") {
    const d = D();
    d.transactions = d.transactions.filter((t) => t.id !== id(2));
    await save();
    return { ok: true };
  }
  if (seg[1] === "transactions" && seg[3] === "suggest") {
    const t = D().transactions.find((x) => x.id === id(2));
    if (!t) fail(404, "Opération introuvable.");
    return { pattern: suggestPattern(t.label) };
  }
  if (seg[1] === "transactions" && seg[3] === "category") {
    const d = D();
    const t = d.transactions.find((x) => x.id === id(2));
    if (!t) fail(404, "Opération introuvable.");
    const cid = body.category_id ?? null;
    if (cid !== null && !d.categories.some((c) => c.id === cid)) fail(404, "Catégorie introuvable.");
    if (body.rule_pattern && cid !== null) {
      const pattern = checkRule(d, { pattern: body.rule_pattern, is_regex: body.rule_is_regex, category_id: cid, sign: body.rule_sign ?? null });
      d.rules.push({ id: store.nextId(), pattern, is_regex: Boolean(body.rule_is_regex), category_id: cid, priority: 10,
        sign: body.rule_sign ?? null, origin: "correction" });
    }
    Object.assign(t, { category_id: cid, category_locked: 1, category_source: "manuel" });
    const changed = categorizeAll(d);
    await save();
    return { ok: true, changed };
  }
  if (seg[1] === "transactions" && seg[3] === "auto") {
    const d = D();
    const t = d.transactions.find((x) => x.id === id(2));
    if (t) t.category_locked = 0;
    categorizeAll(d);
    await save();
    return { ok: true };
  }

  // ---------- Tableau de bord, budgets, revenus, suggestions ----------
  if (p === "/api/dashboard") {
    return dashboard(D(), monthOr400(q.get("month")), Math.max(3, Math.min(Number(q.get("months") || 12), 36)),
      intOrNull(q.get("account_id")), intOrNull(q.get("category_id")));
  }
  if (p === "/api/budgets" && method === "GET") {
    const d = D();
    return d.categories.filter((c) => c.kind === "expense").sort((a, b) => a.name.localeCompare(b.name, "fr"))
      .map((c) => ({ category_id: c.id, name: c.name, color: c.color, monthly_limit_cents: d.budgets[c.id] ?? null }));
  }
  if (seg[1] === "budgets" && seg.length === 3 && method === "PUT") {
    const d = D();
    const c = d.categories.find((x) => x.id === id(2));
    if (!c) fail(404, "Catégorie introuvable.");
    if (c.kind !== "expense") fail(400, "Un budget ne s'applique qu'à une catégorie de dépense.");
    if (!body.monthly_limit_cents || body.monthly_limit_cents <= 0) delete d.budgets[c.id];
    else d.budgets[c.id] = Math.trunc(body.monthly_limit_cents);
    await save();
    return { ok: true };
  }
  if (p === "/api/income" && method === "GET") {
    const d = D();
    const out = incomeAnalysis(d, monthOr400(q.get("month")), Math.max(6, Math.min(Number(q.get("months") || 12), 36)));
    out.income_categories = d.categories.filter((c) => c.kind === "income").sort((a, b) => a.name.localeCompare(b.name, "fr"))
      .map(({ id: cid, name, color }) => ({ id: cid, name, color }));
    out.budgets_total_cents = Object.values(d.budgets).reduce((a, b) => a + b, 0);
    return out;
  }
  if (p === "/api/income/categories") {
    const d = D();
    const valid = new Set(d.categories.filter((c) => c.kind === "income").map((c) => c.id));
    if (!body.category_ids.every((x) => valid.has(x))) fail(400, "Seules des catégories de revenus peuvent être suivies.");
    d.settings.irregular_income_categories = [...new Set(body.category_ids)].sort((a, b) => a - b);
    await save();
    return { ok: true };
  }
  if (p === "/api/insights" && method === "GET") return insights(D(), monthOr400(q.get("month")), intOrNull(q.get("account_id")));
  if (p === "/api/insights/dismiss" && method === "POST") {
    const d = D();
    if (!body.id || body.id.length > 200) fail(400, "Identifiant invalide.");
    d.settings.dismissed_insights = [...new Set([...(d.settings.dismissed_insights || []), body.id])].sort();
    await save();
    return { ok: true };
  }
  if (p === "/api/insights/dismiss" && method === "DELETE") {
    D().settings.dismissed_insights = [];
    await save();
    return { ok: true };
  }

  // ---------- Zone sensible ----------
  if (p === "/api/data/wipe") {
    D();
    const { newData } = await import("./store.js");
    store.data = newData();
    await save();
    return { ok: true };
  }

  fail(404, "Action inconnue.");
}

// ---------- Exports (fichiers produits dans le navigateur) ----------
export async function exportBackup() {
  D();
  return { name: `budget-sauvegarde-${new Date().toISOString().slice(0, 10)}.json`, type: "application/json",
    content: await store.exportBackup() };
}

export function exportCsv() {
  const d = D();
  const cats = new Map(d.categories.map((c) => [c.id, c.name]));
  const accs = new Map(d.accounts.map((a) => [a.id, a.name]));
  const esc = (v) => (/[";\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  const lines = ["date;compte;libelle;montant;categorie;nature"];
  for (const t of [...d.transactions].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.id - b.id))) {
    const c = Math.abs(t.amount_cents);
    const amount = `${t.amount_cents < 0 ? "-" : ""}${Math.floor(c / 100)},${String(c % 100).padStart(2, "0")}`;
    lines.push([t.date, accs.get(t.account_id) || "", t.label, amount, cats.get(t.category_id) || "", t.hint || ""].map((v) => esc(String(v))).join(";"));
  }
  return { name: `budget-operations-${new Date().toISOString().slice(0, 10)}.csv`, type: "text/csv;charset=utf-8",
    content: "﻿" + lines.join("\r\n") + "\r\n" };
}
