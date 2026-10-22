import { groupType, rank, suit } from './hand-rules.js';

// This is a closed-hand construction game. Tile composition is real evidence;
// winning method, wait, turn order and concealed-triplet history are not.
const base = (name, fan, condition, extra = {}) => ({ id: name, name, fan, condition, status: 'base', category: '普通役', ...extra });
const unavailable = (name, fan, condition, reason, extra = {}) => base(name, fan, condition, { status: 'unavailable', reason, ...extra });
const yakuman = (name, condition, extra = {}) => base(name, 13, condition, { category: '役满', classification: 'yakuman', ...extra });
const history = '本作没有立直、巡目或他家鸣牌的对局记录。';
const method = '本作自由组牌，不区分自摸与荣和，也没有对应和牌时机。';
const concealed = '本作不区分每组刻子或杠的明暗及和牌来源；没有足够事实判定暗刻，因此暂不计分。';
const wait = '本作没有指定最终和牌张及和牌前听牌形，不能从最终牌面推断待牌。';

export const RIICHI_CATALOG = [
  unavailable('立直', 1, '门清听牌后宣告立直，再完成和牌。', history),
  unavailable('一发', 1, '立直后未经鸣牌打断的一巡内和牌。', history),
  unavailable('门前清自摸和', 1, '门清并以自摸方式和牌。', method),
  base('断幺九', 1, '所有牌都是 2～8 数牌，不含一、九或字牌。'),
  unavailable('平和', 1, '门清四顺子、非役牌雀头，以两面待完成顺子。', `${wait}本作也没有场风、自风。`),
  base('一盃口', 1, '同花色、同点数的顺子两组；采用门清构筑翻数。', { excludes: ['二盃口'] }),
  base('役牌 · 白', 1, '包含白的刻子或杠；同一种役牌只计一次。'),
  base('役牌 · 發', 1, '包含發的刻子或杠；同一种役牌只计一次。'),
  base('役牌 · 中', 1, '包含中的刻子或杠；同一种役牌只计一次。'),
  unavailable('役牌 · 自风', 1, '包含与自家座位风一致的刻子或杠。', '本作没有玩家座位与自风。'),
  unavailable('役牌 · 场风', 1, '包含与当前场风一致的刻子或杠。', '本作关卡不是东场、南场，不设置场风。'),
  unavailable('抢杠', 1, '以他家加杠牌荣和。', method),
  unavailable('岭上开花', 1, '以开杠后的岭上补牌自摸。', '声明杠已支持，但本作不记录岭上补牌自摸，声明杠本身不等于岭上开花。'),
  unavailable('海底摸月', 1, '以牌山最后一张自摸。', method),
  unavailable('河底捞鱼', 1, '以最后一张舍牌荣和。', method),
  unavailable('两立直', 2, '第一巡、未经鸣牌打断时宣告立直后和牌。', history, { aliases: ['双立直'], excludes: ['立直'] }),
  base('七对子', 2, '七种不同牌各组成一对；同牌四张不能拆成两对。'),
  base('混全带幺九', 2, '每组面子和雀头都含一、九或字牌，同时至少有一个顺子和字牌；门清构筑。', { excludes: ['纯全带幺九', '混老头'] }),
  base('一气通贯', 2, '同花色包含 123、456、789 三个顺子；门清构筑。'),
  base('三色同顺', 2, '万、筒、条各有一组点数相同的顺子；门清构筑。'),
  base('三色同刻', 2, '万、筒、条各有一组点数相同的刻子或杠。'),
  base('三杠子', 2, '三组已声明的杠。', { excludes: ['四杠子'] }),
  base('对对和', 2, '四组刻子或杠，加一对雀头。'),
  unavailable('三暗刻', 2, '三组暗刻或暗杠。', concealed),
  base('小三元', 2, '两种三元牌组成刻子或杠，剩余一种三元牌作雀头；可叠加两组役牌。'),
  base('混老头', 2, '全手只含一、九数牌与字牌；可以与对对和或七对子复合。'),
  base('二盃口', 3, '四组顺子组成两对相同顺子；按顺子解释和牌，不另计七对子；门清构筑。', { excludes: ['一盃口', '七对子'] }),
  base('纯全带幺九', 3, '每组面子和雀头都含一或九，至少有一个顺子，且没有字牌；门清构筑。', { excludes: ['混全带幺九'] }),
  base('混一色', 3, '只用一种数牌花色与字牌；门清构筑。', { excludes: ['清一色'] }),
  base('清一色', 6, '只用一种数牌花色，没有字牌；门清构筑。', { excludes: ['混一色'] }),
  unavailable('流局满贯', 0, '流局时舍牌全为幺九牌、未被鸣牌等条件成立，按满贯结算。', '本作没有对手、舍牌河或流局结算；它是特殊结算，不是普通翻数役。', { valueText: '满贯' }),
  yakuman('国士无双', '六种一九数牌与七种字牌各一张，再重复其中一种，共 14 张。'),
  yakuman('九莲宝灯', '同花色 1112345678999 加该花色任意一张，恰好 14 张、没有杠；门清构筑。'),
  yakuman('大三元', '白、發、中三种牌分别组成刻子或杠。'),
  yakuman('四暗刻', '四组暗刻或暗杠，并满足实际和牌方式要求。', { status: 'unavailable', reason: concealed }),
  yakuman('字一色', '完整和牌全部由字牌构成。'),
  yakuman('绿一色', '完整和牌只用二、三、四、六、八条和發；可以不含發。'),
  yakuman('清老头', '完整和牌全部是一、九数牌，没有字牌。'),
  yakuman('小四喜', '三种风牌组成刻子或杠，第四种风牌作雀头。'),
  yakuman('四杠子', '四组已声明的杠，加一对雀头，共 18 张实牌、14 个结构位置。'),
  yakuman('天和', '庄家起手即自摸和牌。', { status: 'unavailable', reason: `${method}本作也没有庄家起手条件。` }),
  yakuman('地和', '闲家第一巡且未经鸣牌打断时自摸。', { status: 'unavailable', reason: `${method}${history}` }),
  yakuman('国士无双十三面', '国士无双的十三面听牌形，以其中任意一张完成和牌。', { fan: 26, category: '双倍役满', status: 'unavailable', reason: wait, aliases: ['国士无双十三面待'] }),
  yakuman('四暗刻单骑', '四组暗刻已经完成，以雀头单骑待牌和牌。', { fan: 26, category: '双倍役满', status: 'unavailable', reason: `${concealed}${wait}` }),
  yakuman('大四喜', '东、南、西、北分别组成刻子或杠；采用雀魂的双倍役满口径。', { fan: 26, category: '双倍役满', excludes: ['小四喜'] }),
  yakuman('纯正九莲宝灯', '在同花色 1112345678999 的九面听牌形上和牌。', { fan: 26, category: '双倍役满', status: 'unavailable', reason: wait }),
  unavailable('累计役满', 13, '普通役与宝牌累计达到 13 翻时采用的传统得分档位，并非独立役。', '本作按实际翻数查牌型倍率表计分，不追加“累计役满”翻数，也不把高倍率冒充牌型役满。', { category: '役满', valueText: '计分档位' }),
  unavailable('宝牌', 1, '按宝牌指示牌确定，每张额外一翻；不是役，不能单独提供和牌资格。', '本作未设置宝牌指示牌；开杠也不会自动生成杠宝牌。', { category: '宝牌' }),
  unavailable('赤宝牌', 1, '赤五作为额外宝牌计翻；不是役。', '本作没有赤五牌面与赤宝牌标记。', { category: '宝牌' }),
  unavailable('里宝牌', 1, '立直和牌后按里宝牌指示牌追加翻数；不是役。', '本作没有立直与里宝牌指示牌；也不设置杠里宝牌。', { category: '宝牌' }),
  unavailable('拔北宝牌', 1, '三人麻将中拔出的北作为宝牌；不是役。', '本作没有三人麻将与拔北流程。', { category: '宝牌' }),
  base('大车轮', 0, '以七对子解释组成 2～8 筒各一对，需车轮秘卷，和牌分 ×3；不追加役满翻数。', { category: '古役', status: 'relic', relicId: 'wheel', valueText: '和牌分 ×3' }),
  base('将将胡', 0, '完整和牌只含 2、5、8 数牌，需将令，和牌分 ×2.5。', { category: '古役', status: 'relic', relicId: 'jiang', valueText: '和牌分 ×2.5' }),
  base('三连刻', 0, '同花色三组点数连续的刻子或杠，需连山印，和牌分 ×2。', { category: '古役', status: 'relic', relicId: 'mountain', valueText: '和牌分 ×2' }),
];

const catalog = new Map(RIICHI_CATALOG.map(p => [p.id, p]));
const isTerminal = t => t < 27 && (rank(t) === 1 || rank(t) === 9);
const isOutside = t => t >= 27 || isTerminal(t);
const orphanFaces = new Set([0, 8, 9, 17, 18, 26, 27, 28, 29, 30, 31, 32, 33]);
const greenFaces = new Set([19, 20, 21, 23, 25, 32]);

export function riichiPatterns(groups, pair, shape = 'normal') {
  if (!Array.isArray(groups) || !groups.every(Array.isArray) || !Array.isArray(pair)) return [];
  const all = groups.flat().concat(pair);
  if (!all.length || all.some(t => !Number.isInteger(t) || t < 0 || t > 33)) return [];
  const seven = shape === 'pairs';
  const normal = shape === 'normal';
  const counts = Array(34).fill(0);
  for (const t of all) counts[t]++;
  if (seven && (groups.length !== 7 || pair.length || groups.some(g => groupType(g) !== 'pair') || new Set(groups.map(g => g[0])).size !== 7)) return [];
  if (normal && (groups.length !== 4 || groupType(pair) !== 'pair' || groups.some(g => !['chow', 'pung', 'kong'].includes(groupType(g))))) return [];
  if (!normal && !seven && shape !== 'orphans') return [];
  const res = [];
  const add = id => {
    const p = catalog.get(id);
    res.push({ id: p.id, name: p.name, fan: p.fan, tier: p.classification === 'yakuman' ? 2 : p.fan >= 6 ? 1 : 0, ...(p.classification ? { classification: p.classification, ...(p.category === '双倍役满' ? { yakumanMultiplier: 2 } : {}) } : {}) });
  };
  if (shape === 'orphans') {
    if (all.length === 14 && all.every(t => orphanFaces.has(t)) && [...orphanFaces].every(t => counts[t] >= 1) && counts.every(n => n <= 2)) add('国士无双');
    return res;
  }

  const chows = groups.filter(g => groupType(g) === 'chow').map(g => Math.min(...g));
  const pungs = groups.filter(g => ['pung', 'kong'].includes(groupType(g))).map(g => g[0]);
  const pungFaces = new Set(pungs);
  const dragonFaces = new Set(pungs.filter(t => t >= 31));
  const windFaces = new Set(pungs.filter(t => t >= 27 && t <= 30));
  const kongs = groups.filter(g => groupType(g) === 'kong').length;
  const numSuits = new Set(all.filter(t => t < 27).map(suit));
  const honors = all.some(t => t >= 27);
  const pairFace = pair[0];

  // All applicable yakuman stack with each other and replace ordinary yaku.
  if (dragonFaces.size === 3) add('大三元');
  if (all.every(t => t >= 27)) add('字一色');
  if (all.every(t => greenFaces.has(t))) add('绿一色');
  if (all.every(isTerminal)) add('清老头');
  if (windFaces.size === 4) add('大四喜');
  else if (windFaces.size === 3 && pairFace >= 27 && pairFace <= 30 && !windFaces.has(pairFace)) add('小四喜');
  if (kongs === 4) add('四杠子');
  if (!kongs && all.length === 14 && numSuits.size === 1 && !honors) {
    const offset = [...numSuits][0] * 9;
    const minimum = [3, 1, 1, 1, 1, 1, 1, 1, 3];
    if (minimum.every((n, r) => counts[offset + r] >= n)) add('九莲宝灯');
  }
  if (res.length) return res;

  if (all.every(t => t < 27 && rank(t) > 1 && rank(t) < 9)) add('断幺九');
  if (numSuits.size === 1) add(honors ? '混一色' : '清一色');
  if (all.every(isOutside)) add('混老头');
  if (seven) { add('七对子'); return res; }
  if (pungs.length === 4) add('对对和');
  if (kongs === 3) add('三杠子');
  if (dragonFaces.size === 2 && pairFace >= 31 && !dragonFaces.has(pairFace)) add('小三元');
  for (const t of [31, 32, 33]) if (dragonFaces.has(t)) add(['役牌 · 白', '役牌 · 發', '役牌 · 中'][t - 31]);
  if ([0, 1, 2, 3, 4, 5, 6, 7, 8].some(t => pungFaces.has(t) && pungFaces.has(t + 9) && pungFaces.has(t + 18))) add('三色同刻');

  const chowCounts = new Map();
  for (const t of chows) chowCounts.set(t, (chowCounts.get(t) || 0) + 1);
  const twins = [...chowCounts.values()].reduce((n, count) => n + Math.floor(count / 2), 0);
  if (twins) add(twins === 2 ? '二盃口' : '一盃口');
  if (chows.some(t => rank(t) === 1 && chowCounts.has(t + 3) && chowCounts.has(t + 6))) add('一气通贯');
  if (chows.some(t => t < 9 && chowCounts.has(t + 9) && chowCounts.has(t + 18))) add('三色同顺');
  if (chows.length && isOutside(pairFace) && groups.every(g => g.some(isOutside))) add(honors ? '混全带幺九' : '纯全带幺九');
  return res;
}
