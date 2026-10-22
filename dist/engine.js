import { faceValue, suit, rank, groupType, structuralCount, decompose, canCompleteByAdding } from './hand-rules.js';
export { faceValue, suit, rank, groupType, structuralCount };
import { riichiPatterns } from './riichi-patterns.js';
import { mcrPatterns } from './mcr-patterns.js';
import { PATTERN_CATALOG } from './pattern-catalog.js';
import {BALANCE, CORE_IDS, STARTER_RELIC_ID, TARGETS, DISABLED_RELIC_IDS, highFanMultiplier} from './balance.js';
export {BALANCE, CORE_IDS, STARTER_RELIC_ID, TARGETS};
export const VERSION = 9;
export const MODES = { mcr: { name: '国标番型', short: '国标', unit: '番', scale: 8 }, riichi: { name: '日麻役种', short: '日麻', unit: '翻', scale: 1 } };
export const ROUND_NAMES = ['初见青山', '竹影入局', '风过空谷', '云深不知', '月照千峰', '登临绝顶'];
// Cumulative targets, provisional playtest values for one complete hand per round.

export const target = s => s.roundTarget ?? TARGETS[s.mode][s.round];
export const RELICS = [
  {id:'rank_brush',name:'升降笔',icon:'笔',kind:'改牌',desc:'仅准备阶段可改一张候选数牌点数±1，范围1～9；与换色、万能共用每关一次改牌额度。',price:0},
  {id:'suit_ribbon',name:'换色绫',icon:'绫',kind:'改牌',desc:'仅准备阶段可改一张候选数牌花色，保持点数；与改点、万能共用每关一次改牌额度。',price:0},
  {id:'wild_jade',name:'百相玉',icon:'相',kind:'改牌',desc:'仅准备阶段将一张数牌变为花色万能牌：保留点数，结算时择优作为万、筒、索之一，不代字牌；共用每关一次改牌额度。',price:0},
  {id:'high_rescue',name:'补缺符',icon:'补',kind:'辅助',desc:'每关二选一：准备时使用共用改牌额度改点±1或换色；或组牌未满14时额外弃换最多3张。无需计分核心。',price:0},
];
export const relic = id => RELICS.find(r => r.id === id);
export const tileName = tile => { const t = faceValue(tile); return t < 27 ? ['一','二','三','四','五','六','七','八','九'][rank(t)-1] + (tile?.wild ? '万能' : ['万','筒','索'][suit(t)]) : ['东','南','西','北','白','發','中'][t-27]; };
const sum = a => a.reduce((x,y) => x+y,0);
const has = (s,id) => s.relics.includes(id);
const precise = value => Number(value.toFixed(6));
export const fanMultiplier = highFanMultiplier;
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
export const RULES_VERSION = 'nine-batch-v9';
export const SCORE_MODEL_VERSION = 'fan-score-v9';
export function specialStatus() { return []; }

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
      reason:complete ? legal?'牌形成立，可以预览结算':'当前结算将诈胡；可检查成型弃除或声明杠的调整机会' : canComplete?`还需 ${14-n} 个结构位置`:'仅靠追加牌不能完成当前牌形；可检查成型弃除、换牌或补缺资格，或继续承担诈胡风险' };
  } catch {
    return { valid:true, count:n, remaining:14-n, complete, legal:null, canComplete:null, risk:'unknown', reason:'暂时无法计算牌形，请稍后重试；可以继续调整' };
  }
}
export const preview = inspect;

function scoreDecomposition(s, d) {
  const fanList=patterns(s.mode,d.groups,d.pair,d.shape);
  const yakumanCount=fanList.filter(p=>p.classification==='yakuman').reduce((n,p)=>n+(p.yakumanMultiplier||1),0);
  const fans=sum(fanList.map(p=>p.fan)),noYaku=s.mode==='riichi'&&fans===0;
  const base=noYaku?0:BALANCE.scoreBase,mult=precise(highFanMultiplier(s.mode,fans));
  const total=Number(BigInt(base)*BigInt(mult.toFixed(6).replace('.',''))/1000000n);
  const steps=[{event:'hand_reveal',sourceId:'hand',tileIds:d.tiles.map(t=>t.id),label:noYaku?'无役，零收益':'和牌成立'},
    {event:'tile_score',sourceId:'fixed_base',tileIds:[],target:'base',operation:'add',before:0,delta:base,after:base,label:'固定基数'}];
  let revealedFans=0,previous=0;
  for(const p of fanList){revealedFans+=p.fan;const after=precise(highFanMultiplier(s.mode,revealedFans));steps.push({event:'pattern_reveal',sourceId:p.id,tileIds:[],target:'multiplier',operation:'set',before:previous,delta:0,after,label:p.name});previous=after;}
  steps.push({event:'multiplier_update',sourceId:'final_multiplier',tileIds:[],target:'multiplier',operation:'set',before:previous,delta:0,after:mult,label:'牌型倍率'},
    {event:'hand_total',sourceId:'hand_total',tileIds:d.tiles.map(t=>t.id),target:'score',operation:'set',before:0,delta:total,after:total,label:noYaku?'无役，0分':'和牌得分'});
  if(noYaku)steps.splice(1,steps.length-1,{event:'no_yaku',sourceId:'no_yaku',tileIds:d.tiles.map(t=>t.id),target:'score',operation:'set',before:0,delta:0,after:0,label:'无役，0分'});
  return {base,fans,yakumanCount,noYaku,patterns:fanList,gains:[],mult,total,decomposition:d,steps,growthRiver:0,growthCoreAfter:0,coinGain:0};
}

function explanationKey(d) { return `${d.shape}/${d.groups.map(g=>g.join('.')).join('/')}/${d.pair.join('.')}/${d.tiles.map(t=>`${t.id}:${t.face}`).sort().join('/')}`; }
export function currentSettlementPreview(s) {
  if (s.phase === 'settlement' && s.last) return s.last;
  if (s.phase !== 'play') return {valid:false,reason:'当前不在组牌阶段'};
  const exhausted=structuralCount(s)<14&&!s.deck.length&&!s.hand.length;
  if (structuralCount(s) !== 14&&!exhausted) return {valid:false,reason:'请先填满 14 个结构位置'};
  try {
    const options = exhausted?[]:decompose(s.formed,s.kongs,s.mode).map(d=>scoreDecomposition(s,d));
    options.sort((a,b)=>b.yakumanCount-a.yakumanCount || b.fans-a.fans || b.total-a.total || explanationKey(a.decomposition).localeCompare(explanationKey(b.decomposition)));
    const legal = options.length > 0, penalty = legal ? 0 : Math.ceil(target(s)*0.1);
    const result = legal ? options[0] : {base:0,fans:0,patterns:[],gains:[],mult:1,total:0,decomposition:null,growthRiver:0,growthCoreAfter:s.growth.coreGrowth,coinGain:0,steps:[
      {event:'hand_reveal',sourceId:'hand',tileIds:s.formed.map(t=>t.id),label:'牌形检查'},
      {event:exhausted?'incomplete':'false_hu',sourceId:exhausted?'incomplete':'false_hu',tileIds:s.formed.map(t=>t.id),target:'score',operation:'add',before:s.totalScore,delta:-penalty,after:s.totalScore-penalty,label:exhausted?'未完成扣分':'诈胡扣分'},
    ]};
    const delta = result.total - penalty, cumulativeAfter = s.totalScore + delta, passed = cumulativeAfter >= target(s);
    if (![result.base,result.mult,result.total,delta,cumulativeAfter].every(Number.isFinite) || !Number.isSafeInteger(cumulativeAfter)) return {valid:false,reason:'结算数值超出支持范围，请重试'};
    const scoreTier = !legal ? 0 : result.total >= target(s)*2 ? 2 : result.total >= target(s) ? 1 : 0;
    const multiplierTier = !legal ? 0 : result.mult >= 20 ? 2 : result.mult >= 8 ? 1 : 0;
    const patternTier = Math.max(0,...result.patterns.map(p=>p.tier));
    result.steps.push({event:'round_result',sourceId:'round_result',tileIds:[],target:'score',operation:'add',before:s.totalScore,delta,after:cumulativeAfter,label:passed?'累计达标':'累计未达标'});
    const passCoins = 0;
    return freeze({ valid:true, legal,resultType:exhausted?'incomplete':legal?(result.noYaku?'no_yaku':'win'):'false_win',handResult:exhausted?'incomplete':legal?(result.noYaku?'no_yaku':'agari'):'false_hu', ...result,
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
  const s = {version:VERSION,rulesVersion:RULES_VERSION,scoreVersion:SCORE_MODEL_VERSION,runId,mode,seed:seed>>>0,rng:seed>>>0,phase:'prepare',round:0,coins:0,relics:[STARTER_RELIC_ID],growth:{river:0,exchange:0,coreGrowth:BALANCE.growthSeed},history:[],totalScore:0,bestHand:0,offers:[...CORE_IDS],shop:[],log:[],roundScores:[],score:0,processScore:0,formedDiscard:null};
  startRound(s);return s;
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
function refreshBatch(s) { s.discard.push(...s.hand);s.hand=[];refill(s); }
function refill(s) { while(s.hand.length<DRAW_BATCH_SIZE&&s.deck.length) s.hand.push(s.deck.pop()); }
export function sortHand(s) { s.hand.sort((a,b)=>a.face-b.face || Number(a.wild)-Number(b.wild) || a.id.localeCompare(b.id));s.selected=[]; }
export function addRelic(s,id,replaceId=null) {
  if(s.phase!=='reward'||replaceId!==null||!relic(id)||has(s,id)||!s.offers.includes(id)||s.relics.length>=BALANCE.relicSlots)return false;
  s.relics.push(id);s.phase='shop';s.shop=[];s.offers=[];return true;
}
export function beginPlay(s){if(s.phase!=='prepare')return false;s.phase='play';return true;}

// Kept as a rejecting API for old callers; V9 has no core selection.
export function chooseStarter() { return false; }
export function commit(s,ids) {
  if(s.phase!=='play')return {valid:false,reason:'请先完成起手准备并开始组牌'};
  if(!validIds(ids,s.hand)) return {valid:false,reason:'请选择有效且不重复的备选牌'};
  const inspection=inspect(s,ids);if(!inspection.valid)return inspection;
  const tiles=pick(s.hand,ids),processGain=0;
    for(const t of tiles)t.entered=true;
  const used=new Set(ids);s.hand=s.hand.filter(t=>!used.has(t.id));s.formed.push(...tiles);
  s.batches.push({id:`${s.roundId}:batch:${s.batches.length}`,tileIds:[...ids],kind:'play',processGain});
  s.log.unshift({step:s.batches.length,score:processGain,names:[],label:`放入 ${ids.length} 张`});
  refreshBatch(s);sortHand(s);
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
  if(incoming.length)refreshBatch(s);sortHand(s);return {ok:true,kongId:id};
}
function redraw(s,ids){const used=new Set(ids);s.discard.push(...s.hand.filter(t=>used.has(t.id)));s.hand=s.hand.filter(t=>!used.has(t.id));for(let i=0;i<ids.length;i++)s.hand.push(s.deck.pop());sortHand(s);}
export function exchange(s,ids) {
  if(!['prepare','play'].includes(s.phase)||s.swaps<1||s.phase==='play'&&structuralCount(s)>=14||!validIds(ids,s.hand,1,BALANCE.openingExchangeSize)||s.deck.length<ids.length)return false;
  redraw(s,ids);s.swaps--;s.openingSwapsUsed++;return true;
}
export function replaceFormed(){return {ok:false,reason:'本版本不支持替换成型牌'};}
export function discardFormed(s,ids) {
  if(s.phase!=='play')return {ok:false,reason:'成型弃除只在组牌阶段、结算前开放'};
  if(s.formedDiscard!==null)return {ok:false,reason:'本趟旅程的成型弃除已使用'};
  if(!validIds(ids,s.formed,1,2))return {ok:false,reason:'请选择一到两张成型区的牌'};
  const locked=lockedIds(s);if(ids.some(id=>locked.has(id)))return {ok:false,reason:'已声明杠内的牌不能弃除'};
  const removed=pick(s.formed,ids),used=new Set(ids);
  s.formed=s.formed.filter(t=>!used.has(t.id));s.discard.push(...removed);
  s.formedDiscard={round:s.round,tileIds:[...ids]};s.selected=[];
  s.batches.push({id:`${s.roundId}:batch:${s.batches.length}`,tileIds:[...ids],kind:'discard',processGain:0});
  s.log.unshift({step:s.batches.length,score:0,names:[],label:`弃除成型牌 ${ids.length} 张`});
  return {ok:true,count:ids.length,tileIds:[...ids]};
}
export function highRescue(s,request={}){
  if(!['prepare','play'].includes(s.phase)||s.rescueUsed||!has(s,'high_rescue'))return {ok:false,reason:'补缺需补缺符，且本关未使用'};
  const {type,ids,arg}=request;
  if(type==='exchange'){
    if(s.phase!=='play'||structuralCount(s)>=14)return {ok:false,reason:'补缺弃换仅在组牌阶段、成型区未满14时开放'};
    if(!validIds(ids,s.hand,1,BALANCE.highRescueSize)||s.deck.length<ids.length)return {ok:false,reason:`请选择1～${BALANCE.highRescueSize}张候选牌`};
    redraw(s,ids);s.rescueUsed=true;return {ok:true,type,count:ids.length};
  }
  if(!['rank','suit'].includes(type))return {ok:false,reason:'补缺仅支持弃换、点数±1或换花色'};
  if(s.phase!=='prepare')return {ok:false,reason:'补缺改牌只在准备阶段开放'};
  const result=applyTransform(s,ids,type,arg,true);if(result.ok)s.rescueUsed=true;return result;
}

export function transform(s,ids,action,arg){if(s.phase!=='prepare')return {ok:false,reason:'改牌只在准备阶段开放'};return applyTransform(s,ids,action,arg,false);}
function applyTransform(s,ids,action,arg,rescue=false) {
  if(!validIds(ids,available(s),1,1))return {ok:false,reason:'请选择一张候选数牌'};
  if(lockedIds(s).has(ids[0]))return {ok:false,reason:'杠内牌已经锁定，不能改写'};
  const t=available(s).find(t=>t.id===ids[0]);
  if(t.face>=27)return {ok:false,reason:'字牌不能改点数、改花色或变为万能牌'};
  const required={rank:'rank_brush',suit:'suit_ribbon',wild:'wild_jade'}[action];
  if(!required||!rescue&&!has(s,required))return {ok:false,reason:required?`需要持有${relic(required).name}`:'不支持这种改牌方式'};
  const cost=BALANCE.editCost;
  if(!Number.isInteger(s.ink)||s.ink<0||s.ink>BALANCE.ink||s.ink%cost!==0)return {ok:false,reason:'改牌额度无效，请重新开始旅程'};
  if(s.ink<cost)return {ok:false,reason:'本关改牌次数已用完；点数、花色和万能牌共用一次'};
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
  return shuffle(s,RELICS.filter(r=>!has(s,r.id)).map(r=>r.id)).slice(0,n);
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
    if(!s||s.version!==VERSION||s.rulesVersion!==RULES_VERSION||s.scoreVersion!==SCORE_MODEL_VERSION||!MODES[s.mode]||!['prepare','play','settlement','reward','shop','defeat','victory'].includes(s.phase)||typeof s.runId!=='string')return null;
    if(!Array.isArray(s.relics)||s.relics.length>BALANCE.relicSlots||s.relics.some(x=>!relic(x)||DISABLED_RELIC_IDS.includes(x))||new Set(s.relics).size!==s.relics.length||!s.relics.includes(STARTER_RELIC_ID)||!integer(s.round)||s.round>5||!integer(s.coins)||!integer(s.rng)||!signed(s.totalScore)||!integer(s.bestHand))return null;
    if(s.formedDiscard!==null){
      const record=s.formedDiscard,prefix=`${s.runId}:round:${record?.round}:tile:`;
      if(!record||!integer(record.round)||record.round>s.round||!Array.isArray(record.tileIds)||record.tileIds.length<1||record.tileIds.length>2||new Set(record.tileIds).size!==record.tileIds.length||record.tileIds.some(id=>typeof id!=='string'||!id.startsWith(prefix)||!/^(0|[1-9]\d{0,2})$/.test(id.slice(prefix.length))||Number(id.slice(prefix.length))>=136)||s.phase==='starter'||s.phase==='prepare'&&record.round===s.round)return null;
    }
    if(!s.growth||!integer(s.growth.river)||!integer(s.growth.exchange)||!Number.isFinite(s.growth.coreGrowth)||s.growth.coreGrowth<0||s.growth.coreGrowth>Number.MAX_SAFE_INTEGER||!Array.isArray(s.offers)||new Set(s.offers).size!==s.offers.length||s.offers.some(x=>!relic(x)||DISABLED_RELIC_IDS.includes(x)||has(s,x))||!Array.isArray(s.shop)||s.shop.length||!Array.isArray(s.roundScores)||!s.roundScores.every(signed)||!Array.isArray(s.history))return null;
    if(s.phase==='starter'&&(s.relics.length||s.offers.length!==CORE_IDS.length||s.offers.some(x=>!CORE_IDS.includes(x))))return null;
    if(s.phase!=='starter'&&(s.offers.length>3||s.offers.some(x=>CORE_IDS.includes(x))))return null;
    if(s.phase!=='starter'){
      if(s.roundId!==`${s.runId}:round:${s.round}`||s.settlementId!==`${s.roundId}:settlement`||s.roundTarget!==TARGETS[s.mode][s.round]||!signed(s.roundStartScore)||!signed(s.score)||s.processScore!==0||!integer(s.swaps)||s.swaps>BALANCE.openingExchanges||!integer(s.openingSwapsUsed)||s.openingSwapsUsed>BALANCE.openingExchanges||typeof s.rescueUsed!=='boolean'||!integer(s.ink)||s.ink>BALANCE.ink||s.ink%BALANCE.editCost!==0||s.singleCount!==0||!integer(s.wildUsed)||s.wildUsed>1||!Array.isArray(s.log)||!Array.isArray(s.batches))return null;
      if(['prepare','play','settlement'].includes(s.phase)&&s.rescueUsed&&!has(s,'high_rescue'))return null;
      const tile=t=>t&&typeof t.id==='string'&&integer(t.original)&&t.original<34&&integer(t.face)&&t.face<34&&typeof t.wild==='boolean'&&(!t.wild||t.face<27)&&typeof t.entered==='boolean';
      if(!['hand','formed','deck','discard'].every(key=>Array.isArray(s[key])&&s[key].every(tile))||s.hand.length>DRAW_BATCH_SIZE||!Array.isArray(s.kongs)||s.kongs.length>4)return null;
      const all=[...s.hand,...s.formed,...s.deck,...s.discard];
      if(s.wildUsed&&!has(s,'wild_jade'))return null;
      if(all.length!==136||new Set(all.map(t=>t.id)).size!==136||all.filter(t=>t.wild).length>s.wildUsed||Array.from({length:34},(_,face)=>all.filter(t=>t.original===face).length).some(n=>n!==4))return null;
      const formedDiscards=s.discard.filter(t=>t.entered),recordedIds=s.formedDiscard?.round===s.round?s.formedDiscard.tileIds:[];
      if(formedDiscards.length!==recordedIds.length||recordedIds.some(id=>!formedDiscards.some(t=>t.id===id)))return null;
      const editedTiles=all.filter(t=>t.face!==t.original||t.wild).length;
      if(editedTiles!==(BALANCE.ink-s.ink)/BALANCE.editCost)return null;
      if(all.some(t=>!t.id.startsWith(`${s.roundId}:tile:`))||s.formed.some(t=>!t.entered))return null;
      const kongIds=new Set();
      for(const k of s.kongs){
        if(!k||typeof k.id!=='string'||!integer(k.face)||k.face>=34||!validIds(k.tileIds,s.formed,4,4)||k.tileIds.some(id=>kongIds.has(id)))return null;
        for(const id of k.tileIds){kongIds.add(id);if(s.formed.find(t=>t.id===id).face!==k.face)return null;}
      }
      if(structuralCount(s)>14||s.totalScore!==s.roundStartScore+s.score)return null;
      if(s.swaps+s.openingSwapsUsed!==BALANCE.openingExchanges)return null;
      if(s.phase==='prepare'&&(s.formed.length||s.kongs.length||s.batches.length||s.processScore||s.last||s.rescueUsed&&(s.ink!==0||s.wildUsed!==0)))return null;
      if(s.last){
        if(s.last.settlementId!==s.settlementId||!s.last.valid||typeof s.last.legal!=='boolean'||typeof s.last.passed!=='boolean'||!signed(s.last.cumulativeAfter)||s.last.cumulativeAfter!==s.totalScore||s.last.roundScore!==s.score||s.last.passed!==(s.last.cumulativeAfter>=s.roundTarget)||!Array.isArray(s.last.steps)||!Array.isArray(s.last.patterns)||!Array.isArray(s.last.gains)||!s.last.tiers)return null;
        if((structuralCount(s)!==14&&!(s.last.handResult==='incomplete'&&!s.deck.length&&!s.hand.length))||s.last.target!==s.roundTarget||s.last.cumulativeBefore+s.last.delta!==s.last.cumulativeAfter||s.last.total-s.last.penalty!==s.last.delta)return null;
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
