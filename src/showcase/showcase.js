// Showcase mode (?showcase=1): an autopilot flies a scripted, well composed route through a level with the cinematic camera, so the
// game can be screen recorded with real audio. Loaded on demand by game.js, never on the normal path. Details: docs/SHOWCASE.md.
//   ?showcase=1&level=0|1|2   optional ?hud=0 hides the HUD and comm boxes, ?loop=1 keeps going after the level ends,
//   ?bars=0 removes the letterbox bars. Sound: the title's sound gate is the start button (the first key or click unlocks the
//   audio and begins the run); a headless browser starts at once.
// The pilot only writes ctx.input.autopilot (steering, reticle, fire, boost, roll, bomb) and starts extra camera shots through
// ctx.cinema.play(name, { free: true }). It reads the world (obstacles, enemies, shots, boss parts) and never edits it. God mode is on,
// so the ship survives; the route is planned to look like flying anyway: lanes that avoid obstacles, weaving, rolls at incoming fire.
//
// Public: showcase.status() -> { started, ended, phase, level, dist, boss, shots, stats }, showcase.start(level), showcase.log.
// Shots registered with the cinema director: showcase.drone, showcase.flyby, showcase.lowsweep, showcase.wide, showcase.orbit. Every
// pose starts and ends on the chase pose (an envelope on u), so a blend in or out is invisible whatever the director does.
import * as THREE from 'three';
import { chasePose, env as shotEnv } from '../cinema/helpers.js';
import { momentDef } from '../cinema/moments.js';

const clamp = THREE.MathUtils.clamp;
const lerp = THREE.MathUtils.lerp;
const smooth01 = (t) => { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); };
const damp = (cur, target, rate, dt) => cur + (target - cur) * (1 - Math.exp(-rate * dt));

// small seeded generator, so the same route is flown every time
function rng(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

const _v = new THREE.Vector3();
const _w = new THREE.Vector3();
const _cp = new THREE.Vector3();
const _pt = new THREE.Vector3();

// extra shots per level: rail progress (0..1 of the boss distance) and the shot to play (the side alternates)
const SCHEDULE = [
  [0.10, 'showcase.drone'], [0.27, 'showcase.flyby'], [0.44, 'showcase.wide'], [0.60, 'showcase.lowsweep'], [0.78, 'showcase.drone'], [0.92, 'showcase.wide'],
];

export const showcase = {
  ctx: null,
  params: null,
  started: false, ended: false, loop: false, hud: true, bars: true, fixedLevel: null,
  t: 0, runT: 0,
  stats: { rolls: 0, bombs: 0, boosts: 0, volleys: 0, shots: 0, kills: 0, minHealth: 100 },
  played: [],
  log: [],
  _r: rng(2718),
  _ap: { axis: { x: 0, y: 0 }, aim: { x: 0, y: 0 }, fire: false, boost: false, brake: false, bomb: false, rollLeft: false, rollRight: false },
  _aim: { x: 0, y: 0 },
  _lane: { tx: 0, ty: 0, at: 0, clear: true },
  _fire: { hold: 0, off: 0 },
  _boost: { on: false, t: 0, cd: 5 },
  _roll: { cd: 0, decor: 9 },
  _bombCd: 8, _bombT: -99,
  _shotCd: 9, _sched: 0, _side: 1,
  _bossShots: 0, _lastBossPhase: 1,
  _endT: 0, _blurT: 0,

  init(ctx) {
    this.ctx = ctx;
    const q = new URLSearchParams(location.search);
    this.params = q;
    this.hud = q.get('hud') !== '0';
    this.loop = q.get('loop') === '1';
    this.bars = q.get('bars') !== '0';
    this.fixedLevel = q.has('level') ? clamp(Number(q.get('level')) | 0, 0, ctx.config.levels.length - 1) : null;
    ctx.state.god = true;
    this.injectStyle();
    ctx.cinema?.setBars?.(this.bars ? 1 : 0);   // the director's letterbox stays on between shots
    this.registerShots();
    const ev = ctx.events;
    ev.on('enemy:killed', () => { this.stats.kills++; });
    ev.on('player:roll', () => { this.stats.rolls++; });
    ev.on('player:bomb', () => { this.stats.bombs++; });
    ev.on('player:boost', (e) => { if (e?.on) this.stats.boosts++; });
    ev.on('boss:phase', (e) => { this.note('boss:phase ' + (e?.phase ?? '')); });
    ev.on('boss:spawn', () => { this.yieldShot(); this._bombCd = Math.max(this._bombCd, 2); this.note('boss:spawn'); this._bossShots = 0; this._lastBossPhase = 1; this._shotCd = Math.max(this._shotCd, 6); });
    ev.on('boss:defeated', () => { this.note('boss:defeated'); this._bombCd = Math.max(this._bombCd, 4); });
    ev.on('level:start', () => { this.onLevelStart(); });
    ev.on('phase', (e) => { this.onPhase(e); });
    ev.on('cinema:start', (e) => {
      if (e?.name?.startsWith('showcase.')) { this.stats.shots++; this.played.push(e.name); }
      this.note('cinema ' + (e?.name ?? ''));
    });
    // start at once when the audio is running (or headless), else on the first key or click, which also unlocks the audio
    const go = () => { if (!this.started) this.start(this.fixedLevel ?? 0); };
    if (navigator.webdriver || ctx.audio?.unlocked || ctx.state.phase === 'playing') go();
    else {
      ev.on('audio:unlocked', () => setTimeout(go, 150));
      const onGesture = () => { setTimeout(go, 400); };
      addEventListener('keydown', onGesture, { once: true });
      addEventListener('pointerdown', onGesture, { once: true });
    }
  },

  reset() {},

  note(what) {
    const c = this.ctx;
    this.log.push({ t: +this.runT.toFixed(2), dist: Math.round(c?.rail?.distance ?? 0), what });
    if (this.log.length > 400) this.log.shift();
  },

  // ------------------------------------------------------------------ start and level flow
  start(level = 0) {
    const c = this.ctx;
    this.started = true; this.ended = false;
    c.state.god = true;
    if (c.state.phase === 'playing' && c.state.levelIndex === level) this.onLevelStart();
    else c.game.newRun({ level });
  },

  onLevelStart() {
    const c = this.ctx;
    this.runT = 0; this.ended = false; this._sched = 0; this._shotCd = 9; this._side = 1;
    this._boost.on = false; this._boost.cd = 5; this._roll.cd = 0; this._roll.decor = 9; this._bombCd = 8; this._bombT = -99;
    this._fire.hold = 0; this._fire.off = 0;
    this._lane.tx = 0; this._lane.ty = 0; this._lane.at = 0;
    this._bossShots = 0; this._lastBossPhase = 1; this._endT = 0;
    this._r = rng(2718 + (c.state.levelIndex | 0) * 101);
    this.stats.minHealth = c.state.health;
    this.note('level:start ' + c.state.levelIndex);
  },

  onPhase(e) {
    if (!this.started) return;
    if (e.phase === 'levelcomplete' || e.phase === 'victory' || e.phase === 'gameover') { this.ended = true; this._endT = 0; this.note('end ' + e.phase); }
  },

  status() {
    const c = this.ctx, b = c.state.boss;
    return {
      started: this.started, ended: this.ended, phase: c.state.phase, level: c.state.levelIndex, dist: Math.round(c.rail.distance), runT: +this.runT.toFixed(1),
      health: Math.round(c.state.health), lives: c.state.lives, boss: b ? { name: b.name, hp: Math.round(b.hp), maxHp: Math.round(b.maxHp), phase: b.phase } : null,
      shots: this.played.slice(), stats: { ...this.stats }, cinema: c.cinema?.active ? c.cinema.name : '',
    };
  },

  // ------------------------------------------------------------------ frame
  update(dt, ctx = this.ctx) {
    if (!this.started) return;
    this.t += dt;
    const st = ctx.state;
    // keep the run alive when the window loses focus (a recorder in front): the game pauses on blur, a showcase should not
    if (st.phase === 'paused') {
      this._blurT += dt;
      if (this._blurT > 0.4 && !document.hasFocus()) { ctx.game.resume(); this._blurT = 0; }
    } else this._blurT = 0;

    if (st.phase !== 'playing') {
      if (ctx.input.autopilot === this._ap) ctx.input.autopilot = null;
      this.updateEnd(dt, ctx);
      return;
    }
    if (ctx.input.autopilot !== this._ap) ctx.input.autopilot = this._ap;
    this.runT += dt;
    if (dt <= 0) return;
    this.stats.minHealth = Math.min(this.stats.minHealth, st.health);
    if (!ctx.player.alive) { this.idleAp(); return; }
    // the boss shots (entrance, defeat finisher) always win: hand the camera back the moment a boss dies
    if (ctx.enemies?.boss?.dying) this.yieldShot();
    this.pilot(dt, ctx);
    this.director(dt, ctx);
  },

  // end a running showcase shot (never a game shot) so that the game's own takeover can start
  yieldShot() {
    const c = this.ctx.cinema;
    if (c?.active && c.name.startsWith('showcase.')) c.cancel();
  },

  idleAp() {
    const ap = this._ap;
    ap.axis.x = ap.axis.y = 0; ap.fire = false; ap.boost = false; ap.brake = false;
  },

  // after the level: with loop=1 go on to the next level (or repeat the fixed one) once the result screen has shown for a while
  updateEnd(dt, ctx) {
    if (!this.ended || !this.loop) return;
    this._endT += dt;
    const ph = ctx.state.phase;
    if (ph === 'levelcomplete' && this._endT > 7.5) {
      this.ended = false;
      if (this.fixedLevel !== null) ctx.game.newRun({ level: this.fixedLevel });
      else ctx.events.emit('ui:nextLevel');
    } else if ((ph === 'victory' && this._endT > 11) || (ph === 'gameover' && this._endT > 3)) {
      this.ended = false;
      ctx.game.newRun({ level: this.fixedLevel ?? 0 });
    }
  },

  // ------------------------------------------------------------------ the pilot
  pilot(dt, ctx) {
    const p = ctx.player, st = ctx.state, ap = this._ap;
    const h = ctx.feel?.p?.handling || {};
    const boss = ctx.enemies?.boss ?? null;
    const fighting = !!(st.boss && boss && boss.mode === 'fight');
    const time = this.runT;
    const bnd = p.bounds(ctx);

    // what is ahead
    const tgt = this.pickTarget(ctx, fighting);
    const pk = this.pickPickup(ctx);

    // lane: a weave for composition, pulled toward the target (or a pickup), pushed off obstacles
    const wx = (6.4 * Math.sin(time * 0.43) + 2.6 * Math.sin(time * 1.07 + 1.3)) * (bnd.x / 14);
    const wy = (2.5 * Math.sin(time * 0.31 + 2.1) + 1.0 * Math.sin(time * 0.83)) * (bnd.y / 8);
    let dx = wx, dy = wy;
    if (pk) { dx = pk.x; dy = pk.y; }
    else if (tgt) {
      const k = fighting ? 0.92 : 0.5;
      dx = lerp(wx, tgt.rx, k); dy = lerp(wy, tgt.ry, k);
    }
    if (time < 4) { dx *= time / 4; dy *= time / 4; }   // the first seconds belong to the level intro camera: a calm line
    this.planLane(dt, ctx, dx, dy, bnd);
    const L = this._lane;
    const spX = h.speedX ?? ctx.config.player.speedX, spY = h.speedY ?? ctx.config.player.speedY;
    ap.axis.x = clamp((L.tx - p.localOffset.x) * 2.3 / spX, -1, 1);
    ap.axis.y = clamp((L.ty - p.localOffset.y) * 2.6 / spY, -1, 1);

    // aim
    let ax = 0, ay = 0;
    if (tgt) { ax = tgt.ax; ay = tgt.ay; }
    else { ax = 0.15 * Math.sin(time * 0.9); ay = 0.1 * Math.sin(time * 0.7 + 1); }
    this._aim.x = damp(this._aim.x, ax, 14, dt); this._aim.y = damp(this._aim.y, ay, 14, dt);
    ap.aim.x = this._aim.x; ap.aim.y = this._aim.y;

    this.doFire(dt, ctx, tgt, fighting);
    this.doBoost(dt, ctx);
    this.doRoll(dt, ctx);

    // bomb on a crowd
    this._bombCd -= dt;
    // no bombs while any shot runs or is about to (the blast flash is a big veil), and not around a boss defeat
    const cin = ctx.cinema;
    const shotBusy = !!(cin?.active || cin?.weight > 0.001 || cin?.intro?.on || cin?.moment?.on);
    if (this._bombCd <= 0 && st.bombs > 0 && !st.boss && !shotBusy) {
      let n = 0;
      for (const e of ctx.groups.enemies) {
        if (!e.alive || e.isBoss || e.type === 'part' || e.untargetable) continue;
        const d = p.position.z - e.position.z;
        if (d > 25 && d < 100 && Math.abs(e.position.x - p.position.x) < 40) n++;
      }
      if (n >= 6) { ap.bomb = true; this._bombCd = 14; this._bombT = this.runT; } else this._bombCd = 0.5;
    }
  },

  // best thing to shoot: the exposed boss part in a fight, else the enemy closest to the line of flight ahead
  pickTarget(ctx, fighting) {
    const p = ctx.player, pp = p.position;
    let best = null, bs = 1e9;
    const list = ctx.groups.enemies;
    for (let i = 0; i < list.length; i++) {
      const e = list[i];
      if (!e.alive || e.untargetable || e.lockable === false || e.noLock) continue;
      const dz = pp.z - e.position.z;
      if (dz < 14 || dz > 200) continue;
      let s = dz * 0.6 + Math.hypot(e.position.x - pp.x, e.position.y - pp.y) * 0.9;
      if (e.type === 'part') s -= fighting ? 1000 : 60;
      if (s < bs) { bs = s; best = e; }
    }
    if (!best) return null;
    const dz = pp.z - best.position.z;
    const v = best.velocity;
    const tf = dz / 230;
    const tx = best.position.x + (v ? v.x * tf * 0.5 : 0), ty = best.position.y + (v ? v.y * tf * 0.5 : 0);
    const bnd = p.bounds(ctx);
    return {
      e: best, dz,
      rx: clamp(tx - ctx.rail.position.x, -bnd.x + 1.5, bnd.x - 1.5), ry: clamp(ty - ctx.rail.position.y, -bnd.y + 1.2, bnd.y - 1.2),
      ax: clamp(((tx - pp.x) / dz) / 0.32, -1, 1), ay: clamp(((ty - pp.y) / dz) / 0.22, -1, 1),
    };
  },

  pickPickup(ctx) {
    const pp = ctx.player.position, st = ctx.state;
    let best = null, bd = 1e9;
    for (const k of ctx.groups.pickups) {
      if (!k.alive || k.collected) continue;
      const dz = pp.z - k.position.z;
      if (dz < 8 || dz > 60) continue;
      const ex = k.position.x - pp.x, ey = k.position.y - pp.y;
      if (Math.abs(ex) > 13 || Math.abs(ey) > 7) continue;
      const kind = k.kind ?? k.type ?? '';
      if (kind === 'repair' && st.health > 80) continue;
      const d = Math.hypot(ex, ey) + dz * 0.3;
      if (d < bd) { bd = d; best = k; }
    }
    if (!best) return null;
    return { x: best.position.x - ctx.rail.position.x, y: best.position.y - ctx.rail.position.y };
  },

  // lane planner: score a grid of lanes by obstacle hits along the path, distance to the wish and change of lane
  planLane(dt, ctx, wishX, wishY, bnd) {
    const L = this._lane, p = ctx.player, rail = ctx.rail;
    L.at -= dt;
    if (L.at > 0) return;
    L.at = 0.11;
    const obs = [];
    const pz = p.position.z;
    for (const o of ctx.groups.obstacles) {
      if (!o.alive || o.decor || o.active === false || !o.hitTest) continue;
      const dz = pz - o.position.z;
      if (dz < -12 || dz > 110 + (o.radius || 0)) continue;
      obs.push(o);
    }
    const ox = p.localOffset.x, oy = p.localOffset.y;
    const mx = bnd.x - 1.6, my = bnd.y - 1.3;
    const D = [7, 14, 22, 32, 44, 58, 74, 92];
    const slope = ctx.input?.boost ? 0.42 : 0.55;
    let bestC = 1e9, bx = L.tx, by = L.ty;
    for (let ix = -4; ix <= 4; ix++) {
      const cx = ix * mx / 4;
      for (let iy = -2; iy <= 2; iy++) {
        const cy = iy * my / 2;
        let cost = 0;
        if (obs.length) {
          const dxl = cx - ox, dyl = cy - oy, dl = Math.hypot(dxl, dyl) || 1;
          for (let k = 0; k < D.length; k++) {
            const dd = D[k];
            const tr = Math.min(dl, dd * slope) / dl;   // how far along the way to the lane the ship is by then
            _pt.set(rail.position.x + ox + dxl * tr, rail.position.y + oy + dyl * tr, pz - dd);
            for (let j = 0; j < obs.length; j++) {
              if (obs[j].hitTest(_pt, 2.7)) { cost += 130 - dd; break; }
            }
          }
        }
        cost += 0.55 * Math.hypot(cx - wishX, (cy - wishY) * 1.6);
        cost += 0.22 * Math.hypot(cx - L.tx, cy - L.ty);
        if (cost < bestC) { bestC = cost; bx = cx; by = cy; }
      }
    }
    L.tx = bx; L.ty = by;
    L.clear = bestC < 60;
  },

  // pulse bursts for single targets (a long hold would start a charge), charged volleys on groups and boss parts
  doFire(dt, ctx, tgt, fighting) {
    const p = ctx.player, ap = this._ap, F = this._fire;
    if (this.runT < 3 || !tgt) { ap.fire = false; F.hold = 0; F.off = 0; return; }
    if (F.off > 0) { F.off -= dt; ap.fire = false; F.hold = 0; return; }
    const groupN = p.hovered.length;
    if (fighting ? groupN >= 1 : groupN >= 3 || p.charging) {
      // hold to charge and lock, let go for the volley
      ap.fire = true; F.hold += dt;
      const enough = p.charging && p.locks.length >= Math.min(5, Math.max(1, groupN));
      if (enough || F.hold > 1.7 + (p.charging ? 0 : 0.3)) { ap.fire = false; F.off = 0.16; F.hold = 0; this.stats.volleys++; }
    } else {
      ap.fire = true; F.hold += dt;
      if (F.hold > 0.52) { ap.fire = false; F.off = 0.07; F.hold = 0; }
    }
  },

  // boost on clear straights, never through a wave or into the boss
  doBoost(dt, ctx) {
    const B = this._boost, ap = this._ap, st = ctx.state, pz = ctx.player.position.z;
    B.cd -= dt;
    let nearest = 999;
    for (const e of ctx.groups.enemies) {
      if (!e.alive || e.type === 'part') continue;
      const dz = pz - e.position.z;
      if (dz > -10 && dz < nearest) nearest = dz;
    }
    if (B.on) {
      B.t -= dt;
      if (B.t <= 0 || st.boost < 0.12 || nearest < 120 || !this._lane.clear || st.boss) { B.on = false; B.cd = 4.5 + this._r() * 3; }
    } else if (B.cd <= 0 && nearest > 150 && !st.boss && this._lane.clear && this.runT > 8 && st.boost > 0.72 && !ctx.cinema?.active) {
      B.on = true; B.t = 1.4 + this._r() * 1.2;
    }
    ap.boost = B.on;
  },

  // barrel roll at incoming fire (it deflects it), and one now and then for the picture
  doRoll(dt, ctx) {
    const R = this._roll, ap = this._ap, p = ctx.player;
    R.cd -= dt; R.decor -= dt;
    if (p.isRolling || p._rollCd > 0 || R.cd > 0) return;
    let hit = null;
    const shots = ctx.groups.enemyShots;
    for (let i = 0; i < shots.length; i++) {
      const s = shots[i];
      if (!s.alive || s.reflectable === false) continue;
      _v.subVectors(s.position, p.position);
      _w.subVectors(s.velocity, p.velocity);
      const vv = _w.lengthSq();
      if (vv < 1) continue;
      const tc = -_v.dot(_w) / vv;
      if (tc < 0.03 || tc > 0.5) continue;
      _cp.copy(_v).addScaledVector(_w, tc);
      if (_cp.length() < 4.2) { hit = s; break; }
    }
    if (hit) {
      // roll toward the middle of the lane so the side kick keeps the ship inside the field
      const dirLeft = p.localOffset.x > 4 ? true : p.localOffset.x < -4 ? false : hit.position.x > p.position.x;
      ap[dirLeft ? 'rollLeft' : 'rollRight'] = true;
      R.cd = 0.25; R.decor = Math.max(R.decor, 6);
    } else if (R.decor <= 0 && this.runT > 6 && !ctx.cinema?.active) {
      ap[p.localOffset.x > 0 ? 'rollLeft' : 'rollRight'] = true;
      R.decor = 10 + this._r() * 6; R.cd = 1.0;
    }
  },

  // ------------------------------------------------------------------ the director: extra camera shots
  director(dt, ctx) {
    const c = ctx.cinema;
    if (!c) return;
    this._shotCd -= dt;
    if (c.active || this._shotCd > 0 || this.runT < 8 || c.intro?.on || c.moment?.on) return;
    if (this.runT - this._bombT < 3) return;   // let a bomb blast finish before a shot starts
    const st = ctx.state, boss = ctx.enemies?.boss ?? null;
    if (boss && (boss.mode !== 'fight' || boss.dying)) return;
    if (boss && boss.hp < boss.maxHp * 0.3) return;   // leave the last seconds to the defeat finisher
    if (st.boss && boss) {
      // in the fight: an orbit once it has settled, then at each phase change and when the boss is half gone
      const ph = st.boss.phase, half = st.boss.hp < st.boss.maxHp * 0.5;
      const due = (this._bossShots === 0 && boss.modeT > 9) || (ph !== this._lastBossPhase && ph >= 2) || (half && this._bossShots < 2);
      this._lastBossPhase = ph;
      if (due && this._bossShots < 3 && c.play('showcase.orbit', { free: true, data: { side: this._side } })) {
        this._bossShots++; this._side = -this._side; this._shotCd = 14;
      }
      return;
    }
    if (st.boss || ctx.world?.bossStarted) return;
    const info = ctx.world?.levelInfo || {};
    const dist = ctx.rail.distance || 0;
    const mm = momentDef(ctx.world?.theme);
    if (mm && dist > mm.at - 300 && dist < mm.at + 120 + mm.dur * 45) return;   // the signature moment owns this stretch
    const prog = dist / Math.max(1, info.bossAt || 6000);
    if (this._sched < SCHEDULE.length && prog >= SCHEDULE[this._sched][0]) {
      if (prog > SCHEDULE[this._sched][0] + 0.12) { this._sched++; return; }   // missed the window (a fight was on): skip it
      if (this.calmEnough(ctx) && c.play(SCHEDULE[this._sched][1], { free: true, data: { side: this._side } })) {
        this._sched++; this._side = -this._side; this._shotCd = 10;
      } else this._shotCd = 1;
    }
  },

  // no extra shot while the ship is being shot at from close range
  calmEnough(ctx) {
    const p = ctx.player;
    if (p.isRolling) return false;
    for (const s of ctx.groups.enemyShots) if (s.alive && Math.abs(s.position.z - p.position.z) < 40) return false;
    return true;
  },

  // ------------------------------------------------------------------ camera shots
  // keep a camera position out of walls: pull it toward the chase position until no obstacle touches it
  clearOfWalls(ctx, pos, from) {
    const obs = ctx.groups.obstacles;
    for (let k = 0; k < 5; k++) {
      let hit = false;
      for (let i = 0; i < obs.length; i++) {
        const o = obs[i];
        if (!o.alive || o.decor || !o.hitTest) continue;
        if (Math.abs(o.position.z - pos.z) > (o.radius || 10) + 3) continue;
        if (o.hitTest(pos, 2.2)) { hit = true; break; }
      }
      if (!hit) return;
      pos.lerp(from, 0.3);
    }
  },

  registerShots() {
    const ctx = this.ctx, self = this;
    if (!ctx.cinema?.register) return;
    // Every shot writes a wished camera and look point in world space; finish() turns that into the pose the director gets:
    //  - it starts and ends on the live chase camera (smooth envelope over the first and last third of the shot)
    //  - camera and look point are filtered as offsets from the ship (critically damped springs), so the ship's own travel does not lag
    //  - the camera never comes closer than MIN_SHIP to the ship, and is pulled out of walls before the filter
    //  - the view direction turns at most MAX_TURN degrees per frame at 60 Hz, whatever the wish does (no snaps)
    const MIN_SHIP = 10.5, MAX_TURN = 2.2, OMEGA = 5.5;
    const F = { init: false, lastT: 0, p: new THREE.Vector3(), l: new THREE.Vector3(), pv: new THREE.Vector3(), lv: new THREE.Vector3(), dir: new THREE.Vector3(), fov: 60, roll: 0 };
    const _dp = new THREE.Vector3(), _dl = new THREE.Vector3(), _cr = new THREE.Vector3(), _nd = new THREE.Vector3();
    const spring = (x, v, target, dt) => {
      const n = Math.max(1, Math.ceil(dt * 120)), h = dt / n;
      for (let i = 0; i < n; i++) {
        for (const k of ['x', 'y', 'z']) { v[k] += (OMEGA * OMEGA * (target[k] - x[k]) - 2 * OMEGA * v[k]) * h; x[k] += v[k] * h; }
      }
    };
    const finish = (u, t, pos, look, fov, roll, out, ch, latFast = false) => {
      const c = ctx, sp = c.player.position;
      const e = shotEnv(u, 0.36, 0.36);
      const dt = F.init ? clamp(t - F.lastT, 0, 0.05) : 0;
      // wished pose: designed pose blended with the chase camera by the envelope
      _dp.lerpVectors(ch.pos, pos, e);
      if (latFast) {   // sideways and height come in early, so the camera passes the ship from a wide berth
        const el = shotEnv(u, 0.16, 0.36);
        _dp.x = lerp(ch.pos.x, pos.x, el); _dp.y = lerp(ch.pos.y, pos.y, el);
      }
      _dl.lerpVectors(ch.look, look, e);
      self.clearOfWalls(ctx, _dp, ch.pos);
      _dp.sub(sp); _dl.sub(sp); _cr.copy(ch.pos).sub(sp);
      if (_dp.length() < MIN_SHIP) _dp.setLength(MIN_SHIP);
      if (t <= 1e-4 || !F.init) {
        F.init = true; F.p.copy(_cr); F.l.copy(ch.look).sub(sp); F.pv.set(0, 0, 0); F.lv.set(0, 0, 0);
        F.dir.copy(F.l).sub(F.p).normalize(); F.fov = ch.fov; F.roll = 0; F.lastT = t;
      }
      if (dt > 0) {
        spring(F.p, F.pv, _dp, dt); spring(F.l, F.lv, _dl, dt);
        F.fov += (lerp(ch.fov, fov, e) - F.fov) * (1 - Math.exp(-6 * dt));
        F.roll += (roll * e - F.roll) * (1 - Math.exp(-6 * dt));
        F.lastT = t;
        if (F.p.length() < MIN_SHIP) F.p.setLength(MIN_SHIP);
        // turn rate limit on the view direction
        _nd.copy(F.l).sub(F.p);
        const len = Math.max(1, _nd.length());
        _nd.divideScalar(len);
        const ang = Math.acos(clamp(_nd.dot(F.dir), -1, 1));
        const maxA = MAX_TURN * Math.PI / 180 * (dt * 60);
        if (ang > maxA) { _nd.lerpVectors(F.dir, _nd, maxA / ang).normalize(); }
        F.dir.copy(_nd);
        F.l.copy(F.p).addScaledVector(F.dir, len);
      }
      out.pos.copy(F.p).add(sp);
      out.look.copy(F.l).add(sp);
      out.fov = F.fov;
      out.roll = F.roll;
    };
    const reg = (name, duration, fn) => ctx.cinema.register(name, {
      duration, letterbox: 0, hideHud: false, lockInput: false, invulnerable: false, blendIn: 0.3, blendOut: 0.3,
      onStart() { F.init = false; },
      pose(u, t, c, out, data) {
        const sd = data?.side >= 0 ? 1 : -1;
        const ch = chasePose(c);
        if (t <= 1e-4) F.init = false;
        fn(u, t, c, out, ch, sd);
      },
    });

    // drone: a camera in front of and beside the ship that circles round to the back, looking at the ship
    reg('showcase.drone', 5.2, (u, t, c, out, ch, side) => {
      const p = c.player.position, e = smooth01(u);
      const a = lerp(0.55, 2.75, e);
      const r = 14.5 - 2.5 * Math.sin(Math.PI * u);
      _v.set(p.x + side * Math.sin(a) * r, p.y + 1.6 + 2.0 * Math.sin(Math.PI * u), p.z - Math.cos(a) * r);
      _w.set(p.x, p.y + 0.5, p.z - 1.5 - 2 * u);
      finish(u, t, _v, _w, lerp(52, 60, e), side * 0.05 * Math.sin(Math.PI * u), out, ch);
    });

    // flyby: starts far ahead beside the lane, the ship comes up to it, passes, and the camera falls in behind
    reg('showcase.flyby', 6.4, (u, t, c, out, ch, side) => {
      const p = c.player.position, e = smooth01(u);
      _v.set(p.x + side * lerp(16, 12, e), p.y + lerp(3.0, 4.2, e), p.z + lerp(-32, 14, e));
      _w.set(p.x, p.y + 0.4, p.z - 2 * (1 - e));
      finish(u, t, _v, _w, lerp(46, 62, e), 0, out, ch, true);
    });

    // lowsweep: a low camera skimming beside the ship, from behind to ahead of it, rising into the chase
    reg('showcase.lowsweep', 6.0, (u, t, c, out, ch, side) => {
      const p = c.player.position, e = smooth01(u);
      const info = c.world?.levelInfo || {};
      let y = p.y - lerp(3.6, 1.6, e);
      if (Number.isFinite(info.floorY)) y = Math.max(y, info.floorY + 2.4);
      _v.set(p.x + side * lerp(12.5, 11, e), y, p.z + lerp(15, -9, e));
      _w.set(p.x, p.y + 0.3, p.z - 3 - 5 * u);
      finish(u, t, _v, _w, lerp(58, 50, e), -side * 0.06 * Math.sin(Math.PI * u), out, ch, true);
    });

    // wide: pull up and back into a high three quarter view that takes in the level ahead, then settle
    reg('showcase.wide', 5.0, (u, t, c, out, ch, side) => {
      const p = c.player.position, e = smooth01(Math.sin(Math.PI * clamp(u, 0, 1)));
      _v.set(p.x + side * 11 * e, p.y + 3.4 + 6 * e, p.z + 12.5 + 12 * e);
      _w.set(p.x * 0.7, p.y + 0.8 + 2.4 * e, p.z - 26 - 14 * e);
      finish(u, t, _v, _w, 68 + 12 * e, side * 0.03 * e, out, ch);
    });

    // orbit: circle the fight with the ship and the boss in frame, from behind one side to behind the other
    reg('showcase.orbit', 6.4, (u, t, c, out, ch, side) => {
      const p = c.player.position, e = smooth01(u);
      const b = c.enemies?.boss;
      const bp = b && b.alive ? b.position : _w.set(p.x, p.y, p.z - 110);
      const cx = lerp(p.x, bp.x, 0.55), cy = lerp(p.y, bp.y, 0.55), cz = lerp(p.z, bp.z, 0.55);
      const span = Math.max(40, Math.abs(p.z - bp.z));
      const a = lerp(-0.62, 0.62, e) * side;
      const r = span * 0.82;
      _v.set(cx + Math.sin(a) * r, cy + 5 + span * 0.12 + 5 * Math.sin(Math.PI * u), cz + Math.cos(a) * r);
      _w.set(cx, cy + 1, cz - span * 0.06);
      finish(u, t, _v, _w, lerp(56, 46, e), -a * 0.06, out, ch);
    });
  },

  // ------------------------------------------------------------------ page furniture
  injectStyle() {
    const css = [];
    if (!this.hud) css.push('.hud,.comm,.comm-strip{display:none!important}');
    // the director's letterbox bars are drawn above the HUD by default; in showcase mode the HUD sits on top of them
    else if (this.bars) css.push('.ui .hud,.ui .comm,.ui .comm-strip{z-index:15}');
    if (!css.length) return;
    const s = document.createElement('style');
    s.id = 'showcase-style';
    s.textContent = css.join('\n');
    document.head.appendChild(s);
  },
};

export default showcase;
