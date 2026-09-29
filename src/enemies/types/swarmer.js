// Swarmer: small, weak, fast, erratic. Flies as a flock through the player's lane (see spawnFormation('swarm')).
// Each member orbits a shared leader path with its own fast noise. Fires the odd small fast shot.
import * as THREE from 'three';
import { Enemy } from '../enemy.js';
import { G, MAT, part, sym, merged, mesh, glowSprite, wingPair } from '../models.js';

const PI2 = Math.PI / 2;
const _l = new THREE.Vector3();

export class Swarmer extends Enemy {
  static def = { scale: 1.6, hp: 0.9, radius: 1.0, points: 30, damage: 4, contactDamage: 5 };

  build() {
    const b = this.body;
    mesh(merged('swHull', [
      part(G.oct(0.55), 0, 0, 0.2, 0, 0, 0, 0.8, 0.6, 1.9),
      ...wingPair(1.1, 0.35, 1.7, -0.9, 0.09, 0.3, 0, -0.2, 0.3),
    ]), MAT.purple, b);
    mesh(merged('swEye', [part(G.oct(0.24), 0, 0.1, 0.8)]), MAT.yellow, b);
    mesh(merged('swTail', [part(G.box(0.08, 0.5, 0.5), 0, 0.3, -0.7)]), MAT.orangeGlow, b);
    this.engine = glowSprite(0xff9a3a, 1.2, b, 0, 0, -1.1);
    this.muzzleGlow = this.makeGlow(0xffd23a, 2.2, b, 0, 0, 1.2);
  }

  onSpawn(opts) {
    const R = () => Math.random();
    this.ph = [R() * 6.28, R() * 6.28, R() * 6.28]; this.fq = [3 + R() * 2.2, 3.6 + R() * 2.2, 2.6 + R() * 2];
    this.spread = opts.spread ?? 5.5;
    this.origin = opts.origin ?? this.rel.clone();
    // leader path: rail-relative approach, weave, pass through
    this.lead = opts.lead ?? ((t, out) => {
      out.set(this.origin.x + Math.sin(t * 0.9) * 10, this.origin.y + Math.sin(t * 1.3) * 3, this.origin.z + Math.min(t, 6) * 34 + Math.max(0, t - 6) * 60);
      return out;
    });
    this.charge = 0; this.shots = R() < 0.4 ? 1 : 0;
    this.fireAt = 2.4 + R() * 1.2;
  }

  think(dt, ctx) {
    const t = this.age, s = this.spread * Math.min(1, t / 1.2);
    this.lead(t, _l);
    this.rel.set(
      _l.x + Math.sin(t * this.fq[0] + this.ph[0]) * s,
      _l.y + Math.sin(t * this.fq[1] + this.ph[1]) * s * 0.7,
      _l.z + Math.sin(t * this.fq[2] + this.ph[2]) * s * 1.2);
    if (this.shots > 0 && t > this.fireAt) {
      this.charge += dt; this.setGlow(this.muzzleGlow, Math.min(1, this.charge / 0.45), 30);
      if (this.charge > 0.45) {
        this.setGlow(this.muzzleGlow, 0); this.shots--; this.charge = 0;
        this.shootAt(this.muzzle(0, 0, 1.4), 82, 0.06, { radius: 0.5, damage: 4, color: 0xffd23a });
      }
    }
  }

  late(dt) {
    this.faceMotion(dt, 26, 9);
    this.engine.scale.setScalar(1.2 + Math.sin(this.age * 45 + this.ph[0]) * 0.25);
  }
}
