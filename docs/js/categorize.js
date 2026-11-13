// Catégorisation par règles locales (portage de app/categorize.py).
//
// Ordre de décision pour une opération NON classée à la main :
//  1. règles de l'utilisateur (priorité, puis la plus récente) ;
//  2. virement entre deux comptes de l'utilisateur -> « Virements internes » ;
//  3. nature fournie par la source (Trade Republic) ;
//  4. règles par défaut, la plus précise (motif le plus long) d'abord.

import { daysBetween, normalizeLabel } from "./core.js";
import { HINT_CATEGORY, NOISE_WORDS } from "./defaults.js";

const TRANSFER_WORDS = /\b(VIR|VIREMENT|TRANSFER|TRANSFERT|INPAYMENT|PAYOUT)\b/;

export function prepareRule(r) {
  const rule = { ...r, norm: "", re: null };
  if (r.is_regex) {
    try { rule.re = new RegExp(r.pattern, "i"); } catch (_) { return null; }
  } else {
    rule.norm = normalizeLabel(r.pattern);
  }
  return rule;
}

export function ruleMatches(rule, label, normPadded, amount) {
  if ((rule.sign === "+" && amount < 0) || (rule.sign === "-" && amount > 0)) return false;
  if (rule.is_regex) return Boolean(rule.re && rule.re.test(label));
  return Boolean(rule.norm) && normPadded.includes(` ${rule.norm} `);
}

export function validatePattern(pattern, isRegex) {
  const p = String(pattern || "").trim();
  if (!p || p.length > 200) throw new Error("Motif vide ou trop long (200 caractères maximum).");
  if (isRegex) {
    try { new RegExp(p); } catch (_) { throw new Error("Expression régulière invalide."); }
  } else if (!normalizeLabel(p)) {
    throw new Error("Ce mot-clé ne contient aucune lettre utilisable.");
  }
  return p;
}

/** « CB BOULANGERIE DES AMIS » -> « BOULANGERIE DES AMIS » (morceau CONTINU du libellé). */
export function suggestPattern(label) {
  const words = normalizeLabel(label).split(" ").filter(Boolean);
  const useful = (w) => !NOISE_WORDS.has(w) && !/^\d+$/.test(w);
  const start = words.findIndex(useful);
  if (start < 0) return words.slice(0, 3).join(" ");
  const chunk = words.slice(start, start + 3);
  while (chunk.length && !useful(chunk[chunk.length - 1])) chunk.pop();
  return chunk.join(" ");
}

export function loadRules(data) {
  const sorted = [...data.rules].sort((a, b) => a.priority - b.priority || b.id - a.id);
  const user = [], defaults = [];
  for (const r of sorted) {
    const p = prepareRule(r);
    if (!p) continue;
    (r.origin === "default" ? defaults : user).push(p);
  }
  defaults.sort((a, b) => (b.norm || b.pattern).length - (a.norm || a.pattern).length);
  return { user, defaults };
}

export function findInternalPairs(txs) {
  const candidates = txs.filter((t) => t.hint === "virement" || TRANSFER_WORDS.test(normalizeLabel(t.label)));
  const byAmount = new Map();
  for (const t of candidates) {
    const k = Math.abs(t.amount_cents);
    if (!byAmount.has(k)) byAmount.set(k, []);
    byAmount.get(k).push(t);
  }
  const paired = new Set();
  const byDate = (a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0);
  for (const group of byAmount.values()) {
    const outs = group.filter((t) => t.amount_cents < 0).sort(byDate);
    const ins = group.filter((t) => t.amount_cents > 0).sort(byDate);
    for (const o of outs) {
      for (const i of ins) {
        if (paired.has(i.id) || i.account_id === o.account_id) continue;
        if (Math.abs(daysBetween(o.date, i.date)) <= 3) {
          paired.add(o.id); paired.add(i.id);
          break;
        }
      }
    }
  }
  return paired;
}

/** (Re)classe toutes les opérations non verrouillées. Renvoie le nombre de changements. */
export function categorizeAll(data) {
  const { user, defaults } = loadRules(data);
  const catIds = Object.fromEntries(data.categories.map((c) => [c.name, c.id]));
  const pairs = findInternalPairs(data.transactions);
  let changes = 0;
  for (const t of data.transactions) {
    if (t.category_locked) continue;
    const norm = ` ${normalizeLabel(t.label)} `;
    let cat = null, source = null;
    let rule = user.find((x) => ruleMatches(x, t.label, norm, t.amount_cents));
    if (rule) { cat = rule.category_id; source = "regle"; }
    else if (pairs.has(t.id) && catIds["Virements internes"]) { cat = catIds["Virements internes"]; source = "virement-interne"; }
    else if (t.hint && HINT_CATEGORY[t.hint]) {
      let name = HINT_CATEGORY[t.hint];
      if (t.hint === "interets" && t.amount_cents < 0) name = "Frais bancaires";
      cat = catIds[name] ?? null; source = "source";
    }
    if (cat === null) {
      rule = defaults.find((x) => ruleMatches(x, t.label, norm, t.amount_cents));
      if (rule) { cat = rule.category_id; source = "defaut"; }
      else source = null;
    }
    if (cat !== (t.category_id ?? null) || source !== (t.category_source ?? null)) {
      t.category_id = cat;
      t.category_source = source;
      changes++;
    }
  }
  return changes;
}

export function previewRule(data, pattern, isRegex, sign) {
  const rule = prepareRule({ pattern, is_regex: isRegex, sign });
  let count = 0, locked = 0;
  const samples = [];
  const sorted = [...data.transactions].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  for (const t of sorted) {
    if (ruleMatches(rule, t.label, ` ${normalizeLabel(t.label)} `, t.amount_cents)) {
      count++;
      if (t.category_locked) locked++;
      if (samples.length < 5 && !samples.includes(t.label)) samples.push(t.label);
    }
  }
  return { count, locked, samples };
}
