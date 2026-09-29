// Synth instruments and drums for the music sequencer. Every function schedules at absolute time t.
import { mtof, getNoise } from './synth.js';

function cleanup(src, nodes) {
  src.onended = () => { for (const n of nodes) { try { n.disconnect(); } catch (e) { /* ignore */ } } };
}

function env(g, t, peak, a, dec, sus, dur, rel) {
  const p = Math.max(0.0002, peak);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(p, t + a);
  const susT = Math.min(t + a + dec, t + Math.max(a + 0.01, dur));
  g.gain.exponentialRampToValueAtTime(Math.max(0.0002, p * sus), susT);
  g.gain.setValueAtTime(Math.max(0.0002, p * sus), Math.max(susT, t + dur));
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur + rel);
}

function vibrato(ac, oscs, t, dur, depth = 9, rate = 5.6, delay = 0.18) {
  if (dur < 0.3) return null;
  const lfo = ac.createOscillator();
  lfo.frequency.value = rate;
  const amt = ac.createGain();
  amt.gain.setValueAtTime(0, t);
  amt.gain.linearRampToValueAtTime(depth, t + delay + 0.25);
  lfo.connect(amt);
  for (const o of oscs) amt.connect(o.detune);
  lfo.start(t); lfo.stop(t + dur + 0.4);
  return [lfo, amt];
}

/** Lead voice. style: brass | square | strings | bell */
export function leadNote(ac, out, send, t, dur, midi, vel = 1, style = 'brass') {
  const f = mtof(midi);
  const g = ac.createGain();
  const lp = ac.createBiquadFilter();
  lp.type = 'lowpass'; lp.Q.value = 1.1;
  const nodes = [g, lp];
  const oscs = [];
  const mk = (type, freq, detune, gain) => {
    const o = ac.createOscillator(); o.type = type; o.frequency.value = freq; o.detune.value = detune;
    if (gain !== 1) { const gg = ac.createGain(); gg.gain.value = gain; o.connect(gg); gg.connect(lp); nodes.push(gg); } else o.connect(lp);
    oscs.push(o); nodes.push(o);
  };
  let peak = 0.1 * vel, a = 0.014, rel = 0.09;
  if (style === 'brass') {
    mk('sawtooth', f, -7, 1); mk('sawtooth', f, 7, 1); mk('square', f, 0, 0.5);
    lp.frequency.setValueAtTime(Math.min(f * 2.2, 3000), t);
    lp.frequency.exponentialRampToValueAtTime(Math.min(f * 7, 7500), t + 0.05);
    lp.frequency.exponentialRampToValueAtTime(Math.min(f * 3.6, 4200), t + Math.max(0.1, dur));
  } else if (style === 'square') {
    mk('square', f, -5, 1); mk('square', f * 2, 4, 0.22); mk('triangle', f, 0, 0.6);
    lp.frequency.setValueAtTime(Math.min(f * 6, 6000), t);
    lp.frequency.exponentialRampToValueAtTime(Math.min(f * 3, 3500), t + dur);
    peak = 0.085 * vel;
  } else if (style === 'strings') {
    mk('sawtooth', f, -11, 1); mk('sawtooth', f, 11, 1); mk('triangle', f * 0.5, 0, 0.6);
    lp.frequency.value = Math.min(f * 3.2, 2600);
    a = 0.18; rel = 0.45; peak = 0.08 * vel;
  } else { // bell
    mk('sine', f, 0, 1); mk('sine', f * 2.005, 0, 0.35); mk('triangle', f * 4, 0, 0.1);
    lp.frequency.value = 9000; peak = 0.075 * vel; a = 0.004; rel = 0.5;
    dur = Math.min(dur, 0.5);
  }
  env(g, t, peak, a, style === 'strings' ? 0.3 : 0.12, style === 'bell' ? 0.3 : 0.72, dur, rel);
  const vib = style === 'bell' ? null : vibrato(ac, oscs, t, dur, style === 'strings' ? 14 : 8);
  lp.connect(g); g.connect(out); if (send) g.connect(send);
  for (const o of oscs) { o.start(t); o.stop(t + dur + rel + 0.06); }
  if (vib) nodes.push(...vib);
  cleanup(oscs[0], nodes);
}

/** Sustained chord pad. style: strings | space */
export function padChord(ac, out, send, t, dur, notes, style = 'strings', vol = 1) {
  const rel = 0.7;
  const a = style === 'space' ? 0.9 : 0.35;
  notes.forEach((m, i) => {
    const f = mtof(m);
    const g = ac.createGain();
    const lp = ac.createBiquadFilter(); lp.type = 'lowpass'; lp.Q.value = 0.5;
    const oscs = [];
    const nodes = [g, lp];
    const add = (type, freq, det, gain) => {
      const o = ac.createOscillator(); o.type = type; o.frequency.value = freq; o.detune.value = det;
      if (gain !== 1) { const gg = ac.createGain(); gg.gain.value = gain; o.connect(gg); gg.connect(lp); nodes.push(gg); } else o.connect(lp);
      oscs.push(o); nodes.push(o);
    };
    if (style === 'space') {
      add('triangle', f, -6, 1); add('sine', f * 2, 5, 0.45); add('triangle', f * 1.0, 8, 0.6);
      lp.frequency.setValueAtTime(1800, t);
    } else {
      add('sawtooth', f, -9, 1); add('sawtooth', f, 9, 1);
      lp.frequency.setValueAtTime(700, t);
      lp.frequency.linearRampToValueAtTime(1500, t + dur * 0.6);
    }
    const peak = (style === 'space' ? 0.06 : 0.05) * vol / Math.sqrt(notes.length / 3);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t + a);
    g.gain.setValueAtTime(Math.max(0.0002, peak), t + Math.max(a, dur - 0.05));
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur + rel);
    lp.connect(g); g.connect(out); if (send && style === 'space') g.connect(send);
    for (const o of oscs) { o.start(t); o.stop(t + dur + rel + 0.05); }
    cleanup(oscs[0], nodes);
  });
}

export function bassNote(ac, out, t, dur, midi, vel = 1, style = 'saw') {
  const f = mtof(midi);
  const g = ac.createGain();
  const lp = ac.createBiquadFilter(); lp.type = 'lowpass'; lp.Q.value = 2.2;
  lp.frequency.setValueAtTime(Math.min(f * 14, 2200) * (0.5 + vel * 0.5), t);
  lp.frequency.exponentialRampToValueAtTime(Math.max(140, f * 2.5), t + 0.12);
  const o1 = ac.createOscillator(); o1.type = style === 'square' ? 'square' : 'sawtooth'; o1.frequency.value = f;
  const o2 = ac.createOscillator(); o2.type = 'sine'; o2.frequency.value = f;
  const sub = ac.createGain(); sub.gain.value = 0.9;
  o1.connect(lp); o2.connect(sub); sub.connect(g); lp.connect(g);
  env(g, t, (style === 'square' ? 0.085 : 0.1) * vel, 0.006, 0.1, 0.75, Math.max(0.05, dur), 0.05);
  g.connect(out);
  const end = t + dur + 0.12;
  o1.start(t); o2.start(t); o1.stop(end); o2.stop(end);
  cleanup(o1, [o1, o2, g, lp, sub]);
}

export function arpNote(ac, out, send, t, midi, vel = 1, len = 0.2) {
  const f = mtof(midi);
  const g = ac.createGain();
  const lp = ac.createBiquadFilter(); lp.type = 'lowpass'; lp.Q.value = 1.4;
  lp.frequency.setValueAtTime(Math.min(f * 8, 6000), t);
  lp.frequency.exponentialRampToValueAtTime(Math.max(400, f * 1.6), t + len);
  const o1 = ac.createOscillator(); o1.type = 'triangle'; o1.frequency.value = f;
  const o2 = ac.createOscillator(); o2.type = 'square'; o2.frequency.value = f; o2.detune.value = 6;
  const g2 = ac.createGain(); g2.gain.value = 0.35;
  o1.connect(lp); o2.connect(g2); g2.connect(lp);
  env(g, t, 0.11 * vel, 0.003, len, 0.05, len * 0.6, 0.03);
  lp.connect(g); g.connect(out); if (send) g.connect(send);
  const end = t + len * 1.6 + 0.1;
  o1.start(t); o2.start(t); o1.stop(end); o2.stop(end);
  cleanup(o1, [o1, o2, g, lp, g2]);
}

export function stab(ac, out, t, dur, notes, vel = 1) {
  const g = ac.createGain();
  const lp = ac.createBiquadFilter(); lp.type = 'lowpass'; lp.Q.value = 1.2;
  lp.frequency.setValueAtTime(450, t);
  lp.frequency.exponentialRampToValueAtTime(3600, t + 0.035);
  lp.frequency.exponentialRampToValueAtTime(900, t + dur);
  const nodes = [g, lp];
  let first = null;
  const oscs = [];
  for (const m of notes) {
    for (const det of [-8, 8]) {
      const o = ac.createOscillator(); o.type = 'sawtooth'; o.frequency.value = mtof(m); o.detune.value = det;
      o.connect(lp); oscs.push(o); nodes.push(o);
      first = first || o;
    }
  }
  env(g, t, (0.075 * vel) / Math.sqrt(notes.length / 3), 0.01, 0.1, 0.6, dur, 0.07);
  lp.connect(g); g.connect(out);
  for (const o of oscs) { o.start(t); o.stop(t + dur + 0.14); }
  if (first) cleanup(first, nodes);
}

// ==== drums
function nz(ac, out, t, dur, vol, type, f0, f1, q = 0.8) {
  const src = ac.createBufferSource();
  src.buffer = getNoise(ac).white; src.loop = true;
  const f = ac.createBiquadFilter(); f.type = type; f.Q.value = q;
  f.frequency.setValueAtTime(f0, t);
  if (f1 && f1 !== f0) f.frequency.exponentialRampToValueAtTime(f1, t + dur);
  const g = ac.createGain();
  g.gain.setValueAtTime(vol, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  src.connect(f); f.connect(g); g.connect(out);
  src.start(t, Math.random()); src.stop(t + dur + 0.02);
  cleanup(src, [src, f, g]);
}

export function kick(ac, out, t, vel = 1) {
  const o = ac.createOscillator(); o.type = 'sine';
  o.frequency.setValueAtTime(165, t);
  o.frequency.exponentialRampToValueAtTime(46, t + 0.11);
  const g = ac.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(0.55 * vel, t + 0.004);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.32);
  o.connect(g); g.connect(out);
  o.start(t); o.stop(t + 0.35);
  cleanup(o, [o, g]);
  nz(ac, out, t, 0.02, 0.14 * vel, 'highpass', 2500, 2500);
}

export function snare(ac, out, t, vel = 1) {
  nz(ac, out, t, 0.2, 0.3 * vel, 'bandpass', 2100, 1400, 0.7);
  nz(ac, out, t, 0.09, 0.16 * vel, 'highpass', 5000, 5000);
  const o = ac.createOscillator(); o.type = 'triangle';
  o.frequency.setValueAtTime(220, t);
  o.frequency.exponentialRampToValueAtTime(140, t + 0.1);
  const g = ac.createGain();
  g.gain.setValueAtTime(0.18 * vel, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.12);
  o.connect(g); g.connect(out);
  o.start(t); o.stop(t + 0.14);
  cleanup(o, [o, g]);
}

export function hat(ac, out, t, open = false, vel = 1) {
  nz(ac, out, t, open ? 0.24 : 0.045, (open ? 0.12 : 0.15) * vel, 'highpass', 7500, 7500, 0.5);
}

export function crash(ac, out, t, vel = 1) {
  nz(ac, out, t, 1.5, 0.14 * vel, 'highpass', 4200, 3000, 0.4);
  nz(ac, out, t, 0.6, 0.06 * vel, 'bandpass', 8000, 6000, 0.7);
}

export function tom(ac, out, t, freq = 120, vel = 1) {
  const o = ac.createOscillator(); o.type = 'sine';
  o.frequency.setValueAtTime(freq * 1.6, t);
  o.frequency.exponentialRampToValueAtTime(freq, t + 0.12);
  const g = ac.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(0.45 * vel, t + 0.005);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.3);
  o.connect(g); g.connect(out);
  o.start(t); o.stop(t + 0.32);
  cleanup(o, [o, g]);
}
