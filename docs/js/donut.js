// Anneau « Donut Chart » (d'après le composant easyui, React + framer-motion refait en JS sans dépendance) :
// arcs à bouts ronds qui se dessinent l'un après l'autre, total au centre qui affiche la part survolée ou
// touchée, légende qui masque une part sans refermer l'anneau. Mêmes réglages que l'original : épaisseur 16,
// +4 au survol, écart entre parts 3,5 px, dessin 1 s (décalage 0,12 s + 0,09 s par part), mises à jour 0,7 s.

export const CHART_COLORS = ["#6d7cff", "#34d1bf", "#ffb44c", "#ff6b8b", "#a78bfa", "#5ac8fa"];

// Courbe cubic-bezier(0.23, 1, 0.32, 1) de l'original.
function bezier(x1, y1, x2, y2) {
  const cx = 3 * x1, bx = 3 * (x2 - x1) - cx, ax = 1 - cx - bx;
  const cy = 3 * y1, by = 3 * (y2 - y1) - cy, ay = 1 - cy - by;
  const fx = (t) => ((ax * t + bx) * t + cx) * t;
  return (x) => {
    let lo = 0, hi = 1, t = x;
    for (let i = 0; i < 20; i++) { const v = fx(t); if (Math.abs(v - x) < 1e-4) break; if (v < x) lo = t; else hi = t; t = (lo + hi) / 2; }
    return ((ay * t + by) * t + cy) * t;
  };
}
export const EASE_OUT = bezier(0.23, 1, 0.32, 1);
const reduce = () => matchMedia("(prefers-reduced-motion: reduce)").matches;

const pt = (cx, cy, r, a) => ({ x: cx + r * Math.sin(a), y: cy - r * Math.cos(a) });
function arcPath(cx, cy, r, a0, a1) {
  const p0 = pt(cx, cy, r, a0), p1 = pt(cx, cy, r, a1);
  return `M${p0.x.toFixed(2)} ${p0.y.toFixed(2)}A${r} ${r} 0 ${a1 - a0 > Math.PI ? 1 : 0} 1 ${p1.x.toFixed(2)} ${p1.y.toFixed(2)}`;
}

export function mountDonut(root, { format, centerLabel = "Total", size = 240, thickness = 16, ariaLabel = "Répartition" }) {
  // Espace de noms SVG lu sur une icône de la page (évite d'écrire une adresse dans le code).
  const svgNs = document.querySelector("svg").namespaceURI;
  const mk = (tag, attrs = {}) => { const e = document.createElementNS(svgNs, tag); for (const k in attrs) e.setAttribute(k, attrs[k]); return e; };
  root.classList.add("donut");
  const ringBox = document.createElement("div"); ringBox.className = "donut-ring";
  const svg = mk("svg", { role: "img", "aria-label": ariaLabel });
  const track = mk("path", { class: "donut-track", fill: "none", "stroke-linecap": "round" });
  svg.append(track);
  const center = document.createElement("div"); center.className = "donut-center";
  ringBox.append(svg, center);
  const legend = document.createElement("ul"); legend.className = "donut-legend"; legend.setAttribute("aria-label", "Légende");
  root.replaceChildren(ringBox, legend);

  let items = [], hidden = new Set(), active = null, arcs = [], geo = null, first = true, raf = 0, total = 0;
  const shownTotal = { v: 0 };
  const anims = []; // { obj, key, from, to, t0, dur, delay }

  function tween(obj, key, to, dur, delay = 0) {
    for (let i = anims.length - 1; i >= 0; i--) if (anims[i].obj === obj && anims[i].key === key) anims.splice(i, 1);
    if (reduce() || dur === 0) { obj[key] = to; draw(); return; }
    anims.push({ obj, key, from: obj[key], to, t0: performance.now(), dur, delay });
    if (!raf) raf = requestAnimationFrame(tick);
  }
  function tick(now) {
    for (let i = anims.length - 1; i >= 0; i--) {
      const a = anims[i];
      const t = Math.min(1, Math.max(0, (now - a.t0 - a.delay * 1000) / (a.dur * 1000)));
      a.obj[a.key] = a.from + (a.to - a.from) * EASE_OUT(t);
      if (t >= 1) anims.splice(i, 1);
    }
    draw();
    raf = anims.length ? requestAnimationFrame(tick) : 0;
  }

  function measure() {
    const w = root.clientWidth || 300;
    const side = w >= 520;
    root.classList.toggle("donut-side", side);
    const D = Math.round(Math.max(120, Math.min(size, side ? w * 0.42 : w)));
    const grow = thickness + 6, r = D / 2 - grow / 2 - 1;
    geo = { D, r, cx: D / 2, cy: D / 2 };
    svg.setAttribute("width", D); svg.setAttribute("height", D); svg.setAttribute("viewBox", `0 0 ${D} ${D}`);
    ringBox.style.width = ringBox.style.height = `${D}px`;
    track.setAttribute("d", arcPath(geo.cx, geo.cy, r, 0, Math.PI * 1.9999));
    track.setAttribute("stroke-width", thickness);
    center.style.setProperty("--value-size", `${Math.max(22, Math.min(38, D * 0.15))}px`);
  }

  function targets() {
    total = items.reduce((s, x, i) => s + (hidden.has(i) ? 0 : Math.max(0, x.value)), 0);
    const r = geo.r, pad = 3.5 / r + thickness / 2 / r, A = Math.PI * 2;
    let acc = 0;
    return items.map((it, i) => {
      const f = hidden.has(i) || total === 0 ? 0 : Math.max(0, it.value) / total;
      const a0 = acc * A; acc += f; const a1 = acc * A;
      const mid = (a0 + a1) / 2, room = a1 - a0 - 2 * pad;
      return { f, a0: room > 0 ? a0 + pad : mid, a1: room > 0 ? a1 - pad : mid };
    });
  }

  function draw() {
    if (!geo) return;
    arcs.forEach((arc) => {
      const d = arcPath(geo.cx, geo.cy, geo.r, arc.s, Math.max(arc.e, arc.s + 0.0004));
      arc.path.setAttribute("d", d); arc.hit.setAttribute("d", d);
    });
    if (active === null) center.querySelector(".donut-value").textContent = format(shownTotal.v);
  }

  function setActive(i) {
    active = i !== null && hidden.has(i) ? null : i; // une part masquée ne s'affiche pas au centre
    arcs.forEach((arc, k) => {
      arc.g.style.opacity = active !== null && active !== k ? 0.35 : 1;
      arc.path.setAttribute("stroke-width", hidden.has(k) ? 0 : active === k ? thickness + 4 : thickness);
    });
    renderCenter();
  }

  function renderCenter() {
    const seg = active !== null ? arcs[active] : null;
    const box = document.createElement("div");
    box.className = "donut-readout";
    const lab = document.createElement("p"); lab.className = "donut-label"; lab.textContent = seg ? items[active].label : centerLabel;
    const val = document.createElement("p"); val.className = "donut-value";
    val.textContent = seg ? format(items[active].value) : format(shownTotal.v);
    box.append(lab, val);
    if (seg) { const pc = document.createElement("p"); pc.className = "donut-pct"; pc.textContent = `${Math.round(seg.f * 100)} %`; box.append(pc); }
    center.replaceChildren(box);
  }

  function renderLegend() {
    legend.replaceChildren(...items.map((it, i) => {
      const li = document.createElement("li");
      const b = document.createElement("button");
      b.type = "button"; b.className = "donut-item" + (hidden.has(i) ? " off" : "");
      b.setAttribute("aria-pressed", String(!hidden.has(i)));
      const dot = document.createElement("span"); dot.className = "donut-dot"; dot.style.background = it.color;
      const name = document.createElement("span"); name.className = "donut-name"; name.textContent = it.label;
      const v = document.createElement("span"); v.className = "donut-amount"; v.textContent = format(it.value);
      const p = document.createElement("span"); p.className = "donut-share";
      p.textContent = hidden.has(i) ? "—" : `${Math.round((arcs[i]?.f || 0) * 100)} %`;
      b.append(dot, name, v, p);
      b.addEventListener("click", () => toggle(i));
      b.addEventListener("pointerenter", (e) => { if (e.pointerType === "mouse") setActive(i); });
      b.addEventListener("pointerleave", (e) => { if (e.pointerType === "mouse") setActive(null); });
      b.addEventListener("focus", () => { if (b.matches(":focus-visible") && !hidden.has(i)) setActive(i); }); // clavier seulement
      b.addEventListener("blur", () => setActive(null));
      li.append(b);
      return li;
    }));
  }

  function toggle(i) {
    if (hidden.has(i)) hidden.delete(i);
    else if (items.length - hidden.size > 1) hidden.add(i);
    if (active === i && hidden.has(i)) active = null;
    layout(false);
  }

  function layout(intro) {
    const t = targets();
    t.forEach((tg, i) => {
      const arc = arcs[i];
      arc.f = tg.f;
      if (intro) { arc.s = tg.a0; arc.e = tg.a0; tween(arc, "e", tg.a1, 1, 0.12 + i * 0.09); }
      else { tween(arc, "s", tg.a0, 0.7); tween(arc, "e", tg.a1, 0.7); }
    });
    tween(shownTotal, "v", total, intro ? 0.8 : 0.8);
    setActive(active);
    renderLegend();
  }

  // Toucher en dehors : on referme la part sélectionnée.
  document.addEventListener("pointerdown", (e) => { if (active !== null && !ringBox.contains(e.target) && !legend.contains(e.target)) setActive(null); });
  new ResizeObserver(() => { const old = geo && geo.D; measure(); if (old !== geo.D) { layout(false); } }).observe(root);

  return {
    update(next) {
      items = next.map((d, i) => ({ ...d, color: d.color || CHART_COLORS[i % CHART_COLORS.length] }));
      hidden = new Set(); active = null;
      measure();
      arcs.forEach((a) => a.g.remove());
      arcs = items.map((it, i) => {
        const g = mk("g", { class: "donut-arc" });
        const path = mk("path", { fill: "none", stroke: it.color, "stroke-width": thickness, "stroke-linecap": "round" });
        const hit = mk("path", { fill: "none", stroke: "transparent", "stroke-width": 30, "stroke-linecap": "round", "pointer-events": "stroke" });
        hit.setAttribute("aria-label", `${it.label} : ${format(it.value)}`);
        // Souris : survol ; doigt : un toucher sélectionne, un second désélectionne.
        hit.addEventListener("pointerenter", (e) => { if (e.pointerType === "mouse") setActive(i); });
        hit.addEventListener("pointerleave", (e) => { if (e.pointerType === "mouse") setActive(null); });
        hit.addEventListener("click", (e) => { if (e.pointerType !== "mouse" || active !== i) setActive(active === i && e.pointerType !== "mouse" ? null : i); });
        g.append(path, hit);
        svg.append(g);
        return { g, path, hit, s: 0, e: 0, f: 0 };
      });
      if (first) shownTotal.v = 0;
      layout(true);
      first = false;
    },
  };
}
