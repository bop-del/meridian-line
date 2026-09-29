// World module (ctx.world): sky, lights, fog, streamed scenery, obstacles, pickups and the level script runner.
//
// API: each level file default-exports { info, buildEnvironment(ctx, W), script(ctx, S, W) }.
// buildEnvironment configures the look through W.setup({...}), adds meshes to W.root and returns the streamer
// object { update(dt, ctx), invalidate?(), reset?(), dispose?() }.
// Obstacles with collider === 'box' expose hitTest(pos, radius) (custom collider, boxes/spheres in local space);
// their `radius` is only a conservative bounding sphere and must NOT be used as the actual hit shape.
import * as THREE from 'three';
import { Sky, LightRig } from './sky.js';
import { Resources } from './materials.js';
import { createObstacle } from './obstacles.js';
import { Pickup, spawnCellSet } from './pickups.js';
import { ScriptRunner, createScriptAPI } from './script.js';
import { Rng, disposeTree } from './util.js';
import thalassa from './levels/thalassa.js';
import cinder from './levels/cinder.js';
import foundry from './levels/foundry.js';

const LEVELS = [thalassa, cinder, foundry];
const _v = new THREE.Vector3();

export const world = {
  ctx: null, res: null, root: null, sky: null, lights: null,
  index: -1, level: null, env: null, runner: new ScriptRunner(), S: null,
  info: { name: 'THALASSA COAST', subtitle: '', length: 6000, bossAt: 5000, music: 'thalassa', look: {} },
  progress: 0, time: 0, floorY: -26, theme: 'thalassa', rng: new Rng(5),
  decor: [], bossStarted: false, bossTimer: 0, victory: null, finished: false, dropCd: 0, _progT: 0,

  get levelInfo() { return this.info; },

  // ------------------------------------------------------------------ lifecycle
  init(ctx) {
    this.ctx = ctx;
    this.root = new THREE.Group();
    this.root.name = 'world';
    ctx.scene.add(this.root);
    this.sky = new Sky();
    ctx.scene.add(this.sky.group);
    this.lights = new LightRig(ctx.scene);
    if (ctx.camera && ctx.camera.far < 4000) { ctx.camera.far = 4000; ctx.camera.updateProjectionMatrix(); }
    ctx.events.on('boss:defeated', (e) => this.onBossDefeated(e));
    ctx.events.on('enemy:killed', (e) => this.onEnemyKilled(e));
    ctx.events.on('level:start', (e) => { if (e && typeof e.index === 'number' && e.index !== this.index) this.loadLevel(e.index); });
    this.loadLevel(ctx.state?.levelIndex ?? 0);
  },

  reset(ctx) {
    ctx = ctx ?? this.ctx;
    const want = ctx.state?.levelIndex ?? 0;
    if (want !== this.index || !this.level) { this.loadLevel(want); return; }
    this.softReset();
  },

  softReset() {
    const ctx = this.ctx;
    this.clearEntities();
    this.runner.rewind();
    this.bossStarted = false; this.bossSeen = false; this.bossTimer = 0; this.victory = null; this.finished = false; this.progress = 0; this.dropCd = 0;
    this.env?.reset?.(ctx);
    this.env?.invalidate?.();
    this.env?.update?.(0, ctx, true);
  },

  clearEntities() {
    const ctx = this.ctx;
    const g = ctx.groups;
    for (const o of g.obstacles) o.destroy?.(ctx);
    g.obstacles.length = 0;
    for (const p of g.pickups) p.destroy?.(ctx);
    g.pickups.length = 0;
    for (const d of this.decor) d.destroy?.(ctx);
    this.decor.length = 0;
  },

  loadLevel(i, force = false) {
    const ctx = this.ctx;
    if (!ctx) return;
    i = Math.max(0, Math.min(LEVELS.length - 1, i | 0));
    if (!force && i === this.index && this.level && this.env) { this.softReset(); return; }
    this.unload();
    const level = LEVELS[i];
    this.index = i; this.level = level;
    this.info = { ...level.info, index: i };
    this.theme = level.info.theme ?? ['thalassa', 'cinder', 'foundry'][i];
    this.res = new Resources();
    this.rng = new Rng(1000 + i * 77);
    this.bossStarted = false; this.bossSeen = false; this.bossTimer = 0; this.victory = null; this.finished = false; this.progress = 0; this.dropCd = 0;
    this.floorY = level.info.floorY ?? -26;
    this.runner.clear();
    this.env = level.buildEnvironment(ctx, this) ?? null;
    this.S = createScriptAPI(this, this.runner);
    level.script?.(ctx, this.S, this);
    this.env?.update?.(0, ctx, true);
    ctx.render?.setLevelLook?.(this.info.look);
    ctx.events.emit('world:loaded', { index: i, info: this.info });
  },

  unload() {
    const ctx = this.ctx;
    this.clearEntities();
    if (this.env) { this.env.dispose?.(); this.env = null; }
    // sky planets
    if (this.sky) {
      for (const p of this.sky.planets) { this.sky.group.remove(p.group); p.dispose(); }
      this.sky.planets.length = 0;
    }
    // everything the level added under root
    if (this.root) {
      const kids = [...this.root.children];
      for (const k of kids) { this.root.remove(k); disposeTree(k); }
    }
    this.res?.dispose(); this.res = null;
    if (ctx?.scene) { ctx.scene.fog = null; }
  },

  /** Level helper: configure sky, lights, fog and post look in one go. */
  setup({ fog, sky, lights, look, planets = [], rings = [], env }) {
    const ctx = this.ctx;
    if (env !== undefined && ctx.scene) ctx.scene.environmentIntensity = env;
    if (fog) {
      ctx.scene.fog = new THREE.Fog(fog.color, fog.near, fog.far);
      ctx.scene.background = new THREE.Color(fog.color);
    }
    if (sky) this.sky.configure(sky);
    if (lights) this.lights.configure(lights);
    for (const p of planets) this.sky.addPlanet(p);
    for (const p of rings) this.sky.addRing(p);
    if (look) this.info.look = { ...(this.info.look ?? {}), ...look };
  },

  // ------------------------------------------------------------------ spawning API
  spawnObstacle(type, pos, opts = {}) {
    const ctx = this.ctx;
    const ob = createObstacle(type, ctx, this, pos, opts);
    if (!ob) return null;
    ctx.scene.add(ob.group);
    if (ob.decor) this.decor.push(ob); else ctx.groups.obstacles.push(ob);
    return ob;
  },
  spawnDecor(type, pos, opts = {}) {
    const ob = createObstacle(type, this.ctx, this, pos, opts);
    if (!ob) return null;
    ob.decor = true;
    this.ctx.scene.add(ob.group);
    this.decor.push(ob);
    return ob;
  },
  spawnPickup(kind, pos, opts = {}) {
    const ctx = this.ctx;
    const p = new Pickup(kind, this, opts);
    const rail = ctx.rail.position;
    if (opts.raw) p.setBase(pos.x, pos.y, pos.z);
    else p.setBase(THREE.MathUtils.clamp(pos.x, rail.x - 12.5, rail.x + 12.5), THREE.MathUtils.clamp(pos.y, rail.y - 6.5, rail.y + 6.5), Math.min(pos.z, rail.z - 30));
    ctx.scene.add(p.group);
    ctx.groups.pickups.push(p);
    return p;
  },
  spawnCells(kind, pos, count = 4, shape = "line", opts = {}) {
    return spawnCellSet(this, this.ctx, kind, pos, count, shape, opts);
  },

  // ------------------------------------------------------------------ boss and finish
  startBoss(name) {
    const ctx = this.ctx;
    if (this.bossStarted) return;
    this.bossStarted = true; this.bossTimer = 0;
    ctx.enemies?.spawnBoss?.(name);
  },

  onBossDefeated(e) {
    if (this.victory || this.finished) return;
    this.victory = { t: 0, step: 0, fallback: !!e?.fallback };
  },

  runVictory(dt, ctx) {
    const v = this.victory;
    v.t += dt;
    if (v.step === 0 && v.t > 0.8) {
      v.step = 1;
      // debrief lines: [speaker, text]. Dispatch and readouts only log the result.
      const lines = [
        [['CONTROL', 'Landing fleet neutralised. Thalassa Coast logged clear.'], ['FERRO', 'Better than the briefing suggested. Low bar.']],
        [['LUMEN', 'Ring vessel destroyed. Debris field stable.'], ['VEX', 'Wing two confirms. Nothing left to inspect.']],
        [['LUMEN', 'Regent core signal lost. Dominion fleet withdrawing.'], ['CONTROL', 'Forge offline. Logging.'], ['SABLE', 'Noted.']],
      ][Math.min(2, this.index)];
      lines.forEach(([speaker, text], i) => {
        const show = () => ctx.ui?.comm?.({ speaker, text, duration: 3.2 });
        if (i === 0) show(); else this.runner.after(i * 3.3, show);
      });
      v.hold = 0.8 + lines.length * 1.7;
    }
    if (v.step === 1 && v.t > (v.hold ?? 3.2)) { v.step = 2; ctx.ui?.banner?.('MISSION COMPLETE', this.info.name.toUpperCase()); ctx.fx?.flash?.('#ffffff', 0.25, 0.5); }
    if (v.step === 2 && v.t > (v.hold ?? 3.2) + 4.0) {
      v.step = 3; this.finished = true; this.progress = 1;
      ctx.events.emit('level:complete', { index: this.index });
    }
  },

  // ------------------------------------------------------------------ enemy drops
  onEnemyKilled(e) {
    const ctx = this.ctx;
    if (!e || ctx.state?.phase !== 'playing' || this.dropCd > 0) return;
    const en = e.enemy;
    const type = en?.type ?? en?.kind ?? en?.name ?? '';
    const chance = { gunship: 0.2, bomber: 0.16, carrier: 0.5, turret: 0.07, interceptor: 0.1, swarmer: 0.02, dart: 0.03, mine: 0.0, asteroidDrone: 0.03 }[type] ?? 0.05;
    if (Math.random() > chance) return;
    const st = ctx.state;
    let kind = 'bomb';
    const r = Math.random();
    if (r < 0.5 && st.health < 85) kind = 'repair'; else if (r > 0.93 && st.laserLevel < 3) kind = 'pulseUpgrade';
    const p = e.position ?? en?.position;
    if (!p) return;
    const z = Math.min(p.z, ctx.rail.position.z - 55);
    _v.set(THREE.MathUtils.clamp(p.x - ctx.rail.position.x, -11, 11), THREE.MathUtils.clamp(p.y - ctx.rail.position.y, -6, 6), z);
    this.spawnPickup(kind, _v);
    this.dropCd = 3;
  },

  // ------------------------------------------------------------------ frame update
  update(dt, ctx) {
    ctx = ctx ?? this.ctx;
    if (!ctx || !this.env) return;
    this.time += dt;
    this.dropCd = Math.max(0, this.dropCd - dt);
    this.sky.update(dt, ctx.camera, this.time);
    this.env.update(dt, ctx);

    const railZ = ctx.rail.position.z;
    const g = ctx.groups;
    for (let i = g.obstacles.length - 1; i >= 0; i--) {
      const o = g.obstacles[i];
      if (!o.alive) { o.group.parent?.remove(o.group); g.obstacles.splice(i, 1); continue; }
      o.update(dt, ctx);
      if (o.position.z > railZ + (o.pruneBehind ?? 45)) { o.destroy(ctx); g.obstacles.splice(i, 1); }
    }
    for (let i = g.pickups.length - 1; i >= 0; i--) {
      const p = g.pickups[i];
      if (!p.alive) { p.group.parent?.remove(p.group); g.pickups.splice(i, 1); continue; }
      p.update(dt, ctx);
    }
    for (let i = this.decor.length - 1; i >= 0; i--) {
      const d = this.decor[i];
      if (!d.alive || d.position.z > railZ + (d.pruneBehind ?? 60)) { d.destroy(ctx); this.decor.splice(i, 1); continue; }
      d.update?.(dt, ctx);
    }

    const playing = ctx.state?.phase === 'playing';
    const dist = ctx.rail.distance ?? -railZ;
    if (!playing) return;

    this.runner.update(dt, ctx);
    if (this.victory) this.runVictory(dt, ctx);
    else {
      this.progress = Math.max(0, Math.min(1, dist / this.info.bossAt));
      if (this.bossStarted && !this.finished) {
        this.bossTimer += dt;
        // safety net: if no boss ever materialises (enemy module missing), do not soft lock the run
        if (!this.bossSeen) {
          if (ctx.enemies?.boss || ctx.state?.boss) this.bossSeen = true;
          else if (this.bossTimer > 12) this.onBossDefeated({ fallback: true });
        }
      }
    }
    this._progT += dt;
    if (this._progT > 0.1) { this._progT = 0; ctx.events.emit('level:progress', { t: this.progress }); }
  },

  dispose() { this.unload(); },
};
