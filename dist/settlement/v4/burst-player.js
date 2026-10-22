import { createLibraryPlayer } from './library-player.js';
import { SCENES, PATTERN_ANIMATIONS } from './catalog.js';
import { createSettlementAudio } from '../audio.js';
import { isArtObjectURL } from '../../art-loader.js';

export const BURST_DURATION = 5400;
export const DECORATION_LOAD_TIMEOUT_MS = 8000;
const EVENTS = new Set(['hand_reveal', 'tile_score', 'pattern_reveal', 'relic_trigger', 'multiplier_update', 'hand_total', 'round_result']);
const EVENT_LABELS = Object.freeze({ hand_reveal: '构筑成型', tile_score: '底分汇入', pattern_reveal: '番型叠加', relic_trigger: '奇物共鸣', multiplier_update: '倍率收束', hand_total: '一手落定', round_result: '本次结果' });
const VALUE_FIELDS = ['beforeText', 'deltaText', 'afterText', 'detailText'];
const TOTAL_FIELDS = ['baseText', 'multiplierText', 'handScoreText', 'runScoreText', 'targetText'];
const cleanText = value => typeof value === 'string' ? value : '';
const clamp = (value, lo, hi) => Math.max(lo, Math.min(hi, value));
const freeze = value => { if (value && typeof value === 'object' && !Object.isFrozen(value)) { Object.values(value).forEach(freeze); Object.freeze(value); } return value; };
const make = (tag, className, text) => { const node = document.createElement(tag); if (className) node.className = className; if (text !== undefined) node.textContent = text; return node; };

/** Only validates/copies presentation strings and schedules time. No score arithmetic. */
export function createBurstPlan(input, { durationMs = BURST_DURATION } = {}) {
  if (!input || input.handResult !== 'agari') throw new TypeError('构筑爆发只接受已结算的合法和牌；诈胡使用原结算分支。');
  if (!cleanText(input.settlementId)) throw new TypeError('缺少 settlementId。');
  if (!Array.isArray(input.steps) || input.steps.length < 3 || input.steps.length > 128) throw new TypeError('需要完整的冻结 steps（3–128 项）。');
  for (const field of TOTAL_FIELDS) if (!cleanText(input.totals?.[field])) throw new TypeError(`缺少显示文本 totals.${field}。`);
  if (typeof input.totals.passed !== 'boolean') throw new TypeError('totals.passed 必须由结算结果提供。');
  const seen = new Set();
  const steps = input.steps.map((raw, index) => {
    if (!raw || !EVENTS.has(raw.event) || !cleanText(raw.id) || seen.has(raw.id)) throw new TypeError(`步骤 ${index + 1} 的事件或唯一 id 无效。`);
    seen.add(raw.id);
    const step = { id: raw.id, event: raw.event, sourceId: cleanText(raw.sourceId), label: cleanText(raw.label), relicId: cleanText(raw.relicId), target: cleanText(raw.target), operation: cleanText(raw.operation), tileIds: Array.isArray(raw.tileIds) ? raw.tileIds.filter(id => typeof id === 'string') : [] };
    for (const field of VALUE_FIELDS) {
      if (raw[field] !== undefined && typeof raw[field] !== 'string') throw new TypeError(`${raw.id}.${field} 必须是冻结显示文本。`);
      if (raw[field] !== undefined) step[field] = raw[field];
    }
    if (['tile_score', 'multiplier_update', 'hand_total', 'round_result'].includes(step.event) && !step.afterText) throw new TypeError(`${raw.id} 缺少 afterText。`);
    if (['base', 'multiplier'].includes(step.target) && !step.afterText) throw new TypeError(`${raw.id} 缺少目标显示值。`);
    return step;
  });
  if (steps[0].event !== 'hand_reveal' || steps.at(-2).event !== 'hand_total' || steps.at(-1).event !== 'round_result' || steps.filter(s => s.event === 'hand_reveal').length !== 1 || steps.filter(s => s.event === 'hand_total').length !== 1 || steps.filter(s => s.event === 'round_result').length !== 1) throw new TypeError('需要一次 hand_reveal，最后依次为一次 hand_total、round_result。');
  if (steps.at(-2).afterText !== input.totals.handScoreText || steps.at(-1).afterText !== input.totals.runScoreText) throw new TypeError('最终步骤与 totals 的冻结显示文本不一致。');
  const totals = Object.fromEntries(TOTAL_FIELDS.map(field => [field, input.totals[field]]));
  totals.passed = input.totals.passed;
  const tiles = (input.hand?.tiles || []).slice(0, 64).map(t => ({ id: cleanText(t.id), face: cleanText(t.face), label: cleanText(t.label), imageUrl: cleanText(t.imageUrl) }));
  if (tiles.some(t => !t.id) || new Set(tiles.map(t => t.id)).size !== tiles.length) throw new TypeError('牌面需要稳定且唯一的实例 id。');
  const heldTiles = (input.hand?.heldTiles || []).slice(0, 64).map(t => ({ id: cleanText(t.id), face: cleanText(t.face), label: cleanText(t.label), imageUrl: cleanText(t.imageUrl) }));
  const tileIds = new Set([...tiles, ...heldTiles].map(t => t.id));
  if (heldTiles.some(t => !t.id) || tileIds.size !== tiles.length + heldTiles.length) throw new TypeError('实牌与留牌实例 id 重复或缺失。');
  if (steps.some(s => s.tileIds.some(id => !tileIds.has(id)))) throw new TypeError('步骤引用了不存在的牌实例。');
  const snapshot = {
    settlementId: input.settlementId, handResult: 'agari', mode: cleanText(input.mode), rulesVersion: cleanText(input.rulesVersion),
    presentation: { effectId: cleanText(input.presentation?.effectId) || 'normal', label: cleanText(input.presentation?.label), seal: cleanText(input.presentation?.seal) },
    hand: { tiles, heldTiles, decomposition: (input.hand?.decomposition || []).map(g => ({ label: cleanText(g.label), tileIds: [...(g.tileIds || [])] })) }, patterns: (input.patterns || []).map(p => ({ id: cleanText(p.id), label: cleanText(p.label), valueText: cleanText(p.valueText) })),
    tiers: { scoreTier: clamp(Number(input.tiers?.scoreTier) || 0, 0, 2), multiplierTier: clamp(Number(input.tiers?.multiplierTier) || 0, 0, 2), patternTier: clamp(Number(input.tiers?.patternTier) || 0, 0, 2) },
    relics: (input.relics || []).map(r => ({ id: cleanText(r.id), label: cleanText(r.label), imageUrl: cleanText(r.imageUrl) })), totals, steps,
  };
  durationMs = Number.isFinite(durationMs) ? clamp(durationMs, 4000, 6000) : BURST_DURATION;
  const ratio = durationMs / BURST_DURATION;
  const body = steps.slice(1, -2), weights = body.map((_, index) => 1 - 0.52 * index / Math.max(1, body.length - 1));
  const weightTotal = weights.reduce((sum, weight) => sum + weight, 0) || 1;
  let cursor = 1400;
  const cues = [{ at: 0, step: steps[0] }, ...body.map((step, index) => {
    const at = cursor; cursor += 2940 * weights[index] / weightTotal; return { at: at * ratio, step };
  }), { at: 4500 * ratio, step: steps.at(-2) }, { at: 5050 * ratio, step: steps.at(-1) }];
  return freeze({ snapshot, cues, introMs: 1400 * ratio, impactMs: 4500 * ratio, durationMs });
}

function safeImageUrl(value) {
  if (!value) return '';
  if (isArtObjectURL(value)) return value;
  try { const url = new URL(value, document.baseURI); return ['http:', 'https:'].includes(url.protocol) && url.origin === location.origin ? url.href : ''; } catch { return ''; }
}

// Broken/unknown ledgers do not produce invented intermediate scoring. If the
// authoritative final strings are intact, keep them visible without an intro.
function finalOnlyPlan(input, error) {
  if (!input || input.handResult !== 'agari' || !cleanText(input.settlementId) || typeof input.totals?.passed !== 'boolean' || TOTAL_FIELDS.some(key => !cleanText(input.totals?.[key]))) throw error;
  return freeze({ snapshot: { settlementId: input.settlementId, handResult: 'agari', mode: cleanText(input.mode), rulesVersion: cleanText(input.rulesVersion), presentation: { effectId: cleanText(input.presentation?.effectId) || 'normal', label: cleanText(input.presentation?.label), seal: cleanText(input.presentation?.seal) }, hand: { tiles: [] }, relics: [], patterns: [], steps: [], totals: { ...Object.fromEntries(TOTAL_FIELDS.map(key => [key, input.totals[key]])), passed: input.totals.passed } }, cues: [], introMs: 1400, impactMs: 4500, durationMs: BURST_DURATION, fallbackReason: error.message });
}

/** A presentation-only player. The host remains the sole owner of settled state. */
export function createBurstPlayer(root, options = {}) {
  if (!root?.append) throw new TypeError('需要用于展示的 DOM 容器。');
  const clock = options.clock || { now: () => performance.now(), request: fn => requestAnimationFrame(fn), cancel: id => cancelAnimationFrame(id) };
  const audio = (options.audioFactory || createSettlementAudio)();
  const libraryFactory = options.libraryFactory || createLibraryPlayer;
  let destroyed = false, renderer = null, rendererPromise = null, rendererLoad = null, current = null, frameId = null, generation = 0;
  let muted = true, reducedMotion = options.reducedMotion ?? globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
  let paused = false;
  let speed = 1, elapsed = 0, lastNow = 0, cueIndex = -1, frozenBase = false, renderFailed = false;
  const history = new Map(), tileNodes = new Map(), relicNodes = new Map(), patternNodes = new Map();
  const shell = make('section', 'jr-burst'); shell.setAttribute('aria-label', '构筑成型结算演出'); shell.dataset.state = 'idle';
  const art = make('div', 'jr-burst-art'), shade = make('div', 'jr-burst-shade'), beams = make('div', 'jr-burst-beams');
  const heading = make('header', 'jr-burst-heading');
  const seal = make('span', 'jr-burst-seal', '秘卷'), title = make('h2', 'jr-burst-title', '构筑成型'), phase = make('span', 'jr-burst-phase', '等待演出'); heading.append(seal, title, phase);
  const latest = make('div', 'jr-burst-latest'), source = make('strong', '', '牌面与奇物，汇成一手'), operation = make('span', 'jr-burst-operation', ''); latest.append(source, operation);
  const hub = make('div', 'jr-burst-hub');
  const baseWrap = make('div', 'jr-burst-number'), baseLabel = make('span', '', '底分'), base = make('strong', 'jr-burst-base', '—'); baseWrap.append(baseLabel, base);
  const multWrap = make('div', 'jr-burst-number'), multLabel = make('span', '', '倍率'), multiplier = make('strong', 'jr-burst-multiplier', '—'); multWrap.append(multLabel, multiplier);
  hub.append(baseWrap, make('span', 'jr-burst-times', '×'), multWrap);
  const scoreWrap = make('div', 'jr-burst-score-wrap'), scoreLabel = make('span', 'jr-burst-score-label', '本次和牌'), score = make('strong', 'jr-burst-score', '—'), result = make('p', 'jr-burst-result', ''); scoreWrap.append(scoreLabel, score, result);
  const patterns = make('div', 'jr-burst-patterns'), relics = make('div', 'jr-burst-relics'), hand = make('div', 'jr-burst-hand');
  const footer = make('div', 'jr-burst-footer'); footer.append(patterns, relics, hand);
  const track = make('div', 'jr-burst-track'), progress = make('div', 'jr-burst-progress'); track.append(progress);
  const warning = make('p', 'jr-burst-warning'), live = make('p', 'jr-burst-sr'); live.setAttribute('aria-live', 'polite'); live.setAttribute('aria-atomic', 'true');
  shell.append(art, shade, beams, heading, latest, hub, scoreWrap, footer, track, warning, live); root.append(shell);
  const details = make('details', 'jr-details jr-v4-ledger'); details.append(make('summary', '', '展开完整结算明细'));
  const ledger = make('ol', 'jr-ledger'); details.append(ledger); root.append(details);
  audio.setMuted(true);
  shell.classList.toggle('jr-burst-reduced', reducedMotion);

  const stopFrame = () => { if (frameId !== null) clock.cancel(frameId); frameId = null; };
  const clearEffects = () => { beams.replaceChildren(); shell.classList.remove('jr-burst-impact'); };
  const clearHighlights = () => { for (const map of [tileNodes, relicNodes, patternNodes]) for (const node of map.values()) node.classList.remove('is-active'); };
  function setValue(node, text) { node.textContent = cleanText(text) || '—'; node.style.setProperty('--digits', String(Math.max(3, node.textContent.length))); }
  function imageFor(container, rawUrl, label, className = '') {
    const url = safeImageUrl(rawUrl); if (!url) { container.append(make('span', 'jr-burst-image-fallback', label)); return; }
    const img = make('img', className); img.alt = label; img.src = url; img.draggable = false;
    img.addEventListener('error', () => img.replaceWith(make('span', 'jr-burst-image-fallback', label)), { once: true }); container.append(img);
  }
  function resolveImage(resolver, value) {
    try { return typeof resolver === 'function' ? resolver(value) : ''; }
    catch { warning.textContent = '部分素材路径暂不可用，结算明细仍完整显示。'; return ''; }
  }
  function populate(snapshot) {
    tileNodes.clear(); relicNodes.clear(); patternNodes.clear(); hand.replaceChildren(); relics.replaceChildren(); patterns.replaceChildren();
    const tileById = new Map(snapshot.hand.tiles.map(tile => [tile.id, tile]));
    const addTile = (tile, parent) => {
      const node = make('span', 'jr-burst-tile'); node.dataset.tileId = tile.id; node.title = tile.label;
      imageFor(node, resolveImage(options.tileUrl, tile) || tile.imageUrl || `../assets/tiles/${tile.face}.svg`, tile.label || tile.face);
      parent.append(node); tileNodes.set(tile.id, node);
    };
    const groups = snapshot.hand.decomposition?.length ? snapshot.hand.decomposition : [{ tileIds: snapshot.hand.tiles.map(t => t.id), label: '完整和牌' }];
    for (const group of groups) {
      const wrap = make('div', 'jr-burst-group'), row = make('div', 'jr-burst-group-tiles');
      for (const id of group.tileIds) { const tile = tileById.get(id); if (tile) addTile(tile, row); }
      wrap.append(row, make('span', 'jr-burst-group-label', group.label)); hand.append(wrap);
    }
    const scoredIds = new Set(snapshot.steps.flatMap(step => step.tileIds));
    const held = (snapshot.hand.heldTiles || []).filter(tile => scoredIds.has(tile.id));
    if (held.length) {
      const row = make('div', 'jr-burst-held'); row.append(make('span', 'jr-burst-held-label', '留牌联动'));
      for (const tile of held) addTile(tile, row);
      hand.append(row);
    }
    ledger.replaceChildren();
    for (const step of snapshot.steps) {
      const row = make('li'), pattern = snapshot.patterns.find(p => p.id === step.sourceId), relic = snapshot.relics.find(r => r.id === step.relicId);
      const prefix = step.operation === 'multiply' ? '×' : step.operation === 'add' ? '+' : '';
      const change = step.deltaText && step.operation !== 'set' ? `${prefix}${step.deltaText} → ` : '';
      row.append(make('span', '', step.label || pattern?.label || relic?.label || EVENT_LABELS[step.event]), make('strong', '', `${change}${step.afterText || pattern?.valueText || ''}`)); ledger.append(row);
    }
    for (const relic of snapshot.relics) {
      const node = make('div', 'jr-burst-relic'); node.dataset.relicId = relic.id;
      imageFor(node, resolveImage(options.relicUrl, relic) || relic.imageUrl, relic.label || relic.id);
      const label = make('span', '', relic.label || relic.id); node.append(label); relics.append(node); relicNodes.set(relic.id, node);
    }
    for (const pattern of snapshot.patterns) {
      const node = make('span', 'jr-burst-pattern'); node.append(make('span', '', pattern.label), make('b', '', pattern.valueText));
      patterns.append(node); patternNodes.set(pattern.id, node);
    }
    const mode = snapshot.mode === 'guobiao' ? 'mcr' : snapshot.mode;
    const scene = SCENES.find(s => s.id === snapshot.presentation.effectId && s.id !== 'false_hu' && !s.previewOnly && s.availableIn.includes(mode)) || SCENES.find(s => s.id === 'normal') || SCENES[0];
    const mapping = PATTERN_ANIMATIONS[snapshot.mode] || {};
    const actualPattern = snapshot.patterns.find(pattern => {
      const entry = mapping[pattern.label] || mapping[pattern.id];
      return entry?.sceneId === scene.id;
    });
    title.textContent = snapshot.presentation.label || actualPattern?.label || scene.label;
    seal.textContent = snapshot.presentation.seal || scene.seal || '和牌';
    shell.dataset.scoreTier = snapshot.tiers?.scoreTier || 0; shell.dataset.multiplierTier = snapshot.tiers?.multiplierTier || 0;
    return scene;
  }
  function releaseRenderer() {
    const stale = rendererLoad, value = renderer;
    rendererLoad = null; rendererPromise = null; renderer = null;
    stale?.controller.abort();
    try { value?.dispose(); } catch {}
  }
  function ensureRenderer() {
    if (destroyed) return Promise.resolve(null);
    if (rendererPromise) return rendererPromise;
    const load = { controller: new AbortController() }; rendererLoad = load;
    rendererPromise = Promise.resolve().then(() => libraryFactory({ width: 960, height: 540, signal: load.controller.signal })).then(value => {
      if (destroyed || rendererLoad !== load || load.controller.signal.aborted) { value.dispose(); return null; }
      renderer = value; value.canvas.setAttribute('aria-hidden', 'true'); return value;
    }).catch(() => { if (!destroyed && rendererLoad === load) warning.textContent = '主题画面暂不可用，结算明细仍完整显示。'; return null; });
    return rendererPromise;
  }
  function drawBase(ms) {
    if (!renderer || renderFailed || !current?.sceneReady) return;
    try {
      const introMs = current.plan.introMs;
      if (reducedMotion) { if (!frozenBase) renderer.render(2700, { clean: true }); frozenBase = true; }
      else if (ms <= introMs) renderer.render(ms / introMs * 1890, { clean: true });
      else if (!frozenBase) { renderer.render(1890, { clean: true }); frozenBase = true; }
    } catch { renderFailed = true; warning.textContent = '主题画面暂不可用，结算明细仍完整显示。'; }
  }
  function flashSource(node) {
    if (!node || reducedMotion) return;
    const rect = shell.getBoundingClientRect(), from = node.getBoundingClientRect(), to = hub.getBoundingClientRect();
    if (!rect.width) return;
    const x = from.left + from.width / 2 - rect.left, y = from.top + from.height / 2 - rect.top;
    const dx = to.left + to.width / 2 - rect.left - x, dy = to.top + to.height / 2 - rect.top - y;
    const beam = make('i', 'jr-burst-beam'); beam.style.left = `${x}px`; beam.style.top = `${y}px`;
    beam.style.width = `${Math.hypot(dx, dy)}px`; beam.style.transform = `rotate(${Math.atan2(dy, dx)}rad)`;
    beam.style.animationDuration = `${310 / speed}ms`; beams.append(beam);
  }
  function applyCue(cue, sound = true) {
    const s = current.plan.snapshot, step = cue.step; clearEffects(); clearHighlights();
    shell.dataset.event = step.event; shell.dataset.step = step.id; phase.textContent = EVENT_LABELS[step.event];
    const pattern = s.patterns.find(p => p.id === step.sourceId), relic = s.relics.find(r => r.id === step.relicId);
    source.textContent = step.label || pattern?.label || relic?.label || step.sourceId || EVENT_LABELS[step.event];
    const symbol = ({ add: '+', multiply: '×', subtract: '−', set: '→' })[step.operation] || '';
    operation.textContent = step.detailText || (step.operation === 'set' ? `${symbol} ${step.afterText || ''}` : step.deltaText ? `${symbol} ${step.deltaText}` : pattern?.valueText || '');
    for (const id of step.tileIds) tileNodes.get(id)?.classList.add('is-active');
    const anchor = relicNodes.get(step.relicId) || patternNodes.get(step.sourceId) || (step.tileIds.length ? hand : null);
    if (anchor) { anchor.classList.add('is-active', 'is-seen'); flashSource(anchor); }
    if (step.target === 'base' && step.afterText) setValue(base, step.afterText);
    if (step.target === 'multiplier' && step.afterText) setValue(multiplier, step.afterText);
    if (step.event === 'hand_total') {
      setValue(base, s.totals.baseText); setValue(multiplier, s.totals.multiplierText); setValue(score, step.afterText);
      shell.classList.add('jr-burst-landed'); if (!reducedMotion) shell.classList.add('jr-burst-impact');
      live.textContent = `本次和牌 ${step.afterText} 分。`;
    }
    if (step.event === 'round_result') showResult(s);
    try { current.onStep?.({ id: step.id, event: step.event, index: cueIndex }); } catch {}
    if (sound) audio.play(step.event === 'round_result' ? (s.totals.passed ? 'round_pass' : 'round_fail') : step.event, { tier: step.event === 'hand_total' ? s.tiers?.scoreTier || 0 : step.target === 'multiplier' ? s.tiers?.multiplierTier || 0 : s.tiers?.patternTier || 0, speed });
  }
  function showResult(s) {
    result.textContent = `${s.totals.passed ? '累计达标' : '累计未达标'} · ${s.totals.runScoreText} / ${s.totals.targetText}`;
    live.textContent = `本次和牌 ${s.totals.handScoreText} 分。${result.textContent}`;
  }
  function showFinal() {
    if (!current) return;
    const s = current.plan.snapshot; clearEffects(); clearHighlights();
    shell.classList.add('jr-burst-gathering', 'jr-burst-landed'); shell.dataset.event = 'round_result';
    phase.textContent = '一手落定'; source.textContent = '底分与倍率已汇聚'; operation.textContent = '本次结算结果';
    setValue(base, s.totals.baseText); setValue(multiplier, s.totals.multiplierText); setValue(score, s.totals.handScoreText); showResult(s);
    for (const map of [relicNodes, patternNodes]) for (const node of map.values()) node.classList.add('is-seen');
    progress.style.width = '100%'; drawBase(current.plan.durationMs);
  }
  function settle(status, reason = '') {
    const run = current; if (!run || run.done) return run?.result;
    run.done = true; clearTimeout(run.loadTimer);
    if (run.loading) releaseRenderer();
    stopFrame(); clearEffects(); audio.stopAll(); shell.dataset.state = status;
    run.result = Object.freeze({ status, settlementId: run.plan.snapshot.settlementId, ...(reason ? { reason } : {}) });
    run.resolve(run.result); return run.result;
  }
  function tick(now) {
    frameId = null; if (destroyed || !current || current.done || current.loading) return;
    elapsed = Math.min(current.plan.durationMs, elapsed + (paused ? 0 : Math.max(0, now - lastNow) * speed)); lastNow = now;
    const cues = current.plan.cues; let next = cueIndex;
    while (next + 1 < cues.length && cues[next + 1].at <= elapsed) next++;
    // Apply every authoritative text update, but coalesce sound after a delayed frame.
    const run = current;
    while (cueIndex < next) { cueIndex++; applyCue(cues[cueIndex], cueIndex === next); if (destroyed || current !== run || run.done) return; }
    shell.classList.toggle('jr-burst-gathering', elapsed >= current.plan.introMs);
    progress.style.width = `${elapsed / current.plan.durationMs * 100}%`; drawBase(elapsed);
    if (elapsed >= current.plan.durationMs) { showFinal(); settle('completed'); }
    else frameId = clock.request(tick);
  }
  function play(input, playOptions = {}) {
    if (destroyed) return Promise.resolve(Object.freeze({ status: 'destroyed', settlementId: cleanText(input?.settlementId) }));
    let plan;
    try { plan = createBurstPlan(input, playOptions); } catch (error) { try { plan = finalOnlyPlan(input, error); } catch { return Promise.reject(error); } }
    const id = plan.snapshot.settlementId, signature = JSON.stringify(plan.snapshot), previous = history.get(id);
    if (previous && previous.signature !== signature) return Promise.reject(new TypeError('同一 settlementId 不能对应不同冻结账本。'));
    if (previous && !playOptions.replay) return previous.promise;
    if (current && !current.done) settle('superseded');
    generation++; const ticket = generation;
    if (playOptions.speed !== undefined) setSpeed(playOptions.speed);
    if (playOptions.reducedMotion !== undefined) setReducedMotion(playOptions.reducedMotion);
    paused = false; stopFrame(); clearEffects(); audio.stopAll(); elapsed = 0; cueIndex = -1; frozenBase = false; renderFailed = false;
    const promise = new Promise(resolve => { current = { plan, signature, resolve, promise: null, done: false, loading: true, sceneReady: false, onStep: playOptions.onStep }; });
    current.promise = promise; const run = current; history.set(id, run);
    if (history.size > 32) history.delete(history.keys().next().value);
    shell.classList.remove('jr-burst-gathering', 'jr-burst-landed', 'jr-burst-impact'); shell.dataset.state = 'loading'; shell.dataset.event = 'hand_reveal';
    art.replaceChildren(); // A new settlement must never inherit the previous theme frame.
    setValue(base, '—'); setValue(multiplier, '—'); setValue(score, '—'); result.textContent = ''; live.textContent = ''; operation.textContent = ''; warning.textContent = ''; phase.textContent = '正在加载演出 · 可随时跳过'; source.textContent = '牌面与奇物，汇成一手'; progress.style.width = '0%';
    const scene = populate(plan.snapshot);
    if (plan.fallbackReason) { title.textContent = '本次结算'; seal.textContent = '和牌'; warning.textContent = `步骤未完整提供，直接展示冻结结果。${plan.fallbackReason}`; showFinal(); settle('fallback', plan.fallbackReason); return promise; }
    // One wall-clock deadline covers scripts, renderer, font, effects and theme.
    // Decoration must never hold the already-settled game result hostage.
    run.loadTimer = setTimeout(() => {
      if (destroyed || current !== run || run.done || ticket !== generation) return;
      elapsed = plan.durationMs; run.sceneReady = false; art.replaceChildren();
      warning.textContent = '演出加载超时，已直接显示本次结算结果。';
      showFinal(); settle('fallback', 'decoration-load-timeout');
    }, DECORATION_LOAD_TIMEOUT_MS);
    ensureRenderer().then(async value => {
      if (destroyed || current !== run || run.done || ticket !== generation) return;
      try { if (value) { await value.setScene(scene); if (destroyed || current !== run || run.done || ticket !== generation) return; value.reset(); art.replaceChildren(value.canvas); run.sceneReady = true; } }
      catch { if (current === run && !destroyed && !run.done) warning.textContent = '主题画面暂不可用，结算明细仍完整显示。'; }
      if (destroyed || current !== run || run.done || ticket !== generation) return;
      clearTimeout(run.loadTimer); run.loading = false; shell.dataset.state = 'playing'; lastNow = clock.now(); tick(lastNow);
    });
    return promise;
  }
  function skip() { if (!current || current.done) return current?.result || null; elapsed = current.plan.durationMs; showFinal(); return settle('skipped'); }
  function cancel(reason = 'cancelled') { generation++; return settle('cancelled', cleanText(reason)); }
  function setSpeed(value) {
    const next = Number(value); if (!Number.isFinite(next)) return speed;
    if (current && !current.done && !current.loading) { const now = clock.now(); elapsed = Math.min(current.plan.durationMs, elapsed + (paused ? 0 : Math.max(0, now - lastNow) * speed)); lastNow = now; }
    speed = clamp(next, 0.5, 2); shell.style.setProperty('--burst-speed', String(speed)); audio.stopAll(); return speed;
  }
  function setPaused(value) { if (current && !current.done && !current.loading) { const now = clock.now(); elapsed += paused ? 0 : Math.max(0, now - lastNow) * speed; lastNow = now; } paused = Boolean(value); audio.stopAll(); }
  function setReducedMotion(value) { reducedMotion = Boolean(value); shell.classList.toggle('jr-burst-reduced', reducedMotion); clearEffects(); frozenBase = false; if (current && !current.loading) drawBase(elapsed); }
  function setMuted(value) { muted = Boolean(value); audio.setMuted(muted); return muted; }
  async function unlockAudio() { if (destroyed || globalThis.navigator?.userActivation?.isActive === false) return false; return audio.unlock(); }
  function getState() { return { state: destroyed ? 'destroyed' : shell.dataset.state, settlementId: current?.plan.snapshot.settlementId || null, elapsedMs: elapsed, durationMs: current?.plan.durationMs || BURST_DURATION, stepIndex: cueIndex, paused, event: shell.dataset.event || null, speed, reducedMotion, muted, audio: audio.getState(), values: { base: base.textContent, multiplier: multiplier.textContent, score: score.textContent }, activeEffects: beams.childElementCount, pendingFrame: frameId !== null }; }
  function destroy() { if (destroyed) return; settle('destroyed'); destroyed = true; generation++; stopFrame(); clearEffects(); audio.dispose(); releaseRenderer(); shell.remove(); details.remove(); history.clear(); }
  return Object.freeze({ play, skip, cancel, destroy, dispose: destroy, setSpeed, setPaused, setReducedMotion, setMuted, unlockAudio, getState, get ready() { return ensureRenderer(); } });
}
