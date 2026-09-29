// Song data and compiler. Melodies use a tiny DSL:
//   "degree/steps" tokens separated by spaces, 16 steps per bar (a step is a 16th note).
//   degree: 1..7 scale degree, "+" or "-" prefix shifts octaves, "b"/"#" flats or sharps a degree,
//   "sN" is an absolute semitone offset from the tonic, "r" is a rest.
//   Example: "5/4 +1/4 +3/2 +2/2 +1/4" is one bar.
// Chords are plain names (D, Bm, F#m, Bb, G7 ...) and are voice led across the whole progression.

const PC = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
const SCALES = {
  major: [0, 2, 4, 5, 7, 9, 11],
  minor: [0, 2, 3, 5, 7, 8, 10],
  harmonic: [0, 2, 3, 5, 7, 8, 11],
};
const CHORD_Q = {
  '': [0, 4, 7], m: [0, 3, 7], dim: [0, 3, 6], sus4: [0, 5, 7], sus2: [0, 2, 7],
  7: [0, 4, 7, 10], m7: [0, 3, 7, 10], maj7: [0, 4, 7, 11], add9: [0, 4, 7, 14],
};

export function notePc(name) {
  const m = /^([A-G])([b#]?)$/.exec(name);
  if (!m) throw new Error('bad note ' + name);
  return (PC[m[1]] + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0) + 12) % 12;
}

export function parseChord(name) {
  const m = /^([A-G][b#]?)(.*)$/.exec(name);
  if (!m || !CHORD_Q[m[2]]) throw new Error('bad chord ' + name);
  const root = notePc(m[1]);
  const iv = CHORD_Q[m[2]];
  return { name, root, pcs: iv.map((i) => (root + i) % 12), intervals: iv };
}

/** Voice lead a progression: each chord gets the voicing that moves least from the previous one. */
export function voiceLead(chords, center = 62) {
  const out = [];
  let prev = null;
  for (const c of chords) {
    let best = null;
    // candidate voicings: choose an octave placement for each pitch class in [center-9, center+9]
    const opts = c.pcs.map((pc) => {
      const cands = [];
      for (let m = center - 12; m <= center + 12; m++) if (((m % 12) + 12) % 12 === pc) cands.push(m);
      return cands;
    });
    const rec = (i, cur) => {
      if (i === opts.length) {
        const s = [...cur].sort((a, b) => a - b);
        let cost = 0;
        if (prev) {
          const pm = prev.reduce((a, b) => a + b, 0) / prev.length;
          const cm = s.reduce((a, b) => a + b, 0) / s.length;
          cost += Math.abs(pm - cm) * 3;
          for (let k = 0; k < Math.min(s.length, prev.length); k++) cost += Math.abs(s[k] - prev[k]);
        } else cost += Math.abs(s[0] - (center - 7));
        cost += (s[s.length - 1] - s[0] > 12 ? 8 : 0) + Math.abs(s.reduce((a, b) => a + b, 0) / s.length - center) * 0.5;
        if (!best || cost < best.cost) best = { cost, v: s };
        return;
      }
      for (const m of opts[i]) rec(i + 1, [...cur, m]);
    };
    rec(0, []);
    prev = best.v;
    out.push(best.v);
  }
  return out;
}

export function parseMel(str, tonic, scale) {
  const notes = [];
  let step = 0;
  for (const tok of str.trim().split(/\s+/)) {
    if (!tok) continue;
    const [n, d] = tok.split('/');
    const dur = parseInt(d, 10);
    if (!(dur > 0)) throw new Error('bad token ' + tok);
    if (n !== 'r') {
      const m = /^([+-]*)(?:s(-?\d+)|([b#]?)([1-7]))$/.exec(n);
      if (!m) throw new Error('bad note token ' + tok);
      const oct = (m[1].match(/\+/g) || []).length - (m[1].match(/-/g) || []).length;
      let midi;
      if (m[2] !== undefined) midi = tonic + parseInt(m[2], 10) + oct * 12;
      else midi = tonic + SCALES[scale][parseInt(m[4], 10) - 1] + (m[3] === '#' ? 1 : m[3] === 'b' ? -1 : 0) + oct * 12;
      notes.push({ step, dur, midi });
    }
    step += dur;
  }
  return { notes, steps: step };
}

// ==== drum kits
export const DRUMS = {
  none: { kick: '', snare: '', hat: '' },
  rock: { kick: 'x.....x.x.x.....', snare: '....x.......x...', hat: 'x.x.x.x.x.x.x.x.' },
  gallop: { kick: 'x..x..x...x..x..', snare: '....x.......x...', hat: 'x.x.x.x.x.x.x.o.' },
  foundry: { kick: 'x.......x...x...', snare: '........x.......', hat: '..x...x...x...x.' },
  boss: { kick: 'x..x..x.x..x..x.', snare: '....x.......x...', hat: 'xxxxxxxxxxxxxxxx' },
  fanfare: { kick: 'x.....x.x.......', snare: '....x.......x.xx', hat: 'x.x.x.x.x.x.x.x.' },
};

const BASS = {
  drive: 'r.r.o.r.r.r.o.r.',
  gallop: 'r.rrr.rrr.rrr.rr',
  pulse: 'rrrrrrrrrrrrrrrr',
  sus: 'r...............',
  half: 'r.......r.......',
  boss: 'rrorrorrrrorrorr',
  march: 'r.r.r.r.r.r.r.f.',
};

// ==== songs
const L = (...bars) => bars.join(' ');

export const SONG_DEFS = {
  thalassa: {
    bpm: 142, key: 'D', mode: 'major', loop: true, leadStyle: 'brass', padStyle: 'strings',
    delay: { time: 0.4225, fb: 0.3, wet: 0.2 },
    sections: [
      {
        chords: 'D A Bm G D A G A', bass: 'drive', drums: 'rock', arp: '0123432101234321', stab: 'x..x..x.x..x....',
        lead: L('+1/2 7/2 6/4 5/4 3/4', '5/6 6/2 7/4 +1/4', '+2/4 +1/2 7/2 6/4 +1/4', '+1/6 6/2 5/4 4/4',
          'r/4 3/4 5/4 6/4', '7/6 5/2 3/4 5/4', '4/4 6/4 +1/4 6/2 5/2', '7/6 +1/2 7/4 5/4'),
      },
      {
        chords: 'G A Bm F#m G D A A', bass: 'drive', drums: 'rock', arp: '0121212301212123', stab: 'x.......x.......',
        lead: L('+1/4 6/4 4/4 6/4', '7/4 +1/2 +2/2 7/4 5/4', '+3/6 +2/2 +1/4 6/4', '+1/4 7/4 5/4 3/4',
          '4/6 6/2 +1/4 +2/4', '+3/4 +1/4 6/4 5/4', '5/4 7/4 +1/4 7/4', '5/8 r/4 7/2 5/2'),
      },
    ],
  },

  cinder: {
    bpm: 152, key: 'E', mode: 'minor', loop: true, leadStyle: 'square', padStyle: 'space',
    delay: { time: 0.3947, fb: 0.42, wet: 0.3 },
    layers: { arp: 0.15 },
    sections: [
      {
        chords: 'Em C G D Em C B B', bass: 'gallop', drums: 'gallop', arp: '0123123423453210', stab: 'x.......x.....x.',
        lead: L('5/3 5/3 +1/2 +2/3 +1/2 7/3', '6/3 6/3 +1/2 +3/3 +2/2 +1/3', '+3/3 +3/3 +2/2 +1/3 7/2 5/3', '+2/4 +1/4 7/4 6/4',
          '+5/3 +5/3 +3/2 +2/3 +1/2 +2/3', '+3/3 +3/3 +1/2 6/3 +1/2 +3/3', '#7/3 #7/3 +1/2 +2/3 +1/2 #7/3', '+2/8 r/2 +3/2 +2/2 #7/2'),
      },
      {
        chords: 'Am Em C D Am B Em B', bass: 'gallop', drums: 'gallop', arp: '0123123423453210', stab: 'x.......x.....x.',
        lead: L('+1/4 6/4 +1/4 +3/4', '+2/4 +1/4 7/4 5/4', '+1/4 6/4 +3/4 +5/4', '+4/4 +3/4 +2/4 +1/4',
          '+1/3 +1/3 +3/2 +4/3 +3/2 +1/3', '#7/3 #7/3 +2/2 +4/3 +3/2 +2/3', '+3/4 +2/4 +1/4 5/4', '#7/6 r/2 #7/2 +1/2 +2/2 #7/2'),
      },
    ],
  },

  foundry: {
    bpm: 118, key: 'D', mode: 'minor', loop: true, leadStyle: 'brass', padStyle: 'strings',
    delay: { time: 0.5085, fb: 0.4, wet: 0.24 },
    layers: { kick: 0.1, snare: 0.1, arp: 0.5, stab: 0.3 },
    sections: [
      {
        chords: 'Dm Dm Bb A Dm Gm Eb A', bass: 'pulse', drums: 'foundry', arp: '0.1.2.1.0.1.2.1.', stab: 'x.......x.....x.',
        lead: L('5/6 6/2 5/4 3/4', '+1/8 7/4 6/4', '6/6 5/2 3/4 5/4', '#7/6 6/2 5/8',
          '+1/4 +3/4 +2/4 +1/4', '6/4 +1/4 7/4 6/4', '+b2/6 +1/2 6/4 5/4', '5/4 #7/4 +2/4 +1/4'),
      },
      {
        chords: 'Dm Bb Gm A Dm Bb A A', bass: 'pulse', drums: 'foundry', arp: '0.1.2.1.0.1.2.1.', stab: 'x.x.....x.....x.',
        lead: L('+1/4 r/2 +1/2 +3/4 +2/4', '6/4 +1/4 +3/4 +2/4', '+1/8 6/4 5/4', '#7/4 +2/4 +3/4 +2/4',
          '+1/4 +5/4 +4/4 +3/4', '+3/4 +2/4 +1/4 6/4', '#7/4 +2/4 +1/4 #7/4', '5/8 #7/4 +2/4'),
      },
    ],
  },

  boss: {
    bpm: 172, key: 'C', mode: 'minor', loop: true, leadStyle: 'brass', padStyle: 'strings', fixed: 1,
    delay: { time: 0.3488, fb: 0.28, wet: 0.16 },
    sections: [
      {
        chords: 'Cm Ab Bb G Cm Ab Fm G', bass: 'boss', drums: 'boss', arp: '0123432101234321', stab: 'x..x..x.x..x..x.',
        lead: L('+1/2 r/2 +1/2 r/2 +3/2 +2/2 +1/2 7/2', '6/2 +1/2 +3/2 +5/2 +3/2 +1/2 6/2 +1/2',
          '7/2 +2/2 +4/2 +2/2 7/2 5/2 7/2 +2/2', 's7/2 s8/2 s9/2 s10/2 s11/2 s12/2 s13/2 s14/2',
          '+1/4 +3/2 +2/2 +1/2 7/2 6/4', '+3/4 +1/4 6/4 +1/2 +3/2', '+4/4 +3/2 +2/2 +1/4 6/4',
          's14/2 s13/2 s12/2 s11/2 s10/2 s9/2 s8/2 s7/2'),
      },
      {
        chords: 'Cm Cm Ab Bb Cm Fm G G', bass: 'boss', drums: 'boss', arp: '0123432101234321', stab: 'x.x.x.x.x.x.x.xx',
        lead: L('+1/2 +1/2 r/2 +1/2 +3/2 r/2 +2/2 +1/2', '7/2 7/2 r/2 7/2 +2/2 r/2 +1/2 7/2', '6/4 +1/4 +3/4 +5/4',
          '7/4 +2/4 +4/4 +2/4', '+1/2 +1/2 r/2 +1/2 +3/2 r/2 +5/2 +3/2', '+4/4 +3/2 +2/2 +1/4 6/4',
          '5/2 #7/2 +2/2 +4/2 +2/2 #7/2 5/2 #7/2', 's7/2 s8/2 s9/2 s10/2 s11/2 s12/2 s13/2 s14/2'),
      },
    ],
  },

  victory: {
    bpm: 132, key: 'G', mode: 'major', loop: false, leadStyle: 'brass', padStyle: 'strings', fixed: 1,
    delay: { time: 0.4545, fb: 0.3, wet: 0.2 },
    sections: [
      {
        chords: 'G C D G Em C D G', bass: 'march', drums: 'fanfare', arp: '0123432101234321', stab: 'x..x..x.x.......',
        lead: L('1/4 3/4 5/4 +1/4', '+1/6 +2/2 +1/4 6/4', '5/4 6/4 7/4 +2/4', '+1/8 3/4 5/4',
          '6/4 +1/4 +3/4 +2/4', '+1/4 +2/4 +3/4 +5/4', '+2/4 +1/4 7/4 +2/4', '+1/16'),
      },
    ],
  },

  gameover: {
    bpm: 68, key: 'D', mode: 'minor', loop: false, leadStyle: 'strings', padStyle: 'strings', fixed: 0.3,
    delay: { time: 0.88, fb: 0.35, wet: 0.3 },
    layers: { hat: 9, kick: 9, snare: 9, arp: 9, stab: 9, bass: 0 },
    sections: [
      {
        chords: 'Dm Bb A Dm', bass: 'sus', drums: 'none', arp: null, stab: null,
        lead: L('+3/8 +2/4 +1/4', '+1/8 6/8', '#7/8 5/8', '+2/4 +1/12'),
      },
    ],
  },
};

const DEFAULT_LAYERS = { pad: 0, bass: 0, lead: 0, hat: 0.12, kick: 0.2, snare: 0.2, arp: 0.3, stab: 0.5, crash: 0.4, sparkle: 0.8 };

export function compileSong(name, def = SONG_DEFS[name]) {
  if (!def) throw new Error('unknown song ' + name);
  const tonic = 60 + notePc(def.key);
  const stepDur = 60 / def.bpm / 4;
  const sections = def.sections.map((s, si) => {
    const chords = s.chords.split(/\s+/).map(parseChord);
    const mel = parseMel(s.lead, tonic, def.mode);
    if (mel.steps !== chords.length * 16) throw new Error(`${name} section ${si}: lead is ${mel.steps} steps, expected ${chords.length * 16}`);
    const leadByBar = chords.map(() => []);
    for (const n of mel.notes) leadByBar[Math.floor(n.step / 16)].push({ ...n, step: n.step % 16 });
    return { ...s, chords, leadByBar, bars: chords.length, bassPat: BASS[s.bass] || s.bass, kit: DRUMS[s.drums] || DRUMS.none, arpPat: s.arp || '', stabPat: s.stab || '' };
  });
  // voice lead across the whole song, wrapping
  const all = sections.flatMap((s) => s.chords);
  const voic = voiceLead(all, 62);
  let k = 0;
  for (const s of sections) { s.voicings = voic.slice(k, k + s.bars); k += s.bars; }
  return {
    name, bpm: def.bpm, tonic, stepDur, barDur: stepDur * 16, loop: def.loop, sections,
    leadStyle: def.leadStyle, padStyle: def.padStyle, fixed: def.fixed, delay: def.delay,
    layers: { ...DEFAULT_LAYERS, ...(def.layers || {}) },
    totalBars: sections.reduce((a, s) => a + s.bars, 0),
  };
}

export const SONG_NAMES = Object.keys(SONG_DEFS);
