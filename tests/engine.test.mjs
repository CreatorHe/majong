import test from 'node:test';
import assert from 'node:assert/strict';
import * as E from '../dist/engine.js';
import {highFanMultiplier,DISABLED_RELIC_IDS,COMPATIBLE_RELICS,FIRST_COMPATIBLE} from '../dist/balance.js';
import {decompose,canCompleteByAdding} from '../dist/hand-rules.js';

const names=ps=>ps.map(p=>p.name);
const preparing=(mode='mcr',seed=7,core='core_high',extras=[])=>{const s=E.newRun(mode,seed);assert.ok(E.chooseStarter(s,core));s.relics.push(...extras);return s;};
const playing=(mode='mcr',seed=7,core='core_high',extras=[])=>{const s=preparing(mode,seed,core,extras);assert.ok(E.beginPlay(s));return s;};
const flush=[0,1,2,3,4,5,6,7,8,1,2,3,4,4];
const invalid=[0,1,2,3,4,5,15,16,17,27,27,28,29,30];
const pungs=[1,1,1,4,4,4,16,16,16,20,20,20,14,14];
function arrange(s,faces,zone='formed') {
 const all=[...s.hand,...s.formed,...s.deck,...s.discard],chosen=[];
 for(const face of faces){const index=all.findIndex(t=>t.face===face);assert.ok(index>=0,`physical copy ${face}`);chosen.push(all.splice(index,1)[0]);}
 s.formed=[];s.hand=[];s.discard=[];s.kongs=[];
 for(const t of chosen)t.entered=zone==='formed';s[zone]=chosen;s.deck=all;
 while(s.hand.length<E.DRAW_BATCH_SIZE&&s.deck.length)s.hand.push(s.deck.pop());E.sortHand(s);return s;
}
function final(mode='mcr',faces=flush,core='core_high',extras=[]){return arrange(playing(mode,7,core,extras),faces);}
function bring(s,faces){const ids=[];for(const face of faces){let t=s.hand.find(t=>t.face===face&&!ids.includes(t.id));if(!t){const i=s.deck.findIndex(t=>t.face===face);assert.ok(i>=0);t=s.deck.splice(i,1)[0];const oldAt=s.hand.findIndex(x=>!ids.includes(x.id)),old=s.hand.splice(oldAt,1)[0];if(old)s.deck.push(old);s.hand.push(t);}ids.push(t.id);}return ids;}
function structuralEntities(s){const all=[...s.hand,...s.formed,...s.deck,...s.discard];assert.equal(all.length,136);assert.equal(new Set(all.map(t=>t.id)).size,136);for(let face=0;face<34;face++)assert.equal(all.filter(t=>t.original===face).length,4);}
function rewardState(core='core_high',extras=[]){const s=final('mcr',flush,core,extras);s.roundTarget=1;E.settle(s);E.finishSettlement(s);assert.equal(s.phase,'reward');return s;}

test('V5 offers four mutually exclusive starter cores and requires explicit start',()=>{
 for(const core of E.CORE_IDS){const s=E.newRun();assert.deepEqual(s.offers,E.CORE_IDS);assert.equal(E.chooseStarter(s,'jade'),false);assert.ok(E.chooseStarter(s,core));assert.equal(s.phase,'prepare');assert.deepEqual(s.relics,[core]);assert.ok(E.restore(JSON.stringify(s)));
  const before=JSON.stringify(s);assert.equal(E.commit(s,[s.hand[0].id]).valid,false);assert.equal(E.declareKong(s,s.hand.slice(0,4).map(t=>t.id)).ok,false);assert.equal(E.settle(s).valid,false);assert.equal(E.addRelic(s,'jade'),false);assert.equal(JSON.stringify(s),before);
  assert.ok(E.beginPlay(s));assert.equal(s.phase,'play');assert.equal(s.swaps,0);assert.equal(E.beginPlay(s),false);assert.ok(E.restore(JSON.stringify(s)));
 }
});
test('five preparation exchanges of at most five preserve physical supply and cap baseline exposure at 51',()=>{
 for(const mode of ['mcr','riichi']){const s=preparing(mode),seen=new Set(s.hand.map(t=>t.id));assert.equal(s.deck.length,124);
  const before=JSON.stringify(s);assert.equal(E.exchange(s,s.hand.slice(0,6).map(t=>t.id)),false);assert.equal(JSON.stringify(s),before);
  for(let i=0;i<5;i++){assert.ok(E.exchange(s,s.hand.slice(0,5).map(t=>t.id)));s.hand.forEach(t=>seen.add(t.id));assert.ok(E.restore(JSON.stringify(s)));}
  assert.equal(s.openingSwapsUsed,5);assert.equal(seen.size,37);assert.equal(E.exchange(s,[s.hand[0].id]),false);assert.ok(E.beginPlay(s));
  for(let i=0;i<14;i++){const kept=s.hand.slice(1).map(t=>t.id);assert.ok(E.commit(s,[s.hand[0].id]).valid);assert.ok(kept.every(id=>s.hand.some(t=>t.id===id)));s.hand.forEach(t=>seen.add(t.id));}
  assert.equal(seen.size,51);assert.equal(s.discard.length,25);assert.equal(s.deck.length,85);assert.equal(s.hand.length,12);assert.equal(E.structuralCount(s),14);assert.ok(E.restore(JSON.stringify(s)));structuralEntities(s);
 }
});
test('starting play permanently closes ordinary redraw, changes and formed replacement',()=>{
 const s=preparing('mcr',7,'core_pung',['rank_brush']);const id=bring(s,[1])[0];assert.ok(E.transform(s,[id],'rank',1).ok);assert.equal(s.ink,3);assert.ok(E.beginPlay(s));assert.ok(E.commit(s,[id]).valid);
 const before=JSON.stringify(s);assert.equal(E.exchange(s,[s.hand[0].id]),false);assert.equal(E.transform(s,[id],'rank',-1).ok,false);assert.equal(E.replaceFormed(s,[id],[s.hand[0].id]).ok,false);assert.equal(E.addRelic(s,'jade'),false);assert.equal(JSON.stringify(s),before);
});
test('preparation transforms retain physical identity and enforce ownership, ink and one wildcard',()=>{
 const s=arrange(preparing('mcr'),[0,0,0,0,1],'hand'),id=s.hand.find(t=>t.face===1).id;
 assert.equal(E.transform(s,[id],'rank',-1).ok,false);s.relics.push('rank_brush','suit_ribbon','wild_jade');assert.ok(E.transform(s,[id],'rank',-1).ok);assert.equal(s.hand.filter(t=>t.face===0).length,5);assert.equal(s.hand.find(t=>t.id===id).original,1);
 assert.equal(E.transform(s,[id],'rank',-1).ok,false);assert.ok(E.transform(s,[id],'wild').ok);assert.equal(s.ink,1);assert.equal(E.transform(s,[id],'wild').ok,false);assert.ok(E.transform(s,[id],'suit',1).ok);assert.equal(s.ink,0);assert.equal(s.hand.find(t=>t.id===id).wild,false);assert.equal(s.wildUsed,1);structuralEntities(s);assert.ok(E.restore(JSON.stringify(s)));
});
test('high rescue has one shared use, requires both relics and cannot create a wildcard',()=>{
 const s=preparing('mcr',7,'core_high',['high_rescue']);const id=bring(s,[1])[0];assert.equal(E.highRescue(s,{type:'rank',ids:[id],arg:1}).ok,false);E.beginPlay(s);E.commit(s,[id]);
 const before=JSON.stringify(s);assert.equal(E.highRescue(s,{type:'wild',ids:[id]}).ok,false);assert.equal(E.highRescue(s,{type:'rank',ids:[id],arg:9}).ok,false);assert.equal(JSON.stringify(s),before);
 assert.ok(E.highRescue(s,{type:'rank',ids:[id],arg:1}).ok);assert.equal(s.ink,3);assert.equal(s.formed.find(t=>t.id===id).face,2);assert.equal(s.rescueUsed,true);assert.equal(E.highRescue(s,{type:'exchange',ids:[s.hand[0].id]}).ok,false);assert.ok(E.restore(JSON.stringify(s)));
 const r=playing('mcr',7,'core_high',['high_rescue']),wall=r.deck.length;assert.ok(E.highRescue(r,{type:'exchange',ids:r.hand.slice(0,3).map(t=>t.id)}).ok);assert.equal(r.deck.length,wall-3);assert.equal(r.ink,4);assert.equal(E.highRescue(r,{type:'suit',ids:[r.hand[0].id],arg:0}).ok,false);structuralEntities(r);
 for(const core of ['core_pung','core_high']){const t=playing('mcr',7,core,core==='core_pung'?['high_rescue']:[]);assert.equal(E.highRescue(t,{type:'exchange',ids:[t.hand[0].id]}).ok,false);}
 const full=final('mcr',flush,'core_high',['high_rescue']);assert.equal(E.highRescue(full,{type:'exchange',ids:[full.hand[0].id]}).ok,false);
});
test('single payments stop at four and never get multiplied into hand score',()=>{
 const s=playing('mcr',3,'core_pung',['single_seal']);for(let i=0;i<5;i++)assert.ok(E.commit(s,[s.hand[0].id]).valid);assert.equal(s.singleCount,4);assert.equal(s.processScore,80);assert.equal(s.totalScore,80);
 const t=final();t.processScore=80;t.score=80;t.totalScore=80;const p=E.currentSettlementPreview(t);assert.equal(p.cumulativeAfter,80+p.total);assert.equal(p.roundScore,80+p.total);
});
test('invalid selection and overflow have no side effects',()=>{
 const s=playing(),id=s.hand[0].id,before=JSON.stringify(s);assert.equal(E.commit(s,[id,id]).valid,false);assert.equal(E.commit(s,['missing']).valid,false);assert.equal(JSON.stringify(s),before);
 const full=final(),raw=JSON.stringify(full);assert.equal(E.commit(full,[full.hand[0].id]).valid,false);assert.equal(JSON.stringify(full),raw);
});
test('kong consumes four physical tiles as three structural positions and locks its identity',()=>{
 const s=final('mcr',[0,0,0,10,11,12,22,23,24,33,33,33,27,27],'core_pung',['stone','kong_cauldron']);const incoming=bring(s,[0])[0],wall=s.deck.length,ids=[...s.formed.filter(t=>t.face===0).map(t=>t.id),incoming];assert.ok(E.declareKong(s,ids).ok);assert.equal(s.formed.length,15);assert.equal(E.structuralCount(s),14);assert.equal(s.deck.length,wall-1);const p=E.currentSettlementPreview(s);assert.ok(p.legal);assert.equal(p.gains.find(g=>g.id==='kong_cauldron').value,60);assert.equal(p.coinGain,2);assert.equal(E.declareKong(s,ids).ok,false);structuralEntities(s);assert.ok(E.restore(JSON.stringify(s)));
});
test('wildcard assignment is rank-fixed and locked inside a declared kong',()=>{
 const s=preparing('mcr',5,'core_high',['wild_jade']),ids=bring(s,[0,0,0,9]);assert.ok(E.transform(s,[ids[3]],'wild').ok);E.beginPlay(s);assert.ok(E.declareKong(s,ids).ok);assert.equal(s.kongs[0].face,0);assert.equal(s.formed.find(t=>t.id===ids[3]).face,0);assert.ok(E.restore(JSON.stringify(s)));
});
test('risk allows dangerous commitments without calling temporary incompleteness impossible',()=>{
 const s=arrange(playing(),[0,1,2,3,4,5,15,16,17,27,27,28]);assert.equal(E.inspect(s).canComplete,true);const west=bring(s,[29]);assert.equal(E.inspect(s,west).risk,'needs_repair');assert.equal(E.commit(s,west).valid,true);
 const pairs=arrange(playing(),[0,0,2,2,4,4,6,6,8,8,10,10,21]);assert.ok(E.inspect(pairs).canComplete);
});
test('ordinary hand multiplier is linear; exponential threshold belongs only to high core',()=>{
 assert.equal(E.fanMultiplier('mcr',88),12);assert.equal(E.fanMultiplier('riichi',13),14);assert.equal(highFanMultiplier('mcr',88),2048);assert.equal(highFanMultiplier('riichi',26),4096);assert.equal(highFanMultiplier('riichi',39),6144);
 const a=final('mcr',pungs,'core_pung'),b=structuredClone(a);b.relics=['core_high'];const p=E.currentSettlementPreview(a),q=E.currentSettlementPreview(b);assert.equal(p.fans,8);assert.equal(p.mult,122.9312);assert.equal(q.mult,12);assert.ok(q.gains.some(g=>g.id==='core_high'));
});
test('retriggered pung events repeat base and multiplier but do not repeat coins',()=>{
 const s=final('mcr',pungs,'core_pung',['stone','retrigger_meld']),p=E.currentSettlementPreview(s);assert.ok(p.legal);assert.equal(p.base,720);assert.equal(p.mult,7556.039966);assert.equal(p.total,5440348);assert.equal(p.coinGain,4);assert.equal(p.gains.filter(g=>g.id==='stone').length,8);assert.equal(p.gains.filter(g=>g.id==='core_pung').length,8);assert.equal(p.gains.find(g=>g.id==='retrigger_meld').value,4);
});
test('held terminal events include the final refill and freeze stable tile IDs',()=>{
 const s=final('mcr',flush,'core_held',['retrigger_held']);const faces=[0,8,2,3,5,6,10,11,12,13,14,15];bring(s,faces);E.sortHand(s);const before=JSON.stringify(s),p=E.currentSettlementPreview(s);assert.equal(JSON.stringify(s),before);assert.deepEqual(p.heldTiles,s.hand);assert.ok(Object.isFrozen(p.heldTiles));assert.equal(p.gains.filter(g=>g.id==='core_held').length,4);
 const ids=new Set(p.heldTiles.map(t=>t.id));assert.ok(p.steps.filter(t=>t.relicId==='core_held').every(t=>t.tileIds.every(id=>ids.has(id))));const raw=JSON.stringify(p.heldTiles);E.settle(s);assert.equal(JSON.stringify(s.last.heldTiles),raw);assert.ok(E.restore(JSON.stringify(s)));
});
test('held burst tiers count physical tiles once, repeat their tier and ignore candidate display order',()=>{
 const terminals=[0,8,9,17,18,26,27,28,29,30,31,32],fillers=[2,3,5];
 for(const h of [9,10,12])for(const repeated of [false,true]){const s=final('mcr',pungs,'core_held',repeated?['retrigger_held']:[]);bring(s,[...terminals.slice(0,h),...fillers.slice(0,12-h)]);const p=E.currentSettlementPreview(s),events=p.steps.filter(step=>step.relicId==='core_held'),times=repeated?2:1;
  assert.equal(events.length,h*times);assert.equal(events.filter(step=>step.heldTier==='burst').length,Math.max(0,h-9)*times);
  assert.deepEqual(events.map(step=>step.heldOrdinal),Array.from({length:h},(_,i)=>Array(times).fill(i+1)).flat());
  for(const event of events){assert.equal(event.delta,event.heldOrdinal<=9?1.22:2);assert.equal(event.label.includes('爆发档'),event.heldOrdinal>9);}
  const reversed=structuredClone(s);reversed.hand.reverse();const q=E.currentSettlementPreview(reversed);assert.equal(q.total,p.total);assert.equal(q.mult,p.mult);assert.deepEqual(q.steps.filter(step=>step.relicId==='core_held'),events);
 }
});
test('growth previews do not mutate and final stored growth is added once and paid once',()=>{
 const s=final('mcr',flush,'core_growth',['retrigger_meld']),before=JSON.stringify(s),p=E.currentSettlementPreview(s);assert.equal(JSON.stringify(s),before);assert.equal(p.growthCoreAfter,702.290655);assert.equal(p.base,942);assert.equal(p.gains.filter(g=>g.id==='core_growth').length,1);
 E.settle(s);assert.equal(s.growth.coreGrowth,p.growthCoreAfter);const paid=JSON.stringify(s);assert.deepEqual(E.settle(s),p);assert.equal(JSON.stringify(s),paid);const restored=E.restore(JSON.stringify(s));assert.ok(restored);const raw=JSON.stringify(restored);E.settle(restored);assert.equal(JSON.stringify(restored),raw);
 E.finishSettlement(s);E.skipReward(s);E.nextRound(s);assert.equal(s.growth.coreGrowth,p.growthCoreAfter);assert.equal(s.phase,'prepare');assert.equal(s.swaps,5);
});
test('false win applies 10 percent penalty and passes on accumulated overflow without growth or event rewards',()=>{
 const s=final('mcr',invalid,'core_growth',['river','stone']);s.roundTarget=1000;s.roundStartScore=1100;s.totalScore=1100;const growth=structuredClone(s.growth),coins=s.coins,p=E.currentSettlementPreview(s);assert.equal(p.legal,false);assert.equal(p.penalty,100);assert.equal(p.cumulativeAfter,1000);assert.equal(p.passed,true);E.settle(s);assert.deepEqual(s.growth,growth);assert.equal(s.coins,coins+p.rewardCoins);assert.equal(s.score,-100);assert.ok(E.restore(JSON.stringify(s)));E.finishSettlement(s);assert.equal(s.phase,'reward');
 const below=final('mcr',invalid);below.roundTarget=1000;below.roundStartScore=1099;below.totalScore=1099;E.settle(below);E.finishSettlement(below);assert.equal(below.phase,'defeat');
});
test('one compatible reward per clear, four slots and explicit noncore replacement prevent extra acquisition',()=>{
 for(const core of E.CORE_IDS){const s=rewardState(core);assert.equal(s.offers.length,3);assert.ok(s.offers.includes(FIRST_COMPATIBLE[core]));assert.ok(s.offers.every(id=>!E.CORE_IDS.includes(id)&&!DISABLED_RELIC_IDS.includes(id)));assert.ok(E.chooseReward(s,FIRST_COMPATIBLE[core]));assert.equal(s.relics.length,2);assert.equal(E.chooseReward(s,s.offers[0]),false);assert.deepEqual(s.shop,[]);const before=JSON.stringify(s);assert.equal(E.buy(s,'jade'),false);assert.equal(E.refreshShop(s),false);assert.equal(E.sell(s,core),false);assert.equal(JSON.stringify(s),before);assert.ok(E.nextRound(s));assert.ok(E.restore(JSON.stringify(s)));}
 for(const core of E.CORE_IDS)for(let seed=0;seed<12;seed++){const s=final('mcr',flush,core);s.rng=seed;s.roundTarget=1;E.settle(s);assert.ok(core==='core_high'||!s.offers.includes('high_rescue'));assert.ok(core==='core_held'||!s.offers.includes('retrigger_held'));}
 const full=rewardState('core_pung',['jade','stone','rank_brush']),id=full.offers[0];assert.equal(E.chooseReward(full,id),false);assert.equal(E.chooseReward(full,id,'core_pung'),false);assert.ok(E.chooseReward(full,id,'rank_brush'));assert.equal(full.relics.length,4);assert.ok(E.restore(JSON.stringify(full)));
 const skip=rewardState();assert.ok(E.skipReward(skip));assert.equal(E.skipReward(skip),false);assert.equal(skip.relics.length,1);assert.ok(E.nextRound(skip));
});
test('six rounds preserve growth and cumulative score while transient preparation resets',()=>{
 const s=preparing('mcr',7,'core_growth');for(let round=0;round<6;round++){assert.equal(s.round,round);assert.equal(s.swaps,5);assert.equal(s.rescueUsed,false);s.roundTarget=1;E.beginPlay(s);arrange(s,flush);const before=s.totalScore,p=E.settle(s);assert.equal(s.totalScore,before+p.total);assert.ok(E.finishSettlement(s));if(round<5){assert.ok(s.offers.some(id=>COMPATIBLE_RELICS.core_growth.includes(id)));assert.ok(E.skipReward(s));assert.ok(E.nextRound(s));assert.equal(s.phase,'prepare');}else assert.equal(s.phase,'victory');}assert.equal(E.nextRound(s),false);
});
test('all scoring steps replay to authoritative totals without mutating preview state',()=>{
 for(const [core,extras,faces] of [['core_high',['jade','coin','echo'],flush],['core_pung',['stone','retrigger_meld'],pungs],['core_growth',['river','retrigger_meld'],flush],['core_held',['retrigger_held'],flush]]){const s=final('mcr',faces,core,extras),before=JSON.stringify(s),p=E.currentSettlementPreview(s);assert.equal(JSON.stringify(s),before);assert.deepEqual(p,E.currentSettlementPreview(s));let base=0,mult=1;for(const step of p.steps){if(step.target==='base'){assert.equal(step.before,base);base=step.after;}if(step.target==='multiplier'){assert.equal(step.before,mult);mult=step.after;}}assert.equal(base,p.base);assert.equal(mult,p.mult);assert.equal(p.total,Number(BigInt(base)*BigInt(mult.toFixed(6).replace('.',''))/1000000n));assert.equal(p.steps.at(-1).event,'round_result');}
});
test('V5 rejects legacy, forged equipment/resources and altered frozen held snapshots',()=>{
 const s=playing();assert.equal(E.VERSION,5);assert.ok(E.restore(JSON.stringify(s)));for(const patch of [{version:4},{rulesVersion:'free-play-v4'},{scoreVersion:'exponential-v3'},{hand:null},{deck:[]},{totalScore:7},{relics:['core_high','core_pung']},{relics:['core_high','jade','stone','ink','river']},{openingSwapsUsed:6},{swaps:1},{rescueUsed:true}])assert.equal(E.restore(JSON.stringify({...s,...patch})),null);
 const p=preparing();assert.equal(E.restore(JSON.stringify({...p,swaps:4})),null);assert.ok(E.retire(p));assert.ok(E.restore(JSON.stringify(p)));
 const finished=final();E.settle(finished);for(const mutate of [x=>x.last.passed=!x.last.passed,x=>x.last.heldTiles[0].face=33,x=>x.growth.coreGrowth+=1]){const bad=structuredClone(finished);mutate(bad);assert.equal(E.restore(JSON.stringify(bad)),null);}
});
test('real terminal/honor hands and special patterns remain mode-specific',()=>{
 const screenshot=E.currentSettlementPreview(final('riichi',[0,0,0,17,17,17,26,26,26,27,27,27,28,28]));assert.deepEqual(new Set(names(screenshot.patterns)),new Set(['混老头','对对和']));assert.equal(screenshot.fans,4);
 const pure=E.currentSettlementPreview(final('riichi',[0,0,0,8,8,8,9,9,9,17,17,17,18,18]));assert.deepEqual(names(pure.patterns),['清老头']);assert.equal(pure.fans,13);assert.equal(pure.mult,2048);
 for(const mode of ['mcr','riichi'])assert.ok(names(E.currentSettlementPreview(final(mode,[0,8,9,17,18,26,27,28,29,30,31,32,33,0])).patterns).includes(mode==='mcr'?'十三幺':'国士无双'));
});
test('seven pairs use mode-specific duplicate rules and never receive duplicate-sequence yaku',()=>{
 const s=final('mcr',Array.from({length:7},(_,i)=>[i+10,i+10]).flat());const p=E.currentSettlementPreview(s);assert.ok(names(p.patterns).includes('连七对'));
 const r=final('riichi',[0,0,2,2,4,4,6,6,8,8,10,10,12,12]);const q=E.currentSettlementPreview(r);assert.equal(q.decomposition.shape,'pairs');assert.ok(!names(q.patterns).includes('二盃口'));
 const counts=[0,0,0,0,2,2,4,4,6,6,8,8,10,10],tiles=final('mcr',counts).formed;
 assert.equal(decompose(tiles).some(d=>d.shape==='pairs'),false);
 assert.equal(decompose(tiles,[],'mcr').some(d=>d.shape==='pairs'),true);
});

test('special hand structures preserve every physical tile and mode-specific legality',()=>{
 const tiles=faces=>faces.map((face,i)=>({id:`special-${i}`,face}));
 const check=(faces,shape,mode='mcr',kongs=[])=>{
  const hand=tiles(faces),d=decompose(hand,kongs,mode).find(d=>d.shape===shape);assert.ok(d,`${mode}: ${shape}`);
  assert.deepEqual([...d.groupTileIds.flat(),...d.pairTileIds].sort(),hand.map(t=>t.id).sort());return d;
 };
 const orphans=[0,8,9,17,18,26,27,28,29,30,31,32,33,0];
 check(orphans,'orphans','riichi');check(orphans,'orphans');
 assert.equal(decompose(tiles([...orphans.slice(0,12),0,0]),[],'riichi').some(d=>d.shape==='orphans'),false);
 const knit=[0,3,6,10,13,16,20,23,26];
 check([...knit,27,27,27,28,28],'knitted');
 check([...knit,27,28,29,30,31],'unconnected');
 check([...knit.slice(0,7),27,28,29,30,31,32,33],'unconnected');
 assert.equal(decompose(tiles([...knit,27,27,27,28,28]),[],'riichi').length,0);
 const kong={face:27,tileIds:[9,10,11,12].map(i=>`special-${i}`)};
 const d=check([...knit,27,27,27,27,28,28],'knitted','mcr',[kong]);
 assert.equal(d.groups[0].length,9);assert.equal(d.groups[1].length,4);
 const wild=tiles([...orphans.slice(0,13),9]);wild[0].face=18;wild[0].wild=true;
 assert.ok(decompose(wild,[],'riichi').some(d=>d.shape==='orphans'&&d.wildcardAssignments[0].face===0));
 const sixCopies=tiles([0,0,0,0,0,0,2,2,4,4,6,6,8,8]);
 assert.equal(decompose(sixCopies,[],'mcr').some(d=>d.shape==='pairs'),false);
});

test('risk recognizes unfinished special hands without pretending their tiles are ordinary melds',()=>{
 const tiles=faces=>faces.map((face,i)=>({id:`risk-${i}`,face}));
 const orphans=tiles([0,8,9,17,18,26,27,28,29,30,31,32,33]);
 assert.ok(canCompleteByAdding(orphans,[],'riichi'));assert.ok(canCompleteByAdding(orphans,[],'mcr'));
 const knit=[0,3,6,10,13,16,20,23,26];
 const unconnected=tiles([...knit.slice(0,8),27,28,29,30,31]);
 assert.equal(canCompleteByAdding(unconnected,[],'riichi'),false);assert.ok(canCompleteByAdding(unconnected,[],'mcr'));
 assert.ok(canCompleteByAdding(tiles([...knit,27,27,28,28]),[],'mcr'));
 const pairs=tiles([0,0,0,0,2,2,4,4,6,6,8,8,10]);
 assert.ok(canCompleteByAdding(pairs,[],'mcr'));
});

test('duplicate transformed dragon pungs do not fake distinct dragons',()=>{
 const groups=[[31,31,31],[31,31,31],[32,32,32],[27,27,27]],p=[28,28];
 assert.ok(!names(E.patterns('mcr',groups,p)).includes('大三元'));assert.ok(names(E.patterns('mcr',groups,p)).includes('双箭刻'));
 const real=E.patterns('riichi',[[31,31,31],[32,32,32],[33,33,33],[27,27,27]],p);assert.deepEqual(new Set(names(real)),new Set(['字一色','大三元']));assert.ok(real.every(p=>p.classification==='yakuman'));
});

test('four declared kongs make eighteen physical tiles and keep seven pairs excluded',()=>{
 const s=arrange(playing(),[0,0,0,0,9,9,9,9,18,18,18,18,31,31,31,31,32,32]);
 // Retain the remaining kongs while only replacing the four tiles moved each time.
 const selected=s.formed,rest=[...s.hand,...s.deck];s.formed=[];
 s.hand=selected.slice(0,E.DRAW_BATCH_SIZE);s.deck=[...rest,...selected.slice(E.DRAW_BATCH_SIZE).reverse()];
 for(const face of [0,9,18,31]){
  const wall=s.deck.length;assert.ok(E.declareKong(s,s.hand.filter(t=>t.face===face).map(t=>t.id)).ok);assert.equal(s.deck.length,wall-4);
 }
 const pair=selected.filter(t=>t.face===32).map(t=>t.id);assert.equal(E.commit(s,pair).valid,true);
 assert.equal(E.structuralCount(s),14);assert.equal(s.formed.length,18);const p=E.currentSettlementPreview(s);assert.ok(p.legal);assert.equal(p.decomposition.shape,'normal');assert.equal(p.decomposition.groups.length,4);structuralEntities(s);assert.ok(E.restore(JSON.stringify(s)));
});