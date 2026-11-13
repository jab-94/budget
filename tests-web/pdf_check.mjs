// Compare le lecteur PDF du navigateur avec la version Python, sur les faux relevés de test.
import { readFileSync } from "node:fs";
import * as pdfjs from "../tools/web-vendor/node_modules/pdfjs-dist/legacy/build/pdf.mjs";
import { itemsToLines, chooseParser } from "../docs/js/pdfparse.js";

for (const f of ["faux_releve_lcl.pdf", "faux_releve_boursobank.pdf"]) {
  const doc = await pdfjs.getDocument({ data: new Uint8Array(readFileSync(`tests/fixtures/${f}`)), isEvalSupported: false }).promise;
  const pages = [];
  for (let i = 1; i <= doc.numPages; i++) pages.push(itemsToLines((await (await doc.getPage(i)).getTextContent()).items));
  const sample = [...pages.slice(0, 2), pages[pages.length - 1]].map((p) => p.map((l) => l.text).join("\n")).join("\n");
  const p = chooseParser(sample);
  const st = p.parseLines(pages);
  console.log(JSON.stringify({ f, parser: p.constructor.parserName, period: [st.period_start, st.period_end],
    soldes: [st.opening_balance_cents, st.closing_balance_cents], warnings: st.warnings,
    tx: st.transactions.map((t) => [t.date, t.amount_cents, t.label]) }));
}
