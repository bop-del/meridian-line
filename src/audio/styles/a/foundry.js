// Style A, level theme "foundry": F aeolian with a flat second (Gb) rubbing the tonic and a tritone (B) late in the loop,
// 66 BPM, 32 bars (about 116 s). Heavy and cold: low detuned string pads, a deep sine sub, bowed low strings, a machine
// hum, and a mechanical pulse in the timpani that grows from one hit per bar to a full quarter-note pulse with tom
// pistons and distant metal strikes. Layers arrive with level progress: 0 pad, sub, hum, air; 0.15 first timpani;
// 0.3 low strings; 0.4 second beat; 0.55 full pulse and clanks; 0.7 plucks; 0.75 horn and pistons.
import { defineTrack } from './shared/engine.js';
import { arc, arpGen, chordAtFn } from './shared/gen.js';
import { lowString, timpaniAt, tomHit, clank } from './shared/voices.js';
import { mulberry32, noiseBand } from '../../title/a/voices.js';

const BPM = 66, BARS = 32;

const intensity = arc([[0, 0.12], [3, 0.2], [4, 0.3], [11, 0.46], [12, 0.5], [19, 0.7], [20, 0.82], [24, 1], [27, 0.96], [28, 0.5], [31, 0.14]], BARS);

const pads = [
  [0, 4, [41, 48, 53, 60]],              // F C F C: bare stacked fifths
  [4, 4, [41, 48, 56, 63]],              // Fm7
  [8, 4, [41, 48, 54, 56]],              // F C Gb Ab: the flat nine grinding on the root
  [12, 4, [37, 44, 53, 60]],             // Dbmaj7
  [16, 4, [46, 53, 58, 61]],             // Bbm
  [20, 4, [41, 48, 56, 57]],             // F C Ab A: minor and major third together
  [24, 4, [41, 47, 54, 60]],             // F B Gb C: tritone and flat nine, the heaviest bars
  [28, 4, [41, 48, 53]],                 // back to the bare fifths
];
const roots = [41, 41, 41, 41, 41, 41, 41, 41, 41, 41, 41, 41, 37, 37, 37, 37, 46, 46, 46, 46, 41, 41, 41, 41, 41, 41, 41, 41, 41, 41, 41, 41];

const bass = [[0, 12, 29], [12, 4, 37], [16, 4, 34], [20, 12, 29]];

const horn = [
  [14, 0, 53, 8],    // F3, low
  [16, 2, 61, 6],    // up a minor sixth to Db4
  [22, 0, 56, 8],    // Ab3
  [24, 0, 65, 6],    // up a major sixth to F4
  [26, 2, 58, 8],    // down a fifth to Bb3
];

const chordAt = chordAtFn(pads);
const rng = mulberry32(4407);
const grid = [0, 1.5, 2, 3.5];
const plucks = arpGen({ rng, from: 8, to: 28, poolAt: (b) => [...chordAt(b), 65], count: (b) => (b % 2 ? 1 : 0), grid, lo: 65, hi: 84, vel: [0.26, 0.38], tiers: [0.7] });

const swells = [[11, 0, 8, 29], [19, 0, 8, 29], [27, 0, 8, 29]];
const risers = [[11, 1, 0.35, 0.55], [19, 2, 0.65, 0.55], [27, 1, 0.45, 0.55], [31, 1, 0.22]];
const air = [
  [1, 3, -0.5, 260, 700, 0.45], [5, 3, 0.5, 700, 260, 0.45], [9, 3, -0.5, 300, 900, 0.5], [13, 3, 0.5, 900, 320, 0.5],
  [17, 3, -0.5, 340, 1100, 0.55], [21, 3, 0.5, 1100, 380, 0.55], [25, 3, -0.5, 400, 1200, 0.5], [29, 3, 0.5, 900, 300, 0.4],
];

const CLANK_F = [175, 233, 277, 208];

const track = defineTrack({
  meta: {
    id: 'foundry', name: 'Foundry (Cinematic drift)', bpm: BPM, bars: BARS,
    description: 'F aeolian slow burn: low detuned string pads, deep sub, bowed cellos, machine hum and a mechanical timpani pulse with distant metal strikes.',
  },
  score: { intensity, pads, bass, horn, plucks, swells, risers, air },
  adaptive: true, lvl0: 0.05,
  layers: { horn: 0.75, plucks: 0.7, risers: 0.55 },
  pad: { cut: [220, 1000], cents: 9, vol: 1.1 },
  delay: { l: 0.75, r: 1.5, fb: 0.55, lp: 1800 },
  reverb: { seed: 7373 },
  drumLp: 640,
  mix: { trim: 0.47, subVol: 0.17, hornVol: 0.12 },
  seed: 61,
  hook(api) {
    const { ac, BEAT, BAR } = api;
    const lowBus = api.bus(0.9, 0.25, 0, null);
    const metalBus = api.bus(0.55, 1.0, 0.25, null);
    const drums = api.bus(0.85, 0.4, 0, (n) => { const l = api.filt('lowpass', 700, 0.6); n.connect(l); return l; });
    const segStart = new Map(pads.map((p) => [p[0], p]));
    return {
      bar(c) {
        const { t0, bar, rng: r, I, lay, jit, vary } = c;
        // machine hum: overlapping two-bar brown noise swells under everything
        noiseBand(ac, lowBus, t0, 2 * BAR, { type: 'lowpass', f0: 120, f1: 210, q: 0.7, vol: 0.22 + 0.12 * I, shape: 'swell', peak: 0.5, brown: true, off: r() });
        // bowed low strings on the chord roots
        const seg = segStart.get(bar);
        const gs = lay(0.3, 0.48);
        if (seg && gs > 0.03) {
          lowString(ac, lowBus, t0, seg[1] * BAR - 0.3, seg[2][0] + 12, 0.075 * gs * (0.5 + 0.5 * I), { att: 2.2, rel: 2.4, cut: 380, pan: -0.25 });
          lowString(ac, lowBus, t0 + 0.2, seg[1] * BAR - 0.5, seg[2][1], 0.06 * gs * (0.5 + 0.5 * I), { att: 2.6, rel: 2.4, cut: 340, pan: 0.25 });
        }
        // the mechanical pulse
        const f = 440 * Math.pow(2, (roots[bar] - 69) / 12);
        const pulse = [[0, 1.0, 0.12], [2, 0.6, 0.32], [1, 0.34, 0.5], [3, 0.32, 0.5]];
        for (const [beat, vel, lo] of pulse) {
          const g = lay(lo, lo + 0.18);
          if (g > 0.03) timpaniAt(ac, drums, t0 + beat * BEAT + jit(), vel * g * (0.55 + 0.45 * I) * vary(), f, 0.7);
        }
        // pistons: off-beat low toms, only in the heavy bars
        const gp = lay(0.75, 0.93) * (bar >= 12 ? 1 : 0.6);
        if (gp > 0.03) {
          tomHit(ac, drums, t0 + 1.5 * BEAT + jit(), 0.5 * gp * vary(), 62);
          if (bar % 4 === 3) { tomHit(ac, drums, t0 + 3.5 * BEAT + jit(), 0.5 * gp * vary(), 58); tomHit(ac, drums, t0 + 3.75 * BEAT + jit(), 0.35 * gp * vary(), 58); }
        }
        // distant metal, every other bar, moving between the ears
        const gc = lay(0.55, 0.73);
        if (bar % 2 === 1 && gc > 0.03) clank(ac, metalBus, t0 + 2 * BEAT + jit(), gc * (0.5 + 0.5 * I), CLANK_F[(bar >> 1) % CLANK_F.length], ((bar >> 1) % 2 ? 0.55 : -0.55));
      },
    };
  },
});

export const meta = track.meta;
export const create = track.create;
