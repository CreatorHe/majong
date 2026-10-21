export { PATTERN_CATALOG, PATTERNS_BY_ID, DEFAULT_RULES_VERSION, DEFAULT_SCORE_MODEL_VERSION } from '../dist/analytics/game-schema.js';
import { PATTERN_CATALOG, gamePatternCatalog, GAME_VERSION_PAIRS } from '../dist/analytics/game-schema.js';
export const patternsForMode = (mode, rulesVersion) => (Object.hasOwn(GAME_VERSION_PAIRS, rulesVersion) ? gamePatternCatalog(rulesVersion) : PATTERN_CATALOG).filter(pattern => pattern.mode === mode);
