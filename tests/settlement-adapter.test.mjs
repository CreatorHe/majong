import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { buildSettlementSnapshot, createSettlementPlayer, RELIC_ART_URLS } from '../dist/settlement-adapter.js';
import { validateSnapshot } from '../dist/settlement/player.js';
import { getEffect } from '../dist/settlement/effects-v2.js';
import { createBurstPlan, createBurstPlayer, DECORATION_LOAD_TIMEOUT_MS } from '../dist/settlement/v4/burst-player.js';
import { riichiPatterns } from '../dist/riichi-patterns.js';
import { newRun, chooseStarter, beginPlay, commit, settle } from '../dist/engine.js';

test('real engine results in both modes can play without adapter-side scoring', () => {
  for (const mode of ['mcr', 'riichi']) {
    const game = newRun(mode, 123); chooseStarter(game, 'core_growth'); beginPlay(game);
    const pool = [...game.hand, ...game.deck];
    const faces = [0, 1, 2, 9, 10, 11, 21, 22, 23, 15, 16, 17, 4, 4];
    const chosen = faces.map(face => pool.splice(pool.findIndex(tile => tile.face === face), 1)[0]);
    game.hand = [...chosen, ...pool.splice(0, 4)]; game.deck = pool;
    commit(game, chosen.map(tile => tile.id));
    const outcome = settle(game), before = JSON.stringify(game);
    const snapshot = buildSettlementSnapshot(game, outcome);
    assert.equal(validateSnapshot(snapshot), true);
    assert.equal(snapshot.totals.handScoreText, new Intl.NumberFormat('zh-CN').format(outcome.total));
    assert.equal(snapshot.totals.passed, outcome.passed);
    assert.equal(snapshot.hand.tiles.length, 14);
    assert.deepEqual(snapshot.relics, []);
    assert.equal(snapshot.presentation.baseLabel, '固定基数');
    assert.equal(JSON.stringify(game), before);
  }
});

function result({ falseHu = false, passed = true, cumulativeAfter = 1100, tiers = {} } = {}) {
  const groups = [[0, 1, 2], [9, 10, 11], [21, 22, 23], [15, 16, 17]];
  const faces = [...groups.flat(), 4, 4];
  const tiles = faces.map((face, i) => ({ id: `tile-${i}`, original: face, face, wild: false, entered: true }));
  return {
    runId: 'run-1', roundId: 'round-1', settlementId: 'settlement-1', rulesVersion: 2, mode: 'mcr',
    resultType: falseHu ? 'false_win' : 'win', legal: !falseHu, valid: true,
    base: falseHu ? 0 : 240, mult: falseHu ? 0 : 2.5, total: falseHu ? 0 : 600,
    penalty: falseHu ? 100 : 0, cumulativeBefore: falseHu ? cumulativeAfter + 100 : cumulativeAfter - 600,
    cumulativeAfter, target: 1000, passed, processScore: 80, roundScore: falseHu ? -20 : 680,
    tiles, tiers: { scoreTier: 0, multiplierTier: 0, patternTier: 0, ...tiers },
    patterns: falseHu ? [] : [{ id: 'test_pattern', name: '测试番型', fan: 6, tier: 0 }], gains: [],
    decomposition: falseHu ? null : {
      shape: 'normal', groups, pair: [4, 4], tiles,
      groupTileIds: groups.map((group, i) => group.map((_, j) => `tile-${i * 3 + j}`)),
      pairTileIds: ['tile-12', 'tile-13'], declaredKongs: [], wildcardAssignments: [],
    },
    steps: falseHu ? [
      { event: 'hand_reveal', tileIds: tiles.map(t => t.id) },
      { event: 'false_hu', operation: 'add', before: cumulativeAfter + 100, delta: -100, after: cumulativeAfter },
      { event: 'round_result', after: cumulativeAfter },
    ] : [
      { event: 'hand_reveal', tileIds: tiles.map(t => t.id) },
      { event: 'tile_score', target: 'base', operation: 'add', before: 0, delta: 240, after: 240, label: '完整牌底分' },
      { event: 'pattern_reveal', sourceId: 'test_pattern', target: 'multiplier', operation: 'add', before: 1, delta: 1.5, after: 2.5 },
      { event: 'hand_total', after: 600 },
      { event: 'round_result', after: cumulativeAfter },
    ],
  };
}

test('adapter preserves the settled ledger and never adds process points again', () => {
  const r = result(), game = { last: r, totalScore: 999999, processScore: 999999 };
  const before = JSON.stringify(game);
  const snapshot = buildSettlementSnapshot(game);
  assert.equal(validateSnapshot(snapshot), true);
  assert.equal(snapshot.totals.processScoreText, '80');
  assert.equal(snapshot.totals.handScoreText, '600');
  assert.equal(snapshot.totals.runScoreBeforeText, '500');
  assert.equal(snapshot.totals.runScoreText, '1,100');
  assert.equal(snapshot.totals.roundScoreText, '680');
  assert.equal(snapshot.mode, 'guobiao');
  assert.equal(snapshot.steps[2].afterText, '2.5');
  assert.deepEqual(snapshot.steps.map(step => step.event), r.steps.map(step => step.event));
  assert.equal(JSON.stringify(game), before);
  assert.ok(Object.isFrozen(snapshot.hand.tiles[0]));
  assert.ok(!Object.isFrozen(r.tiles[0]), 'only cloned display data is frozen');
});

test('false-hu has independent cumulative pass outcomes, including equality and negative scores', () => {
  for (const [cumulativeAfter, passed] of [[1100, true], [1000, true], [999, false], [-100, false]]) {
    const snapshot = buildSettlementSnapshot({}, result({ falseHu: true, cumulativeAfter, passed }));
    assert.equal(validateSnapshot(snapshot), true);
    assert.equal(snapshot.handResult, 'false_hu');
    assert.equal(snapshot.totals.passed, passed);
    assert.equal(snapshot.totals.penaltyText, '100');
    assert.deepEqual(snapshot.steps.map(step => step.event), ['hand_reveal', 'false_hu', 'round_result']);
    assert.equal(snapshot.totals.progressRatio, Math.max(0, Math.min(1, cumulativeAfter / 1000)));
  }
  assert.equal(buildSettlementSnapshot({}, result({ cumulativeAfter: 999, passed: false })).handResult, 'agari');
});

test('kong real tiles, seven pair names, and wildcard assignments keep engine identities', () => {
  const r = result(), d = r.decomposition;
  d.groups[0] = [0, 0, 0, 0];
  for (let i = 0; i < 3; i++) d.tiles[i].face = 0;
  d.tiles.push({ id: 'fourth-kong', face: 0, original: 0, wild: false });
  d.groupTileIds[0].push('fourth-kong');
  d.declaredKongs = [{ id: 'kong-1', face: 0, tileIds: [...d.groupTileIds[0]] }];
  d.tiles[4].wild = true;
  d.wildcardAssignments = [{ tileId: 'tile-4', face: 10, suit: 1 }];
  const snapshot = buildSettlementSnapshot({}, r);
  assert.equal(validateSnapshot(snapshot), true);
  assert.equal(snapshot.hand.tiles.length, 15);
  assert.equal(snapshot.hand.decomposition[0].type, 'kong');
  assert.equal(snapshot.hand.declaredKongs[0].tileIds.length, 4);
  assert.equal(snapshot.hand.wildcardAssignments[0].label, '2筒');
  assert.equal(snapshot.hand.tiles.find(t => t.id === 'tile-4').wildcard, true);
  const pairs = result();
  pairs.decomposition.shape = 'pairs';
  pairs.decomposition.groups = Array.from({ length: 7 }, (_, i) => [i, i]);
  pairs.decomposition.groupTileIds = Array.from({ length: 7 }, (_, i) => [`tile-${i * 2}`, `tile-${i * 2 + 1}`]);
  pairs.decomposition.pairTileIds = [];
  assert.ok(buildSettlementSnapshot({}, pairs).hand.decomposition.every(group => group.label === '对子'));
  for (const [shape, mode, faces, groupSizes, expectedLabel] of [
    ['orphans', 'riichi', [0,8,9,17,18,26,27,28,29,30,31,32,33,33], [14], '国士无双'],
    ['orphans', 'mcr', [0,8,9,17,18,26,27,28,29,30,31,32,33,33], [14], '十三幺'],
    ['unconnected', 'mcr', [0,3,6,10,13,16,20,27,28,29,30,31,32,33], [14], '不靠牌'],
    ['knitted', 'mcr', [0,3,6,10,13,16,20,23,26,1,1,1,2,2], [9,3], '组合龙'],
  ]) {
    const special = result(); special.mode = mode;
    const tiles = faces.map((face, i) => ({ id: `tile-${i}`, face }));
    let offset = 0;
    const groups = groupSizes.map(size => { const group = faces.slice(offset, offset + size); offset += size; return group; });
    offset = 0;
    const groupTileIds = groupSizes.map(size => { const ids = tiles.slice(offset, offset + size).map(t => t.id); offset += size; return ids; });
    special.decomposition = { shape, tiles, groups, groupTileIds, pair: faces.slice(offset), pairTileIds: tiles.slice(offset).map(t => t.id), declaredKongs: [], wildcardAssignments: [] };
    const snapshot = buildSettlementSnapshot({}, special);
    assert.equal(validateSnapshot(snapshot), true, `${mode}/${shape}`);
    assert.equal(snapshot.hand.decomposition[0].type, 'special');
    assert.equal(snapshot.hand.decomposition[0].label, expectedLabel);
    assert.equal(snapshot.hand.decomposition[0].tileIds.length, groupSizes[0]);
    assert.equal(new Set(snapshot.hand.decomposition.flatMap(g => g.tileIds)).size, 14);
    if (shape === 'knitted') assert.deepEqual(snapshot.hand.decomposition.map(g => g.type), ['special', 'triplet', 'pair']);
  }
});

test('five highlight combinations use authoritative tiers, not inferred score labels', () => {
  for (const [scoreTier, multiplierTier, patternTier] of [[0, 0, 0], [2, 0, 0], [0, 2, 0], [0, 0, 2], [2, 2, 2]]) {
    const r = result({ tiers: { scoreTier, multiplierTier, patternTier } });
    const snapshot = buildSettlementSnapshot({}, r);
    assert.deepEqual(snapshot.tiers, r.tiers);
    assert.equal(snapshot.patterns[0].classification, undefined);
  }
  const riichi = result(); riichi.mode = 'riichi'; riichi.patterns[0].classification = 'yakuman';
  assert.equal(buildSettlementSnapshot({}, riichi).patterns[0].classification, 'yakuman');
  riichi.mode = 'mcr';
  assert.equal(buildSettlementSnapshot({}, riichi).patterns[0].classification, undefined);
  const high = result({ tiers: { scoreTier: 2, multiplierTier: 2 } });
  assert.equal(getEffect(buildSettlementSnapshot({}, high)).rarity, '普通');
  high.patterns = [{ name: '大三元', id: '大三元', fan: 13, tier: 2, classification: 'yakuman' }];
  high.mode = 'riichi';
  assert.equal(getEffect(buildSettlementSnapshot({}, high)).rarity, '役满');
  high.mode = 'mcr';
  assert.equal(getEffect(buildSettlementSnapshot({}, high)).rarity, '大番');
  high.mode = 'riichi';
  high.patterns = riichiPatterns([[27,27,27], [28,28,28], [29,29,29], [30,30,30]], [31,31]);
  const double = buildSettlementSnapshot({}, high);
  assert.equal(double.patterns.find(p => p.label === '大四喜').yakumanMultiplier, 2);
  assert.equal(getEffect(double).id, 'daisuushii', 'actual double-yakuman outranks a coexisting single-yakuman theme');
  assert.equal(getEffect(double).rarity, '双倍役满');
  high.mode = 'mcr';
  assert.equal(buildSettlementSnapshot({}, high).patterns.find(p => p.label === '大四喜').yakumanMultiplier, undefined);
  assert.equal(getEffect(buildSettlementSnapshot({}, high)).rarity, '大番');
  for (const [mode, name, effectId] of [
    ['riichi','国士无双','kokushi'], ['mcr','十三幺','kokushi'],
    ['riichi','清老头','chinroutou'], ['mcr','清幺九','chinroutou'],
    ['riichi','四杠子','suukantsu'], ['mcr','四杠','suukantsu'],
    ['riichi','绿一色','ryuuiisou'], ['riichi','九莲宝灯','chuuren'], ['riichi','小四喜','shousuushii'],
    ['riichi','混老头','honroutou'], ['mcr','混幺九','honroutou'],
  ]) {
    high.mode = mode;
    const ordinary = effectId === 'honroutou';
    high.patterns = [{ name, id: name, fan: ordinary ? 2 : 13, tier: ordinary ? 0 : 2, ...(!ordinary && mode === 'riichi' ? { classification: 'yakuman' } : {}) }];
    const effect = getEffect(buildSettlementSnapshot({}, high));
    assert.equal(effect.id, effectId, name);
    assert.equal(effect.label, name, `${mode} preserves its pattern name`);
    assert.equal(effect.rarity, ordinary ? mode === 'riichi' ? '役种' : '番型' : mode === 'riichi' ? '役满' : '大番');
  }
  assert.equal(getEffect({ mode: 'riichi', presentation: { effectId: 'suuankou' }, patterns: [{ label: '四暗刻', classification: 'yakuman' }] }).id, 'normal');
  high.mode = 'riichi'; high.patterns = [];
  high.gains = [{ id: 'wheel', kind: 'unlock', name: '大车轮' }];
  assert.equal(getEffect(buildSettlementSnapshot({}, high)).id, 'daisharin');
  assert.equal(getEffect(buildSettlementSnapshot({}, high)).rarity, '秘卷');
  high.resultType = 'false_win';
  assert.equal(getEffect(buildSettlementSnapshot({}, high)).id, 'false_hu');
});

test('all registered relic images exist and the reserve relic is excluded', () => {
  const manifest = JSON.parse(readFileSync(new URL('../dist/art/manifest.json', import.meta.url), 'utf8'));
  assert.equal(Object.keys(RELIC_ART_URLS).length, 28);
  assert.equal(manifest.relics.single_chain, undefined);
  for (const [id, url] of Object.entries(RELIC_ART_URLS)) {
    assert.ok(existsSync(new URL(url)), id);
    assert.equal(new URL(manifest.relics[id], new URL('../dist/', import.meta.url)).href, url);
  }
  const css = readFileSync(new URL('../dist/settlement/settlement.css', import.meta.url), 'utf8');
  assert.ok(css.includes('../art/backgrounds/board-v2.webp'));
  assert.ok(!css.includes('assets/backgrounds/'));
});

class Element {
  constructor() {
    this.children = []; this.dataset = {}; this._text = ''; this.classes = new Set();
    this.style = { setProperty() {} };
    this.classList = {
      add: (...names) => names.forEach(name => this.classes.add(name)),
      remove: (...names) => names.forEach(name => this.classes.delete(name)),
      toggle: (name, on) => on ? this.classes.add(name) : this.classes.delete(name),
    };
  }
  set textContent(value) { this._text = String(value); this.children = []; }
  get textContent() { return this._text + this.children.map(child => child.textContent).join(''); }
  append(...nodes) { this.children.push(...nodes); }
  insertBefore(node, reference) { this.children.splice(this.children.indexOf(reference), 0, node); }
  getBoundingClientRect() { return { width: 920, height: 518, left: 0, top: 0, bottom: 518 }; }
  replaceChildren(...nodes) { this.children = [...nodes]; this._text = ''; }
  setAttribute() {}
  addEventListener() {}
  getAnimations() { return []; }
  remove() { this.removed = true; }
  get childElementCount() { return this.children.length; }
}

test('V4 loading skip, completed replay and disposal never replay frozen score operations', async () => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'document');
  globalThis.document = { createElement: () => new Element() };
  let time = 0, frame = 0, finishLoad, disposed = 0;
  const frames = new Map(), sounds = [], steps = [], rendered = [];
  const audio = { setMuted() {}, stopAll() {}, play(event) { sounds.push(event); }, unlock: async () => true, dispose() {}, getState: () => ({}) };
  const renderer = { canvas: new Element(), setScene: async () => {}, render(ms) { rendered.push(ms); }, reset() {}, dispose() { disposed++; } };
  const clock = { now: () => time, request: fn => { frames.set(++frame, fn); return frame; }, cancel: id => frames.delete(id) };
  const player = createBurstPlayer(new Element(), { audioFactory: () => audio, clock, libraryFactory: () => finishLoad ? Promise.resolve({ ...renderer, canvas: new Element() }) : new Promise(resolve => { finishLoad = resolve; }) });
  const snapshot = buildSettlementSnapshot({}, result()), before = JSON.stringify(snapshot);
  const flush = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
  try {
    const first = player.play(snapshot); assert.equal(player.getState().state, 'loading');
    player.skip(); player.skip(); assert.equal((await first).status, 'skipped');
    assert.deepEqual(player.getState().values, { base: '240', multiplier: '2.5', score: '600' });
    await flush(); finishLoad(renderer); await flush();
    assert.equal(frames.size, 0, 'late loading cannot restart a skipped settlement');
    assert.equal(player.play(snapshot), first, 'same ledger returns original promise unless replay was explicit');
    const replay = player.play(snapshot, { replay: true, reducedMotion: false, speed: 1, onStep: step => steps.push(step.id) });
    player.setSpeed(2); player.setReducedMotion(true);
    await flush();
    assert.equal(player.getState().speed, 2, 'loading completion preserves the current speed');
    assert.equal(player.getState().reducedMotion, true, 'loading completion preserves reduced motion');
    assert.deepEqual(rendered, [2700], 'first ready frame is static when reduced motion changed during loading');
    time = 3000; const callback = [...frames.values()].at(-1); frames.clear(); callback(time);
    assert.equal((await replay).status, 'completed');
    assert.equal(steps.length, snapshot.steps.length);
    assert.equal(new Set(steps).size, steps.length, 'each delayed-frame operation is shown exactly once');
    assert.equal(sounds.length, 2, 'one initial cue and one coalesced delayed-frame sound');
    assert.equal(player.getState().pendingFrame, false);
    assert.equal(JSON.stringify(snapshot), before);
    player.destroy(); player.destroy(); assert.equal(disposed, 2);
  } finally {
    player.destroy();
    if (previous) Object.defineProperty(globalThis, 'document', previous); else delete globalThis.document;
  }
});

test('decoration total deadline completes frozen results and rejects late renderer or theme backfill', async () => {
  const keys = ['document', 'setTimeout', 'clearTimeout', 'cancelAnimationFrame'];
  const previous = new Map(keys.map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  const timers = new Map(); let timerId = 0;
  globalThis.document = { createElement: () => new Element(), createElementNS: () => new Element() };
  globalThis.setTimeout = (callback, delay) => { timers.set(++timerId, { callback, delay }); return timerId; };
  globalThis.clearTimeout = id => timers.delete(id);
  globalThis.cancelAnimationFrame = () => {};
  const flush = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
  try {
    for (const stage of ['renderer', 'theme']) {
      let finishLoad, signal, completions = 0, disposed = 0, renders = 0, frames = 0;
      const root = new Element(), snapshot = buildSettlementSnapshot({}, result()), before = JSON.stringify(snapshot);
      const renderer = { canvas: new Element(), setScene: () => stage === 'theme' ? new Promise(resolve => { finishLoad = resolve; }) : Promise.resolve(), render() { renders++; }, reset() {}, dispose() { disposed++; } };
      const audio = { setMuted() {}, stopAll() {}, play() { assert.fail('a timed-out decoration must not play cues'); }, unlock: async () => true };
      const player = createSettlementPlayer(root, { audio,
        clock: { now: () => 0, request: () => ++frames, cancel() {} },
        libraryFactory: options => { signal = options.signal; return stage === 'renderer' ? new Promise(resolve => { finishLoad = resolve; }) : Promise.resolve(renderer); },
      });
      try {
        const playing = player.play(snapshot, { onComplete: () => completions++ });
        player.setSpeed(2); player.setReducedMotion(true);
        await flush();
        assert.equal(player.getState().state, 'loading');
        const deadline = [...timers.values()].find(timer => timer.delay === DECORATION_LOAD_TIMEOUT_MS);
        assert.ok(deadline, stage + ' has one total load deadline'); deadline.callback();
        assert.equal((await playing).status, 'fallback');
        assert.equal(completions, 1);
        assert.equal(signal.aborted, true);
        assert.deepEqual(player.getState().values, { base: '240', multiplier: '2.5', score: '600' });
        assert.ok(root.textContent.includes('1,100')); assert.ok(root.textContent.includes('演出加载超时'));
        finishLoad(stage === 'renderer' ? renderer : undefined); await flush();
        assert.equal(disposed, 1, stage + ' is released exactly once');
        assert.equal(root.children[0].children[0].children.length, 0, 'late canvas never mounts');
        assert.equal(renders, 0); assert.equal(frames, 0);
        assert.equal(player.getState().pendingFrame, false);
        player.skip(); assert.equal(completions, 1);
        assert.equal(JSON.stringify(snapshot), before);
        assert.equal(timers.size, 0);
      } finally { player.dispose(); }
    }
  } finally {
    for (const [key, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key];
    }
  }
});

test('skip, replay and fallback show the same result without changing game or invoking settlement', async () => {
  const keys = ['document', 'requestAnimationFrame', 'cancelAnimationFrame'];
  const previous = new Map(keys.map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  const frames = new Map(); let frameId = 0;
  globalThis.document = { createElement: () => new Element(), createElementNS: () => new Element() };
  globalThis.requestAnimationFrame = callback => { frames.set(++frameId, callback); return frameId; };
  globalThis.cancelAnimationFrame = id => frames.delete(id);
  const game = { last: result({ falseHu: true, passed: true }) };
  const before = JSON.stringify(game);
  const root = new Element(), events = [];
  const audio = { setMuted() {}, stopAll() {}, play(name) { events.push(name); }, unlock: async () => true };
  const player = createSettlementPlayer(root, { audio, libraryFactory: async () => ({ canvas: new Element(), setScene: async () => {}, render() {}, reset() {}, dispose() {} }) });
  try {
    const snapshot = buildSettlementSnapshot(game);
    for (let i = 0; i < 2; i++) {
      let completions = 0;
      const promise = player.play(snapshot, { muted: true, reducedMotion: true, onComplete: () => completions++ });
      assert.equal(player.effect.id, 'false_hu');
      player.skip(); player.skip();
      assert.equal((await promise).status, 'skipped');
      assert.equal(completions, 1);
      assert.equal(player.round.textContent, '1,100');
      assert.equal(player.resultLabel.textContent, '仍然达标 · 过关');
      assert.equal(frames.size, 0);
    }
    const legal = buildSettlementSnapshot({}, result());
    const legalPlay = player.play(legal, { muted: true, reducedMotion: true });
    assert.ok(root.textContent.includes('和牌'));
    assert.equal(player.getState().state, 'loading');
    player.skip();
    assert.equal((await legalPlay).status, 'skipped');
    assert.equal(player.getState().values.score, '600');
    assert.ok(root.textContent.includes('1,100'));
    const broken = structuredClone(snapshot); delete broken.totals.passed;
    assert.equal((await player.play(broken)).status, 'fallback');
    assert.ok(root.textContent.includes('1,100'));
    assert.ok(root.textContent.includes('结果状态暂不可用'));
    assert.equal(JSON.stringify(game), before);
    assert.deepEqual(events, []);
  } finally {
    player.dispose();
    for (const [key, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key];
    }
  }
});


test('V4 maps only supported patterns and keeps held-trigger references separate from fourteen-tile hand', () => {
  const r = result(); r.mode = 'riichi';
  r.patterns = [{ id: '纯正九莲宝灯', name: '纯正九莲宝灯', classification: 'yakuman', fan: 26, tier: 2 }];
  assert.equal(buildSettlementSnapshot({}, r).presentation.effectId, 'normal');
  r.patterns = [{ id: '对对和', name: '对对和', fan: 2, tier: 0 }];
  r.heldTiles = [{ id: 'held-one', face: 0 }];
  r.steps.splice(2, 0, { event: 'relic_trigger', relicId: 'core_held', label: '藏锋匣', target: 'multiplier', operation: 'multiply', before: 1, delta: 1.35, after: 1.35, tileIds: ['held-one'] });
  const snapshot = buildSettlementSnapshot({}, r);
  assert.equal(validateSnapshot(snapshot), true);
  assert.equal(snapshot.presentation.effectId, 'toitoi');
  assert.equal(snapshot.hand.tiles.length, 14);
  assert.equal(snapshot.hand.heldTiles.length, 1);
  const plan = createBurstPlan(snapshot);
  assert.equal(plan.snapshot.hand.heldTiles[0].id, 'held-one');
  assert.ok(Object.isFrozen(plan.snapshot.hand.heldTiles[0]));
  assert.equal(plan.cues.at(-2).step.afterText, snapshot.totals.handScoreText);
  assert.equal(plan.cues.at(-1).step.afterText, snapshot.totals.runScoreText);
  const bad = structuredClone(snapshot); bad.steps[2].tileIds = ['not-seen'];
  assert.throws(() => createBurstPlan(bad), /不存在/);
  assert.throws(() => createBurstPlan(buildSettlementSnapshot({}, result({ falseHu: true }))), /诈胡/);
});

test('V9 no-yaku and incomplete preserve frozen outcomes through playback, skip and fallback without a victory renderer', async () => {
  const keys = ['document', 'requestAnimationFrame', 'cancelAnimationFrame'];
  const previous = new Map(keys.map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  const frames = new Map(), sounds = []; let frameId = 0, rendererCalls = 0;
  globalThis.document = { createElement: () => new Element(), createElementNS: () => new Element() };
  globalThis.requestAnimationFrame = callback => { frames.set(++frameId, callback); return frameId; };
  globalThis.cancelAnimationFrame = id => frames.delete(id);
  const root = new Element(), audio = { setMuted() {}, stopAll() {}, play(name) { sounds.push(name); }, unlock: async () => true };
  const player = createSettlementPlayer(root, { audio, libraryFactory: () => { rendererCalls++; throw Error('must not load victory art'); } });
  try {
    for (const state of ['no_yaku', 'incomplete']) for (const passed of [true, false]) {
      const snapshot = structuredClone(buildSettlementSnapshot({}, result()));
      snapshot.handResult = state;
      snapshot.presentation = { effectId: 'chuuren', baseLabel: '固定基数', multiplierLabel: '牌型倍率', formulaNote: '固定基数 × 牌型倍率' };
      snapshot.tiers = { scoreTier: 2, multiplierTier: 2, patternTier: 2 };
      if (state === 'incomplete') { snapshot.hand.tiles = snapshot.hand.tiles.slice(0, passed ? 10 : 0); snapshot.hand.decomposition = []; }
      snapshot.steps = ['hand_reveal', state, 'round_result'].map((event, index) => ({ id: String(index), event, tileIds: [], target: 'score', operation: 'set', afterText: '0' }));
      Object.assign(snapshot.totals, { handScoreText: '0', penaltyText: state === 'incomplete' ? '500' : '0', runScoreBeforeText: '1,500', runScoreText: state === 'incomplete' ? '1,000' : '1,500', passed });
      const before = JSON.stringify(snapshot);
      assert.equal(validateSnapshot(snapshot), true); assert.equal(getEffect(snapshot).id, state);
      assert.throws(() => createBurstPlan(snapshot), /只接受/);
      const wrongOrder = structuredClone(snapshot); wrongOrder.steps[1].event = 'false_hu';
      assert.throws(() => validateSnapshot(wrongOrder), /顺序/);
      if (state === 'no_yaku') { const bad = structuredClone(snapshot); bad.hand.decomposition = []; assert.throws(() => validateSnapshot(bad), /完整覆盖/); }
      for (const skip of [false, true]) {
        let completions = 0; const seen = [];
        const pending = player.play(snapshot, { durationMs: 30, reducedMotion: true, onComplete: () => completions++, onStep: step => seen.push(step.event) });
        if (skip) { player.skip(); player.skip(); }
        else { const callback = [...frames.values()].at(-1); frames.clear(); callback(performance.now() + 100); }
        assert.equal((await pending).status, skip ? 'skipped' : 'completed');
        assert.equal(completions, 1); assert.equal(frames.size, 0);
        assert.equal(player.heroLabel.textContent, state === 'no_yaku' ? '无役' : '未完成');
        assert.equal(player.score.textContent, state === 'no_yaku' ? '0' : '−500');
        assert.equal(player.round.textContent, snapshot.totals.runScoreText);
        assert.equal(player.result.dataset.passed, String(passed));
        assert.equal(player.formula.hidden, true); assert.equal(player.patternHero.classes.has('is-emphasis'), false);
        assert.ok(!root.textContent.includes('诈胡')); assert.ok(!root.textContent.includes('和牌分'));
        if (state === 'incomplete') assert.ok(!root.textContent.includes('成型 14 / 14'));
        if (!skip) assert.deepEqual(seen, ['hand_reveal', state, 'round_result']);
      }
      const broken = structuredClone(snapshot); broken.steps = [];
      assert.equal((await player.play(broken)).status, 'fallback');
      assert.ok(root.textContent.includes(state === 'no_yaku' ? '无役结算' : '未完成结算'));
      assert.ok(root.textContent.includes(snapshot.totals.runScoreText)); assert.ok(!root.textContent.includes('诈胡'));
      assert.equal(JSON.stringify(snapshot), before);
    }
    assert.equal(rendererCalls, 0); assert.ok(sounds.every(name => name === 'hand_check'));
  } finally {
    player.dispose();
    for (const [key, descriptor] of previous) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key]; }
  }
});

test('V9 fixed-base labels survive V4 plans, skip and final-only fallback while old snapshots keep their defaults', async () => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'document');
  globalThis.document = { createElement: () => new Element() };
  const root = new Element(), audio = { setMuted() {}, stopAll() {}, play() {}, unlock: async () => true, dispose() {}, getState: () => ({}) };
  const player = createBurstPlayer(root, { audioFactory: () => audio, clock: { now: () => 0, request: () => 1, cancel() {} }, libraryFactory: async () => ({ canvas: new Element(), setScene: async () => {}, render() {}, reset() {}, dispose() {} }) });
  const snapshot = structuredClone(buildSettlementSnapshot({}, result()));
  Object.assign(snapshot.presentation, { baseLabel: '固定基数', multiplierLabel: '牌型倍率', formulaNote: '固定基数 × 牌型倍率' });
  const before = JSON.stringify(snapshot), find = (node, cls) => node.className === cls ? node : node.children.map(child => find(child, cls)).find(Boolean);
  try {
    const plan = createBurstPlan(snapshot);
    assert.equal(plan.snapshot.presentation.baseLabel, '固定基数'); assert.equal(plan.snapshot.presentation.multiplierLabel, '牌型倍率'); assert.equal(plan.snapshot.presentation.formulaNote, '固定基数 × 牌型倍率');
    assert.ok(Object.isFrozen(plan.snapshot.presentation));
    const playing = player.play(snapshot); player.skip(); assert.equal((await playing).status, 'skipped');
    assert.equal(find(root, 'jr-burst-hub').children[0].children[0].textContent, '固定基数');
    assert.equal(find(root, 'jr-burst-hub').children[2].children[0].textContent, '牌型倍率');
    assert.ok(find(root, 'jr-burst-latest').textContent.includes('固定基数 × 牌型倍率'));
    assert.equal(find(root, 'jr-burst-formula-note').textContent, '固定基数 × 牌型倍率'); assert.equal(find(root, 'jr-burst-formula-note').hidden, false);
    const broken = structuredClone(snapshot); broken.settlementId += ':fallback'; broken.steps = [];
    assert.equal((await player.play(broken)).status, 'fallback');
    assert.equal(find(root, 'jr-burst-hub').children[0].children[0].textContent, '固定基数');
    assert.ok(find(root, 'jr-burst-latest').textContent.includes('固定基数 × 牌型倍率'));
    const old = structuredClone(snapshot); old.settlementId += ':legacy'; delete old.presentation.baseLabel; delete old.presentation.multiplierLabel; delete old.presentation.formulaNote;
    const legacy = player.play(old); player.skip(); await legacy;
    assert.equal(find(root, 'jr-burst-hub').children[0].children[0].textContent, '底分'); assert.equal(find(root, 'jr-burst-hub').children[2].children[0].textContent, '倍率');
    assert.ok(find(root, 'jr-burst-latest').textContent.includes('底分与倍率已汇聚'));
    assert.equal(find(root, 'jr-burst-formula-note').hidden, true);
    assert.equal(JSON.stringify(snapshot), before);
  } finally { player.destroy(); if (previous) Object.defineProperty(globalThis, 'document', previous); else delete globalThis.document; }
});
