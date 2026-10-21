import { SettlementPlayer, validateSnapshot } from './player.js';
import { getEffect } from './effects-v2.js';
import { createBurstPlayer } from './v4/burst-player.js';
import { createRuntimePlayer } from './v4/runtime.js';

/** Compatibility facade: V4 renders legal frozen ledgers; invalid hands never celebrate. */
export class CinematicSettlementPlayer extends SettlementPlayer {
  constructor(root, options = {}) {
    super(root, options);
    this.playerOptions = options;
    this.burst = null;
    this.legalPlayback = false;
    this.playTicket = 0;
  }
  setMuted(value) { super.setMuted(value); this.burst?.setMuted(value); }
  setSpeed(value) { super.setSpeed(Math.min(2, Number(value) || 1)); this.burst?.setSpeed(this.options.speed); }
  setPaused(value) { super.setPaused(value); this.burst?.setPaused(value); }
  setReducedMotion(value) { super.setReducedMotion(value); this.burst?.setReducedMotion(value); }
  cancel(status = 'replaced') {
    this.playTicket++;
    this.burst?.cancel(status);
    super.cancel(status);
  }
  releaseBurst() { this.burst?.dispose(); this.burst = null; }
  play(snapshot, options = {}) {
    if (this.destroyed) return Promise.resolve({ status: 'disposed' });
    this.cancel();
    this.options = { ...this.options, ...options, paused: false };
    this.snapshot = snapshot;
    this.completionDelivered = false;
    try {
      this.snapshot = typeof structuredClone === 'function' ? structuredClone(snapshot) : JSON.parse(JSON.stringify(snapshot));
      validateSnapshot(this.snapshot);
    } catch (error) {
      this.releaseBurst(); this.legalPlayback = false;
      this.buildFallback(error); return this.complete('fallback');
    }
    this.effect = getEffect(this.snapshot);
    this.legalPlayback = this.snapshot.handResult === 'agari';
    if (!this.legalPlayback) {
      this.releaseBurst();
      return super.play(this.snapshot, this.options);
    }
    if (!this.burst) {
      this.root.replaceChildren(); this.root.className = 'jr-settlement jr-v4-settlement';
      // Both branches share one audio owner. The facade alone disposes it.
      const audio = this.audio;
      this.burst = createBurstPlayer(this.root, {
        tileUrl: this.tileUrl, relicUrl: this.relicUrl,
        libraryFactory: this.playerOptions.libraryFactory || createRuntimePlayer,
        ...(this.playerOptions.clock ? { clock: this.playerOptions.clock } : {}),
        audioFactory: () => ({ setMuted: value => audio.setMuted(value), stopAll: () => audio.stopAll(),
          play: (...args) => audio.play(...args), unlock: () => audio.unlock(),
          getState: () => audio.getState?.() || {}, dispose() {} }),
      });
    }
    this.setMuted(this.options.muted); this.setSpeed(this.options.speed); this.setReducedMotion(this.options.reducedMotion);
    this.running = true;
    const ticket = this.playTicket;
    // Calling the facade again is an explicit replay, as in the original public API.
    const playback = this.burst.play(this.snapshot, { ...this.options, replay: true });
    return playback.then(outcome => {
      if (ticket === this.playTicket && !this.destroyed) {
        this.running = false; this.completionDelivered = true;
        if (['completed', 'skipped', 'fallback'].includes(outcome.status)) {
          try { this.options.onComplete?.(outcome); } catch {}
        }
      }
      return outcome;
    }).catch(error => {
      if (ticket !== this.playTicket || this.destroyed) return { status: 'cancelled', settlementId: this.snapshot?.settlementId };
      this.releaseBurst(); this.legalPlayback = false; this.buildFallback(error);
      return this.complete('fallback');
    });
  }
  skip() { if (this.legalPlayback) return this.burst?.skip(); return super.skip(); }
  showPoster(snapshot, options = {}) { const pending = this.play(snapshot, { ...options, reducedMotion: true }); this.skip(); return pending; }
  getState() {
    return this.legalPlayback && this.burst ? this.burst.getState() : {
      state: this.destroyed ? 'destroyed' : this.running ? 'playing' : 'completed',
      settlementId: this.snapshot?.settlementId, speed: this.options.speed,
      reducedMotion: this.options.reducedMotion, muted: this.options.muted,
    };
  }
  dispose() { if (this.destroyed) return; this.releaseBurst(); super.dispose(); }
}
