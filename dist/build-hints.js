import { RELICS, currentSettlementPreview } from './engine.js';
import { BALANCE } from './balance.js';
import { suit, rank, groupType } from './hand-rules.js';

const SUPPORT = new Set(['ink', 'wind', 'single_seal', 'rank_brush', 'suit_ribbon', 'high_rescue']);
const SUITS = ['万', '筒', '索'];
const unique = values => [...new Set(values)];
const ids = tiles => tiles.map(t => t.id);
const number = value => Number(value || 0).toLocaleString('zh-CN', { maximumFractionDigits: 6 });
const baseNumber = value => number(Number(value || 0) * BALANCE.baseScale);
const editsRemaining = state => Math.max(0, Math.floor((state.ink || 0) / BALANCE.editCost));
const gainEffective = gain => ['base','addMult','retrigger'].includes(gain.kind) ? gain.value > 0 : ['mult','unlock','core'].includes(gain.kind) && gain.value > 1;

// Only formed, fixed-face material is counted before settlement. A wild in a declared
// kong is fixed; every other wild waits for the scorer's actual best assignment.
function material(state) {
  const formed = state.formed || [], kongs = state.kongs || [];
  const locked = new Map(kongs.flatMap(k => k.tileIds.map(id => [id, k.face])));
  const fixed = formed.filter(t => !t.wild || locked.has(t.id)).map(t => ({ ...t, face: locked.get(t.id) ?? t.face }));
  const free = fixed.filter(t => !locked.has(t.id));
  const byFace = Array.from({ length: 34 }, () => []);
  for (const tile of free) byFace[tile.face].push(tile);
  const pungGroups = [...kongs.map(k => [...k.tileIds])];
  for (const tiles of byFace) for (let n = 0; n + 3 <= tiles.length; n += 3) pungGroups.push(ids(tiles.slice(n, n + 3)));
  return { formed, kongs, fixed, free, byFace, pungGroups, wildCount: formed.length - fixed.length };
}

// A tiny nine-face material packing, not a hand solver: the chosen groups cannot
// reuse a tile, and this never asserts that the remaining hand can be completed.
function packSuit(byFace, st, pungs = true) {
  const counts = byFace.slice(st * 9, st * 9 + 9).map(tiles => tiles.length), memo = new Map();
  function pack(left) {
    const key = left.join(','), cached = memo.get(key);
    if (cached) return cached;
    const first = left.findIndex(n => n > 0);
    if (first < 0) return [];
    const skipped = [...left]; skipped[first]--;
    let best = pack(skipped);
    const choices = [];
    if (pungs && left[first] >= 3) choices.push([first, first, first]);
    if (first <= 6 && left[first + 1] && left[first + 2]) choices.push([first, first + 1, first + 2]);
    for (const group of choices) {
      const rest = [...left]; for (const face of group) rest[face]--;
      const candidate = [group, ...pack(rest)];
      if (candidate.length > best.length) best = candidate;
    }
    memo.set(key, best); return best;
  }
  const used = Array(9).fill(0);
  return pack(counts).map(group => group.map(face => byFace[st * 9 + face][used[face]++].id));
}

function pairMaterial(m, mode, st = null) {
  const max = mode === 'mcr' || mode === 'guobiao' ? 2 : 1;
  return m.byFace.flatMap((tiles, face) => st !== null && suit(face) !== st ? [] :
    Array.from({ length: Math.min(max, Math.floor(tiles.length / 2)) }, (_, i) => ids(tiles.slice(i * 2, i * 2 + 2))));
}

function partialRows(state, m) {
  const rows = new Map(), add = (id, progress, effect, detail, tileIds = [], kind = 'progress') => rows.set(id, { progress, effect, detail, tileIds, state: kind });
  const pending = '材料进度，须以最终合法和牌的最佳解释为准。';
  const wildNote = m.wildCount ? `另有 ${m.wildCount} 张未定色万能牌，暂不计花色和成组进度。` : '';
  const pairs = pairMaterial(m, state.mode), pairCount = Math.min(7, pairs.length);
  const chows = SUITS.flatMap((_, st) => packSuit(m.byFace, st, false));
  const melds = [...m.kongs.map(k=>k.tileIds), ...SUITS.flatMap((_,st)=>packSuit(m.byFace,st)),
    ...m.byFace.slice(27).flatMap(tiles=>Array.from({length:Math.floor(tiles.length/3)},(_,i)=>ids(tiles.slice(i*3,i*3+3))))];
  const swaps = state.swaps || 0, ink = state.ink || 0;
  const held = (state.hand || []).filter(t=>t.face>=27 || [1,9].includes(rank(t)));
  add('core_high',`提高番值 · 花色万能${editsRemaining(state)?'可用':'额度已用'}`,'大番曲线＋内置花色万能',`先判番，再按大番曲线计分。自带花色万能能力，不另占槽；保留点数，仅变万／筒／索，不代字牌，与改点／换色共用每关一次${BALANCE.editCost}墨。`);
  add('core_pung',`刻／杠材料 ${m.pungGroups.length} 组`,`每次面子事件 ×${BALANCE.pungFactor}`,pending,m.pungGroups.flat());
  add('core_held',`当前候选有 ${held.length} 张幺九`,`前${BALANCE.heldBaseCount}张 ×${BALANCE.heldFactor}；其后 ×${BALANCE.heldBurstFactor}`,`${Math.min(held.length,BALANCE.heldBaseCount)} 张基础档＋${Math.max(0,held.length-BALANCE.heldBaseCount)} 张爆发档；每张触发 ${(state.relics||[]).includes('retrigger_held')?2:1} 次。须合法和牌，以最终候选为准；重触发不增加合格张数。`,ids(held));
  add('core_growth',`已储存 ${baseNumber(Math.floor(state.growth?.coreGrowth || 0))} 底分`,`每次顺子事件 ×${BALANCE.growthRate}`,'只有合法结算才写入永久成长；本手处理完成长后，加入底分一次。',chows.flat());
  add('retrigger_meld',`当前面子材料 ${melds.length} 组`,'对应面子额外触发1次','可重复面子底分、刻子倍率和顺子成长，不重复金币，也不递归生成触发。',melds.flat());
  add('retrigger_held',`当前候选有 ${held.length} 张幺九`,'留牌计分额外触发1次','需与留牌核心配合，最终快照中每张符合条件的牌额外计分一次。',ids(held));
  add('high_rescue',state.rescueUsed?'本关已使用':'本关尚未使用','组牌时一次补缺',`需同时装备大番核心、且成型区未满14。可换最多${BALANCE.highRescueSize}张，或花共用${BALANCE.editCost}墨改1张点数／花色；补缺二选一，编辑不另送改牌次数。`,[],'support');
  add('jade', '等待合法和牌', `底分 +${baseNumber(BALANCE.jadeBase)}`, '完整和牌后计入整手底分。');
  add('river', `顺子材料 ${chows.length} 组`, `已累计 ${baseNumber(state.growth?.river)} 底分；每顺子再成长 ${baseNumber(BALANCE.riverBase)}`, pending + wildNote, chows.flat());
  add('stone', `刻／杠材料 ${m.pungGroups.length} 组`, `每次底分 +${baseNumber(BALANCE.stoneBase)}，每组得 1 铜钱`, pending + wildNote, m.pungGroups.flat());
  for (const [id, st] of [['seal', 0], ['mirror', 1], ['bamboo', 2]]) {
    const tiles = m.fixed.filter(t => suit(t) === st);
    add(id, `已入 ${tiles.length} 张${SUITS[st]}子`, `每张有效同色牌底分 +${baseNumber(BALANCE.suitBase)}`, pending + wildNote, ids(tiles));
  }
  const echoOptions = SUITS.map((name, st) => {
    const melds = [...m.kongs.filter(k => suit(k.face) === st).map(k => k.tileIds), ...packSuit(m.byFace, st)];
    const samePairs = m.kongs.length ? [] : pairMaterial(m, state.mode, st);
    return { st, name, melds, pairs: samePairs, count: Math.max(melds.length, samePairs.length) };
  }).sort((a, b) => b.count - a.count || a.st - b.st);
  const echo = echoOptions[0];
  add('echo', `${echo.name}子：${Math.min(3,echo.melds.length)}/3 面子 · ${Math.min(3,echo.pairs.length)}/3 对子`, '满足任一解释时，和牌分 ×1.5', '同色面子与七对中的对子分开计数，不混算；' + pending + wildNote, unique([...echo.melds.flat(), ...echo.pairs.flat()]));
  const coinGain = Math.min(1, Math.floor((state.coins || 0) / 5) / 10);
  add('coin', `持有 ${state.coins || 0} 铜钱`, `当前可加倍率 ${number(coinGain)}`, '按结算前铜钱，每 5 枚倍率 +0.1，上限 +1；本关结算奖励不提前计入。');
  add('growth', `已累计 ${baseNumber(state.growth?.exchange)} 底分`, '基础六关暂不刷新', '成长在合法和牌时计入；显示值不包含尚未执行的换牌。');
  add('pair', m.kongs.length ? '已有锁定杠，本关不能采用七对' : `已成对材料 ${pairCount}/7 对`, `最终采用七对解释：底分 +${baseNumber(BALANCE.pairBase)}`, `${state.mode === 'mcr' ? '国标允许四同牌拆两对' : '日麻七对要求七种不同牌'}；已声明的杠不能拆回对子。${pending}${wildNote}`, pairs.flat());
  const wheelPairs = Array.from({ length: 7 }, (_, i) => m.byFace[i + 10].slice(0, 2)).filter(tiles => tiles.length === 2);
  const wheelMissing = Array.from({ length: 7 }, (_, i) => i + 2).filter(n => m.byFace[n + 8].length < 2);
  add('wheel', `2～8 筒已成对 ${wheelPairs.length}/7 种`, '七对解释成立：和牌分 ×3', `${wheelMissing.length ? `尚缺 ${wheelMissing.join('、')} 筒对子；` : '七种对子材料齐备；'}${m.kongs.length ? '已有锁定杠，本关不能采用七对；' : ''}最终目标是 2～8 筒各一对，并采用对应七对解释。${wildNote}`, ids(wheelPairs.flat()));
  // Rank remains known even for a suit-wild tile, so 2/5/8 material is safe to count.
  const jiangTiles = m.formed.filter(t => t.face < 27 && [2, 5, 8].includes(rank(t)));
  add('jiang', `2／5／8 数牌 ${jiangTiles.length}/${m.formed.length} 张`, `每张底分 +${baseNumber(BALANCE.jiangBase)}；全手满足再 ×2.5`, '全手只能含 2、5、8 数牌，且必须组成合法牌型；只满足点数不等于和牌。', ids(jiangTiles));
  const pungFaces = new Map();
  for (const k of m.kongs) if (!pungFaces.has(k.face)) pungFaces.set(k.face, [...k.tileIds]);
  m.byFace.forEach((tiles, face) => { if (tiles.length >= 3 && !pungFaces.has(face)) pungFaces.set(face, ids(tiles.slice(0, 3))); });
  let mountain = { count: 0, start: 0, tileIds: [] };
  for (let st = 0; st < 3; st++) for (let n = 0; n < 7; n++) {
    const start = st * 9 + n, groups = [start, start + 1, start + 2].filter(face => pungFaces.has(face));
    if (groups.length > mountain.count) mountain = { count: groups.length, start, tileIds: groups.flatMap(face => pungFaces.get(face)) };
  }
  add('mountain', `连续刻／杠材料 ${mountain.count}/3 组`, `每刻／杠底分 +${baseNumber(BALANCE.mountainBase)}；三连刻再 ×2`, `${mountain.count ? `当前目标 ${rank(mountain.start)}～${rank(mountain.start) + 2}${SUITS[suit(mountain.start)]}；` : ''}三组须同花色且点数连续，各组使用不同实体牌。${pending}${wildNote}`, mountain.tileIds);
  add('reserve', `剩余 ${swaps} 次换牌`, `当前可加 ${baseNumber(swaps * 20)} 底分`, '基础六关暂不刷新。');
  add('kong_cauldron', `已声明 ${m.kongs.length} 杠`, `每个声明杠底分 +${baseNumber(BALANCE.kongBase)}`, '只计已声明的杠；可与刻石、连山印的刻／杠底分叠加，须合法和牌。', m.kongs.flatMap(k => k.tileIds));
  add('ink', `剩余 ${ink} 墨`, '基础六关暂不刷新', '每关共用一次改牌，不通过墨泉追加次数。', [], 'support');
  add('wind', `剩余 ${swaps} 次换牌`, '每关额外 2 次已计入资源', '基础六关暂不刷新；成型区不支持替换。', [], 'support');
  add('single_seal', `本关已触发 ${state.singleCount || 0}/4 次`, `已得 ${baseNumber((state.singleCount || 0) * BALANCE.singleBase)} 过程分`, '有效单张首次入区即得分；过程分不再随最终和牌倍率重复放大。', [], 'support');
  add('rank_brush', `本关还可改牌 ${editsRemaining(state)} 次`, `每次 ${BALANCE.editCost} 墨：数牌点数 ±1`, '准备与组牌共用额度；可选候选或成型区非杠数牌，满14张未结算仍可用。点数限1～9，不保证和牌。', [], 'support');
  add('suit_ribbon', `本关还可改牌 ${editsRemaining(state)} 次`, `每次 ${BALANCE.editCost} 墨：保持点数换花色`, '准备与组牌共用额度；可改两区非杠数牌，字牌不能改，万能牌可定色。满14张未结算仍可用。', [], 'support');
  return rows;
}

function gainText(gains) {
  const parts=[];
  const base=gains.filter(g=>g.kind==='base').reduce((n,g)=>n+g.value,0);
  const mult=gains.filter(g=>['mult','unlock'].includes(g.kind)).reduce((n,g)=>n*g.value,1);
  const added=gains.filter(g=>g.kind==='addMult').reduce((n,g)=>n+g.value,0);
  const repeat=gains.filter(g=>g.kind==='retrigger').reduce((n,g)=>n+g.value,0);
  const core=gains.find(g=>g.kind==='core');
  if(base)parts.push(`底分 +${number(base)}`);
  if(mult!==1)parts.push(`共 ×${number(mult)}`);
  if(added)parts.push(`倍率 +${number(added)}`);
  if(repeat)parts.push(`额外触发 ${repeat} 次`);
  if(core)parts.push(`牌型倍率 ×${number(core.value)}`);
  return parts.join('；');
}

function finalTileIds(id, preview) {
  const d = preview.decomposition, tiles = d?.tiles || [], groups = d?.groups || [];
  const matchedSteps = (preview.steps || []).filter(step => step.relicId === id).flatMap(step => step.tileIds || []);
  if (matchedSteps.length) return unique(matchedSteps);
  const groupsMatching = predicate => groups.flatMap((group, i) => predicate(group) ? d.groupTileIds?.[i] || [] : []);
  if (id === 'river') return groupsMatching(group => groupType(group) === 'chow');
  if (['stone', 'mountain'].includes(id)) return groupsMatching(group => ['pung', 'kong'].includes(groupType(group)));
  if (id === 'kong_cauldron') return (preview.declaredKongs || []).flatMap(k => k.tileIds);
  if (id === 'echo') {
    const counts = [0, 0, 0]; for (const group of groups) if (suit(group[0]) < 3) counts[suit(group[0])]++;
    return groupsMatching(group => suit(group[0]) < 3 && counts[suit(group[0])] >= 3);
  }
  return id === 'coin' ? [] : ids(tiles);
}

/** Read-only display model. Rows cover owned relics only; never inspect the wall.
 * Strings are presentation-ready. `active` means an effective gain in the actual
 * best settlement, never potential material. `legal` is null until verified.
 */
export function buildHints(state, preview) {
  const m = material(state), complete = m.formed.length - m.kongs.length === 14;
  const result = complete ? preview ?? currentSettlementPreview(state) : null;
  const legal = complete && result?.valid && typeof result.legal === 'boolean' ? result.legal : null;
  const owned = new Set(state.relics || []), candidates = partialRows(state, m);
  const gains = legal ? (result.gains || []).filter(gain => owned.has(gain.id) && gainEffective(gain)) : [];
  const activeIds = unique(gains.map(gain => gain.id));
  const rows = RELICS.filter(relic => owned.has(relic.id)).map(relic => {
    const row = { id: relic.id, name: relic.name, state:'progress',progress:'等待合法和牌',effect:relic.kind,detail:relic.desc,tileIds:[], ...candidates.get(relic.id) };
    if (!complete) return row;
    if (legal === false) return SUPPORT.has(relic.id) ? row : { ...row, state: 'inactive', progress: '先修复牌形', effect: '当前结算将诈胡', detail: `当前14个结构位置尚未组成合法牌型。${editsRemaining(state) && ['rank_brush','suit_ribbon','core_high'].some(id=>owned.has(id)) ? '尚可用对应工具改写非杠数牌，但不保证修复成功。' : '本关已无普通改牌机会；若有合法杠仍可声明。'}已有过程分保留。`, tileIds: [] };
    if (legal === null) return { ...row, state: 'inactive', progress: '等待结算验证', detail: result?.reason || '未取得有效结算预览，暂不确认联动。', tileIds: [] };
    const ownGains = gains.filter(gain => gain.id === relic.id);
    if (ownGains.length) return { ...row, state: 'active', progress: '本次已触发', effect: gainText(ownGains),
      detail: `已计入当前最佳解释。${relic.id === 'core_held' ? row.detail : ''}${relic.id === 'stone' && result.coinGain ? `结算另得 ${result.coinGain} 铜钱。` : ''}${ownGains.some(gain => gain.kind === 'unlock') ? `已满足${ownGains.find(gain => gain.kind === 'unlock').name}。` : ''}`,
      tileIds: finalTileIds(relic.id, result) };
    if (SUPPORT.has(relic.id)) return row;
    return { ...row, state: 'inactive', progress: '本次未触发', effect: '当前最佳解释未计入此项',
      detail: `${relic.desc}${['pair', 'wheel'].includes(relic.id) && result.decomposition?.shape !== 'pairs' ? '本次采用其他牌型解释。' : ''}`, tileIds: [] };
  });
  return { complete, legal, activeIds, rows };
}
