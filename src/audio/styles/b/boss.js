// Style B, boss theme: driving, double-time feel, always intense, with a sense of danger. B flat minor, 132 BPM, 32 bars.
// Four-on-the-floor kick with syncopated pickups, claps on 2 and 4, sixteenth hats, relentless sixteenth gallop bass with a
// tritone alarm figure (B flat, E, F, E), syncopated 3-3-4-3-3 saw stabs, a fast arp, and a lead motif built on a rising tritone
// (B flat to E) that returns bolder at the end. Bars 16-23 are the tension section: chords lift to G flat and A flat, an
// alarm pulse on the tritone swells, and the section ends on the dominant minor before the last statement.
// Layers follow the loop arc; setIntensity (always 1 for bosses) only trims the quietest parts.
import { buildFx } from './shared/fx.js';
import { makeVoices } from './shared/voices.js';
import { mulberry32, lerp, smooth, makeArc, makeChords, ladder, expandSections, makeIntensity } from './shared/util.js';

const BPM = 132;
const BARS = 32;
const BEAT = 60 / BPM;
const BAR = BEAT * 4;

export const meta = {
  id: 'b-boss',
  name: 'Boss (dark synthwave)',
  description: 'Driving B flat minor synthwave at 132 BPM: gallop bass, stabs, fast arp, a tritone danger motif and a tense second half.',
  bpm: BPM,
  bars: BARS,
};

const CH = makeChords({
  Bbm: [10, 'm7'], Gb: [6, 'maj7'], Ab: [8, 'add9'], Db: [1, 'maj7'], E: [4, '7'], Fm: [5, 'm'],
}, { center: 63, bassLo: 34 });

const { names: BAR_CHORD, span: SPAN_AT } = expandSections([
  ['Bbm', 4], ['Gb', 2], ['Ab', 2], // 0-7
  ['Bbm', 2], ['Db', 2], ['Gb', 2], ['E', 1], ['Ab', 1], // 8-15
  ['Gb', 1], ['Ab', 1], ['Bbm', 1], ['E', 1], ['Gb', 1], ['Ab', 1], ['E', 1], ['Fm', 1], // 16-23 tension
  ['Bbm', 2], ['Gb', 2], ['Ab', 2], ['E', 1], ['Ab', 1], // 24-31
]);

const arc = makeArc([[0, 0.72], [8, 0.82], [16, 0.92], [24, 0.97], [30, 0.97], [32, 0.72]], BARS);

const BASS_A = [0, 0, 12, 0, 0, 0, 12, 0, 0, 0, 12, 0, 0, 0, 12, 0];
const BASS_B = [0, 0, 12, 0, 0, 0, 12, 0, 0, 0, 12, 0, 0, 6, 7, 6]; // tritone alarm on the last beat
const STAB_STEPS = [0, 3, 6, 10, 13];
const ARP_SEQ = [0, 2, 4, 1, 5, 3, 6, 2];

// Lead events per bar: [beat, length in beats, midi]
const LEAD = {
  8: [[0, 1.5, 70], [2, 1, 76]], 9: [[0.5, 1.5, 73], [2.5, 1.5, 68]],
  10: [[0, 1.5, 73], [2, 1, 79]], 11: [[0.5, 1.5, 77], [2.5, 1.5, 72]],
  12: [[0, 1.5, 70], [2, 1, 77]], 13: [[0.5, 1.5, 73], [2.5, 1.5, 66]],
  14: [[0, 1, 71], [1.5, 0.5, 76], [2.5, 1.5, 80]], 15: [[0.5, 1.5, 72]],
  16: [[0, 1, 77], [1.5, 0.5, 82], [2.5, 1.5, 78]], 17: [[0, 1, 75], [1.5, 0.5, 80], [2.5, 1.5, 82]],
  18: [[0, 1, 77], [1.5, 0.5, 73], [2.5, 1.5, 80]], 19: [[0, 1, 76], [1.5, 0.5, 80], [2, 2, 83]],
  20: [[0, 1, 78], [1.5, 0.5, 82], [2.5, 1.5, 77]], 21: [[0, 1, 80], [1.5, 0.5, 75], [2.5, 1.5, 72]],
  22: [[0, 1, 80], [1.5, 0.5, 76], [2.5, 1.5, 71]], 23: [[0, 2, 77], [2.5, 1.5, 72]],
  24: [[0, 1.5, 70], [2, 1, 76]], 25: [[0.5, 1.5, 73], [2.5, 1.5, 68]],
  26: [[0, 1.5, 70], [2, 1, 77]], 27: [[0.5, 1.5, 73], [2.5, 1.5, 66]],
  28: [[0, 1, 72], [1.5, 0.5, 75], [2.5, 1.5, 80]], 29: [[0.5, 1.5, 77], [2.5, 1.5, 70]],
  30: [[0, 1, 71], [1.5, 0.5, 76], [2.5, 1.5, 80]],
};

export function create(ac, out) {
  const fx = buildFx(ac, out, {
    bpm: BPM, trim: 0.68, satK: 1.5, tapeHz: 12500, revSec: 2.6, revBright: 0.55, revDark: 0.4, revRet: 0.56,
    delBeats: 0.75, delFb: 0.4, delLpL: 2300, delLpR: 2000, delRet: 0.5, arpDel: 0.4, leadDel: 0.36, padRev: 0.3, percRev: 0.2,
  });
  const v = makeVoices(ac, fx);
  const inten = makeIntensity(ac, 1);
  const lv = (barPos) => 0.3 * inten.get() + 0.7 * arc(barPos);

  return {
    setIntensity: (x) => inten.set(x),
    scheduleBar(t0, bar, loop) {
      const rnd = mulberry32(0xb055 ^ (bar * 7919 + loop * 104729));
      const jit = (ms) => (rnd() - 0.5) * 2 * ms * 0.001;
      const at = (x) => (x < t0 ? t0 : x);
      const e = lv(bar);
      const ch = CH[BAR_CHORD[bar]];
      const S = BEAT / 4;

      // pad and drone
      const span = SPAN_AT[bar];
      if (span) {
        const eEnd = lv(bar + span);
        v.pad(t0, ch.pad, span * BAR, {
          vol: 0.04 * (0.55 + 0.6 * e), a: 0.35, rel: 1.2, cutA: 380 * Math.pow(6.5, e), cutB: 380 * Math.pow(6.5, eEnd),
          q: 1.4, det: 10, sub: ch.sub, rnd,
        });
        v.drone(t0, ch.root, span * BAR, 0.03 + 0.03 * e, { a: 0.4, rel: 1.0 });
      }

      // gallop bass
      {
        const pat = bar % 2 ? BASS_B : BASS_A;
        const g = smooth(e, 0.2, 0.1);
        for (let s = 0; s < 16; s++) {
          const pos = bar + s / 16;
          const cut = (170 + 1000 * e) * (1 + 0.28 * Math.sin((2 * Math.PI * pos) / 8) + 0.1 * Math.sin((2 * Math.PI * pos) / 3.1));
          const acc = s % 4 === 0 ? 1 : s % 2 === 0 ? 0.8 : 0.68;
          v.bass(at(t0 + s * S + jit(1.5)), ch.root + pat[s], S * 0.78, 0.14 * g * (0.6 + 0.4 * e) * acc * (0.92 + rnd() * 0.16), cut, { q: 3.6, type2: 'square', subOct: 1, sawGain: 0.45, subGain: 0.85, dec: 0.1, open: 2.6, sus: 0.7 });
        }
      }

      // drums
      const kk = [[0, 1], [1, 0.9], [2, 0.95], [3, 0.9]];
      if (bar % 2) kk.push([1.75, 0.5], [3.5, 0.55]); else kk.push([2.75, 0.55]);
      for (const [b, vel] of kk) v.kick(at(t0 + b * BEAT + jit(1)), vel * (0.95 + rnd() * 0.08), { f0: 165, f1: 48, len: 0.3, vol: 0.42, depth: 0.3, rel: 0.21, click: 0.05 });
      const fillBar = bar % 8 === 7;
      for (const b of [1, 3]) {
        if (fillBar && b === 3) continue;
        v.clap(at(t0 + b * BEAT + jit(1.5)), 0.95 + rnd() * 0.1, rnd, { f: 1700, vol: 0.9, tail: 0.12, hold: 0.12 });
      }
      for (let s = 0; s < 16; s++) {
        const off = s % 2 === 1; const q8 = s % 4 === 2;
        if (fillBar && s >= 12) continue;
        v.hat(at(t0 + s * S + (off ? 0.05 * S : 0) + jit(2)), (q8 ? 1 : off ? 0.5 : 0.7) * (0.85 + rnd() * 0.3), rnd, { vol: 0.15, dur: q8 ? 0.085 : 0.035 });
      }
      if (fillBar) {
        // last beat: rising tom and clap roll into the next section
        for (let i = 0; i < 4; i++) v.tom(at(t0 + (3 + i / 4) * BEAT), 120 - i * 14, 0.7 + i * 0.1, { vol: 0.26, len: 0.16 });
        for (let i = 0; i < 4; i++) v.clap(at(t0 + (3 + i / 4) * BEAT + 0.02), 0.5 + i * 0.15, rnd, { f: 1700, vol: 0.55, tail: 0.05, hold: 0.06 });
      }

      // stabs (syncopated 3-3-4-3-3)
      if (bar >= 4) {
        const steps = bar < 8 ? [6, 13] : STAB_STEPS;
        for (const s of steps) v.stab(at(t0 + s * S + jit(2)), ch.pad, S * 1.6, 0.045 * (0.7 + 0.3 * e), 1500 + 1800 * e, rnd, { open: 3 });
      }

      // fast arp, density grows into the tension section
      if (bar >= 4) {
        const lad = ladder(ch, 58, 89);
        const n = bar < 8 ? 4 : bar < 16 ? 8 : 12;
        const order = [0, 8, 4, 12, 2, 10, 6, 14, 1, 9, 5, 13];
        const steps = order.slice(0, n).sort((a, b) => a - b);
        steps.forEach((s, i) => {
          const m = lad[ARP_SEQ[(i + bar) % ARP_SEQ.length] % lad.length];
          v.arp(at(t0 + s * S + jit(1.5)), m, (s % 4 === 0 ? 1 : 0.75) * (0.85 + rnd() * 0.3), lv(bar + s / 16), { vol: 0.115, cutBase: 700, ratio: 5, dec: 0.13 });
        });
      }

      // alarm pulse on the tritone in the tension section, swelling bar by bar
      if (bar >= 20 && bar < 24) {
        const swell = 0.5 + 0.5 * ((bar - 20) / 3);
        for (let i = 0; i < 8; i++) v.arp(at(t0 + i * BEAT / 2), i % 2 ? 76 : 70, swell * (i % 2 ? 0.85 : 1), 0.95, { vol: 0.1, cutBase: 1500, ratio: 2.6, dec: 0.2, q: 1.5, types: [['square', -6], ['sawtooth', 6]] });
      }

      // lead
      const ld = LEAD[bar];
      if (ld) for (const [b, d, m] of ld) v.lead(at(t0 + b * BEAT + jit(4)), d * BEAT, m, 0.125, rnd, { cutA: 1100, cutB: 3000, cutC: 1900, glide: 0.07, beat: BEAT, atk: 0.02 });

      // section marks and risers
      if (bar === 8 || bar === 16 || bar === 24) v.boom(t0, 0.7);
      if (bar % 8 === 7) v.riser(t0, BAR * 0.98, { vol: 0.055, f0: 500, f1: 6000, q: 1.8 });
    },
    dispose() { fx.dispose(); },
  };
}

export const SCORE = { lead: LEAD, names: BAR_CHORD, chords: CH };
