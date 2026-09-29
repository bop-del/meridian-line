// Orchestral voices for title variant C, built from oscillators and noise. Everything schedules at absolute time t
// on the given AudioContext (which may be an OfflineAudioContext). A shared hall reverb (procedural convolution),
// a chorus on the string bus and per bar brightness control live in createVoices().
import { mtof, noise } from '../../synth.js';

export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Stereo hall impulse response: exponentially decaying noise that gets darker with time. */
export function makeHallIR(ac, { seconds = 3.8, t60 = 3.4, preDelay = 0.022, seed = 4242 } = {}) {
  const sr = ac.sampleRate;
  const len = Math.floor(seconds * sr);
  const buf = ac.createBuffer(2, len, sr);
  const rng = mulberry32(seed);
  const tau = t60 / 6.9078;
  const pre = Math.floor(preDelay * sr);
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    let lp = 0;
    let energy = 0;
    for (let i = pre; i < len; i++) {
      const t = (i - pre) / sr;
      const x = rng() * 2 - 1;
      const a = 0.8 * Math.exp(-t / 0.9) + 0.1;
      lp += (x - lp) * a;
      const v = lp * Math.exp(-t / tau) * Math.min(1, t / 0.035);
      d[i] = v;
      energy += v * v;
    }
    const norm = 1 / Math.sqrt(energy || 1);
    for (let i = 0; i < len; i++) d[i] *= norm;
  }
  return buf;
}

const waveCache = new WeakMap();
/** Horn timbre as one periodic wave: mostly saw harmonics plus some triangle (odd harmonics, 1/n^2). */
function hornWave(ac) {
  let w = waveCache.get(ac);
  if (w) return w;
  const N = 40;
  const real = new Float32Array(N + 1);
  const imag = new Float32Array(N + 1);
  for (let n = 1; n <= N; n++) {
    let a = 1 / n;
    if (n % 2 === 1) a += 0.9 * ((n - 1) / 2 % 2 === 0 ? 1 : -1) / (n * n);
    imag[n] = a;
  }
  w = ac.createPeriodicWave(real, imag);
  waveCache.set(ac, w);
  return w;
}

const near = (pc, target) => {
  let m = target - (((target - pc) % 12) + 12) % 12;
  if (target - m > 6) m += 12;
  return m;
};
export { near };

export function createVoices(ac, out, { barDur }) {
  const nodes = [];
  const lfos = [];
  const gain = (v = 1) => { const n = ac.createGain(); n.gain.value = v; nodes.push(n); return n; };
  const biq = (type, f, q = 0.7, gdb) => {
    const n = ac.createBiquadFilter(); n.type = type; n.frequency.value = f; n.Q.value = q;
    if (gdb !== undefined) n.gain.value = gdb;
    nodes.push(n); return n;
  };

  const master = gain(0.8);
  master.connect(out);

  // Hall reverb: highpassed feed so the low end does not smear.
  const conv = ac.createConvolver();
  conv.normalize = false;
  conv.buffer = makeHallIR(ac);
  nodes.push(conv);
  const rvIn = gain(1);
  const rvHp = biq('highpass', 160, 0.6);
  const rvLp = biq('lowpass', 7500, 0.5);
  const wet = gain(1);
  rvIn.connect(rvHp); rvHp.connect(rvLp); rvLp.connect(conv); conv.connect(wet); wet.connect(master);

  const mkBus = (input, level, send) => {
    const o = gain(level);
    input.connect(o);
    o.connect(master);
    const s = gain(send);
    o.connect(s); s.connect(rvIn);
    return o;
  };

  // Horn bus: gentle formant bump.
  const hornIn = biq('peaking', 480, 0.9, 3);
  mkBus(hornIn, 1, 0.42);

  // String bus: dynamic lowpass then chorus (two modulated delays, panned apart).
  const strIn = gain(1);
  const strLP = biq('lowpass', 2000, 0.5);
  strIn.connect(strLP);
  const strOut = gain(1);
  strLP.connect(strOut);
  const chorus = (base, rate, depth, pan, lvl) => {
    const d = ac.createDelay(0.1); d.delayTime.value = base; nodes.push(d);
    const l = ac.createOscillator(); l.frequency.value = rate; lfos.push(l);
    const lg = gain(depth); l.connect(lg); lg.connect(d.delayTime); l.start();
    const p = ac.createStereoPanner(); p.pan.value = pan; nodes.push(p);
    const w = gain(lvl);
    strLP.connect(d); d.connect(p); p.connect(w); w.connect(strOut);
  };
  chorus(0.017, 0.31, 0.0032, -0.7, 0.42);
  chorus(0.026, 0.23, 0.0041, 0.7, 0.42);
  mkBus(strOut, 1, 0.5);

  const lowIn = gain(1);
  mkBus(lowIn, 1, 0.1);
  const pluckIn = gain(1);
  mkBus(pluckIn, 1, 0.6);
  const timpIn = gain(1);
  mkBus(timpIn, 1, 0.3);
  const cymIn = gain(1);
  mkBus(cymIn, 1, 0.4);

  const vibrato = (oscs, t, dur, depth, rate = 5.1) => {
    const lfo = ac.createOscillator();
    lfo.frequency.value = rate;
    const amt = ac.createGain();
    const onset = Math.min(0.55, dur * 0.45);
    amt.gain.setValueAtTime(0, t);
    amt.gain.linearRampToValueAtTime(depth, t + onset + 0.35);
    lfo.connect(amt);
    for (const o of oscs) amt.connect(o.detune);
    lfo.start(t); lfo.stop(t + dur + 0.6);
    return [lfo, amt];
  };

  const finish = (src, list) => {
    src.onended = () => { for (const n of list) { try { n.disconnect(); } catch (e) { /* ignore */ } } };
  };

  // Bow like envelope: ramp in, small settle, sustain, exponential style release.
  const bowEnv = (param, t, dur, peak, a, rel, sus = 0.88, settle = 0.4) => {
    const p = Math.max(1e-4, peak);
    param.setValueAtTime(0, t);
    param.linearRampToValueAtTime(p, t + a);
    const tEnd = Math.max(t + a + 0.02, t + dur);
    const tSet = Math.min(t + a + settle, tEnd);
    if (tSet > t + a) param.linearRampToValueAtTime(p * sus, tSet);
    param.setTargetAtTime(0, tEnd, rel / 5);
    return tEnd + rel * 1.5 + 0.05;
  };

  return {
    setBrightness(t, hz, tc = 0.6) { strLP.frequency.setTargetAtTime(hz, t, tc); },

    /** French horn: periodic wave osc pair, slow attack, small vibrato only on notes longer than a beat. */
    horn(t, dur, midi, amp, { beat = 0.7, bright = 0.5, attack = 0.2, pan = 0 } = {}) {
      const f = mtof(midi);
      const env = ac.createGain();
      const lp = ac.createBiquadFilter(); lp.type = 'lowpass'; lp.Q.value = 0.7;
      const cut = Math.min(f * (1.8 + 3.2 * bright), 4200);
      lp.frequency.setValueAtTime(cut * 0.5, t);
      lp.frequency.linearRampToValueAtTime(cut, t + 0.4);
      const oscs = [];
      for (const dt of [-3, 3]) {
        const o = ac.createOscillator();
        o.setPeriodicWave(hornWave(ac));
        o.frequency.value = f; o.detune.value = dt;
        o.connect(lp); oscs.push(o);
      }
      const sub = ac.createOscillator(); sub.type = 'triangle'; sub.frequency.value = f / 2;
      const subG = ac.createGain(); subG.gain.value = 0.18; sub.connect(subG); subG.connect(lp);
      lp.connect(env);
      let node = env;
      if (pan) { const p = ac.createStereoPanner(); p.pan.value = pan; env.connect(p); node = p; }
      node.connect(hornIn);
      const end = bowEnv(env.gain, t, dur, amp * 0.5, attack, 0.5, 0.86, 0.5);
      const all = [...oscs, sub];
      let list = [env, lp, subG, ...all];
      if (dur > beat * 1.05) list = list.concat(vibrato(all, t, dur, 5, 5.0));
      for (const o of all) { o.start(t); o.stop(end); }
      finish(oscs[0], list);
      // faint breath at the attack
      noise(ac, hornIn, { t, dur: 0.22, a: 0.06, vol: amp * 0.05, type: 'bandpass', f0: Math.min(f * 3, 2500), q: 0.8, offset: (midi * 0.137) % 1 });
    },

    /** Bowed string section note: three detuned saws per voice, bow like attack, mild vibrato on long notes. */
    strings(t, dur, midi, amp, { beat = 0.7, attack = 0.11, pan = 0, vib = 8, rel = 0.45 } = {}) {
      const f = mtof(midi);
      const env = ac.createGain();
      const oscs = [];
      for (const dt of [-13, 0, 12]) {
        const o = ac.createOscillator(); o.type = 'sawtooth'; o.frequency.value = f; o.detune.value = dt + (midi % 3) - 1;
        const g = ac.createGain(); g.gain.value = 0.34; o.connect(g); g.connect(env); oscs.push([o, g]);
      }
      let node = env;
      if (pan) { const p = ac.createStereoPanner(); p.pan.value = pan; env.connect(p); node = p; }
      node.connect(strIn);
      const end = bowEnv(env.gain, t, dur, amp * 0.5, attack, rel, 0.85, 0.35);
      const os = oscs.map((x) => x[0]);
      let list = [env, ...oscs.flat()];
      if (dur > beat * 1.05) list = list.concat(vibrato(os, t, dur, vib, 5.3));
      for (const o of os) { o.start(t); o.stop(end); }
      finish(os[0], list);
    },

    /** Sustained pad chord run: `midis` voices, per bar levels `amps` ramped at bar boundaries. */
    padRun(t, bars, midis, amps) {
      const total = bars * barDur;
      for (let v = 0; v < midis.length; v++) {
        const f = mtof(midis[v]);
        const env = ac.createGain();
        const p = 0.5 / Math.sqrt(midis.length);
        env.gain.setValueAtTime(0, t);
        env.gain.linearRampToValueAtTime(amps[0] * p, t + 0.9);
        for (let b = 1; b < bars; b++) env.gain.linearRampToValueAtTime(amps[b] * p, t + b * barDur);
        env.gain.setTargetAtTime(0, t + total, 0.28);
        const oscs = [];
        for (const dt of [-10, 1, 9]) {
          const o = ac.createOscillator(); o.type = 'sawtooth'; o.frequency.value = f; o.detune.value = dt + (v - 1.5) * 1.5;
          const g = ac.createGain(); g.gain.value = 0.34; o.connect(g); g.connect(env); oscs.push([o, g]);
        }
        const pn = ac.createStereoPanner(); pn.pan.value = (v - (midis.length - 1) / 2) * 0.35;
        env.connect(pn); pn.connect(strIn);
        const os = oscs.map((x) => x[0]);
        for (const o of os) { o.start(t); o.stop(t + total + 2.0); }
        finish(os[0], [env, pn, ...oscs.flat()]);
      }
    },

    /** Bass pedal (contrabass and cello blend) across a chord run. */
    bassRun(t, bars, midi, amps) {
      const total = bars * barDur;
      const f = mtof(midi);
      const env = ac.createGain();
      env.gain.setValueAtTime(0, t);
      env.gain.linearRampToValueAtTime(amps[0], t + 1.3);
      for (let b = 1; b < bars; b++) env.gain.linearRampToValueAtTime(amps[b], t + b * barDur);
      env.gain.setTargetAtTime(0, t + total, 0.4);
      const lp = biq('lowpass', 420, 0.5);
      const o1 = ac.createOscillator(); o1.type = 'sawtooth'; o1.frequency.value = f; o1.detune.value = -4;
      const o2 = ac.createOscillator(); o2.type = 'sine'; o2.frequency.value = f;
      const o3 = ac.createOscillator(); o3.type = 'sawtooth'; o3.frequency.value = f * 2; o3.detune.value = 5;
      const g1 = gain(0.25), g2 = gain(0.6), g3 = gain(0.12);
      o1.connect(g1); o2.connect(g2); o3.connect(g3);
      g1.connect(lp); g2.connect(lp); g3.connect(lp);
      lp.connect(env); env.connect(lowIn);
      for (const o of [o1, o2, o3]) { o.start(t); o.stop(t + total + 3); }
      finish(o1, [env, o1, o2, o3]);
    },

    /** Staccato low string ostinato note (cellos and basses). */
    ostinato(t, midi, amp, bright = 0.5) {
      const f = mtof(midi);
      const env = ac.createGain();
      const lp = ac.createBiquadFilter(); lp.type = 'lowpass'; lp.Q.value = 0.9;
      lp.frequency.setValueAtTime(500 + 2200 * bright, t);
      lp.frequency.exponentialRampToValueAtTime(260 + 500 * bright, t + 0.16);
      const oscs = [];
      for (const dt of [-7, 6]) {
        const o = ac.createOscillator(); o.type = 'sawtooth'; o.frequency.value = f; o.detune.value = dt; o.connect(lp); oscs.push(o);
      }
      lp.connect(env); env.connect(lowIn);
      env.gain.setValueAtTime(0, t);
      env.gain.linearRampToValueAtTime(amp, t + 0.014);
      env.gain.setTargetAtTime(0, t + 0.06, 0.05);
      for (const o of oscs) { o.start(t); o.stop(t + 0.42); }
      finish(oscs[0], [env, lp, ...oscs]);
    },

    /** Short bowed staccato for violas (off beat pulse). */
    spiccato(t, midi, amp, pan = 0) {
      const f = mtof(midi);
      const env = ac.createGain();
      const oscs = [];
      for (const dt of [-9, 8]) {
        const o = ac.createOscillator(); o.type = 'sawtooth'; o.frequency.value = f; o.detune.value = dt; o.connect(env); oscs.push(o);
      }
      let node = env;
      if (pan) { const p = ac.createStereoPanner(); p.pan.value = pan; env.connect(p); node = p; }
      node.connect(strIn);
      env.gain.setValueAtTime(0, t);
      env.gain.linearRampToValueAtTime(amp, t + 0.02);
      env.gain.setTargetAtTime(0, t + 0.05, 0.045);
      for (const o of oscs) { o.start(t); o.stop(t + 0.4); }
      finish(oscs[0], [env, ...oscs]);
    },

    /** Harp like pluck: triangle plus a quick octave partial, fast bright to dark decay. */
    pluck(t, midi, amp, pan = 0) {
      const f = mtof(midi);
      const env = ac.createGain();
      const lp = ac.createBiquadFilter(); lp.type = 'lowpass'; lp.Q.value = 0.5;
      lp.frequency.setValueAtTime(Math.min(f * 7, 6000), t);
      lp.frequency.exponentialRampToValueAtTime(Math.max(f * 1.6, 500), t + 0.5);
      const o1 = ac.createOscillator(); o1.type = 'triangle'; o1.frequency.value = f;
      const o2 = ac.createOscillator(); o2.type = 'sine'; o2.frequency.value = f * 2.001;
      const g2 = ac.createGain(); g2.gain.value = 0.25;
      o1.connect(lp); o2.connect(g2); g2.connect(lp);
      lp.connect(env);
      const p = ac.createStereoPanner(); p.pan.value = pan;
      env.connect(p); p.connect(pluckIn);
      env.gain.setValueAtTime(0, t);
      env.gain.linearRampToValueAtTime(amp, t + 0.004);
      env.gain.setTargetAtTime(0, t + 0.006, 0.34);
      o1.start(t); o2.start(t); o1.stop(t + 2.2); o2.stop(t + 2.2);
      finish(o1, [env, lp, o1, o2, g2, p]);
    },

    /** Timpani strike tuned to midi. */
    timpani(t, midi, amp, decay = 0.55) {
      const f = mtof(midi);
      const env = ac.createGain();
      const o1 = ac.createOscillator(); o1.type = 'sine';
      o1.frequency.setValueAtTime(f * 1.5, t);
      o1.frequency.exponentialRampToValueAtTime(f, t + 0.07);
      const o2 = ac.createOscillator(); o2.type = 'sine';
      o2.frequency.setValueAtTime(f * 2.3, t);
      o2.frequency.exponentialRampToValueAtTime(f * 1.5, t + 0.1);
      const g2 = ac.createGain(); g2.gain.value = 0.3;
      o1.connect(env); o2.connect(g2); g2.connect(env);
      env.connect(timpIn);
      env.gain.setValueAtTime(0, t);
      env.gain.linearRampToValueAtTime(amp, t + 0.006);
      env.gain.setTargetAtTime(0, t + 0.01, decay / 3);
      const stop = t + decay * 3.2 + 0.2;
      o1.start(t); o2.start(t); o1.stop(stop); o2.stop(stop);
      finish(o1, [env, o1, o2, g2]);
      // skin thump
      noise(ac, timpIn, { t, dur: 0.07, a: 0.004, vol: amp * 0.25, type: 'lowpass', f0: 500, q: 0.7, offset: (midi * 0.211) % 1 });
    },

    /** Riser: filtered noise swell. */
    riser(t, dur, vol, seedOff = 0.3) {
      noise(ac, cymIn, { t, dur, a: dur * 0.9, vol, type: 'bandpass', f0: 900, f1: 6500, q: 0.6, offset: seedOff });
      noise(ac, cymIn, { t, dur, a: dur * 0.9, vol: vol * 0.5, type: 'highpass', f0: 3500, f1: 7500, q: 0.5, offset: (seedOff + 0.4) % 1 });
    },

    /** Soft cymbal crash. */
    crash(t, vol, seedOff = 0.7) {
      noise(ac, cymIn, { t, dur: 3.6, a: 0.02, vol, type: 'highpass', f0: 3200, f1: 2500, q: 0.5, offset: seedOff });
      noise(ac, cymIn, { t, dur: 2.2, a: 0.02, vol: vol * 0.6, type: 'bandpass', f0: 6500, f1: 5000, q: 0.9, offset: (seedOff + 0.3) % 1 });
    },

    dispose() {
      for (const l of lfos) { try { l.stop(); } catch (e) { /* ignore */ } }
      for (const n of nodes) { try { n.disconnect(); } catch (e) { /* ignore */ } }
    },
  };
}
