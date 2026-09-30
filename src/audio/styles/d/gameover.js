// Style D game over sting: the groove loses its air. D minor, 122 BPM, 6 bars, plays once.
// The filter closes, the kick thins out to half time and stops, a last pluck falls away and one low dark chord rings out.
import { createRig } from './shared/rig.js';
import { makeChord, ladderPick } from './shared/util.js';

const BPM = 122, BARS = 6, BEAT = 60 / BPM, BAR = BEAT * 4, SD = BEAT / 4;

export const meta = {
  id: 'd-gameover', name: 'Game over (melodic techno)', bpm: BPM, bars: BARS, loop: false, tail: 4.2,
  description: 'Short dark sting: the filter closes, the kick thins out and one low chord rings out.',
};

const C = (pc, kind) => makeChord(pc, kind, { bassLo: 36, padLo: 48 });
const CH = { Dm: C(2, 'm'), Bb: C(10, 'M'), Gm: C(7, 'm') };
const BAR_CHORD = ['Dm', 'Bb', 'Gm', 'Dm', 'Dm', 'Dm'];
const LPV = [9000, 4200, 1800, 700, 400, 400];

export function create(ac, out) {
  const rig = createRig(ac, out, { bpm: BPM, trim: 0.2, seed: 61, revSec: 4.6, revLevel: 0.36, duckDepth: 0.4, levels: { kick: 0.9, drums: 1, bass: 1.2, pad: 0.7, arp: 2, lead: 1.5 } });
  const KICK = { f0: 152, f1: 60, len: 0.5, drive: 1.9, click: 0.16 };
  return {
    scheduleBar(t0, bar) {
      const ch = CH[BAR_CHORD[bar]];
      rig.sweep(t0, t0 + BAR, LPV[bar], LPV[Math.min(BARS - 1, bar + 1)]);
      if (bar < 2) {
        for (let b = 0; b < 4; b++) { rig.kick(t0 + b * BEAT, 1, KICK); rig.duck(t0 + b * BEAT, 0.4, BEAT * 0.7); }
        for (let s = 2; s < 16; s += 4) rig.oh(t0 + s * SD, 0.7 - 0.2 * bar, 0.2, 0.1);
        const bs = rig.bass();
        for (let s = 0; s < 16; s++) if ('.rrf.rrr.rfr.rrf'[s] !== '.') bs.note(t0 + s * SD, ch.bass + ('.rrf.rrr.rfr.rrf'[s] === 'f' ? 7 : 0), SD * 0.66, { vol: 0.14, cut: 300 - 60 * bar, env: 2, dec: 0.1, q: 1.6 });
      } else if (bar === 2) {
        for (const b of [0, 2]) { rig.kick(t0 + b * BEAT, 0.9, KICK); rig.duck(t0 + b * BEAT, 0.45, BEAT * 0.9); }
        rig.tom(t0 + 3 * BEAT, 84, 0.8, 0.45, 0.22);
      } else if (bar === 3) {
        rig.kick(t0, 0.8, { ...KICK, len: 0.6, f1: 52 }); rig.duck(t0, 0.5, BEAT);
      }
      if (bar < 3) {
        const ar = rig.arp({ q: 2 }, { rev: 0.25, del: 0.4 });
        const pat = [[0, 3], [3, 2], [6, 1], [8, 2], [11, 1], [14, 0]];
        for (const [s, i] of pat) ar.note(t0 + s * SD, ladderPick(ch.pad, i) + 12, SD * 0.9, { vol: 0.07 * (1 - bar * 0.25), cut: 700 - 150 * bar, env: 2, dec: 0.16, q: 2 });
      }
      if (bar < 3) rig.chord(t0, [ch.bass + 12, ...ch.pad], BAR, { vol: 0.055, cut: 500, env: 1, atk: 0.6, rel: 1.2, dec: BAR, group: 'pad', rev: 0.5, det: 13, lfo: true });
      if (bar === 3) {
        rig.boom(t0 + BEAT * 1.5, 1, { f0: 60, f1: 27, len: 3.4, vol: 0.4 });
        rig.chord(t0 + BEAT * 1.5, [ch.bass, ch.bass + 7, ch.bass + 12, ch.pad[1]], 3.2, { vol: 0.08, cut: 420, env: 2, dec: 3, atk: 0.02, rel: 3.2, group: 'pad', rev: 0.6, det: 14, lfo: true, lpEnd: 0.5 });
      }
    },
    dispose() { rig.dispose(); },
  };
}
