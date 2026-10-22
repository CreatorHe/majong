import { faceValue, suit, rank, groupType, structuralCount, decompose, canCompleteByAdding } from './hand-rules.js';
export { faceValue, suit, rank, groupType, structuralCount };
import { riichiPatterns } from './riichi-patterns.js';
import { mcrPatterns } from './mcr-patterns.js';
import { PATTERN_CATALOG } from './pattern-catalog.js';
import {BALANCE, CORE_IDS, STARTER_RELIC_ID, TARGETS, DISABLED_RELIC_IDS, COMPATIBLE_RELICS, FIRST_COMPATIBLE, highFanMultiplier} from './balance.js';
export {BALANCE, CORE_IDS, STARTER_RELIC_ID, TARGETS};
export const VERSION = 6;
export const MODES = { mcr: { name: '国标番型', short: '国标', unit: '番', scale: 8 }, riichi: { name: '日麻役种', short: '日麻', unit: '翻', scale: 1 } };
export const ROUND_NAMES = ['初见青山', '竹影入局', '风过空谷', '云深不知', '月照千峰', '登临绝顶'];
// Cumulative targets, provisional playtest values for one complete hand per round.

export const target = s => s.roundTarget ?? TARGETS[s.mode][s.round];
export const RELICS = [
  {id:'core_high',name:'天机算筹',icon:'筹',kind:'核心',core:true,desc:'大番路线：番数达到档位时跃升倍率；与补缺符搭配获得组牌阶段一次补缺。',price:0},
  {id:'core_pung',name:'叠岳印',icon:'岳',kind:'核心',core:true,get desc(){return `刻子路线：每次刻子或杠计分，倍率 ×${BALANCE.pungFactor}。`;},price:0},
  {id:'core_held',name:'藏锋匣',icon:'藏',kind:'核心',core:true,get desc(){return `留牌路线：合法和牌时，候选区前${BALANCE.heldBaseCount}张幺九牌每次计分 ×${BALANCE.heldFactor}，第${BALANCE.heldBaseCount+1}～${BALANCE.handSize}张每次 ×${BALANCE.heldBurstFactor}；重复触发沿用该张牌的档位。`;},price:0},
  {id:'core_growth',name:'长春梳',icon:'生',kind:'核心',core:true,get desc(){return `成长路线：从${BALANCE.growthSeed*BALANCE.baseScale}有效底分开始，每次合法顺子计分储存底分 ×${BALANCE.growthRate}；跨关保留。`;},price:0},
  {id:'retrigger_meld',name:'复鸣铃',icon:'鸣',kind:'联动',desc:'每副面子额外计分一次，重触发面子的底分、倍率和明确允许的成长；不重复发钱。',price:8},
  {id:'retrigger_held',name:'余音扇',icon:'余',kind:'联动',desc:'合法和牌时，候选区留牌计分效果额外触发一次。',price:8},
  {id:'high_rescue',name:'补缺符',icon:'补',kind:'辅助',get desc(){return `需天机算筹：每关组牌未满14时，额外弃换最多${BALANCE.highRescueSize}张，或花共用${BALANCE.editCost}墨改一张数牌点数±1／花色；两种方式共用一次，不额外赠送改牌次数。`;},price:8},
  { id: 'jade', name: '温玉', icon: '玉', kind: '基础', get desc(){return `合法和牌时，整手底分 +${BALANCE.jadeBase*BALANCE.baseScale}。`;}, price: 5 },
  { id: 'river', name: '流云梳', icon: '川', kind: '顺子', get desc(){return `合法和牌每组顺子永久成长 ${BALANCE.riverBase*BALANCE.baseScale} 底分；本次即享全部累计成长。`;}, price: 6 },
  { id: 'stone', name: '刻石', icon: '山', kind: '刻子', get desc(){return `合法和牌每次刻子或杠计分 +${BALANCE.stoneBase*BALANCE.baseScale} 底分；每组只获得 1 铜钱。`;}, price: 6 },
  { id: 'bamboo', name: '青竹', icon: '竹', kind: '花色', get desc(){return `合法和牌每张有效索子 +${BALANCE.suitBase*BALANCE.baseScale} 底分。`;}, price: 5 },
  { id: 'mirror', name: '圆镜', icon: '◎', kind: '花色', get desc(){return `合法和牌每张有效筒子 +${BALANCE.suitBase*BALANCE.baseScale} 底分。`;}, price: 5 },
  { id: 'seal', name: '朱印', icon: '萬', kind: '花色', get desc(){return `合法和牌每张有效万子 +${BALANCE.suitBase*BALANCE.baseScale} 底分。`;}, price: 5 },
  { id: 'echo', name: '回响铃', icon: '回', kind: '连动', desc: '最终至少 3 组数牌面子同花色，和牌分 ×1.5；七对解释比较对子。', price: 8 },
  { id: 'coin', name: '聚宝钱', icon: '貝', kind: '经济', desc: '按结算前铜钱，每持有 5 枚倍率 +0.1，最多 +1。', price: 7 },
  { id: 'ink', name: '墨泉', icon: '墨', kind: '辅助', desc: '基础六关暂不开放；不刷新，也不增加改牌次数。', price: 5 },
  { id: 'wind', name: '借东风', icon: '風', kind: '辅助', desc: '本版暂不开放，不增加换牌次数。', price: 5 },
  { id: 'growth', name: '千层塔', icon: '塔', kind: '成长', desc: '本版暂不开放，不再从换牌获得成长。', price: 6 },
  { id: 'pair', name: '成双玉', icon: '双', kind: '七对', get desc(){return `最终采用七对解释和牌时，整手底分 +${BALANCE.pairBase*BALANCE.baseScale}；国标允许四同牌拆两对。`;}, price: 6 },
  { id: 'wheel', name: '车轮秘卷', icon: '輪', kind: '秘卷', desc: '七对解释组成 2～8 筒各一对，和牌分 ×3。日麻解锁大车轮，国标为连七对额外加赏。', price: 8 },
  { id: 'jiang', name: '将令', icon: '將', kind: '秘卷', get desc(){return `合法和牌每张 2、5、8 数牌 +${BALANCE.jiangBase*BALANCE.baseScale} 底分；全手仅含这些牌时解锁将将胡，和牌分 ×2.5。`;}, price: 8 },
  { id: 'mountain', name: '连山印', icon: '岳', kind: '秘卷', get desc(){return `每组刻子或杠 +${BALANCE.mountainBase*BALANCE.baseScale} 底分；同花色三组连续刻子类面子，和牌分 ×2。`;}, price: 8 },
  { id: 'reserve', name: '留白扇', icon: '白', kind: '收束', desc: '本版暂不开放，不按剩余换牌次数计分。', price: 6 },
  { id: 'single_seal', name: '独行印', icon: '独', kind: '单张', get desc(){return `每关前 4 次有效单张出牌各 +${BALANCE.singleBase*BALANCE.baseScale} 过程分；仅实体首次入区触发。`;}, price: 5 },
  { id: 'kong_cauldron', name: '四方鼎', icon: '鼎', kind: '杠', get desc(){return `合法和牌每个已声明的杠 +${BALANCE.kongBase*BALANCE.baseScale} 底分，可与刻子奇物联动。`;}, price: 6 },
  { id: 'rank_brush', name: '升降笔', icon: '笔', kind: '改牌', get desc(){return `准备或组牌阶段，候选及成型区非杠数牌点数 ±1，范围 1～9；消耗共用${BALANCE.editCost}墨，满14未结算也可用。`;}, price: 5 },
  { id: 'suit_ribbon', name: '换色绫', icon: '绫', kind: '改牌', get desc(){return `准备或组牌阶段，候选及成型区非杠数牌换花色、保持点数；消耗共用${BALANCE.editCost}墨，满14未结算也可用。`;}, price: 5 },
  { id: 'wild_jade', name: '百相玉', icon: '相', kind: '改牌', get desc(){return `准备或组牌阶段，候选及成型区非杠数牌变为三色万能牌，保持点数、不代替字牌；消耗共用${BALANCE.editCost}墨，满14未结算也可用。`;}, price: 8 },
];
export const relic = id => RELICS.find(r => r.id === id);
export const tileName = tile => { const t = faceValue(tile); return t < 27 ? ['一','二','三','四','五','六','七','八','九'][rank(t)-1] + (tile?.wild ? '万能' : ['万','筒','索'][suit(t)]) : ['东','南','西','北','白','發','中'][t-27]; };
const sum = a => a.reduce((x,y) => x+y,0);
const count = a => a.reduce((o,v) => (o[v]=(o[v]||0)+1,o),{});
const has = (s,id) => s.relics.includes(id);
const precise = value => Number(value.toFixed(6));
export const fanMultiplier = (mode, fans) => precise(1 + fans / (mode === 'mcr' ? 8 : 1));
const clone = value => JSON.parse(JSON.stringify(value));
const freeze = value => { if (value && typeof value === 'object' && !Object.isFrozen(value)) { for (const child of Object.values(value)) freeze(child); Object.freeze(value); } return value; };
const available = s => [...s.hand, ...s.formed];
export const coreId = s => s.relics.find(id => CORE_IDS.includes(id)) || null;
const lockedIds = s => new Set(s.kongs.flatMap(k => k.tileIds));
const validIds = (ids, pool, min = 1, max = Infinity) => Array.isArray(ids) && ids.length >= min && ids.length <= max && new Set(ids).size === ids.length && ids.every(id => typeof id === 'string' && pool.some(t => t.id === id));
const pick = (pool, ids) => ids.map(id => pool.find(t => t.id === id));
export function random(s) { s.rng = (Math.imul(s.rng,1664525)+1013904223)>>>0; return s.rng/4294967296; }
function shuffle(s,a) { for(let i=a.length-1;i>0;i--){const j=Math.floor(random(s)*(i+1));[a[i],a[j]]=[a[j],a[i]];} return a; }
export const BASE_PATTERNS = Object.fromEntries(Object.entries(PATTERN_CATALOG).map(([mode, entries]) =>
  [mode, entries.filter(p=>p.status==='base').map(p=>[p.name,p.fan,p.condition])]));
// The catalog explicitly lists timing/seat/winning-tile facts absent from this solo game.
export function patterns(mode, groups, pair, shape='normal') {
  return mode === 'mcr' ? mcrPatterns(groups,pair,shape) : riichiPatterns(groups,pair,shape);
}
export const RULES_VERSION = 'opening-build-v6';
export const SCORE_MODEL_VERSION = 'four-core-v6';
export function specialStatus(s, groups = [], pair = [], shape = 'normal') {
  const all = groups.flat().concat(pair), full = shape === 'pairs' ? groups.length === 7 : groups.length === 4 && pair.length === 2;
  const pungs = groups.filter(g => ['pung','kong'].includes(groupType(g))).map(g => g[0]);
  return [
    {id:'wheel',name:s.mode==='mcr'?'连七对 · 车轮加赏':'大车轮',mult:3,ready:full&&shape==='pairs'&&groups.every(g=>g[0]>=10&&g[0]<=16)&&new Set(groups.map(g=>g[0])).size===7,progress:`${groups.filter(g=>g.length===2&&g[0]>=10&&g[0]<=16).length}/7 对`,condition:'七对解释 · 2～8 筒各一对'},
    {id:'jiang',name:'将将胡',mult:2.5,ready:full&&all.every(t=>t<27&&[2,5,8].includes(rank(t))),progress:`${all.filter(t=>t<27&&[2,5,8].includes(rank(t))).length}/${all.length} 张`,condition:'完整牌型仅含 2、5、8 数牌'},
    {id:'mountain',name:s.mode==='mcr'?'一色三节高 · 连山加赏':'三连刻',mult:2,ready:full&&pungs.some(t=>t<27&&suit(t)===suit(t+2)&&pungs.includes(t+1)&&pungs.includes(t+2)),progress:`${pungs.length}/3 刻子类面子`,condition:'同花色三组点数连续的刻子或杠'},
  ].filter(x=>has(s,x.id));
}

export function inspect(s, proposedIds = []) {
  if (s.phase !== 'play') return { valid:false, reason:'当前不在组牌阶段' };
  if (!validIds(proposedIds, s.hand, 0)) return { valid:false, reason:'请选择有效且不重复的备选牌' };
  const formed = [...s.formed, ...pick(s.hand, proposedIds)], n = formed.length - s.kongs.length;
  if (n > 14) return { valid:false, reason:'成型区最多 14 个结构位置；四张相同牌可使用声明杠', count:n, remaining:14-n };
  const complete = n === 14;
  try {
    const legal = complete && decompose(formed, s.kongs, s.mode).length > 0;
    const canComplete = legal || canCompleteByAdding(formed, s.kongs, s.mode);
    return { valid:true, count:n, remaining:14-n, complete, legal, canComplete, risk:canComplete?'safe':'needs_repair',
      reason:complete ? legal?'牌形成立，可以预览结算':'当前结算将诈胡；可检查剩余改牌次数、工具或声明杠的调整机会' : canComplete?`还需 ${14-n} 个结构位置`:'仅靠追加牌不能完成当前牌形；可检查改牌工具、补缺资格或继续承担诈胡风险' };
  } catch {
    return { valid:true, count:n, remaining:14-n, complete, legal:null, canComplete:null, risk:'unknown', reason:'暂时无法计算牌形，请稍后重试；可以继续调整' };
  }
}
export const preview = inspect;

function scoreDecomposition(s, d) {
  const all=d.groups.flat().concat(d.pair),chows=d.groups.filter(g=>groupType(g)==='chow'),pungs=d.groups.filter(g=>['pung','kong'].includes(groupType(g)));
  const fanList=patterns(s.mode,d.groups,d.pair,d.shape),events=has(s,'retrigger_meld')?2:1;
  const steps=[{event:'hand_reveal',sourceId:'hand',tileIds:d.tiles.map(t=>t.id),label:'和牌成立'}],gains=[];
  let base=0,mult=1;
  const addBase=(id,name,value,tileIds=[],relicId=null)=>{
    value*=BALANCE.baseScale;if(!value)return;const before=base;base+=value;
    steps.push({event:relicId?'relic_trigger':'tile_score',sourceId:id,...(relicId?{relicId}:{}),tileIds,target:'base',operation:'add',before,delta:value,after:base,label:name});
    if(relicId)gains.push({id:relicId,name,value,kind:'base'});
  };
  const bonus=(id,value,tileIds=[])=>addBase(id,relic(id).name,value,tileIds,id);
  const multiply=(id,name,value,kind='mult',isRelic=true,tileIds=[],eventDetails={})=>{
    const before=mult;mult=precise(mult*value);gains.push({id,name,value,kind});
    steps.push({event:isRelic?'relic_trigger':'multiplier_update',sourceId:id,...(isRelic?{relicId:id}:{}),tileIds,target:'multiplier',operation:'multiply',before,delta:value,after:mult,label:name,...eventDetails});
  };
  addBase('tiles','牌面底分',sum(all.map(t=>t>=27?BALANCE.honorBase:BALANCE.tileBase)),d.tiles.map(t=>t.id));addBase('complete','完整和牌',BALANCE.completeBase);
  if(has(s,'jade'))bonus('jade',BALANCE.jadeBase);
  const growthRiver=has(s,'river')?chows.length*BALANCE.riverBase*events:0;
  if(has(s,'river'))bonus('river',s.growth.river+growthRiver);
  let growthCoreAfter=s.growth.coreGrowth;
  if(has(s,'core_growth')){
    for(let i=0;i<chows.length*events;i++)growthCoreAfter=precise(growthCoreAfter*BALANCE.growthRate);
    bonus('core_growth',Math.floor(growthCoreAfter));
  }
  for(let gi=0;gi<d.groups.length;gi++){
    const kind=groupType(d.groups[gi]),ids=d.groupTileIds[gi]||[];
    if(!['pung','kong'].includes(kind))continue;
    for(let trigger=0;trigger<events;trigger++){
      if(has(s,'stone'))bonus('stone',BALANCE.stoneBase,ids);
      if(has(s,'mountain'))bonus('mountain',BALANCE.mountainBase,ids);
      if(kind==='kong'&&has(s,'kong_cauldron'))bonus('kong_cauldron',BALANCE.kongBase,ids);
    }
  }
  for(const [id,st]of [['seal',0],['mirror',1],['bamboo',2]])if(has(s,id)){const tiles=d.tiles.filter(t=>suit(t)===st);bonus(id,tiles.length*BALANCE.suitBase,tiles.map(t=>t.id));}
  if(has(s,'pair')&&d.shape==='pairs')bonus('pair',BALANCE.pairBase);
  if(has(s,'jiang')){const tiles=d.tiles.filter(t=>faceValue(t)<27&&[2,5,8].includes(rank(t)));bonus('jiang',tiles.length*BALANCE.jiangBase,tiles.map(t=>t.id));}
  const fans=sum(fanList.map(p=>p.fan));let revealedFans=0;
  for(const p of fanList){const before=mult;revealedFans+=p.fan;mult=precise(has(s,'core_high')?highFanMultiplier(s.mode,revealedFans):fanMultiplier(s.mode,revealedFans));steps.push({event:'pattern_reveal',sourceId:p.id,tileIds:[],target:'multiplier',operation:'set',before,delta:0,after:mult,label:p.name});}
  if(has(s,'core_high'))gains.push({id:'core_high',name:relic('core_high').name,value:mult,kind:'core'});
  if(has(s,'coin')){const value=Math.min(1,Math.floor(s.coins/5)/10),before=mult;mult=precise(mult+value);gains.push({id:'coin',name:relic('coin').name,value,kind:'addMult'});steps.push({event:'relic_trigger',sourceId:'coin',relicId:'coin',tileIds:[],target:'multiplier',operation:'add',before,delta:value,after:mult,label:relic('coin').name});}
  if(has(s,'core_pung'))for(let gi=0;gi<d.groups.length;gi++)if(['pung','kong'].includes(groupType(d.groups[gi])))for(let trigger=0;trigger<events;trigger++)multiply('core_pung',relic('core_pung').name,BALANCE.pungFactor,'mult',true,d.groupTileIds[gi]);
  if(has(s,'core_held')){
    const held=s.hand.filter(tile=>tile.face>=27||[1,9].includes(rank(tile))).sort((a,b)=>a.face-b.face||a.id.localeCompare(b.id));
    held.forEach((tile,ordinal)=>{
      const burst=ordinal>=BALANCE.heldBaseCount,factor=burst?BALANCE.heldBurstFactor:BALANCE.heldFactor;
      for(let trigger=0;trigger<(has(s,'retrigger_held')?2:1);trigger++)multiply('core_held',`${relic('core_held').name}${burst?' · 爆发档':''}`,factor,'mult',true,[tile.id],{heldOrdinal:ordinal+1,heldTier:burst?'burst':'base'});
    });
  }
  if(has(s,'retrigger_meld')&&d.groups.some(g=>['pung','kong','chow'].includes(groupType(g))))gains.push({id:'retrigger_meld',name:relic('retrigger_meld').name,value:d.groups.filter(g=>['pung','kong','chow'].includes(groupType(g))).length,kind:'retrigger'});
  if(has(s,'retrigger_held')&&has(s,'core_held')&&s.hand.some(t=>t.face>=27||[1,9].includes(rank(t))))gains.push({id:'retrigger_held',name:relic('retrigger_held').name,value:s.hand.filter(t=>t.face>=27||[1,9].includes(rank(t))).length,kind:'retrigger'});
  const suitGroups=count(d.groups.filter(g=>suit(g[0])<3).map(g=>suit(g[0])));
  if(has(s,'echo')&&Object.values(suitGroups).some(n=>n>=3))multiply('echo','回响铃',1.5);
  for(const sp of specialStatus(s,d.groups,d.pair,d.shape))if(sp.ready)multiply(sp.id,sp.name,sp.mult,'unlock');
  if(s.round===5)multiply('summit_wind','绝顶寒风',BALANCE.summitMultiplier,'mult',false);
  mult=precise(mult);const multiplierUnits=BigInt(mult.toFixed(6).replace('.','')),total=Number(BigInt(base)*multiplierUnits/1000000n);
  steps.push({event:'multiplier_update',sourceId:'final_multiplier',tileIds:[],target:'multiplier',operation:'set',before:mult,delta:0,after:mult,label:'最终倍率'});
  steps.push({event:'hand_total',sourceId:'hand_total',tileIds:d.tiles.map(t=>t.id),target:'score',operation:'set',before:0,delta:total,after:total,label:'和牌得分'});
  return {base,fans,patterns:fanList,gains,mult,total,decomposition:d,steps,growthRiver,growthCoreAfter,coinGain:has(s,'stone')?pungs.length:0};
}

function explanationKey(d) { return `${d.shape}/${d.groups.map(g=>g.join('.')).join('/')}/${d.pair.join('.')}/${d.tiles.map(t=>`${t.id}:${t.face}`).sort().join('/')}`; }
export function currentSettlementPreview(s) {
  if (s.phase === 'settlement' && s.last) return s.last;
  if (s.phase !== 'play') return {valid:false,reason:'当前不在组牌阶段'};
  if (structuralCount(s) !== 14) return {valid:false,reason:'请先填满 14 个结构位置'};
  try {
    const options = decompose(s.formed,s.kongs,s.mode).map(d=>scoreDecomposition(s,d));
    options.sort((a,b)=>b.total-a.total || explanationKey(a.decomposition).localeCompare(explanationKey(b.decomposition)));
    const legal = options.length > 0, penalty = legal ? 0 : Math.ceil(target(s)*0.1);
    const result = legal ? options[0] : {base:0,fans:0,patterns:[],gains:[],mult:1,total:0,decomposition:null,growthRiver:0,growthCoreAfter:s.growth.coreGrowth,coinGain:0,steps:[
      {event:'hand_reveal',sourceId:'hand',tileIds:s.formed.map(t=>t.id),label:'牌形检查'},
      {event:'false_hu',sourceId:'false_hu',tileIds:s.formed.map(t=>t.id),target:'score',operation:'add',before:s.totalScore,delta:-penalty,after:s.totalScore-penalty,label:'诈胡扣分'},
    ]};
    const delta = result.total - penalty, cumulativeAfter = s.totalScore + delta, passed = cumulativeAfter >= target(s);
    if (![result.base,result.mult,result.total,delta,cumulativeAfter].every(Number.isFinite) || !Number.isSafeInteger(cumulativeAfter)) return {valid:false,reason:'结算数值超出支持范围，请重试'};
    const scoreTier = !legal ? 0 : result.total >= target(s)*2 ? 2 : result.total >= target(s) ? 1 : 0;
    const multiplierTier = !legal ? 0 : result.mult >= 20 ? 2 : result.mult >= 8 ? 1 : 0;
    const patternTier = Math.max(0,...result.patterns.map(p=>p.tier));
    result.steps.push({event:'round_result',sourceId:'round_result',tileIds:[],target:'score',operation:'add',before:s.totalScore,delta,after:cumulativeAfter,label:passed?'累计达标':'累计未达标'});
    const passCoins = passed ? 8 + Math.min(5,Math.floor(Math.max(0,cumulativeAfter)/target(s))) : 0;
    return freeze({ valid:true, legal,resultType:legal?'win':'false_win',handResult:legal?'agari':'false_hu', ...result,
      runId:s.runId,roundId:s.roundId,settlementId:s.settlementId,mode:s.mode,rulesVersion:VERSION,scoreVersion:SCORE_MODEL_VERSION,
      round:s.round,target:target(s),penalty,delta,cumulativeBefore:s.totalScore,cumulativeAfter,passed,
      processScore:s.processScore,roundStartScore:s.roundStartScore,roundScore:s.score+delta,
      tiles:clone(result.decomposition?.tiles || s.formed),heldTiles:clone(s.hand),declaredKongs:clone(s.kongs),
      wildcardAssignments:clone(result.decomposition?.wildcardAssignments || []),
      rewardCoins:passCoins,tiers:{scoreTier,multiplierTier,patternTier,themeId:result.patterns.some(p=>p.classification==='yakuman')?'yakuman':patternTier>0?'grand':result.gains.some(g=>g.kind==='unlock')?'scroll':'jade'},
      display:{base:String(result.base),multiplier:String(result.mult),handScore:String(result.total),penalty:String(penalty),roundScore:String(s.score+delta),cumulativeBefore:String(s.totalScore),cumulativeAfter:String(cumulativeAfter),target:String(target(s))},
    });
  } catch {
    return {valid:false,reason:'结算计算失败，请重试；没有扣分或消耗资源'};
  }
}

export function newRun(mode='mcr',seed=Date.now()) {
  if (!MODES[mode]) throw Error('Unknown mode');
  const runId = globalThis.crypto?.randomUUID?.() || `run-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  return {version:VERSION,rulesVersion:RULES_VERSION,scoreVersion:SCORE_MODEL_VERSION,runId,mode,seed:seed>>>0,rng:seed>>>0,phase:'starter',round:0,coins:8,relics:[],growth:{river:0,exchange:0,coreGrowth:BALANCE.growthSeed},history:[],totalScore:0,bestHand:0,offers:[...CORE_IDS],shop:[],log:[],roundScores:[],score:0,processScore:0};
}
export const DRAW_BATCH_SIZE = BALANCE.handSize;
export function startRound(s) {
  s.phase='prepare';s.roundId=`${s.runId}:round:${s.round}`;s.settlementId=`${s.roundId}:settlement`;
  s.roundTarget=TARGETS[s.mode][s.round];s.roundStartScore=s.totalScore;
  s.formed=[];s.kongs=[];s.hand=[];s.discard=[];s.selected=[];s.score=0;s.processScore=0;s.singleCount=0;s.wildUsed=0;
  s.swaps=BALANCE.openingExchanges;s.openingSwapsUsed=0;s.rescueUsed=false;s.ink=BALANCE.ink;s.last=null;s.log=[];s.batches=[];s.shop=[];
  s.deck=shuffle(s,Array.from({length:136},(_,i)=>({id:`${s.roundId}:tile:${i}`,original:Math.floor(i/4),face:Math.floor(i/4),wild:false,entered:false})));
  refill(s);sortHand(s);
}
function refill(s) { while(s.hand.length<DRAW_BATCH_SIZE&&s.deck.length) s.hand.push(s.deck.pop()); }
export function sortHand(s) { s.hand.sort((a,b)=>a.face-b.face || Number(a.wild)-Number(b.wild) || a.id.localeCompare(b.id));s.selected=[]; }
export function addRelic(s,id,replaceId=null) {
  if(!['starter','reward'].includes(s.phase)||!relic(id)||DISABLED_RELIC_IDS.includes(id)||has(s,id))return false;
  if(!s.offers.includes(id)||s.phase==='starter'&&(!CORE_IDS.includes(id)||s.relics.length))return false;
  if(replaceId!==null&&!has(s,replaceId))return false;
  const equipped=s.relics.filter(x=>x!==replaceId).concat(id,...(s.phase==='starter'?[STARTER_RELIC_ID]:[]));
  if(equipped.length>BALANCE.relicSlots||equipped.filter(x=>CORE_IDS.includes(x)).length>1)return false;
  // A core is a run-defining starter, never a side effect of reward replacement.
  if(s.phase==='reward'&&(CORE_IDS.includes(id)||CORE_IDS.includes(replaceId)))return false;
  s.relics=equipped;
  // The lower-level acquisition API consumes the same one-choice reward.
  if(s.phase==='reward'){s.phase='shop';s.shop=[];s.offers=[];}
  return true;
}
export function beginPlay(s){if(s.phase!=='prepare')return false;s.phase='play';s.swaps=0;return true;}

export function chooseStarter(s,id) {if(s.phase!=='starter'||!CORE_IDS.includes(id)||!s.offers.includes(id)||!addRelic(s,id))return false;s.offers=[];startRound(s);return true;}
export function commit(s,ids) {
  if(s.phase!=='play')return {valid:false,reason:'请先完成起手准备并开始组牌'};
  if(!validIds(ids,s.hand)) return {valid:false,reason:'请选择有效且不重复的备选牌'};
  const inspection=inspect(s,ids);if(!inspection.valid)return inspection;
  const tiles=pick(s.hand,ids),processGain=tiles.length===1&&!tiles[0].entered&&has(s,'single_seal')&&s.singleCount<4?BALANCE.singleBase*BALANCE.baseScale:0;
  if(processGain){s.singleCount++;s.processScore+=processGain;s.score+=processGain;s.totalScore+=processGain;}
  for(const t of tiles)t.entered=true;
  const used=new Set(ids);s.hand=s.hand.filter(t=>!used.has(t.id));s.formed.push(...tiles);
  s.batches.push({id:`${s.roundId}:batch:${s.batches.length}`,tileIds:[...ids],kind:'play',processGain});
  s.log.unshift({step:s.batches.length,score:processGain,names:processGain?['独行印']:[],label:`放入 ${ids.length} 张`});
  refill(s);sortHand(s);
  return {valid:true,processGain,inspection};
}
export function declareKong(s,ids) {
  if(s.phase!=='play'||s.kongs.length>=4||!validIds(ids,available(s),4,4))return {ok:false,reason:'请选择四张可组成杠的牌'};
  const locked=lockedIds(s);if(ids.some(id=>locked.has(id)))return {ok:false,reason:'已声明杠内的牌不能再次使用'};
  const tiles=pick(available(s),ids);
  const fixed=tiles.filter(t=>!t.wild),face=fixed[0]?.face;
  if(face===undefined||fixed.some(t=>t.face!==face)||tiles.some(t=>t.wild&&(face>=27||rank(t)!==rank(face))))return {ok:false,reason:'杠需要四张相同牌；万能牌须有相同点数'};
  const incoming=tiles.filter(t=>s.hand.some(h=>h.id===t.id));
  if(structuralCount(s)+incoming.length-1>14)return {ok:false,reason:'声明后超过 14 个结构位置'};
  const id=`${s.roundId}:kong:${s.kongs.length}`;
  for(const t of tiles){t.entered=true;if(t.wild)t.face=face;}
  s.kongs.push({id,tileIds:[...ids],face});
  const used=new Set(ids);s.hand=s.hand.filter(t=>!used.has(t.id));s.formed.push(...incoming);
  s.batches.push({id:`${s.roundId}:batch:${s.batches.length}`,tileIds:incoming.map(t=>t.id),kind:'kong',processGain:0});
  s.log.unshift({step:s.batches.length,score:0,names:[],label:`声明 ${tileName(face)}杠`});
  if(incoming.length)refill(s);sortHand(s);return {ok:true,kongId:id};
}
function redraw(s,ids){const used=new Set(ids);s.discard.push(...s.hand.filter(t=>used.has(t.id)));s.hand=s.hand.filter(t=>!used.has(t.id));for(let i=0;i<ids.length;i++)s.hand.push(s.deck.pop());sortHand(s);}
export function exchange(s,ids) {
  if(s.phase!=='prepare'||s.swaps<1||!validIds(ids,s.hand,1,BALANCE.openingExchangeSize)||s.deck.length<ids.length)return false;
  redraw(s,ids);s.swaps--;s.openingSwapsUsed++;return true;
}
export function replaceFormed(){return {ok:false,reason:'本版本不支持替换成型牌'};}
export function highRescue(s,request={}){
  if(s.phase!=='play'||structuralCount(s)>=14||s.rescueUsed||!has(s,'core_high')||!has(s,'high_rescue'))return {ok:false,reason:'补缺需天机算筹和补缺符，且本关未使用、成型区未满14'};
  const {type,ids,arg}=request;
  if(type==='exchange'){
    if(!validIds(ids,s.hand,1,BALANCE.highRescueSize)||s.deck.length<ids.length)return {ok:false,reason:`请选择1～${BALANCE.highRescueSize}张候选牌`};
    redraw(s,ids);s.rescueUsed=true;return {ok:true,type,count:ids.length};
  }
  if(!['rank','suit'].includes(type))return {ok:false,reason:'补缺仅支持弃换、点数±1或换花色'};
  const result=applyTransform(s,ids,type,arg,true);if(result.ok)s.rescueUsed=true;return result;
}

export function transform(s,ids,action,arg){if(!['prepare','play'].includes(s.phase))return {ok:false,reason:'改牌只在准备或组牌阶段开放'};return applyTransform(s,ids,action,arg,false);}
function applyTransform(s,ids,action,arg,rescue=false) {
  if(!validIds(ids,available(s),1,1))return {ok:false,reason:'请选择一张候选或成型区的非杠牌'};
  if(lockedIds(s).has(ids[0]))return {ok:false,reason:'杠内牌已经锁定，不能改写'};
  const t=available(s).find(t=>t.id===ids[0]);
  if(t.face>=27)return {ok:false,reason:'字牌不能改点数、改花色或变为万能牌'};
  const required={rank:'rank_brush',suit:'suit_ribbon',wild:'wild_jade'}[action];
  if(!required||!rescue&&!has(s,required))return {ok:false,reason:required?`需要持有${relic(required).name}`:'不支持这种改牌方式'};
  const cost=BALANCE.editCost;
  if(!Number.isInteger(s.ink)||s.ink<0||s.ink>BALANCE.ink||s.ink%cost!==0)return {ok:false,reason:'改牌额度无效，请重新开始旅程'};
  if(s.ink<cost)return {ok:false,reason:'本关改牌次数已用完；准备与组牌共用一次'};
  let face=t.face,wild=t.wild;
  if(action==='rank') {
    if(![-1,1].includes(arg)||rank(t)+arg<1||rank(t)+arg>9)return {ok:false,reason:'点数只能在 1～9 内增减 1'};
    face+=arg;
  } else if(action==='suit') {
    if(![0,1,2].includes(arg))return {ok:false,reason:'请选择万、筒或索'};
    face=arg*9+rank(t)-1;wild=false;
    if(face===t.face&&!t.wild)return {ok:false,reason:'牌面没有变化'};
  } else {
    if(t.wild||s.wildUsed>=1)return {ok:false,reason:'每关最多生成一张花色万能牌'};
    wild=true;
  }
  t.face=face;t.wild=wild;s.ink-=cost;if(action==='wild')s.wildUsed++;
  sortHand(s);return {ok:true,tileId:t.id,face,wild,cost};
}
function drawRelics(s,n) {
  const core=coreId(s);
  const pool=shuffle(s,RELICS.filter(r=>!r.core&&!DISABLED_RELIC_IDS.includes(r.id)&&!has(s,r.id)
    &&(r.id!=='high_rescue'||core==='core_high')&&(r.id!=='retrigger_held'||core==='core_held')).map(r=>r.id));
  const compatible=COMPATIBLE_RELICS[coreId(s)]||[];
  const first=s.round===0?FIRST_COMPATIBLE[coreId(s)]:null;
  const guaranteed=pool.includes(first)?first:pool.find(id=>compatible.includes(id));
  if(guaranteed){pool.splice(pool.indexOf(guaranteed),1);pool.unshift(guaranteed);}
  return pool.slice(0,n);
}
export function settle(s) {
  if(s.phase==='settlement'&&s.last)return s.last;
  if(s.phase!=='play')return {valid:false,reason:'本关已经结束'};
  const result=currentSettlementPreview(s);if(!result.valid)return result;
  // All computations, RNG decisions and next-state preparation precede the single mutation.
  const next=clone(s);next.last=clone(result);next.phase='settlement';next.totalScore=result.cumulativeAfter;next.score=result.roundScore;
  if(result.legal){next.growth.river+=result.growthRiver;next.growth.coreGrowth=result.growthCoreAfter;next.coins+=result.coinGain;next.bestHand=Math.max(next.bestHand,result.total);}
  next.coins+=result.rewardCoins;next.roundScores.push(result.roundScore);
  next.history.push({settlementId:result.settlementId,round:next.round,legal:result.legal,passed:result.passed,handScore:result.total,penalty:result.penalty,roundScore:result.roundScore,cumulativeScore:result.cumulativeAfter});
  next.offers=result.passed&&next.round<5?drawRelics(next,3,true):[];next.shop=[];
  Object.assign(s,next);s.last=freeze(s.last);return s.last;
}
export function finishSettlement(s) { if(s.phase!=='settlement'||!s.last)return false;s.phase=s.last.passed?(s.round===5?'victory':s.offers.length?'reward':'shop'):'defeat';return true; }
export function chooseReward(s,id,replaceId=null) {if(s.phase!=='reward'||!s.offers.includes(id)||!addRelic(s,id,replaceId))return false;s.phase='shop';s.shop=[];s.offers=[];return true;}
export function skipReward(s){if(s.phase!=='reward')return false;s.phase='shop';s.shop=[];s.offers=[];return true;}
export function buy(){return false;}
export function refreshShop(){return false;}
export function sell(){return false;}
export function nextRound(s){if(s.phase!=='shop'||s.round>=5)return false;s.round++;startRound(s);return true;}
export function retire(s){if(!['prepare','play'].includes(s.phase))return false;s.phase='defeat';return true;}

export function restore(raw){
  try {
    const s=JSON.parse(raw),integer=(x,min=0)=>Number.isSafeInteger(x)&&x>=min,signed=x=>Number.isSafeInteger(x);
    if(!s||s.version!==VERSION||s.rulesVersion!==RULES_VERSION||s.scoreVersion!==SCORE_MODEL_VERSION||!MODES[s.mode]||!['starter','prepare','play','settlement','reward','shop','defeat','victory'].includes(s.phase)||typeof s.runId!=='string')return null;
    if(!Array.isArray(s.relics)||s.relics.length>BALANCE.relicSlots||s.relics.some(x=>!relic(x)||DISABLED_RELIC_IDS.includes(x))||new Set(s.relics).size!==s.relics.length||s.relics.filter(x=>CORE_IDS.includes(x)).length!==(s.phase==='starter'?0:1)||!integer(s.round)||s.round>5||!integer(s.coins)||!integer(s.rng)||!signed(s.totalScore)||!integer(s.bestHand))return null;
    if(!s.growth||!integer(s.growth.river)||!integer(s.growth.exchange)||!Number.isFinite(s.growth.coreGrowth)||s.growth.coreGrowth<0||s.growth.coreGrowth>Number.MAX_SAFE_INTEGER||!Array.isArray(s.offers)||new Set(s.offers).size!==s.offers.length||s.offers.some(x=>!relic(x)||DISABLED_RELIC_IDS.includes(x)||has(s,x))||!Array.isArray(s.shop)||s.shop.length||!Array.isArray(s.roundScores)||!s.roundScores.every(signed)||!Array.isArray(s.history))return null;
    if(s.phase==='starter'&&(s.relics.length||s.offers.length!==CORE_IDS.length||s.offers.some(x=>!CORE_IDS.includes(x))))return null;
    if(s.phase!=='starter'&&(s.offers.length>3||s.offers.some(x=>CORE_IDS.includes(x))))return null;
    if(s.phase!=='starter'){
      if(s.roundId!==`${s.runId}:round:${s.round}`||s.settlementId!==`${s.roundId}:settlement`||s.roundTarget!==TARGETS[s.mode][s.round]||!signed(s.roundStartScore)||!signed(s.score)||!integer(s.processScore)||!integer(s.swaps)||s.swaps>BALANCE.openingExchanges||!integer(s.openingSwapsUsed)||s.openingSwapsUsed>BALANCE.openingExchanges||typeof s.rescueUsed!=='boolean'||!integer(s.ink)||s.ink>BALANCE.ink||s.ink%BALANCE.editCost!==0||!integer(s.singleCount)||s.singleCount>4||!integer(s.wildUsed)||s.wildUsed>1||!Array.isArray(s.log)||!Array.isArray(s.batches))return null;
      if(['prepare','play','settlement'].includes(s.phase)&&s.rescueUsed&&(!has(s,'core_high')||!has(s,'high_rescue')))return null;
      const tile=t=>t&&typeof t.id==='string'&&integer(t.original)&&t.original<34&&integer(t.face)&&t.face<34&&typeof t.wild==='boolean'&&(!t.wild||t.face<27)&&typeof t.entered==='boolean';
      if(!['hand','formed','deck','discard'].every(key=>Array.isArray(s[key])&&s[key].every(tile))||s.hand.length>DRAW_BATCH_SIZE||!Array.isArray(s.kongs)||s.kongs.length>4)return null;
      const all=[...s.hand,...s.formed,...s.deck,...s.discard];
      if(all.length!==136||new Set(all.map(t=>t.id)).size!==136||all.filter(t=>t.wild).length>s.wildUsed||Array.from({length:34},(_,face)=>all.filter(t=>t.original===face).length).some(n=>n!==4))return null;
      const editedTiles=all.filter(t=>t.face!==t.original||t.wild).length;
      if(editedTiles!==(BALANCE.ink-s.ink)/BALANCE.editCost)return null;
      if(all.some(t=>!t.id.startsWith(`${s.roundId}:tile:`))||s.formed.some(t=>!t.entered))return null;
      const kongIds=new Set();
      for(const k of s.kongs){
        if(!k||typeof k.id!=='string'||!integer(k.face)||k.face>=34||!validIds(k.tileIds,s.formed,4,4)||k.tileIds.some(id=>kongIds.has(id)))return null;
        for(const id of k.tileIds){kongIds.add(id);if(s.formed.find(t=>t.id===id).face!==k.face)return null;}
      }
      if(structuralCount(s)>14||s.totalScore!==s.roundStartScore+s.score)return null;
      if(s.phase==='prepare'&&(s.formed.length||s.kongs.length||s.batches.length||s.processScore||s.last||s.rescueUsed||s.swaps+s.openingSwapsUsed!==BALANCE.openingExchanges))return null;
      if(['play','settlement','reward','shop','victory'].includes(s.phase)&&s.swaps!==0)return null;
      if(s.last){
        if(s.last.settlementId!==s.settlementId||!s.last.valid||typeof s.last.legal!=='boolean'||typeof s.last.passed!=='boolean'||!signed(s.last.cumulativeAfter)||s.last.cumulativeAfter!==s.totalScore||s.last.roundScore!==s.score||s.last.passed!==(s.last.cumulativeAfter>=s.roundTarget)||!Array.isArray(s.last.steps)||!Array.isArray(s.last.patterns)||!Array.isArray(s.last.gains)||!s.last.tiers)return null;
        if(structuralCount(s)!==14||s.last.target!==s.roundTarget||s.last.cumulativeBefore+s.last.delta!==s.last.cumulativeAfter||s.last.total-s.last.penalty!==s.last.delta)return null;
        if(s.last.rulesVersion!==VERSION||s.last.scoreVersion!==SCORE_MODEL_VERSION||JSON.stringify(s.last.heldTiles)!==JSON.stringify(s.hand)||s.last.growthCoreAfter!==s.growth.coreGrowth)return null;
        freeze(s.last);
      }
      if(['settlement','reward','shop','victory'].includes(s.phase)&&!s.last)return null;
      if(['reward','shop','victory'].includes(s.phase)&&!s.last.passed)return null;
      if(s.phase==='play'&&s.last)return null;
    }
    return s;
  }catch{return null;}
}
