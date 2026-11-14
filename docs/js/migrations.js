// Réparations automatiques des données, appliquées une fois à l'ouverture du coffre.

import { addDays } from "./core.js";
import { fingerprints } from "./analytics.js";
import { categorizeAll } from "./categorize.js";
import { CATEGORIES_V4, DEFAULT_CATEGORIES, DEFAULT_RULES } from "./defaults.js";

/**
 * Correctif « année LCL » : des opérations de fin décembre importées depuis un relevé de
 * janvier ont pu recevoir l'année du relevé (31/12/2026 au lieu de 31/12/2025).
 * Repère les opérations datées bien APRÈS la fin de leur relevé, que le recul d'un an
 * replace dans la période, et les corrige (empreintes anti-doublon recalculées).
 * Renvoie le nombre d'opérations corrigées.
 */
export async function repairYearShift(data) {
  const statements = new Map(data.statements.map((s) => [s.id, s]));
  const touched = new Set();
  let fixed = 0;
  for (const t of data.transactions) {
    const st = statements.get(t.statement_id);
    if (!st || !st.period_start || !st.period_end || st.source !== "pdf") continue;
    if (t.date <= addDays(st.period_end, 31)) continue;
    const shifted = `${Number(t.date.slice(0, 4)) - 1}${t.date.slice(4)}`;
    if (shifted >= addDays(st.period_start, -62) && shifted <= addDays(st.period_end, 1)) {
      t.date = shifted;
      touched.add(st.id);
      fixed++;
    }
  }
  for (const sid of touched) {
    const txs = data.transactions.filter((t) => t.statement_id === sid).sort((a, b) => a.id - b.id);
    const fps = await fingerprints(txs[0].account_id, txs);
    txs.forEach((t, i) => { t.fingerprint = fps[i]; });
  }
  return fixed;
}

/**
 * Nouvelles catégories par défaut (cadeaux, remboursements, primes…) dans un coffre existant :
 * seulement celles qui n'existent pas déjà (même nom), avec leurs règles par défaut.
 */
export function addCategoriesV4(data) {
  const names = new Set(data.categories.map((c) => c.name));
  const added = [];
  for (const c of DEFAULT_CATEGORIES) {
    if (!CATEGORIES_V4.includes(c.name) || names.has(c.name)) continue;
    const cat = { id: data.nextId++, ...c };
    data.categories.push(cat);
    added.push(cat);
  }
  for (const cat of added) {
    for (const r of DEFAULT_RULES.filter((x) => x.category === cat.name)) {
      for (const p of r.patterns) {
        data.rules.push({ id: data.nextId++, pattern: p, is_regex: false, category_id: cat.id, priority: 100,
          sign: r.sign, origin: "default" });
      }
    }
  }
  if (added.length) categorizeAll(data);
  return added.length;
}

export async function migrate(data) {
  data.migrations = data.migrations || {};
  let changed = 0;
  if (!data.migrations.yearShift1) {
    changed += await repairYearShift(data);
    data.migrations.yearShift1 = true;
    changed += 1; // le marqueur lui-même doit être enregistré
  }
  if (!data.migrations.categoriesV4) {
    addCategoriesV4(data);
    data.migrations.categoriesV4 = true;
    changed += 1;
  }
  return changed;
}
