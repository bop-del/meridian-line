// Boss base class. Holds station ahead of the rail (rail-relative), runs intro / fight / death, keeps state.boss in
// sync for the HUD, and manages Parts (weak points, turrets, cable clamps, emitter lenses...) that are separate collidable entities.
//
// Damage model: the boss body itself cannot be damaged (its small collider sits BEHIND the front parts and deflects).
// Every fight is decided by critical parts (`this.crit`). boss.hp = sum of critical part HP (monotonic, drives the HUD).
import * as THREE from 'three';
import { Enemy } from '../enemy.js';
import { Part } from '../part.js';
import { diff } from '../aim.js';

const _p = new THREE.Vector3();

export class Boss extends Enemy {
  static def = { hp: 1, radius: 6, points: 3000, contactDamage: 30 };

  /** cfg: {key, title} */
  constructor(ctx, key, title) { super(ctx, key, { title }); }

  // lifecycle
  onSpawn(opts) {
    const ctx = this.ctx;
    this.title = opts.title; this.key = this.type;
    this.isBoss = true; this.lockable = false; this.untargetable = true; this.harmless = false; this.dying = false; this.defeated = false;
    this.name = this.title; this.phase = 1; this.mode = 'intro'; this.modeT = 0;
    this.parts = this.parts ?? []; this.crit = this.crit ?? [];
    this.tl = []; this.hitFlashT = 0;
    this.assist = new THREE.Vector3(); this.stallT = 0; this.lastHp = -1;
    this.holdZ = this.holdZ ?? 115; this.introT = this.introT ?? 4.2;
    this.fireScale = 1 / diff(ctx).enemyFireRate;
    this.rel.set(0, 0, -this.holdZ - 170); this.startZ = this.rel.z;
    this.maxHp = this.crit.reduce((a, p) => a + p.maxHp, 0); this.hp = this.maxHp;
    for (const p of this.parts) { p.exposed = false; ctx.enemies.add(p); }
    ctx.state.boss = { name: this.title, hp: this.hp, maxHp: this.maxHp, phase: 1 };
    ctx.events.emit('boss:spawn', { name: this.title, key: this.key });
    ctx.ui?.warning?.('WARNING');
    ctx.audio?.sfx?.('alarm');
    ctx.audio?.music?.('boss');
    this.intro?.(ctx);
  }

  /** Schedule fn after `t` seconds (only while alive). */
  after(t, fn) { this.tl.push({ t, fn }); }

  comm(speaker, text, duration = 3.6) { this.ctx.ui?.comm?.({ speaker, text, duration }); }

  addPart(anchor, opts, meshes) {
    const p = new Part(this, this.ctx, anchor, { ...opts, meshes });
    this.parts.push(p);
    if (opts.crit !== false && opts.critical) this.crit.push(p);
    return p;
  }

  // update
  update(dt, ctx) {
    if (!this.alive) return;
    this.age += dt; this.modeT += dt;
    for (let i = this.tl.length - 1; i >= 0; i--) {
      const e = this.tl[i]; e.t -= dt;
      if (e.t <= 0) { this.tl[i] = this.tl[this.tl.length - 1]; this.tl.pop(); e.fn(ctx); }
    }
    if (this.mode === 'intro') {
      const u = Math.min(1, this.modeT / this.introT), e = 1 - Math.pow(1 - u, 3);
      this.rel.z = this.startZ + (-this.holdZ - this.startZ) * e;
      this.rel.x = 0; this.rel.y = this.introY ?? 0;
      this.introUpdate?.(dt, ctx);
      this.animate(dt, ctx);
      if (u >= 1) this.beginFight(ctx);
    } else if (this.mode === 'fight') {
      this.fight(dt, ctx);
      this.animate(dt, ctx);
    } else this.dyingUpdate(dt, ctx);

    this.stallCheck(dt, ctx);
    this.position.copy(ctx.rail.position).add(this.rel).add(this.assist);
    this.relVel.subVectors(this.rel, this._relPrev).divideScalar(Math.max(dt, 1e-4)); this._relPrev.copy(this.rel);
    this.group.updateMatrixWorld(true);
    for (const p of this.parts) { p.sync(); p.lockable = p.alive && p.exposed && this.mode === 'fight'; }
    this.syncHud();
  }

  /**
   * Anti soft-lock: if boss hp has not dropped for 25 s, slide the whole boss so the first exposed critical part
   * lines up with the player's lane (reachable by straight lasers). The offset relaxes back once damage resumes.
   */
  stallCheck(dt, ctx) {
    if (this.mode !== 'fight') return;
    if (this.hp < this.lastHp - 0.01 || this.lastHp < 0) { this.lastHp = this.hp; this.stallT = 0; }
    else this.stallT += dt;
    const k = Math.min(1, dt * 1.2);
    let want = null;
    if (this.stallT > 25) {
      for (const p of this.crit) if (p.alive && p.exposed) { want = p; break; }
    }
    if (want) {
      const rp = ctx.rail.position;
      const dx = want.position.x - this.assist.x - rp.x, dy = want.position.y - this.assist.y - rp.y;
      this.assist.x += (-dx - this.assist.x) * k; this.assist.y += (-dy + 1 - this.assist.y) * k;
    } else { this.assist.x -= this.assist.x * k * 0.5; this.assist.y -= this.assist.y * k * 0.5; }
  }

  beginFight(ctx) {
    this.mode = 'fight'; this.modeT = 0;
    this.setPhase(1, true);
  }

  /** Recompute hp from critical parts and mirror to state.boss. */
  syncHud() {
    let hp = 0; for (const p of this.crit) hp += p.alive ? p.hp : 0;
    this.hp = hp;
    const s = this.ctx.state.boss;
    if (s) { s.hp = hp; s.maxHp = this.maxHp; s.name = this.title; s.phase = this.phase; }
  }

  setPhase(n, silent = false) {
    this.phase = n; this.phaseT = 0;
    const ctx = this.ctx;
    if (!silent) {
      ctx.fx?.flash?.('#ffffff', 0.5, 0.35); ctx.fx?.shake?.(1.4, 0.7);
      ctx.audio?.sfx?.('bigExplosion', { position: this.position });
      ctx.events.emit('fx:hitstop', { duration: 0.12 });
    }
    ctx.events.emit('boss:phase', { name: this.title, phase: n });
    this.onPhase?.(n, silent, ctx);
  }

  // damage
  takeDamage(amount, source, ctx = this.ctx) {
    if (!this.alive || this.dying) return;
    ctx.fx?.sparks?.(this.position, null, 3);
    ctx.audio?.sfx?.('hit', { pitch: 0.5, volume: 0.5, position: this.position });
  }

  onPartDestroyed(p) { p.anchor.visible = false; this.partDestroyed?.(p); }

  // death
  startDeath(ctx = this.ctx) {
    if (this.dying) return;
    this.dying = true; this.mode = 'dying'; this.modeT = 0; this.radius = 0; this.lockable = false;
    this.tl.length = 0;
    for (const p of this.parts) { if (p.alive) { ctx.fx?.explosion?.(p.position, { scale: p.explScale, big: p.explScale > 3 }); p.destroy(); } }
    // remove the boss's hostile stuff
    for (const e of ctx.groups.enemies) if (e !== this && (e.type === 'missile' || e.type === 'plasmaOrb' || e.type === 'grunt' || e.type === 'interceptor') && e.alive && e.spawnedBy === this) e.destroy(ctx);
    ctx.events.emit('fx:hitstop', { duration: 0.35 });
    ctx.fx?.flash?.('#ffffff', 0.7, 0.5); ctx.fx?.shake?.(2, 1.2);
    ctx.audio?.sfx?.('bigExplosion', { position: this.position });
    this.deathBoom = 0; this.deathSlow = false; this.deathFinal = false;
  }

  dyingUpdate(dt, ctx) {
    const t = this.modeT, T = this.deathT ?? 5.2;
    // sink and tumble
    this.rel.y -= 6 * dt * Math.min(1, t / 1.5);
    this.body.rotation.z += dt * 0.12 * Math.min(1, t); this.body.rotation.x += dt * 0.05 * Math.min(1, t);
    this.deathBoom -= dt;
    if (this.deathBoom <= 0 && t < T - 0.6) {
      this.deathBoom = 0.16 - Math.min(0.1, t * 0.02);
      const b = this.bounds ?? new THREE.Vector3(10, 5, 15), s = this.group.scale.x;
      _p.set((Math.random() * 2 - 1) * b.x, (Math.random() * 2 - 1) * b.y, (Math.random() * 2 - 1) * b.z).multiplyScalar(s);
      this.group.localToWorld(_p);
      const big = Math.random() < 0.3;
      const dc = this.deathColors ?? [0xffaa33, 0xff5522];
      ctx.fx?.explosion?.(_p, { scale: (big ? 5 : 3) * s, big, color: Math.random() < 0.5 ? dc[0] : dc[1] });
      ctx.fx?.debris?.(_p, 10, this.debrisColor ?? 0x883344);
      ctx.fx?.shake?.(0.5 + t * 0.25, 0.3);
      ctx.audio?.sfx?.(big ? 'bigExplosion' : 'explosion', { position: _p });
    }
    if (t > T * 0.55 && !this.deathSlow) { this.deathSlow = true; ctx.events.emit('fx:hitstop', { duration: 0.5 }); ctx.fx?.flash?.('#ffddaa', 0.35, 0.3); }
    if (t > T - 0.7 && !this.deathFinal) {
      this.deathFinal = true;
      ctx.fx?.explosion?.(this.position, { scale: 16 * this.group.scale.x, big: true, color: (this.deathColors ?? [0xffcc66])[0] });
      ctx.fx?.shockwave?.(this.position, { radius: 60, color: 0xffddaa });
      ctx.fx?.flash?.('#ffffff', 1.0, 0.9); ctx.fx?.shake?.(3, 1.0);
      ctx.events.emit('fx:hitstop', { duration: 0.7 });
      ctx.audio?.sfx?.('bigExplosion', { position: this.position, volume: 1 });
      this.after(0.12, () => { this.group.visible = false; });
    }
    if (t > T) this.finish(ctx);
  }

  finish(ctx) {
    if (this.defeated) return;
    this.defeated = true;
    ctx.state.boss = null;
    ctx.events.emit('enemy:killed', { enemy: this, points: this.def.points, position: this.position.clone() });
    ctx.events.emit('boss:defeated', { name: this.title, key: this.key });
    this.destroy(ctx);
  }

  destroy(ctx = this.ctx) {
    for (const p of this.parts) p.destroy();
    if (!this.defeated && this.ctx.state.boss?.name === this.title) this.ctx.state.boss = null;
    super.destroy(ctx);
  }

  /** Called when the last critical part dies. */
  bossDown() { this.startDeath(); }

  // subclass API: intro(ctx), fight(dt, ctx), animate(dt, ctx), onPhase(n, silent, ctx), partDestroyed(p),
  // optional: onReflectedHit(part, shot) -> {damage, force} to reward barrel roll reflections (see part.js),
  // and the look: deathColors [a, b] and debrisColor for the death sequence
  fight() {}
  animate() {}

  /** Spawn an enemy that belongs to this boss (culled with it). */
  spawnMinion(type, opts) {
    const e = this.ctx.enemies.spawn(type, opts);
    if (e) e.spawnedBy = this;
    return e;
  }
}
