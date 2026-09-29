// Score data for title variant C, "Restrained orchestral". D minor, 84 BPM, 40 bars, 4/4.
//
// Structure (bars are 0 based):
//    0- 7  Statement: solo horn states the motif plainly, low pedal enters at bar 4, sparse harp plucks.
//    8-15  Development 1: staccato low string ostinato joins, motif inverted (fourth down, step down, third up),
//          string pad enters at bar 12, timpani single hits, small noise swell into bar 16.
//   16-23  Development 2: motif sequenced up a third, twice (F-Bb-C-A, then A-D-E-C), violins double the horn,
//          viola off beat pulse, timpani, cymbal swell over bars 22-23, deceptive A -> Bb into the peak.
//   24-31  Peak: strings carry the motif, low horn plays it in augmentation (bars 26-28), Dorian IV (G major) lift
//          at bar 27, crash at 24, timpani on every phrase boundary.
//   32-39  Release: horn recalls the motif, ostinato thins out, pad fades, bar 39 (C, bVII) returns to bar 0 (Dm).

export const BPM = 84;
export const BARS = 40;

// Chord tones as pitch classes: [root, third, fifth, colour tone].
export const CHORD_DEFS = {
  Dm: [2, 5, 9, 0],
  Bb: [10, 2, 5, 9],
  Gm: [7, 10, 2, 5],
  C: [0, 4, 7, 2],
  Dsus4: [2, 7, 9, 0],
  F: [5, 9, 0, 7],
  G: [7, 11, 2, 9],
  A: [9, 1, 4, 7],
};

export const CHORDS = [
  'Dm', 'Dm', 'Bb', 'Bb', 'Gm', 'C', 'Dsus4', 'Dm',
  'Dm', 'F', 'Bb', 'C', 'Dm', 'Bb', 'Gm', 'C',
  'Bb', 'C', 'Dm', 'F', 'Bb', 'Gm', 'Dsus4', 'A',
  'Bb', 'C', 'Dm', 'G', 'Bb', 'C', 'Gm', 'Dsus4',
  'Dm', 'F', 'Bb', 'C', 'Gm', 'Bb', 'Gm', 'C',
];

// Overall intensity 0..1 per bar. This is the dynamic arc everything else follows.
export const INT = [
  0.10, 0.12, 0.14, 0.15, 0.17, 0.18, 0.20, 0.22,
  0.30, 0.32, 0.36, 0.38, 0.44, 0.47, 0.50, 0.55,
  0.55, 0.58, 0.62, 0.66, 0.70, 0.74, 0.78, 0.85,
  0.95, 0.97, 1.00, 1.00, 1.00, 0.97, 0.90, 0.75,
  0.55, 0.45, 0.38, 0.32, 0.26, 0.20, 0.15, 0.11,
];

// Main melody: [beatInBar, beats, midi]. The motif is D4 G4 A4 F4 (a fourth up, a step up, a third back down).
export const MEL = [
  /* 0  Dm    */ [[0, 1, 62], [1, 1, 67], [2, 1, 69], [3, 1, 65]],
  /* 1        */ [[0, 3, 65]],
  /* 2  Bb    */ [[0, 1, 65], [1, 1, 70], [2, 1, 72], [3, 1, 69]],
  /* 3        */ [[0, 3.5, 69]],
  /* 4  Gm    */ [[1, 1, 62], [2, 2, 67]],
  /* 5  C     */ [[0, 1.5, 69], [1.5, 0.5, 67], [2, 2, 64]],
  /* 6  Dsus4 */ [[0, 2, 69], [2, 2, 67]],
  /* 7  Dm    */ [[0, 3, 65]],
  /* 8  Dm    */ [[0, 1, 69], [1, 1, 64], [2, 1, 62], [3, 1, 65]],
  /* 9  F     */ [[0, 3, 65]],
  /* 10 Bb    */ [[0, 1, 72], [1, 1, 67], [2, 1, 65], [3, 1, 69]],
  /* 11 C     */ [[0, 3, 69]],
  /* 12 Dm    */ [[0, 1, 62], [1, 1, 67], [2, 1, 69], [3, 1, 65]],
  /* 13 Bb    */ [[0, 3, 65], [3, 1, 67]],
  /* 14 Gm    */ [[0, 1, 67], [1, 3, 74]],
  /* 15 C     */ [[0, 2, 72], [2, 1.5, 67]],
  /* 16 Bb    */ [[0, 1, 65], [1, 1, 70], [2, 1, 72], [3, 1, 69]],
  /* 17 C     */ [[0, 3, 69], [3, 1, 67]],
  /* 18 Dm    */ [[0, 1, 69], [1, 1, 74], [2, 1, 76], [3, 1, 72]],
  /* 19 F     */ [[0, 3.5, 72]],
  /* 20 Bb    */ [[0, 1, 74], [1, 3, 70]],
  /* 21 Gm    */ [[0, 1, 67], [1, 1, 72], [2, 1, 74], [3, 1, 70]],
  /* 22 Dsus4 */ [[0, 2, 69], [2, 2, 67]],
  /* 23 A     */ [[0, 3, 73], [3, 1, 74]],
  /* 24 Bb    */ [[0, 1, 77], [1, 1, 82], [2, 1, 84], [3, 1, 81]],
  /* 25 C     */ [[0, 3, 81], [3, 1, 79]],
  /* 26 Dm    */ [[0, 1, 74], [1, 1, 79], [2, 1, 81], [3, 1, 77]],
  /* 27 G     */ [[0, 1, 74], [1, 1, 79], [2, 1, 81], [3, 1, 78]],
  /* 28 Bb    */ [[0, 4, 77]],
  /* 29 C     */ [[0, 2, 76], [2, 2, 74]],
  /* 30 Gm    */ [[0, 3, 74], [3, 1, 72]],
  /* 31 Dsus4 */ [[0, 4, 69]],
  /* 32 Dm    */ [[0, 1, 62], [1, 1, 67], [2, 1, 69], [3, 1, 65]],
  /* 33 F     */ [[0, 3, 65]],
  /* 34 Bb    */ [[0, 3, 67]],
  /* 35 C     */ [[0, 4, 64]],
  /* 36 Gm    */ [[0, 4, 62]],
  /* 37 Bb    */ [[0, 2, 65], [2, 2, 62]],
  /* 38 Gm    */ [[0, 3, 67]],
  /* 39 C     */ [[0, 4.6, 64]], // sustains a little into bar 0 so the loop joins legato
];

// Augmentation of the motif (D G A F at doubled note values) on a low horn, spilling across bars 26 to 28.
export const AUG = {
  26: [[0, 2, 50], [2, 2, 55]],
  27: [[0, 4, 57]],
  28: [[0, 4, 53]],
};

// Timpani. hit: single strike, roll: crescendo/decrescendo roll from beat b0 for `len` beats. vel 0..1.
export const TIMP = {
  7: [{ k: 'roll', b: 2, len: 2, v0: 0.15, v1: 0.45 }],
  8: [{ k: 'hit', b: 0, v: 0.55 }],
  12: [{ k: 'hit', b: 0, v: 0.5 }],
  15: [{ k: 'roll', b: 0, len: 4, v0: 0.2, v1: 0.75 }],
  16: [{ k: 'hit', b: 0, v: 0.7 }],
  20: [{ k: 'hit', b: 0, v: 0.7 }],
  22: [{ k: 'hit', b: 0, v: 0.65 }],
  23: [{ k: 'roll', b: 0, len: 4, v0: 0.3, v1: 1.0 }],
  24: [{ k: 'hit', b: 0, v: 1.0 }],
  25: [{ k: 'hit', b: 2, v: 0.6 }],
  26: [{ k: 'hit', b: 0, v: 0.9 }],
  27: [{ k: 'hit', b: 0, v: 0.9 }],
  28: [{ k: 'hit', b: 0, v: 0.9 }],
  29: [{ k: 'roll', b: 0, len: 4, v0: 0.4, v1: 0.85 }],
  30: [{ k: 'hit', b: 0, v: 0.85 }],
  31: [{ k: 'hit', b: 0, v: 0.45 }, { k: 'hit', b: 2, v: 0.3 }],
  32: [{ k: 'hit', b: 0, v: 0.4 }],
  35: [{ k: 'hit', b: 0, v: 0.22 }],
  39: [{ k: 'hit', b: 2, v: 0.16 }],
};

// Noise swells (bar to bar) and cymbal.
export const RISERS = [
  { bar: 14, bars: 2, vol: 0.5 },
  { bar: 22, bars: 2, vol: 1.0 },
];
export const CRASHES = [{ bar: 16, vol: 0.25 }, { bar: 24, vol: 1.0 }];

// 8th note mask for the low string ostinato (8 slots per bar), or null for none.
const FULL = [1, 1, 1, 1, 1, 1, 1, 1];
const QUARTERS = [1, 0, 1, 0, 1, 0, 1, 0];
const HALFBAR = [1, 1, 1, 1, 0, 0, 0, 0];
const TWO = [1, 0, 0, 0, 1, 0, 0, 0];
export function ostMask(bar) {
  if (bar < 8) return null;
  if (bar <= 11) return QUARTERS;
  if (bar <= 22) return FULL;
  if (bar === 23) return HALFBAR;
  if (bar <= 30) return FULL;
  if (bar === 31) return HALFBAR;
  if (bar <= 33) return FULL;
  if (bar <= 35) return QUARTERS;
  if (bar <= 37) return TWO;
  return null;
}

// Viola off beat pulse (staccato repeated note, no arpeggio).
export function violaPulse(bar) {
  return (bar >= 20 && bar <= 22) || (bar >= 24 && bar <= 30);
}

// Pad strings and bass pedal presence per bar 0..1 (multiplied with INT inside the voices).
export function padLevel(bar) {
  if (bar < 12) return 0;
  if (bar >= 36) return 0.35;
  return 1;
}
export function bassLevel(bar) {
  if (bar < 4) return 0;
  return 1;
}

// Sparse harp plucks: returns [[beat, pcIndex, targetMidi, vel]] for the bar.
export function pluckSpec(bar) {
  if (bar === 1 || bar === 3 || bar === 5 || bar === 7) return [[3, 2, 76, 0.7]];
  if (bar === 9 || bar === 11 || bar === 13 || bar === 15) return [[2.5, 1, 70, 0.6], [3.25, 2, 76, 0.8]];
  if (bar === 17 || bar === 19 || bar === 21) return [[3, 2, 79, 0.6]];
  if (bar === 33 || bar === 35 || bar === 37 || bar === 39) return [[3.25, 2, 74, 0.6]];
  return [];
}

export const NOTE_NAMES = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];
export const noteName = (m) => NOTE_NAMES[((m % 12) + 12) % 12] + (Math.floor(m / 12) - 1);
