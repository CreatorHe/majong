import { DEFAULT_RULES_VERSION, DEFAULT_SCORE_MODEL_VERSION, PATTERNS_BY_ID, patternsForMode } from './catalog.js';
import { GAME_RULES_VERSION, GAME_SCORE_MODEL_VERSION, GAME_VERSION_PAIRS, isSupportedGameVersion, isGameEvent, validateGamePayload } from '../dist/analytics/game-schema.js';

const MAX_BATCH_BYTES = 32 * 1024;
const MAX_EVENT_BYTES = 8 * 1024;
const MAX_BATCH_EVENTS = 20;
const TOKEN_TTL_MS = 90 * 86400_000;
const EVENT_AGE_MS = 7 * 86400_000;
const ID = /^[A-Za-z0-9_.:-]{8,100}$/;
const LABEL = /^[A-Za-z0-9_.:-]{1,64}$/;
const EVENT_FIELDS = ['schema_version', 'event_id', 'event_name', 'occurred_at', 'session_id', 'app_release', 'rules_version', 'score_model_version', 'mode', 'run_id', 'round_attempt_id', 'hand_id', 'payload'];
const encoder = new TextEncoder();
const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const byteLength = value => encoder.encode(value).byteLength;
const nullableId = value => value == null || (typeof value === 'string' && ID.test(value));
const label = value => typeof value === 'string' && LABEL.test(value);
const nullableLabel = value => value === null || label(value);
const onlyKeys = (object, keys) => isObject(object) && Object.keys(object).every(key => keys.includes(key));
const integer = (value, min = 0, max = Number.MAX_SAFE_INTEGER) => Number.isSafeInteger(value) && value >= min && value <= max;
const reply = (data, status = 200, headers = {}) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...headers } });
class RequestError extends Error {
  constructor(reason, status = 400) { super(reason); this.status = status; }
}
function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (isObject(value)) return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}
async function digest(value) {
  const bytes = await crypto.subtle.digest('SHA-256', encoder.encode(value));
  return [...new Uint8Array(bytes)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}
function checkOrigin(request) {
  const origin = request.headers.get('Origin');
  if ((origin && origin !== new URL(request.url).origin) || ['cross-site', 'same-site'].includes(request.headers.get('Sec-Fetch-Site'))) throw new RequestError('origin_not_allowed', 403);
}
async function readJson(request) {
  if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get('Content-Type') || '')) throw new RequestError('json_required', 415);
  const size = Number(request.headers.get('Content-Length'));
  if (Number.isFinite(size) && size > MAX_BATCH_BYTES) throw new RequestError('batch_too_large', 413);
  const reader = request.body?.getReader();
  if (!reader) throw new RequestError('invalid_json');
  const chunks = []; let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_BATCH_BYTES) { await reader.cancel(); throw new RequestError('batch_too_large', 413); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const body = new Uint8Array(total); let offset = 0;
  for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.byteLength; }
  try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(body)); }
  catch { throw new RequestError('invalid_json'); }
}

function validatePayload(name, p, mode) {
  if (!isObject(p)) return 'invalid_payload';
  if (name === 'session_started') {
    return onlyKeys(p, ['entry', 'viewport', 'has_save']) && ['game', 'stats', 'debug'].includes(p.entry) && ['compact', 'wide'].includes(p.viewport) && typeof p.has_save === 'boolean' ? null : 'invalid_session_payload';
  }
  if (name === 'screen_viewed') {
    return onlyKeys(p, ['screen', 'previous_screen', 'reason']) && label(p.screen) && nullableLabel(p.previous_screen) && ['load', 'navigation'].includes(p.reason) ? null : 'invalid_screen_payload';
  }
  if (name === 'ui_action') {
    return onlyKeys(p, ['action', 'target_id', 'input_method', 'outcome', 'reason_code']) && label(p.action) && nullableLabel(p.target_id) && ['pointer', 'keyboard', 'programmatic'].includes(p.input_method) && ['applied', 'rejected', 'noop', 'blocked'].includes(p.outcome) && nullableLabel(p.reason_code) ? null : 'invalid_action_payload';
  }
  if (name === 'client_error') {
    return onlyKeys(p, ['code', 'screen', 'category']) && label(p.code) && nullableLabel(p.screen) && ['storage', 'network', 'runtime', 'resource'].includes(p.category) ? null : 'invalid_error_payload';
  }
  if (name !== 'hand_completed') return 'unknown_event';
  if (!onlyKeys(p, ['shape', 'round_no', 'round_score', 'target_score', 'passed', 'credited_pattern_ids', 'record_quality']) || !['normal', 'pairs'].includes(p.shape) || !integer(p.round_no, 1, 6) || !integer(p.round_score) || !integer(p.target_score, 1) || typeof p.passed !== 'boolean' || !['complete', 'partial'].includes(p.record_quality) || !Array.isArray(p.credited_pattern_ids) || p.credited_pattern_ids.length > 64) return 'invalid_hand_payload';
  if (p.passed !== (p.round_score >= p.target_score)) return 'inconsistent_passed';
  for (const id of p.credited_pattern_ids) {
    const pattern = typeof id === 'string' && PATTERNS_BY_ID.get(id);
    if (!pattern) return 'unknown_pattern';
    if (pattern.mode !== mode) return 'pattern_mode_mismatch';
    if (!pattern.routes.includes(p.shape)) return 'pattern_route_mismatch';
  }
  return null;
}
function validateEvent(input, now) {
  if (!onlyKeys(input, EVENT_FIELDS) || byteLength(JSON.stringify(input)) > MAX_EVENT_BYTES) return { reason: 'invalid_event_or_size' };
  if (input.schema_version !== 1 || typeof input.event_id !== 'string' || !ID.test(input.event_id) || typeof input.session_id !== 'string' || !ID.test(input.session_id) || typeof input.event_name !== 'string' || !label(input.app_release) || !label(input.rules_version) || !label(input.score_model_version) || ![null, 'mcr', 'riichi'].includes(input.mode) || ![input.run_id, input.round_attempt_id, input.hand_id].every(nullableId)) return { reason: 'invalid_envelope' };
  if (typeof input.occurred_at !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?Z$/.test(input.occurred_at)) return { reason: 'invalid_timestamp' };
  const occurred = Date.parse(input.occurred_at);
  if (!Number.isFinite(occurred) || occurred < now - EVENT_AGE_MS || occurred > now + 600_000) return { reason: 'timestamp_out_of_range' };
  if (new Date(occurred).toISOString().slice(0, 19) !== input.occurred_at.slice(0, 19)) return { reason: 'invalid_timestamp' };
  if (input.event_name === 'hand_completed' && (!input.mode || !input.run_id || !input.round_attempt_id || !input.hand_id)) return { reason: 'missing_hand_context' };
  const gameValidation = isGameEvent(input.event_name, input) ? validateGamePayload(input.event_name, input.payload, input) : null;
  const reason = gameValidation ? (gameValidation.ok ? null : gameValidation.reason) : validatePayload(input.event_name, input.payload, input.mode);
  if (reason) return { reason };
  const event = { ...input, occurred_at: new Date(occurred).toISOString(), run_id: input.run_id ?? null, round_attempt_id: input.round_attempt_id ?? null, hand_id: input.hand_id ?? null, payload: gameValidation?.ok ? gameValidation.payload : { ...input.payload } };
  if (event.event_name === 'hand_completed') event.payload.credited_pattern_ids = [...new Set(event.payload.credited_pattern_ids)].sort();
  return { event };
}
async function register(request, db, scope, now) {
  const body = await readJson(request);
  if (!onlyKeys(body, [])) throw new RequestError('invalid_registration');
  const clientId = crypto.randomUUID();
  const token = `at_${[...crypto.getRandomValues(new Uint8Array(32))].map(byte => byte.toString(16).padStart(2, '0')).join('')}`;
  const expires = new Date(now + TOKEN_TTL_MS).toISOString();
  await db.prepare('INSERT INTO analytics_clients (client_id, token_hash, scope, created_at, expires_at) VALUES (?, ?, ?, ?, ?)').bind(clientId, await digest(token), scope, new Date(now).toISOString(), expires).run();
  return reply({ client_id: clientId, write_token: token, scope, expires_at: expires }, 201);
}
async function authenticate(request, db, scope, now, allowExpired = false) {
  const match = /^Bearer (at_[a-f0-9]{64})$/.exec(request.headers.get('Authorization') || '');
  if (!match) throw new RequestError('invalid_credentials', 401);
  const client = await db.prepare('SELECT client_id, scope, expires_at FROM analytics_clients WHERE token_hash = ?').bind(await digest(match[1])).first();
  if (!client || client.scope !== scope || (!allowExpired && Date.parse(client.expires_at) <= now)) throw new RequestError('invalid_credentials', 401);
  return client;
}
async function renew(request, db, scope, now) {
  // The secret proves the same anonymous identity even after its write lease
  // expires. Never create an identity from a client_id supplied by the caller.
  const client = await authenticate(request, db, scope, now, true);
  const body = await readJson(request);
  if (!onlyKeys(body, [])) throw new RequestError('invalid_registration');
  const expires = new Date(now + TOKEN_TTL_MS).toISOString();
  await db.prepare('UPDATE analytics_clients SET expires_at = ? WHERE client_id = ?').bind(expires, client.client_id).run();
  return reply({ client_id: client.client_id, write_token: request.headers.get('Authorization').slice(7), scope, expires_at: expires });
}
async function consumeQuota(db, clientId, count, now) {
  const window = Math.floor(now / 60_000);
  const result = await db.prepare(`UPDATE analytics_clients SET quota_count = CASE WHEN quota_window = ? THEN quota_count + ? ELSE ? END, quota_window = ? WHERE client_id = ? AND (quota_window <> ? OR quota_count + ? <= 300) RETURNING client_id`).bind(window, count, count, window, clientId, window, count).first();
  if (!result) throw new RequestError('rate_limited', 429);
}
function handFingerprint(event) {
  return canonical({ run_id: event.run_id, round_attempt_id: event.round_attempt_id, hand_id: event.hand_id, mode: event.mode, rules_version: event.rules_version, score_model_version: event.score_model_version, payload: event.payload });
}
async function persistEvent(db, clientId, scope, event, now) {
  const eventHash = await digest(canonical(event));
  const receivedAt = new Date(now).toISOString();
  const statements = [db.prepare(`INSERT INTO raw_events (scope, client_id, event_id, event_name, schema_version, event_hash, occurred_at, received_at, session_id, app_release, rules_version, score_model_version, mode, run_id, round_attempt_id, hand_id, payload_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(scope, client_id, event_id) DO UPDATE SET event_hash = NULL WHERE raw_events.event_hash <> excluded.event_hash`).bind(scope, clientId, event.event_id, event.event_name, event.schema_version, eventHash, event.occurred_at, receivedAt, event.session_id, event.app_release, event.rules_version, event.score_model_version, event.mode, event.run_id, event.round_attempt_id, event.hand_id, canonical(event.payload))];
  let factHash = null;
  const settlement = isSupportedGameVersion(event.rules_version, event.score_model_version) && ['round_settled', 'hand_completed'].includes(event.event_name);
  if (settlement) {
    factHash = await digest(handFingerprint(event));
    const p = event.payload;
    statements.push(db.prepare(`INSERT INTO round_settlements (scope, client_id, settlement_id, event_id, fact_hash, run_id, round_attempt_id, mode, rules_version, score_model_version, round_no, legal, passed, result_type, shape, process_score, win_score, penalty_score, round_score, round_start_score, cumulative_before, cumulative_after, target_score, record_quality, payload_json, occurred_at, received_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(scope, client_id, settlement_id) DO UPDATE SET fact_hash = NULL WHERE round_settlements.fact_hash <> excluded.fact_hash`).bind(scope, clientId, p.settlement_id, event.event_id, factHash, event.run_id, event.round_attempt_id, event.mode, event.rules_version, event.score_model_version, p.round_no, p.legal ? 1 : 0, p.passed ? 1 : 0, p.result_type, p.shape, p.process_score, p.win_score, p.penalty_score, p.round_score, p.round_start_score, p.cumulative_before, p.cumulative_after, p.target_score, p.record_quality, canonical(p), event.occurred_at, receivedAt));
    for (const [ids, kind] of [[p.credited_pattern_ids, 'base'], [p.unlock_pattern_ids, 'unlock']]) for (const patternId of ids) statements.push(db.prepare('INSERT INTO settlement_patterns (scope, client_id, settlement_id, pattern_id, kind) VALUES (?, ?, ?, ?, ?) ON CONFLICT DO NOTHING').bind(scope, clientId, p.settlement_id, patternId, kind));
  } else if (event.event_name === 'hand_completed') {
    factHash = await digest(handFingerprint(event));
    const p = event.payload;
    statements.push(db.prepare(`INSERT INTO completed_hands (scope, client_id, hand_id, event_id, fact_hash, run_id, round_attempt_id, mode, rules_version, score_model_version, shape, round_no, round_score, target_score, passed, record_quality, occurred_at, received_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(scope, client_id, hand_id) DO UPDATE SET fact_hash = NULL WHERE completed_hands.fact_hash <> excluded.fact_hash`).bind(scope, clientId, event.hand_id, event.event_id, factHash, event.run_id, event.round_attempt_id, event.mode, event.rules_version, event.score_model_version, p.shape, p.round_no, p.round_score, p.target_score, p.passed ? 1 : 0, p.record_quality, event.occurred_at, receivedAt));
    for (const id of p.credited_pattern_ids) statements.push(db.prepare('INSERT INTO hand_patterns (scope, client_id, hand_id, pattern_id) VALUES (?, ?, ?, ?) ON CONFLICT DO NOTHING').bind(scope, clientId, event.hand_id, id));
  }
  try {
    // D1 batch is transactional. A conflicting hash violates NOT NULL and rolls
    // back the whole event, including its raw record and every pattern row.
    const result = await db.batch(statements);
    return result[0].meta.changes === 0 || (factHash && result[1].meta.changes === 0) ? 'duplicate' : 'accepted';
  } catch (error) {
    const existingEvent = await db.prepare('SELECT event_hash FROM raw_events WHERE scope = ? AND client_id = ? AND event_id = ?').bind(scope, clientId, event.event_id).first();
    if (existingEvent && existingEvent.event_hash !== eventHash) return 'event_id_conflict';
    if (factHash) {
      const table = settlement ? 'round_settlements' : 'completed_hands';
      const factId = settlement ? 'settlement_id' : 'hand_id';
      const existingHand = await db.prepare(`SELECT fact_hash FROM ${table} WHERE scope = ? AND client_id = ? AND (${factId} = ? OR (round_attempt_id = ? AND rules_version = ? AND score_model_version = ?))`).bind(scope, clientId, event.hand_id, event.round_attempt_id, event.rules_version, event.score_model_version).first();
      if (existingHand && existingHand.fact_hash !== factHash) return settlement ? 'settlement_conflict' : 'hand_conflict';
    }
    throw error;
  }
}
async function collect(request, db, scope, now) {
  const client = await authenticate(request, db, scope, now);
  const body = await readJson(request);
  if (!onlyKeys(body, ['events']) || !Array.isArray(body.events) || body.events.length < 1 || body.events.length > MAX_BATCH_EVENTS) throw new RequestError('invalid_batch');
  await consumeQuota(db, client.client_id, body.events.length, now);
  const result = { accepted: [], duplicate: [], rejected: [] };
  for (const input of body.events) {
    const { event, reason } = validateEvent(input, now);
    const eventId = typeof input?.event_id === 'string' && ID.test(input.event_id) ? input.event_id : null;
    if (reason) { result.rejected.push({ event_id: eventId, reason }); continue; }
    const status = await persistEvent(db, client.client_id, scope, event, now);
    if (status === 'accepted' || status === 'duplicate') result[status].push(event.event_id);
    else result.rejected.push({ event_id: event.event_id, reason: status });
  }
  return reply(result);
}
async function report(url, db, now) {
  if ([...url.searchParams.keys()].some(key => !['mode', 'scope', 'rules_version', 'score_model_version'].includes(key))) throw new RequestError('invalid_report_filter');
  const mode = url.searchParams.get('mode') || 'mcr';
  const scope = url.searchParams.get('scope') || 'production';
  const rules = url.searchParams.get('rules_version');
  const score = url.searchParams.get('score_model_version');
  if (!['mcr', 'riichi'].includes(mode) || !['production', 'sandbox'].includes(scope) || (rules !== null && !label(rules)) || (score !== null && !label(score))) throw new RequestError('invalid_report_filter');
  const versionRows = await db.prepare(`SELECT rules_version, score_model_version, MAX(received_at) AS last_received_at FROM (
    SELECT rules_version, score_model_version, received_at FROM completed_hands WHERE scope = ? AND mode = ?
    UNION ALL SELECT rules_version, score_model_version, received_at FROM round_settlements WHERE scope = ? AND mode = ?
  ) GROUP BY rules_version, score_model_version ORDER BY last_received_at DESC, rules_version DESC`).bind(scope, mode, scope, mode).all();
  const versions = versionRows.results.map(({ rules_version, score_model_version }) => ({ rules_version, score_model_version }));
  // A score model may span multiple rules. A score-only filter selects the
  // newest supported rule, independent of which historical version arrived last.
  const latestRulesForScore = score ? Object.entries(GAME_VERSION_PAIRS).reverse().find(([, model]) => model === score)?.[0] : null;
  const selected = rules || (score && !latestRulesForScore) ? versions.find(v => (!rules || v.rules_version === rules) && (!score || v.score_model_version === score)) : null;
  const rulesVersion = rules || latestRulesForScore || selected?.rules_version || (score ? DEFAULT_RULES_VERSION : GAME_RULES_VERSION);
  const scoreVersion = score || GAME_VERSION_PAIRS[rulesVersion] || selected?.score_model_version || DEFAULT_SCORE_MODEL_VERSION;
  const cumulative = isSupportedGameVersion(rulesVersion, scoreVersion);
  if (!cumulative && (Object.hasOwn(GAME_VERSION_PAIRS, rulesVersion) || Object.values(GAME_VERSION_PAIRS).includes(scoreVersion))) throw new RequestError('incompatible_game_version');
  const values = [scope, mode, rulesVersion, scoreVersion];
  const context = { mode, scope, rules_version: rulesVersion, score_model_version: scoreVersion, versions, generated_at: new Date(now).toISOString() };
  if (cumulative) return reportGame(db, values, context);
  const where = "h.scope = ? AND h.mode = ? AND h.rules_version = ? AND h.score_model_version = ? AND h.record_quality = 'complete'";
  const [totals, shapes, counts] = await db.batch([
    db.prepare(`SELECT COUNT(*) AS completed_hands, MAX(h.round_score) AS max_round_score, MIN(h.received_at) AS first_received_at, MAX(h.received_at) AS last_received_at FROM completed_hands h WHERE ${where}`).bind(...values),
    db.prepare(`SELECT h.shape, COUNT(*) AS count FROM completed_hands h WHERE ${where} GROUP BY h.shape`).bind(...values),
    db.prepare(`SELECT p.pattern_id, COUNT(*) AS count, MAX(h.round_score) AS max_round_score FROM hand_patterns p JOIN completed_hands h ON h.scope = p.scope AND h.client_id = p.client_id AND h.hand_id = p.hand_id WHERE ${where} GROUP BY p.pattern_id`).bind(...values),
  ]);
  const byShape = new Map(shapes.results.map(row => [row.shape, Number(row.count)]));
  const byPattern = new Map(counts.results.map(row => [row.pattern_id, row]));
  const patterns = patternsForMode(mode).map(pattern => {
    const row = byPattern.get(pattern.pattern_id);
    const denominator = pattern.routes.reduce((total, route) => total + (byShape.get(route) || 0), 0);
    const count = Number(row?.count || 0);
    return { ...pattern, kind: 'base', count, denominator, rate: denominator ? count / denominator : null, max_round_score: row?.max_round_score ?? null, max_win_score: null, max_cumulative_score: null };
  });
  return reply({ ...context, summary: { ...totals.results[0], max_win_score: null, max_cumulative_score: null, pattern_occurrences: patterns.reduce((total, row) => total + row.count, 0) }, patterns, settlements: null, denominator_basis: 'eligible_routes', collection_status: 'legacy' });
}
async function reportGame(db, values, context) {
  const where = "s.scope = ? AND s.mode = ? AND s.rules_version = ? AND s.score_model_version = ? AND s.record_quality = 'complete'";
  const [totals, counts, settled] = await db.batch([
    db.prepare(`SELECT COUNT(*) AS completed_hands, MAX(s.win_score) AS max_win_score, MAX(s.round_score) AS max_round_score, MAX(s.cumulative_after) AS max_cumulative_score, MIN(s.received_at) AS first_received_at, MAX(s.received_at) AS last_received_at FROM round_settlements s WHERE ${where} AND s.legal = 1`).bind(...values),
    db.prepare(`SELECT p.pattern_id, COUNT(*) AS count, MAX(s.win_score) AS max_win_score, MAX(s.round_score) AS max_round_score, MAX(s.cumulative_after) AS max_cumulative_score FROM settlement_patterns p JOIN round_settlements s ON s.scope = p.scope AND s.client_id = p.client_id AND s.settlement_id = p.settlement_id WHERE ${where} AND s.legal = 1 GROUP BY p.pattern_id`).bind(...values),
    db.prepare(`SELECT COUNT(*) AS total, COALESCE(SUM(s.legal), 0) AS legal, COALESCE(SUM(1 - s.legal), 0) AS false_win, COALESCE(SUM(s.passed), 0) AS passed, COALESCE(SUM(CASE WHEN s.legal = 0 AND s.passed = 1 THEN 1 ELSE 0 END), 0) AS false_win_passed, MAX(s.round_score) AS max_round_score, MAX(s.cumulative_after) AS max_cumulative_score FROM round_settlements s WHERE ${where}`).bind(...values),
  ]);
  const summary = totals.results[0];
  const byPattern = new Map(counts.results.map(row => [row.pattern_id, row]));
  const patterns = patternsForMode(context.mode, context.rules_version).map(pattern => {
    const row = byPattern.get(pattern.pattern_id);
    const count = Number(row?.count || 0), denominator = Number(summary.completed_hands);
    return { ...pattern, count, denominator, rate: denominator ? count / denominator : null, max_win_score: row?.max_win_score ?? null, max_round_score: row?.max_round_score ?? null, max_cumulative_score: row?.max_cumulative_score ?? null };
  });
  const settlements = settled.results[0];
  settlements.pass_rate = settlements.total ? settlements.passed / settlements.total : null;
  return reply({ ...context, summary: { ...summary, pattern_occurrences: patterns.reduce((total, row) => total + row.count, 0) }, patterns, settlements, denominator_basis: 'legal_complete_settlements', collection_status: 'gameplay_adapter_ready' });
}

export async function handleAnalytics(request, env) {
  const url = new URL(request.url);
  if (!url.pathname.startsWith('/api/')) return null;
  try {
    if (!env.DB) throw new RequestError('database_unavailable', 503);
    const now = Date.now();
    if (request.method === 'GET' && url.pathname === '/api/health') {
      await env.DB.prepare('SELECT 1 AS ok').first();
      return reply({ ok: true, storage: 'd1', collection_status: 'gameplay_adapter_ready' });
    }
    if (url.pathname === '/api/reports/patterns') {
      if (request.method !== 'GET') return reply({ error: 'method_not_allowed' }, 405, { Allow: 'GET' });
      return await report(url, env.DB, now);
    }
    const registration = url.pathname === '/api/analytics/register' || url.pathname === '/api/analytics/test/register';
    const renewal = url.pathname === '/api/analytics/renew' || url.pathname === '/api/analytics/test/renew';
    const events = url.pathname === '/api/events' || url.pathname === '/api/analytics/test/events';
    if (!registration && !renewal && !events) return reply({ error: 'not_found' }, 404);
    if (request.method !== 'POST') return reply({ error: 'method_not_allowed' }, 405, { Allow: 'POST' });
    checkOrigin(request);
    const scope = url.pathname.includes('/test/') ? 'sandbox' : 'production';
    if (registration) return await register(request, env.DB, scope, now);
    if (renewal) return await renew(request, env.DB, scope, now);
    return await collect(request, env.DB, scope, now);
  } catch (error) {
    if (error instanceof RequestError) return reply({ error: error.message }, error.status, error.status === 429 ? { 'Retry-After': '60' } : {});
    // Never return SQL, credentials, payloads, or stack traces to the browser.
    return reply({ error: 'storage_unavailable' }, 503);
  }
}
