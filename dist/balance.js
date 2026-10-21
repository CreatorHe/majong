// V5 trial values. Keep mechanics, scoring and acquisition tuning in one place.
// These are playtest parameters, not claims of final four-route balance.
export const CORE_IDS = ['core_high', 'core_pung', 'core_held', 'core_growth'];
export const BALANCE = {
  handSize: 12,
  openingExchanges: 5,
  openingExchangeSize: 5,
  ink: 4,
  relicSlots: 4,
  highRescueSize: 3,
  jadeBase: 80,
  pungFactor: 2.8,
  stoneBase: 60,
  heldFactor: 1.22,
  heldBaseCount: 9,
  heldBurstFactor: 2,
  growthSeed: 200,
  growthRate: 1.17,
  highGlobalFactor: 1,
  summitMultiplier: 0.8,
  // Trial A: discrete thresholds, then a linear tail above the yakuman anchor.
  highAnchors: {
    mcr: [[0,1],[2,3],[4,6],[8,12],[16,24],[24,64],[32,128],[48,256],[64,1024],[88,2048]],
    riichi: [[0,1],[1,12],[2,24],[3,48],[4,96],[5,192],[6,384],[8,768],[11,1024],[13,2048]],
  },
};
export const TARGETS = {
  mcr: [200,500,1000,2500,5500,12000],
  riichi: [200,500,1000,2500,5500,12000],
};
export const DISABLED_RELIC_IDS = ['wind', 'growth', 'reserve'];
export const COMPATIBLE_RELICS = {
  core_high: ['high_rescue','rank_brush','suit_ribbon','wild_jade','jade','ink'],
  core_pung: ['retrigger_meld','stone','mountain','kong_cauldron','rank_brush','jade'],
  core_held: ['retrigger_held','jade','rank_brush','suit_ribbon','ink'],
  core_growth: ['retrigger_meld','jade','rank_brush','suit_ribbon','river','ink'],
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
