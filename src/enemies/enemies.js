// Enemy manager (ctx.enemies). Spawn API, formations, bosses, culling, difficulty scaling.
//
// Notes for other modules (all optional to use):
//  - enemies.add(entity): queue an extra entity (boss parts, etc.) into groups.enemies; parts are inserted at the
//    FRONT so collision hits them before the big hull collider behind them.
//  - enemy.contactDamage (ram damage hint), enemy.type, enemy.aimOffset (Vector3), enemy.isBoss.
//  - Extra types: 'plasmaOrb' (bomber ammo), 'missile' (homing, shootable). Extra formation: 'swarm'.
//  - Events: 'formation:cleared' {name, bonus, position} plus 'score:add' {bonus:true} (state.score is bumped directly).
//  - Boss hitstop uses events 'fx:hitstop' {duration}.
//  - Dev: window.__spawnTest(type|formation|bossName, n).
import * as THREE from 'three';
import { pulseMaterials } from './models.js';
import { Formation, buildFormation, FORMATION_DEFAULT_COUNT, FORMATION_NAMES } from './formations.js';
import { diff } from './aim.js';
import { Grunt } from './types/grunt.js';
import { Dart } from './types/dart.js';
import { Gunship } from './types/gunship.js';
import { Turret } from './types/turret.js';
import { Bomber } from './types/bomber.js';
import { PlasmaOrb } from './types/plasmaOrb.js';
import { Swarmer } from './types/swarmer.js';
import { Interceptor } from './types/interceptor.js';
import { Mine } from './types/mine.js';
import { Carrier } from './types/carrier.js';
import { AsteroidDrone } from './types/asteroidDrone.js';
import { Missile } from './types/missile.js';
import { Tidebreaker } from './bosses/tidebreaker.js';
import { Orrery } from './bosses/orrery.js';
import { Regent } from './bosses/regent.js';

const TYPES = { grunt: Grunt, dart: Dart, gunship: Gunship, turret: Turret, bomber: Bomber, plasmaOrb: PlasmaOrb, swarmer: Swarmer, interceptor: Interceptor, mine: Mine, carrier: Carrier, asteroidDrone: AsteroidDrone, drone: AsteroidDrone, missile: Missile };
const BOSSES = { tidebreaker: Tidebreaker, orrery: Orrery, regent: Regent, thalassa: Tidebreaker, cinder: Orrery, foundry: Regent };

const _o = new THREE.Vector3();

export const enemies = {
  list: [], boss: null, timers: [], pending: [], time: 0, ctx: null,
  types: TYPES,

  init(ctx) {
    this.ctx = ctx; this.list = ctx.groups.enemies;
    window.__enemies = this;
    window.__spawnTest = (type, n = 1) => this.spawnTest(type, n);
  },

  reset(ctx) { this.killAll(); this.time = 0; },
  onWorldReset(ctx) { this.reset(ctx ?? this.ctx); },

  /** spawn(type, {position (world), rel (rail-relative), velocity?, path?, hp?, ...}) -> entity | null */
  spawn(type, opts = {}) {
    const ctx = this.ctx, Cls = TYPES[type];
    if (!Cls) { console.warn('[enemies] unknown type', type); return null; }
    if (type === 'swarmer' && (opts.count ?? 1) > 1) {
      const org = opts.position ? opts.position.clone() : ctx.rail.position.clone().add(opts.rel ?? new THREE.Vector3(0, 0, -160));
      return this.spawnFormation('swarm', org, opts)?.first ?? null;
    }
    const e = new Cls(ctx, type, opts);
    this.list.push(e);
    return e;
  },

  /** spawnFormation('vee'|'line'|'wave'|'circle'|'pincer'|'convoy'|'swarm', originWorldVec3, opts) -> Formation */
  spawnFormation(name, origin, opts = {}) {
    const ctx = this.ctx;
    const o = (origin ?? _o.set(0, 0, -170)).clone().sub(ctx.rail.position);
    let n = opts.count ?? FORMATION_DEFAULT_COUNT[name] ?? 4;
    if (!opts.exact) n = Math.max(3, Math.round(n * diff(ctx).enemyCount));
    const specs = buildFormation(name, o, opts, n);
    if (!specs) { console.warn('[enemies] unknown formation', name); return null; }
    const f = new Formation(name, specs.length, opts.bonus ?? 100 + 50 * specs.length);
    for (const s of specs) {
      s.opts.formation = f;
      if (s.delay <= 0) { const e = this.spawn(s.type, s.opts); f.spawned++; if (e && !f.first) f.first = e; }
      else this.timers.push({ t: s.delay, type: s.type, opts: s.opts, f });
    }
    return f;
  },

  spawnBoss(name) {
    const ctx = this.ctx, Cls = BOSSES[name];
    if (!Cls) { console.warn('[enemies] unknown boss', name); return null; }
    if (this.boss?.alive) this.boss.destroy(ctx);
    const b = new Cls(ctx);
    this.list.push(b);
    this.boss = b;
    return b;
  },

  add(entity) { this.pending.push(entity); return entity; },

  killAll() {
    const ctx = this.ctx;
    this.timers.length = 0; this.pending.length = 0;
    for (let i = this.list.length - 1; i >= 0; i--) { const e = this.list[i]; if (e.formation) e.formation.cancelled = true; e.destroy?.(ctx); }
    this.list.length = 0;
    this.boss = null;
    if (ctx?.state) ctx.state.boss = null;
  },

  update(dt, ctx) {
    this.time += dt;
    pulseMaterials(this.time);
    const list = this.list, rail = ctx.rail.position;

    for (let i = this.timers.length - 1; i >= 0; i--) {
      const t = this.timers[i]; t.t -= dt;
      if (t.t <= 0) {
        this.timers[i] = this.timers[this.timers.length - 1]; this.timers.pop();
        if (!t.f.cancelled) { const e = this.spawn(t.type, t.opts); t.f.spawned++; if (e && !t.f.first) t.f.first = e; }
      }
    }
    for (let i = 0; i < this.pending.length; i++) { const p = this.pending[i]; if (p.alive) list.unshift(p); }
    this.pending.length = 0;

    for (let i = list.length - 1; i >= 0; i--) {
      const e = list[i];
      if (e.alive) {
        e.update(dt, ctx);
        if (e.alive && e.rel && !e.isBoss) {
          const r = e.rel;
          if (r.z > 70 || r.z < -560 || r.x > 320 || r.x < -320 || r.y > 260 || r.y < -260) e.destroy(ctx);
        }
      }
      if (!e.alive) {
        const n = list.length - 1;
        for (let j = i; j < n; j++) list[j] = list[j + 1];
        list.length = n;
      }
    }
    // keep the boss pointer honest
    if (this.boss && !this.boss.alive) this.boss = null;
  },

  // ---- dev harness ----
  spawnTest(type, n = 1) {
    const ctx = this.ctx, out = [];
    const base = _o.copy(ctx.rail.position);
    if (BOSSES[type]) return this.spawnBoss(type);
    if (FORMATION_NAMES.includes(type)) return this.spawnFormation(type, base.clone().add(new THREE.Vector3(0, 0, -200)), { count: n > 1 ? n : undefined });
    for (let i = 0; i < n; i++) {
      const x = (i - (n - 1) / 2) * 14, e = this.spawn(type, { position: base.clone().add(new THREE.Vector3(x, 0, -90 - (i % 2) * 20)) });
      out.push(e);
    }
    return out;
  },
};
