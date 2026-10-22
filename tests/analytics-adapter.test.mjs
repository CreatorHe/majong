import test from 'node:test';
import assert from 'node:assert/strict';
import { createGameAdapter } from '../dist/analytics/game-adapter.js';
import { validateGamePayload } from '../dist/analytics/game-schema.js';
import * as engine from '../dist/engine.js';

function harness() {
  const events = [], status = { consent: 'allowed', collectionGeneration: 1, coordination: 'owner', dropped: 0 };
  const client = { getStatus: () => ({ ...status }), track: async (name, payload, context) => {
    assert.equal(validateGamePayload(name, payload, context).ok, true, `${name} must satisfy the server's shared schema`);
    events.push({ name, payload, context }); return { queued: true, durable: true };
  } };
  const adapter = createGameAdapter({ getClient: () => client });
  const act = async (action, game, perform, context) => {
    const before = adapter.captureGameState(game), result = perform();
    const outcome = await adapter.trackGameAction(action, before, game, result, context);
    assert.deepEqual(outcome.invalid ?? [], [], `${action}: ${JSON.stringify(outcome.invalid)}`);
    return { before, result, outcome };
  };
  return { events, status, client, adapter, act };
}
async function prepared(h, mode = 'mcr') {
  const s = engine.newRun(mode, 1234);
  await h.adapter.trackGameAction('start', null, s, s);
  return s;
}
async function started(h, mode = 'mcr') {
  const s = await prepared(h, mode);
  await h.act('begin_play', s, () => engine.beginPlay(s));
  return s;
}
const ordinary = [0,1,2,0,1,2,3,4,5,6,7,8,4,4];
const invalid = [27,27,27,27,28,28,28,28,29,29,29,29,30,31];
function arrange(s, faces, kongFaces = []) {
  const pool = [...s.hand, ...s.formed, ...s.deck, ...s.discard];
  s.formed = faces.map(face => {
    const index = pool.findIndex(tile => tile.face === face);
    assert.ok(index >= 0, `fixture tile ${face} exists`);
    return { ...pool.splice(index, 1)[0], entered: true };
  });
  s.kongs = kongFaces.map((face, i) => ({ id: `${s.roundId}:kong:${i}`, face, tileIds: s.formed.filter(tile => tile.face === face).slice(0,4).map(tile => tile.id) }));
  s.hand = pool.splice(0, s.version === 9 ? 9 : s.version >= 4 ? 12 : s.version === 3 ? 10 : 18); s.deck = pool; s.discard = [];
}
function stageCandidates(s, faces) {
  const pool = [...s.hand, ...s.deck];
  const tiles = faces.map(face => {
    const index = pool.findIndex(tile => tile.face === face);
    assert.ok(index >= 0, `candidate fixture tile ${face} exists`);
    return pool.splice(index, 1)[0];
  });
  s.hand = tiles.slice(0, 9);
  s.deck = [...pool, ...tiles.slice(9).reverse()];
  return tiles.map(t => t.id);
}
async function commitStaged(h, s, ids) {
  await h.act('begin_play', s, () => engine.beginPlay(s));
  for (const selected of [ids.slice(0,9), ids.slice(9)]) {
    if (selected.length) await h.act('commit', s, () => engine.commit(s, selected), {selected_tile_ids:selected});
  }
}

test('snapshot is immutable, null-safe, contains no deck faces and never mutates the game', async () => {
  const h = harness(), s = await started(h);
  assert.equal(h.adapter.captureGameState(null), null);
  const original = JSON.stringify(s), before = h.adapter.captureGameState(s);
  assert.ok(Object.isFrozen(before) && Object.isFrozen(before.hand[0]));
  assert.equal(before.deck, undefined);
  assert.ok(before.deckIds.every(value => typeof value === 'string'));
  assert.equal(JSON.stringify(s), original);
  s.hand[0].face = 33;
  assert.notEqual(before.hand[0].face, s.hand[0].face);
});

test('nine-tile batches discard unselected candidates without process gain or duplicate callbacks', async () => {
  const h = harness(), s = await started(h);
  const tileId = s.hand[0].id;
  const { before, result } = await h.act('commit', s, () => engine.commit(s, [tileId]), { selected_tile_ids: [tileId] });
  await h.adapter.trackGameAction('commit', before, s, result, { selected_tile_ids: [tileId] });
  const commits = h.events.filter(e => e.name === 'game_action' && e.payload.action === 'commit');
  assert.equal(commits.length, 1);
  assert.equal(commits[0].payload.after.process_score, 0);
  assert.ok(commits[0].payload.tile_changes.some(t => t[0] === tileId && t[1] === 'hand' && t[2] === 'formed'));
  const { before: prior, after: next, tile_changes: changes } = commits[0].payload;
  assert.equal(prior.hand_count, 9); assert.equal(next.hand_count, 9);
  assert.equal(136 - prior.deck_count, 9); assert.equal(136 - next.deck_count, 18);
  assert.equal(next.swaps, 5); assert.equal(prior.swaps, next.swaps);
  assert.equal(next.discard_count - prior.discard_count, 8);
  assert.equal(changes.filter(t => t[1] === 'deck' && t[2] === 'hand').length, 9);
  assert.equal(changes.filter(t => t[1] === 'hand' && t[2] === 'discard').length, 8);
  assert.equal(changes.length, 18);
  await h.act('commit', s, () => engine.commit(s, [tileId]), { selected_tile_ids: [tileId], reason_code: 'tile_not_in_hand' });
  assert.equal(s.totalScore, 0);
  assert.equal(h.events.at(-1).payload.outcome, 'rejected');
  assert.equal(h.events.at(-1).payload.before.process_score, h.events.at(-1).payload.after.process_score);
  assert.equal(h.events.filter(e => e.name === 'hand_completed').length, 0);
});

test('legal win emits identical terminal facts once; skip/complete only display lifecycle', async () => {
  for (const mode of ['mcr', 'riichi']) {
  const h = harness(), s = await started(h, mode);
  arrange(s, ordinary);
  const { before, result } = await h.act('settle', s, () => engine.settle(s));
  assert.equal(result.legal, true);
  const terminal = h.events.filter(e => ['round_settled','hand_completed'].includes(e.name));
  assert.equal(terminal.length, 2);
  assert.deepEqual(terminal[0].payload, terminal[1].payload);
  assert.equal(terminal[0].payload.record_quality, 'complete');
  assert.equal(terminal[0].payload.settlement_id, s.settlementId);
  assert.equal(terminal[0].payload.win_score, result.total);
  assert.deepEqual(terminal[0].payload.owned_relic_ids, ['rank_brush']);
  assert.equal(result.base, 1000);
  assert.equal(result.total, 1000 * engine.fanMultiplier(mode, result.fans));
  assert.equal(terminal[0].payload.process_score, 0); assert.equal(s.coins, 0);
  assert.equal('steps' in terminal[0].payload, false);
  await h.adapter.trackGameAction('settle', before, s, result);
  await h.act('settle', s, () => engine.settle(s));
  await h.act('settlement_skip', s, () => engine.finishSettlement(s));
  await h.act('settlement_complete', s, () => engine.finishSettlement(s));
  assert.equal(h.events.filter(e => e.name === 'hand_completed').length, 1);
  assert.equal(h.events.filter(e => e.name === 'round_settled').length, 1);
  }
});

test('legal below-target remains a hand; terminal failure is recorded after playback', async () => {
  const h = harness(), s = await started(h);
  arrange(s, ordinary); s.roundTarget = Number.MAX_SAFE_INTEGER;
  await h.act('settle', s, () => engine.settle(s));
  const hand = h.events.find(e => e.name === 'hand_completed');
  assert.equal(hand.payload.legal, true); assert.equal(hand.payload.passed, false);
  assert.equal(h.events.some(e => e.name === 'run_ended'), false);
  await h.act('settlement_complete', s, () => true);
  assert.equal(h.events.some(e => e.name === 'run_ended'), false);
  await h.act('settlement_continue', s, () => engine.finishSettlement(s));
  assert.equal(h.events.at(-1).name, 'run_ended');
  assert.equal(h.events.at(-1).payload.reason, 'completed_below_target');
});

test('v9 aliases normalize while v2 through v8 snapshots and superseded runs retain their original version', async () => {
  for (const [version, rulesVersion, scoreVersion, handCount] of [
    [2, 'free-play-v2', 'cumulative-v2', 18], [3, 'free-play-v3', 'exponential-v3', 10],
    [4, 'free-play-v4', 'exponential-v3', 12],
    [5, 'opening-build-v5', 'four-core-v5', 12],
    [6, 'opening-build-v6', 'four-core-v6', 12],
    [7, 'opening-build-v7', 'four-core-v6', 12],
    [8, 'opening-build-v8', 'four-core-v6', 12],
  ]) {
    const h = harness(), s = await started(h);
    assert.equal(h.events.at(-1).context.rules_version, 'nine_batch_v9');
    assert.equal(h.events.at(-1).context.score_model_version, 'fan_score_v9');
    const old = { ...structuredClone(s), version, rulesVersion, scoreVersion, ink: version >= 6 ? 2 : 4, swaps:0,
      relics: version >= 7 ? ['core_high', 'rank_brush'] : version >= 5 ? ['core_high', 'wild_jade'] : ['jade'] };
    if (old.hand.length < handCount) old.hand.push(...old.deck.splice(0, handCount - old.hand.length));
    else old.deck.push(...old.hand.splice(handCount));
    const oldSnapshot = h.adapter.captureGameState(old);
    assert.equal(oldSnapshot.rulesVersion, rulesVersion.replaceAll('-', '_'));
    const next = engine.newRun('riichi', 1234);
    const result = await h.adapter.trackGameAction('start', oldSnapshot, next, next);
    assert.deepEqual(result.invalid, []);
    const superseded = h.events.find(e => e.name === 'run_ended' && e.payload.reason === 'superseded');
    assert.equal(superseded.context.rules_version, rulesVersion.replaceAll('-', '_'));
    assert.equal(superseded.context.score_model_version, scoreVersion.replaceAll('-', '_'));
    assert.equal(superseded.payload.state.hand_count, handCount);
    assert.equal(h.events.filter(e => e.name === 'game_action').at(-1).payload.before, null);
    assert.equal(superseded.payload.state.ink, old.ink, 'old resource amounts are not rewritten as V9');
    assert.equal('formed_discard' in superseded.payload.state, version >= 7);
    if ([5,6].includes(version)) assert.ok(superseded.payload.state.relic_ids.includes('wild_jade'));
    s.rulesVersion = 'nine_batch_v9'; s.scoreVersion = 'fan_score_v9';
    assert.equal(h.adapter.captureGameState(s).scoreVersion, 'fan_score_v9');
    const before = h.adapter.captureGameState(s), count = h.events.length;
    s.scoreVersion = 'four-core-v5';
    assert.equal(h.adapter.captureGameState(s), null);
    assert.equal((await h.adapter.trackGameAction('select', before, s, true)).queued, false);
    assert.equal(h.events.length, count);
  }
});

for (const [start, passed] of [[1200,true],[1100,true],[1000,false],[0,false],[Number.MAX_SAFE_INTEGER,true]]) {
  test(`false win at ${start} can pass or fail independently and never becomes a hand`, async () => {
    const h = harness(), s = await started(h);
    arrange(s, invalid); s.roundTarget = 1000; s.roundStartScore = start; s.totalScore = start;
    await h.act('settle', s, () => engine.settle(s));
    const fact = h.events.find(e => e.name === 'round_settled').payload;
    assert.equal(fact.legal, false); assert.equal(fact.passed, passed);
    assert.equal(fact.penalty_score, 100); assert.equal(fact.round_score, -100);
    assert.equal(fact.cumulative_after, start - 100);
    assert.deepEqual(fact.credited_pattern_ids, []);
    assert.equal(h.events.some(e => e.name === 'hand_completed'), false);
  });
}

test('current special structures preserve every tile and stable credited pattern', async () => {
  const orphans = [0,8,9,17,18,26,27,28,29,30,31,32,33,33];
  for (const [mode, faces, shape, patternId, kongFaces] of [
    ['riichi', orphans, 'orphans', 'riichi.thirteen_orphans', []],
    ['mcr', orphans, 'orphans', 'mcr.thirteen_orphans', []],
    ['mcr', [0,3,6,10,13,16,20,23,26,27,27,27,31,31], 'knitted', 'mcr.knitted_straight', []],
    ['mcr', [0,3,6,10,13,16,20,23,26,27,27,27,27,31,31], 'knitted', 'mcr.knitted_straight', [27]],
    ['mcr', [0,3,6,10,13,16,20,27,28,29,30,31,32,33], 'unconnected', 'mcr.greater_honors_and_knitted_tiles', []],
    ['mcr', [0,3,6,10,13,16,20,23,26,27,28,29,30,31], 'unconnected', 'mcr.lesser_honors_and_knitted_tiles', []],
    ['mcr', [0,0,0,0,10,10,13,13,18,18,23,23,31,31], 'pairs', 'mcr.seven_pairs', []],
  ]) {
    const h = harness(), s = await started(h, mode);
    arrange(s, faces, kongFaces);
    const { result } = await h.act('settle', s, () => engine.settle(s));
    assert.equal(result.legal, true, patternId);
    const fact = h.events.find(e => e.name === 'hand_completed')?.payload;
    assert.ok(fact, patternId);
    assert.equal(fact.shape, shape, patternId);
    assert.ok(fact.credited_pattern_ids.includes(patternId), patternId);
    assert.equal(fact.tiles.length, 14 + kongFaces.length);
    assert.equal(fact.decomposition.groups.flatMap(group => group.tile_ids).length, fact.tiles.length);
  }
});

for (const k of [1,4]) test(`${k} declared kongs preserve ${14+k} physical tiles and exact decomposition`, async () => {
  const h = harness(), s = await started(h);
  const faces = k === 1 ? [0,0,0,0,1,2,3,4,5,6,9,10,11,31,31] : [0,0,0,0,1,1,1,1,2,2,2,2,3,3,3,3,31,31];
  arrange(s, faces, k === 1 ? [0] : [0,1,2,3]);
  await h.act('settle', s, () => engine.settle(s));
  const fact = h.events.find(e => e.name === 'hand_completed').payload;
  assert.equal(fact.tiles.length, 14+k); assert.equal(fact.declared_kongs.length, k);
  assert.equal(fact.decomposition.groups.filter(g => g.type === 'kong').length, k);
});

test('wildcard effective face comes from the real result and its V9 source is wild_jade', async () => {
  const h = harness(), s = await prepared(h, 'riichi');
  const ids = stageCandidates(s, [1,10,12,12,14,14,18,18,21,21,26,26,31,31]);
  s.relics.push('wild_jade');
  await h.act('transform', s, () => engine.transform(s, [ids[0]], 'wild'), {
    selected_tile_ids:[ids[0]], transform_kind:'wild',
  });
  assert.equal(h.events.at(-1).payload.context.relic_id, 'wild_jade');
  await commitStaged(h, s, ids);
  await h.act('settle', s, () => engine.settle(s));
  const fact = h.events.find(e => e.name === 'hand_completed').payload;
  const wild = fact.tiles.find(t => t.wild);
  assert.equal(wild.face, 1); assert.equal(wild.effective_face, 10);
  assert.deepEqual(fact.unlock_pattern_ids, []);
  assert.ok(fact.credited_pattern_ids.includes('riichi.seven_pairs'));
  assert.equal(fact.shape, 'pairs');
});

test('V9 base patterns remain available without historical scoring relics or bonus IDs', async () => {
  for (const [faces, baseId] of [
    [[10,10,11,11,12,12,13,13,14,14,15,15,16,16], 'mcr.seven_shifted_pairs'],
    [[0,0,0,1,1,1,2,2,2,12,13,14,31,31], 'mcr.pure_shifted_pungs'],
  ]) {
    const h = harness(), s = await started(h);
    arrange(s, faces);
    await h.act('settle', s, () => engine.settle(s));
    const fact = h.events.find(e => e.name === 'hand_completed')?.payload;
    assert.ok(fact, baseId);
    assert.ok(fact.credited_pattern_ids.includes(baseId));
    assert.deepEqual(fact.unlock_pattern_ids, []);
  }
});

test('mid-prepare/play consent, revoked/reallowed consent and fresh reload stay partial', async () => {
  for (const kind of ['prepare','mid','reallow','reload']) {
    const h = harness(); if (['prepare','mid'].includes(kind)) h.status.consent = 'denied';
    const s = kind === 'prepare' ? await prepared(h) : await started(h);
    if (kind === 'reload') h.adapter = createGameAdapter({ getClient: () => h.client });
    if (['prepare','mid','reallow'].includes(kind)) { h.status.consent = 'allowed'; h.status.collectionGeneration++; }
    if (kind === 'prepare') await h.act('begin_play', s, () => engine.beginPlay(s));
    arrange(s, ordinary);
    const before = h.adapter.captureGameState(s), result = engine.settle(s);
    await h.adapter.trackGameAction('settle', before, s, result);
    const fact = h.events.find(e => e.name === 'hand_completed').payload;
    assert.equal(fact.record_quality, 'partial', kind);
  }
});

test('resume does not manufacture a start, round start or previously saved settlement', async () => {
  const s = engine.newRun('mcr', 1234); engine.beginPlay(s); arrange(s, ordinary); engine.settle(s);
  const h = harness();
  await h.adapter.trackGameAction('resume', null, s, true, { source: 'save' });
  assert.deepEqual(h.events.map(e => e.name), ['game_action','run_resumed']);
  await h.act('settle', s, () => engine.settle(s));
  assert.equal(h.events.some(e => e.name === 'round_settled'), false);
});

test('snapshot, consent and collector failures cannot throw into gameplay', async () => {
  const broken = createGameAdapter({ getClient: () => { throw Error('unavailable'); } });
  assert.equal(broken.captureGameState(null), null);
  assert.equal((await broken.trackGameAction('start', null, { version:2 }, true)).queued, false);
  const h = harness(), s = await started(h); h.status.consent = 'denied';
  const before = h.adapter.captureGameState(s); engine.commit(s, [s.hand[0].id]);
  const count = h.events.length;
  assert.equal((await h.adapter.trackGameAction('commit', before, s, true)).queued, false);
  assert.equal(h.events.length, count);
});

test('withdraw and reallow during asynchronous action enqueue cannot revive earlier terminal facts', async () => {
  const h = harness(), s = await started(h);
  arrange(s, ordinary);
  const before = h.adapter.captureGameState(s), result = engine.settle(s);
  let release;
  h.client.track = async () => new Promise(resolve => { release = resolve; });
  const pending = h.adapter.trackGameAction('settle', before, s, result);
  h.status.collectionGeneration += 2; // withdrawn, then allowed again before first track resolves
  release({ queued: false, reason: 'consent_required' });
  const outcome = await pending;
  assert.ok(outcome.events.some(event => event.reason === 'consent_changed'));
  assert.equal(h.events.some(event => event.name === 'hand_completed'), false);
  assert.equal(h.events.some(event => event.name === 'round_settled'), false);
});

test('prepare records real resources and begin_play starts no duplicate round or score fact', async () => {
  const h = harness(), s = await prepared(h);
  const round = h.events.find(e => e.name === 'round_started');
  assert.equal(round.payload.state.phase, 'prepare');
  assert.equal(round.payload.state.swaps, 5);
  assert.equal(round.payload.state.ink, 2);
  assert.deepEqual(round.payload.state.relic_ids, ['rank_brush']);
  assert.equal(round.payload.state.hand_count, 9);
  assert.equal(h.events.filter(e => e.name === 'run_started').length, 1);
  assert.equal(h.events.some(e => e.name === 'game_action' && e.payload.action === 'starter'), false);
  assert.equal(round.payload.record_quality, 'complete');
  s.relics.push('high_rescue');
  const tile = s.hand.find(t => t.face < 27 && t.face % 9 < 8);
  const originalFace = tile.face, tileId = tile.id;
  await h.act('transform', s, () => engine.transform(s, [tileId], 'rank', 1), {
    selected_tile_ids:[tileId], source_zone:'hand', transform_kind:'rank', transform_value:1, relic_id:'rank_brush',
  });
  let action = h.events.at(-1).payload;
  assert.equal(action.after.ink - action.before.ink, -2);
  assert.equal(action.context.transform_kind, 'rank');
  assert.ok(action.tile_changes.some(t => t[0] === tileId && t[3] === originalFace && t[4] === originalFace + 1));
  const outgoing = s.hand.slice(0, 5).map(t => t.id);
  await h.act('exchange', s, () => engine.exchange(s, outgoing), {selected_tile_ids:outgoing});
  action = h.events.at(-1).payload;
  assert.equal(action.after.swaps - action.before.swaps, -1);
  assert.equal(action.before.deck_count - action.after.deck_count, 5);
  assert.equal(action.tile_changes.filter(t => t[1] === 'hand' && t[2] === 'discard').length, 5);
  const prepareRescueId = s.hand.find(t => t.face < 27 && t.face % 9 < 8).id;
  await h.act('high_rescue', s, () => engine.highRescue(s, {type:'rank', ids:[prepareRescueId], arg:1}), {
    selected_tile_ids:[prepareRescueId], rescue_kind:'rank', transform_kind:'rank', transform_value:1,
  });
  assert.equal(h.events.at(-1).payload.reason_code, 'edit_limit');
  assert.equal(h.events.at(-1).payload.after.rescue_used, false);
  await h.act('begin_play', s, () => engine.beginPlay(s));
  action = h.events.at(-1).payload;
  assert.equal(action.before.phase, 'prepare'); assert.equal(action.after.phase, 'play');
  assert.equal(action.before.swaps, 4); assert.equal(action.after.swaps, 4);
  assert.equal(action.before.ink, 0); assert.equal(action.after.ink, 0, 'begin_play does not refill the shared edit budget');
  assert.equal(h.events.filter(e => e.name === 'round_started').length, 1);
  const rescueId = s.hand.find(t => t.face < 27 && t.face % 9 < 8).id;
  await h.act('high_rescue', s, () => engine.highRescue(s, {type:'rank', ids:[rescueId], arg:1}), {
    selected_tile_ids:[rescueId], rescue_kind:'rank', transform_kind:'rank', transform_value:1,
  });
  action = h.events.at(-1).payload;
  assert.equal(action.outcome, 'rejected');
  assert.equal(action.reason_code, 'invalid_phase');
  assert.equal(action.before.ink, 0); assert.equal(action.after.ink, 0);
  assert.equal(action.after.rescue_used, false, 'a rejected rescue edit does not consume the rescue');
  for (const count of [1,2,3,5]) {
    const ids = s.hand.slice(0,count).map(t => t.id);
    await h.act('exchange', s, () => engine.exchange(s, ids), {selected_tile_ids:ids});
    const exchange = h.events.at(-1).payload;
    assert.equal(exchange.outcome, 'applied');
    assert.equal(exchange.before.swaps - exchange.after.swaps, 1);
    assert.equal(exchange.before.deck_count - exchange.after.deck_count, count);
    assert.equal(exchange.before.ink, exchange.after.ink);
    assert.equal(s.swaps + s.openingSwapsUsed, 5);
  }
  assert.equal(s.swaps, 0); assert.equal(s.openingSwapsUsed, 5);
  assert.ok(engine.restore(JSON.stringify(s)), 'spent ordinary exchanges survive a play-phase save');
  for (const [name, perform, context] of [
    ['exchange', () => engine.exchange(s, [s.hand[0].id]), { selected_tile_ids: [s.hand[0].id] }],
    ['transform', () => engine.transform(s, [s.hand[0].id], 'rank', 1), {selected_tile_ids:[s.hand[0].id], transform_kind:'rank', transform_value:1}],
    ['replace', () => engine.replaceFormed(s, [], []), {}],
    ['buy', () => engine.buy(s, 'jade'), {relic_id:'jade'}],
  ]) {
    await h.act(name, s, perform, context);
    action = h.events.at(-1).payload;
    assert.equal(action.outcome, 'rejected');
    assert.deepEqual(action.before, action.after);
    assert.deepEqual(action.tile_changes, []);
  }
  assert.equal(h.events.some(e => ['round_settled','hand_completed'].includes(e.name)), false);
});

test('real app rescue contexts preserve the single rescue and its actual exchange or transform', async () => {
  for (const kind of ['exchange', 'rank', 'suit']) {
    const h = harness(), s = await prepared(h);
    s.relics.push('high_rescue');
    const tile = s.hand.find(t => t.face < 27 && t.face % 9 < 8);
    if (kind === 'exchange') await h.act('begin_play', s, () => engine.beginPlay(s));
    const ids = kind === 'exchange' ? s.hand.slice(0, 3).map(t => t.id) : [tile.id];
    const arg = kind === 'rank' ? 1 : kind === 'suit' ? (Math.floor(tile.face / 9) + 1) % 3 : undefined;
    const context = {selected_tile_ids:ids, rescue_kind:kind,
      ...(kind !== 'exchange' ? {transform_kind:kind, transform_value:arg} : {})};
    await h.act('high_rescue', s, () => engine.highRescue(s, {type:kind, ids, arg}), context);
    const action = h.events.at(-1).payload;
    assert.equal(action.outcome, 'applied');
    assert.equal(action.context.rescue_type, kind);
    assert.equal(action.context.transform_kind, kind === 'exchange' ? null : kind);
    assert.equal(action.context.source_zone, 'hand');
    assert.equal(action.before.rescue_used, false); assert.equal(action.after.rescue_used, true);
    assert.equal(action.after.swaps, action.before.swaps);
    assert.equal(action.after.ink - action.before.ink, kind === 'exchange' ? 0 : -2);
    assert.equal(action.before.deck_count - action.after.deck_count, kind === 'exchange' ? 3 : 0);
    assert.equal(action.tile_changes.length, kind === 'exchange' ? 6 : 1);
    assert.ok(engine.restore(JSON.stringify(s)), 'a consumed rescue restores in its actual phase');
    await h.act('high_rescue', s, () => engine.highRescue(s, {type:kind, ids, arg}), context);
    const rejected = h.events.at(-1).payload;
    assert.equal(rejected.outcome, 'rejected');
    assert.deepEqual(rejected.before, rejected.after);
    assert.deepEqual(rejected.tile_changes, []);
    const ordinaryEditId = s.hand.find(t => t.face < 27 && t.face % 9 < 8).id;
    await h.act('transform', s, () => engine.transform(s, [ordinaryEditId], 'rank', 1), {
      selected_tile_ids:[ordinaryEditId], transform_kind:'rank', transform_value:1,
    });
    const ordinaryEdit = h.events.at(-1).payload;
    assert.equal(ordinaryEdit.outcome, 'rejected');
    assert.equal(ordinaryEdit.reason_code, kind === 'exchange' ? 'invalid_phase' : 'edit_limit');
    assert.equal(ordinaryEdit.after.ink, kind === 'exchange' ? 2 : 0);
    assert.equal(ordinaryEdit.after.rescue_used, true);
    assert.equal(ordinaryEdit.context.source_zone, 'hand');
    if (kind !== 'exchange') {
      await h.act('begin_play', s, () => engine.beginPlay(s));
      const exchangeIds = s.hand.slice(0,3).map(t => t.id);
      await h.act('high_rescue', s, () => engine.highRescue(s, {type:'exchange', ids:exchangeIds}), {
        selected_tile_ids:exchangeIds, rescue_kind:'exchange',
      });
      assert.equal(h.events.at(-1).payload.outcome, 'rejected', 'prepare edit consumes the same later rescue exchange');
      assert.deepEqual(h.events.at(-1).payload.before, h.events.at(-1).payload.after);
    }
  }
});

test('V9 edits only in prepare and complete structures reject candidate exchanges', async () => {
  for (const [kind, damagedFace, arg, tool] of [
    ['rank', 3, 1, 'rank_brush'], ['suit', 13, 0, 'suit_ribbon'], ['wild', 13, undefined, 'wild_jade'],
  ]) {
    const h = harness(), s = await prepared(h);
    if (!s.relics.includes(tool)) s.relics.push(tool);
    s.relics.push('high_rescue');
    const ids = stageCandidates(s, [damagedFace, ...ordinary.slice(0, -1)]);
    const tileId = ids[0];
    const context = {selected_tile_ids:[tileId], transform_kind:kind, transform_value:arg ?? null};
    await h.act('transform', s, () => engine.transform(s, [tileId], kind, arg), context);
    const repair = h.events.at(-1).payload;
    assert.equal(repair.outcome, 'applied'); assert.equal(repair.context.source_zone, 'hand');
    if (kind === 'wild') assert.equal(repair.context.relic_id, 'wild_jade');
    assert.equal(repair.before.structure_count, 0); assert.equal(repair.after.structure_count, 0);
    assert.equal(repair.before.ink, 2); assert.equal(repair.after.ink, 0);
    assert.equal(repair.before.rescue_used, false); assert.equal(repair.after.rescue_used, false);
    assert.equal(repair.tile_changes.length, 1);
    assert.deepEqual(repair.tile_changes[0].slice(0, 3), [tileId, 'hand', 'hand']);
    assert.equal(repair.after.deck_count, repair.before.deck_count);
    assert.equal(h.events.some(e => e.name === 'hand_completed'), false);
    await h.act('transform', s, () => engine.transform(s, [tileId], 'rank', 1), {
      selected_tile_ids:[tileId], transform_kind:'rank', transform_value:1,
    });
    assert.equal(h.events.at(-1).payload.outcome, 'rejected');
    assert.equal(h.events.at(-1).payload.reason_code, 'edit_limit');
    assert.deepEqual(h.events.at(-1).payload.tile_changes, []);
    assert.equal(h.events.at(-1).payload.after.ink, 0);
    await commitStaged(h, s, ids);
    await h.act('transform', s, () => engine.transform(s, [tileId], kind, arg), context);
    const denied = h.events.at(-1).payload;
    assert.equal(denied.outcome, 'rejected'); assert.equal(denied.reason_code, 'invalid_phase');
    assert.equal(denied.before.structure_count, 14);
    assert.deepEqual(denied.before, denied.after); assert.deepEqual(denied.tile_changes, []);
    const { result } = await h.act('settle', s, () => engine.settle(s));
    const fact = h.events.find(e => e.name === 'hand_completed')?.payload;
    assert.ok(fact, `${kind} repaired a legal hand`);
    assert.equal(fact.win_score, result.total);
    assert.equal(fact.tiles.find(t => t.id === tileId).effective_face, 4);
    assert.equal(h.events.filter(e => e.name === 'round_settled').length, 1);
  }
  for (const mode of ['mcr', 'riichi']) {
    const h = harness(), s = await prepared(h, mode);
    const tileId = s.hand.find(t => t.face < 27).id;
    await h.act('transform', s, () => engine.transform(s, [tileId], 'wild'), {
      selected_tile_ids:[tileId], transform_kind:'wild', relic_id:'wild_jade',
    });
    const rejected = h.events.at(-1).payload;
    assert.equal(rejected.context.relic_id, 'wild_jade');
    assert.equal(rejected.outcome, 'rejected'); assert.equal(rejected.reason_code, 'missing_relic');
    assert.deepEqual(rejected.before, rejected.after); assert.deepEqual(rejected.tile_changes, []);
  }
  const h = harness(), s = await started(h);
  s.relics.push('suit_ribbon', 'wild_jade', 'high_rescue');
  arrange(s, ordinary);
  const previousPreview = engine.currentSettlementPreview(s), ids = s.hand.slice(0,5).map(t => t.id);
  await h.act('exchange', s, () => engine.exchange(s, ids), {selected_tile_ids:ids});
  const refresh = h.events.at(-1).payload;
  assert.equal(refresh.outcome, 'rejected');
  assert.equal(refresh.before.structure_count, 14); assert.equal(refresh.after.structure_count, 14);
  assert.deepEqual(refresh.before, refresh.after); assert.deepEqual(refresh.tile_changes, []);
  assert.ok(engine.restore(JSON.stringify(s)), 'rejected full-hand exchange preserves a valid save');
  const finalPreview = engine.currentSettlementPreview(s);
  assert.equal(finalPreview.total, previousPreview.total);
  const {result} = await h.act('settle', s, () => engine.settle(s));
  const terminal = h.events.find(e => e.name === 'hand_completed').payload;
  assert.equal(terminal.win_score, result.total); assert.equal(result.total, finalPreview.total);
  assert.equal(result.total, 1000 * engine.fanMultiplier(s.mode, result.fans));
  assert.deepEqual(result.gains, [], 'auxiliary relics do not contribute scoring gains');
  assert.equal(h.events.filter(e => e.name === 'hand_completed').length, 1);
  await h.act('exchange', s, () => engine.exchange(s, [s.hand[0].id]), {selected_tile_ids:[s.hand[0].id]});
  assert.equal(h.events.at(-1).payload.outcome, 'rejected');
  assert.deepEqual(h.events.at(-1).payload.before, h.events.at(-1).payload.after);
});

test('formed discard records one use per run, survives resume and joins later legal or false-win facts', async () => {
  for (const count of [1, 2]) {
    const h = harness(), s = await prepared(h);
    await h.act('formed_discard', s, () => engine.discardFormed(s, []), {selected_tile_ids:[]});
    assert.equal(h.events.at(-1).payload.reason_code, 'invalid_phase');
    assert.equal(h.events.at(-1).payload.after.formed_discard, null);
    await h.act('begin_play', s, () => engine.beginPlay(s));
    arrange(s, count === 1 ? ordinary : invalid);
    const removed = s.formed.slice(-count), ids = removed.map(t => t.id);
    // Reserve physical replacements in the candidate area before observation.
    const replacementIds = [];
    for (const tile of removed) {
      let replacement = s.hand.find(t => t.face === tile.face && !replacementIds.includes(t.id));
      if (!replacement) {
        const index = s.deck.findIndex(t => t.face === tile.face);
        assert.ok(index >= 0);
        const handIndex = s.hand.findIndex(t => !replacementIds.includes(t.id));
        [s.hand[handIndex], s.deck[index]] = [s.deck[index], s.hand[handIndex]];
        replacement = s.hand[handIndex];
      }
      replacementIds.push(replacement.id);
    }
    const context = {selected_tile_ids:ids, source_zone:'formed', count:99};
    const {before, result} = await h.act('formed_discard', s, () => engine.discardFormed(s, ids), context);
    const action = h.events.at(-1).payload;
    assert.equal(result.ok, true); assert.equal(action.outcome, 'applied');
    assert.equal(action.before.formed_discard, null);
    assert.deepEqual(action.after.formed_discard, {round_no:1, tile_ids:ids});
    assert.equal('count' in action.context, false, 'actual IDs define usage count, not the caller hint');
    assert.equal(action.after.formed_count, action.before.formed_count - count);
    assert.equal(action.after.structure_count, action.before.structure_count - count);
    assert.equal(action.after.discard_count, action.before.discard_count + count);
    for (const key of ['hand_count','deck_count','total_score','round_score','process_score','ink','swaps','coins','rescue_used']) {
      assert.equal(action.after[key], action.before[key], key);
    }
    assert.equal(action.tile_changes.length, count);
    assert.deepEqual(action.tile_changes.map(t => t.slice(0,3)).sort(), ids.map(id => [id,'formed','discard']).sort());
    await h.adapter.trackGameAction('formed_discard', before, s, result, context);
    assert.equal(h.events.filter(e => e.name === 'game_action' && e.payload.action === 'formed_discard' && e.payload.outcome === 'applied').length, 1);
    const restored = engine.restore(JSON.stringify(s));
    assert.ok(restored, 'the real engine restores the spent run-level ability');
    const resumed = harness();
    await resumed.adapter.trackGameAction('resume', null, restored, true, {source:'save'});
    assert.equal(resumed.events.filter(e => e.name === 'game_action' && e.payload.action === 'formed_discard').length, 0);
    assert.deepEqual(resumed.events.find(e => e.name === 'run_resumed').payload.state.formed_discard, action.after.formed_discard);
    await h.act('formed_discard', s, () => engine.discardFormed(s, [s.formed[0].id]), {selected_tile_ids:[s.formed[0].id]});
    assert.equal(h.events.at(-1).payload.reason_code, 'formed_discard_used');
    assert.deepEqual(h.events.at(-1).payload.before, h.events.at(-1).payload.after);
    await h.act('commit', s, () => engine.commit(s, replacementIds), {selected_tile_ids:replacementIds});
    const {result: terminal} = await h.act('settle', s, () => engine.settle(s));
    const fact = h.events.find(e => e.name === 'round_settled');
    assert.equal(fact.payload.legal, count === 1);
    assert.equal(fact.context.run_id, s.runId); assert.equal(fact.context.round_attempt_id, s.roundId);
    assert.equal(fact.payload.record_quality, 'complete');
    assert.equal(fact.payload.win_score, terminal.total);
    assert.equal(fact.payload.tiles.some(t => ids.includes(t.id)), false);
    assert.equal(h.events.filter(e => e.name === 'hand_completed').length, count === 1 ? 1 : 0);
    if (count === 1) {
      assert.equal(terminal.passed, true);
      await h.act('settlement_continue', s, () => engine.finishSettlement(s));
      await h.act('skip_reward', s, () => engine.skipReward(s));
      await h.act('next_round', s, () => engine.nextRound(s));
      assert.equal(h.events.at(-1).payload.state.round_no, 2);
      assert.deepEqual(h.events.at(-1).payload.state.formed_discard, action.after.formed_discard);
      await h.act('begin_play', s, () => engine.beginPlay(s));
      const tileId = s.hand[0].id;
      await h.act('commit', s, () => engine.commit(s, [tileId]), {selected_tile_ids:[tileId]});
      await h.act('formed_discard', s, () => engine.discardFormed(s, [tileId]), {selected_tile_ids:[tileId]});
      assert.equal(h.events.at(-1).payload.reason_code, 'formed_discard_used');
      assert.deepEqual(h.events.at(-1).payload.after.formed_discard, action.after.formed_discard);
    }
  }
});

test('only unowned auxiliary rewards can be chosen; exhausted rewards and skips advance normally', async () => {
  const h = harness(), s = await started(h);
  for (let round = 0; round < 4; round++) {
    arrange(s, ordinary); s.roundTarget = 1;
    await h.act('settle', s, () => engine.settle(s));
    await h.act('settlement_continue', s, () => engine.finishSettlement(s));
    assert.equal(s.offers.length, 3 - round);
    if (round === 3) {
      assert.equal(s.phase, 'shop', 'an exhausted pool skips the reward phase');
      assert.equal(h.events.at(-1).payload.after.phase, 'shop');
      break;
    }
    assert.ok(s.offers.every(id => ['suit_ribbon','wild_jade','high_rescue'].includes(id) && !s.relics.includes(id)));
    const reward = s.offers[0];
    await h.act('reward', s, () => engine.chooseReward(s, reward, 'rank_brush'), {relic_id:reward, replaced_relic_id:'rank_brush'});
    assert.equal(h.events.at(-1).payload.outcome, 'rejected');
    assert.equal(h.events.at(-1).payload.context.replace_relic_id, 'rank_brush');
    assert.deepEqual(h.events.at(-1).payload.before, h.events.at(-1).payload.after);
    await h.act('reward', s, () => engine.chooseReward(s, reward), {relic_id:reward});
    const action = h.events.at(-1).payload;
    assert.equal(action.outcome, 'applied'); assert.equal(action.context.relic_id, reward);
    assert.equal(action.context.replace_relic_id, null);
    assert.equal(action.after.relic_ids.length, round + 2);
    assert.ok(action.after.relic_ids.includes(reward)); assert.ok(action.after.relic_ids.includes('rank_brush'));
    assert.equal(action.after.coins, 0); assert.equal(action.before.coins, 0);
    await h.act('reward', s, () => engine.chooseReward(s, reward), {relic_id:reward});
    assert.equal(h.events.at(-1).payload.outcome, 'rejected');
    await h.act('next_round', s, () => engine.nextRound(s));
    assert.equal(h.events.at(-1).name, 'round_started');
    assert.equal(h.events.at(-1).payload.state.phase, 'prepare');
    assert.equal(h.events.at(-1).payload.state.rescue_used, false);
    assert.equal(h.events.at(-1).payload.state.ink, 2);
    await h.act('begin_play', s, () => engine.beginPlay(s));
  }
  assert.deepEqual([...s.relics].sort(), ['rank_brush','suit_ribbon','wild_jade','high_rescue'].sort());
  assert.equal(h.events.filter(e => e.name === 'round_started').length, 4);
  assert.equal(h.events.filter(e => e.name === 'round_settled').length, 4);
  const skip = harness(), other = await started(skip);
  arrange(other, ordinary); other.roundTarget = 1;
  await skip.act('settle', other, () => engine.settle(other));
  await skip.act('settlement_continue', other, () => engine.finishSettlement(other));
  await skip.act('skip_reward', other, () => engine.skipReward(other));
  const action = skip.events.at(-1).payload;
  assert.equal(action.action, 'skip_reward'); assert.equal(action.outcome, 'applied');
  assert.equal(action.before.phase, 'reward'); assert.equal(action.after.phase, 'shop');
  assert.deepEqual(action.after.relic_ids, action.before.relic_ids);
  assert.equal(action.after.coins, action.before.coins);
});

test('V9 no-yaku keeps the real decomposition but never becomes a credited hand or a false win', async () => {
  for (const start of [999, 1000]) {
    const h = harness(), s = await started(h, 'riichi');
    arrange(s, [0,1,2,9,10,11,21,22,23,15,16,17,4,4]);
    s.roundTarget = 1000; s.roundStartScore = start; s.totalScore = start;
    const {before, result} = await h.act('settle', s, () => engine.settle(s));
    assert.equal(result.legal, true); assert.equal(result.resultType, 'no_yaku');
    const fact = h.events.find(e => e.name === 'round_settled').payload;
    assert.equal(fact.result_type, 'no_yaku'); assert.equal(fact.legal, false);
    assert.equal(fact.record_quality, 'complete'); assert.equal(fact.passed, start === 1000);
    assert.equal(fact.shape, 'normal'); assert.equal(fact.tiles.length, 14);
    assert.equal(fact.decomposition.groups.flatMap(g => g.tile_ids).length, 14);
    assert.deepEqual(fact.credited_pattern_ids, []); assert.deepEqual(fact.unlock_pattern_ids, []);
    for (const key of ['win_score','penalty_score','process_score','score_delta','round_score']) assert.equal(fact[key], 0, key);
    assert.equal(fact.cumulative_after, start);
    await h.adapter.trackGameAction('settle', before, s, result);
    await h.act('settle', s, () => engine.settle(s));
    assert.equal(h.events.filter(e => e.name === 'round_settled').length, 1);
    assert.equal(h.events.filter(e => e.name === 'hand_completed').length, 0);
    await h.act('settlement_continue', s, () => engine.finishSettlement(s));
    if (start === 999) assert.equal(h.events.at(-1).payload.reason, 'no_yaku_below_target');
    else assert.equal(s.phase, 'reward');
  }
});

test('V9 exhausted short hands retain their penalty and lifecycle without becoming false wins', async () => {
  for (const mode of ['mcr', 'riichi']) for (const passed of [false, true]) {
    const h = harness(), s = await started(h, mode);
    for (let i = 0; i < 5; i++) {
      const ids = s.hand.slice(0,5).map(t => t.id);
      await h.act('exchange', s, () => engine.exchange(s, ids), {selected_tile_ids:ids});
    }
    let shortBatch = false;
    while (s.hand.length) {
      shortBatch ||= s.hand.length < 9;
      const ids = [s.hand[0].id];
      await h.act('commit', s, () => engine.commit(s, ids), {selected_tile_ids:ids});
    }
    assert.ok(shortBatch); assert.equal(s.deck.length, 0); assert.ok(s.formed.length < 14);
    s.roundTarget = 1001; s.roundStartScore = passed ? 1102 : 1101; s.totalScore = s.roundStartScore;
    const {before, result} = await h.act('settle', s, () => engine.settle(s));
    assert.equal(result.resultType, 'incomplete');
    const fact = h.events.find(e => e.name === 'round_settled').payload;
    assert.equal(fact.result_type, 'incomplete'); assert.equal(fact.legal, false); assert.equal(fact.passed, passed);
    assert.equal(fact.record_quality, 'complete'); assert.equal(fact.shape, null); assert.equal(fact.decomposition, null);
    assert.equal(fact.tiles.length, s.formed.length); assert.equal(fact.penalty_score, 101);
    assert.equal(fact.process_score, 0); assert.equal(fact.win_score, 0); assert.equal(fact.round_score, -101);
    assert.equal(fact.cumulative_after, passed ? 1001 : 1000);
    assert.deepEqual(fact.credited_pattern_ids, []); assert.deepEqual(fact.unlock_pattern_ids, []);
    await h.adapter.trackGameAction('settle', before, s, result);
    await h.act('settle', s, () => engine.settle(s));
    assert.equal(h.events.filter(e => e.name === 'round_settled').length, 1);
    assert.equal(h.events.filter(e => e.name === 'hand_completed').length, 0);
    await h.act('settlement_continue', s, () => engine.finishSettlement(s));
    if (!passed) assert.equal(h.events.at(-1).payload.reason, 'incomplete_below_target');
    else assert.equal(s.phase, 'reward');
  }
});
