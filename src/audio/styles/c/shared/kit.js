// Score helpers for style C tracks: note parsing and a small event compiler. A Score collects events per bar so the
// runtime in track.js only has to walk one array per bar (cheap). Beats are quarter notes from the start of the bar,
// or from the start of the phrase for phrase(), which may run across several bars.
const PC = { C: 0, 'C#': 1, Db: 1, D: 2, 'D#': 3, Eb: 3, E: 4, F: 5, 'F#': 6, Gb: 6, G: 7, 'G#': 8, Ab: 8, A: 9, 'A#': 10, Bb: 10, B: 11 };

/** 'F#4' -> 66 (C4 = 60). */
export function nn(s) {
  if (typeof s === 'number') return s;
  const m = /^([A-G][#b]?)(-?\d)$/.exec(s);
  if (!m) throw new Error('bad note ' + s);
  return 12 * (Number(m[2]) + 1) + PC[m[1]];
}
/** 'D4 F#4 A4' -> [62, 66, 69]. */
export const nv = (str) => (Array.isArray(str) ? str : str.trim().split(/\s+/)).map(nn);

export class Score {
  constructor(bars) {
    this.bars = bars;
    this.ev = Array.from({ length: bars }, () => []);
    this.pads = new Map();   // startBar -> { bars, midis, level, layer }
    this.basses = new Map(); // startBar -> { bars, midi, level, layer }
  }

  /** One event: kind, bar, beat in bar, dur in beats, midi (or name), velocity 0..1, extra options. */
  add(k, bar, beat, d, m, v = 1, o = null) {
    let b = bar + Math.floor(beat / 4); const bt = beat - Math.floor(beat / 4) * 4;
    if (b < 0 || b >= this.bars) throw new Error(`event out of range: ${k} bar ${bar} beat ${beat}`);
    this.ev[b].push({ k, b: bt, d, m: m == null ? null : nn(m), v, o });
    return this;
  }

  /** phrase(kind, startBar, [[beat, dur, note, vel?, opts?]...], opts). Note '_' is a rest. Beats count from startBar. */
  phrase(k, bar, notes, o = null) {
    for (const [beat, d, m, v = 1, oo] of notes) {
      if (m === '_') continue;
      if (Array.isArray(m)) { for (const mm of m) this.add(k, bar, beat, d, mm, v, oo || o ? { ...o, ...oo } : null); } else this.add(k, bar, beat, d, m, v, oo || o ? { ...o, ...oo } : null);
    }
    return this;
  }

  /** Sustained chord run over `bars` bars. level 0..1 (or per bar array). */
  pad(bar, bars, voicing, level = 1, layer = 'pad', o = null) { this.pads.set(bar, { bars, midis: nv(voicing), level, layer, o }); return this; }
  /** Bass pedal over `bars` bars. */
  bass(bar, bars, note, level = 1, layer = 'bass', o = null) { this.basses.set(bar, { bars, midi: nn(note), level, layer, o }); return this; }

  /**
   * Repeating pattern of one kind over bars [from, to]. rootFn(bar) gives a midi root (or a lookup array/object).
   * slots: entries per bar (step = 4 / slots.length beats), each null, a semitone offset or [offset, vel].
   * Optional dur (beats) per event.
   */
  pat(k, from, to, root, slots, { dur = 0.25, vel = 1, opts = null } = {}) {
    const n = slots.length;
    for (let b = from; b <= to; b++) {
      const r = nn(typeof root === 'function' ? root(b) : Array.isArray(root) ? root[b] : root);
      for (let i = 0; i < n; i++) {
        const s = slots[i]; if (s == null) continue;
        const [off, v] = Array.isArray(s) ? s : [s, 1];
        this.add(k, b, (i * 4) / n, dur, r + off, v * vel, opts);
      }
    }
    return this;
  }

  hit(bar, beat, note, vel = 0.7) { return this.add('timp', bar, beat, 0.5, note, vel); }
  roll(bar, beat, len, note, v0 = 0.2, v1 = 0.8) { return this.add('roll', bar, beat, len, note, 1, { v0, v1 }); }
  riser(bar, bars, vol = 1) { return this.add('riser', bar, 0, bars * 4, null, vol); }
  crash(bar, beat = 0, vol = 1) { return this.add('crash', bar, beat, 3, null, vol); }
  tam(bar, beat = 0, vol = 1) { return this.add('tam', bar, beat, 6, null, vol); }
}

/** Expand a per bar chord-root list from runs: roots('G2', 2, 'D2', 2 ...) -> array of midi, one per bar. */
export function expand(list) {
  const out = [];
  for (let i = 0; i < list.length; i += 2) for (let k = 0; k < list[i + 1]; k++) out.push(nn(list[i]));
  return out;
}
