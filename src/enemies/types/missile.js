// Homing missile: shootable, limited turn rate so a good pilot can dodge it. Used by carriers and bosses.
import * as THREE from 'three';
import { Enemy } from '../enemy.js';
import { G, MAT, part, sym, merged, mesh, glowSprite, flameGeo, beamMat } from '../models.js';
import { diff } from '../aim.js';

const PI2 = Math.PI / 2;
const _d = new THREE.Vector3(), _c = new THREE.Vector3();

export class Missile extends Enemy {
  static def = { scale: 1.4, hp: 1, radius: 1.5, points: 20, damage: 12, contactDamage: 0, explColor: 0xff9933 };

  build() {
    this.railRel = false; this.faceRate = 10;
    const b = this.body;
    mesh(merged('miBody', [
      part(G.cyl(0.32, 0.32, 2.2, 6), 0, 0, 0, PI2),
      part(G.cone(0.32, 0.9, 6), 0, 0, 1.55, PI2),
      ...[0, 1, 2, 3].map((i) => part(G.box(0.05, 0.75, 0.6), Math.cos(i * PI2) * 0.4, Math.sin(i * PI2) * 0.4, -0.9, 0, 0, i * PI2)),
    ]), MAT.steel, b);
    mesh(merged('miBand', [part(G.cyl(0.34, 0.34, 0.35, 6), 0, 0, 0.5, PI2)]), MAT.redGlow, b);
    this.flame = mesh(flameGeo, beamMat(0xffa040), b); this.flame.position.z = -1.1; this.flame.scale.set(1.3, 1.3, 3);
    this.halo = glowSprite(0xff6a2a, 3.0, b, 0, 0, -1.2);
  }

  onSpawn(opts) {
    this.speed = opts.speed ?? 46; this.turn = opts.turn ?? 1.25 / Math.sqrt(diff(this.ctx).enemyFireRate);
    this.life = opts.life ?? 6.5; this.homing = opts.homing ?? true;
    if (this.vel.lengthSq() < 1) this.vel.set(0, 0, 1);
    this.launchT = opts.launchT ?? 0.35; // brief straight boost so the launch reads
    this.vel.setLength(this.speed * 0.7);
  }

  think(dt, ctx) {
    this.life -= dt;
    const p = ctx.player.position;
    if (this.homing && this.age > this.launchT) {
      _d.copy(p).sub(this.position); const dist = _d.length();
      if (dist > 9) { // stops steering when nearly on top of the player (dodge window)
        _d.divideScalar(dist); _c.copy(this.vel).normalize();
        const ang = _c.angleTo(_d), step = Math.min(ang, this.turn * dt);
        if (ang > 1e-3) _c.lerp(_d, step / ang).normalize();
        this.vel.copy(_c).multiplyScalar(Math.min(this.speed, this.vel.length() + 60 * dt));
      }
    }
    this.flame.scale.z = 2.6 + Math.sin(this.age * 50) * 0.5;
    const rr = this.radius * 0.7 + ctx.player.radius * 0.8;
    if (this.sweepDist2(ctx, dt) < rr * rr) {
      ctx.fx?.explosion?.(this.position, { scale: 1.6, color: 0xff8833 });
      if (!ctx.player.invulnerable) ctx.player.takeDamage?.(this.damage * diff(ctx).enemyDamage, this);
      this.destroy();
    } else if (this.life <= 0) { ctx.fx?.explosion?.(this.position, { scale: 1.0 }); this.destroy(); }
    else if (this.position.z > p.z + 25) this.destroy();
  }

  late(dt) { if (this.vel.lengthSq() > 1) this.faceDir(_d.copy(this.vel), dt, 12); }
}
