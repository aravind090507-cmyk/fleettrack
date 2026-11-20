// FleetTrack Production Service Worker Shell v3
const CACHE_NAME = 'fleettrack-cache-v3';
const PRECACHE_URLS = [
  '/',
  '/manifest.json'
];

// Install: precache essential shell assets and skip waiting immediately
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(PRECACHE_URLS))
  );
  self.skipWaiting();
});

// Activate: purge all obsolete caches (including v1 and v2) and claim clients
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME) {
            console.log('[SW] Deleting obsolete cache:', key);
            return caches.delete(key);
          }
        })
      )
    ).then(() => self.clients.claim())
  );
});

// Message listener to allow immediate skipWaiting if triggered from client
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

// Fetch: Strategy depends on request type
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Never intercept non-GET requests or backend API/WebSocket routes
  if (
    event.request.method !== 'GET' ||
    url.pathname.startsWith('/api/') ||
    url.pathname.startsWith('/ws') ||
    url.pathname === '/health'
  ) {
    return;
  }

  // Navigation requests (HTML pages): NETWORK FIRST
  // Always fetch fresh HTML from the network so asset hashes are never stale.
  // Fall back to cached HTML only when offline.
  if (event.request.mode === 'navigate' || event.request.destination === 'document') {
    event.respondWith(
      fetch(event.request)
        .then((networkResponse) => {
          if (networkResponse && networkResponse.status === 200) {
            const responseClone = networkResponse.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, responseClone));
          }
          return networkResponse;
        })
        .catch(() => {
          return caches.match(event.request).then((cached) => {
            return cached || caches.match('/');
          });
        })
    );
    return;
  }

  // Static hashed assets (/assets/): CACHE FIRST with network fallback
  // Hashed Vite assets are immutable.
  if (url.pathname.startsWith('/assets/')) {
    event.respondWith(
      caches.match(event.request).then((cachedResponse) => {
        if (cachedResponse) {
          return cachedResponse;
        }
        return fetch(event.request).then((networkResponse) => {
          // Only cache successful basic responses (do not cache 404 or text/html rewrites)
          const contentType = networkResponse.headers.get('content-type') || '';
          const isHtml = contentType.includes('text/html');
          if (networkResponse && networkResponse.status === 200 && !isHtml) {
            const responseClone = networkResponse.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, responseClone));
          }
          return networkResponse;
        });
      })
    );
    return;
  }

  // Other static assets (icons, manifest): STALE-WHILE-REVALIDATE
  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      const fetchPromise = fetch(event.request)
        .then((networkResponse) => {
          if (networkResponse && networkResponse.status === 200) {
            const responseClone = networkResponse.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, responseClone));
          }
          return networkResponse;
        })
        .catch(() => null);

      return cachedResponse || fetchPromise;
    })
  );
});
