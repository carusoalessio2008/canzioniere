const CACHE_NAME = 'canzoniere-sosp-v12';
const ASSETS = [
  './',
  './index.html',
  './app.js',
  './manifest.json',
  './logo.png',
  './canti/index.json'
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))
      );
    })
  );
  self.clients.claim();
});

self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  if (
    e.request.url.includes('firestore.googleapis.com') ||
    e.request.url.includes('firebase') ||
    e.request.url.includes('gstatic.com') ||
    e.request.url.includes('googleapis.com')
  ) {
    return;
  }

  e.respondWith(
    fetch(e.request)
      .then((res) => {
        if (res && res.status === 200) {
          const resClone = res.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(e.request, resClone);
          });
        }
        return res;
      })
      .catch(() => caches.match(e.request))
  );
});
