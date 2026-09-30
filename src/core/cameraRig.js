// Chase camera with trailing spring follow, look-ahead that leads the turn, swing with sideways speed, roll into the bank,
// speed dependent distance and height (push in on boost, pull back on brake, a short lag when the speed jumps), death cam, and the
// orbit shot used behind the title and end screens. On top of the base camera three layers from the cinema director (ctx.cinema,
// src/fx/cinema.js) are composed every frame:
//   1. signature moment: offsets added to the chase TARGET (so the chase springs smooth it and the chase safety limits still hold)
//   2. level intro: a rail relative flythrough blended over the damped chase camera with the intro weight (1 at the start, 0 at the end)
//   3. takeover shot (mode 'cinema'): a world space pose blended over whatever the base camera is with cinema.weight
// Layers blend position linearly and orientation with a quaternion slerp, so no blend ever swings through a strange direction. The
// chase springs keep running under every layer, so handing the camera back never pops.
// All chase values are live feel parameters (feel.p.handling.cam*, src/feel/handling.js), read every frame.
// FOV = camFov + ctx.speedfx.fovKick (the speed module owns the kick curve). Shake comes only from ctx.impact.
// The chase springs run in rail-local space (camera minus rail anchor), so forward travel never adds lag; only changes in
// the desired pose do. Springs are critically damped by default (camDamping 1), substepped and allocation free.
// Public: mode ('title' | 'orbit' | 'victory' | 'death' | 'chase', or 'intro' / 'cinema' while those layers own the view), base (the
//   base mode under the layers), cur { pos, look, fov, roll }, ideal { pos, look } (undamped chase target, for telemetry),
//   chaseOut { pos, look, fov } (the live chase camera, helpers.chasePose), lag (distance between ideal and actual chase position),
//   addTrauma(x), startIntro(), reset().
import * as THREE from 'three';
import { config } from '../config.js';
import { feel } from './feel.js';

const cc = config.camera;
const clamp = THREE.MathUtils.clamp;
const smooth = (t) => { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); };
const DEG = Math.PI / 180;
const hp = () => feel.p.handling || {};
const fin = Number.isFinite;

const _pos = new THREE.Vector3();
const _look = new THREE.Vector3();
const _tmp = new THREE.Vector3();
const _tmpLook = new THREE.Vector3();
const _shake = new THREE.Vector3();
const _d = new THREE.Vector3();
const _lp = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _ql = new THREE.Quaternion();
const _qr = new THREE.Quaternion();
const _m = new THREE.Matrix4();
const _up = new THREE.Vector3(0, 1, 0);
const _z = new THREE.Vector3(0, 0, 1);
const _fwd = new THREE.Vector3();
// ideal chase target in rail-local space, written by chasePose
const _il = { px: 0, py: 0, pz: 0, lx: 0, ly: 0, lz: 0 };
const NO_OFFSET = { cx: 0, cy: 0, cz: 0, lx: 0, ly: 0, lz: 0, fov: 0, roll: 0 };

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

// camera orientation for a look at plus a roll around the view axis (same result as camera.lookAt then rotateZ)
function orient(pos, look, roll, out) {
  if (pos.distanceToSquared(look) < 1e-8) _lp.copy(pos).z -= 1; else _lp.copy(look);
  _m.lookAt(pos, _lp, _up);
  out.setFromRotationMatrix(_m);
  if (roll) out.multiply(_qr.setFromAxisAngle(_z, roll));
  return out;
}

export const cameraRig = {
  ctx: null,
  appliesShake: true,   // the shake comes from ctx.impact (src/fx/impact.js); render.js checks this flag
  time: 0,
  mode: 'title',
  base: 'title',
  modeT: 0,
  // chase spring state (rail-local)
  s: { px: sp(), py: sp(), pz: sp(), lx: sp(), ly: sp(), roll: sp() },
  roll: 0, fov: cc.fov,
  // pose snapshot for base mode transitions, stored relative to the rail anchor so a blend never stalls against forward travel
  snapPos: new THREE.Vector3(), snapLook: new THREE.Vector3(), snapFov: cc.fov, snapRoll: 0,
  blendT: 1, blendDur: 1,
  _railAtPose: new THREE.Vector3(),   // rail anchor the current camera pose was computed against (last frame)
  cur: { pos: new THREE.Vector3(), look: new THREE.Vector3(), fov: cc.fov, roll: 0 },
  ideal: { pos: new THREE.Vector3(), look: new THREE.Vector3() },
  chaseOut: { pos: new THREE.Vector3(), look: new THREE.Vector3(), fov: cc.fov },
  lag: 0,
  deathPos: new THREE.Vector3(),
  orbitA: 0.6,
  // takeover start snapshot (a shot that starts while the previous one is still blending out starts from the actual camera)
  _shotId: 0, _shotSnap: false, _snapQ: new THREE.Quaternion(), _snapP: new THREE.Vector3(), _snapFov: cc.fov, _snapDist: 30,
  _curQ: new THREE.Quaternion(), _curDist: 30,

  init(ctx) {
    this.ctx = ctx;
  },

  reset(ctx) {
    this.roll = 0; this.fov = hp().camFov ?? cc.fov;
    this.snapToChase(ctx);
    this.blendT = 1;
    this._shotSnap = false;
    this._shotId = ctx.cinema?.shotId ?? 0;
  },

  addTrauma(x) { this.ctx?.impact?.addShake?.(x, x / 1.5); },   // compatibility forwarder

  // Level start: a cut to the chase camera with the intro flythrough layered on top (the director runs it).
  startIntro(ctx = this.ctx) {
    this.snapToChase(ctx);
    this.setMode('chase', ctx, 0);
    this.fov = this.chasePose(ctx);
    ctx.cinema?.startIntro?.(ctx);
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

  // Base mode change with a blend from the current camera. blend 0 cuts.
  setMode(mode, ctx, blend = 0.9) {
    if (mode === this.base) return;
    this.snapPos.copy(ctx.camera.position).sub(this._railAtPose);
    this.snapLook.copy(this.cur.look).sub(this._railAtPose);
    this.snapFov = this.cur.fov; this.snapRoll = this.cur.roll;
    this.base = mode; this.mode = mode; this.modeT = 0;
    this.blendT = blend > 0 ? 0 : 1; this.blendDur = Math.max(1e-3, blend);
  },

  // ---------------------------------------------------------------- poses (write into _pos, _look; return fov)
  // Ideal (undamped) chase pose including the signature moment offsets. Also fills the rail-local target _il and this.ideal.
  chasePose(ctx) {
    const h = hp(), p = ctx.player, rail = ctx.rail, rp = rail.position;
    const mo = ctx.cinema?.moment?.on ? ctx.cinema.moment.off : NO_OFFSET;
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
    _il.px = ox * (h.camFollowX ?? cc.followX) - vx * (h.camSwing ?? 0) + mo.cx;
    _il.py = oy * (h.camFollowY ?? cc.followY) + height + mo.cy;
    _il.pz = Math.max(3, dist + mo.cz);
    _il.lx = ox * (h.camLookX ?? cc.lookX) + vx * (h.camLookLead ?? 0) + mo.lx;
    _il.ly = oy * (h.camLookY ?? cc.lookY) + 0.6 + mo.ly;
    _il.lz = -(h.camLookAhead ?? cc.lookAhead) - mo.lz;
    _pos.set(rp.x + _il.px, rp.y + _il.py, rp.z + _il.pz);
    _look.set(rp.x + _il.lx, rp.y + _il.ly, rp.z + _il.lz);
    this.ideal.pos.copy(_pos); this.ideal.look.copy(_look);
    const kick = ctx.speedfx?.fovKick;
    return (h.camFov ?? cc.fov) + (Number.isFinite(kick) ? kick : 0) + mo.fov;
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
    // roll into the bank (the barrel roll spin is not included), plus the moment roll
    const maxRoll = 20 * DEG;
    const mo = ctx.cinema?.moment?.on ? ctx.cinema.moment.off : NO_OFFSET;
    const target = clamp((p.bankAngle ?? -p.bank * 0.66) * (h.camRoll ?? 0.22) + mo.roll, -maxRoll, maxRoll);
    this.roll = clamp(spring(s.roll, target, h.camRollFreq ?? 1.8, z, dt), -maxRoll, maxRoll);
    return fov;
  },

  // ---------------------------------------------------------------- update
  update(dt, ctx) {
    this.time += dt;
    this.modeT += dt;
    const st = ctx.state;
    const phase = st.phase;
    const cin = ctx.cinema;

    // choose the base mode
    let want;
    if (phase === 'title') want = 'title';
    else if (phase === 'levelcomplete') want = 'orbit';
    else if (phase === 'victory') want = 'victory';
    else if (phase === 'gameover') want = 'death';
    else if (!ctx.player.alive) want = 'death';
    else want = 'chase';
    if (want !== this.base) {
      if (want === 'chase') this.snapToChase(ctx);
      if (want === 'death') this.deathPos.copy(ctx.player.position);   // the death cam frames the wreck where it went down
      this.setMode(want, ctx, want === 'chase' ? 0.9 : want === 'death' ? 0.6 : 1.4);
    }

    let fov = cc.fov, roll = 0;
    switch (this.base) {
      case 'title': this.orbitA += dt * 0.16; fov = this.orbitPose(ctx, 1); break;
      case 'orbit': this.orbitA += dt * 0.22; fov = this.orbitPose(ctx, 1.1); break;
      case 'victory': this.orbitA += dt * 0.12; fov = this.orbitPose(ctx, 1.5); break;
      case 'death': fov = this.deathPose(ctx); break;
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
    if (this.base === 'chase') { this.chaseOut.pos.copy(_pos); this.chaseOut.look.copy(_look); this.chaseOut.fov = fFov; }

    // ---- layers
    orient(_pos, _look, fRoll, _q);
    let dist = Math.max(1, _pos.distanceTo(_look));
    let mode = this.base;
    // level intro flythrough (only over the chase camera)
    const it = cin?.intro;
    if (it?.on && this.base === 'chase' && it.weight > 0) {
      const w = clamp(it.weight, 0, 1), ip = it.pose;
      orient(ip.pos, ip.look, ip.roll, _ql);
      _pos.lerp(ip.pos, w);
      _q.slerp(_ql, w);
      fFov += (ip.fov - fFov) * w;
      fRoll += (ip.roll - fRoll) * w;
      dist += (Math.max(1, ip.pos.distanceTo(ip.look)) - dist) * w;
      mode = 'intro';
    }
    // takeover shot
    const cw = cin ? clamp(cin.weight || 0, 0, 1) : 0;
    if (cin && cin.shotId !== this._shotId) {
      this._shotId = cin.shotId;
      this._shotSnap = !!cin.fromSnapshot;
      if (this._shotSnap) {
        this._snapP.copy(this.cur.pos).sub(this._railAtPose);
        this._snapQ.copy(this._curQ); this._snapFov = this.cur.fov; this._snapDist = this._curDist;
      }
    }
    if (cw > 0) {
      const cp = cin.pose;
      if (this._shotSnap && cin.active && cin.t <= (cin._cfg?.blendIn ?? 0) + 0.05) {
        _pos.copy(this._snapP).add(ctx.rail.position); _q.copy(this._snapQ); fFov = this._snapFov; dist = this._snapDist;
      } else this._shotSnap = false;
      orient(cp.pos, cp.look, cp.roll, _ql);
      _pos.lerp(cp.pos, cw);
      _q.slerp(_ql, cw);
      fFov += (cp.fov - fFov) * cw;
      fRoll += (cp.roll - fRoll) * cw;
      dist += (Math.max(1, cp.pos.distanceTo(cp.look)) - dist) * cw;
      mode = 'cinema';
    }
    this.mode = mode;
    if (!fin(_pos.x) || !fin(_pos.y) || !fin(_pos.z) || !fin(_q.x) || !fin(_q.y) || !fin(_q.z) || !fin(_q.w)) {
      // last line of defence: never hand a broken pose to the renderer
      this.chasePose(ctx); orient(_pos, _look, 0, _q); fFov = this.fov; fRoll = 0; dist = 30;
    }
    if (!fin(fFov)) fFov = hp().camFov ?? cc.fov;

    const cam = ctx.camera;
    cam.position.copy(_pos).add(_shake);
    cam.quaternion.copy(_q);
    if (shakeRoll) cam.rotateZ(shakeRoll);
    // FOV widened on narrow screens so the play field stays visible
    const aspect = cam.aspect || 1.78;
    const fovOut = clamp(fFov * (1 + Math.max(0, 1.5 - aspect) * 0.35), 20, 140);
    if (Math.abs(cam.fov - fovOut) > 0.01) { cam.fov = fovOut; cam.updateProjectionMatrix(); }

    this._curQ.copy(_q); this._curDist = dist;
    this.cur.pos.copy(cam.position);
    _fwd.set(0, 0, -1).applyQuaternion(_q);
    this.cur.look.copy(_pos).addScaledVector(_fwd, dist);
    this.cur.fov = fFov; this.cur.roll = fRoll;
    this._railAtPose.copy(ctx.rail.position);
  },
};
