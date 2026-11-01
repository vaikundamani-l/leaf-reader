const CACHE = 'leaf-v11';
const ASSETS = [
  './',
  'index.html',
  'css/style.css',
  'js/app.js',
  'js/book-navigation.js',
  'js/storage.js',
  'vendor/epub.min.js',
  'vendor/jszip.min.js',
  'manifest.json',
  'library/room.epub',
  'library/alice.epub',
  'library/siddhartha.epub',
  'library/pride.epub',
  'library/walden.epub',
  'library/garden.epub',
  'library/Sattam_Arivom_Tamil_Legal_Guide.epub'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE)
      .then(cache => cache.addAll(ASSETS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys.filter(key => key.startsWith('leaf-') && key !== CACHE).map(key => caches.delete(key))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const request = event.request;
  let reqUrl;
  try {
    reqUrl = new URL(request.url, self.location.origin);
  } catch {
    return;
  }
  if (request.method !== 'GET' || reqUrl.origin !== self.location.origin) return;

  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    try {
      const response = await fetch(request, { cache: 'no-cache' });
      if (response.ok && response.status !== 206) {
        await cache.put(request, response.clone());
      }
      return response;
    } catch (error) {
      const cached = await cache.match(request);
      if (cached) return cached;
      if (request.mode === 'navigate' || request.destination === 'document') {
        const fallback = await cache.match('./') || await cache.match('index.html');
        if (fallback) return fallback;
      }
      throw error;
    }
  })());
});
