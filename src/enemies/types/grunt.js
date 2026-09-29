// Grunt: red delta fighter. Swoops in, strafes while firing telegraphed pairs of shots, then peels away.
import * as THREE from 'three';
import { Enemy } from '../enemy.js';
import { G, MAT, part, sym, merged, mesh, glowSprite, wingPair } from '../models.js';
import { swoop, approachTime, T_HOLD } from '../paths.js';
import { leadDir } from '../aim.js';

const PI2 = Math.PI / 2;

export function gruntHullGeo() {
  return merged('gruntHull', [
    part(G.box(1.1, 0.7, 3.4)),
    part(G.cone(0.55, 2.4, 5), 0, 0, 2.8, PI2),
    ...wingPair(2.6, 0.9, 3.4, -1.5, 0.18, 0.4, -0.08, -0.3, 0.06),
    ...sym(part(G.box(0.1, 1.1, 0.9), 3.7, 0.5, -1.9, 0, 0, 0.2)), // wingtip fins
    ...sym(part(G.cyl(0.34, 0.42, 1.5, 6), 0.85, -0.05, -1.75, PI2)),  // engine pods
    part(G.box(0.12, 0.9, 1.0), 0, 0.6, -1.5),
  ]);
}
const accentGeo = () => merged('gruntAccent', [
  ...sym(part(G.cyl(0.27, 0.27, 0.1, 6), 0.85, -0.05, -2.5, PI2)),
]);
const canopyGeo = () => merged('gruntCanopy', [part(G.oct(0.42), 0, 0.42, 0.55, 0, 0, 0, 0.8, 0.6, 1.6)]);
const stripeGeo = () => merged('gruntStripe', [...wingPair(1.0, 0.4, 2.6, -1.1, 0.06, 0.8, 0.1, -0.5, 0.06), part(G.box(0.5, 0.18, 1.6), 0, 0.4, -0.2)]);

export class Grunt extends Enemy {
  static def = { scale: 1.3, hp: 2.2, radius: 1.9, points: 100, damage: 7, contactDamage: 10 };

  build() {
    const b = this.body;
    mesh(gruntHullGeo(), MAT.red, b);
    mesh(stripeGeo(), MAT.darkRed, b);
    mesh(accentGeo(), MAT.orangeGlow, b);
    mesh(canopyGeo(), MAT.yellow, b);
    this.engine = glowSprite(0xff7a2a, 1.9, b, 0, 0, -2.7);
    this.muzzleGlow = this.makeGlow(0xff5a2a, 4.2, b, 0, 0, 2.6);
  }

  onSpawn(opts) {
    const r = this.rel;
    const dir = opts.dir ?? (Math.random() < 0.5 ? -1 : 1);
    this.shotsLeft = opts.shots ?? 2;
    this.charging = 0;
    this.A = opts.A ?? 2.4;
    if (!this.path) {
      const o = {
        x0: r.x, y0: r.y, z0: r.z,
        xc: opts.xc ?? THREE.MathUtils.clamp(r.x * 0.5, -12, 12), yc: opts.yc ?? THREE.MathUtils.clamp(r.y * 0.5 + 1, -4, 5),
        zh: opts.zh ?? -(50 + Math.random() * 12), dir, up: Math.random() < 0.6 ? 1 : -0.5,
        amp: 5 + Math.random() * 6, ph: Math.random() * 6.28, bulge: (Math.random() - 0.5) * 30,
      };
      o.A = this.A = approachTime(o.z0, o.zh);
      this.path = (t, out) => swoop(t, out, o);
    }
    this.fireCd = this.A + 0.5 + Math.random() * 0.3;
    if (opts.rel || opts.position) this.path(0, this.rel);
  }

  think(dt, ctx) {
    this.path(this.age, this.rel, this);
    const t = this.age;
    const inWindow = t > this.A + 0.3 && t < this.A + T_HOLD - 0.3 && this.shotsLeft > 0;
    if (this.charging > 0) {
      this.charging -= dt;
      this.setGlow(this.muzzleGlow, 1 - Math.max(0, this.charging) / 0.5, 22);
      if (this.charging <= 0) {
        this.setGlow(this.muzzleGlow, 0);
        const m = this.muzzle(0, 0, 3.2);
        this.shootAt(m, 64, 0.05, { color: 0xff6a2a });
        this.shotsLeft--; this.fireCd = 1.0 * this.fireScale;
      }
    } else if (inWindow && this.fireCd <= 0) this.charging = 0.5;
  }

  late(dt) {
    this.faceMotion(dt);
    this.engine.scale.setScalar(1.8 + Math.sin(this.age * 40) * 0.2);
  }
}
