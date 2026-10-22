import { createAnalytics } from './client.js';
import { GAME_RULES_VERSION, GAME_SCORE_MODEL_VERSION, HARD_RULES_VERSION, HARD_SCORE_MODEL_VERSION } from './game-schema.js';

// Importing this module never touches storage, DOM, locks or the network.
let instance = null;
let configuration = null;

/** Configure before first use; tests may inject a client or factory without a browser. */
export function configureGameAnalytics(options = {}) {
  if (instance) {
    if (options.client === instance) return instance;
    throw new Error('game_analytics_already_initialized');
  }
  configuration = { ...options, clientOptions: { ...options.clientOptions } };
  if (options.client) instance = options.client;
  return instance;
}

/** One shared game client for boot and the game adapter. SSR returns null unless explicitly configured. */
export function getGameAnalytics(clientOptions = {}) {
  if (instance) return instance;
  if (typeof window === 'undefined' && !configuration) return null;
  const createClient = configuration?.createClient ?? createAnalytics;
  const hard = /^\/hard(?:\/|$)/.test(globalThis.location?.pathname ?? '');
  const rules = hard ? HARD_RULES_VERSION : GAME_RULES_VERSION;
  const score = hard ? HARD_SCORE_MODEL_VERSION : GAME_SCORE_MODEL_VERSION;
  const settings = {
    scope: 'production', entry: 'game',
    defaultEnabled: true,
    viewport: typeof window !== 'undefined' && window.innerWidth < 650 ? 'compact' : 'wide',
    appRelease: rules.replaceAll('_', '-'), rulesVersion: rules, scoreModelVersion: score,
    ...configuration?.clientOptions, ...clientOptions,
  };
  instance = createClient({ ...settings, defaultEnabled: settings.scope === 'production' && settings.defaultEnabled === true });
  return instance;
}

/** Explicit teardown for tests or the host lifecycle, never for ordinary panel unmounting. */
export function resetGameAnalytics({ dispose = true } = {}) {
  if (dispose) instance?.dispose?.();
  instance = null;
  configuration = null;
}
