// Barre d'onglets « Liquid Glass » (iOS 27) du paquet @onlymoein/liquidglass, avec React embarqué.
// Expose une petite API sans JSX pour le reste de l'app (JavaScript sans React).
import { createElement as h } from "react";
import { createRoot } from "react-dom/client";
import { Alert, Glass, Menu, SearchField, SegmentedControl, Sheet, Slider, TabBar } from "@onlymoein/liquidglass";

// Seulement les composants utilisés par l'app (le reste n'est pas embarqué).
const LG = { Alert, Glass, Menu, SearchField, SegmentedControl, Sheet, Slider, TabBar };

// Insère un nœud DOM existant (formulaire, contenu de l'app) dans un composant React.
const Holder = ({ node, className }) => h("div", { className,
  ref: (div) => { if (div && node && node.parentNode !== div) div.append(node); } });

/**
 * Monte n'importe quel composant du paquet (Alert, Slider, SegmentedControl, SearchField, Menu, Glass…).
 * props.content : nœud DOM à placer à l'intérieur (facultatif). Renvoie { update(props), unmount() }.
 */
export function mount(el, name, props) {
  const Component = LG[name];
  if (!Component) throw new Error(`liquidglass : composant inconnu ${name}`);
  const root = createRoot(el);
  let current = props;
  const render = () => {
    const { content, contentClass, ...rest } = current;
    root.render(h(Component, rest, content ? h(Holder, { node: content, className: contentClass }) : undefined));
  };
  render();
  return { update(next) { current = { ...current, ...next }; render(); }, unmount() { root.unmount(); } };
}

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
