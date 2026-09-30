// The atmosphere light rig: exactly two point lights, created once when the first level loads and never added or removed again
// (adding or removing a light at runtime recompiles every lit material and hitches). Only their position, colour, range and intensity
// change, every frame.
//
// Outside boss fights the two lights do a level specific job that the level file describes with setIdle():
//   Cinder Belt   A = hot ember light raking the debris,  B = cold cyan void fill
//   Foundry       A = cold blue fill travelling with the ship, B = orange furnace light from below
//   Thalassa      off (the sea and sky have their own light)
// During a boss fight the same two lights become the boss's hero lighting: A is the KEY light (in front of and above the boss, on the
// side of the camera, so the shape and the weak points are lit), B is the RIM light (behind and to the side, so the silhouette
// separates from the background). They fade in on boss:spawn, flare on boss:phase, flare and fade out on boss:defeated.
import * as THREE from 'three';

const _b = new THREE.Vector3(), _c1 = new THREE.Color(), _c2 = new THREE.Color();
const lerp = (a, b, t) => a + (b - a) * t;

/**
 * Per boss recipes. Offsets are in boss space: +x right, +y up, +z toward the camera. Intensities are candela at decay 1.6 and
 * were tuned in screenshots at the boss hold distance of 150 to 175 units. `phase` gives the colours for phase 1, 2, 3.
 */
const RECIPES = {
  // Thalassa: low golden suns behind the barge, so the key comes in warm from the camera side and the rim is cool sea light
  tidebreaker: {
    key: { off: [34, 52, 90], i: 7800, dist: 420 }, rim: { off: [-58, 30, -70], i: 6300, dist: 420 },
    keyCol: [0xffdcaa, 0xffe4bc, 0xffc98c], rimCol: [0x70e8d8, 0x70e8d8, 0xff9a5a],
  },
  // Cinder Belt: the ember sun is behind and to the right, so the key is a cold pale light from the left and the rim is ember orange.
  // The key slowly orbits the ring so the rotating segments keep catching light.
  orrery: {
    key: { off: [-46, 40, 96], i: 5600, dist: 460, orbit: 0.22 }, rim: { off: [62, 22, -60], i: 4600, dist: 460 },
    keyCol: [0xcfeeff, 0xd8f2ff, 0xfff0d8], rimCol: [0xff8a44, 0xff7a38, 0xff5a2a],
  },
  // Foundry: cold blue-white key from above and the front, hot orange rim from below and behind (the molten floor)
  regent: {
    key: { off: [26, 60, 100], i: 5600, dist: 480 }, rim: { off: [-50, -18, -80], i: 4800, dist: 480 },
    keyCol: [0xb4d0ff, 0xc8dcff, 0xffd8c8], rimCol: [0xff8a3c, 0xff7030, 0xff4a28],
  },
};

export class AtmoRig {
  constructor(scene) {
    this.group = new THREE.Group();
    this.group.name = 'atmoRig';
    this.a = new THREE.PointLight(0xffffff, 0, 300, 1.6);
    this.b = new THREE.PointLight(0xffffff, 0, 300, 1.6);
    this.a.name = 'atmoKey'; this.b.name = 'atmoRim';
    this.group.add(this.a, this.b);
    scene.add(this.group);
    this.idle = null;            // { res, fn } set by the level
    this.out = { aPos: new THREE.Vector3(), aCol: new THREE.Color(), aI: 0, aDist: 200, bPos: new THREE.Vector3(), bCol: new THREE.Color(), bI: 0, bDist: 200 };
    this.mix = 0;                // 0 idle, 1 boss
    this.boss = null;            // the live boss entity
    this.key = '';
    this.phase = 1;
    this.punch = 0;              // decaying flare from phase changes
    this.defeat = 0;             // 1 while the defeat flare runs
    this.defeated = false;
    this.keyCol = new THREE.Color(0xffffff); this.rimCol = new THREE.Color(0xffffff);
    this.t = 0;
  }

  setIdle(res, fn) { this.idle = { res, fn }; }

  onSpawn(name) { this.key = name; this.phase = 1; this.defeated = false; this.defeat = 0; this.punch = 0.6; this._recolor(true); }
  onPhase(n) { this.phase = n; this.punch = 1; this._recolor(false); }
  onDefeated() { this.defeated = true; this.defeat = 1; this.punch = 1.6; }
  reset() { this.mix = 0; this.boss = null; this.key = ''; this.punch = 0; this.defeat = 0; this.defeated = false; }

  _recolor(snap) {
    const r = RECIPES[this.key]; if (!r) return;
    const i = Math.max(0, Math.min(2, this.phase - 1));
    this._kt = r.keyCol[i]; this._rt = r.rimCol[i];
    if (snap) { this.keyCol.set(this._kt); this.rimCol.set(this._rt); }
  }

  update(dt, ctx, W) {
    const P = ctx.feel.p.atmosphere;
    this.t += dt;
    const live = ctx.enemies?.boss;
    const bossAlive = !!(live && live.alive && ctx.state?.boss) ;
    if (bossAlive && live.key && live.key !== this.key && !this.defeated) this.onSpawn(live.key);
    if (bossAlive) this.boss = live;
    // fade: in over bossFade seconds, out over bossFade seconds. During the defeat sequence the lights stay on and flare.
    const want = (bossAlive || (this.defeated && this.defeat > 0.02)) && this.key ? 1 : 0;
    const tau = Math.max(0.05, P.bossFade) / 3;
    this.mix += (want - this.mix) * (1 - Math.exp(-dt / tau));
    if (this.mix < 0.002 && !want) this.mix = 0;
    this.punch = Math.max(0, this.punch - dt * 1.3);
    if (this.defeated) this.defeat = Math.max(0, this.defeat - dt * 0.55);

    // ---- idle values from the level
    const o = this.out;
    o.aI = 0; o.bI = 0;
    if (this.idle && this.idle.res === W.res) this.idle.fn(o, dt, ctx, W, P);

    // ---- boss values
    let ai = o.aI, bi = o.bI;
    const r = RECIPES[this.key];
    if (this.mix > 0.001 && r) {
      const bo = this.boss;
      if (bo) _b.copy(bo.position); else _b.copy(ctx.rail.position).add(_c1.set(0, 0, -160));
      const mult = (P[this.key + '_boss'] ?? 1);
      const punch = 1 + (this.punch + this.defeat * 1.6) * 0.9 * P.bossPhasePunch;
      const k = this.mix;
      // colours drift toward the phase colours
      const cr = 1 - Math.exp(-dt * 2.5);
      this.keyCol.lerp(_c1.set(this._kt ?? 0xffffff), cr); this.rimCol.lerp(_c2.set(this._rt ?? 0xffffff), cr);
      // key
      // the Orrery key swings slowly around the ring (plus and minus 40 degrees) so the rotating segments keep catching light
      let kx = r.key.off[0], ky = r.key.off[1];
      const kz = r.key.off[2];
      if (r.key.orbit) {
        const a = 0.7 * Math.sin(this.t * r.key.orbit), cs = Math.cos(a), sn = Math.sin(a);
        kx = r.key.off[0] * cs - r.key.off[1] * sn; ky = r.key.off[0] * sn + r.key.off[1] * cs;
      }
      o.aPos.set(lerp(o.aPos.x, _b.x + kx, k), lerp(o.aPos.y, _b.y + ky, k), lerp(o.aPos.z, _b.z + kz, k));
      o.aCol.lerp(this.keyCol, k);
      o.aDist = lerp(o.aDist, r.key.dist, k);
      ai = lerp(o.aI, r.key.i * P.bossKey * mult * punch, k);
      // rim, pulses hard in phase 3
      const p3 = this.phase >= 3 && !this.defeated ? 0.82 + 0.18 * Math.sin(this.t * 5.2) : 1;
      o.bPos.set(lerp(o.bPos.x, _b.x + r.rim.off[0], k), lerp(o.bPos.y, _b.y + r.rim.off[1], k), lerp(o.bPos.z, _b.z + r.rim.off[2], k));
      o.bCol.lerp(this.rimCol, k);
      o.bDist = lerp(o.bDist, r.rim.dist, k);
      bi = lerp(o.bI, r.rim.i * P.bossRim * mult * punch * p3, k);
    }
    this.a.position.copy(o.aPos); this.a.color.copy(o.aCol); this.a.distance = o.aDist; this.a.intensity = Math.max(0, ai);
    this.b.position.copy(o.bPos); this.b.color.copy(o.bCol); this.b.distance = o.bDist; this.b.intensity = Math.max(0, bi);
  }
}
