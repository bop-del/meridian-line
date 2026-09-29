// Character portraits drawn with canvas 2d primitives (no images, no text glyphs).
// One helmeted human pilot (VEX), one full-face visor helmet with a data-lens glyph and no eyes (FERRO), one abstract waveform (REGENT). PIP, LUMEN, CONTROL and SABLE have no portrait:
// they use the text readout strip (see READOUTS). Each drawer receives (g, mouth, t) in a 96 x 96 space.

const OUT = '#070b16';
const TAU = Math.PI * 2;

function ell(g, x, y, rx, ry, fill, stroke = OUT, lw = 2, rot = 0) {
  g.beginPath();
  g.ellipse(x, y, Math.max(0.01, rx), Math.max(0.01, ry), rot, 0, TAU);
  if (fill) { g.fillStyle = fill; g.fill(); }
  if (stroke) { g.lineWidth = lw; g.strokeStyle = stroke; g.stroke(); }
}

function poly(g, pts, fill, stroke = OUT, lw = 2) {
  g.beginPath();
  g.moveTo(pts[0], pts[1]);
  for (let i = 2; i < pts.length; i += 2) g.lineTo(pts[i], pts[i + 1]);
  g.closePath();
  if (fill) { g.fillStyle = fill; g.fill(); }
  if (stroke) { g.lineWidth = lw; g.strokeStyle = stroke; g.lineJoin = 'round'; g.stroke(); }
}

function line(g, pts, color, lw = 2) {
  g.beginPath();
  g.moveTo(pts[0], pts[1]);
  for (let i = 2; i < pts.length; i += 2) g.lineTo(pts[i], pts[i + 1]);
  g.lineWidth = lw; g.strokeStyle = color; g.lineCap = 'round'; g.lineJoin = 'round'; g.stroke();
}

// short blink every few seconds, per portrait offset
function blinkOf(t, seed) {
  const p = (t * 0.8 + seed) % 3.6;
  return p > 3.4 ? 1 : p > 3.3 ? 0.5 : 0;
}

// Mouth centred at (x, y): closed line with a curve, or an open ellipse that follows the talk value.
function mouth(g, x, y, w, open, curve = 1, tilt = 0) {
  if (open < 0.12) {
    line(g, [x - w, y - tilt, x, y + curve, x + w, y + tilt], '#2a1214', 2.4);
    return;
  }
  ell(g, x, y + open * 1.5, w * (0.55 + open * 0.2), 1.6 + open * 4.6, '#2a0d10', OUT, 1.6);
  if (open > 0.5) { g.fillStyle = '#f4efe6'; g.fillRect(x - w * 0.42, y - 1.4 + open * 1.5 - 2, w * 0.84, 2); }
}

// ==== pilots
// o: { skin, suit, trim, shell, shellDark, accent, visor, visorLight, seed, ... }
function pilot(g, o, talk, t) {
  const blink = blinkOf(t, o.seed);

  o.back?.(g, t);

  // shoulders and collar
  poly(g, [4, 96, 12, 83, 32, 76, 64, 76, 84, 83, 92, 96], o.suit);
  poly(g, [36, 76, 48, 90, 60, 76, 56, 74, 48, 80, 40, 74], o.trim, OUT, 1.5);
  line(g, [16, 88, 30, 82], o.accent, 2);
  line(g, [80, 88, 66, 82], o.accent, 2);
  // neck
  g.fillStyle = o.skinDark; g.fillRect(40, 66, 16, 12);

  // face (jaw), visible below the visor
  g.beginPath();
  g.moveTo(26, 48); g.lineTo(26, 62 + (o.jawDrop || 0) * 0.3);
  g.quadraticCurveTo(29, 82 + (o.jawDrop || 0), 48, 84 + (o.jawDrop || 0));
  g.quadraticCurveTo(67, 82 + (o.jawDrop || 0), 70, 62 + (o.jawDrop || 0) * 0.3);
  g.lineTo(70, 48); g.closePath();
  g.fillStyle = o.skin; g.fill(); g.lineWidth = 2; g.strokeStyle = OUT; g.stroke();
  // jaw shadow
  g.fillStyle = 'rgba(0,0,0,0.16)';
  g.beginPath(); g.moveTo(28, 70); g.quadraticCurveTo(48, 90, 68, 70); g.lineTo(66, 82); g.quadraticCurveTo(48, 92, 30, 82); g.fill();
  // nose
  line(g, [48, 57, 45.5, 62, 49.5, 62.5], o.skinDark, 1.8);

  o.face?.(g, t, talk);

  // helmet shell: dome plus cheek guards, open below the visor line
  g.beginPath();
  g.moveTo(17, 68); g.lineTo(17, 40);
  g.bezierCurveTo(17, -2, 79, -2, 79, 40);
  g.lineTo(79, 68); g.lineTo(70, 68); g.lineTo(69, 57); g.lineTo(27, 57); g.lineTo(26, 68); g.closePath();
  const sg = g.createLinearGradient(0, 4, 0, 60);
  sg.addColorStop(0, o.shellLight || o.shell); sg.addColorStop(0.55, o.shell); sg.addColorStop(1, o.shellDark);
  g.fillStyle = sg; g.fill(); g.lineWidth = 2.4; g.strokeStyle = OUT; g.lineJoin = 'round'; g.stroke();
  // rim highlight
  g.beginPath(); g.moveTo(24, 34); g.bezierCurveTo(26, 12, 44, 8, 56, 10); g.lineWidth = 2; g.strokeStyle = 'rgba(255,255,255,0.35)'; g.lineCap = 'round'; g.stroke();
  o.shellDeco?.(g, t);

  // ear cups
  ell(g, 17, 55, 6, 9, o.shellDark, OUT, 2);
  ell(g, 79, 55, 6, 9, o.shellDark, OUT, 2);
  ell(g, 16.5, 55, 2.2, 4, o.accent, null);
  ell(g, 79.5, 55, 2.2, 4, o.accent, null);

  // visor
  const vy = o.visorY ?? 30, vh = o.visorH ?? 25;
  g.beginPath(); g.roundRect(23, vy, 50, vh, o.visorR ?? 11);
  const vg = g.createLinearGradient(0, vy, 0, vy + vh);
  vg.addColorStop(0, o.visorLight); vg.addColorStop(1, o.visor);
  g.fillStyle = vg; g.fill(); g.lineWidth = 2.4; g.strokeStyle = OUT; g.stroke();
  // eyes behind the visor
  const ey = vy + vh * 0.52, er = o.eyeR ?? 5.2;
  const ex = o.eyeX ?? 12.5;
  for (const s of [-1, 1]) {
    const cx = 48 + s * ex;
    const ry = Math.max(0.6, er * (1 - blink * 0.9) * (o.eyeSquint ?? 1));
    ell(g, cx, ey, er * 1.05, ry, '#f6fbff', null);
    if (blink < 0.6) {
      ell(g, cx + (o.look ?? 0.8) * s * -0.6, ey + 0.3, er * 0.52, Math.min(ry, er * 0.62), o.iris, null);
      ell(g, cx + (o.look ?? 0.8) * s * -0.6, ey + 0.3, er * 0.24, Math.min(ry, er * 0.3), '#05070d', null);
    }
    if (o.brow) line(g, o.brow(s, cx, ey), 'rgba(6,10,20,0.75)', 2.4);
  }
  // glint
  poly(g, [27, vy + vh - 3, 35, vy + 3, 41, vy + 3, 33, vy + vh - 3], 'rgba(255,255,255,0.22)', null);
  poly(g, [44, vy + vh - 3, 48, vy + 3, 51, vy + 3, 47, vy + vh - 3], 'rgba(255,255,255,0.12)', null);
  // visor frame accent
  line(g, [26, vy + vh + 1.5, 70, vy + vh + 1.5], o.accent, 1.6);

  // mouth
  const my = o.mouthY ?? 70;
  mouth(g, 48 + (o.mouthDx ?? 0), my, o.mouthW ?? 7, talk, o.curve ?? 1, o.tilt ?? 0);

  o.front?.(g, t, talk);
}


// VEX: a former inspection officer. Level brows, a small even mouth, a plain pale shell with a thin violet band,
// a high formal collar with a rank tab and a small inspection badge on the dome.
const VEX = {
  seed: 1.7,
  skin: '#dcae8c', skinDark: '#b0805f',
  suit: '#232a3d', trim: '#e9edf5', accent: '#c88bff',
  shell: '#cfd4e4', shellLight: '#f2f5fc', shellDark: '#7f88a6',
  visor: '#3a1d63', visorLight: '#b98cff', iris: '#5b3a8f',
  visorY: 31, visorH: 21, visorR: 5, eyeR: 4.2, eyeSquint: 0.8, look: 0.2,
  curve: 0.15, tilt: 0, mouthDx: 0, mouthW: 6, mouthY: 71,
  brow: (s, cx, ey) => [cx - s * 6, ey - 6.6, cx + s * 6, ey - 6.6],
  shellDeco(g) {
    // thin violet band and an inspection badge (hexagon with a tick)
    poly(g, [19, 26, 77, 26, 77, 28.2, 19, 28.2], '#c88bff', null);
    poly(g, [44, 9, 52, 9, 55, 15, 52, 21, 44, 21, 41, 15], '#f6f8ff', OUT, 1.6);
    line(g, [44.5, 15, 47, 17.5, 51.5, 12], '#5b3a8f', 1.8);
    line(g, [24, 22, 33, 13], 'rgba(255,255,255,0.65)', 1.4);
  },
  front(g) {
    // high collar with a rank tab
    poly(g, [20, 82, 31, 77, 40, 86, 36, 96, 22, 96], '#e9edf5', OUT, 1.4);
    poly(g, [76, 82, 65, 77, 56, 86, 60, 96, 74, 96], '#e9edf5', OUT, 1.4);
    poly(g, [24, 90, 34, 88, 35, 92, 25, 94], '#c88bff', OUT, 1.2);
  },
};

// FERRO: a full-face opaque visor helmet. No eyes, no mouth: the only "face" is a data-lens glyph on the visor (a ring lens
// with a pulsing core and level bars either side that follow the voice). The deadpan lives in the words, not the drawing.
function ferro(g, talk, t) {
  const ACC = '#5ff08a';
  // shoulders, collar ring and a neck seal
  poly(g, [4, 96, 12, 84, 32, 78, 64, 78, 84, 84, 92, 96], '#26382c');
  poly(g, [34, 80, 48, 92, 62, 80, 58, 76, 48, 82, 38, 76], '#d4dfcf', OUT, 1.5);
  line(g, [15, 89, 29, 83], ACC, 2);
  line(g, [81, 89, 67, 83], ACC, 2);
  g.fillStyle = '#1b271f'; g.fillRect(38, 70, 20, 10);

  // helmet shell: one closed shape from dome to chin guard
  g.beginPath();
  g.moveTo(25, 74); g.lineTo(19, 42);
  g.bezierCurveTo(17, -2, 79, -2, 77, 42);
  g.lineTo(71, 74); g.quadraticCurveTo(48, 90, 25, 74); g.closePath();
  const sg = g.createLinearGradient(0, 4, 0, 84);
  sg.addColorStop(0, '#86a58f'); sg.addColorStop(0.45, '#4f6b58'); sg.addColorStop(1, '#25382b');
  g.fillStyle = sg; g.fill(); g.lineWidth = 2.4; g.strokeStyle = OUT; g.lineJoin = 'round'; g.stroke();
  // dome highlight and a single navigation stripe
  g.beginPath(); g.moveTo(25, 34); g.bezierCurveTo(27, 12, 44, 7, 58, 9); g.lineWidth = 2; g.strokeStyle = 'rgba(255,255,255,0.35)'; g.lineCap = 'round'; g.stroke();
  poly(g, [45, 9, 51, 9, 50.5, 26, 45.5, 26], ACC, null);
  // chin guard: vents and a seam
  line(g, [34, 74, 62, 74], 'rgba(8,18,12,0.7)', 1.6);
  for (let i = 0; i < 4; i++) line(g, [40 + i * 5.4, 77, 40 + i * 5.4, 81], 'rgba(8,18,12,0.75)', 1.6);
  // ear pods
  ell(g, 17, 52, 6, 10, '#2b3f33', OUT, 2);
  ell(g, 79, 52, 6, 10, '#2b3f33', OUT, 2);
  ell(g, 16.5, 52, 2.2, 4.5, ACC, null);
  ell(g, 79.5, 52, 2.2, 4.5, ACC, null);

  // opaque visor: a wide chamfered panel, glossy dark green glass, nothing behind it
  const vx0 = 22, vx1 = 74, vy0 = 31, vy1 = 63;
  const vis = [vx0 + 5, vy0, vx1 - 5, vy0, vx1, vy0 + 9, vx1 - 3, vy1, vx0 + 3, vy1, vx0, vy0 + 9];
  g.beginPath(); g.moveTo(vis[0], vis[1]); for (let i = 2; i < vis.length; i += 2) g.lineTo(vis[i], vis[i + 1]); g.closePath();
  const vg = g.createLinearGradient(0, vy0, 0, vy1);
  vg.addColorStop(0, '#0f3a2a'); vg.addColorStop(0.5, '#06170f'); vg.addColorStop(1, '#03090a');
  g.fillStyle = vg; g.fill(); g.lineWidth = 2.6; g.strokeStyle = OUT; g.stroke();
  // frame accent along the lower edge
  line(g, [vx0 + 4, vy1 + 2, vx1 - 4, vy1 + 2], ACC, 1.5);
  // glass glints
  poly(g, [27, 60, 34, 34, 40, 34, 33, 60], 'rgba(255,255,255,0.10)', null);
  poly(g, [43, 60, 46, 34, 49, 34, 46, 60], 'rgba(255,255,255,0.06)', null);

  // data-lens glyph: ring, pulsing core, sweeping arc, level bars either side
  const cx = 48, cy = 47;
  const pulse = 0.5 + 0.5 * Math.sin(t * 2.4);
  g.beginPath(); g.arc(cx, cy, 9.5, 0, TAU); g.lineWidth = 1.6; g.strokeStyle = 'rgba(95,240,138,0.85)'; g.stroke();
  g.beginPath(); g.arc(cx, cy, 5.2, 0, TAU); g.lineWidth = 1; g.strokeStyle = 'rgba(95,240,138,0.45)'; g.stroke();
  const sw = t * 1.3;
  g.beginPath(); g.arc(cx, cy, 9.5, sw, sw + 1.1); g.lineWidth = 3; g.strokeStyle = '#d8ffe6'; g.lineCap = 'round'; g.stroke();
  ell(g, cx, cy, 2.4 + pulse * 0.9 + talk * 1.2, 2.4 + pulse * 0.9 + talk * 1.2, 'rgba(160,255,190,0.95)', null);
  for (const s of [-1, 1]) {
    for (let i = 0; i < 4; i++) {
      const len = 3 + i * 1.6 + (talk * 5) * (1 - i * 0.18) + Math.sin(t * 5 + i * 1.7 + (s > 0 ? 1.1 : 0)) * 0.7 * (0.3 + talk);
      const x0 = cx + s * (14 + i * 2.3);
      line(g, [x0, cy - len, x0, cy + len], `rgba(95,240,138,${0.85 - i * 0.16})`, 1.5);
    }
  }
  // small tick marks above the lens
  for (let i = -2; i <= 2; i++) line(g, [cx + i * 5, vy0 + 5, cx + i * 5, vy0 + (i === 0 ? 9 : 7)], 'rgba(95,240,138,0.5)', 1);
}

// THE REGENT: an abstract waveform, no face and no eye. A stack of horizontal traces under a lens-shaped envelope;
// the amplitude follows the voice.
function regent(g, talk, t) {
  const N = 13, x0 = 9, x1 = 87;
  // outer frame: two hairline brackets and small diamonds, nothing centred
  g.lineWidth = 1.2; g.strokeStyle = 'rgba(160,150,255,0.5)';
  g.strokeRect(5, 8, 86, 80);
  for (const [x, y] of [[5, 48], [91, 48], [48, 8], [48, 88]]) poly(g, [x, y - 3, x + 3, y, x, y + 3, x - 3, y], '#a89bff', null);
  // vertical hairline axis
  line(g, [48, 12, 48, 84], 'rgba(160,150,255,0.18)', 1);
  for (let i = 0; i < N; i++) {
    const y = 14 + i * (68 / (N - 1));
    const mid = 1 - Math.abs(i - (N - 1) / 2) / ((N - 1) / 2); // 0 at the outer traces, 1 at the middle
    const amp = (1.6 + mid * 5.5) * (0.55 + talk * 1.5) + Math.sin(t * 1.3 + i) * 0.6;
    g.beginPath();
    for (let s = 0; s <= 64; s++) {
      const u = s / 64, x = x0 + u * (x1 - x0);
      const env = Math.pow(Math.sin(Math.PI * u), 1.4);
      const w = Math.sin(u * 17 + t * (2.2 + i * 0.13) + i * 1.7) * 0.65 + Math.sin(u * 31 - t * 3.1 + i * 0.9) * 0.35;
      const yy = y + w * amp * env;
      if (s === 0) g.moveTo(x, yy); else g.lineTo(x, yy);
    }
    const a = 0.3 + mid * 0.6;
    g.lineWidth = 1 + mid * 0.9;
    g.strokeStyle = mid > 0.55 ? `rgba(255,${Math.round(150 + 60 * mid)},${Math.round(90 - 20 * mid)},${a})` : `rgba(150,140,255,${a})`;
    g.lineCap = 'round'; g.lineJoin = 'round'; g.stroke();
  }
}

export const PORTRAITS = {
  VEX: { draw: (g, m, t) => pilot(g, VEX, m, t), bg: ['#2a1a44', '#0f0a1c'], accent: '#c88bff', label: 'VEX' },
  FERRO: { draw: ferro, bg: ['#173226', '#08130d'], accent: '#5ff08a', label: 'FERRO' },
  REGENT: { draw: regent, bg: ['#1a1440', '#07051a'], accent: '#ff9a5a', label: 'REGENT' },
};

// Speakers without a portrait use the text readout strip: monospace tag, left rule, typed text.
export const READOUTS = {
  SABLE: { tag: 'SABLE', accent: '#38e8ff' },
  PIP: { tag: 'PIP', accent: '#ffb03a' },
  LUMEN: { tag: 'LUMEN', accent: '#6ff0dc' },
  CONTROL: { tag: 'CONTROL', accent: '#c9d6ee' },
};

export const SPEAKER_KEYS = [...Object.keys(PORTRAITS), ...Object.keys(READOUTS)];

export function normalizeSpeaker(s) {
  const k = String(s || '').toUpperCase().replace(/[^A-Z]/g, '');
  if (PORTRAITS[k] || READOUTS[k]) return k;
  if (k === 'PLAYER' || k === 'YOU') return 'SABLE';
  return 'LUMEN';
}

// glitch 0..1: horizontal tear bands and a tint shift while the radio static is up
export function drawPortrait(canvas, speaker, mouthOpen = 0, t = 0, glitch = 0) {
  const p = PORTRAITS[speaker] || PORTRAITS.VEX;
  const g = canvas.getContext('2d');
  const S = canvas.width;
  g.save();
  g.clearRect(0, 0, S, S);
  const grad = g.createLinearGradient(0, 0, 0, S);
  grad.addColorStop(0, p.bg[0]); grad.addColorStop(1, p.bg[1]);
  g.fillStyle = grad; g.fillRect(0, 0, S, S);
  // faint backdrop grid
  g.strokeStyle = 'rgba(255,255,255,0.05)'; g.lineWidth = 1;
  for (let i = 1; i < 6; i++) { g.beginPath(); g.moveTo(0, (S / 6) * i); g.lineTo(S, (S / 6) * i); g.stroke(); }
  g.scale(S / 96, S / 96);
  p.draw(g, mouthOpen, t);
  g.restore();
  if (glitch > 0.05) {
    const bands = 1 + ((glitch * 4) | 0);
    for (let i = 0; i < bands; i++) {
      const y = Math.floor(Math.random() * S * 0.9), hh = 2 + Math.floor(Math.random() * S * 0.08);
      const dx = Math.round((Math.random() - 0.5) * S * 0.22 * glitch);
      g.drawImage(canvas, 0, y, S, hh, dx, y, S, hh);
    }
    g.globalAlpha = 0.08 * glitch; g.fillStyle = p.accent; g.fillRect(0, 0, S, S); g.globalAlpha = 1;
  }
}
