// Mode hors ligne : les fichiers de l'app (jamais les données) sont gardés en cache.
//
// Stratégie (corrigée en v3) :
// - Code de l'app (HTML, CSS, js/) : RÉSEAU D'ABORD, copie locale seulement hors connexion.
//   Ainsi la page et le code sont toujours de la même version après une mise à jour.
// - Bibliothèques lourdes (vendor/, icônes) : cache d'abord (elles changent rarement ;
//   une nouvelle version du service worker les retélécharge).
// - À l'installation, les fichiers sont retéléchargés sans passer par le cache HTTP du navigateur.
// Les échanges avec Firebase (autres domaines) ne passent jamais par ce cache.
//
// CACHE_VERSION doit être augmenté à chaque publication.
const CACHE_VERSION = "budget-v3";
const CORE = ["./", "index.html", "app.css", "manifest.json", "icon-192.png", "apple-touch-icon.png",
  "js/theme.js", "js/app.js", "js/backend.js", "js/store.js", "js/cloud.js", "js/crypto.js", "js/config.js",
  "js/core.js", "js/defaults.js", "js/categorize.js", "js/analytics.js", "js/csvparse.js", "js/pdfparse.js",
  "vendor/firebase.js"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE_VERSION)
    .then((c) => c.addAll(CORE.map((u) => new Request(u, { cache: "reload" }))))
    .then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE_VERSION).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

function networkFirst(request) {
  return fetch(request, { cache: "no-cache" }).then((r) => {
    if (r.ok) { const copy = r.clone(); caches.open(CACHE_VERSION).then((c) => c.put(request, copy)); }
    return r;
  }).catch(() => caches.match(request).then((r) => r || (request.mode === "navigate" ? caches.match("index.html") : r)));
}

function cacheFirst(request) {
  return caches.match(request).then((cached) => cached || fetch(request).then((r) => {
    if (r.ok) { const copy = r.clone(); caches.open(CACHE_VERSION).then((c) => c.put(request, copy)); }
    return r;
  }));
}

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== self.location.origin) return;
  const heavy = url.pathname.includes("/vendor/") || url.pathname.endsWith(".png");
  e.respondWith(heavy ? cacheFirst(e.request) : networkFirst(e.request));
});
