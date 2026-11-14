// Barre d'onglets « Liquid Glass » (iOS 27) du paquet @onlymoein/liquidglass, avec React embarqué.
// Expose une petite API sans JSX pour le reste de l'app (JavaScript sans React).
import { createElement as h } from "react";
import { createRoot } from "react-dom/client";
import { Sheet, TabBar } from "@onlymoein/liquidglass";

/** Monte une barre d'onglets dans `el`. props : { items, value, onValueChange }. Renvoie { update(props) }. */
export function mountTabBar(el, props) {
  const root = createRoot(el);
  let current = props;
  const render = () => root.render(h(TabBar, { "aria-label": "Menu", ...current }));
  render();
  return { update(next) { current = { ...current, ...next }; render(); } };
}

/** Feuille qui monte du bas de l'écran. props : { open, onOpenChange, label, children (élément DOM) }. */
export function mountSheet(el, props) {
  const root = createRoot(el);
  let current = props;
  const Holder = ({ node }) => h("div", { ref: (div) => { if (div && node && node.parentNode !== div) div.append(node); } });
  const render = () => root.render(h(Sheet, { "aria-label": current.label, open: current.open, onOpenChange: current.onOpenChange,
    detents: ["medium"] }, h(Holder, { node: current.content })));
  render();
  return { update(next) { current = { ...current, ...next }; render(); } };
}

export { h };
