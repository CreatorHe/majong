import { SettlementPlayer, validateSnapshot } from './player.js';
import { getEffect } from './effects-v2.js';
import { createCinematicAudio } from './cinematic-audio.js';
import { CinematicStage } from './cinematic-stage.js';
import { MOTION_DURATION } from './motion-v3.js';

/** Layered cinematic presentation over the existing ordered, exact-text settlement player. */
export class CinematicSettlementPlayer extends SettlementPlayer {
  constructor(root, options = {}) {
    super(root, options);
    this.cinematicAudio = options.cinematicAudio || createCinematicAudio();
    this.ownsCinematicAudio = !options.cinematicAudio;
  }
  async unlockAudio() {
    const results = await Promise.allSettled([super.unlockAudio(), this.cinematicAudio.unlock()]);
    return results.every(result => result.status === 'fulfilled' && result.value);
  }
  setMuted(value) { super.setMuted(value); this.cinematicAudio?.setMuted(!!value); }
  setSpeed(value) { if (this.running) this.cinematicAudio?.stopAll(); super.setSpeed(value); if(this.running)this.renderFrame(this.clock); }
  setPaused(value) {
    if (this.running && this.options.paused !== !!value) this.previous = performance.now();
    super.setPaused(value);
    if(this.running)this.renderFrame(this.clock);
    if (value) { this.audio.stopAll(); this.cinematicAudio?.stopAll(); }
    for (const animation of this.root.getAnimations?.({ subtree: true }) || []) value ? animation.pause?.() : animation.play?.();
  }
  setReducedMotion(value) {
    super.setReducedMotion(value);
    if (value) this.cinematicAudio?.stopAll();
    if (this.stage?.last) this.stage.render(this.stage.last.p, { ...this.stage.last.options, reducedMotion: !!value });
  }
  cancel(status = 'replaced') { this.stage?.stopMotion(); this.cinematicAudio?.stopAll(); super.cancel(status); }
  dispose() { if (this.destroyed) return; this.stage?.dispose(); super.dispose(); if (this.ownsCinematicAudio) this.cinematicAudio.dispose(); }
  play(snapshot, options = {}) {
    this.isPoster = false; this.impactPlayed = false;
    return super.play(snapshot, { ...options, paused: false });
  }
  build() {
    this.stage?.dispose(); super.build();
    this.effect = getEffect(this.snapshot);
    this.stage = new CinematicStage(this.effect, this.snapshot, this.tileUrl);
    this.root.classList.add('jr-cinematic'); this.root.dataset.effectId = this.effect.id;
    this.root.style.setProperty('--cine-color', this.effect.color); this.root.style.setProperty('--cine-accent', this.effect.accent);
    this.root.insertBefore(this.stage.el, this.scene);
    this.root.dataset.cinePhase = this.snapshot.handResult === 'false_hu' ? 'count' : 'intro';
    this.scene.hidden = this.snapshot.handResult !== 'false_hu';
    this.stage.resize(); this.stage.render(0, { reducedMotion: this.options.reducedMotion, poster: this.isPoster });
  }
  configureTimeline() {
    if (this.snapshot.handResult === 'false_hu') { this.introMs = 0; return; }
    this.introMs = this.stage.motion ? MOTION_DURATION : this.effect.introMs;
    let at = 0;
    this.timeline = this.snapshot.steps.map((step, index) => {
      const duration = index === 0 && step.event === 'hand_reveal' ? this.introMs :
        step.event === 'hand_total' ? 850 : step.event === 'round_result' ? 700 : step.event === 'pattern_reveal' ? 650 : 430;
      const row = { at, duration }; at += duration; return row;
    });
    this.duration = at;
  }
  applyStep(step, index, audible) {
    const generation = this.generation;
    super.applyStep(step, index, false);
    if (generation !== this.generation || !this.running) return;
    const falseHu = this.snapshot.handResult === 'false_hu';
    if (index === 0 && !falseHu) {
      this.cutInUsed = true; // The cinematic has already announced the supplied primary pattern.
      this.heroLabel.textContent = this.effect.label;
      this.heroValue.textContent = this.effect.variantLabel || this.effect.rarity;
      if (audible && !this.options.paused) this.cinematicAudio.playIntro({ effectId: this.effect.family, variant: this.effect.rarity === '普通' ? 'normal' : 'rare', speed: this.options.speed, reducedMotion: this.options.reducedMotion });
    } else if (audible && !this.options.paused) {
      const event = falseHu && step.event === 'hand_reveal' ? 'hand_check' :
        step.event === 'round_result' ? (this.snapshot.totals.passed ? 'round_pass' : 'round_fail') : step.event;
      const rawTier = step.event === 'hand_total' ? this.snapshot.tiers?.scoreTier : step.event === 'pattern_reveal' ? this.snapshot.tiers?.patternTier : this.snapshot.tiers?.multiplierTier;
      this.audio.play(event, { tier: falseHu ? 0 : Math.min(2, Number(rawTier) || 0), speed: this.options.speed });
    }
  }
  renderFrame(clock) {
    if (!this.stage || this.isPoster) return;
    const falseHu = this.snapshot.handResult === 'false_hu';
    const progress = this.introMs ? Math.min(1, clock / this.introMs) : 1;
    const counting = falseHu || clock >= this.introMs;
    this.root.dataset.cinePhase = counting ? 'count' : 'intro'; this.scene.hidden = !counting;
    const exit = this.options.reducedMotion ? 0 : Math.max(0, Math.min(1, (progress - .88) / .12));
    this.stage.el.style.opacity = String(counting ? .36 : 1 - exit * .64);
    this.scene.style.opacity = String(falseHu || this.options.reducedMotion ? 1 : Math.min(1, Math.max(0, (clock - this.introMs) / 250)));
    if (!falseHu && !this.impactPlayed && progress >= .41) {
      this.impactPlayed = true;
      if (!this.options.paused && !this.options.reducedMotion && progress < .8) this.cinematicAudio.playImpact({ effectId: this.effect.family, speed: this.options.speed });
    }
    this.stage.render(progress, { reducedMotion: this.options.reducedMotion, paused: this.options.paused, speed: this.options.speed, phase: counting ? 'result' : 'intro', exit });
  }
  showFinal() {
    super.showFinal(); if (!this.scene || !this.stage) return;
    if (this.snapshot.handResult !== 'false_hu') { this.heroLabel.textContent = this.effect.label; this.heroValue.textContent = [this.effect.variantLabel, this.effect.rarity].filter(Boolean).join(' · '); }
    this.cinematicAudio?.stopAll(); this.scene.hidden = false; this.scene.style.opacity = '1'; this.stage.el.style.opacity = '.36'; this.root.dataset.cinePhase = 'result';
    this.stage.render(1, { reducedMotion: true, phase: 'result' });
  }
  skip() { this.cinematicAudio.stopAll(); super.skip(); }
  showPoster(snapshot) {
    if (this.destroyed) return;
    this.cancel(); this.isPoster = true; this.completionDelivered = true;
    this.snapshot = structuredClone(snapshot); this.options.paused = false;
    try { validateSnapshot(this.snapshot); this.build(); }
    catch (error) { this.stage?.dispose(); this.stage = null; this.buildFallback(error); return; }
    super.showFinal();
    this.setReducedMotion(this.options.reducedMotion);
    this.scene.hidden = true; this.root.dataset.cinePhase = 'poster';
    this.stage.render(.72, { poster: true, reducedMotion: this.options.reducedMotion });
  }
  buildFallback(error) { this.stage?.dispose(); this.stage = null; this.cinematicAudio?.stopAll(); super.buildFallback(error); }
}
