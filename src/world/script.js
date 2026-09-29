// Level script runner: a timeline keyed on rail.distance plus a small toolbox (S) the level files script with.
import * as THREE from 'three';
import { Rng } from './util.js';

const LOOKAHEAD = 700; // static things (obstacles, cell lanes, pads) are created this far before the player reaches them
const SPAWN_AHEAD = 330; // enemy waves appear this far ahead of the rail

export class ScriptRunner {
  constructor() { this.clear(); }
  clear() { this.runCleanups(); this.events = []; this.streams = []; this.timers = []; this.cursor = 0; this.lastDist = 0; this.sorted = true; }
  /** cleanups run when the script rewinds or is cleared (event listeners armed by scripted triggers) */
  cleanup(fn) { (this.cleanups ??= []).push(fn); }
  runCleanups() { const c = this.cleanups; this.cleanups = []; for (const fn of c ?? []) { try { fn(); } catch { /* ignore */ } } }
  add(dist, fn, label = '') { this.events.push({ dist, fn, label }); this.sorted = false; }
  stream(from, to, step, fn, lookahead = LOOKAHEAD) { this.streams.push({ next: from, to, step, fn, lookahead, from }); }
  after(seconds, fn) { this.timers.push({ t: seconds, fn }); }
  rewind() {
    this.runCleanups();
    this.cursor = 0; this.timers.length = 0; this.lastDist = 0;
    for (const s of this.streams) s.next = s.from;
  }
  update(dt, ctx) {
    if (!this.sorted) { this.events.sort((a, b) => a.dist - b.dist); this.sorted = true; }
    const d = ctx.rail.distance;
    if (d + 1 < this.lastDist) this.rewind();
    this.lastDist = d;
    // timers
    for (let i = this.timers.length - 1; i >= 0; i--) {
      const t = this.timers[i];
      t.t -= dt;
      if (t.t <= 0) { this.timers.splice(i, 1); this.safe(t.fn, ctx); }
    }
    while (this.cursor < this.events.length && this.events[this.cursor].dist <= d) {
      const e = this.events[this.cursor++];
      this.safe(e.fn, ctx, e.label);
    }
    for (let i = 0; i < this.streams.length; i++) {
      const s = this.streams[i];
      let guard = 0;
      while (s.next <= s.to && s.next - s.lookahead <= d && guard++ < 8) { const at = s.next; s.next += s.step; this.safe(() => s.fn(at), ctx); }
    }
  }
  safe(fn, ctx, label) {
    try { fn(ctx); } catch (err) { if (!this._warned) { this._warned = true; console.warn('[world script]', label, err); } }
  }
}

/**
 * Builds the scripting toolbox. Distances are rail distance units (1 s is about 40 units at base speed).
 * Static things (obstacles, cell lanes, pickups) are specified by the distance at which the PLAYER reaches them.
 * Waves (enemies, formations) are specified by the distance at which they SPAWN (they appear SPAWN_AHEAD ahead).
 */
export function createScriptAPI(W, runner) {
  const ctx = W.ctx;
  const rng = new Rng(1234);
  const diff = () => ctx.config?.difficulty?.[ctx.state?.difficulty] ?? { enemyCount: 1 };
  const railZ = () => ctx.rail.position.z;
  const S = {
    rng, runner, LOOKAHEAD, SPAWN_AHEAD,
    /** scale an enemy count by difficulty */
    n(k) { return Math.max(1, Math.round(k * (diff().enemyCount ?? 1))); },
    at(dist, fn) { runner.add(dist, fn); },
    after(sec, fn) { runner.after(sec, fn); },
    stream(from, to, step, fn) { runner.stream(from, to, step, fn); },

    // ------------- comms and UI
    comm(dist, speaker, text, duration = 3.6) { runner.add(dist, () => ctx.ui?.comm?.({ speaker, text, duration })); },
    /** a chain of lines: [[speaker, text, delaySeconds?, duration?], ...] starting at dist */
    talk(dist, lines) {
      runner.add(dist, () => {
        let t = 0;
        lines.forEach(([speaker, text, gap = 3.9, duration = 3.6], i) => {
          if (i === 0) ctx.ui?.comm?.({ speaker, text, duration });
          else runner.after(t, () => ctx.ui?.comm?.({ speaker, text, duration }));
          t += gap;
        });
      });
    },
    /** a control prompt on the HUD (ctx.ui.hint), never spoken by a character */
    hint(dist, text, duration = 4) { runner.add(dist, () => ctx.ui?.hint?.(text, duration)); },
    banner(dist, text, sub) { runner.add(dist, () => ctx.ui?.banner?.(text, sub)); },
    warn(dist, text) { runner.add(dist, () => { ctx.ui?.warning?.(text); ctx.events.emit('warning', { text }); ctx.audio?.sfx?.('warning'); }); },

    // ------------- enemies
    ahead(dz = SPAWN_AHEAD, x = 0, y = 0) { return new THREE.Vector3(x, y, railZ() - dz); },
    enemy(dist, type, x = 0, y = 0, opts = {}) {
      runner.add(dist, () => S.spawn(type, x, y, opts));
    },
    spawn(type, x = 0, y = 0, opts = {}) {
      const before = ctx.enemies?.list?.length ?? 0;
      const position = new THREE.Vector3(x, y, railZ() - (opts.ahead ?? SPAWN_AHEAD));
      const r = ctx.enemies?.spawn?.(type, { ...opts, position });
      return r ?? (ctx.enemies?.list && ctx.enemies.list.length > before ? ctx.enemies.list[ctx.enemies.list.length - 1] : null);
    },
    wave(dist, name, x = 0, y = 0, opts = {}) {
      runner.add(dist, () => S.formation(name, x, y, opts));
    },
    formation(name, x = 0, y = 0, opts = {}) {
      const o = { ...opts }; // the enemy module already scales formation counts by difficulty
      const origin = new THREE.Vector3(x, y, railZ() - (o.ahead ?? SPAWN_AHEAD));
      return ctx.enemies?.spawnFormation?.(name, origin, o);
    },
    /** turret emplacements on a decorative pad */
    turretPad(dist, x, y, opts = {}) {
      const z = -dist;
      runner.add(dist - LOOKAHEAD, () => W.spawnDecor('pad', new THREE.Vector3(x, 0, z), { h: y - W.floorY - 1.5, r: opts.r ?? 4.5 }));
      runner.add(dist - 460, () => ctx.enemies?.spawn?.('turret', { position: new THREE.Vector3(x, y, z), ...(opts.turret ?? {}) }));
    },
    /** a Dominion landing barge on the water (decor) with turrets on its gun pedestals: towers = [[x, z, height], ...] */
    barge(dist, x, opts = {}) {
      const z = -dist, hh = opts.h ?? 10, rot = opts.rot ?? 0;
      const towers = opts.towers ?? [[-3.6, -9, hh], [3.6, 7, hh]];
      runner.add(dist - LOOKAHEAD, () => W.spawnDecor('barge', new THREE.Vector3(x, 0, z), { towers, rot }));
      const c = Math.cos(rot), sn = Math.sin(rot);
      for (const [tx, tz, th] of towers) {
        const pos = new THREE.Vector3(x + tx * c + tz * sn, W.floorY + 3.5 + th + 1.7, z - tx * sn + tz * c);
        runner.add(dist - 460, () => ctx.enemies?.spawn?.('turret', { position: pos.clone(), ...(opts.turret ?? {}) }));
      }
    },
    /** an escort gets a tail at a fixed distance: spawn an enemy near the rail and tell the ally system */
    chase(dist, wingman, opts = {}) {
      runner.add(dist, () => S.tail(wingman, opts));
    },
    /** spawn the tail enemy now and start the escort timer (opts.time seconds) */
    tail(wingman, opts = {}) {
      const e = S.spawn(opts.type ?? 'grunt', opts.x ?? (wingman === 'vex' ? -14 : 14), opts.y ?? 4, { ahead: opts.ahead ?? 120, ...opts.enemy });
      ctx.allies?.chaseMe?.(wingman, e, { ...(opts.time ? { time: opts.time } : {}), ...(opts.trouble ? { kind: ({ pinned: "gate", cutoff: "barrier" }[opts.trouble] || opts.trouble) } : {}) });
      if (opts.note) runner.after(opts.noteDelay ?? 2.4, () => ctx.ui?.comm?.({ speaker: opts.note[0], text: opts.note[1], duration: 3.0 }));
      return e;
    },
    /**
     * escort trouble with a scripted TRIGGER, so the beats do not all fire the same way:
     *   'dist'  at `at`
     *   'cells' armed at `arm`, fires when the player completes a shield cell chain (or at `giveUp`)
     *   'kills' armed at `arm`, fires after `kills` enemies are downed (or at `giveUp`)
     *   'roll'  armed at `arm`, fires on the player's next barrel roll (or at `giveUp`)
     */
    escort(wingman, { trigger = 'dist', at = 0, arm = at, kills = 5, giveUp = arm + 320, ...opts } = {}) {
      if (trigger === 'dist') { runner.add(at, () => S.tail(wingman, opts)); return; }
      const evt = { cells: 'cell:set', kills: 'enemy:killed', roll: 'player:roll' }[trigger];
      const st = { done: true, off: null, n: 0 };
      const fire = () => { if (st.done) return; st.done = true; st.off?.(); st.off = null; S.tail(wingman, opts); };
      runner.add(arm, () => {
        st.done = false; st.n = 0;
        st.off = ctx.events.on(evt, () => { if (trigger !== 'kills' || ++st.n >= kills) fire(); });
        runner.cleanup(() => { st.done = true; st.off?.(); st.off = null; });
      });
      runner.add(giveUp, fire);
    },
    wingmen(dist, names = ['vex', 'ferro', 'pip']) { runner.add(dist, () => ctx.allies?.spawnWingmen?.(names)); },

    // ------------- world things (dist is where the player reaches them)
    obstacle(dist, type, x = 0, y = 0, opts = {}) {
      runner.add(dist - LOOKAHEAD, () => W.spawnObstacle(type, new THREE.Vector3(x, y, -dist), opts));
    },
    decor(dist, type, x = 0, y = 0, opts = {}) {
      runner.add(dist - LOOKAHEAD - 300, () => W.spawnDecor(type, new THREE.Vector3(x, y, -dist), opts));
    },
    /** shield cells (or a capacitor) along a slipstream lane; chains of 4 */
    cells(dist, kind, x, y, count = 4, shape = 'line') {
      runner.add(dist - LOOKAHEAD, () => W.spawnCells(kind, new THREE.Vector3(x, y, -dist), count, shape, { raw: true }));
    },
    pickup(dist, kind, x, y, opts) {
      runner.add(dist - LOOKAHEAD, () => W.spawnPickup(kind, new THREE.Vector3(x, y, -dist), { raw: true, ...opts }));
    },

    // ------------- boss and finish
    boss(dist, name, { warning = 'LARGE CONTACT', lines = [] } = {}) {
      runner.add(dist - 240, () => { ctx.ui?.warning?.(warning); ctx.events.emit('warning', { text: warning }); ctx.audio?.sfx?.('alarm'); ctx.ui?.banner?.('BOSS APPROACHING', W.info?.name?.toUpperCase?.()); });
      lines.forEach(([speaker, text], i) => runner.add(dist - 200 + i * 130, () => ctx.ui?.comm?.({ speaker, text, duration: 3.8 })));
      runner.add(dist, () => W.startBoss(name));
    },
  };
  return S;
}
