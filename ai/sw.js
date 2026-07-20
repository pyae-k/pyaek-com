// sw.js — offline-first service worker for ChatAI PWA.
// Strategy: precache the app shell (HTML, CSS, JS, manifest, icons, providers config)
// on install. Navigation requests fall back to the cached index.html (app shell).
// Everything else uses stale-while-revalidate. AI API calls (POST to provider
// endpoints) are never cached and pass straight through to the network.

const CACHE = "chatai-v10";
const SHELL = [
  "./",
  "./index.html",
  "./app.js",
  "./providers.js",
  "./model-router.js",
  "./memory.js",
  "./db.js",
  "./fs-tools.js",
  "./agent-loop.js",
  "./voice.js",
  "./tools.js",
  "./doc-parser.js",
  "./rag.js",
  "./styles.css",
  "./manifest.webmanifest",
  "./icons/icon.svg",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/apple-touch-icon.png",
  "./icons/favicon-16.png",
  "./icons/favicon-32.png",
  "./icons/favicon.svg",
];

self.addEventListener("install", (e) => {
  e.waitUntil(
    caches.open(CACHE).then((cache) =>
      cache.addAll(SHELL).catch((err) => {
        // If any non-critical asset fails, still cache the critical ones individually.
        console.warn("sw: some shell assets failed to precache", err);
        return Promise.all(SHELL.map((u) => cache.add(u).catch(() => null)));
      })
    ).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return; // never intercept POST (AI API calls) or others

  const url = new URL(req.url);
  // Same-origin only: let cross-origin provider API calls go to network.
  if (url.origin !== self.location.origin) return;

  // Navigation: app shell fallback.
  if (req.mode === "navigate") {
    e.respondWith(
      fetch(req).catch(() => caches.match("./index.html"))
    );
    return;
  }

  // Stale-while-revalidate for app assets.
  e.respondWith(
    caches.match(req).then((cached) => {
      const network = fetch(req).then((resp) => {
        if (resp && resp.status === 200 && resp.type === "basic") {
          const copy = resp.clone();
          caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
        }
        return resp;
      }).catch(() => cached);
      return cached || network;
    })
  );
});