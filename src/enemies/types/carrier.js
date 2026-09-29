// Carrier: large enemy transport. Slow, tough, launches grunts from a glowing belly bay and defends itself with
// three destroyable deck turrets (each its own lockable Part).
import * as THREE from 'three';
import { Enemy } from '../enemy.js';
import { Part } from '../part.js';
import { G, MAT, part, sym, merged, mesh, glowSprite } from '../models.js';
import { leadDir } from '../aim.js';

const PI2 = Math.PI / 2;
const TURRETS = [[-6, 3.1, 4], [6, 3.1, 4], [0, 4.6, -6]];

export class Carrier extends Enemy {
  static def = { scale: 1.3, hp: 42, radius: 8.5, points: 800, damage: 8, contactDamage: 25 };

  build() {
    const b = this.body;
    mesh(merged('caHull', [
      part(G.box(12, 5, 26)),
      part(G.box(9, 3.6, 9), 0, -0.6, 16.5, 0.16),
      part(G.cone(4.4, 6, 4), 0, -0.8, 22.5, PI2, 0, Math.PI / 4, 1.0, 1, 0.55),
      ...sym(part(G.box(4.2, 3.4, 20), 8, -0.8, -2, 0, 0, 0)),
      ...sym(part(G.box(2.2, 3.4, 9), 10.5, -0.6, 8, 0, 0.18, 0)),
      part(G.box(5, 3.4, 6), 0, 4.2, -9),
      ...sym(part(G.cyl(1.9, 2.2, 5, 8), 4, 0, -14.5, PI2)),
      ...sym(part(G.cyl(1.2, 1.5, 4, 8), 9, -0.6, -13, PI2)),
    ]), MAT.purple, b);
    mesh(merged('caPlates', [
      part(G.box(8, 0.5, 16), 0, 2.7, 1), ...sym(part(G.box(3.4, 0.4, 16), 8, 1.0, -2)),
      part(G.box(3.4, 0.5, 10), 0, 5.5, -9), ...sym(part(G.box(0.5, 2.6, 8), 6.05, 0.2, 1)),
    ]), MAT.darkPurple, b);
    mesh(merged('caStripe', [...sym(part(G.box(1.0, 0.3, 14), 3, 2.98, 3)), part(G.box(12.2, 0.4, 1.2), 0, 0.5, 11)]), MAT.orange, b);
    mesh(merged('caWin', [part(G.box(4.2, 0.8, 0.2), 0, 4.8, -6.05)]), MAT.cyan, b);
    mesh(merged('caEng', [...sym(part(G.cyl(1.5, 1.5, 0.3, 8), 4, 0, -17.2, PI2)), ...sym(part(G.cyl(0.9, 0.9, 0.3, 8), 9, -0.6, -15.2, PI2))]), MAT.orangeGlow, b);
    // hangar bay under the belly
    mesh(merged('caBay', [part(G.box(5, 0.4, 7), 0, -2.6, 4)]), MAT.dark, b);
    this.bayGlow = mesh(merged('caBayGlow', [part(G.box(3.8, 0.2, 5.6), 0, -2.85, 4)]), MAT.orangeGlow, b); this.bayGlow.visible = false;
    this.bayLight = this.makeGlow(0xff8a1f, 14, b, 0, -3.4, 4);
    this.engs = [[-4, 0, -17.6], [4, 0, -17.6], [-9, -0.6, -15.6], [9, -0.6, -15.6]].map(([x, y, z]) => glowSprite(0xff8a3a, x % 9 ? 6.5 : 4.2, b, x, y, z));
    // deck turrets (parts)
    this.turrets = [];
    for (const [x, y, z] of TURRETS) {
      const a = new THREE.Group(); a.position.set(x, y, z); b.add(a);
      const base = mesh(merged('caTuBase', [part(G.cyl(1.4, 1.8, 0.9, 8), 0, 0.3, 0), part(G.box(1.8, 1.2, 1.8), 0, 1.0, 0)]), MAT.red, a);
      const gun = new THREE.Group(); gun.position.y = 1.2; a.add(gun);
      const barrel = mesh(merged('caTuGun', [...sym(part(G.cyl(0.22, 0.28, 2.6, 6), 0.5, 0, 1.4, PI2)), part(G.box(1.6, 0.7, 1.2))]), MAT.steel, gun);
      const eye = mesh(merged('caTuEye', [part(G.oct(0.3), 0, 0.5, 0.5)]), MAT.yellow, gun);
      const glow = this.makeGlow(0xff8a1f, 3.4, gun, 0, 0, 2.8);
      const p = new Part(this, this.ctx, a, { name: 'deckTurret', radius: 1.9, hp: 6, points: 100, meshes: [base, barrel, eye], explScale: 1.6 });
      p.gun = gun; p.glow = glow; p.charge = 0; p.cd = 1.5 + Math.random() * 2;
      this.turrets.push(p);
    }
    this.aimOffset.set(0, 0, 4);
  }

  onSpawn(opts) {
    for (const t of this.turrets) this.ctx.enemies.add(t);
    this.x0 = this.rel.x; this.y0 = this.rel.y; this.z0 = this.rel.z;
    this.cx = opts.xc ?? 0; this.cy = opts.yc ?? 3; this.zh = -(92 + Math.random() * 8);
    this.enterT = Math.max(4, (this.zh - this.z0) / 45);
    this.brood = []; this.launchCd = 3.2; this.launching = 0; this.maxBrood = 4;
  }

  think(dt, ctx) {
    const r = this.rel;
    const u = Math.min(1, this.age / this.enterT), e = 1 - (1 - u) * (1 - u);
    r.x = this.x0 + (this.cx - this.x0) * e + Math.sin(this.age * 0.35) * 8 * e;
    r.y = this.y0 + (this.cy - this.y0) * e + Math.sin(this.age * 0.5) * 1.5;
    // holds a while, then drifts down onto the player so it eventually flies past
    r.z = this.z0 + (this.zh - this.z0) * e + Math.max(0, this.age - this.enterT - 20) * 4.5;

    // launch grunts: bay glow telegraph 0.9 s
    for (let i = this.brood.length - 1; i >= 0; i--) if (!this.brood[i].alive) this.brood.splice(i, 1);
    if (this.launching > 0) {
      this.launching -= dt; const k = 1 - Math.max(0, this.launching) / 0.9;
      this.setGlow(this.bayLight, k, 18); this.bayGlow.visible = k > 0.1;
      if (this.launching <= 0) {
        this.setGlow(this.bayLight, 0); this.bayGlow.visible = false;
        for (let i = 0; i < 2 && this.brood.length < this.maxBrood; i++) {
          const g = ctx.enemies.spawn('grunt', { rel: new THREE.Vector3(this.rel.x + (i ? 4 : -4), this.rel.y - 4, this.rel.z + 6), dir: i ? 1 : -1 });
          if (g) this.brood.push(g);
        }
        ctx.audio?.sfx?.('whoosh', { position: this.position, pitch: 0.7 });
        this.launchCd = 6.5 * this.fireScale;
      }
    } else if (this.age > 3 && this.brood.length < this.maxBrood - 1) {
      this.launchCd -= dt; if (this.launchCd <= 0) this.launching = 0.9;
    }

    // deck turrets
    for (const t of this.turrets) {
      if (!t.alive) continue;
      t.gun.lookAt(ctx.player.position);
      if (t.charge > 0) {
        t.charge -= dt; this.setGlow(t.glow, 1 - Math.max(0, t.charge) / 0.7, 24);
        if (t.charge <= 0) {
          this.setGlow(t.glow, 0);
          const m = _tm.copy(t.glow.position); t.gun.localToWorld(m);
          this.shootAt(m, 46, 0.04, { radius: 0.9, color: 0xff7a1a, damage: 7, cap: 34 });
          t.cd = (3.4 + Math.random() * 1.6) * this.fireScale;
        }
      } else { t.cd -= dt; if (t.cd <= 0 && this.age > 2.5) t.charge = 0.7; }
    }
  }

  late(dt) {
    this.group.updateMatrixWorld(true);
    for (const t of this.turrets) t.sync();
    for (const e of this.engs) e.scale.setScalar(e.userData.size + Math.sin(this.age * 20) * 0.3);
  }

  onPartDestroyed(p) { p.anchor.visible = false; }

  onDeath(ctx) {
    for (const t of this.turrets) if (t.alive) t.destroy();
    for (let i = 0; i < 5; i++) {
      const o = this.position.clone(); o.x += (Math.random() - 0.5) * 12; o.y += (Math.random() - 0.5) * 4; o.z += (Math.random() - 0.5) * 20;
      ctx.fx?.explosion?.(o, { scale: 3 + Math.random() * 2, big: true });
    }
    ctx.fx?.flash?.('#ffcc88', 0.35, 0.25);
  }
  onDestroy() { for (const t of this.turrets) { t.destroy(); } }
}
const _tm = new THREE.Vector3();
