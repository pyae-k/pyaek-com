// sw.js — offline-first service worker for ChatAI PWA.
// Strategy: precache the app shell (HTML, CSS, JS, manifest, icons, providers config)
// on install. Navigation requests fall back to the cached index.html (app shell).
// Everything else uses stale-while-revalidate. AI API calls (POST to provider
// endpoints) are never cached and pass straight through to the network.

const CACHE = "pyaek-ai-v23";
const SHELL = [
  "./",
  "./index.html",
  "./404.html",
  "./readme/",
  "./tech-doc/",
  "./assets/js/app.js",
  "./assets/js/providers.js",
  "./assets/js/model-router.js",
  "./assets/js/memory.js",
  "./assets/js/db.js",
  "./assets/js/fs-tools.js",
  "./assets/js/agent-loop.js",
  "./assets/js/voice.js",
  "./assets/js/tools.js",
  "./assets/js/doc-parser.js",
  "./assets/js/rag.js",
  "./assets/js/browser-agent.js",
  "./assets/js/tool-parser.js",
  "./assets/js/remote-browser.js",
  "./assets/js/webllm.js",
  "./assets/css/style.css",
  "./manifest.webmanifest",
  "./assets/icons/icon.svg",
  "./assets/icons/icon-192.png",
  "./assets/icons/icon-512.png",
  "./assets/icons/icon-maskable-512.png",
  "./assets/icons/apple-touch-icon.png",
  "./assets/icons/favicon-16.png",
  "./assets/icons/favicon-32.png",
  "./assets/icons/favicon.svg",
  "./models.json",
];

// wllama CDN assets — precached so offline model inference works without network.
// Keep in sync with the version imported in webllm.js.
const WLLAMA_CDN = "https://cdn.jsdelivr.net/npm/@wllama/wllama@3.5.1/esm/";
const WLLAMA_ASSETS = [
  WLLAMA_CDN + "index.js",
  WLLAMA_CDN + "wllama.wasm",
];

self.addEventListener("install", (e) => {
  e.waitUntil(
    caches.open(CACHE).then((cache) =>
      cache.addAll(SHELL).catch((err) => {
        // If any non-critical asset fails, still cache the critical ones individually.
        console.warn("sw: some shell assets failed to precache", err);
        return Promise.all(SHELL.map((u) => cache.add(u).catch(() => null)));
      })
    ).then(() =>
      // Precache wllama CDN assets separately — cross-origin, may fail if offline.
      Promise.allSettled(
        WLLAMA_ASSETS.map((url) =>
          fetch(url, { mode: "cors" }).then((resp) => {
            if (resp.ok) return caches.open(CACHE).then((c) => c.put(url, resp));
          }).catch(() => {})
        )
      )
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