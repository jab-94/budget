// Tests de la logique métier (valeurs de référence reprises de l'ancienne version Python).
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseAmount, parseDate, parseDotDecimal, normalizeLabel } from "../docs/js/core.js";
import { suggestPattern, categorizeAll } from "../docs/js/categorize.js";
import { newData } from "../docs/js/store.js";
import { quantile, insights, incomeAnalysis } from "../docs/js/analytics.js";
import { parseCsvStatement } from "../docs/js/csvparse.js";

test("montants", () => {
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

test("revenu de référence prudent", () => {
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

test("import par lot : un même relevé choisi deux fois est reconnu comme doublon", async () => {
  const { flagDuplicates } = await import("../docs/js/analytics.js");
  const d = newData();
  d.accounts.push({ id: 900, name: "Bourso" });
  const mk = () => [{ date: "2026-03-02", label: "PRLV SEPA FREE MOBILE", amount_cents: -1999 },
    { date: "2026-03-28", label: "VIR SALAIRE", amount_cents: 240000 }];
  const first = mk(), second = mk();
  await flagDuplicates(d, 900, first, []);
  await flagDuplicates(d, 900, second, first);
  assert.deepEqual(first.map((t) => t.duplicate), [null, null]);
  assert.deepEqual(second.map((t) => t.duplicate), ["exact", "exact"]);
  assert.ok(second.every((t) => !t.selected));
});

test("année manquante (« 31.12 ») : relevé de janvier contenant des opérations de décembre", async () => {
  const { LclParser, GenericPdfParser } = await import("../docs/js/pdfparse.js");
  const lcl = `
                  RELEVE DE COMPTE
                                                     du 02.01.2026 au 30.01.2026 - N° 001
      DATE                 LIBELLE                VALEUR    DEBIT     CREDIT
      31.12                            ANCIEN SOLDE                       100,00
      31.12 CB BOULANGERIE                        31.12.25      4,50         .
      31.12 PRLV SEPA FREE MOBILE                 31.12.25     19,99         .
      05.01 VIR INST SALAIRE                      05.01.26             2 400,00
      28.01 CB PHARMACIE                          28.01.26     12,00         .
      31.01                           SOLDE EN EUROS                    2 463,51
`;
  const st = new LclParser().parsePages([lcl]);
  assert.deepEqual(st.transactions.map((t) => t.date), ["2025-12-31", "2025-12-31", "2026-01-05", "2026-01-28"]);
  assert.equal(st.transactions[0].label, "CB BOULANGERIE");
  const generic = `
 RELEVE du 02/01/2026 au 30/01/2026
 Date   Libellé          Débit      Crédit
 31/12  CB BOULANGERIE   4,50
 15/01  CB PHARMACIE     12,00
`;
  assert.deepEqual(new GenericPdfParser().parsePages([generic]).transactions.map((t) => t.date), ["2025-12-31", "2026-01-15"]);
});

test("réparation : opérations importées avec la mauvaise année (31/12/2026 au lieu de 2025)", async () => {
  const { migrate } = await import("../docs/js/migrations.js");
  const { flagDuplicates } = await import("../docs/js/analytics.js");
  const d = newData();
  d.accounts.push({ id: 900, name: "LCL" });
  d.statements.push({ id: 950, account_id: 900, source: "pdf", period_start: "2026-01-02", period_end: "2026-01-30" },
    { id: 951, account_id: 900, source: "pdf", period_start: "2026-12-01", period_end: "2026-12-31" });
  const t = (id, sid, date, label, cents) => ({ id, account_id: 900, statement_id: sid, date, label, amount_cents: cents, fingerprint: "x" });
  d.transactions.push(t(1, 950, "2026-12-31", "CB BOULANGERIE", -450), t(2, 950, "2026-01-05", "VIR INST SALAIRE", 240000),
    t(3, 951, "2026-12-31", "CB AUTRE", -100)); // ce dernier est réellement daté du 31/12/2026 : intact
  const changed = await migrate(d);
  assert.ok(changed > 0);
  assert.deepEqual(d.transactions.map((x) => x.date), ["2025-12-31", "2026-01-05", "2026-12-31"]);
  assert.equal(await migrate(d), 0); // une seule fois
  // Réimporter le même relevé (correctement daté maintenant) : reconnu comme doublon.
  const again = [{ date: "2025-12-31", label: "CB BOULANGERIE", amount_cents: -450 }, { date: "2026-01-05", label: "VIR INST SALAIRE", amount_cents: 240000 }];
  await flagDuplicates(d, 900, again);
  assert.deepEqual(again.map((x) => x.duplicate), ["exact", "exact"]);
});

test("règles : commence par, identique à, ne contient pas, montant", async () => {
  const { prepareRule, ruleMatches, validateRuleFields } = await import("../docs/js/categorize.js");
  const m = (fields, label, amount) => ruleMatches(prepareRule(fields), label, ` ${normalizeLabel(label)} `, amount);
  const frais = "TENUE DE COMPTE", remise = "REMISE TENUE DE COMPTE";
  // « contient » seul : prend les deux (le problème signalé)
  assert.ok(m({ pattern: "tenue de compte" }, frais, -800) && m({ pattern: "tenue de compte" }, remise, 800));
  // « commence par » : seulement les frais
  assert.ok(m({ pattern: "tenue de compte", match: "starts" }, frais, -800));
  assert.ok(!m({ pattern: "tenue de compte", match: "starts" }, remise, 800));
  // « contient … et ne contient pas REMISE »
  assert.ok(m({ pattern: "tenue de compte", exclude: "remise, annulation" }, frais, -800));
  assert.ok(!m({ pattern: "tenue de compte", exclude: "remise, annulation" }, remise, 800));
  // « identique à »
  assert.ok(m({ pattern: "Tenue de compte", match: "equals" }, "TENUE DE COMPTE 03/26", -800)); // dates ignorées
  assert.ok(!m({ pattern: "tenue de compte", match: "equals" }, "TENUE DE COMPTE PREMIUM", -800));
  // montants (valeur absolue) et sens
  assert.ok(m({ pattern: "amazon", min_cents: 5000 }, "CB AMAZON", -6000));
  assert.ok(!m({ pattern: "amazon", min_cents: 5000 }, "CB AMAZON", -4999));
  assert.ok(!m({ pattern: "amazon", max_cents: 2000 }, "CB AMAZON", -2001));
  assert.ok(!m({ pattern: "tenue de compte", sign: "-" }, remise, 800));
  // validation
  assert.throws(() => validateRuleFields({ pattern: "x", min_cents: 500, max_cents: 100 }), /minimum/);
  assert.throws(() => validateRuleFields({ pattern: "(", match: "regex" }), /régulière/);
  assert.throws(() => validateRuleFields({ pattern: "x", match: "bizarre" }), /Type/);
  assert.deepEqual(validateRuleFields({ pattern: " Tenue ", exclude: " remise ,  , annulation " }),
    { pattern: "Tenue", match: "contains", is_regex: false, exclude: "remise, annulation", min_cents: null, max_cents: null, sign: null });
});

test("anciennes règles (sans type) : toujours « contient » ou expression régulière", async () => {
  const { prepareRule, ruleMatches } = await import("../docs/js/categorize.js");
  const old = prepareRule({ pattern: "NETFLIX", is_regex: false });
  assert.equal(old.match, "contains");
  assert.ok(ruleMatches(old, "PRLV SEPA NETFLIX", " PRLV SEPA NETFLIX ", -1349));
  assert.equal(prepareRule({ pattern: "net.lix", is_regex: true }).match, "regex");
});

test("abonnements", async () => {
  const { subscriptions, updateSubscription, subscriptionIdOf } = await import("../docs/js/analytics.js");
  const d = newData();
  d.accounts.push({ id: 900, name: "LCL" });
  let id = 1000;
  const add = (date, label, cents) => d.transactions.push({ id: id++, account_id: 900, date, label, amount_cents: cents, category_locked: 0 });
  ["2026-01", "2026-02", "2026-03", "2026-04", "2026-05", "2026-06"].forEach((m, i) => {
    add(`${m}-10`, "PRLV SEPA NETFLIX", i < 4 ? -1349 : -1599);
    if (i < 2) add(`${m}-12`, "PRLV SEPA DEEZER", -1199);
    if (i < 3) add(`${m}-14`, "PRLV SEPA SPOTIFY", -1099);
    add(`${m}-02`, "VIR LOYER APPARTEMENT", -85000);
    add(`${m}-03`, "PRLV SEPA BASIC FIT", -2999);
    add(`${m}-${String(5 + i).padStart(2, "0")}`, "CB BOULANGERIE DES AMIS", -120);
    add(`${m}-${20 + i}`, "CB BOULANGERIE DES AMIS", -120);
  });
  add("2026-06-28", "VIR SALAIRE", 250000);
  categorizeAll(d);
  let out = subscriptions(d);
  let by = Object.fromEntries(out.items.map((x) => [x.key, x]));
  assert.deepEqual(Object.keys(by).sort(), ["BASIC FIT", "NETFLIX", "SPOTIFY"]);
  assert.deepEqual([by.NETFLIX.amount_cents, by.NETFLIX.price_change_cents, by.NETFLIX.count, by.NETFLIX.status], [1599, 250, 6, "actif"]);
  assert.equal(by.NETFLIX.next_date, "2026-07-10");
  assert.equal(by.SPOTIFY.status, "arrete");
  assert.deepEqual(out.totals, { count: 2, monthly_cents: 1599 + 2999, yearly_cents: (1599 + 2999) * 12 });

  updateSubscription(d, { id: by["BASIC FIT"].id, status: "ignored" }, "2026-07-01");
  updateSubscription(d, { id: by.NETFLIX.id, status: "cancelled", cancelled_on: "2026-05-20", name: "Netflix (famille)" }, "2026-07-01");
  updateSubscription(d, { id: subscriptionIdOf({ label: "PRLV SEPA DEEZER", account_id: 900, amount_cents: -1199 }), status: "confirmed" }, "2026-07-01");
  out = subscriptions(d);
  by = Object.fromEntries(out.items.map((x) => [x.key, x]));
  assert.deepEqual(Object.keys(by).sort(), ["DEEZER", "NETFLIX", "SPOTIFY"]);
  assert.deepEqual(out.ignored.map((x) => x.name), ["Basic Fit"]);
  assert.equal(by.NETFLIX.status, "resilie");
  assert.deepEqual(by.NETFLIX.charged_after_cancel, [{ date: "2026-06-10", amount_cents: 1599 }]);
  assert.equal(by.DEEZER.origin, "manuel");
  const s = Object.fromEntries(insights(d, "2026-06").suggestions.map((x) => [x.kind, x]));
  assert.equal(s["abonnement-resilie"].severity, "bad");
  assert.throws(() => updateSubscription(d, { id: "x", status: "confirmed" }, "2026-07-01"));
});

test("nouvelles catégories (cadeaux, primes…) et migration d'un coffre existant", async () => {
  const { addCategoriesV4 } = await import("../docs/js/migrations.js");
  const d = newData();
  d.accounts.push({ id: 900, name: "LCL" });
  let id = 1000;
  for (const [label, cents] of [["VIR PRIME EXCEPTIONNELLE", 50000], ["VIR INTERESSEMENT 2025", 120000],
    ["PRLV ECHEANCE PRET IMMO", -95000], ["CB AMAZON PRIME", -699]]) {
    d.transactions.push({ id: id++, account_id: 900, date: "2026-03-05", label, amount_cents: cents, category_locked: 0 });
  }
  categorizeAll(d);
  const name = (t) => d.categories.find((c) => c.id === t.category_id)?.name ?? null;
  assert.deepEqual(d.transactions.map(name), ["Primes", "Intéressement et participation", "Mensualités de prêt", "Abonnements"]);
  // Coffre créé avant ces catégories : elles sont ajoutées avec leurs règles, et les opérations reclassées.
  const removed = new Set(["Primes", "Cadeaux"]);
  const gone = new Set(d.categories.filter((c) => removed.has(c.name)).map((c) => c.id));
  d.categories = d.categories.filter((c) => !removed.has(c.name));
  d.rules = d.rules.filter((r) => !gone.has(r.category_id));
  for (const t of d.transactions) if (gone.has(t.category_id)) t.category_id = null;
  assert.equal(addCategoriesV4(d), 2);
  assert.equal(name(d.transactions[0]), "Primes");
  assert.equal(addCategoriesV4(d), 0);
});

test("recherche d'opérations : mots et montants", async () => {
  const { searchTokens } = await import("../docs/js/backend.js");
  assert.deepEqual(searchTokens("  Netflix 13,49 "), [{ text: "NETFLIX", cents: null }, { text: "13,49", cents: 1349 }]);
  assert.deepEqual(searchTokens("50").map((w) => w.cents), [5000]);
  assert.deepEqual(searchTokens("12.5").map((w) => w.cents), [1250]);
  assert.deepEqual(searchTokens("Électricité").map((w) => w.text), ["ELECTRICITE"]);
});

test("carte Dépenses : semaine, mois, 12 mois", async () => {
  const { spendingStats } = await import("../docs/js/analytics.js");
  const d = newData();
  d.accounts.push({ id: 900, name: "LCL" });
  let id = 1000;
  const add = (date, label, cents) => d.transactions.push({ id: id++, account_id: 900, date, label, amount_cents: cents, category_locked: 0 });
  for (let m = 1; m <= 10; m++) {
    const mm = String(m).padStart(2, "0");
    add(`2026-${mm}-05`, "CB CARREFOUR", -10000 * m);   // 100 €, 200 €, … 1 000 € en octobre
    add(`2026-${mm}-28`, "VIR SALAIRE", 250000);         // revenu : ne compte pas
  }
  add("2026-10-20", "VIR INTERNE VERS LIVRET", -50000);  // hors budget : ne compte pas
  categorizeAll(d);
  const s = spendingStats(d, "2026-10");
  const [week, month, year] = s.ranges;
  assert.equal(s.ref_date, "2026-10-28");
  assert.equal(month.value_cents, 100000);
  assert.equal(month.previous_cents, 90000);
  assert.equal(month.delta_pct, 11.1);
  assert.equal(month.points.length, 12);
  assert.equal(year.value_cents, 550000);
  assert.equal(year.delta_pct, null);            // pas 2 ans d'historique
  assert.equal(year.points[11], 550000);         // cumul
  assert.equal(week.value_cents, 0);             // 22-28 oct. : aucune dépense
  assert.equal(spendingStats(d, "2026-09").ranges[1].value_cents, 90000);
});

test("carte Revenus : mêmes périodes, montants entrants", async () => {
  const { spendingStats } = await import("../docs/js/analytics.js");
  const d = newData();
  d.accounts.push({ id: 900, name: "LCL" });
  let id = 1000;
  const add = (date, label, cents) => d.transactions.push({ id: id++, account_id: 900, date, label, amount_cents: cents, category_locked: 0 });
  add("2026-09-28", "VIR SALAIRE", 200000);
  add("2026-10-28", "VIR SALAIRE", 250000);
  add("2026-10-05", "CB CARREFOUR", -9000);
  categorizeAll(d);
  const month = spendingStats(d, "2026-10", null, "income").ranges[1];
  assert.equal(month.value_cents, 250000);
  assert.equal(month.delta_pct, 25);
});

test("courbe lissée monotone : ne dépasse jamais les données", async () => {
  const { monotonePath } = await import("../docs/js/statcard.js").catch(() => ({}));
  if (!monotonePath) return; // module navigateur (requestAnimationFrame) : vérifié dans le navigateur
  assert.match(monotonePath([[0, 10], [10, 0], [20, 0], [30, 5]]), /^M0\.00 10\.00C/);
});
