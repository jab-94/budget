// Carte « Dépenses » animée (d'après le composant « Stat card » de designbookmark.com).
// Changer d'onglet (Semaine / Mois / 12 mois) fait glisser la pastille, rouler le montant et le
// pourcentage, et chaque point de la courbe rejoint sa nouvelle hauteur sur un ressort, l'un après
// l'autre (0,03 s d'écart). Mêmes ressorts que l'original : points 200/17, chiffres 160/22, pastille 380/30.
import { S, after, atRest, clamp, register, start, step } from "./motion.js";

export function mountStatCard(root, { format, describe }) {
  const q = (s) => root.querySelector(s);
  const chart = q(".sc-chart"), line = q(".sc-line"), fill = q(".sc-fill"), dot = q(".sc-dot");
  const big = q(".sc-big"), delta = q(".sc-delta"), pill = q(".sc-pill"), lab = q(".sc-lab"), cmp = q(".sc-cmp");
  const btns = [...root.querySelectorAll(".sc-seg button")];
  const N = 12, H = 96;
  const pts = Array.from({ length: N }, () => S(0, 200, 17));
  const val = S(0, 160, 22), dv = S(0, 160, 22), px = S(0, 380, 30), pw = S(0, 380, 30);
  const springs = [...pts, val, dv, px, pw];
  let ranges = null, r = 1, gen = 0;

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
      delta.classList.toggle("up", (R.delta_pct ?? 0) > 0);
      delta.classList.toggle("down", (R.delta_pct ?? 0) < 0);
      const target = normalize(R.points);
      pts.forEach((p, k) => after(k * 0.03, () => { if (gen === g) { p.t = target[k]; start(); } }));
    }
    start();
  }
  btns.forEach((b, i) => b.addEventListener("click", () => pick(i)));
  addEventListener("resize", () => { placePill(true); start(); });

  register({
    frame(dt) { springs.forEach((s) => step(s, dt)); },
    settled() { return springs.every((s) => atRest(s, 1e-3)); },
    render() {
      const W = chart.clientWidth;
      if (!W) return; // carte masquée (autre onglet)
      chart.setAttribute("viewBox", `0 0 ${W} ${H}`);
      const xy = pts.map((p, i) => [4 + (i / (N - 1)) * (W - 8), 8 + (1 - clamp(p.x, -0.05, 1.05)) * (H - 16)]);
      let d = `M${xy[0][0].toFixed(2)} ${xy[0][1].toFixed(2)}`;
      for (let i = 0; i < N - 1; i++) {
        const p0 = xy[i - 1] || xy[i], p1 = xy[i], p2 = xy[i + 1], p3 = xy[i + 2] || p2;
        d += ` C${(p1[0] + (p2[0] - p0[0]) / 6).toFixed(2)} ${(p1[1] + (p2[1] - p0[1]) / 6).toFixed(2)} ` +
          `${(p2[0] - (p3[0] - p1[0]) / 6).toFixed(2)} ${(p2[1] - (p3[1] - p1[1]) / 6).toFixed(2)} ${p2[0].toFixed(2)} ${p2[1].toFixed(2)}`;
      }
      line.setAttribute("d", d);
      fill.setAttribute("d", `${d} L${xy[N - 1][0].toFixed(2)} ${H} L${xy[0][0].toFixed(2)} ${H} Z`);
      const [lx, ly] = xy[N - 1];
      dot.style.transform = `translate(${(lx - 4.5).toFixed(2)}px,${(ly - 4.5).toFixed(2)}px)`;
      big.textContent = format(Math.max(0, val.x));
      const pctVal = Math.abs(dv.x).toFixed(1).replace(".", ",");
      delta.textContent = `${dv.t > 0 ? "+" : dv.t < 0 ? "−" : ""}${pctVal} %`;
      pill.style.transform = `translateX(${px.x.toFixed(2)}px)`;
      pill.style.width = `${pw.x.toFixed(2)}px`;
    },
  });

  return {
    update(stats) { ranges = stats ? stats.ranges : null; root.hidden = !ranges; if (ranges) pick(r); },
    relayout() { placePill(true); start(); },
  };
}
