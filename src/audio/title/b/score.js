// Score data for title variant B (dark synthwave): harmony, energy arc, drum, arp and lead tables.
// A phrygian/aeolian A minor, 32 bars at 92 BPM. Pure data and tiny helpers, no audio nodes here.

export const BPM = 92;
export const BARS = 32;
export const BEAT = 60 / BPM;
export const BAR = BEAT * 4;

// root = bass root (midi), pad = four voiced chord tones (midi)
export const CHORDS = {
  Am: { root: 45, pad: [57, 60, 64, 67] }, // Am7
  Bb: { root: 46, pad: [58, 62, 65, 69] }, // Bbmaj7 over the phrygian bII
  F: { root: 41, pad: [53, 57, 60, 64] }, // Fmaj7 (bVI)
  Dm: { root: 38, pad: [57, 60, 62, 65] }, // Dm7 (iv)
  E: { root: 40, pad: [52, 56, 59, 62] }, // E7, harmonic minor dominant, pulls back to Am
  G: { root: 43, pad: [55, 59, 62, 64] }, // G6, one brief dorian-ish brightening
};

// [chord, length in bars] per 8 bar section
const SECTIONS = [
  /* 0-7   intro     */ [['Am', 2], ['Bb', 2], ['Am', 2], ['F', 1], ['E', 1]],
  /* 8-15  build     */ [['Am', 2], ['Bb', 2], ['Dm', 2], ['F', 1], ['E', 1]],
  /* 16-23 peak      */ [['Am', 1], ['Bb', 1], ['F', 1], ['G', 1], ['Dm', 1], ['Bb', 1], ['F', 1], ['E', 1]],
  /* 24-31 breakdown */ [['Dm', 2], ['Bb', 2], ['F', 2], ['E', 2]],
];

export const BAR_CHORD = []; // chord name per bar
export const SPAN_AT = []; // span length in bars at a span's first bar, else 0
for (const sec of SECTIONS) {
  for (const [name, len] of sec) {
    SPAN_AT.push(len);
    BAR_CHORD.push(name);
    for (let i = 1; i < len; i++) { SPAN_AT.push(0); BAR_CHORD.push(name); }
  }
}

// Energy arc 0..1 over the loop, bar position (fractional). Wraps: end value equals start value for a seamless loop.
const ARC = [[0, 0.12], [8, 0.3], [12, 0.48], [16, 0.82], [20, 0.95], [23.99, 0.9], [24, 0.52], [28, 0.28], [32, 0.12]];
export function energy(bar) {
  const b = ((bar % BARS) + BARS) % BARS;
  for (let i = 1; i < ARC.length; i++) {
    if (b <= ARC[i][0]) {
      const [x0, y0] = ARC[i - 1], [x1, y1] = ARC[i];
      return y0 + ((y1 - y0) * (b - x0)) / (x1 - x0);
    }
  }
  return ARC[0][1];
}

// Section helpers
export const inRange = (bar, a, b) => bar >= a && bar < b;

// Drum patterns in beats (0 = downbeat). Kick enters at bar 8, backbeat and hats at 12, gone in the breakdown.
export function drumPlan(bar) {
  const plan = { kicks: [], claps: [], hats: [] };
  if (inRange(bar, 8, 12)) plan.kicks = [[0, 1], [2, 0.85]];
  else if (inRange(bar, 12, 16)) {
    plan.kicks = [[0, 1], [2, 0.85]];
    if (bar % 2 === 1) plan.kicks.push([2.75, 0.55]);
    plan.claps = [[1, 0.75], [3, 0.8]];
    plan.hats = [[1.5, 0.7], [3.5, 0.75]];
  } else if (inRange(bar, 16, 24)) {
    plan.kicks = [[0, 1], [2, 0.9], [2.75, 0.6]];
    if (bar % 4 === 3) plan.kicks.push([3.5, 0.5]);
    plan.claps = [[1, 1], [3, 1]];
    plan.hats = [[0.5, 0.55], [1.5, 0.8], [2.5, 0.55], [3.5, 0.85]];
    // rare swung sixteenth ghosts, decided by the bar's rng in the caller
  }
  return plan;
}

// Arp: how many of the 16th steps sound per bar. Opens through the build, peaks, then thins out and closes.
const ARP_ORDER = [0, 6, 11, 3, 8, 14, 10, 13];
export function arpSteps(bar) {
  let n = 0;
  if (inRange(bar, 12, 14)) n = 3;
  else if (inRange(bar, 14, 16)) n = 4;
  else if (inRange(bar, 16, 20)) n = 6;
  else if (inRange(bar, 20, 24)) n = 8;
  else if (inRange(bar, 24, 26)) n = 4;
  else if (inRange(bar, 26, 28)) n = 3;
  else if (inRange(bar, 28, 30)) n = 2;
  else if (bar === 30) n = 1;
  return ARP_ORDER.slice(0, n).sort((a, b) => a - b);
}
export const ARP_SEQ_A = [0, 2, 4, 2, 5, 3, 6, 4];
export const ARP_SEQ_B = [1, 3, 5, 3, 6, 4, 7, 5];

// Arp ladder for a chord: its tones folded into 55..78, low to high, two octaves
export function arpLadder(chordName) {
  const out = [];
  for (const n of CHORDS[chordName].pad) {
    const base = 55 + (((n - 55) % 12) + 12) % 12;
    out.push(base, base + 12);
  }
  return [...new Set(out)].sort((a, b) => a - b);
}

// Lead motif (bars 12-15): A4 ... F5 ... C5 ... E5 ... G#4. Wide leaps, mostly rests.
// Answered in the peak (bars 20-23) with a higher, longer-reaching variation, and a fragment in the breakdown.
// Events per bar: b = start beat, d = length in beats, m = midi.
export const LEAD = {
  12: { vol: 0.12, ev: [{ b: 0, d: 1.75, m: 69 }, { b: 2.5, d: 1.25, m: 77 }] },
  13: { vol: 0.12, ev: [{ b: 2, d: 1.8, m: 72 }] },
  14: { vol: 0.12, ev: [{ b: 1, d: 2.6, m: 76 }] },
  15: { vol: 0.12, ev: [{ b: 0.5, d: 3, m: 68 }] },
  20: { vol: 0.14, ev: [{ b: 0, d: 1, m: 69 }, { b: 1.5, d: 0.5, m: 74 }, { b: 2.5, d: 1.5, m: 81 }] },
  21: { vol: 0.14, ev: [{ b: 0.5, d: 2.5, m: 77 }] },
  22: { vol: 0.14, ev: [{ b: 0, d: 1, m: 76 }, { b: 2, d: 2, m: 81 }] },
  23: { vol: 0.14, ev: [{ b: 0.5, d: 1.5, m: 80 }, { b: 2.5, d: 1.5, m: 71 }] },
  26: { vol: 0.09, ev: [{ b: 0.5, d: 3, m: 77 }] },
  27: { vol: 0.09, ev: [{ b: 1.5, d: 2.2, m: 69 }] },
};

// Bass pulse, semitone offsets from the chord root per eighth
export const BASS_A = [0, 0, 12, 0, 0, 0, 12, 0];
export const BASS_B = [0, 0, 12, 0, 0, 7, 12, 0];

export function mulberry32(a) {
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
