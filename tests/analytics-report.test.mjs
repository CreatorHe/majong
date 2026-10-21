import test from 'node:test';
import assert from 'node:assert/strict';
import { flushTestQueue, makeFixture, patternScore, reportPresentation, sampleVersions, versionKey } from '../dist/analytics/report.js';

const current = (summary = {}, settlements = {}) => ({ ...sampleVersions, summary, settlements });
const previous = (summary = {}, settlements = {}) => ({ rules_version: 'free_play_v2', score_model_version: 'cumulative_v2', summary, settlements });
const v3 = (summary = {}, settlements = {}) => ({ rules_version: 'free_play_v3', score_model_version: 'exponential_v3', summary, settlements });
const legacy = summary => ({ rules_version: 'split_legacy_v1', score_model_version: 'rogue_legacy_v1', summary });

test('v2, v3 and v4 keep score metrics and complete version keys separate', () => {
  assert.deepEqual(sampleVersions, { rules_version: 'free_play_v4', score_model_version: 'exponential_v3' });
  assert.notEqual(versionKey(v3()), versionKey(current()));
  assert.deepEqual(JSON.parse(versionKey(v3())), ['free_play_v3', 'exponential_v3']);
  assert.deepEqual(JSON.parse(versionKey(current())), ['free_play_v4', 'exponential_v3']);
  for (const version of [previous, v3, current]) {
    const data = version(
      { max_win_score: 1800, max_round_score: 1880, max_cumulative_score: 1880 },
      { max_round_score: 1880, max_cumulative_score: 4900, pass_rate: 3 / 5 },
    );
    const view = reportPresentation(data);
    assert.equal(view.freePlay, true);
    assert.equal(view.v2, version === previous);
    assert.equal(view.v3, version === v3);
    assert.equal(view.v4, version === current);
    assert.equal(view.maxScore, 1800);
    assert.equal(view.maxNet, 1880);
    assert.equal(view.maxCumulative, 4900);
    assert.equal(view.passRate, 0.6);
    assert.doesNotMatch(view.explanation, /预选路线/);
    assert.equal(patternScore({ max_win_score: 1800, max_round_score: 1880 }, data), 1800);
  }
});

test('free-play versions preserve missing and signed records, including v3 and v4 safe large scores', () => {
  for (const version of [previous, v3, current]) {
    const data = version({ max_round_score: 9999 }, { max_round_score: -100, max_cumulative_score: -50, pass_rate: 0 });
    const view = reportPresentation(data);
    assert.equal(view.maxScore, null);
    assert.equal(view.maxNet, -100);
    assert.equal(view.maxCumulative, -50);
    assert.equal(view.passRate, 0);
    assert.equal(patternScore({ max_round_score: 9999 }, data), null);
    assert.equal(reportPresentation(version()).passRate, null);
  }
  for (const version of [v3, current]) {
    const high = version({ max_win_score: 2 ** 48 }, { max_round_score: 2 ** 48, max_cumulative_score: Number.MAX_SAFE_INTEGER });
    assert.equal(reportPresentation(high).maxScore, 2 ** 48);
    assert.equal(reportPresentation(high).maxCumulative, Number.MAX_SAFE_INTEGER);
  }
});

test('legacy reports retain route denominator wording and never expose invented cumulative metrics', () => {
  const data = legacy({ max_round_score: 2200, max_win_score: 100, max_cumulative_score: 99999 });
  const view = reportPresentation(data);
  assert.equal(view.v2, false);
  assert.equal(view.maxScore, 2200);
  assert.equal(view.maxNet, null);
  assert.equal(view.maxCumulative, null);
  assert.equal(view.passRate, null);
  assert.match(view.explanation, /预选路线/);
  assert.equal(patternScore({ max_round_score: 2200, max_win_score: 100 }, data), 2200);
});

test('sandbox fixture includes independent legality and passage outcomes, exact threshold and partial exclusion', () => {
  const fixture = makeFixture('mcr');
  assert.equal(fixture.length, 9);
  const settled = fixture.filter(item => item.event_name === 'round_settled');
  const complete = settled.filter(item => item.payload.record_quality === 'complete');
  const hands = complete.filter(item => item.payload.legal);
  assert.equal(settled.length, 6);
  assert.equal(complete.length, 5);
  assert.equal(hands.length, 2);
  assert.equal(hands.filter(item => item.payload.passed).length, 1);
  assert.equal(complete.filter(item => item.payload.passed).length, 3);
  assert.equal(complete.filter(item => !item.payload.legal && item.payload.passed).length, 2);
  assert.ok(complete.some(({ payload: p }) => !p.legal && p.passed && p.cumulative_after === p.target_score));
  assert.ok(complete.some(({ payload: p }) => !p.legal && !p.passed && p.cumulative_after < 0));
  assert.equal(Math.max(...hands.map(item => item.payload.win_score)), 1800);
  assert.equal(Math.max(...complete.map(item => item.payload.round_score)), 1880);
  assert.equal(Math.max(...complete.map(item => item.payload.cumulative_after)), 4900);
  assert.equal(hands.filter(item => item.payload.credited_pattern_ids.includes('mcr.seven_pairs')).length / hands.length, 0.5);
  for (const item of fixture.filter(item => item.event_name === 'hand_completed')) {
    assert.equal(item.payload.legal, true);
    const terminal = settled.find(row => row.payload.settlement_id === item.payload.settlement_id);
    assert.deepEqual(item.payload, terminal.payload);
    assert.deepEqual(item.context, terminal.context);
  }
  const replay = JSON.parse(JSON.stringify(fixture));
  assert.deepEqual(replay.map(item => item.context.hand_id), fixture.map(item => item.context.hand_id));
});

test('sandbox fixture uses separate stable IDs and mode-specific pattern IDs', () => {
  for (const mode of ['mcr', 'riichi']) {
    const fixture = makeFixture(mode);
    const settled = fixture.filter(item => item.event_name === 'round_settled');
    assert.equal(new Set(settled.map(item => item.context.hand_id)).size, 6);
    assert.equal(new Set(settled.map(item => item.context.round_attempt_id)).size, 6);
    for (const item of fixture) {
      assert.equal(item.context.mode, mode);
      assert.equal(item.context.rules_version, sampleVersions.rules_version);
      assert.equal(item.context.score_model_version, sampleVersions.score_model_version);
      assert.equal(item.context.hand_id, item.payload.settlement_id);
      assert.ok(item.payload.credited_pattern_ids.every(id => id.startsWith(`${mode}.`)));
    }
  }
  assert.throws(() => makeFixture('invalid'), /unsupported_fixture_mode/);
});

test('all sandbox facts pass the same shared strict validation as gameplay events', async () => {
  const { validateGamePayload } = await import('../dist/analytics/game-schema.js');
  for (const mode of ['mcr', 'riichi']) {
    for (const item of makeFixture(mode)) {
      const result = validateGamePayload(item.event_name, item.payload, item.context);
      assert.equal(result.ok, true, `${mode}/${item.event_name}/${item.payload.result_type}: ${result.reason}`);
      for (const oldVersion of [previous(), v3()]) {
        const previousContext = { ...item.context, rules_version: oldVersion.rules_version, score_model_version: oldVersion.score_model_version };
        const previousResult = validateGamePayload(item.event_name, item.payload, previousContext);
        assert.equal(previousResult.ok, true, `retained ${oldVersion.rules_version} ${mode}/${item.event_name}: ${previousResult.reason}`);
      }
    }
  }
});


test('sandbox verification drains split batches and retains every acknowledgement', async () => {
  let calls = 0;
  const client = {
    getStatus: () => ({ queued: 25 }),
    flush: async () => (++calls === 1
      ? { queued: 5, lastAck: { accepted: ['event-one'], duplicate: [], rejected: [] } }
      : { queued: 0, lastAck: { accepted: [], duplicate: ['event-two'], rejected: [] } }),
  };
  const status = await flushTestQueue(client);
  assert.equal(calls, 2);
  assert.equal(status.queued, 0);
  assert.deepEqual(status.lastAck, { accepted: ['event-one'], duplicate: ['event-two'], rejected: [] });
});

test('sandbox verification stops on rejection or stalled delivery instead of claiming success', async () => {
  let calls = 0;
  const rejected = await flushTestQueue({
    getStatus: () => ({ queued: 9 }),
    flush: async () => { calls++; return { queued: 8, lastAck: { accepted: [], duplicate: [], rejected: [{ event_id: 'bad-event', reason: 'invalid_payload' }] } }; },
  });
  assert.equal(calls, 1);
  assert.equal(rejected.lastAck.rejected.length, 1);
  calls = 0;
  const stalled = await flushTestQueue({
    getStatus: () => ({ queued: 9 }),
    flush: async () => { calls++; return { queued: 9, lastAck: null, lastError: 'network_unavailable' }; },
  });
  assert.equal(calls, 1);
  assert.equal(stalled.lastAck, null);
  assert.equal(stalled.lastError, 'network_unavailable');
});
