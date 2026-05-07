const STATIC_CACHE = 'acerttapay-static-v20260507-4';
const RUNTIME_CACHE = 'acerttapay-runtime-v20260507-4';
const OFFLINE_FALLBACK_URL = '/offline.html';
const PRECACHE_URLS = [
  OFFLINE_FALLBACK_URL,
  '/app.css',
  '/app.js',
  '/manifest.json',
  '/icon-192.png',
  '/icon-512.png',
  '/apple-touch-icon.png',
  '/favicon-32x32.png',
  '/favicon-16x16.png',
  '/favicon.ico',
  '/logo.png'
];
const CACHEABLE_DESTINATIONS = new Set(['style', 'script', 'image', 'font', 'manifest']);

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(STATIC_CACHE);
    await cache.addAll(PRECACHE_URLS);
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const cacheNames = await caches.keys();
    await Promise.all(
      cacheNames
        .filter((cacheName) => ![STATIC_CACHE, RUNTIME_CACHE].includes(cacheName))
        .map((cacheName) => caches.delete(cacheName))
    );

    if (self.registration && 'navigationPreload' in self.registration) {
      try {
        await self.registration.navigationPreload.enable();
      } catch (error) {
        // Alguns navegadores simplesmente não suportam a feature.
      }
    }

    await self.clients.claim();
  })());
});

function isSameOrigin(url) {
  return url.origin === self.location.origin;
}

function shouldCacheResponse(response) {
  return !!response && (response.ok || response.type === 'opaque');
}

async function staleWhileRevalidate(request, event) {
  const cache = await caches.open(RUNTIME_CACHE);
  const cachedResponse = await cache.match(request);

  const networkPromise = fetch(request)
    .then((networkResponse) => {
      if (shouldCacheResponse(networkResponse)) {
        return cache.put(request, networkResponse.clone()).then(() => networkResponse);
      }
      return networkResponse;
    });

  if (cachedResponse) {
    if (event && typeof event.waitUntil === 'function') {
      event.waitUntil(networkPromise.catch(() => undefined));
    }
    return cachedResponse;
  }

  try {
    return await networkPromise;
  } catch (error) {
    return Response.error();
  }
}

async function handleNavigationRequest(event) {
  try {
    const preloadResponse = await event.preloadResponse;
    if (preloadResponse) {
      return preloadResponse;
    }

    const networkResponse = await fetch(event.request);
    return networkResponse;
  } catch (error) {
    const offlineResponse = await caches.match(OFFLINE_FALLBACK_URL, { ignoreSearch: true });
    if (offlineResponse) {
      return offlineResponse;
    }

    return new Response('Sem internet no momento.', {
      status: 503,
      statusText: 'Offline',
      headers: { 'Content-Type': 'text/plain; charset=utf-8' }
    });
  }
}

self.addEventListener('fetch', (event) => {
  const { request } = event;

  if (request.method !== 'GET') {
    return;
  }

  const requestUrl = new URL(request.url);

  if (request.mode === 'navigate') {
    event.respondWith(handleNavigationRequest(event));
    return;
  }

  if (!isSameOrigin(requestUrl)) {
    return;
  }

  if (CACHEABLE_DESTINATIONS.has(request.destination)) {
    event.respondWith(staleWhileRevalidate(request, event));
  }
});

self.addEventListener('push', (event) => {
  let data = {};

  try {
    data = event.data ? event.data.json() : {};
  } catch (err) {
    data = { title: 'AcerttaPay', body: event.data ? event.data.text() : '' };
  }

  const title = data.title || 'AcerttaPay';
  const options = {
    body: data.body || '',
    icon: '/icon-192.png',
    badge: '/icon-192.png',
    data: {
      href: data.href || '/shared-debts'
    },
    tag: data.tag || undefined
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const href = event.notification?.data?.href || '/shared-debts';

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windowClients) => {
      for (const client of windowClients) {
        if ('focus' in client) {
          try {
            client.navigate(href);
          } catch (err) {
            // ignora falhas de navegação e tenta apenas focar
          }
          return client.focus();
        }
      }

      if (clients.openWindow) {
        return clients.openWindow(href);
      }

      return undefined;
    })
  );
});
