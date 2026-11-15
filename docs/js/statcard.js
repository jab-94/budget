// Carte « Dépenses » animée (d'après le composant « Stat card » de designbookmark.com).
// Changer d'onglet (Semaine / Mois / 12 mois) fait glisser la pastille, rouler le montant et le
// pourcentage, et chaque point de la courbe rejoint sa nouvelle hauteur sur un ressort, l'un après
// l'autre (0,03 s d'écart). Mêmes ressorts que l'original : points 200/17, chiffres 160/22, pastille 380/30.
import { S, after, atRest, clamp, register, start, step } from "./motion.js";

// upIsGood : une hausse est une bonne nouvelle (revenus) -> pastille verte ; sinon rouge (dépenses).
export function mountStatCard(root, { format, describe, upIsGood = false, pointLabel = null, pointNote = "" }) {
  const q = (s) => root.querySelector(s);
  const chart = q(".sc-chart"), line = q(".sc-line"), fill = q(".sc-fill"), dot = q(".sc-dot");
  const big = q(".sc-big"), delta = q(".sc-delta"), pill = q(".sc-pill"), lab = q(".sc-lab"), cmp = q(".sc-cmp");
  const btns = [...root.querySelectorAll(".sc-seg button")];
  const N = 12, H = 96;
  const pts = Array.from({ length: N }, () => S(0, 200, 17));
  const val = S(0, 160, 22), dv = S(0, 160, 22), px = S(0, 380, 30), pw = S(0, 380, 30);
  const springs = [...pts, val, dv, px, pw];
  let ranges = null, r = 1, gen = 0;
  let scrub = null; // point montré sous le doigt / le curseur, ou null

  // Curseur : ligne pointillée verticale + point sur la courbe (thème « Earnings »).
  const NS = chart.namespaceURI;
  const cursor = document.createElementNS(NS, "g");
  cursor.setAttribute("visibility", "hidden");
  const cLine = document.createElementNS(NS, "line");
  cLine.setAttribute("class", "sc-cursor");
  const cDot = document.createElementNS(NS, "circle");
  cDot.setAttribute("class", "sc-cursor-dot");
  cDot.setAttribute("r", "4.5");
  cursor.append(cLine, cDot);
  chart.append(cursor);

  // Hauteurs 0..1 : le plus bas et le plus haut des 12 points occupent presque toute la hauteur.
  const normalize = (values) => {
    const lo = Math.min(...values), hi = Math.max(...values);
    return values.map((v) => (hi === lo ? (hi > 0 ? 0.5 : 0.08) : 0.08 + ((v - lo) / (hi - lo)) * 0.86));
  };

  function placePill(snap = false) {
    const b = btns[r];
    if (!b.offsetWidth) return;
    px.t = b.offsetLeft; pw.t = b.offsetWidth;
    if (snap || !pw.x) { px.x = px.t; pw.x = pw.t; px.v = pw.v = 0; }
  }

  function pick(i) {
    r = i;
    endScrub(false);
    const g = ++gen;
    btns.forEach((b, k) => { b.classList.toggle("on", k === i); b.setAttribute("aria-pressed", String(k === i)); });
    placePill();
    if (ranges) {
      const R = ranges[i];
      val.t = R.value_cents / 100;
      dv.t = R.delta_pct ?? 0;
      const d = describe(R);
      lab.textContent = d.label;
      cmp.textContent = d.compare;
      delta.hidden = R.delta_pct === null;
      const up = (R.delta_pct ?? 0) > 0, down = (R.delta_pct ?? 0) < 0;
      delta.classList.toggle("bad", upIsGood ? down : up);
      delta.classList.toggle("good", upIsGood ? up : down);
      const target = normalize(R.points);
      pts.forEach((p, k) => after(k * 0.03, () => { if (gen === g) { p.t = target[k]; start(); } }));
    }
    start();
  }
  btns.forEach((b, i) => b.addEventListener("click", () => pick(i)));

  // Glisser sur la courbe : le montant suit le doigt (comme le composant d'origine).
  const indexAt = (ev) => {
    const box = chart.getBoundingClientRect();
    return Math.round(clamp((ev.clientX - box.left - 4) / Math.max(1, box.width - 8), 0, 1) * (N - 1));
  };
  function showScrub(i) {
    if (!ranges || !pointLabel) return;
    scrub = i;
    root.classList.add("sc-scrub");
    const R = ranges[r];
    val.t = R.points[i] / 100;
    lab.textContent = pointLabel(R, i);
    cmp.textContent = pointNote;
    delta.hidden = true;
    cursor.setAttribute("visibility", "visible");
    start();
  }
  function endScrub(restore = true) {
    if (scrub === null) return;
    scrub = null;
    root.classList.remove("sc-scrub");
    cursor.setAttribute("visibility", "hidden");
    if (restore && ranges) {
      const R = ranges[r];
      val.t = R.value_cents / 100;
      const d = describe(R);
      lab.textContent = d.label;
      cmp.textContent = d.compare;
      delta.hidden = R.delta_pct === null;
      start();
    }
  }
  chart.addEventListener("pointerdown", (ev) => showScrub(indexAt(ev)));
  chart.addEventListener("pointermove", (ev) => { if (ev.pointerType === "mouse" || scrub !== null) showScrub(indexAt(ev)); });
  chart.addEventListener("pointerleave", (ev) => { if (ev.pointerType === "mouse") endScrub(); });
  document.addEventListener("pointerdown", (ev) => { if (!root.contains(ev.target)) endScrub(); });
  addEventListener("resize", () => { placePill(true); start(); });

  register({
    frame(dt) { springs.forEach((s) => step(s, dt)); },
    settled() { return springs.every((s) => atRest(s, 1e-3)); },
    render() {
      const W = chart.clientWidth;
      if (!W) return; // carte masquée (autre onglet)
      chart.setAttribute("viewBox", `0 0 ${W} ${H}`);
      const xy = pts.map((p, i) => [4 + (i / (N - 1)) * (W - 8), 8 + (1 - clamp(p.x, -0.05, 1.05)) * (H - 16)]);
      const d = monotonePath(xy);
      line.setAttribute("d", d);
      fill.setAttribute("d", `${d} L${xy[N - 1][0].toFixed(2)} ${H} L${xy[0][0].toFixed(2)} ${H} Z`);
      const [lx, ly] = xy[N - 1];
      dot.style.transform = `translate(${(lx - 4.5).toFixed(2)}px,${(ly - 4.5).toFixed(2)}px)`;
      if (scrub !== null) {
        const [sx, sy] = xy[scrub];
        cLine.setAttribute("x1", sx); cLine.setAttribute("x2", sx); cLine.setAttribute("y1", 0); cLine.setAttribute("y2", H);
        cDot.setAttribute("cx", sx); cDot.setAttribute("cy", sy);
      }
      big.textContent = format(Math.max(0, val.x));
      const pctVal = Math.abs(dv.x).toFixed(1).replace(".", ",");
      delta.textContent = `${dv.t > 0 ? "▲ +" : dv.t < 0 ? "▼ −" : ""}${pctVal} %`; // même forme que les autres pastilles
      pill.style.transform = `translateX(${px.x.toFixed(2)}px)`;
      pill.style.width = `${pw.x.toFixed(2)}px`;
    },
  });

  return {
    update(stats) { ranges = stats ? stats.ranges : null; root.hidden = !ranges; if (ranges) pick(r); },
    relayout() { placePill(true); start(); },
  };
}

/** Courbe lissée qui ne dépasse jamais les données (cubique monotone, comme le composant d'origine). */
export function monotonePath(p) {
  const n = p.length;
  if (n < 2) return n ? `M${p[0][0]} ${p[0][1]}` : "";
  const dx = [], m = [];
  for (let i = 0; i < n - 1; i++) { dx[i] = p[i + 1][0] - p[i][0]; m[i] = (p[i + 1][1] - p[i][1]) / (dx[i] || 1e-9); }
  const t = new Array(n);
  t[0] = m[0]; t[n - 1] = m[n - 2];
  for (let i = 1; i < n - 1; i++) t[i] = m[i - 1] * m[i] <= 0 ? 0 : (m[i - 1] + m[i]) / 2;
  for (let i = 0; i < n - 1; i++) {
    if (m[i] === 0) { t[i] = 0; t[i + 1] = 0; }
    else {
      const a = t[i] / m[i], b = t[i + 1] / m[i], q = a * a + b * b;
      if (q > 9) { const k = 3 / Math.sqrt(q); t[i] = k * a * m[i]; t[i + 1] = k * b * m[i]; }
    }
  }
  let d = `M${p[0][0].toFixed(2)} ${p[0][1].toFixed(2)}`;
  for (let i = 0; i < n - 1; i++) {
    const h = dx[i] / 3;
    d += `C${(p[i][0] + h).toFixed(2)} ${(p[i][1] + t[i] * h).toFixed(2)} ${(p[i + 1][0] - h).toFixed(2)} ` +
      `${(p[i + 1][1] - t[i + 1] * h).toFixed(2)} ${p[i + 1][0].toFixed(2)} ${p[i + 1][1].toFixed(2)}`;
  }
  return d;
}
