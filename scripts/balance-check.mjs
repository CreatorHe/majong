import {pathToFileURL} from 'node:url';
import * as E from '../dist/engine.js';

// A visible-information, greedy policy for smoke testing the V2 loop. It knows only
// held/formed tiles and resource counts, never the order or faces in the wall.
// The policy builds ordinary hands; it does not optimize seven pairs or relic builds.
const starterIds = ['jade','single_seal','rank_brush'];
const priority = ['reserve','river','stone','growth','echo','ink','wind','kong_cauldron','single_seal','rank_brush','suit_ribbon','wild_jade','jade','bamboo','mirror','seal','coin','mountain','jiang','pair','wheel'];
const own = (s,id) => s.relics.includes(id);
const faceOptions = tile => tile.wild ? [0,9,18].map(n=>n+E.rank(tile)-1) : [tile.face];

function chooseTiles(s,faces) {
  const used=new Set(),ids=[];
  // Reserve fixed-face copies first so a wildcard isn't wasted on an available copy.
  for(const face of faces){
    const tile=s.hand.find(t=>!used.has(t.id)&&!t.wild&&t.face===face) || s.hand.find(t=>!used.has(t.id)&&faceOptions(t).includes(face));
    if(!tile)return null;used.add(tile.id);ids.push(tile.id);
  }
  return ids;
}
function utility(s,faces,kind) {
  const suit=E.suit(faces[0]),formed=s.formed.map(E.faceValue),sameSuit=formed.filter(t=>E.suit(t)===suit).length;
  const different=formed.some(t=>t<27&&E.suit(t)!==suit);
  let score=faces.length*3 + sameSuit*2 - (different?4:0);
  if(suit<3)score+=2;
  if(kind==='chow'&&own(s,'river'))score+=12;
  if(['pung','kong'].includes(kind)){if(own(s,'stone'))score+=40;if(own(s,'mountain'))score+=16;}
  if(kind==='kong'&&own(s,'kong_cauldron'))score+=40;
  if(own(s,['seal','mirror','bamboo'][suit]))score+=24;
  if(own(s,'jiang')&&faces.every(t=>t<27&&[2,5,8].includes(E.rank(t))))score+=18;
  if(faces.every(t=>t<27&&E.rank(t)>1&&E.rank(t)<9))score+=5;
  return score;
}
function candidates(s,context) {
  const out=[];
  const add=(faces,kind)=>{const ids=chooseTiles(s,faces);if(ids)out.push({ids,kind,utility:utility(s,faces,kind)});};
  if(context.melds<4){
    for(let face=0;face<34;face++){
      add([face,face,face],'pung');add([face,face,face,face],'kong');
      if(face<27&&E.rank(face)<=7)add([face,face+1,face+2],'chow');
    }
  }
  if(!context.pair)for(let face=0;face<34;face++)add([face,face],'pair');
  return out.sort((a,b)=>b.utility-a.utility||a.kind.localeCompare(b.kind)||a.ids.join(',').localeCompare(b.ids.join(',')));
}
function playCandidate(s,context,candidate) {
  if(candidate.kind==='kong') {
    if(!E.declareKong(s,candidate.ids).ok)throw Error('The policy proposed an invalid kong');
  } else {
    // Single-seal hands deliberately claim the limited first-entry reward.
    const batches=own(s,'single_seal')?candidate.ids.map(id=>[id]):[candidate.ids];
    for(const ids of batches)if(!E.commit(s,ids).valid)throw Error('The policy proposed an invalid play');
  }
  if(candidate.kind==='pair')context.pair=true;else context.melds++;
}
function exchangeChoice(s,context) {
  const counts=new Map();for(const t of s.hand)counts.set(t.face,(counts.get(t.face)||0)+1);
  return s.hand.map(t=>{
    const near=t.face<27?[-2,-1,1,2].reduce((n,d)=>n+(E.suit(t.face+d)===E.suit(t)&&counts.has(t.face+d)?2:0),0):0;
    const pair=counts.get(t.face)>=2?context.pair?3:8:0;
    return {id:t.id,keep:pair+near+(t.wild?30:0)+utility(s,[t.face],'single')/8};
  }).sort((a,b)=>a.keep-b.keep||a.id.localeCompare(b.id)).slice(0,Math.min(5,s.deck.length)).map(t=>t.id);
}
function tryImmediateModifier(s,context) {
  let best=null;
  for(const tile of s.hand){
    const actions=[];
    if(own(s,'rank_brush'))for(const delta of [-1,1])actions.push(['rank',delta]);
    if(own(s,'suit_ribbon'))for(const suit of [0,1,2])actions.push(['suit',suit]);
    if(own(s,'wild_jade'))actions.push(['wild']);
    for(const [action,arg] of actions){
      const trial=structuredClone(s);if(!E.transform(trial,[tile.id],action,arg).ok)continue;
      const pick=candidates(trial,context)[0];if(pick&&(!best||pick.utility>best.utility))best={tileId:tile.id,action,arg,utility:pick.utility};
    }
  }
  return best?E.transform(s,[best.tileId],best.action,best.arg).ok:false;
}
function finishWithoutRepair(s) {
  const count=14-E.structuralCount(s),ids=s.hand.slice(0,count).map(t=>t.id);
  if(ids.length!==count){E.retire(s);return;}
  if(count&&!E.commit(s,ids).valid)throw Error('Could not fill the remaining structural positions');
  const result=E.settle(s);if(!result.valid)throw Error(result.reason);
}

export function simulate(mode='mcr',seed=1,starter='jade') {
  if(!starterIds.includes(starter))throw Error(`Unsupported starter: ${starter}`);
  const s=E.newRun(mode,seed);E.chooseStarter(s,starter);
  let context={round:s.round,melds:0,pair:false};
  for(let step=0;step<300&&s.phase!=='defeat'&&s.phase!=='victory';step++){
    if(s.phase==='play'){
      if(context.round!==s.round)context={round:s.round,melds:0,pair:false};
      if(E.structuralCount(s)===14){const result=E.settle(s);if(!result.valid)throw Error(result.reason);continue;}
      const candidate=candidates(s,context)[0];if(candidate){playCandidate(s,context,candidate);continue;}
      if(s.ink>0&&tryImmediateModifier(s,context))continue;
      const discard=exchangeChoice(s,context);if(discard.length&&E.exchange(s,discard))continue;
      finishWithoutRepair(s);
    }else if(s.phase==='settlement')E.finishSettlement(s);
    else if(s.phase==='reward')E.chooseReward(s,[...s.offers].sort((a,b)=>priority.indexOf(a)-priority.indexOf(b))[0]);
    else if(s.phase==='shop'){
      for(const id of [...s.shop].sort((a,b)=>priority.indexOf(a)-priority.indexOf(b)))E.buy(s,id);
      E.nextRound(s);
    }
  }
  if(!['victory','defeat'].includes(s.phase))throw Error(`Simulation stalled at ${s.phase}, round ${s.round+1}`);
  if(!E.restore(JSON.stringify(s)))throw Error('Simulation produced a non-restorable save');
  return s;
}

export function summarize(mode,starter,samples=100) {
  const clearedDistribution=Array(7).fill(0);let firstLegal=0,firstPassed=0,firstMin=Infinity,firstMax=-Infinity,passesAfterFalseHu=0,best=null;
  const firstScores=[];
  for(let seed=1;seed<=samples;seed++){
    const s=simulate(mode,seed,starter),cleared=s.history.filter(h=>h.passed).length,first=s.history[0];
    clearedDistribution[cleared]++;if(first?.legal)firstLegal++;if(first?.passed)firstPassed++;
    if(first){firstMin=Math.min(firstMin,first.cumulativeScore);firstMax=Math.max(firstMax,first.cumulativeScore);firstScores.push(first.cumulativeScore);}
    passesAfterFalseHu+=s.history.filter(h=>!h.legal&&h.passed).length;
    if(!best||cleared>best.cleared)best={seed,cleared,roundNetScores:s.roundScores,cumulative:s.totalScore};
  }
  firstScores.sort((a,b)=>a-b);
  return {mode,starter,samples,firstTarget:E.TARGETS[mode][0],firstLegal,firstPassed,firstScore:{min:firstMin,median:firstScores[Math.floor(firstScores.length/2)],max:firstMax},clearedDistribution,passesAfterFalseHu,best};
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  const samples=Number(process.argv[2]||100);
  if(!Number.isInteger(samples)||samples<1||samples>1000)throw Error('Usage: node scripts/balance-check.mjs [sample count 1..1000]');
  console.log(JSON.stringify({rulesVersion:E.RULES_VERSION,scoreModel:E.SCORE_MODEL_VERSION,policy:'visible-hand greedy ordinary-hand policy; no wall lookahead; not a player win-rate estimate',targets:E.TARGETS}));
  for(const mode of ['mcr','riichi'])for(const starter of starterIds)console.log(JSON.stringify(summarize(mode,starter,samples)));
}
