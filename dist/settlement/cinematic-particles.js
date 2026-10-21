/**
 * Deterministic, decorative Canvas layer for the settlement cut-in.
 * The owner supplies the clock, clears the canvas, and owns all lifecycle work.
 * Coordinates stay in the left two thirds; the right side is reserved for type.
 */
const TAU = Math.PI * 2;
const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
const mix = (a, b, progress) => a + (b - a) * progress;
const smooth = value => value * value * (3 - 2 * value);
const fraction = value => value - Math.floor(value);

function alpha(ctx, value, draw) {
  const before = ctx.globalAlpha;
  ctx.globalAlpha = before * clamp(value, 0, 1);
  try { draw(); } finally { ctx.globalAlpha = before; }
}

function stroke(ctx, draw, opacity = 1) {
  alpha(ctx, opacity, () => { ctx.beginPath(); draw(); ctx.stroke(); });
}

function dot(ctx, x, y, radius = 0.009, opacity = 1) {
  alpha(ctx, opacity, () => {
    ctx.beginPath(); ctx.arc(x, y, radius * 3.5, 0, TAU);
    alpha(ctx, 0.09, () => ctx.fill());
    ctx.beginPath(); ctx.arc(x, y, radius * 1.8, 0, TAU);
    alpha(ctx, 0.16, () => ctx.fill());
    ctx.beginPath(); ctx.arc(x, y, radius, 0, TAU); ctx.fill();
  });
}

function line(ctx, x1, y1, x2, y2, opacity = 1) {
  stroke(ctx, () => { ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); }, opacity);
}

function ring(ctx, x, y, radius, opacity = 1, start = 0, end = TAU) {
  stroke(ctx, () => ctx.arc(x, y, radius, start, end), opacity);
}

function leaf(ctx, x, y, length, angle, opacity = 1, feather = false) {
  ctx.save();
  try {
    ctx.translate(x, y); ctx.rotate(angle);
    stroke(ctx, () => {
      ctx.moveTo(-length / 2, 0);
      ctx.quadraticCurveTo(0, -length * 0.31, length / 2, 0);
      ctx.quadraticCurveTo(-length * 0.03, length * 0.13, -length / 2, 0);
    }, opacity);
    line(ctx, -length * 0.46, 0, length * 0.55, 0, opacity * 0.5);
    if (feather) {
      for (let i = 1; i < 4; i++) {
        const x0 = length * (i / 5 - 0.5);
        line(ctx, x0, 0, x0 + length * 0.12, -length * 0.15, opacity * 0.46);
      }
    }
  } finally { ctx.restore(); }
}

function seal(ctx, x, y, size, index, opacity = 1) {
  ctx.save();
  try {
    ctx.translate(x, y);
    stroke(ctx, () => ctx.rect(-size / 2, -size / 2, size, size), opacity);
    const q = size * 0.28;
    line(ctx, -q, -q, q, -q, opacity * 0.8);
    line(ctx, -q, 0, q, 0, opacity * 0.7);
    line(ctx, 0, -q, 0, q, opacity * 0.8);
    line(ctx, -q, q, q, q, opacity * 0.8);
    if (index % 2) line(ctx, -q, -q, -q, q, opacity * 0.6);
    else line(ctx, q, -q, q, q, opacity * 0.6);
  } finally { ctx.restore(); }
}

function normal(ctx, s) {
  const sweep = s.reduced ? 0.55 : fraction(s.t * 0.32);
  const end = mix(-0.85, 0.9, sweep);
  stroke(ctx, () => {
    ctx.moveTo(-0.87, 0.27);
    ctx.quadraticCurveTo(-0.13, -0.22, 0.88, -0.08);
  }, 0.15);
  if (!s.reduced) {
    stroke(ctx, () => {
      ctx.moveTo(end - 0.16, 0.05 - end * 0.17);
      ctx.quadraticCurveTo(end - 0.03, -0.06, end + 0.1, -0.035 - end * 0.1);
    }, 0.58 * Math.sin(sweep * Math.PI));
  }
  dot(ctx, end, -0.035 - end * 0.1, 0.008, s.reduced ? 0.27 : 0.65);
}

function dragons(ctx, s) {
  for (let i = 0; i < 3; i++) {
    const tilt = -0.42 + i * 0.43;
    const angle = i * TAU / 3 + s.t * (0.22 + i * 0.025);
    ctx.save();
    try {
      ctx.rotate(tilt);
      stroke(ctx, () => ctx.ellipse(0, 0, 0.75 + i * 0.05, 0.21 + i * 0.06, 0, 0, TAU), 0.18);
      dot(ctx, Math.cos(angle) * (0.75 + i * 0.05), Math.sin(angle) * (0.21 + i * 0.06), 0.017 + i * 0.003, 0.73);
      if (!s.reduced) {
        stroke(ctx, () => ctx.ellipse(0, 0, 0.75 + i * 0.05, 0.21 + i * 0.06, 0, angle - 0.6, angle), 0.45);
      }
    } finally { ctx.restore(); }
  }
  dot(ctx, 0, 0, 0.019, 0.36);
}

function orphans(ctx, s) {
  const count = s.reduced ? 5 : 13;
  const special = s.variant === 'thirteen_wait';
  for (let i = 0; i < count; i++) {
    const angle = -Math.PI * 0.9 + i / (count - 1) * Math.PI * 1.8;
    const distance = 0.75 + (special ? 0.018 * Math.sin(s.t * 1.3 + i) : 0);
    const x = Math.sin(angle) * distance;
    const y = -Math.cos(angle) * distance * 0.72;
    const emergence = s.reduced ? 1 : smooth(clamp(s.p * 2.1 - i / count * 0.75, 0, 1));
    stroke(ctx, () => {
      ctx.moveTo(x - 0.033, y + 0.075);
      ctx.lineTo(x - 0.033, y - 0.07 * emergence);
      ctx.lineTo(x + 0.033, y - 0.07 * emergence);
      ctx.lineTo(x + 0.033, y + 0.075);
    }, 0.28 * emergence);
    if (special && !s.reduced) dot(ctx, x, y - 0.085, 0.009, 0.52);
  }
  if (special) ring(ctx, 0, 0, 0.58, 0.17);
  if (!s.reduced) {
    const cut = smooth(clamp(s.p * 2.7 - 0.4, 0, 1));
    line(ctx, -0.77, 0.68, mix(-0.77, 0.75, cut), mix(0.68, -0.72, cut), 0.5 * (1 - 0.55 * cut));
    line(ctx, -0.73, 0.7, mix(-0.73, 0.78, cut), mix(0.7, -0.69, cut), 0.15);
  }
}

function concealed(ctx, s) {
  for (let layer = 0; layer < (s.reduced ? 2 : 4); layer++) {
    const base = -0.3 + layer * 0.24;
    stroke(ctx, () => {
      for (let j = 0; j <= 38; j++) {
        const x = -1.02 + j / 38 * 2.02;
        const y = base + Math.sin(x * 3.6 + s.t * 0.62 + layer * 0.8) * 0.075
          + Math.sin(x * 6.2 - layer) * 0.025;
        if (j === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
    }, 0.18 + layer * 0.035);
  }
  stroke(ctx, () => {
    ctx.moveTo(-0.76, -0.19);
    ctx.bezierCurveTo(-0.45, -0.58, 0.25, -0.54, 0.67, -0.18);
    ctx.quadraticCurveTo(0.4, -0.1, 0.17, -0.03);
    ctx.quadraticCurveTo(-0.16, 0.11, -0.52, -0.09);
    ctx.lineTo(-0.83, 0.04); ctx.lineTo(-0.76, -0.19);
  }, 0.16);
  if (s.variant === 'tanki') {
    dot(ctx, 0.04, 0.04, 0.018, 0.72);
    ring(ctx, 0.04, 0.04, s.reduced ? 0.12 : 0.12 + fraction(s.t * 0.22) * 0.26, 0.2);
  }
}

function winds(ctx, s) {
  const small = s.effectId === 'shousuushii';
  for (let arm = 0; arm < (small ? 3 : 4); arm++) {
    const direction = arm * Math.PI / 2 + Math.PI / 4;
    ctx.save();
    try {
      ctx.rotate(direction);
      stroke(ctx, () => {
        ctx.moveTo(0.12, 0.02); ctx.bezierCurveTo(0.41, -0.32, 0.78, 0.25, 1.02, -0.13);
      }, 0.16);
      for (let j = 0; j < (s.reduced ? 1 : 4); j++) {
        const flight = s.reduced ? 0.55 : fraction(j / 4 + s.t * 0.16 + arm * 0.04);
        // Small winds collect three arms; great winds open all four outwards.
        const x = small ? mix(0.92, 0.14, flight) : mix(0.14, 0.99, flight);
        const y = Math.sin(flight * TAU + arm * 0.3) * 0.13;
        leaf(ctx, x, y, 0.1 + j * 0.007, Math.PI - 0.4 + flight * 0.55, Math.sin(flight * Math.PI) * 0.42, true);
      }
    } finally { ctx.restore(); }
  }
  if (small) {
    const angle = Math.PI * 1.75;
    const returnToPair = s.reduced ? 0.9 : smooth(clamp(s.p * 1.6 - 0.2, 0, 1));
    const distance = mix(0.86, 0.08, returnToPair);
    line(ctx, Math.cos(angle) * 0.86, Math.sin(angle) * 0.86,
      Math.cos(angle) * 0.08, Math.sin(angle) * 0.08, 0.1);
    dot(ctx, Math.cos(angle) * distance, Math.sin(angle) * distance, 0.013, 0.55);
    ring(ctx, 0, 0, 0.075, 0.18);
  }
}

function honors(ctx, s) {
  const open = s.reduced ? 1 : smooth(clamp(s.p * 2, 0, 1));
  const width = mix(0.1, 0.87, open);
  for (const side of [-1, 1]) {
    const x = width * side;
    line(ctx, x, -0.5, x, 0.5, 0.36);
    ring(ctx, x, -0.5, 0.032, 0.4); ring(ctx, x, 0.5, 0.032, 0.4);
    stroke(ctx, () => {
      ctx.moveTo(0, -0.43); ctx.quadraticCurveTo(x * 0.65, -0.49, x, -0.43);
      ctx.moveTo(0, 0.43); ctx.quadraticCurveTo(x * 0.65, 0.49, x, 0.43);
    }, 0.18);
  }
  for (let i = 0; i < (s.reduced ? 3 : 7); i++) {
    const x = (i - (s.reduced ? 1 : 3)) * (s.reduced ? 0.25 : 0.19);
    const wave = s.reduced ? 0 : Math.sin(s.t * 0.5 + i * 0.7) * 0.015;
    seal(ctx, x * open, wave, 0.13, i, 0.22 + (i % 3) * 0.04);
  }
}

function green(ctx, s) {
  for (let stalk = 0; stalk < 3; stalk++) {
    const x = -0.83 + stalk * 0.2;
    const bend = Math.sin(s.t * 0.45 + stalk) * (s.reduced ? 0 : 0.05);
    stroke(ctx, () => { ctx.moveTo(x, 0.9); ctx.quadraticCurveTo(x - 0.06, 0, x + bend, -0.84); }, 0.11);
    for (let n = 0; n < 3; n++) line(ctx, x - 0.027, 0.5 - n * 0.43, x + 0.027, 0.5 - n * 0.43, 0.13);
  }
  for (let i = 0; i < (s.reduced ? 4 : 18); i++) {
    const flight = fraction(i * 0.61803398875 + s.t * 0.085);
    const x = mix(-1, 0.94, flight);
    const y = Math.sin(flight * Math.PI * 1.6 + i * 1.7) * 0.38 + ((i % 3) - 1) * 0.23;
    leaf(ctx, x, y, 0.055 + (i % 4) * 0.017, -0.5 + Math.sin(flight * TAU + i) * 0.6, (s.reduced ? 0.3 : Math.sin(flight * Math.PI) * 0.4));
  }
}

function terminals(ctx, s) {
  for (const side of [-1, 1]) {
    stroke(ctx, () => {
      ctx.moveTo(-0.98, side * 0.75); ctx.lineTo(-0.72, side * 0.34);
      ctx.lineTo(-0.52, side * 0.51); ctx.lineTo(-0.19, side * 0.19);
      ctx.lineTo(0.11, side * 0.42); ctx.lineTo(0.48, side * 0.22);
      ctx.lineTo(0.9, side * 0.69);
    }, 0.21);
  }
  const opening = s.reduced ? 0.08 : smooth(clamp(s.p * 2.4 - 0.2, 0, 1)) * 0.16;
  for (const side of [-1, 1]) {
    stroke(ctx, () => {
      ctx.moveTo(-0.8, -0.65 + side * opening); ctx.lineTo(-0.37, -0.21 + side * opening);
      ctx.lineTo(-0.48, 0.01 + side * opening); ctx.lineTo(0.08, 0.03 + side * opening);
      ctx.lineTo(0.21, 0.28 + side * opening); ctx.lineTo(0.82, 0.66 + side * opening);
    }, 0.25);
  }
  if (!s.reduced) {
    for (let i = 0; i < 8; i++) {
      const drift = fraction(s.t * 0.15 + i * 0.137);
      const x = -0.72 + i * 0.2;
      line(ctx, x, drift * 0.5 - 0.17, x + 0.025, drift * 0.5 - 0.125, (1 - drift) * 0.23);
    }
  }
}

function lotus(ctx, s) {
  const pure = s.variant === 'pure';
  const bloom = s.reduced ? 1 : smooth(clamp(s.p * 1.8, 0, 1));
  for (let i = 0; i < 9; i++) {
    const angle = i * TAU / 9 - Math.PI / 2;
    ctx.save();
    try {
      ctx.rotate(angle);
      stroke(ctx, () => {
        ctx.moveTo(0.03, 0);
        ctx.bezierCurveTo(0.27, -0.19 * bloom, 0.58, -0.17 * bloom, 0.71, 0);
        ctx.bezierCurveTo(0.58, 0.17 * bloom, 0.27, 0.19 * bloom, 0.03, 0);
      }, s.reduced ? 0.13 : 0.19);
    } finally { ctx.restore(); }
    const lamp = s.reduced ? 0.27 : 0.35 + 0.2 * Math.sin(s.t * 1.1 + (pure ? 0 : i * 0.5));
    dot(ctx, Math.cos(angle) * 0.83, Math.sin(angle) * 0.83, pure ? 0.015 : 0.01, lamp);
  }
  if (pure) ring(ctx, 0, 0, 0.9, 0.12);
  dot(ctx, 0, 0, 0.02, 0.32);
}

function kongs(ctx, s) {
  for (let i = 0; i < 4; i++) {
    const x = (i - 1.5) * 0.45;
    const landing = s.reduced ? 1 : smooth(clamp(s.p * 2.5 - i * 0.22, 0, 1));
    const y = mix(-0.82, 0.25, landing);
    seal(ctx, x, y, 0.22, i, 0.35);
    line(ctx, x - 0.09, y - 0.48, x - 0.09, y - 0.13, 0.13);
    line(ctx, x + 0.09, y - 0.48, x + 0.09, y - 0.13, 0.13);
    if (!s.reduced) {
      const pulse = fraction(s.t * 0.22 + i * 0.25);
      stroke(ctx, () => {
        ctx.moveTo(x, -0.86); ctx.lineTo(x + 0.04, -0.59);
        ctx.lineTo(x - 0.045, -0.39); ctx.lineTo(x + 0.025, -0.12);
        ctx.lineTo(x, y - 0.12);
      }, 0.1 + Math.pow(Math.sin(pulse * Math.PI), 6) * 0.14);
      stroke(ctx, () => ctx.ellipse(x, 0.42, 0.14 + pulse * 0.1, 0.035, 0, 0, TAU), (1 - pulse) * 0.19);
    }
  }
}

function heaven(ctx, s) {
  const spread = s.reduced ? 1 : smooth(clamp(s.p * 2.1, 0, 1));
  for (let i = 0; i < (s.reduced ? 3 : 9); i++) {
    const count = s.reduced ? 3 : 9;
    const x = (i / (count - 1) - 0.5) * 1.8 * spread;
    stroke(ctx, () => {
      ctx.moveTo(x * 0.12, -0.9);
      ctx.bezierCurveTo(x * 0.18, -0.48, x * 0.8, -0.05, x, 0.71);
    }, 0.1 + (i % 3) * 0.025);
    if (!s.reduced) {
      const fall = fraction(s.t * 0.12 + i * 0.173);
      dot(ctx, x * (0.12 + fall * 0.88), mix(-0.83, 0.68, fall), 0.008, Math.sin(fall * Math.PI) * 0.35);
    }
  }
  stroke(ctx, () => ctx.ellipse(0, -0.74, 0.5 * spread, 0.11, 0, 0, TAU), 0.28);
}

function earth(ctx, s) {
  for (let branch = 0; branch < (s.reduced ? 3 : 7); branch++) {
    const angle = -Math.PI + branch / (s.reduced ? 2 : 6) * Math.PI;
    const x = Math.cos(angle) * 0.96;
    const y = 0.57 + Math.sin(angle) * 0.24;
    stroke(ctx, () => {
      ctx.moveTo(0, 0.55); ctx.lineTo(x * 0.24, y + 0.04);
      ctx.lineTo(x * 0.51, y - 0.045); ctx.lineTo(x * 0.72, y + 0.025); ctx.lineTo(x, y);
    }, 0.25);
  }
  for (let i = 0; i < (s.reduced ? 3 : 15); i++) {
    const rise = s.reduced ? 0.25 + i * 0.11 : fraction(s.t * 0.13 + i * 0.61803398875);
    const x = Math.sin(i * 2.4) * (0.7 - rise * 0.25) + Math.sin(rise * 3 + i) * 0.04;
    const y = 0.57 - rise * 1.3;
    dot(ctx, x, y, 0.005 + (i % 3) * 0.0025, (1 - rise) * 0.35);
  }
}

function sevenPairs(ctx, s) {
  const count = s.reduced ? 3 : 7;
  for (let i = 0; i < count; i++) {
    const angle = -Math.PI * 0.9 + i / (count - 1) * Math.PI * 1.8;
    const y = Math.sin(angle) * 0.68;
    const merge = s.reduced ? 0.8 : smooth(0.5 - 0.5 * Math.cos(s.t * 0.8 + i * 0.32));
    const separation = mix(0.24, 0.025, merge);
    const x = Math.cos(angle) * 0.48 - 0.19;
    stroke(ctx, () => {
      ctx.moveTo(x - 0.28, y); ctx.quadraticCurveTo(x, y - 0.12, x + 0.28, y);
    }, 0.1);
    dot(ctx, x - separation, y, 0.012, 0.47);
    dot(ctx, x + separation, y, 0.012, 0.47);
    if (merge > 0.84) ring(ctx, x, y, 0.035 + (merge - 0.84) * 0.16, 0.2);
  }
}

function wheel(ctx, s) {
  const angle = s.t * 0.13;
  ring(ctx, 0, 0, 0.8, 0.23);
  ring(ctx, 0, 0, 0.67, 0.12);
  ring(ctx, 0, 0, 0.16, 0.23);
  // Seven spokes carry seven pairs, rather than fourteen unrelated spokes.
  for (let i = 0; i < 7; i++) {
    const a = i * TAU / 7 + angle;
    line(ctx, Math.cos(a) * 0.18, Math.sin(a) * 0.18, Math.cos(a) * 0.66, Math.sin(a) * 0.66, 0.16);
    ctx.save();
    try {
      ctx.rotate(a); ctx.translate(0.8, 0);
      for (const offset of [-0.034, 0.034]) {
        stroke(ctx, () => ctx.rect(-0.06, offset - 0.026, 0.12, 0.052), 0.25);
      }
    } finally { ctx.restore(); }
  }
  if (!s.reduced) {
    ring(ctx, 0, 0, 0.86, 0.42, angle, angle + Math.PI * 0.4);
    ring(ctx, 0, 0, 0.86, 0.19, angle + Math.PI, angle + Math.PI * 1.4);
  }
}

function straight(ctx, s) {
  const yAt = x => Math.sin((x + 0.9) * Math.PI / 1.8) * -0.28 + 0.13;
  stroke(ctx, () => {
    for (let i = 0; i <= 36; i++) {
      const x = -0.9 + i * 0.05;
      if (i === 0) ctx.moveTo(x, yAt(x)); else ctx.lineTo(x, yAt(x));
    }
  }, 0.2);
  for (let i = 0; i < 9; i++) {
    const x = -0.9 + i * 0.225;
    const reveal = s.reduced ? 0.32 : clamp(s.p * 1.9 - i * 0.105, 0.12, 0.7);
    dot(ctx, x, yAt(x), 0.011, reveal);
  }
  if (!s.reduced) {
    const head = mix(-0.9, 0.9, fraction(s.t * 0.2));
    dot(ctx, head, yAt(head), 0.016, 0.64);
    line(ctx, head - 0.08, yAt(head - 0.08), head, yAt(head), 0.38);
  }
}

function parallelStreams(ctx, s) {
  const colors = ['#dca28b', '#90cba9', '#d2d7ec'];
  const original = ctx.strokeStyle;
  try {
    for (let row = 0; row < 3; row++) {
      const y = (row - 1) * 0.26;
      ctx.strokeStyle = colors[row];
      stroke(ctx, () => {
        ctx.moveTo(-0.92, y + 0.07);
        ctx.bezierCurveTo(-0.42, y - 0.13, 0.42, y - 0.13, 0.92, y + 0.07);
      }, 0.26);
      for (let j = 0; j < 3; j++) {
        const flight = s.reduced ? 0.26 + j * 0.24 : fraction(s.t * 0.17 + j / 3);
        const x = mix(-0.9, 0.9, flight);
        const arcY = y - 0.08 + 0.15 * (2 * flight - 1) ** 2;
        dot(ctx, x, arcY, 0.008, 0.38);
        line(ctx, x - 0.045, arcY, x + 0.025, arcY, 0.3);
      }
    }
  } finally { ctx.strokeStyle = original; }
}

function longWind(ctx, s) {
  for (let ribbon = 0; ribbon < (s.reduced ? 3 : 6); ribbon++) {
    const baseline = (ribbon - (s.reduced ? 1 : 2.5)) * 0.15;
    const phase = s.t * 0.45;
    stroke(ctx, () => {
      for (let j = 0; j <= 26; j++) {
        const x = mix(-1.02, 0.97, j / 26);
        const y = baseline + Math.sin(x * 2.1 - phase) * 0.11;
        if (j === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
    }, 0.12 + ribbon % 2 * 0.05);
    if (!s.reduced) {
      const x = mix(-0.96, 0.91, fraction(s.t * 0.13 + ribbon * 0.157));
      const y = baseline + Math.sin(x * 2.1 - phase) * 0.11;
      line(ctx, x - 0.09, y - 0.012, x + 0.06, y + 0.012, 0.36);
    }
  }
}

function linkedPairs(ctx, s) {
  const yAt = i => Math.sin(i / 6 * Math.PI) * -0.18 + 0.08;
  for (let i = 0; i < 7; i++) {
    const x = -0.84 + i * 0.28;
    const formed = s.reduced ? 1 : smooth(clamp(s.p * 2.15 - i * 0.135, 0, 1));
    const separation = mix(0.11, 0.021, formed);
    dot(ctx, x, yAt(i) - separation, 0.01, 0.38);
    dot(ctx, x, yAt(i) + separation, 0.01, 0.38);
    if (i > 0) {
      const fromX = x - 0.28;
      line(ctx, fromX, yAt(i - 1), mix(fromX, x, formed), mix(yAt(i - 1), yAt(i), formed), 0.25);
    }
  }
  if (!s.reduced) {
    const along = fraction(s.t * 0.19) * 6;
    dot(ctx, -0.84 + along * 0.28, yAt(along), 0.014, 0.55);
  }
}

function mirrorPairs(ctx, s) {
  for (const group of [-1, 1]) {
    const cx = group * 0.43;
    for (const mirror of [-1, 1]) {
      stroke(ctx, () => {
        ctx.moveTo(cx - 0.32, 0);
        ctx.bezierCurveTo(cx - 0.15, mirror * 0.34, cx + 0.15, mirror * 0.34, cx + 0.32, 0);
      }, 0.23);
      for (let i = 0; i < (s.reduced ? 1 : 3); i++) {
        const phase = s.reduced ? 0.5 : fraction(s.t * 0.16 + i / 3);
        const flight = mirror < 0 ? phase : 1 - phase;
        const x = cx + mix(-0.32, 0.32, flight);
        const y = mirror * Math.sin(flight * Math.PI) * 0.255;
        dot(ctx, x, y, 0.01, 0.4);
      }
    }
    line(ctx, cx, -0.38, cx, 0.38, 0.07);
  }
}

function repeatedArcs(ctx, s) {
  const count = s.effectId === 'pure_quadruple_chow' ? 4 : 3;
  for (let layer = 0; layer < count; layer++) {
    const y = (layer - (count - 1) / 2) * 0.18;
    const appear = s.reduced ? 1 : smooth(clamp(s.p * 2.2 - layer * 0.12, 0, 1));
    stroke(ctx, () => ctx.ellipse(0, y + 0.22, 0.84, 0.33, 0, Math.PI, TAU), 0.15 + appear * 0.1);
    for (let i = 0; i < 3; i++) {
      const flight = s.reduced ? (i + 1) / 4 : fraction(s.t * 0.13 + i / 3);
      const a = Math.PI + flight * Math.PI;
      dot(ctx, Math.cos(a) * 0.84, y + 0.22 + Math.sin(a) * 0.33, 0.008, 0.37);
    }
  }
}

function ascendingSteps(ctx, s) {
  const count = s.effectId === 'pure_quadruple_pung' ? 4 : 3;
  let previous = null;
  for (let i = 0; i < count; i++) {
    const x = mix(-0.66, 0.66, i / (count - 1));
    const raised = s.reduced ? 1 : smooth(clamp(s.p * 2.5 - i * 0.28, 0, 1));
    const y = mix(0.62, 0.24 - i * 0.23, raised);
    line(ctx, x - 0.16, y, x + 0.16, y, 0.38);
    line(ctx, x - 0.16, y + 0.075, x + 0.16, y + 0.075, 0.12);
    if (previous) {
      stroke(ctx, () => {
        ctx.moveTo(previous.x + 0.16, previous.y);
        ctx.lineTo(x - 0.16, previous.y); ctx.lineTo(x - 0.16, y);
      }, 0.16);
    }
    for (let member = 0; member < 3; member++) {
      const px = x + (member - 1) * 0.09;
      stroke(ctx, () => ctx.rect(px - 0.028, y - 0.12, 0.056, 0.095), 0.22);
      if (!s.reduced) {
        const rise = fraction(s.t * 0.18 + i * 0.12 + member * 0.1);
        line(ctx, px, y + 0.17 - rise * 0.23, px, y + 0.2 - rise * 0.23, (1 - rise) * 0.14);
      }
    }
    previous = { x, y };
  }
}

function jiangStamp(ctx, x, y, rank, opacity) {
  ctx.save();
  try {
    ctx.translate(x, y);
    stroke(ctx, () => ctx.rect(-0.095, -0.095, 0.19, 0.19), opacity);
    if (rank === 2) {
      line(ctx, -0.046, -0.035, 0.046, -0.035, opacity);
      line(ctx, -0.06, 0.041, 0.06, 0.041, opacity);
    } else if (rank === 5) {
      line(ctx, -0.057, -0.055, 0.057, -0.055, opacity);
      line(ctx, -0.03, -0.003, 0.038, -0.003, opacity);
      line(ctx, -0.064, 0.058, 0.064, 0.058, opacity);
      line(ctx, -0.015, -0.055, -0.031, 0.058, opacity);
      line(ctx, 0.038, -0.003, 0.038, 0.058, opacity);
    } else {
      line(ctx, -0.019, -0.05, -0.065, 0.06, opacity);
      line(ctx, 0.02, -0.052, 0.065, 0.059, opacity);
    }
  } finally { ctx.restore(); }
}

function jiangColumns(ctx, s) {
  for (let column = 0; column < 3; column++) {
    const x = (column - 1) * 0.48;
    line(ctx, x, -0.63, x, 0.63, 0.08);
    for (let row = 0; row < (s.reduced ? 1 : 3); row++) {
      const drift = s.reduced ? 0 : Math.sin(s.t * 0.7 + column * 0.5) * 0.022;
      const y = s.reduced ? 0 : (row - 1) * 0.37 + drift;
      jiangStamp(ctx, x, y, [2, 5, 8][column], 0.26);
    }
  }
}

function brokenSeal(ctx, s) {
  const opening = s.reduced ? 0.055 : smooth(clamp(s.p * 2, 0, 1)) * 0.09;
  for (const side of [-1, 1]) {
    const x = side * opening;
    stroke(ctx, () => {
      ctx.moveTo(x, -0.35); ctx.lineTo(x + side * 0.3, -0.35);
      ctx.lineTo(x + side * 0.3, 0.35); ctx.lineTo(x, 0.35);
      ctx.lineTo(x + side * 0.045, 0.15); ctx.lineTo(x - side * 0.025, -0.04);
      ctx.lineTo(x + side * 0.035, -0.19);
    }, 0.23);
    if (!s.reduced) line(ctx, side * 0.14, 0.4, side * 0.16, 0.5 + fraction(s.t * 0.17) * 0.08, 0.11);
  }
}

function scoreRise(ctx, s) {
  for (let i = 0; i < (s.reduced ? 3 : 6); i++) {
    const rise = s.reduced ? 0.2 + i * 0.25 : fraction(s.t * 0.12 + i / 6);
    const y = mix(0.6, -0.68, rise);
    const breadth = mix(0.57, 0.23, rise);
    stroke(ctx, () => {
      ctx.moveTo(-breadth, y + 0.06); ctx.quadraticCurveTo(0, y - 0.05, breadth, y + 0.06);
    }, (1 - rise) * 0.25);
    dot(ctx, 0, y, 0.008, (1 - rise) * 0.23);
  }
}

function multiplierCoil(ctx, s) {
  const angle = s.t * 0.19;
  for (let strand = 0; strand < (s.reduced ? 2 : 3); strand++) {
    stroke(ctx, () => {
      for (let j = 0; j <= 44; j++) {
        const q = j / 44;
        const a = angle + q * TAU * 1.3 + strand * TAU / 3;
        const r = mix(0.13, 0.84, q);
        if (j === 0) ctx.moveTo(Math.cos(a) * r, Math.sin(a) * r);
        else ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r);
      }
    }, 0.2);
  }
}

const THEMES = Object.freeze({
  normal, dragons, orphans, concealed, winds, honors, green, terminals,
  lotus, kongs, heaven, earth, seven_pairs: sevenPairs, wheel,
});

// These effects share an illustration family, but never just recolor its motion.
const CHOREOGRAPHY = Object.freeze({
  false_hu: brokenSeal, score: scoreRise, multiplier: multiplierCoil,
  ittsuu: straight, sanshoku: parallelStreams, chinitsu: longWind,
  renqiidui: linkedPairs, ryanpeikou: mirrorPairs,
  pure_triple_chow: repeatedArcs, pure_quadruple_chow: repeatedArcs,
  pure_triple_pung: ascendingSteps, pure_quadruple_pung: ascendingSteps,
  all_jiang: jiangColumns,
});

/** Draws without clearing the canvas or retaining any state between frames. */
export function drawTheme(ctx, {
  width, height, time = 0, progress = 0, family = 'normal', variant = '', effectId = '',
  color = '#d6bb79', accent = '#fff1c0', reducedMotion = false,
} = {}) {
  if (!ctx || !Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return;
  const p = clamp(Number.isFinite(progress) ? progress : 0, 0, 1);
  const radius = Math.min(width * 0.28, height * 0.4);
  const reduced = Boolean(reducedMotion);
  const state = {
    t: reduced ? 0 : Math.max(0, Number.isFinite(time) ? time : 0) / 1000,
    p, variant, reduced, effectId,
  };
  ctx.save();
  try {
    ctx.beginPath(); ctx.rect(0, 0, width * 0.68, height); ctx.clip();
    ctx.translate(width * 0.36, height * 0.45); ctx.scale(radius, radius);
    ctx.globalCompositeOperation = 'screen';
    ctx.globalAlpha *= smooth(clamp(p / 0.13, 0, 1)) * (reduced ? 0.65 : 0.85);
    ctx.lineWidth = Math.max(0.75, Math.min(width, height) / 680) / radius;
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.strokeStyle = typeof color === 'string' ? color : '#d6bb79';
    ctx.fillStyle = typeof accent === 'string' ? accent : '#fff1c0';
    const draw = Object.hasOwn(CHOREOGRAPHY, effectId) ? CHOREOGRAPHY[effectId]
      : Object.hasOwn(THEMES, family) ? THEMES[family] : THEMES.normal;
    draw(ctx, state);
  } finally { ctx.restore(); }
}
