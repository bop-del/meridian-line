// Bomber: big slow purple manta. Opens its belly bay (orange glow telegraph) and lobs slow plasma orbs on an arc.
import * as THREE from 'three';
import { Enemy } from '../enemy.js';
import { G, MAT, part, sym, merged, mesh, glowSprite, wingPair } from '../models.js';
import { playerVel } from '../aim.js';

const PI2 = Math.PI / 2;
const _t = new THREE.Vector3(), _v = new THREE.Vector3(), _pv = new THREE.Vector3();
export const ORB_GRAVITY = 12;

export class Bomber extends Enemy {
  static def = { scale: 1.3, hp: 11, radius: 3.6, points: 200, damage: 14, contactDamage: 16 };

  build() {
    const b = this.body;
    mesh(merged('boHull', [
      part(G.box(3.6, 1.6, 6.0)),
      part(G.cone(1.5, 2.6, 5), 0, 0, 4.2, PI2, 0, 0),
      ...wingPair(6.4, 1.6, 9.0, -3.0, 0.55, 1.5, -0.2, -0.6, 0.05),   // broad manta wings
      ...sym(part(G.cyl(0.9, 1.1, 2.4, 6), 1.8, 0.2, -3.6, PI2)),
      part(G.box(0.4, 1.6, 2.4), 0, 1.4, -2.0),
    ]), MAT.purple, b);
    mesh(merged('boPlate', [
      part(G.box(2.8, 0.3, 3.6), 0, 0.9, 0.2), ...wingPair(4.6, 1.0, 7.4, -2.7, 0.16, 1.5, 0.04, -0.5, 0.05),
    ]), MAT.darkPurple, b);
    mesh(merged('boBay', [part(G.box(2.0, 0.2, 2.6), 0, -0.85, 0.4)]), MAT.dark, b);
    this.bayGlow = mesh(merged('boBayGlow', [part(G.box(1.5, 0.12, 2.0), 0, -0.93, 0.4)]), MAT.orangeGlow, b);
    this.bayGlow.visible = false;
    mesh(merged('boEye', [part(G.oct(0.5), 0, 0.8, 2.6, 0, 0, 0, 1.5, 0.5, 1.2)]), MAT.yellow, b);
    this.bay = this.makeGlow(0xff8a1f, 8, b, 0, -1.6, 0.4);
    this.eng = [-1, 1].map((s) => glowSprite(0xd04dff, 3.4, b, s * 1.8, 0.2, -4.9));
  }

  onSpawn(opts) {
    this.state = 'enter'; this.stateT = 0; this.drops = 0; this.maxDrops = opts.drops ?? 4;
    this.x0 = this.rel.x; this.y0 = this.rel.y; this.z0 = this.rel.z;
    this.cx = opts.xc ?? (Math.random() < 0.5 ? -6 : 6); this.cy = opts.yc ?? 5; this.zh = -(72 + Math.random() * 8);
    this.lifetime = opts.lifetime ?? 30;
    this.enterT = Math.max(2.8, (this.zh - this.z0) / 55);
  }

  think(dt, ctx) {
    const r = this.rel; this.stateT += dt;
    if (this.state === 'enter') {
      const u = Math.min(1, this.stateT / this.enterT), e = 1 - (1 - u) * (1 - u);
      r.x = this.x0 + (this.cx - this.x0) * e; r.y = this.y0 + (this.cy - this.y0) * e; r.z = this.z0 + (this.zh - this.z0) * e;
      if (u >= 1) this.go('cruise');
    } else if (this.state === 'leave') {
      r.x += (r.x < 0 ? -1 : 1) * 14 * dt; r.y += 6 * dt; r.z -= 26 * dt;
    } else {
      const ramp = Math.min(1, Math.max(0, (this.age - this.enterT) / 2.5));
      r.x = this.cx + Math.sin(this.age * 0.55) * 12 * ramp; r.y = this.cy + Math.sin(this.age * 0.9) * 1.6 * ramp; r.z = this.zh + Math.sin(this.age * 0.4) * 3 * ramp;
      if (this.state === 'cruise' && this.stateT > 2.6 * this.fireScale) this.go('open');
      else if (this.state === 'open') { // telegraph: bay glow grows
        const k = Math.min(1, this.stateT / 1.0);
        this.setGlow(this.bay, k, 20); this.bayGlow.visible = k > 0.15;
        if (k >= 1) { this.drop(ctx); this.go('close'); }
      } else if (this.state === 'close' && this.stateT > 0.6) {
        this.setGlow(this.bay, 0); this.bayGlow.visible = false;
        this.go(this.drops >= this.maxDrops ? 'leave' : 'cruise');
      }
    }
    if (this.age > this.lifetime && this.state !== 'leave') this.go('leave');
  }
  go(s) { this.state = s; this.stateT = 0; }

  drop(ctx) {
    const o = this.muzzle(0, -1.7, 0.4, _t);
    const p = ctx.player.position;
    if (o.z > p.z - 30 || !ctx.enemies?.spawn) return; // too close: skip
    playerVel(ctx, _pv);
    const T = THREE.MathUtils.clamp(o.distanceTo(p) / 34, 1.8, 3.4);
    // ballistic solve: target = where the player will be, minus half of the gravity drop
    _v.set(p.x + _pv.x * 0.45 * T - o.x, p.y + _pv.y * 0.45 * T - o.y, p.z + _pv.z * T - o.z).divideScalar(T);
    _v.y += 0.5 * ORB_GRAVITY * T;
    const orb = ctx.enemies.spawn('plasmaOrb', { position: o.clone(), velocity: _v.clone(), damage: this.damage });
    if (orb) { orb.shotAge = 0; this.drops++; ctx.audio?.sfx?.('whoosh', { position: o, pitch: 0.6 }); }
  }

  late(dt) {
    this.faceMotion(dt, 70, 3);
    for (const e of this.eng) e.scale.setScalar(3.4 + Math.sin(this.age * 26) * 0.25);
  }
}
