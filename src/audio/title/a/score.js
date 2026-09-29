// Score data for title variant A ("Cinematic drift"). D dorian with borrowed Bb (D aeolian colour), 72 BPM, 32 bars.
// Every list is plain data, indexed at load time by start bar so scheduleBar stays a cheap lookup.
//
// Form (bars):  0-3 intro, 4-11 A (pad, heartbeat, first distant horn), 12-19 B (swell, plucks),
//               20-27 peak (timpani, fullest pad, high horn), 28-31 outro (thinning back into bar 0).

export const BPM = 72;
export const BARS = 32;

// Overall loudness / brightness arc per bar, 0..1.
export const INTENSITY = [
  0.12, 0.14, 0.18, 0.22,
  0.30, 0.33, 0.37, 0.41, 0.44, 0.47, 0.50, 0.54,
  0.52, 0.56, 0.60, 0.64, 0.66, 0.70, 0.72, 0.76,
  0.92, 0.96, 1.00, 1.00, 0.96, 0.90, 0.78, 0.66,
  0.48, 0.34, 0.22, 0.15,
];

// Pad chords: open voicings (MIDI), one chord per 1 to 2 bars, no pop progression.
// D pedal in the bass for bars 0 to 11 gives the ambiguity: sus2, sus4, add9, maj7 over D.
export const PAD_SEGS = [
  { bar: 0, len: 3, notes: [50, 57, 62, 64, 69] },        // Dsus2
  { bar: 3, len: 1, notes: [50, 57, 62, 67, 69] },        // Dsus4 (G against the D pedal)
  { bar: 4, len: 2, notes: [50, 57, 65, 69, 76] },        // Dm(add9)
  { bar: 6, len: 2, notes: [50, 58, 65, 69, 74] },        // Bbmaj7/D
  { bar: 8, len: 2, notes: [50, 55, 62, 67, 69] },        // Gsus2/D
  { bar: 10, len: 2, notes: [55, 60, 64, 67, 74] },       // Cadd9/D (Dm7sus feel)
  { bar: 12, len: 2, notes: [53, 57, 60, 67, 72] },       // Fadd9
  { bar: 14, len: 2, notes: [52, 55, 60, 62, 67] },       // Cadd9/E
  { bar: 16, len: 2, notes: [57, 60, 64, 71, 76] },       // Am(add9)
  { bar: 18, len: 1, notes: [55, 57, 62, 67, 69] },       // Gsus2
  { bar: 19, len: 1, notes: [57, 62, 64, 69, 76] },       // Asus4, leaning into the peak
  { bar: 20, len: 2, notes: [50, 57, 62, 65, 69, 76] },   // Dm(add9), full
  { bar: 22, len: 2, notes: [58, 62, 65, 69, 76] },       // Bbmaj7#11
  { bar: 24, len: 2, notes: [55, 58, 62, 69, 74] },       // Gm(add9)
  { bar: 26, len: 2, notes: [57, 62, 64, 69, 74] },       // Asus4 / open fifth on A, unresolved
  { bar: 28, len: 2, notes: [50, 57, 62, 64, 69] },       // Dsus2 again
  { bar: 30, len: 2, notes: [50, 57, 62, 64, 69] },       // Dsus2, leads back into bar 0
];

// Sub bass: [startBar, lengthBars, midi]. Slow notes only.
export const BASS_SEGS = [
  [0, 4, 38], [4, 4, 38], [8, 4, 38],
  [12, 2, 41], [14, 2, 40], [16, 2, 33], [18, 1, 31], [19, 1, 33],
  [20, 2, 38], [22, 2, 34], [24, 2, 31], [26, 2, 33],
  [28, 4, 38],
];

// Lone horn: [bar, beat, midi, beats]. Fourths, fifths and minor sixths, long rests.
export const HORN = [
  [8, 0, 57, 6],    // A3
  [9, 2, 62, 5.5],  // up a fourth to D4
  [11, 2, 64, 3],   // E4
  [12, 0, 57, 4],   // A3
  [13, 0, 64, 3],   // up a fifth to E4
  [14, 2, 67, 5],   // G4
  [16, 0, 64, 3],   // E4
  [17, 0, 72, 6],   // up a minor sixth to C5
  [18, 2, 69, 5.5], // A4
  [20, 0, 62, 8],   // D4, long, vibrato
  [21, 2, 69, 8],   // up a fifth to A4 (major seventh over Bb next bar)
  [23, 2, 74, 6],   // up a fourth to D5, the one high moment
  [25, 2, 67, 6],   // down a fifth to G4
  [29, 0, 62, 8],   // D4, faint echo of the peak note
];

// FM piano-ish plucks: [bar, beat, midi, velocity]. Sparse, mostly fifths.
export const PIANO = [
  [3, 2, 69, 0.45],
  [5, 1, 69, 0.5], [5, 3, 76, 0.4],
  [7, 2, 74, 0.5],
  [9, 1, 69, 0.5], [9, 3, 74, 0.45],
  [11, 1, 67, 0.5], [11, 3, 74, 0.4],
  [12, 2, 72, 0.5], [13, 3, 79, 0.35],
  [14, 1, 76, 0.5], [15, 2, 67, 0.45],
  [16, 1, 76, 0.5], [17, 3, 69, 0.45],
  [18, 1, 74, 0.5], [18, 3, 81, 0.35], [19, 2, 76, 0.45],
  [20, 2, 69, 0.55],
  [22, 2, 77, 0.5],
  [24, 2, 74, 0.5],
  [26, 2, 76, 0.5],
  [28, 2, 69, 0.4],
  [30, 0, 74, 0.32],
  [31, 2, 81, 0.25],
];

// Heartbeat low tom, lub-dub pair: [bar, velocity]. Every other bar early, every bar at the peak.
export const HEART = [
  [6, 0.5], [8, 0.55], [10, 0.6],
  [14, 0.6], [16, 0.65], [18, 0.7],
  [20, 0.8], [21, 0.8], [22, 0.85], [23, 0.85], [24, 0.8], [25, 0.75], [26, 0.6],
];

// Soft timpani: [bar, beat, velocity]. Phrase starts only.
export const TIMPANI = [
  [4, 0, 0.35], [12, 0, 0.5], [20, 0, 0.9], [24, 0, 0.55], [28, 0, 0.3],
];

// Reverse-cymbal style risers ending at the start of the next phrase: [startBar, lengthBars, volume].
export const RISERS = [
  { bar: 3, bars: 1, vol: 0.5 },
  { bar: 11, bars: 1, vol: 0.6 },
  { bar: 18, bars: 2, vol: 0.9 },
  { bar: 23, bars: 1, vol: 0.5 },
  { bar: 27, bars: 1, vol: 0.5 },
  { bar: 31, bars: 1, vol: 0.28 },
];

// Timpani swell (filtered brown noise + D2 sine) into the peak.
export const TIMP_SWELLS = [{ bar: 19, beat: 0, beats: 8 }];

// Air: slow band-passed noise swells, [bar, lengthBars, pan, f0, f1, volume].
export const AIR = [
  [1, 3, -0.6, 500, 1400, 0.5],
  [5, 3, 0.6, 1300, 500, 0.5],
  [9, 3, -0.5, 600, 1800, 0.55],
  [13, 3, 0.5, 1600, 700, 0.6],
  [17, 2, -0.6, 700, 2400, 0.6],
  [21, 3, 0.6, 2200, 900, 0.6],
  [25, 3, -0.6, 900, 2600, 0.5],
  [29, 3, 0.5, 1400, 500, 0.4],
];
