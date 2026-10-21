import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { handleAnalytics } from '../server/analytics.js';
import { PATTERN_CATALOG } from '../server/catalog.js';
import { GAME_RULES_VERSION, GAME_SCORE_MODEL_VERSION, GAME_PATTERN_CATALOG, V2_PATTERN_CATALOG, GAME_VERSION_PAIRS, gamePatternCatalog, patternIdForName, relicIdsForVersion, isSupportedGameVersion, validateGamePayload } from '../dist/analytics/game-schema.js';
import { makeFixture } from '../dist/analytics/report.js';

// Exercises the same migration SQL deployed to D1, with real SQLite constraints
// and transactional D1.batch semantics; no canned query results.
function database() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec('PRAGMA foreign_keys=ON');
  const path = fileURLToPath(new URL('../drizzle/', import.meta.url));
  for (const file of readdirSync(path).filter(file => file.endsWith('.sql')).sort()) sqlite.exec(readFileSync(`${path}/${file}`, 'utf8'));
  const prepared = (sql, bindings = []) => ({
    bind: (...values) => prepared(sql, values),
    first: async () => sqlite.prepare(sql).get(...bindings) ?? null,
    all: async () => ({ results: sqlite.prepare(sql).all(...bindings) }),
    run: async () => ({ meta: sqlite.prepare(sql).run(...bindings) }),
    execute: () => {
      if (/^\s*SELECT\b/i.test(sql)) return { results: sqlite.prepare(sql).all(...bindings), meta: { changes: 0 } };
      return { results: [], meta: sqlite.prepare(sql).run(...bindings) };
    },
  });
  return { sqlite, prepare: prepared, batch: async statements => {
    sqlite.exec('BEGIN');
    try { const results = statements.map(statement => statement.execute()); sqlite.exec('COMMIT'); return results; }
    catch (error) { sqlite.exec('ROLLBACK'); throw error; }
  } };
}
const BASE = 'https://mahjong.example';
function request(path, { method = 'GET', body, token, headers = {} } = {}) {
  return new Request(`${BASE}${path}`, { method, headers: { ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}), ...headers }, ...(body !== undefined ? { body: typeof body === 'string' ? body : JSON.stringify(body) } : {}) });
}
async function fixture(t, scope = 'production') {
  const DB = database(); t.after(() => DB.sqlite.close());
  const env = { DB };
  const endpoint = scope === 'sandbox' ? '/api/analytics/test/events' : '/api/events';
  const regPath = scope === 'sandbox' ? '/api/analytics/test/register' : '/api/analytics/register';
  const registration = await handleAnalytics(request(regPath, { method: 'POST', body: {} }), env);
  assert.equal(registration.status, 201);
  const credentials = await registration.json();
  const send = async (events, options = {}) => {
    const response = await handleAnalytics(request(options.endpoint || endpoint, { method: 'POST', body: { events }, token: credentials.write_token, ...options }), env);
    return { status: response.status, body: await response.json() };
  };
  const report = async (query = '') => {
    const legacy = /(?:rules_version|score_model_version)=/.test(query) ? '' : '&rules_version=split_legacy_v1&score_model_version=rogue_legacy_v1';
    const response = await handleAnalytics(request(`/api/reports/patterns?scope=${scope}&${query}${legacy}`), env);
    assert.equal(response.status, 200); return response.json();
  };
  return { DB, env, credentials, send, report };
}
function hand(overrides = {}) {
  const nonce = crypto.randomUUID();
  const { payload, ...envelope } = overrides;
  return { schema_version: 1, event_id: crypto.randomUUID(), event_name: 'hand_completed', occurred_at: new Date().toISOString(), session_id: 'session-test-001', app_release: 'test_release', rules_version: 'split_legacy_v1', score_model_version: 'rogue_legacy_v1', mode: 'mcr', run_id: 'run-test-001', round_attempt_id: `round-${nonce}`, hand_id: `hand-${nonce}`, ...envelope, payload: { shape: 'normal', round_no: 1, round_score: 1000, target_score: 100, passed: true, credited_pattern_ids: ['mcr.full_flush'], record_quality: 'complete', ...payload } };
}
const row = (report, id) => report.patterns.find(pattern => pattern.pattern_id === id);
const tableCount = (DB, table) => DB.sqlite.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n;

test('catalog retains stable legacy parent patterns and includes v2 unlock metadata', () => {
  for (const mode of ['mcr', 'riichi']) {
    const actual = PATTERN_CATALOG.filter(pattern => pattern.mode === mode);
    assert.equal(actual.length, mode === 'mcr' ? 19 : 12);
    assert.equal(new Set(actual.map(p => p.pattern_id)).size, actual.length);
    assert.ok(actual.every(pattern => pattern.routes.length > 0));
  }
  assert.equal(V2_PATTERN_CATALOG.filter(p => p.kind === 'unlock').length, 4);
});

test('empty reports show zero counts, null rates and no invented high score', async t => {
  const f = await fixture(t);
  const r = await f.report('mode=mcr');
  assert.equal(r.patterns.length, 19);
  assert.equal(r.summary.completed_hands, 0);
  assert.equal(r.summary.max_round_score, null);
  assert.ok(r.patterns.every(pattern => pattern.count === 0 && pattern.denominator === 0 && pattern.rate === null && pattern.max_round_score === null));
  assert.equal(r.collection_status, 'legacy');
});

test('real stored facts count once, allow overlapping patterns, include below-target and exclude partial', async t => {
  const f = await fixture(t);
  const events = [
    hand({ payload: { shape: 'pairs', round_score: 1800, credited_pattern_ids: ['mcr.full_flush', 'mcr.seven_pairs', 'mcr.seven_pairs'] } }),
    hand({ payload: { round_score: 80, passed: false, credited_pattern_ids: [] } }),
    hand({ payload: { round_score: 2200 } }),
    hand({ payload: { shape: 'pairs', round_score: 9999, record_quality: 'partial', credited_pattern_ids: ['mcr.full_flush', 'mcr.seven_pairs'] } }),
  ];
  assert.equal((await f.send(events)).body.accepted.length, 4);
  const r = await f.report('mode=mcr');
  assert.equal(r.summary.completed_hands, 3);
  assert.equal(r.summary.pattern_occurrences, 3);
  assert.equal(r.summary.max_round_score, 2200);
  assert.deepEqual([row(r, 'mcr.full_flush').count, row(r, 'mcr.full_flush').denominator, row(r, 'mcr.full_flush').rate, row(r, 'mcr.full_flush').max_round_score], [2, 3, 2 / 3, 2200]);
  assert.deepEqual([row(r, 'mcr.seven_pairs').count, row(r, 'mcr.seven_pairs').denominator, row(r, 'mcr.seven_pairs').rate, row(r, 'mcr.seven_pairs').max_round_score], [1, 1, 1, 1800]);
  assert.equal(row(r, 'mcr.all_pungs').denominator, 2);
  assert.equal(tableCount(f.DB, 'completed_hands'), 4);
  assert.equal(tableCount(f.DB, 'hand_patterns'), 5);
});

test('same event retries and new events for the same hand cannot double count', async t => {
  const f = await fixture(t);
  const event = hand();
  assert.deepEqual((await f.send([event])).body.accepted, [event.event_id]);
  assert.deepEqual((await f.send([event])).body.duplicate, [event.event_id]);
  const alias = { ...event, event_id: crypto.randomUUID(), occurred_at: new Date(Date.now() + 1).toISOString() };
  assert.deepEqual((await f.send([alias])).body.duplicate, [alias.event_id]);
  assert.equal(tableCount(f.DB, 'completed_hands'), 1);
  assert.equal(tableCount(f.DB, 'hand_patterns'), 1);
  assert.equal(tableCount(f.DB, 'raw_events'), 2, 'new event IDs are retained for conflict detection, but never become a second hand');
  assert.equal((await f.report()).summary.completed_hands, 1);
});

test('event reuse, changed hand facts and second hand IDs for one round reject without overwriting', async t => {
  const f = await fixture(t);
  const event = hand(); await f.send([event]);
  const changed = { ...event, payload: { ...event.payload, round_score: 9999 } };
  assert.equal((await f.send([changed])).body.rejected[0].reason, 'event_id_conflict');
  const newEvent = { ...changed, event_id: crypto.randomUUID() };
  assert.equal((await f.send([newEvent])).body.rejected[0].reason, 'hand_conflict');
  const aliasHand = { ...event, event_id: crypto.randomUUID(), hand_id: crypto.randomUUID() };
  assert.equal((await f.send([aliasHand])).body.rejected[0].reason, 'hand_conflict');
  assert.equal(tableCount(f.DB, 'raw_events'), 1);
  assert.equal((await f.report()).summary.max_round_score, 1000);
});

test('pattern insertion failure rolls back raw event and hand; retry later succeeds', async t => {
  const f = await fixture(t);
  f.DB.sqlite.exec("CREATE TRIGGER force_failure BEFORE INSERT ON hand_patterns BEGIN SELECT RAISE(ABORT, 'test failure'); END");
  const event = hand();
  const failed = await f.send([event]);
  assert.equal(failed.status, 503);
  assert.deepEqual(failed.body, { error: 'storage_unavailable' });
  assert.equal(tableCount(f.DB, 'raw_events'), 0);
  assert.equal(tableCount(f.DB, 'completed_hands'), 0);
  f.DB.sqlite.exec('DROP TRIGGER force_failure');
  assert.deepEqual((await f.send([event])).body.accepted, [event.event_id]);
});

test('modes, versions and supported-route denominators are isolated', async t => {
  const f = await fixture(t);
  const mcr = hand({ payload: { round_score: 200 } });
  const riichi = hand({ mode: 'riichi', payload: { shape: 'pairs', credited_pattern_ids: ['riichi.seven_pairs'], round_score: 400 } });
  const newer = hand({ rules_version: 'whole_hand_v2', score_model_version: 'rogue_v2', payload: { round_score: 9000 } });
  await f.send([mcr, riichi, newer]);
  const legacy = await f.report('mode=mcr&rules_version=split_legacy_v1&score_model_version=rogue_legacy_v1');
  assert.equal(legacy.summary.completed_hands, 1);
  assert.equal(legacy.summary.max_round_score, 200);
  assert.equal(legacy.versions.length, 2);
  assert.equal(row(legacy, 'mcr.seven_pairs').rate, null);
  const japanese = await f.report('mode=riichi');
  assert.equal(japanese.summary.max_round_score, 400);
  assert.equal(row(japanese, 'riichi.seven_pairs').rate, 1);
  assert.equal(row(japanese, 'riichi.all_pungs').denominator, 0);
  const latest = await f.report('mode=mcr&rules_version=whole_hand_v2');
  assert.equal(latest.score_model_version, 'rogue_v2');
  assert.equal(latest.summary.completed_hands, 1);
  const current = await handleAnalytics(request('/api/reports/patterns?mode=mcr'), f.env);
  assert.equal((await current.json()).rules_version, GAME_RULES_VERSION);
});

test('registration stores only credential hashes; scope cannot be spoofed; private reads do not exist', async t => {
  const f = await fixture(t, 'sandbox');
  assert.equal(f.credentials.scope, 'sandbox');
  const stored = f.DB.sqlite.prepare('SELECT * FROM analytics_clients').get();
  assert.ok(!JSON.stringify(stored).includes(f.credentials.write_token));
  assert.match(stored.token_hash, /^[a-f0-9]{64}$/);
  assert.equal((await f.send([hand()], { endpoint: '/api/events' })).status, 401);
  const spoof = hand({ scope: 'production', is_test: false });
  assert.equal((await f.send([spoof])).body.rejected.length, 1);
  await f.send([hand()]);
  const production = await handleAnalytics(request('/api/reports/patterns?scope=production&mode=mcr'), f.env);
  assert.equal((await production.json()).summary.completed_hands, 0);
  assert.equal((await handleAnalytics(request('/api/raw-events'), f.env)).status, 404);
  assert.equal((await handleAnalytics(request('/api/events'), f.env)).status, 405);
  assert.equal((await handleAnalytics(request('/api/events', { method: 'POST', body: { events: [hand()] } }), f.env)).status, 401);
  f.DB.sqlite.prepare('UPDATE analytics_clients SET expires_at = ?').run('2000-01-01T00:00:00.000Z');
  assert.equal((await f.send([hand()])).status, 401);
});

test('expired write leases renew the same identity and preserve event deduplication', async t => {
  const f = await fixture(t);
  const event = hand();
  await f.send([event]);
  f.DB.sqlite.prepare('UPDATE analytics_clients SET expires_at = ?').run('2000-01-01T00:00:00.000Z');
  assert.equal((await f.send([event])).status, 401);
  const renewal = await handleAnalytics(request('/api/analytics/renew', { method: 'POST', body: {}, token: f.credentials.write_token }), f.env);
  assert.equal(renewal.status, 200);
  const credentials = await renewal.json();
  assert.equal(credentials.client_id, f.credentials.client_id);
  assert.equal(credentials.write_token, f.credentials.write_token);
  assert.equal(credentials.scope, 'production');
  assert.ok(Date.parse(credentials.expires_at) > Date.now() + 89 * 86400_000);
  assert.deepEqual((await f.send([event])).body.duplicate, [event.event_id]);
  assert.equal(tableCount(f.DB, 'analytics_clients'), 1);
  assert.equal(tableCount(f.DB, 'completed_hands'), 1);
  const retry = await handleAnalytics(request('/api/analytics/renew', { method: 'POST', body: {}, token: f.credentials.write_token }), f.env);
  assert.equal((await retry.json()).write_token, f.credentials.write_token);
  const wrongScope = await handleAnalytics(request('/api/analytics/test/renew', { method: 'POST', body: {}, token: f.credentials.write_token }), f.env);
  assert.equal(wrongScope.status, 401);
  const unknown = await handleAnalytics(request('/api/analytics/renew', { method: 'POST', body: {}, token: `at_${'a'.repeat(64)}` }), f.env);
  assert.equal(unknown.status, 401);
  const claim = await handleAnalytics(request('/api/analytics/renew', { method: 'POST', body: { client_id: f.credentials.client_id }, token: f.credentials.write_token }), f.env);
  assert.equal(claim.status, 400);
  const external = await handleAnalytics(request('/api/analytics/renew', { method: 'POST', body: {}, token: f.credentials.write_token, headers: { Origin: 'https://evil.example' } }), f.env);
  assert.equal(external.status, 403);
});

test('malformed envelopes and impossible payloads are rejected individually with valid neighbors accepted', async t => {
  const f = await fixture(t);
  const invalid = [
    hand({ event_id: 12345678 }), hand({ session_id: 12345678 }),
    hand({ mode: 'other' }), hand({ occurred_at: 'yesterday' }), hand({ occurred_at: '2000-01-01T00:00:00.000Z' }),
    hand({ payload: { round_score: -1 } }), hand({ payload: { round_score: 0.5 } }), hand({ payload: { target_score: 0 } }),
    hand({ payload: { passed: false } }), hand({ payload: { credited_pattern_ids: ['mcr.nonexistent'] } }),
    hand({ payload: { credited_pattern_ids: ['riichi.full_flush'] } }), hand({ payload: { credited_pattern_ids: ['mcr.seven_pairs'] } }),
    hand({ hand_id: null }), hand({ payload: { secret: 'do not retain' } }),
  ];
  const valid = hand();
  const result = await f.send([...invalid, valid]);
  assert.equal(result.status, 200);
  assert.deepEqual(result.body.accepted, [valid.event_id]);
  assert.equal(result.body.rejected.length, invalid.length);
  assert.equal(tableCount(f.DB, 'raw_events'), 1);
});

test('actual body byte limits, content type, origin and batch boundaries are enforced', async t => {
  const f = await fixture(t);
  const oversized = JSON.stringify({ events: [hand()], padding: 'x'.repeat(33 * 1024) });
  assert.equal((await f.send([], { body: oversized })).status, 413);
  assert.equal((await f.send([], { body: '{broken' })).status, 400);
  assert.equal((await f.send([], { headers: { 'Content-Type': 'text/plain' } })).status, 415);
  assert.equal((await f.send([hand()], { headers: { Origin: 'https://evil.example' } })).status, 403);
  assert.equal((await f.send([hand()], { headers: { 'Sec-Fetch-Site': 'same-site' } })).status, 403);
  assert.equal((await f.send([hand()], { headers: { Origin: BASE, 'Sec-Fetch-Site': 'same-origin' } })).status, 200);
  assert.equal((await f.send([])).status, 400);
  assert.equal((await f.send(Array.from({ length: 21 }, () => hand()))).status, 400);
  const hugeEvent = hand({ payload: { extra: 'x'.repeat(8192) } });
  assert.equal((await f.send([hugeEvent])).body.rejected[0].reason, 'invalid_event_or_size');
  assert.equal((await handleAnalytics(request('/api/reports/patterns?mode=bad'), f.env)).status, 400);
});

test('quota is persisted and enforced atomically across requests', async t => {
  const f = await fixture(t);
  const window = Math.floor(Date.now() / 60_000);
  f.DB.sqlite.prepare('UPDATE analytics_clients SET quota_window = ?, quota_count = 299').run(window);
  assert.equal((await f.send([hand()])).status, 200);
  assert.equal((await f.send([hand()])).status, 429);
  assert.equal(tableCount(f.DB, 'completed_hands'), 1);
  f.DB.sqlite.prepare('UPDATE analytics_clients SET quota_window = ?').run(window - 1);
  assert.equal((await f.send([hand()])).status, 200);
});

test('generic events persist without contributing to pattern facts and sanitize errors', async t => {
  const f = await fixture(t);
  const base = hand({ mode: null, run_id: null, round_attempt_id: null, hand_id: null });
  const events = [
    { ...base, event_id: crypto.randomUUID(), event_name: 'session_started', payload: { entry: 'game', viewport: 'wide', has_save: false } },
    { ...base, event_id: crypto.randomUUID(), event_name: 'screen_viewed', payload: { screen: 'home', previous_screen: null, reason: 'load' } },
    { ...base, event_id: crypto.randomUUID(), event_name: 'ui_action', payload: { action: 'stats.open', target_id: 'stats-link', input_method: 'pointer', outcome: 'applied', reason_code: null } },
    { ...base, event_id: crypto.randomUUID(), event_name: 'client_error', payload: { code: 'storage.unavailable', screen: null, category: 'storage' } },
  ];
  assert.equal((await f.send(events)).body.accepted.length, 4);
  assert.equal(tableCount(f.DB, 'raw_events'), 4);
  assert.equal((await f.report()).summary.completed_hands, 0);
  const leaked = { ...events[3], event_id: crypto.randomUUID(), payload: { ...events[3].payload, stack: 'secret/url' } };
  assert.equal((await f.send([leaked])).body.rejected.length, 1);
  assert.equal(await handleAnalytics(request('/game'), f.env), null);
  assert.equal((await handleAnalytics(request('/api/health'), f.env)).status, 200);
});

function gameEvents(mode = 'mcr') {
  return makeFixture(mode).map(({ event_name, payload, context }) => ({
    schema_version: 1, event_id: crypto.randomUUID(), event_name, occurred_at: new Date().toISOString(), session_id: 'session-v2-001', ...context, rules_version: 'free_play_v2', score_model_version: 'cumulative_v2', payload,
  }));
}
function scoreParts(event, { start = 0, process = 0, win = 1000, penalty = 0, target = 100 } = {}) {
  Object.assign(event.payload, { round_start_score: start, process_score: process, win_score: win, penalty_score: penalty, score_delta: win - penalty, round_score: process + win - penalty, cumulative_before: start + process, cumulative_after: start + process + win - penalty, target_score: target, passed: start + process + win - penalty >= target });
  return event;
}
function kongEvent(kongCount) {
  const event = structuredClone(gameEvents()[2]); // legal normal hand
  event.event_id = crypto.randomUUID();
  event.hand_id = event.payload.settlement_id = crypto.randomUUID();
  event.round_attempt_id = crypto.randomUUID();
  const groups = [], tiles = [], declared = [];
  for (let i = 0; i < 4; i++) {
    const type = i < kongCount ? 'kong' : 'pung', ids = [];
    for (let j = 0; j < (type === 'kong' ? 4 : 3); j++) {
      const id = `tile-${i}-${j}`; ids.push(id);
      tiles.push({ id, original: i, face: i, effective_face: i, wild: false });
    }
    groups.push({ type, tile_ids: ids });
    if (type === 'kong') declared.push({ id: `kong-${i}`, tile_ids: ids, face: i });
  }
  for (let j = 0; j < 2; j++) tiles.push({ id: `pair-${j}`, original: 6, face: 6, effective_face: 6, wild: false });
  groups.push({ type: 'pair', tile_ids: ['pair-0', 'pair-1'] });
  Object.assign(event.payload, { shape: 'normal', tiles, declared_kongs: declared, decomposition: { groups }, credited_pattern_ids: ['mcr.full_flush'], unlock_pattern_ids: [], owned_relic_ids: [] });
  return scoreParts(event);
}

test('v2 real report sample separates legal hands, false-win passes and three score records', async t => {
  const f = await fixture(t, 'sandbox');
  const events = gameEvents();
  const result = await f.send(events);
  assert.equal(result.status, 200);
  assert.deepEqual(result.body.rejected, []);
  assert.equal(result.body.accepted.length, 6);
  assert.equal(result.body.duplicate.length, 3);
  const r = await f.report('mode=mcr&rules_version=free_play_v2');
  assert.equal(r.denominator_basis, 'legal_complete_settlements');
  assert.equal(r.summary.completed_hands, 2);
  assert.deepEqual([row(r, 'mcr.full_flush').count, row(r, 'mcr.full_flush').denominator, row(r, 'mcr.full_flush').rate], [1, 2, 0.5]);
  assert.equal(row(r, 'mcr.seven_pairs').denominator, 2, 'normal hands stay in the v2 denominator');
  assert.equal(row(r, 'mcr.all_pungs').denominator, 2, 'pairs hands stay in the v2 denominator');
  assert.deepEqual([r.summary.max_win_score, r.settlements.max_round_score, r.settlements.max_cumulative_score], [1800, 1880, 4900]);
  assert.deepEqual([r.settlements.total, r.settlements.legal, r.settlements.false_win, r.settlements.passed, r.settlements.false_win_passed, r.settlements.pass_rate], [5, 2, 3, 3, 2, 0.6]);
  assert.equal(tableCount(f.DB, 'round_settlements'), 6);
  assert.equal(tableCount(f.DB, 'completed_hands'), 0);
  const negative = f.DB.sqlite.prepare('SELECT round_score, cumulative_after FROM round_settlements WHERE cumulative_after < 0').get();
  assert.deepEqual({ ...negative }, { round_score: -100, cumulative_after: -50 });
  assert.equal((await f.send(events)).body.duplicate.length, 9);
  assert.equal((await f.report('rules_version=free_play_v2')).settlements.total, 5);
});

test('v2 two event types merge in either order and conflicting cross-event evidence rolls back', async t => {
  const f = await fixture(t);
  const [settled, completed] = gameEvents();
  const first = await f.send([completed, settled]);
  assert.deepEqual(first.body.accepted, [completed.event_id]);
  assert.deepEqual(first.body.duplicate, [settled.event_id]);
  const changed = scoreParts({ ...structuredClone(settled), event_id: crypto.randomUUID() }, { process: 80, win: 2500, target: 1000 });
  assert.equal((await f.send([changed])).body.rejected[0].reason, 'settlement_conflict');
  const newIdSameRound = structuredClone(settled);
  newIdSameRound.event_id = crypto.randomUUID(); newIdSameRound.hand_id = newIdSameRound.payload.settlement_id = crypto.randomUUID();
  assert.equal((await f.send([newIdSameRound])).body.rejected[0].reason, 'settlement_conflict');
  assert.equal(tableCount(f.DB, 'raw_events'), 2);
  assert.equal(tableCount(f.DB, 'round_settlements'), 1);
  assert.equal((await f.report('rules_version=free_play_v2')).summary.max_win_score, 1800);
});

test('v2 transaction rolls back partial terminal writes and keeps legacy mode/version isolated', async t => {
  const f = await fixture(t);
  const event = gameEvents()[0];
  f.DB.sqlite.exec("CREATE TRIGGER fail_v2 BEFORE INSERT ON settlement_patterns BEGIN SELECT RAISE(ABORT, 'fault'); END");
  assert.equal((await f.send([event])).status, 503);
  assert.equal(tableCount(f.DB, 'raw_events'), 0);
  assert.equal(tableCount(f.DB, 'round_settlements'), 0);
  f.DB.sqlite.exec('DROP TRIGGER fail_v2');
  await f.send([event, hand({ payload: { round_score: 99999 } }), gameEvents('riichi')[0]]);
  assert.equal((await f.report('rules_version=free_play_v2&mode=mcr')).summary.max_win_score, 1800);
  assert.equal((await f.report('rules_version=free_play_v2&mode=riichi')).summary.completed_hands, 1);
  assert.equal((await f.report()).summary.max_round_score, 99999);
});

test('v2 validates 15/18 physical tiles, declared kongs and rank-preserving wildcard assignments', async t => {
  const f = await fixture(t);
  const one = kongEvent(1), four = kongEvent(4);
  const wild = structuredClone(gameEvents()[0]);
  wild.event_id = crypto.randomUUID(); wild.round_attempt_id = crypto.randomUUID(); wild.hand_id = wild.payload.settlement_id = crypto.randomUUID();
  wild.payload.tiles[0].face = 9; wild.payload.tiles[0].wild = true; // effective 1m, current 1p
  const result = await f.send([one, four, wild]);
  assert.deepEqual(result.body.rejected, []);
  assert.equal(result.body.accepted.length, 3);
  const wrongRank = structuredClone(wild); wrongRank.event_id = crypto.randomUUID(); wrongRank.payload.tiles[0].effective_face = 1;
  assert.equal((await f.send([wrongRank])).body.rejected[0].reason, 'invalid_wild_assignment');
  const splitKong = structuredClone(one); splitKong.event_id = crypto.randomUUID(); splitKong.payload.decomposition.groups[0].type = 'pung';
  assert.equal((await f.send([splitKong])).body.rejected[0].reason, 'invalid_decomposition');
  const missingTile = structuredClone(four); missingTile.event_id = crypto.randomUUID(); missingTile.payload.tiles.pop();
  assert.equal((await f.send([missingTile])).body.rejected[0].reason, 'invalid_physical_tile_count');
});

test('v2 rejects legacy payloads, mismatched versions, false-win hands and inconsistent cumulative arithmetic', async t => {
  const f = await fixture(t);
  const oldPayload = hand({ rules_version: GAME_RULES_VERSION, score_model_version: GAME_SCORE_MODEL_VERSION });
  const wrongVersion = { ...gameEvents()[0], score_model_version: 'rogue_legacy_v1' };
  const falseHand = { ...gameEvents()[4], event_name: 'hand_completed' };
  const wrongTotal = gameEvents()[0]; wrongTotal.payload.cumulative_after++;
  const wrongPassed = gameEvents()[0]; wrongPassed.payload.passed = false;
  const result = await f.send([oldPayload, wrongVersion, falseHand, wrongTotal, wrongPassed]);
  assert.equal(result.body.rejected.length, 5);
  assert.equal(tableCount(f.DB, 'raw_events'), 0);
});

test('v2 actual unlocks require known same-mode patterns and owning their relic', async t => {
  const f = await fixture(t);
  const event = gameEvents('riichi')[0];
  event.payload.unlock_pattern_ids = ['riichi.big_wheel', 'riichi.big_wheel'];
  event.payload.owned_relic_ids = ['wheel'];
  assert.equal((await f.send([event])).body.accepted.length, 1);
  const r = await f.report('rules_version=free_play_v2&mode=riichi');
  assert.equal(row(r, 'riichi.big_wheel').count, 1);
  assert.equal(row(r, 'riichi.big_wheel').kind, 'unlock');
  const missing = structuredClone(event); missing.event_id = crypto.randomUUID(); missing.payload.owned_relic_ids = [];
  assert.equal((await f.send([missing])).body.rejected[0].reason, 'unlock_without_relic');
  const cross = structuredClone(event); cross.event_id = crypto.randomUUID(); cross.payload.unlock_pattern_ids = ['mcr.all_258']; cross.payload.owned_relic_ids = ['jiang'];
  assert.equal((await f.send([cross])).body.rejected[0].reason, 'pattern_mode_mismatch');
});

function gameState() {
  return { phase: 'play', round_no: 1, formed_count: 0, structure_count: 0, kong_count: 0, hand_count: 18, deck_count: 118, discard_count: 0, coins: 8, ink: 4, swaps: 5, total_score: 0, round_score: 0, process_score: 0, round_start_score: 0, target_score: 1000, relic_ids: ['single_seal'], single_count: 0, wild_used: false };
}
function actionEvent() {
  const base = gameEvents()[0];
  const before = gameState();
  return { ...base, event_name: 'game_action', hand_id: null, payload: { action_id: crypto.randomUUID(), action: 'commit', input_method: 'pointer', outcome: 'applied', reason_code: null, before, after: { ...before, formed_count: 1, structure_count: 1, deck_count: 117, total_score: 20, round_score: 20, process_score: 20, single_count: 1 }, selected_tile_ids: ['entity-1'], tile_changes: [['entity-1', 'hand', 'formed', 0, 0, false, false, false, true]], evidence_truncated: false, context: { source_zone: 'hand', transform_kind: null, transform_value: null, relic_id: null } } };
}

test('v2 bounded game actions and lifecycle events never manufacture terminal scores', async t => {
  const f = await fixture(t);
  const action = actionEvent();
  const life = ['run_started', 'run_resumed', 'round_started', 'run_ended'].map(event_name => ({ ...action, event_id: crypto.randomUUID(), event_name, payload: { state: gameState(), record_quality: 'partial', ...(event_name === 'run_resumed' ? { source: 'consent' } : {}), ...(event_name === 'run_ended' ? { reason: 'retired' } : {}) } }));
  const result = await f.send([action, ...life]);
  assert.equal(result.body.accepted.length, 5);
  assert.deepEqual((await f.send([action])).body.duplicate, [action.event_id]);
  const replay = { ...structuredClone(action), event_id: crypto.randomUUID(), payload: { ...structuredClone(action.payload), action: 'settlement_skip', before: action.payload.after, after: action.payload.after, tile_changes: [] } };
  assert.equal((await f.send([replay])).body.accepted.length, 1);
  assert.equal((await f.report('rules_version=free_play_v2')).settlements.total, 0);
  const rejectedMutation = structuredClone(action); rejectedMutation.event_id = crypto.randomUUID(); rejectedMutation.payload.outcome = 'rejected';
  assert.equal((await f.send([rejectedMutation])).body.rejected[0].reason, 'rejected_action_mutates_state');
  assert.equal(tableCount(f.DB, 'round_settlements'), 0);
});

test('v2 largest supported evidence stays under the 8 KiB event ceiling', () => {
  const event = kongEvent(4);
  const replacements = new Map(event.payload.tiles.map((tile, index) => [tile.id, `t${index}`.padEnd(64, 'x')]));
  for (const tile of event.payload.tiles) tile.id = replacements.get(tile.id);
  for (const group of event.payload.decomposition.groups) group.tile_ids = group.tile_ids.map(id => replacements.get(id));
  for (const kong of event.payload.declared_kongs) { kong.id = kong.id.padEnd(64, 'k'); kong.tile_ids = kong.tile_ids.map(id => replacements.get(id)); }
  event.payload.owned_relic_ids = ['jade', 'river', 'stone', 'bamboo', 'mirror', 'seal', 'echo', 'coin', 'ink', 'wind', 'growth', 'pair', 'wheel', 'jiang', 'mountain', 'reserve', 'single_seal', 'kong_cauldron', 'rank_brush', 'suit_ribbon', 'wild_jade'];
  assert.equal(validateGamePayload(event.event_name, event.payload, event).ok, true);
  assert.ok(Buffer.byteLength(JSON.stringify(event)) < 8192, `terminal bytes=${Buffer.byteLength(JSON.stringify(event))}`);
  const action = actionEvent();
  action.payload.selected_tile_ids = Array.from({ length: 18 }, (_, i) => `t${i}`.padEnd(64, 'x'));
  action.payload.tile_changes = Array.from({ length: 36 }, (_, i) => [`t${i}`.padEnd(64, 'x'), 'hand', 'formed', 0, 0, false, false, false, true]);
  assert.equal(validateGamePayload(action.event_name, action.payload, action).ok, true);
  assert.ok(Buffer.byteLength(JSON.stringify(action)) < 8192, `action bytes=${Buffer.byteLength(JSON.stringify(action))}`);
});

test('actual current engine → adapter → SDK → API → SQLite survives lost ACK and preserves one settlement', async t => {
  const [{ createGameAdapter }, { createAnalytics }, engine] = await Promise.all([
    import('../dist/analytics/game-adapter.js'), import('../dist/analytics/client.js'), import('../dist/engine.js'),
  ]);
  const DB = database(); t.after(() => DB.sqlite.close());
  let saved = null, timestamp = Date.now(), dropFirstAck = true;
  const preferences = new Map(), received = [];
  const client = createAnalytics({
    scope: 'sandbox', autoFlush: false, locks: null, appRelease: 'free-play-v2', entry: 'debug', clock: () => timestamp,
    storage: { load: async () => saved && structuredClone(saved), save: async data => { saved = structuredClone(data); }, clear: async () => { saved = null; } },
    preferenceStorage: { getItem: key => preferences.get(key), setItem: (key, value) => preferences.set(key, value) },
    fetch: async (path, init) => {
      const response = await handleAnalytics(new Request(`${BASE}${path}`, init), { DB });
      if (path.endsWith('/events')) {
        received.push(await response.clone().json());
        if (dropFirstAck && response.ok) { dropFirstAck = false; throw new Error('simulated lost acknowledgement'); }
      }
      return response;
    },
  });
  t.after(() => client.dispose());
  await client.setConsent(true);
  const adapter = createGameAdapter({ getClient: () => client });
  const game = engine.newRun('mcr', 1234);
  await adapter.trackGameAction('start', null, game, game);
  async function act(action, operation, context) {
    const before = adapter.captureGameState(game), result = operation();
    const tracked = await adapter.trackGameAction(action, before, game, result, context);
    assert.deepEqual(tracked.invalid ?? [], []);
    return { before, result };
  }
  await act('starter', () => engine.chooseStarter(game, 'single_seal'), { relic_id: 'single_seal' });
  const pool = [...game.hand, ...game.formed, ...game.deck, ...game.discard];
  const faces = [0, 1, 2, 0, 1, 2, 3, 4, 5, 6, 7, 8, 4, 4];
  const chosen = faces.map(face => {
    const index = pool.findIndex(tile => tile.face === face);
    assert.ok(index >= 0); return pool.splice(index, 1)[0];
  });
  const secondBatch = chosen.slice(1, 11);
  game.hand = chosen.slice(0, 12); game.formed = [];
  game.deck = pool.concat(chosen.slice(12).reverse()); game.discard = []; game.kongs = [];
  assert.equal(game.swaps, 7);
  const tileId = chosen[0].id;
  const first = await act('commit', () => engine.commit(game, [tileId]), { selected_tile_ids: [tileId] });
  await adapter.trackGameAction('commit', first.before, game, first.result, { selected_tile_ids: [tileId] });
  assert.equal(game.hand.length, 12);
  assert.equal(game.discard.length, 0);
  assert.ok(secondBatch.every(tile => game.hand.some(candidate => candidate.id === tile.id)), 'unplayed candidates stay in hand');
  await act('commit', () => engine.commit(game, secondBatch.map(tile => tile.id)), { selected_tile_ids: secondBatch.map(tile => tile.id) });
  await act('commit', () => engine.commit(game, chosen.slice(11).map(tile => tile.id)), { selected_tile_ids: chosen.slice(11).map(tile => tile.id) });
  assert.equal(game.hand.length, 12);
  assert.equal(136 - game.deck.length, 26, 'initial 12 plus 14 played tiles were drawn');
  const terminal = await act('settle', () => engine.settle(game));
  assert.equal(terminal.result.legal, true);
  await adapter.trackGameAction('settle', terminal.before, game, terminal.result);
  await act('settlement_skip', () => engine.finishSettlement(game));
  await client.flush(); timestamp += 2100;
  for (let i = 0; i < 8 && client.getStatus().queued; i++) { await client.flush(); timestamp += 2100; }
  assert.equal(client.getStatus().queued, 0);
  assert.equal(client.getStatus().rejected, 0);
  assert.ok(received.some(ack => ack.duplicate.length > 0));
  assert.ok(received.every(ack => ack.rejected.length === 0));
  const r = await (await handleAnalytics(request('/api/reports/patterns?scope=sandbox&mode=mcr'), { DB })).json();
  assert.equal(r.summary.completed_hands, 1);
  assert.equal(r.settlements.total, 1);
  assert.equal(r.summary.max_win_score, terminal.result.total);
  const stored = DB.sqlite.prepare('SELECT process_score, round_score, cumulative_after FROM round_settlements').get();
  assert.equal(stored.process_score, 20);
  assert.equal(stored.round_score, terminal.result.total + 20);
  assert.equal(stored.cumulative_after, game.totalScore);
  const commits = DB.sqlite.prepare("SELECT payload_json FROM raw_events WHERE event_name = 'game_action'").all().map(row => JSON.parse(row.payload_json)).filter(action => action.action === 'commit');
  assert.equal(commits.length, 3, 'duplicate adapter callback did not create another process award event');
  assert.equal(commits.filter(action => action.after.process_score - action.before.process_score === 20).length, 1);
  assert.equal(tableCount(DB, 'round_settlements'), 1);
  assert.equal(tableCount(DB, 'analytics_clients'), 1);
});

test('v2 false-win-only reports retain negative records and have no legal-hand denominator', async t => {
  const f = await fixture(t);
  const event = gameEvents().find(event => event.event_name === 'round_settled' && event.payload.cumulative_after < 0);
  assert.equal((await f.send([event])).body.accepted.length, 1);
  const r = await f.report('rules_version=free_play_v2');
  assert.equal(r.summary.completed_hands, 0);
  assert.equal(r.summary.max_win_score, null);
  assert.ok(r.patterns.every(pattern => pattern.denominator === 0 && pattern.rate === null && pattern.max_win_score === null));
  assert.equal(r.settlements.max_round_score, -100);
  assert.equal(r.settlements.max_cumulative_score, -50);
  assert.equal(r.settlements.pass_rate, 0);
});

function v3Hand(shape = 'normal', mode = 'mcr', options = {}) {
  const event = structuredClone(gameEvents(mode)[0]);
  event.rules_version = 'free_play_v3'; event.score_model_version = 'exponential_v3';
  event.event_id = crypto.randomUUID(); event.round_attempt_id = crypto.randomUUID();
  event.hand_id = event.payload.settlement_id = crypto.randomUUID();
  const knitted = [0, 3, 6, 10, 13, 16, 20, 23, 26];
  let faces, packs, patterns;
  if (shape === 'orphans') {
    faces = [0, 8, 9, 17, 18, 26, 27, 28, 29, 30, 31, 32, 33, 0];
    packs = [['orphans', 14]]; patterns = [`${mode}.thirteen_orphans`];
  } else if (shape === 'knitted') {
    faces = [...knitted, ...Array(options.kong ? 4 : 3).fill(27), 31, 31];
    packs = [['knitted', 9], [options.kong ? 'kong' : 'pung', options.kong ? 4 : 3], ['pair', 2]];
    patterns = ['mcr.knitted_straight'];
  } else if (shape === 'unconnected') {
    faces = options.fullKnitted ? [...knitted, 27, 28, 29, 30, 31] : [...knitted.slice(0, 7), 27, 28, 29, 30, 31, 32, 33];
    packs = [['unconnected', 14]];
    patterns = options.fullKnitted ? ['mcr.lesser_honors_and_knitted_tiles', 'mcr.knitted_straight'] : ['mcr.greater_honors_and_knitted_tiles'];
  } else if (shape === 'pairs') {
    faces = options.fourSame ? [0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5] : [0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6];
    packs = Array.from({ length: 7 }, () => ['pair', 2]); patterns = [`${mode}.seven_pairs`];
  } else {
    faces = [0, 1, 2, 3, 4, 5, 6, 7, 8, 1, 2, 3, 4, 4];
    packs = [['chow', 3], ['chow', 3], ['chow', 3], ['chow', 3], ['pair', 2]]; patterns = [`${mode}.full_flush`];
  }
  const tiles = faces.map((face, i) => ({ id: `v3-tile-${i}`, original: face, face, effective_face: face, wild: false }));
  let offset = 0;
  const groups = packs.map(([type, count]) => { const group = { type, tile_ids: tiles.slice(offset, offset + count).map(tile => tile.id) }; offset += count; return group; });
  const declared = options.kong ? [{ id: 'v3-kong-1', tile_ids: groups.find(group => group.type === 'kong').tile_ids, face: 27 }] : [];
  Object.assign(event.payload, { shape, tiles, decomposition: { groups }, declared_kongs: declared, credited_pattern_ids: patterns, unlock_pattern_ids: [], owned_relic_ids: [] });
  return scoreParts(event, { win: 2000, target: 1000 });
}

test('v3 catalogue mappings preserve old IDs, exclude unavailable patterns and freeze v2 facts', async t => {
  const [{ PATTERN_CATALOG: source }, { V3_UNMAPPED_PATTERNS }] = await Promise.all([import('../dist/pattern-catalog.js'), import('../dist/analytics/game-catalog-v3.js')]);
  assert.deepEqual(V3_UNMAPPED_PATTERNS, []);
  assert.equal(V2_PATTERN_CATALOG.length, 35);
  for (const [mode, rows] of Object.entries(source)) {
    for (const entry of rows) {
      if (entry.status === 'unavailable') continue;
      const id = patternIdForName(mode, entry.name, 'free_play_v3');
      assert.ok(id, `available pattern ${mode}/${entry.name} has a stable analytics ID`);
      if (entry.relicId) assert.ok(relicIdsForVersion('free_play_v3').includes(entry.relicId));
    }
    const catalog = gamePatternCatalog('free_play_v3').filter(pattern => pattern.mode === mode);
    assert.equal(new Set(catalog.map(pattern => pattern.pattern_id)).size, catalog.length);
  }
  assert.equal(patternIdForName('riichi', '役牌 · 白', 'free_play_v3'), 'riichi.dragon_pung');
  assert.equal(patternIdForName('riichi', '役牌 · 發', 'free_play_v3'), 'riichi.dragon_pung');
  assert.equal(patternIdForName('mcr', '箭刻 ×2', 'free_play_v3'), 'mcr.dragon_pung');
  assert.equal(patternIdForName('riichi', '立直', 'free_play_v3'), null);
  assert.equal(patternIdForName('mcr', '十三幺', 'free_play_v2'), null);
  assert.ok(isSupportedGameVersion('free_play_v2', 'cumulative_v2'));
  assert.ok(isSupportedGameVersion('free_play_v3', 'exponential_v3'));
  assert.equal(isSupportedGameVersion('free_play_v3', 'cumulative_v2'), false);
  const f = await fixture(t);
  const queuedV2 = gameEvents()[0], latest = v3Hand('orphans');
  assert.equal((await f.send([queuedV2, latest, hand()])).body.accepted.length, 3);
  assert.equal((await f.send([queuedV2])).body.duplicate.length, 1, 'old v2 outboxes still acknowledge into their original fact table');
  assert.equal((await f.report('rules_version=free_play_v2')).summary.completed_hands, 1);
  assert.equal((await f.report('rules_version=free_play_v3')).summary.completed_hands, 1);
  assert.equal((await f.report()).summary.completed_hands, 1);
  assert.equal(tableCount(f.DB, 'round_settlements'), 2);
  assert.equal(tableCount(f.DB, 'completed_hands'), 1);
});

test('v3 special structures and MCR four-of-a-kind pairs remain version- and mode-specific', async t => {
  const f = await fixture(t);
  const events = [v3Hand('orphans'), v3Hand('orphans', 'riichi'), v3Hand('knitted'), v3Hand('knitted', 'mcr', { kong: true }), v3Hand('unconnected'), v3Hand('unconnected', 'mcr', { fullKnitted: true }), v3Hand('pairs', 'mcr', { fourSame: true })];
  const received = await f.send(events);
  assert.deepEqual(received.body.rejected, []);
  assert.equal(received.body.accepted.length, events.length);
  const bad = [
    { ...v3Hand('orphans'), rules_version: 'free_play_v2', score_model_version: 'cumulative_v2' },
    { ...v3Hand('pairs', 'mcr', { fourSame: true }), rules_version: 'free_play_v2', score_model_version: 'cumulative_v2' },
    v3Hand('pairs', 'riichi', { fourSame: true }), v3Hand('knitted', 'riichi'),
  ];
  const malformed = v3Hand('orphans'); malformed.payload.tiles[0].face = malformed.payload.tiles[0].effective_face = 1; bad.push(malformed);
  const sixSame = v3Hand('pairs', 'mcr', { fourSame: true }); for (const tile of sixSame.payload.tiles.slice(4, 6)) tile.face = tile.effective_face = 0; bad.push(sixSame);
  assert.equal((await f.send(bad)).body.rejected.length, bad.length);
  const snapshot = actionEvent(); snapshot.rules_version = 'free_play_v3'; snapshot.score_model_version = 'exponential_v3';
  assert.equal(validateGamePayload(snapshot.event_name, snapshot.payload, snapshot).ok, false, 'v3 never accepts old 18-tile candidate snapshots');
  snapshot.payload.before.hand_count = snapshot.payload.after.hand_count = 10;
  assert.equal(validateGamePayload(snapshot.event_name, snapshot.payload, snapshot).ok, true);
});

test('v3 persists safe-integer extremes and rejects rounded or overflowing cumulative arithmetic', async t => {
  const f = await fixture(t);
  const max = Number.MAX_SAFE_INTEGER;
  const high = scoreParts(v3Hand(), { win: max, target: max });
  assert.equal((await f.send([high])).body.accepted.length, 1);
  const r = await f.report('rules_version=free_play_v3');
  assert.equal(r.summary.max_win_score, max);
  assert.equal(r.summary.max_round_score, max);
  assert.equal(r.summary.max_cumulative_score, max);
  const negatives = { ...gameEvents()[4], rules_version: 'free_play_v3', score_model_version: 'exponential_v3' };
  scoreParts(negatives, { start: -max + 100, process: 0, win: 0, penalty: 100, target: 1 });
  assert.equal((await f.send([negatives])).body.accepted.length, 1);
  assert.equal(f.DB.sqlite.prepare('SELECT MIN(cumulative_after) AS n FROM round_settlements').get().n, -max);
  const rounded = scoreParts(v3Hand(), { win: max, process: 0, target: 1 });
  rounded.payload.process_score = 1; rounded.payload.cumulative_before = 1; // claimed final=max, true final=max+1
  const overflow = scoreParts(v3Hand(), { win: max, target: 1 }); overflow.payload.win_score = max + 1;
  const oldLimit = { ...scoreParts(v3Hand(), { win: 2 ** 48 }), rules_version: 'free_play_v2', score_model_version: 'cumulative_v2' };
  const rejected = (await f.send([rounded, overflow, oldLimit])).body.rejected;
  assert.equal(rejected.length, 3);
  assert.equal(rejected[0].reason, 'inconsistent_settlement_score');
  assert.equal(rejected[1].reason, 'invalid_settlement_score');
  assert.equal(tableCount(f.DB, 'round_settlements'), 2);
});

test('v4 keeps v3 facts isolated and selects the latest rule for a shared score model', async t => {
  const f = await fixture(t);
  const v3 = v3Hand('knitted');
  await f.send([v3]);
  const scoreOnly = async () => (await (await handleAnalytics(request('/api/reports/patterns?mode=mcr&score_model_version=exponential_v3'), f.env)).json());
  let current = await scoreOnly();
  assert.equal(current.rules_version, 'free_play_v4', 'score-only never silently selects an older rule with more recent data');
  assert.equal(current.summary.completed_hands, 0);
  const v4 = { ...v3Hand('orphans'), rules_version: 'free_play_v4', score_model_version: 'exponential_v3' };
  assert.equal((await f.send([v4])).body.accepted.length, 1);
  assert.equal((await f.send([v3])).body.duplicate.length, 1);
  current = await scoreOnly();
  assert.equal(current.summary.completed_hands, 1);
  assert.equal(row(current, 'mcr.thirteen_orphans').count, 1);
  const previous = await f.report('rules_version=free_play_v3&score_model_version=exponential_v3');
  assert.equal(previous.summary.completed_hands, 1);
  assert.equal(row(previous, 'mcr.knitted_straight').count, 1);
  assert.equal(row(previous, 'mcr.thirteen_orphans').count, 0);
  assert.equal(tableCount(f.DB, 'round_settlements'), 2);
  assert.deepEqual(gamePatternCatalog('free_play_v4'), gamePatternCatalog('free_play_v3'));
  assert.deepEqual(relicIdsForVersion('free_play_v4'), relicIdsForVersion('free_play_v3'));
  assert.equal(patternIdForName('mcr', '十三幺', 'free_play_v4'), 'mcr.thirteen_orphans');
  for (const [rules, model, limit] of [['free_play_v2', 'cumulative_v2', 18], ['free_play_v3', 'exponential_v3', 10], ['free_play_v4', 'exponential_v3', 12]]) {
    const action = actionEvent(); action.rules_version = rules; action.score_model_version = model;
    action.payload.before.hand_count = action.payload.after.hand_count = limit;
    action.payload.before.swaps = action.payload.after.swaps = 7;
    action.payload.before.deck_count = 136 - limit;
    action.payload.after.deck_count = 135 - limit;
    assert.equal(validateGamePayload(action.event_name, action.payload, action).ok, true, rules);
    action.payload.after.hand_count = limit + 1;
    assert.equal(validateGamePayload(action.event_name, action.payload, action).ok, false, `${rules} candidate capacity`);
  }
  const high = scoreParts({ ...v3Hand(), rules_version: 'free_play_v4' }, { win: Number.MAX_SAFE_INTEGER, target: Number.MAX_SAFE_INTEGER });
  assert.equal((await f.send([high])).body.accepted.length, 1);
  assert.equal((await f.report('rules_version=free_play_v4')).summary.max_win_score, Number.MAX_SAFE_INTEGER);
});
