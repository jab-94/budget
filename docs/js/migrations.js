// Réparations automatiques des données, appliquées une fois à l'ouverture du coffre.

import { addDays } from "./core.js";
import { fingerprints } from "./analytics.js";

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

export async function migrate(data) {
  data.migrations = data.migrations || {};
  let changed = 0;
  if (!data.migrations.yearShift1) {
    changed += await repairYearShift(data);
    data.migrations.yearShift1 = true;
    changed += 1; // le marqueur lui-même doit être enregistré
  }
  return changed;
}
