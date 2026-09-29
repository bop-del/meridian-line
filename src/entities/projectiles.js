// Pooled shots for player and enemy, rendered with additive InstancedMeshes (core + glow + trail).
// Shots are plain entities (position, velocity, radius, damage, life, owner, alive) whose `group` is a
// detached Object3D that shares `position`; they are NOT in the scene graph, the instanced meshes draw them.
//
// API: firePlayerShot(origin, dir, opts), fireEnemyShot(origin, dir, opts), fireBomb(origin).
// Extras: reflect(shot, ctx), clearEnemyShots(pos?, radius?), detonateBomb(pos), lateUpdate(ctx) (called by game.js after collision).
import * as THREE from 'three';
import { config } from '../config.js';

const MAX_PLAYER = 160;
const MAX_ENEMY = 240;
const MAX_TRAIL = MAX_PLAYER + MAX_ENEMY;
const MAX_BOMBS = 4;

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _s = new THREE.Vector3();
const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _p = new THREE.Vector3();
const Z = new THREE.Vector3(0, 0, 1);
const _c = new THREE.Color();

function makeMat(opacity, additive = true) {
  return new THREE.MeshBasicMaterial({
    color: 0xffffff, transparent: true, opacity, blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    depthWrite: false, toneMapped: false, fog: false,
  });
}

function makeInstanced(geo, mat, cap) {
  const mesh = new THREE.InstancedMesh(geo, mat, cap);
  mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3), 3);
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
  mesh.frustumCulled = false;
  mesh.count = 0;
  mesh.renderOrder = 10;
  return mesh;
}

class Shot {
  constructor() {
    this.group = new THREE.Object3D();
    this.position = this.group.position;
    this.prev = new THREE.Vector3();
    this.velocity = new THREE.Vector3();
    this.color = new THREE.Color();
    this.glow = new THREE.Color();
    this.shell = new THREE.Color();
    this.reset();
  }
  reset() {
    this.alive = false; this.owner = 'enemy'; this.kind = 'orb';
    this.damage = 8; this.radius = 0.7; this.life = 1; this.maxLife = 1; this.age = 0;
    this.homing = null; this.turn = 0; this.speed = 60; this.maxSpeed = 60;
    this.shootable = false; this.hp = 1; this.reflectable = true; this.reflected = false; this.pierce = false;
    this.size = 1; this.trail = 0; this.pulse = 0; this.curl = 0;
    this.velocity.set(0, 0, 0);
  }
  update(dt, ctx) { projectiles.stepShot(this, dt, ctx); }
  takeDamage(amount) { if (!this.shootable || !this.alive) return; this.hp -= amount; if (this.hp <= 0) this.destroy(); }
  destroy() { this.alive = false; }
}

class Bomb {
  constructor(scene) {
    this.group = new THREE.Group();
    this.position = this.group.position;
    this.velocity = new THREE.Vector3();
    const core = new THREE.Mesh(new THREE.SphereGeometry(0.7, 14, 10), makeMat(1));
    core.material.color.setRGB(2.6, 2.8, 3.0);
    const glow = new THREE.Mesh(new THREE.SphereGeometry(1.9, 14, 10), makeMat(0.35));
    glow.material.color.setRGB(0.5, 1.2, 2.4);
    this.group.add(core, glow);
    this.core = core; this.glow = glow;
    this.group.visible = false;
    scene.add(this.group);
    this.alive = false; this.radius = 1.2; this.life = 0; this.owner = 'player';
  }
  destroy() { this.alive = false; this.group.visible = false; }
}

export const projectiles = {
  pool: { player: [], enemy: [] },
  bombs: [],
  ctx: null,
  time: 0,

  init(ctx) {
    this.ctx = ctx;
    for (let i = 0; i < MAX_PLAYER; i++) this.pool.player.push(new Shot());
    for (let i = 0; i < MAX_ENEMY; i++) this.pool.enemy.push(new Shot());

    // player bolts: capsule stretched along Z
    const cap = new THREE.CapsuleGeometry(1, 1, 3, 10); cap.rotateX(Math.PI / 2);
    this.boltShell = makeInstanced(cap, makeMat(0.92, false), MAX_PLAYER + MAX_ENEMY);
    this.boltCore = makeInstanced(cap, makeMat(1), MAX_PLAYER + MAX_ENEMY);
    this.boltGlow = makeInstanced(cap, makeMat(0.2), MAX_PLAYER + MAX_ENEMY);
    // orbs
    const sph = new THREE.SphereGeometry(1, 14, 10);
    this.orbShell = makeInstanced(sph, makeMat(0.92, false), MAX_ENEMY + MAX_PLAYER);
    this.orbCore = makeInstanced(sph, makeMat(1), MAX_ENEMY + MAX_PLAYER);
    this.orbGlow = makeInstanced(sph, makeMat(0.24), MAX_ENEMY + MAX_PLAYER);
    // trails: cone, base (width 1) at z=0 tapering to tip at z=1 (points behind the motion)
    const cone = new THREE.ConeGeometry(1, 1, 10, 1, true); cone.rotateX(Math.PI / 2); cone.translate(0, 0, 0.5);
    this.trailMesh = makeInstanced(cone, makeMat(0.55), MAX_TRAIL);
    ctx.scene.add(this.boltShell, this.boltGlow, this.boltCore, this.orbShell, this.orbGlow, this.orbCore, this.trailMesh);

    for (let i = 0; i < MAX_BOMBS; i++) this.bombs.push(new Bomb(ctx.scene));
  },

  reset(ctx) {
    this.time = 0;
    for (const s of this.pool.player) s.reset();
    for (const s of this.pool.enemy) s.reset();
    ctx.groups.playerShots.length = 0;
    ctx.groups.enemyShots.length = 0;
    for (const b of this.bombs) b.destroy();
    this.writeInstances(ctx);
  },

  acquire(kind, ctx) {
    const pool = this.pool[kind];
    const arr = kind === 'player' ? ctx.groups.playerShots : ctx.groups.enemyShots;
    let s = pool.pop();
    if (!s) {                       // pool exhausted: recycle the oldest live shot
      s = arr.shift();
      if (!s) return null;
    }
    s.reset();
    arr.push(s);
    return s;
  },

  // core: hot additive center, glow: additive halo, shell: saturated normal-blended body that keeps shots
  // readable against bright sky and sea where additive light alone washes out to white.
  setColor(s, hex, hot = 2.4, glowHex = null, glowMul = 1.1, shellHex = null) {
    s.color.setHex(hex).multiplyScalar(hot);
    s.glow.setHex(glowHex ?? hex).multiplyScalar(glowMul);
    s.shell.setHex(shellHex ?? glowHex ?? hex);
  },

  // ---------------------------------------------------------------- public API
  firePlayerShot(origin, dir, opts = {}) {
    const ctx = this.ctx;
    const s = this.acquire('player', ctx);
    if (!s) return null;
    s.owner = 'player'; s.alive = true;
    s.position.copy(origin); s.prev.copy(origin);
    _v.copy(dir).normalize();
    const speed = opts.speed ?? 230;
    s.speed = speed; s.maxSpeed = opts.maxSpeed ?? speed;
    s.velocity.copy(_v).multiplyScalar(speed);
    s.damage = opts.damage ?? 10;
    s.radius = opts.radius ?? 0.5;
    s.life = s.maxLife = opts.life ?? config.player.laserLife;
    s.homing = opts.homing ?? null;
    s.turn = opts.turn ?? (s.homing ? 11 : 0);
    s.curl = opts.curl ?? 0;
    s.kind = opts.kind ?? (s.homing ? 'homing' : 'laser');
    s.size = opts.size ?? 1;
    s.pierce = !!opts.pierce;
    s.level = opts.level ?? 1;
    if (s.kind === 'homing') {
      this.setColor(s, opts.color ?? 0x8dffb4, 2.8, 0x33ff88, 1.3, 0x10c860);
      s.trail = 7;
    } else {
      this.setColor(s, 0xffffff, 1.5, opts.color ?? 0x39ff7a, 0.9, opts.color ?? 0x39ff7a);
      s.trail = 0;
    }
    if (s.curl) {   // initial swirl: kick the velocity sideways, homing pulls it back in
      _v2.set(-_v.y, _v.x, 0).normalize().multiplyScalar(s.curl * speed);
      s.velocity.add(_v2);
    }
    this.stepMatrixFor(s);
    return s;
  },

  fireEnemyShot(origin, dir, opts = {}) {
    const ctx = this.ctx;
    const s = this.acquire('enemy', ctx);
    if (!s) return null;
    const diff = config.difficulty[ctx.state?.difficulty] ?? config.difficulty.normal;
    s.owner = 'enemy'; s.alive = true;
    s.position.copy(origin); s.prev.copy(origin);
    _v.copy(dir).normalize();
    const speed = opts.speed ?? 60;
    s.speed = s.maxSpeed = speed;
    s.velocity.copy(_v).multiplyScalar(speed);
    s.damage = (opts.damage ?? 8) * (opts.scaleDamage ? diff.enemyDamage : 1);   // enemies pre-scale by difficulty
    s.radius = opts.radius ?? 0.7;
    s.life = s.maxLife = opts.life ?? 7;
    s.homing = opts.homing ? (opts.homing === true ? ctx.player : opts.homing) : null;
    s.turn = opts.turn ?? (s.homing ? 1.3 : 0);
    s.shootable = opts.shootable ?? !!s.homing;
    s.hp = opts.hp ?? 2;
    s.reflectable = opts.reflectable ?? true;
    s.kind = opts.kind ?? (speed >= 110 ? 'bolt' : 'orb');
    s.size = opts.size ?? 1;
    s.pulse = Math.random() * 6.28;
    if (s.kind === 'bolt') {
      this.setColor(s, 0xffe0c0, 2.4, opts.glowColor ?? 0xff2200, 1.3, opts.color ?? 0xe01808);
      s.trail = 0;
    } else {
      this.setColor(s, 0xfff0c0, 2.8, opts.glowColor ?? 0xff3a0a, 1.5, opts.color ?? 0xd81a08);
      s.trail = opts.trail ?? Math.min(6, 2.5 + speed * 0.03);
    }
    this.stepMatrixFor(s);
    return s;
  },

  fireBomb(origin, dir) {
    const b = this.bombs.find((x) => !x.alive) ?? this.bombs[0];
    b.alive = true; b.group.visible = true;
    b.position.copy(origin);
    b.velocity.set(0, 0, -1);
    if (dir) b.velocity.copy(dir).normalize();
    b.velocity.multiplyScalar(115);
    b.life = 0.55;
    return b;
  },

  // Turn an enemy shot around: it now belongs to the player and hunts the nearest enemy in front.
  reflect(shot, ctx = this.ctx) {
    if (!shot.alive || shot.owner !== 'enemy' || !shot.reflectable) return false;
    const idx = ctx.groups.enemyShots.indexOf(shot);
    if (idx >= 0) ctx.groups.enemyShots.splice(idx, 1);
    ctx.groups.playerShots.push(shot);
    shot.owner = 'player'; shot.reflected = true; shot.shootable = false;
    shot.damage = 3;
    shot.life = shot.maxLife = 2.2;
    shot.age = 0;
    // pick target: nearest live enemy ahead of the shot
    let best = null, bd = 1e9;
    for (const e of ctx.groups.enemies) {
      if (!e.alive) continue;
      const d = e.position.distanceToSquared(shot.position);
      if (e.position.z < shot.position.z + 5 && d < bd) { bd = d; best = e; }
    }
    const speed = Math.max(shot.speed, 110);
    shot.speed = shot.maxSpeed = speed;
    if (best) {
      _v.copy(best.position).sub(shot.position).normalize();
      shot.homing = best; shot.turn = 6;
    } else {
      _v.set((Math.random() - 0.5) * 0.4, (Math.random() - 0.5) * 0.3, -1).normalize();
      shot.homing = null;
    }
    shot.velocity.copy(_v).multiplyScalar(speed);
    shot.kind = 'homing'; shot.radius = Math.max(shot.radius, 0.9);
    // a reflected heavy shell keeps its hit radius but not its bloom: a thin teal glow and a smaller core, so the boss and the
    // reticle stay readable behind it
    this.setColor(shot, 0xd0fff4, 1.9, 0x33ffd0, 0.85, 0x10c8a0);
    shot.size = Math.min(shot.size, 0.7);
    shot.trail = 5;
    return true;
  },

  clearEnemyShots(pos = null, radius = Infinity) {
    const ctx = this.ctx;
    const r2 = radius * radius;
    let n = 0;
    for (const s of ctx.groups.enemyShots) {
      if (!s.alive) continue;
      if (pos && s.position.distanceToSquared(pos) > r2) continue;
      s.alive = false; n++;
      ctx.fx?.sparks?.(s.position, undefined, 4);
    }
    return n;
  },

  detonateBomb(pos) {
    const ctx = this.ctx;
    const cfg = config.player;
    const R = cfg.bombRadius;
    this.clearEnemyShots(pos, R);
    for (const e of ctx.groups.enemies) {
      if (!e.alive) continue;
      const d = Math.max(0, e.position.distanceTo(pos) - (e.radius || 0));
      if (d > R) continue;
      let dmg = cfg.bombDamage * (1 - 0.5 * (d / R));
      if (e.isBoss || e.type === 'part' || e === ctx.enemies?.boss) dmg *= cfg.bombBossFactor;
      e.takeDamage?.(dmg, 'bomb', ctx, { position: e.position });
      ctx.events.emit('enemy:hit', { enemy: e, position: e.position, damage: dmg, source: 'bomb' });
    }
    for (const o of ctx.groups.obstacles) {
      if (!o.alive || !o.takeDamage) continue;
      if (o.position.distanceTo(pos) - (o.radius || 0) < R * 0.6) o.takeDamage(40, 'bomb', ctx);
    }
    ctx.fx?.shockwave?.(pos, { radius: R, color: 0xffd58a });
    ctx.fx?.explosion?.(pos, { scale: 3.2, color: 0xffd28a, big: true });
    ctx.fx?.flash?.('#fff1c8', 0.55, 0.3);
    ctx.fx?.shake?.(0.9, 0.5);
    ctx.cameraRig?.addTrauma?.(0.85);
    ctx.audio?.sfx?.('bomb', { position: pos });
    ctx.events.emit('bomb:detonate', { position: pos.clone() });
  },

  // ---------------------------------------------------------------- simulation
  update(dt, ctx) {
    this.time += dt;
    for (const s of ctx.groups.playerShots) if (s.alive) this.stepShot(s, dt, ctx);
    for (const s of ctx.groups.enemyShots) if (s.alive) this.stepShot(s, dt, ctx);
    for (const b of this.bombs) if (b.alive) this.stepBomb(b, dt, ctx);
  },

  stepBomb(b, dt, ctx) {
    b.life -= dt;
    b.position.addScaledVector(b.velocity, dt);
    b.core.scale.setScalar(1 + Math.sin(this.time * 30) * 0.12);
    let boom = b.life <= 0;
    if (!boom) {
      for (const e of ctx.groups.enemies) {
        if (e.alive && e.position.distanceTo(b.position) < (e.radius || 1) + b.radius) { boom = true; break; }
      }
    }
    if (!boom) {
      for (const o of ctx.groups.obstacles) {
        if (!o.alive || o.collidesShots === false) continue;
        const hit = o.collider === 'box' && o.hitTest ? o.hitTest(b.position, b.radius) : o.position.distanceTo(b.position) < (o.radius || 1) + b.radius;
        if (hit) { boom = true; break; }
      }
    }
    if (boom) { const p = b.position.clone(); b.destroy(); this.detonateBomb(p); }
    else ctx.fx?.sparks?.(b.position, undefined, 1);
  },

  stepShot(s, dt, ctx) {
    s.prev.copy(s.position);
    s.age += dt;
    s.life -= dt;
    if (s.life <= 0) { s.alive = false; return; }
    if (s.homing || (s.owner === 'player' && s.kind === 'homing')) this.steer(s, dt, ctx);
    s.position.addScaledVector(s.velocity, dt);
    const rp = ctx.rail.position;
    if (s.owner === 'enemy') {
      if (s.position.z > rp.z + 45 || Math.abs(s.position.x - rp.x) > 260 || Math.abs(s.position.y - rp.y) > 220 || s.position.z < rp.z - 700) s.alive = false;
    } else if (s.position.z < rp.z - 700 || s.position.z > rp.z + 60 || Math.abs(s.position.x - rp.x) > 320) s.alive = false;
  },

  steer(s, dt, ctx) {
    let tgt = s.homing;
    if (tgt && tgt.alive === false) { s.homing = tgt = null; }
    if (!tgt && s.owner === 'player' && s.kind === 'homing') {
      // lost target: reacquire the nearest enemy ahead so volley shots are never wasted
      let bd = 60 * 60;
      for (const e of ctx.groups.enemies) {
        if (!e.alive) continue;
        const d = e.position.distanceToSquared(s.position);
        if (d < bd && e.position.z < s.position.z) { bd = d; tgt = e; }
      }
      if (tgt) s.homing = tgt;
    }
    if (!tgt) return;
    const spd = s.velocity.length() || s.speed;
    _v.copy(tgt.position).sub(s.position);
    const dist = _v.length();
    if (dist < 0.001) return;
    _v.multiplyScalar(1 / dist);
    _v2.copy(s.velocity).multiplyScalar(1 / spd);
    const ramp = s.owner === 'player' ? Math.min(1, s.age / 0.12) : 1;
    const k = Math.min(1, s.turn * ramp * dt);
    _v2.lerp(_v, k).normalize();
    let ns = spd;
    if (s.owner === 'player') ns = Math.min(s.maxSpeed, spd + 140 * dt);
    s.velocity.copy(_v2).multiplyScalar(ns);
  },

  // ---------------------------------------------------------------- rendering
  stepMatrixFor(s) { /* matrices are written in lateUpdate; hook kept for future use */ },

  lateUpdate(ctx) {
    this.prune(ctx);
    this.writeInstances(ctx);
  },

  prune(ctx) {
    const sweep = (arr, poolName) => {
      let w = 0;
      for (let i = 0; i < arr.length; i++) {
        const s = arr[i];
        if (s.alive) arr[w++] = s;
        else { const owner = s.owner === 'player' ? 'player' : 'enemy'; if (this.pool[owner].length < (owner === 'player' ? MAX_PLAYER : MAX_ENEMY) + 40) this.pool[owner].push(s); }
      }
      arr.length = w;
    };
    sweep(ctx.groups.playerShots);
    sweep(ctx.groups.enemyShots);
  },

  writeInstances(ctx) {
    let nb = 0, no = 0, nt = 0;
    const t = this.time;
    const bc = this.boltCore, bg = this.boltGlow, bs = this.boltShell, oc = this.orbCore, og = this.orbGlow, os = this.orbShell, tm = this.trailMesh;
    const draw = (s) => {
      if (!s.alive) return;
      const sp = s.velocity.length() || 1;
      if (s.kind === 'laser' || s.kind === 'bolt') {
        _v.copy(s.velocity).multiplyScalar(1 / sp);
        _q.setFromUnitVectors(Z, _v);
        const isPlayer = s.owner === 'player';
        const len = (isPlayer ? 2.1 : 1.8) * s.size;
        const rad = (isPlayer ? 0.17 : 0.2) * s.size;
        _s.set(rad, rad, len);
        _m.compose(s.position, _q, _s);
        bc.setMatrixAt(nb, _m); bc.setColorAt(nb, s.color);
        _s.set(rad * 1.9, rad * 1.9, len * 1.1);
        _m.compose(s.position, _q, _s);
        bs.setMatrixAt(nb, _m); bs.setColorAt(nb, s.shell);
        _s.set(rad * 2.6, rad * 2.6, len * 1.2);
        _m.compose(s.position, _q, _s);
        bg.setMatrixAt(nb, _m); bg.setColorAt(nb, s.glow);
        nb++;
      } else {
        const pulse = 1 + Math.sin(t * 22 + s.pulse) * 0.1;
        // visual radius is capped so heavy boss shells do not bloom into a screen-filling disc (the hit radius is unchanged)
        const r = Math.min(s.reflected ? 1.4 : 2.6, s.radius * (s.kind === 'homing' ? 0.7 : 0.85) * pulse * s.size);
        _s.set(r, r, r);
        _q.identity();
        _m.compose(s.position, _q, _s);
        oc.setMatrixAt(no, _m); oc.setColorAt(no, s.color);
        const sh = r * (s.owner === 'enemy' ? 1.7 : 1.5);
        _s.set(sh, sh, sh);
        _m.compose(s.position, _q, _s);
        os.setMatrixAt(no, _m); os.setColorAt(no, s.shell);
        const g = r * (s.owner === 'enemy' ? 2.4 : 1.9);
        _s.set(g, g, g);
        _m.compose(s.position, _q, _s);
        og.setMatrixAt(no, _m); og.setColorAt(no, s.glow);
        no++;
        if (s.trail > 0) {
          _v.copy(s.velocity).multiplyScalar(-1 / sp);
          _q.setFromUnitVectors(Z, _v);
          const tr = r * 1.05;
          _s.set(tr, tr, s.trail * Math.min(1, s.age * 8 + 0.2));
          _m.compose(s.position, _q, _s);
          tm.setMatrixAt(nt, _m); tm.setColorAt(nt, s.glow);
          nt++;
        }
      }
    };
    for (const s of ctx.groups.playerShots) draw(s);
    for (const s of ctx.groups.enemyShots) draw(s);
    bc.count = bg.count = bs.count = nb; oc.count = og.count = os.count = no; tm.count = nt;
    for (const m of [bc, bg, bs, oc, og, os, tm]) {
      m.instanceMatrix.needsUpdate = true;
      if (m.instanceColor) m.instanceColor.needsUpdate = true;
    }
  },
};
