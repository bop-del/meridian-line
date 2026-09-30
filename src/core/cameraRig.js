// Chase camera with trailing spring follow, look-ahead that leads the turn, swing with sideways speed, roll into the bank,
// speed dependent distance and height (push in on boost, pull back on brake, a short lag when the speed jumps), level intro
// swoop, death cam, and the orbit shot used behind the title and end screens.
// All chase values are live feel parameters (feel.p.handling.cam*, src/feel/handling.js), read every frame.
// FOV = camFov + ctx.speedfx.fovKick (the speed module owns the kick curve). Shake comes only from ctx.impact.
// The chase springs run in rail-local space (camera minus rail anchor), so forward travel never adds lag; only changes in
// the desired pose do. Springs are critically damped by default (camDamping 1), substepped and allocation free.
// Public: mode, cur { pos, look, fov, roll }, ideal { pos, look } (undamped chase target, for telemetry),
//   lag (distance between ideal and actual chase position), addTrauma(x), startIntro(), reset().
import * as THREE from 'three';
import { config } from '../config.js';
import { feel } from './feel.js';

const cc = config.camera;
const clamp = THREE.MathUtils.clamp;
const smooth = (t) => { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); };
const DEG = Math.PI / 180;
const hp = () => feel.p.handling || {};

const _pos = new THREE.Vector3();
const _look = new THREE.Vector3();
const _tmp = new THREE.Vector3();
const _tmpLook = new THREE.Vector3();
const _shake = new THREE.Vector3();
const _d = new THREE.Vector3();
// ideal chase target in rail-local space, written by chasePose
const _il = { px: 0, py: 0, pz: 0, lx: 0, ly: 0, lz: 0 };

// Damped spring on s = { x, v } toward target. freq in Hz, zeta damping ratio (1 critical). Substepped for stability.
function spring(s, target, freq, zeta, dt) {
  if (!(dt > 0)) return s.x;
  const w = 2 * Math.PI * Math.max(0.05, freq);
  const n = Math.min(10, Math.ceil(dt * 240));
  const h = dt / n;
  for (let i = 0; i < n; i++) {
    s.v += (-w * w * (s.x - target) - 2 * zeta * w * s.v) * h;
    s.x += s.v * h;
  }
  if (!Number.isFinite(s.x) || !Number.isFinite(s.v)) { s.x = target; s.v = 0; }
  return s.x;
}
const sp = () => ({ x: 0, v: 0 });

export const cameraRig = {
  ctx: null,
  appliesShake: true,   // the shake comes from ctx.impact (src/fx/impact.js); render.js checks this flag
  time: 0,
  mode: 'title',
  modeT: 0,
  introT: 99,
  // chase spring state (rail-local)
  s: { px: sp(), py: sp(), pz: sp(), lx: sp(), ly: sp(), roll: sp() },
  roll: 0, fov: cc.fov,
  // pose snapshot for transitions, stored relative to the rail anchor so a blend never stalls against forward travel
  snapPos: new THREE.Vector3(), snapLook: new THREE.Vector3(), snapFov: cc.fov, snapRoll: 0,
  blendT: 1, blendDur: 1,
  _railAtPose: new THREE.Vector3(),   // rail anchor the current camera pose was computed against (last frame)
  cur: { pos: new THREE.Vector3(), look: new THREE.Vector3(), fov: cc.fov, roll: 0 },
  ideal: { pos: new THREE.Vector3(), look: new THREE.Vector3() },
  lag: 0,
  deathPos: new THREE.Vector3(),
  orbitA: 0.6,

  init(ctx) {
    this.ctx = ctx;
  },

  reset(ctx) {
    this.introT = 99;
    this.roll = 0; this.fov = hp().camFov ?? cc.fov;
    this.snapToChase(ctx);
    this.blendT = 1;
  },

  addTrauma(x) { this.ctx?.impact?.addShake?.(x, x / 1.5); },   // compatibility forwarder

  startIntro(ctx = this.ctx) {
    this.introT = 0;
    this.snapToChase(ctx);
    this.setMode('intro', ctx, 0);
  },

  // Place the chase springs at their ideal pose so entering chase mode never pops
  snapToChase(ctx) {
    this.chasePose(ctx);
    const s = this.s;
    s.px.x = _il.px; s.py.x = _il.py; s.pz.x = _il.pz; s.lx.x = _il.lx; s.ly.x = _il.ly;
    s.roll.x = 0;
    for (const k in s) s[k].v = 0;
    this.roll = 0;
  },

  setMode(mode, ctx, blend = 0.9) {
    if (mode === this.mode) return;
    this.snapPos.copy(ctx.camera.position).sub(this._railAtPose);
    this.snapLook.copy(this.cur.look).sub(this._railAtPose);
    this.snapFov = this.cur.fov; this.snapRoll = this.cur.roll;
    this.mode = mode; this.modeT = 0;
    this.blendT = 0; this.blendDur = blend;
  },

  // ---------------------------------------------------------------- poses (write into _pos, _look; return fov)
  // Ideal (undamped) chase pose. Also fills the rail-local target _il and this.ideal.
  chasePose(ctx) {
    const h = hp(), p = ctx.player, rail = ctx.rail, rp = rail.position;
    const ox = p.localOffset.x, oy = p.localOffset.y, vx = p.localVelocity?.x || 0;
    // normalised speed above and below base (boost push in, brake pull back)
    const cb = config.rail.baseSpeed;
    const base = rail.baseSpeed * (rail.speedMultiplier ?? 1);
    let up = 0, dn = 0;
    if (base > 1 && !rail.frozen) {
      const r = rail.speed / base;
      up = clamp((r - 1) / Math.max(0.05, (rail.boostSpeed ?? config.rail.boostSpeed) / cb - 1), 0, 1);
      dn = clamp((1 - r) / Math.max(0.05, 1 - (rail.brakeSpeed ?? config.rail.brakeSpeed) / cb), 0, 1);
    }
    const accLag = clamp((rail.accel || 0) * (h.camAccelLag ?? 0), -3, 3);
    const dist = (h.camDistance ?? cc.distance) - up * (h.camBoostPush ?? 0) + dn * (h.camBrakePull ?? 0) + accLag;
    const height = (h.camHeight ?? cc.height) + up * (h.camBoostHeight ?? 0) + dn * (h.camBrakeHeight ?? 0);
    _il.px = ox * (h.camFollowX ?? cc.followX) - vx * (h.camSwing ?? 0);
    _il.py = oy * (h.camFollowY ?? cc.followY) + height;
    _il.pz = Math.max(3, dist);
    _il.lx = ox * (h.camLookX ?? cc.lookX) + vx * (h.camLookLead ?? 0);
    _il.ly = oy * (h.camLookY ?? cc.lookY) + 0.6;
    _il.lz = -(h.camLookAhead ?? cc.lookAhead);
    _pos.set(rp.x + _il.px, rp.y + _il.py, rp.z + _il.pz);
    _look.set(rp.x + _il.lx, rp.y + _il.ly, rp.z + _il.lz);
    this.ideal.pos.copy(_pos); this.ideal.look.copy(_look);
    const kick = ctx.speedfx?.fovKick;
    return (h.camFov ?? cc.fov) + (Number.isFinite(kick) ? kick : 0);
  },

  orbitPose(ctx, wide = 1) {
    const p = ctx.player;
    const a = this.orbitA;
    const r = 9 * wide;
    // camera slightly above and the aim point above the ship, so the ship sits in the lower third
    // of the frame and leaves the middle free for title and result screens
    _pos.set(p.position.x + Math.sin(a) * r, p.position.y + 1.6 + Math.sin(this.time * 0.35) * 0.5, p.position.z + Math.cos(a) * r * 1.1);
    _look.set(p.position.x, p.position.y + 3.3 * wide, p.position.z - 0.5);
    return 50;
  },

  introPose(ctx) {
    const p = ctx.player;
    const t = clamp(this.introT / cc.introTime, 0, 1);
    const e = smooth(t);
    // chase pose target
    const fov = this.chasePose(ctx);
    const chasePos = _tmp.copy(_pos);
    const chaseLook = _tmpLook.copy(_look);
    // swoop: starts low and to the front right of the ship, sweeping around behind it
    const a = (1 - e) * 2.5;
    const r = 8 + (1 - e) * 5;
    const sx = p.position.x + Math.sin(a) * r * 0.9;
    const sy = p.position.y + 1.2 + (1 - e) * 1.4 + e * 2.2;
    const sz = p.position.z + Math.cos(a) * r;
    _pos.set(sx, sy, sz).lerp(chasePos, e * e);
    _look.set(p.position.x, p.position.y + 0.4, p.position.z - 2).lerp(chaseLook, e);
    return 58 + (fov - 58) * e;
  },

  deathPose(ctx) {
    const t = Math.min(this.modeT, 4);
    _pos.set(this.deathPos.x + 4 + t * 0.6, this.deathPos.y + 3 + t * 0.4, this.deathPos.z + 12 + t * 1.2);
    _look.copy(this.deathPos);
    return 60;
  },

  // Damped chase: springs in rail-local space toward the ideal pose, roll into the bank, never inside or in front of the ship.
  chaseUpdate(ctx, dt) {
    const h = hp(), p = ctx.player, rp = ctx.rail.position, s = this.s;
    const fov = this.chasePose(ctx);
    const z = clamp(h.camDamping ?? 1, 0.3, 2);
    spring(s.px, _il.px, h.camFreqX ?? 2.1, z, dt);
    spring(s.py, _il.py, h.camFreqY ?? 2.3, z, dt);
    spring(s.pz, _il.pz, h.camFreqZ ?? 1.7, z, dt);
    spring(s.lx, _il.lx, h.camLookFreq ?? 3, z, dt);
    spring(s.ly, _il.ly, h.camLookFreq ?? 3, z, dt);
    _pos.set(rp.x + s.px.x, rp.y + s.py.x, rp.z + s.pz.x);
    _look.set(rp.x + s.lx.x, rp.y + s.ly.x, rp.z + _il.lz);
    this.lag = _pos.distanceTo(this.ideal.pos);
    // never inside the ship, never level with or in front of it
    const minD = h.camMinDist ?? 6;
    const pp = p.position;
    if (_pos.z < pp.z + minD * 0.6) _pos.z = pp.z + minD * 0.6;
    _d.subVectors(_pos, pp);
    const dl = _d.length();
    if (dl < minD) _pos.copy(pp).addScaledVector(dl > 1e-4 ? _d.multiplyScalar(1 / dl) : _d.set(0, 0.3, 1).normalize(), minD);
    if (_look.z > _pos.z - 4) _look.z = _pos.z - 4;
    // roll into the bank (the barrel roll spin is not included)
    const maxRoll = 20 * DEG;
    const target = clamp((p.bankAngle ?? -p.bank * 0.66) * (h.camRoll ?? 0.22), -maxRoll, maxRoll);
    this.roll = clamp(spring(s.roll, target, h.camRollFreq ?? 1.8, z, dt), -maxRoll, maxRoll);
    return fov;
  },

  // ---------------------------------------------------------------- update
  update(dt, ctx) {
    this.time += dt;
    this.modeT += dt;
    const st = ctx.state;
    const phase = st.phase;

    // choose mode
    let want;
    if (phase === 'title') want = 'title';
    else if (phase === 'levelcomplete') want = 'orbit';
    else if (phase === 'victory') want = 'victory';
    else if (phase === 'gameover') want = 'death';
    else if (!ctx.player.alive) want = 'death';
    else if (this.introT < cc.introTime) want = 'intro';
    else want = 'chase';
    if (phase === 'playing' || phase === 'paused') { if (this.introT < 99 && phase === 'playing') this.introT += dt; }
    if (want !== this.mode) {
      if (want === 'chase') this.snapToChase(ctx);
      if (want === 'death') this.deathPos.copy(ctx.player.position);   // the death cam frames the wreck where it went down
      this.setMode(want, ctx, want === 'chase' ? 0.9 : want === 'death' ? 0.6 : 1.4);
    }

    let fov = cc.fov, roll = 0;
    switch (this.mode) {
      case 'title': this.orbitA += dt * 0.16; fov = this.orbitPose(ctx, 1); break;
      case 'orbit': this.orbitA += dt * 0.22; fov = this.orbitPose(ctx, 1.1); break;
      case 'victory': this.orbitA += dt * 0.12; fov = this.orbitPose(ctx, 1.5); break;
      case 'death': fov = this.deathPose(ctx); break;
      case 'intro': fov = this.introPose(ctx); break;
      default: fov = this.chaseUpdate(ctx, dt); roll = this.roll;
    }
    // the speed module smooths its FOV kick; here only a light filter so mode changes never step
    this.fov += (fov - this.fov) * (1 - Math.exp(-25 * dt));
    if (!Number.isFinite(this.fov)) this.fov = hp().camFov ?? cc.fov;

    // shake: ctx.impact owns the curves (offset in camera units, roll in radians)
    _shake.set(0, 0, 0);
    let shakeRoll = 0;
    if (ctx.impact) { _shake.copy(ctx.impact.offset); shakeRoll = ctx.impact.roll || 0; }

    // transition blend from the snapshot pose
    let fRoll = roll, fFov = this.fov;
    if (this.blendT < 1) {
      this.blendT = Math.min(1, this.blendT + dt / this.blendDur);
      const b = smooth(this.blendT);
      const rp = ctx.rail.position;
      _pos.lerpVectors(_tmp.copy(this.snapPos).add(rp), _pos, b);
      _look.lerpVectors(_tmpLook.copy(this.snapLook).add(rp), _look, b);
      fRoll = this.snapRoll + (roll - this.snapRoll) * b;
      fFov = this.snapFov + (this.fov - this.snapFov) * b;
    }

    const cam = ctx.camera;
    cam.position.copy(_pos).add(_shake);
    cam.lookAt(_look);
    if (fRoll || shakeRoll) cam.rotateZ(fRoll + shakeRoll);
    // FOV widened on narrow screens so the play field stays visible
    const aspect = cam.aspect || 1.78;
    const fovOut = clamp(fFov * (1 + Math.max(0, 1.5 - aspect) * 0.35), 20, 140);
    if (Math.abs(cam.fov - fovOut) > 0.01) { cam.fov = fovOut; cam.updateProjectionMatrix(); }

    this.cur.pos.copy(cam.position);
    this.cur.look.copy(_look);
    this.cur.fov = fFov; this.cur.roll = fRoll;
    this._railAtPose.copy(ctx.rail.position);
  },
};
