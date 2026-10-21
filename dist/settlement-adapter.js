import { CinematicSettlementPlayer } from './settlement/cinematic-player.js';

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
const PATTERN_EFFECTS = Object.freeze({
  大三元: 'daisangen', 字一色: 'tsuuiisou', 清一色: 'chinitsu',
  国士无双: 'kokushi', 十三幺: 'kokushi', 绿一色: 'ryuuiisou',
  清老头: 'chinroutou', 清幺九: 'chinroutou', 九莲宝灯: 'chuuren',
  小四喜: 'shousuushii', 大四喜: 'daisuushii', 四杠子: 'suukantsu', 四杠: 'suukantsu',
  混老头: 'honroutou', 混幺九: 'honroutou',
  七对: 'chiitoitsu', 七对子: 'chiitoitsu', 连七对: 'renqiidui',
  清龙: 'ittsuu', 一气通贯: 'ittsuu', 三色三同顺: 'sanshoku', 三色同顺: 'sanshoku',
  二盃口: 'ryanpeikou', 一色三同顺: 'pure_triple_chow', 一色四同顺: 'pure_quadruple_chow',
  一色三节高: 'pure_triple_pung', 一色四节高: 'pure_quadruple_pung',
});

function effectFor(result) {
  if (result.resultType === 'false_win') return 'false_hu';
  const patterns = (result.patterns || []).filter(p => PATTERN_EFFECTS[p.name]);
  const yakuman = result.mode === 'riichi' && patterns.filter(p => p.classification === 'yakuman')
    .sort((a, b) => (b.yakumanMultiplier || 1) - (a.yakumanMultiplier || 1) || b.fan - a.fan)[0];
  if (yakuman) return PATTERN_EFFECTS[yakuman.name];
  const unlocks = (result.gains || []).filter(g => g.kind === 'unlock');
  if (result.mode === 'riichi' && unlocks.some(g => g.id === 'wheel')) return 'daisharin';
  if (unlocks.some(g => g.id === 'jiang')) return 'all_jiang';
  const primary = patterns.sort((a, b) => b.fan - a.fan)[0];
  return primary ? PATTERN_EFFECTS[primary.name]
    : result.tiers?.multiplierTier > 0 ? 'multiplier'
    : result.tiers?.scoreTier > 0 ? 'score' : 'normal';
}

export const RELIC_ART_URLS = Object.freeze(Object.fromEntries([
  ...OLD_RELICS.map(id => [id, new URL(`./art/relics/${id}-v2.webp`, import.meta.url).href]),
  ...NEW_RELICS.map(id => [id, new URL(`./art/relics/${id}-v3.webp`, import.meta.url).href]),
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
  return { id: `group-${index}`, type, label: groupName, tileIds: [...tileIds] };
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
    for (const key of ['sourceId', 'relicId', 'target', 'operation', 'label', 'emphasis']) {
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
    hand: { tiles, decomposition, declaredKongs, wildcardAssignments },
    patterns,
    relics,
    steps,
    tiers: { ...r.tiers },
    presentation: { effectId: effectFor(r) },
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
    tileUrl: tile => tile.face ? new URL(`./art/tiles/${tile.face}.svg`, import.meta.url).href : '',
    relicUrl: relic => relic.imageUrl || RELIC_ART_URLS[relic.id] || '',
    ...options,
  });
}

export { CinematicSettlementPlayer as SettlementPlayer };
