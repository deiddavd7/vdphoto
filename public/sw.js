// Questo script dice al browser che l'app è pronta per essere installata
self.addEventListener('install', (event) => {
    console.log('[Service Worker] Installato con successo!');
    self.skipWaiting();
});

self.addEventListener('activate', (event) => {
    console.log('[Service Worker] Attivato!');
});

// Ascolta le richieste di rete (necessario per le PWA)
self.addEventListener('fetch', (event) => {
    event.respondWith(fetch(event.request));
});
