// Dart: fast kamikaze. Drifts and locks on (glowing nose telegraph), then dives at the player with a trail.
import * as THREE from 'three';
import { Enemy } from '../enemy.js';
import { G, MAT, part, sym, merged, mesh, flameGeo, beamMat, glowSprite } from '../models.js';
import { leadDir, diff } from '../aim.js';

const PI2 = Math.PI / 2;
const _d = new THREE.Vector3(), _c = new THREE.Vector3(), _q = new THREE.Quaternion();

export class Dart extends Enemy {
  static def = { scale: 1.45, hp: 1, radius: 1.3, points: 50, damage: 12, contactDamage: 0 };

  build() {
    const b = this.body;
    mesh(merged('dartHull', [
      part(G.cone(0.6, 4.2, 4), 0, 0, 0.6, PI2, 0, Math.PI / 4),
      ...sym(part(G.box(1.5, 0.08, 1.4), 0.9, 0, -1.0, 0, 0.9, 0)),
      ...sym(part(G.box(0.08, 0.7, 0.9), 0.35, 0.35, -1.3, 0, 0, 0.5)),
    ]), MAT.red, b);
    mesh(merged('dartFrame', [...sym(part(G.box(1.2, 0.12, 0.3), 0.9, 0, -0.5, 0, 0.9, 0)), part(G.box(0.3, 0.3, 1.4), 0, 0, -0.9)]), MAT.darkRed, b);
    mesh(merged('dartGlow', [part(G.oct(0.36), 0, 0, -1.5, 0, 0, 0, 1, 1, 1.6), ...sym(part(G.box(0.05, 0.05, 1.3), 0.9, 0.05, -0.9, 0, 0.9, 0))]), MAT.redGlow, b);
    this.lockGlow = this.makeGlow(0xff3a2a, 4.5, b, 0, 0, 2.6);
    this.trail = mesh(flameGeo, beamMat(0xff6a2a), b); this.trail.scale.set(1.1, 1.1, 0.01); this.trail.position.z = -1.6;
    this.trail2 = mesh(flameGeo, beamMat(0xffe0a0), b); this.trail2.scale.set(0.5, 0.5, 0.01); this.trail2.position.z = -1.6;
    this.railRel = false;
  }

  onSpawn() {
    this.state = 'seek'; this.lockT = 0; this.diveT = 0;
    this.speed = 80; this.lockTime = 1.0;
    this.vel.set(0, 0, -this.ctx.rail.speed * 0.95);
  }

  think(dt, ctx) {
    const p = ctx.player.position, r = ctx.rail;
    if (this.state === 'seek') {
      const far = this.position.z < p.z - 200;      // still far away: just close in, do not start the lock yet
      if (!far) this.lockT += dt;
      // slide onto the player's lane while matching the rail
      const k = Math.min(1, dt * 2.2);
      this.vel.x += ((p.x - this.position.x) * 1.4 - this.vel.x) * k;
      this.vel.y += ((p.y - this.position.y) * 1.4 - this.vel.y) * k;
      this.vel.z += ((-r.speed + (far ? 70 : 10)) - this.vel.z) * k;
      this.setGlow(this.lockGlow, Math.min(1, this.lockT / this.lockTime), 30);
      this.trail.scale.z = 2 + this.lockT * 2;
      if (this.lockT >= this.lockTime && this.position.z < p.z - 30) {
        this.state = 'dive'; this.setGlow(this.lockGlow, 0);
        ctx.audio?.sfx?.('whoosh', { position: this.position });
        ctx.fx?.fireFlare?.(this.position, 0xff3a2a, 1.8);   // the dive commits: flash at the nose
        this.vel.copy(leadDir(ctx, this.position, this.speed, 0.015, 0.5, _d)).multiplyScalar(this.speed);
      }
    } else {
      this.diveT += dt;
      // limited homing for the first part of the dive, then commit
      if (this.diveT < 1.4) {
        _d.subVectors(p, this.position); const dist = _d.length();
        if (dist > 22) {
          _d.divideScalar(dist);
          _c.copy(this.vel).normalize();
          _c.lerp(_d, Math.min(1, dt * 1.3)).normalize();
          this.vel.copy(_c).multiplyScalar(this.speed);
        }
      }
      this.trail.scale.z = 9 + Math.sin(this.age * 60) * 1.2; this.trail2.scale.z = 6;
      // impact
      const rr = this.radius + ctx.player.radius * 0.8;
      if (this.sweepDist2(ctx, dt) < rr * rr) return this.impact(ctx);
      if (this.position.z > p.z + 40) this.destroy();
    }
  }

  impact(ctx) {
    ctx.fx?.explosion?.(this.position, { scale: 1.6, color: 0xff5522 });
    ctx.fx?.sparks?.(this.position, null, 14);
    if (!ctx.player.invulnerable) ctx.player.takeDamage?.(this.damage * diff(ctx).enemyDamage, this);
    this.destroy();
  }

  late(dt) {
    if (this.vel.lengthSq() > 4) this.faceDir(_d.copy(this.vel), dt, this.state === 'dive' ? 14 : 5);
    this.body.rotation.z += dt * (this.state === 'dive' ? 9 : 2);
  }
}
