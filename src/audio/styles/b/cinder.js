// Style B, level 2 theme "cinder": tense, sparse, ember colours. C minor with a phrygian D-flat and a tritone G-flat, 90 BPM, 36 bars.
// A dark resonant pad, a low pedal, a heartbeat kick, ember ticks and crackle instead of hats, slow long-decay arp plucks into a
// quarter-note ping-pong delay, and a lead motif built on a rising tritone and a sigh down by a semitone.
// Pressure rises across the loop (bass pulse thickens, embers multiply, riser, toms) and then drops out at bar 32.
// setIntensity layers: kick .26, arp .18, embers .12+, clap .55, lead .45, sixteenth bass .82 (on top of the loop arc).
import { buildFx } from './shared/fx.js';
import { makeVoices } from './shared/voices.js';
import { mulberry32, lerp, smooth, makeArc, makeChords, ladder, expandSections, makeIntensity } from './shared/util.js';

const BPM = 90;
const BARS = 36;
const BEAT = 60 / BPM;
const BAR = BEAT * 4;

export const meta = {
  id: 'b-cinder',
  name: 'Cinder (dark synthwave)',
  description: 'Sparse, tense C minor synthwave: heartbeat kick, ember ticks, dark pad, rising pressure and a tritone lead motif.',
  bpm: BPM,
  bars: BARS,
};

const CH = makeChords({
  Cm: [0, 'm9'], Db: [1, 'maj7#11'], Ab: [8, 'maj7'], Fm: [5, 'm7'], Gb: [6, 'add#11'], G7: [7, '7b9'],
}, { center: 63, bassLo: 36 });

const { names: BAR_CHORD, span: SPAN_AT } = expandSections([
  ['Cm', 4], ['Db', 2], ['Cm', 2], // 0-7 embers
  ['Cm', 2], ['Fm', 2], ['Db', 2], ['G7', 2], // 8-15 ticking begins
  ['Cm', 2], ['Db', 1], ['Gb', 1], ['Fm', 2], ['G7', 2], // 16-23 pressure
  ['Cm', 1], ['Db', 1], ['Cm', 1], ['Gb', 1], ['Cm', 1], ['Db', 1], ['Fm', 1], ['G7', 1], // 24-31 climb
  ['Cm', 2], ['G7', 2], // 32-35 drop and hold
]);

// pressure rises to bar 31, then falls away
const arc = makeArc([[0, 0.1], [8, 0.22], [16, 0.42], [24, 0.68], [31.99, 0.95], [32, 0.38], [34, 0.22], [36, 0.1]], BARS);

// bass pulse patterns as [beat, semitone offset]; offset 1 is the phrygian sneer
const P1 = [[0, 0], [2, 0]];
const P2 = [[0, 0], [1.5, 0], [2, 0], [3.5, 1]];
const P3 = [[0, 0], [0.5, 0], [1, 0], [1.5, 0], [2, 0], [2.5, 0], [3, 0], [3.5, 1]];
const P4 = Array.from({ length: 16 }, (_, i) => [i / 4, i % 8 === 7 ? 1 : i % 4 === 2 ? 12 : 0]);
const ARP_SEQ = [0, 4, 2, 6, 3, 7, 1, 5];
const ARP_POS = [0, 2.5, 1.5, 3.5, 0.5, 2, 1, 3]; // beats, in order of appearance

// Lead events per bar: [beat, length in beats, midi]
const LEAD = {
  16: [[1, 2, 67], [3.5, 0.5, 73]], 17: [[1, 3, 72]],
  18: [[0.5, 2.5, 68]], 19: [[1, 3, 70]],
  20: [[1, 2, 65], [3.5, 0.5, 71]], 21: [[1, 3, 68]],
  22: [[1, 2, 71]], 23: [[1.5, 2.5, 67]],
  24: [[0.5, 1.5, 79], [3, 1, 73]], 25: [[1, 3, 72]],
  26: [[0.5, 1.5, 75], [2.5, 1.5, 78]], 27: [[1, 3, 77]],
  28: [[0.5, 1.5, 79], [3, 0.5, 73]], 29: [[1, 3, 77]],
  30: [[0, 1, 72], [1.5, 0.5, 68], [2.5, 1.5, 71]], 31: [[1, 3, 74]],
};

export function create(ac, out) {
  const fx = buildFx(ac, out, {
    bpm: BPM, trim: 0.82, satK: 1.6, tapeHz: 9500, revSec: 4.6, revBright: 0.46, revDark: 0.42, revRet: 0.66,
    delBeats: 1, delFb: 0.52, delLpL: 1300, delLpR: 1100, delRet: 0.62, arpDel: 0.75, leadDel: 0.5, percDel: 0.3, percRev: 0.3, padRev: 0.4,
  });
  const v = makeVoices(ac, fx);
  const inten = makeIntensity(ac, 0.6);
  const lv = (barPos) => 0.4 * inten.get() + 0.6 * arc(barPos);

  return {
    setIntensity: (x) => inten.set(x),
    scheduleBar(t0, bar, loop) {
      const rnd = mulberry32(0x0c1dea ^ (bar * 7919 + loop * 104729));
      const jit = (ms) => (rnd() - 0.5) * 2 * ms * 0.001;
      const at = (x) => (x < t0 ? t0 : x);
      const e = lv(bar);
      const ch = CH[BAR_CHORD[bar]];

      // pad, pedal drone
      const span = SPAN_AT[bar];
      if (span) {
        const eEnd = lv(bar + span);
        v.pad(t0, ch.pad, span * BAR, {
          vol: 0.04 * (0.5 + 0.75 * e), a: span > 1 ? 1.5 : 0.9, rel: 2.2, cutA: 240 * Math.pow(6.5, e), cutB: 240 * Math.pow(6.5, eEnd),
          q: 2.1, det: 11, spread: 0.4, sub: ch.sub, subGain: 0.5, rnd,
        });
        v.drone(t0, ch.root, span * BAR, 0.02 + 0.035 * e, { a: 1.6, rel: 2, h: 0.06 });
      }

      // bass pulse thickens with pressure
      if (e > 0.2) {
        const pat = e < 0.4 ? P1 : e < 0.62 ? P2 : e < 0.82 ? P3 : P4;
        const g = smooth(e, 0.2, 0.08);
        const cutBase = 100 + 520 * e;
        for (const [b, off] of pat) {
          const pos = bar + b / 4;
          const slow = 1 + 0.35 * Math.sin((2 * Math.PI * pos) / 6) + 0.12 * Math.sin((2 * Math.PI * pos) / 2.3);
          const acc = b % 1 === 0 ? 1 : 0.7;
          v.bass(at(t0 + b * BEAT + jit(3)), ch.root + off, BEAT * (pat === P4 ? 0.2 : 0.42), 0.14 * g * (0.55 + 0.5 * e) * acc * (0.9 + rnd() * 0.2), cutBase * slow, { q: 4.5, open: 2.2 });
        }
      }

      // heartbeat kick
      const gK = smooth(e, 0.26, 0.08);
      if (gK > 0.05) {
        const kk = [[0, 1], [0.75, 0.55]];
        if (e > 0.6) kk.push([2, 0.85], [2.75, 0.5]);
        if (e > 0.85) kk.push([1, 0.6], [3, 0.6]);
        for (const [b, vel] of kk) v.kick(at(t0 + b * BEAT + jit(1.5)), gK * vel * (0.94 + rnd() * 0.1), { f0: 125, f1: 42, len: 0.4, vol: 0.38, depth: 0.4, rel: 0.34 });
      }
      const gC = smooth(e, 0.55, 0.08);
      if (gC > 0.05) v.clap(at(t0 + 2 * BEAT + jit(2)), gC * (0.9 + rnd() * 0.15), rnd, { f: 1300, vol: 0.8, tail: 0.22, body: 180, hold: 0.22 });

      // embers: ticks on the sixteenth grid plus off-grid crackle
      if (e > 0.12) {
        const nT = Math.round(lerp(1, 11, smooth(e, 0.12, 0.8)));
        for (let i = 0; i < nT; i++) {
          const st = Math.floor(rnd() * 16);
          v.tick(at(t0 + st * BEAT / 4 + jit(4)), 0.5 + rnd() * 0.7, rnd, { vol: 0.07, hp: 3000 + rnd() * 4500, dur: 0.012 + rnd() * 0.02 });
        }
        const nC = Math.round(2 + 6 * e);
        for (let i = 0; i < nC; i++) v.tick(t0 + rnd() * BAR, 0.3 + rnd() * 0.5, rnd, { vol: 0.045, hp: 1800 + rnd() * 2600, dur: 0.008 + rnd() * 0.012, type: 'bandpass', q: 2 });
      }

      // sparse arp plucks
      const gA = smooth(e, 0.18, 0.1);
      if (gA > 0.05) {
        const lad = ladder(ch, 55, 80);
        const n = 2 + Math.round(4 * smooth(e, 0.18, 0.7));
        for (let i = 0; i < n; i++) {
          const m = lad[ARP_SEQ[(i + bar * 3) % ARP_SEQ.length] % lad.length];
          v.arp(at(t0 + ARP_POS[i] * BEAT + jit(5)), m, gA * (0.8 + rnd() * 0.3), e, { vol: 0.12, cutBase: 380, ratio: 5.5, dec: 0.5, q: 2.6, types: [['triangle', -6], ['sawtooth', 7]] });
        }
      }

      // lead
      const ld = LEAD[bar];
      if (ld) {
        const gL = smooth(e, 0.45, 0.1);
        if (gL > 0.05) for (const [b, d, m] of ld) v.lead(at(t0 + b * BEAT + jit(6)), d * BEAT, m, 0.105 * gL, rnd, { cutA: 700, cutB: 1800, cutC: 1100, glide: 0.16, beat: BEAT });
      }

      // pressure devices
      if (bar === 24 && e > 0.3) v.riser(t0, BAR * 8, { vol: 0.045, f0: 300, f1: 3800, q: 2.2, peak: 0.93 });
      if (bar === 31 && e > 0.55) for (let i = 0; i < 4; i++) v.tom(at(t0 + (3 + i / 4) * BEAT), 88 + i * 14, 0.5 + i * 0.12, { vol: 0.22, len: 0.16 });
      if (bar === 32 && e > 0.25) v.boom(t0, 0.7);
      if (bar === BARS - 1) v.riser(t0, BAR * 0.98, { vol: 0.035, f0: 260, f1: 3000, q: 2 });
    },
    dispose() { fx.dispose(); },
  };
}

export const SCORE = { lead: LEAD, names: BAR_CHORD, chords: CH };
