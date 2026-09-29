// Style B game over stinger: quiet, sombre, unresolved, fades out. E minor drifting to a hanging B sus with a flat ninth, 72 BPM,
// 5 bars, one shot. A low soft thud, a pad whose filter closes as it goes, one falling lead phrase (B ... E ... G ... F sharp) that
// ends a semitone sigh above nothing, and a few dark echoes that keep ringing while the master fades away.
// meta.loop is false: the player plays the 5 bars once and lets the tail ring.
import { buildFx } from './shared/fx.js';
import { makeVoices } from './shared/voices.js';
import { mulberry32, makeChords, ladder } from './shared/util.js';

const BPM = 72;
const BARS = 5;
const BEAT = 60 / BPM;
const BAR = BEAT * 4;

export const meta = {
  id: 'b-gameover',
  name: 'Game over (dark synthwave)',
  description: 'Sombre and unresolved: a closing pad, one falling lead phrase, a hanging B sus with a flat ninth, fading out.',
  bpm: BPM,
  bars: BARS,
  loop: false,
  tail: 5,
};

const CH = makeChords({
  Em9: [4, 'm9'], Cl: [0, 'maj7#11'], Am7: [9, 'm7'], Bs: [11, 'sus4b9'],
}, { center: 60, bassLo: 34 });
const BAR_CHORD = ['Em9', 'Cl', 'Am7', 'Bs', 'Bs'];
const SPAN = { 0: 1, 1: 1, 2: 1, 3: 2 };

// Lead events per bar: [beat, length in beats, midi]
const LEAD = { 0: [[1, 2.5, 71]], 1: [[2, 2, 64]], 2: [[1.5, 2.5, 67]], 3: [[2, 5.5, 66]] };
const PLUCK = { 1: [0.5, 76], 2: [2.5, 72], 3: [1, 74] };

export function create(ac, out) {
  const fx = buildFx(ac, out, {
    bpm: BPM, trim: 0.95, satK: 1.5, tapeHz: 8500, revSec: 4.8, revBright: 0.46, revDark: 0.44, revRet: 0.7,
    delBeats: 0.75, delFb: 0.5, delLpL: 1500, delLpR: 1300, delRet: 0.6, arpDel: 0.7, leadDel: 0.5, padRev: 0.45,
  });
  const v = makeVoices(ac, fx);

  return {
    scheduleBar(t0, bar, loop) {
      const rnd = mulberry32(0x6a3e0 ^ (bar * 7919 + loop * 104729));
      const jit = (ms) => (rnd() - 0.5) * 2 * ms * 0.001;
      const at = (x) => (x < t0 ? t0 : x);
      const ch = CH[BAR_CHORD[bar]];
      const k = Math.pow(0.66, bar); // everything darkens and thins

      const span = SPAN[bar];
      if (span) {
        const dur = span * BAR;
        v.pad(t0, ch.pad, dur, {
          vol: 0.04 * (0.6 + 0.6 * k), a: bar === 0 ? 1.4 : 1.0, rel: 3.2, cutA: 1300 * Math.pow(0.6, bar), cutB: 1300 * Math.pow(0.6, bar + span),
          q: 1.4, det: 12, sub: ch.sub, rnd,
        });
        v.drone(t0, ch.root, dur, 0.028 + 0.02 * k, { a: 1.0, rel: 3.0, h: 0.08 });
      }
      if (bar === 0) v.boom(t0, 0.5, { f0: 62, f1: 30, len: 1.8, vol: 0.3 });

      const ld = LEAD[bar];
      if (ld) for (const [bt, d, m] of ld) v.lead(at(t0 + bt * BEAT + jit(6)), d * BEAT, m, 0.1, rnd, { cutA: 600, cutB: 1300, cutC: 900, glide: 0.2, beat: BEAT, rel: bar === 3 ? 2.4 : 0.6, atk: 0.06 });

      const pl = PLUCK[bar];
      if (pl) v.arp(at(t0 + pl[0] * BEAT), pl[1], 0.8, 0.35, { vol: 0.09, cutBase: 380, ratio: 4, dec: 0.6, types: [['triangle', -5], ['sawtooth', 6]] });

      // fade the whole mix out over the last two bars and into the tail
      if (bar === 3) {
        const g = fx.master.gain;
        g.setValueAtTime(0.95, t0);
        g.exponentialRampToValueAtTime(0.45, t0 + 2 * BAR); // gentle over the hanging chord ...
        g.exponentialRampToValueAtTime(0.0003, t0 + 2 * BAR + 7); // ... then gone under the reverb tail
      }
    },
    dispose() { fx.dispose(); },
  };
}

export const SCORE = { lead: LEAD, names: BAR_CHORD, chords: CH };
