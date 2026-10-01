// Offline support. The page (index.html) is fetched from the network when online and from the cache when not.
// Scripts and styles carry ?v=N in index.html, so each URL never changes and is served cache-first.
// Card images are cached the first time they are shown (or all at once from the menu's offline button).
// Only same-origin GET requests are touched; online play (PeerJS / MQTT) goes straight to the network.
const CORE = 'urza-core', IMAGES = 'urza-images';

async function precache() {
  const res = await fetch('index.html', { cache: 'reload' });
  if (!res.ok) return;
  const html = await res.clone().text();
  const urls = [...html.matchAll(/(?:src|href)="([^"]+\?v=\d+)"/g)].map(m => new URL(m[1], location).href);
  const cache = await caches.open(CORE);
  await cache.put('index.html', res);
  await cache.addAll(urls);
  // drop files from older versions
  const keep = new Set(urls.concat(new URL('index.html', location).href));
  for (const req of await cache.keys()) if (!keep.has(req.url)) await cache.delete(req);
}

self.addEventListener('install', e => { e.waitUntil(precache().then(() => self.skipWaiting())); });
self.addEventListener('activate', e => { e.waitUntil(self.clients.claim()); });

self.addEventListener('fetch', e => {
  const req = e.request, url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== location.origin) return;
  if (req.mode === 'navigate') {
    e.respondWith(fetch(req).then(res => {
      if (res.ok) { const copy = res.clone(); caches.open(CORE).then(c => c.put('index.html', copy)); }
      return res;
    }).catch(async () => (await caches.match('index.html')) || Response.error()));
    return;
  }
  const bucket = url.pathname.includes('/images/') ? IMAGES : CORE;
  e.respondWith(caches.match(req).then(hit => hit || fetch(req).then(res => {
    if (res.ok) {
      const copy = res.clone(), v = url.searchParams.get('v');
      caches.open(bucket).then(async c => {
        await c.put(req, copy);
        // a new ?v= means a new release: drop that file's older versions
        if (v) for (const k of await c.keys()) { const ku = new URL(k.url); if (ku.pathname === url.pathname && ku.searchParams.get('v') !== v) c.delete(k); }
      });
    }
    return res;
  })));
});
