const CACHE_NAME = 'pyaek-portfolio-v2';
const ASSETS = [
  './',
  './index.html',
  './style.css',
  './manifest.json',
  './profile.png',
  './profile-hero.jpg',
  './favicon.ico',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/apple-touch-icon.png'
];

function normalizeRequest(request) {
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) {
    return request;
  }
  if (request.mode === 'navigate' || url.pathname === '/' || url.pathname === '/index.html') {
    return new Request('./index.html', { cache: 'reload' });
  }
  return request;
}

self.addEventListener('install', function (event) {
  event.waitUntil(
    caches.open(CACHE_NAME).then(function (cache) {
      return cache.addAll(ASSETS);
    }).then(function () {
      return self.skipWaiting();
    })
  );
});

self.addEventListener('activate', function (event) {
  event.waitUntil(
    caches.keys().then(function (cacheNames) {
      return Promise.all(
        cacheNames.filter(function (name) {
          return name !== CACHE_NAME;
        }).map(function (name) {
          return caches.delete(name);
        })
      );
    }).then(function () {
      return self.clients.claim();
    })
  );
});

self.addEventListener('fetch', function (event) {
  if (event.request.method !== 'GET') {
    return;
  }

  const normalized = normalizeRequest(event.request);

  event.respondWith(
    caches.match(normalized).then(function (cached) {
      if (cached) {
        return cached;
      }

      return fetch(event.request).then(function (response) {
        if (!response || response.status !== 200 || response.type !== 'basic') {
          return response;
        }

        const clone = response.clone();
        caches.open(CACHE_NAME).then(function (cache) {
          cache.put(normalized, clone);
        });

        return response;
      }).catch(function () {
        return caches.match('./index.html');
      });
    })
  );
});
