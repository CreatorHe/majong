// V9: nine-tile batches and a shared fan-to-score curve. Targets remain playtest values.
export const CORE_IDS = [];
export const STARTER_RELIC_ID = 'rank_brush';
export const BALANCE = {
  handSize: 9, openingExchanges: 5, openingExchangeSize: 5,
  ink: 2, editCost: 2, relicSlots: 4, highRescueSize: 3,
  scoreBase: 1000, growthSeed: 0,
  highAnchors: {
    mcr: [[0,0],[1,2],[2,4],[4,12],[8,32],[16,96],[24,256],[32,512],[48,1024],[64,2048],[88,4096]],
    riichi: [[0,0],[1,12],[2,24],[3,48],[4,96],[5,192],[6,384],[8,768],[11,1024],[13,2048]],
  },
};
export const TARGETS = {
  mcr: [32000,128000,384000,896000,1920000,3968000],
  riichi: [12000,36000,84000,180000,372000,756000],
};
export const DISABLED_RELIC_IDS = [];
export const COMPATIBLE_RELICS = {};
export const FIRST_COMPATIBLE = {};
export function highFanMultiplier(mode, fans) {
  if(fans<=0)return 0;
  const points=BALANCE.highAnchors[mode];
  const [lastFan,lastMult]=points.at(-1);
  return fans>lastFan?lastMult*fans/lastFan:[...points].reverse().find(([threshold])=>fans>=threshold)[1];
}
