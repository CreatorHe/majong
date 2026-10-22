import { V3_PATTERN_CATALOG } from './game-catalog-v3.js';
// Stable parent-pattern IDs. Scoring variants (for example two dragon pungs)
// count once per completed hand under their parent ID.
const both = ['normal', 'pairs'];
const normal = ['normal'];
const pairs = ['pairs'];
const definitions = {
  mcr: [
    ['full_flush', '清一色', 24, '仅一种数牌花色', both],
    ['half_flush', '混一色', 6, '一种数牌花色与字牌', both],
    ['all_simples', '断幺', 2, '所有牌为 2～8 数牌', both],
    ['all_pungs', '碰碰和', 6, '四组刻子', normal],
    ['seven_pairs', '七对', 24, '七个不同对子', pairs],
    ['seven_shifted_pairs', '连七对', 88, '同花色七个连续对子', pairs],
    ['pure_straight', '清龙', 16, '同花色 123、456、789', normal],
    ['mixed_triple_chow', '三色三同顺', 8, '三种花色相同的顺子', normal],
    ['pure_triple_chow', '一色三同顺', 24, '三组相同顺子', normal],
    ['quadruple_chow', '一色四同顺', 48, '四组相同顺子', normal],
    ['pure_shifted_pungs', '一色三节高', 24, '同花色三组连续刻子', normal],
    ['four_pure_shifted_pungs', '一色四节高', 48, '同花色四组连续刻子', normal],
    ['all_chows', '平和', 2, '四顺子与数牌雀头', normal],
    ['dragon_pung', '箭刻', 2, '白、發、中任一刻子；统计每手至多一次', normal],
    ['two_dragon_pungs', '双箭刻', 6, '两种箭刻', normal],
    ['big_three_dragons', '大三元', 88, '三种箭刻', normal],
    ['all_honors', '字一色', 64, '全部为字牌', both],
    ['no_honors', '无字', 1, '没有字牌；遵循当前计分覆盖规则', both],
    ['one_voided_suit', '缺一门', 1, '恰有两种数牌花色', both],
  ],
  riichi: [
    ['full_flush', '清一色', 6, '仅一种数牌花色', both],
    ['half_flush', '混一色', 3, '一种数牌花色与字牌', both],
    ['all_simples', '断幺九', 1, '所有牌为 2～8 数牌', both],
    ['all_pungs', '对对和', 2, '四组刻子', normal],
    ['seven_pairs', '七对子', 2, '七个不同对子', pairs],
    ['pure_straight', '一气通贯', 2, '同花色 123、456、789', normal],
    ['mixed_triple_chow', '三色同顺', 2, '三种花色相同的顺子', normal],
    ['pure_double_chow', '一盃口', 1, '一对相同顺子', normal],
    ['twice_pure_double_chow', '二盃口', 3, '两对相同顺子', normal],
    ['dragon_pung', '役牌', 1, '白、發、中任一刻子；统计每手至多一次', normal],
    ['big_three_dragons', '大三元', 13, '三种箭刻，本作折算 13 翻', normal],
    ['all_honors', '字一色', 13, '全部为字牌，本作折算 13 翻', both],
  ],
};
export const PATTERN_CATALOG = Object.freeze(Object.entries(definitions).flatMap(([mode, rows]) => rows.map(([id, name, fan, description, routes]) => Object.freeze({ pattern_id: `${mode}.${id}`, mode, name, fan, description, routes: Object.freeze([...routes]) }))));
export const PATTERNS_BY_ID = new Map(PATTERN_CATALOG.map(pattern => [pattern.pattern_id, pattern]));
export const DEFAULT_RULES_VERSION = 'split_legacy_v1';
export const DEFAULT_SCORE_MODEL_VERSION = 'rogue_legacy_v1';
export const patternsForMode = mode => PATTERN_CATALOG.filter(pattern => pattern.mode === mode);

export const V5_RULES_VERSION = 'opening_build_v5';
export const V5_SCORE_MODEL_VERSION = 'four_core_v5';
export const V6_RULES_VERSION = 'opening_build_v6';
export const V6_SCORE_MODEL_VERSION = 'four_core_v6';
export const V7_RULES_VERSION = 'opening_build_v7';
export const V7_SCORE_MODEL_VERSION = 'four_core_v6';
export const V8_RULES_VERSION = 'opening_build_v8';
export const V8_SCORE_MODEL_VERSION = 'four_core_v6';
export const GAME_RULES_VERSION = V8_RULES_VERSION;
export const GAME_SCORE_MODEL_VERSION = V8_SCORE_MODEL_VERSION;
export const GAME_VERSION_PAIRS = Object.freeze({ free_play_v2: 'cumulative_v2', free_play_v3: 'exponential_v3', free_play_v4: 'exponential_v3', [V5_RULES_VERSION]: V5_SCORE_MODEL_VERSION, [V6_RULES_VERSION]: V6_SCORE_MODEL_VERSION, [V7_RULES_VERSION]: V7_SCORE_MODEL_VERSION, [V8_RULES_VERSION]: V8_SCORE_MODEL_VERSION });
export const isSupportedGameVersion = (rules, score) => Object.hasOwn(GAME_VERSION_PAIRS, rules) && GAME_VERSION_PAIRS[rules] === score;
export const GAME_EVENT_NAMES = Object.freeze(['game_action', 'run_started', 'run_resumed', 'round_started', 'run_ended', 'round_settled', 'hand_completed']);
const LEGACY_GAME_ACTIONS = Object.freeze(['start', 'starter', 'select', 'commit', 'kong', 'exchange', 'replace', 'transform', 'settle', 'settlement_skip', 'settlement_complete', 'settlement_continue', 'reward', 'buy', 'sell', 'refresh_shop', 'next_round', 'retire', 'resume']);
const OPENING_BUILD_ACTIONS = Object.freeze([...LEGACY_GAME_ACTIONS, 'begin_play', 'high_rescue', 'skip_reward']);
export const GAME_ACTIONS = Object.freeze([...OPENING_BUILD_ACTIONS, 'formed_discard']);
export const V2_RELIC_IDS = Object.freeze(['jade', 'river', 'stone', 'bamboo', 'mirror', 'seal', 'echo', 'coin', 'ink', 'wind', 'growth', 'pair', 'wheel', 'jiang', 'mountain', 'reserve', 'single_seal', 'kong_cauldron', 'rank_brush', 'suit_ribbon', 'wild_jade']);
export const V5_CORE_IDS = Object.freeze(['core_high', 'core_pung', 'core_held', 'core_growth']);
// Versioned equipment IDs, not the historical display catalogue. Old outboxes
// retain their original permissions when an item retires from current equipment.
export const V5_RELIC_IDS = Object.freeze([...V5_CORE_IDS, 'retrigger_meld', 'retrigger_held', 'high_rescue', ...V2_RELIC_IDS]);
export const V6_RELIC_IDS = Object.freeze([...V5_RELIC_IDS]);
export const V7_RELIC_IDS = Object.freeze(V6_RELIC_IDS.filter(id => id !== 'wild_jade'));
export const V8_RELIC_IDS = Object.freeze([...V7_RELIC_IDS]);
export const UNLOCK_PATTERN_CATALOG = Object.freeze([
  { pattern_id: 'mcr.all_258', mode: 'mcr', name: '将将胡', description: '实际触发将令：有效牌仅含 2、5、8 数牌', fan: null, routes: both, kind: 'unlock', relic_id: 'jiang' },
  { pattern_id: 'riichi.all_258', mode: 'riichi', name: '将将胡', description: '实际触发将令：有效牌仅含 2、5、8 数牌', fan: null, routes: both, kind: 'unlock', relic_id: 'jiang' },
  { pattern_id: 'riichi.big_wheel', mode: 'riichi', name: '大车轮', description: '实际触发车轮秘卷：2～8 筒各一对', fan: null, routes: pairs, kind: 'unlock', relic_id: 'wheel' },
  { pattern_id: 'riichi.three_consecutive_pungs', mode: 'riichi', name: '三连刻', description: '实际触发连山印：同花色三组连续刻子类面子', fan: null, routes: normal, kind: 'unlock', relic_id: 'mountain' },
].map(pattern => Object.freeze(pattern)));
export const V2_PATTERN_CATALOG = Object.freeze([...PATTERN_CATALOG.map(pattern => Object.freeze({ ...pattern, kind: 'base' })), ...UNLOCK_PATTERN_CATALOG]);
export const GAME_PATTERN_CATALOG = V3_PATTERN_CATALOG;
const openingBuildRules = rulesVersion => [V5_RULES_VERSION, V6_RULES_VERSION, V7_RULES_VERSION, V8_RULES_VERSION].includes(rulesVersion);
const formedDiscardRules = rulesVersion => [V7_RULES_VERSION, V8_RULES_VERSION].includes(rulesVersion);
const extendedRules = rulesVersion => ['free_play_v3', 'free_play_v4', V5_RULES_VERSION, V6_RULES_VERSION, V7_RULES_VERSION, V8_RULES_VERSION].includes(rulesVersion);
const candidateLimitFor = rulesVersion => ({ free_play_v2: 18, free_play_v3: 10, free_play_v4: 12, [V5_RULES_VERSION]: 12, [V6_RULES_VERSION]: 12, [V7_RULES_VERSION]: 12, [V8_RULES_VERSION]: 12 })[rulesVersion];
export const RELIC_IDS = V8_RELIC_IDS;
export const gamePatternCatalog = (rulesVersion = GAME_RULES_VERSION) => rulesVersion === 'free_play_v2' ? V2_PATTERN_CATALOG : extendedRules(rulesVersion) ? GAME_PATTERN_CATALOG : [];
export const relicIdsForVersion = (rulesVersion = GAME_RULES_VERSION) => rulesVersion === V8_RULES_VERSION ? V8_RELIC_IDS : rulesVersion === V7_RULES_VERSION ? V7_RELIC_IDS : rulesVersion === V6_RULES_VERSION ? V6_RELIC_IDS : rulesVersion === V5_RULES_VERSION ? V5_RELIC_IDS : ['free_play_v2', 'free_play_v3', 'free_play_v4'].includes(rulesVersion) ? V2_RELIC_IDS : [];
export function patternIdForName(mode, name, rulesVersion = GAME_RULES_VERSION) {
  if (typeof name !== 'string') return null;
  const parentName = name.split(' · ')[0].replace(/\s*[×x]\d+$/u, '');
  const catalog = gamePatternCatalog(rulesVersion);
  return (catalog.find(pattern => pattern.mode === mode && pattern.name === name) ?? catalog.find(pattern => pattern.mode === mode && pattern.name === parentName))?.pattern_id ?? null;
}
export function isGameEvent(name, context = {}) {
  const recognizedVersion = Object.hasOwn(GAME_VERSION_PAIRS, context.rules_version) || Object.values(GAME_VERSION_PAIRS).includes(context.score_model_version);
  return GAME_EVENT_NAMES.includes(name) && (name !== 'hand_completed' || recognizedVersion);
}

const SCORE_LIMIT = Number.MAX_SAFE_INTEGER;
const scoreLimitFor = rulesVersion => rulesVersion === 'free_play_v2' ? 1_000_000_000_000 : SCORE_LIMIT;

const obj = x => x !== null && typeof x === 'object' && !Array.isArray(x);
const keys = (x, names) => obj(x) && Object.keys(x).length === names.length && Object.keys(x).every(k => names.includes(k));
const int = (x, min = 0, max = SCORE_LIMIT) => Number.isSafeInteger(x) && x >= min && x <= max;
const signed = (x, limit = SCORE_LIMIT) => int(x, -limit, limit);
const id = x => typeof x === 'string' && /^[A-Za-z0-9_.:-]{8,100}$/.test(x);
const smallId = x => typeof x === 'string' && /^[A-Za-z0-9_.:-]{1,64}$/.test(x);
const bool = x => typeof x === 'boolean';
const face = x => int(x, 0, 33);
const quality = x => ['complete', 'partial'].includes(x);
const knownRelics = (x, rulesVersion) => {
  const allowed = relicIdsForVersion(rulesVersion);
  return Array.isArray(x) && x.length <= allowed.length && x.every(v => allowed.includes(v)) &&
    (!openingBuildRules(rulesVersion) || (x.length <= 4 && new Set(x).size === x.length && x.filter(v => V5_CORE_IDS.includes(v)).length <= 1));
};
const unique = x => new Set(x).size === x.length;
const uniqueIds = (x, min, max) => Array.isArray(x) && x.length >= min && x.length <= max && x.every(smallId) && unique(x);
const validFormedDiscard = (record, round) => record === null || (keys(record, ['round_no', 'tile_ids']) && int(record.round_no, 1, round) && uniqueIds(record.tile_ids, 1, 2));
const sameFormedDiscard = (a, b) => a === null || b === null ? a === b : a.round_no === b.round_no && a.tile_ids.length === b.tile_ids.length && a.tile_ids.every(tileId => b.tile_ids.includes(tileId));
const STATE_FIELDS = ['phase', 'round_no', 'formed_count', 'structure_count', 'kong_count', 'hand_count', 'deck_count', 'discard_count', 'coins', 'ink', 'swaps', 'total_score', 'round_score', 'process_score', 'round_start_score', 'target_score', 'relic_ids', 'single_count', 'wild_used'];
export function validateGameState(s, rulesVersion = GAME_RULES_VERSION) {
  const limit = scoreLimitFor(rulesVersion);
  const openingBuild = openingBuildRules(rulesVersion);
  const v7 = formedDiscardRules(rulesVersion);
  return Object.hasOwn(GAME_VERSION_PAIRS, rulesVersion) && keys(s, [...STATE_FIELDS, ...(openingBuild ? ['rescue_used'] : []), ...(v7 ? ['formed_discard'] : [])]) && ['home', 'starter', 'play', 'settlement', 'reward', 'shop', 'victory', 'defeat', ...(openingBuild ? ['prepare'] : [])].includes(s.phase) && int(s.round_no, 1, 6) && int(s.formed_count, 0, 18) && int(s.structure_count, 0, 14) && int(s.kong_count, 0, 4) && s.formed_count - s.kong_count === s.structure_count && int(s.hand_count, 0, candidateLimitFor(rulesVersion)) && int(s.deck_count, 0, 136) && int(s.discard_count, 0, 136) && int(s.coins, 0, 1_000_000_000) && int(s.ink, 0, 1000) && int(s.swaps, 0, 1000) && signed(s.total_score, limit) && signed(s.round_score, limit) && int(s.process_score, 0, limit) && signed(s.round_start_score, limit) && (s.target_score === null || int(s.target_score, 1, limit)) && knownRelics(s.relic_ids, rulesVersion) && int(s.single_count, 0, 4) && bool(s.wild_used) && (!openingBuild || bool(s.rescue_used)) && (!v7 || validFormedDiscard(s.formed_discard, s.round_no)) && BigInt(s.total_score) === BigInt(s.round_start_score) + BigInt(s.round_score);
}
const ORPHAN_FACES = [0, 8, 9, 17, 18, 26, 27, 28, 29, 30, 31, 32, 33];
const KNITTED_FACES = [[0,1,2],[0,2,1],[1,0,2],[1,2,0],[2,0,1],[2,1,0]].map(permutation => permutation.flatMap((rankGroup, suit) => [rankGroup, rankGroup + 3, rankGroup + 6].map(rank => suit * 9 + rank)));
const matchesSpecialGroup = (type, faces) => {
  if (type === 'orphans') return faces.length === 14 && new Set(faces).size === 13 && faces.every(value => ORPHAN_FACES.includes(value));
  if (type === 'knitted') return faces.length === 9 && unique(faces) && KNITTED_FACES.some(template => faces.every(value => template.includes(value)));
  if (type === 'unconnected') return faces.length === 14 && unique(faces) && KNITTED_FACES.some(template => faces.every(value => value >= 27 || template.includes(value)));
  return false;
};
const TERMINAL_FIELDS = ['settlement_id', 'round_no', 'legal', 'result_type', 'passed', 'process_score', 'win_score', 'penalty_score', 'score_delta', 'round_score', 'round_start_score', 'cumulative_before', 'cumulative_after', 'target_score', 'record_quality', 'shape', 'tiles', 'declared_kongs', 'decomposition', 'credited_pattern_ids', 'unlock_pattern_ids', 'owned_relic_ids'];
function validateTerminal(p, context, eventName) {
  const extended = extendedRules(context.rules_version), limit = scoreLimitFor(context.rules_version);
  if (!keys(p, TERMINAL_FIELDS) || !id(p.settlement_id) || p.settlement_id !== context.hand_id || !int(p.round_no, 1, 6) || !bool(p.legal) || p.result_type !== (p.legal ? 'win' : 'false_win') || !bool(p.passed) || !quality(p.record_quality) || !knownRelics(p.owned_relic_ids, context.rules_version)) return 'invalid_settlement_payload';
  if (!['process_score', 'win_score', 'penalty_score'].every(key => int(p[key], 0, limit)) || !['score_delta', 'round_score', 'round_start_score', 'cumulative_before', 'cumulative_after'].every(key => signed(p[key], limit)) || !int(p.target_score, 1, limit)) return 'invalid_settlement_score';
  const n = key => BigInt(p[key]);
  if (n('score_delta') !== n('win_score') - n('penalty_score') || n('round_score') !== n('process_score') + n('score_delta') || n('cumulative_before') !== n('round_start_score') + n('process_score') || n('cumulative_after') !== n('cumulative_before') + n('score_delta') || n('cumulative_after') !== n('round_start_score') + n('round_score') || p.passed !== (p.cumulative_after >= p.target_score)) return 'inconsistent_settlement_score';
  if ((p.legal && p.penalty_score !== 0) || (!p.legal && p.win_score !== 0) || (eventName === 'hand_completed' && !p.legal)) return 'inconsistent_settlement_result';
  if (!Array.isArray(p.tiles) || p.tiles.length < 14 || p.tiles.length > 18 || !Array.isArray(p.declared_kongs) || p.declared_kongs.length > 4 || p.tiles.length !== 14 + p.declared_kongs.length) return 'invalid_physical_tile_count';
  const tiles = new Map();
  for (const tile of p.tiles) {
    if (!keys(tile, ['id', 'original', 'face', 'effective_face', 'wild']) || !smallId(tile.id) || tiles.has(tile.id) || !face(tile.original) || !face(tile.face) || !bool(tile.wild) || (tile.effective_face !== null && !face(tile.effective_face)) || (p.legal && tile.effective_face === null)) return 'invalid_tile_evidence';
    if (tile.wild && (tile.face >= 27 || (tile.effective_face !== null && (tile.effective_face >= 27 || tile.effective_face % 9 !== tile.face % 9)))) return 'invalid_wild_assignment';
    if (!tile.wild && tile.effective_face !== null && tile.effective_face !== tile.face) return 'invalid_effective_face';
    tiles.set(tile.id, tile);
  }
  const kongTileIds = new Set(), kongIds = new Set(), kongSignatures = new Set();
  for (const kong of p.declared_kongs) {
    if (!keys(kong, ['id', 'tile_ids', 'face']) || !smallId(kong.id) || kongIds.has(kong.id) || !uniqueIds(kong.tile_ids, 4, 4) || !face(kong.face) || kong.tile_ids.some(tileId => !tiles.has(tileId) || kongTileIds.has(tileId) || tiles.get(tileId).effective_face !== kong.face)) return 'invalid_declared_kong';
    kongIds.add(kong.id); kong.tile_ids.forEach(tileId => kongTileIds.add(tileId)); kongSignatures.add([...kong.tile_ids].sort().join('|'));
  }
  if (!Array.isArray(p.credited_pattern_ids) || p.credited_pattern_ids.length > 64 || !Array.isArray(p.unlock_pattern_ids) || p.unlock_pattern_ids.length > 8) return 'invalid_pattern_list';
  if (!p.legal) {
    if (p.shape !== null || p.decomposition !== null || p.credited_pattern_ids.length || p.unlock_pattern_ids.length) return 'false_win_has_patterns';
    return null;
  }
  const shapeGroupCounts = { normal: 5, pairs: 7, ...(extended ? { orphans: 1, ...(context.mode === 'mcr' ? { knitted: 3, unconnected: 1 } : {}) } : {}) };
  if (!Object.hasOwn(shapeGroupCounts, p.shape) || !keys(p.decomposition, ['groups']) || !Array.isArray(p.decomposition.groups) || p.decomposition.groups.length !== shapeGroupCounts[p.shape]) return 'invalid_decomposition';
  const allowedTypes = p.shape === 'pairs' ? ['pair'] : p.shape === 'orphans' || p.shape === 'unconnected' ? [p.shape] : ['chow', 'pung', 'kong', 'pair', ...(p.shape === 'knitted' ? ['knitted'] : [])];
  const used = new Set(), pairFaces = [], groupKinds = [], declaredUsed = new Set();
  for (const group of p.decomposition.groups) {
    const size = ({ chow: 3, pung: 3, kong: 4, pair: 2, orphans: 14, knitted: 9, unconnected: 14 })[group?.type];
    if (!keys(group, ['type', 'tile_ids']) || !allowedTypes.includes(group.type) || !size || !uniqueIds(group.tile_ids, size, size) || group.tile_ids.some(tileId => !tiles.has(tileId) || used.has(tileId))) return 'invalid_decomposition';
    const faces = group.tile_ids.map(tileId => tiles.get(tileId).effective_face).sort((a, b) => a - b);
    if (['orphans', 'knitted', 'unconnected'].includes(group.type)) {
      if (!matchesSpecialGroup(group.type, faces)) return 'invalid_decomposition';
    } else if (group.type === 'chow') {
      if (faces[0] >= 27 || Math.floor(faces[0] / 9) !== Math.floor(faces[2] / 9) || faces[1] !== faces[0] + 1 || faces[2] !== faces[0] + 2) return 'invalid_decomposition';
    } else if (!faces.every(value => value === faces[0])) return 'invalid_decomposition';
    if (group.type === 'kong') {
      const signature = [...group.tile_ids].sort().join('|');
      if (!kongSignatures.has(signature)) return 'undeclared_kong';
      declaredUsed.add(signature);
    } else if (group.tile_ids.some(tileId => kongTileIds.has(tileId))) return 'declared_kong_split';
    group.tile_ids.forEach(tileId => used.add(tileId)); groupKinds.push(group.type);
    if (group.type === 'pair') pairFaces.push(faces[0]);
  }
  const pairMultiplicity = new Map();
  for (const value of pairFaces) pairMultiplicity.set(value, (pairMultiplicity.get(value) || 0) + 1);
  const pairsLegal = extended && context.mode === 'mcr' ? [...pairMultiplicity.values()].every(count => count <= 2) : unique(pairFaces);
  if (used.size !== p.tiles.length || declaredUsed.size !== p.declared_kongs.length ||
      (p.shape === 'normal' && pairFaces.length !== 1) ||
      (p.shape === 'pairs' && (p.declared_kongs.length || pairFaces.length !== 7 || !pairsLegal)) ||
      (p.shape === 'knitted' && (groupKinds.filter(kind => kind === 'knitted').length !== 1 || pairFaces.length !== 1)) ||
      (['orphans', 'unconnected'].includes(p.shape) && p.declared_kongs.length)) return 'invalid_decomposition';
  for (const [list, kind] of [[p.credited_pattern_ids, 'base'], [p.unlock_pattern_ids, 'unlock']]) for (const patternId of list) {
    const pattern = gamePatternCatalog(context.rules_version).find(item => item.pattern_id === patternId);
    if (!pattern || pattern.kind !== kind) return 'unknown_pattern';
    if (pattern.mode !== context.mode) return 'pattern_mode_mismatch';
    if (!pattern.routes.includes(p.shape)) return 'pattern_shape_mismatch';
    if (pattern.relic_id && !p.owned_relic_ids.includes(pattern.relic_id)) return 'unlock_without_relic';
  }
  return null;
}
function validateAction(p, rulesVersion) {
  const openingBuild = openingBuildRules(rulesVersion);
  const v7 = formedDiscardRules(rulesVersion);
  if (!keys(p, ['action_id', 'action', 'input_method', 'outcome', 'reason_code', 'before', 'after', 'selected_tile_ids', 'tile_changes', 'evidence_truncated', 'context']) || !id(p.action_id) || !(v7 ? GAME_ACTIONS : openingBuild ? OPENING_BUILD_ACTIONS : LEGACY_GAME_ACTIONS).includes(p.action) || !['pointer', 'keyboard', 'programmatic'].includes(p.input_method) || !['applied', 'rejected', 'noop', 'blocked'].includes(p.outcome) || (p.reason_code !== null && !smallId(p.reason_code)) || (p.before === null && p.after === null) || (p.before !== null && !validateGameState(p.before, rulesVersion)) || (p.after !== null && !validateGameState(p.after, rulesVersion)) || !uniqueIds(p.selected_tile_ids, 0, 18) || !bool(p.evidence_truncated) || !Array.isArray(p.tile_changes) || p.tile_changes.length > 36) return 'invalid_game_action';
  const changes = new Set();
  for (const change of p.tile_changes) {
    if (!Array.isArray(change) || change.length !== 9 || !smallId(change[0]) || changes.has(change[0]) || ![change[1], change[2]].every(zone => zone === null || ['hand', 'formed', 'deck', 'discard'].includes(zone)) || ![change[3], change[4]].every(value => value === null || face(value)) || !change.slice(5).every(value => value === null || bool(value))) return 'invalid_tile_changes';
    changes.add(change[0]);
  }
  const c = p.context;
  if (!keys(c, ['source_zone', 'transform_kind', 'transform_value', 'relic_id', ...(openingBuild ? ['rescue_type', 'replace_relic_id'] : [])]) || ![null, 'hand', 'formed'].includes(c.source_zone) || ![null, 'rank', 'suit', 'wild'].includes(c.transform_kind) || (c.relic_id !== null && !relicIdsForVersion(rulesVersion).includes(c.relic_id))) return 'invalid_action_context';
  if (openingBuild && (![null, 'exchange', 'rank', 'suit'].includes(c.rescue_type) || (c.replace_relic_id !== null && !relicIdsForVersion(rulesVersion).includes(c.replace_relic_id)) || (p.action !== 'high_rescue' && c.rescue_type !== null) || (p.action !== 'reward' && c.replace_relic_id !== null))) return 'invalid_action_context';
  if (p.action === 'high_rescue' && ((p.outcome === 'applied' && c.rescue_type === null) || c.transform_kind !== (['rank', 'suit'].includes(c.rescue_type) ? c.rescue_type : null))) return 'invalid_action_context';
  if (!['transform', 'high_rescue'].includes(p.action) && (c.transform_kind !== null || c.transform_value !== null)) return 'invalid_action_context';
  if (c.transform_kind === 'rank' ? ![-1, 1].includes(c.transform_value) : c.transform_kind === 'suit' ? ![0, 1, 2].includes(c.transform_value) : c.transform_value !== null) return 'invalid_action_context';
  if (rulesVersion === V8_RULES_VERSION && p.outcome === 'applied' && ['transform', 'exchange', 'high_rescue'].includes(p.action)) {
    const a = p.before, b = p.after;
    const edit = p.action === 'transform' || (p.action === 'high_rescue' && c.rescue_type !== 'exchange');
    const phases = edit ? ['prepare'] : p.action === 'high_rescue' ? ['play'] : ['prepare', 'play'];
    if (!a || !b || !phases.includes(a.phase) || b.phase !== a.phase || (p.action === 'high_rescue' && c.rescue_type === 'exchange' && a.structure_count >= 14)) return 'invalid_action_phase';
    if (!uniqueIds(p.selected_tile_ids, 1, edit ? 1 : p.action === 'high_rescue' ? 3 : 5)) return 'invalid_action_selection';
  }
  if (v7 && p.action === 'transform' && c.transform_kind === 'wild' && p.outcome === 'applied' && (c.relic_id !== 'core_high' || !p.before?.relic_ids.includes('core_high') || !p.after?.relic_ids.includes('core_high'))) return 'wild_requires_core_high';
  if (p.outcome !== 'applied' && p.before && p.after && ['total_score', 'round_score', 'process_score', 'coins', 'ink', 'swaps', ...(openingBuild ? ['rescue_used'] : [])].some(key => p.before[key] !== p.after[key])) return 'rejected_action_mutates_state';
  if (v7 && p.outcome !== 'applied' && p.before && p.after && !sameFormedDiscard(p.before.formed_discard, p.after.formed_discard)) return 'rejected_action_mutates_state';
  if (p.action === 'formed_discard' && p.outcome === 'applied') {
    const a = p.before, b = p.after, selected = p.selected_tile_ids;
    if (!a || !b || a.phase !== 'play' || b.phase !== 'play' || a.round_no !== b.round_no || a.formed_discard !== null || b.formed_discard === null || !uniqueIds(selected, 1, 2) || !sameFormedDiscard(b.formed_discard, { round_no: a.round_no, tile_ids: selected }) ||
        b.formed_count !== a.formed_count - selected.length || b.structure_count !== a.structure_count - selected.length || b.discard_count !== a.discard_count + selected.length ||
        ['kong_count', 'hand_count', 'deck_count', 'total_score', 'round_score', 'process_score', 'round_start_score', 'target_score', 'coins', 'ink', 'swaps', 'single_count', 'wild_used', 'rescue_used'].some(key => a[key] !== b[key]) ||
        p.evidence_truncated || p.tile_changes.length !== selected.length || p.tile_changes.some(change => !selected.includes(change[0]) || change[1] !== 'formed' || change[2] !== 'discard')) return 'invalid_formed_discard_transition';
  }
  return null;
}
export function validateGamePayload(name, payload, context = {}) {
  if (!isSupportedGameVersion(context.rules_version, context.score_model_version)) return { ok: false, reason: 'incompatible_game_version' };
  if (!GAME_EVENT_NAMES.includes(name) || !['mcr', 'riichi'].includes(context.mode)) return { ok: false, reason: 'invalid_game_context' };
  if (name !== 'game_action' && !id(context.run_id)) return { ok: false, reason: 'missing_run_context' };
  let reason;
  if (name === 'round_settled' || name === 'hand_completed') {
    if (!id(context.round_attempt_id) || !id(context.hand_id)) return { ok: false, reason: 'missing_settlement_context' };
    reason = validateTerminal(payload, context, name);
  } else if (name === 'game_action') reason = validateAction(payload, context.rules_version);
  else {
    const extras = name === 'run_resumed' ? ['source'] : name === 'run_ended' ? ['reason'] : [];
    if (!keys(payload, ['state', 'record_quality', ...extras]) || !validateGameState(payload.state, context.rules_version) || !quality(payload.record_quality) || context.hand_id != null || (name === 'round_started' && !id(context.round_attempt_id)) || (name === 'run_resumed' && !['save', 'memory', 'consent'].includes(payload.source)) || (name === 'run_ended' && !['victory', 'completed_below_target', 'false_win_below_target', 'retired', 'superseded'].includes(payload.reason))) reason = 'invalid_lifecycle_payload';
  }
  if (reason) return { ok: false, reason };
  const normalized = JSON.parse(JSON.stringify(payload));
  for (const key of ['credited_pattern_ids', 'unlock_pattern_ids', 'owned_relic_ids']) if (Array.isArray(normalized[key])) normalized[key] = [...new Set(normalized[key])].sort();
  return { ok: true, payload: normalized };
}
