// Small pure helpers shared by the style D (techno) tracks: seeded rng, ranges, section tables, pattern strings.

export function mulberry32(a) {
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const clamp = (x, a = 0, b = 1) => (x < a ? a : x > b ? b : x);
export const lerp = (a, b, x) => a + (b - a) * x;
export const smooth = (x, a, w) => { const u = clamp((x - a) / Math.max(1e-6, w)); return u * u * (3 - 2 * u); };

// Smoothed 0..1 intensity follower. The first set() snaps, later ones slew with time constant tau (never jumps).
export function makeIntensity(ac, init = 0.7, tau = 0.8) {
  let cur = init, last = null, first = true;
  return {
    set(x) {
      const v = clamp(Number.isFinite(x) ? x : cur);
      const now = ac.currentTime;
      if (first) { cur = v; first = false; } else cur += (v - cur) * (1 - Math.exp(-Math.max(0.01, now - (last ?? now - 0.04)) / tau));
      last = now;
    },
    get: () => cur,
  };
}

/**
 * Sections: [[name, bars, 'layer names separated by spaces'], ...] -> { at(bar) -> {name, i, n, on(layer)}, total }.
 * `i` is the bar index inside the section, `n` the section length, on(layer) tells whether the arrangement plays that layer.
 */
export function makeSections(list) {
  const rows = [];
  let bar = 0;
  for (const [name, n, layers] of list) {
    const set = new Set(String(layers || '').split(/\s+/).filter(Boolean));
    // globalThis.__dLayers (an array of layer names) restricts the arrangement, used by the offline mix analysis only
    const on = (l) => (l === 'fx' ? !globalThis.__dLayers || globalThis.__dLayers.includes('fx') : set.has(l) && (!globalThis.__dLayers || globalThis.__dLayers.includes(l)));
    for (let i = 0; i < n; i++) rows.push({ name, i, n, last: i === n - 1, first: i === 0, on, get fx() { return on('fx'); } });
    bar += n;
  }
  return { at: (b) => rows[((b % rows.length) + rows.length) % rows.length], total: bar };
}

/** Iterates a 16 character step pattern: calls fn(step, char) for every character that is not '.' or ' '. */
export function steps(pat, fn) {
  for (let s = 0; s < 16 && s < pat.length; s++) { const c = pat[s]; if (c !== '.' && c !== ' ') fn(s, c); }
}

/** Velocity for a pattern character: X accent, x normal, o soft, - ghost. */
export const VEL = { X: 1, x: 0.8, o: 0.55, '-': 0.32 };
export const vel = (c) => VEL[c] ?? 0.8;

/** Pitch class helpers: midi note from a name like 'D3'. */
const PC = { C: 0, 'C#': 1, Db: 1, D: 2, 'D#': 3, Eb: 3, E: 4, F: 5, 'F#': 6, Gb: 6, G: 7, 'G#': 8, Ab: 8, A: 9, 'A#': 10, Bb: 10, B: 11 };
export const note = (name) => { const m = /^([A-G][#b]?)(-?\d)$/.exec(name); return PC[m[1]] + (Number(m[2]) + 1) * 12; };

/** Exponential piecewise curve over bars: points [[bar, hz], ...]; use two points a hair apart for a jump. Wraps over `bars`. */
export function makeCurve(points, bars) {
  return (x) => {
    const b = ((x % bars) + bars) % bars;
    for (let i = 1; i < points.length; i++) {
      if (b <= points[i][0]) {
        const [x0, y0] = points[i - 1], [x1, y1] = points[i];
        const u = x1 === x0 ? 1 : (b - x0) / (x1 - x0);
        return y0 * Math.pow(y1 / y0, u);
      }
    }
    return points[points.length - 1][1];
  };
}

/** Frequently used scale of chord tones: pick the n-th tone of `tones`, wrapping up by octaves. */
export const ladderPick = (tones, n) => {
  const len = tones.length;
  const i = ((n % len) + len) % len;
  return tones[i] + 12 * Math.floor(n / len);
};

// ---- chords: semitone stacks from the root
export const KIND = {
  m: [0, 3, 7, 10], m9: [0, 3, 7, 14], M: [0, 4, 7, 14], M7: [0, 4, 7, 11], dom: [0, 4, 7, 10], sus: [0, 5, 7, 10], sus2: [0, 2, 7, 12],
  p5: [0, 7, 12, 19], mb2: [0, 1, 7, 10], dim: [0, 3, 6, 10], lyd: [0, 4, 7, 18], mM: [0, 3, 7, 11],
};

/**
 * makeChord(rootPitchClass, kind) -> { pc, bass (midi root in [bassLo, bassLo+12)), pad (chord tones folded into a 12 semitone
 * window starting at padLo, ascending), acid (semitone scale for acid lines: root, octave, fifth, third, seventh, octave+third) }
 */
export function makeChord(pc, kind, { bassLo = 33, padLo = 55 } = {}) {
  const iv = KIND[kind];
  const bass = bassLo + ((((pc - bassLo) % 12) + 12) % 12);
  const pad = [...new Set(iv.map((i) => padLo + ((((pc + i) - padLo) % 12) + 12) % 12))].sort((a, b) => a - b);
  const third = iv.includes(3) ? 3 : iv.includes(4) ? 4 : iv.includes(5) ? 5 : iv.includes(2) ? 2 : iv.includes(1) ? 1 : 7;
  const sev = iv.includes(11) ? 11 : 10;
  return { pc, bass, pad, acid: [0, 12, 7, third, sev, 12 + third, 19] };
}

/** Plays a monophonic line. line: [[step, index, flags]], flags: 'a' accent, 's' slide into this note, 'l' long. */
export function playLine(voice, t0, sd, line, pitchOf, base = {}) {
  for (let i = 0; i < line.length; i++) {
    const [s, idx, fl = ''] = line[i];
    const next = line[i + 1];
    const gap = (next ? next[0] : 16) - s;
    const slideNext = next && next[2] && next[2].includes('s') && gap > 0;
    const dur = slideNext ? gap * sd : Math.min(gap, fl.includes('l') ? 6 : 1.7) * sd * (fl.includes('l') ? 0.95 : 0.8);
    const acc = fl.includes('a');
    voice.note(t0 + s * sd, pitchOf(idx, s), dur, {
      ...base, vel: (base.vel ?? 1) * (acc ? 1 : 0.72), env: (base.env ?? 3) * (acc ? 1.5 : 1), slide: fl.includes('s'),
    });
  }
}
