// Asteroid drone: hides in a rocky shell (only a faint red eye betrays it), then wakes (shell splits, eye flares:
// telegraph) and dashes out across the player's lane firing two shots.
import * as THREE from 'three';
import { Enemy } from '../enemy.js';
import { G, MAT, part, sym, merged, mesh, glowSprite } from '../models.js';
import { playerVel } from '../aim.js';

const PI2 = Math.PI / 2;
const _v = new THREE.Vector3(), _pv = new THREE.Vector3();

export class AsteroidDrone extends Enemy {
  static def = { scale: 1.5, hp: 2, radius: 1.7, points: 60, damage: 7, contactDamage: 9 };

  build() {
    this.railRel = false;
    const b = this.body;
    // drone core (hidden inside)
    this.drone = new THREE.Group(); b.add(this.drone);
    mesh(merged('adCore', [
      part(G.oct(0.9), 0, 0, 0, 0, 0, 0, 1, 0.7, 1.5),
      ...sym(part(G.box(1.8, 0.08, 0.9), 1.2, 0, -0.4, 0, 0.6, 0)),
      part(G.cone(0.35, 1.2, 5), 0, 0, 1.8, PI2),
    ]), MAT.red, this.drone);
    this.eye = mesh(G.oct(0.36), MAT.yellow, this.drone); this.eye.position.z = 0.9; this.eye.scale.set(1, 1, 1.4);
    this.engine = glowSprite(0xff8a3a, 2.4, this.drone, 0, 0, -1.5); this.engine.visible = false;
    this.muzzleGlow = this.makeGlow(0xff5a2a, 3.6, this.drone, 0, 0, 2.3);
    // rock shell: two halves that split apart
    this.shellA = mesh(merged('adShellA', [part(G.ico(1.9, 1), 0, 0.5, 0, 0, 0, 0, 1.1, 0.7, 1.0), part(G.ico(0.9, 0), 1.2, 1.0, 0.6)]), MAT.dark, b);
    this.shellB = mesh(merged('adShellB', [part(G.ico(1.9, 1), 0, -0.5, 0, 0, 0.6, 0, 1.1, 0.7, 1.0), part(G.ico(0.8, 0), -1.1, -1.0, -0.5)]), MAT.dark, b);
    this.halo = glowSprite(0xff3a2a, 2.2, b, 0, 0, 1.2);
  }

  onSpawn(opts) {
    this.state = 'dormant'; this.stateT = 0; this.wakeDist = opts.wakeDist ?? 105;
    this.vel.set(0, 0, 0); this.spin = (Math.random() - 0.5) * 0.5;
    this.group.rotation.set(Math.random() * 6, Math.random() * 6, 0); this.dashRot = null;
    this.shots = 2; this.eye.scale.setScalar(0.4);
  }

  think(dt, ctx) {
    this.stateT += dt;
    const p = ctx.player.position;
    if (this.state === 'dormant') {
      this.group.rotation.y += this.spin * dt;
      const blink = 0.35 + Math.max(0, Math.sin(this.age * 1.7)) * 0.6;
      this.halo.scale.setScalar(0.9 + blink); this.eye.scale.setScalar(0.35 + blink * 0.1);
      if (this.position.z - p.z > -this.wakeDist && this.position.z < p.z - 20) this.go('wake');
    } else if (this.state === 'wake') {
      const k = Math.min(1, this.stateT / 0.8);
      const e = k * k * (3 - 2 * k);
      this.shellA.position.set(0.6 * e, 2.6 * e, 0); this.shellB.position.set(-0.6 * e, -2.6 * e, 0);
      this.shellA.rotation.z = 0.5 * e; this.shellB.rotation.z = -0.5 * e;
      this.halo.scale.setScalar(2.2 + e * 5 + Math.sin(this.age * 30) * 0.4); this.eye.scale.setScalar(1 + e * 0.8);
      this.setGlow(this.muzzleGlow, e, 28);
      if (k >= 1) {
        this.go('dash'); this.setGlow(this.muzzleGlow, 0);
        // dash on a chord across the player's lane; arrives slightly to the side so shots do the work
        playerVel(ctx, _pv);
        const T = 1.35, side = this.position.x > p.x ? 1 : -1;
        _v.set(p.x + side * 7 + _pv.x * 0.3 * T, p.y + 1 + _pv.y * 0.3 * T, p.z + _pv.z * T).sub(this.position).divideScalar(T);
        this.vel.copy(_v);
        this.engine.visible = true; this.halo.scale.setScalar(2.0);
        ctx.audio?.sfx?.('whoosh', { position: this.position });
      }
    } else {
      this.halo.scale.setScalar(1.6);
      this.engine.scale.setScalar(2.4 + Math.sin(this.age * 40) * 0.3);
      if (this.shots > 0 && this.stateT > 0.32 + (2 - this.shots) * 0.28) {
        this.shots--;
        this.shootAt(this.muzzle(0, 0, 2.4), 72, 0.05, { color: 0xff5a2a, radius: 0.6 });
      }
      if (this.stateT > 1.6) this.vel.multiplyScalar(1 + dt * 0.5);
      if (this.position.z > p.z + 30) this.destroy();
    }
  }
  go(s) { this.state = s; this.stateT = 0; }

  late(dt) {
    if (this.state === 'dash') {
      // orient the whole group toward travel; the shell halves are far behind by now
      if (!this.dashRot) { this.dashRot = true; this.group.rotation.set(0, 0, 0); this.shellA.visible = this.shellB.visible = false; }
      this.faceDir(_v.copy(this.vel), dt, 12);
      this.drone.rotation.z += dt * 3;
    }
  }
}
