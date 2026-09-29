// Shared enemy base class implementing the entity protocol (see docs/ARCHITECTURE.md).
//
// Motion modes:
//  railRel = true  (default): the subclass writes `this.rel` (offset from ctx.rail.position) in think();
//                             world position = rail.position + rel. `relVel` is derived automatically.
//  railRel = false: world space, subclass writes `this.vel` (integrated by the base) or moves position itself.
//
// Subclass hooks: build(opts), onSpawn(opts), think(dt, ctx), late(dt, ctx), onHit(amount, source), onDeath(ctx).
import * as THREE from 'three';
import { glowSprite } from './models.js';
import { leadDir, diff, playerVel } from './aim.js';

const _pv = new THREE.Vector3(), _rv = new THREE.Vector3(), _r0 = new THREE.Vector3(), _mz = new THREE.Vector3(), _m4 = new THREE.Matrix4(), _q = new THREE.Quaternion(), _fd = new THREE.Vector3();
const ZERO = new THREE.Vector3(), UP = new THREE.Vector3(0, 1, 0), WHITE = new THREE.Color(1, 1, 1);
export const SHOT_CAP = 44; // global concurrent enemy shot budget

export class Enemy {
  static def = { hp: 3, radius: 1.5, points: 100, damage: 8 };

  constructor(ctx, type, opts = {}) {
    this.ctx = ctx; this.type = type;
    const def = this.constructor.def; this.def = def;
    const d = diff(ctx);
    this.alive = true; this.lockable = true; this.invulnerable = false; this.killedByPlayer = false;
    this.group = new THREE.Group(); this.body = new THREE.Group(); this.group.add(this.body);
    this.position = this.group.position;
    this.aimOffset = new THREE.Vector3();
    this.rel = new THREE.Vector3(); this._relPrev = new THREE.Vector3(); this.relVel = new THREE.Vector3();
    this.vel = new THREE.Vector3();
    this.railRel = true; this.faceBias = 30; this.faceRate = 6; this.bankAmt = 0.03;
    this.age = 0; this.flashT = 0; this._flash = null; this._destroyed = false; this._started = false;
    this.maxHp = this.hp = (opts.hp ?? def.hp) * d.enemyHp;
    const sc = opts.scale ?? def.scale ?? 1; this.group.scale.setScalar(sc); this.scale = sc;
    this.radius = (opts.radius ?? def.radius) * sc; this.points = opts.points ?? def.points;
    this.damage = (opts.damage ?? def.damage);
    this.contactDamage = def.contactDamage ?? 10; // ram damage hint for collision.js
    this.fireScale = 1 / d.enemyFireRate;
    this.formation = opts.formation ?? null;
    this.delay = opts.delay ?? 0;
    this.path = opts.path ?? null;
    this.fireCd = 0;
    this.build(opts);
    // initial placement
    const r = ctx.rail.position;
    if (opts.rel) this.rel.copy(opts.rel);
    else if (opts.position) this.rel.copy(opts.position).sub(r);
    else this.rel.set(0, 0, -150);
    if (opts.velocity) this.vel.copy(opts.velocity);
    if (this.railRel) this.position.copy(r).add(this.rel); else this.position.copy(r).add(this.rel);
    this._relPrev.copy(this.rel);
    this.onSpawn(opts);
    ctx.scene.add(this.group);
  }

  /** World velocity (used by player aim assist). */
  get velocity() { return this.vel; }

  // ---- hooks (override) ----
  build() {}
  onSpawn() {}
  think() {}
  late() {}

  // ---- per frame ----
  update(dt, ctx) {
    if (!this.alive) return;
    this.age += dt;
    if (this.fireCd > 0) this.fireCd -= dt;
    this.think(dt, ctx);
    if (this.railRel) {
      this.position.copy(ctx.rail.position).add(this.rel);
      if (dt > 0) this.relVel.subVectors(this.rel, this._relPrev).divideScalar(dt);
      this._relPrev.copy(this.rel);
      this.vel.copy(this.relVel); this.vel.z -= ctx.rail.speed;
    } else {
      this.position.addScaledVector(this.vel, dt);
      this.rel.subVectors(this.position, ctx.rail.position);
    }
    this.late(dt, ctx);
    if (this.flashT > 0) this._updateFlash(dt);
  }

  /** Smoothly orient the model along the rail-relative motion (railRel) with a bank into turns. */
  faceMotion(dt, bias = this.faceBias, rate = this.faceRate) {
    _fd.copy(this.relVel); _fd.z += bias;
    if (_fd.lengthSq() < 1e-3) return;
    this.faceDir(_fd, dt, rate);
    const bank = THREE.MathUtils.clamp(-this.relVel.x * this.bankAmt, -0.9, 0.9);
    this.body.rotation.z += (bank - this.body.rotation.z) * Math.min(1, dt * 5);
  }

  faceDir(dir, dt, rate = 6) {
    _m4.lookAt(dir, ZERO, UP); // +Z of the object points along dir
    _q.setFromRotationMatrix(_m4);
    if (rate <= 0 || dt <= 0) this.group.quaternion.copy(_q);
    else this.group.quaternion.slerp(_q, 1 - Math.exp(-rate * dt));
  }

  /** World position of a model-local point (shared scratch vector). */
  muzzle(x, y, z, out = _mz) {
    return out.set(x * (this.group.scale.x || 1), y * (this.group.scale.y || 1), z * (this.group.scale.z || 1)).applyQuaternion(this.group.quaternion).add(this.position);
  }

  /** Squared closest distance to the player over this frame (swept, so fast movers cannot tunnel through). */
  sweepDist2(ctx, dt) {
    const p = ctx.player.position;
    playerVel(ctx, _pv);
    _rv.copy(this.vel).sub(_pv); _r0.subVectors(this.position, p);
    const a = _rv.lengthSq();
    let t = a > 1e-6 ? -_r0.dot(_rv) / a : 0;
    t = t < 0 ? 0 : t > dt ? dt : t;
    return _r0.addScaledVector(_rv, t).lengthSq();
  }

  // ---- combat ----
  /** Override for armor etc. Return the effective damage. */
  filterDamage(amount) { return amount; }

  takeDamage(amount, source, ctx = this.ctx) {
    if (!this.alive || this.invulnerable || this._destroyed) return;
    amount = this.filterDamage(amount, source);
    if (amount <= 0) { ctx.fx?.sparks?.(this.position, null, 4); return; }
    this.hp -= amount;
    this.flashT = 1;
    ctx.fx?.hitSpark?.(this.position);
    this.onHit(amount, source);
    if (this.hp <= 0) this.die(ctx, source);
  }
  onHit() {}

  die(ctx = this.ctx, source) {
    if (!this.alive || this._destroyed) return;
    this.killedByPlayer = true; this.hp = 0;
    const big = this.radius > 4;
    ctx.fx?.explosion?.(this.position, { scale: Math.max(0.8, this.radius * 0.75), color: this.def.explColor ?? 0xffaa33, big });
    ctx.fx?.debris?.(this.position, big ? 22 : 8, this.def.debrisColor ?? 0xb02733);
    ctx.fx?.sparks?.(this.position, null, 10);
    ctx.fx?.shake?.(Math.min(1.2, 0.15 + this.radius * 0.08), 0.25);
    ctx.audio?.sfx?.(big ? 'bigExplosion' : 'explosion', { position: this.position });
    this.onDeath(ctx, source);
    if (this.points) ctx.events.emit('enemy:killed', { enemy: this, points: this.points, position: this.position.clone() });
    this.formation?.memberKilled(this, ctx);
    this.destroy(ctx);
  }
  onDeath() {}

  /** Silent removal (culled, level cleanup): no score, no fx. Idempotent. */
  destroy() {
    if (this._destroyed) return;
    this._destroyed = true; this.alive = false; this.lockable = false;
    this.group.removeFromParent();
    if (this._flash) for (const f of this._flash) f.m.dispose();
    this._flash = null;
    this.formation?.memberGone(this);
    this.onDestroy?.();
  }

  /** Aimed, budgeted, fair enemy shot. Returns the shot or null if suppressed. */
  shoot(origin, dir, o = {}) {
    const ctx = this.ctx, P = ctx.projectiles;
    if (!P?.fireEnemyShot) return null;
    if (ctx.groups.enemyShots.length >= (o.cap ?? SHOT_CAP)) return null;
    const pp = ctx.player.position;
    const dx = origin.x - pp.x, dy = origin.y - pp.y, dz = origin.z - pp.z;
    const d2 = dx * dx + dy * dy + dz * dz;
    if (d2 < (origin.z > pp.z - 2 ? 625 : 400)) return null; // never point blank, 25+ from behind
    const shot = P.fireEnemyShot(origin, dir, {
      damage: (o.damage ?? this.damage) * diff(ctx).enemyDamage,
      speed: o.speed ?? 60, radius: o.radius ?? 0.7, color: o.color ?? 0xff5533, glowColor: o.glowColor ?? o.color ?? 0xff5533,
      size: o.size, homing: o.homing, shootable: o.shootable, hp: o.hp, life: o.life, kind: o.kind,
    });
    ctx.fx?.muzzleFlash?.(origin, dir);
    ctx.audio?.sfx?.('enemyShot', { position: origin });
    return shot;
  }

  /** Lead aimed shot from a world origin. */
  shootAt(origin, speed = 60, err = 0.05, o = {}) {
    const dir = leadDir(this.ctx, origin, speed, err, o.leadK ?? 0.8);
    return this.shoot(origin, dir, { ...o, speed });
  }

  /** Muzzle glow telegraph helper: create once, then setCharge(0..1). */
  makeGlow(color, size, parent = this.body, x = 0, y = 0, z = 0) {
    const s = glowSprite(color, size, parent, x, y, z);
    s.scale.setScalar(0.0001); s.visible = false;
    return s;
  }
  setGlow(s, v, pulse = 0) {
    if (!s) return;
    const k = v * (1 + (pulse ? Math.sin(this.age * pulse) * 0.18 : 0));
    s.visible = k > 0.01; s.scale.setScalar(Math.max(0.0001, s.userData.size * k));
  }

  // ---- hit flash (materials cloned lazily on first hit so shared materials stay shared) ----
  _updateFlash(dt) {
    if (!this._flash) {
      this._flash = [];
      this.group.traverse((o) => {
        if (o.isMesh && o.material?.isMeshStandardMaterial && o.material.userData.noFlash !== true) {
          const m = o.material.clone(); m.userData = { own: true };
          o.material = m; this._flash.push({ m, e: m.emissive.clone(), i: m.emissiveIntensity });
        }
      });
    }
    this.flashT = Math.max(0, this.flashT - dt * 7);
    const f = this.flashT * this.flashT;
    for (const x of this._flash) { x.m.emissive.copy(x.e).lerp(WHITE, f); x.m.emissiveIntensity = x.i + f * 1.6; }
  }
}
