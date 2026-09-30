// Style D victory sting: a short restrained resolution in the same sound. A minor to C major glow, 124 BPM, 6 bars, plays once.
// A pad swells open, a soft kick pulse joins for two bars, the bell states the motif once and the last chord rings out.
import { createRig } from './shared/rig.js';
import { makeChord, ladderPick, smooth } from './shared/util.js';

const BPM = 124, BARS = 6, BEAT = 60 / BPM, BAR = BEAT * 4, SD = BEAT / 4;

export const meta = {
  id: 'd-victory', name: 'Victory (melodic techno)', bpm: BPM, bars: BARS, loop: false, tail: 4,
  description: 'Short restrained resolution: a pad swell, a soft pulse and one statement of the bell motif.',
};

const C = (pc, kind) => makeChord(pc, kind, { bassLo: 36, padLo: 48 });
const CH = { F: C(5, 'M7'), C: C(0, 'M'), Am: C(9, 'm9'), G: C(7, 'M') };
const BAR_CHORD = ['F', 'F', 'C', 'G', 'Am', 'Am'];
const L = (ch, n, o = 12) => ladderPick(ch.pad, n) + o;
// the single motif statement (bars 2 and 3), then a long last note
const MOTIF = { 2: [[0, 4, 4], [6, 2, 4], [10, 3, 6]], 3: [[2, 5, 6], [10, 4, 6]], 4: [[0, 6, 16]] };

export function create(ac, out) {
  const rig = createRig(ac, out, { bpm: BPM, trim: 0.258, seed: 51, revSec: 4.4, revLevel: 0.36, duckDepth: 0.4, levels: { kick: 0.85, drums: 1, bass: 1.2, pad: 0.75, arp: 2, lead: 1.7 } });
  const KICK = { f0: 158, f1: 66, len: 0.46, drive: 1.8, click: 0.18 };
  return {
    scheduleBar(t0, bar) {
      const ch = CH[BAR_CHORD[bar]];
      const last = bar === BARS - 1;
      rig.sweep(t0, t0 + BAR, 900 * Math.pow(9, Math.min(1, bar / 3)), 900 * Math.pow(9, Math.min(1, (bar + 1) / 3)));
      if (bar !== 5) rig.chord(t0, [ch.bass + 12, ch.bass + 19, ...ch.pad, ch.pad[1] + 12], bar === 0 || bar === 4 ? BAR * (bar === 4 ? 2 : 1) : BAR, { vol: 0.06, cut: 500 + 500 * bar, env: 1, lpEnd: 1.4, atk: bar === 0 ? 1.6 : 0.8, rel: last ? 3 : 1.4, dec: BAR, group: 'pad', rev: 0.55, det: 13, lfo: true });
      if (bar >= 2 && bar <= 4) {
        const n = bar === 4 ? [0] : [0, 1, 2, 3];
        for (const b of n) { rig.kick(t0 + b * BEAT, bar === 4 ? 0.8 : 0.75 + 0.05 * b, KICK); rig.duck(t0 + b * BEAT, 0.4, BEAT * 0.7); }
        if (bar < 4) {
          const bs = rig.bass();
          for (let b = 0; b < 4; b++) bs.note(t0 + (b * 4 + 2) * SD, ch.bass, SD * 2.4, { vol: 0.14, cut: 260, env: 2, dec: 0.1, q: 1.6 });
          for (let s = 0; s < 16; s += 4) rig.hat(t0 + (s + 2) * SD, 0.6, 0.03, 7000, 0.1);
        }
      }
      if (bar >= 1 && bar <= 3) {
        const ar = rig.arp({}, { rev: 0.2, del: 0.4 });
        for (const [s, i] of [[0, 0], [2, 2], [4, 1], [6, 3], [8, 2], [10, 4], [12, 3], [14, 1]]) ar.note(t0 + s * SD, ladderPick(ch.pad, i) + 12, SD * 0.8, { vol: 0.06 * smooth(bar, 0.5, 1.5), vel: s % 4 ? 0.7 : 1, cut: 600 + 250 * bar, env: 2.2, dec: 0.15, q: 2 });
      }
      const ld = rig.lead({}, { rev: 0.5, del: 0.4 });
      for (const [s, i, len] of MOTIF[bar] || []) ld.note(t0 + s * SD, L(ch, i), len * SD, { vol: last || bar === 4 ? 0.07 : 0.08, cut: 2400, env: 1.2, dec: 0.3, rel: 1.6 });
      if (bar === 4) rig.boom(t0, 0.8, { f0: 70, f1: 30, len: 3, vol: 0.3 });
    },
    dispose() { rig.dispose(); },
  };
}
