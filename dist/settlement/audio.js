/**
 * 叠雀 — original, deterministic Web Audio settlement cues.
 * No samples, dependencies, automatic playback or global event listeners.
 */
export const SOUND_LABELS = Object.freeze({
  hand_reveal: '和牌 · 玉磬起声',
  hand_check: '检查 · 轻木一点',
  false_hu: '诈胡 · 木声轻断',
  tile_score: '底分 · 木点入账',
  pattern_reveal: '番型 · 清玉叠音',
  relic_trigger: '奇物 · 木玉共鸣',
  multiplier_update: '倍率 · 低弦上行',
  hand_total: '落分 · 玉印落定',
  round_pass: '过关 · 三音收束',
  round_fail: '未达标 · 低弦轻收',
});
export const SOUND_EVENTS = Object.freeze(Object.keys(SOUND_LABELS));

const MASTER_GAIN = 0.22;
const MAX_VOICES = 4;
const MAX_SOURCES = 32;
const PRIORITY = { tile_score: 0, relic_trigger: 1, multiplier_update: 1,
  pattern_reveal: 2, hand_reveal: 2, hand_check: 1, hand_total: 3,
  round_pass: 4, round_fail: 4, false_hu: 5 };
const COOLDOWN = { tile_score: 0.065, relic_trigger: 0.11, multiplier_update: 0.13,
  pattern_reveal: 0.14, hand_reveal: 0.2, hand_check: 0.18, false_hu: 0.25,
  hand_total: 0.25, round_pass: 0.25, round_fail: 0.25 };

function clamp(value, minimum, maximum, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(maximum, Math.max(minimum, number)) : fallback;
}

// All musical phrases were composed for this prototype. Frequencies are in Hz.
function recipe(event, tier) {
  const layers = [];
  // Extra voices change the harmony, while compensating the summed amplitude.
  const balance = 1 / (1 + tier * 0.28);
  const tone = (frequency, at, duration, peak = 0.16, type = 'sine', endFrequency) =>
    layers.push({ kind: 'tone', frequency, at, duration, peak: peak * balance, type, endFrequency });
  const wood = (at = 0, pitch = 760, duration = 0.12) => {
    tone(pitch, at, duration, 0.19, 'sine', pitch * 0.48);
    layers.push({ kind: 'noise', at, duration: 0.065, peak: 0.075 * balance,
      frequency: 1450, q: 1.5 });
  };
  const jade = (frequency, at = 0, duration = 0.36, peak = 0.15) => {
    tone(frequency, at, duration, peak);
    tone(frequency * 2.76, at, duration * 0.46, peak * 0.22);
    tone(frequency * 4.1, at, duration * 0.24, peak * 0.075);
  };
  const string = (frequency, at = 0, duration = 0.34, peak = 0.13) => {
    tone(frequency, at, duration, peak, 'triangle');
    tone(frequency * 2, at + 0.006, duration * 0.7, peak * 0.19);
  };

  switch (event) {
    case 'hand_check':
      // A dry, neutral touch: checking the tiles does not announce a valid hand.
      tone(360, 0, 0.1, 0.11, 'sine', 300);
      layers.push({ kind: 'noise', at: 0, duration: 0.045, peak: 0.035,
        frequency: 1000, q: 1 });
      break;
    case 'false_hu':
      // Two descending wooden fragments, without celebratory chimes or alarm tones.
      tone(460, 0, 0.075, 0.15, 'sine', 230);
      layers.push({ kind: 'noise', at: 0.005, duration: 0.055, peak: 0.055,
        frequency: 1100, q: 1.2 });
      tone(280, 0.06, 0.125, 0.12, 'triangle', 140);
      layers.push({ kind: 'noise', at: 0.065, duration: 0.06, peak: 0.035,
        frequency: 780, q: 1 });
      break;
    case 'hand_reveal':
      string(196, 0, 0.38, 0.13);
      jade(392, 0.045, 0.4);
      if (tier >= 1) tone(587.33, 0.095, 0.35, 0.12);
      if (tier >= 2) jade(784, 0.145, 0.36, 0.1);
      break;
    case 'tile_score':
      wood(0, 780, 0.105);
      if (tier >= 1) tone(1174.66, 0.012, 0.1, 0.07);
      if (tier >= 2) tone(1568, 0.025, 0.1, 0.065);
      break;
    case 'pattern_reveal':
      jade(523.25, 0, 0.37, 0.17);
      if (tier >= 1) jade(784, 0.045, 0.37, 0.11);
      if (tier >= 2) jade(1046.5, 0.085, 0.41, 0.095);
      break;
    case 'relic_trigger':
      wood(0, 1030, 0.1);
      jade(659.25, 0.025, 0.3, 0.14);
      if (tier >= 1) tone(987.77, 0.065, 0.28, 0.11);
      if (tier >= 2) tone(1318.51, 0.105, 0.31, 0.1);
      break;
    case 'multiplier_update':
      string(146.83, 0, 0.3, 0.16);
      tone(293.66, 0.045, 0.28, 0.12, 'triangle');
      if (tier >= 1) tone(440, 0.085, 0.3, 0.12);
      if (tier >= 2) jade(587.33, 0.125, 0.32, 0.11);
      break;
    case 'hand_total':
      tone(120, 0, 0.21, 0.22, 'sine', 72);
      jade(392, 0.018, 0.47, 0.19);
      if (tier >= 1) jade(587.33, 0.055, 0.45, 0.13);
      if (tier >= 2) {
        tone(784, 0.09, 0.46, 0.12);
        jade(987.77, 0.13, 0.43, 0.1);
      }
      break;
    case 'round_pass':
      jade(392, 0, 0.34, 0.13);
      tone(493.88, 0.055, 0.34, 0.13);
      tone(587.33, 0.11, 0.35, 0.14);
      if (tier >= 1) tone(784, 0.135, 0.35, 0.1);
      if (tier >= 2) jade(1174.66, 0.17, 0.36, 0.085);
      break;
    case 'round_fail':
      // A quiet descending release: no alarm, buzzer, or punishment sound.
      string(220, 0, 0.26, 0.11);
      string(196, 0.085, 0.32, 0.12);
      if (tier >= 1) tone(392, 0.085, 0.29, 0.065);
      if (tier >= 2) tone(293.66, 0.13, 0.3, 0.055);
      break;
  }
  return layers;
}

export function createSettlementAudio() {
  let context = null;
  let master = null;
  let compressor = null;
  let noiseBuffer = null;
  let muted = true;
  let disposed = false;
  let unlockPromise = null;
  const voices = new Set();
  const lastPlayed = new Map();
  const ContextClass = () => globalThis.AudioContext || globalThis.webkitAudioContext;
  const disconnect = node => { try { node?.disconnect(); } catch { /* already disconnected */ } };

  function retireLayer(voice, layer) {
    if (!voice.layers.has(layer)) return;
    layer.source.onended = null;
    for (const node of layer.nodes) disconnect(node);
    voice.layers.delete(layer);
    if (!voice.layers.size) voices.delete(voice);
  }

  function stopVoice(voice) {
    for (const layer of [...voice.layers]) {
      layer.source.onended = null;
      try { layer.source.stop(); } catch { /* source may already have ended */ }
      retireLayer(voice, layer);
    }
    voices.delete(voice);
  }

  function stopAll() {
    for (const voice of [...voices]) stopVoice(voice);
    lastPlayed.clear();
  }

  function createGraph() {
    context = new (ContextClass())({ latencyHint: 'interactive' });
    master = context.createGain();
    master.gain.setValueAtTime(muted ? 0 : MASTER_GAIN, context.currentTime);
    compressor = context.createDynamicsCompressor();
    compressor.threshold.value = -18;
    compressor.knee.value = 12;
    compressor.ratio.value = 4;
    compressor.attack.value = 0.003;
    compressor.release.value = 0.12;
    master.connect(compressor);
    compressor.connect(context.destination);

    // One repeatable noise buffer. Xorshift32 seed is fixed; no downloaded samples.
    noiseBuffer = context.createBuffer(1, Math.ceil(context.sampleRate * 0.7), context.sampleRate);
    const samples = noiseBuffer.getChannelData(0);
    let seed = 0x4a414445;
    for (let i = 0; i < samples.length; i++) {
      seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5;
      samples[i] = ((seed >>> 0) / 0x100000000) * 2 - 1;
    }
  }

  async function unlock() {
    if (disposed || !ContextClass()) return false;
    if (unlockPromise) return unlockPromise;
    const attempt = (async () => {
      try {
        if (!context || context.state === 'closed') createGraph();
        if (context.state !== 'running') await context.resume();
        return !disposed && context.state === 'running';
      } catch {
        // Autoplay denial / unavailable device must never stop the visual player.
        return false;
      }
    })();
    unlockPromise = attempt;
    try { return await attempt; }
    finally { if (unlockPromise === attempt) unlockPromise = null; }
  }

  function setMuted(value) {
    muted = Boolean(value);
    if (muted) stopAll();
    if (!master || !context || context.state === 'closed') return;
    try {
      master.gain.cancelScheduledValues(context.currentTime);
      if (muted) master.gain.setValueAtTime(0, context.currentTime);
      else master.gain.setTargetAtTime(MASTER_GAIN, context.currentTime, 0.008);
    } catch { /* audio may be closing */ }
  }

  function scheduleLayer(voice, spec, start, speed) {
    const durationScale = 1 / Math.max(1, speed);
    const at = start + spec.at * durationScale;
    const duration = Math.max(0.04, spec.duration * durationScale);
    const source = spec.kind === 'noise' ? context.createBufferSource() : context.createOscillator();
    const gain = context.createGain();
    const nodes = [source, gain];
    const layer = { source, nodes };
    voice.layers.add(layer);
    if (spec.kind === 'noise') {
      source.buffer = noiseBuffer;
      const filter = context.createBiquadFilter();
      filter.type = 'bandpass';
      filter.frequency.value = spec.frequency;
      filter.Q.value = spec.q;
      nodes.push(filter);
      source.connect(filter);
      filter.connect(gain);
    } else {
      source.type = spec.type;
      source.frequency.setValueAtTime(spec.frequency, at);
      if (spec.endFrequency) source.frequency.exponentialRampToValueAtTime(spec.endFrequency, at + duration);
      source.connect(gain);
    }
    gain.connect(master);
    const attack = Math.min(0.007, duration * 0.12);
    gain.gain.setValueAtTime(0, at);
    gain.gain.linearRampToValueAtTime(spec.peak, at + attack);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + duration * 0.94);
    gain.gain.linearRampToValueAtTime(0, at + duration);
    source.onended = () => retireLayer(voice, layer);
    source.start(at);
    source.stop(at + duration + 0.003);
  }

  function play(event, { tier = 0, speed = 1 } = {}) {
    if (disposed || muted || !context || context.state !== 'running' || !SOUND_EVENTS.includes(event)) return false;
    tier = Math.round(clamp(tier, 0, 2, 0));
    // Neutral checks and mistakes stay restrained at every visual score tier.
    if (event === 'hand_check' || event === 'false_hu') tier = 0;
    speed = clamp(speed, 0.5, 4, 1);
    const now = context.currentTime;
    // Fast timelines skip surplus ticks instead of piling them up. No sound queue.
    const interval = COOLDOWN[event] * Math.min(Math.max(speed, 1), 2);
    if (now - (lastPlayed.get(event) ?? -Infinity) < interval) return false;
    const layers = recipe(event, tier);

    // A result replaces residual counting; it does not compete with it.
    if (PRIORITY[event] >= 3) {
      for (const voice of [...voices]) if (PRIORITY[voice.event] < PRIORITY[event]) stopVoice(voice);
    }
    let sources = [...voices].reduce((sum, voice) => sum + voice.layers.size, 0);
    while (voices.size >= MAX_VOICES || sources + layers.length > MAX_SOURCES) {
      const candidate = [...voices].find(voice => PRIORITY[voice.event] <= PRIORITY[event]);
      if (!candidate) return false;
      sources -= candidate.layers.size;
      stopVoice(candidate);
    }
    const voice = { event, layers: new Set() };
    voices.add(voice);
    try {
      for (const layer of layers) scheduleLayer(voice, layer, now + 0.006, speed);
      lastPlayed.set(event, now);
      return true;
    } catch {
      stopVoice(voice);
      return false;
    }
  }

  function getState() {
    return {
      supported: Boolean(ContextClass()),
      unlocked: !disposed && context?.state === 'running',
      muted,
      activeVoices: voices.size,
      activeSources: [...voices].reduce((sum, voice) => sum + voice.layers.size, 0),
      contextState: context?.state || 'not-created',
      disposed,
    };
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    stopAll();
    disconnect(master);
    disconnect(compressor);
    noiseBuffer = null;
    try { context?.close().catch(() => {}); } catch { /* already closed */ }
  }

  return Object.freeze({ unlock, setMuted, play, stopAll, dispose, getState });
}
