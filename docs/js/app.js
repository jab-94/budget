// Budget local — front en JavaScript simple, sans aucune bibliothèque.
// Toutes les requêtes partent vers des chemins RELATIFS ("/api/...") : la
// Content-Security-Policy interdit de toute façon toute autre destination.
import * as cloud from "./cloud.js";
import { ApiError, exportBackup, exportCsv, handle } from "./backend.js";
import { MIN_PASSWORD_LENGTH, store, WrongPassword } from "./store.js";

/** Même interface que l'ancienne API serveur, mais tout se passe dans le navigateur. */
async function api(path, options = {}) {
  const method = options.method || (options.body || options.raw ? "POST" : "GET");
  try {
    return await handle(method, path, options.body ? JSON.parse(JSON.stringify(options.body)) : null, options.raw || null);
  } catch (e) {
    if (e instanceof ApiError) {
      if (e.status === 423) refresh();
      const err = new Error(e.detail);
      err.status = e.status;
      throw err;
    }
    console.error(e);
    throw new Error(e && e.message ? e.message : "Erreur inattendue.");
  }
}

// ---------- Petits utilitaires ----------
const $ = (id) => document.getElementById(id);

function el(tag, attrs = {}, ...children) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === null || v === false) continue;
    if (k === "style") e.style.cssText = v;
    else if (k.startsWith("on")) e.addEventListener(k.slice(2), v);
    else if (k in e && typeof v !== "string") e[k] = v;
    else e.setAttribute(k, v);
  }
  for (const c of children) {
    if (c === null || c === undefined) continue;
    e.append(c instanceof Node ? c : document.createTextNode(String(c))); // jamais d'injection HTML
  }
  return e;
}

const EUR = new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR" });
const money = (cents) => EUR.format(cents / 100);
const DATE_FR = new Intl.DateTimeFormat("fr-FR", { day: "2-digit", month: "2-digit", year: "numeric" });
const dateFr = (iso) => DATE_FR.format(new Date(iso + "T12:00:00"));

/** « 1 234,56 » -> 123456 ; renvoie null si illisible. */
function parseEuros(text) {
  let s = String(text || "").trim().replace(/[\s  €]/g, "");
  if (!s) return null;
  let neg = false;
  if (s.startsWith("-")) { neg = true; s = s.slice(1); } else if (s.startsWith("+")) s = s.slice(1);
  if (s.includes(",") && s.includes(".")) s = s.replace(/\./g, "").replace(",", ".");
  else s = s.replace(",", ".");
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return null;
  const [w, d = ""] = s.split(".");
  const cents = parseInt(w, 10) * 100 + parseInt((d + "00").slice(0, 2), 10);
  return neg ? -cents : cents;
}
const centsToInput = (c) => (c === null || c === undefined ? "" : (c / 100).toFixed(2).replace(".", ","));

// ---------- État ----------
let status = null;
let accounts = [];
let currentTab = "dashboard";

let user = null;
let peek = null;

async function refresh() {
  status = { unlocked: store.unlocked, auto_lock_minutes: 15, min_password_length: MIN_PASSWORD_LENGTH };
  if (store.unlocked) return showApp();
  showLock();
}

function showLock() {
  for (const s of document.querySelectorAll(".tab")) s.hidden = true;
  document.body.classList.add("locked");
  $("tabs").hidden = true;
  $("lock-btn").hidden = true;
  $("lock-screen").hidden = false;
  $("login-form").hidden = Boolean(user);
  $("vault-box").hidden = !user;
  if (!user) { $("login-email").focus(); return; }
  $("who").textContent = user.email || "";
  const creating = peek && !peek.exists;
  $("lock-title").textContent = creating ? "Créer votre coffre" : "Déverrouiller";
  $("lock-intro").textContent = creating
    ? "Vos données seront chiffrées sur cet appareil avec ce mot de passe, avant tout envoi. " +
      "Choisissez-le DIFFÉRENT de celui du compte. S'il est oublié, les données sont perdues définitivement."
    : "Entrez le mot de passe du coffre pour le déchiffrer sur cet appareil.";
  $("pw2-wrap").hidden = !creating;
  $("pw-help").hidden = !creating;
  $("pw-help").textContent = `Au moins ${MIN_PASSWORD_LENGTH} caractères. Idéal : une phrase de 4 ou 5 mots.`;
  $("lock-submit").textContent = creating ? "Créer le coffre" : "Ouvrir";
  const w = $("lock-warnings");
  w.replaceChildren();
  if (peek && peek.offline) {
    w.append(el("p", { class: "warning" }, peek.exists
      ? "Hors connexion : ouverture de la copie chiffrée gardée sur cet appareil. Les modifications seront envoyées au retour du réseau."
      : "Hors connexion : impossible de vérifier votre coffre en ligne. Reconnectez-vous à Internet."));
  }
  $("pw").focus();
}

$("login-form").addEventListener("submit", async (ev) => {
  ev.preventDefault();
  $("login-error").textContent = "";
  $("login-submit").disabled = true;
  try {
    await cloud.login($("login-email").value.trim(), $("login-pw").value);
    $("login-pw").value = "";
  } catch (e) {
    $("login-error").textContent = e.message;
  } finally {
    $("login-submit").disabled = false;
  }
});

$("logout-btn").addEventListener("click", async () => {
  store.lock();
  await cloud.cacheClear();
  await cloud.logout();
});

$("lock-form").addEventListener("submit", async (ev) => {
  ev.preventDefault();
  const creating = peek && !peek.exists;
  const pw = $("pw").value;
  $("lock-error").textContent = "";
  if (creating && pw !== $("pw2").value) { $("lock-error").textContent = "Les deux mots de passe ne correspondent pas."; return; }
  if (creating && peek.offline) { $("lock-error").textContent = "Connectez-vous à Internet pour créer le coffre."; return; }
  $("lock-submit").disabled = true;
  $("lock-submit").textContent = creating ? "Création…" : "Déchiffrement…";
  try {
    if (creating) await store.create(user.uid, pw);
    else await store.unlock(user.uid, pw, peek.remote);
    $("pw").value = ""; $("pw2").value = "";
    await refresh();
  } catch (e) {
    $("lock-error").textContent = e instanceof WrongPassword ? "Mot de passe du coffre incorrect." : e.message;
  } finally {
    $("lock-submit").disabled = false;
    if (!store.unlocked) $("lock-submit").textContent = creating ? "Créer le coffre" : "Ouvrir";
  }
});

$("lock-btn").addEventListener("click", async () => {
  resetImport();
  store.lock();
  if (window.__updateReady) { location.reload(); return; }
  peek = await store.peek(user.uid);
  await refresh();
});

// Verrouillage automatique après 15 minutes d'inactivité, même sans action.
setInterval(() => {
  if (store.unlocked && Date.now() - store.lastActivity > 15 * 60 * 1000) { store.lock(); refresh(); }
}, 30000);

// ---------- Application ----------
async function showApp() {
  document.body.classList.remove("locked");
  $("lock-screen").hidden = true;
  $("lock-btn").hidden = false;
  $("tabs").hidden = false;
  await loadAccounts();
  if (!accounts.length) currentTab = "accounts";
  showTab(currentTab);
}

function showTab(name) {
  currentTab = name;
  for (const b of document.querySelectorAll("#tabs button")) b.classList.toggle("active", b.dataset.tab === name);
  for (const s of document.querySelectorAll(".tab")) s.hidden = s.id !== "tab-" + name;
  if (name === "ops") loadOps();
  if (name === "categories") loadCategoriesTab();
  if (name === "dashboard") loadDashboard();
  if (name === "budgets") loadBudgetsTab();
  if (name === "insights") loadInsightsTab();
  if (name === "income") loadIncomeTab();
  window.scrollTo(0, 0);
}
for (const b of document.querySelectorAll("#tabs button")) b.addEventListener("click", () => showTab(b.dataset.tab));
// Boutons « Importer », « Gérer »… qui mènent à une autre page.
document.addEventListener("click", (ev) => {
  const b = ev.target.closest("[data-goto]");
  if (b) showTab(b.dataset.goto);
});

// ---------- Thème clair / sombre / auto (préférence d'affichage gardée dans ce navigateur) ----------
function applyThemeChoice(choice) {
  if (choice === "light" || choice === "dark") document.documentElement.dataset.theme = choice;
  else delete document.documentElement.dataset.theme;
  try {
    if (choice === "auto") localStorage.removeItem("theme"); else localStorage.setItem("theme", choice);
  } catch (_) { /* stockage indisponible : le choix vaut pour cette session */ }
  for (const b of document.querySelectorAll("[data-theme-choice]")) b.classList.toggle("active", b.dataset.themeChoice === choice);
}
for (const b of document.querySelectorAll("[data-theme-choice]")) {
  b.addEventListener("click", () => applyThemeChoice(b.dataset.themeChoice));
}
applyThemeChoice(document.documentElement.dataset.theme || "auto");

let categories = [];
const KIND_GROUP = { expense: "Dépenses", income: "Revenus", transfer: "Hors budget" };

/** Options de catégories groupées par type (Dépenses / Revenus / Hors budget). */
function categoryOptions(selectedId, extra = []) {
  const groups = Object.entries(KIND_GROUP).map(([kind, label]) => el("optgroup", { label },
    ...categories.filter((c) => c.kind === kind).map((c) =>
      el("option", { value: c.id, selected: c.id === selectedId }, c.name))));
  return [...extra, ...groups];
}

async function loadCategories() {
  categories = await api("/api/categories");
  const keep = $("ops-category").value;
  $("ops-category").replaceChildren(...categoryOptions(null, [
    el("option", { value: "" }, "Toutes catégories"), el("option", { value: "none" }, "À classer")]));
  $("ops-category").value = keep;
  $("rule-category").replaceChildren(...categoryOptions(null));
}

async function loadAccounts() {
  await loadCategories();
  accounts = await api("/api/accounts");
  const opts = () => accounts.map((a) => el("option", { value: a.id }, a.name));
  // On garde le compte sélectionné dans chaque liste (sinon un réimport partirait sur le mauvais compte).
  const fill = (id, extra = []) => {
    const keep = $(id).value;
    $(id).replaceChildren(...extra, ...opts());
    if ([...$(id).options].some((o) => o.value === keep)) $(id).value = keep;
  };
  fill("ops-account", [el("option", { value: "" }, "Tous les comptes")]);
  fill("m-account");
  fill("i-account");
  renderAccounts();
}

// ---------- Comptes ----------
const KIND_LABEL = { courant: "Compte courant", joint: "Compte joint", epargne: "Épargne", investissement: "Investissement" };

function renderAccounts() {
  $("acc-empty").hidden = accounts.length > 0;
  $("acc-list").replaceChildren(...accounts.map((a) => el("li", {},
    el("div", {},
      el("strong", {}, a.name), " ",
      el("span", { class: "muted small" }, [a.bank, KIND_LABEL[a.kind]].filter(Boolean).join(" · ")),
      el("div", { class: "muted small" }, a.tx_count
        ? `${a.tx_count} opération(s), du ${dateFr(a.first_date)} au ${dateFr(a.last_date)}`
        : "Aucune opération")),
    el("button", { class: "ghost small-btn", onclick: () => deleteAccount(a) }, "Supprimer"))));
}

async function deleteAccount(a) {
  const msg = a.tx_count
    ? `Supprimer « ${a.name} » et ses ${a.tx_count} opération(s) ? C'est irréversible.`
    : `Supprimer « ${a.name} » ?`;
  if (!confirm(msg)) return;
  await api(`/api/accounts/${a.id}`, { method: "DELETE" });
  await loadAccounts();
}

$("acc-form").addEventListener("submit", async (ev) => {
  ev.preventDefault();
  try {
    await api("/api/accounts", { body: { name: $("acc-name").value, bank: $("acc-bank").value, kind: $("acc-kind").value } });
    $("acc-name").value = "";
    await loadAccounts();
  } catch (e) { alert(e.message); }
});

$("wipe-btn").addEventListener("click", async () => {
  const answer = prompt("Pour tout effacer définitivement, tapez SUPPRIMER :");
  if (answer !== "SUPPRIMER") return;
  await api("/api/data/wipe", { method: "POST" });
  resetImport();
  currentTab = "accounts";
  await showApp();
});

// ---------- Opérations ----------
$("ops-account").addEventListener("change", loadOps);
$("ops-category").addEventListener("change", loadOps);
$("ops-month").addEventListener("change", loadOps);

async function loadOps() {
  const p = new URLSearchParams();
  if ($("ops-account").value) p.set("account_id", $("ops-account").value);
  if ($("ops-month").value) p.set("month", $("ops-month").value);
  if ($("ops-category").value) p.set("category", $("ops-category").value);
  const rows = await api(`/api/transactions?${p}`);
  const income = rows.filter((r) => r.amount_cents > 0).reduce((s, r) => s + r.amount_cents, 0);
  const spent = rows.filter((r) => r.amount_cents < 0).reduce((s, r) => s + r.amount_cents, 0);
  $("ops-summary").textContent = rows.length
    ? `${rows.length} opération(s) · entrées ${money(income)} · sorties ${money(spent)}`
    : "";
  $("ops-empty").hidden = rows.length > 0;
  $("ops-body").replaceChildren(...rows.map((r) => el("tr", {},
    el("td", { class: "nowrap desktop-only" }, dateFr(r.date)),
    el("td", {}, r.label, el("div", { class: "muted small" }, r.account, r.hint ? " · " : "", r.hint ? HINT_LABEL[r.hint] || r.hint : ""),
      // Sur téléphone, la date et la catégorie passent sous le libellé (colonnes masquées).
      el("div", { class: "mobile-only" }, el("span", { class: "muted small" }, dateFr(r.date)), categoryChip(r))),
    el("td", { class: "desktop-only" }, categoryChip(r)),
    el("td", { class: "num nowrap " + (r.amount_cents < 0 ? "neg" : "pos") }, money(r.amount_cents)),
    el("td", {}, el("button", {
      class: "icon-btn", title: "Supprimer", "aria-label": "Supprimer",
      onclick: async () => {
        if (!confirm("Supprimer cette opération ?")) return;
        await api(`/api/transactions/${r.id}`, { method: "DELETE" });
        loadOps(); loadAccounts();
      },
    }, "×")))));
}

$("m-date").value = new Date().toISOString().slice(0, 10);
$("manual-form").addEventListener("submit", async (ev) => {
  ev.preventDefault();
  const cents = parseEuros($("m-amount").value);
  if (cents === null) { $("m-msg").textContent = "Montant illisible."; return; }
  try {
    await api("/api/transactions", { body: {
      account_id: Number($("m-account").value), date: $("m-date").value,
      label: $("m-label").value, amount_cents: Math.abs(cents) * Number($("m-sign").value),
    } });
    $("m-label").value = ""; $("m-amount").value = "";
    $("m-msg").textContent = "Ajoutée.";
    loadOps(); loadAccounts();
  } catch (e) { $("m-msg").textContent = e.message; }
});

// ---------- Import ----------
let imp = null; // { file, fmt, parser, mapping, preview, rows }

function resetImport() {
  imp = null;
  $("i-file").value = "";
  $("i-options").hidden = true;
  $("i-review").hidden = true;
  $("i-batch").hidden = true;
  $("i-balances").hidden = false;
  $("i-error").textContent = "";
}

const fmtOf = (f) => (/\.pdf$/i.test(f.name) || f.type === "application/pdf" ? "pdf" : "csv");

$("i-file").addEventListener("change", () => {
  const files = [...$("i-file").files];
  if (!files.length) return;
  if (files.length === 1) {
    imp = { file: files[0], fmt: fmtOf(files[0]), parser: null, mapping: null };
    runPreview();
  } else {
    imp = { batch: true, files };
    runBatchPreview();
  }
});
$("i-account").addEventListener("change", () => { if (imp) (imp.batch ? runBatchPreview() : runPreview()); });
$("i-parser").addEventListener("change", () => { imp.parser = $("i-parser").value; runPreview(); });
$("i-remap").addEventListener("click", () => {
  const m = {};
  for (const s of $("i-mapping").querySelectorAll("select")) if (s.value) m[s.dataset.field] = s.value;
  imp.mapping = m;
  runPreview();
});
$("i-cancel").addEventListener("click", resetImport);

async function runPreview() {
  $("i-error").textContent = "";
  if (!$("i-account").value) { $("i-error").textContent = "Créez d'abord un compte (onglet Comptes)."; return; }
  const p = new URLSearchParams({ account_id: $("i-account").value, fmt: imp.fmt });
  if (imp.parser) p.set("parser", imp.parser);
  if (imp.mapping) p.set("mapping", JSON.stringify(imp.mapping));
  try {
    const buf = await imp.file.arrayBuffer();
    imp.preview = await api(`/api/import/preview?${p}`, { raw: buf });
  } catch (e) {
    $("i-error").textContent = e.message;
    $("i-review").hidden = true;
    return;
  }
  imp.rows = imp.preview.transactions;
  await renderImportOptions();
  renderReview();
}

const MAP_FIELDS = [["date", "Date"], ["label", "Libellé"], ["amount", "Montant (signé)"], ["debit", "Débit"], ["credit", "Crédit"]];

async function renderImportOptions() {
  const pv = imp.preview;
  $("i-options").hidden = false;
  $("i-pdf-opts").hidden = imp.fmt !== "pdf";
  $("i-csv-opts").hidden = imp.fmt !== "csv";
  if (imp.fmt === "pdf") {
    const parsers = await api("/api/import/parsers");
    $("i-parser").replaceChildren(...parsers.map((x) => el("option", { value: x.name, selected: x.name === pv.parser }, x.label)));
  } else {
    const info = pv.csv || {};
    $("i-preset").textContent = info.preset_label ? `✓ Format reconnu : ${info.preset_label}` : "Format non reconnu automatiquement.";
    // Format reconnu : le choix manuel des colonnes est replié (et contournerait le lecteur dédié).
    $("i-map-box").open = !info.preset || Boolean(imp.mapping);
    $("i-mapping").replaceChildren(...MAP_FIELDS.map(([field, label]) => el("label", {}, label,
      el("select", { "data-field": field },
        el("option", { value: "" }, "—"),
        ...(info.headers || []).map((h) => el("option", { value: h, selected: (info.mapping || {})[field] === h }, h))))));
  }
}

function renderReview() {
  const pv = imp.preview;
  $("i-review").hidden = false;
  $("i-batch").hidden = true;
  $("i-balances").hidden = false;
  $("i-open").value = centsToInput(pv.opening_balance_cents);
  $("i-close").value = centsToInput(pv.closing_balance_cents);
  $("i-warnings").replaceChildren(...pv.warnings.map((w) => el("p", { class: "warning" }, w)));
  renderRows();
}

const HINT_LABEL = {
  investissement: "Investissement", dividende: "Dividende", interets: "Intérêts", impot: "Impôt / taxe",
  frais: "Frais", carte: "Carte", virement: "Virement",
};
const hintTag = (h) => el("span", { class: "tag tag-hint" }, HINT_LABEL[h] || h);

// ----- Plusieurs relevés d'un coup -----
const shortName = (n) => (n.length > 34 ? n.slice(0, 31) + "…" : n);
const periodLabel = (st) => (st.period_start && st.period_end
  ? `du ${dateFr(st.period_start)} au ${dateFr(st.period_end)}` : "période inconnue");

async function runBatchPreview() {
  $("i-error").textContent = "";
  if (!$("i-account").value) { $("i-error").textContent = "Créez d'abord un compte (onglet Comptes)."; return; }
  $("i-error").replaceChildren(el("span", { class: "muted" }, `Lecture de ${imp.files.length} fichiers…`));
  try {
    const files = await Promise.all(imp.files.map(async (f) => ({ name: f.name, fmt: fmtOf(f), bytes: await f.arrayBuffer() })));
    files.onProgress = (i, n) => {
      $("i-error").replaceChildren(el("span", { class: "muted" }, `Lecture des relevés… ${i + 1} / ${n}`));
    };
    const res = await api(`/api/import/preview-batch?account_id=${encodeURIComponent($("i-account").value)}`, { raw: files });
    imp.statements = res.statements;
  } catch (e) {
    $("i-error").textContent = e.message;
    $("i-review").hidden = true;
    return;
  }
  $("i-error").textContent = "";
  imp.rows = imp.statements.flatMap((st, i) => st.transactions.map((t) => Object.assign(t, { _st: i })));
  $("i-options").hidden = true;
  $("i-balances").hidden = true;
  $("i-batch").hidden = false;
  $("i-review").hidden = false;
  $("i-warnings").replaceChildren(...imp.statements.flatMap((st) => (st.warnings || []).map((w) =>
    el("p", { class: "warning" }, `${shortName(st.name)} : ${w}`))));
  renderRows();
}

/** Récapitulatif par relevé : cohérence (recalculée en direct) et continuité entre relevés. */
function renderBatchSummary() {
  let ok = 0, checked = 0;
  const rows = imp.statements.map((st, i) => {
    if (st.error) {
      return el("tr", {}, el("td", {}, shortName(st.name)), el("td", { colspan: 3, class: "error" }, `✕ ${st.error}`));
    }
    const mine = imp.rows.filter((t) => t._st === i);
    const sum = mine.reduce((s, t) => s + t.amount_cents, 0);
    let coh;
    if (st.opening_balance_cents === null || st.closing_balance_cents === null) coh = el("span", { class: "muted" }, "soldes non trouvés");
    else {
      checked++;
      const diff = st.opening_balance_cents + sum - st.closing_balance_cents;
      if (diff === 0) ok++;
      coh = diff === 0 ? el("span", { class: "pill pill-good" }, "✓ Cohérent") : el("span", { class: "pill pill-bad" }, `✕ Écart ${money(diff)}`);
    }
    const cont = st.duplicate_of
      ? el("div", { class: "small muted" }, `Même relevé que « ${shortName(st.duplicate_of)} » : ses opérations sont décochées.`)
      : st.continuity && st.continuity.status === "gap"
        ? el("div", { class: "small trend-up" }, `⚠ ne suit pas le relevé précédent (${money(st.continuity.diff_cents)}) : relevé manquant ?`) : null;
    const sel = mine.filter((t) => t.selected).length;
    return el("tr", {},
      el("td", {}, shortName(st.name), el("div", { class: "muted small" }, periodLabel(st))),
      el("td", { class: "num nowrap" }, `${sel} / ${mine.length}`),
      el("td", {}, coh, cont));
  });
  const errors = imp.statements.filter((st) => st.error).length;
  const gaps = imp.statements.filter((st) => st.continuity && st.continuity.status === "gap").length;
  const twins = imp.statements.filter((st) => st.duplicate_of).length;
  $("i-batch").replaceChildren(
    el("p", { class: ok === checked && !gaps && !errors ? "ok-box" : "warning" },
      `${imp.statements.length} relevés · ${ok}/${checked} cohérents` + (gaps ? ` · ${gaps} rupture(s) entre relevés` : "") +
      (errors ? ` · ${errors} fichier(s) illisible(s)` : "") + (twins ? ` · ${twins} relevé(s) en double` : "")),
    el("div", { class: "table-wrap" }, el("table", { class: "tx" },
      el("thead", {}, el("tr", {}, el("th", {}, "Relevé"), el("th", { class: "num" }, "À enregistrer"), el("th", {}, "Contrôle"))),
      el("tbody", {}, ...rows))));
}

function renderRows() {
  $("i-body").replaceChildren(...imp.rows.map((t) => {
    const tags = [];
    if (imp.batch) tags.push(el("span", { class: "tag tag-dup" }, shortName(imp.statements[t._st].name)));
    if (t.duplicate === "exact") tags.push(el("span", { class: "tag tag-dup" }, "Déjà importée"));
    if (t.duplicate === "probable") tags.push(el("span", { class: "tag tag-warn" }, "Doublon probable"));
    if (t.uncertain_sign) tags.push(el("span", { class: "tag tag-warn" }, "Sens deviné"));
    if (t.hint) tags.push(hintTag(t.hint));
    return el("tr", { class: t.selected ? "" : "dimmed" },
      el("td", {}, el("input", { type: "checkbox", checked: t.selected, "aria-label": "Importer cette ligne",
        onchange: (ev) => { t.selected = ev.target.checked; ev.target.closest("tr").classList.toggle("dimmed", !t.selected); updateCounts(); } })),
      el("td", { class: "nowrap" }, dateFr(t.date)),
      el("td", {}, t.label, tags.length ? el("div", { class: "tags" }, ...tags) : null),
      el("td", { class: "num nowrap " + (t.amount_cents < 0 ? "neg" : "pos") }, money(t.amount_cents)),
      el("td", {}, el("button", { class: "icon-btn", title: "Inverser débit / crédit", "aria-label": "Inverser le sens",
        onclick: () => { t.amount_cents = -t.amount_cents; t.uncertain_sign = false; renderRows(); } }, "±")));
  }));
  $("i-all").checked = imp.rows.length > 0 && imp.rows.every((t) => t.selected);
  updateCounts();
}

$("i-all").addEventListener("change", (ev) => {
  for (const t of imp.rows) t.selected = ev.target.checked;
  renderRows();
});
$("i-open").addEventListener("input", updateCounts);
$("i-close").addEventListener("input", updateCounts);

function updateCounts() {
  const sel = imp.rows.filter((t) => t.selected);
  const dups = imp.rows.filter((t) => t.duplicate).length;
  $("i-counts").textContent = `${imp.rows.length} ligne(s) lue(s) · ${sel.length} à enregistrer` +
    (dups ? ` · ${dups} doublon(s) décoché(s) d'office` : "");
  $("i-commit").textContent = `Enregistrer ${sel.length} opération(s)`;
  $("i-commit").disabled = sel.length === 0;
  if (imp.batch) { $("i-coherence").replaceChildren(); renderBatchSummary(); return; }

  // Contrôle de cohérence : solde début + TOUTES les opérations du relevé = solde fin.
  const open = parseEuros($("i-open").value), close = parseEuros($("i-close").value);
  const sum = imp.rows.reduce((s, t) => s + t.amount_cents, 0);
  const box = $("i-coherence");
  if (open === null || close === null) {
    box.replaceChildren(el("p", { class: "info" },
      `Total des opérations lues : ${money(sum)}. Renseignez les soldes de début et de fin pour vérifier qu'il ne manque rien.`));
  } else {
    const diff = open + sum - close;
    box.replaceChildren(diff === 0
      ? el("p", { class: "ok-box" }, `✓ Cohérent : ${money(open)} + ${money(sum)} = ${money(close)}`)
      : el("p", { class: "warning" }, `Écart de ${money(diff)} : ${money(open)} + ${money(sum)} ≠ ${money(close)}. ` +
          "Une opération manque, est en trop, ou a un mauvais sens (bouton ±)."));
  }
}

$("i-commit").addEventListener("click", async () => {
  const sel = imp.rows.filter((t) => t.selected);
  $("i-commit").disabled = true;
  if (imp.batch) {
    try {
      const r = await api("/api/import/commit-batch", { body: {
        account_id: Number($("i-account").value),
        statements: imp.statements.filter((st) => !st.error).map((st) => {
          const i = imp.statements.indexOf(st);
          return { source: st.fmt, period_start: st.period_start, period_end: st.period_end,
            opening_balance_cents: st.opening_balance_cents, closing_balance_cents: st.closing_balance_cents,
            transactions: sel.filter((t) => t._st === i).map((t) => ({ date: t.date, label: t.label, amount_cents: t.amount_cents,
              fingerprint: t.fingerprint, hint: t.hint })) };
        }),
      } });
      resetImport();
      $("i-error").replaceChildren(el("span", { class: "ok-text" }, `${r.inserted} opération(s) enregistrée(s), ${r.statements} relevé(s).`));
      await loadAccounts();
    } catch (e) {
      $("i-error").textContent = e.message;
      $("i-commit").disabled = false;
    }
    return;
  }
  try {
    const r = await api("/api/import/commit", { body: {
      account_id: Number($("i-account").value), source: imp.fmt,
      period_start: imp.preview.period_start, period_end: imp.preview.period_end,
      opening_balance_cents: parseEuros($("i-open").value), closing_balance_cents: parseEuros($("i-close").value),
      transactions: sel.map((t) => ({ date: t.date, label: t.label, amount_cents: t.amount_cents, fingerprint: t.fingerprint, hint: t.hint })),
    } });
    resetImport();
    $("i-error").replaceChildren(el("span", { class: "ok-text" }, `${r.inserted} opération(s) enregistrée(s).`));
    await loadAccounts();
  } catch (e) {
    $("i-error").textContent = e.message;
    $("i-commit").disabled = false;
  }
});

// ---------- Catégorisation ----------
const SOURCE_LABEL = {
  manuel: "classée à la main", regle: "par une de vos règles", "virement-interne": "virement entre vos comptes",
  source: "d'après la banque", defaut: "règle par défaut",
};

function categoryChip(r) {
  const label = r.category || "À classer";
  return el("button", {
    class: "chip" + (r.category ? "" : " chip-empty") + (r.category_locked ? " chip-locked" : ""),
    style: r.category_color ? `--dot:${r.category_color}` : "",
    title: r.category_source ? `Classement : ${SOURCE_LABEL[r.category_source] || r.category_source}. Cliquer pour changer.` : "Cliquer pour classer",
    onclick: () => openCategoryDialog(r),
  }, label);
}

let cdTx = null;

const MATCH_LABEL = { contains: "contient", starts: "commence par", equals: "est identique à", regex: "correspond à l'expression" };

/** Champs d'une règle lus dans un formulaire (préfixe « rule » ou « cd »). Montants en centimes. */
function ruleFields(prefix) {
  const cents = (id) => {
    const v = $(`${prefix}-${id}`).value.trim();
    if (!v) return null;
    const c = parseEuros(v);
    if (c === null || c < 0) throw new Error("Montant illisible.");
    return c;
  };
  return { pattern: $(`${prefix}-pattern`).value.trim(), match: $(`${prefix}-match`).value,
    exclude: $(`${prefix}-exclude`).value.trim() || null, sign: $(`${prefix}-sign`).value || null,
    min_cents: cents("min"), max_cents: cents("max") };
}

/** « commence par « TENUE DE COMPTE » · sauf REMISE · dépenses seulement · de 5,00 € à 20,00 € » */
function describeRule(r) {
  const parts = [`${MATCH_LABEL[r.match] || "contient"} « ${r.pattern} »`];
  if (r.exclude) parts.push(`sauf « ${r.exclude} »`);
  if (r.sign) parts.push(r.sign === "+" ? "revenus seulement" : "dépenses seulement");
  if (r.min_cents != null && r.max_cents != null) parts.push(`de ${money(r.min_cents)} à ${money(r.max_cents)}`);
  else if (r.min_cents != null) parts.push(`à partir de ${money(r.min_cents)}`);
  else if (r.max_cents != null) parts.push(`jusqu'à ${money(r.max_cents)}`);
  return parts.join(" · ");
}
let previewTimer = null;

function debouncedPreview(fn) {
  clearTimeout(previewTimer);
  previewTimer = setTimeout(fn, 250);
}

async function openCategoryDialog(r) {
  cdTx = r;
  $("cd-label").textContent = `${dateFr(r.date)} · ${r.label} · ${money(r.amount_cents)}`;
  $("cd-category").replaceChildren(...categoryOptions(r.category_id, r.category_id ? [] : [el("option", { value: "" }, "— choisir —")]));
  $("cd-error").textContent = "";
  $("cd-auto").hidden = !r.category_locked;
  $("cd-make-rule").checked = true;
  $("cd-rule-box").hidden = false;
  $("cd-pattern").value = "";
  $("cd-match").value = "contains";
  $("cd-exclude").value = ""; $("cd-sign").value = ""; $("cd-min").value = ""; $("cd-max").value = "";
  $("cd-more").open = false;
  $("cd-preview").textContent = "";
  $("cat-dialog").showModal();
  const s = await api(`/api/transactions/${r.id}/suggest`);
  $("cd-pattern").value = s.pattern;
  updateDialogPreview();
}

async function updateDialogPreview() {
  if (!$("cd-make-rule").checked || !$("cd-pattern").value.trim()) { $("cd-preview").textContent = ""; return; }
  try {
    const p = await api("/api/rules/preview", { body: ruleFields("cd") });
    $("cd-preview").textContent = p.count
      ? `${p.count} opération(s) correspondent` + (p.locked ? ` (dont ${p.locked} classée(s) à la main, qui ne bougeront pas)` : "") +
        (p.samples.length ? ` — ex. : ${p.samples.slice(0, 3).join(" ; ")}` : "")
      : "Aucune opération existante ne correspond (la règle servira aux prochains imports).";
  } catch (e) { $("cd-preview").textContent = e.message; }
}

$("cd-make-rule").addEventListener("change", () => {
  $("cd-rule-box").hidden = !$("cd-make-rule").checked;
  updateDialogPreview();
});
for (const id of ["cd-pattern", "cd-exclude", "cd-min", "cd-max"]) $(id).addEventListener("input", () => debouncedPreview(updateDialogPreview));
for (const id of ["cd-match", "cd-sign"]) $(id).addEventListener("change", () => debouncedPreview(updateDialogPreview));
$("cd-cancel").addEventListener("click", () => $("cat-dialog").close());
$("cd-auto").addEventListener("click", async () => {
  await api(`/api/transactions/${cdTx.id}/auto`, { method: "POST" });
  $("cat-dialog").close();
  loadOps();
});
$("cat-dialog-form").addEventListener("submit", async (ev) => {
  ev.preventDefault();
  const catId = $("cd-category").value ? Number($("cd-category").value) : null;
  if (catId === null) { $("cd-error").textContent = "Choisissez une catégorie."; return; }
  const body = { category_id: catId };
  if ($("cd-make-rule").checked && $("cd-pattern").value.trim()) {
    let f;
    try { f = ruleFields("cd"); } catch (e) { $("cd-error").textContent = e.message; return; }
    Object.assign(body, { rule_pattern: f.pattern, rule_match: f.match, rule_exclude: f.exclude, rule_sign: f.sign,
      rule_min_cents: f.min_cents, rule_max_cents: f.max_cents });
  }
  try {
    await api(`/api/transactions/${cdTx.id}/category`, { method: "PUT", body });
    $("cat-dialog").close();
    loadOps();
  } catch (e) { $("cd-error").textContent = e.message; }
});

// ---------- Onglet Catégories ----------
const SIGN_LABEL = { "+": "revenus seulement", "-": "dépenses seulement" };
const ORIGIN_LABEL = { user: "créée à la main", correction: "créée par une correction", default: "par défaut" };

async function loadCategoriesTab() {
  await loadCategories();
  const [stats, rules] = await Promise.all([api("/api/categories/stats"), api("/api/rules")]);
  $("cat-summary").textContent = stats.uncategorized
    ? `${stats.uncategorized} opération(s) à classer. Les catégories « Hors budget » ne comptent ni en dépenses ni en revenus.`
    : "Toutes les opérations sont classées. Les catégories « Hors budget » ne comptent ni en dépenses ni en revenus.";
  $("cat-list").replaceChildren(...stats.categories.map((c) => el("li", {},
    el("div", {},
      el("span", { class: "dot", style: `--dot:${c.color || "#999"}` }),
      el("strong", {}, c.name), " ",
      el("span", { class: "muted small" }, `${KIND_GROUP[c.kind]} · ${c.tx_count} opération(s) · ${c.rule_count} règle(s)`)),
    el("button", { class: "ghost small-btn", onclick: async () => {
      if (!confirm(`Supprimer « ${c.name} » et ses ${c.rule_count} règle(s) ? Ses opérations seront reclassées automatiquement.`)) return;
      await api(`/api/categories/${c.id}`, { method: "DELETE" });
      loadCategoriesTab();
    } }, "Supprimer"))));

  const ruleItem = (r) => el("li", {},
    el("div", {},
      el("div", {}, el("code", {}, describeRule(r)), " → ", el("strong", {}, r.category)),
      el("div", { class: "muted small" }, ORIGIN_LABEL[r.origin])),
    el("div", { class: "row" },
      el("button", { class: "ghost small-btn", onclick: () => editRule(r) }, "Modifier"),
      el("button", { class: "ghost small-btn", onclick: async () => {
        const res = await api(`/api/rules/${r.id}`, { method: "DELETE" });
        $("rule-msg").textContent = `Règle supprimée, ${res.changed} opération(s) reclassée(s).`;
        loadCategoriesTab();
      } }, "Supprimer")));
  const mine = rules.filter((r) => r.origin !== "default");
  const defaults = rules.filter((r) => r.origin === "default");
  $("rule-empty").hidden = mine.length > 0;
  $("rule-list").replaceChildren(...mine.map(ruleItem));
  $("default-count").textContent = defaults.length;
  $("default-list").replaceChildren(...defaults.map(ruleItem));
}

let editingRuleId = null;

function editRule(r) {
  editingRuleId = r.id;
  $("rule-match").value = r.match || "contains";
  $("rule-pattern").value = r.pattern;
  $("rule-exclude").value = r.exclude || "";
  $("rule-sign").value = r.sign || "";
  $("rule-min").value = r.min_cents != null ? centsToInput(r.min_cents) : "";
  $("rule-max").value = r.max_cents != null ? centsToInput(r.max_cents) : "";
  $("rule-category").value = r.category_id;
  $("rule-form-title").textContent = "Modifier la règle";
  $("rule-submit").textContent = "Enregistrer la modification";
  $("rule-cancel").hidden = false;
  $("rule-form").scrollIntoView({ behavior: "smooth", block: "center" });
  updateRulePreview();
}

function resetRuleForm() {
  editingRuleId = null;
  for (const id of ["rule-pattern", "rule-exclude", "rule-min", "rule-max"]) $(id).value = "";
  $("rule-match").value = "contains"; $("rule-sign").value = "";
  $("rule-preview").textContent = "";
  $("rule-form-title").textContent = "Ajouter une règle";
  $("rule-submit").textContent = "Créer la règle";
  $("rule-cancel").hidden = true;
}
$("rule-cancel").addEventListener("click", resetRuleForm);

async function updateRulePreview() {
  if (!$("rule-pattern").value.trim()) { $("rule-preview").textContent = ""; return; }
  try {
    const p = await api("/api/rules/preview", { body: ruleFields("rule") });
    $("rule-preview").textContent = `${p.count} opération(s) correspondent` +
      (p.samples.length ? ` — ex. : ${p.samples.slice(0, 3).join(" ; ")}` : "");
  } catch (e) { $("rule-preview").textContent = e.message; }
}
for (const id of ["rule-pattern", "rule-exclude", "rule-min", "rule-max"]) $(id).addEventListener("input", () => debouncedPreview(updateRulePreview));
for (const id of ["rule-match", "rule-sign"]) $(id).addEventListener("change", () => debouncedPreview(updateRulePreview));

$("rule-form").addEventListener("submit", async (ev) => {
  ev.preventDefault();
  try {
    const body = { ...ruleFields("rule"), category_id: Number($("rule-category").value) };
    const res = editingRuleId
      ? await api(`/api/rules/${editingRuleId}`, { method: "PUT", body })
      : await api("/api/rules", { body });
    $("rule-msg").textContent = `${editingRuleId ? "Règle modifiée" : "Règle créée"}, ${res.changed} opération(s) reclassée(s).`;
    resetRuleForm();
    loadCategoriesTab();
  } catch (e) { $("rule-msg").textContent = e.message; }
});

$("cat-form").addEventListener("submit", async (ev) => {
  ev.preventDefault();
  try {
    await api("/api/categories", { body: { name: $("cat-name").value, kind: $("cat-kind").value, color: $("cat-color").value } });
    $("cat-name").value = "";
    loadCategoriesTab();
  } catch (e) { alert(e.message); }
});

$("recat-btn").addEventListener("click", async () => {
  const res = await api("/api/rules/recategorize", { method: "POST" });
  $("cat-summary").textContent = `${res.changed} opération(s) reclassée(s).`;
  setTimeout(loadCategoriesTab, 1500);
});

// ================= Tableau de bord =================
// Espace de noms SVG lu sur une icône de la page (évite d'écrire une URL dans le code).
const SVGNS = document.querySelector("svg.ico").namespaceURI;
function svg(tag, attrs = {}) {
  const e = document.createElementNS(SVGNS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  return e;
}

/** Montant mis en forme : partie entière en grand, centimes et « € » en petit. */
function amountNode(cents, target) {
  const parts = EUR.formatToParts(cents / 100);
  let main = "", tail = "";
  let inTail = false;
  for (const p of parts) {
    if (p.type === "decimal") inTail = true;
    if (inTail || p.type === "currency" || (p.type === "literal" && tail)) tail += p.value; else main += p.value;
  }
  target.replaceChildren(document.createTextNode(main.trim()), el("span", { class: "cents" }, tail));
  return target;
}

const MONTH_FMT = new Intl.DateTimeFormat("fr-FR", { month: "long", year: "numeric" });
const MONTH_SHORT = new Intl.DateTimeFormat("fr-FR", { month: "short" });
const monthDate = (m) => new Date(`${m}-15T12:00:00`);
const monthLabel = (m) => MONTH_FMT.format(monthDate(m));
const monthShort = (m) => MONTH_SHORT.format(monthDate(m)).replace(".", "");
function monthAdd(m, delta) {
  const idx = Number(m.slice(0, 4)) * 12 + Number(m.slice(5, 7)) - 1 + delta;
  return `${String(Math.floor(idx / 12)).padStart(4, "0")}-${String((idx % 12) + 1).padStart(2, "0")}`;
}
const pct = (x) => `${Math.round(x)} %`;

/** « +12 % vs février » / « −5 % vs février » ; flèche + mot, jamais la couleur seule. */
function deltaText(cur, prev, prevMonth, upIsBad) {
  if (!prev) return "";
  const d = (cur - prev) / prev * 100;
  if (Math.abs(d) < 0.5) return `stable vs ${MONTH_SHORT.format(monthDate(prevMonth))}`;
  const up = d > 0;
  const span = el("span", { class: up === upIsBad ? "trend-up" : "trend-down" },
    `${up ? "▲ +" : "▼ −"}${Math.abs(Math.round(d))} %`);
  const wrap = el("span", {}, span, ` vs ${MONTH_FMT.format(monthDate(prevMonth)).split(" ")[0]}`);
  return wrap;
}

const dash = { month: null, account: "", range: "auto", category: null, data: null };

async function loadDashboard() {
  // « Auto » : la période couvre les mois disponibles, entre 6 et 12 mois.
  let range = dash.range;
  if (range === "auto") {
    const first = dash.data && dash.data.months_available[0];
    const span = first && dash.month ? (Number(dash.month.slice(0, 4)) - Number(first.slice(0, 4))) * 12
      + Number(dash.month.slice(5, 7)) - Number(first.slice(5, 7)) + 1 : 12;
    range = Math.min(12, Math.max(6, span));
  }
  const p = new URLSearchParams({ months: range });
  if (dash.month) p.set("month", dash.month);
  if (dash.account) p.set("account_id", dash.account);
  if (dash.category) p.set("category_id", dash.category);
  const d = await api(`/api/dashboard?${p}`);
  const firstLoad = !dash.data;
  dash.data = d;
  dash.month = d.month;
  if (firstLoad && dash.range === "auto" && d.months_available.length) return loadDashboard();

  const empty = d.months_available.length === 0;
  $("dash-empty").hidden = !empty;
  $("dash-grid").hidden = empty;

  // En-tête : mois et compte
  $("dash-month-label").textContent = monthLabel(d.month);
  const months = d.months_available.includes(d.month) ? d.months_available : [...d.months_available, d.month].sort();
  $("dash-month").replaceChildren(...[...months].reverse().map((m) => el("option", { value: m, selected: m === d.month }, monthLabel(m))));
  $("dash-prev").disabled = !months.length || d.month <= months[0];
  $("dash-next").disabled = !months.length || d.month >= months[months.length - 1];
  const keepAcc = dash.account;
  $("dash-account").replaceChildren(el("option", { value: "" }, "Tous les comptes"),
    ...accounts.map((a) => el("option", { value: a.id }, a.name)));
  $("dash-account").value = keepAcc;
  if (empty) return;

  renderHero(d);
  renderBudgetsCard(d);
  renderCategories(d);
  renderIncomes(d);
  renderTop(d);
  renderEvolution(d);
  loadDashInsights();
  loadDashSalary();
}

function renderHero(d) {
  const t = d.totals;
  amountNode(t.net_cents, $("dash-net")).classList.toggle("is-neg", t.net_cents < 0);
  const rate = $("dash-rate");
  rate.className = "rate";
  if (t.income_cents <= 0) {
    rate.textContent = t.expense_cents ? "Aucun revenu enregistré ce mois-ci" : "";
  } else if (t.net_cents >= 0) {
    rate.classList.add("good");
    rate.textContent = `↗ ${pct(d.savings_rate)} des revenus mis de côté`;
  } else {
    rate.classList.add("bad");
    rate.textContent = `↘ Dépenses supérieures aux revenus de ${money(-t.net_cents)}`;
  }
  const unc = $("dash-uncat");
  unc.hidden = !d.uncategorized_count;
  unc.textContent = `${d.uncategorized_count} opération(s) à classer`;

  // Barre empilée : où partent les revenus du mois
  const base = Math.max(t.income_cents, t.expense_cents) || 1;
  const top = d.expenses_by_category.slice(0, 4);
  const other = d.expenses_by_category.slice(4).reduce((s, c) => s + c.amount_cents, 0);
  const segs = top.map((c) => ({ cls: c.color ? "" : "seg-other", color: c.color, name: c.name, cents: c.amount_cents }));
  if (other) segs.push({ cls: "seg-other", name: "Autres dépenses", cents: other });
  const rest = t.income_cents - t.expense_cents;
  if (rest > 0) segs.push({ cls: "seg-rest", name: "Reste", cents: rest });
  const stack = $("dash-stack");
  stack.replaceChildren(...segs.map((sg) => {
    const span = el("span", { class: sg.cls, title: `${sg.name} : ${money(sg.cents)}` });
    span.style.width = `${(sg.cents / base) * 100}%`;
    if (sg.color) span.style.setProperty("--seg", sg.color);
    return span;
  }));
  stack.setAttribute("aria-label", "Répartition des revenus du mois : " + segs.map((sg) => `${sg.name} ${money(sg.cents)}`).join(", "));

  const ofIncome = (c) => (t.income_cents > 0 ? el("span", { class: "lg-pct" }, `· ${pct(c / t.income_cents * 100)}`) : null);
  const legend = [el("li", {}, el("div", { class: "lg-name" }, "Revenus"), el("div", { class: "lg-val" }, money(t.income_cents)))];
  for (const sg of segs.filter((x) => x.cls !== "seg-rest")) {
    const dot = el("span", { class: "dot" });
    if (sg.color) dot.style.setProperty("--dot", sg.color);
    legend.push(el("li", {}, el("div", { class: "lg-name" }, dot, sg.name),
      el("div", { class: "lg-val" }, `− ${money(sg.cents)}`, ofIncome(sg.cents))));
  }
  if (rest >= 0) {
    const dot = el("span", { class: "dot" }); dot.style.setProperty("--dot", "var(--good)");
    legend.push(el("li", { class: "lg-rest" }, el("div", { class: "lg-name" }, dot, "= Reste"),
      el("div", { class: "lg-val" }, money(rest), ofIncome(rest))));
  } else {
    legend.push(el("li", { class: "lg-over" }, el("div", { class: "lg-name" }, "⚠ Déficit"),
      el("div", { class: "lg-val" }, `− ${money(-rest)}`)));
  }
  $("dash-stack-legend").replaceChildren(...legend);
}

const BUDGET_STATUS = {
  ok: { pill: "pill-good", label: () => "✓ Dans le budget" },
  warn: { pill: "pill-warn", label: (b) => `! ${pct(b.budget_pct)} utilisé` },
  over: { pill: "pill-bad", label: (b) => `✕ Dépassé de ${money(b.spent_cents - b.budget_cents)}` },
};

function budgetRow(b) {
  const st = BUDGET_STATUS[b.budget_status];
  const dot = el("span", { class: "dot" });
  if (b.color) dot.style.setProperty("--dot", b.color);
  const fill = el("span");
  fill.style.width = `${Math.min(100, b.budget_pct)}%`;
  return el("li", {},
    el("div", { class: "budget-top" },
      el("span", { class: "cat-name" }, dot, el("span", {}, b.name)),
      el("span", { class: `pill ${st.pill}` }, st.label(b))),
    el("div", { class: "budget-meter " + b.budget_status, role: "img",
      "aria-label": `${b.name} : ${money(b.spent_cents)} sur ${money(b.budget_cents)}` }, fill),
    el("div", { class: "cat-sub" }, el("span", {}, `${money(b.spent_cents)} sur ${money(b.budget_cents)}`),
      el("span", {}, b.spent_cents <= b.budget_cents ? `reste ${money(b.budget_cents - b.spent_cents)}` : "")));
}

function renderBudgetsCard(d) {
  const list = d.budgets;
  const n = (s) => list.filter((b) => b.budget_status === s).length;
  $("dash-budget-summary").textContent = list.length
    ? [n("over") && `✕ ${n("over")} dépassé(s)`, n("warn") && `! ${n("warn")} à surveiller`, n("ok") && `✓ ${n("ok")} dans le budget`]
      .filter(Boolean).join(" · ")
    : "Aucun budget défini. Fixez des plafonds par catégorie dans « Gérer ».";
  $("dash-budgets").replaceChildren(...list.slice(0, 6).map(budgetRow));
}

function renderCategories(d) {
  amountNode(d.totals.expense_cents, $("dash-expenses"));
  const delta = deltaText(d.totals.expense_cents, d.previous.expense_cents, monthAdd(d.month, -1), true);
  $("dash-expenses-delta").replaceChildren(delta || "");
  const max = Math.max(1, ...d.expenses_by_category.map((c) => c.amount_cents));
  const total = d.totals.expense_cents || 1;
  $("dash-cats").replaceChildren(...d.expenses_by_category.slice(0, 8).map((c) => {
    const dot = el("span", { class: "dot" });
    if (c.color) dot.style.setProperty("--dot", c.color);
    const fill = el("span");
    fill.style.width = `${(c.amount_cents / max) * 100}%`;
    let trend = "";
    if (c.avg3_cents) {
      const v = (c.amount_cents - c.avg3_cents) / c.avg3_cents * 100;
      if (Math.abs(v) >= 10) trend = el("span", { class: v > 0 ? "trend-up" : "trend-down" },
        `${v > 0 ? "▲ +" : "▼ −"}${Math.abs(Math.round(v))} % vs moy. 3 mois`);
    }
    const li = el("li", {
      class: dash.category && dash.category === c.category_id ? "selected" : "",
      title: c.category_id ? "Voir l'évolution de cette catégorie" : "",
      onclick: () => {
        if (!c.category_id) { $("ops-category").value = "none"; showTab("ops"); return; }
        dash.category = dash.category === c.category_id ? null : c.category_id;
        loadDashboard();
      },
    },
      el("div", { class: "cat-top" }, el("span", { class: "cat-name" }, dot, el("span", {}, c.name)),
        el("span", { class: "cat-val" }, money(c.amount_cents))),
      el("div", { class: "track" }, fill),
      el("div", { class: "cat-sub" }, el("span", {}, `${pct(c.amount_cents / total * 100)} des dépenses`), trend));
    return li;
  }));
}

function renderIncomes(d) {
  amountNode(d.totals.income_cents, $("dash-income"));
  const delta = deltaText(d.totals.income_cents, d.previous.income_cents, monthAdd(d.month, -1), false);
  $("dash-income-delta").replaceChildren(delta || "");
  $("dash-incomes").replaceChildren(...(d.incomes_by_category.length ? d.incomes_by_category.map((c) => {
    const dot = el("span", { class: "dot" });
    if (c.color) dot.style.setProperty("--dot", c.color);
    return el("li", {}, el("span", { class: "cat-name" }, dot, el("span", {}, c.name)), el("span", { class: "sl-val" }, money(c.amount_cents)));
  }) : [el("li", { class: "muted" }, "Aucun revenu ce mois-ci.")]));
}

function renderTop(d) {
  $("dash-top").replaceChildren(...(d.top_expenses.length ? d.top_expenses.map((t) => el("li", {},
    el("div", { class: "sl-main" }, el("div", {}, t.label),
      el("div", { class: "muted small" }, `${dateFr(t.date)} · ${t.account}${t.category ? " · " + t.category : ""}`)),
    el("span", { class: "sl-val" }, money(t.amount_cents)))) : [el("li", { class: "muted" }, "Aucune dépense ce mois-ci.")]));
}

/** Graduations « rondes » pour l'axe vertical. */
function niceTicks(max) {
  if (max <= 0) return [0, 1];
  const raw = max / 4;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((k) => k * mag).find((s) => s >= raw);
  const ticks = [];
  for (let v = 0; v <= max + step * 0.001; v += step) ticks.push(v);
  if (ticks[ticks.length - 1] < max) ticks.push(ticks[ticks.length - 1] + step);
  return ticks;
}
const compactEur = (cents) => {
  const v = cents / 100;
  return v >= 10000 ? `${Math.round(v / 1000)} k€` : `${new Intl.NumberFormat("fr-FR").format(Math.round(v))} €`;
};

/** Colonne à bout arrondi (4px) côté valeur, carrée côté ligne de base. */
function columnPath(x, y, w, h) {
  const r = Math.min(4, h, w / 2);
  const b = y + h;
  return `M${x},${b} V${y + r} Q${x},${y} ${x + r},${y} H${x + w - r} Q${x + w},${y} ${x + w},${y + r} V${b} Z`;
}

function renderEvolution(d) {
  const single = Boolean(d.category_filter);
  $("dash-evo-title").textContent = single ? `${d.category_filter} — évolution` : "Revenus et dépenses";
  $("dash-evo-clear").hidden = !single;
  $("dash-evo-legend").replaceChildren(...(single ? [] : [
    el("li", {}, el("span", { class: "sw sw-income" }), "Revenus"),
    el("li", {}, el("span", { class: "sw sw-expense" }), "Dépenses")]));

  const series = d.series;
  const keys = single ? [["category_cents", "bar-income", "Montant"]] :
    [["income_cents", "bar-income", "Revenus"], ["expense_cents", "bar-expense", "Dépenses"]];
  const box = $("dash-chart");
  const W = Math.max(300, box.clientWidth || 600), H = 240;
  const pad = { l: 52, r: 8, t: 10, b: 26 };
  const pw = W - pad.l - pad.r, ph = H - pad.t - pad.b;
  const max = Math.max(...series.flatMap((p) => keys.map(([k]) => p[k] || 0)), 1);
  const ticks = niceTicks(max);
  const top = ticks[ticks.length - 1];
  const yOf = (v) => pad.t + ph - (v / top) * ph;
  const band = pw / series.length;
  const barW = Math.max(3, Math.min(24, (band - 10) / keys.length - 2));
  const root = svg("svg", { viewBox: `0 0 ${W} ${H}`, role: "img",
    "aria-label": single ? `Évolution mensuelle de ${d.category_filter}` : "Revenus et dépenses par mois" });

  for (const t of ticks) {
    const y = yOf(t);
    root.append(svg("line", { class: t === 0 ? "baseline" : "gridline", x1: pad.l, x2: W - pad.r, y1: y, y2: y }));
    const lab = svg("text", { class: "axis", x: pad.l - 8, y: y + 4, "text-anchor": "end" });
    lab.textContent = compactEur(t);
    root.append(lab);
  }
  const every = series.length > 12 ? 3 : series.length > 8 ? 2 : 1;
  const tip = el("div", { class: "tooltip", hidden: true });

  series.forEach((p, i) => {
    const x0 = pad.l + i * band;
    const hit = svg("rect", { class: "band" + (p.month === d.month ? " active" : ""), x: x0, y: pad.t, width: band, height: ph, rx: 8 });
    root.append(hit);
    const groupW = keys.length * barW + (keys.length - 1) * 2;
    keys.forEach(([k, cls], j) => {
      const v = p[k] || 0;
      if (v <= 0) return;
      const x = x0 + (band - groupW) / 2 + j * (barW + 2);
      const y = yOf(v);
      root.append(svg("path", { class: cls, d: columnPath(x, y, barW, pad.t + ph - y), "pointer-events": "none" }));
    });
    if (i % every === 0 || p.month === d.month) {
      const lab = svg("text", { class: "axis", x: x0 + band / 2, y: H - 8, "text-anchor": "middle" });
      lab.textContent = monthShort(p.month) + (p.month.endsWith("-01") || i === 0 ? ` ${p.month.slice(2, 4)}` : "");
      if (p.month === d.month) lab.setAttribute("font-weight", "700");
      root.append(lab);
    }
    // Survol : infobulle ; clic : afficher ce mois dans tout le tableau de bord.
    const show = () => {
      tip.replaceChildren(el("strong", {}, monthLabel(p.month)),
        ...(p.has_data ? keys.map(([k, cls, name]) => el("div", { class: "tt-row" },
          el("span", {}, el("span", { class: "sw " + (cls === "bar-income" ? "sw-income" : "sw-expense") }), name),
          el("span", {}, money(p[k] || 0)))) : [el("div", { class: "muted" }, "Aucune opération")]),
        ...(p.has_data && !single ? [el("div", { class: "tt-row tt-total" },
          el("span", {}, el("span", { class: "sw sw-none" }), "Solde"), el("span", {}, money(p.net_cents)))] : []));
      tip.hidden = false;
      // À côté de la colonne survolée (à droite, ou à gauche s'il n'y a pas la place) : ne cache pas les barres.
      const scale = box.clientWidth / W;
      const tw = tip.offsetWidth || 190;
      const right = (x0 + band) * scale + 8;
      tip.style.left = `${right + tw <= box.clientWidth ? right : Math.max(0, x0 * scale - tw - 8)}px`;
      tip.style.top = "8px";
    };
    hit.addEventListener("mouseenter", show);
    hit.addEventListener("mouseleave", () => { tip.hidden = true; });
    hit.addEventListener("click", () => { if (p.has_data) { dash.month = p.month; loadDashboard(); } });
    hit.style.cursor = p.has_data ? "pointer" : "default";
  });
  box.replaceChildren(root, tip);

  // Vue tableau (accessibilité : les valeurs ne dépendent jamais du graphique seul)
  const head = el("tr", {}, el("th", {}, "Mois"), ...keys.map(([, , n]) => el("th", { class: "num" }, n)),
    single ? null : el("th", { class: "num" }, "Solde"));
  $("dash-table").replaceChildren(el("thead", {}, head), el("tbody", {}, ...series.filter((p) => p.has_data).reverse().map((p) =>
    el("tr", {}, el("td", {}, monthLabel(p.month)), ...keys.map(([k]) => el("td", { class: "num" }, money(p[k] || 0))),
      single ? null : el("td", { class: "num" }, money(p.net_cents))))));
}

$("dash-prev").addEventListener("click", () => { dash.month = monthAdd(dash.month, -1); loadDashboard(); });
$("dash-next").addEventListener("click", () => { dash.month = monthAdd(dash.month, 1); loadDashboard(); });
$("dash-month").addEventListener("change", () => { dash.month = $("dash-month").value; loadDashboard(); });
$("dash-account").addEventListener("change", () => { dash.account = $("dash-account").value; loadDashboard(); });
$("dash-range").addEventListener("change", () => {
  dash.range = $("dash-range").value === "auto" ? "auto" : Number($("dash-range").value);
  loadDashboard();
});
$("dash-evo-clear").addEventListener("click", () => { dash.category = null; loadDashboard(); });
$("dash-uncat").addEventListener("click", () => { $("ops-category").value = "none"; $("ops-month").value = dash.month; showTab("ops"); });
let resizeTimer = null;
window.addEventListener("resize", () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => { if (currentTab === "dashboard" && dash.data && !$("dash-grid").hidden) renderEvolution(dash.data); }, 150);
});

// ================= Suggestions d'économies =================
const SG_ICON = { bad: ["sg-bad", "✕"], warn: ["sg-warn", "!"], info: ["sg-info", "i"] };
const CADENCE_SHORT = { hebdomadaire: "/sem.", mensuel: "/mois", trimestriel: "/trim.", annuel: "/an" };
const DAY_FMT = new Intl.DateTimeFormat("fr-FR", { month: "short" });

async function fetchInsights() {
  const p = new URLSearchParams();
  if (dash.month) p.set("month", dash.month);
  if (dash.account) p.set("account_id", dash.account);
  const ins = await api(`/api/insights?${p}`);
  const n = ins.suggestions.filter((s) => s.severity !== "info").length;
  $("nav-insights-count").hidden = !n;
  $("nav-insights-count").textContent = n;
  return ins;
}

function suggestionItem(s, { compact = false, onDismiss } = {}) {
  const [cls, glyph] = SG_ICON[s.severity];
  const side = el("div", { class: "sg-side" });
  if (s.yearly_saving_cents) side.append(el("span", { class: "pill pill-good" }, `≈ ${money(s.yearly_saving_cents)}/an`));
  if (!compact) side.append(el("button", { type: "button", class: "link", onclick: onDismiss }, "Masquer"));
  const body = el("div", {}, el("div", { class: "sg-title" }, s.title), el("div", { class: "sg-detail" }, s.detail));
  if (!compact && s.items) {
    body.append(el("ul", { class: "sg-items" }, ...s.items.map((it) =>
      el("li", {}, `${it.label} · ${money(it.amount_cents)}${CADENCE_SHORT[it.cadence] || ""} · ${money(it.yearly_cents)}/an`))));
  }
  const sevLabel = { bad: "Important", warn: "À surveiller", info: "Information" }[s.severity];
  return el("li", {}, el("span", { class: `sg-icon ${cls}`, title: sevLabel, "aria-label": sevLabel }, glyph), body, side);
}

function upcomingItem(u) {
  const dt = new Date(u.next_date + "T12:00:00");
  const dot = el("span", { class: "dot" });
  if (u.color) dot.style.setProperty("--dot", u.color);
  return el("li", {},
    el("span", { class: "day-chip" }, el("strong", {}, String(dt.getDate()).padStart(2, "0")), el("span", {}, DAY_FMT.format(dt).replace(".", ""))),
    el("div", { class: "up-label" }, el("div", {}, titleCase(u.key)),
      el("div", { class: "muted small" }, [u.category, u.account].filter(Boolean).join(" · "))),
    el("span", { class: "sl-val" + (u.is_expense ? "" : " pos") }, `${u.is_expense ? "−" : "+"}${u.variable ? " ≈" : ""} ${money(u.amount_cents)}`));
}
const titleCase = (s) => s.toLowerCase().replace(/(^|\s)\p{L}/gu, (m) => m.toUpperCase());

function remainingNode(rem) {
  const box = el("div", { class: "remaining-box" },
    el("div", { class: "muted small" }, `Reste à vivre d'ici le ${dateFr(rem.month_end)}`),
    amountNode(rem.remaining_cents, el("p", { class: "amount-l" + (rem.remaining_cents < 0 ? " is-neg" : "") })),
    el("div", { class: "muted small" }, rem.per_day_cents
      ? `soit ${money(rem.per_day_cents)} par jour pendant ${rem.days_left} jours`
      : rem.remaining_cents < 0 ? "⚠ dépenses prévues supérieures aux revenus" : ""));
  return box;
}

async function loadDashInsights() {
  let ins;
  try { ins = await fetchInsights(); } catch (_) { return; }
  const list = ins.suggestions.slice(0, 4);
  $("dash-suggestions").replaceChildren(...(list.length ? list.map((s) => suggestionItem(s, { compact: true }))
    : [el("li", { class: "muted" }, "Rien à signaler pour l'instant. Les suggestions apparaissent avec quelques mois d'historique.")]));
  $("dash-remaining").replaceChildren(ins.remaining ? remainingNode(ins.remaining) : "");
  const up = ins.upcoming.slice(0, 6);
  const total = ins.upcoming.filter((u) => u.is_expense).reduce((s, u) => s + u.amount_cents, 0);
  $("dash-upcoming-total").textContent = ins.upcoming.length ? `${money(total)} sur 31 jours` : "";
  $("dash-upcoming").replaceChildren(...(up.length ? up.map(upcomingItem)
    : [el("li", { class: "muted small" }, "Aucun prélèvement récurrent repéré pour l'instant.")]));
}

async function loadInsightsTab() {
  const ins = await fetchInsights();
  // Reste à vivre
  $("ins-remaining-card").hidden = !ins.remaining;
  if (ins.remaining) {
    const r = ins.remaining;
    $("ins-asof").textContent = `d'après les opérations connues au ${dateFr(r.as_of)}`;
    amountNode(r.remaining_cents, $("ins-remaining")).classList.toggle("is-neg", r.remaining_cents < 0);
    $("ins-perday").className = "rate " + (r.remaining_cents >= 0 ? "good" : "bad");
    $("ins-perday").textContent = r.per_day_cents
      ? `soit ${money(r.per_day_cents)} par jour pendant les ${r.days_left} jours restants`
      : r.remaining_cents < 0 ? "⚠ Les dépenses prévues dépassent les revenus du mois" : "";
    const li = (name, val, cls = "") => el("li", { class: cls }, el("div", { class: "lg-name" }, name), el("div", { class: "lg-val" }, val));
    $("ins-remaining-detail").replaceChildren(
      li("Revenus reçus", money(r.income_cents)),
      li(r.expected_salary_cents ? "Revenus attendus (dont salaire prudent)" : "Revenus attendus", `+ ${money(r.upcoming_income_cents)}`),
      li("Déjà dépensé", `− ${money(r.spent_cents)}`),
      li("Prélèvements à venir", `− ${money(r.upcoming_expense_cents)}`),
      li("= Reste à vivre", money(r.remaining_cents), r.remaining_cents >= 0 ? "lg-rest" : "lg-over"));
  }
  // Suggestions
  $("ins-list").replaceChildren(...(ins.suggestions.length ? ins.suggestions.map((s) => suggestionItem(s, {
    onDismiss: async () => { await api("/api/insights/dismiss", { body: { id: s.id } }); loadInsightsTab(); },
  })) : [el("li", { class: "muted" }, "Aucune suggestion pour l'instant.")]));
  $("ins-restore").hidden = !ins.dismissed_count;
  $("ins-restore").textContent = `Réafficher ${ins.dismissed_count} suggestion(s) masquée(s)`;
  // Récurrences
  const rec = ins.recurring.filter((x) => x.is_expense || x.active);
  const active = rec.filter((x) => x.active && x.is_expense);
  $("ins-rec-total").textContent = active.length
    ? `${active.length} actives · ${money(active.reduce((s, x) => s + x.monthly_cents, 0))}/mois · ${money(active.reduce((s, x) => s + x.yearly_cents, 0))}/an` : "";
  $("ins-rec-empty").hidden = rec.length > 0;
  $("ins-rec-body").replaceChildren(...rec.map((x) => {
    const dot = el("span", { class: "dot" });
    if (x.color) dot.style.setProperty("--dot", x.color);
    const tags = [];
    if (x.is_subscription) tags.push(el("span", { class: "tag tag-hint" }, "Abonnement"));
    if (!x.is_expense) tags.push(el("span", { class: "tag tag-dup" }, "Revenu"));
    if (x.price_change_cents > 0) tags.push(el("span", { class: "tag tag-warn" }, `▲ +${money(x.price_change_cents)}`));
    if (!x.active) tags.push(el("span", { class: "tag tag-dup" }, "Semble arrêté"));
    return el("tr", { class: x.active ? "" : "dimmed" },
      el("td", {}, el("span", { class: "cat-name" }, dot, el("span", {}, titleCase(x.key))),
        el("div", { class: "muted small" }, [x.category, x.account, `${x.occurrences} fois`].filter(Boolean).join(" · ")),
        tags.length ? el("div", { class: "tags" }, ...tags) : null),
      el("td", { class: "desktop-only" }, x.cadence),
      el("td", { class: "num nowrap" + (x.is_expense ? "" : " pos") }, `${x.variable ? "≈ " : ""}${money(x.amount_cents)}`),
      el("td", { class: "num nowrap desktop-only" }, money(x.yearly_cents)),
      el("td", { class: "nowrap" }, x.active ? dateFr(x.next_date) : el("span", { class: "status-off" }, "—")));
  }));
}
$("ins-restore").addEventListener("click", async () => { await api("/api/insights/dismiss", { method: "DELETE" }); loadInsightsTab(); });

// ================= Revenus variables =================
const RULE_TEXT = {
  "moyenne-20": "la moyenne sur 6 mois diminuée de 20 %",
  quartile: "le montant dépassé environ 3 mois sur 4",
};

async function fetchIncome(months = 12) {
  const p = new URLSearchParams({ months });
  if (dash.month) p.set("month", dash.month);
  return api(`/api/income?${p}`);
}

async function loadDashSalary() {
  let inc;
  try { inc = await fetchIncome(6); } catch (_) { return; }
  const box = $("dash-salary");
  const ref = inc.reference;
  box.hidden = !(ref && inc.enough_history);
  if (box.hidden) return;
  box.replaceChildren(
    el("div", { class: "muted small" }, `${inc.category_names.join(", ")} · moyenne 6 mois ${money(ref.avg6_cents)}`),
    el("div", { class: "row space" }, el("strong", {}, "Référence prudente"), el("strong", {}, money(ref.prudent_cents))),
    el("div", { class: "muted small" }, inc.current_received ? `Reçu ce mois-ci : ${money(inc.current_cents)}` : "Pas encore reçu ce mois-ci"));
}

function kpi(name, cents, sub, main = false) {
  return el("li", { class: main ? "kpi-main" : "" }, el("div", { class: "k-name" }, name),
    amountNode(cents, el("div", { class: "k-val" })), sub ? el("div", { class: "k-sub" }, sub) : null);
}

async function loadIncomeTab() {
  // Comme le tableau de bord : la période couvre les mois disponibles (6 à 12).
  let span = 12;
  const avail = dash.data && dash.data.months_available;
  if (avail && avail.length && dash.month) {
    span = (Number(dash.month.slice(0, 4)) - Number(avail[0].slice(0, 4))) * 12
      + Number(dash.month.slice(5, 7)) - Number(avail[0].slice(5, 7)) + 1;
  }
  const inc = await fetchIncome(Math.min(12, Math.max(6, span)));
  const ref = inc.reference;
  $("inc-title").textContent = inc.category_names.length ? `${inc.category_names.join(" + ")} — revenu variable` : "Revenus variables";
  $("inc-month").textContent = inc.month ? `référence pour ${monthLabel(inc.month)}` : "";
  // Catégories suivies
  $("inc-cats").replaceChildren(...inc.income_categories.map((c) => {
    const box = el("input", { type: "checkbox", checked: inc.categories.includes(c.id) });
    box.addEventListener("change", async () => {
      const ids = [...$("inc-cats").querySelectorAll("input")].map((b, i) => (b.checked ? inc.income_categories[i].id : null)).filter(Boolean);
      await api("/api/income/categories", { method: "PUT", body: { category_ids: ids } });
      $("inc-cats-msg").replaceChildren(el("span", { class: "ok-text" }, "✓ Enregistré"));
      loadIncomeTab();
    });
    return el("label", { class: "check-pill" }, box, c.name);
  }));

  const empty = !ref;
  $("inc-empty").hidden = !empty;
  $("inc-body").hidden = empty;
  if (empty) {
    $("inc-empty").textContent = inc.categories.length
      ? "Pas encore assez de données : importez quelques mois de relevés et classez votre salaire en « Salaire »."
      : "Aucune catégorie de revenu suivie : cochez-en une ci-dessous.";
    return;
  }
  const n = inc.history_months;
  $("inc-kpis").replaceChildren(
    kpi("Ce mois-ci", inc.current_cents, inc.current_received ? "reçu" : "pas encore reçu"),
    kpi("Moyenne 3 mois", ref.avg3_cents, "lissée"),
    kpi(`Moyenne ${n} mois`, ref.avg6_cents, ref.variability_pct !== null ? `écart moyen ±${ref.variability_pct} %` : ""),
    kpi("Référence prudente", ref.prudent_cents, "à utiliser pour votre budget", true));
  $("inc-rule").replaceChildren(
    `Référence prudente = le plus petit de : moyenne ${n} mois − 20 % (${money(ref.avg6_minus_20_cents)}) et montant dépassé ~3 mois sur 4 (${money(ref.q25_cents)}). `,
    el("strong", {}, `Ici, c'est ${RULE_TEXT[ref.prudent_rule]}.`),
    inc.enough_history ? "" : ` ⚠ Seulement ${n} mois d'historique : la référence deviendra plus fiable avec le temps.`);
  $("inc-legend").replaceChildren(
    el("li", {}, el("span", { class: "sw sw-income" }), "Montant reçu"),
    el("li", {}, el("span", { class: "sw sw-avg" }), `Moyenne ${n} mois`),
    el("li", {}, el("span", { class: "sw sw-prudent" }), "Référence prudente"));
  renderIncomeChart(inc);
  $("inc-table").replaceChildren(
    el("thead", {}, el("tr", {}, el("th", {}, "Mois"), el("th", { class: "num" }, "Montant reçu"))),
    el("tbody", {}, ...inc.series.filter((p) => p.has_data).reverse().map((p) =>
      el("tr", {}, el("td", {}, monthLabel(p.month)), el("td", { class: "num" }, money(p.amount_cents))))));
}

function renderIncomeChart(inc) {
  const box = $("inc-chart");
  const ref = inc.reference;
  const series = inc.series;
  const W = Math.max(300, box.clientWidth || 600), H = 230;
  const pad = { l: 52, r: 96, t: 10, b: 26 };
  const pw = W - pad.l - pad.r, ph = H - pad.t - pad.b;
  const ticks = niceTicks(Math.max(...series.map((p) => p.amount_cents), ref.avg6_cents, 1));
  const top = ticks[ticks.length - 1];
  const yOf = (v) => pad.t + ph - (v / top) * ph;
  const band = pw / series.length;
  const barW = Math.max(4, Math.min(24, band - 12));
  const root = svg("svg", { viewBox: `0 0 ${W} ${H}`, role: "img", "aria-label": "Montant reçu chaque mois et revenu de référence" });
  for (const t of ticks) {
    const y = yOf(t);
    root.append(svg("line", { class: t === 0 ? "baseline" : "gridline", x1: pad.l, x2: W - pad.r, y1: y, y2: y }));
    const lab = svg("text", { class: "axis", x: pad.l - 8, y: y + 4, "text-anchor": "end" });
    lab.textContent = compactEur(t);
    root.append(lab);
  }
  const tip = el("div", { class: "tooltip", hidden: true });
  series.forEach((p, i) => {
    const x0 = pad.l + i * band;
    const hit = svg("rect", { class: "band" + (p.month === inc.month ? " active" : ""), x: x0, y: pad.t, width: band, height: ph, rx: 8 });
    root.append(hit);
    if (p.amount_cents > 0) {
      const y = yOf(p.amount_cents);
      root.append(svg("path", { class: "bar-income", d: columnPath(x0 + (band - barW) / 2, y, barW, pad.t + ph - y), "pointer-events": "none" }));
    }
    const lab = svg("text", { class: "axis", x: x0 + band / 2, y: H - 8, "text-anchor": "middle" });
    lab.textContent = (series.length > 8 && i % 2) ? "" : monthShort(p.month);
    root.append(lab);
    hit.addEventListener("mouseenter", () => {
      tip.replaceChildren(el("strong", {}, monthLabel(p.month)),
        el("div", { class: "tt-row" }, el("span", {}, "Reçu"), el("span", {}, p.has_data ? money(p.amount_cents) : "pas de données")));
      tip.hidden = false;
      const scale = box.clientWidth / W, tw = tip.offsetWidth || 170, right = (x0 + band) * scale + 8;
      tip.style.left = `${right + tw <= box.clientWidth ? right : Math.max(0, x0 * scale - tw - 8)}px`;
      tip.style.top = "8px";
    });
    hit.addEventListener("mouseleave", () => { tip.hidden = true; });
  });
  // Lignes de référence, étiquetées directement en bout de ligne.
  for (const [v, cls, name] of [[ref.avg6_cents, "ref-avg", "Moyenne"], [ref.prudent_cents, "ref-prudent", "Prudent"]]) {
    const y = yOf(v);
    root.append(svg("line", { class: `ref-line ${cls}`, x1: pad.l, x2: W - pad.r, y1: y, y2: y }));
    const t = svg("text", { class: "ref-label", x: W - pad.r + 6, y: y + (cls === "ref-avg" ? -2 : 12) });
    t.textContent = `${name} ${compactEur(v)}`;
    root.append(t);
  }
  box.replaceChildren(root, tip);
}

// ================= Page Budgets =================
async function loadBudgetsTab() {
  const [list, d] = await Promise.all([api("/api/budgets"), api(`/api/dashboard?months=3${dash.month ? "&month=" + dash.month : ""}`)]);
  const spent = Object.fromEntries(d.expenses_by_category.map((c) => [c.category_id, c]));
  fetchIncome(6).then((inc) => {
    const box = $("bud-vs-income");
    const ref = inc.reference;
    box.hidden = !(ref && inc.enough_history && inc.budgets_total_cents);
    if (box.hidden) return;
    const pctv = inc.budgets_total_cents / ref.prudent_cents * 100;
    box.replaceChildren(`Total de vos plafonds : ${money(inc.budgets_total_cents)} par mois, soit `,
      el("strong", {}, `${pct(pctv)} de votre revenu de référence prudent`), ` (${money(ref.prudent_cents)}).`,
      pctv > 100 ? " ⚠ Vos plafonds dépassent ce que vous pouvez raisonnablement compter toucher." : "");
  }).catch(() => {});
  $("bud-month").textContent = d.months_available.length ? `Dépenses de ${monthLabel(d.month)} :` : "";
  $("bud-list").replaceChildren(...list.map((b) => {
    const s = spent[b.category_id];
    const dot = el("span", { class: "dot" });
    if (b.color) dot.style.setProperty("--dot", b.color);
    const input = el("input", { type: "text", inputmode: "decimal", placeholder: "Pas de plafond",
      value: b.monthly_limit_cents ? centsToInput(b.monthly_limit_cents) : "", "aria-label": `Plafond mensuel ${b.name}` });
    const save = async () => {
      const raw = input.value.trim();
      const cents = raw ? parseEuros(raw) : null;
      if (raw && (cents === null || cents < 0)) { $("bud-msg").textContent = "Montant illisible."; return; }
      if ((cents || null) === (b.monthly_limit_cents || null)) return;
      await api(`/api/budgets/${b.category_id}`, { method: "PUT", body: { monthly_limit_cents: cents } });
      b.monthly_limit_cents = cents;
      $("bud-msg").replaceChildren(el("span", { class: "ok-text" }, `✓ ${b.name} : ${cents ? money(cents) + " par mois" : "plafond retiré"}`));
      loadBudgetsTab();
    };
    input.addEventListener("change", save);
    input.addEventListener("keydown", (ev) => { if (ev.key === "Enter") input.blur(); });
    let info = el("span", { class: "muted" }, s ? `${money(s.amount_cents)} dépensés` : "Rien dépensé");
    if (s && s.avg3_cents) info.append(` · moyenne 3 mois ${money(s.avg3_cents)}`);
    if (b.monthly_limit_cents) {
      const p = (s ? s.amount_cents : 0) / b.monthly_limit_cents * 100;
      const status = p > 100 ? "over" : p >= 80 ? "warn" : "ok";
      const fill = el("span"); fill.style.width = `${Math.min(100, p)}%`;
      info = el("div", {}, el("div", { class: "budget-meter " + status }, fill),
        el("div", { class: "cat-sub" }, info, el("span", { class: `pill ${BUDGET_STATUS[status].pill}` },
          BUDGET_STATUS[status].label({ budget_pct: p, spent_cents: s ? s.amount_cents : 0, budget_cents: b.monthly_limit_cents }))));
    }
    return el("li", {}, el("span", { class: "cat-name" }, dot, el("span", {}, b.name)), input, info);
  }));
}

// ================= Sauvegarde et export =================
function saveFile({ name, type, content }) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = el("a", { href: url, download: name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
  return name;
}

$("exp-backup").addEventListener("click", async () => {
  try {
    const n = saveFile(await exportBackup());
    $("exp-msg").replaceChildren(el("span", { class: "ok-text" }, `✓ ${n} enregistré dans vos téléchargements (chiffré).`));
  } catch (e) { $("exp-msg").textContent = e.message; }
});
$("exp-csv").addEventListener("click", () => {
  if (!confirm("Ce fichier CSV ne sera PAS chiffré : toutes vos opérations y seront lisibles. Continuer ?")) return;
  try {
    const n = saveFile(exportCsv());
    $("exp-msg").replaceChildren(el("span", { class: "ok-text" }, `✓ ${n} enregistré dans vos téléchargements. Pensez à le supprimer après usage.`));
  } catch (e) { $("exp-msg").textContent = e.message; }
});
$("restore-file").addEventListener("change", async () => {
  const f = $("restore-file").files[0];
  if (!f) return;
  const pw = prompt("Mot de passe avec lequel cette sauvegarde a été faite :");
  $("restore-file").value = "";
  if (!pw) return;
  if (!confirm("Remplacer TOUT le contenu actuel du coffre par celui de la sauvegarde ?")) return;
  try {
    await store.restoreBackup(await f.text(), pw);
    $("exp-msg").replaceChildren(el("span", { class: "ok-text" }, "✓ Sauvegarde restaurée."));
    await loadAccounts();
  } catch (e) {
    $("exp-msg").textContent = e instanceof WrongPassword ? "Mot de passe incorrect pour cette sauvegarde." : e.message;
  }
});

// ================= Démarrage =================
cloud.onUser(async (u) => {
  user = u;
  peek = null;
  if (u) peek = await store.peek(u.uid);
  else store.lock();
  refresh().catch((e) => { document.body.textContent = e.message; });
});
if ("serviceWorker" in navigator) {
  // Quand une nouvelle version de l'app prend la main, on recharge UNE fois (si le coffre est
  // verrouillé) pour que la page et le code soient de la même version.
  const hadController = Boolean(navigator.serviceWorker.controller);
  let reloaded = false;
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (!hadController || reloaded) return;
    reloaded = true;
    if (!store.unlocked) location.reload();
    else window.__updateReady = true; // coffre ouvert : rechargement au prochain verrouillage
  });
  navigator.serviceWorker.register("service-worker.js").catch(() => { /* mode hors ligne indisponible */ });
}
