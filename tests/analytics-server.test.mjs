import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { handleAnalytics } from '../server/analytics.js';
import { PATTERN_CATALOG } from '../server/catalog.js';
import { GAME_RULES_VERSION, GAME_SCORE_MODEL_VERSION, V5_RULES_VERSION, V5_SCORE_MODEL_VERSION, V6_RULES_VERSION, V6_SCORE_MODEL_VERSION, V7_RULES_VERSION, V7_SCORE_MODEL_VERSION, V8_RULES_VERSION, V8_SCORE_MODEL_VERSION, V9_RULES_VERSION, V9_SCORE_MODEL_VERSION, V5_CORE_IDS, GAME_PATTERN_CATALOG, V2_PATTERN_CATALOG, GAME_VERSION_PAIRS, gamePatternCatalog, patternIdForName, relicIdsForVersion, isSupportedGameVersion, validateGamePayload } from '../dist/analytics/game-schema.js';
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
  // Historical envelopes are independent of the report page's current fixture.
  // V2 allowed a complete no-pattern hand and had process awards; V9 does not.
  const samples = [
    ['pairs', 0, 80, 1800, 'complete'], ['normal', 0, 0, 80, 'complete'],
    [null, 5000, 0, 0, 'complete'], [null, 50, 0, 0, 'complete'],
    [null, 1100, 0, 0, 'complete'], ['pairs', 0, 0, 9999, 'partial'],
  ];
  return samples.flatMap(([shape, start, process, win, record_quality]) => {
    const legal = shape !== null, settlement_id = crypto.randomUUID();
    const faces = shape === 'pairs' ? [0,0,1,1,2,2,4,4,5,5,7,7,8,8] : legal ? [0,1,2,9,10,11,18,19,20,27,27,27,31,31] : [0,1,3,4,6,7,9,10,12,13,15,16,27,28];
    const tiles = faces.map((face, i) => ({ id: `sample-tile-${i + 1}`, original: face, face, effective_face: face, wild: false }));
    const group = (type, start, count) => ({ type, tile_ids: tiles.slice(start, start + count).map(tile => tile.id) });
    const groups = shape === 'pairs' ? Array.from({ length: 7 }, (_, i) => group('pair', i * 2, 2)) : [group('chow', 0, 3), group('chow', 3, 3), group('chow', 6, 3), group('pung', 9, 3), group('pair', 12, 2)];
    const event = scoreParts({ schema_version: 1, event_id: crypto.randomUUID(), event_name: 'round_settled', occurred_at: new Date().toISOString(), session_id: 'session-v2-001', app_release: 'historical_fixture_v2', mode, run_id: crypto.randomUUID(), round_attempt_id: crypto.randomUUID(), hand_id: settlement_id, rules_version: 'free_play_v2', score_model_version: 'cumulative_v2', payload: {
      settlement_id, round_no: 1, legal, result_type: legal ? 'win' : 'false_win', record_quality,
      shape, tiles, declared_kongs: [], decomposition: legal ? { groups } : null,
      credited_pattern_ids: shape === 'pairs' ? [`${mode}.full_flush`, `${mode}.seven_pairs`] : [], unlock_pattern_ids: [], owned_relic_ids: [],
    } }, { start, process, win, penalty: legal ? 0 : 100, target: 1000 });
    return legal ? [event, { ...structuredClone(event), event_id: crypto.randomUUID(), event_name: 'hand_completed' }] : [event];
  });
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

test('versioned report samples separate legal hands, all terminal outcomes and score records', async t => {
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
  let riichiSamples;
  for (const mode of ['mcr', 'riichi']) {
    const samples = makeFixture(mode).map(({ event_name, payload, context }) => ({ schema_version: 1, event_id: crypto.randomUUID(), event_name, occurred_at: new Date().toISOString(), session_id: 'session-v9-001', ...context, payload }));
    assert.ok(samples.every(event => event.rules_version === V9_RULES_VERSION));
    const ack = await f.send(samples);
    assert.deepEqual(ack.body.rejected, []); assert.equal(ack.body.accepted.length, 6); assert.equal(ack.body.duplicate.length, 3);
    assert.equal((await f.send(samples)).body.duplicate.length, 9);
    const current = await f.report(`mode=${mode}&rules_version=${V9_RULES_VERSION}`);
    assert.equal(current.summary.completed_hands, 2);
    assert.deepEqual([row(current, `${mode}.full_flush`).count, row(current, `${mode}.full_flush`).rate, row(current, `${mode}.full_flush`).denominator], [1, 0.5, 2]);
    assert.ok(current.patterns.every(pattern => pattern.kind === 'base' && pattern.denominator === 2));
    assert.equal(current.summary.max_win_score, mode === 'mcr' ? 1024000 : 768000);
    assert.deepEqual([current.settlements.total, current.settlements.legal, current.settlements.passed, current.settlements.pass_rate], [5, 2, 3, 0.6]);
    assert.deepEqual([current.settlements.false_win, current.settlements.false_win_passed, current.settlements.no_yaku, current.settlements.no_yaku_passed, current.settlements.incomplete, current.settlements.incomplete_passed], mode === 'riichi' ? [1, 1, 1, 1, 1, 0] : [2, 2, 0, 0, 1, 0]);
    if (mode === 'riichi') riichiSamples = samples;
  }
  const noYaku = riichiSamples.find(event => event.payload.result_type === 'no_yaku');
  const incomplete = riichiSamples.find(event => event.payload.result_type === 'incomplete');
  const invalid = [];
  for (const [source, mutate] of [
    [noYaku, event => { event.event_name = 'hand_completed'; }],
    [noYaku, event => { event.payload.legal = true; }],
    [noYaku, event => { event.mode = 'mcr'; }],
    [noYaku, event => { event.payload.decomposition = null; }],
    [noYaku, event => { event.payload.tiles[0].effective_face = null; }],
    [noYaku, event => { event.payload.credited_pattern_ids = ['riichi.full_flush']; }],
    [noYaku, event => { event.payload.decomposition.groups[0].tile_ids[0] = 'absent-tile'; }],
    [noYaku, event => { scoreParts(event, { win: 0, penalty: 1, target: 32000 }); }],
    [incomplete, event => { event.event_name = 'hand_completed'; }],
    [incomplete, event => { event.payload.tiles = structuredClone(noYaku.payload.tiles); }],
    [incomplete, event => { scoreParts(event, { win: 0, penalty: 3199, target: 32000 }); }],
    [incomplete, event => { event.payload.shape = 'normal'; event.payload.decomposition = structuredClone(noYaku.payload.decomposition); }],
    [noYaku, event => { event.rules_version = V8_RULES_VERSION; event.score_model_version = V8_SCORE_MODEL_VERSION; }],
    [incomplete, event => { event.rules_version = V8_RULES_VERSION; event.score_model_version = V8_SCORE_MODEL_VERSION; }],
  ]) { const event = structuredClone(source); event.event_id = crypto.randomUUID(); mutate(event); invalid.push(event); }
  assert.equal((await f.send(invalid)).body.rejected.length, invalid.length);
  const empty = structuredClone(incomplete);
  empty.event_id = crypto.randomUUID(); empty.hand_id = empty.payload.settlement_id = crypto.randomUUID(); empty.round_attempt_id = crypto.randomUUID(); empty.payload.tiles = [];
  scoreParts(empty, { start: 35200, win: 0, penalty: 3200, target: 32000 });
  const partialKongs = kongEvent(4);
  Object.assign(partialKongs, { rules_version: V9_RULES_VERSION, score_model_version: V9_SCORE_MODEL_VERSION });
  Object.assign(partialKongs.payload, { legal: false, result_type: 'incomplete', shape: null, decomposition: null, credited_pattern_ids: [], record_quality: 'partial', owned_relic_ids: ['rank_brush'] });
  partialKongs.payload.tiles.pop(); scoreParts(partialKongs, { win: 0, penalty: 1, target: 1 });
  assert.deepEqual((await f.send([empty, partialKongs])).body.rejected, []);
  const current = await f.report(`mode=riichi&rules_version=${V9_RULES_VERSION}`);
  assert.equal(current.settlements.incomplete_passed, 1, 'exhaustion can pass after the deduction without counting as a legal hand');
  assert.equal(current.summary.completed_hands, 2);
  const conflict = structuredClone(empty); conflict.event_id = crypto.randomUUID();
  scoreParts(conflict, { start: 35201, win: 0, penalty: 3200, target: 32000 });
  assert.equal((await f.send([conflict])).body.rejected[0].reason, 'settlement_conflict');
  assert.equal((await f.report('rules_version=free_play_v2')).settlements.no_yaku, 0, 'new outcome columns do not reinterpret old facts');
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
  assert.equal(engine.VERSION, 9);
  assert.equal(V9_RULES_VERSION, engine.RULES_VERSION.replaceAll('-', '_'));
  assert.equal(V9_SCORE_MODEL_VERSION, engine.SCORE_MODEL_VERSION.replaceAll('-', '_'));
  assert.deepEqual([...relicIdsForVersion(V9_RULES_VERSION)].sort(), engine.RELICS.map(item => item.id).sort());
  assert.deepEqual(engine.RELICS.filter(item => item.core), []);
  const DB = database(); t.after(() => DB.sqlite.close());
  let saved = null, timestamp = Date.now(), dropFirstAck = true;
  const preferences = new Map(), received = [];
  const client = createAnalytics({
    scope: 'sandbox', autoFlush: false, locks: null, appRelease: 'nine-batch-v9', entry: 'debug', clock: () => timestamp,
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
  assert.equal(game.phase, 'prepare');
  assert.equal(game.swaps, 5);
  assert.deepEqual(game.relics, ['rank_brush']);
  // Controlled physical tiles exercise whole-batch refresh and final scoring;
  // all transitions still go through the real engine, adapter and transport.
  const pool = [...game.hand, ...game.formed, ...game.deck, ...game.discard];
  const faces = [1, 1, 2, 0, 1, 2, 3, 4, 5, 6, 7, 8, 4, 4];
  const chosen = faces.map(face => {
    const index = pool.findIndex(tile => tile.face === face);
    assert.ok(index >= 0); return pool.splice(index, 1)[0];
  });
  const replacements = [1, 2].map(face => {
    const index = pool.findIndex(tile => tile.face === face);
    assert.ok(index >= 0); return pool.splice(index, 1)[0];
  });
  const firstBatch = chosen.slice(0, 3), secondBatch = chosen.slice(3, 12);
  game.hand = firstBatch.concat(pool.splice(0, 6)); game.formed = [];
  const thirdCandidates = chosen.slice(12).concat(pool.splice(0, 7));
  const fourthCandidates = replacements.concat(pool.splice(0, 7));
  game.deck = pool.concat([...fourthCandidates].reverse(), [...thirdCandidates].reverse(), [...secondBatch].reverse()); game.discard = []; game.kongs = [];
  const tileId = chosen[0].id;
  assert.equal(game.ink, 2);
  const repair = await act('transform', () => engine.transform(game, [tileId], 'rank', -1), { selected_tile_ids: [tileId], source_zone: 'hand', transform_kind: 'rank', transform_value: -1, relic_id: 'rank_brush' });
  assert.equal(repair.result.ok, true);
  assert.equal(game.ink, 0, 'preparation repair consumes the shared ink allowance');
  await act('begin_play', () => engine.beginPlay(game));
  assert.equal(game.phase, 'play');
  assert.equal(game.swaps, 5, 'begin play preserves the remaining shared exchanges');
  const firstIds = firstBatch.map(tile => tile.id);
  const first = await act('commit', () => engine.commit(game, firstIds), { selected_tile_ids: firstIds });
  const processGain = first.result.processGain;
  assert.equal(processGain, 0);
  await adapter.trackGameAction('commit', first.before, game, first.result, { selected_tile_ids: firstIds });
  assert.equal(game.hand.length, 9);
  assert.equal(game.discard.length, 6);
  assert.ok(secondBatch.every(tile => game.hand.some(candidate => candidate.id === tile.id)), 'the whole next batch replaces unplayed candidates');
  await act('commit', () => engine.commit(game, secondBatch.map(tile => tile.id)), { selected_tile_ids: secondBatch.map(tile => tile.id) });
  await act('commit', () => engine.commit(game, chosen.slice(12).map(tile => tile.id)), { selected_tile_ids: chosen.slice(12).map(tile => tile.id) });
  assert.equal(game.hand.length, 9);
  assert.equal(game.discard.length, 13);
  assert.equal(136 - game.deck.length, 36, 'initial nine and three fresh nine-tile batches were drawn');
  const discardedIds = chosen.slice(1, 3).map(tile => tile.id);
  assert.ok(replacements.every(tile => game.hand.some(candidate => candidate.id === tile.id)));
  const discard = await act('formed_discard', () => engine.discardFormed(game, discardedIds), { selected_tile_ids: discardedIds, source_zone: 'formed' });
  assert.equal(discard.result.ok, true);
  assert.deepEqual(game.formedDiscard, { round: 0, tileIds: discardedIds });
  assert.equal(game.hand.length, 9);
  assert.equal(136 - game.deck.length, 36, 'formed discard does not draw replacements');
  assert.equal(game.processScore, processGain);
  assert.equal(game.ink, 0);
  await adapter.trackGameAction('formed_discard', discard.before, game, discard.result, { selected_tile_ids: discardedIds, source_zone: 'formed' });
  const refused = await act('formed_discard', () => engine.discardFormed(game, discardedIds), { selected_tile_ids: discardedIds, source_zone: 'formed' });
  assert.equal(refused.result.ok, false);
  await act('commit', () => engine.commit(game, replacements.map(tile => tile.id)), { selected_tile_ids: replacements.map(tile => tile.id) });
  const terminal = await act('settle', () => engine.settle(game));
  assert.equal(terminal.result.legal, true);
  assert.deepEqual(terminal.result.gains, []);
  assert.ok(terminal.result.total >= 1000, 'the new fixed-base score is preserved without converting to fan counts');
  await adapter.trackGameAction('settle', terminal.before, game, terminal.result);
  await act('settlement_skip', () => engine.finishSettlement(game));
  await client.flush(); timestamp += 2100;
  for (let i = 0; i < 8 && client.getStatus().queued; i++) { await client.flush(); timestamp += 2100; }
  assert.equal(client.getStatus().queued, 0);
  assert.equal(client.getStatus().rejected, 0);
  assert.ok(received.some(ack => ack.duplicate.length > 0));
  assert.ok(received.every(ack => ack.rejected.length === 0));
  const r = await (await handleAnalytics(request('/api/reports/patterns?scope=sandbox&mode=mcr'), { DB })).json();
  assert.equal(r.rules_version, V9_RULES_VERSION);
  assert.equal(r.score_model_version, V9_SCORE_MODEL_VERSION);
  assert.equal(r.summary.completed_hands, 1);
  assert.equal(r.settlements.total, 1);
  assert.equal(r.summary.max_win_score, terminal.result.total);
  const stored = DB.sqlite.prepare('SELECT process_score, round_score, cumulative_after FROM round_settlements').get();
  assert.equal(stored.process_score, processGain);
  assert.equal(stored.process_score, terminal.result.processScore);
  assert.equal(stored.round_score, terminal.result.total + processGain);
  assert.equal(stored.cumulative_after, game.totalScore);
  const commits = DB.sqlite.prepare("SELECT payload_json FROM raw_events WHERE event_name = 'game_action'").all().map(row => JSON.parse(row.payload_json)).filter(action => action.action === 'commit');
  assert.equal(commits.length, 4, 'duplicate adapter callback did not create another action event');
  assert.ok(commits.every(action => action.after.process_score === 0 && action.before.process_score === 0));
  const discardEvents = DB.sqlite.prepare("SELECT payload_json FROM raw_events WHERE event_name='game_action'").all().map(row => JSON.parse(row.payload_json)).filter(action => action.action === 'formed_discard');
  assert.equal(discardEvents.filter(action => action.outcome === 'applied').length, 1);
  assert.equal(discardEvents.filter(action => action.outcome === 'rejected').length, 1);
  assert.deepEqual(discardEvents[0].after.formed_discard, { round_no: 1, tile_ids: discardedIds });
  const storedTerminal = JSON.parse(DB.sqlite.prepare('SELECT payload_json FROM round_settlements').get().payload_json);
  assert.ok(storedTerminal.tiles.every(tile => !discardedIds.includes(tile.id)), 'discarded entities cannot reappear in the completed hand');
  assert.equal(DB.sqlite.prepare("SELECT COUNT(*) AS n FROM raw_events WHERE event_name='round_started'").get().n, 1, 'begin_play does not start a second observed round');
  assert.ok(DB.sqlite.prepare("SELECT payload_json FROM raw_events WHERE event_name IN ('round_settled','hand_completed')").all().every(row => !Object.hasOwn(JSON.parse(row.payload_json), 'steps')), 'animation steps are not submitted as additional scoring facts');
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
  assert.equal(gamePatternCatalog('free_play_v3').length, 90, 'historical catalogues are frozen independently of the current production catalogue');
  for (const pattern of gamePatternCatalog('free_play_v3').filter(pattern => pattern.kind === 'unlock')) {
    assert.equal(patternIdForName(pattern.mode, pattern.name, V8_RULES_VERSION), pattern.pattern_id);
    assert.equal(patternIdForName(pattern.mode, pattern.name, V9_RULES_VERSION), null, 'retired secret-scroll names do not fall back to a base pattern');
  }
  assert.equal(gamePatternCatalog(V9_RULES_VERSION).length, 84);
  assert.ok(gamePatternCatalog(V9_RULES_VERSION).every(pattern => pattern.kind === 'base'));
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

function v5Action(action = 'begin_play') {
  const event = actionEvent();
  event.rules_version = V5_RULES_VERSION; event.score_model_version = V5_SCORE_MODEL_VERSION;
  const state = { ...gameState(), phase: 'prepare', hand_count: 12, deck_count: 124, swaps: 5, relic_ids: ['core_high', 'high_rescue'], rescue_used: false };
  Object.assign(event.payload, {
    action, before: state, after: { ...state, phase: 'play' }, selected_tile_ids: [], tile_changes: [],
    context: { source_zone: null, transform_kind: null, transform_value: null, relic_id: null, rescue_type: null, replace_relic_id: null },
  });
  return event;
}

test('v5–v9 facts stay isolated and a shared score model selects the latest matching rules', async t => {
  assert.equal(GAME_RULES_VERSION, V9_RULES_VERSION);
  assert.equal(GAME_SCORE_MODEL_VERSION, V9_SCORE_MODEL_VERSION);
  assert.equal(V7_SCORE_MODEL_VERSION, V6_SCORE_MODEL_VERSION);
  assert.equal(V8_SCORE_MODEL_VERSION, V6_SCORE_MODEL_VERSION);
  assert.deepEqual(relicIdsForVersion(V6_RULES_VERSION), relicIdsForVersion(V5_RULES_VERSION));
  assert.ok(relicIdsForVersion(V5_RULES_VERSION).includes('ink'), 'disabling a reward drop does not rewrite a historical catalogue');
  for (const rules of ['free_play_v2', 'free_play_v3', 'free_play_v4', V5_RULES_VERSION, V6_RULES_VERSION]) assert.ok(relicIdsForVersion(rules).includes('wild_jade'));
  assert.equal(relicIdsForVersion(V7_RULES_VERSION).includes('wild_jade'), false);
  assert.deepEqual(relicIdsForVersion(V8_RULES_VERSION), relicIdsForVersion(V7_RULES_VERSION));
  assert.equal(relicIdsForVersion(V8_RULES_VERSION).length, 27);
  assert.deepEqual(gamePatternCatalog(V8_RULES_VERSION), gamePatternCatalog(V7_RULES_VERSION));
  assert.deepEqual(relicIdsForVersion(V9_RULES_VERSION), ['rank_brush', 'suit_ribbon', 'wild_jade', 'high_rescue']);
  assert.deepEqual(gamePatternCatalog(V6_RULES_VERSION), gamePatternCatalog(V5_RULES_VERSION));
  assert.deepEqual(gamePatternCatalog(V5_RULES_VERSION), gamePatternCatalog('free_play_v4'));
  const f = await fixture(t);
  const v4 = { ...v3Hand('knitted'), rules_version: 'free_play_v4' };
  assert.equal((await f.send([v4])).body.accepted.length, 1);
  const latest = async () => (await (await handleAnalytics(request(`/api/reports/patterns?mode=mcr&score_model_version=${V8_SCORE_MODEL_VERSION}`), f.env)).json());
  const defaultReport = async () => (await (await handleAnalytics(request('/api/reports/patterns?mode=mcr'), f.env)).json());
  assert.equal((await defaultReport()).rules_version, V9_RULES_VERSION);
  assert.equal((await latest()).rules_version, V8_RULES_VERSION);
  assert.equal((await latest()).summary.completed_hands, 0);
  const v5 = scoreParts({ ...v3Hand('orphans'), rules_version: V5_RULES_VERSION, score_model_version: V5_SCORE_MODEL_VERSION }, { win: Number.MAX_SAFE_INTEGER, target: Number.MAX_SAFE_INTEGER });
  v5.payload.owned_relic_ids = ['core_high', 'retrigger_meld', 'high_rescue', 'jade'];
  assert.equal((await f.send([v5])).body.accepted.length, 1);
  const completed = { ...structuredClone(v5), event_name: 'hand_completed', event_id: crypto.randomUUID() };
  assert.deepEqual((await f.send([completed])).body.duplicate, [completed.event_id]);
  const report = await f.report(`rules_version=${V5_RULES_VERSION}`);
  assert.equal(report.summary.completed_hands, 1);
  assert.equal(report.settlements.total, 1);
  assert.equal(report.summary.max_win_score, Number.MAX_SAFE_INTEGER);
  assert.equal(row(report, 'mcr.thirteen_orphans').count, 1);
  assert.equal((await f.report('rules_version=free_play_v4')).summary.completed_hands, 1);
  assert.equal((await latest()).summary.completed_hands, 0, 'new rules never inherit older high scores');
  const v6 = scoreParts({ ...v3Hand('pairs'), rules_version: V6_RULES_VERSION, score_model_version: V6_SCORE_MODEL_VERSION }, { win: 2500, process: 200, target: 1000 });
  v6.payload.owned_relic_ids = ['core_growth', 'rank_brush', 'single_seal', 'retrigger_meld'];
  assert.equal((await f.send([v6])).body.accepted.length, 1);
  assert.deepEqual((await f.send([v5, v6])).body.duplicate, [v5.event_id, v6.event_id]);
  const current = await f.report(`rules_version=${V6_RULES_VERSION}`);
  assert.equal(current.summary.completed_hands, 1);
  assert.equal(current.summary.max_win_score, 2500);
  assert.equal(current.summary.max_round_score, 2700);
  assert.equal(current.summary.max_cumulative_score, 2700);
  assert.equal(row(current, 'mcr.seven_pairs').count, 1);
  assert.equal(row(current, 'mcr.thirteen_orphans').count, 0);
  assert.equal((await f.report(`score_model_version=${V5_SCORE_MODEL_VERSION}`)).summary.max_win_score, Number.MAX_SAFE_INTEGER);
  const scoreOnly = await f.report(`score_model_version=${V6_SCORE_MODEL_VERSION}`);
  assert.equal(scoreOnly.rules_version, V8_RULES_VERSION);
  assert.equal(scoreOnly.summary.completed_hands, 0, 'score-only reports never mix V6 records into the latest V8 rules');
  const v7 = scoreParts({ ...v3Hand(), rules_version: V7_RULES_VERSION, score_model_version: V7_SCORE_MODEL_VERSION }, { win: 1000, target: 1000 });
  v7.payload.owned_relic_ids = ['core_high', 'rank_brush'];
  assert.equal((await f.send([v7])).body.accepted.length, 1);
  assert.equal((await latest()).summary.completed_hands, 0);
  assert.equal((await f.report(`rules_version=${V7_RULES_VERSION}`)).summary.max_win_score, 1000);
  assert.equal((await f.report(`score_model_version=${V6_SCORE_MODEL_VERSION}`)).summary.completed_hands, 0);
  assert.equal((await f.report(`rules_version=${V6_RULES_VERSION}`)).summary.max_win_score, 2500);
  const v8 = scoreParts({ ...v3Hand('pairs'), rules_version: V8_RULES_VERSION, score_model_version: V8_SCORE_MODEL_VERSION }, { win: 500, target: 1000 });
  v8.payload.owned_relic_ids = ['core_high', 'rank_brush', 'wheel'];
  v8.payload.unlock_pattern_ids = ['mcr.seven_shifted_pairs_bonus'];
  assert.equal((await f.send([v8])).body.accepted.length, 1);
  assert.equal((await latest()).summary.max_win_score, 500);
  assert.equal((await f.report(`score_model_version=${V6_SCORE_MODEL_VERSION}`)).summary.max_win_score, 500);
  assert.equal((await f.report(`rules_version=${V7_RULES_VERSION}`)).summary.max_win_score, 1000);
  assert.equal((await f.report(`rules_version=${V6_RULES_VERSION}`)).summary.max_win_score, 2500);
  assert.deepEqual((await f.send([v6, v7, v8])).body.duplicate, [v6.event_id, v7.event_id, v8.event_id]);
  assert.equal(row(await latest(), 'mcr.seven_shifted_pairs_bonus').count, 1, 'historical unlocks remain visible after production removes their relics');
  assert.equal((await defaultReport()).summary.completed_hands, 0);
  const v9 = scoreParts({ ...v3Hand(), rules_version: V9_RULES_VERSION, score_model_version: V9_SCORE_MODEL_VERSION }, { win: 128000, target: 32000 });
  v9.payload.owned_relic_ids = ['rank_brush'];
  assert.equal((await f.send([v9])).body.accepted.length, 1);
  assert.equal((await defaultReport()).summary.max_win_score, 128000);
  assert.equal((await latest()).summary.max_win_score, 500);
  assert.equal((await f.report(`score_model_version=${V9_SCORE_MODEL_VERSION}`)).rules_version, V9_RULES_VERSION);
  assert.equal(row(await defaultReport(), 'mcr.seven_shifted_pairs_bonus'), undefined);
  assert.deepEqual((await f.send([v8, v9])).body.duplicate, [v8.event_id, v9.event_id]);
  const invalid = [];
  for (const rules of ['free_play_v2', 'free_play_v3', 'free_play_v4']) {
    assert.equal(relicIdsForVersion(rules).length, 21);
    assert.equal(relicIdsForVersion(rules).includes('core_high'), false);
    const old = { ...v3Hand(), rules_version: rules, score_model_version: GAME_VERSION_PAIRS[rules] };
    old.payload.owned_relic_ids = ['core_high']; invalid.push(old);
  }
  for (const owned of [['core_high', 'core_pung'], ['core_high', 'jade', 'ink', 'wheel', 'jiang'], ['core_high', 'jade', 'jade']]) {
    const bad = structuredClone(v5); bad.event_id = crypto.randomUUID(); bad.payload.owned_relic_ids = owned; invalid.push(bad);
  }
  const steps = structuredClone(v5); steps.event_id = crypto.randomUUID(); steps.payload.steps = []; invalid.push(steps);
  const mixed = structuredClone(v5); mixed.event_id = crypto.randomUUID(); mixed.score_model_version = 'exponential_v3'; invalid.push(mixed);
  const retired = structuredClone(v7); retired.event_id = crypto.randomUUID(); retired.payload.owned_relic_ids.push('wild_jade'); invalid.push(retired);
  const retiredV8 = structuredClone(v8); retiredV8.event_id = crypto.randomUUID(); retiredV8.payload.owned_relic_ids.push('wild_jade'); invalid.push(retiredV8);
  for (const mutate of [event => { event.payload.owned_relic_ids.push('core_high'); }, event => { event.payload.unlock_pattern_ids = ['mcr.seven_shifted_pairs_bonus']; }, event => { scoreParts(event, { process: 1, win: 128000 }); }]) {
    const bad = structuredClone(v9); bad.event_id = crypto.randomUUID(); mutate(bad); invalid.push(bad);
  }
  for (const [event, score] of [[v5, V6_SCORE_MODEL_VERSION], [v6, V5_SCORE_MODEL_VERSION], [v7, V5_SCORE_MODEL_VERSION], [v8, V5_SCORE_MODEL_VERSION]]) {
    const mixed = structuredClone(event); mixed.event_id = crypto.randomUUID(); mixed.score_model_version = score; invalid.push(mixed);
  }
  for (let i = 0; i < invalid.length; i += 8) assert.equal((await f.send(invalid.slice(i, i + 8))).body.rejected.length, invalid.slice(i, i + 8).length);
  assert.equal(tableCount(f.DB, 'round_settlements'), 6);
  assert.equal(tableCount(f.DB, 'completed_hands'), 0);
});

test('older actions still replay while V9 phases, tools and discards carry bounded evidence', async t => {
  const f = await fixture(t);
  const begin = v5Action();
  const startRound = { ...structuredClone(begin), event_id: crypto.randomUUID(), event_name: 'round_started', payload: { state: begin.payload.before, record_quality: 'complete' } };
  const rescue = v5Action('high_rescue');
  rescue.payload.before.phase = 'play'; rescue.payload.after.rescue_used = true;
  rescue.payload.selected_tile_ids = ['entity-1']; rescue.payload.context.rescue_type = 'exchange';
  const rank = structuredClone(rescue); rank.event_id = crypto.randomUUID(); rank.payload.action_id = crypto.randomUUID();
  rank.payload.after.ink--; Object.assign(rank.payload.context, { rescue_type: 'rank', transform_kind: 'rank', transform_value: 1 });
  const suit = structuredClone(rank); suit.event_id = crypto.randomUUID(); suit.payload.action_id = crypto.randomUUID();
  Object.assign(suit.payload.context, { rescue_type: 'suit', transform_kind: 'suit', transform_value: 2 });
  const reward = v5Action('reward'); reward.payload.before.phase = 'reward'; reward.payload.after.phase = 'shop';
  reward.payload.before.relic_ids = ['core_high', 'jade', 'ink', 'wheel']; reward.payload.after.relic_ids = ['core_high', 'high_rescue', 'ink', 'wheel'];
  Object.assign(reward.payload.context, { relic_id: 'high_rescue', replace_relic_id: 'jade' });
  const skip = v5Action('skip_reward'); skip.payload.before.phase = 'reward'; skip.payload.after.phase = 'shop';
  const rejected = structuredClone(rescue); rejected.event_id = crypto.randomUUID(); rejected.payload.action_id = crypto.randomUUID();
  rejected.payload.outcome = 'rejected'; rejected.payload.after = structuredClone(rejected.payload.before);
  const previousEvents = [startRound, begin, rescue, rank, suit, reward, skip, rejected];
  const v6Begin = structuredClone(begin);
  Object.assign(v6Begin, { event_id: crypto.randomUUID(), rules_version: V6_RULES_VERSION, score_model_version: V6_SCORE_MODEL_VERSION });
  v6Begin.payload.action_id = crypto.randomUUID();
  for (const state of [v6Begin.payload.before, v6Begin.payload.after]) { state.ink = 2; state.relic_ids = ['core_high', 'rank_brush']; }
  const v6Tool = structuredClone(v6Begin); v6Tool.event_id = crypto.randomUUID(); v6Tool.payload.action_id = crypto.randomUUID();
  v6Tool.payload.action = 'transform'; v6Tool.payload.selected_tile_ids = ['entity-1'];
  for (const state of [v6Tool.payload.before, v6Tool.payload.after]) { state.phase = 'play'; state.formed_count = state.structure_count = 14; }
  v6Tool.payload.after.ink = 0;
  v6Tool.payload.tile_changes = [['entity-1', 'formed', 'formed', 1, 2, false, false, true, true]];
  Object.assign(v6Tool.payload.context, { source_zone: 'formed', transform_kind: 'rank', transform_value: 1, relic_id: 'rank_brush' });
  const exhausted = structuredClone(v6Tool); exhausted.event_id = crypto.randomUUID(); exhausted.payload.action_id = crypto.randomUUID();
  exhausted.payload.outcome = 'rejected'; exhausted.payload.reason_code = 'insufficient_ink';
  exhausted.payload.before = structuredClone(exhausted.payload.after); exhausted.payload.tile_changes = [];
  const v7Discard = structuredClone(v6Tool);
  Object.assign(v7Discard, { event_id: crypto.randomUUID(), rules_version: V7_RULES_VERSION, score_model_version: V7_SCORE_MODEL_VERSION });
  Object.assign(v7Discard.payload, { action_id: crypto.randomUUID(), action: 'formed_discard', selected_tile_ids: ['entity-1', 'entity-2'], context: { ...begin.payload.context, source_zone: 'formed' } });
  v7Discard.payload.before = { ...structuredClone(v6Tool.payload.after), deck_count: 110, formed_discard: null };
  v7Discard.payload.after = { ...structuredClone(v7Discard.payload.before), formed_count: 12, structure_count: 12, discard_count: 2, formed_discard: { round_no: 1, tile_ids: ['entity-1', 'entity-2'] } };
  v7Discard.payload.tile_changes = ['entity-1', 'entity-2'].map(tileId => [tileId, 'formed', 'discard', 2, null, false, null, true, null]);
  const used = structuredClone(v7Discard); used.event_id = crypto.randomUUID(); used.payload.action_id = crypto.randomUUID();
  used.payload.before = structuredClone(used.payload.after); used.payload.after = structuredClone(used.payload.before);
  used.payload.after.formed_discard = { tile_ids: ['entity-2', 'entity-1'], round_no: 1 };
  used.payload.outcome = 'rejected'; used.payload.reason_code = 'formed_discard_used'; used.payload.tile_changes = [];
  const carried = { ...structuredClone(v7Discard), event_id: crypto.randomUUID(), event_name: 'round_started', payload: { state: { ...structuredClone(v7Discard.payload.after), round_no: 2, phase: 'prepare', formed_count: 0, structure_count: 0, deck_count: 124, discard_count: 0 }, record_quality: 'complete' } };
  const oldWild = structuredClone(v6Tool); oldWild.event_id = crypto.randomUUID(); oldWild.payload.action_id = crypto.randomUUID();
  for (const state of [oldWild.payload.before, oldWild.payload.after]) state.relic_ids = ['core_pung', 'wild_jade'];
  Object.assign(oldWild.payload.context, { transform_kind: 'wild', transform_value: null, relic_id: 'wild_jade' });
  oldWild.payload.after.wild_used = true;
  oldWild.payload.tile_changes = [['entity-1', 'formed', 'formed', 1, 1, false, true, true, true]];
  const coreWild = structuredClone(oldWild);
  Object.assign(coreWild, { event_id: crypto.randomUUID(), rules_version: V7_RULES_VERSION, score_model_version: V7_SCORE_MODEL_VERSION });
  coreWild.payload.action_id = crypto.randomUUID(); coreWild.payload.context.relic_id = 'core_high';
  for (const state of [coreWild.payload.before, coreWild.payload.after]) { state.relic_ids = ['core_high', 'rank_brush']; state.formed_discard = null; }
  const refusedWild = structuredClone(coreWild); refusedWild.event_id = crypto.randomUUID(); refusedWild.payload.action_id = crypto.randomUUID();
  refusedWild.payload.before.relic_ids = ['core_pung', 'rank_brush']; refusedWild.payload.after = structuredClone(refusedWild.payload.before);
  refusedWild.payload.outcome = 'rejected'; refusedWild.payload.reason_code = 'missing_relic'; refusedWild.payload.tile_changes = [];
  const events = [...previousEvents, v6Begin, v6Tool, exhausted, v7Discard, used, carried, oldWild, coreWild, refusedWild];
  const received = await f.send(events);
  assert.deepEqual(received.body.rejected, []);
  assert.equal(received.body.accepted.length, events.length);
  assert.deepEqual((await f.send(previousEvents)).body.duplicate, previousEvents.map(event => event.event_id), 'old V5 outboxes retain their original envelopes and ACKs');
  assert.equal(f.DB.sqlite.prepare('SELECT COUNT(*) AS n FROM raw_events WHERE rules_version=?').get(V5_RULES_VERSION).n, previousEvents.length);
  assert.equal(f.DB.sqlite.prepare('SELECT COUNT(*) AS n FROM raw_events WHERE rules_version=?').get(V6_RULES_VERSION).n, 4);
  assert.equal(f.DB.sqlite.prepare('SELECT COUNT(*) AS n FROM raw_events WHERE rules_version=?').get(V7_RULES_VERSION).n, 5);
  assert.deepEqual((await f.send([v7Discard])).body.duplicate, [v7Discard.event_id]);
  assert.deepEqual((await f.send([coreWild, used, carried])).body.duplicate, [coreWild.event_id, used.event_id, carried.event_id], 'V7 outboxes still replay their play-phase edits and persistent discard record');
  assert.equal(tableCount(f.DB, 'round_settlements'), 0, 'actions never create settlement awards');
  const asV8 = source => {
    const event = structuredClone(source);
    Object.assign(event, { event_id: crypto.randomUUID(), rules_version: V8_RULES_VERSION, score_model_version: V8_SCORE_MODEL_VERSION });
    event.payload.action_id = crypto.randomUUID();
    for (const state of [event.payload.before, event.payload.after]) if (!Object.hasOwn(state, 'formed_discard')) state.formed_discard = null;
    return event;
  };
  const v8Begin = asV8(v6Begin);
  const prepTool = asV8(v6Tool);
  for (const state of [prepTool.payload.before, prepTool.payload.after]) { state.phase = 'prepare'; state.formed_count = state.structure_count = 0; }
  prepTool.payload.context.source_zone = 'hand';
  prepTool.payload.tile_changes = [['entity-1', 'hand', 'hand', 1, 2, false, false, false, false]];
  const prepSuit = asV8(prepTool);
  for (const state of [prepSuit.payload.before, prepSuit.payload.after]) state.relic_ids = ['core_high', 'suit_ribbon'];
  Object.assign(prepSuit.payload.context, { transform_kind: 'suit', transform_value: 1, relic_id: 'suit_ribbon' });
  prepSuit.payload.tile_changes[0][4] = 10;
  const prepWild = asV8(coreWild);
  for (const state of [prepWild.payload.before, prepWild.payload.after]) { state.phase = 'prepare'; state.formed_count = state.structure_count = 0; }
  prepWild.payload.context.source_zone = 'hand';
  prepWild.payload.tile_changes = [['entity-1', 'hand', 'hand', 1, 1, false, true, false, false]];
  const exchangeAt = (phase, count, full = false, rescueAction = false) => {
    const event = asV8(rescueAction ? rescue : v8Begin), p = event.payload;
    p.action = rescueAction ? 'high_rescue' : 'exchange';
    p.selected_tile_ids = Array.from({ length: count }, (_, i) => `exchange-${i}`);
    for (const state of [p.before, p.after]) { state.phase = phase; state.formed_count = state.structure_count = full ? 14 : 0; }
    p.after.deck_count -= count; p.after.discard_count += count;
    if (!rescueAction) p.after.swaps--;
    p.context.source_zone = 'hand';
    p.tile_changes = p.selected_tile_ids.flatMap(tileId => [[tileId, 'hand', 'discard', 1, null, false, null, false, null], [`new-${tileId}`, 'deck', 'hand', null, 2, null, false, null, false]]);
    return event;
  };
  const prepExchange = exchangeAt('prepare', 1), fullExchange = exchangeAt('play', 5, true), rescueExchange = exchangeAt('play', 3, false, true);
  const rescueRank = asV8(rank), rescueSuit = asV8(suit);
  for (const event of [rescueRank, rescueSuit]) {
    event.payload.before.phase = event.payload.after.phase = 'prepare';
    event.payload.before.ink = 2; event.payload.after.ink = 0;
  }
  const refusedTool = asV8(prepTool); refusedTool.payload.before.phase = 'play';
  const refusedRescue = asV8(rescueRank); refusedRescue.payload.before.phase = 'play';
  const fullRescue = asV8(rescueExchange); fullRescue.payload.before.formed_count = fullRescue.payload.before.structure_count = 14;
  for (const event of [refusedTool, refusedRescue, fullRescue]) {
    event.payload.outcome = 'rejected'; event.payload.reason_code = 'wrong_phase';
    event.payload.after = structuredClone(event.payload.before); event.payload.tile_changes = [];
  }
  const v8Events = [v8Begin, prepTool, prepSuit, prepWild, prepExchange, fullExchange, rescueExchange, rescueRank, rescueSuit, refusedTool, refusedRescue, fullRescue, asV8(v7Discard), asV8(used)];
  for (let i = 0; i < v8Events.length; i += 8) {
    const result = await f.send(v8Events.slice(i, i + 8));
    assert.deepEqual(result.body.rejected, []); assert.equal(result.body.accepted.length, v8Events.slice(i, i + 8).length);
  }
  assert.equal(v8Begin.payload.before.swaps, v8Begin.payload.after.swaps, 'the same counter spans preparation and play');
  assert.equal(fullExchange.payload.after.swaps, 4, 'a full formed area does not block ordinary candidate exchange');
  assert.equal(f.DB.sqlite.prepare('SELECT COUNT(*) AS n FROM raw_events WHERE rules_version=?').get(V8_RULES_VERSION).n, v8Events.length);
  const v8Invalid = [];
  for (const [source, change] of [
    [prepTool, event => { event.payload.before.phase = event.payload.after.phase = 'play'; }],
    [prepWild, event => { event.payload.before.phase = event.payload.after.phase = 'play'; }],
    [rescueRank, event => { event.payload.before.phase = event.payload.after.phase = 'play'; }],
    [rescueSuit, event => { event.payload.before.phase = event.payload.after.phase = 'play'; }],
    [rescueExchange, event => { event.payload.before.phase = event.payload.after.phase = 'prepare'; }],
    [rescueExchange, event => { event.payload.before.structure_count = event.payload.before.formed_count = 14; }],
    [rescueExchange, event => { event.payload.selected_tile_ids.push('extra-tile'); }],
    [prepExchange, event => { event.payload.before.phase = event.payload.after.phase = 'reward'; }],
    [fullExchange, event => { event.payload.selected_tile_ids.push('extra-tile'); }],
    [prepExchange, event => { event.payload.selected_tile_ids = []; }],
    [prepTool, event => { event.payload.before.openingSwapsUsed = 0; }],
    [prepWild, event => { event.payload.before.relic_ids = event.payload.after.relic_ids = ['core_pung']; }],
    [prepWild, event => { event.payload.before.relic_ids.push('wild_jade'); }],
    [refusedTool, event => { event.payload.after.ink = 0; }],
    [refusedRescue, event => { event.payload.after.rescue_used = true; }],
  ]) { const bad = asV8(source); change(bad); v8Invalid.push(bad); }
  for (let i = 0; i < v8Invalid.length; i += 8) {
    const result = await f.send(v8Invalid.slice(i, i + 8));
    assert.equal(result.body.rejected.length, v8Invalid.slice(i, i + 8).length);
  }
  const asV9 = source => {
    const event = asV8(source);
    Object.assign(event, { rules_version: V9_RULES_VERSION, score_model_version: V9_SCORE_MODEL_VERSION });
    for (const state of [event.payload.before, event.payload.after]) {
      state.hand_count = 9; state.coins = state.process_score = state.single_count = 0;
      state.relic_ids = ['rank_brush', 'suit_ribbon', 'wild_jade', 'high_rescue'];
    }
    if (event.payload.context.transform_kind === 'wild') event.payload.context.relic_id = 'wild_jade';
    return event;
  };
  const v9Begin = asV9(v8Begin), v9Wild = asV9(prepWild), v9Exchange = asV9(fullExchange);
  for (const state of [v9Exchange.payload.before, v9Exchange.payload.after]) state.formed_count = state.structure_count = 13;
  const refusedFull = asV9(fullExchange); refusedFull.payload.outcome = 'rejected'; refusedFull.payload.after = structuredClone(refusedFull.payload.before); refusedFull.payload.tile_changes = [];
  const endings = ['no_yaku_below_target', 'incomplete_below_target'].map(reason => ({ ...structuredClone(v9Begin), event_id: crypto.randomUUID(), event_name: 'run_ended', payload: { state: { ...structuredClone(v9Begin.payload.before), phase: 'defeat' }, record_quality: 'complete', reason } }));
  const v9Events = [v9Begin, asV9(prepTool), v9Wild, asV9(prepExchange), v9Exchange, asV9(rescueRank), asV9(rescueExchange), asV9(v7Discard), refusedFull, ...endings];
  for (let i = 0; i < v9Events.length; i += 8) {
    const ack = await f.send(v9Events.slice(i, i + 8));
    assert.deepEqual(ack.body.rejected, []); assert.equal(ack.body.accepted.length, v9Events.slice(i, i + 8).length);
  }
  assert.deepEqual((await f.send([v8Begin, prepWild, v9Wild])).body.duplicate, [v8Begin.event_id, prepWild.event_id, v9Wild.event_id], 'V8 core wilds and V9 tool wilds keep their original versioned facts');
  const v9Invalid = [];
  for (const [source, change] of [
    [v9Begin, event => { event.payload.after.hand_count = 10; }],
    [v9Begin, event => { event.payload.after.coins = 1; }],
    [v9Begin, event => { event.payload.after.process_score = 1; }],
    [v9Begin, event => { event.payload.after.single_count = 1; }],
    [v9Begin, event => { event.payload.after.relic_ids = ['core_high']; }],
    [v9Exchange, event => { event.payload.before.formed_count = event.payload.before.structure_count = 14; }],
    [v9Wild, event => { event.payload.context.relic_id = 'core_high'; }],
    [v9Wild, event => { event.payload.before.relic_ids = ['rank_brush']; }],
    [v9Wild, event => { event.payload.before.phase = event.payload.after.phase = 'play'; }],
  ]) { const bad = asV9(source); change(bad); v9Invalid.push(bad); }
  for (const ending of endings) v9Invalid.push({ ...structuredClone(ending), event_id: crypto.randomUUID(), rules_version: V8_RULES_VERSION, score_model_version: V8_SCORE_MODEL_VERSION, payload: { ...ending.payload, state: { ...ending.payload.state, relic_ids: ['rank_brush'] } } });
  for (let i = 0; i < v9Invalid.length; i += 8) assert.equal((await f.send(v9Invalid.slice(i, i + 8))).body.rejected.length, v9Invalid.slice(i, i + 8).length);
  const invalid = [];
  for (const rules of ['free_play_v2', 'free_play_v3', 'free_play_v4']) {
    const old = actionEvent(); old.rules_version = rules; old.score_model_version = GAME_VERSION_PAIRS[rules];
    old.payload.before.hand_count = old.payload.after.hand_count = rules === 'free_play_v3' ? 10 : 12;
    for (const action of ['begin_play', 'high_rescue', 'skip_reward']) {
      const extraAction = structuredClone(old); extraAction.event_id = crypto.randomUUID(); extraAction.payload.action = action; invalid.push(extraAction);
    }
    const extraState = structuredClone(old); extraState.event_id = crypto.randomUUID(); extraState.payload.after.rescue_used = false; invalid.push(extraState);
    const extraContext = structuredClone(old); extraContext.event_id = crypto.randomUUID(); Object.assign(extraContext.payload.context, { rescue_type: null, replace_relic_id: null }); invalid.push(extraContext);
  }
  const mutateRejected = structuredClone(rejected); mutateRejected.event_id = crypto.randomUUID(); mutateRejected.payload.after.rescue_used = true; invalid.push(mutateRejected);
  const wrongType = structuredClone(rank); wrongType.event_id = crypto.randomUUID(); wrongType.payload.context.rescue_type = 'suit'; invalid.push(wrongType);
  const replacementLeak = structuredClone(begin); replacementLeak.event_id = crypto.randomUUID(); replacementLeak.payload.context.replace_relic_id = 'jade'; invalid.push(replacementLeak);
  const missingRescue = v5Action(); delete missingRescue.payload.after.rescue_used; invalid.push(missingRescue);
  const overflow = v5Action(); overflow.payload.after.hand_count = 13; invalid.push(overflow);
  const result = await f.send(invalid);
  assert.equal(result.body.rejected.length, invalid.length);
  assert.ok(result.body.rejected.some(item => item.reason === 'rejected_action_mutates_state'));
  const v6Invalid = [];
  for (const change of [event => { event.payload.after.transform_used = true; }, event => { event.payload.after.ink = -1; }, event => { event.payload.after.hand_count = 13; }]) {
    const bad = structuredClone(v6Tool); bad.event_id = crypto.randomUUID(); change(bad); v6Invalid.push(bad);
  }
  assert.equal((await f.send(v6Invalid)).body.rejected.length, v6Invalid.length);
  const v7Invalid = [];
  for (const change of [
    event => { event.payload.after.formed_discard.tile_ids = ['entity-1', 'entity-1']; },
    event => { event.payload.after.formed_discard.tile_ids.push('entity-3'); },
    event => { event.payload.after.formed_discard.round_no = 0; },
    event => { event.payload.after.formed_discard.round_no = 2; },
    event => { delete event.payload.after.formed_discard; },
    event => { event.payload.after.formed_discard.used = true; },
    event => { event.payload.after.ink++; },
    event => { event.payload.after.total_score = event.payload.after.round_score = event.payload.after.process_score = 10; },
    event => { event.payload.after.deck_count--; },
    event => { event.payload.after.hand_count--; },
    event => { event.payload.before.formed_discard = structuredClone(event.payload.after.formed_discard); },
    event => { event.payload.selected_tile_ids = ['entity-1']; },
  ]) { const bad = structuredClone(v7Discard); bad.event_id = crypto.randomUUID(); change(bad); v7Invalid.push(bad); }
  const refusedChange = structuredClone(used); refusedChange.event_id = crypto.randomUUID(); refusedChange.payload.after.formed_discard = null; v7Invalid.push(refusedChange);
  for (const rules of [V5_RULES_VERSION, V6_RULES_VERSION]) {
    const old = structuredClone(v6Tool); Object.assign(old, { event_id: crypto.randomUUID(), rules_version: rules, score_model_version: GAME_VERSION_PAIRS[rules] });
    old.payload.action = 'formed_discard';
    assert.equal(validateGamePayload(old.event_name, old.payload, old).reason, 'invalid_game_action', 'old versions reject the new action before applying its context or transition validation');
    v7Invalid.push(old);
    const leakedState = structuredClone(old); leakedState.event_id = crypto.randomUUID(); leakedState.payload.action = 'transform'; leakedState.payload.after.formed_discard = null; v7Invalid.push(leakedState);
  }
  const invalidWild = [];
  for (const change of [
    event => { for (const state of [event.payload.before, event.payload.after]) state.relic_ids = ['core_pung', 'rank_brush']; },
    event => { for (const state of [event.payload.before, event.payload.after]) state.relic_ids.push('wild_jade'); },
    event => { event.payload.context.relic_id = 'wild_jade'; },
  ]) { const bad = structuredClone(coreWild); bad.event_id = crypto.randomUUID(); change(bad); invalidWild.push(bad); }
  const invalidDiscard = await f.send(v7Invalid);
  assert.equal(invalidDiscard.body.rejected.length, v7Invalid.length);
  assert.ok(invalidDiscard.body.rejected.some(item => item.reason === 'rejected_action_mutates_state'));
  const wildResult = await f.send(invalidWild);
  assert.equal(wildResult.body.rejected.length, invalidWild.length);
  assert.ok(wildResult.body.rejected.some(item => item.reason === 'wild_requires_core_high'));
  assert.equal(tableCount(f.DB, 'raw_events'), events.length + v8Events.length + v9Events.length);
  assert.equal(tableCount(f.DB, 'round_settlements'), 0);
  const bounded = v5Action('select');
  bounded.payload.selected_tile_ids = Array.from({ length: 18 }, (_, i) => `t${i}`.padEnd(64, 'x'));
  bounded.payload.tile_changes = Array.from({ length: 36 }, (_, i) => [`t${i}`.padEnd(64, 'x'), 'hand', 'formed', 0, 0, false, false, false, true]);
  assert.equal(validateGamePayload(bounded.event_name, bounded.payload, bounded).ok, true);
  assert.ok(Buffer.byteLength(JSON.stringify(bounded)) < 8192);
  bounded.rules_version = V6_RULES_VERSION; bounded.score_model_version = V6_SCORE_MODEL_VERSION;
  assert.equal(validateGamePayload(bounded.event_name, bounded.payload, bounded).ok, true);
  assert.ok(Buffer.byteLength(JSON.stringify(bounded)) < 8192);
  bounded.rules_version = V7_RULES_VERSION; bounded.score_model_version = V7_SCORE_MODEL_VERSION;
  for (const state of [bounded.payload.before, bounded.payload.after]) state.formed_discard = { round_no: 1, tile_ids: ['a'.repeat(64), 'b'.repeat(64)] };
  assert.equal(validateGamePayload(bounded.event_name, bounded.payload, bounded).ok, true);
  assert.ok(Buffer.byteLength(JSON.stringify(bounded)) < 8192);
  bounded.rules_version = V8_RULES_VERSION; bounded.score_model_version = V8_SCORE_MODEL_VERSION;
  assert.equal(validateGamePayload(bounded.event_name, bounded.payload, bounded).ok, true);
  assert.ok(Buffer.byteLength(JSON.stringify(bounded)) < 8192);
  const v9Bounded = asV9(bounded);
  assert.equal(validateGamePayload(v9Bounded.event_name, v9Bounded.payload, v9Bounded).ok, true);
  assert.ok(Buffer.byteLength(JSON.stringify(v9Bounded)) < 8192);
});
