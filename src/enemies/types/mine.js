// Mine: floating spiked mine. Drifts and bobs. Arms (fast red flashing) when the player approaches, then detonates
// on proximity. Its blast hurts the player and chains into neighbouring mines and enemies.
import * as THREE from 'three';
import { Enemy } from '../enemy.js';
import { G, MAT, part, merged, mesh, glowSprite } from '../models.js';
import { diff } from '../aim.js';

const PI2 = Math.PI / 2;
const SPIKES = (() => {
  const g = new THREE.IcosahedronGeometry(1, 0), a = g.attributes.position, seen = new Set(), out = [];
  for (let i = 0; i < a.count; i++) {
    const k = `${a.getX(i).toFixed(3)},${a.getY(i).toFixed(3)},${a.getZ(i).toFixed(3)}`;
    if (!seen.has(k)) { seen.add(k); out.push(new THREE.Vector3(a.getX(i), a.getY(i), a.getZ(i)).normalize()); }
  }
  g.dispose(); return out;
})();
const _q = new THREE.Quaternion(), _e = new THREE.Euler(), UP = new THREE.Vector3(0, 1, 0);

export const BLAST_RADIUS = 11, TRIGGER_RADIUS = 6.5, ARM_RADIUS = 26;

export class Mine extends Enemy {
  static def = { scale: 1.3, hp: 1.4, radius: 2.3, points: 40, damage: 16, contactDamage: 0, explColor: 0xff4422 };

  build() {
    this.railRel = false;
    const b = this.body;
    this.spin = new THREE.Group(); b.add(this.spin);
    mesh(G.ico(1.5, 0), MAT.darkRed, this.spin);
    const parts = [], tips = [];
    for (const d of SPIKES) {
      _q.setFromUnitVectors(UP, d);
      _e.setFromQuaternion(_q);
      parts.push(part(G.cone(0.32, 1.6, 5), d.x * 2.0, d.y * 2.0, d.z * 2.0, _e.x, _e.y, _e.z));
      tips.push(part(G.oct(0.2), d.x * 2.85, d.y * 2.85, d.z * 2.85));
    }
    mesh(merged('mineSpikes', parts), MAT.steel, this.spin);
    mesh(merged('mineTips', tips), MAT.yellow, this.spin);
    this.eye = mesh(G.sph(0.85, 10, 8), MAT.redGlow, this.spin);
    this.halo = glowSprite(0xff2a1a, 6, b);
    this.halo.visible = false;
  }

  onSpawn(opts) {
    this.vel.set((Math.random() - 0.5) * 1.6, 0, 0); this.baseY = this.position.y; this.ph = Math.random() * 6.28;
    this.armed = false; this.fuse = -1; this.trig = -1;
    this.spin.rotation.set(Math.random() * 3, Math.random() * 3, 0);
  }

  /** Called by another mine's blast: detonate after a short delay. */
  trigger(delay = 0.15) { if (this.trig < 0 && this.alive) this.trig = delay; }

  think(dt, ctx) {
    this.spin.rotation.y += dt * 0.9; this.spin.rotation.x += dt * 0.4;
    this.position.y = this.baseY + Math.sin(this.age * 1.3 + this.ph) * 0.9; this.vel.y = 0;
    const p = ctx.player.position;
    const dx = p.x - this.position.x, dy = p.y - this.position.y, dz = p.z - this.position.z;
    const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (this.trig >= 0) { this.trig -= dt; if (this.trig <= 0) return this.die(ctx); }
    if (!this.armed && d < ARM_RADIUS && dz > -4) { this.armed = true; ctx.audio?.sfx?.('alarm', { position: this.position, volume: 0.5, pitch: 1.6 }); }
    // eye telegraph: slow pulse idle, frantic when armed
    const rate = this.armed ? 26 : 3.5;
    this.eye.scale.setScalar(1 + Math.sin(this.age * rate) * (this.armed ? 0.32 : 0.1));
    this.halo.visible = this.armed; if (this.armed) this.halo.scale.setScalar(6 + Math.sin(this.age * 26) * 1.6);
    if (this.armed && (d < TRIGGER_RADIUS + ctx.player.radius || dz < -1 && d > TRIGGER_RADIUS && this.wasClose)) { this.blast(ctx); this.destroy(); return; }
    if (this.armed && d < TRIGGER_RADIUS + 5) this.wasClose = true;
    if (this.position.z > p.z + 20) this.destroy(); // passed
  }

  onDeath(ctx) { this.blast(ctx); }

  blast(ctx) {
    const pos = this.position, d = diff(ctx);
    ctx.fx?.explosion?.(pos, { scale: 3.4, color: 0xff5522, big: true });
    ctx.fx?.shockwave?.(pos, { radius: BLAST_RADIUS, color: 0xff6633 });
    ctx.fx?.shake?.(0.75, 0.45, 'blast');
    ctx.audio?.sfx?.('bigExplosion', { position: pos });
    const p = ctx.player.position;
    if (p.distanceTo(pos) < BLAST_RADIUS && !ctx.player.invulnerable) ctx.player.takeDamage?.(this.damage * d.enemyDamage, this);
    for (const e of ctx.groups.enemies) {
      if (e === this || !e.alive) continue;
      const dd = e.position.distanceTo(pos);
      if (dd > BLAST_RADIUS + (e.radius ?? 0) * 0.5) continue;
      if (e.type === 'mine') e.trigger(0.12 + dd * 0.012);
      else if (e.type !== 'part' && !e.isBoss) e.takeDamage(6, this, ctx);
    }
  }

  late() {}
}
