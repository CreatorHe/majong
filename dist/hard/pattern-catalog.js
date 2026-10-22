import { RIICHI_CATALOG } from './riichi-patterns.js';
import { MCR_CATALOG } from './mcr-patterns.js';

// Keep standard patterns independent of relic ownership. These entries describe
// only the extra rewards applied by the game's existing secret-scroll effects.
const mcrRelics = [
  {
    id: '连七对 · 车轮加赏', name: '连七对 · 车轮加赏', fan: 0,
    condition: '以七对解释组成 2～8 筒各一对，持有车轮秘卷时和牌分 ×3。标准连七对的 88 番始终直接可用，不需要奇物。',
    status: 'relic', category: '奇物加赏', relicId: 'wheel', valueText: '和牌分 ×3', aliases: ['大车轮', '车轮秘卷'],
  },
  {
    id: '将将胡', name: '将将胡', fan: 0,
    condition: '完整和牌只含 2、5、8 数牌，持有将令时和牌分 ×2.5；这是地区麻将扩展，不属于国标基本番型。',
    status: 'relic', category: '地区扩展', relicId: 'jiang', valueText: '和牌分 ×2.5',
  },
  {
    id: '一色三节高 · 连山加赏', name: '一色三节高 · 连山加赏', fan: 0,
    condition: '同花色三组点数连续的刻子或杠，持有连山印时和牌分 ×2。标准一色三节高等番型始终直接可用，不需要奇物。',
    status: 'relic', category: '奇物加赏', relicId: 'mountain', valueText: '和牌分 ×2', aliases: ['三连刻', '连山印'],
  },
];

export const PATTERN_CATALOG = Object.freeze({
  riichi: Object.freeze([...RIICHI_CATALOG]),
  mcr: Object.freeze([...MCR_CATALOG, ...mcrRelics.map(p => Object.freeze(p))]),
});

export const PATTERN_RELIC_NAMES = Object.freeze({ wheel: '车轮秘卷', jiang: '将令', mountain: '连山印' });
