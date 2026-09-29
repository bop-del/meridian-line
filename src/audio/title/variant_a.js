// Title variant A, "Cinematic drift": a restrained film-trailer space theme. D dorian with a borrowed Bb, 72 BPM,
// 32 bars (about 107 s). Detuned saw string pads, a slow sine sub, one distant horn on wide intervals, sparse FM
// plucks into long delay tails, air and reversed-cymbal risers, a heartbeat tom and soft timpani. All procedural.
import {
  BPM, BARS, INTENSITY, PAD_SEGS, BASS_SEGS, HORN, PIANO, HEART, TIMPANI, RISERS, TIMP_SWELLS, AIR,
} from './a/score.js';
import {
  mulberry32, makeImpulse, padNote, subNote, hornNote, fmPluck, heartbeat, timpani, noiseBand, ceilingCurve,
} from './a/voices.js';

export const meta = {
  id: 'a',
  name: 'Cinematic drift',
  description: 'Slow D dorian film-trailer drift: detuned string pads, deep sub, one distant horn on wide intervals, sparse FM plucks and a single restrained peak.',
  bpm: BPM,
  bars: BARS,
};

const BEAT = 60 / BPM;
const BAR = BEAT * 4;
const TRIM = 0.47; // overall level, measured so the output stays well under 0.5

// Index score events by bar once at load time.
const byBar = (list, key = (e) => (Array.isArray(e) ? e[0] : e.bar)) => {
  const m = new Map();
  for (const e of list) { const k = key(e); if (!m.has(k)) m.set(k, []); m.get(k).push(e); }
  return m;
};
const PAD_AT = byBar(PAD_SEGS);
const BASS_AT = byBar(BASS_SEGS);
const HORN_AT = byBar(HORN);
const PIANO_AT = byBar(PIANO);
const HEART_AT = byBar(HEART);
const TIMP_AT = byBar(TIMPANI);
const RISER_AT = byBar(RISERS);
const SWELL_AT = byBar(TIMP_SWELLS);
const AIR_AT = byBar(AIR);

const swellGain = (i) => 0.22 + 0.78 * Math.pow(i, 1.4);
const padCutoff = (i) => 340 + 1900 * i;

export function create(ac, out) {
  let disposed = false;
  const nodes = [];
  const mk = (n) => { nodes.push(n); return n; };
  const gain = (v) => { const g = mk(ac.createGain()); g.gain.value = v; return g; };
  const filt = (type, f, q = 0.7) => { const b = mk(ac.createBiquadFilter()); b.type = type; b.frequency.value = f; b.Q.value = q; return b; };

  // Master: mix -> trim -> soft ceiling (safety, linear below 0.35) -> out
  const mix = gain(1);
  const trim = gain(TRIM);
  const ceil = mk(ac.createWaveShaper());
  ceil.curve = ceilingCurve();
  ceil.oversample = '2x';
  mix.connect(trim); trim.connect(ceil); ceil.connect(out);

  // Convolution reverb: generated 4.2 s stereo noise impulse with exponential decay
  const reverb = mk(ac.createConvolver());
  reverb.buffer = makeImpulse(ac, 4.2);
  const revIn = gain(1);
  const revHp = filt('highpass', 180, 0.5);
  const revLp = filt('lowpass', 7000, 0.5);
  const revOut = gain(0.9);
  revIn.connect(revHp); revHp.connect(revLp); revLp.connect(reverb); reverb.connect(revOut); revOut.connect(mix);

  // Ping-pong delay, dotted eighth against a dotted quarter, darkened in the feedback path
  const dlyIn = gain(1);
  const dL = mk(ac.createDelay(4)); dL.delayTime.value = BEAT * 0.75;
  const dR = mk(ac.createDelay(4)); dR.delayTime.value = BEAT * 1.5;
  const fbL = filt('lowpass', 2400, 0.5), fbR = filt('lowpass', 2400, 0.5);
  const gL = gain(0.62), gR = gain(0.62);
  const pL = mk(ac.createStereoPanner()); pL.pan.value = -0.75;
  const pR = mk(ac.createStereoPanner()); pR.pan.value = 0.75;
  const dlyOut = gain(0.55);
  const dlyHp = filt('highpass', 300, 0.5);
  dlyIn.connect(dlyHp); dlyHp.connect(dL);
  dL.connect(fbL); fbL.connect(gL); gL.connect(dR);
  dR.connect(fbR); fbR.connect(gR); gR.connect(dL);
  dL.connect(pL); dR.connect(pR); pL.connect(dlyOut); pR.connect(dlyOut);
  dlyOut.connect(mix);
  const dlyToRev = gain(0.35);
  dlyOut.connect(dlyToRev); dlyToRev.connect(revIn);

  // Bus helper: dry / reverb / delay sends
  const bus = (dry, rev, dly, head) => {
    const inp = gain(1);
    const tail = head ? head(inp) : inp;
    const d = gain(dry); tail.connect(d); d.connect(mix);
    if (rev) { const r = gain(rev); tail.connect(r); r.connect(revIn); }
    if (dly) { const y = gain(dly); tail.connect(y); y.connect(dlyIn); }
    return inp;
  };

  // Pad: voices -> swell gain (per bar automation) -> slowly moving lowpass (+ LFO) -> sends
  const padSwell = gain(swellGain(INTENSITY[0]));
  const padLp = filt('lowpass', padCutoff(INTENSITY[0]), 0.6);
  padSwell.connect(padLp);
  const padOut = bus(0.6, 0.55, 0, null);
  padLp.connect(padOut);
  const lfo = mk(ac.createOscillator()); lfo.frequency.value = 0.043;
  const lfoAmt = gain(170);
  lfo.connect(lfoAmt); lfoAmt.connect(padLp.frequency);
  lfo.start();
  const padIn = padSwell;

  const bassBus = bus(1, 0, 0, null);
  const hornBus = bus(0.42, 1.0, 0.22, null);
  const pianoBus = bus(0.7, 0.5, 0.75, (n) => { const l = filt('lowpass', 4200, 0.5); n.connect(l); return l; });
  const drumBus = bus(0.8, 0.45, 0, (n) => { const l = filt('lowpass', 520, 0.6); n.connect(l); return l; });
  const airBus = bus(0.5, 0.9, 0, null);
  const riserBus = bus(0.25, 1.0, 0, null);

  function scheduleBar(t0, bar, loop) {
    if (disposed) return;
    bar = ((bar % BARS) + BARS) % BARS;
    const rng = mulberry32(bar * 7919 + loop * 104729 + 17);
    const I = INTENSITY[bar];
    const In = INTENSITY[(bar + 1) % BARS];
    const jit = () => rng() * 0.009;              // 0 to 9 ms late, never early
    const vary = () => 0.9 + rng() * 0.2;         // +-10 percent velocity

    // slow dynamics: pad level and lowpass glide across the bar, continuous into the next one
    padSwell.gain.setValueAtTime(swellGain(I), t0);
    padSwell.gain.linearRampToValueAtTime(swellGain(In), t0 + BAR);
    padLp.frequency.setValueAtTime(padCutoff(I), t0);
    padLp.frequency.linearRampToValueAtTime(padCutoff(In), t0 + BAR);

    for (const s of PAD_AT.get(bar) || []) {
      const dur = s.len * BAR + 0.6;
      const n = s.notes.length;
      const vol = 0.195 / Math.sqrt(n / 5);
      s.notes.forEach((m, i) => {
        const pan = (((i * 3) % n) / (n - 1) - 0.5) * 1.5;
        padNote(ac, padIn, t0 + rng() * 0.15, dur, m, { vol: vol * (0.9 + rng() * 0.2), pan, cents: 6 + rng() * 6 });
      });
    }

    for (const [, len, midi] of BASS_AT.get(bar) || []) {
      subNote(ac, bassBus, t0, len * BAR + 0.4, midi, 0.15 * (0.25 + 0.75 * Math.pow(I, 1.2)));
    }

    for (const [, beat, midi, beats] of HORN_AT.get(bar) || []) {
      const pan = (midi % 2 ? 0.28 : -0.28);
      hornNote(ac, hornBus, t0 + beat * BEAT + jit() * 3, beats * BEAT, midi, 0.13 * (0.45 + 0.55 * I) * vary(), pan);
    }

    for (const [, beat, midi, vel] of PIANO_AT.get(bar) || []) {
      const pan = ((midi * 7) % 11) / 11 - 0.45;
      fmPluck(ac, pianoBus, t0 + beat * BEAT + jit(), midi, vel * vary() * (0.7 + 0.3 * I), pan);
    }

    for (const [, v] of HEART_AT.get(bar) || []) heartbeat(ac, drumBus, t0 + jit(), v * vary());
    for (const [, beat, v] of TIMP_AT.get(bar) || []) timpani(ac, drumBus, t0 + beat * BEAT + jit(), v * vary());

    for (const s of SWELL_AT.get(bar) || []) {
      const d = s.beats * BEAT;
      noiseBand(ac, drumBus, t0 + s.beat * BEAT, d, { type: 'lowpass', f0: 110, f1: 320, q: 0.7, vol: 0.5, shape: 'riser', brown: true, off: rng() });
      subNote(ac, drumBus, t0 + s.beat * BEAT, d, 38, 0.08);
    }

    for (const r of RISER_AT.get(bar) || []) {
      noiseBand(ac, riserBus, t0, r.bars * BAR, {
        type: 'bandpass', f0: 1100, f1: 7500, q: 0.55, vol: 0.36 * r.vol, shape: 'riser', off: rng(), pan: rng() * 0.6 - 0.3,
      });
    }

    for (const [, len, pan, f0, f1, vol] of AIR_AT.get(bar) || []) {
      noiseBand(ac, airBus, t0, len * BAR, {
        type: 'bandpass', f0, f1, q: 2.2, vol: 0.2 * vol * (0.5 + 0.5 * I), pan, shape: 'swell', peak: 0.55, off: rng(),
      });
    }
  }

  function dispose() {
    disposed = true;
    try { lfo.stop(); } catch (e) { /* not started or already stopped */ }
    for (const n of nodes) { try { n.disconnect(); } catch (e) { /* ignore */ } }
  }

  return { scheduleBar, dispose };
}
