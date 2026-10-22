// V7 acquisition; V6 score curves and thresholds. Keep mechanics, scoring and acquisition tuning in one place.
// These are playtest parameters, not claims of final four-route balance.
export const CORE_IDS = ['core_high', 'core_pung', 'core_held', 'core_growth'];
export const STARTER_RELIC_ID = 'rank_brush';
export const BALANCE = {
  handSize: 12,
  openingExchanges: 5,
  openingExchangeSize: 5,
  ink: 2,
  editCost: 2,
  relicSlots: 4,
  highRescueSize: 3,
  // Store growth and bonuses in these units; scale once when adding score.
  baseScale: 10,
  tileBase: 10,
  honorBase: 15,
  completeBase: 100,
  jadeBase: 80,
  riverBase: 8,
  suitBase: 10,
  pairBase: 100,
  jiangBase: 6,
  mountainBase: 20,
  kongBase: 60,
  singleBase: 20,
  pungFactor: 2.8,
  stoneBase: 60,
  heldFactor: 1.26,
  heldBaseCount: 9,
  heldBurstFactor: 2,
  growthSeed: 200,
  growthRate: 1.17,
  highGlobalFactor: 1,
  summitMultiplier: 0.8,
  // Discrete thresholds, then a linear tail above the final anchor.
  highAnchors: {
    mcr: [[0,1],[1,2],[2,4],[4,12],[8,32],[16,96],[24,256],[32,512],[48,1024],[64,2048],[88,4096]],
    riichi: [[0,1],[1,12],[2,24],[3,48],[4,96],[5,192],[6,384],[8,768],[11,1024],[13,2048]],
  },
};
export const TARGETS = {
  mcr: [1000,5000,12000,30000,80000,180000],
  riichi: [200,500,1000,2500,5500,12000],
};
export const DISABLED_RELIC_IDS = ['wind', 'growth', 'reserve', 'ink', 'wild_jade'];
export const COMPATIBLE_RELICS = {
  core_high: ['high_rescue','rank_brush','suit_ribbon','jade'],
  core_pung: ['retrigger_meld','stone','mountain','kong_cauldron','rank_brush','jade'],
  core_held: ['retrigger_held','jade','rank_brush','suit_ribbon'],
  core_growth: ['retrigger_meld','jade','rank_brush','suit_ribbon','river'],
};
export const FIRST_COMPATIBLE = {
  core_high: 'high_rescue', core_pung: 'retrigger_meld',
  core_held: 'retrigger_held', core_growth: 'retrigger_meld',
};
export function highFanMultiplier(mode, fans) {
  if(fans<=0)return 1;
  const points=BALANCE.highAnchors[mode];
  const [lastFan,lastMult]=points.at(-1);
  const value=fans>lastFan?lastMult*fans/lastFan:[...points].reverse().find(([threshold])=>fans>=threshold)[1];
  return Math.max(1+fans/(mode==='mcr'?8:1),value*BALANCE.highGlobalFactor);
}
