// Shared track engine for style A (Cinematic drift). defineTrack(def) turns a score (plain data, indexed by bar at load
// time) into a variant module { meta, create }. The graph is the title theme's: mix -> trim -> soft ceiling -> out, a
// 4 s convolution reverb, a ping-pong delay, and per-instrument buses with dry / reverb / delay sends. Voices are the
// title theme's (../../../title/a/voices.js) plus a few extras (./voices.js).
//
// Score lists (all optional). Every event may end with a minimum level `min` (0..1): on level themes the event fades in
// smoothly when the level progress passes it, which is how layers are added as the level goes on.
//   pads   [bar, len, [midi...]]        detuned saw string pad chord
//   bass   [bar, len, midi]             slow sine sub
//   horn   [bar, beat, midi, beats, vol?, min?]
//   plucks [bar, beat, midi, vel, min?] soft FM plucks into the delay
//   heart  [bar, vel, min?]             heartbeat tom
//   timp   [bar, beat, vel, min?, midi?]
//   swells [bar, beat, beats, midi?]    timpani swell (brown noise + sine)
//   risers [bar, bars, vol, min?]       reversed-cymbal noise risers
//   air    [bar, len, pan, f0, f1, vol, min?]   band-passed noise swells
//   surf   [bar, len, pan, f0, f1, vol, min?]   low-passed brown noise swells (water)
// def.hook(api) may return { bar(c) } for track specific voices (ostinatos, mechanical pulses, embers).
import {
  mulberry32, makeImpulse, padNote, subNote, hornNote, fmPluck, heartbeat, noiseBand, ceilingCurve,
} from '../../../title/a/voices.js';
import { timpaniAt } from './voices.js';

const LVL_FLOOR = 0.3; // intensity at the very start of a level as sent by the engine, and below
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const sm = (x) => { x = clamp(x, 0, 1); return x * x * (3 - 2 * x); };

const byBar = (list) => {
  const m = new Map();
  for (const e of list || []) { const k = e[0]; if (!m.has(k)) m.set(k, []); m.get(k).push(e); }
  return m;
};

export function defineTrack(def) {
  const meta = { beatsPerBar: 4, loop: true, ...def.meta };
  const BPM = meta.bpm, BARS = meta.bars;
  const BEAT = 60 / BPM, BAR = BEAT * meta.beatsPerBar;
  const S = def.score;
  const form = S.intensity;
  const adaptive = !!def.adaptive;
  const layers = def.layers || {};
  const P = { att: 2.0, rel: 2.6, cents: 6, vol: 1, cut: [340, 2240], lfo: 170, lfoHz: 0.043, ...(def.pad || {}) };
  const M = { trim: 0.47, subVol: 0.15, hornVol: 0.13, pluckVol: 1, timpVol: 1, heartVol: 1, riserVol: 0.36, airVol: 0.2, ...(def.mix || {}) };
  const BUS = { pad: [0.6, 0.55, 0], bass: [1, 0, 0], horn: [0.42, 1.0, 0.22], pluck: [0.7, 0.5, 0.75], drum: [0.8, 0.45, 0], air: [0.5, 0.9, 0], riser: [0.25, 1.0, 0], ...(def.buses || {}) };
  const DLY = { l: 0.75, r: 1.5, fb: 0.62, lp: 2400, hp: 300, out: 0.55, toRev: 0.35, ...(def.delay || {}) };
  const REV = { seconds: 4.0, seed: 4242, hp: 180, lp: 7000, out: 0.9, ...(def.reverb || {}) };
  const hornVoice = def.hornVoice || hornNote;

  const PAD_AT = byBar(S.pads), BASS_AT = byBar(S.bass), HORN_AT = byBar(S.horn), PLUCK_AT = byBar(S.plucks);
  const HEART_AT = byBar(S.heart), TIMP_AT = byBar(S.timp), SWELL_AT = byBar(S.swells), RISER_AT = byBar(S.risers);
  const AIR_AT = byBar(S.air), SURF_AT = byBar(S.surf);

  const swellGain = (i) => 0.22 + 0.78 * Math.pow(i, 1.4);
  const padCutoff = (i) => P.cut[0] + (P.cut[1] - P.cut[0]) * i;

  function create(ac, out) {
    let disposed = false;
    const nodes = [];
    const mk = (n) => { nodes.push(n); return n; };
    const gain = (v) => { const g = mk(ac.createGain()); g.gain.value = v; return g; };
    const filt = (type, f, q = 0.7) => { const b = mk(ac.createBiquadFilter()); b.type = type; b.frequency.value = f; b.Q.value = q; return b; };

    // level progress (0..1), smoothed inside the track so the engine's 40 ms updates never cause a jump
    let L = adaptive ? (def.lvl0 ?? 0.05) : 1;
    let seen = false, lastT = 0;
    const lay = (lo, hi) => {
      if (!adaptive) return 1;
      if (lo <= 0) return 1;
      const h = Math.min(1, lo + 0.18);
      return h <= lo ? (L >= lo ? 1 : 0) : sm((L - lo) / (h - lo));
    };

    const mix = gain(1);
    const trim = gain(M.trim);
    const ceil = mk(ac.createWaveShaper());
    ceil.curve = ceilingCurve();
    ceil.oversample = '2x';
    mix.connect(trim); trim.connect(ceil); ceil.connect(out);

    const reverb = mk(ac.createConvolver());
    reverb.buffer = makeImpulse(ac, REV.seconds, REV.seed);
    const revIn = gain(1);
    const revHp = filt('highpass', REV.hp, 0.5);
    const revLp = filt('lowpass', REV.lp, 0.5);
    const revOut = gain(REV.out);
    revIn.connect(revHp); revHp.connect(revLp); revLp.connect(reverb); reverb.connect(revOut); revOut.connect(mix);

    const dlyIn = gain(1);
    const dL = mk(ac.createDelay(4)); dL.delayTime.value = BEAT * DLY.l;
    const dR = mk(ac.createDelay(4)); dR.delayTime.value = BEAT * DLY.r;
    const fbL = filt('lowpass', DLY.lp, 0.5), fbR = filt('lowpass', DLY.lp, 0.5);
    const gL = gain(DLY.fb), gR = gain(DLY.fb);
    const pL = mk(ac.createStereoPanner()); pL.pan.value = -0.75;
    const pR = mk(ac.createStereoPanner()); pR.pan.value = 0.75;
    const dlyOut = gain(DLY.out);
    const dlyHp = filt('highpass', DLY.hp, 0.5);
    dlyIn.connect(dlyHp); dlyHp.connect(dL);
    dL.connect(fbL); fbL.connect(gL); gL.connect(dR);
    dR.connect(fbR); fbR.connect(gR); gR.connect(dL);
    dL.connect(pL); dR.connect(pR); pL.connect(dlyOut); pR.connect(dlyOut);
    dlyOut.connect(mix);
    const dlyToRev = gain(DLY.toRev);
    dlyOut.connect(dlyToRev); dlyToRev.connect(revIn);

    const bus = (dry, rev, dly, head) => {
      const inp = gain(1);
      const tail = head ? head(inp) : inp;
      const d = gain(dry); tail.connect(d); d.connect(mix);
      if (rev) { const r = gain(rev); tail.connect(r); r.connect(revIn); }
      if (dly) { const y = gain(dly); tail.connect(y); y.connect(dlyIn); }
      return inp;
    };

    const I0 = form[0] * (adaptive ? 0.62 + 0.38 * L : 1);
    const padSwell = gain(swellGain(I0));
    const padLp = filt('lowpass', padCutoff(I0), 0.6);
    padSwell.connect(padLp);
    const padOut = bus(...BUS.pad, null);
    padLp.connect(padOut);
    const lfo = mk(ac.createOscillator()); lfo.frequency.value = P.lfoHz;
    const lfoAmt = gain(P.lfo);
    lfo.connect(lfoAmt); lfoAmt.connect(padLp.frequency);
    lfo.start();

    const drumHead = (n) => { const l = filt('lowpass', def.drumLp ?? 520, 0.6); n.connect(l); return l; };
    const pluckHead = (n) => { const l = filt('lowpass', def.pluckLp ?? 4200, 0.5); n.connect(l); return l; };
    const buses = {
      bass: bus(...BUS.bass, null),
      horn: bus(...BUS.horn, null),
      pluck: bus(...BUS.pluck, pluckHead),
      drum: bus(...BUS.drum, drumHead),
      air: bus(...BUS.air, null),
      riser: bus(...BUS.riser, null),
    };
    const api = { ac, mix, bus, gain, filt, mk, BEAT, BAR, BARS, BPM, buses, clamp, sm, padSwell, padLp };
    const hook = def.hook ? def.hook(api) : null;

    function scheduleBar(t0, bar, loop) {
      if (disposed) return;
      bar = ((bar % BARS) + BARS) % BARS;
      const rng = mulberry32(bar * 7919 + loop * 104729 + (def.seed ?? 17));
      const scale = adaptive ? 0.62 + 0.38 * L : 1;
      const I = clamp(form[bar] * scale, 0, 1);
      const In = clamp(form[(bar + 1) % BARS] * scale, 0, 1);
      const jit = () => rng() * 0.009;
      const vary = () => 0.9 + rng() * 0.2;
      const gate = (e, k, name) => { const m = e[k] ?? layers[name] ?? 0; return lay(m, m + 0.18); };

      padSwell.gain.setValueAtTime(swellGain(I), t0);
      padSwell.gain.linearRampToValueAtTime(swellGain(In), t0 + BAR);
      padLp.frequency.setValueAtTime(padCutoff(I), t0);
      padLp.frequency.linearRampToValueAtTime(padCutoff(In), t0 + BAR);

      for (const [, len, notes] of PAD_AT.get(bar) || []) {
        const dur = len * BAR + 0.6;
        const n = notes.length;
        const vol = (0.195 * P.vol) / Math.sqrt(n / 5);
        notes.forEach((m, i) => {
          const pan = (((i * 3) % n) / Math.max(1, n - 1) - 0.5) * 1.5;
          padNote(ac, padSwell, t0 + rng() * 0.15, dur, m, { vol: vol * (0.9 + rng() * 0.2), pan, cents: P.cents + rng() * 6, att: P.att, rel: P.rel });
        });
      }

      for (const [, len, midi] of BASS_AT.get(bar) || []) {
        subNote(ac, buses.bass, t0, len * BAR + 0.4, midi, M.subVol * (0.25 + 0.75 * Math.pow(I, 1.2)));
      }

      for (const e of HORN_AT.get(bar) || []) {
        const [, beat, midi, beats, hv] = e;
        const g = gate(e, 5, 'horn');
        if (g < 0.03) continue;
        const pan = midi % 2 ? 0.28 : -0.28;
        hornVoice(ac, buses.horn, t0 + beat * BEAT + jit() * 3, beats * BEAT, midi, (hv ?? M.hornVol) * (0.45 + 0.55 * I) * vary() * g, pan);
      }

      for (const e of PLUCK_AT.get(bar) || []) {
        const [, beat, midi, vel] = e;
        const g = gate(e, 4, 'plucks');
        if (g < 0.03) continue;
        const pan = ((midi * 7) % 11) / 11 - 0.45;
        fmPluck(ac, buses.pluck, t0 + beat * BEAT + jit(), midi, vel * M.pluckVol * vary() * (0.7 + 0.3 * I) * g, pan);
      }

      for (const e of HEART_AT.get(bar) || []) {
        const g = gate(e, 2, 'heart');
        if (g < 0.03) continue;
        heartbeat(ac, buses.drum, t0 + jit(), e[1] * M.heartVol * vary() * g);
      }
      for (const e of TIMP_AT.get(bar) || []) {
        const g = gate(e, 3, 'timp');
        if (g < 0.03) continue;
        const f = e[4] ? 440 * Math.pow(2, (e[4] - 69) / 12) : 73.42;
        timpaniAt(ac, buses.drum, t0 + e[1] * BEAT + jit(), e[2] * M.timpVol * vary() * g, f, def.timpLen ?? 1);
      }

      for (const s of SWELL_AT.get(bar) || []) {
        const d = s[2] * BEAT;
        noiseBand(ac, buses.drum, t0 + s[1] * BEAT, d, { type: 'lowpass', f0: 110, f1: 320, q: 0.7, vol: 0.5, shape: 'riser', brown: true, off: rng() });
        subNote(ac, buses.drum, t0 + s[1] * BEAT, d, s[3] ?? 38, 0.08);
      }

      for (const e of RISER_AT.get(bar) || []) {
        const g = gate(e, 3, 'risers');
        if (g < 0.03) continue;
        noiseBand(ac, buses.riser, t0, e[1] * BAR, {
          type: 'bandpass', f0: 1100, f1: 7500, q: 0.55, vol: M.riserVol * e[2] * g, shape: 'riser', off: rng(), pan: rng() * 0.6 - 0.3,
        });
      }

      for (const e of AIR_AT.get(bar) || []) {
        const g = gate(e, 6, 'air');
        if (g < 0.03) continue;
        const [, len, pan, f0, f1, vol] = e;
        noiseBand(ac, buses.air, t0, len * BAR, {
          type: 'bandpass', f0, f1, q: 2.2, vol: M.airVol * vol * (0.5 + 0.5 * I) * g, pan, shape: 'swell', peak: 0.55, off: rng(),
        });
      }
      for (const e of SURF_AT.get(bar) || []) {
        const g = gate(e, 6, 'surf');
        if (g < 0.03) continue;
        const [, len, pan, f0, f1, vol] = e;
        noiseBand(ac, buses.air, t0, len * BAR, {
          type: 'lowpass', f0, f1, q: 0.7, vol: 0.6 * vol * (0.5 + 0.5 * I) * g, pan, shape: 'swell', peak: 0.62, brown: true, off: rng(),
        });
      }

      if (hook) hook.bar({ t0, bar, loop, rng, I, In, L, lay, gate, jit, vary, api });

      // one-shots: fade the whole graph (dry, reverb and delay returns) to silence after the last bar
      if (!meta.loop && def.endFade && bar === BARS - 1) {
        const { at, dur } = def.endFade;
        mix.gain.setValueAtTime(1, t0 + at);
        mix.gain.linearRampToValueAtTime(0.0001, t0 + at + dur);
      }
    }

    function setIntensity(x) {
      if (!adaptive || !Number.isFinite(x)) return;
      // the engine maps level progress to 0.35..1 (audio.js); stretch that back to a full 0..1 for the layers
      x = clamp((x - LVL_FLOOR) / (1 - LVL_FLOOR), 0, 1);
      const now = ac.currentTime;
      if (!seen) { L = x; seen = true; } else L += (x - L) * (1 - Math.exp(-Math.max(0, now - lastT) / 1.2));
      lastT = now;
    }

    function dispose() {
      disposed = true;
      try { lfo.stop(); } catch (e) { /* not started or already stopped */ }
      try { hook?.dispose?.(); } catch (e) { /* ignore */ }
      for (const n of nodes) { try { n.disconnect(); } catch (e) { /* ignore */ } }
    }

    return adaptive ? { scheduleBar, setIntensity, dispose } : { scheduleBar, dispose };
  }

  return { meta, create };
}
