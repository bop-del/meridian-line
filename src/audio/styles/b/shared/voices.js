// Instrument voices for the style B tracks. Same sound world as the B title theme: resonant filtered saw+sub bass,
// tight kick with a duck, gated clap, detuned pad, filtered arp plucks, portamento lead without vibrato. Each voice takes
// an options object so the tracks can bend the timbre (brighter, colder, heavier) without changing the family.
import { mtof, tone, noise } from '../../../synth.js';
import { mulberry32 } from './util.js';

export function makeVoices(ac, fx) {
  const free = (nodes) => () => { for (const n of nodes) { try { n.disconnect(); } catch (e) { /* ignore */ } } };
  const st = { leadMidi: 69, leadEnd: -1e9 };

  // pad: two detuned oscillators per chord tone, panned wide, slow lowpass sweep cutA -> cutB over `dur`
  function pad(t, notes, dur, o = {}) {
    const { vol = 0.045, a = 0.9, rel = 1.7, cutA = 500, cutB = 1500, q = 1.3, det = 9, spread = 0.35, type = 'sawtooth',
      sub = null, subGain = 0.6, rnd = Math.random, bus = fx.padBus } = o;
    const d = dur + 0.15;
    const end = t + d + rel;
    const flt = ac.createBiquadFilter();
    flt.type = 'lowpass'; flt.Q.value = q;
    flt.frequency.setValueAtTime(cutA, t);
    flt.frequency.exponentialRampToValueAtTime(cutB, t + Math.max(0.2, dur));
    const g = ac.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(vol, t + a);
    g.gain.setValueAtTime(vol, t + d);
    g.gain.linearRampToValueAtTime(0.0001, end);
    flt.connect(g); g.connect(bus);
    const nodes = [flt, g];
    let last = null;
    notes.forEach((m, i) => {
      const f = mtof(m);
      [-1, 1].forEach((side) => {
        const os = ac.createOscillator();
        os.type = type; os.frequency.value = f;
        os.detune.value = side * (det + rnd() * 3) + (rnd() - 0.5) * 2;
        const p = ac.createStereoPanner(); p.pan.value = side * (spread + 0.15 * (i % 2));
        os.connect(p); p.connect(flt);
        os.start(t); os.stop(end + 0.05);
        nodes.push(os, p); last = os;
      });
    });
    if (sub != null) {
      const so = ac.createOscillator(); so.type = 'triangle'; so.frequency.value = mtof(sub);
      const sg = ac.createGain(); sg.gain.value = subGain;
      so.connect(sg); sg.connect(flt); so.start(t); so.stop(end + 0.05); nodes.push(so, sg);
    }
    last.onended = free(nodes);
  }

  // bass note: saw pair + sub, resonant lowpass with a decaying envelope
  function bass(t, midi, dur, vol, cut, o = {}) {
    const { q = 3.8, type = 'sawtooth', type2 = null, subOct = 0.5, subGain = 0.9, sawGain = 0.5, open = 2.5, dec = 0.17,
      sus = 0.62, det = 6, bus = fx.bassBus } = o;
    const f = mtof(midi);
    const flt = ac.createBiquadFilter();
    flt.type = 'lowpass'; flt.Q.value = q;
    flt.frequency.setValueAtTime(cut * open, t);
    flt.frequency.exponentialRampToValueAtTime(cut, t + dec);
    const g = ac.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.006);
    g.gain.exponentialRampToValueAtTime(vol * sus, t + Math.min(0.13, dur));
    g.gain.setValueAtTime(vol * sus, t + dur);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur + 0.07);
    const nodes = [flt, g];
    const mk = (ty, freq, dt, gain) => {
      const os = ac.createOscillator(); os.type = ty; os.frequency.value = freq; os.detune.value = dt;
      const gg = ac.createGain(); gg.gain.value = gain;
      os.connect(gg); gg.connect(flt); os.start(t); os.stop(t + dur + 0.15);
      nodes.push(os, gg); return os;
    };
    mk(type, f, -det, sawGain); mk(type2 || type, f, det, sawGain);
    const sb = mk('sine', f * subOct, 0, subGain);
    flt.connect(g); g.connect(bus);
    sb.onended = free(nodes);
  }

  // long low drone under a chord span
  function drone(t, midi, dur, vol, o = {}) {
    const { a = 1.0, rel = 1.5, h = 0.12, bus = fx.bassBus } = o;
    const g = ac.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(vol, t + a);
    g.gain.setValueAtTime(vol, t + dur);
    g.gain.linearRampToValueAtTime(0.0001, t + dur + rel);
    const os = ac.createOscillator(); os.type = 'sine'; os.frequency.value = mtof(midi);
    const o2 = ac.createOscillator(); o2.type = 'triangle'; o2.frequency.value = mtof(midi) * 2.004;
    const g2 = ac.createGain(); g2.gain.value = h;
    os.connect(g); o2.connect(g2); g2.connect(g); g.connect(bus);
    os.start(t); o2.start(t); os.stop(t + dur + rel + 0.1); o2.stop(t + dur + rel + 0.1);
    os.onended = free([os, o2, g, g2]);
  }

  function kick(t, vel, o = {}) {
    const { f0 = 150, f1 = 45, len = 0.34, vol = 0.4, click = 0.04, depth = 0.34, rel = 0.26, duck = true } = o;
    tone(ac, fx.kickBus, { type: 'sine', f0, f1, t, dur: len, sweep: 0.22, vol: vol * vel, a: 0.002, hold: 0.1 });
    tone(ac, fx.kickBus, { type: 'triangle', f0: f0 * 2.1, f1: f0 * 0.6, t, dur: 0.05, sweep: 0.8, vol: vol * 0.25 * vel, a: 0.001 });
    noise(ac, fx.kickBus, { t, dur: 0.018, vol: click * vel, type: 'highpass', f0: 2500, q: 0.7, a: 0.001, offset: 0.3 });
    if (duck) fx.duck(t, depth, rel);
  }

  function clap(t, vel, rnd, o = {}) {
    const { f = 1500, vol = 1, tail = 0.16, body = 205, hold = 0.17 } = o;
    noise(ac, fx.snareBus, { t, dur: 0.014, vol: 0.57 * vel * vol, type: 'bandpass', f0: f, q: 1.1, a: 0.001, offset: rnd() });
    noise(ac, fx.snareBus, { t: t + 0.011, dur: 0.014, vol: 0.62 * vel * vol, type: 'bandpass', f0: f * 1.07, q: 1.1, a: 0.001, offset: rnd() });
    noise(ac, fx.snareBus, { t: t + 0.022, dur: 0.02, vol: 0.62 * vel * vol, type: 'bandpass', f0: f, q: 1.0, a: 0.001, offset: rnd() });
    noise(ac, fx.snareBus, { t: t + 0.03, dur: tail, vol: 0.44 * vel * vol, type: 'bandpass', f0: f * 1.13, f1: f * 0.6, q: 0.8, a: 0.002, offset: rnd() });
    tone(ac, fx.snareBus, { type: 'triangle', f0: body, f1: body * 0.68, t, dur: 0.11, sweep: 0.5, vol: 0.25 * vel * vol, a: 0.001 });
    fx.gate(t, hold);
  }

  function hat(t, vel, rnd, o = {}) {
    const { vol = 0.19, hp = 7400, dur = 0.05, bus = fx.hatBus } = o;
    noise(ac, bus, { t, dur, vol: vol * vel, type: 'highpass', f0: hp, q: 0.7, a: 0.001, offset: rnd() });
  }

  function tom(t, f, vel, o = {}) {
    const { vol = 0.3, len = 0.3 } = o;
    tone(ac, fx.snareBus, { type: 'sine', f0: f * 1.5, f1: f, t, dur: len, sweep: 0.3, vol: vol * vel, a: 0.002, hold: 0.1 });
    noise(ac, fx.snareBus, { t, dur: 0.02, vol: 0.05 * vel, type: 'bandpass', f0: 1800, q: 1, a: 0.001, offset: 0.5 });
  }

  // arp pluck: two detuned oscillators through a resonant lowpass whose cutoff follows the energy
  function arp(t, midi, vel, e, o = {}) {
    const { vol = 0.14, cutBase = 520, ratio = 7.2, dec = 0.24, q = 2.2, types = [['sawtooth', -8], ['square', 8]], bus = fx.arpBus,
      floor = 0.45, gain = 0.75 } = o;
    const f = mtof(midi);
    const cut = cutBase * Math.pow(ratio, e);
    const flt = ac.createBiquadFilter();
    flt.type = 'lowpass'; flt.Q.value = q;
    flt.frequency.setValueAtTime(cut * 1.9, t);
    flt.frequency.exponentialRampToValueAtTime(cut * 0.7, t + dec * 0.85);
    const g = ac.createGain();
    const v = vol * vel * (floor + gain * e);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, v), t + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dec);
    const nodes = [flt, g];
    let last = null;
    types.forEach(([type, det], i) => {
      const os = ac.createOscillator(); os.type = type; os.frequency.value = f; os.detune.value = det;
      const gg = ac.createGain(); gg.gain.value = i ? 0.45 : 0.7;
      os.connect(gg); gg.connect(flt); os.start(t); os.stop(t + dec + 0.06);
      nodes.push(os, gg); last = os;
    });
    flt.connect(g); g.connect(bus);
    last.onended = free(nodes);
  }

  // lead: triangle + softly filtered square, portamento from the previous note, no vibrato
  function lead(t, dur, midi, vol, rnd, o = {}) {
    const { cutA = 900, cutB = 2300, cutC = 1500, rel = 0.42, glide = 0.11, atk = 0.035, beat = 0.65, types = [['triangle', 1], ['square', 0.22], ['triangle', 0.16]], jump = 4 } = o;
    const from = t - st.leadEnd < beat * 2.5 ? st.leadMidi : midi - jump;
    const f = mtof(midi), f0 = mtof(from);
    const gl = glide + rnd() * 0.03;
    const flt = ac.createBiquadFilter();
    flt.type = 'lowpass'; flt.Q.value = 0.9;
    flt.frequency.setValueAtTime(cutA, t);
    flt.frequency.exponentialRampToValueAtTime(cutB, t + 0.35);
    flt.frequency.exponentialRampToValueAtTime(cutC, t + Math.max(0.5, dur));
    const g = ac.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + atk);
    g.gain.exponentialRampToValueAtTime(vol * 0.72, t + Math.max(atk + 0.05, dur * 0.6));
    g.gain.setValueAtTime(vol * 0.72, t + dur);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur + rel);
    const nodes = [flt, g];
    let last = null;
    types.forEach(([type, gain], i) => {
      const os = ac.createOscillator(); os.type = type;
      const oct = i === 2 ? 2 : 1;
      os.frequency.setValueAtTime(f0 * oct, t);
      os.frequency.exponentialRampToValueAtTime(f * oct, t + gl);
      os.detune.value = (i === 2 ? 0 : 0) + (rnd() - 0.5) * 6;
      const gg = ac.createGain(); gg.gain.value = gain;
      os.connect(gg); gg.connect(flt); os.start(t); os.stop(t + dur + rel + 0.05);
      nodes.push(os, gg); last = os;
    });
    flt.connect(g); g.connect(fx.leadBus);
    last.onended = free(nodes);
    st.leadMidi = midi; st.leadEnd = t + dur;
  }

  // chord stab: detuned saws through a fast-closing lowpass (boss)
  function stab(t, notes, dur, vol, cut, rnd, o = {}) {
    const { q = 2.5, type = 'sawtooth', bus = fx.arpBus, open = 3.2 } = o;
    const flt = ac.createBiquadFilter();
    flt.type = 'lowpass'; flt.Q.value = q;
    flt.frequency.setValueAtTime(cut * open, t);
    flt.frequency.exponentialRampToValueAtTime(cut, t + dur * 0.8);
    const g = ac.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    flt.connect(g); g.connect(bus);
    const nodes = [flt, g];
    let last = null;
    notes.forEach((m) => {
      [-1, 1].forEach((side) => {
        const os = ac.createOscillator(); os.type = type; os.frequency.value = mtof(m); os.detune.value = side * (8 + rnd() * 3);
        os.connect(flt); os.start(t); os.stop(t + dur + 0.05); nodes.push(os); last = os;
      });
    });
    last.onended = free(nodes);
  }

  // metallic clank: inharmonic square partials through a bandpass, short and cold (foundry)
  function clank(t, midi, vel, o = {}) {
    const { vol = 0.1, dec = 0.35, ratios = [1, 1.483, 1.932, 2.546], bus = fx.percBus, cut = 3200 } = o;
    const f = mtof(midi);
    const flt = ac.createBiquadFilter();
    flt.type = 'bandpass'; flt.frequency.value = cut; flt.Q.value = 1.1;
    const g = ac.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol * vel, t + 0.002);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dec);
    flt.connect(g); g.connect(bus);
    const nodes = [flt, g];
    let last = null;
    ratios.forEach((r, i) => {
      const os = ac.createOscillator(); os.type = 'square'; os.frequency.value = f * r;
      const gg = ac.createGain(); gg.gain.value = 1 / (1 + i * 0.6);
      os.connect(gg); gg.connect(flt); os.start(t); os.stop(t + dec + 0.05); nodes.push(os, gg); last = os;
    });
    noise(ac, bus, { t, dur: 0.02, vol: 0.05 * vel, type: 'bandpass', f0: 4200, q: 1.2, a: 0.001, offset: 0.7 });
    last.onended = free(nodes);
  }

  // tiny ember tick / steam chug through the perc bus
  function tick(t, vel, rnd, o = {}) {
    const { vol = 0.06, hp = 4200, dur = 0.02, type = 'highpass', q = 0.8, f1 = null } = o;
    noise(ac, fx.percBus, { t, dur, vol: vol * vel, type, f0: hp, f1: f1 || hp, q, a: 0.001, offset: rnd() });
  }

  // low boom / impact
  function boom(t, vel, o = {}) {
    const { f0 = 70, f1 = 27, len = 1.6, vol = 0.32 } = o;
    tone(ac, fx.kickBus, { type: 'sine', f0, f1, t, dur: len, sweep: 0.35, vol: vol * vel, a: 0.004, hold: 0.06 });
    noise(ac, fx.percBus, { t, dur: 0.9, vol: 0.06 * vel, type: 'lowpass', f0: 900, f1: 120, q: 0.6, a: 0.004, offset: 0.4 });
  }

  // noise swell that peaks at its end (riser) or falls (sweep down)
  function riser(t, dur, o = {}) {
    const { vol = 0.05, f0 = 350, f1 = 4200, q = 1.6, peak = 0.82, bus = fx.arpBus } = o;
    noise(ac, bus, { t, dur, vol, type: 'bandpass', f0, f1, q, a: dur * peak, offset: 0.2 });
  }

  return { pad, bass, drone, kick, clap, hat, tom, arp, lead, stab, clank, tick, boom, riser, mulberry32 };
}
