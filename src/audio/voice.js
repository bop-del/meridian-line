// Pilot voice barks and data blips for the comm lines. voice.speak(speaker, text, { duration }) plays ONE short bark per line:
//   VEX     calm, formal, clipped      fast staccato syllables, mid pitch, small pitch range
//   FERRO   deadpan, dry               slower, low, nearly monotone, slightly nasal
//   REGENT  cold, formal               very low, a detuned double and an octave below, slow, a cold short echo
//   PIP     nervous data chirps        quick rising triangle blips
//   LUMEN   flat precise status ticks  even sine ticks, last one lower
//   CONTROL telemetry chatter          a fast two note square pattern with a crackle
// The barks are not words. Syllable count, vowel colour and consonant hiss come from the line's text (vowel groups, the consonant
// before each one), timed to a short burst (about 0.4 to 2 seconds) instead of the whole typewriter time, with a falling
// sentence contour (rising on a question). Voice = sawtooth glottal source + three parallel formant band passes, aspiration and
// consonant noise, then one shared RADIO chain: band pass 340 to 3300 Hz, presence bump, soft saturation, static bed and a key
// click at the start and a squelch at the end. One bark builds about 25 nodes and frees them when it ends.
//
// Level: barks sit around -30 dBFS peak-ish before the master, well below the music. The voice bus is muted by the pause menu
// sound switch like everything else (it goes through the master gain).
import { feel } from '../core/feel.js';
import { getNoise } from './synth.js';

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const FORMANTS = { a: [730, 1090, 2440], e: [530, 1840, 2480], i: [300, 2250, 3000], o: [570, 840, 2410], u: [330, 900, 2240] };
const FORM_GAIN = [1, 0.62, 0.3];

export const PROFILES = {
  VEX: { f0: 134, span: 0.11, syl: 0.072, gap: 0.03, wordGap: 0.05, shift: 1.05, decl: -0.07, stress: 0.09, breath: 0.05, clip: 0.7, level: 1.0, maxSyl: 12 },
  FERRO: { f0: 106, span: 0.035, syl: 0.105, gap: 0.045, wordGap: 0.085, shift: 0.94, decl: -0.03, stress: 0.03, breath: 0.1, clip: 0.85, level: 0.95, maxSyl: 10, nasal: true },
  REGENT: { f0: 80, span: 0.05, syl: 0.13, gap: 0.05, wordGap: 0.1, shift: 0.86, decl: -0.05, stress: 0.04, breath: 0.07, clip: 0.9, level: 0.95, maxSyl: 9, double: true, echo: true },
};
const BLIPS = { PIP: 1, LUMEN: 1, CONTROL: 1 };

/** Break a line into syllables: { v vowel, c consonant class ('f' fricative, 'p' plosive, 'n' nasal or liquid, ''), first, pause, q }. */
export function syllablesOf(text) {
  const out = [];
  const words = String(text || '').split(/\s+/).filter(Boolean);
  for (let wi = 0; wi < words.length; wi++) {
    const raw = words[wi];
    const w = raw.toLowerCase().replace(/[^a-z0-9]/g, '');
    if (!w) continue;
    const tail = raw.slice(-1);
    const pause = tail === '.' || tail === '?' || tail === '!' ? 2 : tail === ',' || tail === ':' || tail === ';' ? 1 : 0;
    const q = tail === '?';
    const before = out.length;
    if (/^[0-9]+$/.test(w)) {
      out.push({ v: 'o', c: 'f', first: true, pause, q });
    } else {
      const re = /[aeiouy]+/g;
      let m;
      const groups = [];
      while ((m = re.exec(w))) groups.push({ at: m.index, s: m[0] });
      // a final lone 'e' after a consonant is silent when the word has another vowel group
      if (groups.length > 1) {
        const last = groups[groups.length - 1];
        if (last.s === 'e' && last.at === w.length - 1 && w.length > 3) groups.pop();
      }
      if (!groups.length) groups.push({ at: 0, s: 'e' });
      for (let gi = 0; gi < groups.length; gi++) {
        const g = groups[gi];
        let v = g.s[0] === 'y' ? 'i' : g.s[0];
        if (g.s.length > 1 && /ou|ow|oo/.test(g.s)) v = 'u';
        if (g.s.length > 1 && /ai|ay|ei/.test(g.s)) v = 'e';
        const ch = g.at > 0 ? w[g.at - 1] : '';
        const c = /[sfhzxcvj]/.test(ch) ? 'f' : /[ptkbdgq]/.test(ch) ? 'p' : /[mnlrwy]/.test(ch) ? 'n' : '';
        out.push({ v, c, first: gi === 0, pause: 0, q: false });
      }
    }
    if (out.length > before) { out[out.length - 1].pause = pause; out[out.length - 1].q = q; }
  }
  return out;
}

function hash(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
function rng(seed) { let s = seed || 1; return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; }; }

function satCurve(grit) {
  const k = 1 + clamp(grit, 0, 1) * 7, n = 512, c = new Float32Array(n), norm = Math.tanh(k);
  for (let i = 0; i < n; i++) { const x = (i * 2) / (n - 1) - 1; c[i] = Math.tanh(k * x) / norm; }
  return c;
}

export class Voice {
  constructor(ac, dest, { getP = () => feel.p.audio } = {}) {
    this.ac = ac; this.getP = getP; this.dest = dest;
    // persistent radio channel
    this.in = ac.createGain(); this.in.gain.value = 1;
    this.hp = ac.createBiquadFilter(); this.hp.type = 'highpass'; this.hp.frequency.value = 340; this.hp.Q.value = 0.8;
    this.pres = ac.createBiquadFilter(); this.pres.type = 'peaking'; this.pres.frequency.value = 1700; this.pres.Q.value = 0.9; this.pres.gain.value = 4;
    this.lp = ac.createBiquadFilter(); this.lp.type = 'lowpass'; this.lp.frequency.value = 3300; this.lp.Q.value = 0.8;
    this.shaper = ac.createWaveShaper(); this.shaper.oversample = 'none';
    this.gritApplied = -1; this._grit(0.35);
    this.outG = ac.createGain(); this.outG.gain.value = 0.21;
    this.in.connect(this.hp); this.hp.connect(this.pres); this.pres.connect(this.shaper); this.shaper.connect(this.lp); this.lp.connect(this.outG); this.outG.connect(dest);
    // cold echo for the REGENT (only fed by REGENT barks)
    this.echoIn = ac.createGain(); this.echoIn.gain.value = 1;
    const d = ac.createDelay(0.5); d.delayTime.value = 0.115;
    const fb = ac.createGain(); fb.gain.value = 0.32;
    const elp = ac.createBiquadFilter(); elp.type = 'lowpass'; elp.frequency.value = 1900;
    const wet = ac.createGain(); wet.gain.value = 0.55;
    this.echoIn.connect(d); d.connect(elp); elp.connect(fb); fb.connect(d); elp.connect(wet); wet.connect(this.hp);
    this.busy = 0;
    this.barks = 0;
  }

  _grit(g) {
    if (Math.abs(g - this.gritApplied) < 0.02) return;
    this.gritApplied = g; this.shaper.curve = satCurve(g);
  }

  /** Radio settings from the registry (radioLow/High/Grit), applied when a bark starts. */
  _radio(P) {
    const t = this.ac.currentTime;
    this.hp.frequency.setTargetAtTime(P.radioLow, t, 0.01);
    this.lp.frequency.setTargetAtTime(P.radioHigh, t, 0.01);
    this._grit(P.radioGrit);
  }

  /**
   * speaker: 'VEX' | 'FERRO' | 'REGENT' | 'PIP' | 'LUMEN' | 'CONTROL' | 'SABLE'. text: the comm line. o: { t, duration, volume, rand }.
   * Returns the length in seconds of the sound (0 when the speaker has none).
   */
  speak(speaker, text, o = {}) {
    const P = this.getP();
    const sp = String(speaker || '').toUpperCase();
    const t = o.t ?? this.ac.currentTime + 0.03;
    const typed = clamp(String(text || '').length / 44, 0.35, 2.6);
    const dur = o.duration ?? typed;
    this._radio(P);
    let len = 0;
    if (PROFILES[sp]) len = this._bark(sp, String(text || ''), t, dur, o.volume ?? 1, P, o.rand);
    else if (BLIPS[sp]) len = this._blips(sp, String(text || ''), t, dur, o.volume ?? 1, P, o.rand);
    if (len > 0) this.barks++;
    return len;
  }

  _bark(sp, text, t0, typed, vol, P, rand) {
    const ac = this.ac, pr = PROFILES[sp];
    const rate = clamp(P.voiceRate, 0.5, 2);
    const syl = pr.syl / rate, gap = pr.gap / rate, wgap = pr.wordGap / rate;
    const all = syllablesOf(text);
    if (!all.length) return 0;
    const pace = syl + gap + 0.02;
    const m = clamp(Math.round(typed / pace), 3, pr.maxSyl);
    const pick = [];
    if (all.length <= m) pick.push(...all);
    else for (let i = 0; i < m; i++) pick.push(all[Math.round((i * (all.length - 1)) / (m - 1))]);
    const r = rand || rng(hash(sp + text));
    const question = /\?\s*$/.test(text);
    const excl = /!\s*$/.test(text);

    // ---- graph
    const nodes = [];
    const mk = (n) => { nodes.push(n); return n; };
    const g = (v = 0) => { const n = mk(ac.createGain()); n.gain.value = v; return n; };
    const bp = (f, q) => { const n = mk(ac.createBiquadFilter()); n.type = 'bandpass'; n.frequency.value = f; n.Q.value = q; return n; };
    const src = g(1);
    const osc = mk(ac.createOscillator()); osc.type = 'sawtooth'; osc.frequency.value = pr.f0 * P.voicePitch;
    osc.connect(src);
    let osc2 = null;
    if (pr.double) {
      osc2 = mk(ac.createOscillator()); osc2.type = 'sawtooth'; osc2.frequency.value = pr.f0 * P.voicePitch; osc2.detune.value = 14;
      const sub = g(0.5); osc2.connect(sub); sub.connect(src);
    }
    const nz = mk(ac.createBufferSource()); nz.buffer = getNoise(ac).white; nz.loop = true;
    const asp = g(pr.breath); nz.connect(asp); asp.connect(src);
    const forms = [bp(500, 8), bp(1500, 10), bp(2500, 12)];
    const env = g(0);
    const fsum = g(1.0);
    forms.forEach((f, i) => { const fg = g(FORM_GAIN[i]); src.connect(f); f.connect(fg); fg.connect(fsum); });
    let nasal = null;
    if (pr.nasal) { nasal = bp(1150, 5); const ng = g(0.35); src.connect(nasal); nasal.connect(ng); ng.connect(fsum); }
    fsum.connect(env);
    const outBus = g(0.5 * vol * pr.level);
    env.connect(outBus);
    // consonant noise and static share the noise source
    const cBP = bp(3500, 1.2), cG = g(0); nz.connect(cBP); cBP.connect(cG); cG.connect(outBus);
    const bedHP = mk(ac.createBiquadFilter()); bedHP.type = 'highpass'; bedHP.frequency.value = 900;
    const bedBP = bp(2200, 0.35), bedG = g(0);
    nz.connect(bedHP); bedHP.connect(bedBP); bedBP.connect(bedG);
    const staticK = P.radioStatic;
    outBus.connect(this.in);
    bedG.connect(this.in);
    if (pr.echo) { outBus.connect(this.echoIn); }

    // ---- schedule
    let t = t0 + 0.02;   // room for the key click
    const startT = t;
    nz.start(t0, Math.random() * 1.5);
    osc.start(t0); if (osc2) osc2.start(t0);
    bedG.gain.setValueAtTime(0.0001, t0);
    bedG.gain.linearRampToValueAtTime(0.05 * staticK, t0 + 0.004);            // key click
    bedG.gain.exponentialRampToValueAtTime(0.011 * staticK + 0.0001, t0 + 0.03);   // static bed
    const n = pick.length;
    for (let i = 0; i < n; i++) {
      const s = pick[i], u = n > 1 ? i / (n - 1) : 0;
      const form = FORMANTS[s.v] || FORMANTS.e;
      let f = pr.f0 * P.voicePitch * (1 + pr.decl * u) * (1 + (r() * 2 - 1) * pr.span * 0.5);
      if (s.first) f *= 1 + pr.stress;
      if (question && u > 0.6) f *= 1 + 0.16 * ((u - 0.6) / 0.4);
      if (excl && i === n - 1) f *= 1.06;
      const amp = (s.first ? 1 : 0.8) * (0.85 + r() * 0.3) * (i === n - 1 ? 0.8 : 1);
      // consonant before the vowel
      const cl = s.c === 'f' ? 0.045 : s.c === 'p' ? 0.012 : 0;
      if (cl > 0) {
        const ct = t;
        cBP.frequency.setValueAtTime(s.c === 'f' ? 4200 + r() * 1400 : 1800 + r() * 1400, ct);
        cG.gain.setValueAtTime(0.0001, ct);
        cG.gain.linearRampToValueAtTime((s.c === 'f' ? 0.34 : 0.55) * amp, ct + 0.004);
        cG.gain.exponentialRampToValueAtTime(0.0001, ct + cl);
        t += cl * 0.7;
      }
      osc.frequency.setTargetAtTime(f, t - 0.006, 0.012);
      if (osc2) osc2.frequency.setTargetAtTime(f, t - 0.006, 0.012);
      forms.forEach((fl, k) => fl.frequency.setTargetAtTime(form[k] * pr.shift, t - 0.006, 0.012));
      const on = syl * pr.clip;
      env.gain.setValueAtTime(0.0001, t);
      env.gain.linearRampToValueAtTime(amp, t + 0.014);
      env.gain.setValueAtTime(amp, t + Math.max(0.016, on - 0.02));
      env.gain.exponentialRampToValueAtTime(0.0001, t + on + 0.012);
      t += syl + gap + (s.pause === 2 ? wgap * 2.4 : s.pause === 1 ? wgap * 1.6 : s.first ? wgap * 0.5 : 0);
    }
    const end = t + 0.03;
    // squelch tail
    bedG.gain.cancelScheduledValues(end);
    bedG.gain.setValueAtTime(0.011 * staticK + 0.0001, end);
    bedG.gain.linearRampToValueAtTime(0.038 * staticK + 0.0001, end + 0.004);
    bedG.gain.exponentialRampToValueAtTime(0.0001, end + 0.06);
    const stopAt = end + (pr.echo ? 0.75 : 0.12);
    nz.stop(stopAt); osc.stop(stopAt); if (osc2) osc2.stop(stopAt);
    osc.onended = () => { for (const nd of nodes) { try { nd.disconnect(); } catch (e) { /* gone */ } } };
    return end - t0 + 0.06;
  }

  _blips(sp, text, t0, typed, vol, P, rand) {
    const ac = this.ac;
    const r = rand || rng(hash(sp + text));
    const words = Math.max(1, text.split(/\s+/).filter(Boolean).length);
    const level = 0.3 * vol * P.blipLevel;
    const nodes = [];
    const list = [];
    const tone = (type, f, at, len, a, lpHz) => {
      const o = ac.createOscillator(); o.type = type; o.frequency.setValueAtTime(f, at);
      const e = ac.createGain(); e.gain.setValueAtTime(0.0001, at);
      e.gain.linearRampToValueAtTime(a, at + 0.004);
      e.gain.exponentialRampToValueAtTime(0.0001, at + len);
      let node = o;
      if (lpHz) { const l = ac.createBiquadFilter(); l.type = 'lowpass'; l.frequency.value = lpHz; o.connect(l); node = l; nodes.push(l); }
      node.connect(e); e.connect(this.in);
      o.start(at); o.stop(at + len + 0.02);
      nodes.push(o, e); list.push(o);
    };
    let t = t0 + 0.02, end = t;
    if (sp === 'PIP') {
      const n = clamp(Math.round(words * 0.7), 2, 7), scale = [1568, 1760, 1976, 2349, 2637];
      let k = 1;
      for (let i = 0; i < n; i++) {
        k = clamp(k + (r() < 0.65 ? 1 : -1) * (r() < 0.3 ? 2 : 1), 0, scale.length - 1);
        const f = scale[k] * (i === n - 1 ? 1.12 : 1);
        tone('triangle', f, t, 0.034, 0.16 * level, 5200);
        t += 0.055; end = t;
      }
    } else if (sp === 'LUMEN') {
      const n = clamp(Math.round(words * 0.4), 2, 4);
      for (let i = 0; i < n; i++) {
        tone('sine', i === n - 1 ? 880 : 1175, t, 0.06, 0.2 * level, 4200);
        tone('sine', (i === n - 1 ? 880 : 1175) * 2, t, 0.03, 0.04 * level);
        t += 0.1; end = t;
      }
    } else {
      // CONTROL: fast two note square pattern and a crackle of noise
      const n = clamp(Math.round(words * 0.5), 3, 6);
      for (let i = 0; i < n; i++) {
        tone('square', i % 2 ? 1050 : 700, t, 0.03, 0.09 * level, 2600);
        t += 0.048; end = t;
      }
      const nz = ac.createBufferSource(); nz.buffer = getNoise(ac).white;
      const f = ac.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 2400; f.Q.value = 1.2;
      const e = ac.createGain(); e.gain.setValueAtTime(0.0001, t0 + 0.02); e.gain.linearRampToValueAtTime(0.05 * level, t0 + 0.03);
      e.gain.exponentialRampToValueAtTime(0.0001, end + 0.05);
      nz.connect(f); f.connect(e); e.connect(this.in); nz.start(t0 + 0.02, r() * 1.5); nz.stop(end + 0.08);
      nodes.push(nz, f, e);
    }
    // key click / squelch
    const nz2 = ac.createBufferSource(); nz2.buffer = getNoise(ac).white;
    const hp = ac.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 1500;
    const ce = ac.createGain();
    ce.gain.setValueAtTime(0.0001, t0); ce.gain.linearRampToValueAtTime(0.04 * P.radioStatic, t0 + 0.003); ce.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.025);
    ce.gain.setValueAtTime(0.0001, end); ce.gain.linearRampToValueAtTime(0.03 * P.radioStatic, end + 0.003); ce.gain.exponentialRampToValueAtTime(0.0001, end + 0.04);
    nz2.connect(hp); hp.connect(ce); ce.connect(this.in);
    nz2.start(t0, r() * 1.5); nz2.stop(end + 0.08);
    nodes.push(nz2, hp, ce);
    nz2.onended = () => { for (const nd of nodes) { try { nd.disconnect(); } catch (e) { /* gone */ } } };
    return end - t0 + 0.06;
  }
}
