const CACHE_NAME = "pyaek-home-v17";
const ASSETS = [
  "/",
  "/index.html",
  "/404.html",
  "/manifest.json",
  "/assets/css/style.css",
  "/assets/js/script.js",
  "/assets/icons/icon-192.png",
  "/assets/icons/icon-512.png",
  "/assets/icons/apple-touch-icon.png",
  "/apps/about/index.html",
  "/apps/about/manifest.json",
  "/apps/blog/index.html",
  "/apps/blog/manifest.json",
  "/apps/blog/assets/css/style.css",
  "/apps/blog/assets/js/app.js",
  "/apps/blog/assets/icons/icon-192.png",
  "/apps/blog/assets/icons/icon-512.png",
  "/apps/blog/assets/icons/apple-touch-icon.png",
  "/apps/about/assets/images/profile.png",
  "/apps/about/assets/images/profile-hero.jpg",
  "/apps/calc/index.html",
  "/apps/calc/manifest.json",
  "/apps/calc/assets/css/style.css",
  "/apps/calc/assets/js/app.js",
  "/apps/calc/assets/js/calc.js",
  "/apps/calc/assets/js/convert.js",
  "/apps/calc/assets/js/health.js",
  "/apps/calc/assets/icons/icon-192.png",
  "/apps/calc/assets/icons/icon-512.png",
  "/apps/calc/assets/icons/apple-touch-icon.png",
];

self.addEventListener("install", function(event) {
  event.waitUntil(
    caches.open(CACHE_NAME).then(function(cache) {
      return cache.addAll(ASSETS);
    }).then(function() {
      return self.skipWaiting();
    })
  );
});

self.addEventListener("activate", function(event) {
  event.waitUntil(
    caches.keys().then(function(keys) {
      return Promise.all(
        keys.filter(function(key) {
          return key !== CACHE_NAME;
        }).map(function(key) {
          return caches.delete(key);
        })
      );
    }).then(function() {
      return self.clients.claim();
    })
  );
});

self.addEventListener("fetch", function(event) {
  if (event.request.method !== "GET") return;
  var url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;

  if (event.request.mode === "navigate") {
    event.respondWith(
      fetch(event.request).catch(function() {
        return caches.match("/index.html");
      })
    );
    return;
  }

  event.respondWith(
    caches.match(event.request).then(function(cached) {
      var network = fetch(event.request).then(function(response) {
        if (!response || response.status !== 200 || response.type !== "basic") {
          return response;
        }
        var clone = response.clone();
        caches.open(CACHE_NAME).then(function(cache) {
          cache.put(event.request, clone);
        });
        return response;
      }).catch(function() {
        return cached;
      });
      return cached || network;
    })
  );
});
