import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { buildSettlementSnapshot, createSettlementPlayer, RELIC_ART_URLS } from '../dist/settlement-adapter.js';
import { validateSnapshot } from '../dist/settlement/player.js';
import { getEffect } from '../dist/settlement/effects-v2.js';
import { MotionVideo } from '../dist/settlement/motion-v3.js';
import { riichiPatterns } from '../dist/riichi-patterns.js';
import { newRun, chooseStarter, commit, settle } from '../dist/engine.js';

test('real engine results in both modes can play without adapter-side scoring', () => {
  for (const mode of ['mcr', 'riichi']) {
    const game = newRun(mode, 123); chooseStarter(game, 'jade');
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
    assert.equal(snapshot.relics[0].id, 'jade');
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
  assert.equal(Object.keys(RELIC_ART_URLS).length, 21);
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
}

test('motion media cannot restart after cancellation or reduced motion and rejection stays a static fallback', async () => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'document');
  const videos = [];
  class Video extends Element {
    constructor() {
      super(); this.readyState = 0; this.currentTime = 0; this.paused = true; this.plays = 0; this.listeners = new Map();
      this.playResult = new Promise((resolve, reject) => { this.resolvePlay = resolve; this.rejectPlay = reject; });
    }
    addEventListener(name, callback) { this.listeners.set(name, callback); }
    emit(name) { this.listeners.get(name)?.(); }
    load() {}
    play() { this.plays++; this.paused = false; return this.playResult; }
    pause() { this.paused = true; }
    removeAttribute(name) { if (name === 'src') this.src = ''; }
    remove() { this.removed = true; }
  }
  globalThis.document = { createElement(tag) { assert.equal(tag, 'video'); const video = new Video(); videos.push(video); return video; } };
  const flush = async () => { for (let i = 0; i < 4; i++) await Promise.resolve(); };
  const host = new Element(), media = new MotionVideo(host, 'theme.mp4');
  try {
    for (const options of [{ reducedMotion: true }, { poster: true }, { phase: 'result' }]) media.render(.2, options);
    media.render(1);
    assert.equal(videos.length, 0, 'static display must not download a motion source');

    media.render(.2);
    const cancelled = videos.at(-1);
    media.cancel(); cancelled.readyState = 2; cancelled.emit('loadeddata'); media.render(.3);
    assert.equal(cancelled.plays, 0);
    assert.equal(cancelled.src, '');
    assert.equal(videos.length, 1, 'late loading and further frames cannot revive a cancelled clip');

    const reduced = new MotionVideo(host, 'theme.mp4'); reduced.render(.2, { paused: true });
    const pending = videos.at(-1); pending.readyState = 2; pending.emit('loadeddata');
    assert.equal(pending.plays, 0, 'loading while paused must stay paused');
    reduced.render(.2); assert.equal(pending.plays, 1);
    reduced.render(.2, { reducedMotion: true });
    pending.paused = false; pending.resolvePlay(); await flush(); pending.emit('loadeddata');
    assert.equal(pending.paused, true, 'late successful play is stopped after reduced motion releases the clip');
    assert.equal(reduced.video, null);
    assert.equal(pending.removed, true);
    reduced.dispose(); reduced.render(.3);
    assert.equal(videos.length, 2);

    const rejected = new MotionVideo(host, 'theme.mp4'); rejected.render(.2);
    const blocked = videos.at(-1); blocked.readyState = 2; blocked.emit('loadeddata');
    blocked.rejectPlay(new Error('Playback denied')); await flush();
    assert.equal(rejected.failed, true);
    assert.equal(rejected.video, null);
    assert.equal(blocked.paused, true);
    assert.doesNotThrow(() => { rejected.render(.5); rejected.render(1, { phase: 'result' }); rejected.cancel(); rejected.dispose(); }, 'media failure must not interrupt the settlement clock or completion');
    assert.equal(videos.length, 3, 'failed media leaves the static poster without retrying on every frame');
  } finally {
    media.dispose();
    if (previous) Object.defineProperty(globalThis, 'document', previous); else delete globalThis.document;
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
  const player = createSettlementPlayer(root, { audio });
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
    assert.equal(player.stage.titleText.textContent, '和牌');
    player.skip();
    assert.equal((await legalPlay).status, 'skipped');
    assert.equal(player.round.textContent, '1,100');
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
