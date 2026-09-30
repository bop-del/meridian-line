// Boss base class. Holds station ahead of the rail (rail-relative), runs intro / fight / death, keeps state.boss in
// sync for the HUD, and manages Parts (weak points, turrets, cable clamps, emitter lenses...) that are separate collidable entities.
//
// Damage model: the boss body itself cannot be damaged (its small collider sits BEHIND the front parts and deflects).
// Every fight is decided by critical parts (`this.crit`). boss.hp = sum of critical part HP (monotonic, drives the HUD).
import * as THREE from 'three';
import { Enemy } from '../enemy.js';
import { Part } from '../part.js';
import { diff } from '../aim.js';
import { ensureBossShots } from './cinematics.js';

const _p = new THREE.Vector3(), _c = new THREE.Vector3();
const clamp = THREE.MathUtils.clamp;

// Defeat sequence timing (game seconds since the last critical part died). The finisher takeover (cinematics.js, 3.2 s) starts at shotAt and
// ends at T; the burst lands 1.55 s into it. Everything before shotAt is the cascade, played in the normal chase camera.
// Per boss overrides go into this.deathCfg (flash colour, peak, sink speeds, ...).
const DEATH = { T: 5.4, shotAt: 2.2, burstAt: 3.75, flash: '#ffe2b0', flashPeak: 0.55, sink: 3.5, sinkAfter: 3.5, tumble: 1 };

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
    ctx.audio?.sfx?.('alarm');
    ctx.audio?.music?.('boss');
    // entrance takeover: the WARNING banner waits until the shot ends (showWarning), the first comm lines wait via cinDelay
    this.cinDelay = 0; this.warnPending = false;
    ensureBossShots(ctx);
    if (ctx.cinema?.play(`boss.${this.key}.entrance`, { data: { boss: this } })) { this.warnPending = true; this.cinDelay = ctx.cinema.duration + 0.1; }
    else ctx.ui?.warning?.('WARNING');
    this.intro?.(ctx);
  }

  /** Called when the entrance takeover ends (or at once when there is none). */
  showWarning() {
    if (!this.warnPending) return;
    this.warnPending = false;
    if (this.alive && !this.dying) this.ctx.ui?.warning?.('WARNING');
  }

  /** World centre of the boss for the takeover cameras and the defeat effects. Subclasses point it at their core. */
  focus(out) { return this.group.getWorldPosition(out); }

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
    // the boss comes to rest: a low thump through the camera
    ctx.fx?.shake?.(0.7, 0.7, 'boss'); ctx.audio?.sfx?.('bigExplosion', { position: this.position, volume: 0.35, pitch: 0.6 });
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

  // ---------------------------------------------------------------- death
  // 1. cascade (0 to burstAt): staged explosions along the silhouette, parts blow one after the other, the boss sinks and tumbles.
  //    The finisher takeover starts at shotAt. 2. slow motion beat just before the burst. 3. burst: a warm flash that ramps in over
  //    three frames (never above flashPeak), core detonation, shock ring, debris, boss:defeated. 4. aftermath: fire and drifting wreck.
  // Subclass hooks: deathPoint(out, k) blast positions along the silhouette (k 0..1 progress), deathTick(dt, t, ds, ctx) per frame visuals,
  // onBurst(ctx, c) the boss specific burst, hideAtBurst() what disappears in the flash, deathSort(a, b) part blast order.
  startDeath(ctx = this.ctx) {
    if (this.dying) return;
    this.dying = true; this.mode = 'dying'; this.modeT = 0; this.radius = 0; this.lockable = false;
    this.tl.length = 0;
    const q = [];
    for (const p of this.parts) if (p.alive) { q.push(p); p.destroy(); }
    q.sort((a, b) => this.deathSort(a, b));
    // remove the boss's hostile stuff
    for (const e of ctx.groups.enemies) if (e !== this && (e.type === 'missile' || e.type === 'plasmaOrb' || e.type === 'grunt' || e.type === 'interceptor') && e.alive && e.spawnedBy === this) e.destroy(ctx);
    this.dp = { ...DEATH, ...(this.deathCfg ?? {}) };
    this.ds = { q, cd: 0.05, n: 0, shot: false, slow: false, burst: false, ff: -1, gs: this.group.scale.x };
    ctx.game?.hitStop?.(0.1, 0.2);
    ctx.fx?.shake?.(1.4, 0.9, 'boss'); ctx.fx?.flash?.(this.dp.flash, 0.2, 0.3);
    ctx.audio?.sfx?.('bigExplosion', { position: this.position });
    this.onDeathStart?.(ctx);
  }

  deathSort(a, b) { return a.anchor.position.z - b.anchor.position.z; }

  /** Default blast position: anywhere in the boss bounds. */
  deathPoint(out) {
    const b = this.bounds ?? _c.set(10, 5, 15);
    out.set((Math.random() * 2 - 1) * b.x, (Math.random() * 2 - 1) * b.y, (Math.random() * 2 - 1) * b.z);
    return this.group.localToWorld(out.multiplyScalar(this.group.scale.x));
  }

  /** One staged blast. Default is a fireball; the Regent overrides it with cold energy. */
  blastFx(ctx, pos, scale, color, deb) { ctx.fx?.explosion?.(pos, { scale, color, debrisColor: deb }); }

  /** The final detonation at the focus. */
  burstFx(ctx, c, gs, color) {
    ctx.fx?.explosion?.(c, { scale: 4 * gs, big: true, color, debrisColor: this.debrisColor });
    ctx.fx?.shockwave?.(c, { radius: 46, color });
  }

  deathBlast(ctx, k) {
    const S = this.ds, gs = S.gs, dc = this.deathColors ?? [0xffaa33, 0xff5522];
    let scale, color, deb = this.debrisColor ?? 0x883344;
    const part = S.q.length && (S.n % 2 === 0 || k > 0.55) ? S.q.shift() : null;
    if (part) { part.anchor.getWorldPosition(_p); scale = (part.explScale ?? 3) * 0.95; color = part.explColor; deb = part.debrisColor ?? deb; part.anchor.visible = false; this.onPartBlast?.(part); }
    else { this.deathPoint(_p, k); scale = (1.3 + 1.3 * k + Math.random() * 0.8) * gs; color = Math.random() < 0.5 ? dc[0] : dc[1]; }
    this.blastFx(ctx, _p, scale, color, deb);
    ctx.fx?.debris?.(_p, 8, deb);
    ctx.fx?.shake?.(0.25 + 0.5 * k, 0.25);
    ctx.audio?.sfx?.(part || S.n % 4 === 0 ? 'bigExplosion' : 'explosion', { position: _p, volume: 0.6 + 0.4 * k });
    S.n++;
  }

  dyingUpdate(dt, ctx) {
    const t = this.modeT, D = this.dp, S = this.ds;
    // sink and tumble
    const ramp = Math.min(1, t / 1.5);
    this.rel.y -= (t < D.burstAt ? D.sink : D.sinkAfter) * dt * ramp;
    this.body.rotation.z += dt * 0.12 * ramp * D.tumble; this.body.rotation.x += dt * 0.05 * ramp * D.tumble;
    if (!S.shot && t >= D.shotAt) { S.shot = true; ctx.cinema?.play(`boss.${this.key}.finisher`, { data: { boss: this } }); }
    // cascade, then a thinner trail of fires in the aftermath
    S.cd -= dt;
    if (S.cd <= 0 && t < D.T - 0.5) {
      if (!S.burst) { const k = clamp(t / D.burstAt, 0, 1); S.cd = 0.34 - 0.25 * k * k + Math.random() * 0.04; this.deathBlast(ctx, k); }
      else { S.cd = (D.afterCd ?? 0.2) + Math.random() * 0.1; this.deathPoint(_p, 1); this.blastFx(ctx, _p, (D.afterScale ?? 1.3) * S.gs, (this.deathColors ?? [0xffaa33])[0], this.debrisColor); }
    }
    this.deathTick?.(dt, t, S, ctx);
    // slow motion beat: lands the burst inside it
    if (!S.slow && t >= D.burstAt - 0.09) { S.slow = true; ctx.game?.hitStop?.(0.75, 0.16); }
    if (!S.burst && t >= D.burstAt) { S.burst = true; S.ff = 0; }
    // the flash ramps in over three frames; the detonation itself happens on the last one, under the peak
    if (S.ff >= 0 && S.ff < 3) {
      ctx.fx?.flash?.(D.flash, D.flashPeak * (S.ff + 1) / 3, 0.55);
      if (S.ff === 2) this.deathBurst(ctx);
      S.ff++;
    }
    if (t > D.T) this.finish(ctx);
  }

  deathBurst(ctx) {
    const c = this.focus(_c), gs = this.ds.gs, dc = this.deathColors ?? [0xffcc66, 0xff8844];
    this.burstFx(ctx, c, gs, dc[0]);
    ctx.fx?.debris?.(c, 30, this.debrisColor ?? 0x883344);
    ctx.fx?.sparks?.(c, null, 40);
    ctx.fx?.shake?.(2.2, 1.2, 'boss');
    ctx.audio?.sfx?.('bigExplosion', { position: c, volume: 1 });
    if (this.hideAtBurst) this.hideAtBurst(); else this.group.visible = false;
    this.onBurst?.(ctx, c);
    this.declareDefeated(ctx);
  }

  /** boss:defeated: score, victory flow, atmosphere. The HUD answers it with a near white screen flash; that one is capped here. */
  declareDefeated(ctx) {
    if (this.defeated) return;
    this.defeated = true;
    ctx.state.boss = null;
    const hud = ctx.ui?.hud, sf = hud?.screenFlash;
    if (hud && sf) hud.screenFlash = (col, a, ms) => sf.call(hud, 'rgba(255,214,150,0.6)', Math.min(a, 0.22), Math.min(ms, 500));
    try {
      ctx.events.emit('enemy:killed', { enemy: this, points: this.def.points, position: this.position.clone() });
      ctx.events.emit('boss:defeated', { name: this.title, key: this.key });
    } finally { if (hud && sf) hud.screenFlash = sf; }
  }

  finish(ctx) {
    this.declareDefeated(ctx);
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
