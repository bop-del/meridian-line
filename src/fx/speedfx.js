// Speed sensation: FOV kick, speed streaks and space dust, near parallax streaks, motion blur and chroma amounts.
// Module: speed feel. Read by cameraRig each frame: speedfx.fovKick (degrees added to the camera FOV, may be negative for brake).
// Read by the post pass (src/render/renderer.js, also speed-owned): speedfx.blur (0..1 radial blur amount) and speedfx.chroma
// (extra chromatic aberration, added on top of the hit chroma).
//
// API (stable):
//   speedfx.fovKick   degrees, smoothed, already includes base gain, boost, brake and the onset punch
//   speedfx.blur      0..1 radial motion blur
//   speedfx.chroma    extra chromatic aberration amount
//   speedfx.speed01   0..1 normalised rail speed (brake 0, base ~0.35, boost 1); read-only convenience for others
//   speedfx.signed    -1 (full brake) .. 0 (cruise) .. +1 (full boost), smoothed; drives every triple in feel.p.speed
//   speedfx.update(dt, ctx)   runs before cameraRig.update every frame
// The streak field and dust that used to live in fx.js live here now; fx.speedLines(x) forwards to speedfx.setManual(x).
// Reads: ctx.player.boostAmount/brakeAmount/isBoosting/isBraking, ctx.rail.speed, ctx.camera, ctx.render.quality, feel.p.speed.*
//
// Adaptive quality (ctx.render.quality, 0 best): the near layer drops first (tier 2), then line and dust density is
// reduced (tier 4). The post pass drops blur taps at tier 3 and the blur at tier 4 (renderer.js).
import * as THREE from 'three';
import { StreakField } from './streaks.js';
import { feel } from '../core/feel.js';

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const lerp = (a, b, t) => a + (b - a) * t;

const COL_COOL = new THREE.Color(0xbfd8ff), COL_HOT = new THREE.Color(0xd9fff4), COL_WARM = new THREE.Color(0xffc98a);
const _col = new THREE.Color();

/** value along the signed speed axis: s < 0 blends cruise to brake, s > 0 blends cruise to boost. */
const tri = (s, brake, base, boost) => (s >= 0 ? lerp(base, boost, s) : lerp(base, brake, -s));

export const speedfx = {
  ctx: null,
  fovKick: 0,
  blur: 0,
  chroma: 0,
  speed01: 0,
  signed: 0,
  _manual: 0, _manualT: 0,
  _fov: 0, _s: 0, _px: 0, _pv: 0, _wasBoost: false, _wasBrake: false,

  init(ctx) {
    this.ctx = ctx;
    const scene = ctx.scene;
    this.speedField = new StreakField(scene, 140, { rMin: 3.5, rMax: 24, depth: 170, near: 3, len: 14, width: 0.045, alpha: 0.55, color: 0xbfd8ff, name: 'fxSpeedLines', renderOrder: 9 });
    this.dust = new StreakField(scene, 260, { rMin: 4, rMax: 55, depth: 110, near: 0, len: 0.7, width: 0.05, alpha: 0.55, color: 0x9fb4d8, name: 'fxDust', renderOrder: 8 });
    // near parallax layer: short, fast, wide streaks that sweep past the camera close to the ship
    this.near = new StreakField(scene, 90, { rMin: 2.4, rMax: 10, depth: 34, near: 1, len: 2.5, width: 0.07, alpha: 0.5, color: 0xd6e6ff, fadeNear: 2.5, name: 'fxNear', renderOrder: 10 });
  },

  reset() {
    this._manual = 0; this._manualT = 0; this._s = 0; this._fov = 0; this._px = 0; this._pv = 0;
    this._wasBoost = false; this._wasBrake = false;
    this.fovKick = 0; this.blur = 0; this.chroma = 0; this.signed = 0;
  },

  /** fx.speedLines(x) forwards here: a transient minimum boost amount that expires when no longer refreshed. */
  setManual(x) { this._manual = clamp(x, 0, 1); this._manualT = 0.2; },

  update(dt, ctx = this.ctx) {
    const f = feel.p.speed;
    const cam = ctx.camera, rail = ctx.rail, cfg = ctx.config?.rail, pl = ctx.player;
    const base = rail?.baseSpeed ?? 40, bs = rail?.boostSpeed ?? cfg?.boostSpeed ?? 75, ks = rail?.brakeSpeed ?? cfg?.brakeSpeed ?? 22;
    const spd = rail?.speed ?? base;
    this.speed01 = clamp((spd - ks) / Math.max(1, bs - ks), 0, 1);
    if (this._manualT > 0) { this._manualT -= dt; if (this._manualT <= 0) this._manual = 0; }

    // signed speed: the rail speed is the sustained truth, the player's smoothed boost and brake amounts make it respond at once
    const playing = ctx.state?.phase === 'playing' && pl?.alive !== false;
    const tB = clamp((spd - base) / Math.max(1, bs - base), 0, 1);
    const tK = clamp((base - spd) / Math.max(1, base - ks), 0, 1);
    const b = Math.max(tB, playing ? Math.max(pl?.boostAmount || 0, this._manual) : 0);
    const k = Math.max(tK, playing ? (pl?.brakeAmount || 0) : 0);
    const target = clamp(b - k, -1, 1);
    const rate = Math.abs(target) > Math.abs(this._s) ? f.fxAttack : f.fxRelease;
    this._s += (target - this._s) * (1 - Math.exp(-rate * dt));
    const s = this.signed = this._s;

    // ---- FOV: smoothed level plus an onset punch spring
    const cruise = f.baseFovGain * clamp(spd / Math.max(1, base), 0, 1);
    const levelT = playing ? cruise + (b > 0 ? f.boostFov * Math.pow(b, f.fovCurve) : 0) + f.brakeFov * k : 0;
    const fr = Math.abs(levelT) > Math.abs(this._fov) ? f.fovAttack : f.fovRelease;
    this._fov += (levelT - this._fov) * (1 - Math.exp(-fr * dt));
    const w = f.punchSpeed, z = clamp(f.punchDamping, 0.1, 0.98), q1 = Math.sqrt(1 - z * z), wd = w * q1;
    if (playing) {
      // impulse sized so the first peak of the spring response equals the requested degrees
      const peak = Math.exp(-(z / q1) * Math.atan(q1 / z)) / w;
      if (pl?.isBoosting && !this._wasBoost) this._pv += f.boostPunch / peak;
      if (pl?.isBraking && !this._wasBrake) this._pv += f.brakePunch / peak;
    }
    this._wasBoost = !!pl?.isBoosting; this._wasBrake = !!pl?.isBraking;
    if (this._px !== 0 || this._pv !== 0) {
      // exact step of the damped spring, stable at any dt
      const e = Math.exp(-z * w * dt), c = Math.cos(wd * dt), sn = Math.sin(wd * dt), x = this._px, v = this._pv;
      this._px = e * (x * c + ((v + z * w * x) / wd) * sn);
      this._pv = e * (v * c - ((w * w * x + z * w * v) / wd) * sn);
      if (Math.abs(this._px) < 1e-4 && Math.abs(this._pv) < 1e-3) { this._px = 0; this._pv = 0; }
    }
    this.fovKick = this._fov + this._px;

    // ---- blur and chroma amounts along the signed speed
    this.blur = clamp(tri(s, f.blurBrake, f.blurBase, f.blurBoost), 0, 1);
    this.chroma = Math.max(0, tri(s, 0, f.chromaBase, f.chromaBoost));

    // ---- streak layers
    const q = (ctx.render?.quality | 0), thin = q >= 4 ? 0.55 : 1;
    const mv = clamp(spd / Math.max(1, base), 0, 1); // lines and near streaks vanish when the rail is at rest (title, wreck)
    const lines = this.speedField, dust = this.dust, near = this.near;
    lines.setRadius(f.lineRadiusMin, f.lineRadiusMax);
    lines.set(cam.position, clamp(tri(s, f.linesBrake, f.linesBase, f.linesBoost), 0, 1) * thin * mv,
      tri(s, f.lineLenBrake, f.lineLenBase, f.lineLenBoost), tri(s, f.lineAlphaBrake, f.lineAlphaBase, f.lineAlphaBoost));
    // colour: cool at cruise, hot teal white on boost (slightly over-bright so bloom picks it up), warm amber on brake
    _col.copy(COL_COOL);
    if (s > 0) _col.lerp(COL_HOT, s * f.boostTint).multiplyScalar(1 + 0.5 * s * f.boostTint);
    else _col.lerp(COL_WARM, -s * f.brakeTint);
    lines.setColor(_col);

    dust.set(cam.position, f.dustDensity * thin, 0.25 + spd * f.dustStretch, f.dustAlpha * (s < 0 ? 1 + s * 0.4 : 1));
    if (q >= 2) near.set(cam.position, 0, 1, 0);
    else {
      near.setRadius(f.nearRadiusMin, f.nearRadiusMax);
      _col.copy(COL_COOL).lerp(s > 0 ? COL_HOT : COL_WARM, Math.abs(s) * 0.5);
      near.setColor(_col);
      // follows real speed strongly: dim when braking, obvious at cruise and boost
      near.set(cam.position, f.nearDensity, 0.25 + spd * f.nearStretch, f.nearAlpha * mv * (0.25 + 0.75 * clamp(spd / base, 0, 1.4)) * (s < 0 ? 1 + s * 0.6 : 1));
    }
  },

  dispose() { this.speedField?.dispose(); this.dust?.dispose(); this.near?.dispose(); },
};
