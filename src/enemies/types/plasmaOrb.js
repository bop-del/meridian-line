// Plasma orb: slow arcing ball dropped by bombers. Big, shootable, harmful on contact.
import * as THREE from 'three';
import { Enemy } from '../enemy.js';
import { G, MAT, part, merged, mesh, glowSprite } from '../models.js';
import { diff } from '../aim.js';
import { ORB_GRAVITY } from './bomber.js';

export class PlasmaOrb extends Enemy {
  static def = { hp: 1.2, radius: 2.1, points: 30, damage: 16, contactDamage: 0, explColor: 0xd04dff, debrisColor: 0xd04dff };

  build() {
    this.railRel = false;
    const b = this.body;
    this.core = mesh(G.ico(1.25, 1), MAT.purpleGlow, b);
    this.shell = mesh(G.ico(1.8, 0), new THREE.MeshBasicMaterial({ color: 0xc040ff, wireframe: true, transparent: true, opacity: 0.55, fog: false }), b);
    this.shell.material.userData.noFlash = true;
    this.halo = glowSprite(0xc040ff, 7.5, b);
    glowSprite(0xffffff, 3.0, b);
  }
  onSpawn() { this.life = 8; }

  think(dt, ctx) {
    this.life -= dt;
    this.vel.y -= ORB_GRAVITY * dt;
    this.core.rotation.x += dt * 2; this.core.rotation.y += dt * 3; this.shell.rotation.y -= dt * 1.5; this.shell.rotation.z += dt;
    const s = 1 + Math.sin(this.age * 9) * 0.08; this.halo.scale.setScalar(7.5 * s);
    const p = ctx.player.position, rr = this.radius + ctx.player.radius * 0.8;
    if (this.sweepDist2(ctx, dt) < rr * rr) {
      ctx.fx?.explosion?.(this.position, { scale: 2, color: 0xd04dff });
      if (!ctx.player.invulnerable) ctx.player.takeDamage?.(this.damage * diff(ctx).enemyDamage, this);
      this.destroy();
    } else if (this.life <= 0 || this.position.z > p.z + 30 || this.position.y < p.y - 90) this.destroy();
  }
}
