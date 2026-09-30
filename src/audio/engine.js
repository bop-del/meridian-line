// Continuous engine voice. Built once, driven every frame by engine.update(dt, state); nothing is created after the constructor.
//
//   rotor   two detuned saws -> low pass (cutoff follows speed)          the body, pitch 42 Hz braking .. 70 cruise .. 128 boost
//   sub     sine an octave down + a quiet fifth                          weight at idle, thins out under boost
//   whine   turbine sine that climbs with speed
//   wind    band passed white noise, climbs and brightens with speed
//   roar    brown noise low pass + bright hiss + 24 Hz tremolo           builds while boosting (build time in the registry)
//   brake   falling sine whine + air brake hiss                          only while braking
//   rattle  gated band noise + slow pitch wobble on the rotor            only when the shield is low
//   out -> StereoPanner (drifts toward the steering side) -> destination bus
//
// state = { speed: -1..1 (0 cruise, 1 full boost, -1 full brake), boost: 0..1, brake: 0..1, steer: -1..1, health: 0..1 (shield
// fraction), playing: bool }. All control values are smoothed in JS and applied with short setTargetAtTime constants, so there is no
// zipper noise. Ranges come from feel.p.audio.eng* (see src/feel/audio.js).
import { feel } from '../core/feel.js';
import { getNoise } from './synth.js';

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const mix = (a, b, t) => a + (b - a) * t;
const fin = (v, d = 0) => (Number.isFinite(v) ? v : d);
const TRIM = 0.72;   // overall engine trim: keeps cruise about as loud as the old engine so music and dialogue stay clear

export class Engine {
  constructor(ac, dest, { getP = () => feel.p.audio } = {}) {
    this.ac = ac;
    this.getP = getP;
    this.s = 0; this.boostEnv = 0; this.brakeEnv = 0; this.rattleEnv = 0; this.steer = 0; this.on = 0;
    this.applied = {};
    this.nodes = [];
    const g = (v = 0) => { const n = ac.createGain(); n.gain.value = v; this.nodes.push(n); return n; };
    const osc = (type, f) => { const o = ac.createOscillator(); o.type = type; o.frequency.value = f; this.nodes.push(o); this.srcs = this.srcs || []; this.srcs.push(o); return o; };
    const filt = (type, f, q) => { const b = ac.createBiquadFilter(); b.type = type; b.frequency.value = f; b.Q.value = q; this.nodes.push(b); return b; };
    const noise = (buf) => {
      const s = ac.createBufferSource(); s.buffer = getNoise(ac)[buf]; s.loop = true;
      this.nodes.push(s); this.srcs = this.srcs || []; this.srcs.push(s);
      return s;
    };

    this.out = g(0);
    this.pan = ac.createStereoPanner ? ac.createStereoPanner() : null;
    if (this.pan) { this.nodes.push(this.pan); this.out.connect(this.pan); this.pan.connect(dest); } else this.out.connect(dest);

    // rotor
    this.oscA = osc('sawtooth', 70); this.oscB = osc('sawtooth', 70); this.oscB.detune.value = 7;
    const rotorIn = g(0.5);
    this.rotorLP = filt('lowpass', 620, 1.4);
    this.rotorG = g(0);
    this.oscA.connect(rotorIn); this.oscB.connect(rotorIn); rotorIn.connect(this.rotorLP); this.rotorLP.connect(this.rotorG); this.rotorG.connect(this.out);
    // sub and fifth
    this.sub = osc('sine', 35); this.subG = g(0);
    this.sub.connect(this.subG); this.subG.connect(this.out);
    this.fifth = osc('triangle', 105); this.fifthG = g(0);
    this.fifth.connect(this.fifthG); this.fifthG.connect(this.out);
    // turbine whine
    this.whine = osc('sine', 520); this.whineG = g(0);
    this.whine.connect(this.whineG); this.whineG.connect(this.out);
    // wind
    this.windSrc = noise('white'); this.windBP = filt('bandpass', 500, 0.7); this.windG = g(0);
    this.windSrc.connect(this.windBP); this.windBP.connect(this.windG); this.windG.connect(this.out);
    // roar (rumble + hiss, with tremolo)
    this.roarSrc = noise('brown'); this.roarLP = filt('lowpass', 250, 0.8); this.trem = g(0.75); this.roarG = g(0);
    this.roarSrc.connect(this.roarLP); this.roarLP.connect(this.trem); this.trem.connect(this.roarG); this.roarG.connect(this.out);
    this.tremLfo = osc('sine', 24); this.tremAmp = g(0);
    this.tremLfo.connect(this.tremAmp); this.tremAmp.connect(this.trem.gain);
    this.hissSrc = noise('white'); this.hissBP = filt('bandpass', 3200, 0.8); this.hissG = g(0);
    this.hissSrc.connect(this.hissBP); this.hissBP.connect(this.hissG); this.hissG.connect(this.out);
    // brake
    this.bWhine = osc('sine', 1100); this.bWhineG = g(0);
    this.bWhine.connect(this.bWhineG); this.bWhineG.connect(this.out);
    this.bHissSrc = noise('white'); this.bHissBP = filt('bandpass', 2600, 1.4); this.bHissG = g(0);
    this.bHissSrc.connect(this.bHissBP); this.bHissBP.connect(this.bHissG); this.bHissG.connect(this.out);
    // rattle: gated band noise (the gate swings around zero, which for noise only reshapes it) plus a pitch wobble
    this.rSrc = noise('white'); this.rBP = filt('bandpass', 1900, 3); this.rGate = g(0); this.rG = g(0);
    this.rSrc.connect(this.rBP); this.rBP.connect(this.rGate); this.rGate.connect(this.rG); this.rG.connect(this.out);
    this.rLfo = osc('square', 12); this.rLfoAmp = g(0);
    this.rLfo.connect(this.rLfoAmp); this.rLfoAmp.connect(this.rGate.gain);
    this.wobLfo = osc('sine', 5.7); this.wobAmp = g(0);
    this.wobLfo.connect(this.wobAmp); this.wobAmp.connect(this.oscA.detune);
    this.wobAmp2 = g(0); this.wobLfo.connect(this.wobAmp2); this.wobAmp2.connect(this.oscB.detune);

    const t = ac.currentTime + 0.01;
    for (const s of this.srcs) { try { s.start(t, s.buffer ? Math.random() * 1.5 : 0); } catch (e) { /* already started */ } }
  }

  /** Smoothly steer one AudioParam toward v (skips changes below 0.2 percent so the timeline stays short). */
  _set(key, param, v, tc = 0.06) {
    v = fin(v);
    const a = this.applied[key];
    if (a !== undefined && Math.abs(a - v) <= 0.002 * Math.max(Math.abs(v), Math.abs(a), 1e-3)) return;
    this.applied[key] = v;
    param.setTargetAtTime(v, this.ac.currentTime, tc);
  }

  update(dt, st) {
    const P = this.getP();
    dt = clamp(fin(dt, 0.016), 0, 0.1);
    const playing = !!st.playing;
    const rate = (cur, tgt, up, down) => cur + (tgt - cur) * (1 - Math.exp(-(tgt > cur ? up : down) * dt));
    const s = clamp(fin(st.speed), -1, 1);
    this.s = Math.abs(s) > Math.abs(this.s) ? rate(this.s, s, 6, 6) : rate(this.s, s, 3.5, 3.5);
    this.boostEnv = rate(this.boostEnv, playing ? clamp(fin(st.boost), 0, 1) : 0, 3 / Math.max(0.05, P.engRoarBuild), 3 / 0.9);
    this.brakeEnv = rate(this.brakeEnv, playing ? clamp(fin(st.brake), 0, 1) : 0, 9, 5);
    const rt = clamp((P.engRattleAt - clamp(fin(st.health, 1), 0, 1)) / Math.max(0.05, P.engRattleAt), 0, 1);
    this.rattleEnv = rate(this.rattleEnv, playing ? rt * P.engRattle : 0, 2.5, 1.5);
    this.steer = rate(this.steer, clamp(fin(st.steer), -1, 1), 5, 5);
    this.on = playing ? 1 : 0;

    const sm = this.s, s01 = (sm + 1) / 2, sp = Math.max(sm, 0), sn = Math.max(-sm, 0);
    const be = this.boostEnv, bre = this.brakeEnv, re = this.rattleEnv, L = P.engLevel;
    // pitch: brake .. cruise .. boost
    const f = sm >= 0 ? mix(P.engCruiseHz, P.engBoostHz, Math.pow(sp, 0.85)) : mix(P.engCruiseHz, P.engBrakeHz, sn);
    const cut = sm >= 0 ? Math.exp(mix(Math.log(P.engCutoffCruise), Math.log(P.engCutoffBoost), Math.pow(sp, 0.9))) : Math.exp(mix(Math.log(P.engCutoffCruise), Math.log(P.engCutoffBrake), sn));

    this._set('out', this.out.gain, this.on * TRIM, this.on ? 0.35 : 0.12);
    this._set('fA', this.oscA.frequency, f, 0.05); this._set('fB', this.oscB.frequency, f, 0.05);
    this._set('fS', this.sub.frequency, f * 0.5, 0.05); this._set('fF', this.fifth.frequency, f * 1.5, 0.05);
    this._set('cut', this.rotorLP.frequency, cut, 0.07);
    this._set('rotorG', this.rotorG.gain, 0.03 * L * (0.55 + Math.pow(s01, 1.3)), 0.08);
    this._set('subG', this.subG.gain, 0.045 * L * (1 - 0.35 * sp) * (1 - 0.2 * sn), 0.08);
    this._set('fifthG', this.fifthG.gain, 0.004 * L + 0.014 * L * sp, 0.08);
    this._set('whineF', this.whine.frequency, mix(500, 1700, s01), 0.06);
    this._set('whineG', this.whineG.gain, (0.003 + 0.022 * sp * sp) * L, 0.08);
    this._set('windF', this.windBP.frequency, 450 + 2400 * Math.pow(s01, 1.4), 0.07);
    this._set('windG', this.windG.gain, (0.006 + 0.03 * s01 * s01) * L, 0.08);
    // boost roar
    this._set('roarF', this.roarLP.frequency, 220 + 1300 * be, 0.08);
    this._set('roarG', this.roarG.gain, 0.13 * Math.pow(be, 1.4) * P.engRoar, 0.06);
    this._set('tremA', this.tremAmp.gain, 0.24 * be, 0.08);
    this._set('hissF', this.hissBP.frequency, 2600 + 1800 * be, 0.08);
    this._set('hissG', this.hissG.gain, 0.04 * be * be * P.engRoar, 0.06);
    // brake
    this._set('bwF', this.bWhine.frequency, 1150 - 520 * bre, 0.05);
    this._set('bwG', this.bWhineG.gain, 0.007 * bre * P.engBrakeWhine, 0.04);
    this._set('bhG', this.bHissG.gain, 0.016 * bre * P.engBrakeWhine, 0.04);
    this._set('bhF', this.bHissBP.frequency, 2800 - 1500 * bre, 0.06);
    // rattle
    this._set('rG', this.rG.gain, 0.2 * re, 0.08);
    this._set('rLfoA', this.rLfoAmp.gain, 0.5 * re, 0.08);
    this._set('wob', this.wobAmp.gain, 34 * re, 0.1); this._set('wob2', this.wobAmp2.gain, 28 * re, 0.1);
    // stereo drift toward the steering side
    if (this.pan) this._set('pan', this.pan.pan, this.steer * P.engSteerPan, 0.12);
  }

  stop() {
    const t = this.ac.currentTime;
    for (const s of this.srcs) { try { s.stop(t + 0.05); } catch (e) { /* ignore */ } }
    setTimeout(() => { for (const n of this.nodes) { try { n.disconnect(); } catch (e) { /* gone */ } } }, 200);
  }

  /** Node count of the whole engine voice (constant after the constructor). */
  get nodeCount() { return this.nodes.length; }
}
