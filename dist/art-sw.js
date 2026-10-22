/* Only cataloged art is intercepted. Game HTML, APIs and analytics stay online. */
importScripts('./art-assets-sw.js');
const MANIFEST = self.JADE_ART_ASSETS;
const BASE = new URL('./', self.location.href);
const CACHE = 'jade-art-v1:' + BASE.pathname;
const assets = new Map(MANIFEST.entries.map(asset => [new URL(asset.path, BASE).href, asset]));
const pending = new Map(), memory = new Map();

self.addEventListener('install', event => event.waitUntil(self.skipWaiting()));
self.addEventListener('activate', event => event.waitUntil(self.clients.claim()));
self.addEventListener('message', event => {
  if (event.data?.type === 'JADE_ART_VERSION') event.ports[0]?.postMessage({ version: MANIFEST.version });
});

async function openCache() { try { return await caches.open(CACHE); } catch { return null; } }
async function sha256(bytes) {
  const hash = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, '0')).join('');
}
function assetResponse(asset, requestedSHA) {
  const key = new URL(asset.path, BASE); key.searchParams.set('art_sha', requestedSHA);
  const url = key.href;
  if (pending.has(url)) return pending.get(url).then(response => response.clone());
  const task = (async () => {
    if (memory.has(url)) return memory.get(url).clone();
    const cache = await openCache();
    let cached;
    try { cached = await cache?.match(url); } catch {}
    if (cached?.headers.get('x-jade-art-sha') === requestedSHA) return cached;
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 12000);
    try {
      const response = await fetch(url, { credentials: 'same-origin', cache: 'reload', signal: controller.signal });
      if (!response.ok || response.status === 206) throw new Error(`Art HTTP ${response.status}`);
      const bytes = await response.arrayBuffer();
      // An old open tab can request its previous asset SHA. Keep those entries
      // reusable, but never return another revision under the requested URL.
      if (await sha256(bytes) !== requestedSHA) throw new Error('Art revision mismatch');
      const headers = new Headers(response.headers);
      headers.delete('content-encoding'); headers.delete('content-length');
      headers.set('x-jade-art-sha', requestedSHA);
      const checked = new Response(bytes, { status: 200, headers });
      let stored = false;
      try { if (cache) { await cache.put(url, checked.clone()); stored = true; } } catch {}
      // Private browsing or a full storage quota can disable persistence. Keep
      // one manifest-sized fallback in this worker session so warmed assets do
      // not immediately download again. Normal persistent hits use no RAM copy.
      if (!stored) {
        memory.set(url, checked.clone());
        while (memory.size > MANIFEST.entries.length) memory.delete(memory.keys().next().value);
      }
      return checked;
    } finally { clearTimeout(timer); }
  })().finally(() => pending.delete(url));
  pending.set(url, task);
  return task.then(response => response.clone());
}
self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET' || request.headers.has('range')) return;
  const url = new URL(request.url);
  if (url.origin !== BASE.origin || [...url.searchParams.keys()].some(key => key !== 'art_sha')) return;
  const requestedSHA = url.searchParams.get('art_sha');
  if (requestedSHA && !/^[a-f0-9]{64}$/.test(requestedSHA)) return;
  url.search = ''; url.hash = '';
  const asset = assets.get(url.href);
  if (!asset) return;
  // A rejected art fetch invokes the renderer's existing fallback. No partial,
  // opaque or mismatched response can poison the persistent cache.
  event.respondWith(assetResponse(asset, requestedSHA || asset.sha256));
});
