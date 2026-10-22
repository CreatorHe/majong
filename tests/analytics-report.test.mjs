import test from 'node:test';
import assert from 'node:assert/strict';
import { flushTestQueue, makeFixture, patternScore, reportPresentation, sampleVersions, versionKey } from '../dist/analytics/report.js';

const current = (summary = {}, settlements = {}) => ({ ...sampleVersions, summary, settlements });
const previous = (summary = {}, settlements = {}) => ({ rules_version: 'free_play_v2', score_model_version: 'cumulative_v2', summary, settlements });
const v3 = (summary = {}, settlements = {}) => ({ rules_version: 'free_play_v3', score_model_version: 'exponential_v3', summary, settlements });
const v4 = (summary = {}, settlements = {}) => ({ rules_version: 'free_play_v4', score_model_version: 'exponential_v3', summary, settlements });
const v5 = (summary = {}, settlements = {}) => ({ rules_version: 'opening_build_v5', score_model_version: 'four_core_v5', summary, settlements });
const v6 = (summary = {}, settlements = {}) => ({ rules_version: 'opening_build_v6', score_model_version: 'four_core_v6', summary, settlements });
const v7 = (summary = {}, settlements = {}) => ({ rules_version: 'opening_build_v7', score_model_version: 'four_core_v6', summary, settlements });
const v8 = (summary = {}, settlements = {}) => ({ rules_version: 'opening_build_v8', score_model_version: 'four_core_v6', summary, settlements });
const legacy = summary => ({ rules_version: 'split_legacy_v1', score_model_version: 'rogue_legacy_v1', summary });

test('v2 through v9 keep reported scores unchanged and complete version keys separate', () => {
  assert.deepEqual(sampleVersions, { rules_version: 'nine_batch_v9', score_model_version: 'fan_score_v9' });
  assert.notEqual(versionKey(v3()), versionKey(v4()));
  assert.notEqual(versionKey(v4()), versionKey(v5()));
  assert.notEqual(versionKey(v5()), versionKey(v6()));
  assert.equal(v6().score_model_version, v8().score_model_version);
  assert.notEqual(versionKey(v6()), versionKey(v7()));
  assert.equal(v7().score_model_version, v8().score_model_version);
  assert.notEqual(versionKey(v7()), versionKey(v8()));
  assert.notEqual(versionKey(v8()), versionKey(current()));
  assert.deepEqual(JSON.parse(versionKey(v3())), ['free_play_v3', 'exponential_v3']);
  assert.deepEqual(JSON.parse(versionKey(v4())), ['free_play_v4', 'exponential_v3']);
  assert.deepEqual(JSON.parse(versionKey(v5())), ['opening_build_v5', 'four_core_v5']);
  assert.deepEqual(JSON.parse(versionKey(v6())), ['opening_build_v6', 'four_core_v6']);
  assert.deepEqual(JSON.parse(versionKey(v7())), ['opening_build_v7', 'four_core_v6']);
  assert.deepEqual(JSON.parse(versionKey(v8())), ['opening_build_v8', 'four_core_v6']);
  assert.deepEqual(JSON.parse(versionKey(current())), ['nine_batch_v9', 'fan_score_v9']);
  assert.equal(reportPresentation({ ...current(), score_model_version: 'exponential_v3' }).freePlay, false);
  assert.equal(reportPresentation({ ...current(), score_model_version: 'four_core_v5' }).freePlay, false);
  assert.equal(reportPresentation({ ...current(), score_model_version: 'four_core_v6' }).freePlay, false);
  for (const version of [previous, v3, v4, v5, v6, v7, v8, current]) {
    const data = version(
      { max_win_score: 1800, max_round_score: 1880, max_cumulative_score: 1880 },
      { max_round_score: 1880, max_cumulative_score: 4900, pass_rate: 3 / 5, no_yaku: 2, incomplete: 3 },
    );
    const view = reportPresentation(data);
    assert.equal(view.freePlay, true);
    assert.equal(view.v2, version === previous);
    assert.equal(view.v3, version === v3);
    assert.equal(view.v4, version === v4);
    assert.equal(view.v5, version === v5);
    assert.equal(view.v6, version === v6);
    assert.equal(view.v7, version === v7);
    assert.equal(view.v8, version === v8);
    assert.equal(view.v9, version === current);
    assert.equal(view.noYaku, version === current ? 2 : null);
    assert.equal(view.incomplete, version === current ? 3 : null);
    assert.equal(view.maxScore, 1800);
    assert.equal(view.maxNet, 1880);
    assert.equal(view.maxCumulative, 4900);
    assert.equal(view.passRate, 0.6);
    assert.doesNotMatch(view.explanation, /预选路线/);
    assert.equal(patternScore({ max_win_score: 1800, max_round_score: 1880 }, data), 1800);
  }
});

test('free-play versions preserve missing and signed records, including v3 through v9 safe large scores', () => {
  for (const version of [previous, v3, v4, v5, v6, v7, v8, current]) {
    const data = version({ max_round_score: 9999 }, { max_round_score: -100, max_cumulative_score: -50, pass_rate: 0 });
    const view = reportPresentation(data);
    assert.equal(view.maxScore, null);
    assert.equal(view.maxNet, -100);
    assert.equal(view.maxCumulative, -50);
    assert.equal(view.passRate, 0);
    assert.equal(patternScore({ max_round_score: 9999 }, data), null);
    assert.equal(reportPresentation(version()).passRate, null);
  }
  for (const version of [v3, v4, v5, v6, v7, v8, current]) {
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

test('sandbox fixtures separate v9 results and share the correct win-only denominator in both modes', () => {
  for (const mode of ['mcr', 'riichi']) {
    const fixture = makeFixture(mode);
    assert.equal(fixture.length, 9);
    const settled = fixture.filter(item => item.event_name === 'round_settled');
    const complete = settled.filter(item => item.payload.record_quality === 'complete');
    const hands = complete.filter(item => item.payload.legal);
    assert.equal(settled.length, 6);
    assert.equal(complete.length, 5);
    assert.equal(hands.length, 2);
    assert.ok(hands.every(item => item.payload.result_type === 'win' && item.payload.credited_pattern_ids.length));
    assert.equal(hands.filter(item => item.payload.passed).length, 1);
    assert.equal(complete.filter(item => item.payload.passed).length, 3);
    assert.equal(complete.filter(item => item.payload.result_type === 'false_win').length, mode === 'riichi' ? 1 : 2);
    assert.equal(complete.filter(item => item.payload.result_type === 'no_yaku').length, mode === 'riichi' ? 1 : 0);
    assert.ok(complete.some(({ payload: p }) => p.result_type === 'false_win' && p.passed && p.cumulative_after === p.target_score));
    const incomplete = complete.find(item => item.payload.result_type === 'incomplete').payload;
    assert.equal(incomplete.legal, false);
    assert.equal(incomplete.passed, false);
    assert.equal(incomplete.cumulative_after, -3100);
    assert.ok(incomplete.tiles.length < 14);
    assert.equal(incomplete.decomposition, null);
    const expectedMax = mode === 'mcr' ? 1024000 : 768000;
    assert.equal(Math.max(...hands.map(item => item.payload.win_score)), expectedMax);
    assert.equal(Math.max(...complete.map(item => item.payload.round_score)), expectedMax);
    assert.equal(Math.max(...complete.map(item => item.payload.cumulative_after)), expectedMax);
    for (const pattern of ['full_flush', 'seven_pairs', 'all_simples']) {
      assert.equal(hands.filter(item => item.payload.credited_pattern_ids.includes(`${mode}.${pattern}`)).length / hands.length, 0.5);
    }
    if (mode === 'riichi') {
      const noYaku = complete.find(item => item.payload.result_type === 'no_yaku').payload;
      assert.equal(noYaku.legal, false);
      assert.equal(noYaku.win_score + noYaku.process_score + noYaku.penalty_score, 0);
      assert.equal(noYaku.tiles.length, 14);
      assert.equal(noYaku.decomposition.groups.length, 5);
      assert.deepEqual(noYaku.credited_pattern_ids, []);
    }
    for (const item of fixture.filter(item => item.event_name === 'hand_completed')) {
      assert.equal(item.payload.result_type, 'win');
      const terminal = settled.find(row => row.payload.settlement_id === item.payload.settlement_id);
      assert.deepEqual(item.payload, terminal.payload);
      assert.deepEqual(item.context, terminal.context);
    }
    const replay = JSON.parse(JSON.stringify(fixture));
    assert.deepEqual(replay.map(item => item.context.hand_id), fixture.map(item => item.context.hand_id));
  }
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
      assert.equal(item.context.app_release, 'nine-batch-v9');
      assert.deepEqual(item.payload.owned_relic_ids, ['rank_brush']);
      assert.equal(item.payload.process_score, 0);
      assert.equal(item.context.hand_id, item.payload.settlement_id);
      assert.ok(item.payload.credited_pattern_ids.every(id => id.startsWith(`${mode}.`)));
    }
  }
  assert.throws(() => makeFixture('invalid'), /unsupported_fixture_mode/);
});

test('all sandbox facts pass shared validation and retain version-specific terminal permissions', async () => {
  const { validateGamePayload } = await import('../dist/analytics/game-schema.js');
  for (const mode of ['mcr', 'riichi']) {
    for (const item of makeFixture(mode)) {
      const result = validateGamePayload(item.event_name, item.payload, item.context);
      assert.equal(result.ok, true, `${mode}/${item.event_name}/${item.payload.result_type}: ${result.reason}`);
      assert.equal(validateGamePayload(item.event_name, { ...item.payload, owned_relic_ids: ['core_high'] }, item.context).ok, false);
      if (['no_yaku', 'incomplete'].includes(item.payload.result_type)) {
        assert.equal(validateGamePayload('hand_completed', item.payload, item.context).ok, false);
        assert.equal(validateGamePayload(item.event_name, item.payload, { ...item.context, ...v8() }).ok, false);
        if (item.payload.result_type === 'no_yaku') assert.equal(validateGamePayload(item.event_name, item.payload, { ...item.context, mode: 'mcr' }).ok, false);
        continue;
      }
      for (const oldVersion of [previous(), v3(), v4(), v5(), v6(), v7(), v8()]) {
        const oldContext = { ...item.context, rules_version: oldVersion.rules_version, score_model_version: oldVersion.score_model_version, app_release: oldVersion.rules_version.replaceAll('_', '-') };
        // These synthetic retained facts check old permissions; real outboxes are never relabelled.
        const oldPayload = { ...item.payload, owned_relic_ids: oldVersion.rules_version.startsWith('opening_build') ? ['core_high'] : [] };
        const oldResult = validateGamePayload(item.event_name, oldPayload, oldContext);
        assert.equal(oldResult.ok, true, `retained ${oldVersion.rules_version} ${mode}/${item.event_name}: ${oldResult.reason}`);
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
