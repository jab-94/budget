// Budget local — front en JavaScript simple, sans aucune bibliothèque.
// Toutes les requêtes partent vers des chemins RELATIFS ("/api/...") : la
// Content-Security-Policy interdit de toute façon toute autre destination.
"use strict";

const TOKEN = document.querySelector('meta[name="session-token"]').content;

async function api(path, options = {}) {
  const headers = { "X-Budget-Token": TOKEN };
  let body;
  if (options.raw) {           // fichier envoyé tel quel (lu en mémoire côté serveur)
    headers["Content-Type"] = "application/octet-stream";
    body = options.raw;
  } else if (options.body) {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(options.body);
  }
  const res = await fetch(path, {
    method: options.method || (body ? "POST" : "GET"),
    headers, body, credentials: "same-origin", cache: "no-store",
  });
  let data = null;
  try { data = await res.json(); } catch (_) { /* réponse vide */ }
  if (!res.ok) {
    if (res.status === 423) { refresh(); }
    const detail = data && data.detail;
    const err = new Error(typeof detail === "string" ? detail : "Erreur inattendue.");
    err.status = res.status;
    throw err;
  }
  return data;
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
let currentTab = "ops";

async function refresh() {
  status = await api("/api/status");
  if (status.unlocked) return showApp();
  showLock();
}

// ---------- Écran de verrouillage ----------
function showLock() {
  for (const s of document.querySelectorAll(".tab")) s.hidden = true;
  $("tabs").hidden = true;
  $("lock-btn").hidden = true;
  $("lock-screen").hidden = false;
  $("vault-path").textContent = status.vault_path;
  $("location-input").value = status.vault_path;
  $("use-icloud").hidden = !status.icloud_available;

  const creating = !status.vault_exists;
  $("lock-title").textContent = creating ? "Créer votre coffre" : "Déverrouiller";
  $("lock-intro").textContent = creating
    ? "Vos données seront rangées dans un fichier chiffré, illisible sans ce mot de passe. " +
      "Attention : s'il est oublié, les données sont perdues définitivement."
    : "Entrez votre mot de passe pour ouvrir le coffre.";
  $("pw2-wrap").hidden = !creating;
  $("pw-help").hidden = !creating;
  $("pw-help").textContent =
    `Au moins ${status.min_password_length} caractères. Idéal : une phrase de 4 ou 5 mots.`;
  $("lock-submit").textContent = creating ? "Créer le coffre" : "Ouvrir";
  $("pw").autocomplete = creating ? "new-password" : "current-password";

  const w = $("lock-warnings");
  w.replaceChildren();
  if (status.open_elsewhere) {
    w.append(el("p", { class: "warning" },
      `Le coffre semble ouvert sur un autre appareil (${status.open_elsewhere}). ` +
      "Fermez-le là-bas et attendez la synchronisation iCloud avant de modifier ici."));
  }
  if (status.conflict_copies.length) {
    w.append(el("p", { class: "warning" },
      "iCloud a créé des copies en conflit à côté du coffre : " + status.conflict_copies.join(", ") +
      ". Elles contiennent peut-être des modifications faites sur un autre appareil."));
  }
  $("pw").focus();
}

$("lock-form").addEventListener("submit", async (ev) => {
  ev.preventDefault();
  const creating = !status.vault_exists;
  const pw = $("pw").value;
  $("lock-error").textContent = "";
  if (creating && pw !== $("pw2").value) {
    $("lock-error").textContent = "Les deux mots de passe ne correspondent pas.";
    return;
  }
  $("lock-submit").disabled = true;
  try {
    await api(creating ? "/api/vault/create" : "/api/vault/unlock", { method: "POST", body: { password: pw } });
    $("pw").value = ""; $("pw2").value = "";
    await refresh();
  } catch (e) {
    $("lock-error").textContent = e.message;
  } finally {
    $("lock-submit").disabled = false;
  }
});

$("location-form").addEventListener("submit", async (ev) => {
  ev.preventDefault();
  try {
    await api("/api/vault/location", { method: "POST", body: { path: $("location-input").value } });
    await refresh();
  } catch (e) { $("lock-error").textContent = e.message; }
});
$("use-icloud").addEventListener("click", () => { $("location-input").value = status.icloud_default; });
$("lock-btn").addEventListener("click", async () => {
  resetImport();
  await api("/api/vault/lock", { method: "POST" });
  await refresh();
});

// ---------- Application ----------
async function showApp() {
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
}
for (const b of document.querySelectorAll("#tabs button")) b.addEventListener("click", () => showTab(b.dataset.tab));

async function loadAccounts() {
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
$("ops-month").addEventListener("change", loadOps);

async function loadOps() {
  const p = new URLSearchParams();
  if ($("ops-account").value) p.set("account_id", $("ops-account").value);
  if ($("ops-month").value) p.set("month", $("ops-month").value);
  const rows = await api(`/api/transactions?${p}`);
  const income = rows.filter((r) => r.amount_cents > 0).reduce((s, r) => s + r.amount_cents, 0);
  const spent = rows.filter((r) => r.amount_cents < 0).reduce((s, r) => s + r.amount_cents, 0);
  $("ops-summary").textContent = rows.length
    ? `${rows.length} opération(s) · entrées ${money(income)} · sorties ${money(spent)}`
    : "";
  $("ops-empty").hidden = rows.length > 0;
  $("ops-body").replaceChildren(...rows.map((r) => el("tr", {},
    el("td", { class: "nowrap" }, dateFr(r.date)),
    el("td", {}, r.label, el("div", { class: "muted small" }, r.account, r.hint ? " · " : "", r.hint ? HINT_LABEL[r.hint] || r.hint : "")),
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
  $("i-error").textContent = "";
}

$("i-file").addEventListener("change", () => {
  const f = $("i-file").files[0];
  if (!f) return;
  const fmt = /\.pdf$/i.test(f.name) || f.type === "application/pdf" ? "pdf" : "csv";
  imp = { file: f, fmt, parser: null, mapping: null };
  runPreview();
});
$("i-account").addEventListener("change", () => { if (imp) runPreview(); });
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

function renderRows() {
  $("i-body").replaceChildren(...imp.rows.map((t) => {
    const tags = [];
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

refresh().catch((e) => { document.body.textContent = e.message; });
