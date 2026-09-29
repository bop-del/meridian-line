// Small pure helpers shared by the style B tracks: seeded rng, ranges, energy arcs, chord voicing, section tables.

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
export const inRange = (bar, a, b) => bar >= a && bar < b;
export const smooth = (x, a, w) => { const u = clamp((x - a) / w); return u * u * (3 - 2 * u); };

// Piecewise linear energy arc over a loop of `bars` bars; the last point should equal the first for a seamless wrap.
export function makeArc(points, bars) {
  return (bar) => {
    const b = ((bar % bars) + bars) % bars;
    for (let i = 1; i < points.length; i++) {
      if (b <= points[i][0]) {
        const [x0, y0] = points[i - 1], [x1, y1] = points[i];
        return y0 + ((y1 - y0) * (b - x0)) / (x1 - x0);
      }
    }
    return points[0][1];
  };
}

// Chord qualities as semitone stacks from the root
export const KINDS = {
  maj: [0, 4, 7], m: [0, 3, 7], maj7: [0, 4, 7, 11], maj9: [0, 4, 7, 11, 14], m7: [0, 3, 7, 10], m9: [0, 3, 7, 10, 14],
  add9: [0, 4, 7, 14], madd9: [0, 3, 7, 14], sus2: [0, 2, 7], '7sus2': [0, 2, 7, 10], '7': [0, 4, 7, 10], m7b5: [0, 3, 6, 10],
  '7b9': [0, 4, 7, 10, 13], 'maj7#11': [0, 4, 7, 11, 18], 'add#11': [0, 4, 7, 18], '5': [0, 7], 'sus4': [0, 5, 7, 10],
  'sus4b9': [0, 5, 7, 13], 'susb2': [0, 1, 7], 'm6': [0, 3, 7, 9], 'maj9#11': [0, 4, 7, 11, 14, 18],
};

// defs: { name: [rootPitchClass, kind] } -> { name: { pc, pcs, root, pad, sub } }
//  root = bass root midi inside [bassLo, bassLo+12), pad = the chord tones folded into a 12 semitone window around `center`
//  (so neighbouring chords voice-lead smoothly), sub = root an octave above the bass root (for pad body).
export function makeChords(defs, { center = 64, bassLo = 36 } = {}) {
  const out = {};
  const lo = center - 6;
  for (const [name, [pc, kind]] of Object.entries(defs)) {
    const st = KINDS[kind];
    const pcs = st.map((i) => (pc + i) % 12);
    const pad = [...new Set(pcs)].map((p) => lo + ((((p - lo) % 12) + 12) % 12)).sort((a, b) => a - b);
    const root = bassLo + ((((pc - bassLo) % 12) + 12) % 12);
    out[name] = { pc, pcs, root, pad, sub: root + 12 };
  }
  return out;
}

// All chord tones (plus optional extra pitch classes) between lo and hi midi, ascending
export function ladder(chord, lo, hi, extra = []) {
  const set = new Set([...chord.pcs, ...extra]);
  const out = [];
  for (let m = lo; m <= hi; m++) if (set.has(((m % 12) + 12) % 12)) out.push(m);
  return out;
}

// Expand sections [[chordName, bars], ...] into per-bar tables: name at every bar, span length at a span's first bar
export function expandSections(secs) {
  const names = [], span = [];
  for (const [n, len] of secs) {
    span.push(len); names.push(n);
    for (let i = 1; i < len; i++) { span.push(0); names.push(n); }
  }
  return { names, span };
}

// Smoothed 0..1 intensity follower. The first set() snaps (no ramp from the default), later ones slew with time constant tau.
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
