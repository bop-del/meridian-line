// Sound rig for the style D (melodic techno) tracks. One rig per track instance.
//
// CPU plan: everything that fires on 16th notes (hats, shaker, claps, bass, plucks, bell, swells) is a PERSISTENT voice whose gain,
// pitch and filter are automated per hit, so a bar creates no nodes for them. Only kicks, booms and pad chords create
// short lived nodes (a handful per bar). Voices are built lazily on first use, so a track only pays for what it plays.
//
// Signal flow:  voices -> duck groups (sidechain style pump) -> melodic lowpass (breakdown sweeps) -> mix
//               drums, kick -> mix;  reverb and ping-pong delay sends -> mix
//               mix -> glue compressor -> soft clip (hard ceiling 0.9) -> trim -> out
import { mtof, getNoise } from '../../../synth.js';
import { mulberry32 } from './util.js';

const REST = 0.0001;

function makeIR(ac, seconds, seed) {
  const sr = ac.sampleRate, len = Math.floor(sr * seconds);
  const buf = ac.createBuffer(2, len, sr);
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    const rnd = mulberry32(seed * 977 + ch * 131);
    let lp = 0;
    for (let i = 0; i < len; i++) {
      const x = i / len;
      const alpha = Math.max(0.08, 0.7 - 0.6 * Math.pow(x, 0.5));
      lp += alpha * ((rnd() * 2 - 1) * Math.exp(-6.2 * x) - lp);
      d[i] = lp * Math.min(1, i / (sr * 0.003));
    }
  }
  return buf;
}

const curveCache = new Map();
/** tanh soft clipper curve normalised so curve(1) = ceil. */
function tanhCurve(k, ceil = 1) {
  const key = k + ':' + ceil;
  let c = curveCache.get(key);
  if (!c) {
    const n = 1024; c = new Float32Array(n);
    const nk = Math.tanh(k);
    for (let i = 0; i < n; i++) { const x = (i * 2) / (n - 1) - 1; c[i] = (Math.tanh(k * x) / nk) * ceil; }
    curveCache.set(key, c);
  }
  return c;
}

/**
 * A persistent monophonic synth voice: oscillators -> filter(s) -> optional drive -> amp gain -> dest.
 * o: { oscs:[{type, det (cents), gain, oct (octave shift)}], filters:1|2, q, drive (tanh k, 0 = clean), vib:{rate, depth (cents)} }
 */
class Mono {
  constructor(rig, dest, o) {
    const ac = rig.ac;
    this.ac = ac; this.o = o;
    this.filt = [];
    this.oscs = [];
    const first = rig.filter('lowpass', 1000, o.q ?? 4);
    this.filt.push(first);
    let tail = first;
    if ((o.filters ?? 1) > 1) { const f2 = rig.filter('lowpass', 1000, (o.q ?? 4) * 0.5); first.connect(f2); this.filt.push(f2); tail = f2; }
    if (o.drive) { const ws = rig.node(ac.createWaveShaper()); ws.curve = tanhCurve(o.drive); tail.connect(ws); tail = ws; }
    this.amp = rig.gain(REST);
    tail.connect(this.amp); this.amp.connect(dest);
    let lfoGain = null;
    if (o.vib) {
      const lfo = rig.src(ac.createOscillator()); lfo.frequency.value = o.vib.rate ?? 5.4;
      lfoGain = rig.gain(o.vib.depth ?? 5); lfo.connect(lfoGain);
      lfo.start();
    }
    for (const d of o.oscs) {
      const os = rig.src(ac.createOscillator()); os.type = d.type; os.frequency.value = 110; os.detune.value = d.det || 0;
      const g = rig.gain(d.gain ?? 1); os.connect(g); g.connect(first);
      if (lfoGain) lfoGain.connect(os.detune);
      os.start();
      this.oscs.push({ os, mul: Math.pow(2, d.oct || 0) });
    }
    this.holdEnd = -1;
    this.level = 0;
  }

  /**
   * Schedules one note. n: { vel, vol, cut, env (cutoff multiple at the start of the decay), dec, atk, rel, slide, glide }
   * A slide note that starts exactly where the previous note ends (within 1 ms) glides in pitch and keeps the gate open.
   */
  note(t, midi, dur, n = {}) {
    const f = mtof(midi);
    const vol = Math.max(REST * 2, (n.vol ?? 0.2) * (n.vel ?? 1));
    const cut = Math.max(40, Math.min(18000, n.cut ?? 1200));
    const cutA = Math.max(40, Math.min(18000, cut * (n.env ?? 3)));
    const dec = Math.max(0.02, n.dec ?? 0.15);
    const atk = n.atk ?? 0.003, rel = n.rel ?? 0.04;
    dur = Math.max(0.02, dur);
    const slide = !!n.slide && Math.abs(t - this.holdEnd) < 0.001 && this.level > 0;
    for (const { os, mul } of this.oscs) {
      if (slide) os.frequency.setTargetAtTime(f * mul, t, (n.glide ?? 0.05) / 3);
      else os.frequency.setValueAtTime(f * mul, t);
    }
    const a = slide ? cut + (cutA - cut) * 0.35 : cutA;
    this.filt.forEach((fl, i) => {
      fl.frequency.setValueAtTime(a, t);
      fl.frequency.exponentialRampToValueAtTime(cut, t + dec * (i ? 1.2 : 1));
    });
    const g = this.amp.gain;
    if (slide) {
      g.cancelScheduledValues(t);
      g.setValueAtTime(this.level, t);
      g.linearRampToValueAtTime(vol, t + 0.015);
    } else {
      g.setValueAtTime(REST, t);
      g.linearRampToValueAtTime(vol, t + atk);
    }
    g.setValueAtTime(vol, t + dur);
    g.exponentialRampToValueAtTime(REST, t + dur + rel);
    this.holdEnd = t + dur;
    this.level = vol;
  }
}

export function createRig(ac, out, o = {}) {
  const {
    bpm = 124, trim = 0.85, seed = 1, revSec = 4.2, revLevel = 0.3, revHP = 240,
    delBeats = 0.75, delFb = 0.42, delTone = 2600, delLevel = 0.34,
    glue = { thr: -20, ratio: 4, rel: 0.18 }, satK = 1.1, tone = 9200,
    duckDepth = 0.4, levels = {}, modRate = 1,
  } = o;
  const lvl = (k) => (Number.isFinite(levels[k]) ? levels[k] : 1);
  const beat = 60 / bpm;
  const all = [];       // every node, disconnected on dispose
  const sources = [];   // every source that must be stopped on dispose

  const node = (n) => { all.push(n); return n; };
  const src = (s) => { all.push(s); sources.push(s); return s; };
  const gain = (v = 1) => { const g = node(ac.createGain()); g.gain.value = v; return g; };
  const filter = (type, f, q = 0.7) => { const b = node(ac.createBiquadFilter()); b.type = type; b.frequency.value = f; b.Q.value = q; return b; };
  const delay = (max, t) => { const d = node(ac.createDelay(max)); d.delayTime.value = t; return d; };
  const noiseSrc = (offset) => {
    const s = src(ac.createBufferSource()); s.buffer = getNoise(ac).white; s.loop = true; s.start(0, (offset % 1) * 1.5); return s;
  };
  const rig = { ac, node, src, gain, filter, beat };

  // ---- master chain
  const mix = gain(0.5);   // headroom before the glue compressor and the soft clip
  const comp = node(ac.createDynamicsCompressor());
  comp.threshold.value = glue.thr; comp.knee.value = 8; comp.ratio.value = glue.ratio; comp.attack.value = 0.006; comp.release.value = glue.rel;
  const clip = node(ac.createWaveShaper()); clip.curve = tanhCurve(satK, 0.9);
  const master = gain(trim * 2);
  // dark top end: everything above about 9 kHz rolls off, so nothing gets shrill
  const toneLP = filter('lowpass', tone, 0.5), toneLP2 = filter('lowpass', tone * 1.4, 0.5);
  mix.connect(comp); comp.connect(clip); clip.connect(toneLP); toneLP.connect(toneLP2); toneLP2.connect(master); master.connect(out);

  // ---- sends
  const revIn = gain(1);
  const rHP = filter('highpass', revHP, 0.6);
  const conv = node(ac.createConvolver()); conv.buffer = makeIR(ac, revSec, seed);
  const rRet = gain(revLevel);
  revIn.connect(rHP); rHP.connect(conv); conv.connect(rRet); rRet.connect(mix);

  const delIn = gain(1);
  const dHP = filter('highpass', 300, 0.6);
  const dL = delay(2, beat * delBeats), dR = delay(2, beat * delBeats);
  const lpL = filter('lowpass', delTone, 0.4), lpR = filter('lowpass', delTone * 0.85, 0.4);
  const fbL = gain(delFb), fbR = gain(delFb);
  const merger = node(ac.createChannelMerger(2));
  const dRet = gain(delLevel);
  delIn.connect(dHP); dHP.connect(dL);
  dL.connect(lpL); lpL.connect(fbL); fbL.connect(dR);
  dR.connect(lpR); lpR.connect(fbR); fbR.connect(dL);
  lpL.connect(merger, 0, 0); lpR.connect(merger, 0, 1);
  merger.connect(dRet); dRet.connect(mix);
  // a light reverb on the delay tail
  const dRev = gain(0.25); dRet.connect(dRev); dRev.connect(revIn);

  // ---- groups: drums (plain), melodic lowpass with duck inserts
  const drumBus = gain(lvl('drums')); drumBus.connect(mix);
  const kickBus = gain(lvl('kick')); kickBus.connect(mix);
  const fxBus = gain(lvl('fx')); fxBus.connect(mix);
  const melLP = filter('lowpass', 20000, 0.5); melLP.connect(mix);
  const grp = {};
  const groupNames = { bass: 1, pad: 0.9, arp: 0.55, lead: 0.4, drone: 0.8 };
  for (const [name, amount] of Object.entries(groupNames)) {
    const g = gain(1), lv = gain(lvl(name));     // g carries the pump automation, lv the static mix level
    g.connect(lv); lv.connect(melLP); grp[name] = { g, lv, amount };
  }
  // sends taken from the group outputs so the wet part follows the pump a little too
  const sendTo = (from, to, level) => { const s = gain(level); from.connect(s); s.connect(to); return s; };

  // ---- sidechain style pump
  function duck(t, depth = duckDepth, rel = beat * 0.62) {
    rel = Math.min(rel, beat * 0.9);
    for (const { g, amount } of Object.values(grp)) {
      const d = 1 - (1 - depth) * amount;
      g.gain.setValueAtTime(1, t);
      g.gain.linearRampToValueAtTime(d, t + 0.006);
      g.gain.linearRampToValueAtTime(1, t + rel);
    }
  }

  /** Lowpass sweep on all melodic layers (not the drums): from fA at t0 to fB at t1 (exponential). */
  function sweep(t0, t1, fA, fB) {
    const f = melLP.frequency;
    f.setValueAtTime(fA, t0);
    f.exponentialRampToValueAtTime(Math.max(30, fB), Math.max(t0 + 0.01, t1));
  }

  // ---- lazy persistent voices
  const lazy = {};
  const get = (key, make) => lazy[key] || (lazy[key] = make());

  // ==== drums
  function kick(t, vel = 1, k = {}) {
    const { f0 = 150, f1 = 63, sweepT = 0.05, len = 0.46, drive = 1.0, click = 0.18, vol = 0.66, hold = 0.42, tail = 0.94, sub = 0 } = k;
    const os = ac.createOscillator(); os.type = 'sine';
    os.frequency.setValueAtTime(f0, t);
    os.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + sweepT);
    if (tail) os.frequency.exponentialRampToValueAtTime(Math.max(20, f1 * tail), t + len);
    const g = ac.createGain();
    const v = vol * vel;
    g.gain.setValueAtTime(REST, t);
    g.gain.linearRampToValueAtTime(v, t + 0.0022);
    g.gain.exponentialRampToValueAtTime(Math.max(REST * 2, v * hold), t + len * 0.4);
    g.gain.exponentialRampToValueAtTime(REST, t + len);
    let head = os;
    if (drive) { const ws = ac.createWaveShaper(); ws.curve = tanhCurve(drive); os.connect(ws); head = ws; }
    head.connect(g); g.connect(kickBus);
    os.start(t); os.stop(t + len + 0.03);
    os.onended = () => { for (const n of [os, g, head]) { try { n.disconnect(); } catch (e) { /* gone */ } } };
    if (sub > 0) {
      // clean sub layer: a plain sine at the body pitch, no drive, slightly shorter than the main body
      const so = ac.createOscillator(); so.type = 'sine'; so.frequency.value = Math.max(20, f1 * 0.98);
      const sg = ac.createGain();
      sg.gain.setValueAtTime(REST, t); sg.gain.linearRampToValueAtTime(vol * sub * vel, t + 0.006);
      sg.gain.exponentialRampToValueAtTime(REST, t + len * 0.85);
      so.connect(sg); sg.connect(kickBus); so.start(t); so.stop(t + len * 0.85 + 0.03);
      so.onended = () => { for (const n of [so, sg]) { try { n.disconnect(); } catch (e) { /* gone */ } } };
    }
    if (click > 0) {
      const c = get('click', () => {
        const s = noiseSrc(0.31), hp = filter('highpass', 1800, 0.7), cg = gain(REST);
        s.connect(hp); hp.connect(cg); cg.connect(kickBus); return cg;
      });
      c.gain.setValueAtTime(click * vel * 0.5, t);
      c.gain.exponentialRampToValueAtTime(REST, t + 0.012);
    }
  }

  function hat(t, vel = 1, dec = 0.035, hp = 7600, vol = 0.19) {
    const h = get('hat', () => {
      const s = noiseSrc(0.11), f = filter('highpass', hp, 0.7), g = gain(REST);
      s.connect(f); f.connect(g); g.connect(drumBus); return { g, f };
    });
    h.f.frequency.setValueAtTime(hp, t);
    h.g.gain.setValueAtTime(vol * vel, t);
    h.g.gain.exponentialRampToValueAtTime(REST, t + dec);
  }

  function oh(t, vel = 1, dec = 0.15, vol = 0.16, hp = 7000) {
    const h = get('oh', () => {
      const s = noiseSrc(0.47), f = filter('highpass', hp, 0.7), f2 = filter('peaking', 10000, 0.8), g = gain(REST);
      f2.gain.value = 4;
      s.connect(f); f.connect(f2); f2.connect(g); g.connect(drumBus); return { g, f };
    });
    h.f.frequency.setValueAtTime(hp, t);
    h.g.gain.setValueAtTime(REST, t);
    h.g.gain.linearRampToValueAtTime(vol * vel, t + 0.004);
    h.g.gain.exponentialRampToValueAtTime(vol * vel * 0.4, t + dec * 0.4);
    h.g.gain.exponentialRampToValueAtTime(REST, t + dec);
  }

  function clap(t, vel = 1, c = {}) {
    const { f = 1500, vol = 0.42, tail = 0.16, q = 1.2, rev = 0.3 } = c;
    const h = get('clap', () => {
      const s = noiseSrc(0.73), bp = filter('bandpass', f, q), g = gain(REST);
      s.connect(bp); bp.connect(g); g.connect(drumBus); sendTo(g, revIn, rev);
      return { g, bp };
    });
    h.bp.frequency.setValueAtTime(f, t);
    h.bp.Q.setValueAtTime(q, t);
    const g = h.g.gain, v = vol * vel;
    g.setValueAtTime(v * 0.9, t); g.exponentialRampToValueAtTime(REST, t + 0.009);
    g.setValueAtTime(v, t + 0.011); g.exponentialRampToValueAtTime(REST, t + 0.02);
    g.setValueAtTime(v * 0.95, t + 0.022); g.exponentialRampToValueAtTime(REST, t + 0.032);
    g.setValueAtTime(v * 0.75, t + 0.033); g.exponentialRampToValueAtTime(REST, t + 0.033 + tail);
  }

  function snare(t, vel = 1, s = {}) {
    const { f = 2000, tone = 190, vol = 0.34, dec = 0.13 } = s;
    const h = get('snare', () => {
      const n = noiseSrc(0.59), bp = filter('bandpass', f, 0.8), g = gain(REST);
      n.connect(bp); bp.connect(g); g.connect(drumBus); sendTo(g, revIn, 0.2);
      const os = src(ac.createOscillator()); os.type = 'triangle'; os.frequency.value = tone; os.start();
      const og = gain(REST); os.connect(og); og.connect(drumBus);
      return { g, bp, os, og };
    });
    h.bp.frequency.setValueAtTime(f, t);
    h.g.gain.setValueAtTime(vol * vel, t);
    h.g.gain.exponentialRampToValueAtTime(REST, t + dec);
    h.os.frequency.setValueAtTime(tone * 1.5, t);
    h.os.frequency.exponentialRampToValueAtTime(tone, t + 0.05);
    h.og.gain.setValueAtTime(vol * 0.5 * vel, t);
    h.og.gain.exponentialRampToValueAtTime(REST, t + 0.09);
  }

  /** Inharmonic metallic hit (clank, rim, industrial percussion). */
  function metal(t, freq, vel = 1, m = {}) {
    const { dec = 0.14, vol = 0.12, cut = 3200, q = 1.3, ratios = [1, 1.483, 1.932, 2.546] } = m;
    const h = get('metal', () => {
      const bp = filter('bandpass', cut, q), g = gain(REST); bp.connect(g); g.connect(drumBus); sendTo(g, revIn, 0.25);
      const oscs = ratios.map((r, i) => {
        const os = src(ac.createOscillator()); os.type = 'square'; os.frequency.value = 400 * r;
        const og = gain(1 / (1 + i * 0.6)); os.connect(og); og.connect(bp); os.start(); return { os, r };
      });
      return { bp, g, oscs };
    });
    h.bp.frequency.setValueAtTime(cut, t);
    h.bp.Q.setValueAtTime(q, t);
    for (const { os, r } of h.oscs) os.frequency.setValueAtTime(freq * r, t);
    h.g.gain.setValueAtTime(vol * vel, t);
    h.g.gain.exponentialRampToValueAtTime(REST, t + dec);
  }

  function tom(t, f, vel = 1, len = 0.22, vol = 0.34) {
    const h = get('tom', () => {
      const os = src(ac.createOscillator()); os.type = 'sine'; os.frequency.value = 120; os.start();
      const g = gain(REST); os.connect(g); g.connect(drumBus); return { os, g };
    });
    h.os.frequency.setValueAtTime(f * 1.7, t);
    h.os.frequency.exponentialRampToValueAtTime(f, t + 0.09);
    h.g.gain.setValueAtTime(REST, t);
    h.g.gain.linearRampToValueAtTime(vol * vel, t + 0.003);
    h.g.gain.exponentialRampToValueAtTime(REST, t + len);
  }

  function crash(t, vel = 1, dec = 1.3, vol = 0.14) {
    const h = get('crash', () => {
      const s = noiseSrc(0.83), f = filter('highpass', 3800, 0.5), g = gain(REST);
      s.connect(f); f.connect(g); g.connect(fxBus); sendTo(g, revIn, 0.3); return g;
    });
    h.gain.setValueAtTime(vol * vel, t);
    h.gain.exponentialRampToValueAtTime(vol * vel * 0.35, t + dec * 0.3);
    h.gain.exponentialRampToValueAtTime(REST, t + dec);
  }

  /** Noise riser: bandpass sweep f0 -> f1 with a rising level. down=true is a falling sweep (level starts high). */
  function riser(t, dur, r = {}) {
    const { f0 = 400, f1 = 6000, vol = 0.12, q = 1.6, down = false } = r;
    const h = get('riser', () => {
      const s = noiseSrc(0.19), bp = filter('bandpass', f0, q), g = gain(REST);
      s.connect(bp); bp.connect(g); g.connect(fxBus); sendTo(g, revIn, 0.35); return { bp, g };
    });
    h.bp.Q.setValueAtTime(q, t);
    h.bp.frequency.setValueAtTime(down ? f1 : f0, t);
    h.bp.frequency.exponentialRampToValueAtTime(down ? f0 : f1, t + dur);
    const g = h.g.gain;
    if (down) {
      g.setValueAtTime(vol, t); g.exponentialRampToValueAtTime(REST, t + dur);
    } else {
      g.setValueAtTime(REST, t); g.exponentialRampToValueAtTime(vol, t + dur * 0.96);
      g.linearRampToValueAtTime(REST, t + dur);
    }
  }

  /** Sub drop / impact: sine falling f0 -> f1 with a slow decay. */
  function boom(t, vel = 1, b = {}) {
    const { f0 = 90, f1 = 30, len = 1.5, vol = 0.5, lp = 0 } = b;
    const os = ac.createOscillator(); os.type = 'sine';
    os.frequency.setValueAtTime(f0, t);
    os.frequency.exponentialRampToValueAtTime(f1, t + len * 0.5);
    const g = ac.createGain();
    g.gain.setValueAtTime(REST, t);
    g.gain.linearRampToValueAtTime(vol * vel, t + 0.004);
    g.gain.exponentialRampToValueAtTime(REST, t + len);
    os.connect(g); g.connect(kickBus);
    os.start(t); os.stop(t + len + 0.05);
    os.onended = () => { for (const n of [os, g]) { try { n.disconnect(); } catch (e) { /* gone */ } } };
  }

  /** Real silence: the reverb and echo returns are muted from t for dur seconds. */
  function hush(t, dur) {
    for (const [r, v] of [[rRet, revLevel], [dRet, delLevel]]) {
      r.gain.setTargetAtTime(0.0001, t, 0.012);
      r.gain.setTargetAtTime(v, t + dur, 0.08);
    }
  }

  function shaker(t, vel = 1, dec = 0.05, vol = 0.12) {
    const h = get('shaker', () => {
      const s = noiseSrc(0.91), bp = filter('bandpass', 6200, 0.9), g = gain(REST);
      s.connect(bp); bp.connect(g); g.connect(drumBus); return g;
    });
    h.gain.setValueAtTime(REST, t);
    h.gain.linearRampToValueAtTime(vol * vel, t + 0.008);
    h.gain.exponentialRampToValueAtTime(REST, t + dec);
  }

  // slow LFO-on-LFO that every pad filter listens to (about 0.1 Hz, its rate drifting with a second, much slower LFO)
  const padMod = () => get('padMod', () => {
    const slow = src(ac.createOscillator()); slow.frequency.value = 0.031 * modRate;
    const slowG = gain(0.05 * modRate); slow.connect(slowG); slow.start();
    const fast = src(ac.createOscillator()); fast.frequency.value = 0.11 * modRate; slowG.connect(fast.frequency); fast.start();
    const depth = gain(230); fast.connect(depth);   // cents of filter detune
    return depth;
  });

  // ==== melodic voices (persistent monos)
  function mono(key, group, def, sends = {}) {
    return get(key, () => {
      const m = new Mono(rig, grp[group].g, def);
      m.rev = sends.rev != null ? sendTo(m.amp, revIn, sends.rev) : null;
      m.del = sends.del != null ? sendTo(m.amp, delIn, sends.del) : null;
      return m;
    });
  }

  // plucked bass: a sine body with a thin saw and square for definition, low passed
  const bassDef = (o = {}) => ({
    oscs: [{ type: 'sine', gain: 1 }, { type: 'sawtooth', det: -5, gain: 0.3 }, { type: 'square', oct: 1, det: 4, gain: 0.08 }],
    filters: 1, q: 1.6, ...o,
  });
  // pluck: detuned saw and square through a low pass, fast attack, no sustain
  const arpDef = (o = {}) => ({
    oscs: [{ type: 'sawtooth', det: -7, gain: 0.6 }, { type: 'square', det: 6, gain: 0.35 }], filters: 1, q: 2.2, ...o,
  });
  // soft bell: sines an octave and two octaves apart, long release
  const leadDef = (o = {}) => ({
    oscs: [{ type: 'sine', gain: 1 }, { type: 'sine', oct: 1, det: 3, gain: 0.3 }, { type: 'triangle', oct: 2, gain: 0.07 }], filters: 1, q: 0.7, ...o,
  });

  // ==== per hit polyphonic voices: chord stab and pad
  function chord(t, notes, dur, c = {}) {
    const { vol = 0.07, cut = 900, env = 1, dec = 0.25, atk = 0.006, rel = 0.12, types = ['sawtooth', 'sawtooth'], det = 12, group = 'pad', rev = 0.3, lpEnd = 1, lfo = 0 } = c;
    const flt = ac.createBiquadFilter(); flt.type = 'lowpass'; flt.Q.value = c.q ?? 1.4;
    flt.frequency.setValueAtTime(Math.min(16000, cut * env), t);
    flt.frequency.exponentialRampToValueAtTime(Math.max(60, cut * lpEnd), t + dec);
    const g = ac.createGain();
    const v = vol / Math.sqrt(Math.max(1, notes.length) / 3);
    g.gain.setValueAtTime(REST, t);
    g.gain.linearRampToValueAtTime(v, t + atk);
    g.gain.setValueAtTime(v, t + Math.max(atk, dur - 0.02));
    g.gain.exponentialRampToValueAtTime(REST, t + dur + rel);
    const mod = lfo ? padMod() : null;
    if (mod) mod.connect(flt.detune);
    flt.connect(g); g.connect(grp[group].g);
    let tap = null;
    if (rev) { tap = ac.createGain(); tap.gain.value = rev; g.connect(tap); tap.connect(revIn); }
    const oscs = [];
    notes.forEach((m, i) => {
      const f = mtof(m);
      types.forEach((type, j) => {
        const os = ac.createOscillator(); os.type = type; os.frequency.value = f;
        os.detune.value = (j % 2 ? 1 : -1) * det + (i % 3 - 1) * 1.5;
        os.connect(flt); os.start(t); os.stop(t + dur + rel + 0.05); oscs.push(os);
      });
    });
    oscs[0].onended = () => {
      if (mod) { try { mod.disconnect(flt.detune); } catch (e) { /* gone */ } }
      for (const n of [...oscs, flt, g, tap]) { try { n && n.disconnect(); } catch (e) { /* gone */ } } };
  }

  function dispose() {
    for (const s of sources) { try { s.stop(); } catch (e) { /* not started or stopped */ } }
    for (const n of all) { try { n.disconnect(); } catch (e) { /* gone */ } }
  }

  return Object.assign(rig, {
    mix, drumBus, kickBus, fxBus, grp, revIn, delIn, sendTo, duck, sweep,
    kick, hat, oh, clap, snare, metal, tom, crash, riser, boom, chord,
    hush, shaker,
    bass: (opts) => mono('bass', 'bass', bassDef(opts)),
    arp: (opts, sends = { rev: 0.15, del: 0.4 }) => mono('arp', 'arp', arpDef(opts), sends),
    lead: (opts, sends = { rev: 0.4, del: 0.4 }) => mono('lead', 'lead', leadDef(opts), sends),
    dispose,
  });
}
