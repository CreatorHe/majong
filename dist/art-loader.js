import { ART_ASSETS } from './art-assets.js';

export const ARTWORK = ART_ASSETS.artwork;
const BASE = new URL('./', import.meta.url);
const CACHE = 'jade-art-v1:' + BASE.pathname;
const entries = ART_ASSETS.entries.map(asset => ({ ...asset, url: new URL(asset.path, BASE).href }));
const byURL = new Map(entries.map(asset => [asset.url, asset]));
const pending = new Map(), loaded = new Set(), failed = new Set(), localURLs = new Map();
let handle, remaining, cachePromise, controlled = false, persistent = false, phase = 'idle', recoveryAttempts = 0;

function versioned(asset) {
  const url = new URL(asset.url);
  url.searchParams.set('art_sha', asset.sha256);
  return url.href;
}

/** Pure before init: safe for the engine's Node imports and file previews. */
export function artUrl(path) {
  if (!path) return '';
  let url;
  try { url = new URL(path, BASE); } catch { return String(path); }
  if (url.origin !== BASE.origin) return url.href;
  if ([...url.searchParams.keys()].some(key => key !== 'art_sha')) return url.href;
  url.search = ''; url.hash = '';
  const asset = byURL.get(url.href);
  if (!asset) return new URL(path, BASE).href;
  return ((!controlled || !persistent) && localURLs.get(asset.url)) || versioned(asset);
}

/** Only object URLs made from this manifest's verified bytes are trusted. */
export function isArtObjectURL(value) {
  return typeof value === 'string' && [...localURLs.values()].includes(value);
}

async function storage() {
  if (!cachePromise) cachePromise = (async () => {
    try {
      if (!globalThis.caches) return null;
      const cache = await caches.open(CACHE); persistent = true; return cache;
    } catch { return null; }
  })();
  return cachePromise;
}

function digest(bytes) {
  return crypto.subtle.digest('SHA-256', bytes).then(hash => Array.from(new Uint8Array(hash), b => b.toString(16).padStart(2, '0')).join(''));
}

async function checkedResponse(response, asset) {
  if (!response.ok || response.status === 206) throw new Error(`Art HTTP ${response.status}: ${asset.path}`);
  const bytes = await response.arrayBuffer();
  if (bytes.byteLength !== asset.bytes || await digest(bytes) !== asset.sha256) throw new Error(`Art revision mismatch: ${asset.path}`);
  const headers = new Headers(response.headers);
  headers.delete('content-encoding'); headers.delete('content-length');
  headers.set('x-jade-art-sha', asset.sha256);
  return new Response(bytes, { status: 200, headers });
}

async function rememberLocal(response, asset) {
  // A blocked/unavailable service worker must not cause the initial image batch
  // to be downloaded again when the prepared first screen is mounted.
  if ((!controlled || !persistent) && /\.(?:svg|webp|png|woff2)$/.test(asset.path) && !localURLs.has(asset.url) && globalThis.URL?.createObjectURL) {
    localURLs.set(asset.url, URL.createObjectURL(await response.blob()));
  }
}

function load(asset) {
  if (loaded.has(asset.url)) return Promise.resolve(true);
  if (pending.has(asset.url)) return pending.get(asset.url);
  const task = (async () => {
    const key = versioned(asset), cache = await storage();
    let response;
    try { response = await cache?.match(key); } catch {}
    if (response?.headers.get('x-jade-art-sha') !== asset.sha256) response = null;
    if (!response) {
      let error;
      for (let attempt = 0; attempt < 2; attempt++) {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 12000);
        try {
          // Versioned URLs avoid an old HTTP cache object even before the first
          // worker claims this page. The worker owns dedup once it is available.
          response = await checkedResponse(await fetch(key, { credentials: 'same-origin', cache: 'reload', signal: controller.signal }), asset);
          break;
        } catch (reason) { error = reason; } finally { clearTimeout(timer); }
      }
      if (!response) throw error;
      try { await cache?.put(key, response.clone()); } catch { persistent = false; }
    }
    await rememberLocal(response, asset);
    loaded.add(asset.url); failed.delete(asset.url); return true;
  })().catch(() => { failed.add(asset.url); return false; }).finally(() => pending.delete(asset.url));
  pending.set(asset.url, task);
  return task;
}

function getState() {
  const count = (set, first) => entries.filter(asset => asset.critical === first && set.has(asset.url)).length;
  const criticalTotal = entries.filter(asset => asset.critical).length;
  return { phase, version: ART_ASSETS.version, loaded: loaded.size, total: entries.length, failed: failed.size,
    criticalLoaded: count(loaded, true), criticalTotal, criticalFailed: count(failed, true),
    remainingLoaded: count(loaded, false), remainingTotal: entries.length - criticalTotal, remainingFailed: count(failed, false), persistent, controlled };
}

async function batch(assets, concurrency) {
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(concurrency, assets.length) }, async () => {
    while (next < assets.length) await load(assets[next++]);
  }));
  return getState();
}

function workerVersion(worker) {
  return new Promise(resolve => {
    if (!worker || typeof MessageChannel === 'undefined') { resolve(false); return; }
    const channel = new MessageChannel();
    const finish = value => { clearTimeout(timer); channel.port1.close(); resolve(value); };
    const timer = setTimeout(() => finish(false), 500);
    channel.port1.onmessage = event => finish(event.data?.version === ART_ASSETS.version);
    try { worker.postMessage({ type: 'JADE_ART_VERSION' }, [channel.port2]); } catch { finish(false); }
  });
}

async function registerWorker() {
  if (!globalThis.navigator?.serviceWorker || !globalThis.isSecureContext || BASE.protocol === 'file:') return false;
  const service = navigator.serviceWorker;
  try {
    const register = service.register(new URL(`art-sw.js?v=${ART_ASSETS.version}`, BASE).href, { scope: BASE.pathname, updateViaCache: 'none' });
    // Registration may hang offline on a first visit; it never holds the game.
    const registration = await Promise.race([register, new Promise(resolve => setTimeout(() => resolve(null), 4500))]);
    if (!registration) return false;
    return await new Promise(resolve => {
      let finished = false;
      const finish = value => {
        if (finished) return; finished = true; clearTimeout(timer);
        service.removeEventListener('controllerchange', check); resolve(value);
      };
      const check = async () => {
        if (await workerVersion(service.controller)) { controlled = true; finish(true); }
      };
      const timer = setTimeout(() => finish(false), 4500);
      service.addEventListener('controllerchange', check);
      check();
    });
  } catch { return false; }
}

/** Starts the small first-screen batch once, without blocking module evaluation. */
export function initArtAssets() {
  if (handle) return handle;
  phase = 'critical';
  const workerReady = registerWorker();
  const criticalReady = (async () => {
    await Promise.race([workerReady, new Promise(resolve => setTimeout(resolve, 1200))]);
    await batch(entries.filter(asset => asset.critical), 6);
    if (phase === 'critical') phase = failed.size ? 'partial' : 'critical-ready';
    return getState();
  })().catch(() => { phase = 'partial'; return getState(); });
  handle = { criticalReady, workerReady, getState };
  globalThis.addEventListener?.('online', () => {
    if (!failed.size || recoveryAttempts >= 2) return;
    recoveryAttempts++;
    if (remaining) preloadRemainingArt({ retry: true });
    else batch(entries.filter(asset => asset.critical && !loaded.has(asset.url)), 3).then(() => {
      if (phase !== 'remaining' && phase !== 'ready') phase = failed.size ? 'partial' : 'critical-ready';
    }).catch(() => {});
  });
  return handle;
}

/** Called on entering a game: 3 downloads at a time, no repeated full batches. */
export function preloadRemainingArt({ retry = false } = {}) {
  const initial = initArtAssets();
  if (retry && phase === 'partial') remaining = null;
  if (remaining) return remaining;
  remaining = (async () => {
    await initial.criticalReady;
    phase = 'remaining';
    // Failed critical entries get a later retry as well; successful entries are
    // skipped without a fetch and the ongoing per-URL promise is shared.
    await batch(entries.filter(asset => !loaded.has(asset.url)), 3);
    phase = failed.size ? 'partial' : 'ready';
    return getState();
  })().catch(() => { phase = 'partial'; return getState(); });
  return remaining;
}
