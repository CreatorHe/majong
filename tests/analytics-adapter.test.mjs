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
async function started(h, mode = 'mcr', starter = 'jade') {
  const s = engine.newRun(mode, 1234);
  await h.adapter.trackGameAction('start', null, s, s);
  await h.act('starter', s, () => engine.chooseStarter(s, starter), { relic_id: starter });
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
  s.hand = pool.splice(0, s.version === 4 ? 12 : s.version === 3 ? 10 : 18); s.deck = pool; s.discard = [];
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
  const h = harness(), s = await started(h, 'mcr', 'single_seal');
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
  assert.equal(next.swaps, 7); assert.equal(prior.swaps, next.swaps);
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
  const h = harness(), s = await started(h);
  arrange(s, ordinary);
  const { before, result } = await h.act('settle', s, () => engine.settle(s));
  assert.equal(result.legal, true);
  const terminal = h.events.filter(e => ['round_settled','hand_completed'].includes(e.name));
  assert.equal(terminal.length, 2);
  assert.deepEqual(terminal[0].payload, terminal[1].payload);
  assert.equal(terminal[0].payload.record_quality, 'complete');
  assert.equal(terminal[0].payload.settlement_id, s.settlementId);
  assert.equal(terminal[0].payload.win_score, result.total);
  await h.adapter.trackGameAction('settle', before, s, result);
  await h.act('settle', s, () => engine.settle(s));
  await h.act('settlement_skip', s, () => engine.finishSettlement(s));
  await h.act('settlement_complete', s, () => engine.finishSettlement(s));
  assert.equal(h.events.filter(e => e.name === 'hand_completed').length, 1);
  assert.equal(h.events.filter(e => e.name === 'round_settled').length, 1);
});

test('legal below-target remains a hand; terminal failure is recorded after playback', async () => {
  const h = harness(), s = await started(h);
  arrange(s, ordinary); s.roundTarget = 100000;
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

test('v4 aliases normalize while v2/v3 snapshots and superseded runs retain their original version', async () => {
  for (const [version, rulesVersion, scoreVersion, handCount] of [
    [2, 'free-play-v2', 'cumulative-v2', 18], [3, 'free-play-v3', 'exponential-v3', 10],
  ]) {
    const h = harness(), s = await started(h);
    assert.equal(h.events.at(-1).context.rules_version, 'free_play_v4');
    assert.equal(h.events.at(-1).context.score_model_version, 'exponential_v3');
    const old = { ...structuredClone(s), version, rulesVersion, scoreVersion };
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
    s.rulesVersion = 'free_play_v4'; s.scoreVersion = 'exponential_v3';
    assert.equal(h.adapter.captureGameState(s).scoreVersion, 'exponential_v3');
    const before = h.adapter.captureGameState(s), count = h.events.length;
    s.scoreVersion = 'cumulative-v4';
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

test('mid-round consent, revoked/reallowed consent and fresh reload stay partial', async () => {
  for (const kind of ['mid','reallow','reload']) {
    const h = harness(); if (kind === 'mid') h.status.consent = 'denied';
    const s = await started(h);
    if (kind === 'reload') h.adapter = createGameAdapter({ getClient: () => h.client });
    if (kind === 'mid' || kind === 'reallow') { h.status.consent = 'allowed'; h.status.collectionGeneration++; }
    arrange(s, ordinary);
    const before = h.adapter.captureGameState(s), result = engine.settle(s);
    await h.adapter.trackGameAction('settle', before, s, result);
    const fact = h.events.find(e => e.name === 'hand_completed').payload;
    assert.equal(fact.record_quality, 'partial', kind);
  }
});

test('resume does not manufacture a start, round start or previously saved settlement', async () => {
  const s = engine.newRun('mcr', 1234); engine.chooseStarter(s, 'jade'); arrange(s, ordinary); engine.settle(s);
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

test('transform, exchange, replacement and shop actions expose only actual resource changes', async () => {
  const h = harness(), s = await started(h, 'mcr', 'rank_brush');
  let tile = s.hand.find(t => t.face < 27 && t.face % 9 < 8);
  const originalFace = tile.face, tileId = tile.id;
  await h.act('transform', s, () => engine.transform(s, [tileId], 'rank', 1), {
    selected_tile_ids:[tileId], source_zone:'hand', transform_kind:'rank', transform_value:1, relic_id:'rank_brush',
  });
  let action = h.events.at(-1).payload;
  assert.equal(action.after.ink - action.before.ink, -1);
  assert.equal(action.context.transform_kind, 'rank');
  assert.ok(action.tile_changes.some(t => t[0] === tileId && t[3] === originalFace && t[4] === originalFace + 1));
  await h.act('commit', s, () => engine.commit(s, [tileId]), {selected_tile_ids:[tileId]});
  const incoming = s.hand[0].id;
  await h.act('replace', s, () => engine.replaceFormed(s, [tileId], [incoming]), {selected_tile_ids:[tileId,incoming]});
  action = h.events.at(-1).payload;
  assert.equal(action.after.swaps - action.before.swaps, -1);
  assert.equal(action.after.process_score - action.before.process_score, 0);
  assert.ok(action.tile_changes.some(t => t[0] === tileId && t[1] === 'formed' && t[2] === 'discard'));
  const outgoing = s.hand[0].id;
  await h.act('exchange', s, () => engine.exchange(s, [outgoing]), {selected_tile_ids:[outgoing]});
  assert.equal(h.events.at(-1).payload.after.swaps - h.events.at(-1).payload.before.swaps, -1);
  s.phase='shop'; s.shop=['jade']; s.coins=10;
  await h.act('buy', s, () => engine.buy(s, 'jade'), {relic_id:'jade'});
  assert.equal(h.events.at(-1).payload.after.coins - h.events.at(-1).payload.before.coins, -5);
  await h.act('sell', s, () => engine.sell(s, 'jade'), {relic_id:'jade'});
  assert.equal(h.events.at(-1).payload.after.coins - h.events.at(-1).payload.before.coins, 2);
});
