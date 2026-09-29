// Title variant C: "Restrained orchestral". D minor, 84 BPM, 40 bars. A solo horn states a four note motif (a fourth up,
// a step up, a third down), the orchestra grows around it (ostinato, strings, timpani), the strings take it at the peak and the
// piece breathes out into bar 0 again. No drum kit, no arpeggio. See c/score.js for the bar by bar plan and c/voices.js
// for the instruments (all procedural WebAudio).
import { BPM, BARS, CHORDS, CHORD_DEFS, INT, MEL, AUG, TIMP, RISERS, CRASHES, ostMask, violaPulse, padLevel, bassLevel, pluckSpec, noteName } from './c/score.js';
import { createVoices, mulberry32, near } from './c/voices.js';

export const meta = {
  id: 'c',
  name: 'Restrained orchestral',
  description: 'Understated D minor space theme: solo horn motif, staccato low string ostinato, strings and timpani building to one tasteful climax, then a quiet release into a seamless loop.',
  bpm: BPM,
  bars: BARS,
};

const BEAT = 60 / BPM;
const BAR = 4 * BEAT;
// Level of a part at intensity v: `hi` at v = 1, falling `range` dB towards v = 0.
const mulHook = () => globalThis.__TITLE_C_MUL || null; // optional test hook: per part gain multipliers (stems)
const lvl = (key, v) => {
  const [hi, range] = LV[key];
  return hi * Math.pow(10, (-(1 - v) * range) / 20) * (mulHook()?.[key] ?? 1);
};

// Output level table (linear). Tuned by measurement so the piece peaks around 0.4 on its own.
const LV = {
  horn: [0.13, 14],
  hornPeak: 0.15,
  vln: [0.34, 20],
  vla: [0.26, 20],
  pad: [0.38, 24],
  bass: [0.085, 20],
  ost: [0.11, 24],
  pulse: [0.06, 24],
  pluck: [0.06, 16],
  timp: 0.2,
  riser: 0.03,
  crash: 0.02,
};

export function create(ac, out) {
  const V = createVoices(ac, out, { barDur: BAR });
  const dbg = globalThis.__TITLE_C_LOG; // optional test hook: array that receives scheduled note events
  const log = (bar, kind, beat, midi, extra) => { if (dbg) dbg.push({ bar, kind, beat, midi, name: midi != null ? noteName(midi) : null, ...extra }); };

  // Pad voicings per chord run (voice led): a run is consecutive bars with the same chord.
  const runs = new Map(); // startBar -> { bars, midis, root }
  {
    let prev = [55, 62, 66, 72];
    for (let b = 0; b < BARS;) {
      let e = b + 1;
      while (e < BARS && CHORDS[e] === CHORDS[b]) e++;
      const pcs = CHORD_DEFS[CHORDS[b]];
      const midis = pcs.map((pc, i) => {
        let m = near(pc, prev[i]);
        const lo = [50, 57, 62, 67][i], hi = [62, 69, 74, 79][i];
        while (m < lo) m += 12;
        while (m > hi) m -= 12;
        return m;
      });
      prev = midis;
      let root = near(pcs[0], 40);
      while (root < 34) root += 12;
      while (root > 45) root -= 12;
      runs.set(b, { bars: e - b, midis, root });
      b = e;
    }
  }

  const bassRoot = (bar) => {
    let m = near(CHORD_DEFS[CHORDS[bar]][0], 40);
    while (m < 34) m += 12;
    while (m > 45) m -= 12;
    return m;
  };
  const timpMidi = (bar) => {
    let m = near(CHORD_DEFS[CHORDS[bar]][0], 40);
    while (m < 36) m += 12;
    while (m > 47) m -= 12;
    return m;
  };

  return {
    scheduleBar(t0, bar, loop) {
      const rng = mulberry32(bar * 977 + loop * 131 + 7);
      const jit = (max) => rng() * max;
      const vari = () => 0.92 + rng() * 0.16;
      const v = INT[bar];
      const chord = CHORD_DEFS[CHORDS[bar]];

      // Brightness of the string bus follows the arc.
      V.setBrightness(t0, 1500 + 3300 * v, 0.5);

      // Chord run start: pad and bass pedal.
      const run = runs.get(bar);
      if (run) {
        const amps = [], bamps = [];
        for (let i = 0; i < run.bars; i++) {
          const b = bar + i;
          amps.push(lvl('pad', INT[b]) * padLevel(b));
          bamps.push(lvl('bass', INT[b]) * bassLevel(b));
        }
        if (amps.some((a) => a > 0)) {
          V.padRun(t0 + 0.01, run.bars, run.midis, amps.map((a) => Math.max(a, 0)));
          log(bar, 'pad', 0, run.midis[0], { bars: run.bars });
        }
        if (bamps.some((a) => a > 0)) {
          V.bassRun(t0 + 0.005, run.bars, bassRoot(bar), bamps);
          log(bar, 'bass', 0, bassRoot(bar), { bars: run.bars });
        }
      }

      // Melody: horn leads, violins double from bar 16, strings take over at the peak.
      const peak = bar >= 24 && bar <= 31;
      for (const [b, d, m] of MEL[bar]) {
        const t = t0 + b * BEAT + jit(0.014);
        const dur = d * BEAT * 0.97;
        const vel = vari();
        if (!peak) {
          V.horn(t, dur, m, lvl('horn', v) * vel, { beat: BEAT, bright: 0.25 + 0.6 * v, attack: bar < 2 ? 0.28 : 0.2 });
          log(bar, 'melody', b, m, { dur: d, voice: 'horn' });
        } else {
          V.horn(t, dur, m - 12, lvl('horn', v) * LV.hornPeak * vel * 2, { beat: BEAT, bright: 0.8, attack: 0.16 });
          V.strings(t + jit(0.01), dur, m, lvl('vln', v) * vel, { beat: BEAT, attack: 0.09, pan: -0.25, vib: 9 });
          V.strings(t + jit(0.01), dur, m - 12, lvl('vla', v) * vel, { beat: BEAT, attack: 0.11, pan: 0.25, vib: 8 });
          log(bar, 'melody', b, m, { dur: d, voice: 'violins+violas+horn' });
        }
        if (bar >= 16 && bar <= 23) {
          const mv = m >= 73 ? m : m + 12;
          V.strings(t + jit(0.01), dur, mv, lvl('vln', v) * 0.55 * vel, { beat: BEAT, attack: 0.12, pan: -0.2, vib: 7 });
          log(bar, 'double', b, mv, { dur: d, voice: 'violins' });
        }
      }

      // Augmentation of the motif on a low horn.
      if (AUG[bar]) {
        for (const [b, d, m] of AUG[bar]) {
          V.horn(t0 + b * BEAT + jit(0.01), d * BEAT * 0.98, m, lvl('horn', v) * 0.45, { beat: BEAT, bright: 0.5, attack: 0.25 });
          log(bar, 'augmentation', b, m, { dur: d, voice: 'low horn' });
        }
      }

      // Low string ostinato (staccato 8ths) on root and fifth.
      const mask = ostMask(bar);
      if (mask) {
        let root = near(chord[0], 47);
        while (root < 42) root += 12;
        while (root > 53) root -= 12;
        for (let i = 0; i < 8; i++) {
          if (!mask[i]) continue;
          const accent = i === 0 ? 1 : i === 4 ? 0.85 : (i % 2 ? 0.55 : 0.7);
          const m = i === 2 || i === 6 ? root + 7 : root;
          V.ostinato(t0 + i * BEAT / 2 + jit(0.009), m, lvl('ost', v) * accent * vari(), 0.2 + 0.7 * v);
          log(bar, 'ostinato', i / 2, m);
        }
      }

      // Viola off beat pulse.
      if (violaPulse(bar)) {
        const m = near(chord[2], 66);
        for (let i = 1; i < 8; i += 2) {
          V.spiccato(t0 + i * BEAT / 2 + jit(0.009), m, lvl('pulse', v) * vari(), 0.3);
          log(bar, 'pulse', i / 2, m);
        }
      }

      // Harp plucks.
      for (const [b, idx, target, vel] of pluckSpec(bar)) {
        const m = near(chord[idx], target);
        V.pluck(t0 + b * BEAT + jit(0.012), m, lvl('pluck', v) * vel * vari(), (rng() - 0.5) * 0.9);
        log(bar, 'pluck', b, m);
      }

      // Timpani.
      for (const e of TIMP[bar] || []) {
        const m = timpMidi(bar);
        if (e.k === 'hit') {
          V.timpani(t0 + e.b * BEAT + jit(0.006), m, LV.timp * (mulHook()?.timp ?? 1) * e.v * vari(), 0.6 + 0.6 * e.v);
          log(bar, 'timpani', e.b, m, { v: e.v });
        } else {
          const n = Math.round((e.len * BEAT) / 0.085);
          for (let i = 0; i < n; i++) {
            const k = i / (n - 1);
            const vel = e.v0 * Math.pow(e.v1 / e.v0, k);
            V.timpani(t0 + e.b * BEAT + i * 0.085 + jit(0.008), m, LV.timp * (mulHook()?.timp ?? 1) * vel * 0.8 * vari(), 0.35);
          }
          log(bar, 'timpani-roll', e.b, m, { len: e.len });
        }
      }

      // Noise swells and crashes.
      for (const r of RISERS) {
        if (r.bar === bar) { V.riser(t0, r.bars * BAR, LV.riser * (mulHook()?.riser ?? 1) * r.vol, 0.31 + bar * 0.013); log(bar, 'riser', 0, null); }
      }
      for (const c of CRASHES) {
        if (c.bar === bar) { V.crash(t0 + 0.004, LV.crash * (mulHook()?.riser ?? 1) * c.vol, 0.71 + bar * 0.007); log(bar, 'crash', 0, null); }
      }
    },
    dispose() { V.dispose(); },
  };
}
