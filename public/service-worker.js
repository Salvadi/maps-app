/* eslint-disable no-restricted-globals */

// Service Worker for offline-first PWA
// Uses network-first strategy for JS/CSS and HTML documents (ensures updates are detected quickly)
// Uses cache-first strategy for images and static files

// IMPORTANT: Increment version number on each deployment to force cache update
const CACHE_VERSION = 27; // Increment this on every deploy! (v27: Fix duplicate warning for empty fields, improve copy button visibility)
const CACHE_NAME = `mapping-app-v${CACHE_VERSION}`;
const RUNTIME_CACHE = `mapping-app-runtime-v${CACHE_VERSION}`;

// App shell - critical files needed for offline functionality
// Note: Do NOT include specific JS/CSS files here as they have hashed names
// that change on each build (e.g., main.044d3b01.js → main.5f2312f1.js)
const APP_SHELL = [
  '/',
  '/index.html',
  '/manifest.json',
  '/favicon.ico',
  '/logo192.png',
  '/logo512.png',
];

// Install event - cache app shell
self.addEventListener('install', (event) => {
  console.log('[Service Worker] Installing...');

  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => {
        console.log('[Service Worker] Caching app shell');
        return cache.addAll(APP_SHELL);
      })
      .then(() => {
        console.log('[Service Worker] Installed successfully');
        return self.skipWaiting(); // Activate immediately
      })
      .catch((error) => {
        console.error('[Service Worker] Installation failed:', error);
      })
  );
});

// Activate event - clean up old caches
self.addEventListener('activate', (event) => {
  console.log('[Service Worker] Activating...');

  event.waitUntil(
    caches.keys()
      .then((cacheNames) => {
        return Promise.all(
          cacheNames
            .filter((cacheName) => {
              // Delete old caches
              return cacheName !== CACHE_NAME && cacheName !== RUNTIME_CACHE;
            })
            .map((cacheName) => {
              console.log('[Service Worker] Deleting old cache:', cacheName);
              return caches.delete(cacheName);
            })
        );
      })
      .then(() => {
        console.log('[Service Worker] Activated successfully');
        return self.clients.claim(); // Take control immediately
      })
  );
});

// Fetch event - network-first for JS/CSS, cache-first for documents/images
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Skip cross-origin requests
  if (url.origin !== location.origin) {
    return;
  }

  // Network-first for JS and CSS (they have hashed names that change on deploy)
  if (
    request.method === 'GET' &&
    (request.destination === 'style' || request.destination === 'script')
  ) {
    event.respondWith(
      fetch(request)
        .then((response) => {
          // Cache successful responses for offline use
          if (response && response.status === 200) {
            const responseToCache = response.clone();
            caches.open(RUNTIME_CACHE)
              .then((cache) => {
                cache.put(request, responseToCache);
              });
          }
          console.log('[Service Worker] Fetched from network:', request.url);
          return response;
        })
        .catch((error) => {
          console.log('[Service Worker] Network failed, trying cache:', request.url);
          // Fallback to cache if offline
          return caches.match(request);
        })
    );
    return;
  }

  // Network-first strategy for documents to ensure updates are picked up quickly
  // Cache-first strategy for images and static files
  if (
    request.method === 'GET' &&
    (
      request.destination === 'document'
    )
  ) {
    event.respondWith(
      fetch(request)
        .then((response) => {
          // Cache successful responses
          if (response && response.status === 200) {
            const responseToCache = response.clone();
            caches.open(RUNTIME_CACHE)
              .then((cache) => {
                cache.put(request, responseToCache);
              });
          }
          console.log('[Service Worker] Fetched document from network:', request.url);
          return response;
        })
        .catch((error) => {
          console.log('[Service Worker] Network failed for document, trying cache:', request.url);
          // Fallback to cache if offline
          return caches.match(request)
            .then((cachedResponse) => {
              if (cachedResponse) {
                return cachedResponse;
              }
              // Return offline fallback page for navigation requests
              return caches.match('/index.html');
            });
        })
    );
    return;
  }

  // Cache-first strategy for images and static files
  if (
    request.method === 'GET' &&
    (
      request.destination === 'image' ||
      url.pathname.startsWith('/static/')
    )
  ) {
    event.respondWith(
      caches.match(request)
        .then((cachedResponse) => {
          if (cachedResponse) {
            console.log('[Service Worker] Serving from cache:', request.url);
            return cachedResponse;
          }

          console.log('[Service Worker] Fetching from network:', request.url);
          return fetch(request)
            .then((response) => {
              // Cache successful responses
              if (response && response.status === 200) {
                const responseToCache = response.clone();
                caches.open(RUNTIME_CACHE)
                  .then((cache) => {
                    cache.put(request, responseToCache);
                  });
              }
              return response;
            })
            .catch((error) => {
              console.error('[Service Worker] Fetch failed:', error);
              throw error;
            });
        })
    );
    return;
  }

  // Network-first for API calls and other requests
  event.respondWith(
    fetch(request)
      .then((response) => {
        // Cache successful GET requests
        if (request.method === 'GET' && response && response.status === 200) {
          const responseToCache = response.clone();
          caches.open(RUNTIME_CACHE)
            .then((cache) => {
              cache.put(request, responseToCache);
            });
        }
        return response;
      })
      .catch((error) => {
        console.log('[Service Worker] Network request failed, trying cache:', request.url);

        // Fallback to cache for failed network requests
        return caches.match(request)
          .then((cachedResponse) => {
            if (cachedResponse) {
              return cachedResponse;
            }
            throw error;
          });
      })
  );
});

// Background sync event - Phase 3 implementation
self.addEventListener('sync', (event) => {
  console.log('[Service Worker] Background sync:', event.tag);

  if (event.tag === 'sync-queue') {
    event.waitUntil(
      // Notify all clients to trigger sync
      notifyClientsToSync()
        .then(() => {
          console.log('[Service Worker] Sync notification sent to clients');
        })
        .catch((error) => {
          console.error('[Service Worker] Sync notification failed:', error);
          throw error; // Will retry later
        })
    );
  }
});

/**
 * Notify all active clients to trigger sync
 */
async function notifyClientsToSync() {
  const clients = await self.clients.matchAll({
    type: 'window',
    includeUncontrolled: true
  });

  console.log(`[Service Worker] Notifying ${clients.length} clients to sync`);

  // Send message to all clients
  for (const client of clients) {
    client.postMessage({
      type: 'BACKGROUND_SYNC',
      tag: 'sync-queue',
      timestamp: Date.now()
    });
  }

  // If no clients are open, we can't sync
  // Background Sync API will retry later
  if (clients.length === 0) {
    console.warn('[Service Worker] No active clients to sync');
    throw new Error('No active clients');
  }
}

// Push notification event (for future enhancements)
self.addEventListener('push', (event) => {
  console.log('[Service Worker] Push notification received');

  const options = {
    body: event.data ? event.data.text() : 'New update available',
    icon: '/logo192.png',
    badge: '/logo192.png',
    vibrate: [200, 100, 200],
  };

  event.waitUntil(
    self.registration.showNotification('OPImaPPA', options)
  );
});

// Message event - handle messages from the app
self.addEventListener('message', (event) => {
  console.log('[Service Worker] Message received:', event.data);

  if (event.data && event.data.type === 'SKIP_WAITING') {
    console.log('[Service Worker] Skipping waiting and activating immediately');
    self.skipWaiting();
  }

  if (event.data && event.data.type === 'CLEAR_CACHE') {
    console.log('[Service Worker] Clearing all caches');
    event.waitUntil(
      caches.keys().then((cacheNames) => {
        return Promise.all(
          cacheNames.map((cacheName) => {
            console.log('[Service Worker] Deleting cache:', cacheName);
            return caches.delete(cacheName);
          })
        );
      })
    );
  }
});
