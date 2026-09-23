const CACHE_NAME = 'portal-vertical-salud-v2';
const APP_FILES = [
  './',
  './index.html',
  './manifest.webmanifest',
  './icons/portal.svg',
  './icons/portal-192.png',
  './icons/portal-512.png',
  './icons/portal-maskable-512.png',
  './icons/portal-180.png',
  './css/app.css',
  './css/app-brand.css',
  './js/data.js',
  './js/app.js',
  '../css/tokens.css',
  '../css/base.css',
  '../css/components.css',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_FILES)));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(Promise.all([
    caches.keys().then((keys) => Promise.all(
      keys.filter((key) => key.startsWith('portal-vertical-salud-') && key !== CACHE_NAME)
        .map((key) => caches.delete(key)),
    )),
    self.clients.claim(),
  ]));
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET' || new URL(event.request.url).origin !== self.location.origin) return;
  if (event.request.mode === 'navigate') {
    event.respondWith(fetch(event.request).then((response) => {
      const copy = response.clone();
      caches.open(CACHE_NAME).then((cache) => cache.put('./index.html', copy));
      return response;
    }).catch(() => caches.match('./index.html')));
    return;
  }
  event.respondWith(caches.open(CACHE_NAME).then(async (cache) => {
    const cached = await cache.match(event.request);
    const network = fetch(event.request).then((response) => {
      if (response.ok) return cache.put(event.request, response.clone()).then(() => response, () => response);
      return response;
    }).catch(() => cached);
    return cached || network;
  }));
});
