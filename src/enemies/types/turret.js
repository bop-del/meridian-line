// Turret: static in the world (ground or tower). Tracks the player, charges (orange glow), fires slow shells.
// opts.tower = height of a support pylon under the base (0 for ground mounted).
import * as THREE from 'three';
import { Enemy } from '../enemy.js';
import { G, MAT, part, sym, merged, mesh } from '../models.js';

const PI2 = Math.PI / 2;

export class Turret extends Enemy {
  static def = { scale: 1.3, hp: 4.5, radius: 2.3, points: 150, damage: 8, contactDamage: 14 };

  build(opts) {
    this.railRel = false;
    const b = this.body;
    const tower = opts.tower ?? 0;
    mesh(merged('tuBase', [
      part(G.cyl(2.6, 3.2, 1.0, 8), 0, 0.5, 0),
      part(G.cyl(1.7, 2.1, 0.8, 8), 0, 1.3, 0),
      ...sym(part(G.box(0.5, 1.6, 0.5), 2.3, 0.9, 0, 0, 0, 0.3)),
    ]), MAT.dark, b);
    mesh(merged('tuRing', [part(G.tor(1.9, 0.12, 6, 16), 0, 1.72, 0, PI2)]), MAT.orangeGlow, b);
    if (tower > 0) {
      const t = new THREE.Group(); b.add(t);
      const stem = mesh(G.cyl(1.2, 1.9, tower, 6), MAT.steel, t); stem.position.y = -tower / 2;
      const cap = mesh(G.cyl(2.7, 1.5, 0.8, 8), MAT.dark, t); cap.position.y = -0.3;
    }
    this.yaw = new THREE.Group(); this.yaw.position.y = 1.9; b.add(this.yaw);
    mesh(merged('tuHead', [
      part(G.box(2.4, 1.3, 2.2), 0, 0.5, 0), part(G.oct(1.15), 0, 1.0, -0.2, 0, 0.4, 0, 1.2, 0.6, 1.2),
      ...sym(part(G.box(0.4, 1.0, 1.6), 1.35, 0.5, -0.3, 0, 0, 0.25)),
    ]), MAT.purple, this.yaw);
    this.pitch = new THREE.Group(); this.pitch.position.set(0, 0.6, 0.8); this.yaw.add(this.pitch);
    mesh(merged('tuBarrels', [...sym(part(G.cyl(0.24, 0.3, 3.0, 6), 0.55, 0, 1.5, PI2)), part(G.box(1.8, 0.8, 0.8), 0, 0, 0)]), MAT.steel, this.pitch);
    this.lens = mesh(merged('tuLens', [part(G.sph(0.32, 8, 6), 0, 1.15, 0.9)]), MAT.redGlow, this.yaw);
    this.tips = [-1, 1].map((s) => this.makeGlow(0xff8a1f, 3.6, this.pitch, s * 0.55, 0, 3.1));
    this.aimOffset.set(0, 2.6, 0);
  }

  onSpawn(opts) {
    this.vel.set(0, 0, 0);
    this.charge = 0; this.fireCd = 1.2 + Math.random() * 1.2; this.barrel = 0;
    this.range = opts.range ?? 190;
    this.yawA = Math.PI; // starts pointing at the player side
  }

  think(dt, ctx) {
    const p = ctx.player.position, s = this.position;
    const dx = p.x - s.x, dy = p.y - (s.y + 2.6), dz = p.z - s.z;
    const horiz = Math.hypot(dx, dz);
    const tYaw = Math.atan2(dx, dz), tPitch = -Math.atan2(dy, Math.max(4, horiz));
    const k = Math.min(1, dt * 4);
    let dyaw = tYaw - this.yaw.rotation.y; dyaw = Math.atan2(Math.sin(dyaw), Math.cos(dyaw));
    this.yaw.rotation.y += dyaw * k;
    this.pitch.rotation.x += (THREE.MathUtils.clamp(tPitch, -1.1, 0.25) - this.pitch.rotation.x) * k;
    const inRange = dz < -30 && horiz < this.range; // player still in front of it
    if (this.charge > 0) {
      this.charge -= dt;
      const v = 1 - Math.max(0, this.charge) / 0.85;
      for (const t of this.tips) this.setGlow(t, v, 24);
      this.lens.scale.setScalar(1 + v * 0.9);
      if (this.charge <= 0) {
        for (const t of this.tips) this.setGlow(t, 0);
        this.lens.scale.setScalar(1);
        const m = this.muzzle(0, 0, 0); // pitch-aware barrel tip
        this.pitch.localToWorld(m.set((this.barrel++ & 1) ? 0.55 : -0.55, 0, 3.2));
        this.shootAt(m, 40, 0.035, { radius: 1.0, color: 0xff7a1a, damage: 8, leadK: 0.9, cap: 30 });
        this.fireCd = 2.5 * this.fireScale;
      }
    } else if (inRange && this.fireCd <= 0) this.charge = 0.85;
    if (!inRange && this.charge > 0) this.charge = 0;
  }
}
