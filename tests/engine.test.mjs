import test from 'node:test';
import assert from 'node:assert/strict';
import * as E from '../dist/engine.js';
import {highFanMultiplier} from '../dist/balance.js';
import {decompose,canCompleteByAdding} from '../dist/hand-rules.js';
const names=ps=>ps.map(p=>p.name);
const preparing=(mode='mcr',seed=7,extras=[])=>{const s=E.newRun(mode,seed);s.relics.push(...extras);return s;};
const playing=(mode='mcr',seed=7,extras=[])=>{const s=preparing(mode,seed,extras);E.beginPlay(s);return s;};
const flush=[0,1,2,3,4,5,6,7,8,1,2,3,4,4];
const invalid=[0,1,2,3,4,5,15,16,17,27,27,28,29,30];
function arrange(s,faces,zone='formed'){
 const all=[...s.hand,...s.formed,...s.deck,...s.discard],chosen=[];
 for(const face of faces){const i=all.findIndex(t=>t.face===face);assert.ok(i>=0);chosen.push(all.splice(i,1)[0]);}
 s.formed=[];s.hand=[];s.discard=[];s.kongs=[];
 for(const t of chosen)t.entered=zone==='formed';s[zone]=chosen;s.deck=all;
 while(s.hand.length<E.DRAW_BATCH_SIZE&&s.deck.length)s.hand.push(s.deck.pop());E.sortHand(s);return s;
}
const final=(mode='mcr',faces=flush)=>arrange(playing(mode),faces);
function bring(s,faces){const ids=[];for(const face of faces){let t=s.hand.find(t=>t.face===face&&!ids.includes(t.id));if(!t){const pool=s.deck.some(t=>t.face===face)?s.deck:s.discard;const i=pool.findIndex(t=>t.face===face);assert.ok(i>=0);t=pool.splice(i,1)[0];const oldAt=s.hand.findIndex(x=>!ids.includes(x.id)),old=s.hand.splice(oldAt,1)[0];if(old)s.deck.push(old);s.hand.push(t);}ids.push(t.id);}return ids;}
function conserved(s){const all=[...s.hand,...s.formed,...s.deck,...s.discard];assert.equal(all.length,136);assert.equal(new Set(all.map(t=>t.id)).size,136);for(let i=0;i<34;i++)assert.equal(all.filter(t=>t.original===i).length,4);assert.ok(E.restore(JSON.stringify(s)));}

test('V9 starts either mode directly in preparation with nine candidates and only a utility',()=>{
 for(const mode of ['mcr','riichi']){const s=preparing(mode);assert.equal(s.phase,'prepare');assert.equal(s.hand.length,9);assert.equal(s.deck.length,127);assert.deepEqual(s.relics,['rank_brush']);assert.deepEqual(s.offers,[]);conserved(s);
 const before=JSON.stringify(s);assert.equal(E.commit(s,[s.hand[0].id]).valid,false);assert.equal(E.settle(s).valid,false);assert.equal(E.chooseStarter(s,'core_high'),false);assert.equal(JSON.stringify(s),before);}
});
test('single plays discard every unselected candidate, refresh nine, and preserve all entities',()=>{
 const s=playing(),seen=new Set(s.hand.map(t=>t.id));
 for(let i=0;i<14;i++){const chosen=s.hand[0].id,discarded=s.hand.slice(1).map(t=>t.id),swaps=s.swaps;assert.ok(E.commit(s,[chosen]).valid);assert.ok(discarded.every(id=>s.discard.some(t=>t.id===id)));assert.equal(s.hand.length,9);assert.equal(s.swaps,swaps);s.hand.forEach(t=>seen.add(t.id));conserved(s);}
 assert.equal(seen.size,135);assert.equal(s.deck.length,1);assert.equal(s.discard.length,112);assert.equal(E.structuralCount(s),14);
 const before=JSON.stringify(s);assert.equal(E.exchange(s,[s.hand[0].id]),false);assert.equal(E.commit(s,[s.hand[0].id]).valid,false);assert.equal(JSON.stringify(s),before);
});
test('five selected-only exchanges share preparation/play budget and reject invalid operations atomically',()=>{
 const s=preparing();for(let i=0;i<5;i++){if(i===2)E.beginPlay(s);const ids=s.hand.slice(0,5).map(t=>t.id),kept=s.hand.slice(5).map(t=>t.id);assert.ok(E.exchange(s,ids));assert.ok(kept.every(id=>s.hand.some(t=>t.id===id)));conserved(s);}
 assert.equal(s.swaps,0);const before=JSON.stringify(s);assert.equal(E.exchange(s,[s.hand[0].id]),false);assert.equal(E.commit(s,[s.hand[0].id,s.hand[0].id]).valid,false);assert.equal(JSON.stringify(s),before);
});
test('rank suit and wild share one preparation edit, with ownership and physical identity preserved',()=>{
 for(const [action,tool] of [['rank','rank_brush'],['suit','suit_ribbon'],['wild','wild_jade']]){
  const s=preparing();const id=bring(s,[1])[0];if(tool!=='rank_brush'){assert.equal(E.transform(s,[id],action,1).ok,false);s.relics.push(tool);}
  assert.ok(E.transform(s,[id],action,1).ok);assert.equal(s.ink,0);assert.equal(s.hand.find(t=>t.id===id).original,1);conserved(s);
  const before=JSON.stringify(s);assert.equal(E.transform(s,[id],'rank',1).ok,false);assert.equal(JSON.stringify(s),before);E.beginPlay(s);
  const other=s.hand.find(t=>t.id!==id);assert.ok(E.commit(s,[other.id]).valid);assert.ok(s.discard.some(t=>t.id===id));conserved(s);
  const play=JSON.stringify(s);assert.equal(E.transform(s,[s.hand[0].id],action,1).ok,false);assert.equal(JSON.stringify(s),play);
 }
});
test('wild identity stays rank-fixed and can complete a suited sequence',()=>{
 const s=final('mcr',[0,1,11,3,4,5,6,7,8,1,2,3,4,4]);s.relics.push('wild_jade');s.formed.find(t=>t.face===11).wild=true;s.wildUsed=1;s.ink=0;
 const p=E.currentSettlementPreview(s);assert.ok(p.legal);assert.equal(p.wildcardAssignments.length,1);assert.equal(p.wildcardAssignments[0].face%9,2);conserved(s);
});
test('rescue needs only its utility and shares one use across prep editing or play exchange',()=>{
 const s=preparing('mcr',7,['high_rescue']),id=bring(s,[1])[0];assert.ok(E.highRescue(s,{type:'rank',ids:[id],arg:1}).ok);assert.equal(s.ink,0);assert.equal(s.rescueUsed,true);E.beginPlay(s);assert.equal(E.highRescue(s,{type:'exchange',ids:[s.hand[0].id]}).ok,false);conserved(s);
 const p=playing('riichi',7,['high_rescue']);assert.ok(E.highRescue(p,{type:'exchange',ids:p.hand.slice(0,3).map(t=>t.id)}).ok);assert.equal(p.swaps,5);conserved(p);
});
test('kongs refresh only when candidates enter, and lock four physical tiles into three positions',()=>{
 const s=playing(),ids=bring(s,[0,0,0,0]),wall=s.deck.length,discard=s.hand.filter(t=>!ids.includes(t.id)).map(t=>t.id);assert.ok(E.declareKong(s,ids).ok);assert.equal(s.deck.length,wall-9);assert.equal(E.structuralCount(s),3);assert.ok(discard.every(id=>s.discard.some(t=>t.id===id)));assert.equal(E.discardFormed(s,[ids[0]]).ok,false);conserved(s);
 const p=arrange(playing(),[0,0,0,0]),before=p.deck.length,hand=p.hand.map(t=>t.id);assert.ok(E.declareKong(p,p.formed.map(t=>t.id)).ok);assert.equal(p.deck.length,before);assert.deepEqual(p.hand.map(t=>t.id),hand);assert.equal(E.structuralCount(p),3);conserved(p);
});
test('four kongs support eighteen physical tiles with a legal fourteen-position hand',()=>{
 const s=playing();for(const face of [0,9,18,31])assert.ok(E.declareKong(s,bring(s,[face,face,face,face])).ok);
 assert.ok(E.commit(s,bring(s,[32,32])).valid);assert.equal(s.formed.length,18);assert.equal(E.structuralCount(s),14);assert.ok(E.currentSettlementPreview(s).legal);conserved(s);
});
test('formed discard is once per journey, draws nothing and survives subsequent rounds',()=>{
 const s=final();const wall=s.deck.length,ids=s.formed.slice(0,2).map(t=>t.id);assert.ok(E.discardFormed(s,ids).ok);assert.equal(s.deck.length,wall);assert.equal(E.structuralCount(s),12);conserved(s);
 const before=JSON.stringify(s);assert.equal(E.discardFormed(s,[s.formed[0].id]).ok,false);assert.equal(JSON.stringify(s),before);
 s.round++;E.startRound(s);assert.deepEqual(s.formedDiscard.tileIds,ids);conserved(s);
});
test('last short batch is consumed without recycling and exhausted incomplete hands can settle',()=>{
 const s=playing();for(let i=0;i<5;i++)assert.ok(E.exchange(s,s.hand.slice(0,5).map(t=>t.id)));
 let short=false;while(s.hand.length){if(s.hand.length<9)short=true;assert.ok(E.commit(s,[s.hand[0].id]).valid);conserved(s);}
 assert.ok(short);assert.ok(E.structuralCount(s)<14);assert.equal(s.deck.length,0);
 const p=E.settle(s);assert.equal(p.handResult,'incomplete');assert.equal(p.penalty,3200);assert.equal(p.total,0);assert.equal(p.passed,false);conserved(s);E.finishSettlement(s);assert.equal(s.phase,'defeat');
});
test('fan conversion is shared, independent of utilities/candidates/round and has no process bonuses',()=>{
 assert.equal(highFanMultiplier('mcr',24)*1000,256000);assert.equal(highFanMultiplier('mcr',88)*1000,4096000);assert.equal(highFanMultiplier('riichi',13)*1000,2048000);
 const s=final();const before=JSON.stringify(s),p=E.currentSettlementPreview(s);assert.equal(JSON.stringify(s),before);assert.equal(p.base,1000);assert.deepEqual(p.gains,[]);
 s.relics.push('suit_ribbon','wild_jade','high_rescue');s.round=5;s.roundTarget=E.TARGETS.mcr[5];assert.equal(E.currentSettlementPreview(s).total,p.total);
 const k=playing();E.commit(k,[k.hand[0].id]);assert.equal(k.totalScore,0);assert.equal(k.processScore,0);
});
test('riichi no-yaku is zero income without fraud penalty, with overflow progression',()=>{
 const faces=[0,1,2,9,10,11,21,22,23,15,16,17,4,4],s=final('riichi',faces);s.totalScore=s.roundStartScore=E.target(s);
 const p=E.settle(s);assert.equal(p.handResult,'no_yaku');assert.equal(p.legal,true);assert.equal(p.total,0);assert.equal(p.penalty,0);assert.ok(p.passed);conserved(s);
});
test('fraud applies ten percent and may pass with carry; repeated settlement is idempotent',()=>{
 const s=final('mcr',invalid);s.totalScore=s.roundStartScore=E.target(s)*2;
 const p=E.settle(s);assert.equal(p.handResult,'false_hu');assert.equal(p.penalty,3200);assert.ok(p.passed);const before=JSON.stringify(s);assert.deepEqual(E.settle(s),p);assert.equal(JSON.stringify(s),before);conserved(s);
});
test('six stages grant only unowned utilities and empty reward pool advances without a blank choice',()=>{
 const s=playing();for(let i=0;i<6;i++){arrange(s,[0,0,0,1,2,3,4,5,6,7,8,8,8,4]);const before=s.totalScore,p=E.settle(s);assert.ok(p.passed);assert.equal(s.totalScore,before+p.total);conserved(s);E.finishSettlement(s);
  if(i===5){assert.equal(s.phase,'victory');break;}
  if(i<3){assert.equal(s.phase,'reward');assert.equal(s.offers.length,3-i);assert.ok(s.offers.every(id=>!s.relics.includes(id)));assert.ok(E.chooseReward(s,s.offers[0]));assert.equal(s.offers.length,0);}
  else assert.equal(s.phase,'shop');assert.ok(E.nextRound(s));E.beginPlay(s);conserved(s);
 }
 assert.equal(s.relics.length,4);assert.equal(s.coins,0);
});
test('restore rejects old versions, scoring relics, resource forgery and altered settled totals',()=>{
 const s=preparing();for(const patch of [{version:8},{relics:['core_high','rank_brush']},{ink:1},{swaps:6},{processScore:1}])assert.equal(E.restore(JSON.stringify({...s,...patch})),null);
 const p=final();E.settle(p);assert.ok(E.restore(JSON.stringify(p)));const forged=JSON.parse(JSON.stringify(p));forged.last.cumulativeAfter++;assert.equal(E.restore(JSON.stringify(forged)),null);
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
