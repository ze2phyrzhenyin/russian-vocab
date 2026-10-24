/* Only a public app shell and versioned assets live in this cache.
   Auth responses, API data and source/user images are never cached here.
   Account content is isolated in IndexedDB by the authenticated client. */
const CACHE = 'slovo-public-shell-v2';
const PUBLIC = ['/', '/icon.svg', '/manifest.webmanifest'];
async function installShell() {
  const cache = await caches.open(CACHE);
  await cache.addAll(PUBLIC);
  // Initial CSS/JS can finish loading before the worker gains control. Safari
  // does not reliably serve that HTTP cache while offline, so populate the
  // worker's own cache from this public shell's explicit static references.
  const shell = await cache.match('/');
  if (!shell) throw new Error('Public application shell is unavailable');
  const html = await shell.text();
  const assets = [...html.matchAll(/(?:src|href)=["']([^"']+)["']/g)]
    .map(match => new URL(match[1], self.location.origin))
    .filter(url => url.origin === self.location.origin && url.pathname.startsWith('/_next/static/'))
    .map(url => url.href);
  await cache.addAll([...new Set(assets)]);
}
self.addEventListener('install', event => { event.waitUntil(installShell()); self.skipWaiting(); });
self.addEventListener('activate', event => { event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key.startsWith('slovo-public-shell-') && key !== CACHE).map(key => caches.delete(key)))).then(() => self.clients.claim())); });
self.addEventListener('message', event => {
  if (event.data?.type !== 'SLOVO_SHELL_STATUS' || !event.ports[0]) return;
  event.waitUntil(caches.open(CACHE).then(async cache => {
    const shell = await cache.match('/');
    const keys = await cache.keys();
    const staticAssets = keys.filter(request => new URL(request.url).pathname.startsWith('/_next/static/')).length;
    event.ports[0].postMessage({ type: 'SLOVO_SHELL_READY', version: 2, ready: Boolean(shell) && staticAssets > 0 });
  }));
});
self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin || url.pathname.startsWith('/api/') || url.pathname.startsWith('/ocr/')) return;
  if (request.mode === 'navigate' && url.pathname === '/') {
    event.respondWith(fetch(request).then(response => {
      if (response.ok && !url.search) { const copy = response.clone(); event.waitUntil(caches.open(CACHE).then(cache => cache.put('/', copy))); }
      return response;
    }).catch(() => caches.match('/').then(cached => cached || new Response('请联网打开俄语拾词，登录并下载课次后即可离线学习。', { status: 503, headers: { 'Content-Type': 'text/plain;charset=utf-8' } }))));
    return;
  }
  if (url.pathname.startsWith('/_next/static/') || PUBLIC.slice(1).includes(url.pathname)) {
    event.respondWith(caches.match(request).then(cached => cached || fetch(request).then(response => {
      if (response.ok) { const copy = response.clone(); event.waitUntil(caches.open(CACHE).then(cache => cache.put(request, copy))); }
      return response;
    })));
  }
});
