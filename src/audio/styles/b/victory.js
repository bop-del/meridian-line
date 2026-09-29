// Style B victory stinger: restrained relief, not a fanfare. F major (starting from the relative minor), 90 BPM, 10 bars, one shot.
// A slow pad that opens its filter as the harmony brightens (D minor > B flat lydian > G minor > B flat > C sus > A minor > F),
// a low drone and a soft bass pulse, a heartbeat kick in the middle, sparse arp plucks into the dark delay, and a lead that
// states one leaping phrase (A E ... D G ... C G ... F) and settles on A over a resolved Fmaj9, which rings out for two bars
// plus the reverb tail. meta.loop is false: the player plays the 10 bars once and lets the tail ring.
import { buildFx } from './shared/fx.js';
import { makeVoices } from './shared/voices.js';
import { mulberry32, lerp, smooth, makeChords, ladder } from './shared/util.js';

const BPM = 90;
const BARS = 10;
const BEAT = 60 / BPM;
const BAR = BEAT * 4;

export const meta = {
  id: 'b-victory',
  name: 'Victory (dark synthwave)',
  description: 'Restrained relief: a slowly brightening pad, a soft pulse and one leaping lead phrase that resolves on a long Fmaj9.',
  bpm: BPM,
  bars: BARS,
  loop: false,
  tail: 5, // seconds the engine keeps it alive after the last bar (pad release plus reverb)
};

const CH = makeChords({
  Dm9: [2, 'm9'], Bbl: [10, 'maj7#11'], Gm9: [7, 'm9'], Bb9: [10, 'maj9'], Cs: [0, 'sus4'], Am7: [9, 'm7'], F9: [5, 'maj9'],
}, { center: 65, bassLo: 34 });

// chord and span in bars, starting at the given bar
const SPANS = { 0: ['Dm9', 2], 2: ['Bbl', 1], 3: ['Gm9', 1], 4: ['Bb9', 2], 6: ['Cs', 1], 7: ['Am7', 1], 8: ['F9', 2] };
const BAR_CHORD = ['Dm9', 'Dm9', 'Bbl', 'Gm9', 'Bb9', 'Bb9', 'Cs', 'Am7', 'F9', 'F9'];

// Lead events per bar: [beat, length in beats, midi]
const LEAD = {
  2: [[0.5, 2, 69], [3, 1, 76]], 3: [[1, 2.5, 74]],
  4: [[0.5, 1.5, 72], [2.5, 1.5, 79]], 5: [[1, 3, 77]],
  6: [[0.5, 1.5, 74]], 7: [[1, 2.5, 76]],
  8: [[1, 5.5, 81]],
};

export function create(ac, out) {
  const fx = buildFx(ac, out, {
    bpm: BPM, trim: 0.85, tapeHz: 12000, revSec: 4.4, revBright: 0.52, revDark: 0.4, revRet: 0.7,
    delBeats: 0.75, delFb: 0.46, delLpL: 2000, delLpR: 1800, delRet: 0.55, arpDel: 0.6, leadDel: 0.45, padRev: 0.45,
  });
  const v = makeVoices(ac, fx);
  const bloom = (bar) => smooth(bar, 0, 8.5); // 0 to 1 over the piece

  return {
    scheduleBar(t0, bar, loop) {
      const rnd = mulberry32(0x71c70 ^ (bar * 7919 + loop * 104729));
      const jit = (ms) => (rnd() - 0.5) * 2 * ms * 0.001;
      const at = (x) => (x < t0 ? t0 : x);
      const ch = CH[BAR_CHORD[bar]];
      const b = bloom(bar);

      const sp = SPANS[bar];
      if (sp) {
        const [, len] = sp;
        const last = bar === 8;
        const dur = last ? BAR * 2.2 : len * BAR;
        v.pad(t0, ch.pad, dur, {
          vol: 0.042 * (0.9 + 0.3 * b + (last ? 0.1 : 0)), a: bar === 0 ? 1.2 : len > 1 ? 1.2 : 0.7, rel: last ? 4.2 : 1.8,
          cutA: 380 * Math.pow(6.5, b), cutB: 380 * Math.pow(6.5, last ? 0.98 : bloom(bar + len)), q: 1.2, det: 9, sub: ch.sub, rnd,
        });
        v.drone(t0, ch.root, dur, 0.04 + 0.02 * b, { a: 1.2, rel: last ? 3.5 : 1.5 });
      }

      // soft pulse and heartbeat in the middle
      if (bar >= 4 && bar <= 7) {
        for (let s = 0; s < 8; s++) {
          if (s % 2 === 1 && bar < 6) continue;
          v.bass(at(t0 + (s * BEAT) / 2 + jit(3)), ch.root + (s === 4 ? 7 : 0), BEAT * 0.3, 0.1 * (s % 2 ? 0.7 : 1) * (0.92 + rnd() * 0.16), 200 + 380 * b, { q: 3 });
        }
        for (const [bt, vel] of [[0, 0.75], [2, 0.6]]) v.kick(at(t0 + bt * BEAT + jit(1.5)), vel, { f0: 130, f1: 44, len: 0.4, vol: 0.34, depth: 0.5, rel: 0.4 });
      }
      if (bar === 8) v.kick(t0, 0.55, { f0: 120, f1: 42, len: 0.55, vol: 0.32, depth: 0.7, rel: 0.5 }); // one soft resolving thump
      if (bar === 6) v.clap(at(t0 + 2 * BEAT), 0.5, rnd, { f: 1400, vol: 0.55, tail: 0.2, hold: 0.2 });

      // sparse arp plucks
      if (bar >= 2 && bar <= 7) {
        const lad = ladder(ch, 62, 88);
        const pos = [1.5, 3.5, 0, 2.5];
        const n = bar < 4 ? 2 : 4;
        for (let i = 0; i < n; i++) v.arp(at(t0 + pos[i] * BEAT + jit(5)), lad[(i * 3 + bar * 2) % lad.length], 0.8 + rnd() * 0.3, 0.3 + 0.5 * b, { vol: 0.1, cutBase: 420, ratio: 5.5, dec: 0.4 });
      }
      if (bar === 8) { // a few high drops over the final chord
        const hi = ladder(ch, 84, 96);
        [[1, 0], [2.5, 2], [4.5, 1], [6, 3]].forEach(([bt, i]) => v.arp(at(t0 + bt * BEAT), hi[i % hi.length], 0.6, 0.6, { vol: 0.07, cutBase: 900, ratio: 3, dec: 0.7, types: [['triangle', 0], ['sine', 900]] }));
      }

      const ld = LEAD[bar];
      if (ld) for (const [bt, d, m] of ld) v.lead(at(t0 + bt * BEAT + jit(6)), d * BEAT, m, 0.105, rnd, { cutA: 800, cutB: 2000, cutC: 1300, glide: 0.14, beat: BEAT, rel: bar === 8 ? 1.6 : 0.42 });
    },
    dispose() { fx.dispose(); },
  };
}

export const SCORE = { lead: LEAD, names: BAR_CHORD, chords: CH };
