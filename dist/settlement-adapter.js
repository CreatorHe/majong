import { CinematicSettlementPlayer } from './settlement/cinematic-player.js';
import { PATTERN_ANIMATIONS } from './settlement/v4/catalog.js';
import { artUrl } from './art-loader.js';

// This module only translates the engine's settled ledger into presentation data.
// No game mutations, score operations, rewards, or random draws belong here.
const FACES = [
  ...Array.from({ length: 9 }, (_, i) => `Man${i + 1}`),
  ...Array.from({ length: 9 }, (_, i) => `Pin${i + 1}`),
  ...Array.from({ length: 9 }, (_, i) => `Sou${i + 1}`),
  'Ton', 'Nan', 'Shaa', 'Pei', 'Haku', 'Hatsu', 'Chun',
];
const HONORS = ['东', '南', '西', '北', '白', '發', '中'];
const SUITS = ['万', '筒', '条'];
const OLD_RELICS = ['jade', 'river', 'stone', 'bamboo', 'mirror', 'seal', 'echo', 'coin',
  'ink', 'wind', 'growth', 'pair', 'wheel', 'jiang', 'mountain', 'reserve'];
const NEW_RELICS = ['single_seal', 'kong_cauldron', 'rank_brush', 'suit_ribbon', 'wild_jade'];
const numberFormat = new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 12 });
function presentationFor(result) {
  if (result.resultType === 'false_win') return { effectId: 'false_hu', label: '诈胡', seal: '未和' };
  const mappings = PATTERN_ANIMATIONS[result.mode] || {};
  // Catalogue availability gates animation only; actual recognition stays in engine.
  const patterns = (result.patterns || []).filter(p => mappings[p.name]?.enabled);
  const yakuman = result.mode === 'riichi' && patterns.filter(p => p.classification === 'yakuman')
    .sort((a, b) => (b.yakumanMultiplier || 1) - (a.yakumanMultiplier || 1) || b.fan - a.fan)[0];
  const chosen = pattern => ({ effectId: mappings[pattern.name].sceneId, label: pattern.name,
    seal: pattern.classification === 'yakuman' && result.mode === 'riichi'
      ? pattern.yakumanMultiplier === 2 ? '双倍役满' : '役满' : pattern.tier > 0 ? '大番' : '和牌' });
  if (yakuman) return chosen(yakuman);
  const unlocks = (result.gains || []).filter(g => g.kind === 'unlock');
  if (result.mode === 'riichi' && unlocks.some(g => g.id === 'wheel')) return { effectId: 'daisharin', label: '大车轮', seal: '秘卷' };
  if (unlocks.some(g => g.id === 'jiang')) return { effectId: 'all_jiang', label: '将将胡', seal: '秘卷' };
  const primary = patterns.sort((a, b) => b.fan - a.fan)[0];
  return primary ? chosen(primary) : result.tiers?.multiplierTier > 0
    ? { effectId: 'multiplier', label: '倍率升华', seal: '和牌' }
    : result.tiers?.scoreTier > 0 ? { effectId: 'score', label: '高分落定', seal: '和牌' }
    : { effectId: 'normal', label: '和牌', seal: '和牌' };
}

export const RELIC_ART_URLS = Object.freeze(Object.fromEntries([
  ...OLD_RELICS.map(id => [id, new URL(`./art/relics/${id}-v2.webp`, import.meta.url).href]),
  ...NEW_RELICS.map(id => [id, new URL(`./art/relics/${id}-v3.webp`, import.meta.url).href]),
  ...Object.entries({ core_high: 'wheel-v2', core_pung: 'stone-v2', core_held: 'reserve-v2', core_growth: 'river-v2', retrigger_meld: 'echo-v2', retrigger_held: 'mirror-v2', high_rescue: 'rank_brush-v3' }).map(([id, art]) => [id, new URL(`./art/relics/${art}.webp`, import.meta.url).href]),
]));

function display(value) {
  if (typeof value === 'string') return value;
  if (typeof value === 'bigint' || (typeof value === 'number' && Number.isFinite(value))) return numberFormat.format(value);
  return '—';
}
function labelForFace(face) {
  if (!Number.isInteger(face) || face < 0 || face > 33) return '未知牌';
  return face < 27 ? `${face % 9 + 1}${SUITS[Math.floor(face / 9)]}` : HONORS[face - 27];
}
function freeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}
function presentationGroup(tileIds, faces, index, shape, mode) {
  const special = tileIds.length >= 9 && ['orphans', 'knitted', 'unconnected'].includes(shape);
  const type = special ? 'special' : tileIds.length === 4 ? 'kong' : tileIds.length === 2 ? 'pair'
    : faces.every(face => face === faces[0]) ? 'triplet' : 'sequence';
  const groupName = special ? ({ orphans: mode === 'riichi' ? '国士无双' : '十三幺', knitted: '组合龙', unconnected: '不靠牌' })[shape]
    : type === 'pair' && shape === 'pairs' ? '对子'
    : ({ kong: '杠', pair: '雀头', triplet: '刻子', sequence: '顺子' })[type];
  const description = special ? ({ orphans: '六种一九数牌＋七种字牌，再重复一种', knitted: '三种花色分别取 147、258、369', unconnected: '数牌取自组合龙，字牌互不重复' })[shape]
    : ({ kong: '四张相同', pair: '两张相同', triplet: '三张相同', sequence: '同花色三张连续' })[type];
  return { id: `group-${index}`, type, label: groupName, description, tileIds: [...tileIds] };
}

/**
 * Build an immutable display snapshot from a completed engine result.
 * `result` defaults to game.last. The result owns all scoring fields; game is only
 * a compatibility source for physical tiles and identifiers, never a score calculator.
 * A malformed ledger is left visibly incomplete so SettlementPlayer can fall back
 * to authoritative final totals instead of inventing scoring steps or false-hu.
 */
export function buildSettlementSnapshot(game, result = game?.last) {
  const r = result || {};
  const d = r.decomposition || {};
  const settlementId = r.settlementId ?? game?.settlementId;
  const handResult = r.resultType === 'false_win' ? 'false_hu' : r.resultType === 'win' ? 'agari' : undefined;
  const sourceTiles = d.tiles || r.tiles || game?.formed || [];
  const tiles = sourceTiles.map(t => ({ id: t.id, face: FACES[t.face], label: labelForFace(t.face), wildcard: !!t.wild }));
  const heldTiles = (r.heldTiles || []).map(t => ({ id: t.id, face: FACES[t.face], label: labelForFace(t.face), wildcard: !!t.wild }));
  const tileById = new Map(sourceTiles.map(t => [t.id, t]));
  const decomposition = (d.groupTileIds || []).map((ids, index) =>
    presentationGroup(ids, d.groups?.[index] || ids.map(id => tileById.get(id)?.face), index, d.shape, r.mode ?? game?.mode));
  if (d.pairTileIds?.length) decomposition.push(presentationGroup(d.pairTileIds, d.pair || [], decomposition.length, d.shape, r.mode ?? game?.mode));
  const declaredKongs = (d.declaredKongs || r.declaredKongs || game?.kongs || [])
    .map(k => ({ id: k.id, tileIds: [...k.tileIds] }));
  const wildcardAssignments = (d.wildcardAssignments || []).map(a => ({
    tileId: a.tileId,
    toSuit: SUITS[Math.floor(a.face / 9)],
    rank: a.face % 9 + 1,
    label: labelForFace(a.face),
  }));
  const patterns = (r.patterns || []).map(p => ({
    id: p.id, label: p.name, valueText: `${display(p.fan)}${r.mode === 'riichi' ? ' 翻' : ' 番'}`,
    tier: p.tier || 0,
    ...(p.classification === 'yakuman' && r.mode === 'riichi' ? {
      classification: 'yakuman', ...(p.yakumanMultiplier === 2 ? { yakumanMultiplier: 2 } : {}),
    } : {}),
  }));
  const steps = (r.steps || []).map((step, index) => {
    const converted = {
      id: step.id || `${settlementId}-step-${index}`,
      event: step.event,
      tileIds: [...(step.tileIds || [])],
    };
    for (const key of ['sourceId', 'relicId', 'target', 'operation', 'label', 'emphasis', 'detailText', 'triggerIndex', 'retrigger']) {
      if (step[key] !== undefined) converted[key] = step[key];
    }
    for (const key of ['before', 'delta', 'after']) {
      if (step[`${key}Text`] !== undefined || step[key] !== undefined) converted[`${key}Text`] = display(step[`${key}Text`] ?? step[key]);
    }
    return converted;
  });
  const relics = [...new Set(steps.map(step => step.relicId).filter(Boolean))].map(id => ({
    id, label: r.gains?.find(gain => gain.id === id)?.name || steps.find(step => step.relicId === id)?.label || id,
    imageUrl: RELIC_ART_URLS[id],
  }));
  // The ratio only fills the visual progress bar. The authoritative passed flag
  // is never recomputed, including equality, negative totals, or false-hu passes.
  const progressRatio = typeof r.cumulativeAfter === 'number' && typeof r.target === 'number' && r.target > 0
    ? Math.max(0, Math.min(1, r.cumulativeAfter / r.target)) : 0;
  return freeze({
    settlementId,
    runId: r.runId ?? game?.runId,
    roundId: r.roundId ?? game?.roundId,
    rulesVersion: r.rulesVersion ?? game?.rulesVersion ?? game?.version,
    mode: (r.mode ?? game?.mode) === 'riichi' ? 'riichi' : 'guobiao',
    handResult,
    hand: { tiles, heldTiles, decomposition, declaredKongs, wildcardAssignments },
    patterns,
    relics,
    steps,
    tiers: { ...r.tiers },
    presentation: presentationFor(r),
    totals: {
      baseText: display(r.base),
      multiplierText: display(r.mult),
      handScoreText: display(r.total),
      processScoreText: display(r.processScore),
      penaltyText: display(r.penalty),
      roundScoreText: display(r.roundScore),
      runScoreBeforeText: display(r.cumulativeBefore),
      runScoreText: display(r.cumulativeAfter),
      targetText: display(r.target),
      passed: r.passed,
      progressRatio,
    },
  });
}

/** The host owns this root and must keep it outside any whole-app rerender. */
export function createSettlementPlayer(root, options = {}) {
  return new CinematicSettlementPlayer(root, {
    tileUrl: tile => tile.face ? artUrl(new URL(`./art/tiles/${tile.face}.svg`, import.meta.url).href) : '',
    relicUrl: relic => artUrl(relic.imageUrl || RELIC_ART_URLS[relic.id] || ''),
    ...options,
  });
}

export { CinematicSettlementPlayer as SettlementPlayer };
