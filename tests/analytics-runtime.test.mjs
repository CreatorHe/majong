import test from 'node:test';
import assert from 'node:assert/strict';
import { configureGameAnalytics, getGameAnalytics, resetGameAnalytics } from '../dist/analytics/runtime.js';

test('runtime import and ordinary SSR access have no side effects', () => {
  resetGameAnalytics();
  assert.equal(typeof window, 'undefined');
  assert.equal(getGameAnalytics(), null);
  assert.equal(getGameAnalytics(), null);
});

test('boot and adapter share a lazy v8 client; only production defaults collection on', () => {
  for (const [clientOptions, expectedDefault] of [[{}, true], [{ scope: 'sandbox', defaultEnabled: true }, false], [{ defaultEnabled: false }, false]]) {
    let calls = 0, disposed = 0, received;
    const client = { dispose() { disposed++; } };
    configureGameAnalytics({ createClient(options) { calls++; received = options; return client; }, clientOptions });
    assert.equal(calls, 0);
    const adapter = getGameAnalytics();
    const boot = getGameAnalytics({ entry: 'game' });
    assert.equal(adapter, boot);
    assert.equal(calls, 1);
    assert.equal(received.scope, clientOptions.scope ?? 'production');
    assert.equal(received.defaultEnabled, expectedDefault);
    assert.equal(received.rulesVersion, 'opening_build_v8');
    assert.equal(received.scoreModelVersion, 'four_core_v6');
    assert.equal(received.appRelease, 'opening-build-v8');
    assert.equal(disposed, 0);
    resetGameAnalytics();
    assert.equal(disposed, 1);
  }
});

test('explicit test client injection never constructs a second SDK', () => {
  let disposed = 0;
  const client = { dispose() { disposed++; } };
  configureGameAnalytics({ client });
  assert.equal(getGameAnalytics(), client);
  assert.equal(configureGameAnalytics({ client }), client);
  assert.throws(() => configureGameAnalytics({ client: {} }), /already_initialized/);
  resetGameAnalytics({ dispose: false });
  assert.equal(disposed, 0);
  assert.equal(getGameAnalytics(), null);
});
