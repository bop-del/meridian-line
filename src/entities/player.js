// The Vanta controller: steering with inertia and banking, barrel roll, boost/brake, twin laser,
// charge lock-on volley, smart bomb, damage, death and respawn, reticles.
// Public fields and methods: player.hitRadius (fair hitbox for shots), player.reticleFar, player.locks[],
// player.hovered[] (enemies under the far reticle while holding fire), player.charge (0..1) and player.charging,
// player.boostAmount/brakeAmount (smoothed 0..1 for camera and renderer), player.aimDir, player.localVelocity,
// player.upgradeLaser(), player.collectPickup(kind) (fallback pickup effects), player.knock(dir, strength),
// player.bank (visual roll normalised to the bank angle, about -1..1), player.bankAngle / pitchAngle / yawAngle (radians),
// player.surge (visual forward slip in u, + is back).
// Handling is live tuned through feel.p.handling (src/feel/handling.js): steering, soft edges, attitude springs,
// surge, barrel roll. Values are read every frame.
// Damage units: 1 = one twin-laser hit (enemy hp is expressed in hits). Death emits `game:over` when no lives remain.
import * as THREE from 'three';
import { createVanta } from '../models/vanta.js';
import { config } from '../config.js';
import { feel } from '../core/feel.js';

const cfg = config.player;
const clamp = THREE.MathUtils.clamp;
const damp = (cur, target, rate, dt) => cur + (target - cur) * (1 - Math.exp(-rate * dt));
const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const easeOut = (t) => 1 - Math.pow(1 - t, 3);
const DEG = Math.PI / 180;
const hp = () => feel.p.handling || {};

// Damped spring on s = { x, v } toward target. freq in Hz, zeta is the damping ratio (1 critical). Substepped, allocation free.
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

// One steering axis: coast (decel) when centred, reverse bite when steering against the motion, else accel.
function stepAxis(v, t, top, accel, rev, decel, dt) {
  const rate = Math.abs(t) < 0.02 * top ? decel : (Math.sign(t) !== Math.sign(v) && Math.abs(v) > 0.06 * top ? rev : accel);
  return damp(v, t, rate, dt);
}

// Limit the velocity toward an edge so the ship eases to a stop exactly at +-bound (constant deceleration zone of width soft).
function softEdge(off, v, bound, vref, soft) {
  if (soft <= 0.01) return v;
  const limP = vref * Math.sqrt(Math.max(0, bound - off) / soft);
  if (v > limP) v = limP;
  const limN = vref * Math.sqrt(Math.max(0, bound + off) / soft);
  if (v < -limN) v = -limN;
  return v;
}

const _d = new THREE.Vector3();
const _m = new THREE.Vector3();
const _t = new THREE.Vector3();
const _r = new THREE.Vector3();

export const player = {
  position: new THREE.Vector3(),
  velocity: new THREE.Vector3(),
  radius: cfg.radius,
  hitRadius: cfg.hitRadius,
  alive: true,
  invulnerable: false,
  reticle: new THREE.Vector3(),
  reticleFar: new THREE.Vector3(),
  aimDir: new THREE.Vector3(0, 0, -1),
  locks: [],
  hovered: [],          // enemies currently under the far reticle while charging (UI hint)
  localOffset: new THREE.Vector2(),
  localVelocity: new THREE.Vector2(),
  isBoosting: false, isBraking: false, isRolling: false,
  boostAmount: 0, brakeAmount: 0,   // smoothed 0..1 visual amounts (renderer, camera)
  charge: 0,                        // 0..1 charge shot progress
  charging: false,
  controlsEnabled: false,
  rollAngle: 0, bank: 0,
  bankAngle: 0, pitchAngle: 0, yawAngle: 0, surge: 0,
  group: null, ship: null,
  ctx: null,

  // internal timers
  _invuln: 0, _respawnInv: false, _rollT: 0, _rollDir: 1, _rollCd: 0, _fireCd: 0, _bombCd: 0,
  _side: 0, _hold: 0, _boostDelay: 0, _deathT: 0, _deathDone: false, _time: 0,
  _volley: [], _smoke: null, _alarmT: 0, _knock: new THREE.Vector2(), _lastEngine: -1,
  _acc: new THREE.Vector2(), _prevLv: new THREE.Vector2(),
  _sRoll: { x: 0, v: 0 }, _sPitch: { x: 0, v: 0 }, _sYaw: { x: 0, v: 0 }, _sSurge: { x: 0, v: 0 },

  init(ctx) {
    this.ctx = ctx;
    this.ship = createVanta();
    this.group = this.ship.group;
    ctx.scene.add(this.group);
  },

  reset(ctx) {
    this.ctx = ctx;
    const s = ctx.state;
    this.alive = true; this.invulnerable = false;
    this._invuln = 0; this._respawnInv = false; this._rollT = 0; this._rollCd = 0; this._fireCd = 0; this._bombCd = 0;
    this._hold = 0; this._deathT = 0; this._deathDone = false; this._d2 = this._d3 = false; this._volley.length = 0; this._alarmT = 0;
    this.isBoosting = this.isBraking = this.isRolling = false;
    this.boostAmount = this.brakeAmount = 0; this.charge = 0; this.charging = false;
    this.rollAngle = 0; this.bank = 0;
    this._resetAttitude();
    this.localOffset.set(0, 0); this.localVelocity.set(0, 0); this._knock.set(0, 0);
    this.clearLocks();
    this._stopSmoke();
    if (this.group) this.group.visible = true;
    this.ship?.setBoost?.(0); this.ship?.setBrake?.(0); this.ship?.setRoll?.(0); this.ship?.setBank?.(0, 0, 0); this.ship?.setDamage?.(0);
    this.syncTransform(ctx);
    this.updateReticles(ctx);
    void s;
  },

  // ------------------------------------------------------------------ helpers
  bounds(ctx) { return ctx.world?.levelInfo?.bounds ?? config.bounds; },

  _resetAttitude() {
    for (const s of [this._sRoll, this._sPitch, this._sYaw, this._sSurge]) { s.x = 0; s.v = 0; }
    this._acc.set(0, 0); this._prevLv.copy(this.localVelocity);
    this.bankAngle = this.pitchAngle = this.yawAngle = this.surge = 0;
  },

  syncTransform(ctx) {
    const rp = ctx.rail.position;
    this.position.set(rp.x + this.localOffset.x, rp.y + this.localOffset.y, rp.z + this.surge);
    this.group.position.copy(this.position);
    this.velocity.set(this.localVelocity.x, this.localVelocity.y, -ctx.rail.speed);
  },

  clearLocks() { this.locks.length = 0; this.hovered.length = 0; },

  updateReticles(ctx) {
    const a = ctx.input.aim;
    _d.set(a.x * 0.32, a.y * 0.22, -1).normalize();
    this.aimDir.copy(_d);
    this.reticle.copy(this.position).addScaledVector(_d, 46);
    this.reticleFar.copy(this.position).addScaledVector(_d, 150);
  },

  // World position of a wing cannon (side -1 left, +1 right). Uses the model anchors when present.
  muzzle(side, out) {
    const a = side < 0 ? this.ship?.anchors?.cannonL : this.ship?.anchors?.cannonR;
    if (a?.getWorldPosition) { a.getWorldPosition(out); out.z -= 0.6; return out; }
    return out.set(this.position.x + side * 1.05, this.position.y - 0.15, this.position.z - 1.7);
  },

  _stopSmoke() { if (this._smoke) { this._smoke.stop?.(); this._smoke = null; } },

  // Impulse from ramming an obstacle or enemy (direction in XY, strength in u/s)
  knock(dir, strength) {
    this._knock.set(dir.x * strength, dir.y * strength);
  },

  // ------------------------------------------------------------------ main update
  update(dt, ctx) {
    this._time += dt;
    const s = ctx.state;
    const inp = ctx.input;
    const h = hp();
    const idle = !this.controlsEnabled;
    const active = this.alive && !idle;

    // timers
    this._rollCd = Math.max(0, this._rollCd - dt);
    this._fireCd = Math.max(0, this._fireCd - dt);
    this._bombCd = Math.max(0, this._bombCd - dt);
    this._invuln = Math.max(0, this._invuln - dt);
    if (s.boostCooldown > 0) s.boostCooldown = Math.max(0, s.boostCooldown - dt);

    if (idle) { this.updateIdle(dt, ctx); return; }

    if (!this.alive) { this.updateDead(dt, ctx); return; }

    // ---- boost and brake
    const wantBrake = inp.brake;
    let wantBoost = inp.boost && !wantBrake && s.boostCooldown <= 0 && s.boost > (this.isBoosting ? 0 : cfg.boostMinStart);
    const wasBoosting = this.isBoosting;
    if (wantBoost) {
      s.boost = Math.max(0, s.boost - cfg.boostDrain * dt);
      this._boostDelay = cfg.boostRegenDelay;
      if (s.boost <= 0) { wantBoost = false; s.boostCooldown = cfg.boostLockout; }
    } else {
      this._boostDelay -= dt;
      if (this._boostDelay <= 0) s.boost = Math.min(1, s.boost + cfg.boostRegen * dt);
    }
    this.isBoosting = wantBoost;
    this.isBraking = wantBrake && !wantBoost;
    if (this.isBoosting !== wasBoosting) {
      ctx.events.emit('player:boost', { on: this.isBoosting });
      if (this.isBoosting) ctx.audio?.sfx?.('boost');
    }
    if (this.isBraking && !this._wasBraking) ctx.audio?.sfx?.('brake');
    this._wasBraking = this.isBraking;
    this.boostAmount = damp(this.boostAmount, this.isBoosting ? 1 : 0, this.isBoosting ? 7 : 4, dt);
    this.brakeAmount = damp(this.brakeAmount, this.isBraking ? 1 : 0, 6, dt);

    // ---- barrel roll
    if (!this.isRolling && this._rollCd <= 0 && (inp.rollLeft || inp.rollRight)) this.barrelRoll(inp.rollRight ? 1 : -1);
    if (this.isRolling) {
      this._rollT += dt;
      const p = clamp(this._rollT / (h.rollTime ?? cfg.rollTime), 0, 1);
      const snap = clamp(h.rollShape ?? 0.6, 0, 1);
      this.rollAngle = -this._rollDir * Math.PI * 2 * (easeInOut(p) * (1 - snap) + easeOut(p) * snap);
      if (p >= 1) { this.isRolling = false; this.rollAngle = 0; this._rollCd = h.rollCooldown ?? cfg.rollCooldown; }
    }

    // ---- steering with inertia (exponential approach to the steered speed, separate accel, reverse and coast rates)
    const speedX = h.speedX ?? cfg.speedX, speedY = h.speedY ?? cfg.speedY;
    let steerScale = this.isBoosting ? (h.boostSteer ?? cfg.boostSteer) : this.isBraking ? (h.brakeSteer ?? cfg.brakeSteer) : 1;
    const committed = this.isRolling && this._rollT < (h.rollCommit ?? 0);
    if (this.isRolling) steerScale *= h.rollSteer ?? 1;
    const tx = inp.axis.x * speedX * steerScale;
    const ty = inp.axis.y * speedY * steerScale;
    const lv = this.localVelocity;
    const accel = h.accel ?? cfg.accel, rev = h.reverseAccel ?? cfg.reverseAccel, decel = h.decel ?? cfg.decel;
    if (!committed) lv.x = stepAxis(lv.x, tx, speedX, accel, rev, decel, dt);   // roll commit: hold the side kick, ignore steering
    lv.y = stepAxis(lv.y, ty, speedY, accel, rev, decel, dt);
    if (this._knock.lengthSq() > 0.01) { lv.x += this._knock.x; lv.y += this._knock.y; this._knock.set(0, 0); }
    // soft edges: ease to a stop at the play area bounds, then a hard clamp as the safety net
    const b = this.bounds(ctx);
    const soft = h.edgeSoft ?? 0;
    lv.x = softEdge(this.localOffset.x, lv.x, b.x, speedX * 1.2, Math.min(soft, b.x * 0.4));
    lv.y = softEdge(this.localOffset.y, lv.y, b.y, speedY * 1.2, Math.min(soft, b.y * 0.4));
    this.localOffset.x += lv.x * dt;
    this.localOffset.y += lv.y * dt;
    if (this.localOffset.x > b.x) { this.localOffset.x = b.x; if (lv.x > 0) lv.x = 0; }
    else if (this.localOffset.x < -b.x) { this.localOffset.x = -b.x; if (lv.x < 0) lv.x = 0; }
    if (this.localOffset.y > b.y) { this.localOffset.y = b.y; if (lv.y > 0) lv.y = 0; }
    else if (this.localOffset.y < -b.y) { this.localOffset.y = -b.y; if (lv.y < 0) lv.y = 0; }
    // surge: the ship slips back when the rail speeds up and forward when it slows (visible mass)
    const sMax = h.surgeMax ?? 0;
    this.surge = spring(this._sSurge, clamp((ctx.rail.accel || 0) * (h.surgeGain ?? 0), -sMax, sMax), h.surgeFreq ?? 1.8, 0.75, dt);

    this.syncTransform(ctx);
    this.updateReticles(ctx);
    this.applyModel(dt, ctx, steerScale);

    // ---- invulnerability and flicker
    this.invulnerable = this._invuln > 0 || this.isRolling;
    if (this._invuln > 0 && !this.isRolling) this.group.visible = Math.floor(this._time * 20) % 2 === 0 || this._invuln < 0.05;
    else this.group.visible = true;
    if (this._invuln <= 0) this._respawnInv = false;

    // ---- weapons
    this.updateWeapons(dt, ctx);
    if (inp.bomb) this.launchBomb();

    // ---- low health warning
    if (s.health < 26 && s.health > 0) {
      this._alarmT -= dt;
      if (this._alarmT <= 0) { this._alarmT = 1.4; ctx.audio?.sfx?.('alarm', { volume: 0.5 }); }
    }

    // ---- feedback
    ctx.fx?.speedLines?.(this.boostAmount);
    const bs = ctx.rail.boostSpeed ?? config.rail.boostSpeed, ks = ctx.rail.brakeSpeed ?? config.rail.brakeSpeed;
    const sp01 = clamp((ctx.rail.speed - ks) / Math.max(1, bs - ks), 0, 1);
    ctx.audio?.setEngine?.(sp01, this.isBoosting);
  },

  // Attitude: underdamped springs toward a blend of the actual speed and the stick (the stick share makes the ship lean
  // the moment a key goes down, the springs give the overshoot and settle that read as mass).
  applyModel(dt, ctx, steerScale = 1) {
    const h = hp();
    const lv = this.localVelocity, ax = ctx.input.axis;
    const sX = h.speedX ?? cfg.speedX, sY = h.speedY ?? cfg.speedY;
    // smoothed sideways and vertical acceleration (knocks excluded by the clamp below), normalised by a nominal 12/s ramp
    if (dt > 0) {
      const k = 1 - Math.exp(-20 * dt);
      this._acc.x += ((lv.x - this._prevLv.x) / dt - this._acc.x) * k;
      this._acc.y += ((lv.y - this._prevLv.y) / dt - this._acc.y) * k;
      this._prevLv.copy(lv);
    }
    const ka = this.isRolling ? 0 : h.bankAccel ?? 0;
    const w = this.isRolling ? 0 : clamp(h.bankIntent ?? 0, 0, 1);
    const nx = clamp(lv.x / sX, -1.3, 1.3) * (1 - w) + clamp(ax.x * steerScale, -1.3, 1.3) * w + ka * clamp(this._acc.x / (sX * 12), -1.2, 1.2);
    const ny = clamp(lv.y / sY, -1.3, 1.3) * (1 - w) + clamp(ax.y * steerScale, -1.3, 1.3) * w + ka * clamp(this._acc.y / (sY * 12), -1.2, 1.2);
    const bankRad = (h.bankRoll ?? 38) * DEG;
    const roll = clamp(spring(this._sRoll, -nx * bankRad, h.bankFreq ?? 2.6, h.bankDamping ?? 0.5, dt), -80 * DEG, 80 * DEG);
    const pitch = clamp(spring(this._sPitch, ny * (h.bankPitch ?? 16) * DEG, h.attFreq ?? 3, h.attDamping ?? 0.55, dt), -45 * DEG, 45 * DEG);
    const yaw = clamp(spring(this._sYaw, -nx * (h.bankYaw ?? 8) * DEG, h.attFreq ?? 3, h.attDamping ?? 0.55, dt), -30 * DEG, 30 * DEG);
    this.bankAngle = roll; this.pitchAngle = pitch; this.yawAngle = yaw;
    this.bank = bankRad > 1e-4 ? roll / bankRad : 0;
    const ship = this.ship;
    ship.setBank?.(pitch, roll, yaw);
    ship.setRoll?.(this.rollAngle);
    ship.setBoost?.(this.boostAmount);
    ship.setBrake?.(this.brakeAmount);
  },

  updateIdle(dt, ctx) {
    // title and cinematic states: hover in place, gentle sway
    const t = this._time;
    this.localOffset.set(0, 0); this.localVelocity.set(0, 0);
    if (this.surge || this._sRoll.x) this._resetAttitude();
    this.syncTransform(ctx);
    if (this.alive) {
      this.group.position.y += Math.sin(t * 1.3) * 0.18;
      this.group.visible = true;
      this.ship?.setBank?.(Math.sin(t * 0.9) * 0.05, Math.sin(t * 0.7) * 0.14, 0);
      this.ship?.setRoll?.(0);
      this.boostAmount = damp(this.boostAmount, 0.15, 3, dt);
      this.ship?.setBoost?.(this.boostAmount);
      this.ship?.setBrake?.(0);
    }
    this.updateReticles(ctx);
  },

  // ------------------------------------------------------------------ weapons
  updateWeapons(dt, ctx) {
    const inp = ctx.input;
    // queued volley shots
    if (this._volley.length) {
      for (let i = this._volley.length - 1; i >= 0; i--) {
        const v = this._volley[i];
        v.t -= dt;
        if (v.t <= 0) { this._launchHoming(v.target, v.i, ctx); this._volley.splice(i, 1); }
      }
    }
    // prune dead locks
    for (let i = this.locks.length - 1; i >= 0; i--) if (!this.locks[i].alive) this.locks.splice(i, 1);

    if (inp.fire) {
      this._hold += dt;
      this.scanHovered(ctx);
      if (!this.charging && this._hold >= cfg.chargeTime && this.hovered.length > 0) {
        this.charging = true;
        ctx.audio?.sfx?.('laserCharge');
      }
      this.charge = this.charging ? 1 : (this.hovered.length ? clamp((this._hold - 0.12) / (cfg.chargeTime - 0.12), 0, 1) : 0);
      if (this.charging) {
        this.updateLocks(dt, ctx);
      } else if (this._fireCd <= 0) {
        this.fireLaser();
      }
    } else {
      if (this.charging) this.releaseCharge(ctx);
      this._hold = 0; this.charge = 0; this.charging = false;
      if (this.hovered.length) this.hovered.length = 0;
    }
  },

  scanHovered(ctx) {
    const h = this.hovered;
    h.length = 0;
    const list = ctx.groups.enemies;
    for (let i = 0; i < list.length; i++) {
      const e = list[i];
      if (!e.alive || e.noLock || e.lockable === false) continue;
      if (this.inReticleCone(e)) h.push(e);
    }
  },

  inReticleCone(e) {
    _m.copy(e.position).sub(this.position);
    const proj = _m.dot(this.aimDir);
    if (proj < 10 || proj > 210) return false;
    _r.copy(this.aimDir).multiplyScalar(proj);
    const perp = _m.sub(_r).length();
    return perp < (e.radius || 1) + 3.6 + proj * 0.038;
  },

  updateLocks(dt, ctx) {
    for (const e of this.hovered) {
      if (this.locks.includes(e)) continue;
      if (this.locks.length >= cfg.maxLocks) break;
      e._lockT = (e._lockT || 0) + dt;
      if (e._lockT >= cfg.lockTime) {
        this.locks.push(e);
        e._lockT = 0;
        ctx.audio?.sfx?.('lockon', { pitch: 1 + this.locks.length * 0.09 });
        ctx.events.emit('player:lockon', { enemy: e });
      }
    }
  },

  releaseCharge(ctx) {
    this.charging = false;
    if (this.locks.length === 0) { if (this._fireCd <= 0) this.fireLaser(); return; }
    ctx.audio?.sfx?.('chargedShot');
    this._fireCd = 0.35;
    const n = this.locks.length;
    for (let i = 0; i < n; i++) this._volley.push({ t: i * cfg.volleyStagger, target: this.locks[i], i });
    this.locks.length = 0;
    ctx.events.emit('player:fire', { volley: n, charged: true, homing: true });
  },

  _launchHoming(target, i, ctx) {
    if (!this.alive || !target?.alive) return;
    const side = i % 2 === 0 ? -1 : 1;
    this.muzzle(side, _t);
    _d.set(side * 0.55, 0.35 + (i % 3) * 0.12, -1).normalize();
    const lvl = ctx.state.laserLevel;
    ctx.projectiles.firePlayerShot(_t, _d, {
      damage: cfg.volleyDamage * (lvl >= 3 ? 1.3 : 1), speed: cfg.volleySpeed, maxSpeed: cfg.volleySpeed * 1.5, homing: target, kind: 'homing',
      radius: 1.0, life: 2.6, turn: 9, curl: 0.25 * side, size: 1.15,
    });
    ctx.fx?.muzzleFlash?.(_t, _d);
  },

  fireLaser() {
    const ctx = this.ctx;
    if (!this.alive || !ctx) return false;
    const lvl = clamp(ctx.state.laserLevel | 0, 1, 3);
    const L = cfg.laser[lvl];
    this._fireCd = 1 / L.rate;
    // aim point with gentle assist
    _t.copy(this.position).addScaledVector(this.aimDir, 90);
    this.applyAimAssist(_t, ctx);
    const sides = L.both ? [-1, 1] : [this._side = -this._side || 1];
    for (const side of sides) {
      this.muzzle(side, _m);
      _d.copy(_t).sub(_m).normalize();
      ctx.projectiles.firePlayerShot(_m, _d, {
        damage: L.damage, speed: L.speed, radius: L.radius, size: L.size, color: L.color, level: lvl, kind: 'laser',
      });
      ctx.fx?.muzzleFlash?.(_m, _d);
    }
    // each pulse level has its own sound (src/audio/sfx2/weapons.js); the recipes randomise pitch themselves
    ctx.audio?.sfx?.(lvl >= 3 ? 'laser3' : lvl === 2 ? 'laser2' : 'laser', { volume: 0.9 });
    ctx.events.emit('player:fire', { level: lvl });
    return true;
  },

  // Bend the aim point toward the nearest enemy close to the crosshair (keyboard friendly).
  applyAimAssist(target, ctx) {
    const k = cfg.aimAssist;
    if (!k) return;
    let best = null, bd = 1e9;
    for (const e of ctx.groups.enemies) {
      if (!e.alive || e.untargetable) continue;
      _m.copy(e.position).sub(this.position);
      const proj = _m.dot(this.aimDir);
      if (proj < 14 || proj > 200) continue;
      _r.copy(this.aimDir).multiplyScalar(proj);
      const perp = _m.sub(_r).length() - (e.radius || 1);
      const lim = 2.6 + proj * 0.012;
      if (perp < lim && perp < bd) { bd = perp; best = e; }
    }
    if (best) {
      const t = _m.copy(best.position);
      // lead by enemy velocity over the time of flight
      if (best.velocity) { const tf = t.distanceTo(this.position) / 230; t.addScaledVector(best.velocity, tf * 0.6); }
      target.lerp(t, k);
    }
  },

  launchBomb() {
    const ctx = this.ctx;
    if (!this.alive || this._bombCd > 0 || ctx.state.bombs <= 0) return false;
    ctx.state.bombs--;
    this._bombCd = cfg.bombCooldown;
    _t.set(this.position.x, this.position.y, this.position.z - 2.5);
    ctx.projectiles.fireBomb(_t, this.aimDir);
    ctx.audio?.sfx?.('bomb');
    ctx.fx?.flash?.('#bfe6ff', 0.18, 0.15);
    ctx.events.emit('player:bomb', {});
    return true;
  },

  barrelRoll(dir = 1) {
    if (!this.alive || this.isRolling) return false;
    this.isRolling = true; this._rollT = 0; this._rollDir = dir >= 0 ? 1 : -1;
    this.localVelocity.x += this._rollDir * (hp().rollKick ?? cfg.rollKick);
    this.ctx?.audio?.sfx?.('roll');
    this.ctx?.events.emit('player:roll', { dir: this._rollDir });
    return true;
  },

  // Called by collision after a successful reflect
  onReflect(shot) {
    this.ctx?.state && (this.ctx.state.score += 25);
    this.ctx?.events.emit('score:add', { points: 25, base: 25, multiplier: 1, position: shot.position, reflect: true });
  },

  // ------------------------------------------------------------------ health
  takeDamage(amount, source) {
    const ctx = this.ctx;
    if (!this.alive || !ctx) return false;
    if (this.invulnerable || ctx.state.god) return false;
    const s = ctx.state;
    s.health = Math.max(0, s.health - amount);
    this._invuln = cfg.invulnerableAfterHit;
    this.invulnerable = true;
    s.combo = 0; s.comboTimer = 0; s.multiplier = 1;
    this.charging = false; this._hold = 0; this.charge = 0; this.clearLocks(); this._volley.length = 0;
    this.ship?.setDamage?.(1 - s.health / s.maxHealth);
    ctx.audio?.sfx?.('damage');
    ctx.fx?.flash?.('#ff2a10', 0.32, 0.28);
    // camera shake for damage comes from src/fx/impact.js (player:damage event)
    ctx.fx?.sparks?.(this.position, undefined, 14);
    ctx.events.emit('player:damage', { amount, source, position: this.position, health: s.health, maxHealth: s.maxHealth });
    if (s.health / s.maxHealth < 0.4 && !this._smoke) this._smoke = ctx.fx?.damageSmoke?.(this) ?? null;
    if (s.health <= 0) this.die(source);
    return true;
  },

  heal(n) {
    const s = this.ctx.state;
    if (!this.alive) return;
    const before = s.health;
    s.health = Math.min(s.maxHealth, s.health + n);
    this.ship?.setDamage?.(1 - s.health / s.maxHealth);
    if (s.health / s.maxHealth >= 0.4) this._stopSmoke();
    this.ctx.events.emit('player:heal', { amount: s.health - before });
  },

  addBombs(n) {
    const s = this.ctx.state;
    s.bombs = Math.min(cfg.maxBombs, s.bombs + n);
  },

  upgradeLaser() {
    const s = this.ctx.state;
    s.laserLevel = Math.min(3, s.laserLevel + 1);
    this.ctx.fx?.flash?.('#66ffcc', 0.2, 0.25);
  },

  // Fallback pickup effects (pickups normally apply their own via collect)
  collectPickup(kind) {
    const s = this.ctx.state;
    switch (kind) {
      case 'repair': this.heal(40); break;
      case 'bomb': this.addBombs(1); break;
      case 'pulseUpgrade': this.upgradeLaser(); break;
      case 'shieldCell': s.score += 50; this.heal(4); break;
      case 'capacitor': s.score += 200; this.heal(25); break;
      default: break;
    }
  },

  die(source) {
    const ctx = this.ctx;
    if (!this.alive) return;
    const s = ctx.state;
    this.alive = false; this.invulnerable = false;
    this.isRolling = false; this.isBoosting = false; this.isBraking = false;
    this.charging = false; this.charge = 0; this.clearLocks(); this._volley.length = 0;
    s.health = 0; s.lives = Math.max(0, s.lives - 1); s.laserLevel = 1;
    this._deathT = 0; this._deathDone = false;
    this.group.visible = false;
    this._stopSmoke();
    ctx.fx?.explosion?.(this.position, { scale: 2.6, color: 0xffb040, big: true });
    ctx.fx?.debris?.(this.position, 22, 0x9aa8c4);
    ctx.fx?.shockwave?.(this.position, { radius: 18, color: 0xffa860 });
    ctx.fx?.flash?.('#ffffff', 0.5, 0.35);
    ctx.audio?.sfx?.('bigExplosion');
    ctx.events.emit('player:dead', { source });
  },

  updateDead(dt, ctx) {
    this._deathT += dt;
    this.syncTransform(ctx);
    if (this._deathT > 0.45 && !this._d2) { this._d2 = true; ctx.fx?.explosion?.(_t.copy(this.position).add(_d.set(2, 1, 0)), { scale: 1.6, big: false }); }
    if (this._deathT > 0.9 && !this._d3) { this._d3 = true; ctx.fx?.explosion?.(_t.copy(this.position).add(_d.set(-2, -1, -2)), { scale: 1.2 }); }
    if (this._deathT > 2.7 && !this._deathDone) {
      this._deathDone = true; this._d2 = this._d3 = false;
      if (ctx.state.lives > 0) this.respawn(ctx);
      else ctx.events.emit('game:over', {});
    }
  },

  respawn(ctx) {
    const s = ctx.state;
    this.alive = true;
    s.health = s.maxHealth; s.boost = 1; s.boostCooldown = 0;
    s.bombs = Math.max(s.bombs, cfg.bombs);
    this._invuln = cfg.respawnInvulnerable; this._respawnInv = true; this.invulnerable = true;
    this.localVelocity.set(0, 0);
    this.rollAngle = 0; this.bank = 0;
    this._resetAttitude();
    this.group.visible = true;
    this.ship?.setDamage?.(0);
    ctx.projectiles.clearEnemyShots?.(this.position, 45);
    ctx.fx?.flash?.('#9fd8ff', 0.3, 0.4);
    ctx.audio?.sfx?.('pickup');
    ctx.events.emit('player:respawn', {});
  },
};
