// Chase camera with damped follow, banking roll, boost FOV kick, brake pull back, trauma shake,
// level intro swoop, death cam, and the orbit shot used behind the title and end screens.
import * as THREE from 'three';
import { config } from '../config.js';

const cc = config.camera;
const clamp = THREE.MathUtils.clamp;
const smooth = (t) => { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); };
const damp = (cur, target, rate, dt) => cur + (target - cur) * (1 - Math.exp(-rate * dt));

const _pos = new THREE.Vector3();
const _look = new THREE.Vector3();
const _tmp = new THREE.Vector3();
const _shake = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _zAxis = new THREE.Vector3(0, 0, 1);

// cheap smooth noise from a few incommensurate sines
function noise(t, seed) {
  return Math.sin(t * 17.3 + seed) * 0.5 + Math.sin(t * 31.7 + seed * 2.1) * 0.3 + Math.sin(t * 7.9 + seed * 0.7) * 0.2;
}

export const cameraRig = {
  ctx: null,
  trauma: 0,
  time: 0,
  mode: 'title',
  modeT: 0,
  introT: 99,
  // damped chase state
  cpos: new THREE.Vector3(),
  clook: new THREE.Vector3(),
  roll: 0, fov: cc.fov, pull: 0,
  // pose snapshot for transitions
  snapPos: new THREE.Vector3(), snapLook: new THREE.Vector3(), snapFov: cc.fov, snapRoll: 0,
  blendT: 1, blendDur: 1,
  cur: { pos: new THREE.Vector3(), look: new THREE.Vector3(), fov: cc.fov, roll: 0 },
  deathPos: new THREE.Vector3(),
  orbitA: 0.6,

  init(ctx) {
    this.ctx = ctx;
    ctx.events.on('player:damage', (p) => this.addTrauma(clamp((p?.amount ?? 10) / 32, 0.12, 0.7)));
    ctx.events.on('player:dead', () => { this.addTrauma(1); this.deathPos.copy(ctx.player.position); });
    ctx.events.on('boss:defeated', () => this.addTrauma(0.9));
    ctx.events.on('enemy:killed', (p) => { if ((p?.points ?? 0) >= 800 || p?.enemy?.big) this.addTrauma(0.35); });
    ctx.events.on('player:bomb', () => this.addTrauma(0.25));
    ctx.events.on('player:roll', () => this.addTrauma(0.08));
  },

  reset(ctx) {
    this.trauma = 0;
    this.introT = 99;
    this.roll = 0; this.pull = 0; this.fov = cc.fov;
    this.snapToChase(ctx);
    this.blendT = 1;
  },

  addTrauma(x) { this.trauma = Math.min(1, this.trauma + x); },

  startIntro(ctx = this.ctx) {
    this.introT = 0;
    this.trauma = 0;
    this.snapToChase(ctx);
    this.setMode('intro', ctx, 0);
  },

  // Place damped chase state at its ideal pose so entering chase mode never pops
  snapToChase(ctx) {
    this.chasePose(ctx, 0, true);
    this.cpos.copy(_pos); this.clook.copy(_look);
  },

  setMode(mode, ctx, blend = 0.9) {
    if (mode === this.mode) return;
    this.snapPos.copy(ctx.camera.position);
    this.snapLook.copy(this.cur.look);
    this.snapFov = this.cur.fov; this.snapRoll = this.cur.roll;
    this.mode = mode; this.modeT = 0;
    this.blendT = 0; this.blendDur = blend;
  },

  // ---------------------------------------------------------------- poses (write into _pos, _look; return fov)
  chasePose(ctx, dt, instant = false) {
    const p = ctx.player, rp = ctx.rail.position;
    const ox = p.localOffset.x, oy = p.localOffset.y;
    const boost = p.boostAmount || 0, brake = p.brakeAmount || 0;
    const dist = cc.distance + boost * cc.boostPull + brake * cc.brakePull;
    _pos.set(rp.x + ox * cc.followX, rp.y + oy * cc.followY + cc.height, rp.z + dist);
    _look.set(rp.x + ox * cc.lookX, rp.y + oy * cc.lookY + 0.6, rp.z - cc.lookAhead);
    return cc.fov + boost * cc.boostFov + brake * cc.brakeFov;
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
    const fov = this.chasePose(ctx, 0);
    const chasePos = _tmp.copy(_pos);
    const chaseLook = _look.clone();
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
      this.setMode(want, ctx, want === 'chase' ? 0.9 : want === 'death' ? 0.6 : 1.4);
    }

    let fov = cc.fov, roll = 0;
    switch (this.mode) {
      case 'title': this.orbitA += dt * 0.16; fov = this.orbitPose(ctx, 1); break;
      case 'orbit': this.orbitA += dt * 0.22; fov = this.orbitPose(ctx, 1.1); break;
      case 'victory': this.orbitA += dt * 0.12; fov = this.orbitPose(ctx, 1.5); break;
      case 'death': fov = this.deathPose(ctx); break;
      case 'intro': fov = this.introPose(ctx); break;
      default: {
        // damped chase
        const p = ctx.player;
        const target = this.chasePose(ctx, dt);
        const rate = cc.damping;
        this.cpos.x = damp(this.cpos.x, _pos.x, rate * 1.15, dt);
        this.cpos.y = damp(this.cpos.y, _pos.y, rate, dt);
        this.cpos.z = damp(this.cpos.z, _pos.z, rate * 1.6, dt);
        this.clook.x = damp(this.clook.x, _look.x, rate * 1.4, dt);
        this.clook.y = damp(this.clook.y, _look.y, rate * 1.4, dt);
        this.clook.z = _look.z;
        _pos.copy(this.cpos); _look.copy(this.clook);
        // bank: lean into lateral motion, plus a touch of roll while barrel rolling
        const lvx = (p.localVelocity?.x || 0) / config.player.speedX;
        const targetRoll = -lvx * cc.roll * 0.35 * (p.isRolling ? 0.5 : 1);
        this.roll = damp(this.roll, targetRoll, 6, dt);
        roll = this.roll;
        fov = target;
      }
    }
    this.fov = damp(this.fov, fov, 10, dt);

    // shake
    this.trauma = Math.max(0, this.trauma - dt * 1.5);
    const fxs = ctx.fx?.shakeOffset;
    _shake.set(0, 0, 0);
    let shakeRoll = 0;
    if (this.trauma > 0) {
      const a = this.trauma * this.trauma * cc.shakeMax;
      _shake.set(noise(this.time, 1) * a, noise(this.time, 5) * a, noise(this.time, 9) * a * 0.4);
      shakeRoll = noise(this.time, 13) * a * 0.03;
    }
    if (fxs && fxs.isVector3) _shake.add(fxs);

    // transition blend from the snapshot pose
    let fPos = _pos, fLook = _look, fRoll = roll, fFov = this.fov;
    if (this.blendT < 1) {
      this.blendT = Math.min(1, this.blendT + dt / this.blendDur);
      const b = smooth(this.blendT);
      _pos.lerpVectors(this.snapPos, _pos, b);
      _look.lerpVectors(this.snapLook, _look, b);
      fRoll = this.snapRoll + (roll - this.snapRoll) * b;
      fFov = this.snapFov + (this.fov - this.snapFov) * b;
    }

    const cam = ctx.camera;
    cam.position.copy(fPos).add(_shake);
    cam.lookAt(fLook);
    if (fRoll || shakeRoll) cam.rotateZ(fRoll + shakeRoll);
    // FOV widened on narrow screens so the play field stays visible
    const aspect = cam.aspect || 1.78;
    const fovOut = fFov * (1 + Math.max(0, 1.5 - aspect) * 0.35);
    if (Math.abs(cam.fov - fovOut) > 0.01) { cam.fov = fovOut; cam.updateProjectionMatrix(); }

    this.cur.pos.copy(cam.position);
    this.cur.look.copy(fLook);
    this.cur.fov = fFov; this.cur.roll = fRoll;
  },
};
