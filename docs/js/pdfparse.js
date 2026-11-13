// Lecture des relevés PDF (portage de app/importers/pdf_generic.py et banks.py).
//
// Chaque ligne = texte + abscisse réelle de chaque caractère : un libellé long qui
// décale le montant dans le texte ne transforme pas un débit en crédit.

import { daysBetween, parseAmount, plain, todayIso, validDate } from "./core.js";

const DATE_START = /^\s*(\d{2}[/.]\d{2}(?:[/.]\d{2,4})?)(?=\s)/;
const TRAILING_DATE = /\s+(\d{2}[/.]\d{2}(?:[/.]\d{2,4})?)\s*$/;
const LEADING_DATE = /^\s*(\d{2}[/.]\d{2}(?:[/.]\d{2,4})?)\s+/;
const AMOUNT = /(?<![\d,.])-?\d{1,3}(?:[   .]\d{3})*,\d{2}(?![\d,%])/g;
const PERIOD = /(\d{2}[/.]\d{2}[/.]\d{4})\D{1,20}?(\d{2}[/.]\d{2}[/.]\d{4})/g;
const PERIOD_DU_AU = /\bdu\s*(\d{2}[/.]\d{2}[/.]\d{4})\s*au\s*(\d{2}[/.]\d{2}[/.]\d{4})/gi;
const PAGE_MARK = /\bpage\s*\d+\s*\/\s*\d+\b/;

export class Line {
  constructor(text, xs) { this.text = text; this.xs = xs; }
  static fromText(text) { return new Line(text, [...text].map((_, i) => i)); }
  get indent() {
    const stripped = this.text.length - this.text.trimStart().length;
    return stripped < this.xs.length ? this.xs[stripped] : 0;
  }
}

const allMatches = (re, s) => [...s.matchAll(new RegExp(re.source, re.flags.includes("g") ? re.flags : re.flags + "g"))];

export class GenericPdfParser {
  static parserName = "pdf-generique";
  static label = "Format générique";
  static detectKeywords = [];
  creditHints = ["VIR RECU", "VIREMENT RECU", "VIR SEPA RECU", "REMISE", "AVOIR", "REMBOURSEMENT", "SALAIRE"];
  skipLineKeywords = ["total des operations", "totaux", "sous-total", "sous total"];
  maxLabelLength = 140;
  startMarker = null;
  maxContinuationLength = 80;

  static detect(text) {
    const t = plain(text);
    return this.detectKeywords.some((k) => t.includes(plain(k)));
  }

  parsePages(pages) {
    return this.parseLines(pages.map((p) => p.split("\n").map((t) => Line.fromText(t))));
  }

  parseLines(pages) {
    const st = { source: "pdf", parser: this.constructor.parserName, transactions: [], opening_balance_cents: null,
      closing_balance_cents: null, period_start: null, period_end: null, warnings: [] };
    const full = pages.map((p) => p.map((l) => l.text).join("\n")).join("\n");
    this.findPeriod(full, st);
    const yearHint = st.period_end ? Number(st.period_end.slice(0, 4)) : Number(todayIso().slice(0, 4));

    let cols = null, current = null, contMinX = 0;
    const balances = [];
    for (const page of pages) {
      current = null;
      let inSection = this.startMarker === null;
      for (const line of page) {
        const text = line.text;
        if (!text.trim()) continue;
        const low = plain(text);
        if (!inSection) { inSection = low.includes(this.startMarker); continue; }
        const header = this.headerColumns(line);
        if (header) { cols = header; current = null; continue; }
        if (PAGE_MARK.test(low) || this.skipLineKeywords.some((k) => low.includes(k))) { current = null; continue; }
        const amounts = allMatches(AMOUNT, text);
        if (low.includes("solde") && amounts.length) {
          const m = amounts[amounts.length - 1];
          let val = Math.abs(parseAmount(m[0]));
          if (m[0].startsWith("-") || low.includes("debiteur") || this.side(line, m, cols) === "debit") val = -val;
          balances.push([low, val]);
          current = null;
          continue;
        }
        const dm = text.match(DATE_START);
        if (dm && allMatches(PERIOD_DU_AU, text).length) { current = null; continue; }
        if (dm && amounts.length) {
          current = this.makeTx(line, dm, amounts, cols, yearHint, st);
          const dmEnd = dm.index + dm[0].length;
          const rest = text.slice(dmEnd);
          const labelIdx = dmEnd + rest.length - rest.trimStart().length;
          const labelX = labelIdx < line.xs.length ? line.xs[labelIdx] : line.indent;
          contMinX = (line.indent + labelX) / 2;
          if (current) st.transactions.push(current);
          continue;
        }
        if (current && !amounts.length && !dm && line.indent > contMinX && text.trim().length <= this.maxContinuationLength) {
          const extra = this.continuationText(text.split(/\s+/).filter(Boolean).join(" "));
          if (extra && current.label.length + extra.length < this.maxLabelLength) current.label = `${current.label} ${extra}`;
          continue;
        }
        current = null;
      }
    }
    this.assignBalances(balances, st);
    if (st.transactions.length && !st.period_start) {
      const ds = st.transactions.map((t) => t.date).sort();
      st.period_start = ds[0]; st.period_end = ds[ds.length - 1];
    }
    if (st.transactions.some((t) => t.uncertain_sign)) {
      st.warnings.push("Colonnes Débit/Crédit non trouvées : le sens de certaines opérations a été deviné. Vérifiez-les.");
    }
    if (!st.transactions.length) st.warnings.push("Aucune opération reconnue dans ce PDF. Ce format de relevé doit être calibré.");
    return st;
  }

  continuationText(text) {
    if (text.length <= 1 || /^[^\p{L}]+$/u.test(text)) return null;
    return text;
  }

  signHint() { return null; }

  findPeriod(text, st) {
    for (const m of [...allMatches(PERIOD_DU_AU, text), ...allMatches(PERIOD, text)]) {
      const a = fullDate(m[1]), b = fullDate(m[2]);
      if (a && b && a <= b) { st.period_start = a; st.period_end = b; return; }
    }
  }

  headerColumns(line) {
    const low = plain(line.text);
    if (low.includes("solde")) return null;
    const d = low.match(/\bdebit\b/), c = low.match(/\bcredit\b/);
    if (!d || !c) return null;
    return [line.xs[d.index + d[0].length - 1], line.xs[c.index + c[0].length - 1]];
  }

  side(line, m, cols) {
    if (!cols) return null;
    const right = line.xs[m.index + m[0].length - 1];
    return Math.abs(right - cols[0]) < Math.abs(right - cols[1]) ? "debit" : "credit";
  }

  makeTx(line, dm, amounts, cols, yearHint, st) {
    const text = line.text;
    let labelPart = text.slice(dm.index + dm[0].length, amounts[0].index);
    // Date de valeur (avant ou après le libellé) : retirée du libellé, mais son ANNÉE sert
    // à dater correctement l'opération quand la colonne DATE n'a que « JJ.MM » (LCL).
    let valueRaw = null;
    const lead = labelPart.match(LEADING_DATE);
    if (lead) { valueRaw = lead[1]; labelPart = " " + labelPart.slice(lead[0].length); }
    const trail = labelPart.match(TRAILING_DATE);
    if (trail) { valueRaw = valueRaw || trail[1]; labelPart = labelPart.slice(0, trail.index); }
    const iso = this.dateWithYear(dm[1], yearHint, st, valueRaw);
    if (!iso) return null;
    const label = labelPart.split(/\s+/).filter(Boolean).join(" ") || "(sans libellé)";
    const m = amounts[0];
    const value = Math.abs(parseAmount(m[0]));
    let uncertain = false, sign;
    const hint = this.signHint(line, m);
    const side = this.side(line, m, cols);
    if (m[0].startsWith("-")) sign = -1;
    else if (hint !== null) sign = hint;
    else if (side !== null) sign = side === "debit" ? -1 : 1;
    else {
      uncertain = true;
      sign = this.creditHints.some((h) => label.toUpperCase().includes(h)) ? 1 : -1;
    }
    return { date: iso, label, amount_cents: sign * value, uncertain_sign: uncertain, hint: null };
  }

  /**
   * Date complète d'une opération. Si l'année manque (« 31.12 »), on choisit l'année la plus
   * plausible : au plus près de la date de valeur si elle a une année (« 31.12.25 »), sinon au
   * plus près de la période du relevé (une opération ne tombe pas 11 mois après son relevé).
   */
  dateWithYear(raw, yearHint, st, valueRaw = null) {
    const parts = raw.split(/[/.]/);
    if (parts.length === 3) {
      try { return validDate(Number(parts[2]) + (parts[2].length === 2 ? 2000 : 0), Number(parts[1]), Number(parts[0])); }
      catch (_) { return null; }
    }
    const d = Number(parts[0]), mth = Number(parts[1]);
    const vp = valueRaw ? valueRaw.split(/[/.]/) : [];
    let valueIso = null;
    if (vp.length === 3) {
      try { valueIso = validDate(Number(vp[2]) + (vp[2].length === 2 ? 2000 : 0), Number(vp[1]), Number(vp[0])); } catch (_) { /* ignorée */ }
    }
    const base = valueIso ? Number(valueIso.slice(0, 4)) : yearHint;
    const candidates = [];
    for (const y of [base, base - 1, base + 1]) {
      try { candidates.push(validDate(y, mth, d)); } catch (_) { /* 29/02 hors année bissextile… */ }
    }
    if (!candidates.length) return null;
    const distance = (iso) => {
      if (valueIso) return Math.abs(daysBetween(iso, valueIso));
      if (st.period_start && st.period_end) {
        if (iso < st.period_start) return daysBetween(iso, st.period_start);
        if (iso > st.period_end) return daysBetween(st.period_end, iso);
        return 0;
      }
      return 0;
    };
    let best = candidates[0];
    for (const c of candidates.slice(1)) if (distance(c) < distance(best)) best = c;
    return best;
  }

  assignBalances(balances, st) {
    if (!balances.length) return;
    const opening = balances.filter(([low]) => ["ancien", "precedent", "debut", "report"].some((k) => low.includes(k))).map((b) => b[1]);
    const closing = balances.filter(([low]) => ["nouveau", "final", "fin "].some((k) => low.includes(k))).map((b) => b[1]);
    st.opening_balance_cents = opening.length ? opening[0] : balances[0][1];
    if (closing.length) st.closing_balance_cents = closing[closing.length - 1];
    else if (balances.length > 1) st.closing_balance_cents = balances[balances.length - 1][1];
  }
}

function fullDate(s) {
  const [d, m, y] = s.split(/[/.]/).map(Number);
  try { return validDate(y, m, d); } catch (_) { return null; }
}

function dropReferences(text) {
  return text.split(/\s+/).filter((w) => w && !(/\d/.test(w) && w.length >= 10)).join(" ");
}

export class LclParser extends GenericPdfParser {
  static parserName = "lcl";
  static label = "LCL";
  static detectKeywords = ["Crédit Lyonnais", "LCL"];
  static noiseKey = /^(?:[A-Z]{2,4}\.[A-Z]+|NATURE\b[^:]*|.*\bREF\b[^:]*|.*MANDAT[^:]*)\s*:/i;
  static keyValue = /^([^:]{2,40}):\s*(.*)$/;

  signHint(line, m) {
    // « 45,90   . » : le point dans la colonne crédit signale un débit.
    return line.text.slice(m.index + m[0].length).trim() === "." ? -1 : null;
  }

  continuationText(text) {
    if (LclParser.noiseKey.test(text)) return null;
    const kv = text.match(LclParser.keyValue);
    if (kv) text = kv[2].trim();
    const cleaned = dropReferences(text);
    return cleaned ? super.continuationText(cleaned) : null;
  }
}

export class BoursobankParser extends GenericPdfParser {
  static parserName = "boursobank";
  static label = "Boursobank";
  static detectKeywords = ["BoursoBank", "Boursorama"];
  startMarker = "mouvements";
  static noiseKey = /^[^\s:]{2,6}\s*:/;

  headerColumns(line) {
    const cols = super.headerColumns(line);
    if (cols) return cols;
    const low = plain(line.text);
    const m = low.match(/\bvaleur\b/);
    if (!m) return null;
    const base = m.index + m[0].length;
    const after = [...line.text.slice(base).matchAll(/\S+/g)];
    if (after.length !== 2) return null;
    return [line.xs[base + after[0].index + after[0][0].length - 1], line.xs[base + after[1].index + after[1][0].length - 1]];
  }

  continuationText(text) {
    if (BoursobankParser.noiseKey.test(text)) return null;
    const cleaned = dropReferences(text);
    if (cleaned.replace(/[^\p{L}]/gu, "").length < 4) return null;
    return super.continuationText(cleaned);
  }
}

export class TradeRepublicParser extends GenericPdfParser {
  static parserName = "trade-republic";
  static label = "Trade Republic";
  static detectKeywords = ["Trade Republic"];
  creditHints = [...this.creditHints, "INCOMING", "ENTRANT", "INTERETS", "INTÉRÊTS"];
}

export const PDF_PARSERS = [LclParser, BoursobankParser, TradeRepublicParser];

export function availableParsers() {
  return [{ name: GenericPdfParser.parserName, label: GenericPdfParser.label },
    ...PDF_PARSERS.map((c) => ({ name: c.parserName, label: c.label }))];
}

export function chooseParser(firstText, forced) {
  if (forced) {
    const cls = PDF_PARSERS.find((c) => c.parserName === forced);
    return cls ? new cls() : new GenericPdfParser();
  }
  const cls = PDF_PARSERS.find((c) => c.detect(firstText));
  return cls ? new cls() : new GenericPdfParser();
}

// --- Extraction avec pdf.js -------------------------------------------------------------------
/** Regroupe les morceaux de texte d'une page en lignes, avec l'abscisse de chaque caractère. */
export function itemsToLines(items) {
  const words = items
    .filter((it) => it.str && it.str.trim())
    .map((it) => ({ text: it.str, x0: it.transform[4], x1: it.transform[4] + it.width, top: -it.transform[5] }));
  words.sort((a, b) => Math.round(a.top) - Math.round(b.top) || a.x0 - b.x0);
  const rows = [];
  for (const w of words) {
    const last = rows[rows.length - 1];
    if (last && Math.abs(w.top - last[0].top) <= 3) last.push(w); else rows.push([w]);
  }
  return rows.map((row) => {
    row.sort((a, b) => a.x0 - b.x0);
    let text = "";
    const xs = [];
    row.forEach((w, i) => {
      const t = w.text;
      const charW = (w.x1 - w.x0) / Math.max(t.length, 1);
      if (i) {
        const gap = w.x0 - row[i - 1].x1;
        // Morceaux collés (changement de police au milieu d'un mot) : pas d'espace.
        if (gap > 0.15 * charW) {
          const n = gap < 3 * charW ? 1 : 3;
          const prev = xs[xs.length - 1];
          for (let k = 0; k < n; k++) { text += " "; xs.push(prev + ((k + 1) * gap) / (n + 1)); }
        }
      } else {
        const n = Math.floor(w.x0 / Math.max(charW, 1));
        text += " ".repeat(n);
        for (let k = 0; k < n; k++) xs.push((w.x0 * k) / Math.max(n, 1));
      }
      text += t;
      for (let k = 0; k < t.length; k++) xs.push(w.x0 + (k + 0.5) * charW);
    });
    return new Line(text, xs);
  });
}

let pdfjsPromise = null;
async function pdfjs() {
  if (!pdfjsPromise) {
    pdfjsPromise = import("../vendor/pdf.min.mjs").then((lib) => {
      lib.GlobalWorkerOptions.workerSrc = new URL("../vendor/pdf.worker.min.mjs", import.meta.url).href;
      return lib;
    });
  }
  return pdfjsPromise;
}

export async function pdfPagesLines(bytes) {
  const lib = await pdfjs();
  let doc, task;
  try {
    task = lib.getDocument({
      data: bytes,
      isEvalSupported: false,          // jamais de code généré à la volée
      cMapUrl: new URL("../vendor/cmaps/", import.meta.url).href, cMapPacked: true,
      standardFontDataUrl: new URL("../vendor/standard_fonts/", import.meta.url).href,
      useSystemFonts: false, disableFontFace: true,
    });
    doc = await task.promise;
  } catch (_) {
    throw new Error("Ce PDF n'a pas pu être lu (fichier protégé ou abîmé ?).");
  }
  const pages = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    pages.push(itemsToLines(content.items));
  }
  await task.destroy();
  return pages;
}

export async function parsePdf(bytes, forced) {
  const pages = await pdfPagesLines(bytes);
  if (!pages.some((p) => p.some((l) => l.text.trim()))) {
    throw new Error("Ce PDF ne contient pas de texte (scan ?). Utilisez plutôt l'export CSV de la banque.");
  }
  const sample = [...pages.slice(0, 2), pages[pages.length - 1]];
  const parser = chooseParser(sample.map((p) => p.map((l) => l.text).join("\n")).join("\n"), forced);
  const st = parser.parseLines(pages);
  st.parser = parser.constructor.parserName;
  return st;
}
