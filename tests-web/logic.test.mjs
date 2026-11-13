// Les règles de la version web doivent donner les mêmes résultats que la version Python.
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseAmount, parseDate, parseDotDecimal, normalizeLabel } from "../docs/js/core.js";
import { suggestPattern, categorizeAll } from "../docs/js/categorize.js";
import { newData } from "../docs/js/store.js";
import { quantile, insights, incomeAnalysis } from "../docs/js/analytics.js";
import { parseCsvStatement } from "../docs/js/csvparse.js";

test("montants (mêmes cas que tests/test_importers.py)", () => {
  for (const [t, c] of [["12,50", 1250], ["-12,50", -1250], ["1 234,56", 123456], ["1 234,56 €", 123456], ["1.234,56", 123456],
    ["1,234.56", 123456], ["-45.9", -4590], ["100", 10000], ["12,50-", -1250], ["+3,00", 300], ["(7,25)", -725], ["-1 000,00", -100000]]) {
    assert.equal(parseAmount(t), c, t);
  }
  for (const bad of ["", "abc", "12,5,6", "--3"]) assert.throws(() => parseAmount(bad));
  assert.equal(parseDotDecimal("999.999999"), 100000);
  assert.equal(parseDotDecimal("-0.005"), -1);
  assert.equal(parseDotDecimal("3.125000"), 313);
  assert.equal(parseDotDecimal("-25.004999"), -2500);
});

test("dates et libellés", () => {
  assert.equal(parseDate("05/03/2026"), "2026-03-05");
  assert.equal(parseDate("05.03.26"), "2026-03-05");
  assert.equal(parseDate("05/03", 2025), "2025-03-05");
  assert.throws(() => parseDate("31/02/2026"));
  assert.equal(normalizeLabel("CB Carrefour 02/03"), "CB CARREFOUR");
  assert.equal(normalizeLabel("Prélèvement Électricité"), "PRELEVEMENT ELECTRICITE");
  assert.equal(suggestPattern("CB BOULANGERIE DES AMIS"), "BOULANGERIE DES AMIS");
  assert.equal(suggestPattern("PRLV SEPA FREE MOBILE"), "FREE MOBILE");
});

test("catégorisation par défaut et virements internes", () => {
  const d = newData();
  d.accounts.push({ id: 900, name: "LCL" }, { id: 901, name: "Bourso" });
  let id = 1000;
  const add = (label, cents, account = 900, date = "2026-03-05") => {
    const t = { id: id++, account_id: account, date, label, amount_cents: cents, category_id: null, category_locked: 0 };
    d.transactions.push(t); return t;
  };
  const cases = [[add("CB CARREFOUR MARKET 02/03", -4590), "Alimentation"], [add("CB UBER EATS PARIS", -2500), "Restaurants"],
    [add("CB UBER BV", -1800), "Transports"], [add("VIR SALAIRE MARS", 215000), "Salaire"], [add("VIR CPAM REMBOURSEMENT", 3000), "Santé"],
    [add("VIR INST VERS BOURSO", -50000, 900, "2026-03-10"), "Virements internes"], [add("VIREMENT RECU DE LCL", 50000, 901, "2026-03-11"), "Virements internes"],
    [add("CB MAGASIN INCONNU", -999), null]];
  categorizeAll(d);
  const name = (t) => d.categories.find((c) => c.id === t.category_id)?.name ?? null;
  for (const [t, expected] of cases) assert.equal(name(t), expected, t.label);
  assert.ok(!d.categories.some((c) => c.name === "Droits d'auteur"));
});

test("revenu de référence prudent (mêmes valeurs que tests/test_income.py)", () => {
  assert.equal(quantile([190000, 210000, 240000, 280000, 300000, 350000], 0.25), 217500);
  const d = newData();
  d.accounts.push({ id: 900, name: "LCL" });
  let id = 1000;
  const sal = { "2026-01": 280000, "2026-02": 210000, "2026-03": 350000, "2026-04": 190000, "2026-05": 300000, "2026-06": 240000 };
  for (const [m, v] of Object.entries(sal)) {
    d.transactions.push({ id: id++, account_id: 900, date: `${m}-28`, label: "VIR SALAIRE EMPLOYEUR", amount_cents: v, category_locked: 0 });
    d.transactions.push({ id: id++, account_id: 900, date: `${m}-05`, label: "CB CARREFOUR", amount_cents: -9000, category_locked: 0 });
  }
  d.transactions.push({ id: id++, account_id: 900, date: "2026-07-03", label: "CB CARREFOUR", amount_cents: -5000, category_locked: 0 });
  categorizeAll(d);
  const ref = incomeAnalysis(d, "2026-07").reference;
  assert.equal(ref.q25_cents, 217500);
  assert.equal(ref.prudent_cents, Math.round((1570000 / 6) * 0.8));
  assert.equal(ref.prudent_rule, "moyenne-20");
  const rem = insights(d, "2026-07").remaining;
  assert.equal(rem.expected_salary_cents, ref.prudent_cents);
});

test("CSV Trade Republic : frais séparés, montants arrondis, dividende = revenu", () => {
  const head = "datetime,date,account_type,category,type,asset_class,name,symbol,shares,price,amount,fee,tax,currency,original_amount,original_currency,fx_rate,description,transaction_id,counterparty_name,counterparty_iban,payment_reference,mcc_code";
  const row = (d, cat, type, amount, desc, fee = "", tax = "") => `${d}T10:00:00Z,${d},DEFAULT,${cat},${type},,,,,,${amount},${fee},${tax},EUR,,,,${desc},x,,,,`;
  const csv = [head, row("2026-03-03", "TRADING", "BUY", "-49.990000", "Buy trade", "-1.000000"),
    row("2026-03-07", "TRADING", "DIVIDEND", "4.200000", "Dividend", "", "-0.630000")].join("\n");
  const [st, info] = parseCsvStatement(new TextEncoder().encode("﻿" + csv));
  assert.equal(info.preset, "trade_republic");
  assert.deepEqual(st.transactions.map((t) => [t.amount_cents, t.hint]),
    [[-4999, "investissement"], [-100, "frais"], [420, "dividende"], [-63, "impot"]]);
});
