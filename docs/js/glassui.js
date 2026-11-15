// Verre « Liquid Glass » ailleurs que la barre d'onglets, sur téléphone seulement :
//  - en-tête collant en verre (logo, titre, version, verrouiller) ;
//  - réglages au doigt : thème (sélecteur à lentille), transparence (curseur à poignée de verre) ;
//  - recherche des opérations (champ en verre) ;
//  - listes de choix (compte, catégorie) en menus qui s'ouvrent depuis leur bouton.
// Chaque contrôle d'origine reste dans la page (masqué) et garde ses écouteurs : le verre ne fait
// que le piloter. Sans la bibliothèque (ordinateur, échec de chargement), rien ne change.
import { loadGlass } from "./glass.js";

const $ = (id) => document.getElementById(id);
const refreshers = [];

export async function setupGlassUi() {
  const lg = await loadGlass();
  if (!lg) return;
  document.body.classList.add("has-glass-ui");
  header(lg);
  theme(lg);
  transparency(lg);
  rangeAsSlider(lg, $("bg-speed"), "Vitesse du fond d'écran");
  search(lg);
  for (const [id, label] of [["ops-account", "Compte"], ["ops-category", "Catégorie"]]) selectAsMenu(lg, $(id), label);
  // Accueil : choix du compte réduit à une icône de banque (on garde presque toujours « Tous les comptes ») ;
  // le nom du compte s'affiche en petit seulement quand un compte précis est choisi.
  selectAsMenu(lg, $("dash-account"), "Compte", { compact: true });
  // Après un changement d'onglet, les valeurs ont pu être changées par le code (ex. « À classer »).
  document.addEventListener("tab-shown", () => refreshers.forEach((f) => f()));
}

function header(lg) {
  const row = document.createElement("div");
  row.className = "gh-row";
  const brand = document.querySelector(".brand-mark").cloneNode(true);
  const title = document.createElement("div");
  title.className = "gh-title";
  title.append("Budget ", Object.assign(document.createElement("span"), { className: "app-version", textContent: $("app-version").textContent }));
  const lock = document.createElement("button");
  lock.type = "button";
  lock.className = "gh-lock";
  lock.setAttribute("aria-label", "Verrouiller");
  lock.append($("lock-btn").querySelector("svg").cloneNode(true));
  lock.addEventListener("click", () => $("lock-btn").click());
  row.append(brand, title, lock);
  const wrap = document.createElement("div");
  wrap.className = "glass-header";
  document.querySelector(".shell").prepend(wrap);
  lg.mount(wrap, "Glass", { className: "gh-glass", content: row, contentClass: "gh-content" });
}

function theme(lg) {
  const box = $("glass-theme");
  $("glass-theme-row").hidden = false;
  const current = () => document.documentElement.dataset.theme || "auto";
  let seg = null;
  // Monté seulement quand la page Réglages est visible : la pastille se mesure sur l'option choisie
  // (montée dans une page masquée, elle resterait sous « Clair »).
  const mountNow = () => {
    if (seg || !box.offsetParent) return;
    seg = lg.mount(box, "SegmentedControl", { "aria-label": "Thème",
      items: [{ value: "light", label: "Clair" }, { value: "auto", label: "Auto" }, { value: "dark", label: "Sombre" }],
      value: current(),
      onValueChange: (v) => { document.querySelector(`[data-theme-choice="${v}"]`).click(); seg.update({ value: current() }); } });
  };
  mountNow();
  document.addEventListener("tab-shown", (e) => { if (e.detail === "settings") requestAnimationFrame(mountNow); });
}

function transparency(lg) {
  const range = $("glass-range");
  range.classList.add("glass-native-hidden");
  const slider = lg.mount($("glass-slider"), "Slider", { "aria-label": "Transparence de la barre d'onglets",
    min: 0, max: 100, step: 5, value: Number(range.value),
    onValueChange: (v) => { range.value = v; range.dispatchEvent(new Event("input")); slider.update({ value: v }); } });
  document.addEventListener("glass-transparency-change", (e) => slider.update({ value: e.detail }));
}

function search(lg) {
  const input = $("ops-q");
  input.classList.add("glass-native-hidden");
  const box = document.createElement("div");
  box.className = "glass-search";
  input.after(box);
  const field = lg.mount(box, "SearchField", { placeholder: "Libellé, montant, catégorie, note", "aria-label": "Rechercher", value: input.value,
    onValueChange: (v) => { input.value = v; input.dispatchEvent(new Event("input")); field.update({ value: v }); } });
  $("ops-reset").addEventListener("click", () => field.update({ value: "" }));
}

/** Remplace un <select> par un menu en verre qui pilote le <select> (masqué, toujours la source). */
const BANK_ICON = "M3 9l9-5 9 5M5 10v8M9.5 10v8M14.5 10v8M19 10v8M3 20h18";

function selectAsMenu(lg, sel, label, { compact = false } = {}) {
  if (!sel) return;
  sel.classList.add("glass-native-hidden");
  const box = document.createElement("div");
  box.className = "glass-select";
  sel.after(box);
  const item = (o) => ({ label: o.textContent, checked: o.value === sel.value, keepOpen: false,
    onSelect: () => { sel.value = o.value; sel.dispatchEvent(new Event("change", { bubbles: true })); refresh(); } });
  const build = () => {
    const items = [];
    for (const node of sel.children) {
      if (node.tagName === "OPTGROUP") {
        if (node.children.length) items.push({ heading: node.label }, ...[...node.children].map(item));
      } else items.push(item(node));
    }
    const cur = sel.options[sel.selectedIndex];
    if (compact) {
      const filtered = Boolean(sel.value);
      box.classList.toggle("filtered", filtered);
      tag.textContent = filtered && cur ? cur.textContent : "";
      tag.hidden = !filtered;
      return { "aria-label": `${label} : ${cur ? cur.textContent : ""}`, items, align: "end",
        icon: lg.h("svg", { viewBox: "0 0 24 24", width: 20, height: 20, fill: "none", stroke: "currentColor", strokeWidth: 1.8,
          strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": true }, lg.h("path", { d: BANK_ICON })) };
    }
    return { "aria-label": label, label: cur ? cur.textContent : label, items, align: "start" };
  };
  const tag = document.createElement("span");
  tag.className = "glass-select-tag";
  tag.hidden = true;
  if (compact) { box.classList.add("compact"); box.after(tag); }
  const menu = lg.mount(box, "Menu", build());
  const refresh = () => menu.update(build());
  sel.addEventListener("change", refresh);
  new MutationObserver(refresh).observe(sel, { childList: true, subtree: true });
  refreshers.push(refresh);
}

/** Remplace un <input type="range"> par le curseur en verre (le champ d'origine reste la source). */
function rangeAsSlider(lg, range, label) {
  if (!range) return;
  range.classList.add("glass-native-hidden");
  const box = document.createElement("div");
  box.className = "glass-slider";
  range.after(box);
  const slider = lg.mount(box, "Slider", { "aria-label": label,
    min: Number(range.min), max: Number(range.max), step: Number(range.step) || 1, value: Number(range.value),
    onValueChange: (v) => { range.value = v; range.dispatchEvent(new Event("input")); slider.update({ value: v }); } });
  // Valeur changée par le code (bouton « Par défaut ») : l'app envoie « change » sur le champ.
  range.addEventListener("change", () => slider.update({ value: Number(range.value) }));
}
