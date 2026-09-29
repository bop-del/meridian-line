// Gunship: armored heavy. Holds station off to one side, opens its vents (cyan, vulnerable) to charge a burst of 3 shots.
import * as THREE from 'three';
import { Enemy } from '../enemy.js';
import { G, MAT, part, sym, merged, mesh, glowSprite, wingPair } from '../models.js';

const PI2 = Math.PI / 2;

export class Gunship extends Enemy {
  static def = { scale: 1.3, hp: 15, radius: 3.0, points: 300, damage: 8, contactDamage: 14 };

  build() {
    const b = this.body;
    mesh(merged('gsHull', [
      part(G.box(3.2, 1.7, 6.2)),
      part(G.box(2.4, 1.0, 2.2), 0, 0.2, 3.9, 0.25),                 // sloped prow
      part(G.cone(1.1, 2.0, 4), 0, -0.1, 5.4, PI2, 0, Math.PI / 4),
      ...wingPair(4.2, 2.0, 4.8, -1.2, 0.6, 1.2, -0.3, -0.5, -0.08),
      ...sym(part(G.box(0.9, 1.9, 2.6), 5.7, 0.2, -1.0, 0, 0, 0)),          // outboard armor slabs
      ...sym(part(G.cyl(0.5, 0.65, 2.2, 6), 1.2, -0.1, -3.7, PI2)),           // engines
    ]), MAT.orange, b);
    mesh(merged('gsPlate', [
      ...sym(part(G.box(1.0, 0.35, 3.0), 1.0, 0.95, 0.4)),
      part(G.box(1.3, 0.3, 2.2), 0, 0.98, -1.6),
      ...sym(part(G.box(0.5, 0.5, 3.4), 5.7, 1.3, -1.0)),
    ]), MAT.dark, b);
    // side cannons
    this.cannons = [];
    for (const s of [-1, 1]) {
      const c = new THREE.Group(); c.position.set(s * 5.7, -0.3, 0.5); b.add(c);
      mesh(merged('gsCannon', [part(G.cyl(0.32, 0.4, 3.6, 6), 0, 0, 1.6, PI2), part(G.box(0.9, 0.9, 1.4), 0, 0, -0.1)]), MAT.steel, c);
      c.userData.tip = this.makeGlow(0xff7a2a, 3.4, c, 0, 0, 3.5);
      this.cannons.push(c);
    }
    // vents = weak points (cyan when open)
    const ventGeo = merged('gsVents', [...sym(part(G.box(0.7, 0.14, 1.6), 0.8, 0.93, 0.4)), part(G.box(0.8, 0.14, 1.4), 0, 1.0, -1.6)]);
    this.ventsClosed = mesh(ventGeo, MAT.dark, b); this.ventsOpen = mesh(ventGeo, MAT.cyan, b); this.ventsOpen.visible = false;
    this.ventGlow = this.makeGlow(0x4de8ff, 6.5, b, 0, 1.5, 0);
    this.eng = [-1, 1].map((s) => glowSprite(0xff7a2a, 3, b, s * 1.2, -0.1, -4.9));
  }

  onSpawn(opts) {
    this.side = opts.side ?? (this.rel.x < 0 ? -1 : (Math.random() < 0.5 ? -1 : 1));
    this.targetX = this.side * (19 + Math.random() * 3); this.targetY = 1 + Math.random() * 3;
    this.holdZ = -(58 + Math.random() * 8);
    this.enterT = Math.max(2.4, (this.rel.z - this.holdZ) / -60); this.state = 'enter'; this.stateT = 0; this.cycles = 0; this.burstLeft = 0; this.lifetime = opts.lifetime ?? 34;
    this.armored = true; this.entryZ = this.rel.z; this.x0 = this.rel.x; this.y0 = this.rel.y;
    this.cannonIdx = 0;
    this.stateT = 0;
  }

  filterDamage(a) { return this.armored ? a * 0.4 : a * 1.25; }

  think(dt, ctx) {
    const r = this.rel; this.stateT += dt;
    const bob = Math.sin(this.age * 0.9);
    switch (this.state) {
      case 'enter': { // fly in and settle
        const u = Math.min(1, this.stateT / this.enterT), e = 1 - (1 - u) * (1 - u);
        r.z = this.entryZ + (this.holdZ - this.entryZ) * e; r.x = this.x0 + (this.targetX - this.x0) * e; r.y = this.y0 + (this.targetY - this.y0) * e;
        if (u >= 1) this.go('idle');
        break;
      }
      case 'idle': this.hover(dt, bob); if (this.stateT > 1.6 * this.fireScale) this.go('charge'); break;
      case 'charge': { // vents open: vulnerable + telegraph glows
        this.hover(dt, bob);
        const k = Math.min(1, this.stateT / 0.95);
        this.armored = k < 0.35; this.setGlow(this.ventGlow, k, 18);
        this.ventsOpen.visible = k > 0.3;
        for (const c of this.cannons) this.setGlow(c.userData.tip, k, 26);
        if (this.stateT >= 0.95) { this.go('burst'); this.burstLeft = 3; this.fireCd = 0; }
        break;
      }
      case 'burst': {
        this.hover(dt, bob);
        if (this.burstLeft > 0 && this.fireCd <= 0) {
          const c = this.cannons[this.cannonIdx++ & 1];
          const m = this.muzzle(c.position.x, c.position.y, c.position.z + 3.7);
          this.shootAt(m, 62, 0.045, { color: 0xffa030, radius: 0.75 });
          this.burstLeft--; this.fireCd = 0.16;
        }
        if (this.burstLeft <= 0 && this.stateT > 0.75) {
          for (const c of this.cannons) this.setGlow(c.userData.tip, 0);
          this.go('recover');
        }
        break;
      }
      case 'recover': { // still exposed for a beat: reward for staying on it
        this.hover(dt, bob);
        const k = 1 - this.stateT / 1.3; this.setGlow(this.ventGlow, Math.max(0, k), 18);
        if (this.stateT > 1.3) {
          this.armored = true; this.ventsOpen.visible = false; this.setGlow(this.ventGlow, 0);
          this.cycles++;
          if (this.cycles % 2 === 0) { this.side = -this.side; this.targetX = this.side * (19 + Math.random() * 3); this.targetY = -1 + Math.random() * 5; this.go('shift'); this.sx = r.x; this.sy = r.y; }
          else this.go('idle');
        }
        break;
      }
      case 'shift': {
        const u = Math.min(1, this.stateT / 1.5), e = u * u * (3 - 2 * u);
        r.x = this.sx + (this.targetX - this.sx) * e; r.y = this.sy + (this.targetY - this.sy) * e; r.z = this.holdZ + bob * 2;
        if (u >= 1) this.go('idle');
        break;
      }
      case 'leave': {
        r.x += this.side * 30 * dt * (1 + this.stateT); r.z -= 20 * dt; r.y += 6 * dt; break;
      }
    }
    if (this.age > this.lifetime && this.state !== 'leave') this.go('leave');
  }

  hover(dt, bob) {
    const r = this.rel;
    r.x = this.targetX + Math.sin(this.age * 0.7) * 1.4; r.y = this.targetY + bob * 0.8; r.z = this.holdZ + Math.sin(this.age * 0.5) * 2;
  }
  go(s) { this.state = s; this.stateT = 0; }

  late(dt) {
    this.faceMotion(dt, 60, 4);
    const ex = this.state === 'burst' ? 0.6 : 1;
    for (const e of this.eng) e.scale.setScalar(3 * ex + Math.sin(this.age * 30) * 0.2);
  }
}
