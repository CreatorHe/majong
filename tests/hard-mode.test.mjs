import test from 'node:test';
import assert from 'node:assert/strict';
import * as H from '../dist/hard/engine.js';
import * as Easy from '../dist/engine.js';
import { FIRST_COMPATIBLE } from '../dist/hard/balance.js';
import { buildSettlementSnapshot } from '../dist/hard/settlement-adapter.js';
import { validateSnapshot } from '../dist/settlement/player.js';

const flush = [0,1,2,3,4,5,6,7,8,1,2,3,4,4];
const pungs = [1,1,1,4,4,4,16,16,16,20,20,20,14,14];
const invalid = [0,1,2,3,4,5,15,16,17,27,27,28,29,30];
function prepared(mode='mcr',core='core_high') {
  const state=H.newRun(mode,7);
  assert.ok(H.chooseStarter(state,core));
  return state;
}
function arrange(state,faces) {
  const all=[...state.hand,...state.formed,...state.deck,...state.discard];
  state.formed=[];state.hand=[];state.discard=[];state.kongs=[];
  for(const face of faces){const i=all.findIndex(t=>t.face===face);assert.ok(i>=0);const tile=all.splice(i,1)[0];tile.entered=true;state.formed.push(tile);}
  state.deck=all;
  while(state.hand.length<12&&state.deck.length)state.hand.push(state.deck.pop());
  H.sortHand(state);
  return state;
}
function finished(mode='mcr',core='core_high',faces=flush){const state=prepared(mode,core);H.beginPlay(state);return arrange(state,faces);}

test('hard V5 and easy V9 restore only their own saves and retain independent rules',()=>{
  for(const mode of ['mcr','riichi'])for(const core of H.CORE_IDS){
    const state=H.newRun(mode,7);
    assert.equal(state.variant,'hard_v5');assert.equal(state.version,5);
    assert.equal(state.rulesVersion,'opening-build-v5');assert.equal(state.scoreVersion,'four-core-v5');
    assert.deepEqual(state.offers,H.CORE_IDS);assert.ok(H.restore(JSON.stringify(state)));
    assert.ok(H.chooseStarter(state,core));assert.equal(state.hand.length,12);assert.equal(state.ink,4);
    assert.deepEqual(state.relics,[core]);assert.ok(H.restore(JSON.stringify(state)));
    assert.equal(Easy.restore(JSON.stringify(state)),null);
    assert.equal(H.restore(JSON.stringify({...state,variant:undefined})),null);
    assert.equal(H.restore(JSON.stringify({...state,variant:'easy_v9'})),null);
  }
  const easy=Easy.newRun('mcr',7);
  assert.equal(easy.hand.length,9);assert.equal(H.restore(JSON.stringify(easy)),null);
  assert.deepEqual(H.TARGETS.mcr,[200,500,1000,2500,5500,12000]);
  assert.deepEqual(H.TARGETS.riichi,H.TARGETS.mcr);
});

test('hard V5 keeps unplayed candidates and limits all ordinary exchanges to preparation',()=>{
  for(const mode of ['mcr','riichi']){
    const state=prepared(mode),seen=new Set(state.hand.map(t=>t.id));
    assert.equal(H.exchange(state,state.hand.slice(0,6).map(t=>t.id)),false);
    for(let i=0;i<5;i++){assert.ok(H.exchange(state,state.hand.slice(0,5).map(t=>t.id)));state.hand.forEach(t=>seen.add(t.id));}
    assert.equal(seen.size,37);assert.equal(H.exchange(state,[state.hand[0].id]),false);
    assert.ok(H.beginPlay(state));assert.equal(state.swaps,0);
    for(let i=0;i<14;i++){
      const kept=state.hand.slice(1).map(t=>t.id);
      assert.ok(H.commit(state,[state.hand[0].id]).valid);
      assert.ok(kept.every(id=>state.hand.some(t=>t.id===id)));state.hand.forEach(t=>seen.add(t.id));
    }
    assert.equal(seen.size,51);assert.equal(state.deck.length,85);assert.equal(state.discard.length,25);
    assert.equal(state.hand.length,12);assert.equal(H.structuralCount(state),14);
    assert.equal(H.exchange(state,[state.hand[0].id]),false);
    assert.equal(H.transform(state,[state.hand[0].id],'rank',1).ok,false);
    assert.equal(H.replaceFormed(state,[state.formed[0].id],[state.hand[0].id]).ok,false);
    const all=[...state.hand,...state.formed,...state.deck,...state.discard];
    assert.equal(all.length,136);assert.equal(new Set(all.map(t=>t.id)).size,136);
    assert.ok(H.restore(JSON.stringify(state)));
  }
});

test('four hard routes retain V5 scoring in both modes and share compatible settlement presentation',()=>{
  // Reference outcomes from the published V5 a31de09, fixed physical hands (not playtest success rates).
  const expected={mcr:[30720,29503,2232,3837],riichi:[184320,59006,3214,5526]};
  for(const mode of ['mcr','riichi'])for(const [index,core] of H.CORE_IDS.entries()){
    const state=finished(mode,core,core==='core_pung'?pungs:flush),raw=JSON.stringify(state);
    const result=H.currentSettlementPreview(state);assert.equal(JSON.stringify(state),raw);
    assert.equal(result.total,expected[mode][index]);assert.equal(result.legal,true);
    assert.ok(result.gains.some(g=>g.id===core));
    assert.equal(result.growthCoreAfter,core==='core_growth'?374.777442:200);
    H.settle(state);const paid=JSON.stringify(state);H.settle(state);assert.equal(JSON.stringify(state),paid);
    const snapshot=buildSettlementSnapshot(state);assert.doesNotThrow(()=>validateSnapshot(snapshot));
    assert.equal(snapshot.totals.handScoreText,new Intl.NumberFormat('zh-CN').format(result.total));
    assert.equal(snapshot.presentation.baseLabel,undefined);assert.equal(snapshot.presentation.formulaNote,undefined);
    assert.ok(H.restore(JSON.stringify(state)));
  }
});

test('hard V5 supplies one compatible reward, caps four slots and never replaces the core',()=>{
  for(const core of H.CORE_IDS){
    const state=finished('mcr',core);H.settle(state);H.finishSettlement(state);
    assert.equal(state.phase,'reward');assert.equal(state.offers.length,3);
    assert.ok(state.offers.includes(FIRST_COMPATIBLE[core]));
    assert.ok(H.chooseReward(state,FIRST_COMPATIBLE[core]));assert.equal(state.relics.length,2);
    assert.equal(H.chooseReward(state,state.offers[0]),false);
    assert.ok(H.nextRound(state));assert.equal(state.phase,'prepare');assert.equal(state.swaps,5);
    assert.ok(H.restore(JSON.stringify(state)));
  }
  const full=finished('mcr','core_pung');full.relics.push('jade','stone','rank_brush');H.settle(full);H.finishSettlement(full);
  const reward=full.offers[0];assert.equal(H.chooseReward(full,reward),false);
  assert.equal(H.chooseReward(full,reward,'core_pung'),false);
  assert.ok(H.chooseReward(full,reward,'rank_brush'));assert.equal(full.relics.length,4);
});

test('hard V5 cumulative false-hu boundary and six-round completion remain intact',()=>{
  for(const before of [1100,1099]){
    const state=finished('mcr','core_growth',invalid);state.roundTarget=1000;state.roundStartScore=before;state.totalScore=before;
    const growth=state.growth.coreGrowth,p=H.settle(state);
    assert.equal(p.penalty,100);assert.equal(state.totalScore,before-100);assert.equal(state.growth.coreGrowth,growth);
    assert.equal(p.passed,before===1100);assert.ok(H.restore(JSON.stringify(state)));
  }
  for(const mode of ['mcr','riichi']){
    const state=prepared(mode);
    for(let i=0;i<6;i++){
      assert.equal(state.round,i);assert.equal(state.phase,'prepare');H.beginPlay(state);arrange(state,flush);
      const before=state.totalScore,p=H.settle(state);assert.ok(p.passed);assert.equal(state.totalScore,before+p.total);
      assert.ok(H.finishSettlement(state));
      if(i<5){assert.equal(state.phase,'reward');assert.ok(H.skipReward(state));assert.ok(H.nextRound(state));}
      else assert.equal(state.phase,'victory');
    }
    assert.equal(H.nextRound(state),false);assert.ok(H.restore(JSON.stringify(state)));
  }
});
