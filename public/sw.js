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