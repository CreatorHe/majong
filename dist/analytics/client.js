import { GAME_EVENT_NAMES, isGameEvent, validateGamePayload } from './game-schema.js';

/** Small analytics outbox controlled by the saved collection preference. */
const DAY = 86400000;
const EVENT_ID = /^[A-Za-z0-9_.:-]{8,100}$/;
const encoder = new TextEncoder();
const bytes = value => encoder.encode(JSON.stringify(value)).length;
const clone = value => JSON.parse(JSON.stringify(value));
const names = new Set(['session_started', 'screen_viewed', 'ui_action', 'client_error', 'hand_completed', ...GAME_EVENT_NAMES]);
const durableFacts = new Set(['hand_completed', 'round_settled', 'run_started', 'round_started', 'run_ended']);
const payloadKeys = {
  session_started: ['entry', 'viewport', 'has_save'],
  screen_viewed: ['screen', 'previous_screen', 'reason'],
  ui_action: ['action', 'target_id', 'input_method', 'outcome', 'reason_code'],
  client_error: ['code', 'screen', 'category'],
  hand_completed: ['shape', 'round_no', 'round_score', 'target_score', 'passed', 'credited_pattern_ids', 'record_quality'],
};
function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}

function browserStorage() { try { return globalThis.localStorage; } catch { return null; } }

/** Injectable storage must implement async load(), save(snapshot), clear(). */
export function createIndexedDBStore(namespace, indexedDB = globalThis.indexedDB) {
  let connection;
  function open() {
    if (!indexedDB) return Promise.reject(new Error('indexeddb_unavailable'));
    if (!connection) connection = new Promise((resolve, reject) => {
      const request = indexedDB.open(namespace, 1);
      request.onupgradeneeded = () => request.result.createObjectStore('state');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
      request.onblocked = () => reject(new Error('indexeddb_blocked'));
    });
    return connection;
  }
  async function transact(mode, action) {
    const db = await open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('state', mode);
      const request = action(tx.objectStore('state'));
      tx.oncomplete = () => resolve(request.result ?? null);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error || new Error('indexeddb_aborted'));
    });
  }
  return {
    load: () => transact('readonly', store => store.get('snapshot')),
    save: snapshot => transact('readwrite', store => store.put(snapshot, 'snapshot')),
    clear: () => transact('readwrite', store => store.clear()),
  };
}

export function createAnalytics(options = {}) {
  const scope = options.scope === 'test' ? 'sandbox' : options.scope ?? 'production';
  if (!['production', 'sandbox'].includes(scope)) throw new TypeError('Unknown analytics scope');
  const namespace = `jade-run:analytics:v1:${scope}`;
  const prefs = options.preferenceStorage === undefined ? browserStorage() : options.preferenceStorage;
  let store = options.storage ?? createIndexedDBStore(namespace, options.indexedDB);
  const fetcher = options.fetch ?? globalThis.fetch?.bind(globalThis);
  const now = options.clock ?? Date.now;
  const uuid = options.uuid ?? (() => globalThis.crypto.randomUUID());
  const defer = options.setTimeout ?? globalThis.setTimeout;
  const cancel = options.clearTimeout ?? globalThis.clearTimeout;
  const endpoint = scope === 'sandbox' ? '/api/analytics/test' : '/api';
  const registerEndpoint = scope === 'sandbox' ? `${endpoint}/register` : '/api/analytics/register';
  const renewEndpoint = scope === 'sandbox' ? `${endpoint}/renew` : '/api/analytics/renew';
  const eventsEndpoint = `${endpoint}/events`;
  const maxEvents = options.maxEvents ?? 5000;
  const maxBytes = options.maxBytes ?? 5 * 1024 * 1024;
  const maxAgeMs = options.maxAgeMs ?? 7 * DAY;
  const listeners = new Set();
  const lockManager = options.locks === undefined ? globalThis.navigator?.locks : options.locks;
  let coordination = 'idle', releaseLock = null;
  let channel = null;
  try {
    if (typeof window !== 'undefined' && typeof BroadcastChannel !== 'undefined') channel = new BroadcastChannel(`${namespace}:consent`);
  } catch {}
  let consent = 'unknown', disposed = false, epoch = 0;
  let state = { credentials: null, session: null, events: [] };
  let storageMode = 'persistent', storageFault = null, dropped = 0, rejected = 0;
  let lastError = null, lastSentAt = null, lastAck = null, sending = false;
  let failureCount = 0, retryAt = 0, timer = null, controller = null, deliveryPaused = false;
  let serial = Promise.resolve(), stateReady = Promise.resolve(), flushPromise = null;

  const active = generation => !disposed && consent === 'allowed' && generation === epoch;
  function getStatus() {
    return { scope, consent, collectionGeneration: epoch, queued: state.events.length, storage: storageMode, coordination,
      dropped, rejected, lastError, lastSentAt, lastAck: lastAck && clone(lastAck), retryAt,
      delivery: consent !== 'allowed' ? 'idle' : sending ? 'sending' : deliveryPaused ? 'paused' : retryAt > now() ? 'backoff' : lastError ? 'error' : 'idle',
      registered: Boolean(state.credentials), disposed };
  }
  function emit() { for (const listener of listeners) { try { listener(getStatus()); } catch {} } }
  function exclusive(job) {
    const result = serial.then(job);
    serial = result.catch(() => {});
    return result;
  }
  function preference(value) {
    try {
      if (!prefs) throw new Error('preference_storage_unavailable');
      prefs.setItem(`${namespace}:consent`, value);
    } catch { lastError = 'preference_storage_unavailable'; }
  }
  function unlock() { releaseLock?.(); releaseLock = null; coordination = 'idle'; }
  async function takeLock(generation) {
    if (!lockManager) {
      coordination = options.storage ? 'external' : 'isolated_memory';
      if (!options.storage) storageMode = 'memory';
      return true;
    }
    return new Promise(resolve => {
      lockManager.request(namespace, { ifAvailable: true }, async lock => {
        if (!lock || !active(generation)) { coordination = lock ? 'idle' : 'blocked'; resolve(false); return; }
        coordination = 'owner';
        await new Promise(release => { releaseLock = release; resolve(true); });
      }).catch(() => { coordination = 'blocked'; lastError = 'collector_lock_unavailable'; resolve(false); });
    });
  }
  async function clearStore() {
    // A non-owner cannot overwrite a live owner's outbox. The owner receives revocation below.
    if (coordination === 'owner' || !lockManager) { await store.clear(); return; }
    await lockManager.request(namespace, { ifAvailable: true }, async lock => { if (lock) await store.clear(); });
  }
  function stopTimer() { if (timer !== null) cancel(timer); timer = null; }
  function schedule(delay = 5000) {
    if (options.autoFlush === false || disposed || deliveryPaused || consent !== 'allowed' || !state.events.length) return;
    stopTimer();
    timer = defer(() => { timer = null; void flushInternal(true); }, Math.max(delay, retryAt - now(), 0));
    timer?.unref?.();
  }
  async function save(generation) {
    if (!active(generation) || storageFault) return false;
    if (storageMode === 'memory') return true; // Deliberate isolated mode; no shared disk snapshot exists.
    try { await store.save(clone(state)); return active(generation); }
    catch { pauseStorage('save'); return false; }
  }
  function pauseStorage(operation) {
    storageFault = storageFault === 'load' ? 'load' : operation;
    storageMode = 'memory'; deliveryPaused = true; retryAt = 0; lastError = 'storage_unavailable';
  }
  function savedState(saved) {
    if (!saved || !Array.isArray(saved.events)) return null;
    return {
      credentials: saved.credentials && typeof saved.credentials.client_id === 'string' && typeof saved.credentials.write_token === 'string' ? saved.credentials : null,
      session: saved.session && typeof saved.session.id === 'string' && Number.isFinite(saved.session.lastActivity) ? saved.session : null,
      events: saved.events.filter(event => event?.schema_version === 1 && typeof event.event_id === 'string' && names.has(event.event_name)),
    };
  }
  async function recoverStorage(generation) {
    if (!storageFault || !active(generation)) return !storageFault;
    try {
      if (storageFault === 'load') {
        const restored = savedState(await store.load());
        if (!active(generation)) return false;
        if (restored) {
          state.credentials = restored.credentials;
          state.events = [...new Map([...restored.events, ...state.events].map(event => [event.event_id, event])).values()];
          state.session ??= restored.session;
          prune();
        }
      }
      await store.save(clone(state));
      if (!active(generation)) return false;
      storageFault = null; storageMode = 'persistent'; deliveryPaused = false; lastError = null;
      return true;
    } catch { pauseStorage(storageFault); return false; }
  }
  function prune() {
    const cutoff = now() - maxAgeMs;
    const kept = state.events.filter(event => Date.parse(event.occurred_at) >= cutoff);
    dropped += state.events.length - kept.length;
    state.events = kept;
    while (state.events.length > maxEvents || bytes(state.events) > maxBytes) {
      const expendable = state.events.findIndex(event => !durableFacts.has(event.event_name));
      state.events.splice(expendable === -1 ? 0 : expendable, 1);
      dropped++;
    }
  }
  function envelope(name, payload, context = {}) {
    return {
      schema_version: 1, event_id: context.event_id === undefined ? uuid() : context.event_id, event_name: name,
      occurred_at: context.occurred_at === undefined ? new Date(now()).toISOString() : context.occurred_at,
      session_id: state.session.id, app_release: context.app_release ?? options.appRelease ?? 'analytics-v1',
      rules_version: context.rules_version ?? options.rulesVersion ?? 'unintegrated-v1',
      score_model_version: context.score_model_version ?? options.scoreModelVersion ?? 'unintegrated-v1',
      mode: context.mode ?? null, run_id: context.run_id ?? null,
      round_attempt_id: context.round_attempt_id ?? null, hand_id: context.hand_id ?? null, payload,
    };
  }
  function validIdentity(context) {
    if (context.event_id !== undefined && (typeof context.event_id !== 'string' || !EVENT_ID.test(context.event_id))) return false;
    if (context.occurred_at !== undefined) {
      if (typeof context.occurred_at !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?Z$/.test(context.occurred_at)) return false;
      const occurred = Date.parse(context.occurred_at);
      if (!Number.isFinite(occurred) || occurred < now() - 7 * DAY || occurred > now() + 600000 || new Date(occurred).toISOString().slice(0, 19) !== context.occurred_at.slice(0, 19)) return false;
    }
    return true;
  }
  function ensureSession() {
    if (!state.session || now() - state.session.lastActivity >= 30 * 60000 || now() < state.session.lastActivity) {
      state.session = { id: uuid(), lastActivity: now() };
      state.events.push(envelope('session_started', {
        entry: options.entry ?? 'game', viewport: options.viewport ?? 'wide', has_save: Boolean(options.hasSave),
      }));
    }
    state.session.lastActivity = now();
  }
  function validPayload(name, payload, context) {
    if (!names.has(name) || !payload || typeof payload !== 'object' || Array.isArray(payload)) return null;
    if (isGameEvent(name, context)) {
      const validation = validateGamePayload(name, payload, context);
      return validation.ok ? validation.payload : null;
    }
    const clean = {};
    for (const key of payloadKeys[name]) {
      if (payload[key] !== undefined) clean[key] = payload[key];
    }
    if (name === 'hand_completed') {
      if (!['mcr', 'riichi'].includes(context.mode) ||
          !['run_id', 'round_attempt_id', 'hand_id', 'rules_version', 'score_model_version'].every(key => typeof context[key] === 'string' && context[key].length > 0) ||
          !['normal', 'pairs'].includes(clean.shape) || !Number.isInteger(clean.round_no) || clean.round_no < 1 || clean.round_no > 6 ||
          !Number.isSafeInteger(clean.round_score) || clean.round_score < 0 || !Number.isSafeInteger(clean.target_score) || clean.target_score <= 0 ||
          typeof clean.passed !== 'boolean' || !['complete', 'partial'].includes(clean.record_quality) ||
          !Array.isArray(clean.credited_pattern_ids) || clean.credited_pattern_ids.length > 64 ||
          !clean.credited_pattern_ids.every(id => typeof id === 'string' && /^[a-z0-9_:.\-]{1,80}$/.test(id))) return null;
      clean.credited_pattern_ids = [...new Set(clean.credited_pattern_ids)];
    } else {
      const short = value => typeof value === 'string' && /^[A-Za-z0-9_.:-]{1,64}$/.test(value);
      const optional = value => value === null || short(value);
      if (name === 'session_started' && (!['game', 'stats', 'debug'].includes(clean.entry) || !['compact', 'wide'].includes(clean.viewport) || typeof clean.has_save !== 'boolean')) return null;
      if (name === 'screen_viewed' && (!short(clean.screen) || !optional(clean.previous_screen) || !['load', 'navigation'].includes(clean.reason))) return null;
      if (name === 'ui_action' && (!short(clean.action) || !optional(clean.target_id) || !['pointer', 'keyboard', 'programmatic'].includes(clean.input_method) || !['applied', 'rejected', 'noop', 'blocked'].includes(clean.outcome) || !optional(clean.reason_code))) return null;
      if (name === 'client_error' && (!short(clean.code) || !optional(clean.screen) || !['storage', 'network', 'runtime', 'resource'].includes(clean.category))) return null;
    }
    return clean;
  }

  function changeConsent(allowed, persistPreference = true) {
    if (disposed) return Promise.resolve(getStatus());
    if (allowed && consent === 'allowed' && coordination !== 'blocked') return stateReady.then(getStatus);
    if (!allowed && consent === 'denied') return stateReady.then(getStatus);
    epoch++;
    const generation = epoch;
    consent = allowed ? 'allowed' : 'denied';
    stopTimer();
    controller?.abort();
    retryAt = 0; failureCount = 0; lastError = null; lastAck = null; deliveryPaused = false;
    if (persistPreference) preference(consent);
    if (!allowed) {
      // Synchronous cancellation precedes any outstanding disk or network work.
      state = { credentials: null, session: null, events: [] };
      try { channel?.postMessage({ consent: 'denied' }); } catch {}
      emit();
      stateReady = exclusive(async () => {
        try { await clearStore(); storageFault = null; storageMode = 'persistent'; } catch { pauseStorage('load'); lastError = 'storage_clear_failed'; }
        unlock();
        emit();
      });
      return stateReady.then(getStatus);
    }
    stateReady = exclusive(async () => {
      if (!await takeLock(generation) || !active(generation)) { emit(); return; }
      let saved;
      if (coordination !== 'isolated_memory') {
        try { saved = await store.load(); storageFault = null; storageMode = 'persistent'; } catch { pauseStorage('load'); }
      }
      if (!active(generation)) return;
      if (savedState(saved)) state = savedState(saved);
      ensureSession(); prune(); await save(generation); emit(); schedule();
    });
    emit();
    return stateReady.then(getStatus);
  }
  function setConsent(allowed) { return changeConsent(allowed); }

  async function track(name, payload = {}, context = {}) {
    const generation = epoch;
    if (!active(generation)) return { queued: false, reason: 'consent_required' };
    await stateReady;
    return exclusive(async () => {
      if (!active(generation)) return { queued: false, reason: 'consent_required' };
      if (coordination === 'blocked') return { queued: false, reason: 'collector_busy' };
      let clean;
      try { clean = validIdentity(context) && validPayload(name, payload, context); } catch { clean = null; }
      if (!clean) return { queued: false, reason: 'invalid_event' };
      let event;
      try { event = envelope(name, clone(clean), context); } catch { return { queued: false, reason: 'invalid_event' }; }
      if (bytes(event) > 8192) return { queued: false, reason: 'event_too_large' };
      const existing = state.events.find(item => item.event_id === event.event_id);
      if (existing) {
        const semanticFields = ['event_name', 'app_release', 'rules_version', 'score_model_version', 'mode', 'run_id', 'round_attempt_id', 'hand_id', 'payload'];
        if (semanticFields.some(key => canonical(existing[key]) !== canonical(event[key])) ||
            (context.occurred_at !== undefined && Date.parse(existing.occurred_at) !== Date.parse(event.occurred_at))) {
          return { queued: false, reason: 'event_id_conflict' };
        }
        await save(generation); emit();
        return active(generation) ? { queued: true, event_id: existing.event_id, durable: storageMode === 'persistent' && !storageFault, duplicate: true } : { queued: false, reason: 'consent_required' };
      }
      ensureSession();
      event.session_id = state.session.id;
      state.events.push(event); prune(); await save(generation); emit(); schedule(state.events.length >= 20 ? 0 : 5000);
      if (!active(generation)) return { queued: false, reason: 'consent_required' };
      if (!state.events.some(item => item.event_id === event.event_id)) return { queued: false, reason: 'queue_limit' };
      return { queued: true, event_id: event.event_id, durable: storageMode === 'persistent' && !storageFault };
    });
  }

  function fail(code, retryAfter = 0) {
    lastError = code;
    if (/http_4\d\d$/.test(code) && !code.endsWith('_429') && !code.endsWith('_408')) {
      deliveryPaused = true; retryAt = 0; return;
    }
    failureCount++;
    retryAt = now() + Math.max(retryAfter, Math.min(60000, 1000 * (2 ** Math.min(failureCount - 1, 6))));
  }
  async function request(url, init, generation) {
    if (!active(generation)) throw new Error('cancelled');
    controller = new AbortController();
    const signal = controller.signal;
    let timeout;
    const expired = new Promise((resolve, reject) => {
      timeout = defer(() => { controller?.abort(); reject(new Error('request_timeout')); }, options.requestTimeoutMs ?? 10000);
      timeout?.unref?.();
    });
    try { return await Promise.race([fetcher(url, { ...init, signal, credentials: 'same-origin' }), expired]); }
    finally { cancel(timeout); }
  }
  function pauseRenewal(code) {
    lastError = code; deliveryPaused = true; retryAt = 0;
  }
  async function renewCredentials(generation, original) {
    try {
      const response = await request(renewEndpoint, {
        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${original.write_token}` }, body: '{}',
      }, generation);
      if (!active(generation)) return false;
      if (!response.ok) { pauseRenewal(`renewal_http_${response.status}`); return false; }
      const renewed = await response.json();
      if (!active(generation)) return false;
      if (renewed.client_id !== original.client_id || renewed.write_token !== original.write_token ||
          typeof renewed.expires_at !== 'string' || !Number.isFinite(Date.parse(renewed.expires_at))) {
        pauseRenewal('invalid_renewal'); return false;
      }
      return await exclusive(async () => {
        if (!active(generation)) return false;
        state.credentials = { ...original, expires_at: renewed.expires_at };
        return save(generation);
      });
    } catch {
      if (active(generation)) pauseRenewal('renewal_unavailable');
      return false;
    }
  }
  async function send(generation, automatic) {
    await stateReady;
    if (!active(generation)) return getStatus();
    if (storageFault) {
      if (automatic || !await exclusive(() => recoverStorage(generation))) return getStatus();
    }
    if (deliveryPaused && !automatic && (lastError === 'events_http_401' || lastError === 'invalid_renewal' || lastError?.startsWith('renewal_'))) {
      deliveryPaused = false;
    }
    if (!active(generation) || deliveryPaused || !state.events.length || now() < retryAt) return getStatus();
    const persisted = await exclusive(async () => {
      if (!active(generation)) return false;
      prune(); return save(generation);
    });
    if (!persisted || !active(generation) || !state.events.length) return getStatus();
    sending = true; stopTimer(); emit();
    try {
      if (!fetcher) throw new Error('network_unavailable');
      if (!state.credentials) {
        const response = await request(registerEndpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }, generation);
        if (!active(generation)) return getStatus();
        if (!response.ok) { fail(`registration_http_${response.status}`, retryDelay(response)); return getStatus(); }
        const credentials = await response.json();
        if (!active(generation)) return getStatus();
        if (typeof credentials.client_id !== 'string' || typeof credentials.write_token !== 'string') throw new Error('invalid_registration');
        const registered = await exclusive(async () => {
          if (!active(generation)) return false;
          state.credentials = credentials; return save(generation);
        });
        if (!registered) return getStatus();
      }
      if (!active(generation)) return getStatus();
      const batch = [];
      for (const event of state.events.slice(0, 20)) {
        if (bytes({ events: [...batch, event] }) > 32768) break;
        batch.push(event);
      }
      if (!batch.length) return getStatus();
      const originalCredentials = { ...state.credentials };
      const batchRequest = {
        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${state.credentials.write_token}` },
        body: JSON.stringify({ events: batch }), keepalive: true,
      };
      let response = await request(eventsEndpoint, batchRequest, generation);
      if (!active(generation)) return getStatus();
      if (response.status === 401) {
        if (!await renewCredentials(generation, originalCredentials)) return getStatus();
        if (!active(generation)) return getStatus();
        response = await request(eventsEndpoint, batchRequest, generation);
      }
      if (!active(generation)) return getStatus();
      if (!response.ok) { fail(`events_http_${response.status}`, retryDelay(response)); return getStatus(); }
      const ack = await response.json();
      if (!active(generation)) return getStatus();
      if (!Array.isArray(ack.accepted) || !Array.isArray(ack.duplicate) || !Array.isArray(ack.rejected)) throw new Error('invalid_ack');
      const sent = new Set(batch.map(event => event.event_id));
      const acknowledged = new Set([...ack.accepted, ...ack.duplicate].filter(id => sent.has(id)));
      const rejectedIDs = new Set(ack.rejected.filter(item => item && sent.has(item.event_id) && typeof item.reason === 'string').map(item => item.event_id));
      if (!acknowledged.size && !rejectedIDs.size) throw new Error('empty_ack');
      await exclusive(async () => {
        if (!active(generation)) return;
        state.events = state.events.filter(event => !acknowledged.has(event.event_id) && !rejectedIDs.has(event.event_id));
        rejected += rejectedIDs.size;
        lastAck = {
          accepted: ack.accepted.filter(id => sent.has(id)), duplicate: ack.duplicate.filter(id => sent.has(id)),
          rejected: ack.rejected.filter(item => rejectedIDs.has(item?.event_id)).map(item => ({ event_id: item.event_id, reason: item.reason.slice(0, 120) })),
        };
        lastSentAt = new Date(now()).toISOString();
        lastError = rejectedIDs.size ? 'events_rejected' : null;
        retryAt = 0; failureCount = 0;
        await save(generation);
      });
    } catch (error) {
      if (active(generation)) fail(['invalid_ack', 'empty_ack', 'invalid_registration'].includes(error?.message) ? error.message : 'network_unavailable');
    } finally {
      sending = false; controller = null; emit();
      if (active(generation)) schedule(retryAt > now() ? retryAt - now() : 100);
    }
    return getStatus();
  }
  function retryDelay(response) {
    const raw = response.headers?.get?.('Retry-After');
    if (!raw) return 0;
    const numeric = Number(raw);
    return Number.isFinite(numeric) ? Math.min(Math.max(0, numeric * 1000), 3600000) : Math.min(Math.max(0, Date.parse(raw) - now()) || 0, 3600000);
  }
  function flushInternal(automatic) {
    if (flushPromise) return flushPromise;
    const generation = epoch;
    flushPromise = send(generation, automatic).finally(() => {
      flushPromise = null;
      if (consent === 'allowed' && state.events.length) schedule(retryAt > now() ? retryAt - now() : 100);
    });
    return flushPromise;
  }
  function flush() { return flushInternal(false); }
  function dispose() {
    disposed = true; epoch++; stopTimer(); controller?.abort(); listeners.clear();
    globalThis.removeEventListener?.('storage', storageChanged);
    channel?.close();
    void serial.finally(unlock);
  }
  function storageChanged(event) { if (event.key === `${namespace}:consent` && event.newValue === 'denied') void setConsent(false); }
  globalThis.addEventListener?.('storage', storageChanged);
  if (channel) channel.onmessage = event => { if (event.data?.consent === 'denied') void setConsent(false); };
  let remembered, preferenceReadable = false;
  try {
    if (prefs) { remembered = prefs.getItem(`${namespace}:consent`); preferenceReadable = true; }
  } catch { lastError = 'preference_storage_unavailable'; }
  if (!preferenceReadable && scope === 'production' && options.defaultEnabled === true) lastError = 'preference_storage_unavailable';
  // Defaults apply only to an absent, readable preference in the real game.
  // Restoring or applying a default must not overwrite another tab's opt-out.
  if (remembered === 'allowed' || (scope === 'production' && options.defaultEnabled === true && preferenceReadable && remembered == null)) changeConsent(true, false);
  else if (remembered === 'denied') consent = 'denied';
  return { setConsent, getStatus, track, flush, dispose,
    get ready() { return stateReady; },
    subscribe(listener) { listeners.add(listener); listener(getStatus()); return () => listeners.delete(listener); },
  };
}
