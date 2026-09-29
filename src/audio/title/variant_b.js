// Title variant B: dark synthwave. A minor with phrygian and dorian touches, 92 BPM, 32 bars.
// Pulsing saw+sub bass with a moving lowpass, tight kick with sidechain-style ducking, gated-reverb clap, sparse swung hats,
// detuned chorused pad with a slow filter sweep, a sparse arp that opens and closes, and a minimal portamento lead that states
// a leaping motif and answers it later. Tape saturation and flutter, dark ping-pong delay, procedural reverb.
// Arc: intro (pad+pulse) > kick enters > backbeat, hats, arp + motif > restrained peak + variation > breakdown > intro again.
import { mtof, tone, noise } from '../synth.js';
import {
  BPM, BARS, BEAT, BAR, CHORDS, BAR_CHORD, SPAN_AT, energy, drumPlan, arpSteps, arpLadder,
  ARP_SEQ_A, ARP_SEQ_B, LEAD, BASS_A, BASS_B, mulberry32, inRange,
} from './b/score.js';
import { buildFx } from './b/fx.js';

export const meta = {
  id: 'b',
  name: 'Dark synthwave',
  description: 'Slow A minor synthwave ballad: pulsing filtered bass, gated clap, chorused pad, sparse arp and a leaping lead motif.',
  bpm: BPM,
  bars: BARS,
};

const TWO_PI = Math.PI * 2;
const lerp = (a, b, x) => a + (b - a) * x;

export function create(ac, out) {
  const fx = buildFx(ac, out);
  let lastLeadMidi = 69;
  let lastLeadEnd = -1e9;

  const free = (nodes) => (ev) => { for (const n of nodes) { try { n.disconnect(); } catch (e) { /* ignore */ } } };

  // pad: two detuned saws per chord tone, panned wide, slow lowpass sweep
  function padChord(t, name, span, bar, rnd) {
    const chord = CHORDS[name];
    const dur = span * BAR + 0.15;
    const a = span > 1 ? 1.1 : 0.6;
    const rel = 1.7;
    const end = t + dur + rel;
    const cut = (e) => 330 * Math.pow(7.6, e);
    const flt = ac.createBiquadFilter();
    flt.type = 'lowpass'; flt.Q.value = 1.3;
    flt.frequency.setValueAtTime(cut(energy(bar)), t);
    flt.frequency.exponentialRampToValueAtTime(cut(energy(bar + span)), t + span * BAR);
    const g = ac.createGain();
    const e = energy(bar);
    const vol = 0.045 * (0.62 + 0.5 * e) * (bar >= 28 ? 0.6 : bar >= 24 ? 0.72 : 1); // breakdown is thinner
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(vol, t + a);
    g.gain.setValueAtTime(vol, t + dur);
    g.gain.linearRampToValueAtTime(0.0001, end);
    flt.connect(g); g.connect(fx.padBus);
    const nodes = [flt, g];
    let last = null;
    chord.pad.forEach((m, i) => {
      const f = mtof(m);
      [-1, 1].forEach((side) => {
        const o = ac.createOscillator();
        o.type = 'sawtooth'; o.frequency.value = f;
        o.detune.value = side * (9 + rnd() * 3) + (rnd() - 0.5) * 2;
        const p = ac.createStereoPanner(); p.pan.value = side * (0.35 + 0.15 * (i % 2));
        o.connect(p); p.connect(flt);
        o.start(t); o.stop(end + 0.05);
        nodes.push(o, p); last = o;
      });
    });
    // a soft triangle an octave under the root for body
    const sub = ac.createOscillator(); sub.type = 'triangle'; sub.frequency.value = mtof(chord.pad[0] - 12);
    const sg = ac.createGain(); sg.gain.value = 0.6;
    sub.connect(sg); sg.connect(flt); sub.start(t); sub.stop(end + 0.05); nodes.push(sub, sg);
    last.onended = free(nodes);
  }

  // bass: saw pair + sub, 8th note pulse, resonant lowpass with envelope and slow movement
  function bassNote(t, midi, dur, vol, cut) {
    const f = mtof(midi);
    const flt = ac.createBiquadFilter();
    flt.type = 'lowpass'; flt.Q.value = 3.8;
    flt.frequency.setValueAtTime(cut * 2.5, t);
    flt.frequency.exponentialRampToValueAtTime(cut, t + 0.17);
    const g = ac.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.006);
    g.gain.exponentialRampToValueAtTime(vol * 0.62, t + 0.13);
    g.gain.setValueAtTime(vol * 0.62, t + dur);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur + 0.07);
    const nodes = [flt, g];
    const mk = (type, freq, det, gain) => {
      const o = ac.createOscillator(); o.type = type; o.frequency.value = freq; o.detune.value = det;
      const gg = ac.createGain(); gg.gain.value = gain;
      o.connect(gg); gg.connect(flt); o.start(t); o.stop(t + dur + 0.15);
      nodes.push(o, gg); return o;
    };
    mk('sawtooth', f, -6, 0.5); mk('sawtooth', f, 6, 0.5);
    const sub = mk('sine', f / 2, 0, 0.9);
    flt.connect(g); g.connect(fx.bassBus);
    sub.onended = free(nodes);
  }

  function bassDrone(t, midi, span, bar) {
    const dur = span * BAR;
    const vol = 0.04 + 0.1 * energy(bar);
    const g = ac.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(vol, t + 1.0);
    g.gain.setValueAtTime(vol, t + dur);
    g.gain.linearRampToValueAtTime(0.0001, t + dur + 1.5);
    const o = ac.createOscillator(); o.type = 'sine'; o.frequency.value = mtof(midi);
    const o2 = ac.createOscillator(); o2.type = 'triangle'; o2.frequency.value = mtof(midi) * 2.004;
    const g2 = ac.createGain(); g2.gain.value = 0.12;
    o.connect(g); o2.connect(g2); g2.connect(g); g.connect(fx.bassBus);
    o.start(t); o2.start(t); o.stop(t + dur + 1.6); o2.stop(t + dur + 1.6);
    o.onended = free([o, o2, g, g2]);
  }

  // drums
  function kick(t, vel) {
    tone(ac, fx.kickBus, { type: 'sine', f0: 150, f1: 45, t, dur: 0.34, sweep: 0.22, vol: 0.4 * vel, a: 0.002, hold: 0.1 });
    tone(ac, fx.kickBus, { type: 'triangle', f0: 320, f1: 90, t, dur: 0.05, sweep: 0.8, vol: 0.1 * vel, a: 0.001 });
    noise(ac, fx.kickBus, { t, dur: 0.018, vol: 0.04 * vel, type: 'highpass', f0: 2500, q: 0.7, a: 0.001, offset: 0.3 });
    fx.duck(t);
  }

  function clap(t, vel, rnd) {
    // three fast bursts and a longer tail, plus a short snare body, then a hard-gated reverb tail via the snare bus
    const off = () => rnd();
    noise(ac, fx.snareBus, { t, dur: 0.014, vol: 0.57 * vel, type: 'bandpass', f0: 1500, q: 1.1, a: 0.001, offset: off() });
    noise(ac, fx.snareBus, { t: t + 0.011, dur: 0.014, vol: 0.62 * vel, type: 'bandpass', f0: 1600, q: 1.1, a: 0.001, offset: off() });
    noise(ac, fx.snareBus, { t: t + 0.022, dur: 0.02, vol: 0.62 * vel, type: 'bandpass', f0: 1500, q: 1.0, a: 0.001, offset: off() });
    noise(ac, fx.snareBus, { t: t + 0.03, dur: 0.16, vol: 0.44 * vel, type: 'bandpass', f0: 1700, f1: 900, q: 0.8, a: 0.002, offset: off() });
    tone(ac, fx.snareBus, { type: 'triangle', f0: 205, f1: 140, t, dur: 0.11, sweep: 0.5, vol: 0.25 * vel, a: 0.001 });
    fx.gate(t);
  }

  function hat(t, vel, rnd) {
    noise(ac, fx.hatBus, { t, dur: 0.05, vol: 0.19 * vel, type: 'highpass', f0: 7400, q: 0.7, a: 0.001, offset: rnd() });
  }

  // arp: short filtered plucks, cutoff and level follow the energy arc
  function arpNote(t, midi, vel, e) {
    const f = mtof(midi);
    const cut = 520 * Math.pow(7.2, e);
    const flt = ac.createBiquadFilter();
    flt.type = 'lowpass'; flt.Q.value = 2.2;
    flt.frequency.setValueAtTime(cut * 1.9, t);
    flt.frequency.exponentialRampToValueAtTime(cut * 0.7, t + 0.2);
    const g = ac.createGain();
    const vol = 0.14 * vel * (0.45 + 0.75 * e);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.24);
    const nodes = [flt, g];
    let last = null;
    [['sawtooth', -8], ['square', 8]].forEach(([type, det], i) => {
      const o = ac.createOscillator(); o.type = type; o.frequency.value = f; o.detune.value = det;
      const gg = ac.createGain(); gg.gain.value = i ? 0.45 : 0.7;
      o.connect(gg); gg.connect(flt); o.start(t); o.stop(t + 0.3);
      nodes.push(o, gg); last = o;
    });
    flt.connect(g); g.connect(fx.arpBus);
    last.onended = free(nodes);
  }

  // lead: triangle + softly filtered square, portamento, no vibrato
  function leadNote(t, dur, midi, vol, rnd) {
    const glideFrom = t - lastLeadEnd < BEAT * 2.5 ? lastLeadMidi : midi - 4;
    const f = mtof(midi), f0 = mtof(glideFrom);
    const glide = 0.11 + rnd() * 0.03;
    const flt = ac.createBiquadFilter();
    flt.type = 'lowpass'; flt.Q.value = 0.9;
    flt.frequency.setValueAtTime(900, t);
    flt.frequency.exponentialRampToValueAtTime(2300, t + 0.35);
    flt.frequency.exponentialRampToValueAtTime(1500, t + Math.max(0.5, dur));
    const g = ac.createGain();
    const a = 0.035, rel = 0.42;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + a);
    g.gain.exponentialRampToValueAtTime(vol * 0.72, t + Math.max(a + 0.05, dur * 0.6));
    g.gain.setValueAtTime(vol * 0.72, t + dur);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur + rel);
    const nodes = [flt, g];
    let last = null;
    [['triangle', 0, 1], ['square', 0, 0.22], ['triangle', 0, 0.16]].forEach(([type, det, gain], i) => {
      const o = ac.createOscillator(); o.type = type;
      const ff = i === 2 ? f * 2 : f, ff0 = i === 2 ? f0 * 2 : f0;
      o.frequency.setValueAtTime(ff0, t);
      o.frequency.exponentialRampToValueAtTime(ff, t + glide);
      o.detune.value = (i === 2 ? 0 : det) + (rnd() - 0.5) * 6;
      const gg = ac.createGain(); gg.gain.value = gain;
      o.connect(gg); gg.connect(flt); o.start(t); o.stop(t + dur + rel + 0.05);
      nodes.push(o, gg); last = o;
    });
    flt.connect(g); g.connect(fx.leadBus);
    last.onended = free(nodes);
    lastLeadMidi = midi; lastLeadEnd = t + dur;
  }

  // riser into the loop point: quiet filtered noise that swells and is gone by the downbeat
  function riser(t) {
    noise(ac, fx.arpBus, { t, dur: BAR * 0.98, vol: 0.05, type: 'bandpass', f0: 350, f1: 4200, q: 1.6, a: BAR * 0.82, offset: 0.2 });
  }

  return {
    scheduleBar(t0, bar, loop) {
      const rnd = mulberry32(0x9e3779b1 ^ (bar * 7919 + loop * 104729));
      const jit = (ms) => (rnd() - 0.5) * 2 * ms * 0.001;
      const at = (x) => (x < t0 ? t0 : x); // humanization never pulls an event before the bar (also keeps times non-negative)
      const e = energy(bar);
      const chordName = BAR_CHORD[bar];
      const chord = CHORDS[chordName];

      // pad
      if (SPAN_AT[bar]) padChord(t0, chordName, SPAN_AT[bar], bar, rnd);

      // bass: pulse until the breakdown, then a drone per chord
      if (bar < 24) {
        const pat = bar % 2 ? BASS_B : BASS_A;
        for (let s = 0; s < 8; s++) {
          const pos = bar + s / 8;
          const slow = 1 + 0.32 * Math.sin((TWO_PI * pos) / 8) + 0.14 * Math.sin((TWO_PI * pos) / 3.7);
          const cut = (115 + 820 * e) * slow;
          const accent = s % 2 === 0 ? 1 : 0.72;
          const vel = accent * (0.88 + rnd() * 0.24);
          bassNote(at(t0 + (s * BEAT) / 2 + jit(3)), chord.root + pat[s], BEAT * 0.5 * 0.62, 0.14 * (0.55 + 0.5 * e) * vel, cut);
        }
      } else if (SPAN_AT[bar]) {
        bassDrone(t0, chord.root, SPAN_AT[bar], bar);
      }

      // drums
      const plan = drumPlan(bar);
      for (const [b, v] of plan.kicks) kick(at(t0 + b * BEAT + jit(1.5)), v * (0.94 + rnd() * 0.1));
      for (const [b, v] of plan.claps) clap(at(t0 + b * BEAT + jit(2.5)), v * (0.92 + rnd() * 0.12), rnd);
      const swing = 0.09 * BEAT;
      for (const [b, v] of plan.hats) hat(at(t0 + b * BEAT + swing + jit(4)), v * (0.85 + rnd() * 0.3), rnd);
      if (inRange(bar, 16, 24)) {
        // rare swung sixteenth ghosts
        if (rnd() < 0.4) hat(t0 + 3.75 * BEAT + swing + jit(4), 0.35, rnd);
        if (rnd() < 0.25) hat(t0 + 1.25 * BEAT + swing + jit(4), 0.3, rnd);
      }

      // arp: dotted 16th grid subset, weaving through the chord's tones
      const steps = arpSteps(bar);
      if (steps.length) {
        const ladder = arpLadder(chordName);
        const seq = bar % 2 ? ARP_SEQ_B : ARP_SEQ_A;
        steps.forEach((st, i) => {
          const m = ladder[seq[i % seq.length] % ladder.length];
          const sw = st % 2 ? 0.03 * BEAT : 0;
          arpNote(at(t0 + (st * BEAT) / 4 + sw + jit(4)), m, (st === 0 ? 1 : 0.8) * (0.85 + rnd() * 0.3), energy(bar + st / 16));
        });
      }

      // lead motif and its answer
      const ld = LEAD[bar];
      if (ld) for (const ev of ld.ev) leadNote(at(t0 + ev.b * BEAT + jit(7)), ev.d * BEAT, ev.m, ld.vol, rnd);

      // riser into the loop point
      if (bar === BARS - 1) riser(t0);
    },
    dispose() { fx.dispose(); },
  };
}
