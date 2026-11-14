// Petit moteur de ressorts (repris du composant « Stat card » de designbookmark.com, mêmes équations).
// Ressort = { x position, v vitesse, t cible, k raideur, c amortissement }. Une seule boucle
// requestAnimationFrame, arrêtée dès que tout est immobile (économise la batterie du téléphone).

const reduce = typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;

/** Ressort : raideur k, amortissement c. Mouvement réduit demandé -> amortissement critique (aucun rebond). */
export const S = (x, k = 400, c = 30) => ({ x, v: 0, t: x, k, c: reduce ? 2 * Math.sqrt(k) : c });
export const step = (s, dt) => { const a = -s.k * (s.x - s.t) - s.c * s.v; s.v += a * dt; s.x += s.v * dt; };
export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export const atRest = (s, eps = 1e-4) => Math.abs(s.x - s.t) < eps && Math.abs(s.v) < eps;

const timers = [];
const comps = [];
let running = false, last = 0;

/** Lance fn après `sec` secondes (temps de l'animation). */
export function after(sec, fn) { timers.push({ t: sec, fn }); start(); }

/** Composant : { frame(dt), render(), settled() }. */
export function register(c) { comps.push(c); start(); }

export function start() {
  if (running || typeof requestAnimationFrame !== "function") return;
  running = true;
  last = performance.now();
  requestAnimationFrame(loop);
}

function loop(now) {
  const dt = Math.min((now - last) / 1000, 1 / 30);
  last = now;
  for (let i = timers.length - 1; i >= 0; i--) if ((timers[i].t -= dt) <= 0) timers.splice(i, 1)[0].fn();
  const sub = 4;
  for (let k = 0; k < sub; k++) comps.forEach((c) => c.frame(dt / sub));
  comps.forEach((c) => c.render());
  if (!timers.length && comps.every((c) => c.settled())) { running = false; return; }
  requestAnimationFrame(loop);
}
