// sw.js — offline-first service worker for Stocks PWA.
// Strategy: precache the app shell on install. Navigation requests fall back
// to the cached index.html. Same-origin GET uses cache-first with network
// update. Cross-origin requests pass through.

const CACHE_NAME = "pyaek-stocks-v17";
const SHELL = [
  "./",
  "./index.html",
  "./404.html",
  "./readme/",
  "./tech-doc/",
  "./manifest.json",
  "./assets/css/style.css",
  "./assets/js/app.js",
  "./assets/js/router.js",
  "./assets/js/api.js",
  "./assets/js/dashboard.js",
  "./assets/js/detail.js",
  "./assets/js/prediction.js",
  "./assets/js/models.js",
  "./assets/js/search.js",
  "./assets/js/charts.js",
  "./assets/js/compare.js",
  "./assets/js/indicators.js",
  "./assets/icons/icon-192.png",
  "./assets/icons/icon-512.png",
  "./assets/icons/apple-touch-icon.png",
  "./assets/icons/icon-maskable-512.png",
];

// CDN assets to precache (Lightweight Charts)
const CDN_ASSETS = [
  "https://unpkg.com/lightweight-charts@4.1.3/dist/lightweight-charts.standalone.production.js",
];

self.addEventListener("install", (e) => {
  e.waitUntil(
    caches.open(CACHE_NAME).then((cache) =>
      cache.addAll(SHELL).then(() => {
        // Precache CDN assets separately (they may fail)
        return Promise.allSettled(
          CDN_ASSETS.map((url) =>
            fetch(url, { mode: "cors" }).then((resp) => {
              if (resp.ok) cache.put(url, resp);
            }).catch(() => {})
          )
        );
      })
    ).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  if (e.request.method !== "GET") return;
  const url = new URL(e.request.url);

  // Cache-first for CDN assets
  if (CDN_ASSETS.includes(url.href)) {
    e.respondWith(
      caches.match(e.request).then((cached) => cached || fetch(e.request))
    );
    return;
  }

  if (url.origin !== self.location.origin) return;

  // Data files (pipeline snapshots): network-first so fresh data is served.
  // Fall back to the cached copy when offline or the fetch fails.
  if (url.pathname.includes("/data/")) {
    e.respondWith(
      fetch(e.request).then((resp) => {
        if (resp && resp.status === 200 && resp.type === "basic") {
          const copy = resp.clone();
          caches.open(CACHE_NAME).then((c) => c.put(e.request, copy));
        }
        return resp;
      }).catch(() => caches.match(e.request))
    );
    return;
  }

  if (e.request.mode === "navigate") {
    e.respondWith(fetch(e.request).catch(() => caches.match("./index.html")));
    return;
  }

  e.respondWith(
    caches.match(e.request).then((cached) => {
      const network = fetch(e.request).then((resp) => {
        if (resp && resp.status === 200 && resp.type === "basic") {
          const copy = resp.clone();
          caches.open(CACHE_NAME).then((c) => c.put(e.request, copy));
        }
        return resp;
      }).catch(() => cached);
      return cached || network;
    })
  );
});
