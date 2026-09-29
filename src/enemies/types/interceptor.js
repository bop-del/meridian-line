// Interceptor: fast pursuit fighter. Spawned behind the rail it overtakes the player, then engages: shadows the player's
// lane, weaves, makes short sideways thrust bursts and fires telegraphed aimed pairs. Breaks off after ~9 s.
import * as THREE from 'three';
import { Enemy } from '../enemy.js';
import { G, MAT, part, sym, merged, mesh, glowSprite, wingPair } from '../models.js';

const PI2 = Math.PI / 2;

export class Interceptor extends Enemy {
  static def = { scale: 1.3, hp: 5.5, radius: 1.9, points: 250, damage: 7, contactDamage: 12 };

  build() {
    const b = this.body;
    mesh(merged('inHull', [
      part(G.box(0.9, 0.6, 4.2)),
      part(G.cone(0.42, 3.0, 5), 0, 0, 3.4, PI2),
      ...wingPair(2.6, 0.9, 3.4, 1.1, 0.14, 0.4, 0, -1.2, -0.12),               // forward swept
      ...sym(part(G.box(0.1, 1.6, 1.0), 3.8, 0.2, -0.3, 0, 0, 0)),               // wingtip blades
      ...sym(part(G.box(0.1, 0.9, 1.0), 0.5, 0.55, -1.8, 0, 0, -0.5)),
      ...sym(part(G.cyl(0.3, 0.4, 1.2, 6), 0.65, -0.1, -2.4, PI2)),
    ]), MAT.purple, b);
    mesh(merged('inTrim', [...wingPair(1.3, 0.5, 3.0, 0.9, 0.05, 0.6, 0.09, -1.15, -0.12), part(G.box(0.3, 0.2, 2.0), 0, 0.32, 0.4)]), MAT.orange, b);
    mesh(merged('inGlow', [part(G.oct(0.36), 0, 0.36, 0.8, 0, 0, 0, 0.8, 0.6, 1.7), ...sym(part(G.box(0.14, 0.14, 0.8), 3.8, 0.2, 0.2, 0, 0, 0))]), MAT.cyan, b);
    this.engines = [-1, 1].map((s) => glowSprite(0xff8a3a, 2.2, b, s * 0.65, -0.1, -3.1));
    this.gunGlow = [-1, 1].map((s) => this.makeGlow(0xffb030, 2.8, b, s * 3.8, 0.2, 0.7));
  }

  onSpawn(opts) {
    const r = this.rel;
    this.side = r.x !== 0 ? Math.sign(r.x) : (Math.random() < 0.5 ? -1 : 1);
    this.state = r.z > 0 ? 'overtake' : 'engage';
    this.stateT = 0; this.ph = Math.random() * 6.28;
    this.engageZ = -(44 + Math.random() * 8);
    this.sx = r.x; this.sy = r.y; this.sz = r.z;
    this.thrustT = -1; this.thrustCd = 1.8 + Math.random(); this.dashX = 0;
    this.burst = 0; this.charge = 0; this.fireCd = 1.4; this.engageTime = opts.engageTime ?? 9;
    this.leaving = false; this.ex = 0;
    if (this.state === 'overtake') { r.x = this.side * 24; r.y = Math.max(-4, Math.min(6, r.y)); this.sx = r.x; this.sy = r.y; }
  }

  think(dt, ctx) {
    const r = this.rel; this.stateT += dt;
    const pl = ctx.player.position, rl = ctx.rail.position;
    const px = pl.x - rl.x, py = pl.y - rl.y;
    if (this.state === 'overtake') {
      r.z += 105 * -1 * dt; // fly from behind to ahead (rel z decreasing)
      r.x = this.side * 24; r.y = this.sy + Math.sin(this.stateT * 3) * 1.5;
      if (r.z < this.engageZ + 6) this.go('engage');
      return;
    }
    if (this.state === 'engage') {
      const k = Math.min(1, dt * 2.4);
      // shadow the player's lane with a weave
      const tx = px * 0.85 + Math.sin(this.age * 1.5 + this.ph) * 10 + this.dashX;
      const ty = py * 0.7 + Math.sin(this.age * 2.1 + this.ph) * 3.5;
      r.x += (tx - r.x) * k; r.y += (ty - r.y) * k;
      const targetZ = this.engageZ + Math.min(14, this.stateT * 1.6); // creeps closer
      r.z += Math.max(-95, Math.min(95, (targetZ - r.z) * 3)) * dt;
      // sideways thrust burst: a quick lateral shove with a hard bank into it
      this.thrustCd -= dt; this.dashX *= Math.max(0, 1 - dt * 2.5);
      if (this.thrustT < 0 && this.thrustCd <= 0) { this.thrustT = 0; this.dashX = (Math.random() < 0.5 ? -1 : 1) * 9; this.thrustCd = 2.2 + Math.random() * 1.2; }
      if (this.thrustT >= 0) { this.thrustT += dt; this.body.rotation.z += (-Math.sign(this.dashX) * 0.9 - this.body.rotation.z) * Math.min(1, dt * 9); if (this.thrustT > 0.5) this.thrustT = -1; }
      // telegraphed fire
      if (this.charge > 0) {
        this.charge -= dt; const v = 1 - Math.max(0, this.charge) / 0.5;
        for (const g of this.gunGlow) this.setGlow(g, v, 26);
        if (this.charge <= 0) { for (const g of this.gunGlow) this.setGlow(g, 0); this.burst = 2; this.fireCd = 0; }
      } else if (this.burst > 0) {
        if (this.fireCd <= 0) {
          const s = this.burst-- & 1 ? 1 : -1;
          this.shootAt(this.muzzle(s * 3.8, 0.2, 1.7), 70, 0.04, { color: 0xffb030, radius: 0.65 });
          this.fireCd = 0.18;
        }
      } else if (this.fireCd <= 0 && this.stateT > 1.0 && this.stateT < this.engageTime - 0.8) { this.charge = 0.5; this.fireCd = 2.0 * this.fireScale; }
      if (this.stateT > this.engageTime) this.go('break');
    } else { // break off: zoom away ahead and up
      this.ex += dt; r.z -= (40 + this.ex * 90) * dt; r.y += 8 * dt; r.x += this.side * 10 * dt;
    }
  }
  go(s) { this.state = s; this.stateT = 0; }

  late(dt) {
    if (this.state === 'overtake') this.faceDir(_fwd.set(this.side * -0.15, 0, -1), dt, 8); // nose forward (away) while overtaking
    else this.faceMotion(dt, 45, 7);
    for (const e of this.engines) e.scale.setScalar(2.2 + Math.sin(this.age * 38) * 0.25);
  }
}
const _fwd = new THREE.Vector3();
