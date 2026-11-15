// Barre d'onglets « Liquid Glass » en bas de l'écran, sur téléphone seulement (le paquet
// @onlymoein/liquidglass et React ne sont chargés que dans ce cas : l'ordinateur garde le menu latéral).
// 3 onglets principaux + « Plus » qui ouvre une feuille avec les autres pages (dont Réglages).
// « Importer » n'est plus dans la barre : le bouton de l'accueil y mène (et il reste dans « Plus »).
// Comptes et Catégories sont rangés dans Réglages.

const MAIN = ["dashboard", "ops", "subs"];
const SHORT = { dashboard: "Accueil", ops: "Opérations", subs: "Abonnements" };
const IN_SETTINGS = ["accounts", "categories"];
const MORE_ICON = "M5 12h.01M12 12h.01M19 12h.01";

import { loadGlass } from "./glass.js";

export async function setupGlassTabBar({ showTab, current }) {
  const lg = await loadGlass();
  if (!lg) return null;
  const { h } = lg;

  const navButtons = [...document.querySelectorAll("#tabs button[data-tab]")];
  const icon = (d) => h("svg", { viewBox: "0 0 24 24", width: 26, height: 26, fill: "none", stroke: "currentColor",
    strokeWidth: 1.8, strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": true }, h("path", { d }));
  const pathOf = (b) => b.querySelector("svg path")?.getAttribute("d") || "";
  const labelOf = (b) => [...b.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent).join("").trim();

  const items = MAIN.map((tab) => ({ value: tab, label: SHORT[tab], icon: icon(pathOf(navButtons.find((b) => b.dataset.tab === tab))) }));
  items.push({ value: "more", label: "Plus", icon: icon(MORE_ICON) });
  const valueFor = (tab) => (MAIN.includes(tab) ? tab : "more");

  // Feuille « Plus » : les autres pages, avec les mêmes icônes que le menu latéral.
  const list = document.createElement("ul");
  list.className = "more-list";
  let sheet = null;
  for (const b of navButtons.filter((x) => !MAIN.includes(x.dataset.tab) && !IN_SETTINGS.includes(x.dataset.tab))) {
    const li = document.createElement("li");
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "more-item";
    btn.append(b.querySelector("svg").cloneNode(true), labelOf(b));
    const count = b.querySelector(".nav-count");
    if (count) btn.append(count.cloneNode(true));
    btn.addEventListener("click", () => { sheet.update({ open: false }); showTab(b.dataset.tab); });
    li.append(btn);
    list.append(li);
  }

  const barEl = document.getElementById("glass-tabbar");
  const sheetEl = document.getElementById("glass-sheet");
  sheet = lg.mountSheet(sheetEl, { label: "Plus de pages", open: false, content: list,
    onOpenChange: (open) => sheet.update({ open }) });
  const bar = lg.mountTabBar(barEl, {
    items, value: valueFor(current()),
    onValueChange: (v) => {
      if (v === "more") { sheet.update({ open: true }); bar.update({ value: "more" }); return; }
      showTab(v);
    },
  });
  document.body.classList.add("has-glass-tabbar");
  return {
    select(tab) { bar.update({ value: valueFor(tab) }); },
    refreshCounts() {
      for (const b of navButtons) {
        const c = b.querySelector(".nav-count");
        const target = [...list.querySelectorAll(".more-item")].find((x) => x.textContent.startsWith(labelOf(b)));
        const old = target?.querySelector(".nav-count");
        if (c && old) { old.hidden = c.hidden; old.textContent = c.textContent; }
      }
    },
  };
}
