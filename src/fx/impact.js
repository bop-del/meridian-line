// Impact feedback: layered camera shake per event, hit-stop rules, damage feedback, kill and hit-confirm feedback, reticle pulse.
// Module: impact feedback. Read by cameraRig each frame: impact.offset (Vector3, camera-local units) and impact.roll (radians)
// are the ONLY shake source (fx.shake() routes into impact.addShake, fx.shakeOffset/shakeRoll stay zero).
//
// API (stable, other modules call these):
//   impact.addShake(intensity 0..1.5, duration seconds, kind?, dir?)   layered curves, kind is one of SHAKE_KINDS (default 'fx'),
//                                                                      dir {x, y} is the direction the camera is pushed (optional)
//   impact.hitStop(duration, scale, force?)                            budgeted hit-stop, forwards to ctx.game.hitStop
//   impact.offset / impact.roll                                        current shake result, updated in impact.update(dt)
//   impact.reticlePulse                                                0..1, read by the HUD reticle (hit confirm, kill confirm, lock)
//   impact.magnitude                                                   current camera offset length (telemetry)
//   hitDirection(source, playerPos, out)                               unit vector (screen space, +x right, +y up) toward where a hit came from
//
// Model: every addShake call starts a layer. A layer is a decaying oscillation with its own frequency, axis weights and roll
// weight per kind. Layers add up, then the sum goes through a soft cap (tanh), so nothing can exceed the caps in
// feel.p.impact and there is no hard clipping. Shake time runs on the real clock, so a hit-stop freezes the world but the
// camera keeps vibrating (that is what makes a stop read as weight instead of a hang).
//
// Events consumed: player:damage, player:dead, player:roll, bomb:detonate, enemy:hit, enemy:killed, boss:phase, boss:defeated,
// shot:reflected, fx:hitstop, player:lockon.
import * as THREE from 'three';
import { feel } from '../core/feel.js';

const TAU = Math.PI * 2;
const DEG = Math.PI / 180;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

// Static shape per kind. wx, wy, wz: axis weights of the random-direction wave. roll: degrees of roll per world unit of offset.
// pow: envelope power (bigger decays faster). atk: attack time in seconds. rise: envelope rises instead of decaying (charge).
const KINDS = {
  hit: { wx: 1.0, wy: 0.85, wz: 0.12, roll: 2.4, pow: 2.2, atk: 0.006 },
  blast: { wx: 0.9, wy: 1.0, wz: 0.7, roll: 1.65, pow: 1.5, atk: 0.02 },
  boss: { wx: 1.0, wy: 1.0, wz: 0.9, roll: 1.8, pow: 1.25, atk: 0.03 },
  roll: { wx: 0.6, wy: 0.4, wz: 0.1, roll: 3.0, pow: 2.0, atk: 0.01 },
  death: { wx: 1.0, wy: 1.0, wz: 1.0, roll: 2.2, pow: 1.2, atk: 0.04 },
  fx: { wx: 1.0, wy: 0.9, wz: 0.5, roll: 1.3, pow: 1.8, atk: 0.015 },
  charge: { wx: 0.6, wy: 0.6, wz: 0.2, roll: 1.4, pow: 0, atk: 0, rise: true },
  reflect: { wx: 0.8, wy: 0.8, wz: 0.1, roll: 2.3, pow: 2.4, atk: 0.005 },
};
export const SHAKE_KINDS = Object.keys(KINDS);

const N_LAYERS = 20;
const R = Math.random;

/**
 * Direction a hit came from as a unit vector in screen space (+x right, +y up), written into out {x, y, has}.
 * Enemy shots use their velocity (they are already on the ship when the damage event fires), everything else uses the
 * position of the source relative to the ship. has is false when the hit came straight down the view axis.
 */
export function hitDirection(src, playerPos, out = { x: 0, y: 0, has: false }) {
  out.x = 0; out.y = 0; out.has = false;
  if (!src) return out;
  const v = src.velocity;
  if (src.owner === 'enemy' && v) {
    const vl = Math.hypot(v.x, v.y, v.z), vxy = Math.hypot(v.x, v.y);
    if (vl > 1 && vxy / vl > 0.1) { out.x = -v.x / vxy; out.y = -v.y / vxy; out.has = true; }
    return out;
  }
  const sp = src.position;
  if (sp && playerPos) {
    const dx = sp.x - playerPos.x, dy = sp.y - playerPos.y, l = Math.hypot(dx, dy);
    if (l > 0.6) { out.x = dx / l; out.y = dy / l; out.has = true; }
  }
  return out;
}

const _dir = { x: 0, y: 0, has: false };
const _push = { x: 0, y: 0 };

export const impact = {
  ctx: null,
  offset: new THREE.Vector3(),
  roll: 0,
  reticlePulse: 0,
  magnitude: 0,
  lowBeat: 0,               // 0..1 heartbeat of the low health state (the HUD edge glow follows it), 0 when shield is fine
  lowSev: 0,                // 0..1 how low the shield is below the threshold
  hitStopTotal: 0,          // seconds of hit-stop granted since reset (telemetry and tests)
  layers: [],
  _time: 0, _frame: 0,
  _kx: 0, _ky: 0, _kz: 0, _kr: 0,       // camera kick (settles exponentially)
  _dmg: 0,                              // damage pulse 0..1
  _lowPhase: 0,
  _hsBudget: 0.3, _hsAt: -9, _hsDur: 0,
  _post: { damage: 0 },

  _p() { return feel.p.impact; },

  init(ctx) {
    this.ctx = ctx;
    if (!this.layers.length) {
      for (let i = 0; i < N_LAYERS; i++) {
        this.layers.push({ active: false, kind: 'fx', ks: KINDS.fx, t: 0, base: 0.3, intensity: 0, p0: 0, p1: 0, p2: 0, p3: 0, hasDir: false, dx: 0, dy: 0, frame: 0 });
      }
    }
    const ev = ctx.events;
    const P = () => feel.p.impact;

    ev.on('player:damage', (e) => {
      const p = P();
      const amount = e?.amount ?? 10;
      const a = clamp(0.3 + amount / 40, 0.3, 1);   // 7 hp reads as 0.48, 20 hp as 0.8
      // player.js also calls fx.shake in the same tick: drop that generic layer, the directional one below replaces it
      this._dropSameFrame('fx', 0.35);
      const d = hitDirection(e?.source, ctx.player?.position, _dir);
      let push = null;
      if (d.has) { _push.x = -d.x; _push.y = -d.y; push = _push; }
      this.addShake(a, 0.14 + 0.16 * a, 'hit', push);
      // camera kick: shove away from the hit, a little pull back, roll flick toward the hit side
      const kick = p.hitKick * a * p.shakeScale;
      if (push) { this._kx += push.x * kick; this._ky += push.y * kick; this._kr += -push.x * p.hitKickRollDeg * DEG * a * p.shakeScale * p.shakeRollScale; }
      else { this._ky += -kick * 0.5; }
      this._kz += p.hitKickBack * a * p.shakeScale;
      // screen feedback
      this._dmg = Math.max(this._dmg, clamp(amount / 25, 0.35, 1));
      if (amount >= p.hsDamageMin) this.hitStop(p.hsDamageDur * Math.min(1.5, amount / 14), p.hsDamageScale);
    });

    ev.on('player:dead', () => {
      const p = P();
      this._dropSameFrame('fx', 0.8);
      this.addShake(1, 0.9, 'death');
      this._dmg = 1;
      this.hitStop(p.hsDeathDur, p.hsDeathScale, true);
    });

    ev.on('boss:defeated', () => {
      const p = P();
      this.addShake(1.1, 1.0, 'boss');
      this.hitStop(p.hsBossDefeatDur, p.hsBossDefeatScale, true);
    });
    ev.on('boss:phase', () => {
      const p = P();
      this.hitStop(p.hsBossPhaseDur, p.hsBossPhaseScale);
    });

    ev.on('bomb:detonate', () => {
      const p = P();
      this.addShake(0.9, 0.55, 'blast');
      this.hitStop(p.hsBombDur, p.hsBombScale);
    });

    ev.on('player:roll', () => this.addShake(0.4, 0.1, 'roll'));
    ev.on('shot:reflected', () => { this.addShake(0.5, 0.1, 'reflect'); this.pulse(P().reticleHitPulse * 0.8); });
    ev.on('player:lockon', () => this.pulse(P().reticleLockPulse));

    ev.on('enemy:hit', (e) => { if ((e?.damage ?? 1) > 0) this.pulse(P().reticleHitPulse); });

    ev.on('enemy:killed', (e) => {
      const p = P();
      const en = e?.enemy, r = en?.radius ?? 1.5, pts = e?.points ?? 0;
      const big = r >= 4 || pts >= 500;
      this.pulse(p.reticleKillPulse);
      if (e?.position) ctx.fx?.killBurst?.(e.position, r, en?.def?.explColor ?? 0xffd9a0);
      if (r >= p.killShakeMinRadius || big) this.addShake(Math.min(1, p.killShake * r + (big ? 0.15 : 0)), 0.18 + 0.03 * Math.min(r, 8), 'blast');
      if (big) this.hitStop(p.hsBigKillDur, p.hsBigKillScale);
      else if (p.hsSmallKillDur > 0) this.hitStop(p.hsSmallKillDur, p.hsSmallKillScale);
    });

    // hit-stop requests from other code (boss parts, boss sequences): scaled, capped and budgeted like ours
    ev.on('fx:hitstop', (e) => {
      const p = P();
      this.hitStop(Math.min(p.hsEventMax, (e?.duration ?? 0.06) * p.hsEventScale), p.hsEventSpeed);
    });
  },

  reset() {
    this.offset.set(0, 0, 0); this.roll = 0; this.reticlePulse = 0; this.magnitude = 0; this.hitStopTotal = 0;
    this._kx = this._ky = this._kz = this._kr = 0; this._dmg = 0; this._lowPhase = 0; this.lowBeat = 0; this.lowSev = 0;
    this._hsBudget = feel.p.impact?.hsBudget ?? 0.3; this._hsAt = -9; this._hsDur = 0;
    for (const l of this.layers) l.active = false;
    this._post.damage = 0;
    this.ctx?.render?.setPost?.(this._post);
  },

  pulse(v) { if (v > this.reticlePulse) this.reticlePulse = Math.min(1, v); },

  _dropSameFrame(kind, dur) {
    for (const l of this.layers) if (l.active && l.kind === kind && l.frame === this._frame && l.t === 0 && Math.abs(l.base - dur) < 1e-3) l.active = false;
  },

  /**
   * Start a shake layer. intensity 0..1.5 (values above 1.2 sent as the generic kind are promoted to 'boss'), duration in
   * seconds, kind one of SHAKE_KINDS, dir optional {x, y}: the direction the camera is pushed.
   */
  addShake(intensity = 0.5, duration = 0.3, kind = 'fx', dir = null) {
    const e = Math.min(1.5, intensity);
    if (!(e > 0.001)) return;
    if (!KINDS[kind]) kind = 'fx';
    if (kind === 'fx' && e >= 1.2) kind = 'boss';
    const ls = this.layers;
    // merge bursts of the same kind that start together (chain explosions) so they do not pile up into a jitter
    for (let i = 0; i < ls.length; i++) {
      const l = ls[i];
      if (l.active && l.kind === kind && l.t < 0.045 && !dir && !l.hasDir) {
        const lo = Math.min(l.intensity, e), hi = Math.max(l.intensity, e);
        l.intensity = Math.min(1.5, hi + 0.3 * lo); l.base = Math.max(l.base, duration);
        return;
      }
    }
    let slot = null;
    for (let i = 0; i < ls.length; i++) if (!ls[i].active) { slot = ls[i]; break; }
    if (!slot) {
      let w = 1e9;
      for (let i = 0; i < ls.length; i++) { const l = ls[i], rem = l.intensity * Math.max(0, 1 - l.t / (l.base || 1)); if (rem < w) { w = rem; slot = l; } }
    }
    slot.active = true; slot.kind = kind; slot.ks = KINDS[kind]; slot.t = 0;
    slot.base = clamp(duration, 0.05, 3); slot.intensity = e; slot.frame = this._frame;
    slot.p0 = R() * TAU; slot.p1 = R() * TAU; slot.p2 = R() * TAU; slot.p3 = R() * TAU;
    slot.hasDir = !!dir; slot.dx = dir?.x ?? 0; slot.dy = dir?.y ?? 0;
  },

  /**
   * Budgeted hit-stop. Requests that arrive right after a stop of equal or longer length are dropped, the rest are cut down to
   * what is left of the budget (feel.p.impact.hsBudget, refilled at hsRegen per second). force skips both rules.
   */
  hitStop(duration, scale, force = false) {
    const p = this._p();
    const d0 = duration * p.hitStopMaster;
    if (!(d0 > 0.004)) return false;
    let d = d0;
    if (!force) {
      if (this._time - this._hsAt < 0.12 && d <= this._hsDur + 1e-6) return false;
      d = Math.min(d, this._hsBudget);
      if (d < 0.03) return false;
    }
    this._hsBudget = Math.max(0, this._hsBudget - d);
    this._hsAt = this._time; this._hsDur = d;
    this.hitStopTotal += d;
    this.ctx?.game?.hitStop?.(d, scale);
    return true;
  },

  update(dt, ctx = this.ctx) {
    const p = this._p();
    const phase = ctx?.state?.phase;
    // in the playing and title branches game.js hands us a time-scaled dt; recover the real step so shake, kick and screen
    // feedback keep running through a hit-stop
    const ts = ctx?.timeScale ?? 1;
    let raw = (phase === 'playing' || phase === 'title') && ts > 0.02 ? dt / ts : dt;
    if (!(raw > 0)) raw = 0;
    if (raw > 0.1) raw = 0.1;
    this._time += raw; this._frame++;
    this._hsBudget = Math.min(p.hsBudget, this._hsBudget + p.hsRegen * raw);

    // ---- layers
    let ox = 0, oy = 0, oz = 0, rl = 0, active = 0;
    const db = p.hitDirectional, ms = p.shakeScale, rs = p.shakeRollScale;
    for (let i = 0; i < this.layers.length; i++) {
      const l = this.layers[i];
      if (!l.active) continue;
      l.t += raw;
      const k = l.kind, ks = l.ks;
      const dur = l.base * p[k + 'Dur'];
      const u = l.t / dur;
      if (u >= 1) { l.active = false; continue; }
      active++;
      let env;
      if (ks.rise) env = Math.pow(u, 1.4) * (1 - Math.pow(u, 6));
      else env = (ks.atk > 0 ? Math.min(1, l.t / ks.atk) : 1) * Math.pow(1 - u, ks.pow);
      const A = p[k + 'Amp'] * ms * l.intensity * env;
      if (A < 1e-5) continue;
      const w = TAU * p[k + 'Freq'] * l.t;
      const sx = (Math.sin(w + l.p0) + 0.35 * Math.sin(1.93 * w + 2 * l.p0)) * 0.74;
      const sy = (Math.sin(1.13 * w + l.p1) + 0.35 * Math.sin(2.11 * w + 1.7 * l.p1)) * 0.74;
      const sz = Math.sin(0.87 * w + l.p2);
      const sr = Math.sin(0.95 * w + l.p3);
      if (l.hasDir) {
        const c = Math.cos(w) * (0.7 + 0.3 * Math.cos(1.9 * w));
        ox += A * ((1 - db) * ks.wx * sx + db * l.dx * c);
        oy += A * ((1 - db) * ks.wy * sy + db * l.dy * c);
        rl += A * ks.roll * DEG * rs * ((1 - db) * sr - db * l.dx * c);
      } else {
        ox += A * ks.wx * sx;
        oy += A * ks.wy * sy;
        rl += A * ks.roll * DEG * rs * sr;
      }
      oz += A * ks.wz * sz;
    }

    // ---- camera kick (exponential settle)
    const kd = Math.exp(-p.hitKickDecay * raw);
    this._kx *= kd; this._ky *= kd; this._kz *= kd; this._kr *= kd;
    if (Math.abs(this._kx) + Math.abs(this._ky) + Math.abs(this._kz) + Math.abs(this._kr) < 1e-5) { this._kx = this._ky = this._kz = this._kr = 0; }
    ox += this._kx; oy += this._ky; oz += this._kz; rl += this._kr;

    // ---- soft caps (tanh: identity for small values, smooth ceiling for large ones)
    const cap = Math.max(0.01, p.shakeMaxOffset);
    const len = Math.hypot(ox, oy, oz);
    if (len > 1e-6) { const s = cap * Math.tanh(len / cap) / len; ox *= s; oy *= s; oz *= s; }
    const rcap = p.shakeMaxRollDeg * DEG;
    rl = rcap > 1e-6 ? rcap * Math.tanh(rl / rcap) : 0;

    if (!Number.isFinite(ox + oy + oz + rl)) { ox = oy = oz = rl = 0; for (const l of this.layers) l.active = false; }
    if (active === 0 && ox === 0 && oy === 0 && oz === 0 && rl === 0) {
      if (this.magnitude !== 0) { this.offset.set(0, 0, 0); this.roll = 0; this.magnitude = 0; }
    } else {
      this.offset.set(ox, oy, oz); this.roll = rl; this.magnitude = Math.hypot(ox, oy, oz);
    }

    // ---- reticle pulse
    if (this.reticlePulse > 0) { this.reticlePulse *= Math.exp(-p.reticlePulseDecay * raw); if (this.reticlePulse < 0.004) this.reticlePulse = 0; }

    // ---- damage and low health screen feedback, delivered through the post pass override
    if (this._dmg > 0) this._dmg = Math.max(0, this._dmg - raw / Math.max(0.05, p.damagePulseTime));
    const st = ctx?.state;
    let low = 0;
    this.lowBeat = 0; this.lowSev = 0;
    if (st && phase === 'playing' && ctx.player?.alive !== false) {
      const hp = st.health / Math.max(1, st.maxHealth || 100);
      if (hp > 0 && hp < p.lowHpThreshold) {
        const sev = 1 - hp / Math.max(0.01, p.lowHpThreshold);         // 0 at the threshold, 1 near empty
        this._lowPhase = (this._lowPhase + raw * p.lowHpRate * (1 + 1.2 * sev)) % 1;
        const x = this._lowPhase;
        // two beats per cycle, lub and dub
        const beat = Math.exp(-(((x - 0.08) / 0.05) ** 2)) + 0.6 * Math.exp(-(((x - 0.27) / 0.05) ** 2));
        this.lowSev = sev; this.lowBeat = 0.35 + 0.65 * Math.min(1, beat);
        low = p.lowHpStrength * (0.25 + 0.75 * sev) * this.lowBeat;
      }
    }
    this._post.damage = clamp(this._dmg * p.damagePulse * (0.6 + 0.4 * this._dmg) + low, 0, 1);
    ctx?.render?.setPost?.(this._post);
  },
};
