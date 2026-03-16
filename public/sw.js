// Este é o Service Worker básico para permitir a instalação do PWA
self.addEventListener('install', (e) => {
  console.log('[Service Worker] Instalado com sucesso!');
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  console.log('[Service Worker] Ativado!');
});

self.addEventListener('fetch', (e) => {
  // Por enquanto, ele apenas repassa as requisições normais da internet
  e.respondWith(fetch(e.request).catch(() => {
    // Se a internet cair, você pode tratar aqui no futuro
  }));
});

self.addEventListener('push', (event) => {
  let data = {};

  try {
    data = event.data ? event.data.json() : {};
  } catch (err) {
    data = { title: 'OrganizaPay', body: event.data ? event.data.text() : '' };
  }

  const title = data.title || 'OrganizaPay';
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
