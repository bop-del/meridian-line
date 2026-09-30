// Shared enemy base class implementing the entity protocol (see docs/ARCHITECTURE.md).
//
// Motion modes:
//  railRel = true  (default): the subclass writes `this.rel` (offset from ctx.rail.position) in think();
//                             world position = rail.position + rel. `relVel` is derived automatically.
//  railRel = false: world space, subclass writes `this.vel` (integrated by the base) or moves position itself.
//
// Subclass hooks: build(opts), onSpawn(opts), think(dt, ctx), late(dt, ctx), onHit(amount, source), onDeath(ctx).
import * as THREE from 'three';
import { glowSprite, beamGeo } from './models.js';
import { leadDir, diff, playerVel } from './aim.js';

const _pv = new THREE.Vector3(), _rv = new THREE.Vector3(), _r0 = new THREE.Vector3(), _mz = new THREE.Vector3(), _m4 = new THREE.Matrix4(), _q = new THREE.Quaternion(), _fd = new THREE.Vector3();
const ZERO = new THREE.Vector3(), UP = new THREE.Vector3(0, 1, 0), WHITE = new THREE.Color(1, 1, 1);
const _tp = new THREE.Vector3();
export const SHOT_CAP = 44; // global concurrent enemy shot budget

// Wind-up telegraph pieces (per glow sprite, created on first use): a thin ring that closes on the muzzle and a faint aim line
// toward the ship. Both are normal blended and saturated, so they read against bright water where additive glow washes out.
let ringTex = null;
function ringTexture() {
  if (ringTex) return ringTex;
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const g = c.getContext('2d');
  g.strokeStyle = 'rgba(255,255,255,1)'; g.lineWidth = 5; g.shadowColor = 'rgba(255,255,255,0.9)'; g.shadowBlur = 4;
  g.beginPath(); g.arc(32, 32, 25, 0, Math.PI * 2); g.stroke();
  ringTex = new THREE.CanvasTexture(c); ringTex.colorSpace = THREE.SRGBColorSpace;
  return ringTex;
}

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

  takeDamage(amount, source, ctx = this.ctx, info = null) {
    if (!this.alive || this.invulnerable || this._destroyed) return;
    amount = this.filterDamage(amount, source);
    if (amount <= 0) { ctx.fx?.sparks?.(info?.position ?? this.position, null, 4); return; }
    this.hp -= amount;
    this.flashT = 1;
    // spark where the shot landed (collision passes the shot position), not at the centre of the hull
    ctx.fx?.hitSpark?.(info?.position ?? this.position, undefined, Math.min(1.6, 0.8 + amount * 0.08));
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
    // camera shake, hit-stop and the kill burst come from the enemy:killed event (src/fx/impact.js)
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
    if (this._teles) { for (const t of this._teles) { t.ring.removeFromParent(); t.ring.material.dispose(); t.line.removeFromParent(); t.line.material.dispose(); } this._teles = null; }
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
    ctx.fx?.muzzleFlash?.(origin, dir, o.color ?? 0xff5533);
    ctx.fx?.fireFlare?.(origin, o.glowColor ?? o.color ?? 0xff8a3a, o.flare ?? 1);
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
    s.scale.setScalar(0.0001); s.visible = false; s.userData.color = color;
    return s;
  }
  setGlow(s, v, pulse = 0) {
    if (!s) return;
    const k = v * (1 + (pulse ? Math.sin(this.age * pulse) * 0.18 : 0));
    // the last 15% of the ramp punches the glow up, so the moment before the shot has a clear peak
    const punch = v > 0.85 ? 1 + 0.45 * Math.min(1, (v - 0.85) / 0.15) : 1;
    s.visible = k > 0.01; s.scale.setScalar(Math.max(0.0001, s.userData.size * k * punch));
    if (!this.isBoss && s.userData.size <= 12) this._telegraph(s, v);
  }

  /** Converging ring and aim line for a wind-up glow. Called from setGlow; reads feel.p.impact.telegraph* every call. */
  _telegraph(s, v) {
    let t = s.userData.tele;
    if (v <= 0.02) { if (t) { t.ring.visible = false; t.line.visible = false; } return; }
    const ctx = this.ctx, P = ctx.feel.p.impact;
    if (!t) {
      if (P.telegraphRing <= 0 && P.telegraphLine <= 0) return;
      const col = s.userData.color ?? 0xff6a2a;
      const ring = new THREE.Sprite(new THREE.SpriteMaterial({ map: ringTexture(), color: col, transparent: true, opacity: 0, depthWrite: false, fog: false }));
      ring.position.copy(s.position); ring.visible = false; ring.renderOrder = 9; s.parent.add(ring);
      const line = new THREE.Mesh(beamGeo, new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0, depthWrite: false, fog: false, toneMapped: false }));
      line.visible = false; line.frustumCulled = false; line.renderOrder = 9; ctx.scene.add(line);
      t = s.userData.tele = { ring, line };
      (this._teles ??= []).push(t);
    }
    const u = Math.min(1, v);
    const ra = Math.min(1, u * 1.6) * P.telegraphRing * 0.85;
    t.ring.visible = ra > 0.02;
    if (t.ring.visible) { t.ring.material.opacity = ra; t.ring.scale.setScalar(s.userData.size * (2.8 - 1.7 * u)); }
    // aim line: only in the second part of the wind-up, only while the shooter is ahead of the ship
    const st = P.telegraphLineStart;
    const la = P.telegraphLine * Math.min(1, Math.max(0, (u - st) / Math.max(0.05, 1 - st))) * 0.8;
    if (la > 0.02) {
      s.getWorldPosition(_tp);
      const pp = ctx.player.position;
      const dx = pp.x - _tp.x, dy = pp.y - _tp.y, dz = pp.z - _tp.z;
      const dist = Math.hypot(dx, dy, dz);
      if (dz > 8 && dist > 8) {
        const cam = ctx.camera, cd = cam ? Math.hypot(cam.position.x - _tp.x, cam.position.y - _tp.y, cam.position.z - _tp.z) : 60;
        const w = Math.min(0.35, Math.max(0.05, cd * 0.0016));
        t.line.visible = true; t.line.material.opacity = la;
        t.line.position.copy(_tp); t.line.lookAt(pp);
        t.line.scale.set(w, w, Math.min(dist, 160));
        return;
      }
    }
    t.line.visible = false;
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
