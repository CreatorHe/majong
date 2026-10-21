import { drawTheme } from './cinematic-particles.js';
import { MOTION_THEMES, MotionVideo } from './motion-v3.js';

const clamp = value => Math.max(0, Math.min(1, value));
const ease = value => 1 - (1 - clamp(value)) ** 3;
const between = (p, start, end) => ease((p - start) / (end - start));
function camera(family, p) {
  const arrive = 1 - between(p, .18, .7), drift = between(p, .55, 1);
  // The image and foreground hand move on different planes, with a direction per motif.
  const paths = {
    dragons: [-4, 1, -2.8, .15], orphans: [0, 8, -.7, .19], concealed: [-2, 13, -3.2, .19],
    winds: [-11, 4, 3.4, .2], honors: [-8, 0, -1.6, .14], green: [-5, 2, 1, .12],
    terminals: [0, -6, 0, .16], lotus: [0, 3, -1, .22], kongs: [0, -12, .7, .19],
    heaven: [1, -7, 1.2, .18], earth: [0, 10, -.6, .18], seven_pairs: [-3, 0, -2, .14],
    wheel: [0, 0, -5, .18], normal: [0, 3, 0, .1],
  };
  const [x, y, rotation, zoom] = paths[family] || paths.normal;
  return `translate3d(${x * arrive}%,${y * arrive}%,0) rotate(${rotation * arrive}deg) scale(${1.035 + zoom * arrive + .018 * drift})`;
}
const make = (tag, cls, text) => {
  const el = document.createElement(tag); el.className = cls;
  if (text !== undefined) el.textContent = text;
  return el;
};

/** The stage is driven entirely by the player's clock. No independent animation loop. */
export class CinematicStage {
  constructor(profile, snapshot, tileUrl) {
    this.profile = profile; this.snapshot = snapshot; this.last = null; this.disposed = false;
    this.motion = snapshot.handResult === 'agari' ? MOTION_THEMES[profile.id] : null;
    this.el = make('div', 'jr-theater'); this.el.dataset.family = profile.family;
    this.el.style.setProperty('--cine-color', profile.color);
    this.el.style.setProperty('--cine-accent', profile.accent);
    this.el.setAttribute('aria-label', `${profile.label} · ${profile.subtitle}`);
    this.backdrop = make('div', 'jr-cine-backdrop');
    this.art = make('img', 'jr-cine-art'); this.art.alt = ''; this.art.draggable = false;
    if (this.motion || profile.art) {
      this.art.src = this.motion?.poster || new URL(profile.art, import.meta.url).href;
      this.art.addEventListener('error', () => { this.art.hidden = true; this.el.dataset.imageFallback = 'true'; }, { once: true });
    } else this.art.hidden = true;
    this.mediaHost = make('div','jr-cine-media');
    this.backdrop.append(this.art, this.mediaHost, make('div', 'jr-cine-shade'));
    if(this.motion){this.media=new MotionVideo(this.mediaHost,this.motion.video);this.el.dataset.motionVersion='3';}
    this.canvas = make('canvas', 'jr-cine-canvas'); this.canvas.setAttribute('aria-hidden', 'true');
    this.ctx = this.canvas.getContext?.('2d');
    this.curtain = make('div', 'jr-cine-curtain');
    this.title = make('div', 'jr-cine-heading');
    this.eyebrow = make('div', 'jr-cine-eyebrow', profile.rarity === '普通' ? '一 手 成 境' : profile.rarity);
    this.titleText = make('strong', 'jr-cine-title', profile.id === 'normal' ? (snapshot.presentation?.winMethod === 'ron' ? '荣和' : snapshot.presentation?.winMethod === 'tsumo' ? '自摸' : '和牌') : profile.label);
    this.variant = make('span', 'jr-cine-variant', profile.variantLabel);
    this.subtitle = make('span', 'jr-cine-subtitle', profile.subtitle);
    this.title.append(this.eyebrow, this.titleText, this.variant, this.subtitle);
    this.stamp = make('span', 'jr-cine-stamp', '叠雀'); this.stamp.setAttribute('aria-hidden', 'true');
    this.title.append(this.stamp);
    this.fan = make('div', 'jr-cine-fan'); this.fan.setAttribute('aria-hidden', 'true');
    this.fanTiles = snapshot.hand.tiles.map((tile, index, all) => {
      const el = this.makeTile(tile, tileUrl); el.dataset.tileId = tile.id;
      el.style.setProperty('--tile-position', String(index - (all.length - 1) / 2));
      el.style.setProperty('--tile-arc', String(((index - (all.length - 1) / 2) / all.length) ** 2));
      el.style.zIndex = String(index + 1);
      if (tile.id === snapshot.hand.winningTileId) el.classList.add('is-winning');
      this.fan.append(el); return el;
    });
    const winning = snapshot.hand.tiles.find(t => t.id === snapshot.hand.winningTileId) || snapshot.hand.tiles.at(-1);
    this.flying = this.makeTile(winning, tileUrl); this.flying.classList.add('jr-cine-flying'); this.flying.setAttribute('aria-hidden', 'true');
    this.ray = make('div', 'jr-cine-rise');
    this.el.append(this.backdrop, this.canvas, this.curtain, this.ray, this.flying, this.title, this.fan);
    this.resize = () => {
      if (this.disposed) return;
      const bounds = this.el.getBoundingClientRect(); this.width = bounds.width || 1000; this.height = bounds.height || 562.5;
      const ratio = Math.min(1.5, globalThis.devicePixelRatio || 1);
      this.canvas.width = Math.round(this.width * ratio); this.canvas.height = Math.round(this.height * ratio); this.ratio = ratio;
      this.el.style.setProperty('--fan-tile', Math.min(63, this.width * .82 / (snapshot.hand.tiles.length * .88 + 1)) + 'px');
      if (this.last) this.render(this.last.p, this.last.options);
    };
    if (globalThis.ResizeObserver) { this.observer = new ResizeObserver(this.resize); this.observer.observe(this.el); }
  }
  makeTile(tile, tileUrl) {
    const el = make('span', 'jr-cine-tile'), img = make('img', '');
    img.src = tileUrl(tile); img.alt = tile?.label || ''; img.draggable = false;
    img.addEventListener('error', () => { img.hidden = true; el.append(make('span', 'jr-cine-tile-fallback', tile?.label || '牌')); }, { once: true });
    el.append(img); return el;
  }
  render(progress, options = {}) {
    if (this.disposed) return;
    this.last = { p: progress, options };
    const p = clamp(progress), reduced = !!options.reducedMotion, still = options.poster || reduced || options.phase === 'result';
    const q = still ? .72 : p;
    const reveal = between(q, .18, .43), text = between(q, .39, .54), fan = between(q, .5, .68);
    this.el.dataset.phase = options.phase || 'intro';
    this.el.dataset.beat = q < .18 ? 'rise' : q < .39 ? 'reveal' : q < .55 ? 'title' : 'hold';
    this.el.dataset.progress = p.toFixed(3);
    this.media?.render(p, options);
    this.backdrop.style.transform = still || this.motion ? 'scale(1)' : camera(this.profile.family, q);
    this.backdrop.style.opacity = this.motion ? '1' : String(.22 + reveal * .78);
    this.curtain.style.opacity = this.motion ? '0' : String(1 - reveal);
    this.curtain.style.transform = `translateX(${reveal * -110}%) skewX(-12deg)`;
    this.title.style.opacity = String(text * (1 - (options.exit || 0)));
    this.title.style.transform = `translate3d(${(1 - text) * 90}px,${(1 - text) * -8}px,0) rotate(-5deg) scale(${1 + (1 - text) * .18})`;
    this.fan.style.opacity = String(fan * (1 - (options.exit || 0)));
    this.fan.style.transform = `translate(-50%,${(1 - fan) * 90}px) rotate(-3deg)`;
    const flight = between(q, 0, .27), vanish = between(q, .24, .35);
    this.flying.style.opacity = String(still || this.profile.id === 'false_hu' ? 0 : Math.min(1, q * 25) * (1 - vanish));
    this.flying.style.transform = `translate(-50%,${70 - flight * 120}%) perspective(800px) rotateY(${(1 - flight) * -170}deg) rotateZ(${-16 + flight * 8}deg) scale(${.35 + flight * 1.15})`;
    this.ray.style.opacity = String(still || this.profile.id === 'false_hu' ? 0 : Math.sin(Math.PI * clamp(q / .34)) * .65);
    if (this.ctx) {
      const ctx = this.ctx; ctx.setTransform(this.ratio || 1, 0, 0, this.ratio || 1, 0, 0); ctx.clearRect(0, 0, this.width || 1000, this.height || 562);
      if (!this.motion && this.profile.id !== 'false_hu' && reveal > 0) {
        ctx.save(); ctx.globalAlpha = reveal * (options.phase === 'result' ? .15 : .75);
        drawTheme(ctx, { width: this.width || 1000, height: this.height || 562, time: (still ? .72 : p) * this.profile.introMs,
          progress: q, family: this.profile.family, variant: this.profile.variant, effectId: this.profile.id,
          color: this.profile.color, accent: this.profile.accent, reducedMotion: still }); ctx.restore();
      }
    }
  }
  stopMotion(){this.media?.cancel();}
  dispose() { this.disposed = true; this.media?.dispose(); this.observer?.disconnect(); }
}
