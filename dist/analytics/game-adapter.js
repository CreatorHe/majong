import { getGameAnalytics } from './runtime.js';
import { GAME_ACTIONS, V5_RULES_VERSION, V5_SCORE_MODEL_VERSION, V6_RULES_VERSION, V6_SCORE_MODEL_VERSION, V7_RULES_VERSION, V7_SCORE_MODEL_VERSION, V8_RULES_VERSION, V8_SCORE_MODEL_VERSION, V9_RULES_VERSION, V9_SCORE_MODEL_VERSION, gamePatternCatalog, relicIdsForVersion, patternIdForName, validateGamePayload } from './game-schema.js';

// This module observes committed engine transitions. It never scores, mutates a
// game/save, repairs a hand, or reads an unplayed wall's faces.
const id = value => typeof value === 'string' && /^[A-Za-z0-9_.:-]{1,100}$/.test(value);
const label = value => typeof value === 'string' && /^[A-Za-z0-9_.:-]{1,64}$/.test(value);
const integer = value => Number.isSafeInteger(value) ? value : 0;
const freeze = value => { if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); } return value; };
const members = (collection, value) => typeof collection.has === 'function' ? collection.has(value) : collection.includes(value);
const uuid = () => globalThis.crypto?.randomUUID?.() ?? `a-${Date.now()}-${Math.random().toString(36).slice(2)}`;
const keyOf = state => state && `${state.rulesVersion}/${state.scoreVersion}/${state.runId}/${state.roundId}`;
function gameVersions(game) {
  const versions = game?.version === 2 ? ['free_play_v2', 'cumulative_v2']
    : game?.version === 3 ? ['free_play_v3', 'exponential_v3']
    : game?.version === 4 ? ['free_play_v4', 'exponential_v3']
    : game?.version === 5 ? [V5_RULES_VERSION, V5_SCORE_MODEL_VERSION]
    : game?.version === 6 ? [V6_RULES_VERSION, V6_SCORE_MODEL_VERSION]
    : game?.version === 7 ? [V7_RULES_VERSION, V7_SCORE_MODEL_VERSION]
    : game?.version === 8 ? [V8_RULES_VERSION, V8_SCORE_MODEL_VERSION]
    : game?.version === 9 ? [V9_RULES_VERSION, V9_SCORE_MODEL_VERSION] : null;
  if (!versions || game.rulesVersion?.replaceAll('-', '_') !== versions[0] || game.scoreVersion?.replaceAll('-', '_') !== versions[1]) return null;
  return { rulesVersion: versions[0], scoreVersion: versions[1] };
}
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const readTile = tile => ({ id: tile.id, original: tile.original, face: tile.face, wild: tile.wild === true, entered: tile.entered === true });
const relics = (values, rulesVersion) => [...new Set((Array.isArray(values) ? values : []).filter(value => members(relicIdsForVersion(rulesVersion), value)))].sort();

function stateSummary(game, rulesVersion) {
  const formed = game.formed?.length ?? 0, kongs = game.kongs?.length ?? 0;
  return {
    phase: game.phase === 'settling' ? 'settlement' : game.phase,
    round_no: integer(game.round) + 1,
    formed_count: formed, structure_count: formed - kongs, kong_count: kongs,
    hand_count: game.hand?.length ?? 0, deck_count: game.deck?.length ?? 0, discard_count: game.discard?.length ?? 0,
    coins: integer(game.coins), ink: integer(game.ink), swaps: integer(game.swaps),
    total_score: integer(game.totalScore), round_score: integer(game.score), process_score: integer(game.processScore),
    round_start_score: integer(game.roundStartScore), target_score: Number.isSafeInteger(game.roundTarget) ? game.roundTarget : null,
    relic_ids: relics(game.relics, rulesVersion), single_count: integer(game.singleCount), wild_used: game.wildUsed === true || game.wildUsed === 1,
    ...([5,6,7,8,9].includes(game.version) ? { rescue_used: game.rescueUsed === true || game.rescueUsed === 1 } : {}),
    ...([7,8,9].includes(game.version) ? { formed_discard: game.formedDiscard == null ? null : {
      round_no: game.formedDiscard.round + 1, tile_ids: [...game.formedDiscard.tileIds],
    } } : {}),
  };
}

function tileChanges(before, after) {
  const a = new Map(), b = new Map();
  for (const zone of ['hand', 'formed']) {
    for (const tile of before?.[zone] ?? []) a.set(tile.id, { ...tile, zone });
    for (const tile of after?.[zone] ?? []) b.set(tile.id, { ...tile, zone });
  }
  const changes = [];
  for (const tileId of new Set([...a.keys(), ...b.keys()])) {
    const old = a.get(tileId), next = b.get(tileId);
    if (same(old, next)) continue;
    const from = old?.zone ?? (before?.deckIds.includes(tileId) ? 'deck' : null);
    const to = next?.zone ?? (after?.discardIds.includes(tileId) ? 'discard' : null);
    changes.push([tileId, from, to, old?.face ?? null, next?.face ?? (to === 'discard' ? old?.face : null) ?? null,
      old?.wild ?? null, next?.wild ?? (to === 'discard' ? old?.wild : null) ?? null,
      old?.entered ?? null, next?.entered ?? (to === 'discard' ? old?.entered : null) ?? null]);
  }
  return changes;
}

function patternIds(mode, patterns, rulesVersion) {
  if (!Array.isArray(patterns)) return null;
  const credited = [], unlocks = [];
  const catalog = gamePatternCatalog(rulesVersion);
  for (const pattern of patterns) {
    const name = typeof pattern === 'string' ? pattern : pattern?.name;
    const value = patternIdForName(mode, name, rulesVersion);
    if (!value) return null; // An unknown scored pattern is not silently lost.
    const entry = catalog.find(row => row.mode === mode && row.pattern_id === value);
    if (!entry) return null;
    (entry.kind === 'unlock' ? unlocks : credited).push(value);
  }
  return { credited: [...new Set(credited)].sort(), unlocks: [...new Set(unlocks)].sort() };
}
function groupKind(faces, shape) {
  if ((shape === 'orphans' || shape === 'unconnected') && faces.length === 14) return shape;
  if (shape === 'knitted' && faces.length === 9) return 'knitted';
  if (faces.length === 2) return 'pair';
  if (faces.length === 4) return 'kong';
  return faces.every(value => value === faces[0]) ? 'pung' : 'chow';
}
function rejectionCode(result, context) {
  if (label(context.reason_code ?? result?.reasonCode)) return context.reason_code ?? result.reasonCode;
  const reason = result?.reason;
  if (typeof reason !== 'string') return 'engine_rejected';
  for (const [pattern, code] of [
    [/墨不足/, 'insufficient_ink'], [/改牌次数已用完/, 'edit_limit'], [/改牌额度无效/, 'invalid_edit_budget'],
    [/成型弃除已使用/, 'formed_discard_used'],
    [/没有剩余换牌/, 'no_swaps'], [/需要持有/, 'missing_relic'],
    [/最多生成一张/, 'wild_limit'], [/没有变化/, 'unchanged_tile'], [/杠内|已声明杠/, 'locked_kong'],
    [/字牌不能/, 'honor_transform'], [/1～9/, 'rank_boundary'], [/请选择万/, 'invalid_suit'],
    [/四张.*杠|四张相同/, 'invalid_kong'], [/超过|最多 14/, 'capacity_exceeded'],
    [/填满 14/, 'incomplete_hand'], [/当前不在|本关已经结束|请先完成起手准备|只在起手准备阶段|改牌只在准备或组牌阶段|改牌只在准备阶段|补缺弃换仅在组牌阶段|成型弃除只在组牌阶段/, 'invalid_phase'],
    [/请选择|有效且不重复/, 'invalid_selection'], [/数值超出/, 'score_limit'],
    [/计算失败/, 'calculation_failed'], [/不支持/, 'unsupported_transform'],
  ]) if (pattern.test(reason)) return code;
  return 'engine_rejected';
}
function settlementPayload(game, result, quality, rulesVersion) {
  const v9 = rulesVersion === V9_RULES_VERSION;
  if (typeof result?.legal !== 'boolean' || !id(game.settlementId)) return null;
  const legal = v9 ? result.resultType === 'win' : result.legal;
  const structured = legal || (v9 && result.resultType === 'no_yaku');
  if (v9 && (!['win','false_win','no_yaku','incomplete'].includes(result.resultType) || result.legal !== structured)) return null;
  if (v9 && result.resultType === 'incomplete' && (game.hand?.length !== 0 || game.deck?.length !== 0 || game.formed.length - game.kongs.length >= 14)) return null;
  const decomposition = result.decomposition;
  const effective = new Map((decomposition?.tiles ?? []).map(tile => [tile.id, tile.face]));
  const kongs = (game.kongs ?? []).map(kong => ({ id: kong.id, tile_ids: [...kong.tileIds], face: kong.face }));
  const locked = new Map(kongs.flatMap(kong => kong.tile_ids.map(tileId => [tileId, kong.face])));
  const tiles = (game.formed ?? []).map(tile => ({
    id: tile.id, original: tile.original, face: tile.face, wild: tile.wild === true,
    effective_face: structured ? effective.get(tile.id) ?? (tile.wild ? null : tile.face) : locked.get(tile.id) ?? (tile.wild ? null : tile.face),
  }));
  let groups = null;
  if (structured && decomposition && Array.isArray(decomposition.groups) && Array.isArray(decomposition.groupTileIds)) {
    groups = decomposition.groups.map((group, index) => ({ type: groupKind(group, decomposition.shape), tile_ids: [...decomposition.groupTileIds[index]] }));
    if (decomposition.pair?.length) groups.push({ type: 'pair', tile_ids: [...decomposition.pairTileIds] });
  }
  const patterns = structured ? patternIds(game.mode, result.patterns, rulesVersion) : { credited: [], unlocks: [] };
  if (!patterns || (structured && !groups)) return null;
  const unlocks = [...patterns.unlocks];
  for (const gain of legal ? result.gains ?? [] : []) {
    if (gain.kind !== 'unlock') continue;
    if (['free_play_v3', 'free_play_v4', V5_RULES_VERSION, V6_RULES_VERSION, V7_RULES_VERSION, V8_RULES_VERSION, V9_RULES_VERSION].includes(rulesVersion)) {
      const patternId = patternIdForName(game.mode, gain.name, rulesVersion);
      const entry = gamePatternCatalog(rulesVersion).find(row => row.pattern_id === patternId && row.kind === 'unlock');
      if (!entry) return null; // Relic bonuses have distinct IDs from their base patterns.
      unlocks.push(patternId);
      continue;
    }
    if (gain.id === 'jiang' || gain.relicId === 'jiang' || gain.name === '将将胡') unlocks.push(`${game.mode}.all_258`);
    if (game.mode === 'riichi' && (gain.id === 'wheel' || gain.relicId === 'wheel' || gain.name === '大车轮')) unlocks.push('riichi.big_wheel');
    if (game.mode === 'riichi' && (gain.id === 'mountain' || gain.relicId === 'mountain' || gain.name === '三连刻')) unlocks.push('riichi.three_consecutive_pungs');
  }
  return {
    settlement_id: game.settlementId, round_no: integer(game.round) + 1, legal,
    result_type: result.resultType, passed: result.passed,
    process_score: game.processScore, win_score: result.total, penalty_score: result.penalty,
    score_delta: result.delta, round_score: game.score, round_start_score: game.roundStartScore,
    cumulative_before: result.cumulativeBefore, cumulative_after: result.cumulativeAfter, target_score: result.target,
    record_quality: quality, shape: structured ? decomposition.shape : null, tiles, declared_kongs: kongs,
    decomposition: structured ? { groups } : null, credited_pattern_ids: patterns.credited,
    unlock_pattern_ids: [...new Set(unlocks)].sort(), owned_relic_ids: relics(game.relics, rulesVersion),
  };
}

/** Separate instances are for isolated tests; production uses the exports below. */
export function createGameAdapter({ getClient = getGameAnalytics, now = Date.now, newId = uuid } = {}) {
  const observations = new Map(), emitted = new Map();
  const boundedSet = (map, key, value) => { map.set(key, value); if (map.size > 512) map.delete(map.keys().next().value); };
  const statusOf = () => { try { return getClient()?.getStatus() ?? {}; } catch { return {}; } };
  const allowed = status => status.consent === 'allowed' && status.coordination !== 'blocked' && !status.disposed;
  function capture(game) {
    try {
      const status = statusOf();
      const versions = gameVersions(game);
      if (!versions) return null;
      return freeze({
        captureId: newId(), capturedAt: now(), runId: game.runId, roundId: game.roundId ?? null,
        settlementId: game.settlementId ?? null, settledId: game.last?.settlementId ?? (game.last?.resultType ? game.settlementId : null),
        ...versions, mode: game.mode, state: stateSummary(game, versions.rulesVersion), hand: (game.hand ?? []).map(readTile), formed: (game.formed ?? []).map(readTile),
        deckIds: (game.deck ?? []).map(tile => tile.id), discardIds: (game.discard ?? []).map(tile => tile.id),
        selected: (game.selected ?? []).filter(id), generation: status.collectionGeneration,
        observing: allowed(status), dropped: status.dropped ?? 0,
      });
    } catch { return null; }
  }
  function quality(snapshot, status) {
    const record = observations.get(keyOf(snapshot));
    return record && record.generation === status.collectionGeneration && record.dropped === (status.dropped ?? 0) && allowed(status) ? 'complete' : 'partial';
  }
  async function track(action, before, game, result, context = {}) {
    try {
      if (!members(GAME_ACTIONS, action) || !gameVersions(game)) return { queued: false, reason: 'unsupported_action_or_game' };
      const client = getClient();
      if (!client) return { queued: false, reason: 'unavailable' };
      const status = client.getStatus();
      if (!allowed(status)) { observations.clear(); return { queued: false, reason: 'consent_required' }; }
      const after = capture(game);
      if (!after || !id(after.runId)) return { queued: false, reason: 'missing_game_identity' };
      const envelope = { mode: game.mode, run_id: after.runId, round_attempt_id: after.roundId,
        hand_id: null, app_release: after.rulesVersion.replaceAll('_', '-'), rules_version: after.rulesVersion, score_model_version: after.scoreVersion };
      const records = [], invalid = [];
      const add = (name, payload, eventKey, extra = {}) => {
        const env = { ...envelope, ...extra, occurred_at: new Date(before?.capturedAt ?? now()).toISOString() };
        const checked = validateGamePayload(name, payload, env);
        if (!checked.ok) { invalid.push({ event: name, reason: checked.reason }); return; }
        records.push({ name, payload: checked.payload, key: eventKey, context: env });
      };
      const changed = !same(before?.state, after.state) || !same(before?.hand, after.hand) || !same(before?.formed, after.formed);
      const refused = result === false || result?.valid === false || result?.ok === false;
      const success = !refused && (changed || ['start','resume','select','settlement_skip','settlement_complete'].includes(action));
      const newRound = ['starter','next_round','start'].includes(action) && success && after.roundId && before?.roundId !== after.roundId && after.state.phase === ([5,6,7,8,9].includes(game.version) ? 'prepare' : 'play');
      // V9 starts its first round directly. A fresh start observed synchronously
      // under allowed consent needs no fictitious starter action; resume never
      // qualifies and an explicitly unobserved before-snapshot stays partial.
      const freshStart = game.version === 9 && action === 'start' && before == null;
      if (newRound && (freshStart || (before?.observing && before.generation === status.collectionGeneration))) boundedSet(observations, keyOf(after), { generation: status.collectionGeneration, dropped: status.dropped ?? 0 });
      let recordQuality = quality(after, status);
      const actionId = id(context.action_id) && context.action_id.length >= 8 ? context.action_id : `action.${before?.captureId ?? newId()}.${action}`.slice(0, 100);
      let changes = before?.runId === after.runId && before?.roundId === after.roundId ? tileChanges(before, after) : [];
      const selected = context.selected_tile_ids ?? context.selectedIds ?? context.tileIds ?? context.ids ?? (action === 'select' ? after.selected : before?.selected) ?? [];
      const selectedIds = [...new Set(Array.isArray(selected) ? selected.filter(id) : [])];
      const requestedZone = context.source_zone ?? context.sourceZone;
      const inferredZone = Array.isArray(selected) && selected.length ? ['hand','formed'].find(zone => selected.every(tileId => before?.[zone]?.some(tile => tile.id === tileId))) : null;
      const requestedRescue = context.rescue_type ?? context.rescue_kind ?? context.type;
      const rescueType = action === 'high_rescue' && ['exchange','rank','suit'].includes(requestedRescue) ? requestedRescue : null;
      const replacedRelic = context.replace_relic_id ?? context.replaced_relic_id ?? context.replaceId;
      const transformAction = action === 'transform' || (action === 'high_rescue' && ['rank','suit'].includes(rescueType));
      const transformKind = context.transform_kind ?? context.kind ?? context.transformKind ?? rescueType;
      const actionContext = {
        source_zone: ['hand','formed'].includes(requestedZone) ? requestedZone : inferredZone ?? null,
        transform_kind: transformAction && ['rank','suit','wild'].includes(transformKind) ? transformKind : null,
        transform_value: transformAction ? context.transform_value ?? context.value ?? context.arg ?? null : null,
        relic_id: members(relicIdsForVersion(after.rulesVersion), context.relic_id ?? context.relicId ?? context.id) ? context.relic_id ?? context.relicId ?? context.id : null,
        ...([5,6,7,8,9].includes(game.version) ? {
          rescue_type: rescueType,
          replace_relic_id: action === 'reward' && members(relicIdsForVersion(after.rulesVersion), replacedRelic) ? replacedRelic : null,
        } : {}),
      };
      // V7/V8 own the fixed-rank wild ability on the high-fan core. The app's
      // ordinary edit context has no relic ID; rejected attempts use the same
      // ability source without claiming the player owns that core.
      if ([7,8].includes(game.version) && action === 'transform' && actionContext.transform_kind === 'wild') actionContext.relic_id = 'core_high';
      if (game.version === 9 && action === 'transform' && actionContext.transform_kind === 'wild') actionContext.relic_id = 'wild_jade';
      if (!actionContext.transform_kind || actionContext.transform_kind === 'wild') actionContext.transform_value = null;
      // A new-version action cannot validate an old-version hand/resource limit.
      // Preserve the old snapshot in its separately versioned superseded event.
      const sameVersion = before?.rulesVersion === after.rulesVersion && before?.scoreVersion === after.scoreVersion;
      const payload = { action_id: actionId, action, input_method: ['pointer','keyboard','programmatic'].includes(context.input_method) ? context.input_method : 'programmatic',
        outcome: refused ? 'rejected' : success ? 'applied' : 'noop', reason_code: refused ? rejectionCode(result, context) : null,
        before: sameVersion ? before.state : null, after: after.state, selected_tile_ids: selectedIds.slice(0,18),
        tile_changes: changes.slice(0,36), evidence_truncated: changes.length > 36 || selectedIds.length > 18, context: actionContext };
      // Reserve envelope/UUID overhead. Cropping applies only to action evidence,
      // never to final settlement evidence or score facts.
      while (new TextEncoder().encode(JSON.stringify(payload)).length > 6500 && payload.tile_changes.length) { payload.tile_changes.pop(); payload.evidence_truncated = true; }
      add('game_action', payload, actionId);
      if (invalid.length) { observations.delete(keyOf(after)); recordQuality = 'partial'; }
      if (action === 'start' && success) {
        if (before?.runId && before.runId !== after.runId && ['starter','prepare','play','settlement','reward','shop'].includes(before.state.phase)) {
          add('run_ended', { state: before.state, record_quality: quality(before, status), reason: 'superseded' }, `ended.${before.runId}`,
            { mode: before.mode, run_id: before.runId, round_attempt_id: before.roundId,
              app_release: before.rulesVersion.replaceAll('_', '-'), rules_version: before.rulesVersion, score_model_version: before.scoreVersion });
        }
        add('run_started', { state: after.state, record_quality: 'complete' }, `run.${after.runId}`);
      }
      if (action === 'resume' && success) add('run_resumed', { state: after.state, record_quality: recordQuality, source: context.source === 'memory' ? 'memory' : 'save' }, actionId + '.resume');
      if (newRound) add('round_started', { state: after.state, record_quality: recordQuality }, `round.${after.roundId}`);
      const settled = action === 'settle' && !refused && after.settledId && before?.settledId !== after.settledId;
      if (settled) {
        const fact = settlementPayload(game, game.last ?? result, recordQuality, after.rulesVersion);
        if (fact) {
          add('round_settled', fact, `settlement.${after.settledId}`, { hand_id: after.settledId });
          if (fact.legal) add('hand_completed', fact, `hand.${after.settledId}`, { hand_id: after.settledId });
        } else invalid.push({ event: 'round_settled', reason: 'incomplete_engine_result' });
      }
      const terminalTransition = ['settle','settlement_skip','settlement_complete','settlement_continue'].includes(action) && before?.state.phase !== after.state.phase && ['defeat','victory'].includes(after.state.phase);
      if (success && ((action === 'retire') || terminalTransition)) {
        const outcomeReason = game.version === 9 && ['no_yaku','incomplete'].includes(game.last?.resultType) ? `${game.last.resultType}_below_target` : game.last?.legal ? 'completed_below_target' : 'false_win_below_target';
        const reason = action === 'retire' ? 'retired' : after.state.phase === 'victory' ? 'victory' : outcomeReason;
        add('run_ended', { state: after.state, record_quality: recordQuality, reason }, `ended.${after.runId}`);
      }
      const outcomes = [];
      for (const record of records) {
        // Lifecycle IDs derive from persistent engine identities. Common IDs fit
        // directly; hash only the rare long key rather than truncating uniqueness.
        if (record.key.length <= 100) record.context.event_id = record.key;
        else {
          const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(record.key));
          record.context.event_id = `game.${Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('')}`;
        }
        const currentStatus = client.getStatus();
        if (!allowed(currentStatus) || currentStatus.collectionGeneration !== status.collectionGeneration) {
          observations.clear();
          outcomes.push({ queued: false, reason: 'consent_changed', event: record.name });
          break; // Never re-inject pre-withdrawal facts into a later consent epoch.
        }
        if (emitted.has(record.key)) { outcomes.push({ queued: false, reason: 'already_observed', event: record.name }); continue; }
        // Cache a pending promise before yielding so duplicate UI callbacks cannot
        // enqueue the same transition twice. Failed enqueue can be retried.
        const pending = Promise.resolve(client.track(record.name, record.payload, record.context));
        boundedSet(emitted, record.key, pending);
        let outcome;
        try { outcome = await pending; } catch { outcome = { queued: false, reason: 'collector_error' }; }
        if (!outcome?.queued) { emitted.delete(record.key); observations.delete(keyOf(after)); }
        outcomes.push({ ...outcome, event: record.name });
      }
      return { queued: outcomes.some(outcome => outcome.queued), events: outcomes, invalid };
    } catch { return { queued: false, reason: 'adapter_error' }; }
  }
  return { captureGameState: capture, trackGameAction: track };
}

const adapter = createGameAdapter();
export const captureGameState = adapter.captureGameState;
export const trackGameAction = adapter.trackGameAction;
