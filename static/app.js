// Budget local — front en JavaScript simple, sans aucune bibliothèque.
// Toutes les requêtes partent vers des chemins RELATIFS ("/api/...") : la
// Content-Security-Policy interdit de toute façon tout autre destination.
"use strict";

const TOKEN = document.querySelector('meta[name="session-token"]').content;

async function api(path, options = {}) {
  const res = await fetch(path, {
    method: options.method || "GET",
    headers: { "Content-Type": "application/json", "X-Budget-Token": TOKEN },
    body: options.body ? JSON.stringify(options.body) : undefined,
    credentials: "same-origin",
    cache: "no-store",
  });
  let data = null;
  try { data = await res.json(); } catch (_) { /* réponse vide */ }
  if (!res.ok) {
    const err = new Error((data && data.detail) || "Erreur inattendue.");
    err.status = res.status;
    throw err;
  }
  return data;
}

const $ = (id) => document.getElementById(id);

function el(tag, attrs = {}, text) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "style") e.style.cssText = v; else e.setAttribute(k, v);
  }
  if (text !== undefined) e.textContent = text; // textContent : jamais d'injection HTML
  return e;
}

let status = null;

async function refresh() {
  status = await api("/api/status");
  if (status.unlocked) return showApp();
  showLock();
}

function showLock() {
  $("app-screen").hidden = true;
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

async function showApp() {
  $("lock-screen").hidden = true;
  $("app-screen").hidden = false;
  $("lock-btn").hidden = false;
  $("autolock").textContent = status.auto_lock_minutes;
  const cats = await api("/api/categories");
  const ul = $("categories");
  ul.replaceChildren(...cats.map((c) => el("li", { style: `--dot:${c.color || "#999"}` }, c.name)));
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
  await api("/api/vault/lock", { method: "POST" });
  await refresh();
});

// Si le serveur a verrouillé le coffre pour inactivité, on revient à l'écran de mot de passe.
window.addEventListener("unhandledrejection", (ev) => {
  if (ev.reason && ev.reason.status === 423) refresh();
});

refresh().catch((e) => { document.body.textContent = e.message; });
