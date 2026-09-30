// Style B, theme "thalassa": bright, airy, forward-driving dark synthwave. D lydian / mixolydian, 104 BPM, 40 bars.
// Four-on-the-floor kick, gated clap, octave-gallop bass, bright detuned pad with a slow sweep, gated 16th arp, high sparkles
// into a wide delay, and a leaping lead motif (fifths and sixths, one lydian G# spark) that is answered higher in the second peak.
// Arc: intro (pad, drone) > build (bass pulse, kick, hats, arp) > peak 1 (motif) > peak 2 (lift, higher answer) > release > intro.
// setIntensity layers: kick .28, arp .30, hats .34, clap .42, lead .50, 16th hats and pickups .72 (on top of the loop arc).
import { buildFx } from './shared/fx.js';
import { makeVoices } from './shared/voices.js';
import { mulberry32, clamp, lerp, smooth, makeArc, makeChords, ladder, expandSections, makeIntensity } from './shared/util.js';

const BPM = 104;
const BARS = 40;
const BEAT = 60 / BPM;
const BAR = BEAT * 4;

export const meta = {
  id: 'b-thalassa',
  name: 'Thalassa (dark synthwave)',
  description: 'Bright, airy D lydian synthwave: gallop bass, four-on-the-floor kick, gated arp and a leaping lead motif over a coral sea.',
  bpm: BPM,
  bars: BARS,
};

const CH = makeChords({
  D: [2, 'maj9'], E: [4, 'add9'], Cs: [0, 'add9'], G: [7, 'maj7'], Bm: [11, 'm7'], A: [9, '7sus2'], Fsm: [6, 'm7'], Em: [4, 'm7'],
}, { center: 64, bassLo: 36 });

const { names: BAR_CHORD, span: SPAN_AT } = expandSections([
  ['D', 2], ['E', 2], ['Cs', 2], ['G', 2], // 0-7 intro
  ['Bm', 2], ['G', 2], ['D', 2], ['E', 1], ['A', 1], // 8-15 build
  ['D', 2], ['E', 2], ['Cs', 2], ['G', 2], // 16-23 peak 1
  ['Fsm', 2], ['E', 2], ['G', 2], ['A', 2], // 24-31 peak 2 (lift)
  ['D', 2], ['G', 2], ['Em', 2], ['A', 2], // 32-39 release
]);

const arc = makeArc([[0, 0.14], [8, 0.3], [16, 0.72], [24, 0.92], [31.99, 0.88], [32, 0.5], [36, 0.3], [40, 0.14]], BARS);

// 16th step offsets (semitones from the chord root, -1 = rest): octave gallop
const BASS_A = [0, -1, 12, 0, -1, 12, 0, -1, 0, -1, 12, 0, -1, 7, 12, -1];
const BASS_B = [0, -1, 0, 12, -1, 0, -1, 12, 0, -1, 0, 12, -1, 7, -1, 12];
// which 16th steps the arp plays, in order of appearance as the level rises
const ARP_ORDER = [0, 6, 11, 3, 14, 8, 10, 5, 13, 2, 7, 15];
const ARP_SEQ = [0, 3, 5, 2, 6, 4, 7, 3, 1, 5, 2, 6];

// Lead events per bar: [beat, length in beats, midi]
const LEAD = {
  16: [[0, 1.5, 69], [2.5, 1.5, 76]], 17: [[1.5, 0.5, 78], [2.5, 1.5, 73]],
  18: [[0.5, 1.5, 71], [2.5, 1.5, 80]], 19: [[1, 2.5, 76]],
  20: [[0, 1, 67], [2, 1.5, 76]], 21: [[1.5, 0.5, 79], [2.5, 1.5, 74]],
  22: [[0.5, 1.5, 71], [2.5, 1.5, 79]], 23: [[1.5, 2.5, 74]],
  24: [[0, 1, 73], [1.5, 0.5, 78], [2.5, 1.5, 81]], 25: [[0.5, 3, 76]],
  26: [[0, 1, 71], [1.5, 0.5, 76], [2.5, 1.5, 83]], 27: [[1, 2.5, 80]],
  28: [[0, 1, 74], [1.5, 0.5, 79], [2.5, 1.5, 83]], 29: [[0.5, 2, 81], [3, 1, 74]],
  30: [[0, 1.5, 76], [2, 1, 81]], 31: [[1, 2.5, 83]],
  32: [[0.5, 2.5, 78]], 34: [[1.5, 2, 71]],
};

export function create(ac, out) {
  const fx = buildFx(ac, out, {
    bpm: BPM, trim: 0.74, revSec: 3.8, revBright: 0.55, revDark: 0.36, revRet: 0.66, tapeHz: 13000,
    delBeats: 0.75, delFb: 0.5, delLpL: 2500, delLpR: 2200, delRet: 0.6, arpDel: 0.55, leadDel: 0.45, padRev: 0.42,
  });
  const v = makeVoices(ac, fx);
  const inten = makeIntensity(ac, 0.7);
  const lv = (barPos) => 0.4 * inten.get() + 0.6 * arc(barPos);

  return {
    setIntensity: (x) => inten.set(x),
    scheduleBar(t0, bar, loop) {
      const rnd = mulberry32(0x7a1a55a ^ (bar * 7919 + loop * 104729));
      const jit = (ms) => (rnd() - 0.5) * 2 * ms * 0.001;
      const at = (x) => (x < t0 ? t0 : x);
      const e = lv(bar);
      const name = BAR_CHORD[bar];
      const ch = CH[name];
      const gPulse = smooth(e, 0.16, 0.1);

      // pad and drone per chord span
      const span = SPAN_AT[bar];
      if (span) {
        const eEnd = lv(bar + span);
        v.pad(t0, ch.pad, span * BAR, {
          vol: 0.045 * (0.5 + 0.7 * e), a: span > 1 ? 1.1 : 0.6, rel: 1.7, cutA: 420 * Math.pow(8, e), cutB: 420 * Math.pow(8, eEnd),
          q: 1.2, det: 9, sub: ch.sub, rnd,
        });
        v.drone(t0, ch.root, span * BAR, 0.02 + 0.03 * (1 - gPulse) + 0.02 * e, { a: 1.0, rel: 1.5 });
      }

      // gallop bass
      if (gPulse > 0.05) {
        const pat = bar % 2 ? BASS_B : BASS_A;
        const cutBase = 150 + 900 * e;
        for (let s = 0; s < 16; s++) {
          if (pat[s] < 0) continue;
          const pos = bar + s / 16;
          const slow = 1 + 0.3 * Math.sin((2 * Math.PI * pos) / 8) + 0.12 * Math.sin((2 * Math.PI * pos) / 3.7);
          const accent = s % 4 === 0 ? 1 : s % 2 === 0 ? 0.82 : 0.68;
          v.bass(at(t0 + s * BEAT / 4 + jit(2.5)), ch.root + pat[s], BEAT * 0.2, 0.15 * gPulse * (0.6 + 0.4 * e) * accent * (0.9 + rnd() * 0.2), cutBase * slow);
        }
      }

      // drums
      const gKick = smooth(e, 0.28, 0.08);
      if (gKick > 0.05) {
        for (let b = 0; b < 4; b++) v.kick(at(t0 + b * BEAT + jit(1.2)), gKick * (b === 0 ? 1 : 0.88) * (0.95 + rnd() * 0.1), { f1: 46, vol: 0.4 });
        if (e > 0.72 && bar % 2 === 1) v.kick(at(t0 + 3.5 * BEAT + jit(1.5)), 0.5 * gKick, { f1: 46, vol: 0.4 });
      }
      const gHat = smooth(e, 0.34, 0.08);
      if (gHat > 0.05) {
        const sw = 0.06 * BEAT;
        for (let b = 0; b < 4; b++) v.hat(at(t0 + (b + 0.5) * BEAT + sw + jit(3)), gHat * (b % 2 ? 0.85 : 0.7) * (0.85 + rnd() * 0.3), rnd, { vol: 0.17 });
        if (e > 0.72) for (let b = 0; b < 4; b++) v.hat(at(t0 + (b + 0.25) * BEAT + jit(3)), 0.32 * smooth(e, 0.72, 0.1), rnd, { vol: 0.17, hp: 8200, dur: 0.035 });
      }
      const gClap = smooth(e, 0.42, 0.08);
      if (gClap > 0.05) for (const b of [1, 3]) v.clap(at(t0 + b * BEAT + jit(2)), gClap * (0.92 + rnd() * 0.12), rnd, { f: 1650, vol: 0.9 });

      // arp: gated 16ths through the chord ladder
      const gArp = smooth(e, 0.3, 0.12);
      if (gArp > 0.05) {
        const lad = ladder(ch, 57, 84);
        const n = Math.round(lerp(3, 11, smooth(e, 0.3, 0.55)));
        const steps = ARP_ORDER.slice(0, n).sort((a, b) => a - b);
        steps.forEach((st, i) => {
          const m = lad[ARP_SEQ[(i + bar) % ARP_SEQ.length] % lad.length];
          v.arp(at(t0 + st * BEAT / 4 + (st % 2 ? 0.02 * BEAT : 0) + jit(3)), m, gArp * (st === 0 ? 1 : 0.8) * (0.85 + rnd() * 0.3), lv(bar + st / 16), { vol: 0.13, cutBase: 640, ratio: 6.2, dec: 0.2 });
        });
        // high sparkles into the delay
        if (e > 0.42 && bar % 2 === 0) {
          const hi = ladder(ch, 84, 96);
          v.arp(at(t0 + 1.5 * BEAT), hi[Math.floor(rnd() * hi.length)], 0.55 * gArp, 0.9, { vol: 0.09, cutBase: 1800, ratio: 2, dec: 0.55, types: [['triangle', 0], ['sine', 1200]] });
        }
      }

      // lead
      const ld = LEAD[bar];
      if (ld) {
        const gL = smooth(e, 0.5, 0.1);
        if (gL > 0.05) for (const [b, d, m] of ld) v.lead(at(t0 + b * BEAT + jit(6)), d * BEAT, m, 0.12 * gL, rnd, { cutA: 1200, cutB: 3200, cutC: 2000, beat: BEAT });
      }

      // riser into the loop point
      if (bar === BARS - 1) v.riser(t0, BAR * 0.98, { vol: 0.05, f0: 450, f1: 5200 });
    },
    dispose() { fx.dispose(); },
  };
}
export const LEAD_DEBUG = { lead: LEAD, names: BAR_CHORD }; export const CH_DEBUG = CH;

// Score tables, exported for offline checks
export const SCORE = { lead: LEAD, names: BAR_CHORD, chords: CH };
