// Sphere based collision between the shared entity groups, plus score and combo bookkeeping.
// Everything is defensive: empty or stubbed groups, entities without takeDamage and so on are fine.
//   playerShots vs enemies / obstacles (and shootable enemy shots)
//   enemyShots  vs player (deflected while rolling) / allies / obstacles
//   enemies, obstacles vs player (ram damage)
//   player vs pickups (collect)
// Obstacles with `collider === 'box'` use `hitTest(pos, radius)`. Any entity may provide hitTest.
import * as THREE from 'three';
import { config } from '../config.js';

const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _n = new THREE.Vector3();

// Squared distance from point p to segment a-b (closest approach of a moving shot).
function segDistSq(a, b, p) {
  _a.subVectors(b, a);
  const l2 = _a.lengthSq();
  let t = 0;
  if (l2 > 1e-8) { t = _b.subVectors(p, a).dot(_a) / l2; t = t < 0 ? 0 : t > 1 ? 1 : t; }
  _b.copy(a).addScaledVector(_a, t);
  return _b.distanceToSquared(p);
}

function hitsEntity(shot, e) {
  if (e.hitTest && (e.collider === 'box' || e.useHitTest)) return !!e.hitTest(shot.position, shot.radius);
  const r = (e.radius || 1) + shot.radius;
  return segDistSq(shot.prev, shot.position, e.position) <= r * r;
}

export const collision = {
  ctx: null,
  pickupFlag: false,
  cellFlag: false,

  init(ctx) {
    this.ctx = ctx;
    ctx.events.on('pickup:collected', () => { this.pickupFlag = true; });
    ctx.events.on('cell:collected', () => { this.cellFlag = true; });
    ctx.events.on('enemy:killed', (p) => this.awardKill(p));
  },

  reset(ctx) {
    ctx.state.comboTimer = 0; ctx.state.combo = 0; ctx.state.multiplier = 1;
  },

  awardKill(p = {}) {
    const ctx = this.ctx, st = ctx.state, c = config.combo;
    st.kills++; st.hits++;
    st.combo++;
    st.comboTimer = c.window;
    st.multiplier = 1 + Math.min(c.maxMultiplier - 1, Math.floor((st.combo - 1) / c.step));
    const base = p.points ?? 100;
    const gain = Math.round(base * st.multiplier);
    st.score += gain;
    ctx.events.emit('score:add', { points: gain, base, multiplier: st.multiplier, position: p.position, enemy: p.enemy });
  },

  update(dt, ctx) {
    const st = ctx.state;
    if (st.comboTimer > 0) {
      st.comboTimer -= dt;
      if (st.comboTimer <= 0) { st.comboTimer = 0; st.combo = 0; st.multiplier = 1; }
    }
    const g = ctx.groups;
    const player = ctx.player;
    this.playerShots(g, ctx);
    this.enemyShots(g, ctx, player);
    if (player.alive) {
      this.rams(g, ctx, player);
      this.pickups(g, ctx, player);
    }
  },

  playerShots(g, ctx) {
    const shots = g.playerShots;
    for (let i = 0; i < shots.length; i++) {
      const s = shots[i];
      if (!s.alive) continue;
      // enemies
      let hit = false;
      for (let j = 0; j < g.enemies.length; j++) {
        const e = g.enemies[j];
        if (!e.alive || e.untargetable) continue;
        if (!hitsEntity(s, e)) continue;
        const dmg = s.damage;
        e.takeDamage?.(dmg, s.kind === 'homing' ? 'homing' : 'player', ctx, { position: s.position, shot: s });
        ctx.events.emit('enemy:hit', { enemy: e, position: s.position, damage: dmg, shot: s, homing: s.kind === 'homing' });
        ctx.audio?.sfx?.('hit', { position: s.position });
        if (!s.pierce) { s.alive = false; hit = true; break; }
      }
      if (hit) continue;
      // shootable enemy projectiles (missiles)
      const es = g.enemyShots;
      for (let j = 0; j < es.length; j++) {
        const e = es[j];
        if (!e.alive || !e.shootable) continue;
        const r = e.radius + s.radius;
        if (segDistSq(s.prev, s.position, e.position) <= r * r) {
          e.takeDamage(s.damage);
          ctx.fx?.hitSpark?.(s.position);
          if (!e.alive) { ctx.fx?.explosion?.(e.position, { scale: 0.6, color: 0xffaa33 }); ctx.events.emit('shot:destroyed', { shot: e }); }
          s.alive = false; hit = true; break;
        }
      }
      if (hit) continue;
      // obstacles absorb shots, some can be damaged
      for (let j = 0; j < g.obstacles.length; j++) {
        const o = g.obstacles[j];
        if (!o.alive || o.collidesShots === false || o.passShots) continue;
        if (!hitsEntity(s, o)) continue;
        o.takeDamage?.(s.damage, 'player', ctx, { position: s.position, shot: s });
        ctx.events.emit('enemy:hit', { enemy: o, position: s.position, damage: s.damage, shot: s, obstacle: true });
        ctx.fx?.hitSpark?.(s.position);
        s.alive = false;
        break;
      }
    }
  },

  enemyShots(g, ctx, player) {
    const shots = g.enemyShots;
    const hr = player.hitRadius ?? player.radius;
    for (let i = shots.length - 1; i >= 0; i--) {
      const s = shots[i];
      if (!s.alive) continue;
      // player
      if (player.alive) {
        const r = hr + s.radius;
        if (segDistSq(s.prev, s.position, player.position) <= r * r) {
          if (player.isRolling && s.reflectable !== false && ctx.projectiles.reflect(s, ctx)) {
            ctx.fx?.sparks?.(s.position, undefined, 10);
            ctx.fx?.hitSpark?.(s.position);
            ctx.audio?.sfx?.('hit', { pitch: 1.6 });
            ctx.events.emit('shot:reflected', { shot: s });
            player.onReflect?.(s);
            continue;
          }
          if (player.invulnerable) { ctx.fx?.sparks?.(s.position, undefined, 4); s.alive = false; continue; }
          player.takeDamage(s.damage, s);
          ctx.fx?.hitSpark?.(s.position);
          s.alive = false;
          continue;
        }
      }
      // allies
      let dead = false;
      for (let j = 0; j < g.allies.length; j++) {
        const a = g.allies[j];
        if (!a.alive) continue;
        const r = (a.radius || 1.5) + s.radius;
        if (segDistSq(s.prev, s.position, a.position) <= r * r) {
          a.takeDamage?.(s.damage, 'enemy', ctx);
          ctx.fx?.hitSpark?.(s.position);
          s.alive = false; dead = true; break;
        }
      }
      if (dead) continue;
      // solid obstacles eat enemy fire too
      for (let j = 0; j < g.obstacles.length; j++) {
        const o = g.obstacles[j];
        if (!o.alive || o.collidesShots === false || o.passShots || o.blocksEnemyShots === false) continue;
        const blocks = o.collider === 'box' ? o.hitTest?.(s.position, s.radius) : (o.blocksShots && s.position.distanceToSquared(o.position) < ((o.radius || 1) + s.radius) ** 2);
        if (blocks) {
          s.alive = false; ctx.fx?.sparks?.(s.position, undefined, 4); break;
        }
      }
    }
  },

  rams(g, ctx, player) {
    const now = ctx.projectiles.time;
    const hr = player.hitRadius ?? player.radius;
    // enemies
    for (let i = 0; i < g.enemies.length; i++) {
      const e = g.enemies[i];
      if (!e.alive || e.harmless) continue;
      const contact = e.ramDamage ?? e.contactDamage ?? 14;
      if (contact <= 0) continue;     // mines, orbs, boss parts and the like handle their own contact
      let hit;
      if (e.hitTest && e.useHitTest) hit = !!e.hitTest(player.position, hr);
      else { const r = (e.radius || 1) + hr; hit = e.position.distanceToSquared(player.position) < r * r; }
      if (!hit) continue;
      if (e._ramT !== undefined && now - e._ramT < 0.5) continue;
      e._ramT = now;
      const diff = config.difficulty[ctx.state.difficulty] ?? config.difficulty.normal;
      const dmg = contact * diff.enemyDamage;
      _n.subVectors(player.position, e.position); _n.z = 0;
      if (_n.lengthSq() < 1e-4) _n.set(Math.random() - 0.5, 0.2, 0);
      _n.normalize();
      if (player.isRolling) {
        e.takeDamage?.(2, 'roll', ctx, { position: player.position });
        ctx.events.emit('enemy:hit', { enemy: e, position: player.position, damage: 2, source: 'roll' });
        ctx.fx?.hitSpark?.(player.position);
      } else if (!player.invulnerable && !ctx.state.god) {
        if (player.takeDamage(dmg, e) !== false) {
          player.knock?.(_n, 18);
          e.takeDamage?.(e.ramSelfDamage ?? 3, 'ram', ctx, { position: player.position });
        }
      } else if (!ctx.state.god) {
        // invulnerable: still shove
        player.knock?.(_n, 6);
      }
    }
    // obstacles
    for (let i = 0; i < g.obstacles.length; i++) {
      const o = g.obstacles[i];
      if (!o.alive || o.harmless || o.passable) continue;
      let hit = false;
      if (o.collider === 'box' && o.hitTest) hit = !!o.hitTest(player.position, hr);
      else if (o.collider !== 'none') { const r = (o.radius || 1) + hr; hit = o.position.distanceToSquared(player.position) < r * r; }
      if (!hit) continue;
      if (o.damage === 0) continue;
      _n.subVectors(player.position, o.position); _n.z = 0;
      if (_n.lengthSq() < 1e-4) _n.set(0, 1, 0);
      _n.normalize();
      if (player.isRolling && o.rollSafe) continue;
      if (player.invulnerable || ctx.state.god) { player.knock?.(_n, 8); continue; }
      if (player.takeDamage(o.damage ?? 20, o) !== false) {
        player.knock?.(_n, 22);
        o.onPlayerHit?.(ctx);
      }
    }
  },

  pickups(g, ctx, player) {
    const arr = g.pickups;
    for (let i = 0; i < arr.length; i++) {
      const p = arr[i];
      if (!p.alive) continue;
      const r = (p.radius || 1) + player.radius + 0.8;
      if (p.position.distanceToSquared(player.position) > r * r) continue;
      this.pickupFlag = false; this.cellFlag = false;
      if (typeof p.collect === 'function') p.collect(ctx);
      else { player.collectPickup?.(p.kind); p.alive = false; }
      if (p.alive) { if (p.destroy) p.destroy(ctx); else p.alive = false; }
      if (!this.pickupFlag) ctx.events.emit('pickup:collected', { kind: p.kind, position: p.position });
      if ((p.kind === 'shieldCell' || p.kind === 'capacitor') && !this.cellFlag) ctx.events.emit('cell:collected', { kind: p.kind });
    }
  },
};
