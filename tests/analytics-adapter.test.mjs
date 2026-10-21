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
async function prepared(h, mode = 'mcr', starter = 'core_high') {
  const s = engine.newRun(mode, 1234);
  await h.adapter.trackGameAction('start', null, s, s);
  await h.act('starter', s, () => engine.chooseStarter(s, starter), { relic_id: starter });
  return s;
}
async function started(h, mode = 'mcr', starter = 'core_high') {
  const s = await prepared(h, mode, starter);
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
  s.hand = pool.splice(0, s.version >= 4 ? 12 : s.version === 3 ? 10 : 18); s.deck = pool; s.discard = [];
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

test('single-tile process gain is a real delta and duplicate callbacks do not duplicate it', async () => {
  const h = harness(), s = await started(h, 'mcr', 'core_growth');
  s.relics.push('single_seal');
  const tileId = s.hand[0].id;
  const { before, result } = await h.act('commit', s, () => engine.commit(s, [tileId]), { selected_tile_ids: [tileId] });
  await h.adapter.trackGameAction('commit', before, s, result, { selected_tile_ids: [tileId] });
  const commits = h.events.filter(e => e.name === 'game_action' && e.payload.action === 'commit');
  assert.equal(commits.length, 1);
  assert.equal(commits[0].payload.after.process_score - commits[0].payload.before.process_score, 20);
  assert.ok(commits[0].payload.tile_changes.some(t => t[0] === tileId && t[1] === 'hand' && t[2] === 'formed'));
  const { before: prior, after: next, tile_changes: changes } = commits[0].payload;
  assert.equal(prior.hand_count, 12); assert.equal(next.hand_count, 12);
  assert.equal(136 - prior.deck_count, 12); assert.equal(136 - next.deck_count, 13);
  assert.equal(next.swaps, 0); assert.equal(prior.swaps, next.swaps);
  assert.equal(prior.discard_count, next.discard_count);
  assert.equal(changes.filter(t => t[1] === 'deck' && t[2] === 'hand').length, 1);
  assert.equal(changes.length, 2, 'retained candidates do not become fake discard or draw events');
  await h.act('commit', s, () => engine.commit(s, [tileId]), { selected_tile_ids: [tileId], reason_code: 'tile_not_in_hand' });
  assert.equal(s.totalScore, 20);
  assert.equal(h.events.at(-1).payload.outcome, 'rejected');
  assert.equal(h.events.at(-1).payload.before.process_score, h.events.at(-1).payload.after.process_score);
  assert.equal(h.events.filter(e => e.name === 'hand_completed').length, 0);
});

test('legal win emits identical terminal facts once; skip/complete only display lifecycle', async () => {
  for (const core of ['core_high', 'core_pung', 'core_held', 'core_growth']) {
  const h = harness(), s = await started(h, 'mcr', core);
  const retrigger = core === 'core_held' ? 'retrigger_held' : 'retrigger_meld';
  s.relics.push(retrigger);
  arrange(s, ordinary);
  const { before, result } = await h.act('settle', s, () => engine.settle(s));
  assert.equal(result.legal, true);
  const terminal = h.events.filter(e => ['round_settled','hand_completed'].includes(e.name));
  assert.equal(terminal.length, 2);
  assert.deepEqual(terminal[0].payload, terminal[1].payload);
  assert.equal(terminal[0].payload.record_quality, 'complete');
  assert.equal(terminal[0].payload.settlement_id, s.settlementId);
  assert.equal(terminal[0].payload.win_score, result.total);
  assert.ok(terminal[0].payload.owned_relic_ids.includes(core));
  assert.ok(terminal[0].payload.owned_relic_ids.includes(retrigger));
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

test('v5 aliases normalize while v2/v3/v4 snapshots and superseded runs retain their original version', async () => {
  for (const [version, rulesVersion, scoreVersion, handCount] of [
    [2, 'free-play-v2', 'cumulative-v2', 18], [3, 'free-play-v3', 'exponential-v3', 10],
    [4, 'free-play-v4', 'exponential-v3', 12],
  ]) {
    const h = harness(), s = await started(h);
    assert.equal(h.events.at(-1).context.rules_version, 'opening_build_v5');
    assert.equal(h.events.at(-1).context.score_model_version, 'four_core_v5');
    const old = { ...structuredClone(s), version, rulesVersion, scoreVersion, relics: ['jade'] };
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
    s.rulesVersion = 'opening_build_v5'; s.scoreVersion = 'four_core_v5';
    assert.equal(h.adapter.captureGameState(s).scoreVersion, 'four_core_v5');
    const before = h.adapter.captureGameState(s), count = h.events.length;
    s.scoreVersion = 'exponential-v3';
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

test('wildcard effective face and unlock patterns come from actual terminal result', async () => {
  const h = harness(), s = await started(h, 'riichi');
  const faces = [10,10,11,11,12,12,13,13,14,14,15,15,16,16];
  arrange(s, faces); s.relics.push('wheel', 'wild_jade');
  s.formed[0].face = 1; s.formed[0].wild = true; s.wildUsed = 1;
  await h.act('settle', s, () => engine.settle(s));
  const fact = h.events.find(e => e.name === 'hand_completed').payload;
  const wild = fact.tiles.find(t => t.wild);
  assert.equal(wild.face, 1); assert.equal(wild.effective_face, 10);
  assert.deepEqual(fact.unlock_pattern_ids, ['riichi.big_wheel']);
  assert.equal(fact.shape, 'pairs');
});

test('current MCR relic bonuses keep separate IDs without hiding their base patterns', async () => {
  for (const [relicId, faces, baseId, bonusId] of [
    ['wheel', [10,10,11,11,12,12,13,13,14,14,15,15,16,16], 'mcr.seven_shifted_pairs', 'mcr.seven_shifted_pairs_bonus'],
    ['mountain', [0,0,0,1,1,1,2,2,2,12,13,14,31,31], 'mcr.pure_shifted_pungs', 'mcr.pure_shifted_pungs_bonus'],
  ]) {
    const h = harness(), s = await started(h);
    arrange(s, faces); s.relics.push(relicId);
    await h.act('settle', s, () => engine.settle(s));
    const fact = h.events.find(e => e.name === 'hand_completed')?.payload;
    assert.ok(fact, bonusId);
    assert.ok(fact.credited_pattern_ids.includes(baseId));
    assert.ok(!fact.credited_pattern_ids.includes(bonusId));
    assert.deepEqual(fact.unlock_pattern_ids, [bonusId]);
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
  const s = engine.newRun('mcr', 1234); engine.chooseStarter(s, 'core_high'); engine.beginPlay(s); arrange(s, ordinary); engine.settle(s);
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
  s.relics.push('rank_brush');
  const round = h.events.find(e => e.name === 'round_started');
  assert.equal(round.payload.state.phase, 'prepare');
  assert.equal(round.payload.state.swaps, 5);
  assert.equal(round.payload.record_quality, 'complete');
  const tile = s.hand.find(t => t.face < 27 && t.face % 9 < 8);
  const originalFace = tile.face, tileId = tile.id;
  await h.act('transform', s, () => engine.transform(s, [tileId], 'rank', 1), {
    selected_tile_ids:[tileId], source_zone:'hand', transform_kind:'rank', transform_value:1, relic_id:'rank_brush',
  });
  let action = h.events.at(-1).payload;
  assert.equal(action.after.ink - action.before.ink, -1);
  assert.equal(action.context.transform_kind, 'rank');
  assert.ok(action.tile_changes.some(t => t[0] === tileId && t[3] === originalFace && t[4] === originalFace + 1));
  const outgoing = s.hand.slice(0, 5).map(t => t.id);
  await h.act('exchange', s, () => engine.exchange(s, outgoing), {selected_tile_ids:outgoing});
  action = h.events.at(-1).payload;
  assert.equal(action.after.swaps - action.before.swaps, -1);
  assert.equal(action.before.deck_count - action.after.deck_count, 5);
  assert.equal(action.tile_changes.filter(t => t[1] === 'hand' && t[2] === 'discard').length, 5);
  await h.act('begin_play', s, () => engine.beginPlay(s));
  action = h.events.at(-1).payload;
  assert.equal(action.before.phase, 'prepare'); assert.equal(action.after.phase, 'play');
  assert.equal(action.before.swaps, 4); assert.equal(action.after.swaps, 0);
  assert.equal(h.events.filter(e => e.name === 'round_started').length, 1);
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
    const h = harness(), s = await started(h);
    s.relics.push('high_rescue');
    const tile = s.hand.find(t => t.face < 27 && t.face % 9 < 8);
    if (kind !== 'exchange') await h.act('commit', s, () => engine.commit(s, [tile.id]), {selected_tile_ids:[tile.id]});
    const ids = kind === 'exchange' ? s.hand.slice(0, 3).map(t => t.id) : [tile.id];
    const arg = kind === 'rank' ? 1 : kind === 'suit' ? (Math.floor(tile.face / 9) + 1) % 3 : undefined;
    const context = {selected_tile_ids:ids, rescue_kind:kind,
      ...(kind !== 'exchange' ? {transform_kind:kind, transform_value:arg} : {})};
    await h.act('high_rescue', s, () => engine.highRescue(s, {type:kind, ids, arg}), context);
    const action = h.events.at(-1).payload;
    assert.equal(action.outcome, 'applied');
    assert.equal(action.context.rescue_type, kind);
    assert.equal(action.context.transform_kind, kind === 'exchange' ? null : kind);
    assert.equal(action.context.source_zone, kind === 'exchange' ? 'hand' : 'formed');
    assert.equal(action.before.rescue_used, false); assert.equal(action.after.rescue_used, true);
    assert.equal(action.after.swaps, action.before.swaps);
    assert.equal(action.after.ink - action.before.ink, kind === 'exchange' ? 0 : -1);
    assert.equal(action.before.deck_count - action.after.deck_count, kind === 'exchange' ? 3 : 0);
    assert.equal(action.tile_changes.length, kind === 'exchange' ? 6 : 1);
    await h.act('high_rescue', s, () => engine.highRescue(s, {type:kind, ids, arg}), context);
    const rejected = h.events.at(-1).payload;
    assert.equal(rejected.outcome, 'rejected');
    assert.deepEqual(rejected.before, rejected.after);
    assert.deepEqual(rejected.tile_changes, []);
  }
});

test('full-slot reward replacement, skip_reward and next prepare use actual app field names', async () => {
  const h = harness(), s = await started(h);
  s.relics.push('jade', 'stone', 'bamboo');
  arrange(s, ordinary); s.roundTarget = 1;
  await h.act('settle', s, () => engine.settle(s));
  await h.act('settlement_continue', s, () => engine.finishSettlement(s));
  const reward = s.offers[0];
  await h.act('reward', s, () => engine.chooseReward(s, reward), {relic_id:reward});
  assert.equal(h.events.at(-1).payload.outcome, 'rejected');
  await h.act('reward', s, () => engine.chooseReward(s, reward, 'jade'), {relic_id:reward, replaced_relic_id:'jade'});
  let action = h.events.at(-1).payload;
  assert.equal(action.context.replace_relic_id, 'jade');
  assert.equal(action.context.relic_id, reward);
  assert.equal(action.after.relic_ids.length, 4);
  assert.ok(action.after.relic_ids.includes(reward));
  assert.ok(!action.after.relic_ids.includes('jade'));
  assert.equal(action.after.coins, action.before.coins);
  await h.act('next_round', s, () => engine.nextRound(s));
  assert.equal(h.events.at(-1).name, 'round_started');
  assert.equal(h.events.at(-1).payload.state.phase, 'prepare');
  assert.equal(h.events.at(-1).payload.state.rescue_used, false);
  await h.act('begin_play', s, () => engine.beginPlay(s));
  arrange(s, ordinary); s.roundTarget = 1;
  await h.act('settle', s, () => engine.settle(s));
  await h.act('settlement_continue', s, () => engine.finishSettlement(s));
  await h.act('skip_reward', s, () => engine.skipReward(s));
  action = h.events.at(-1).payload;
  assert.equal(action.action, 'skip_reward'); assert.equal(action.outcome, 'applied');
  assert.equal(action.before.phase, 'reward'); assert.equal(action.after.phase, 'shop');
  assert.deepEqual(action.after.relic_ids, action.before.relic_ids);
  assert.equal(action.after.coins, action.before.coins);
  assert.equal(h.events.filter(e => e.name === 'round_started').length, 2);
  assert.equal(h.events.filter(e => e.name === 'round_settled').length, 2);
});
