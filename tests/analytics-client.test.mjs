import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createAnalytics } from '../dist/analytics/client.js';

function deferred() { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; }
function memoryStore() {
  let snapshot = null;
  return {
    loads: 0, saves: 0, clears: 0,
    async load() { this.loads++; return snapshot && structuredClone(snapshot); },
    async save(value) { this.saves++; snapshot = structuredClone(value); },
    async clear() { this.clears++; snapshot = null; },
    peek() { return snapshot && structuredClone(snapshot); },
  };
}
function locksManager() {
  const held = new Set();
  return { async request(name, options, callback) {
    if (held.has(name)) return callback(null);
    held.add(name);
    try { return await callback({ name }); } finally { held.delete(name); }
  } };
}
const response = (body, status = 200, headers = {}) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers } });
const view = { screen: 'game_shell', previous_screen: null, reason: 'load' };
function setup(options = {}) {
  const storage = options.storage ?? memoryStore();
  const prefs = new Map();
  const requests = [];
  let timestamp = Date.parse('2026-10-21T04:00:00Z');
  let generated = 0;
  const config = {
    storage, preferenceStorage: { getItem: key => prefs.get(key), setItem: (key, value) => prefs.set(key, value) },
    autoFlush: false, locks: null, uuid: () => { generated++; return randomUUID(); }, clock: () => timestamp,
    fetch: async (url, init) => {
      requests.push({ url, init, body: JSON.parse(init.body) });
      if (url.endsWith('/register')) return response({ client_id: 'client-id', write_token: 'private-token' });
      return response({ accepted: JSON.parse(init.body).events.map(event => event.event_id), duplicate: [], rejected: [] });
    }, ...options,
  };
  const client = createAnalytics(config);
  return { client, config, storage, requests, prefs, generated: () => generated, advance: ms => { timestamp += ms; } };
}

test('SDK stays opt-in unless enabled; sandbox and unreadable preferences never default on', async () => {
  for (const options of [{}, { scope: 'sandbox', defaultEnabled: true },
    { defaultEnabled: true, preferenceStorage: null },
    { defaultEnabled: true, preferenceStorage: { getItem() { throw Error('unavailable'); }, setItem() {} } }]) {
    const h = setup(options);
    assert.deepEqual(await h.client.track('screen_viewed', view), { queued: false, reason: 'consent_required' });
    await h.client.flush();
    await h.client.setConsent(false);
    assert.equal(h.generated(), 0);
    assert.equal(h.storage.loads, 0);
    assert.equal(h.storage.saves, 0);
    assert.equal(h.requests.length, 0);
    assert.equal(h.client.getStatus().consent, 'denied');
    h.client.dispose();
  }
});

test('production defaults on only without a preference and an explicit opt-out survives reload', async () => {
  const h = setup({ defaultEnabled: true });
  await h.client.ready;
  assert.equal(h.client.getStatus().consent, 'allowed');
  assert.equal(h.client.getStatus().queued, 1);
  assert.equal(h.prefs.size, 0, 'initialization does not write an explicit allowed preference');
  await h.client.track('screen_viewed', view); await h.client.flush();
  assert.deepEqual(h.requests.map(r => r.url), ['/api/analytics/register', '/api/events']);
  await h.client.track('screen_viewed', view);
  await h.client.setConsent(false);
  assert.equal(h.storage.peek(), null);
  assert.equal(h.client.getStatus().queued, 0);
  assert.equal(h.prefs.get('jade-run:analytics:v1:production:consent'), 'denied');
  const calls = h.requests.length, ids = h.generated(), loads = h.storage.loads;
  h.client.dispose();
  const restored = createAnalytics(h.config); await restored.ready;
  assert.equal(restored.getStatus().consent, 'denied');
  assert.equal((await restored.track('screen_viewed', view)).reason, 'consent_required');
  await restored.flush();
  assert.equal(h.requests.length, calls); assert.equal(h.generated(), ids); assert.equal(h.storage.loads, loads);
  await restored.setConsent(true);
  assert.equal(restored.getStatus().consent, 'allowed', 'explicit user re-enabling still works');
  h.config.preferenceStorage.setItem = () => { throw Error('unavailable'); };
  await restored.setConsent(false);
  assert.equal(restored.getStatus().consent, 'denied');
  assert.equal(restored.getStatus().lastError, 'preference_storage_unavailable', 'failed opt-out persistence stays visible');
  assert.equal(h.storage.peek(), null, 'the local queue is cleared even when the preference cannot be saved');
  restored.dispose();
});

test('consent opens a session, sends authenticated batches and deletes only acknowledged events', async () => {
  const h = setup();
  await h.client.setConsent(true);
  const tracked = await h.client.track('screen_viewed', { ...view, password: 'never send' });
  assert.equal(tracked.queued, true);
  assert.equal(h.client.getStatus().queued, 2);
  const result = await h.client.flush();
  assert.equal(h.requests[0].url, '/api/analytics/register');
  assert.equal(h.requests[1].url, '/api/events');
  assert.equal(h.requests[1].init.headers.Authorization, 'Bearer private-token');
  assert.equal(h.requests[1].body.events[1].payload.password, undefined);
  assert.equal(result.queued, 0);
  assert.equal(result.lastAck.accepted.length, 2);
  assert.equal(JSON.stringify(result).includes('private-token'), false);
});

test('offline retries preserve event IDs and credentials across reload', async () => {
  const h = setup();
  const workingFetch = h.config.fetch;
  let offline = true;
  const config = { ...h.config, fetch: (url, init) => {
    if (offline && url === '/api/events') throw new Error('offline');
    return workingFetch(url, init);
  } };
  h.client.dispose();
  const first = createAnalytics(config);
  await first.setConsent(true);
  await first.track('screen_viewed', view);
  const before = h.storage.peek().events.map(event => event.event_id);
  await first.flush();
  assert.equal(first.getStatus().queued, 2);
  first.dispose(); offline = false; h.advance(2000);
  const second = createAnalytics(config);
  await second.ready;
  await second.flush();
  assert.deepEqual(h.requests.at(-1).body.events.map(event => event.event_id), before);
  assert.equal(h.requests.filter(request => request.url.endsWith('/register')).length, 1);
  assert.equal(second.getStatus().queued, 0);
});

test('duplicate and explicit rejected ACKs resolve, missing ACKs remain queued', async () => {
  const h = setup({ fetch: async (url, init) => {
    if (url.endsWith('/register')) return response({ client_id: 'id', write_token: 'secret' });
    const events = JSON.parse(init.body).events;
    return response({ accepted: [], duplicate: [events[0].event_id, 'foreign-id'], rejected: [{ event_id: events[1].event_id, reason: 'bad_payload' }] });
  } });
  await h.client.setConsent(true);
  await h.client.track('screen_viewed', view);
  await h.client.track('screen_viewed', view);
  const result = await h.client.flush();
  assert.equal(result.queued, 1);
  assert.equal(result.rejected, 1);
  assert.equal(result.lastAck.duplicate.length, 1);
  assert.equal(result.lastAck.rejected[0].reason, 'bad_payload');
});

test('concurrent flush calls share one in-flight batch', async () => {
  const gate = deferred(); let deliveries = 0;
  const h = setup({ fetch: async (url, init) => {
    if (url.endsWith('/register')) return response({ client_id: 'id', write_token: 'secret' });
    deliveries++; await gate.promise;
    return response({ accepted: JSON.parse(init.body).events.map(e => e.event_id), duplicate: [], rejected: [] });
  } });
  await h.client.setConsent(true);
  const a = h.client.flush(), b = h.client.flush();
  assert.equal(a, b);
  gate.resolve(); await Promise.all([a, b]);
  assert.equal(deliveries, 1);
});

test('withdrawal during registration aborts and cannot recreate credentials or enqueue events', async () => {
  const started = deferred(), gate = deferred(); let signal, eventRequests = 0;
  const h = setup({ fetch: async (url, init) => {
    if (!url.endsWith('/register')) { eventRequests++; return response({ accepted: [], duplicate: [], rejected: [] }); }
    signal = init.signal; started.resolve(); await gate.promise;
    return response({ client_id: 'id', write_token: 'secret' });
  } });
  await h.client.setConsent(true);
  const inFlight = h.client.flush(); await started.promise;
  await h.client.setConsent(false);
  assert.equal(signal.aborted, true);
  gate.resolve(); await inFlight;
  assert.equal(eventRequests, 0);
  assert.equal(h.storage.peek(), null);
  assert.equal(h.client.getStatus().registered, false);
  assert.equal(h.client.getStatus().queued, 0);
});

test('late event ACK after withdrawal does not restore state', async () => {
  const started = deferred(), gate = deferred();
  const h = setup({ fetch: async (url, init) => {
    if (url.endsWith('/register')) return response({ client_id: 'id', write_token: 'secret' });
    started.resolve(); await gate.promise;
    return response({ accepted: JSON.parse(init.body).events.map(e => e.event_id), duplicate: [], rejected: [] });
  } });
  await h.client.setConsent(true);
  const flight = h.client.flush(); await started.promise;
  await h.client.setConsent(false); gate.resolve(); await flight;
  assert.equal(h.storage.peek(), null);
  assert.equal(h.client.getStatus().lastAck, null);
  assert.equal(h.client.getStatus().lastSentAt, null);
});

test('withdrawal while persisting clears the old snapshot after pending write', async () => {
  const storage = memoryStore();
  const originalSave = storage.save.bind(storage);
  const started = deferred(), gate = deferred(); let shouldBlock = false;
  storage.save = async value => { if (shouldBlock) { started.resolve(); await gate.promise; } await originalSave(value); };
  const h = setup({ storage });
  await h.client.setConsent(true); shouldBlock = true;
  const tracking = h.client.track('screen_viewed', view); await started.promise;
  const withdrawal = h.client.setConsent(false); gate.resolve();
  await Promise.all([tracking, withdrawal]);
  assert.equal(storage.peek(), null);
  assert.equal(h.client.getStatus().queued, 0);
});

test('sandbox endpoints, keys and session data are isolated from production', async () => {
  const production = setup(); await production.client.setConsent(true); await production.client.flush();
  const sandbox = setup({ scope: 'sandbox' }); await sandbox.client.setConsent(true); await sandbox.client.flush();
  assert.equal(sandbox.requests[0].url, '/api/analytics/test/register');
  assert.equal(sandbox.requests[1].url, '/api/analytics/test/events');
  assert.equal([...sandbox.prefs.keys()][0], 'jade-run:analytics:v1:sandbox:consent');
  assert.equal([...production.prefs.keys()][0], 'jade-run:analytics:v1:production:consent');
});

test('429 Retry-After and 5xx backoff prevent immediate replay', async () => {
  let calls = 0;
  const h = setup({ fetch: async url => {
    if (url.endsWith('/register')) return response({ client_id: 'id', write_token: 'secret' });
    calls++;
    return response({}, calls === 1 ? 429 : 503, calls === 1 ? { 'Retry-After': '10' } : {});
  } });
  await h.client.setConsent(true); await h.client.flush(); await h.client.flush();
  assert.equal(calls, 1);
  h.advance(10001); await h.client.flush(); await h.client.flush();
  assert.equal(calls, 2);
  assert.equal(h.client.getStatus().queued, 1);
});

test('unavailable persistent storage buffers in memory but pauses delivery to avoid replay under another identity', async () => {
  const h = setup({ storage: { load: async () => { throw new Error('denied'); }, save: async () => { throw new Error('denied'); }, clear: async () => {} }, maxEvents: 3 });
  await h.client.setConsent(true);
  for (let i = 0; i < 5; i++) await h.client.track('screen_viewed', view);
  assert.equal(h.client.getStatus().storage, 'memory');
  assert.equal(h.client.getStatus().queued, 3);
  assert.equal(h.client.getStatus().dropped, 3);
  await h.client.flush();
  assert.equal(h.client.getStatus().queued, 3);
  assert.equal(h.client.getStatus().delivery, 'paused');
  assert.equal(h.requests.length, 0);
});

test('batches contain at most 20 events and 32 KiB, inactivity starts a new session', async () => {
  const h = setup(); await h.client.setConsent(true);
  const initialSession = h.storage.peek().session.id;
  for (let i = 0; i < 22; i++) await h.client.track('screen_viewed', view);
  await h.client.flush();
  const delivered = h.requests.at(-1);
  assert.equal(delivered.body.events.length, 20);
  assert.ok(Buffer.byteLength(delivered.init.body) <= 32768);
  assert.equal(h.client.getStatus().queued, 3);
  h.advance(30 * 60000);
  await h.client.track('screen_viewed', view);
  assert.notEqual(h.storage.peek().session.id, initialSession);
});

test('hand API requires explicit version and IDs, strips non-contract fields, deduplicates pattern IDs', async () => {
  const h = setup(); await h.client.setConsent(true);
  const payload = { shape: 'normal', round_no: 1, round_score: 600, target_score: 400, passed: true, credited_pattern_ids: ['mcr.all_pungs', 'mcr.all_pungs'], record_quality: 'complete', game: { private: true } };
  assert.equal((await h.client.track('hand_completed', payload)).reason, 'invalid_event');
  const context = { mode: 'mcr', run_id: randomUUID(), round_attempt_id: randomUUID(), hand_id: randomUUID(), rules_version: 'v1', score_model_version: 'v1' };
  assert.equal((await h.client.track('hand_completed', payload, context)).queued, true);
  const event = h.storage.peek().events.at(-1);
  assert.equal(event.payload.game, undefined);
  assert.deepEqual(event.payload.credited_pattern_ids, ['mcr.all_pungs']);
});

test('same-scope writers use an exclusive lock; blocked instance never loads or overwrites outbox', async () => {
  const locks = locksManager();
  const h = setup({ locks }); await h.client.setConsent(true);
  await h.client.track('screen_viewed', view);
  const snapshot = h.storage.peek();
  const second = createAnalytics(h.config); await second.ready;
  assert.equal(second.getStatus().coordination, 'blocked');
  assert.equal((await second.track('screen_viewed', view)).reason, 'collector_busy');
  await second.flush();
  assert.equal(h.storage.loads, 1);
  assert.deepEqual(h.storage.peek(), snapshot);
  assert.equal(h.requests.length, 0);
  h.client.dispose();
  await new Promise(resolve => setImmediate(resolve));
  await second.setConsent(true);
  assert.equal(second.getStatus().coordination, 'owner');
  assert.equal(second.getStatus().queued, 2);
  await second.setConsent(false); second.dispose();
});

test('different scopes can hold locks independently', async () => {
  const locks = locksManager();
  const a = setup({ locks }), b = setup({ locks, scope: 'sandbox' });
  await Promise.all([a.client.setConsent(true), b.client.setConsent(true)]);
  assert.equal(a.client.getStatus().coordination, 'owner');
  assert.equal(b.client.getStatus().coordination, 'owner');
  a.client.dispose(); b.client.dispose();
});

test('a blocked writer cannot clear the active writer storage before revocation reaches its owner', async () => {
  const h = setup({ locks: locksManager() }); await h.client.setConsent(true);
  const second = createAnalytics(h.config); await second.ready;
  assert.equal(second.getStatus().coordination, 'blocked');
  await second.setConsent(false);
  assert.notEqual(h.storage.peek(), null);
  await h.client.setConsent(false);
  assert.equal(h.storage.peek(), null);
  h.client.dispose(); second.dispose();
});

test('default-enabled tabs synchronize opt-out through storage and broadcast without reviving the queue', async t => {
  const properties = ['window', 'BroadcastChannel', 'addEventListener', 'removeEventListener'];
  const descriptors = new Map(properties.map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  t.after(() => { for (const [key, descriptor] of descriptors) {
    if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key];
  } });
  for (const transport of ['storage', 'broadcast']) {
    const callbacks = new Set(), channels = new Set();
    Object.assign(globalThis, {
      window: {},
      addEventListener(type, callback) { if (type === 'storage') callbacks.add(callback); },
      removeEventListener(type, callback) { if (type === 'storage') callbacks.delete(callback); },
      BroadcastChannel: class {
        constructor(name) { this.name = name; channels.add(this); }
        postMessage(data) { if (transport === 'broadcast') for (const receiver of channels) {
          if (receiver !== this && receiver.name === this.name) queueMicrotask(() => receiver.onmessage?.({ data }));
        } }
        close() { channels.delete(this); }
      },
    });
    const h = setup({ defaultEnabled: true, locks: locksManager() }); await h.client.ready;
    const second = createAnalytics(h.config); await second.ready;
    const sandbox = createAnalytics({ ...h.config, scope: 'sandbox' }); await sandbox.ready;
    assert.equal(second.getStatus().coordination, 'blocked');
    assert.equal(sandbox.getStatus().consent, 'unknown');
    await second.setConsent(false);
    if (transport === 'storage') for (const callback of callbacks) callback({ key: 'jade-run:analytics:v1:production:consent', newValue: 'denied' });
    await Promise.all([h.client.ready, second.ready]);
    assert.equal(h.client.getStatus().consent, 'denied', transport);
    assert.equal(h.client.getStatus().queued, 0); assert.equal(h.storage.peek(), null);
    assert.equal(sandbox.getStatus().consent, 'unknown', 'production revocation does not change sandbox');
    await h.client.flush(); await second.flush();
    assert.equal(h.requests.length, 0);
    h.client.dispose(); second.dispose(); sandbox.dispose();
    const refreshed = createAnalytics(h.config); await refreshed.ready;
    assert.equal(refreshed.getStatus().consent, 'denied', transport);
    assert.equal(refreshed.getStatus().queued, 0); refreshed.dispose();
  }
});

for (const scope of ['production', 'sandbox']) test(`${scope}: expired lease renews the original identity and retries identical event IDs`, async () => {
  const calls = []; let valid = false;
  const h = setup({ scope, fetch: async (url, init) => {
    calls.push({ url, init });
    if (url.endsWith('/register')) return response({ client_id: 'same-client', write_token: 'same-token', expires_at: '2026-01-01T00:00:00Z' });
    if (url.endsWith('/renew')) { valid = true; return response({ client_id: 'same-client', write_token: 'same-token', expires_at: '2027-01-01T00:00:00Z' }); }
    return valid ? response({ accepted: JSON.parse(init.body).events.map(e => e.event_id), duplicate: [], rejected: [] }) : response({ error: 'expired' }, 401);
  } });
  await h.client.setConsent(true); await h.client.track('screen_viewed', view);
  const ids = h.storage.peek().events.map(e => e.event_id);
  await h.client.flush();
  const sends = calls.filter(call => call.url.endsWith('/events'));
  assert.equal(sends.length, 2);
  assert.equal(sends[0].init.body, sends[1].init.body);
  assert.deepEqual(JSON.parse(sends[1].init.body).events.map(e => e.event_id), ids);
  assert.equal(calls.filter(call => call.url.endsWith('/register')).length, 1);
  assert.equal(calls.find(call => call.url.endsWith('/renew')).url, scope === 'sandbox' ? '/api/analytics/test/renew' : '/api/analytics/renew');
  assert.equal(h.storage.peek().credentials.client_id, 'same-client');
  assert.equal(h.storage.peek().credentials.write_token, 'same-token');
  assert.equal(h.storage.peek().credentials.expires_at, '2027-01-01T00:00:00Z');
  assert.equal(h.client.getStatus().queued, 0);
});

test('failed renewal pauses without clearing queue or creating another client; explicit flush retries once', async () => {
  let registrations = 0, renewals = 0, sends = 0;
  const h = setup({ fetch: async url => {
    if (url.endsWith('/register')) { registrations++; return response({ client_id: 'same-client', write_token: 'same-token' }); }
    if (url.endsWith('/renew')) { renewals++; return response({ error: 'unavailable' }, 503); }
    sends++; return response({ error: 'expired' }, 401);
  } });
  await h.client.setConsent(true); await h.client.flush();
  assert.equal(h.client.getStatus().delivery, 'paused');
  assert.equal(h.client.getStatus().lastError, 'renewal_http_503');
  assert.equal(h.client.getStatus().queued, 1);
  assert.equal(renewals, 1); assert.equal(sends, 1);
  await h.client.flush();
  assert.equal(renewals, 2); assert.equal(sends, 2); assert.equal(registrations, 1);
});

test('renewal response cannot change client or token, and a second 401 never loops', async () => {
  for (const differentIdentity of [true, false]) {
    let renewals = 0, sends = 0;
    const h = setup({ fetch: async url => {
      if (url.endsWith('/register')) return response({ client_id: 'same-client', write_token: 'same-token' });
      if (url.endsWith('/renew')) { renewals++; return response({ client_id: differentIdentity ? 'other-client' : 'same-client', write_token: 'same-token', expires_at: '2027-01-01T00:00:00Z' }); }
      sends++; return response({ error: 'expired' }, 401);
    } });
    await h.client.setConsent(true); await h.client.flush();
    assert.equal(renewals, 1); assert.equal(sends, differentIdentity ? 1 : 2);
    assert.equal(h.client.getStatus().delivery, 'paused');
    assert.equal(h.client.getStatus().lastError, differentIdentity ? 'invalid_renewal' : 'events_http_401');
    assert.equal(h.storage.peek().credentials.client_id, 'same-client');
    assert.equal(h.client.getStatus().queued, 1);
  }
});

test('withdrawal during renewal aborts and a late reply cannot restore credentials or resend', async () => {
  const started = deferred(), gate = deferred(); let signal, sends = 0;
  const h = setup({ fetch: async (url, init) => {
    if (url.endsWith('/register')) return response({ client_id: 'same-client', write_token: 'same-token' });
    if (url.endsWith('/renew')) {
      signal = init.signal; started.resolve(); await gate.promise;
      return response({ client_id: 'same-client', write_token: 'same-token', expires_at: '2027-01-01T00:00:00Z' });
    }
    sends++; return response({ error: 'expired' }, 401);
  } });
  await h.client.setConsent(true);
  const flight = h.client.flush(); await started.promise;
  await h.client.setConsent(false);
  assert.equal(signal.aborted, true);
  gate.resolve(); await flight;
  assert.equal(sends, 1);
  assert.equal(h.storage.peek(), null);
  assert.equal(h.client.getStatus().registered, false);
  assert.equal(h.client.getStatus().queued, 0);
});

test('credential persistence failure never sends disk events under an ephemeral identity before reload', async () => {
  const storage = memoryStore(); const originalSave = storage.save.bind(storage);
  let failCredentialSave = true, registrations = 0;
  const deliveries = [];
  storage.save = async value => {
    if (failCredentialSave && value.credentials) throw new Error('quota');
    return originalSave(value);
  };
  const h = setup({ storage, fetch: async (url, init) => {
    if (url.endsWith('/register')) { registrations++; return response({ client_id: `client-${registrations}`, write_token: `token-${registrations}` }); }
    for (const event of JSON.parse(init.body).events) deliveries.push({ token: init.headers.Authorization, event_id: event.event_id });
    return response({ accepted: JSON.parse(init.body).events.map(e => e.event_id), duplicate: [], rejected: [] });
  } });
  await h.client.setConsent(true); await h.client.track('screen_viewed', view);
  const ids = storage.peek().events.map(e => e.event_id);
  await h.client.flush();
  assert.equal(registrations, 1);
  assert.equal(deliveries.length, 0);
  assert.equal(storage.peek().credentials, null);
  assert.equal(h.client.getStatus().delivery, 'paused');
  h.client.dispose(); failCredentialSave = false;
  const restored = createAnalytics(h.config); await restored.ready; await restored.flush();
  assert.equal(registrations, 2);
  assert.deepEqual(deliveries.map(item => item.event_id), ids);
  assert.ok(deliveries.every(item => item.token === 'Bearer token-2'));
  assert.equal(restored.getStatus().queued, 0);
});

test('manual retry persists the same in-memory credentials before any event can be delivered', async () => {
  const storage = memoryStore(); const originalSave = storage.save.bind(storage);
  let blocked = true, registrations = 0, sends = 0;
  storage.save = async value => { if (blocked && value.credentials) throw new Error('quota'); return originalSave(value); };
  const h = setup({ storage, fetch: async (url, init) => {
    if (url.endsWith('/register')) { registrations++; return response({ client_id: 'client-one', write_token: 'token-one' }); }
    sends++;
    assert.equal(storage.peek().credentials.client_id, 'client-one');
    return response({ accepted: JSON.parse(init.body).events.map(e => e.event_id), duplicate: [], rejected: [] });
  } });
  await h.client.setConsent(true); await h.client.flush();
  assert.equal(sends, 0); blocked = false;
  await h.client.flush();
  assert.equal(registrations, 1); assert.equal(sends, 1);
  assert.equal(h.client.getStatus().storage, 'persistent');
  assert.equal(h.client.getStatus().queued, 0);
});

test('failed initial storage read merges the existing queue and identity on recovery instead of overwriting it', async () => {
  const initial = setup(); await initial.client.setConsent(true); await initial.client.track('screen_viewed', view);
  const existing = initial.storage.peek(); existing.credentials = { client_id: 'original-client', write_token: 'original-token' };
  await initial.storage.save(existing); initial.client.dispose();
  const originalLoad = initial.storage.load.bind(initial.storage); let readFails = true;
  initial.storage.load = async () => { if (readFails) throw new Error('unavailable'); return originalLoad(); };
  const client = createAnalytics(initial.config); await client.ready;
  await client.track('screen_viewed', view); await client.flush();
  assert.equal(initial.requests.length, 0);
  readFails = false; await client.flush();
  assert.equal(initial.requests.length, 1);
  assert.equal(initial.requests[0].init.headers.Authorization, 'Bearer original-token');
  const ids = new Set(initial.requests[0].body.events.map(e => e.event_id));
  for (const event of existing.events) assert.equal(ids.has(event.event_id), true);
  assert.equal(client.getStatus().queued, 0);
});

test('stable event ID and original occurred_at survive delayed tracking and offline retry', async () => {
  const h = setup(); await h.client.setConsent(true);
  const identity = { event_id: 'round_settled:stable-round-1234', occurred_at: '2026-10-21T03:59:00.000Z' };
  h.advance(10000);
  const tracked = await h.client.track('screen_viewed', view, identity);
  assert.equal(tracked.queued, true);
  assert.equal(tracked.durable, true);
  assert.equal(tracked.event_id, identity.event_id);
  const stored = h.storage.peek().events.at(-1);
  assert.equal(stored.occurred_at, identity.occurred_at);
  h.advance(10000); await h.client.flush();
  const sent = h.requests.at(-1).body.events.find(e => e.event_id === identity.event_id);
  assert.equal(sent.occurred_at, identity.occurred_at);
});

test('pending stable event identity reuses original envelope and rejects changed fact', async () => {
  const h = setup(); await h.client.setConsent(true);
  const identity = { event_id: 'stable-screen-event', occurred_at: '2026-10-21T03:59:00.000Z' };
  await h.client.track('screen_viewed', view, identity);
  const first = h.storage.peek().events.at(-1);
  h.advance(31 * 60000);
  const again = await h.client.track('screen_viewed', view, identity);
  assert.equal(again.queued, true); assert.equal(again.duplicate, true);
  assert.deepEqual(h.storage.peek().events.find(e => e.event_id === identity.event_id), first);
  assert.equal(h.storage.peek().events.filter(e => e.event_id === identity.event_id).length, 1);
  const conflict = await h.client.track('screen_viewed', { ...view, screen: 'different_screen' }, identity);
  assert.deepEqual(conflict, { queued: false, reason: 'event_id_conflict' });
});

test('invalid event identity and timestamps are rejected; undefined overrides preserve defaults', async () => {
  const h = setup(); await h.client.setConsent(true);
  for (const identity of [
    { event_id: null }, { event_id: '' }, { event_id: 'bad id /' }, { event_id: 'a'.repeat(101) },
    { occurred_at: null }, { occurred_at: '2026-02-30T04:00:00Z' }, { occurred_at: '2026-10-21T04:00:00+00:00' },
    { occurred_at: '2026-10-21T04:11:00Z' }, { occurred_at: '2026-10-13T04:00:00Z' },
  ]) assert.equal((await h.client.track('screen_viewed', view, identity)).reason, 'invalid_event');
  assert.equal(h.client.getStatus().queued, 1);
  const result = await h.client.track('screen_viewed', view, { event_id: undefined, occurred_at: undefined });
  assert.equal(result.queued, true);
  assert.match(result.event_id, /^[0-9a-f-]{36}$/);
  assert.equal(h.storage.peek().events.at(-1).occurred_at, '2026-10-21T04:00:00.000Z');
});

test('collection generation distinguishes closing and re-enabling consent without rotating an active client', async () => {
  const h = setup(); const initial = h.client.getStatus().collectionGeneration;
  await h.client.setConsent(true); await h.client.flush();
  const enabled = h.client.getStatus().collectionGeneration;
  const credentials = h.storage.peek().credentials;
  await h.client.setConsent(true);
  assert.equal(h.client.getStatus().collectionGeneration, enabled);
  assert.deepEqual(h.storage.peek().credentials, credentials);
  await h.client.setConsent(false);
  const disabled = h.client.getStatus().collectionGeneration;
  await h.client.setConsent(true);
  assert.ok(initial < enabled && enabled < disabled && disabled < h.client.getStatus().collectionGeneration);
});

const gameState = {
  phase: 'play', round_no: 1, formed_count: 0, structure_count: 0, kong_count: 0,
  hand_count: 18, deck_count: 118, discard_count: 0, coins: 8, ink: 4, swaps: 5,
  total_score: 0, round_score: 0, process_score: 0, round_start_score: 0, target_score: 1000,
  relic_ids: [], single_count: 0, wild_used: false,
};
const gameContext = {
  mode: 'mcr', run_id: 'test-run-0001', round_attempt_id: 'test-round-0001', hand_id: null,
  rules_version: 'free_play_v2', score_model_version: 'cumulative_v2',
};

test('versioned lifecycle and actions preserve rule limits and old outboxes across upgrades', async () => {
  const h = setup(); await h.client.setConsent(true);
  const lifecycle = { state: gameState, record_quality: 'complete' };
  assert.equal((await h.client.track('round_started', lifecycle, gameContext)).queued, true);
  const action = {
    action_id: 'test-action-0001', action: 'select', input_method: 'pointer', outcome: 'applied', reason_code: null,
    before: gameState, after: gameState, selected_tile_ids: ['tile-1'], tile_changes: [], evidence_truncated: false,
    context: { source_zone: 'hand', transform_kind: null, transform_value: null, relic_id: null },
  };
  assert.equal((await h.client.track('game_action', action, gameContext)).queued, true);
  assert.equal((await h.client.track('game_action', { ...action, full_game: { secret: 'never_send' } }, gameContext)).reason, 'invalid_event');
  assert.equal((await h.client.track('round_started', lifecycle, { ...gameContext, score_model_version: 'legacy_v1' })).reason, 'invalid_event');
  assert.equal((await h.client.track('round_started', lifecycle, { ...gameContext, run_id: null })).reason, 'invalid_event');
  assert.equal((await h.client.track('hand_completed', { ...lifecycle }, gameContext)).reason, 'invalid_event');
  const v3Context = { ...gameContext, rules_version: 'free_play_v3', score_model_version: 'exponential_v3' };
  const highState = { ...gameState, hand_count: 10, deck_count: 126, total_score: 2 ** 48, round_start_score: 2 ** 48 };
  assert.equal((await h.client.track('round_started', { state: highState, record_quality: 'complete' }, v3Context)).queued, true);
  assert.equal((await h.client.track('round_started', { state: highState, record_quality: 'complete' }, gameContext)).reason, 'invalid_event');
  const v4Context = { ...v3Context, rules_version: 'free_play_v4' };
  const v4State = { ...highState, hand_count: 12, deck_count: 124, swaps: 7 };
  assert.equal((await h.client.track('round_started', { state: v4State, record_quality: 'complete' }, v4Context)).queued, true);
  assert.equal((await h.client.track('round_started', { state: v4State, record_quality: 'complete' }, v3Context)).reason, 'invalid_event');
  const v5Context = { ...gameContext, rules_version: 'opening_build_v5', score_model_version: 'four_core_v5' };
  const v5State = { ...v4State, phase: 'prepare', swaps: 5, relic_ids: ['core_high', 'high_rescue'], rescue_used: false };
  assert.equal((await h.client.track('round_started', { state: v5State, record_quality: 'complete' }, v5Context)).queued, true);
  assert.equal((await h.client.track('round_started', { state: v5State, record_quality: 'complete' }, { ...v5Context, score_model_version: 'exponential_v3' })).reason, 'invalid_event');
  assert.equal((await h.client.track('round_started', { state: v5State, record_quality: 'complete' }, v4Context)).reason, 'invalid_event');
  const begin = {
    ...action, action: 'begin_play', before: v5State, after: { ...v5State, phase: 'play' }, selected_tile_ids: [],
    context: { ...action.context, source_zone: null, rescue_type: null, replace_relic_id: null },
  };
  assert.equal((await h.client.track('game_action', begin, v5Context)).queued, true);
  const rescue = {
    ...begin, action: 'high_rescue', before: begin.after, after: { ...begin.after, rescue_used: true },
    context: { ...begin.context, source_zone: 'hand', rescue_type: 'exchange' },
  };
  assert.equal((await h.client.track('game_action', rescue, v5Context)).queued, true);
  assert.equal(h.storage.peek().events.at(-1).payload.after.rescue_used, true);
  assert.equal((await h.client.track('game_action', { ...begin, context: action.context }, v5Context)).reason, 'invalid_event');
  const v6Context = { ...gameContext, rules_version: 'opening_build_v6', score_model_version: 'four_core_v6' };
  const v6State = { ...v5State, ink: 2, relic_ids: ['core_high', 'rank_brush'] };
  assert.equal((await h.client.track('round_started', { state: v6State, record_quality: 'complete' }, v6Context)).queued, true);
  assert.equal((await h.client.track('round_started', { state: v6State, record_quality: 'complete' }, { ...v6Context, score_model_version: 'four_core_v5' })).reason, 'invalid_event');
  const fullState = { ...v6State, phase: 'play', formed_count: 14, structure_count: 14 };
  const repair = {
    ...begin, action: 'transform', before: fullState, after: { ...fullState, ink: 0 }, selected_tile_ids: ['tile-1'],
    tile_changes: [['tile-1', 'formed', 'formed', 0, 1, false, false, true, true]],
    context: { ...begin.context, source_zone: 'formed', transform_kind: 'rank', transform_value: 1, relic_id: 'rank_brush' },
  };
  assert.equal((await h.client.track('game_action', repair, v6Context)).queued, true);
  assert.equal(h.storage.peek().events.at(-1).payload.after.ink, 0);
  for (const [context, state] of [[v3Context, highState], [v4Context, v4State], [v5Context, v5State], [v6Context, v6State]]) {
    assert.equal((await h.client.track('round_started', { state: { ...state, hand_count: state.hand_count + 1 }, record_quality: 'complete' }, context)).reason, 'invalid_event');
    assert.equal((await h.client.track('round_started', { state: { ...state, total_score: Number.MAX_SAFE_INTEGER + 1 }, record_quality: 'complete' }, context)).reason, 'invalid_event');
  }
  const storedOld = h.storage.peek().events.filter(event => ['free_play_v2', 'free_play_v3', 'free_play_v4', 'opening_build_v5'].includes(event.rules_version));
  h.client.dispose();
  const upgraded = createAnalytics({ ...h.config, rulesVersion: 'opening_build_v6', scoreModelVersion: 'four_core_v6', appRelease: 'opening-build-v6' });
  await upgraded.ready; await upgraded.flush();
  const deliveredOld = h.requests.at(-1).body.events.filter(event => ['free_play_v2', 'free_play_v3', 'free_play_v4', 'opening_build_v5'].includes(event.rules_version));
  assert.deepEqual(deliveredOld, storedOld);
  upgraded.dispose();
});

test('v2 settlement facts retain signed cumulative scoring and forbid false wins from hand_completed', async () => {
  const h = setup(); await h.client.setConsent(true);
  const faces = [0, 1, 2, 9, 10, 11, 18, 19, 20, 3, 4, 5, 27, 27];
  const tiles = faces.map((face, index) => ({ id: `tile-${index + 1}`, original: face, face, effective_face: face, wild: false }));
  const payload = {
    settlement_id: 'test-settlement-0001', round_no: 1, legal: true, result_type: 'win', passed: true,
    process_score: 80, win_score: 1200, penalty_score: 0, score_delta: 1200,
    round_score: 1280, round_start_score: 0, cumulative_before: 80, cumulative_after: 1280, target_score: 1000,
    record_quality: 'complete', shape: 'normal', tiles, declared_kongs: [],
    decomposition: { groups: [
      { type: 'chow', tile_ids: ['tile-1', 'tile-2', 'tile-3'] }, { type: 'chow', tile_ids: ['tile-4', 'tile-5', 'tile-6'] },
      { type: 'chow', tile_ids: ['tile-7', 'tile-8', 'tile-9'] }, { type: 'chow', tile_ids: ['tile-10', 'tile-11', 'tile-12'] },
      { type: 'pair', tile_ids: ['tile-13', 'tile-14'] },
    ] },
    credited_pattern_ids: [], unlock_pattern_ids: [], owned_relic_ids: ['jade'],
  };
  const context = { ...gameContext, hand_id: payload.settlement_id };
  assert.equal((await h.client.track('hand_completed', payload, context)).queued, true);
  const falseWin = {
    ...payload, settlement_id: 'test-settlement-0002', legal: false, result_type: 'false_win',
    win_score: 0, penalty_score: 1000, score_delta: -1000, round_score: -920, round_start_score: 2000,
    cumulative_before: 2080, cumulative_after: 1080, shape: null, decomposition: null,
  };
  const falseContext = { ...gameContext, hand_id: falseWin.settlement_id };
  assert.equal((await h.client.track('round_settled', falseWin, falseContext)).queued, true);
  assert.equal((await h.client.track('hand_completed', falseWin, falseContext)).reason, 'invalid_event');
  const stored = h.storage.peek().events.at(-1);
  assert.equal(stored.payload.round_score, -920);
  assert.equal(stored.payload.passed, true);
  assert.equal(stored.payload.result_type, 'false_win');
  assert.equal(stored.payload.cumulative_after, 1080);
});
