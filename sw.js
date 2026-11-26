const scope = self.registration.scope;
const name = 'japan-taxfree-ledger-' + scope + '-2.3';
const assets = ['./','./style.css?v=2.3','./app.js?v=2.3','./model.js?v=2.3','./storage.js?v=2.3','./budget.js?v=2.3','./travel-banner-v21.webp','./app.webmanifest','./icon-192.png','./icon-512.png'];
self.addEventListener('install', event => event.waitUntil((async () => {
  const cache = await caches.open(name);
  await cache.addAll(assets.map(asset => new Request(new URL(asset, scope), {cache:'reload'})));
  await self.skipWaiting();
})()));
self.addEventListener('activate', event => event.waitUntil((async () => {
  const keys = await caches.keys();
  await Promise.all(keys.filter(key => key.startsWith('japan-taxfree-ledger-' + scope + '-') && key !== name).map(key => caches.delete(key)));
  await self.clients.claim();
})()));
self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET' || !request.url.startsWith(scope)) return;
  if (request.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        const response = await fetch(request, {cache:'no-cache'});
        if (response.ok) return response;
      } catch {}
      const cache = await caches.open(name);
      return (await cache.match(scope)) || Response.error();
    })());
  } else {
    event.respondWith((async () => (await (await caches.open(name)).match(request)) || fetch(request))());
  }
});
