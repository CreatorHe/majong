/**
 * Presentation themes only. No hand recognition, scoring or payment conventions.
 * Non-winning outcomes always block success themes. Otherwise presentation.effectId chooses
 * the theme; actual matching pattern classification
 * and mode choose its rarity wording. Visual variants never imply double-yakuman payment.
 */
const art = name => name ? `cinematic/${name}-v2.webp` : null;
const definitions = [
  ['normal', '和牌', 'normal', '#a6c9ac', '#f0ebdd', null, '牌面成型 · 逐项结算'],
  ['score', '高分落定', 'heaven', '#e6be6e', '#fff1c8', 'cosmos', '高分落定 · 记下这一手'],
  ['multiplier', '倍率升华', 'wheel', '#76d3c7', '#e5ffed', 'lotus', '倍率攀升 · 连锁收束'],
  ['false_hu', '诈胡', 'normal', '#b88e78', '#e5d2bc', null, '牌型未成立 · 扣分后核对累计门槛'],
  ['no_yaku', '无役', 'normal', '#a6b7ad', '#dce2d4', null, '牌形成立但无役 · 本手 0 翻、0 分'],
  ['incomplete', '未完成', 'normal', '#b5a28c', '#e5d8c5', null, '牌山与候选耗尽 · 未满十四个结构位置'],
  ['kokushi', '国士无双', 'orphans', '#dbb067', '#fff0c3', 'sovereign', '十三门并立 · 一线归一'],
  ['daisangen', '大三元', 'dragons', '#de7864', '#f4d58c', 'cosmos', '三曜归一 · 星轨共鸣'],
  ['shousuushii', '小四喜', 'winds', '#a8d9d4', '#f9e7b9', 'phoenix', '三风起 · 一风归'],
  ['daisuushii', '大四喜', 'winds', '#e2b66d', '#fff4d6', 'phoenix', '四方风动 · 共聚一席'],
  ['tsuuiisou', '字一色', 'honors', '#c2b4e0', '#f3e5bd', 'scroll', '七字成章 · 符印相承'],
  ['ryuuiisou', '绿一色', 'green', '#79cba1', '#e4f7cc', 'forest', '竹影澄碧 · 一色成境'],
  ['chinroutou', '清老头', 'terminals', '#b8b7ac', '#eddbb0', 'scroll', '幺九峙立 · 山岩成阵'],
  ['chuuren', '九莲宝灯', 'lotus', '#bba3e3', '#ffebbc', 'lotus', '九灯浮起 · 星莲绽放'],
  ['suukantsu', '四杠子', 'kongs', '#ca9671', '#ffe0a4', 'gate', '四重门震 · 杠声落定'],
  ['honroutou', '混老头', 'terminals', '#c6b796', '#f4e8c9', 'scroll', '幺九与字 · 刻影成章'],
  ['chinitsu', '清一色', 'green', '#91c7b4', '#f4edcf', 'forest', '一色铺陈 · 贯穿全手'],
  ['chiitoitsu', '七对子', 'seven_pairs', '#d8b08d', '#fff0d2', 'scroll', '七次相逢 · 对对成章'],
  ['renqiidui', '连七对', 'seven_pairs', '#e6be79', '#fff1bc', 'lotus', '七对相连 · 次第点亮'],
  ['daisharin', '大车轮', 'wheel', '#8dd1cb', '#f6e3ac', 'lotus', '车轮秘卷 · 环玉流转'],
  ['ittsuu', '一气通贯', 'dragons', '#dcaa72', '#f7e2b5', 'cosmos', '一至九相接 · 一线贯通'],
  ['pure_triple_chow', '一色三同顺', 'wheel', '#85c8be', '#ecf5d4', 'lotus', '三道同序 · 玉纹相合'],
  ['pure_quadruple_chow', '一色四同顺', 'wheel', '#a6d9cf', '#fff0bc', 'lotus', '四道同序 · 重环共鸣'],
  ['pure_triple_pung', '一色三节高', 'terminals', '#c2a984', '#f4dfb7', 'gate', '三节连起 · 层层向上'],
  ['pure_quadruple_pung', '一色四节高', 'kongs', '#d4ad77', '#ffe6b2', 'gate', '四节登阶 · 高台成势'],
  ['sanshoku', '三色三同顺', 'dragons', '#b7c3d3', '#f4e4b7', 'cosmos', '三色同序 · 万筒条相应'],
  ['ryanpeikou', '二盃口', 'seven_pairs', '#c1b0d5', '#efe5c8', 'scroll', '双影成双 · 顺序相叠'],
  ['all_jiang', '将将胡', 'honors', '#cca475', '#f8e1ab', 'scroll', '将令秘卷 · 二五八成阵'],
];

const VARIANTS = Object.freeze({
  kokushi: Object.freeze({
    standard: Object.freeze({ variantLabel: '' }),
    thirteen_wait: Object.freeze({ variantLabel: '十三面听', color: '#f1ca7f', accent: '#fff8df',
      subtitle: '十三面同开 · 一牌归位' }),
  }),
  suuankou: Object.freeze({
    standard: Object.freeze({ variantLabel: '' }),
    tanki: Object.freeze({ variantLabel: '单骑', color: '#99dce7', accent: '#f0fffc',
      subtitle: '四影已定 · 单骑归位' }),
  }),
  chuuren: Object.freeze({
    standard: Object.freeze({ variantLabel: '' }),
    pure: Object.freeze({ variantLabel: '纯正九面', color: '#d1b4fb', accent: '#fff5cf',
      subtitle: '九面灯开 · 纯正星莲' }),
  }),
});

const BONUS_IDS = new Set(['score', 'multiplier']);
const SECRET_IDS = new Set(['daisharin', 'all_jiang']);
const NON_WINNING_IDS = new Set(['false_hu', 'no_yaku', 'incomplete']);
const BASIC_IDS = new Set(['normal', ...NON_WINNING_IDS, ...BONUS_IDS]);

export const EFFECTS = Object.freeze(definitions.map(([id, label, family, color, accent, image, subtitle]) =>
  Object.freeze({ id, label, family, color, accent, art: art(image),
    introMs: id === 'normal' || NON_WINNING_IDS.has(id) ? 1600 : 3200,
    rarity: SECRET_IDS.has(id) ? '秘卷' : BASIC_IDS.has(id) ? '普通' : '大番',
    subtitle, ...(VARIANTS[id] ? { variants: VARIANTS[id] } : {}),
  })));
const BY_ID = new Map(EFFECTS.map(effect => [effect.id, effect]));

// Exact aliases describe the supplied named pattern; they never inspect tile structure.
const PATTERN_ALIASES = {
  kokushi: ['国士无双', '国士無双', '国士无双十三面', '国士无双十三面听', '十三幺', 'kokushi_musou', 'kokushi_thirteen'],
  suuankou: ['四暗刻', '四暗刻单骑', '四暗刻単騎', 'suuankou_tanki', 'four_concealed_triplets'],
  daisangen: ['大三元', 'big_three_dragons'],
  shousuushii: ['小四喜', 'small_four_winds', 'shousuushi'],
  daisuushii: ['大四喜', 'big_four_winds', 'daisuushi'],
  tsuuiisou: ['字一色', 'all_honors', 'all_honours'],
  ryuuiisou: ['绿一色', '緑一色', 'all_green'],
  chinroutou: ['清老头', '清老頭', '清幺九', 'all_terminals'],
  honroutou: ['混老头', '混老頭', '混幺九', 'all_terminals_and_honors'],
  chuuren: ['九莲宝灯', '九蓮宝燈', '纯正九莲宝灯', '纯正九蓮宝燈', 'nine_gates', 'chuuren_pure'],
  suukantsu: ['四杠子', '四槓子', '四杠', 'four_kongs', 'four_quads'],
  tenhou: ['天和', 'heavenly_hand'],
  chiihou: ['地和', 'earthly_hand'],
  chinitsu: ['清一色', 'full_flush'],
  chiitoitsu: ['七对', '七对子', '七対子', 'seven_pairs'],
  renqiidui: ['连七对', '連七対', 'seven_shifted_pairs'],
  daisharin: ['大车轮', '大車輪', 'wheel'],
  ittsuu: ['一气通贯', '一気通貫', '清龙', '清龍', 'pure_straight'],
  pure_triple_chow: ['一色三同顺'],
  pure_quadruple_chow: ['一色四同顺'],
  pure_triple_pung: ['一色三节高', 'pure_shifted_pungs'],
  pure_quadruple_pung: ['一色四节高', 'four_pure_shifted_pungs'],
  sanshoku: ['三色三同顺', '三色同顺', '三色同順', 'mixed_triple_chow'],
  ryanpeikou: ['二盃口', '二杯口'],
  all_jiang: ['将将胡', '將將胡', 'jiang'],
};
const normalize = value => String(value ?? '').trim().toLowerCase().replace(/[\s_\-·]/g, '');
const ALIAS_TO_ID = new Map(Object.entries(PATTERN_ALIASES)
  .flatMap(([id, aliases]) => [id, ...aliases].map(alias => [normalize(alias), id])));

function patternId(pattern) {
  return ALIAS_TO_ID.get(normalize(pattern?.id)) || ALIAS_TO_ID.get(normalize(pattern?.label));
}
function classification(pattern) {
  const value = pattern?.classification;
  return normalize(typeof value === 'object' && value !== null ? value.type : value);
}
function isSecret(pattern) {
  return ['secret', 'secretscroll', 'customrelic', 'relic', '秘卷'].includes(classification(pattern));
}
function isYakuman(pattern) {
  return ['yakuman', 'doubleyakuman', 'yakumandouble', 'yakuman2', '役满', '双倍役满']
    .includes(classification(pattern));
}
function isDoubleYakuman(pattern) {
  if (['doubleyakuman', 'yakumandouble', 'yakuman2', '双倍役满'].includes(classification(pattern))) return true;
  // Only explicit classification metadata counts; never infer from waits, score or multiplier.
  return isYakuman(pattern) && (pattern?.yakumanMultiplier === 2 || pattern?.classification?.multiplier === 2);
}
function isRiichi(mode) {
  return ['riichi', 'japanese', 'jp', '日麻', '日本麻将'].includes(normalize(mode));
}
function suppliedVariant(presentation, pattern, id) {
  const raw = presentation.variant ?? pattern?.variant ?? 'standard';
  const value = typeof raw === 'object' && raw !== null ? raw.id : raw;
  return Object.hasOwn(VARIANTS[id] || {}, value) ? value : 'standard';
}

export function getEffect(snapshot = {}) {
  const safe = snapshot && typeof snapshot === 'object' ? snapshot : {};
  const presentation = safe.presentation && typeof safe.presentation === 'object' ? safe.presentation : {};
  const patterns = Array.isArray(safe.patterns) ? safe.patterns : [];
  const hasExplicitId = typeof presentation.effectId === 'string' && presentation.effectId.length > 0;
  let id;
  if (NON_WINNING_IDS.has(safe.handResult)) {
    // Passing the cumulative gate does not turn this hand into a winning one.
    id = safe.handResult;
  } else if (hasExplicitId) {
    id = BY_ID.has(presentation.effectId) ? presentation.effectId : 'normal';
  } else {
    const actual = patterns.find(pattern => isYakuman(pattern) && !isSecret(pattern) && BY_ID.has(patternId(pattern)));
    id = actual ? patternId(actual) : 'normal';
  }
  const base = BY_ID.get(id);
  const matching = patterns.find(pattern => patternId(pattern) === id);
  const variant = suppliedVariant(presentation, matching, id);
  const variantStyle = VARIANTS[id]?.[variant] || {};
  let rarity = base.rarity;
  if (!BASIC_IDS.has(id)) {
    if (SECRET_IDS.has(id) || isSecret(matching)) rarity = '秘卷';
    else if (isRiichi(safe.mode) && isYakuman(matching)) rarity = isDoubleYakuman(matching) ? '双倍役满' : '役满';
    else rarity = matching?.tier > 0 ? '大番' : isRiichi(safe.mode) ? '役种' : '番型';
  }
  // Mode-specific names are names only. They do not imply a fan value or payment amount.
  let label = base.label;
  if (!isRiichi(safe.mode) && id === 'ittsuu') label = '清龙';
  if (!isRiichi(safe.mode) && id === 'chiitoitsu') label = '七对';
  if (!isRiichi(safe.mode) && id === 'kokushi') label = '十三幺';
  if (!isRiichi(safe.mode) && id === 'chinroutou') label = '清幺九';
  if (!isRiichi(safe.mode) && id === 'honroutou') label = '混幺九';
  if (!isRiichi(safe.mode) && id === 'suukantsu') label = '四杠';
  if (isRiichi(safe.mode) && id === 'sanshoku') label = '三色同顺';
  const introMs = rarity === '役满' || rarity === '双倍役满' ? 3600 : base.introMs;
  return Object.freeze({ ...base, ...variantStyle, label, rarity, introMs, variant,
    variantLabel: variantStyle.variantLabel || '',
  });
}
