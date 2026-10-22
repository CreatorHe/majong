import { RIICHI_CATALOG } from './riichi-patterns.js';
import { MCR_CATALOG } from './mcr-patterns.js';

export const PATTERN_CATALOG = Object.freeze({
  riichi: Object.freeze(RIICHI_CATALOG.filter(p=>p.status!=='relic')),
  mcr: Object.freeze([...MCR_CATALOG]),
});

export const PATTERN_RELIC_NAMES = Object.freeze({ wheel: '车轮秘卷', jiang: '将令', mountain: '连山印' });
