/*
 * Service Worker — modo purge temporário.
 * Limpa todos os caches antigos e passa todas as requisições direto para
 * a rede. Reativar o SW com cache apenas depois que a SPA estiver estável.
 */

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.keys()
      .then((names) => Promise.all(names.map((name) => caches.delete(name))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    self.clients.claim().then(() =>
      self.clients.matchAll({ type: 'window' }).then((clients) => {
        clients.forEach((client) => client.postMessage({ type: 'GAMBY_SW_PURGE' }));
      })
    )
  );
});

self.addEventListener('fetch', (event) => {
  // Sem cache — todas as requisições vão direto à rede.
  if (event.request.method !== 'GET') return;
  event.respondWith(
    fetch(event.request).catch(() =>
      new Response('Serviço temporariamente indisponível.', {
        status: 503,
        headers: { 'Content-Type': 'text/plain; charset=utf-8' }
      })
    )
  );
});
