// Import CSV (portage de app/importers/csv_import.py et trade_republic.py).

import { parseAmount, parseDate, parseDotDecimal, stripAccents } from "./core.js";

const norm = (h) => stripAccents(String(h || "")).trim().toLowerCase();

export function decode(bytes) {
  try {
    let s = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    if (s.charCodeAt(0) === 0xfeff) s = s.slice(1);
    return s;
  } catch (_) {
    return new TextDecoder("windows-1252").decode(bytes);
  }
}

/** Analyse CSV standard (guillemets, guillemets doublés, retours à la ligne entre guillemets). */
export function parseCsv(text, delim) {
  const rows = [];
  let row = [], field = "", inQ = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQ) {
      if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else inQ = false; }
      else field += c;
    } else if (c === '"') inQ = true;
    else if (c === delim) { row.push(field); field = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field); rows.push(row); row = []; field = "";
    } else field += c;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  return rows;
}

/** Lignes entièrement entre guillemets (après Excel / un éditeur) : on retire l'enveloppe. */
export function unwrapQuotedLines(text) {
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  if (!lines.length || !lines.every((l) => l.startsWith('"') && l.trimEnd().endsWith('"'))) return null;
  const inner = lines.map((l) => (parseCsv(l, "\u0000")[0] || [""])[0]);
  if (![",", ";", "\t"].some((d) => inner[0].includes(d))) return null;
  return inner.join("\n");
}

function sniffDelimiter(sample) {
  const lines = sample.split(/\r?\n/).filter((l) => l.trim()).slice(0, 10);
  let best = ",", bestScore = -1;
  for (const d of [";", ",", "\t", "|"]) {
    const counts = parseCsv(lines.join("\n"), d).map((r) => r.length);
    if (!counts.length || counts[0] < 2) continue;
    const consistent = counts.filter((n) => n === counts[0]).length;
    const score = consistent * 100 + counts[0];
    if (score > bestScore) { bestScore = score; best = d; }
  }
  return best;
}

export function readRows(bytes) {
  let text = decode(bytes);
  const unwrapped = unwrapQuotedLines(text);
  if (unwrapped !== null) text = unwrapped;
  const delim = sniffDelimiter(text.slice(0, 5000));
  const all = parseCsv(text, delim);
  const headers = (all[0] || []).filter((h) => h !== undefined);
  if (headers.length < 2) throw new Error("Impossible de lire les colonnes de ce CSV.");
  const rows = all.slice(1)
    .filter((r) => r.some((v) => (v || "").trim()))
    .map((r) => Object.fromEntries(headers.map((h, i) => [h, r[i] ?? ""])));
  return { headers, rows };
}

// --- Trade Republic ---------------------------------------------------------------------------
export const TR_SIGNATURE = ["date", "category", "type", "amount", "fee", "tax", "currency", "description"];

export function classifyTR(category, type) {
  const c = (category || "").toUpperCase(), t = (type || "").toUpperCase();
  if (t.includes("DIVIDEND")) return "dividende";
  if (t.includes("INTEREST")) return "interets";
  if (t.includes("TAX")) return "impot";
  if (t.includes("FEE")) return "frais";
  if (c === "TRADING" || t === "BUY" || t === "SELL" || t.includes("SAVINGS_PLAN") || t.includes("TRADE")) return "investissement";
  if (t.includes("CARD")) return "carte";
  if (["TRANSFER", "PAYMENT", "PAYOUT", "DIRECT_DEBIT"].some((k) => t.includes(k))) return "virement";
  return null;
}

function parseTradeRepublic(headers, rows) {
  const st = newStatement("trade_republic");
  const col = Object.fromEntries(headers.map((h) => [norm(h), h]));
  const get = (r, name) => (col[name] ? String(r[col[name]] ?? "").trim() : "");
  let skipped = 0, foreign = 0;
  for (const r of rows) {
    let d, amount, fee, tax;
    try {
      d = parseDate(get(r, "date"));
      amount = get(r, "amount") ? parseDotDecimal(get(r, "amount")) : 0;
      fee = get(r, "fee") ? parseDotDecimal(get(r, "fee")) : 0;
      tax = get(r, "tax") ? parseDotDecimal(get(r, "tax")) : 0;
    } catch (_) { skipped++; continue; }
    if (get(r, "currency") && get(r, "currency").toUpperCase() !== "EUR") { foreign++; continue; }
    const hint = classifyTR(get(r, "category"), get(r, "type"));
    let label = get(r, "description").split(/\s+/).filter(Boolean).join(" ");
    if (!label) label = [get(r, "counterparty_name"), get(r, "name"), get(r, "type")].filter(Boolean).join(" ");
    label = label || "(sans libellé)";
    if (amount) st.transactions.push({ date: d, label, amount_cents: amount, uncertain_sign: false, hint });
    if (fee) st.transactions.push({ date: d, label: `Frais Trade Republic – ${label}`.slice(0, 200), amount_cents: -Math.abs(fee), uncertain_sign: false, hint: "frais" });
    if (tax) st.transactions.push({ date: d, label: `Taxe – ${label}`.slice(0, 200), amount_cents: tax, uncertain_sign: false, hint: "impot" });
  }
  if (skipped) st.warnings.push(`${skipped} ligne(s) ignorée(s) car illisibles (date ou montant).`);
  if (foreign) st.warnings.push(`${foreign} ligne(s) dans une autre devise que l'euro ignorée(s).`);
  if (st.transactions.some((t) => t.hint === "investissement")) {
    st.warnings.push("Les achats et ventes de titres sont marqués « Investissement » : ils ne compteront pas comme des dépenses dans le budget.");
  }
  setPeriod(st);
  return st;
}

// --- Préréglages et CSV générique ---------------------------------------------------------
const PRESETS = {
  boursobank: { label: "Boursobank (export CSV)", signature: ["dateop", "label", "amount"],
    mapping: { date: "dateOp", label: "label", amount: "amount" } },
  trade_republic: { label: "Trade Republic (export CSV)", signature: TR_SIGNATURE,
    mapping: { date: "date", label: "description", amount: "amount" }, reader: parseTradeRepublic },
};

const GUESS = {
  date: ["date operation", "date op", "dateop", "date", "date comptable", "booking date"],
  label: ["libelle", "libelle operation", "label", "description", "intitule", "detail", "operation"],
  amount: ["montant", "amount", "montant (eur)", "montant eur", "valeur"],
  debit: ["debit", "debit (eur)", "debit eur", "sortie"],
  credit: ["credit", "credit (eur)", "credit eur", "entree"],
};

function newStatement(parser) {
  return { source: "csv", parser, transactions: [], opening_balance_cents: null, closing_balance_cents: null,
    period_start: null, period_end: null, warnings: [] };
}

function setPeriod(st) {
  if (!st.transactions.length) return;
  const ds = st.transactions.map((t) => t.date).sort();
  st.period_start = ds[0]; st.period_end = ds[ds.length - 1];
}

export function detectPreset(headers) {
  const normed = new Set(headers.map(norm));
  const ordered = Object.entries(PRESETS).sort((a, b) => b[1].signature.length - a[1].signature.length);
  const hit = ordered.find(([, p]) => p.signature.every((s) => normed.has(s)));
  return hit ? hit[0] : null;
}

export function guessMapping(headers) {
  const byNorm = Object.fromEntries(headers.map((h) => [norm(h), h]));
  const mapping = {};
  for (const [field, names] of Object.entries(GUESS)) {
    for (const n of names) {
      if (byNorm[n] && !Object.values(mapping).includes(byNorm[n])) { mapping[field] = byNorm[n]; break; }
    }
  }
  if (mapping.amount && (mapping.debit || mapping.credit)) { delete mapping.debit; delete mapping.credit; }
  return mapping;
}

function resolvePresetMapping(preset, headers) {
  const byNorm = Object.fromEntries(headers.map((h) => [norm(h), h]));
  return Object.fromEntries(Object.entries(PRESETS[preset].mapping).map(([k, v]) => [k, byNorm[norm(v)]]));
}

/** Renvoie [relevé, infos pour l'écran : colonnes, mapping, préréglage]. */
export function parseCsvStatement(bytes, mapping) {
  const { headers, rows } = readRows(bytes);
  const preset = detectPreset(headers);
  if (preset && !mapping && PRESETS[preset].reader) {
    return [PRESETS[preset].reader(headers, rows), { headers, mapping: resolvePresetMapping(preset, headers), preset,
      preset_label: PRESETS[preset].label, needs_mapping: false }];
  }
  if (!mapping) mapping = preset ? resolvePresetMapping(preset, headers) : guessMapping(headers);
  const info = { headers, mapping, preset, preset_label: preset ? PRESETS[preset].label : null };
  const st = newStatement(preset || "csv-generique");
  const hasAmount = Boolean(mapping.amount);
  const hasSplit = Boolean(mapping.debit || mapping.credit);
  if (!mapping.date || !mapping.label || !(hasAmount || hasSplit)) { info.needs_mapping = true; return [st, info]; }
  let skipped = 0;
  for (const r of rows) {
    let d, cents;
    try {
      d = parseDate(r[mapping.date] ?? "");
      if (hasAmount) cents = parseAmount(r[mapping.amount] ?? "");
      else {
        const deb = String(r[mapping.debit] ?? "").trim(), cre = String(r[mapping.credit] ?? "").trim();
        cents = (cre ? parseAmount(cre) : 0) - (deb ? Math.abs(parseAmount(deb)) : 0);
      }
    } catch (_) { skipped++; continue; }
    const label = String(r[mapping.label] ?? "").split(/\s+/).filter(Boolean).join(" ") || "(sans libellé)";
    st.transactions.push({ date: d, label, amount_cents: cents, uncertain_sign: false, hint: null });
  }
  if (skipped) st.warnings.push(`${skipped} ligne(s) ignorée(s) car illisibles (date ou montant).`);
  setPeriod(st);
  info.needs_mapping = !st.transactions.length;
  return [st, info];
}
