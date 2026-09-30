// Cinema director: camera takeovers plus the real time camera choreography (level intros, signature moments). Module: cinema (ctx.cinema).
// A takeover is a named shot that owns the camera for at most 4 seconds (boss entrance and boss defeat finisher are the two moments that
// use it). Everything else keeps the player in control: the level intro flythrough (src/cinema/intros.js) and one signature moment per
// level (src/cinema/moments.js) are layered over the chase camera by src/core/cameraRig.js.
//
// API (stable, other modules call these):
//   cinema.register(name, def)   def = {
//       duration      seconds, capped at 4 (MAX_TAKEOVER) unless opts.free is set
//       letterbox     0..1 share of the full bar size (feel cinema.letterbox), default 1; the bars slide in and leave before the end
//       hideHud       fade the HUD panels and the reticle (warnings, banners and comm lines stay), default false
//       lockInput     the ship gets no steering, fire, boost, brake, bomb or roll input while the shot runs (pause still works)
//       invulnerable  the player takes no damage while the shot runs and for feel cinema.graceAfter seconds after it
//       blendIn       seconds to ease in from the live chase camera (default feel cinema.blendIn, 0 is a hard cut)
//       blendOut      seconds to ease back to the live chase camera, INSIDE the duration (default feel cinema.blendOut, 0 cuts)
//       clock         'real' (default: the shot runs in real time, so a slow motion beat slows the world, not the camera move)
//                     or 'game' (the shot follows ctx.timeScale and hit stops)
//       pose(u, t, ctx, out)   REQUIRED. u = t / duration (0..1), t seconds since the start. Write WORLD space values:
//                     out.pos (Vector3 camera position), out.look (Vector3 point the camera looks at), out.fov (vertical degrees,
//                     20 to 120), out.roll (radians around the view axis). Keep the previous frame's values when you have
//                     nothing new: out is the same object every frame. Non finite values are rejected (the last good pose is kept).
//                     The director evaluates pose every frame of the shot, and also during a blend out after cancel().
//                     Helpers for common moves (dolly, curves, orbit, eased look-at, FOV kick, rail and ship points): src/cinema/helpers.js.
//                     helpers.chasePose(ctx) is the live chase camera if a shot wants to start from or end on it.
//       onStart(ctx, opts), onEnd(ctx, opts, cancelled)   optional callbacks }
//   cinema.play(name, opts)      starts the shot, returns false when unknown or a takeover is running. opts.free lifts the 4 s cap
//                                (showcase mode only), opts.data is handed on (the fifth pose argument, also cinema.opts.data), and opts may
//                                override letterbox, hideHud, lockInput, invulnerable, blendIn, blendOut, clock of the def.
//   cinema.cancel()              ends the running takeover now; the camera still eases back over blendOut (no pop)
//   cinema.setBars(v)            baseline letterbox 0..1 that stays on outside shots (showcase mode), 0 by default
//   cinema.active / name / t / u / duration / weight   takeover state (weight is the camera blend 0..1)
//   cinema.pose                  { pos, look, fov, roll } of the running shot (world space)
//   cinema.state                 one object for other modules (audio ducking, HUD): { kind: 'takeover' | 'intro' | 'moment' | '',
//                                active, name, t, u, duration, weight, bars, hudAlpha, lockInput, invulnerable, intro, moment }
//   cinema.startIntro(ctx)       called by cameraRig.startIntro at level start
// Events: 'cinema:start' { name, duration, free }, 'cinema:end' { name, cancelled }, 'cinema:moment' { name, level, duration },
// 'cinema:intro' { level, duration }.
// Pause freezes everything (the director only runs in the game step), including the letterbox and the HUD fade.
import * as THREE from 'three';
import { feel } from '../core/feel.js';
import { ease } from '../cinema/helpers.js';
import { introDef, introPose } from '../cinema/intros.js';
import { momentDef, momentOffset, landmarkPresent } from '../cinema/moments.js';

export const MAX_TAKEOVER = 4;

const cp = () => feel.p.cinema || {};
const smooth = ease.smooth;
const fin = Number.isFinite;
const newPose = () => ({ pos: new THREE.Vector3(), look: new THREE.Vector3(0, 0, -1), fov: 60, roll: 0 });
const copyPose = (a, b) => { a.pos.copy(b.pos); a.look.copy(b.look); a.fov = b.fov; a.roll = b.roll; return a; };
const poseOk = (p) => fin(p.pos.x) && fin(p.pos.y) && fin(p.pos.z) && fin(p.look.x) && fin(p.look.y) && fin(p.look.z) && fin(p.fov) && fin(p.roll)
  && p.pos.distanceToSquared(p.look) > 1e-6;
const approach = (v, target, rate, dt) => (v < target ? Math.min(target, v + rate * dt) : Math.max(target, v - rate * dt));

export const cinema = {
  ctx: null,
  // takeover
  active: false, name: '', t: 0, u: 0, duration: 0, opts: null, def: null, weight: 0, shotId: 0,
  lockInput: false, invulnerable: false,
  shots: {},
  pose: newPose(),
  _good: newPose(),
  _rel: { on: false, t: 0, dur: 0, from: 0, def: null, opts: null, dur0: 1 },
  _cfg: { letterbox: 1, hideHud: false, lockInput: false, invulnerable: false, blendIn: 0.5, blendOut: 0.7, clock: 'real' },
  _grace: 0,
  _warned: new Set(),
  // letterbox and HUD (read by src/ui/ui.js): bars 0..1 of the full bar size, barSize the full size as a share of the screen height
  bars: 0, barSize: 0.085, hudAlpha: 1, holdBars: 0,
  // level intro, layered over the chase camera by cameraRig with intro.weight
  intro: { on: false, t: 0, dur: 0, u: 0, def: null, weight: 0, pose: newPose() },
  // signature moment, added to the chase target by cameraRig
  moment: { on: false, t: 0, dur: 0, u: 0, def: null, name: '', fired: false, off: { cx: 0, cy: 0, cz: 0, lx: 0, ly: 0, lz: 0, fov: 0, roll: 0 } },
  state: { kind: '', active: false, name: '', t: 0, u: 0, duration: 0, weight: 0, bars: 0, hudAlpha: 1, lockInput: false, invulnerable: false, intro: false, moment: '' },

  init(ctx) {
    this.ctx = ctx;
    this.installGuards(ctx);
  },

  // The takeover rules need hooks in two modules this file does not own; both wrappers are no-ops outside a shot.
  //  - input: after input.update, a locked shot clears the ship controls for the frame (pause and menu keys keep working)
  //  - player: takeDamage refuses damage while a shot (or its grace time) makes the player invulnerable
  installGuards(ctx) {
    const inp = ctx.input, pl = ctx.player, self = this;
    if (inp && !inp.__cinemaGuard && typeof inp.update === 'function') {
      const orig = inp.update;
      inp.update = function (...args) {
        const r = orig.apply(this, args);
        if (self.lockInput) {
          this.axis.x = 0; this.axis.y = 0; this.rawAxis.x = 0; this.rawAxis.y = 0;
          this.fire = false; this.firePressed = false; this.fireReleased = false;
          this.boost = false; this.brake = false; this.bomb = false; this.rollLeft = false; this.rollRight = false;
        }
        return r;
      };
      inp.__cinemaGuard = true;
    }
    if (pl && !pl.__cinemaGuard && typeof pl.takeDamage === 'function') {
      const orig = pl.takeDamage;
      pl.takeDamage = function (...args) { return self.invulnerable ? false : orig.apply(this, args); };
      pl.__cinemaGuard = true;
    }
  },

  reset() {
    this.end(true);
    this.weight = 0; this._rel.on = false; this._rel.def = null; this._grace = 0;
    this.lockInput = false; this.invulnerable = false;
    this.intro.on = false; this.intro.weight = 0;
    this.moment.on = false; this.moment.fired = false; this.moment.def = null; this.moment.name = '';
    this.clearOffset();
    this.bars = this.holdBars; this.hudAlpha = 1;
    this.syncState();
  },

  register(name, def) { this.shots[name] = def; },

  play(name, opts = {}) {
    const def = this.shots[name];
    if (!def || this.active) return false;
    if (typeof def.pose !== 'function') { this.warnOnce('nopose:' + name, `[cinema] shot "${name}" has no pose()`); return false; }
    const P = cp(), c = this._cfg;
    const pick = (k, fb) => (opts[k] !== undefined ? opts[k] : def[k] !== undefined ? def[k] : fb);
    c.letterbox = Math.max(0, Math.min(1, Number(pick('letterbox', 1)) || 0));
    c.hideHud = !!pick('hideHud', false);
    c.lockInput = !!pick('lockInput', false);
    c.invulnerable = !!pick('invulnerable', false);
    c.clock = pick('clock', 'real') === 'game' ? 'game' : 'real';
    const dur = Number(opts.free ? (opts.duration ?? def.duration ?? MAX_TAKEOVER) : Math.min(MAX_TAKEOVER, def.duration ?? MAX_TAKEOVER));
    this.duration = fin(dur) && dur > 0.05 ? dur : MAX_TAKEOVER;
    c.blendIn = Math.max(0, Math.min(this.duration * 0.45, Number(pick('blendIn', P.blendIn ?? 0.55)) || 0));
    c.blendOut = Math.max(0, Math.min(this.duration * 0.45, Number(pick('blendOut', P.blendOut ?? 0.75)) || 0));
    // a new shot during the blend out of the previous one starts from wherever the camera is (the rig snapshots it)
    this.fromSnapshot = this._rel.on && this.weight > 0.001;
    this._rel.on = false; this._rel.def = null;
    this.def = def; this.name = name; this.opts = opts; this.active = true; this.t = 0; this.u = 0; this.shotId++;
    this.lockInput = c.lockInput; this.invulnerable = c.invulnerable || this._grace > 0;
    // first pose right away, so the rig never blends toward an empty pose; a shot that fails on its first frame holds the chase view
    const ch = this.ctx.cameraRig?.chaseOut;
    if (ch && fin(ch.pos.x) && fin(ch.look.x)) { this._good.pos.copy(ch.pos); this._good.look.copy(ch.look); this._good.fov = ch.fov; this._good.roll = 0; }
    this.evalPose(def, 0, 0);
    this.weight = c.blendIn > 0 ? 0 : 1;
    try { def.onStart?.(this.ctx, opts); } catch (err) { console.error('[cinema.onStart]', err); }
    this.ctx.events.emit('cinema:start', { name, duration: this.duration, free: !!opts.free });
    this.syncState();
    return true;
  },

  cancel() {
    if (!this.active) return;
    const c = this._cfg, rel = this._rel;
    const w = this.weight;
    const def = this.def, opts = this.opts, t = this.t;
    this.end(true);
    if (w > 0.001) {
      rel.on = true; rel.t = 0; rel.dur = Math.max(0.3, c.blendOut || cp().blendOut || 0.75); rel.from = w;
      rel.def = def; rel.opts = opts; rel.t0 = t;
    }
  },

  end(cancelled = false) {
    if (!this.active) return;
    const name = this.name, def = this.def, opts = this.opts;
    const wasInv = this._cfg.invulnerable;
    this.active = false; this.name = ''; this.def = null; this.t = 0; this.u = 0;
    this.lockInput = false;
    if (wasInv) this._grace = cp().graceAfter ?? 0.6;
    this.invulnerable = this._grace > 0;
    if (!cancelled) this.weight = 0;
    try { def?.onEnd?.(this.ctx, opts, cancelled); } catch (err) { console.error('[cinema.onEnd]', err); }
    this.opts = null;
    this.ctx?.events.emit('cinema:end', { name, cancelled });
    this.syncState();
  },

  setBars(v) { this.holdBars = Math.max(0, Math.min(1, Number(v) || 0)); },

  // ---------------------------------------------------------------- level intro
  startIntro(ctx = this.ctx) {
    const W = ctx.world, def = introDef(W?.theme);
    const it = this.intro;
    it.on = false; it.weight = 0;
    if (!def) return;
    const P = cp();
    it.def = def; it.t = 0; it.u = 0;
    it.dur = def.dur * Math.max(0.3, P[`${W.theme}_intro`] ?? 1);
    it.on = true;
    try { def.set?.(ctx, W); } catch (err) { console.error('[cinema.intro set]', err); }
    it.weight = introPose(def, 0, ctx, it.pose);
    // level start is a cut: bars in and HUD out at once, both ease back during the flythrough
    this.bars = Math.max(this.holdBars, P.introBars ?? 1);
    this.hudAlpha = 0;
    ctx.events.emit('cinema:intro', { level: W.theme, duration: it.dur });
    this.syncState();
  },

  // ---------------------------------------------------------------- frame
  update(dt, ctx = this.ctx) {
    if (!(dt >= 0)) dt = 0;
    const st = ctx.state, ph = st?.phase;
    // real time: game.js hands the director the time scaled dt while playing (hit stops, slow motion)
    const ts = ctx.timeScale;
    const real = Math.min(0.1, (ph === 'playing' || ph === 'title') && ts > 0.02 && ts < 1 ? dt / ts : dt);
    const P = cp();
    this.barSize = P.letterbox ?? 0.085;
    if (this._grace > 0) this._grace = Math.max(0, this._grace - real);

    // takeover
    let barsT = this.holdBars, hudT = 1;
    const c = this._cfg;
    if (this.active) {
      const step = c.clock === 'game' ? dt : real;
      this.t += step;
      this.u = Math.min(1, this.t / Math.max(0.01, this.duration));
      this.evalPose(this.def, this.u, this.t);
      const wi = c.blendIn > 1e-3 ? smooth(this.t / c.blendIn) : 1;
      const left = this.duration - this.t;
      const wo = c.blendOut > 1e-3 ? smooth(left / c.blendOut) : left > 0 ? 1 : 0;
      this.weight = Math.min(wi, wo);
      this.invulnerable = c.invulnerable || this._grace > 0;
      const barT = P.barTime ?? 0.4;
      barsT = Math.max(barsT, left > barT ? c.letterbox : 0);
      if (c.hideHud) hudT = 1 - (P.hudFade ?? 1) * (left > barT ? 1 : 0);
      if (this.t >= this.duration) this.end(false);
    } else {
      const rel = this._rel;
      if (rel.on) {
        rel.t += real;
        if (rel.def) this.evalPose(rel.def, 1, (rel.t0 ?? 0) + rel.t);
        this.weight = rel.from * (1 - smooth(rel.t / rel.dur));
        if (rel.t >= rel.dur) { rel.on = false; rel.def = null; rel.opts = null; this.weight = 0; }
      } else this.weight = 0;
      this.invulnerable = this._grace > 0;
    }

    // level intro (game time, the flythrough is part of the flight)
    const it = this.intro;
    if (it.on) {
      if (ph === 'playing' && ctx.player?.alive !== false) {
        it.t += dt;
        it.u = Math.min(1, it.t / Math.max(0.1, it.dur));
        it.weight = introPose(it.def, it.u, ctx, it.pose);
        barsT = Math.max(barsT, (P.introBars ?? 1) * (1 - smooth((it.u - 0.42) / 0.3)));
        hudT = Math.min(hudT, smooth((it.u - (P.introHud ?? 0.3)) / 0.2));
        if (it.u >= 1) { it.on = false; it.weight = 0; }
      } else { it.on = false; it.weight = 0; }   // leaving play or a crash during the intro ends it (the death cam takes over)
    }

    // signature moment
    this.updateMoment(dt, ctx, P);

    // letterbox and HUD fade
    const barRate = 1 / Math.max(0.05, P.barTime ?? 0.4);
    if (it.on) this.bars = Math.max(barsT, approach(this.bars, barsT, barRate * 0.6, real));
    else this.bars = approach(this.bars, barsT, barRate, real);
    this.hudAlpha = it.on && !this.active ? hudT : approach(this.hudAlpha, hudT, 1 / 0.35, real);
    this.syncState();
  },

  evalPose(def, u, t) {
    const p = this.pose;
    try { def.pose(u, t, this.ctx, p, this.opts?.data); } catch (err) {
      this.warnOnce('throw:' + this.name, err);
      copyPose(p, this._good);
      return;
    }
    if (!(p.fov >= 20 && p.fov <= 120)) p.fov = Math.min(120, Math.max(20, fin(p.fov) ? p.fov : this._good.fov));
    if (!fin(p.roll)) p.roll = 0;
    if (poseOk(p)) copyPose(this._good, p);
    else { copyPose(p, this._good); this.warnOnce('nan:' + this.name, `[cinema] shot "${this.name}" wrote a non finite pose, kept the last good one`); }
  },

  // ---------------------------------------------------------------- signature moments
  updateMoment(dt, ctx, P) {
    const m = this.moment, W = ctx.world, theme = W?.theme;
    const playing = ctx.state?.phase === 'playing' && ctx.player?.alive !== false;
    if (!m.on) {
      this.clearOffset();
      if (m.fired || !playing || this.active || this.intro.on || ctx.state?.boss) return;
      const def = momentDef(theme);
      const d = ctx.rail?.distance ?? 0;
      // only near the trigger point: a rail jump far past it does not replay the moment later
      if (!def || d < def.at || d > def.at + 120) return;
      const k = P[`${theme}_moment`] ?? 1;
      m.fired = true;
      if (k <= 0 || !landmarkPresent(def, ctx)) return;
      m.on = true; m.def = def; m.name = def.name; m.t = 0; m.u = 0; m.dur = def.dur;
      ctx.events.emit('cinema:moment', { name: def.name, level: theme, duration: def.dur });
    }
    if (!playing || this.active) { m.on = false; this.clearOffset(); return; }
    m.t += dt;
    m.u = Math.min(1, m.t / Math.max(0.1, m.dur));
    momentOffset(m.def, m.u, P[`${theme}_moment`] ?? 1, (P.momentFov ?? 1) * (P.fovKick ?? 1), m.off);
    if (m.u >= 1) { m.on = false; this.clearOffset(); }
  },

  clearOffset() {
    const o = this.moment.off;
    o.cx = o.cy = o.cz = o.lx = o.ly = o.lz = o.fov = o.roll = 0;
  },

  syncState() {
    const s = this.state;
    s.active = this.active; s.name = this.name; s.t = this.t; s.u = this.u; s.duration = this.duration; s.weight = this.weight;
    s.bars = this.bars; s.hudAlpha = this.hudAlpha; s.lockInput = this.lockInput; s.invulnerable = this.invulnerable;
    s.intro = this.intro.on; s.moment = this.moment.on ? this.moment.name : '';
    s.kind = this.active || this.weight > 0 ? 'takeover' : this.intro.on ? 'intro' : this.moment.on ? 'moment' : '';
  },

  warnOnce(key, msg) {
    if (this._warned.has(key)) return;
    this._warned.add(key);
    console.error(msg);
  },
};
