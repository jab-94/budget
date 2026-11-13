// Mode hors ligne : les fichiers de l'app (jamais les données) sont gardés en cache.
// - index.html : réseau d'abord (pour recevoir les mises à jour), cache si hors ligne.
// - autres fichiers : cache d'abord, rafraîchis en arrière-plan.
// Les échanges avec Firebase (autres domaines) ne passent jamais par ce cache.
// CACHE_VERSION doit être augmenté à chaque publication.
const CACHE_VERSION = "budget-v1";
const CORE = ["./", "index.html", "app.css", "manifest.json", "icon-192.png", "apple-touch-icon.png",
  "js/theme.js", "js/app.js", "js/backend.js", "js/store.js", "js/cloud.js", "js/crypto.js", "js/config.js",
  "js/core.js", "js/defaults.js", "js/categorize.js", "js/analytics.js", "js/csvparse.js", "js/pdfparse.js",
  "vendor/firebase.js"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE_VERSION).then((c) => c.addAll(CORE)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE_VERSION).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== self.location.origin) return;
  const isPage = e.request.mode === "navigate" || url.pathname.endsWith("/") || url.pathname.endsWith("index.html");
  if (isPage) {
    e.respondWith(fetch(e.request).then((r) => {
      const copy = r.clone();
      caches.open(CACHE_VERSION).then((c) => c.put(e.request, copy));
      return r;
    }).catch(() => caches.match(e.request).then((r) => r || caches.match("index.html"))));
    return;
  }
  e.respondWith(caches.match(e.request).then((cached) => {
    const network = fetch(e.request).then((r) => {
      if (r.ok) { const copy = r.clone(); caches.open(CACHE_VERSION).then((c) => c.put(e.request, copy)); }
      return r;
    }).catch(() => cached);
    return cached || network;
  }));
});
