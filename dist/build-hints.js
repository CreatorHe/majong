import { relic, structuralCount } from './engine.js';
import { BALANCE } from './balance.js';
// Utility status only: no hidden-wall reads and no speculative score bonuses.
export function buildHints(state, preview) {
  const edits=state.phase==='prepare'?Math.floor(state.ink/BALANCE.editCost):0;
  const rows=state.relics.map(id=>({id,name:relic(id).name,state:'support',tileIds:[],
    progress:id==='high_rescue'?(state.rescueUsed?'本关已用':'本关未用'):state.phase==='prepare'?`本关可改 ${edits} 次`:'准备已结束',
    effect:id==='high_rescue'?'改牌／弃换二选一':'准备改牌',detail:relic(id).desc}));
  return {complete:structuralCount(state)===14,legal:preview?.valid?preview.legal:null,activeIds:[],rows};
}
