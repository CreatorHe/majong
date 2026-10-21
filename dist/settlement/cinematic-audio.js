/**
 * 叠雀 cinematic sound v2. Original synthesis only: no speech or sampled game audio.
 * A player supplies effect IDs; this module never calculates hands, scores or rewards.
 * Default muted. Call unlock() inside a trusted click/touch handler, then setMuted(false).
 * playIntro/Impact return whether a cue was scheduled; stopAll cancels even future notes.
 */
export const CINEMATIC_AUDIO_FAMILIES = Object.freeze([
  'normal', 'dragons', 'orphans', 'concealed', 'winds', 'honors', 'green',
  'terminals', 'lotus', 'kongs', 'heaven', 'earth', 'seven_pairs', 'wheel',
]);

const ALIASES = [
  ['dragons', /dragon|daisangen|shousangen|三元/i],
  ['orphans', /orphan|kokushi|guoshi|国士|十三幺/i],
  ['concealed', /concealed|suuankou|四暗刻/i],
  ['winds', /winds?|daisuushii|shousuushii|四喜/i],
  ['honors', /honors?|tsuuiisou|字一色/i],
  ['green', /green|ryuuiisou|绿一色/i],
  ['terminals', /terminals?|chinroutou|清老头/i],
  ['lotus', /lotus|chuuren|nine.gates|九莲/i],
  ['kongs', /kongs?|suukantsu|四杠/i],
  ['heaven', /heaven|tenhou|天和/i],
  ['earth', /earth|chiihou|地和/i],
  ['seven_pairs', /seven.pairs|chiitoitsu|七对/i],
  ['wheel', /wheel|daisharin|车轮/i],
];

export function resolveCinematicAudioFamily(effectId) {
  const id = String(effectId ?? 'normal');
  return CINEMATIC_AUDIO_FAMILIES.includes(id) ? id :
    (ALIASES.find(([, expression]) => expression.test(id))?.[0] || 'normal');
}

function tierOf(variant) {
  if (typeof variant === 'number') return Math.max(0, Math.min(2, Math.round(variant) || 0));
  if (/^(normal|ordinary|common|base)$/i.test(variant)) return 0;
  return /^(legendary|epic|high|supreme)$/i.test(variant) ? 2 : 1;
}

const clampSpeed = value => Number.isFinite(Number(value)) ? Math.max(0.5, Math.min(4, Number(value))) : 1;

// The instrument helpers deliberately differ in envelope, spectrum, noise and movement.
// Changing family changes the composition, not merely the tuning of one sound.
function instruments(layers) {
  const tone = (frequency, at, duration, peak = 0.1, extra = {}) =>
    layers.push({ kind: 'tone', frequency, at, duration, peak, attack: 0.006,
      type: 'sine', pan: 0, ...extra });
  const noise = (at, duration, frequency = 1200, peak = 0.035, extra = {}) =>
    layers.push({ kind: 'noise', at, duration, frequency, peak, attack: 0.01,
      filter: 'bandpass', q: 0.8, pan: 0, ...extra });
  const jade = (pitch, at, duration = 0.3, pan = 0, peak = 0.1) => {
    tone(pitch, at, duration, peak, { pan });
    tone(pitch * 2.76, at + 0.002, duration * 0.48, peak * 0.21, { pan });
  };
  const knock = (pitch, at, duration = 0.12, pan = 0, peak = 0.13) => {
    tone(pitch, at, duration, peak, { endFrequency: pitch * 0.52, pan });
    noise(at, duration * 0.45, pitch * 2.7, peak * 0.24, { pan, q: 1.5, attack: 0.003 });
  };
  const string = (pitch, at, duration = 0.48, peak = 0.09, extra = {}) => {
    tone(pitch, at, duration, peak, { type: 'triangle', attack: 0.045, ...extra });
    tone(pitch * 2, at + 0.012, duration * 0.75, peak * 0.2, { attack: 0.035, ...extra,
      endFrequency: extra.endFrequency ? extra.endFrequency * 2 : undefined });
  };
  const metal = (pitch, at, duration = 0.32, pan = 0) => {
    tone(pitch, at, duration, 0.09, { pan });
    tone(pitch * 1.47, at, duration * 0.72, 0.043, { pan });
    tone(pitch * 3.13, at + 0.003, duration * 0.38, 0.016, { pan });
  };
  const drop = (pitch, at, pan = 0) =>
    tone(pitch, at, 0.14, 0.085, { endFrequency: pitch * 0.49, attack: 0.012, pan });
  return { tone, noise, jade, knock, string, metal, drop };
}

function introRecipe(family, tier, reducedMotion) {
  const layers = [];
  const { tone, noise, jade, knock, string, metal, drop } = instruments(layers);
  if (tier === 0 || family === 'normal') {
    knock(620, 0, 0.1, 0, 0.12);
    noise(0.035, 0.16, 1450, 0.025, { attack: 0.025, endFrequency: 700 });
    jade(659.25, 0.09, 0.32, 0, 0.105);
    return layers;
  }

  // An actual silent gap precedes the inhale and low arrival. No autoplay or timers.
  const inhaleAt = tier === 2 ? 0.14 : 0.1;
  noise(inhaleAt, 0.17, 650, 0.025, { attack: 0.075, endFrequency: 1800, shape: 'inhale' });
  tone(116, inhaleAt + 0.15, 0.16, 0.14, { endFrequency: 65 });
  const at = inhaleAt + 0.22;
  switch (family) {
    case 'dragons':
      knock(330, at, 0.17, -0.3);
      tone(440, at + 0.13, 0.22, 0.11, { type: 'triangle', pan: 0 });
      jade(659.25, at + 0.26, 0.39, 0.3, 0.11);
      break;
    case 'orphans':
      noise(at, 0.27, 3200, 0.038, { filter: 'highpass', attack: 0.035,
        endFrequency: 900, pan: -0.55, endPan: 0.55 });
      metal(554.37, at + 0.07, 0.42, 0.25);
      knock(190, at + 0.16, 0.11, -0.15, 0.095);
      break;
    case 'concealed':
      [0, 0.11, 0.24, 0.4].forEach((offset, index) => {
        knock([240, 220, 196, 165][index], at + offset, 0.15, index % 2 ? 0.15 : -0.15, 0.11);
        noise(at + offset + 0.014, 0.13, 420, 0.02, { filter: 'lowpass', attack: 0.02 });
      });
      break;
    case 'winds':
      [0, 0.12, 0.24, 0.36].forEach((offset, index) => {
        noise(at + offset, 0.26, [650, 1050, 1450, 900][index], 0.031,
          { attack: 0.055, pan: [-0.7, 0.7, -0.3, 0.3][index], endFrequency: 550 });
      });
      tone(392, at + 0.42, 0.28, 0.065, { attack: 0.03 });
      break;
    case 'honors':
      [0, 0.17, 0.33].forEach((offset, index) => {
        knock([350, 295, 260][index], at + offset, 0.18, 0, 0.12);
        tone([880, 740, 660][index], at + offset + 0.018, 0.16, 0.04);
      });
      break;
    case 'green':
      noise(at, 0.42, 2600, 0.018, { filter: 'highpass', attack: 0.07 });
      knock(780, at + 0.02, 0.11, -0.25, 0.1);
      drop(1800, at + 0.13, 0.28);
      knock(990, at + 0.24, 0.1, -0.15, 0.085);
      drop(1340, at + 0.34, 0.2);
      break;
    case 'terminals':
      tone(92, at, 0.33, 0.13, { endFrequency: 43 });
      noise(at + 0.018, 0.31, 350, 0.065, { q: 0.7, endFrequency: 180 });
      noise(at + 0.12, 0.15, 930, 0.03, { q: 2, attack: 0.003 });
      knock(155, at + 0.29, 0.19, 0.1, 0.1);
      break;
    case 'lotus':
      [523.25, 587.33, 659.25, 784, 880, 1046.5, 1174.66, 1318.51, 1568]
        .forEach((pitch, index) => jade(pitch, at + index * 0.055, 0.31,
          Math.sin(index * 1.4) * 0.35, 0.065));
      break;
    case 'kongs':
      [0, 0.14, 0.29, 0.45].forEach((offset, index) => {
        tone([130, 116, 103, 87][index], at + offset, 0.22, 0.13,
          { endFrequency: [70, 64, 57, 48][index] });
        noise(at + offset, 0.075, 480, 0.04, { attack: 0.003, q: 0.7 });
      });
      break;
    case 'heaven':
      string(523.25, at, 0.6, 0.075, { pan: -0.25, attack: 0.1 });
      string(784, at + 0.08, 0.55, 0.065, { pan: 0.25, attack: 0.09 });
      tone(1568, at + 0.2, 0.46, 0.028, { attack: 0.1 });
      noise(at, 0.51, 2800, 0.014, { filter: 'highpass', attack: 0.12 });
      break;
    case 'earth':
      string(130.81, at, 0.49, 0.11, { endFrequency: 65.41, attack: 0.015 });
      noise(at + 0.1, 0.1, 1250, 0.05, { attack: 0.002, q: 1.2 });
      noise(at + 0.14, 0.37, 230, 0.05, { filter: 'lowpass', attack: 0.025 });
      tone(49, at + 0.16, 0.31, 0.08, { attack: 0.02 });
      break;
    case 'seven_pairs':
      [392, 440, 493.88, 587.33, 659.25, 784, 880].forEach((pitch, index) => {
        const when = at + index * 0.075;
        // Each of seven strikes is a close pair: two tiny tile faces in one gesture.
        knock(pitch, when, 0.105, -0.14, 0.075);
        tone(pitch * 1.006, when + 0.014, 0.1, 0.045, { pan: 0.14, endFrequency: pitch * 0.52 });
      });
      break;
    case 'wheel':
      [392, 493.88, 587.33, 784, 587.33, 493.88, 392].forEach((pitch, index) =>
        jade(pitch, at + index * 0.065, 0.28, Math.sin(index * Math.PI / 3) * 0.55, 0.07));
      noise(at, 0.4, 1500, 0.016, { attack: 0.06, endFrequency: 500 });
      break;
  }
  if (tier === 2) {
    // A separate low-string foundation, rather than raising the whole cue's volume.
    string(['heaven', 'lotus'].includes(family) ? 261.63 : 98, at + 0.04, 0.43, 0.045);
  }
  if (reducedMotion) for (const layer of layers) {
    layer.pan = 0;
    delete layer.endPan;
    if (layer.kind === 'noise') layer.peak *= 0.8;
  }
  return layers;
}

function impactRecipe(family) {
  const layers = [];
  const { tone, noise, jade, knock, string, metal, drop } = instruments(layers);
  switch (family) {
    case 'dragons':
      [392, 523.25, 659.25].forEach((pitch, i) => jade(pitch, i * 0.025, 0.37, 0, 0.085));
      tone(98, 0, 0.19, 0.1, { endFrequency: 65 }); break;
    case 'orphans':
      noise(0, 0.12, 2600, 0.04, { filter: 'highpass', endFrequency: 900, pan: -0.3, endPan: 0.3 });
      metal(440, 0.035, 0.35); break;
    case 'concealed':
      [0, 0.035, 0.07, 0.105].forEach((at, i) => knock(240 - i * 25, at, 0.14, 0, 0.08));
      noise(0.1, 0.16, 350, 0.028, { filter: 'lowpass' }); break;
    case 'winds':
      [-0.6, 0.6, -0.25, 0.25].forEach((pan, i) => noise(i * 0.025, 0.22, 700 + i * 250,
        0.025, { pan, attack: 0.035 }));
      jade(392, 0.08, 0.29, 0, 0.085); break;
    case 'honors':
      knock(300, 0, 0.2, 0, 0.15); metal(660, 0.025, 0.22); break;
    case 'green':
      knock(820, 0, 0.11, -0.15, 0.095); drop(1580, 0.025, 0.1); drop(1180, 0.09, -0.1);
      noise(0, 0.23, 2400, 0.012, { filter: 'highpass' }); break;
    case 'terminals':
      tone(110, 0, 0.31, 0.15, { endFrequency: 42 });
      noise(0, 0.23, 370, 0.065, { endFrequency: 180, attack: 0.003 });
      noise(0.07, 0.1, 1100, 0.03, { q: 2, attack: 0.003 }); break;
    case 'lotus':
      [1046.5, 1318.51, 1568].forEach((pitch, i) => jade(pitch, i * 0.038, 0.37, (i - 1) * 0.2, 0.08));
      break;
    case 'kongs':
      tone(132, 0, 0.32, 0.17, { endFrequency: 48 });
      noise(0, 0.08, 540, 0.05, { attack: 0.002 });
      knock(220, 0.065, 0.15, 0, 0.11); break;
    case 'heaven':
      string(523.25, 0, 0.49, 0.08, { attack: 0.035, pan: -0.2 });
      jade(1046.5, 0.035, 0.4, 0.2, 0.085); break;
    case 'earth':
      string(130.81, 0, 0.37, 0.13, { attack: 0.008, endFrequency: 65.41 });
      noise(0.035, 0.09, 1050, 0.045, { attack: 0.002 });
      noise(0.06, 0.27, 240, 0.04, { filter: 'lowpass' }); break;
    case 'seven_pairs':
      knock(590, 0, 0.15, -0.15, 0.12); knock(593, 0.018, 0.15, 0.15, 0.085);
      jade(880, 0.085, 0.26, 0, 0.075); break;
    case 'wheel':
      [587.33, 784, 493.88, 392].forEach((pitch, i) => jade(pitch, i * 0.035, 0.29,
        [-0.4, 0.4, -0.2, 0][i], 0.085)); break;
    default:
      knock(480, 0, 0.13, 0, 0.14); jade(659.25, 0.025, 0.3, 0, 0.095);
  }
  return layers;
}

export function createCinematicAudio() {
  let context = null, master = null, compressor = null, noiseBuffer = null;
  let muted = true, disposed = false, unlocking = null, reduced = false;
  const voices = new Set();
  const lastPlayed = new Map();
  let lastCue = null;
  const contextClass = () => globalThis.AudioContext || globalThis.webkitAudioContext;
  const disconnect = node => { try { node?.disconnect(); } catch { /* already gone */ } };

  function release(voice, layer) {
    if (!voice.layers.delete(layer)) return;
    layer.source.onended = null;
    layer.nodes.forEach(disconnect);
    if (!voice.layers.size) voices.delete(voice);
  }
  function stopVoices() {
    for (const voice of [...voices]) {
      for (const layer of [...voice.layers]) {
        layer.source.onended = null;
        try { layer.source.stop(); } catch { /* already ended */ }
        release(voice, layer);
      }
      voices.delete(voice);
    }
  }
  function stopAll() { stopVoices(); lastPlayed.clear(); }

  function createGraph() {
    const next = new (contextClass())({ latencyHint: 'interactive' });
    let nextMaster, nextCompressor;
    try {
      nextMaster = next.createGain();
      nextMaster.gain.setValueAtTime(muted ? 0 : 0.2, next.currentTime);
      nextCompressor = next.createDynamicsCompressor();
      Object.entries({ threshold: -22, knee: 12, ratio: 5, attack: 0.003, release: 0.13 })
        .forEach(([key, value]) => { nextCompressor[key].value = value; });
      nextMaster.connect(nextCompressor); nextCompressor.connect(next.destination);
      const buffer = next.createBuffer(1, Math.ceil(next.sampleRate * 0.8), next.sampleRate);
      const data = buffer.getChannelData(0);
      let seed = 0x44494551;
      for (let i = 0; i < data.length; i++) {
        seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5;
        data[i] = (seed >>> 0) / 0x80000000 - 1;
      }
      context = next; master = nextMaster; compressor = nextCompressor; noiseBuffer = buffer;
    } catch (error) {
      disconnect(nextMaster); disconnect(nextCompressor);
      try { next.close().catch(() => {}); } catch { /* unsupported device */ }
      throw error;
    }
  }
  async function unlock() {
    if (disposed || !contextClass()) return false;
    if (unlocking) return unlocking;
    const attempt = (async () => {
      try {
        if (!context || context.state === 'closed') createGraph();
        if (context.state !== 'running') await context.resume();
        return !disposed && context.state === 'running';
      } catch { return false; }
    })();
    unlocking = attempt;
    try { return await attempt; }
    finally { if (unlocking === attempt) unlocking = null; }
  }
  function setMuted(value) {
    muted = Boolean(value);
    if (muted) stopAll();
    if (!context || !master || context.state === 'closed') return;
    try {
      master.gain.cancelScheduledValues(context.currentTime);
      if (muted) master.gain.setValueAtTime(0, context.currentTime);
      else master.gain.setTargetAtTime(0.2, context.currentTime, 0.008);
    } catch { /* context closed during interaction */ }
  }

  function schedule(voice, spec, start, speed) {
    // Faster playback compresses time, not pitch. Very short attacks remain softened.
    const scale = 1 / Math.max(1, speed);
    const at = start + spec.at * scale;
    const duration = Math.max(0.035, spec.duration * scale);
    const source = spec.kind === 'noise' ? context.createBufferSource() : context.createOscillator();
    const nodes = [source];
    const layer = { source, nodes };
    voice.layers.add(layer);
    const gain = context.createGain(); nodes.push(gain);
    let tail = source;
    if (spec.kind === 'noise') {
      source.buffer = noiseBuffer;
      const filter = context.createBiquadFilter(); nodes.push(filter);
      filter.type = spec.filter; filter.Q.value = spec.q;
      filter.frequency.setValueAtTime(spec.frequency, at);
      if (spec.endFrequency) filter.frequency.exponentialRampToValueAtTime(spec.endFrequency, at + duration);
      source.connect(filter); tail = filter;
    } else {
      source.type = spec.type;
      source.frequency.setValueAtTime(spec.frequency, at);
      if (spec.endFrequency) source.frequency.exponentialRampToValueAtTime(spec.endFrequency, at + duration);
    }
    tail.connect(gain); tail = gain;
    if (typeof context.createStereoPanner === 'function' && !reduced && (spec.pan || spec.endPan)) {
      const panner = context.createStereoPanner(); nodes.push(panner);
      panner.pan.setValueAtTime(spec.pan || 0, at);
      if (spec.endPan !== undefined) panner.pan.linearRampToValueAtTime(spec.endPan, at + duration);
      tail.connect(panner); tail = panner;
    }
    tail.connect(master);
    const attack = Math.max(0.003, Math.min(duration * 0.5, spec.attack * scale));
    gain.gain.setValueAtTime(0, at);
    gain.gain.linearRampToValueAtTime(spec.peak, at + attack);
    if (spec.shape === 'inhale') {
      gain.gain.setValueAtTime(spec.peak, at + duration * 0.67);
      gain.gain.linearRampToValueAtTime(0, at + duration);
    } else {
      gain.gain.exponentialRampToValueAtTime(0.0001, at + duration * 0.94);
      gain.gain.linearRampToValueAtTime(0, at + duration);
    }
    source.onended = () => release(voice, layer);
    source.start(at); source.stop(at + duration + 0.003);
  }

  function play(kind, family, recipe, speed, variant) {
    if (disposed || muted || !context || context.state !== 'running') return false;
    const now = context.currentTime;
    const cooldown = (kind === 'intro' ? 0.16 : 0.11) * Math.min(speed, 2);
    if (now - (lastPlayed.get(kind) ?? -Infinity) < cooldown) return false;
    // Every cut-in or impact replaces the previous phrase. There is never a sound queue.
    stopVoices();
    const voice = { layers: new Set() };
    voices.add(voice);
    try {
      for (const spec of recipe.slice(0, 48)) schedule(voice, spec, now + 0.006, speed);
      lastPlayed.set(kind, now);
      lastCue = { kind, family, variant, speed };
      return true;
    } catch { stopVoices(); return false; }
  }
  function playIntro({ effectId = 'normal', variant = 'rare', speed = 1, reducedMotion = false } = {}) {
    const family = resolveCinematicAudioFamily(effectId);
    const tier = tierOf(variant);
    reduced = Boolean(reducedMotion);
    return play('intro', family, introRecipe(family, tier, reduced), clampSpeed(speed), tier);
  }
  function playImpact({ effectId = 'normal', speed = 1 } = {}) {
    const family = resolveCinematicAudioFamily(effectId);
    return play('impact', family, impactRecipe(family), clampSpeed(speed));
  }
  function getState() {
    return { supported: Boolean(contextClass()), unlocked: !disposed && context?.state === 'running',
      muted, disposed, contextState: context?.state || 'not-created', activeVoices: voices.size,
      activeSources: [...voices].reduce((total, voice) => total + voice.layers.size, 0),
      lastCue: lastCue ? { ...lastCue } : null };
  }
  function dispose() {
    if (disposed) return;
    disposed = true; stopAll(); disconnect(master); disconnect(compressor); noiseBuffer = null;
    try { context?.close().catch(() => {}); } catch { /* already closed */ }
  }
  return Object.freeze({ unlock, setMuted, playIntro, playImpact, stopAll, dispose, getState });
}
