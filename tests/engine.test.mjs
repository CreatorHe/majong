import test from 'node:test';
import assert from 'node:assert/strict';
import * as E from '../dist/engine.js';
import {highFanMultiplier,DISABLED_RELIC_IDS,COMPATIBLE_RELICS,FIRST_COMPATIBLE} from '../dist/balance.js';
import {decompose,canCompleteByAdding} from '../dist/hand-rules.js';

const names=ps=>ps.map(p=>p.name);
const preparing=(mode='mcr',seed=7,core='core_high',extras=[])=>{const s=E.newRun(mode,seed);assert.ok(E.chooseStarter(s,core));s.relics.push(...extras.filter(id=>!s.relics.includes(id)));return s;};
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
function rewardState(core='core_high',extras=[]){const s=final('mcr',flush,core,extras);E.settle(s);E.finishSettlement(s);assert.equal(s.phase,'reward');return s;}

test('V8 offers four mutually exclusive starter cores and requires explicit start',()=>{
 for(const core of E.CORE_IDS){const s=E.newRun();assert.deepEqual(s.offers,E.CORE_IDS);assert.equal(E.chooseStarter(s,'jade'),false);assert.ok(E.chooseStarter(s,core));assert.equal(s.phase,'prepare');assert.deepEqual(s.relics,[core,'rank_brush']);assert.ok(E.restore(JSON.stringify(s)));
  const before=JSON.stringify(s);assert.equal(E.commit(s,[s.hand[0].id]).valid,false);assert.equal(E.declareKong(s,s.hand.slice(0,4).map(t=>t.id)).ok,false);assert.equal(E.settle(s).valid,false);assert.equal(E.addRelic(s,'jade'),false);assert.equal(JSON.stringify(s),before);
  assert.ok(E.beginPlay(s));assert.equal(s.phase,'play');assert.equal(s.swaps,5);assert.equal(E.beginPlay(s),false);assert.ok(E.restore(JSON.stringify(s)));
 }
});
test('five exchanges shared across preparation and play preserve supply and cap baseline exposure at 51',()=>{
 for(const mode of ['mcr','riichi']){const s=preparing(mode),seen=new Set(s.hand.map(t=>t.id));assert.equal(s.deck.length,124);
  for(const ids of [[],s.hand.slice(0,6).map(t=>t.id),[s.hand[0].id,s.hand[0].id],['missing']]){const before=JSON.stringify(s);assert.equal(E.exchange(s,ids),false);assert.equal(JSON.stringify(s),before);}
  for(let i=0;i<2;i++){assert.ok(E.exchange(s,s.hand.slice(0,5).map(t=>t.id)));s.hand.forEach(t=>seen.add(t.id));assert.ok(E.restore(JSON.stringify(s)));}
  assert.equal(s.swaps,3);assert.ok(E.beginPlay(s));assert.equal(s.swaps,3);assert.equal(s.openingSwapsUsed,2);
  for(let i=0;i<14;i++){
   if(i<3){assert.ok(E.exchange(s,s.hand.slice(0,5).map(t=>t.id)));s.hand.forEach(t=>seen.add(t.id));assert.ok(E.restore(JSON.stringify(s)));}
   const kept=s.hand.slice(1).map(t=>t.id);assert.ok(E.commit(s,[s.hand[0].id]).valid);assert.ok(kept.every(id=>s.hand.some(t=>t.id===id)));s.hand.forEach(t=>seen.add(t.id));
  }
  assert.equal(s.openingSwapsUsed,5);assert.equal(s.swaps,0);const exhausted=JSON.stringify(s);assert.equal(E.exchange(s,[s.hand[0].id]),false);assert.equal(JSON.stringify(s),exhausted);
  assert.equal(seen.size,51);assert.equal(s.discard.length,25);assert.equal(s.deck.length,85);assert.equal(s.hand.length,12);assert.equal(E.structuralCount(s),14);assert.ok(E.restore(JSON.stringify(s)));structuralEntities(s);
 }
});
test('candidate exchange stays available at full fourteen but closes after settlement without changing ordinary score',()=>{
 const s=final('mcr',flush,'core_pung'),ids=s.hand.slice(0,5).map(t=>t.id),formed=JSON.stringify(s.formed),before=E.currentSettlementPreview(s),wall=s.deck.length;
 assert.ok(E.exchange(s,ids));assert.equal(s.deck.length,wall-5);assert.equal(s.hand.length,12);assert.equal(s.openingSwapsUsed,1);assert.equal(s.swaps,4);assert.equal(JSON.stringify(s.formed),formed);assert.equal(E.currentSettlementPreview(s).total,before.total);structuralEntities(s);assert.ok(E.restore(JSON.stringify(s)));
 const frozen=E.settle(s);for(const finish of [false,true]){if(finish)E.finishSettlement(s);const raw=JSON.stringify(s);assert.equal(E.exchange(s,[s.hand[0].id]),false);assert.equal(JSON.stringify(s),raw);assert.deepEqual(s.last,frozen);assert.ok(E.restore(JSON.stringify(s)));}
 const short=playing();short.deck=[];const raw=JSON.stringify(short);assert.equal(E.exchange(short,[short.hand[0].id]),false);assert.equal(JSON.stringify(short),raw);
});
test('edits remain preparation-only for rank, suit and wild and never consume resources during play',()=>{
 for(const action of ['rank','suit','wild'])for(const count of [0,1,14]){
  const s=preparing('mcr',7,'core_high',['suit_ribbon']),id=bring(s,[1])[0];E.beginPlay(s);
  if(count===1)E.commit(s,[id]);if(count===14)arrange(s,flush);
  const tile=count===14?s.formed.find(t=>t.face===1):[...s.hand,...s.formed].find(t=>t.id===id),before=JSON.stringify(s);
  assert.equal(E.transform(s,[tile.id],action,1).ok,false);assert.equal(JSON.stringify(s),before);assert.equal(s.ink,2);
 }
 const s=preparing('mcr',7,'core_pung'),id=bring(s,[1])[0];assert.ok(E.transform(s,[id],'rank',1).ok);assert.equal(s.ink,0);assert.ok(E.beginPlay(s));assert.ok(E.commit(s,[id]).valid);
 const before=JSON.stringify(s);assert.equal(E.transform(s,[id],'rank',-1).ok,false);assert.equal(E.replaceFormed(s,[id],[s.hand[0].id]).ok,false);assert.equal(E.addRelic(s,'jade'),false);assert.equal(JSON.stringify(s),before);assert.ok(E.exchange(s,[s.hand[0].id]));assert.ok(E.restore(JSON.stringify(s)));
});
test('one edit preserves physical identity, enforces tool ownership and covers rank, suit and wild',()=>{
 const rank=arrange(preparing('mcr'),[0,0,0,0,1],'hand'),id=rank.hand.find(t=>t.face===1).id;
 rank.relics=['core_high'];assert.equal(E.transform(rank,[id],'rank',-1).ok,false);rank.relics.push('rank_brush');
 assert.ok(E.transform(rank,[id],'rank',-1).ok);assert.equal(rank.hand.filter(t=>t.face===0).length,5);assert.equal(rank.hand.find(t=>t.id===id).original,1);assert.equal(rank.ink,0);
 const before=JSON.stringify(rank);assert.equal(E.transform(rank,[id],'rank',1).ok,false);assert.equal(JSON.stringify(rank),before);structuralEntities(rank);assert.ok(E.restore(JSON.stringify(rank)));
 for(const action of ['suit','wild']){
  const s=preparing('mcr'),tileId=bring(s,[1])[0];
  if(action==='suit'){assert.equal(E.transform(s,[tileId],action,1).ok,false);s.relics.push('suit_ribbon');}
  else {assert.deepEqual(s.relics,['core_high','rank_brush']);}assert.ok(E.transform(s,[tileId],action,1).ok);assert.ok(E.beginPlay(s));
  const changed=s.hand.find(t=>t.id===tileId);assert.equal(changed.original,1);assert.equal(changed.face%9,1);assert.equal(changed.wild,action==='wild');assert.equal(s.ink,0);
  assert.equal(E.transform(s,[tileId],action,2).ok,false);structuralEntities(s);assert.ok(E.restore(JSON.stringify(s)));
 }
});
test('wild ability belongs to the high core, is prepared once and resolves after the hand is formed',()=>{
 for(const core of ['core_pung','core_held','core_growth']){const s=preparing('mcr',7,core,['wild_jade']),id=bring(s,[1])[0],before=JSON.stringify(s);assert.equal(E.transform(s,[id],'wild').ok,false);assert.equal(JSON.stringify(s),before);assert.equal(E.restore(before),null);}
 const s=preparing(),id=bring(s,[22])[0];assert.ok(E.transform(s,[id],'wild').ok);assert.equal(s.ink,0);assert.equal(s.relics.length,2);assert.ok(E.restore(JSON.stringify(s)));
 E.beginPlay(s);arrange(s,[1,2,3,10,11,12,19,20,21,4,4,4,13,22]);assert.ok(E.currentSettlementPreview(s).legal);assert.equal(s.formed.find(t=>t.id===id).original,22);assert.ok(E.restore(JSON.stringify(s)));
 const before=JSON.stringify(s);assert.equal(E.transform(s,[id],'rank',1).ok,false);assert.equal(JSON.stringify(s),before);
 const bad=structuredClone(s);bad.relics=['core_pung','rank_brush'];assert.equal(E.restore(JSON.stringify(bad)),null);
});
test('full fourteen and settled hands reject all edits even when the preparation allowance was unused',()=>{
 const s=final('mcr',[1,2,3,10,11,12,19,20,21,4,4,4,13,14],'core_high',['suit_ribbon']);
 assert.equal(E.currentSettlementPreview(s).legal,false);const t=s.formed.find(t=>t.face===14),before=JSON.stringify(s);
 for(const action of ['rank','suit','wild']){assert.equal(E.transform(s,[t.id],action,action==='rank'?-1:1).ok,false);assert.equal(JSON.stringify(s),before);}
 const p=E.settle(s);assert.equal(p.legal,false);const settled=JSON.stringify(s);for(const action of ['rank','suit','wild']){assert.equal(E.transform(s,[t.id],action,1).ok,false);assert.equal(JSON.stringify(s),settled);}assert.ok(E.restore(JSON.stringify(s)));
});
test('high rescue shares one use between preparation editing and play-only exchange with one shared ink budget',()=>{
 const s=preparing('mcr',7,'core_high',['high_rescue']),id=bring(s,[1])[0];
 for(const request of [{type:'exchange',ids:[id]},{type:'wild',ids:[id]},{type:'rank',ids:[id],arg:9}]){const before=JSON.stringify(s);assert.equal(E.highRescue(s,request).ok,false);assert.equal(JSON.stringify(s),before);}
 assert.ok(E.highRescue(s,{type:'suit',ids:[id],arg:1}).ok);assert.equal(s.ink,0);assert.equal(s.hand.find(t=>t.id===id).face,10);assert.equal(s.rescueUsed,true);assert.ok(E.restore(JSON.stringify(s)));
 E.beginPlay(s);E.commit(s,[id]);const used=JSON.stringify(s);assert.equal(E.highRescue(s,{type:'exchange',ids:[s.hand[0].id]}).ok,false);assert.equal(JSON.stringify(s),used);assert.ok(E.restore(JSON.stringify(s)));
 const r=playing('mcr',7,'core_high',['high_rescue']),rid=bring(r,[1])[0];
 for(const request of [{type:'rank',ids:[rid],arg:1},{type:'suit',ids:[rid],arg:1},{type:'wild',ids:[rid]},{type:'exchange',ids:r.hand.slice(0,4).map(t=>t.id)}]){const before=JSON.stringify(r);assert.equal(E.highRescue(r,request).ok,false);assert.equal(JSON.stringify(r),before);}
 const wall=r.deck.length;assert.ok(E.highRescue(r,{type:'exchange',ids:r.hand.slice(0,3).map(t=>t.id)}).ok);assert.equal(r.deck.length,wall-3);assert.equal(r.ink,2);assert.equal(r.swaps,5);assert.equal(r.openingSwapsUsed,0);assert.equal(r.rescueUsed,true);assert.ok(E.restore(JSON.stringify(r)));structuralEntities(r);
 for(const phase of ['prepare','play'])for(const core of ['core_pung','core_high']){const t=preparing('mcr',7,core,core==='core_pung'?['high_rescue']:[]),tid=bring(t,[1])[0];if(phase==='play')E.beginPlay(t);const before=JSON.stringify(t);assert.equal(E.highRescue(t,{type:phase==='prepare'?'rank':'exchange',ids:[tid],arg:1}).ok,false);assert.equal(JSON.stringify(t),before);}
 const shared=preparing('mcr',7,'core_high',['high_rescue']),tid=bring(shared,[1])[0];assert.ok(E.transform(shared,[tid],'rank',1).ok);const raw=JSON.stringify(shared);assert.equal(E.highRescue(shared,{type:'rank',ids:[tid],arg:1}).ok,false);assert.equal(JSON.stringify(shared),raw);E.beginPlay(shared);assert.ok(E.highRescue(shared,{type:'exchange',ids:[shared.hand[0].id]}).ok);
 const full=final('mcr',flush,'core_high',['high_rescue']),before=JSON.stringify(full);for(const type of ['exchange','rank','suit'])assert.equal(E.highRescue(full,{type,ids:[full.hand[0].id],arg:1}).ok,false);assert.equal(JSON.stringify(full),before);E.settle(full);const settled=JSON.stringify(full);assert.equal(E.highRescue(full,{type:'exchange',ids:[full.hand[0].id]}).ok,false);assert.equal(JSON.stringify(full),settled);
});
test('single payments stop at four and never get multiplied into hand score',()=>{
 const s=playing('mcr',3,'core_pung',['single_seal']);for(let i=0;i<5;i++)assert.ok(E.commit(s,[s.hand[0].id]).valid);assert.equal(s.singleCount,4);assert.equal(s.processScore,800);assert.equal(s.totalScore,800);
 const t=final();t.processScore=80;t.score=80;t.totalScore=80;const p=E.currentSettlementPreview(t);assert.equal(p.cumulativeAfter,80+p.total);assert.equal(p.roundScore,80+p.total);
});
test('formed discard permanently removes one or two tiles without drawing or refunding resources and payments',()=>{
 for(const count of [1,2]){
  const s=preparing('mcr',3,'core_pung',['single_seal']),editId=bring(s,[1])[0];assert.ok(E.transform(s,[editId],'rank',1).ok);assert.ok(E.beginPlay(s));
  assert.ok(E.commit(s,[editId]).valid);for(let i=0;i<3;i++)assert.ok(E.commit(s,[s.hand[0].id]).valid);
  const ids=s.formed.slice(0,count).map(t=>t.id),removed=s.formed.slice(0,count),hand=JSON.stringify(s.hand),wall=JSON.stringify(s.deck),resources=[s.ink,s.swaps,s.openingSwapsUsed,s.rescueUsed,s.singleCount,s.processScore,s.score,s.totalScore];
  assert.ok(E.discardFormed(s,ids).ok);assert.equal(E.structuralCount(s),4-count);assert.deepEqual(s.formedDiscard,{round:0,tileIds:ids});assert.ok(removed.every(t=>s.discard.includes(t)&&t.entered));
  assert.equal(JSON.stringify(s.hand),hand);assert.equal(JSON.stringify(s.deck),wall);assert.deepEqual([s.ink,s.swaps,s.openingSwapsUsed,s.rescueUsed,s.singleCount,s.processScore,s.score,s.totalScore],resources);structuralEntities(s);assert.ok(E.restore(JSON.stringify(s)));
  const after=JSON.stringify(s);assert.equal(E.commit(s,ids).valid,false);assert.equal(E.discardFormed(s,[s.formed[0].id]).ok,false);assert.equal(JSON.stringify(s),after);
  const deckCount=s.deck.length;assert.ok(E.commit(s,s.hand.slice(0,count).map(t=>t.id)).valid);assert.equal(s.deck.length,deckCount-count);assert.equal(s.hand.length,12);assert.equal(E.structuralCount(s),4);assert.equal(s.processScore,800);assert.equal(s.singleCount,4);structuralEntities(s);assert.ok(E.restore(JSON.stringify(s)));
 }
});
test('formed discard rejects invalid phases, selections and locked kongs without consuming its use',()=>{
 const prep=preparing(),beforePrep=JSON.stringify(prep);assert.equal(E.discardFormed(prep,[prep.hand[0].id]).ok,false);assert.equal(JSON.stringify(prep),beforePrep);
 const s=final(),ids=s.formed.map(t=>t.id);for(const selected of [null,[],[ids[0],ids[0]],ids.slice(0,3),['missing'],[s.hand[0].id]]){const before=JSON.stringify(s);assert.equal(E.discardFormed(s,selected).ok,false);assert.equal(JSON.stringify(s),before);}
 const kong=final('mcr',[0,0,0,10,11,12,22,23,24,33,33,33,27,27]),incoming=bring(kong,[0])[0],locked=kong.formed.filter(t=>t.face===0).map(t=>t.id).concat(incoming);assert.ok(E.declareKong(kong,locked).ok);
 const unlocked=kong.formed.find(t=>!locked.includes(t.id)).id,beforeKong=JSON.stringify(kong);assert.equal(E.discardFormed(kong,[unlocked,locked[0]]).ok,false);assert.equal(JSON.stringify(kong),beforeKong);assert.ok(E.discardFormed(kong,[unlocked]).ok);assert.equal(kong.kongs.length,1);assert.ok(E.restore(JSON.stringify(kong)));
 E.settle(s);const settled=JSON.stringify(s);assert.equal(E.discardFormed(s,[ids[0]]).ok,false);assert.equal(JSON.stringify(s),settled);
});
test('formed discard survives reload and later rounds while forged or reset usage is rejected',()=>{
 const s=final(),id=s.formed.find(t=>t.face===4).id;assert.ok(E.discardFormed(s,[id]).ok);const reloaded=E.restore(JSON.stringify(s));assert.ok(reloaded);assert.deepEqual(reloaded.formedDiscard,{round:0,tileIds:[id]});
 for(const mutate of [x=>delete x.formedDiscard,x=>x.formedDiscard=null,x=>x.formedDiscard.round=1,x=>x.formedDiscard.tileIds=[id,id],x=>x.formedDiscard.tileIds=[x.hand[0].id],x=>x.discard.find(t=>t.id===id).entered=false]){const forged=structuredClone(s);mutate(forged);assert.equal(E.restore(JSON.stringify(forged)),null);}
 const replacement=bring(reloaded,[4])[0];assert.ok(E.commit(reloaded,[replacement]).valid);assert.ok(E.settle(reloaded).legal);assert.ok(E.finishSettlement(reloaded));assert.ok(E.skipReward(reloaded));assert.ok(E.nextRound(reloaded));assert.deepEqual(reloaded.formedDiscard,{round:0,tileIds:[id]});assert.ok(E.restore(JSON.stringify(reloaded)));
 assert.ok(E.beginPlay(reloaded));assert.ok(E.commit(reloaded,[reloaded.hand[0].id]).valid);const before=JSON.stringify(reloaded);assert.equal(E.discardFormed(reloaded,[reloaded.formed[0].id]).ok,false);assert.equal(JSON.stringify(reloaded),before);assert.ok(E.restore(JSON.stringify(reloaded)));assert.equal(E.newRun().formedDiscard,null);
});
test('invalid selection and overflow have no side effects',()=>{
 const s=playing(),id=s.hand[0].id,before=JSON.stringify(s);assert.equal(E.commit(s,[id,id]).valid,false);assert.equal(E.commit(s,['missing']).valid,false);assert.equal(JSON.stringify(s),before);
 const full=final(),raw=JSON.stringify(full);assert.equal(E.commit(full,[full.hand[0].id]).valid,false);assert.equal(JSON.stringify(full),raw);
});
test('kong consumes four physical tiles as three structural positions and locks its identity',()=>{
 const s=final('mcr',[0,0,0,10,11,12,22,23,24,33,33,33,27,27],'core_pung',['stone','kong_cauldron']);const incoming=bring(s,[0])[0],wall=s.deck.length,ids=[...s.formed.filter(t=>t.face===0).map(t=>t.id),incoming];assert.ok(E.declareKong(s,ids).ok);assert.equal(s.formed.length,15);assert.equal(E.structuralCount(s),14);assert.equal(s.deck.length,wall-1);const p=E.currentSettlementPreview(s);assert.ok(p.legal);assert.equal(p.gains.find(g=>g.id==='kong_cauldron').value,600);assert.equal(p.coinGain,2);const lockedState=JSON.stringify(s);assert.equal(E.transform(s,[ids[0]],'rank',1).ok,false);assert.equal(JSON.stringify(s),lockedState);assert.equal(E.declareKong(s,ids).ok,false);structuralEntities(s);assert.ok(E.restore(JSON.stringify(s)));
});
test('wildcard assignment is rank-fixed and locked inside a declared kong',()=>{
 const s=preparing('mcr',5,'core_high'),ids=bring(s,[0,0,0,9]);assert.ok(E.transform(s,[ids[3]],'wild').ok);E.beginPlay(s);assert.ok(E.declareKong(s,ids).ok);assert.equal(s.kongs[0].face,0);assert.equal(s.formed.find(t=>t.id===ids[3]).face,0);assert.ok(E.restore(JSON.stringify(s)));
});
test('risk allows dangerous commitments without calling temporary incompleteness impossible',()=>{
 const s=arrange(playing(),[0,1,2,3,4,5,15,16,17,27,27,28]);assert.equal(E.inspect(s).canComplete,true);const west=bring(s,[29]);assert.equal(E.inspect(s,west).risk,'needs_repair');assert.equal(E.commit(s,west).valid,true);
 const pairs=arrange(playing(),[0,0,2,2,4,4,6,6,8,8,10,10,21]);assert.ok(E.inspect(pairs).canComplete);
});
test('ordinary hand multiplier is linear; exponential threshold belongs only to high core',()=>{
 assert.equal(E.fanMultiplier('mcr',88),12);assert.equal(E.fanMultiplier('riichi',13),14);assert.equal(highFanMultiplier('mcr',3),4);assert.equal(highFanMultiplier('mcr',4),12);assert.equal(highFanMultiplier('mcr',88),4096);assert.equal(highFanMultiplier('mcr',176),8192);assert.equal(highFanMultiplier('riichi',26),4096);assert.equal(highFanMultiplier('riichi',39),6144);
 const a=final('mcr',pungs,'core_pung'),b=structuredClone(a);b.relics=['core_high'];const p=E.currentSettlementPreview(a),q=E.currentSettlementPreview(b);assert.equal(p.fans,8);assert.equal(p.mult,122.9312);assert.equal(q.mult,32);assert.ok(q.gains.some(g=>g.id==='core_high'));
});
test('retriggered pung events repeat base and multiplier but do not repeat coins',()=>{
 const s=final('mcr',pungs,'core_pung',['stone','retrigger_meld']),p=E.currentSettlementPreview(s);assert.ok(p.legal);assert.equal(p.base,7200);assert.equal(p.mult,7556.039966);assert.equal(p.total,54403487);assert.equal(p.coinGain,4);assert.equal(p.gains.filter(g=>g.id==='stone').length,8);assert.equal(p.gains.filter(g=>g.id==='core_pung').length,8);assert.equal(p.gains.find(g=>g.id==='retrigger_meld').value,4);
});
test('held terminal events include the final refill and freeze stable tile IDs',()=>{
 const s=final('mcr',flush,'core_held',['retrigger_held']);const faces=[0,8,2,3,5,6,10,11,12,13,14,15];bring(s,faces);E.sortHand(s);const before=JSON.stringify(s),p=E.currentSettlementPreview(s);assert.equal(JSON.stringify(s),before);assert.deepEqual(p.heldTiles,s.hand);assert.ok(Object.isFrozen(p.heldTiles));assert.equal(p.gains.filter(g=>g.id==='core_held').length,4);
 const ids=new Set(p.heldTiles.map(t=>t.id));assert.ok(p.steps.filter(t=>t.relicId==='core_held').every(t=>t.tileIds.every(id=>ids.has(id))));const raw=JSON.stringify(p.heldTiles);E.settle(s);assert.equal(JSON.stringify(s.last.heldTiles),raw);assert.ok(E.restore(JSON.stringify(s)));
 const refreshed=final('mcr',pungs,'core_held');bring(refreshed,[0,8,9,17,18,26,27,28,29,30,31,32]);const old=E.currentSettlementPreview(refreshed),terminal=refreshed.hand[0].id;refreshed.deck.push(refreshed.deck.splice(refreshed.deck.findIndex(t=>t.face===2),1)[0]);assert.ok(E.exchange(refreshed,[terminal]));const next=E.currentSettlementPreview(refreshed);assert.equal(old.gains.filter(g=>g.id==='core_held').length,12);assert.equal(next.gains.filter(g=>g.id==='core_held').length,11);assert.ok(next.mult<old.mult);assert.ok(!next.heldTiles.some(t=>t.id===terminal));assert.deepEqual(E.settle(refreshed).heldTiles,next.heldTiles);assert.ok(E.restore(JSON.stringify(refreshed)));
});
test('held burst tiers count physical tiles once, repeat their tier and ignore candidate display order',()=>{
 const terminals=[0,8,9,17,18,26,27,28,29,30,31,32],fillers=[2,3,5];
 for(const h of [9,10,12])for(const repeated of [false,true]){const s=final('mcr',pungs,'core_held',repeated?['retrigger_held']:[]);bring(s,[...terminals.slice(0,h),...fillers.slice(0,12-h)]);const p=E.currentSettlementPreview(s),events=p.steps.filter(step=>step.relicId==='core_held'),times=repeated?2:1;
  assert.equal(events.length,h*times);assert.equal(events.filter(step=>step.heldTier==='burst').length,Math.max(0,h-9)*times);
  assert.deepEqual(events.map(step=>step.heldOrdinal),Array.from({length:h},(_,i)=>Array(times).fill(i+1)).flat());
  for(const event of events){assert.equal(event.delta,event.heldOrdinal<=9?1.26:2);assert.equal(event.label.includes('爆发档'),event.heldOrdinal>9);}
  const reversed=structuredClone(s);reversed.hand.reverse();const q=E.currentSettlementPreview(reversed);assert.equal(q.total,p.total);assert.equal(q.mult,p.mult);assert.deepEqual(q.steps.filter(step=>step.relicId==='core_held'),events);
 }
});
test('growth previews do not mutate and final stored growth is added once and paid once',()=>{
 const s=final('mcr',flush,'core_growth',['retrigger_meld']),before=JSON.stringify(s),p=E.currentSettlementPreview(s);assert.equal(JSON.stringify(s),before);assert.equal(p.growthCoreAfter,702.290655);assert.equal(p.base,9420);assert.equal(p.gains.filter(g=>g.id==='core_growth').length,1);
 E.settle(s);assert.equal(s.growth.coreGrowth,p.growthCoreAfter);const paid=JSON.stringify(s);assert.deepEqual(E.settle(s),p);assert.equal(JSON.stringify(s),paid);const restored=E.restore(JSON.stringify(s));assert.ok(restored);const raw=JSON.stringify(restored);E.settle(restored);assert.equal(JSON.stringify(restored),raw);
 E.finishSettlement(s);E.skipReward(s);E.nextRound(s);assert.equal(s.growth.coreGrowth,p.growthCoreAfter);assert.equal(s.phase,'prepare');assert.equal(s.swaps,5);
});
test('false win applies 10 percent penalty and passes on accumulated overflow without growth or event rewards',()=>{
 const s=final('mcr',invalid,'core_growth',['river','stone']);s.roundTarget=1000;s.roundStartScore=1100;s.totalScore=1100;const growth=structuredClone(s.growth),coins=s.coins,p=E.currentSettlementPreview(s);assert.equal(p.legal,false);assert.equal(p.penalty,100);assert.equal(p.cumulativeAfter,1000);assert.equal(p.passed,true);E.settle(s);assert.deepEqual(s.growth,growth);assert.equal(s.coins,coins+p.rewardCoins);assert.equal(s.score,-100);assert.ok(E.restore(JSON.stringify(s)));E.finishSettlement(s);assert.equal(s.phase,'reward');
 const below=final('mcr',invalid);below.roundTarget=1000;below.roundStartScore=1099;below.totalScore=1099;E.settle(below);E.finishSettlement(below);assert.equal(below.phase,'defeat');
});
test('one compatible reward per clear, four slots and explicit noncore replacement prevent extra acquisition',()=>{
 for(const core of E.CORE_IDS){const s=rewardState(core);assert.equal(s.offers.length,3);assert.ok(s.offers.includes(FIRST_COMPATIBLE[core]));assert.ok(s.offers.every(id=>!E.CORE_IDS.includes(id)&&!DISABLED_RELIC_IDS.includes(id)));assert.ok(E.chooseReward(s,FIRST_COMPATIBLE[core]));assert.equal(s.relics.length,3);assert.equal(E.chooseReward(s,s.offers[0]),false);assert.deepEqual(s.shop,[]);const before=JSON.stringify(s);assert.equal(E.buy(s,'jade'),false);assert.equal(E.refreshShop(s),false);assert.equal(E.sell(s,core),false);assert.equal(JSON.stringify(s),before);assert.ok(E.nextRound(s));assert.ok(E.restore(JSON.stringify(s)));}
 for(const core of E.CORE_IDS)for(let seed=0;seed<12;seed++){const s=final('mcr',flush,core);s.rng=seed;E.settle(s);assert.ok(!s.offers.includes('wild_jade'));assert.ok(core==='core_high'||!s.offers.includes('high_rescue'));assert.ok(core==='core_held'||!s.offers.includes('retrigger_held'));}
 const full=rewardState('core_pung',['jade','stone']),id=full.offers[0];assert.equal(E.chooseReward(full,id),false);assert.equal(E.chooseReward(full,id,'core_pung'),false);assert.ok(E.chooseReward(full,id,'rank_brush'));assert.equal(full.relics.length,4);assert.ok(E.restore(JSON.stringify(full)));
 const skip=rewardState();assert.ok(E.skipReward(skip));assert.equal(E.skipReward(skip),false);assert.equal(skip.relics.length,2);assert.ok(E.nextRound(skip));
});
test('six rounds preserve growth and cumulative score while transient preparation resets',()=>{
 const s=preparing('mcr',7,'core_growth');for(let round=0;round<6;round++){assert.equal(s.round,round);assert.equal(s.swaps,5);assert.equal(s.openingSwapsUsed,0);assert.equal(s.rescueUsed,false);assert.equal(s.ink,2);const editId=bring(s,[1])[0];assert.ok(E.transform(s,[editId],'rank',1).ok);E.beginPlay(s);assert.ok(E.exchange(s,s.hand.slice(0,5).map(t=>t.id)));arrange(s,flush);const before=s.totalScore,p=E.settle(s);assert.equal(s.totalScore,before+p.total);assert.ok(E.finishSettlement(s));if(round<5){assert.ok(s.offers.some(id=>COMPATIBLE_RELICS.core_growth.includes(id)));assert.ok(E.skipReward(s));assert.ok(E.nextRound(s));assert.equal(s.phase,'prepare');}else assert.equal(s.phase,'victory');assert.ok(E.restore(JSON.stringify(s)));}assert.equal(E.nextRound(s),false);
});
test('all scoring steps replay to authoritative totals without mutating preview state',()=>{
 for(const [core,extras,faces] of [['core_high',['jade','coin'],flush],['core_pung',['stone','retrigger_meld'],pungs],['core_growth',['river','retrigger_meld'],flush],['core_held',['retrigger_held'],flush]]){const s=final('mcr',faces,core,extras),before=JSON.stringify(s),p=E.currentSettlementPreview(s);assert.equal(JSON.stringify(s),before);assert.deepEqual(p,E.currentSettlementPreview(s));let base=0,mult=1;for(const step of p.steps){if(step.target==='base'){assert.equal(step.before,base);base=step.after;}if(step.target==='multiplier'){assert.equal(step.before,mult);mult=step.after;}}assert.equal(base,p.base);assert.equal(mult,p.mult);assert.equal(p.total,Number(BigInt(base)*BigInt(mult.toFixed(6).replace('.',''))/1000000n));assert.equal(p.steps.at(-1).event,'round_result');}
});
test('V8 rejects legacy, forged equipment/resources and altered frozen held snapshots',()=>{
 const s=playing();assert.equal(E.VERSION,8);assert.ok(E.restore(JSON.stringify(s)));for(const patch of [{version:7},{rulesVersion:'opening-build-v7'},{version:6},{rulesVersion:'opening-build-v6'},{relics:['core_high','wild_jade']},{version:5},{rulesVersion:'opening-build-v5'},{scoreVersion:'four-core-v5'},{ink:4},{ink:1},{relics:['core_high','ink']},{version:4},{rulesVersion:'free-play-v4'},{scoreVersion:'exponential-v3'},{hand:null},{deck:[]},{totalScore:7},{relics:['core_high','core_pung']},{relics:['core_high','jade','stone','ink','river']},{openingSwapsUsed:6},{swaps:1},{rescueUsed:true}])assert.equal(E.restore(JSON.stringify({...s,...patch})),null);
 const p=preparing();assert.equal(E.restore(JSON.stringify({...p,swaps:4})),null);assert.ok(E.retire(p));assert.ok(E.restore(JSON.stringify(p)));
 const rescue=preparing('mcr',7,'core_high',['high_rescue']);assert.equal(E.restore(JSON.stringify({...rescue,rescueUsed:true})),null);const id=bring(rescue,[1])[0];assert.ok(E.transform(rescue,[id],'wild').ok);assert.equal(E.restore(JSON.stringify({...rescue,rescueUsed:true})),null);
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
