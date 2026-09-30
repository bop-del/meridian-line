// Style B, theme "foundry": oppressive, mechanical, cold, heavy low end. F sharp minor over a fixed F sharp pedal, 86 BPM, 36 bars.
// A stepwise-growing 16th sequencer bass on the pedal, deep sub drone, slow kick with a half-time clap, piston chugs and metal
// clanks, a cold 3-against-4 tick sequence that phases across the bars, a wide-detuned hollow pad whose chords grind against
// the pedal (G over F#, C# major over F#), and a brittle two-tone lead motif: tritone down, then up a major seventh.
// setIntensity layers: sequencer steps grow from .16, kick .24, chugs .30, clanks .35, tick sequence .40, clap .40, lead .45,
// four-on-the-floor kick .75 (on top of the loop arc).
import { buildFx } from './shared/fx.js';
import { makeVoices } from './shared/voices.js';
import { mulberry32, lerp, smooth, makeArc, makeChords, ladder, expandSections, makeIntensity } from './shared/util.js';

const BPM = 86;
const BARS = 36;
const BEAT = 60 / BPM;
const BAR = BEAT * 4;

export const meta = {
  id: 'b-foundry',
  name: 'Foundry (dark synthwave)',
  description: 'Oppressive F sharp minor synthwave over a heavy pedal: machine bass sequencer, slow kick, clanks and a cold tick sequence.',
  bpm: BPM,
  bars: BARS,
};

const CH = makeChords({
  Fm: [6, 'm7'], Fs2: [6, 'susb2'], Gp: [7, 'maj'], Dp: [2, 'maj7'], Cp: [1, 'maj'],
}, { center: 62, bassLo: 36 });
for (const n of ['Fm', 'Fs2', 'Gp', 'Dp', 'Cp']) { CH[n].root = 42; CH[n].sub = 54; } // fixed F# pedal under every chord

const { names: BAR_CHORD, span: SPAN_AT } = expandSections([
  ['Fm', 4], ['Fs2', 2], ['Fm', 2], // 0-7
  ['Fm', 2], ['Gp', 2], ['Fm', 2], ['Dp', 2], // 8-15
  ['Fm', 2], ['Gp', 1], ['Fm', 1], ['Dp', 2], ['Cp', 1], ['Fs2', 1], // 16-23
  ['Fm', 1], ['Gp', 1], ['Fm', 1], ['Dp', 1], ['Fm', 1], ['Gp', 1], ['Cp', 1], ['Fs2', 1], // 24-31
  ['Fm', 2], ['Fs2', 2], // 32-35
]);

const arc = makeArc([[0, 0.16], [8, 0.3], [16, 0.55], [24, 0.8], [31.99, 0.85], [32, 0.42], [36, 0.16]], BARS);

// sequencer: steps in order of appearance, and the semitone offset of each (octave jumps are the machine's only melody)
const SEQ_ORDER = [0, 8, 3, 11, 6, 14, 2, 10, 5, 13, 7, 15];
const SEQ_OFF = { 0: 0, 8: 0, 3: 0, 11: 12, 6: 0, 14: 0, 2: 0, 10: 0, 5: 12, 13: 0, 7: 0, 15: 0 };
const CHUG = [0.5, 1.5, 2.5, 3.5];
const MACH_HATS = [0, 0.5, 0.75, 1.25, 1.5, 2, 2.5, 2.75, 3.25, 3.5]; // fixed machine pattern, beats
const CLANK_A = [[1.5, 66], [3.25, 73]];
const CLANK_B = [[0.75, 67], [2.5, 66], [3.75, 61]];
const TICK_SEQ = [0, 3, 1, 4, 2];

// Lead events per bar: [beat, length in beats, midi]
const LEAD = {
  16: [[1, 1.5, 73], [3, 1, 67]], 17: [[1.5, 2.5, 78]],
  18: [[0.5, 1, 69], [2.5, 1.5, 66]], 19: [[1, 3, 72]],
  20: [[1, 1.5, 73], [3, 1, 67]], 21: [[1.5, 1.5, 78], [3.5, 0.5, 76]],
  22: [[0, 2, 74]], 23: [[1, 3, 73]],
  28: [[1, 1.5, 73], [3, 1, 67]], 29: [[1.5, 2.5, 78]],
  30: [[0.5, 1.5, 69], [2.5, 1.5, 72]], 31: [[1, 3, 66]],
};

export function create(ac, out) {
  const fx = buildFx(ac, out, {
    bpm: BPM, trim: 0.7, satK: 1.1, tapeHz: 14000, revSec: 2.8, revBright: 0.58, revDark: 0.3, revRet: 0.56, revHP: 220,
    delBeats: 0.75, delFb: 0.38, delLpL: 2200, delLpR: 2000, delRet: 0.5, arpDel: 0.6, leadDel: 0.35, percDel: 0.25, percRev: 0.28,
    padRev: 0.3, chorus: 0.5, gateRet: 0.8, gateSec: 0.7,
  });
  const v = makeVoices(ac, fx);
  const inten = makeIntensity(ac, 0.6);
  const lv = (barPos) => 0.4 * inten.get() + 0.6 * arc(barPos);

  return {
    setIntensity: (x) => inten.set(x),
    scheduleBar(t0, bar, loop) {
      const rnd = mulberry32(0xf0ee7 ^ (bar * 7919 + loop * 104729));
      const jit = (ms) => (rnd() - 0.5) * 2 * ms * 0.001;
      const at = (x) => (x < t0 ? t0 : x);
      const e = lv(bar);
      const ch = CH[BAR_CHORD[bar]];

      // pad and deep drone
      const span = SPAN_AT[bar];
      if (span) {
        const eEnd = lv(bar + span);
        v.pad(t0, ch.pad, span * BAR, {
          vol: 0.036 * (0.5 + 0.7 * e), a: span > 1 ? 1.6 : 0.8, rel: 1.8, cutA: 260 * Math.pow(6, e), cutB: 260 * Math.pow(6, eEnd),
          q: 1.6, det: 16, spread: 0.5, sub: null, rnd,
        });
        v.drone(t0, 30, span * BAR, 0.05 + 0.05 * e, { a: 1.2, rel: 1.8, h: 0.2 });
      }

      // machine bass: the sequencer adds steps as the level rises
      if (e > 0.14) {
        const n = Math.round(lerp(2, 12, smooth(e, 0.16, 0.65)));
        const g = smooth(e, 0.14, 0.08);
        const cutBase = 90 + 380 * e;
        for (let i = 0; i < n; i++) {
          const s = SEQ_ORDER[i];
          let off = SEQ_OFF[s];
          if (s === 15 && bar % 4 === 3) off = 1;
          const pos = bar + s / 16;
          const cut = cutBase * (1 + 0.4 * Math.sin((2 * Math.PI * pos) / 4));
          const acc = s % 4 === 0 ? 1 : s % 2 === 0 ? 0.8 : 0.66;
          v.bass(at(t0 + (s * BEAT) / 4 + jit(1.5)), 42 + off, BEAT * 0.2, 0.15 * g * (0.55 + 0.5 * e) * acc, cut, { q: 2.6, type: 'sawtooth', type2: 'square', sawGain: 0.42, subGain: 1.0, open: 2.2 });
        }
      }

      // drums: slow heavy kick, half-time clap
      const gK = smooth(e, 0.24, 0.08);
      if (gK > 0.05) {
        const kk = [[0, 1], [2, 0.9]];
        if (e > 0.75) kk.push([1, 0.7], [3, 0.7]);
        else if (e > 0.5 && bar % 2) kk.push([2.75, 0.5]);
        for (const [b, vel] of kk) v.kick(at(t0 + b * BEAT + jit(1)), gK * vel * (0.95 + rnd() * 0.08), { f0: 110, f1: 38, len: 0.5, vol: 0.44, click: 0.05, depth: 0.3, rel: 0.36 });
      }
      const gC = smooth(e, 0.4, 0.08);
      if (gC > 0.05) v.clap(at(t0 + 2 * BEAT + jit(1)), gC, rnd, { f: 1100, vol: 0.85, tail: 0.24, body: 160, hold: 0.22 });

      // pistons and machine hats
      const gP = smooth(e, 0.3, 0.1);
      if (gP > 0.05) for (const b of CHUG) v.tick(at(t0 + b * BEAT + jit(1.5)), gP * (b % 1 ? 1 : 0.7), rnd, { vol: 0.16, hp: 850, f1: 500, dur: 0.07, type: 'bandpass', q: 0.9 });
      if (e > 0.55) {
        const gH = smooth(e, 0.55, 0.1);
        for (const b of MACH_HATS) v.hat(at(t0 + b * BEAT + jit(1)), gH * (b % 1 ? 0.55 : 0.85), rnd, { vol: 0.13, hp: 6800, dur: 0.03 });
      }
      // clanks
      const gL = smooth(e, 0.35, 0.1);
      if (gL > 0.05) for (const [b, m] of bar % 2 ? CLANK_B : CLANK_A) v.clank(at(t0 + b * BEAT + jit(2)), m, gL * (0.8 + rnd() * 0.3), { vol: 0.085 });
      if (e > 0.3 && bar % 4 === 3) v.riser(t0 + BEAT * 2.5, BEAT * 1.4, { vol: 0.04, f0: 700, f1: 2600, q: 1.2, peak: 0.9, bus: fx.percBus });

      // cold tick sequence, 3 against 4: phases across the bars
      if (e > 0.4) {
        const gT = smooth(e, 0.4, 0.12);
        const lad = ladder(ch, 66, 90);
        const every = e > 0.66 ? 3 : 6;
        for (let s = 0; s < 16; s++) {
          const k = bar * 16 + s;
          if (k % every !== 0) continue;
          const m = lad[TICK_SEQ[(k / 3) % TICK_SEQ.length | 0] % lad.length];
          v.arp(at(t0 + (s * BEAT) / 4 + jit(1)), m, gT * (0.8 + rnd() * 0.3), e, { vol: 0.1, cutBase: 900, ratio: 3.2, dec: 0.14, q: 3, types: [['square', -4], ['square', 5]] });
        }
      }

      // lead
      const ld = LEAD[bar];
      if (ld) {
        const gLd = smooth(e, 0.45, 0.1);
        if (gLd > 0.05) for (const [b, d, m] of ld) v.lead(at(t0 + b * BEAT + jit(4)), d * BEAT, m, 0.1 * gLd, rnd, { cutA: 800, cutB: 1900, cutC: 1300, glide: 0.06, beat: BEAT, types: [['square', 0.5], ['triangle', 0.7], ['triangle', 0.1]] });
      }

      // section hits and the loop point
      if ((bar === 8 || bar === 16 || bar === 24) && e > 0.35) v.boom(t0, 0.75);
      if (bar === 32 && e > 0.25) v.boom(t0, 0.7);
      if (bar === BARS - 1) v.riser(t0, BAR * 0.98, { vol: 0.03, f0: 400, f1: 3200, q: 1.8 });
    },
    dispose() { fx.dispose(); },
  };
}

export const SCORE = { lead: LEAD, names: BAR_CHORD, chords: CH };
