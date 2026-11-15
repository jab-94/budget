// Histogramme « Bar Chart » (d'après le composant easyui, React + framer-motion refait en JS sans dépendance) :
// colonnes groupées ou empilées (le passage de l'un à l'autre se transforme en douceur), légende qui masque
// une série, bande + infobulle qui suivent le doigt ou la souris (les autres groupes s'estompent à 0,38),
// navigation au clavier. Réglages d'origine : entrée 0,8 s (décalage 0,04 s par groupe + 0,025 s par série),
// ensuite ressort 0,5 s sans rebond ; coins 6 px ; 4 graduations « rondes » ; infobulle sur ressort 520/42.
import { EASE_OUT } from "./donut.js";
import { S, register, start, step } from "./motion.js";

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const reduceMotion = () => matchMedia("(prefers-reduced-motion: reduce)").matches;
function niceStep(raw) {
  if (!(raw > 0) || !isFinite(raw)) return 1;
  const exp = Math.floor(Math.log10(raw)), base = raw / 10 ** exp;
  return (base <= 1 ? 1 : base <= 2 ? 2 : base <= 2.5 ? 2.5 : base <= 5 ? 5 : 10) * 10 ** exp;
}
// Colonne à bout arrondi : toujours la même structure de commandes, donc deux colonnes se transforment l'une en l'autre.
function barPath(x, y, w, h, r) {
  const rr = Math.max(0, Math.min(r, w / 2, h));
  return `M${x} ${y + h}V${y + rr}Q${x} ${y} ${x + rr} ${y}H${x + w - rr}Q${x + w} ${y} ${x + w} ${y + rr}V${y + h}Z`;
}

/**
 * opts : { height, formatValue, formatTick, ariaLabel, extraRows(i) -> [[libellé, texte]], onPick(i), pickLabel,
 *          overlays(ctx) -> nœuds SVG (lignes de référence), variant: "grouped" | "stacked" }
 * update({ data: [{ label, values: { clé: nombre }, empty? }], series: [{ key, label, color }] })
 */
export function mountBarChart(root, opts) {
  const NS = document.querySelector("svg").namespaceURI; // lu sur une icône de la page (pas d'adresse dans le code)
  const mk = (tag, attrs = {}) => { const e = document.createElementNS(NS, tag); for (const k in attrs) e.setAttribute(k, attrs[k]); return e; };
  const height = opts.height || 260;
  root.classList.add("bchart");
  const wrap = document.createElement("div"); wrap.className = "bchart-wrap"; wrap.style.height = `${height}px`;
  const svg = mk("svg", { role: "img", tabindex: "0", class: "bchart-svg" });
  const gStatic = mk("g"), band = mk("rect", { class: "bchart-band", rx: 8 }), gBars = mk("g"), gOver = mk("g"), gLabels = mk("g");
  const surface = mk("rect", { fill: "transparent", class: "bchart-surface" });
  svg.append(gStatic, band, gBars, gOver, gLabels, surface);
  const tip = document.createElement("div"); tip.className = "bchart-tip"; tip.hidden = true;
  wrap.append(svg, tip);
  const legend = document.createElement("div"); legend.className = "bchart-legend"; legend.setAttribute("role", "group");
  root.replaceChildren(wrap, legend);

  let data = [], series = [], hidden = new Set(), variant = opts.variant || "grouped", active = null;
  let bars = new Map(); // `${i}|${key}` -> { path, cur:{x,y,w,h,r,o}, from, to, t0, dur, delay }
  let geo = null, raf = 0, entered = false;
  const tipX = S(0, 866, 70), tipY = S(0, 866, 70), bandX = S(0, 866, 70); // ressort 520/42 (masse 0,6)
  let tipSeen = false;
  register({
    frame(dt) { [tipX, tipY, bandX].forEach((s) => step(s, dt)); },
    settled() { return [tipX, tipY, bandX].every((s) => Math.abs(s.x - s.t) < 0.05 && Math.abs(s.v) < 0.05); },
    render() {
      tip.style.transform = `translate(${tipX.x.toFixed(1)}px, ${tipY.x.toFixed(1)}px)`;
      band.setAttribute("x", bandX.x.toFixed(1));
    },
  });

  const val = (d, k) => { const v = d.values[k]; return typeof v === "number" && isFinite(v) ? Math.max(0, v) : 0; };
  const visible = () => series.filter((s) => !hidden.has(s.key));

  function layout() {
    const width = Math.max(240, root.clientWidth || 600);
    const vis = visible(), stacked = variant === "stacked", n = data.length;
    const maxV = Math.max(1e-9, ...data.map((d) => (stacked ? vis.reduce((s, x) => s + val(d, x.key), 0) : Math.max(0, ...vis.map((x) => val(d, x.key))))),
      ...(opts.minMax ? [opts.minMax()] : []));
    const stepV = niceStep(maxV / 4), yMax = stepV * 4;
    const ticks = [0, 1, 2, 3, 4].map((i) => i * stepV);
    const tickText = ticks.map(opts.formatTick);
    const M = { top: 8, right: opts.rightMargin || 6, bottom: 26, left: Math.ceil(Math.max(...tickText.map((s) => s.length)) * 6.4) + 10 };
    const iw = Math.max(10, width - M.left - M.right), ih = height - M.top - M.bottom, base = M.top + ih;
    const y = (v) => base - (v / yMax) * ih;
    const stepX = iw / Math.max(1, n), k = Math.max(1, vis.length), gapIn = 3;
    const barW = stacked ? clamp(stepX * 0.62, 4, 46) : clamp((stepX * 0.74 - gapIn * (k - 1)) / k, 3, 34);
    const groupW = stacked ? barW : barW * k + gapIn * (k - 1);
    const labelEvery = Math.max(1, Math.ceil((Math.max(...data.map((d) => d.label.length), 1) * 6.4 + 14) / stepX));
    geo = { width, M, iw, ih, base, y, stepX, ticks, tickText, labelEvery, yMax };
    const targets = new Map();
    data.forEach((d, i) => {
      const centre = M.left + stepX * i + stepX / 2;
      let cum = 0;
      const topSeries = [...vis].reverse().find((x) => val(d, x.key) > 0);
      series.forEach((s) => {
        const vi = vis.findIndex((x) => x.key === s.key), v = val(d, s.key);
        let g;
        if (vi < 0) g = { x: centre, y: base, w: 0, h: 0, r: 0, o: 0 };
        else if (stacked) {
          const y1 = y(cum + v), y0 = y(cum);
          const h = Math.max(0, y0 - y1 - (cum > 0 && v > 0 ? 1.5 : 0));
          cum += v;
          g = { x: centre - barW / 2, y: y1, w: barW, h, r: topSeries && topSeries.key === s.key ? Math.min(6, barW / 2) : 0, o: 1 };
        } else {
          const h = (v / yMax) * ih;
          g = { x: centre - groupW / 2 + vi * (barW + gapIn), y: base - h, w: barW, h, r: Math.min(6, barW / 2), o: 1 };
        }
        targets.set(`${i}|${s.key}`, { g, i, si: series.indexOf(s), color: s.color, centre });
      });
    });
    return targets;
  }

  function drawStatic() {
    const { width, M, base, ih, ticks, tickText, labelEvery, stepX } = geo;
    svg.setAttribute("width", width); svg.setAttribute("height", height); svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
    gStatic.replaceChildren(...ticks.flatMap((_, t) => {
      const gy = base - (t / 4) * ih;
      const line = mk("line", { x1: M.left, x2: width - M.right, y1: gy, y2: gy, class: t === 0 ? "bchart-base" : "bchart-grid" });
      const tx = mk("text", { x: M.left - 8, y: gy, "text-anchor": "end", "dominant-baseline": "middle", class: "bchart-tick" });
      tx.textContent = tickText[t];
      return [line, tx];
    }));
    gLabels.replaceChildren(...data.map((d, i) => {
      if (i % labelEvery !== 0 && !d.always) return null;
      const t = mk("text", { x: M.left + stepX * i + stepX / 2, y: height - 8, "text-anchor": "middle", class: "bchart-xlab" + (d.current ? " current" : "") });
      t.textContent = d.label;
      t.dataset.i = i;
      return t;
    }).filter(Boolean));
    band.setAttribute("y", M.top); band.setAttribute("height", ih); band.setAttribute("width", stepX);
    surface.setAttribute("x", M.left); surface.setAttribute("y", M.top); surface.setAttribute("width", geo.iw); surface.setAttribute("height", ih);
    gOver.replaceChildren(...(opts.overlays ? opts.overlays({ mk, ...geo }) : []));
  }

  function animateTo(targets, mode) { // mode : "intro" | "spring" | "instant"
    const now = performance.now(), reduce = reduceMotion();
    for (const [key, t] of targets) {
      let b = bars.get(key);
      if (!b) {
        const path = mk("path", { fill: t.color, class: "bchart-bar" });
        const start = { x: t.centre - t.g.w / 2, y: geo.base, w: t.g.w, h: 0, r: 0, o: 0 };
        b = { path, cur: mode === "intro" ? start : { ...t.g }, i: t.i };
        bars.set(key, b);
        let grp = gBars.querySelector(`g[data-i="${t.i}"]`);
        if (!grp) { grp = mk("g", { "data-i": t.i, class: "bchart-group" }); gBars.append(grp); }
        grp.append(path);
      }
      b.path.setAttribute("fill", t.color);
      b.from = { ...b.cur }; b.to = t.g; b.t0 = now;
      b.dur = reduce || mode === "instant" ? 0 : mode === "intro" ? 0.8 : 0.5;
      b.delay = mode === "intro" && !reduce ? t.i * 0.04 + t.si * 0.025 : 0;
    }
    if (!raf) raf = requestAnimationFrame(tick);
  }
  function tick(now) {
    let busy = false;
    for (const b of bars.values()) {
      const p = b.dur ? clamp((now - b.t0 - b.delay * 1000) / (b.dur * 1000), 0, 1) : 1;
      const e = EASE_OUT(p);
      for (const k of ["x", "y", "w", "h", "r", "o"]) b.cur[k] = b.from[k] + (b.to[k] - b.from[k]) * e;
      b.path.setAttribute("d", barPath(b.cur.x, b.cur.y, Math.max(0, b.cur.w), Math.max(0, b.cur.h), Math.max(0, b.cur.r)));
      b.path.style.opacity = b.cur.o;
      if (p < 1) busy = true;
    }
    raf = busy ? requestAnimationFrame(tick) : 0;
  }

  function groupTop(i) {
    const d = data[i], vis = visible();
    const v = variant === "stacked" ? vis.reduce((s, x) => s + val(d, x.key), 0) : Math.max(0, ...vis.map((x) => val(d, x.key)));
    return geo.y(v);
  }
  function setActive(i) {
    active = i;
    gBars.querySelectorAll(".bchart-group").forEach((g) => { g.style.opacity = active === null || Number(g.dataset.i) === active ? 1 : 0.38; });
    gLabels.querySelectorAll(".bchart-xlab").forEach((t) => t.classList.toggle("on", Number(t.dataset.i) === active));
    band.classList.toggle("on", active !== null);
    if (active === null) { tip.hidden = true; tipSeen = false; return; }
    bandX.t = geo.M.left + geo.stepX * active;
    if (!band.classList.contains("seen")) { bandX.x = bandX.t; band.classList.add("seen"); }
    renderTip();
    start();
  }
  function renderTip() {
    const d = data[active], vis = visible();
    const rows = [];
    const title = document.createElement("p"); title.className = "bchart-tip-title"; title.textContent = d.title || d.label;
    rows.push(title);
    if (d.empty) { const p = document.createElement("p"); p.className = "muted"; p.textContent = "Aucune opération"; rows.push(p); }
    else {
      const ul = document.createElement("ul");
      for (const s of vis) {
        const li = document.createElement("li");
        const name = document.createElement("span"); name.className = "bchart-tip-name";
        const dot = document.createElement("span"); dot.className = "bchart-dot"; dot.style.background = s.color;
        name.append(dot, s.label);
        const v = document.createElement("span"); v.className = "bchart-tip-val"; v.textContent = opts.formatValue(val(d, s.key));
        li.append(name, v); ul.append(li);
      }
      rows.push(ul);
      const extra = [];
      if (variant === "stacked" && vis.length > 1) extra.push(["Total", opts.formatValue(vis.reduce((s, x) => s + val(d, x.key), 0))]);
      if (opts.extraRows) extra.push(...opts.extraRows(active));
      for (const [k, v] of extra) {
        const p = document.createElement("p"); p.className = "bchart-tip-total";
        const a = document.createElement("span"); a.textContent = k; const b = document.createElement("span"); b.textContent = v;
        p.append(a, b); rows.push(p);
      }
    }
    if (opts.onPick && !d.empty) {
      const btn = document.createElement("button"); btn.type = "button"; btn.className = "link bchart-pick";
      btn.textContent = opts.pickLabel || "Afficher ›";
      const i = active;
      btn.addEventListener("click", (e) => { e.stopPropagation(); opts.onPick(i); });
      rows.push(btn);
    }
    tip.replaceChildren(...rows);
    tip.hidden = false;
    const w = tip.offsetWidth || 130, h = tip.offsetHeight || 60;
    const x = geo.M.left + geo.stepX * (active + 0.5);
    const tx = clamp(x - w / 2, 0, Math.max(0, geo.width - w));
    let ty = groupTop(active) - h - 12;
    if (ty < 0) ty = groupTop(active) + 18;
    tipX.t = tx; tipY.t = ty;
    if (!tipSeen) { tipX.x = tx; tipY.x = ty; tipX.v = tipY.v = 0; tipSeen = true; }
  }

  function renderLegend() {
    legend.hidden = series.length < 2;
    legend.replaceChildren(...series.map((s) => {
      const on = !hidden.has(s.key);
      const b = document.createElement("button"); b.type = "button"; b.className = "bchart-chip" + (on ? "" : " off");
      b.setAttribute("aria-pressed", String(on));
      const dot = document.createElement("span"); dot.className = "bchart-dot"; dot.style.background = on ? s.color : "currentColor";
      b.append(dot, s.label);
      b.addEventListener("click", () => {
        if (hidden.has(s.key)) hidden.delete(s.key); else if (visible().length > 1) hidden.add(s.key);
        relayout("spring"); renderLegend();
      });
      return b;
    }));
  }

  function relayout(mode) {
    const targets = layout();
    drawStatic();
    animateTo(targets, mode);
    if (active !== null && active < data.length) setActive(active); else setActive(null);
  }

  // Doigt / souris : la bande et l'infobulle suivent ; un clic de souris ouvre le mois (onPick).
  const indexAt = (e) => { const box = surface.getBoundingClientRect(); return clamp(Math.floor((e.clientX - box.left) / (box.width / Math.max(1, data.length))), 0, data.length - 1); };
  surface.addEventListener("pointermove", (e) => { if (e.pointerType === "mouse" || active !== null) setActive(indexAt(e)); });
  surface.addEventListener("pointerdown", (e) => setActive(indexAt(e)));
  surface.addEventListener("pointerleave", (e) => { if (e.pointerType === "mouse") setActive(null); });
  surface.addEventListener("click", (e) => { if (e.pointerType === "mouse" && opts.onPick && !data[indexAt(e)].empty) opts.onPick(indexAt(e)); });
  surface.style.cursor = opts.onPick ? "pointer" : "default";
  document.addEventListener("pointerdown", (e) => { if (active !== null && !wrap.contains(e.target)) setActive(null); });
  svg.addEventListener("keydown", (e) => {
    const n = data.length;
    if (e.key === "ArrowRight") setActive(clamp((active ?? -1) + 1, 0, n - 1));
    else if (e.key === "ArrowLeft") setActive(clamp((active ?? n) - 1, 0, n - 1));
    else if (e.key === "Home") setActive(0);
    else if (e.key === "End") setActive(n - 1);
    else if (e.key === "Escape") setActive(null);
    else if (e.key === "Enter" && active !== null && opts.onPick) opts.onPick(active);
    else return;
    e.preventDefault();
  });
  // Perte du focus clavier : on referme, sauf si c'est un toucher dans le graphique (ex. le bouton de l'infobulle).
  let pointerInside = 0;
  wrap.addEventListener("pointerdown", () => { pointerInside = performance.now(); }, true);
  svg.addEventListener("blur", () => { if (performance.now() - pointerInside > 400) setActive(null); });
  let lastW = 0;
  new ResizeObserver(() => { const w = root.clientWidth; if (w && w !== lastW && data.length) { lastW = w; relayout("instant"); } }).observe(root);

  return {
    update(next) {
      const sameShape = next.data.length === data.length && next.series.map((s) => s.key).join() === series.map((s) => s.key).join();
      data = next.data; series = next.series;
      for (const k of [...hidden]) if (!series.some((s) => s.key === k)) hidden.delete(k);
      if (!sameShape) { bars = new Map(); gBars.replaceChildren(); }
      svg.setAttribute("aria-label", opts.ariaLabel);
      lastW = root.clientWidth;
      relayout(!entered || !sameShape ? "intro" : "spring");
      entered = true;
      renderLegend();
    },
    setVariant(v) { if (v !== variant) { variant = v; if (data.length) relayout("spring"); } },
    get variant() { return variant; },
  };
}
