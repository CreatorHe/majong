import test from 'node:test';
import assert from 'node:assert/strict';
import * as E from '../dist/engine.js';
import {buildHints} from '../dist/build-hints.js';
import {decompose,canCompleteByAdding} from '../dist/hand-rules.js';

const names=ps=>ps.map(p=>p.name);
const playing=(mode='mcr',seed=7,starter='jade')=>{const s=E.newRun(mode,seed);assert.ok(E.chooseStarter(s,starter));return s;};
const flush=[0,1,2,3,4,5,6,7,8,1,2,3,4,4];
const invalid=[0,1,2,3,4,5,15,16,17,27,27,28,29,30];
function arrange(s,faces,zone='formed') {
  const all=[...s.hand,...s.formed,...s.deck,...s.discard];
  const chosen=[];
  for(const face of faces){const index=all.findIndex(t=>t.face===face);assert.ok(index>=0,`physical copy of ${face} available`);chosen.push(all.splice(index,1)[0]);}
  s.formed=[];s.hand=[];s.discard=[];s.kongs=[];
  for(const t of chosen)t.entered=zone==='formed';
  s[zone]=chosen;s.deck=all;
  while(s.hand.length<E.DRAW_BATCH_SIZE&&s.deck.length)s.hand.push(s.deck.pop());E.sortHand(s);return s;
}
function final(mode='mcr',faces=flush){return arrange(playing(mode),faces);}
function bring(s,faces){const ids=[];for(const face of faces){let t=s.hand.find(t=>t.face===face&&!ids.includes(t.id));if(!t){const i=s.deck.findIndex(t=>t.face===face);assert.ok(i>=0);t=s.deck.splice(i,1)[0];const oldAt=s.hand.findIndex(x=>!ids.includes(x.id));const old=s.hand.splice(oldAt,1)[0];if(old)s.deck.push(old);s.hand.push(t);}ids.push(t.id);}return ids;}
function structuralEntities(s){const all=[...s.hand,...s.formed,...s.deck,...s.discard];assert.equal(all.length,136);assert.equal(new Set(all.map(t=>t.id)).size,136);for(let face=0;face<34;face++)assert.equal(all.filter(t=>t.original===face).length,4);}

test('both modes use complete decompositions and distinct fan values',()=>{
 const m=E.currentSettlementPreview(final()),r=E.currentSettlementPreview(final('riichi'));
 assert.ok(m.legal&&r.legal);assert.equal(m.patterns.find(x=>x.name==='清一色').fan,24);assert.equal(r.patterns.find(x=>x.name==='清一色').fan,6);
 assert.ok(names(m.patterns).includes('清龙'));assert.ok(names(r.patterns).includes('一气通贯'));
 assert.equal(E.groupType([7,8,9]),null);assert.equal(E.groupType([33,33,33,33]),'kong');
});
test('arbitrary single and batch commits recombine and never settle automatically',()=>{
 const t=final(),selected=t.formed.slice(),rest=[...t.hand,...t.deck];t.formed=[];
 t.hand=selected.slice(0,E.DRAW_BATCH_SIZE);t.deck=[...rest,...selected.slice(E.DRAW_BATCH_SIZE).reverse()];
 const ids=[1,2,5,6].map(n=>selected.splice(0,n).map(t=>t.id));
 assert.equal(E.commit(t,ids[0]).valid,true);assert.equal(E.commit(t,ids[1]).valid,true);
 assert.equal(E.structuralCount(t),3);assert.equal(t.score,0);assert.equal(t.phase,'play');assert.ok(E.inspect(t).canComplete);
 assert.equal(E.commit(t,ids[2]).valid,true);assert.equal(E.commit(t,ids[3]).valid,true);
 const p=E.currentSettlementPreview(t);assert.ok(p.legal);assert.equal(t.phase,'play');structuralEntities(t);
});
test('preview has no state or RNG side effects and payout is identical',()=>{
 const s=final();E.addRelic(s,'river');E.addRelic(s,'stone');E.addRelic(s,'coin');
 const before=JSON.stringify(s),p=E.currentSettlementPreview(s),p2=E.currentSettlementPreview(s);
 assert.equal(JSON.stringify(s),before);assert.deepEqual(p2,p);assert.ok(Object.isFrozen(p));
 const done=E.settle(s);assert.deepEqual(done,p);assert.equal(s.phase,'settlement');assert.equal(s.totalScore,p.cumulativeAfter);
 const paid=JSON.stringify(s);assert.deepEqual(E.settle(s),done);assert.equal(JSON.stringify(s),paid);assert.ok(E.finishSettlement(s));assert.equal(E.finishSettlement(s),false);
});
test('one final hand scores the same regardless of batch history',()=>{
 const a=final(),b=structuredClone(a);a.batches=[{kind:'play',tileIds:a.formed.map(t=>t.id)}];b.batches=b.formed.map(t=>({kind:'play',tileIds:[t.id]}));
 assert.equal(E.currentSettlementPreview(a).total,E.currentSettlementPreview(b).total);
});
test('single seal pays only first four qualifying entries, and process points are not multiplied again',()=>{
 const s=playing('mcr',3,'single_seal');for(let i=0;i<5;i++)assert.ok(E.commit(s,[s.hand[0].id]).valid);
 assert.equal(s.singleCount,4);assert.equal(s.processScore,80);assert.equal(s.totalScore,80);
 const t=final();E.addRelic(t,'single_seal');t.processScore=80;t.score=80;t.totalScore=80;
 const p=E.currentSettlementPreview(t);assert.equal(p.cumulativeAfter,80+p.total);assert.equal(p.roundScore,80+p.total);
});
test('replacement is finite, never pays single bonus, and preserves entity conservation',()=>{
 const s=playing('mcr',4,'single_seal');E.commit(s,[s.hand[0].id]);const score=s.totalScore,old=s.formed[0].id,newId=s.hand[0].id;
 assert.ok(E.replaceFormed(s,[old],[newId]).ok);assert.equal(s.totalScore,score);assert.equal(s.swaps,6);assert.ok(s.discard.some(t=>t.id===old));assert.ok(s.formed.find(t=>t.id===newId).entered);
 assert.ok(E.exchange(s,[s.hand[0].id]));assert.equal(s.swaps,5);
 s.swaps=0;const before=JSON.stringify(s);assert.equal(E.replaceFormed(s,[newId],[s.hand[0].id]).ok,false);assert.equal(JSON.stringify(s),before);structuralEntities(s);
});
test('invalid ids and capacity errors never consume state or resources',()=>{
 const s=playing(),id=s.hand[0].id,before=JSON.stringify(s);
 assert.equal(E.commit(s,[id,id]).valid,false);assert.equal(E.commit(s,['missing']).valid,false);assert.equal(E.exchange(s,[id,id]),false);assert.equal(JSON.stringify(s),before);
 const full=final(),beforeFull=JSON.stringify(full);assert.equal(E.commit(full,[full.hand[0].id]).valid,false);assert.equal(JSON.stringify(full),beforeFull);
});
test('kong declaration counts four physical tiles as three structural slots, locked once',()=>{
 const s=arrange(playing(),[0,0,0,0,10,11,12,22,23,24,33,33,33,27,27]);
 // Directly prepared 15 tiles become legal atomically upon explicit declaration.
 assert.equal(E.currentSettlementPreview(s).valid,false);
 const ids=s.formed.filter(t=>t.face===0).map(t=>t.id);assert.ok(E.declareKong(s,ids).ok);assert.equal(E.structuralCount(s),14);assert.equal(s.formed.length,15);
 E.addRelic(s,'kong_cauldron');E.addRelic(s,'stone');const p=E.currentSettlementPreview(s);assert.ok(p.legal);assert.equal(p.gains.find(g=>g.id==='kong_cauldron').value,60);assert.equal(p.gains.find(g=>g.id==='stone').value,120);
 assert.equal(E.declareKong(s,ids).ok,false);E.addRelic(s,'rank_brush');assert.equal(E.transform(s,[ids[0]],'rank',1).ok,false);assert.equal(E.replaceFormed(s,[ids[0]],[s.hand[0].id]).ok,false);structuralEntities(s);
});
test('append fourth candidate to a formed pung atomically and replenish only the incoming tile',()=>{
 const s=final('mcr',[0,0,0,10,11,12,22,23,24,33,33,33,27,27]);const incoming=bring(s,[0])[0],wall=s.deck.length,oldCandidates=s.hand.filter(t=>t.id!==incoming).map(t=>t.id);
 const ids=[...s.formed.filter(t=>t.face===0).map(t=>t.id),incoming];assert.ok(E.declareKong(s,ids).ok);
 assert.equal(s.formed.length,15);assert.equal(E.structuralCount(s),14);assert.equal(s.deck.length,wall-1);assert.equal(s.hand.length,E.DRAW_BATCH_SIZE);
 assert.ok(oldCandidates.every(id=>s.hand.some(t=>t.id===id)));assert.equal(s.discard.length,0);structuralEntities(s);
});
test('kong spanning both zones validates prospective capacity and has no immediate reward',()=>{
 const s=arrange(playing(),[1,1]);const ids=[...s.formed.map(t=>t.id),...bring(s,[1,1])];E.addRelic(s,'single_seal');E.addRelic(s,'kong_cauldron');const before=s.totalScore,wall=s.deck.length;
 assert.ok(E.declareKong(s,ids).ok);assert.equal(s.totalScore,before);assert.equal(E.structuralCount(s),3);assert.equal(s.deck.length,wall-2);assert.equal(s.hand.length,12);structuralEntities(s);
});
test('fourteen single plays retain candidates and seven exchanges cap ordinary exposure at 61 tiles',()=>{
 for(const mode of ['mcr','riichi']){
  const s=playing(mode),seen=new Set(s.hand.map(t=>t.id));assert.equal(E.DRAW_BATCH_SIZE,12);assert.equal(s.hand.length,12);assert.equal(s.deck.length,124);
  for(let exchange=0;exchange<7;exchange++){
   assert.ok(E.exchange(s,s.hand.slice(0,5).map(t=>t.id)));
   for(const tile of s.hand)seen.add(tile.id);
  }
  assert.equal(s.swaps,0);assert.equal(seen.size,47);
  for(let step=1;step<=14;step++){
   const chosen=s.hand[0].id,unused=s.hand.slice(1).map(t=>t.id);
   assert.ok(E.commit(s,[chosen]).valid);assert.ok(unused.every(id=>s.hand.some(t=>t.id===id)));
   assert.equal(s.hand.filter(t=>!seen.has(t.id)).length,1);for(const tile of s.hand)seen.add(tile.id);
   assert.equal(s.hand.length,12);assert.equal(s.deck.length,136-47-step);
   assert.equal(E.structuralCount(s),step);structuralEntities(s);
  }
  assert.equal(seen.size,61);assert.equal(s.discard.length,35);assert.equal(s.deck.length,75);assert.equal(s.phase,'play');assert.ok(E.restore(JSON.stringify(s)));
  const before=JSON.stringify(s);assert.equal(E.exchange(s,[s.hand[0].id]),false);assert.equal(JSON.stringify(s),before);
 }
});
test('partial exchanges and repairs keep unselected candidates and formed-only kong does not draw',()=>{
 const s=playing(),selected=s.hand.slice(0,2).map(t=>t.id),kept=s.hand.slice(2).map(t=>t.id),wall=s.deck.length;
 assert.ok(E.exchange(s,selected));assert.ok(kept.every(id=>s.hand.some(t=>t.id===id)));assert.equal(s.deck.length,wall-2);assert.equal(s.hand.length,12);
 assert.ok(E.commit(s,[s.hand[0].id]).valid);const repairKept=s.hand.slice(1).map(t=>t.id),repairWall=s.deck.length;
 assert.ok(E.replaceFormed(s,[s.formed[0].id],[s.hand[0].id]).ok);assert.ok(repairKept.every(id=>s.hand.some(t=>t.id===id)));assert.equal(s.deck.length,repairWall-1);assert.equal(s.hand.length,12);structuralEntities(s);
 const k=arrange(playing(),[0,0,0,0]),beforeCandidates=JSON.stringify(k.hand),beforeWall=k.deck.length;
 assert.ok(E.declareKong(k,k.formed.map(t=>t.id)).ok);assert.equal(JSON.stringify(k.hand),beforeCandidates);assert.equal(k.deck.length,beforeWall);structuralEntities(k);
 const oversized=playing();oversized.hand.push(oversized.deck.pop());assert.equal(E.restore(JSON.stringify(oversized)),null);
});
test('seven base exchanges preserve wind, ink and third-round resource modifiers',()=>{
 const s=playing();assert.equal(s.swaps,7);assert.equal(s.ink,4);
 assert.ok(E.addRelic(s,'wind'));assert.equal(s.swaps,9);assert.ok(E.addRelic(s,'ink'));assert.equal(s.ink,6);
 assert.equal(E.addRelic(s,'wind'),false);assert.equal(s.swaps,9);
 s.round=2;E.startRound(s);assert.equal(s.swaps,7);assert.equal(s.ink,6);
 const plain=playing();plain.round=2;E.startRound(plain);assert.equal(plain.swaps,5);assert.equal(plain.ink,4);
});
test('risk distinguishes incomplete from unrepairable-by-addition and recognizes prospective kongs',()=>{
 const s=arrange(playing(),[0,1,2,3,4,5,15,16,17,27,27,28]);assert.equal(E.inspect(s).canComplete,true);
 const west=bring(s,[29]);assert.equal(E.inspect(s,west).risk,'needs_repair');assert.equal(E.commit(s,west).valid,true);
 const k=arrange(playing(),[0,0,0,0,9,10,11,18,19,20,27,27,27,28]);
 assert.equal(E.inspect(k).legal,false);assert.equal(E.inspect(k).canComplete,true); // declare kong, then add east pair's matching south
 assert.equal(E.inspect(k).risk,'safe');
});
test('risk includes seven pairs and a single suit-wild assignment',()=>{
 const s=arrange(playing(),[0,0,2,2,4,4,6,6,8,8,10,10,21]);assert.ok(E.inspect(s).canComplete);
 const t=final('mcr',[0,1,11,3,4,5,6,7,8,27,27,27,28,28]);E.addRelic(t,'wild_jade');const id=t.formed.find(x=>x.face===11).id;assert.ok(E.transform(t,[id],'wild').ok);assert.ok(E.inspect(t).legal);
});
test('modifiers require owned relic, keep IDs and original supply, and allow over-four effective faces',()=>{
 const s=arrange(playing(),[0,0,0,0,1],'hand');const id=s.hand.find(t=>t.face===1).id,ink=s.ink;
 assert.equal(E.transform(s,[id],'rank',-1).ok,false);assert.equal(s.ink,ink);E.addRelic(s,'rank_brush');assert.ok(E.transform(s,[id],'rank',-1).ok);
 assert.equal(s.hand.filter(t=>t.face===0).length,5);assert.equal(s.hand.find(t=>t.id===id).original,1);assert.equal(s.ink,3);structuralEntities(s);
 assert.equal(E.transform(s,[id],'rank',-1).ok,false);assert.equal(s.ink,3);
});
test('wildcard is rank-fixed, assigned consistently once, and may be explicitly removed',()=>{
 const s=final('mcr',[0,1,11,3,4,5,6,7,8,27,27,27,28,28]);E.addRelic(s,'wild_jade');E.addRelic(s,'seal');E.addRelic(s,'suit_ribbon');E.addRelic(s,'rank_brush');
 const tile=s.formed.find(t=>t.face===11),id=tile.id;assert.ok(E.transform(s,[id],'wild').ok);assert.equal(s.ink,2);
 const p=E.currentSettlementPreview(s);assert.ok(p.legal);assert.equal(p.wildcardAssignments[0].face,2);assert.equal(p.decomposition.tiles.find(t=>t.id===id).face,2);assert.equal(tile.face,11);assert.equal(p.gains.find(g=>g.id==='seal').value,90);
 assert.equal(E.transform(s,[s.formed[0].id],'wild').ok,false);assert.ok(E.transform(s,[id],'rank',1).ok);assert.equal(tile.wild,true);assert.equal(E.rank(tile),4);
 assert.ok(E.transform(s,[id],'suit',0).ok);assert.equal(tile.wild,false);assert.equal(tile.face,3);assert.equal(s.wildUsed,1);
});
test('wildcard may join a declared numerical kong and its assignment is locked',()=>{
 const s=playing();E.addRelic(s,'wild_jade');const ids=bring(s,[0,0,0,9]);assert.ok(E.transform(s,[ids[3]],'wild').ok);assert.ok(E.declareKong(s,ids).ok);
 assert.equal(s.kongs[0].face,0);assert.equal(s.formed.find(t=>t.id===ids[3]).face,0);assert.equal(E.restore(JSON.stringify(s)).kongs[0].face,0);
});
test('best supported explanation includes relics rather than choosing a fixed decomposition',()=>{
 const faces=[10,10,11,11,12,12,13,13,14,14,15,15,16,16],s=final('riichi',faces);E.addRelic(s,'pair');
 const options=decompose(s.formed,s.kongs);assert.ok(options.some(d=>d.shape==='normal'));assert.ok(options.some(d=>d.shape==='pairs'));
 // Exponential yaku favor the normal interpretation until the wheel relic changes the best result.
 assert.equal(E.currentSettlementPreview(s).decomposition.shape,'normal');E.addRelic(s,'wheel');
 const p=E.currentSettlementPreview(s);assert.equal(p.decomposition.shape,'pairs');assert.ok(p.gains.some(g=>g.id==='pair'));assert.deepEqual(p,E.currentSettlementPreview(s));
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
test('false win deducts cumulative score, can pass exactly at threshold, and never grants legal-hand rewards',()=>{
 const s=final('mcr',invalid);E.addRelic(s,'river');E.addRelic(s,'stone');s.roundTarget=1000;s.roundStartScore=1100;s.totalScore=1100;
 const coins=s.coins,growth=s.growth.river,p=E.currentSettlementPreview(s);assert.ok(p.valid);assert.equal(p.legal,false);assert.equal(p.penalty,100);assert.equal(p.cumulativeAfter,1000);assert.equal(p.passed,true);assert.equal(p.total,0);
 E.settle(s);assert.equal(s.growth.river,growth);assert.equal(s.bestHand,0);assert.equal(s.coins,coins+p.rewardCoins);assert.equal(s.score,-100);assert.equal(s.totalScore,1000);assert.ok(E.finishSettlement(s));assert.equal(s.phase,'reward');
 const below=final('mcr',invalid);below.roundTarget=1000;below.roundStartScore=1099;below.totalScore=1099;E.settle(below);E.finishSettlement(below);assert.equal(below.phase,'defeat');
});
test('negative score is retained and legal but under-target is a separate terminal result',()=>{
 const bad=final('mcr',invalid);E.settle(bad);assert.equal(bad.totalScore,-30);assert.equal(bad.score,-30);assert.ok(E.restore(JSON.stringify(bad)));
 const good=final();good.roundTarget=999999;const p=E.settle(good);assert.equal(p.legal,true);assert.equal(p.penalty,0);assert.equal(p.passed,false);E.finishSettlement(good);assert.equal(good.phase,'defeat');
});
test('full seven-round boundary and cross-round carry preserve cumulative score and reset transient resources',()=>{
 const s=final();E.settle(s);E.finishSettlement(s);const earned=s.totalScore,id=s.offers[0];assert.ok(E.chooseReward(s,id));assert.equal(E.chooseReward(s,id),false);
 s.coins=100;const purchase=s.shop[0];assert.ok(E.buy(s,purchase));assert.equal(E.buy(s,purchase),false);assert.ok(E.nextRound(s));
 assert.equal(s.totalScore,earned);assert.equal(s.roundStartScore,earned);assert.equal(s.score,0);assert.equal(s.formed.length,0);assert.equal(s.wildUsed,0);assert.equal(s.singleCount,0);assert.equal(s.roundTarget,E.TARGETS.mcr[1]);assert.ok(E.restore(JSON.stringify(s)));
 const end=final();end.round=5;end.roundTarget=100;E.settle(end);E.finishSettlement(end);assert.equal(end.phase,'victory');assert.equal(E.nextRound(end),false);
});
test('saved in-flight settlement restores without a duplicate payout or reward draw',()=>{
 const s=final();E.settle(s);const restored=E.restore(JSON.stringify(s));assert.ok(restored);const before=JSON.stringify(restored);E.settle(restored);assert.equal(JSON.stringify(restored),before);assert.ok(E.finishSettlement(restored));assert.equal(restored.phase,'reward');
});
test('legacy, damaged and forged settlement saves are rejected',()=>{
 const s=playing();assert.equal(E.VERSION,4);assert.equal(s.rulesVersion,'free-play-v4');assert.equal(s.scoreVersion,'exponential-v3');assert.ok(E.restore(JSON.stringify(s)));
 const legacy=JSON.stringify({...s,version:3,rulesVersion:'free-play-v3'});
 assert.equal(E.restore(legacy),null);assert.equal(E.restore(JSON.stringify({...s,version:1})),null);
 assert.equal(E.restore(JSON.stringify({...s,rulesVersion:'free-play-v3'})),null);assert.equal(E.restore(JSON.stringify({...s,scoreVersion:'obsolete'})),null);
 for(const bad of [{...s,hand:null},{...s,deck:[]},{...s,score:'x'},{...s,relics:['jade','jade']},{...s,totalScore:7}])assert.equal(E.restore(JSON.stringify(bad)),null);
 const finished=final();E.settle(finished);const malformed=structuredClone(finished);malformed.last.passed=!malformed.last.passed;assert.equal(E.restore(JSON.stringify(malformed)),null);
});
test('all mathematical steps are replayable and end at authoritative base/multiplier totals',()=>{
 const s=final();for(const id of ['river','coin','echo','reserve'])E.addRelic(s,id);const p=E.currentSettlementPreview(s);let base=0,mult=1;
 for(const step of p.steps){if(step.target==='base'){assert.equal(step.before,base);base=step.after;}if(step.target==='multiplier'){assert.equal(step.before,mult);mult=step.after;}}
 assert.equal(base,p.base);assert.equal(mult,p.mult);assert.equal(Math.floor(base*mult+1e-8),p.total);
 assert.equal(p.steps[0].event,'hand_reveal');assert.equal(p.steps.at(-1).event,'round_result');
 const q=E.currentSettlementPreview(final('mcr',invalid));assert.deepEqual(q.steps.map(s=>s.event),['hand_reveal','false_hu','round_result']);
});
test('seeds preserve a 136-instance deck through free play, exchange, and restoration',()=>{
 for(const mode of ['mcr','riichi'])for(let seed=1;seed<=20;seed++){
  const s=playing(mode,seed);E.commit(s,[s.hand[0].id,s.hand[1].id]);assert.ok(E.exchange(s,s.hand.slice(0,5).map(t=>t.id)));structuralEntities(s);assert.ok(E.restore(JSON.stringify(s)));assert.notEqual(E.inspect(s).risk,'unknown');
 }
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
test('empty wall does not prohibit replacing with available tiles or spend swap on a failed exchange',()=>{
 const s=arrange(playing(),[0,1,2]);s.discard.push(...s.deck);s.deck=[];
 const swaps=s.swaps,id=s.hand[0].id;assert.equal(E.exchange(s,[id]),false);assert.equal(s.swaps,swaps);
 assert.ok(E.replaceFormed(s,[s.formed[0].id],[id]).ok);assert.equal(s.swaps,swaps-1);assert.equal(s.hand.length,E.DRAW_BATCH_SIZE-1);structuralEntities(s);
});
test('depleted relic pool never traps a passed round in an empty reward screen',()=>{
 const s=final();s.relics=E.RELICS.map(r=>r.id);E.settle(s);assert.equal(s.offers.length,0);assert.ok(E.finishSettlement(s));assert.equal(s.phase,'shop');assert.ok(E.nextRound(s));
});


test('Riichi opening threshold accepts a basic legal no-yaku hand and exponential-mode gates increase',()=>{
 const s=final('riichi',[0,1,2,11,12,13,23,24,25,6,7,8,10,10]);s.relics=[];
 const p=E.currentSettlementPreview(s);assert.ok(p.legal);assert.equal(p.fans,0);assert.equal(p.total,240);assert.equal(p.target,240);assert.equal(p.passed,true);
 assert.deepEqual(E.TARGETS.riichi.slice(1),[1200,5000,18000,75000,300000]);
 assert.deepEqual(E.TARGETS.mcr,[300,1800,8000,40000,180000,1000000]);
});

test('terminal/honor regressions and special structures score real supported patterns',()=>{
 const screenshot=E.currentSettlementPreview(final('riichi',[0,0,0,17,17,17,26,26,26,27,27,27,28,28]));
 assert.deepEqual(new Set(names(screenshot.patterns)),new Set(['混老头','对对和']));assert.equal(screenshot.fans,4);assert.equal(screenshot.mult,4);
 const pure=E.currentSettlementPreview(final('riichi',[0,0,0,8,8,8,9,9,9,17,17,17,18,18]));
 assert.deepEqual(names(pure.patterns),['清老头']);assert.equal(pure.fans,13);
 const orphans=[0,8,9,17,18,26,27,28,29,30,31,32,33,0];
 for(const mode of ['mcr','riichi'])assert.ok(names(E.currentSettlementPreview(final(mode,orphans)).patterns).includes(mode==='mcr'?'十三幺':'国士无双'));
 const knit=[0,3,6,10,13,16,20,23,26];
 const unconnected=E.currentSettlementPreview(final('mcr',[...knit,27,28,29,30,31]));
 assert.ok(unconnected.legal);assert.ok(names(unconnected.patterns).includes('全不靠'));assert.ok(names(unconnected.patterns).includes('组合龙'));
});
test('exponential fan growth and large authoritative payouts survive restore without double payment',()=>{
 assert.equal(E.fanMultiplier('riichi',4),4);assert.equal(E.fanMultiplier('riichi',8),16);
 assert.equal(E.fanMultiplier('mcr',24),8);assert.equal(E.fanMultiplier('mcr',48),64);assert.equal(E.fanMultiplier('mcr',88),2048);
 const s=final('mcr',[27,27,27,28,28,28,29,29,29,30,30,30,31,31]);
 const fourth=bring(s,[27])[0];assert.ok(E.declareKong(s,[...s.formed.filter(t=>t.face===27).map(t=>t.id),fourth]).ok);
 const p=E.settle(s);assert.ok(p.valid&&p.legal&&p.total>100000000);assert.ok(Number.isSafeInteger(p.total));
 assert.equal(p.total,Number(BigInt(p.base)*BigInt(p.mult.toFixed(6).replace('.',''))/1000000n));
 const restored=E.restore(JSON.stringify(s));assert.ok(restored);const before=JSON.stringify(restored);E.settle(restored);assert.equal(JSON.stringify(restored),before);
 assert.equal(E.restore(JSON.stringify({...s,version:2})),null);
});


test('build hints count only committed material, keep wilds conservative, and never mutate state',()=>{
 const s=arrange(playing('riichi'),Array.from({length:6},(_,i)=>[10+i,10+i]).flat());s.relics=['wheel','pair','echo'];bring(s,[16,16]);
 const before=JSON.stringify(s),h=buildHints(s);assert.equal(JSON.stringify(s),before);assert.equal(h.legal,null);assert.deepEqual(h.activeIds,[]);
 assert.match(h.rows.find(r=>r.id==='wheel').progress,/6\/7/);
 s.formed[0].wild=true;assert.match(buildHints(s).rows.find(r=>r.id==='wheel').progress,/5\/7/);
 const overlaps=arrange(playing('riichi'),[0,1,2,3]);overlaps.relics=['echo'];assert.match(buildHints(overlaps).rows[0].progress,/1\/3 面子/);
 const four=arrange(playing('mcr'),[10,10,10,10]);four.relics=['pair'];assert.match(buildHints(four).rows[0].progress,/2\/7/);four.mode='riichi';assert.match(buildHints(four).rows[0].progress,/1\/7/);
});
test('build activation follows the actual best settlement and merges a relic base with its multiplier',()=>{
 const s=final('riichi',Array.from({length:7},(_,i)=>[10+i,10+i]).flat());s.relics=['mirror','pair','echo','wheel'];
 const before=JSON.stringify(s),p=E.currentSettlementPreview(s),h=buildHints(s,p);assert.equal(JSON.stringify(s),before);assert.equal(p.total,48875);assert.equal(h.legal,true);
 assert.deepEqual([...h.activeIds].sort(),['echo','mirror','pair','wheel']);assert.ok(h.rows.every(r=>r.state==='active'));
 const j=final('riichi',[1,1,1,4,4,4,7,7,7,10,10,10,13,13]);j.relics=['jiang'];const row=buildHints(j).rows[0];assert.match(row.effect,/84/);assert.match(row.effect,/2.5/);
 s.relics=['jade','pair'];const switched=buildHints(s);assert.equal(E.currentSettlementPreview(s).decomposition.shape,'normal');assert.equal(switched.rows.find(r=>r.id==='pair').state,'inactive');
});
test('invalid completed hands deactivate scoring hints while keeping repair abilities available',()=>{
 const s=final('riichi',invalid);s.relics=['wheel','rank_brush','wind'];const before=JSON.stringify(s),h=buildHints(s);
 assert.equal(h.legal,false);assert.deepEqual(h.activeIds,[]);assert.equal(h.rows.find(r=>r.id==='wheel').state,'inactive');assert.equal(h.rows.find(r=>r.id==='rank_brush').state,'support');assert.equal(h.rows.find(r=>r.id==='wind').state,'support');assert.equal(JSON.stringify(s),before);
});
