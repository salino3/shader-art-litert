
const CACHE_NAME = 'shader-art-cache-v1';
const OFFLINE_URL = '/shader-art-litert/404.html';

// List of files to precache automatically
const urlsToCache = [
  ...[
  "/shader-art-litert/404.html",
  "/shader-art-litert/assets/index-B0Lm3NXW.js",
  "/shader-art-litert/assets/index-BalCoq57.css",
  "/shader-art-litert/index.html"
],
  OFFLINE_URL
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => {
        console.log('Cache opened');
        // Add all static assets and the offline page to the cache
        return cache.addAll(urlsToCache);
      })
  );
  // Force the waiting service worker to become the active service worker
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => {
          // Delete old caches that don't match the current cache name
          if (cacheName !== CACHE_NAME) {
            console.log('Deleting old cache:', cacheName);
            return caches.delete(cacheName);
          }
        })
      );
    })
  );
  // Take control of all pages immediately
  return self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  event.respondWith(
    // Try to find the resource in the cache first
    caches.match(event.request)
    .then((response) => {
      // If the resource is in the cache, return it
      if (response) {
        return response;
      }

      // If not in cache, try to fetch it from the network
      return fetch(event.request)
        .then((networkResponse) => {
          // Cache successful network responses for future use
          if (networkResponse && networkResponse.status === 200) {
            const responseToCache = networkResponse.clone();
            caches.open(CACHE_NAME).then((cache) => {
              cache.put(event.request, responseToCache);
            });
          }
          return networkResponse;
        })
        .catch(() => {
          // If the network request fails (because we're offline),
          // and the request is for a navigation, serve the offline page.
          if (event.request.mode === 'navigate') {
            return caches.match(OFFLINE_URL);
          }
          // For non-navigation requests, return undefined to let browser handle it
          return undefined;
        });
    })
  );
});
