// Orchestral voices for the style C tracks (level themes, boss, stingers). Same sound world as the C title theme
// (src/audio/title/c/voices.js): horn, bowed strings with chorus, string pad, low string ostinato, harp plucks, timpani,
// noise risers and a hall reverb. Adds low brass, low winds, tremolo strings and a tam-tam. Everything is procedural and
// schedules at absolute time t (works on an OfflineAudioContext). Each voice takes a `layer` name: layers are gain
// nodes in front of the buses so the track can fade whole parts in and out smoothly with setLayer().
import { mtof, getNoise } from '../../../synth.js';
import { makeHallIR } from '../../../title/c/voices.js';

export { mulberry32, near } from '../../../title/c/voices.js';

const waveCache = new WeakMap();
function periodic(ac, key, build) {
  let m = waveCache.get(ac); if (!m) { m = new Map(); waveCache.set(ac, m); }
  let w = m.get(key); if (w) return w;
  const N = 40; const real = new Float32Array(N + 1), imag = new Float32Array(N + 1);
  build(imag, N);
  w = ac.createPeriodicWave(real, imag); m.set(key, w); return w;
}
const hornWave = (ac) => periodic(ac, 'horn', (imag, N) => {
  for (let n = 1; n <= N; n++) { let a = 1 / n; if (n % 2 === 1) a += 0.9 * ((n - 1) / 2 % 2 === 0 ? 1 : -1) / (n * n); imag[n] = a; }
});
// Reed like wave (bass clarinet, bassoon): odd harmonics dominate, soft top.
const reedWave = (ac) => periodic(ac, 'reed', (imag, N) => {
  for (let n = 1; n <= N; n++) imag[n] = (n % 2 === 1 ? 1 / Math.pow(n, 1.15) : 0.12 / n) * Math.exp(-n / 14);
});
// Brass wave: full saw harmonics with a formant like hump around the 4th to 7th partial.
const brassWave = (ac) => periodic(ac, 'brass', (imag, N) => {
  for (let n = 1; n <= N; n++) imag[n] = (1 / Math.pow(n, 0.92)) * (1 + 0.9 * Math.exp(-Math.pow((n - 5) / 2.6, 2)));
});

/** Filtered noise burst like synth.js noise(), but the gain node starts at (almost) zero so a source that begins one frame
 * before its envelope (float rounding) cannot leak a one sample click. */
function noise(ac, out, o) {
  const t = o.t, dur = Math.max(0.02, o.dur), vol = Math.max(0.0002, o.vol), a = Math.min(o.a ?? 0.002, dur * 0.9);
  const src = ac.createBufferSource();
  src.buffer = getNoise(ac).white; src.loop = true;
  const f = ac.createBiquadFilter(); f.type = o.type || 'lowpass'; f.Q.value = o.q ?? 0.8;
  const f0 = Math.max(20, o.f0 ?? 1000), f1 = Math.max(20, o.f1 ?? f0);
  f.frequency.setValueAtTime(f0, t);
  if (f1 !== f0) f.frequency.exponentialRampToValueAtTime(f1, t + dur);
  const g = ac.createGain(); g.gain.value = 0.0001;
  g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + Math.max(a, 0.001)); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  src.connect(f); f.connect(g); g.connect(out);
  src.start(t, (o.offset ?? 0) * 1.5); src.stop(t + dur + 0.05);
  src.onended = () => { try { src.disconnect(); f.disconnect(); g.disconnect(); } catch (e) { /* ignore */ } };
}

/**
 * createVoices(ac, out, { barDur, reverb: { seconds, t60, preDelay, wet }, tone })
 * reverb.wet scales every reverb send (default 1); tone: 'warm' (default) | 'dark' | 'bright' sets the reverb damping.
 */
export function createVoices(ac, out, { barDur, reverb = {}, wet = 1, masterGain = 0.8 } = {}) {
  const nodes = [];
  const lfos = [];
  const gain = (v = 1) => { const n = ac.createGain(); n.gain.value = v; nodes.push(n); return n; };
  const biq = (type, f, q = 0.7, gdb) => {
    const n = ac.createBiquadFilter(); n.type = type; n.frequency.value = f; n.Q.value = q;
    if (gdb !== undefined) n.gain.value = gdb;
    nodes.push(n); return n;
  };

  const trim = gain(1); // level slew from the track (setTrim)
  trim.connect(out);
  const master = gain(masterGain);
  master.connect(trim);

  const conv = ac.createConvolver();
  conv.normalize = false;
  conv.buffer = makeHallIR(ac, { seconds: reverb.seconds ?? 3.8, t60: reverb.t60 ?? 3.4, preDelay: reverb.preDelay ?? 0.022, seed: reverb.seed ?? 4242 });
  nodes.push(conv);
  const rvIn = gain(1);
  const rvHp = biq('highpass', reverb.hp ?? 160, 0.6);
  const rvLp = biq('lowpass', reverb.lp ?? 7500, 0.5);
  const rvOut = gain(reverb.level ?? 1);
  rvIn.connect(rvHp); rvHp.connect(rvLp); rvLp.connect(conv); conv.connect(rvOut); rvOut.connect(master);

  const mkBus = (input, level, send) => {
    const o = gain(level);
    input.connect(o); o.connect(master);
    const s = gain(send * wet); o.connect(s); s.connect(rvIn);
    return o;
  };

  const hornIn = biq('peaking', 480, 0.9, 3); mkBus(hornIn, 1, 0.42);
  const brassIn = biq('peaking', 700, 0.8, 2); mkBus(brassIn, 1, 0.38);
  const windIn = gain(1); mkBus(windIn, 1, 0.34);

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

  const lowIn = gain(1); mkBus(lowIn, 1, 0.1);
  const pluckIn = gain(1); mkBus(pluckIn, 1, 0.6);
  const timpIn = gain(1); mkBus(timpIn, 1, 0.3);
  const cymIn = gain(1); mkBus(cymIn, 1, 0.4);
  const buses = { horn: hornIn, brass: brassIn, wind: windIn, str: strIn, low: lowIn, pluck: pluckIn, timp: timpIn, cym: cymIn };

  // Layers: named gain stages in front of a bus.
  const layerVal = new Map();
  const layerNodes = new Map(); // layer -> [gain nodes]
  const cache = new Map();
  const to = (bus, layer) => {
    if (!layer) return buses[bus];
    const key = bus + '|' + layer;
    let g = cache.get(key);
    if (!g) {
      g = gain(layerVal.has(layer) ? layerVal.get(layer) : 1); g.connect(buses[bus]); cache.set(key, g);
      if (!layerNodes.has(layer)) layerNodes.set(layer, []);
      layerNodes.get(layer).push(g);
    }
    return g;
  };

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
  const finish = (src, list) => { src.onended = () => { for (const n of list) { try { n.disconnect(); } catch (e) { /* ignore */ } } }; };
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
  // Amplitude tremolo (bowed tremolo): returns the gain node to feed instead of the plain destination.
  const tremolo = (t, end, rate, depth, dest) => {
    const g = ac.createGain(); g.gain.value = 1 - depth / 2;
    const l = ac.createOscillator(); l.frequency.value = rate;
    const lg = ac.createGain(); lg.gain.value = depth / 2;
    l.connect(lg); lg.connect(g.gain); g.connect(dest);
    l.start(t); l.stop(end);
    return [g, [g, l, lg]];
  };

  return {
    setBrightness(t, hz, tc = 0.6) { strLP.frequency.setTargetAtTime(hz, t, tc); },
    /** Layer gain: immediate when `at` is undefined, else smooth (time constant tc) from time `at`. */
    setLayer(name, v, at, tc = 0.9) {
      layerVal.set(name, v);
      const list = layerNodes.get(name);
      if (!list) return;
      for (const g of list) { if (at === undefined) g.gain.value = v; else g.gain.setTargetAtTime(v, at, tc); }
    },
    setTrim(v, at, tc = 1.2) { if (at === undefined) trim.gain.value = v; else trim.gain.setTargetAtTime(v, at, tc); },
    layerValue(name) { return layerVal.has(name) ? layerVal.get(name) : 1; },

    /** French horn: periodic wave pair, slow attack, small vibrato on notes longer than a beat. */
    horn(t, dur, midi, amp, { beat = 0.7, bright = 0.5, attack = 0.2, pan = 0, layer, rel = 0.5, sus = 0.86 } = {}) {
      const f = mtof(midi);
      const env = ac.createGain(); env.gain.value = 0;
      const lp = ac.createBiquadFilter(); lp.type = 'lowpass'; lp.Q.value = 0.7;
      const cut = Math.min(f * (1.8 + 3.2 * bright), 4200);
      lp.frequency.setValueAtTime(cut * 0.5, t);
      lp.frequency.linearRampToValueAtTime(cut, t + 0.4);
      const oscs = [];
      for (const dt of [-3, 3]) {
        const o = ac.createOscillator(); o.setPeriodicWave(hornWave(ac));
        o.frequency.value = f; o.detune.value = dt; o.connect(lp); oscs.push(o);
      }
      const sub = ac.createOscillator(); sub.type = 'triangle'; sub.frequency.value = f / 2;
      const subG = ac.createGain(); subG.gain.value = 0.18; sub.connect(subG); subG.connect(lp);
      lp.connect(env);
      let node = env;
      if (pan) { const p = ac.createStereoPanner(); p.pan.value = pan; env.connect(p); node = p; }
      node.connect(to('horn', layer));
      const end = bowEnv(env.gain, t, dur, amp * 0.5, attack, rel, sus, 0.5);
      const all = [...oscs, sub];
      let list = [env, lp, subG, ...all];
      if (dur > beat * 1.05) list = list.concat(vibrato(all, t, dur, 5, 5.0));
      for (const o of all) { o.start(t); o.stop(end); }
      finish(oscs[0], list);
      noise(ac, to('horn', layer), { t, dur: 0.22, a: 0.06, vol: amp * 0.05, type: 'bandpass', f0: Math.min(f * 3, 2500), q: 0.8, offset: (midi * 0.137) % 1 });
    },

    /**
     * Brass (trombone, tuba, horn section blend): saw like wave, filter swell "bwaah" at the attack.
     * stab: true makes a short accent (fast attack, quick decay).
     */
    brass(t, dur, midi, amp, { attack = 0.1, bright = 0.5, rel = 0.35, pan = 0, layer, sus = 0.85, swell = 0.16, stab = false } = {}) {
      const f = mtof(midi);
      const env = ac.createGain(); env.gain.value = 0;
      const lp = ac.createBiquadFilter(); lp.type = 'lowpass'; lp.Q.value = 0.8;
      const top = Math.min(f * (2.2 + 5 * bright), 5000);
      lp.frequency.setValueAtTime(Math.max(120, top * 0.3), t);
      lp.frequency.linearRampToValueAtTime(top, t + Math.max(0.05, attack + swell));
      if (stab) lp.frequency.setTargetAtTime(top * 0.4, t + attack + 0.08, 0.12);
      const oscs = [];
      for (const dt of [-6, 5]) {
        const o = ac.createOscillator(); o.setPeriodicWave(brassWave(ac)); o.frequency.value = f; o.detune.value = dt; o.connect(lp); oscs.push(o);
      }
      const sub = ac.createOscillator(); sub.type = 'sine'; sub.frequency.value = f;
      const subG = ac.createGain(); subG.gain.value = 0.25; sub.connect(subG); subG.connect(lp);
      lp.connect(env);
      let node = env;
      if (pan) { const p = ac.createStereoPanner(); p.pan.value = pan; env.connect(p); node = p; }
      node.connect(to('brass', layer));
      let end;
      if (stab) {
        const pk = Math.max(1e-4, amp * 0.5);
        env.gain.setValueAtTime(0, t); env.gain.linearRampToValueAtTime(pk, t + attack);
        env.gain.setTargetAtTime(0, t + attack + Math.max(0.03, dur * 0.35), Math.max(0.05, dur * 0.28));
        end = t + attack + dur * 2.4 + 0.3;
      } else end = bowEnv(env.gain, t, dur, amp * 0.5, attack, rel, sus, 0.45);
      const all = [...oscs, sub];
      let list = [env, lp, subG, ...all];
      if (!stab && dur > 1.3) list = list.concat(vibrato(all, t, dur, 4, 4.6));
      for (const o of all) { o.start(t); o.stop(end); }
      finish(oscs[0], list);
      noise(ac, to('brass', layer), { t, dur: 0.16, a: 0.04, vol: amp * 0.04, type: 'bandpass', f0: Math.min(f * 3, 2200), q: 0.8, offset: (midi * 0.173) % 1 });
    },

    /** Low wind (bass clarinet, bassoon): reed wave, breathy attack, no vibrato. */
    wind(t, dur, midi, amp, { attack = 0.12, bright = 0.4, rel = 0.4, pan = 0, layer, sus = 0.9 } = {}) {
      const f = mtof(midi);
      const env = ac.createGain(); env.gain.value = 0;
      const lp = ac.createBiquadFilter(); lp.type = 'lowpass'; lp.Q.value = 1.1;
      lp.frequency.setValueAtTime(f * 2, t); lp.frequency.linearRampToValueAtTime(Math.min(f * (3 + 5 * bright), 3800), t + 0.3);
      const o1 = ac.createOscillator(); o1.setPeriodicWave(reedWave(ac)); o1.frequency.value = f; o1.detune.value = -4;
      const o2 = ac.createOscillator(); o2.setPeriodicWave(reedWave(ac)); o2.frequency.value = f; o2.detune.value = 5;
      o1.connect(lp); o2.connect(lp); lp.connect(env);
      let node = env;
      if (pan) { const p = ac.createStereoPanner(); p.pan.value = pan; env.connect(p); node = p; }
      node.connect(to('wind', layer));
      const end = bowEnv(env.gain, t, dur, amp * 0.5, attack, rel, sus, 0.3);
      for (const o of [o1, o2]) { o.start(t); o.stop(end); }
      finish(o1, [env, lp, o1, o2]);
      noise(ac, to('wind', layer), { t, dur: Math.min(dur, 0.6), a: 0.1, vol: amp * 0.07, type: 'bandpass', f0: Math.min(f * 4, 3000), q: 1.4, offset: (midi * 0.291) % 1 });
    },

    /** Bowed string section note: three detuned saws, bow like attack, mild vibrato on long notes. */
    strings(t, dur, midi, amp, { beat = 0.7, attack = 0.11, pan = 0, vib = 8, rel = 0.45, layer, trem = 0, tremRate = 0 } = {}) {
      const f = mtof(midi);
      const env = ac.createGain(); env.gain.value = 0;
      const oscs = [];
      for (const dt of [-13, 0, 12]) {
        const o = ac.createOscillator(); o.type = 'sawtooth'; o.frequency.value = f; o.detune.value = dt + (midi % 3) - 1;
        const g = ac.createGain(); g.gain.value = 0.34; o.connect(g); g.connect(env); oscs.push([o, g]);
      }
      let node = env;
      if (pan) { const p = ac.createStereoPanner(); p.pan.value = pan; env.connect(p); node = p; }
      const os = oscs.map((x) => x[0]);
      const end = bowEnv(env.gain, t, dur, amp * 0.5, attack, rel, 0.85, 0.35);
      let list = [env, ...oscs.flat()];
      if (trem > 0) {
        const [tg, tl] = tremolo(t, end, tremRate || 9.5 + ((midi * 0.37) % 3), trem, to('str', layer));
        node.connect(tg); list = list.concat(tl);
      } else {
        node.connect(to('str', layer));
        if (dur > beat * 1.05) list = list.concat(vibrato(os, t, dur, vib, 5.3));
      }
      for (const o of os) { o.start(t); o.stop(end); }
      finish(os[0], list);
    },

    /** Sustained pad chord run: `midis` voices, per bar levels `amps` ramped at bar boundaries. */
    padRun(t, bars, midis, amps, { layer, attack = 0.9, trem = 0, tremRate = 0, tail = 0.28 } = {}) {
      const total = bars * barDur;
      for (let v = 0; v < midis.length; v++) {
        const f = mtof(midis[v]);
        const env = ac.createGain(); env.gain.value = 0;
        const p = 0.5 / Math.sqrt(midis.length);
        env.gain.setValueAtTime(0, t);
        env.gain.linearRampToValueAtTime(amps[0] * p, t + attack);
        for (let b = 1; b < bars; b++) env.gain.linearRampToValueAtTime(amps[b] * p, t + b * barDur);
        env.gain.setTargetAtTime(0, t + total, tail);
        const oscs = [];
        for (const dt of [-10, 1, 9]) {
          const o = ac.createOscillator(); o.type = 'sawtooth'; o.frequency.value = f; o.detune.value = dt + (v - 1.5) * 1.5;
          const g = ac.createGain(); g.gain.value = 0.34; o.connect(g); g.connect(env); oscs.push([o, g]);
        }
        const pn = ac.createStereoPanner(); pn.pan.value = (v - (midis.length - 1) / 2) * 0.35;
        env.connect(pn);
        let extra = [];
        const stop = t + total + tail * 7;
        if (trem > 0) { const [tg, tl] = tremolo(t, stop, (tremRate || 8.5) + v * 0.9, trem, to('str', layer)); pn.connect(tg); extra = tl; } else pn.connect(to('str', layer));
        const os = oscs.map((x) => x[0]);
        for (const o of os) { o.start(t); o.stop(stop); }
        finish(os[0], [env, pn, ...oscs.flat(), ...extra]);
      }
    },

    /** Bass pedal (contrabass and cello blend) across a chord run. */
    bassRun(t, bars, midi, amps, { layer, lp: lpHz = 420, attack = 1.3, grit = 0.25, sub = 0, tail = 0.4 } = {}) {
      const total = bars * barDur;
      const f = mtof(midi);
      const env = ac.createGain(); env.gain.value = 0;
      env.gain.setValueAtTime(0, t);
      env.gain.linearRampToValueAtTime(amps[0], t + attack);
      for (let b = 1; b < bars; b++) env.gain.linearRampToValueAtTime(amps[b], t + b * barDur);
      env.gain.setTargetAtTime(0, t + total, tail);
      const lp = biq('lowpass', lpHz, 0.5);
      const o1 = ac.createOscillator(); o1.type = 'sawtooth'; o1.frequency.value = f; o1.detune.value = -4;
      const o2 = ac.createOscillator(); o2.type = 'sine'; o2.frequency.value = f;
      const o3 = ac.createOscillator(); o3.type = 'sawtooth'; o3.frequency.value = f * 2; o3.detune.value = 5;
      const g1 = gain(grit), g2 = gain(0.6), g3 = gain(0.12);
      o1.connect(g1); o2.connect(g2); o3.connect(g3);
      g1.connect(lp); g2.connect(lp); g3.connect(lp);
      const list = [env, o1, o2, o3];
      const oscs = [o1, o2, o3];
      if (sub > 0) { const o4 = ac.createOscillator(); o4.type = 'sine'; o4.frequency.value = f / 2; const g4 = gain(sub); o4.connect(g4); g4.connect(lp); oscs.push(o4); list.push(o4); }
      lp.connect(env); env.connect(to('low', layer));
      const stop = t + total + tail * 8;
      for (const o of oscs) { o.start(t); o.stop(stop); }
      finish(o1, list);
    },

    /** Staccato (or marcato with `hold`) low string ostinato note. */
    ostinato(t, midi, amp, bright = 0.5, { hold = 0, layer, dec = 0.05 } = {}) {
      const f = mtof(midi);
      const env = ac.createGain(); env.gain.value = 0;
      const lp = ac.createBiquadFilter(); lp.type = 'lowpass'; lp.Q.value = 0.9;
      lp.frequency.setValueAtTime(500 + 2200 * bright, t);
      lp.frequency.exponentialRampToValueAtTime(260 + 500 * bright, t + 0.16 + hold);
      const oscs = [];
      for (const dt of [-7, 6]) {
        const o = ac.createOscillator(); o.type = 'sawtooth'; o.frequency.value = f; o.detune.value = dt; o.connect(lp); oscs.push(o);
      }
      lp.connect(env); env.connect(to('low', layer));
      env.gain.setValueAtTime(0, t);
      env.gain.linearRampToValueAtTime(amp, t + 0.014);
      env.gain.setTargetAtTime(0, t + 0.06 + hold, dec + hold * 0.15);
      for (const o of oscs) { o.start(t); o.stop(t + 0.42 + hold * 2); }
      finish(oscs[0], [env, lp, ...oscs]);
    },

    /** Short bowed staccato (violas, off beat pulse). */
    spiccato(t, midi, amp, pan = 0, layer) {
      const f = mtof(midi);
      const env = ac.createGain(); env.gain.value = 0;
      const oscs = [];
      for (const dt of [-9, 8]) {
        const o = ac.createOscillator(); o.type = 'sawtooth'; o.frequency.value = f; o.detune.value = dt; o.connect(env); oscs.push(o);
      }
      let node = env;
      if (pan) { const p = ac.createStereoPanner(); p.pan.value = pan; env.connect(p); node = p; }
      node.connect(to('str', layer));
      env.gain.setValueAtTime(0, t);
      env.gain.linearRampToValueAtTime(amp, t + 0.02);
      env.gain.setTargetAtTime(0, t + 0.05, 0.045);
      for (const o of oscs) { o.start(t); o.stop(t + 0.4); }
      finish(oscs[0], [env, ...oscs]);
    },

    /** Harp like pluck: triangle plus a quick octave partial, fast bright to dark decay. */
    pluck(t, midi, amp, pan = 0, { layer, decay = 0.34 } = {}) {
      const f = mtof(midi);
      const env = ac.createGain(); env.gain.value = 0;
      const lp = ac.createBiquadFilter(); lp.type = 'lowpass'; lp.Q.value = 0.5;
      lp.frequency.setValueAtTime(Math.min(f * 7, 6000), t);
      lp.frequency.exponentialRampToValueAtTime(Math.max(f * 1.6, 500), t + 0.5);
      const o1 = ac.createOscillator(); o1.type = 'triangle'; o1.frequency.value = f;
      const o2 = ac.createOscillator(); o2.type = 'sine'; o2.frequency.value = f * 2.001;
      const g2 = ac.createGain(); g2.gain.value = 0.25;
      o1.connect(lp); o2.connect(g2); g2.connect(lp);
      lp.connect(env);
      const p = ac.createStereoPanner(); p.pan.value = pan;
      env.connect(p); p.connect(to('pluck', layer));
      env.gain.setValueAtTime(0, t);
      env.gain.linearRampToValueAtTime(amp, t + 0.004);
      env.gain.setTargetAtTime(0, t + 0.006, decay);
      const stop = t + 0.006 + decay * 7 + 0.2;
      o1.start(t); o2.start(t); o1.stop(stop); o2.stop(stop);
      finish(o1, [env, lp, o1, o2, g2, p]);
    },

    /** Timpani strike tuned to midi. */
    timpani(t, midi, amp, decay = 0.55, layer) {
      const f = mtof(midi);
      const env = ac.createGain(); env.gain.value = 0;
      const o1 = ac.createOscillator(); o1.type = 'sine';
      o1.frequency.setValueAtTime(f * 1.5, t); o1.frequency.exponentialRampToValueAtTime(f, t + 0.07);
      const o2 = ac.createOscillator(); o2.type = 'sine';
      o2.frequency.setValueAtTime(f * 2.3, t); o2.frequency.exponentialRampToValueAtTime(f * 1.5, t + 0.1);
      const g2 = ac.createGain(); g2.gain.value = 0.3;
      o1.connect(env); o2.connect(g2); g2.connect(env);
      const dst = to('timp', layer);
      env.connect(dst);
      env.gain.setValueAtTime(0, t);
      env.gain.linearRampToValueAtTime(amp, t + 0.006);
      env.gain.setTargetAtTime(0, t + 0.01, decay / 3);
      const stop = t + decay * 3.2 + 0.2;
      o1.start(t); o2.start(t); o1.stop(stop); o2.stop(stop);
      finish(o1, [env, o1, o2, g2]);
      noise(ac, dst, { t, dur: 0.07, a: 0.004, vol: amp * 0.25, type: 'lowpass', f0: 500, q: 0.7, offset: (midi * 0.211) % 1 });
    },

    /** Riser: filtered noise swell. */
    riser(t, dur, vol, seedOff = 0.3, layer) {
      const d = to('cym', layer);
      noise(ac, d, { t, dur, a: dur * 0.9, vol, type: 'bandpass', f0: 900, f1: 6500, q: 0.6, offset: seedOff });
      noise(ac, d, { t, dur, a: dur * 0.9, vol: vol * 0.5, type: 'highpass', f0: 3500, f1: 7500, q: 0.5, offset: (seedOff + 0.4) % 1 });
    },

    /** Soft cymbal crash. */
    crash(t, vol, seedOff = 0.7, layer) {
      const d = to('cym', layer);
      noise(ac, d, { t, dur: 3.6, a: 0.02, vol, type: 'highpass', f0: 3200, f1: 2500, q: 0.5, offset: seedOff });
      noise(ac, d, { t, dur: 2.2, a: 0.02, vol: vol * 0.6, type: 'bandpass', f0: 6500, f1: 5000, q: 0.9, offset: (seedOff + 0.3) % 1 });
    },

    /** Tam-tam: dark metallic wash with a long bloom (noise plus a few inharmonic partials). */
    tam(t, vol, midi = 38, layer, len = 6) {
      const d = to('cym', layer);
      noise(ac, d, { t, dur: len, a: 0.35, vol, type: 'bandpass', f0: 1400, f1: 700, q: 0.7, offset: 0.13 });
      noise(ac, d, { t, dur: len * 0.7, a: 0.12, vol: vol * 0.5, type: 'lowpass', f0: 500, f1: 250, q: 0.8, offset: 0.61 });
      const f = mtof(midi);
      for (const [r, a] of [[1, 1], [1.59, 0.7], [2.14, 0.5], [2.65, 0.4], [3.32, 0.25]]) {
        const o = ac.createOscillator(); o.type = 'sine'; o.frequency.value = f * r * 2;
        const g = ac.createGain(); g.gain.value = 0;
        g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(vol * 0.13 * a, t + 0.5);
        g.gain.setTargetAtTime(0, t + 0.6, len * 0.16);
        o.connect(g); g.connect(d); o.start(t); o.stop(t + len * 1.3);
        finish(o, [o, g]);
      }
    },

    dispose() {
      for (const l of lfos) { try { l.stop(); } catch (e) { /* ignore */ } }
      for (const n of nodes) { try { n.disconnect(); } catch (e) { /* ignore */ } }
    },
  };
}
