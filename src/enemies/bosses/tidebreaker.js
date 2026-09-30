// Boss of Thalassa Coast: TIDEBREAKER, the flagship siege barge of the Dominion landing fleet, riding on twin pontoon
// skids. It starts the fight tied down to three mooring towers.
//  P1 MOORED:   three heavy mooring cables hold the hull. Each cable ends in a clamp on the hull (a critical part).
//               Cut all three. Deck turrets and missile pods harass while the hull strains.
//  P2 ADRIFT:   the barge drifts free and its siege cannon charges with a telegraphed aim line. A barrel roll REFLECTS the
//               shell back into the hull and cracks an armour plate for big damage. The four plates can also be shot down
//               with lasers, more slowly, so a laser-only pilot still wins.
//  P3 CRACKED:  the deck is split open. The reactor core rises on a timed cycle (sealed, opening, open) and can only be hit
//               while it is out. While it is sealed the overheat vents spit plasma. Faster cannon, bigger missile volleys.
import * as THREE from 'three';
import { Boss } from './boss.js';
import { G, part, sym, merged, mesh, glowSprite, beamGeo, beamMat, makeStd } from '../models.js';
import { leadDir } from '../aim.js';

const PI2 = Math.PI / 2;
const SCALE = 2.0;
const Z = new THREE.Vector3(0, 0, 1), DOWN = new THREE.Vector3(0, -1, 0);
const _o = new THREE.Vector3(), _d = new THREE.Vector3(), _t = new THREE.Vector3(), _c = new THREE.Vector3(), _e = new THREE.Vector3();

// Heavy teal grey plating with amber running lights. Shared by every Tidebreaker instance.
const HULL = makeStd(0x3a6068, { fog: false, metalness: 0.5, roughness: 0.55, emissive: 0x0a1619 });
const HULL_D = makeStd(0x1a2e36, { fog: false, metalness: 0.6, roughness: 0.5, emissive: 0x060e11 });
const HULL_L = makeStd(0x7fa9a4, { fog: false, metalness: 0.4, roughness: 0.6, emissive: 0x0d1715 });
const PLATE = makeStd(0x9db6b0, { fog: false, metalness: 0.45, roughness: 0.5, emissive: 0x101a18 });
const CABLE = makeStd(0x1c2a30, { fog: false, metalness: 0.7, roughness: 0.5, emissive: 0x05090b });
const glowMat = (hex, i = 2.4) => new THREE.MeshStandardMaterial({ color: 0x141210, emissive: hex, emissiveIntensity: i, roughness: 0.4, metalness: 0, flatShading: true, fog: false });
const AMBER = glowMat(0xffa82a, 2.6);
const CORE_GLOW = glowMat(0xffd070, 3.2);
const CANNON_GLOW = glowMat(0xff9a2a, 1.3);
const CRACK = glowMat(0xff5a1a, 3.4);
const VENT_GLOW = glowMat(0xff4a18, 3.0);
const TENSION = beamMat(0xffa030).clone(); TENSION.opacity = 0.55;

// Armoured ram prow: plan-view polygon extruded downwards (top face at y = 0, 5 units deep), bevelled for facets.
const PROW = (() => {
  const sh = new THREE.Shape();
  sh.moveTo(-12, 0); sh.lineTo(12, 0); sh.lineTo(10.5, 7); sh.lineTo(5.5, 15); sh.lineTo(0, 19); sh.lineTo(-5.5, 15); sh.lineTo(-10.5, 7); sh.closePath();
  const g = new THREE.ExtrudeGeometry(sh, { depth: 4.2, bevelEnabled: true, bevelSize: 0.7, bevelThickness: 0.7, bevelSegments: 1 });
  g.rotateX(Math.PI / 2); // shape y -> world z, extrusion -> downwards
  return g;
})();

// Where the three cables attach: a clamp on the hull, an anchor on a mooring tower (hull space, before the boss scale).
const MOORINGS = [
  { name: 'port', clamp: [-10.4, 3.0, 12.8], anchor: [-38, 8, 12.8] },
  { name: 'starboard', clamp: [10.4, 3.0, 12.8], anchor: [38, 8, 12.8] },
  { name: 'stern', clamp: [0, 4.2, -10.4], anchor: [0, 16, -64] },
];
// Armour plate slots: two pairs on the foredeck. All sit within laser reach of the rail.
const PLATES = [[-7.2, 4.1, 17], [7.2, 4.1, 17], [-7.6, 4.1, 8.6], [7.6, 4.1, 8.6]];
const VENTS = [[-3.6, 3.2, -4.5], [3.6, 3.2, -4.5], [-10.5, 3.0, -14], [10.5, 3.0, -14]];
const SHELL_DAMAGE = 40, SHELL_SPLASH = 10, CORE_SHELL_DAMAGE = 24;

export class Tidebreaker extends Boss {
  constructor(ctx) { super(ctx, 'tidebreaker', 'TIDEBREAKER'); }

  build() {
    this.holdZ = 176; this.introT = 4.6; this.introY = -3;
    this.parts = []; this.crit = [];
    this.group.scale.setScalar(SCALE);
    this.body.position.z = 8; // visual root sits in front of the (rear) hull collider so front parts are hit first
    this.radius = 12; this.bounds = new THREE.Vector3(18, 8, 26);
    this.deathColors = [0xffb040, 0xff7a20]; this.debrisColor = 0x3a6068;
    this.deathCfg = { flash: '#ffdcaa', sink: 3.6, sinkAfter: 6, tumble: 1.3, afterCd: 0.1, afterScale: 2.1 };
    const b = this.body;
    // barge hull
    mesh(merged('tbHull', [
      part(G.box(24, 5, 40), 0, -1, -2),                                      // main deck slab
      part(PROW, 0, 1.4, 17),                                                // armoured ram prow
      part(G.box(14, 3, 34), 0, -4.6, -2),                                    // keel
      ...sym(part(G.box(3, 4.4, 30), 12.4, 0, -4)),                           // side armour
      part(G.box(20, 7, 8), 0, 2, -19),                                       // stern block
      part(G.box(9, 8, 9), 0, 5.5, -15), part(G.box(6, 3.2, 6), 0, 11, -15),  // bridge tower
      ...sym(part(G.cyl(3, 3.6, 7, 8), 7, -0.5, -24, PI2)),                   // engine bells
      ...sym(part(G.cyl(3.1, 3.1, 50, 8), 17.5, -4.5, -1, PI2)),              // pontoon skids
      ...sym(part(G.cyl(2.3, 3.1, 12, 8), 17.5, -2.6, 29, PI2 - 0.42)),       // upswept skid bows
      ...[-17, 0, 15].flatMap((z) => sym(part(G.box(8, 2, 3), 14.2, -2.6, z))), // skid struts
      ...sym(part(G.cyl(1.6, 1.9, 2.6, 8), 10.4, 1.9, 12.8)),                  // mooring winch drums
    ]), HULL, b);
    mesh(merged('tbPlate', [
      part(G.box(18, 0.8, 26), 0, 1.9, -6), part(G.box(11, 1, 8), 0, 2.2, 19, -0.16),
      ...sym(part(G.box(1.2, 3.4, 26), 17.5, -1.6, -1)),                       // skid fins
      ...sym(part(G.box(0.8, 1.6, 44), 17.5, -8, -2)),                        // runners
      part(G.box(4, 5, 4), 0, 15.6, -15), part(G.cyl(0.25, 0.25, 6, 5), 0, 20, -15),
    ]), HULL_D, b);
    mesh(merged('tbTrim', [
      ...sym(part(G.box(1, 0.5, 36), 11.4, 2.1, -3)), part(G.box(24, 0.5, 1), 0, 1.9, 16.6),
      ...sym(part(G.box(0.9, 0.5, 46), 17.5, -1.2, -1)), part(G.box(9.4, 0.6, 1), 0, 9.6, -10.4),
    ]), HULL_L, b);
    mesh(merged('tbLights', [
      part(G.box(7, 1.2, 0.3), 0, 6.6, -10.4),                                // bridge window
      ...sym(part(G.box(0.4, 0.9, 30), 12.05, -0.6, -3)),                     // hull band
      ...sym(part(G.box(0.4, 0.4, 42), 19.05, -2.6, -1)),                     // skid running lights
      ...sym(part(G.box(0.5, 0.5, 0.5), 17.5, 0.3, 34.8)),
      ...[0, 1, 2].map((i) => part(G.box(0.5, 0.5, 0.5), (i - 1) * 2.2, 13.2, -11.2)),
    ]), AMBER, b);
    // engines and repulsors
    this.engs = [];
    for (const s of [-1, 1]) this.engs.push(glowSprite(0xffa040, 12, b, s * 7, -0.5, -28.5));
    mesh(merged('tbEng', [...sym(part(G.cyl(2.5, 2.5, 0.5, 10), 7, -0.5, -27.7, PI2))]), AMBER, b);
    this.pads = [];
    for (const s of [-1, 1]) for (const z of [-16, 16]) this.pads.push(glowSprite(0x4fe0c8, 6, b, s * 17.5, -9.6, z));

    // siege cannon
    this.cannon = new THREE.Group(); this.cannon.position.set(0, -1.4, 24); b.add(this.cannon);
    mesh(merged('tbCannon', [
      part(G.box(10, 8, 9), 0, 0, 0), part(G.cyl(3.0, 3.5, 14, 10), 0, 0, 10.5, PI2), part(G.cyl(4.4, 4.4, 2.5, 10), 0, 0, 17.6, PI2),
      part(G.cyl(4.0, 4.0, 1.4, 10), 0, 0, 5.4, PI2), part(G.box(3, 2, 6), 0, 5, 1),
    ]), HULL_D, this.cannon);
    mesh(merged('tbCoils', [...[7.5, 10, 12.5, 15].map((z) => part(G.tor(3.9, 0.42, 6, 14), 0, 0, z))]), CANNON_GLOW, this.cannon);
    this.cannonRing = mesh(merged('tbRing', [part(G.tor(4.6, 0.55, 6, 16), 0, 0, 19.2)]), CANNON_GLOW, this.cannon);
    this.cannonGlow = this.makeGlow(0xffa030, 20, this.cannon, 0, 0, 20.5);
    const aimMat = beamMat(0xffa030).clone();
    this.aimLine = mesh(beamGeo, aimMat, this.ctx.scene); this.aimLine.visible = false;

    // mooring towers and cables. Each cable is two halves so it can whip apart when its clamp is shot away.
    this.cables = MOORINGS.map((m, i) => {
      const C = new THREE.Vector3(...m.clamp), A = new THREE.Vector3(...m.anchor);
      const tower = mesh(merged('tbTower', [
        part(G.cyl(2.8, 3.8, 84, 8), 0, -42, 0), part(G.cyl(4.6, 3.4, 2.6, 8), 0, -1.3, 0), part(G.cyl(3.4, 3.4, 1.2, 8), 0, 0.6, 0),
        ...[-10, -22, -36].map((y) => part(G.tor(3.5, 0.5, 5, 10), 0, y, 0, PI2)),
        part(G.box(1.4, 1.4, 5.2), 0, 1.6, 0),
      ]), HULL_D, b);
      tower.position.copy(A);
      mesh(merged('tbTowerL', [part(G.tor(3.9, 0.36, 5, 12), 0, -3.4, 0, PI2), part(G.tor(4.1, 0.3, 5, 12), 0, -6.4, 0, PI2)]), AMBER, tower);
      const L = C.distanceTo(A);
      const half = (pivot, to) => ({ pivot: pivot.clone(), dir0: _d.subVectors(to, pivot).normalize().clone(), len: L / 2, dark: mesh(beamGeo, CABLE, b), glow: mesh(beamGeo, TENSION, b) });
      return { i, C, A, halves: [half(C, A), half(A, C)], cut: false, fall: 0 };
    });
    for (const c of this.cables) this.placeCable(c, 0);

    // cable clamps (critical, P1)
    this.clamps = [];
    MOORINGS.forEach((m, i) => {
      const a = new THREE.Group(); a.position.set(...m.clamp); b.add(a);
      const blk = mesh(merged('tbClamp', [part(G.box(3.8, 4.6, 3.8), 0, 1.0, 0), part(G.box(5.0, 0.8, 2.2), 0, 3.6, 0), part(G.cyl(1.3, 1.3, 5.0, 8), 0, 0.6, 0, PI2)]), HULL_D, a);
      const ring = mesh(merged('tbClampRing', [part(G.tor(2.3, 0.36, 5, 14), 0, 0.8, 2.0)]), AMBER, a);
      const halo = glowSprite(0xffb040, 12, a, 0, 1.2, 2.2);
      const p = this.addPart(a, { name: 'mooringClamp', radius: 4.6 * SCALE, hp: 24, points: 400, critical: true, explScale: 4, explColor: 0xffc060 }, [blk, ring]);
      p.ring = ring; p.halo = halo; p.idx = i; this.clamps.push(p);
    });

    // armour plates on the foredeck (critical, P2). Slower to shoot down, but a reflected siege shell breaks one outright.
    this.plates = []; this.cracks = [];
    PLATES.forEach((pos, i) => {
      const crack = mesh(merged('tbCrackPad', [part(G.box(4.8, 0.3, 6.2), 0, 0, 0), part(G.box(0.5, 0.3, 8.6), 0.6, 0, 0, 0, 0.35, 0)]), CRACK, b);
      crack.position.set(pos[0], 1.85, pos[2]); crack.visible = false; this.cracks.push(crack);
      const a = new THREE.Group(); a.position.set(...pos); a.rotation.z = pos[0] < 0 ? 0.08 : -0.08; b.add(a);
      // a standing armour slab: leans back, amber edge lights, a keel plate behind it
      const slab = mesh(merged('tbSlab', [
        part(G.box(4.8, 4.6, 1.5), 0, 0, 0, -0.16), part(G.box(3.6, 1.0, 1.9), 0, 2.7, -0.4, -0.16),
        part(G.box(1.5, 2.6, 2.6), 0, -1.0, -1.5), part(G.box(5.4, 0.7, 2.4), 0, -2.3, -0.4),
      ]), PLATE, a);
      const rim = mesh(merged('tbSlabRim', [
        part(G.box(0.34, 4.2, 0.4), 2.35, 0, 0.8, -0.16), part(G.box(0.34, 4.2, 0.4), -2.35, 0, 0.8, -0.16),
        part(G.box(3.8, 0.34, 0.4), 0, 1.5, 0.85, -0.16), part(G.box(3.8, 0.34, 0.4), 0, -0.6, 0.85, -0.16),
      ]), AMBER, a);
      const p = this.addPart(a, { name: 'armourPlate', radius: 3.4 * SCALE, hp: 26, armor: 0.6, points: 300, critical: true, explScale: 4, explColor: 0xffd090, debrisColor: 0x9db6b0 }, [slab, rim]);
      p.idx = i; this.plates.push(p);
    });

    // reactor core in a silo under two sliding hatches (critical, P3)
    mesh(merged('tbPed', [part(G.cyl(4.8, 5.6, 1.5, 12), 0, 0, 0)]), HULL_D, b).position.set(0, 2.0, 8);
    this.coreA = new THREE.Group(); this.coreA.position.set(0, 1.4, 8); b.add(this.coreA);
    const cmesh = mesh(G.oct(3.0), CORE_GLOW, this.coreA); cmesh.scale.set(1, 1.15, 1);
    mesh(G.ico(1.7, 0), CORE_GLOW, this.coreA);
    this.coreHalo = glowSprite(0xffcf6a, 14, this.coreA);
    this.hatch = [-1, 1].map((s) => { const m = mesh(merged('tbHatch', [part(G.box(4.4, 0.9, 9), 0, 0, 0), part(G.box(4.4, 0.5, 1), 0, 0.6, 3.5)]), HULL, b); m.position.set(s * 2.2, 3.1, 8); m.userData.s = s; return m; });
    this.core = this.addPart(this.coreA, { name: 'core', radius: 4.3 * SCALE, hp: 42, points: 1500, critical: true, exposed: false, explScale: 6 }, [cmesh]);
    // the split down the deck that shows in P3
    this.seam = mesh(merged('tbSeam', [part(G.box(1.0, 0.3, 24), 0, 0, 0), part(G.box(0.6, 0.3, 10), 2.2, 0, 6, 0, 0.5, 0), part(G.box(0.6, 0.3, 9), -2.0, 0, -7, 0, -0.45, 0)]), CRACK, b);
    this.seam.position.set(0, 2.35, 4); this.seam.visible = false;

    // overheat vents (P3 hazard, not targets)
    this.vents = VENTS.map((pos) => {
      const g = new THREE.Group(); g.position.set(...pos); b.add(g);
      mesh(merged('tbVent', [part(G.cyl(1.2, 1.7, 2.6, 8), 0, 0, 0), part(G.tor(1.3, 0.28, 5, 10), 0, 1.3, 0, PI2)]), HULL_D, g);
      const cap = mesh(G.cyl(0.95, 0.95, 0.2, 8), VENT_GLOW, g); cap.position.y = 1.35;
      const halo = this.makeGlow(0xff5a20, 8, g, 0, 2, 0);
      return { g, cap, halo };
    });

    // deck turrets
    this.turrets = [];
    for (const s of [-1, 1]) {
      const a = new THREE.Group(); a.position.set(s * 8, 1.6, -11); b.add(a);
      const base = mesh(merged('tbTB', [part(G.cyl(2.4, 3.0, 1.6, 8), 0, 0.3, 0), part(G.box(3.4, 2.2, 3.4), 0, 1.8, 0)]), HULL_D, a);
      const gun = new THREE.Group(); gun.position.y = 2.4; a.add(gun);
      const barrel = mesh(merged('tbTG', [...sym(part(G.cyl(0.4, 0.5, 5.6, 6), 0.9, 0, 3.0, PI2)), part(G.box(3, 1.6, 2.4))]), HULL, gun);
      const lamp = mesh(merged('tbTE', [part(G.oct(0.5), 0, 1.0, 0.4)]), AMBER, gun);
      const p = this.addPart(a, { name: 'deckTurret', radius: 3.0 * SCALE, hp: 10, points: 300, explScale: 3 }, [base, barrel, lamp]);
      p.gun = gun; p.glow = this.makeGlow(0xffa030, 6, gun, 0, 0, 6); p.charge = 0; p.burst = 0; p.cd = 2 + Math.random() * 2; p.side = s;
      this.turrets.push(p);
    }
    // missile pods
    this.pods = [];
    for (const s of [-1, 1]) {
      const a = new THREE.Group(); a.position.set(s * 9.6, 2.6, -1); b.add(a);
      const body = mesh(merged('tbPod', [part(G.box(6.4, 6, 11)), part(G.box(7, 1, 4), 0, 3.4, -2)]), HULL_D, a);
      const tubes = [];
      for (let i = 0; i < 6; i++) tubes.push(part(G.cyl(0.85, 0.85, 0.6, 8), ((i % 3) - 1) * 1.9, i < 3 ? 1.4 : -1.4, 5.6, PI2));
      const tg = mesh(merged('tbTubes', tubes), AMBER, a);
      const p = this.addPart(a, { name: 'missilePod', radius: 3.4 * SCALE, hp: 14, points: 300, explScale: 3.4 }, [body, tg]);
      p.glow = this.makeGlow(0xffa030, 10, a, 0, 0, 6.5); p.cd = 4 + Math.random() * 3; p.charge = 0; p.side = s;
      this.pods.push(p);
    }
    this.aimOffset.set(0, 6, 8);
  }

  intro() {
    const D = this.cinDelay ?? 0;   // the comm lines wait for the entrance takeover to end
    this.after(D + 0.3, () => this.comm('CONTROL', 'Landing fleet flagship, TIDEBREAKER, on the reef line. Engage.'));
    this.after(D + 3.5, () => this.comm('LUMEN', 'Large contact, barge class. Three moorings.', 3.4));
    this.after(D + 7.4, () => this.comm('FERRO', 'A great deal of rope for a ship that means to leave.', 3.4));
    this.after(D + 1.6, () => this.ctx.ui?.hint?.('Shoot the amber cable clamps to cut the moorings', 5));
    this.cutCount = 0; this.calm = 0; this.cannonState = 'idle'; this.cannonT = 3; this.cannonShots = 0;
    this.hatchOpen = 0; this.coreUp = 0; this.missiles = 0; this.lurch = 0; this.lurchDir = 0;
    this.shells = new Set(); this.hinted = false; this.reflectNoted = false;
    this.cycle = { state: 'sealed', t: 0, dur: 1.6, ventStage: 0 }; this.ventGlow = 0; this.crackGlow = 0;
    this.offReflect = this.ctx.events.on('shot:reflected', ({ shot }) => this.shellReflected(shot));
  }

  onPhase(n, silent) {
    if (n === 1) { for (const p of this.parts) p.exposed = p.name !== 'armourPlate' && p !== this.core; return; }
    if (silent) return;
    if (n === 2) {
      this.calm = 2.2;
      for (const p of this.plates) p.exposed = true;
      this.comm('LUMEN', 'Moorings clear. Hull adrift. Siege cannon charging.', 3.4);
      this.after(3.6, () => this.comm('VEX', 'Wing two, cannon bearing zero zero zero. Charge in progress.', 3.4));
      this.cannonT = 4.5;
    } else if (n === 3) {
      this.calm = 1.2;
      this.core.exposed = false; this.cycle = { state: 'sealed', t: 0, dur: 1.8, ventStage: 0 };
      this.comm('LUMEN', 'Plating breached. Core venting on a cycle.', 3.4);
      this.after(3.8, () => this.comm('FERRO', 'It is now on fire. That is unlikely to help it.', 3.2));
      this.cannonT = 2.2;
    }
  }

  partDestroyed(p) {
    p.anchor.visible = false;
    if (p.name === 'mooringClamp') {
      const c = this.cables[p.idx]; c.cut = true;
      this.lurch = 1; this.lurchDir = MOORINGS[p.idx].clamp[0] >= 0 ? -1 : 1; if (!this.lurchDir) this.lurchDir = Math.random() < 0.5 ? -1 : 1;
      this.ctx.fx?.explosion?.(_o.set(...c.A.toArray()).applyMatrix4(this.body.matrixWorld), { scale: 2.6, color: 0xffb060 });
      this.ctx.audio?.sfx?.('whoosh', { position: this.position, pitch: 0.6 });
      this.cutCount++;
      if (this.cutCount === 1) this.comm('PIP', 'mooring 1 severed, 2 remain', 2.6);
      else if (this.cutCount === 2) this.comm('LUMEN', 'Hull stress rising. One mooring remaining.', 3.0);
      if (this.cutCount >= 3 && this.phase === 1) this.setPhase(2);
    } else if (p.name === 'armourPlate') {
      this.cracks[p.idx].visible = true;
      const left = this.plates.filter((q) => q.alive && q !== p).length;
      if (left === 2) this.comm('PIP', 'plating 2 of 4 remaining', 2.6);
      if (left <= 0 && this.phase === 2) this.setPhase(3);
    } else if (p === this.core) this.bossDown();
  }

  startDeath(ctx) {
    super.startDeath(ctx);
    for (const s of this.shells) s.alive = false;
    this.shells.clear(); this.aimLine.visible = false; this.setGlow(this.cannonGlow, 0);
    for (const v of this.vents) this.setGlow(v.halo, 0);
    this.after(0.5, () => this.comm('CONTROL', 'Flagship down. Landing fleet has lost its command barge. Logging.', 3.4));
  }

  focus(out) { return this.body.localToWorld(out.set(0, 3, 2)); }

  // ---- defeat: blasts walk from the stern to the bow, the siege cannon cooks off and is thrown clear, the reactor goes up in a plume ----
  onDeathStart() { this.cannonV = null; this.cookAt = this.dp.burstAt - 0.55; }

  deathPoint(out, k = 0.5) {
    if (k >= 1 && this.ds.burst) {   // aftermath: a plume of fire rises from the wreck
      out.set((Math.random() - 0.5) * 10, 4 + Math.random() * 26, (Math.random() - 0.5) * 16);
      return this.body.localToWorld(out);
    }
    out.set((Math.random() - 0.5) * 20, 1 + Math.random() * 7, -26 + 48 * k + (Math.random() - 0.5) * 8);
    return this.body.localToWorld(out);
  }

  deathTick(dt, t, S, ctx) {
    const D = this.dp;
    if (!S.burst) {
      const k = Math.min(1, t / D.burstAt);
      this.setGlow(this.cannonGlow, Math.min(1, k * 1.4), 24); this.cannonRing.rotation.z += dt * 3 * k;
      if (Math.random() < dt * (6 + 16 * k)) { this.deathPoint(_o, k); ctx.fx?.smoke?.(_o, 1.2); ctx.fx?.sparks?.(_o, null, 4); }
      // cook off: the cannon bursts and is thrown forward and up
      if (!this.cannonV && t >= this.cookAt) {
        this.cannonV = new THREE.Vector3((Math.random() < 0.5 ? -1 : 1) * (6 + Math.random() * 6), 12, -4);
        this.cannon.getWorldPosition(_o);
        ctx.fx?.explosion?.(_o, { scale: 7, color: 0xffb040, debrisColor: 0x3a6068 }); ctx.fx?.debris?.(_o, 14, 0x3a6068); ctx.fx?.shake?.(0.9, 0.4);
        ctx.audio?.sfx?.('bigExplosion', { position: _o, volume: 0.9 });
      }
    }
    if (this.cannonV) {
      const cv = this.cannonV; this.cannon.position.addScaledVector(cv, dt / SCALE); cv.y -= 14 * dt;
      this.cannon.rotation.x -= dt * 1.6; this.cannon.rotation.z += dt * 2.2;
      if (S.burst) { const sc = Math.max(0, 1 - ((t - D.burstAt) / 1.4) ** 2); this.cannon.scale.setScalar(sc); }
      if (Math.random() < dt * 10) { this.cannon.getWorldPosition(_o); ctx.fx?.smoke?.(_o, 1.5); }
    }
  }

  hideAtBurst() { for (const c of this.body.children) if (c !== this.cannon) c.visible = false; }

  onBurst(ctx, c) {
    // the fireball climbs out of the water: a spray ring at the surface and a second, taller blast
    const wy = (ctx.world?.info?.floorY ?? -26) + 1;
    _o.set(c.x, wy, c.z); ctx.fx?.explosion?.(_o, { scale: 6, color: 0xcfeaff, debrisColor: 0xcfeaff }); ctx.fx?.shockwave?.(_o, { radius: 40, color: 0xcfeaff });
    _o.set(c.x, c.y + 14, c.z); ctx.fx?.explosion?.(_o, { scale: 6, big: true, color: 0xff8a2a, debrisColor: 0x3a6068 });
  }

  // fight
  fight(dt, ctx) {
    this.phaseT += dt;
    if (this.calm > 0) this.calm -= dt;
    this.lurch = Math.max(0, this.lurch - dt * 0.8);
    // moored: hard on its cables, sways little and gets looser with every cable cut. adrift: wallows and yaws.
    const moored = this.phase === 1;
    const amp = moored ? 1.2 + this.cutCount * 1.8 : this.phase === 2 ? 4.2 : 3.4;
    const sp = moored ? 0.3 : this.phase === 3 ? 0.5 : 0.36;
    const k = Math.min(1, dt * 1.6), r = this.rel;
    r.x += (Math.sin(this.age * sp) * amp + this.lurchDir * this.lurch * 3 - r.x) * k;
    r.y += (-3 + Math.sin(this.age * 0.5) * (moored ? 0.8 : 1.6) - r.y) * k;
    r.z += (-this.holdZ + Math.sin(this.age * 0.3) * (moored ? 3 : 10) - r.z) * k;
    this.group.rotation.y += ((moored ? Math.sin(this.age * 0.4) * 0.02 : Math.sin(this.age * 0.33) * 0.2) - this.group.rotation.y) * Math.min(1, dt * 1.2);
    const busy = this.calm > 0;
    // covered parts must not soak up shots meant for the parts behind them
    for (const q of this.plates) q.untargetable = this.phase < 2;
    this.core.untargetable = this.phase < 3;
    if (this.phase === 3) this.cycleLogic(dt, ctx, busy);
    this.turretLogic(dt, ctx, busy);
    this.podLogic(dt, ctx, busy);
    if (this.phase >= 2 && !busy) this.cannonLogic(dt, ctx);
    else if (this.cannonState !== 'idle') this.cannonReset();
  }

  // P3: sealed (vents) -> opening -> open (core exposed) -> closing
  cycleLogic(dt, ctx, busy) {
    const C = this.cycle; C.t += dt;
    if (C.state === 'sealed') {
      this.core.exposed = false;
      this.ventGlow = C.t < 2.6 ? Math.min(1, C.t / 1.1) : 0;
      if (!busy && C.ventStage === 0 && C.t > 1.1) { C.ventStage = 1; C.vi = 0; C.vt = 0; }
      if (C.ventStage === 1) {
        C.vt -= dt;
        if (C.vt <= 0 && C.vi < this.vents.length) {
          const v = this.vents[C.vi++]; C.vt = 0.22;
          v.g.getWorldPosition(_o); _o.y += 3;
          this.shootAt(_o, 40, 0.1, { radius: 1.5, size: 1.1, color: 0xff6a20, glowColor: 0xff3a10, damage: 9, cap: 50, leadK: 0.5 });
          ctx.audio?.sfx?.('whoosh', { position: _o, pitch: 1.2 }); ctx.fx?.smoke?.(_o);
        }
      }
      if (C.t >= C.dur) { this.cycle = { state: 'opening', t: 0, dur: 0.7, ventStage: 0 }; ctx.audio?.sfx?.('bossCharge', { position: this.core.position }); }
    } else if (C.state === 'opening') {
      this.ventGlow = 0; this.core.exposed = false;
      if (C.t >= C.dur) { this.cycle = { state: 'open', t: 0, dur: 3.4, ventStage: 0 }; }
    } else if (C.state === 'open') {
      this.core.exposed = true; this.ventGlow = 0;
      if (C.t >= C.dur) this.cycle = { state: 'closing', t: 0, dur: 0.5, ventStage: 0 };
    } else if (C.state === 'closing') {
      this.core.exposed = false;
      if (C.t >= C.dur) this.cycle = { state: 'sealed', t: 0, dur: 3.6, ventStage: 0 };
    }
  }

  turretLogic(dt, ctx, busy) {
    for (const t of this.turrets) {
      if (!t.alive) continue;
      t.gun.lookAt(ctx.player.position);
      if (t.charge > 0) {
        t.charge -= dt; this.setGlow(t.glow, 1 - Math.max(0, t.charge) / 0.75, 24);
        if (t.charge <= 0) { this.setGlow(t.glow, 0); t.burst = 3; t.bcd = 0; }
      } else if (t.burst > 0) {
        t.bcd -= dt;
        if (t.bcd <= 0) {
          _o.copy(t.glow.position); t.gun.localToWorld(_o);
          this.shootAt(_o, 56, 0.045, { radius: 0.9, size: 0.75, color: 0xffb02a, damage: 7, cap: 60 });
          t.burst--; t.bcd = 0.2;
          if (t.burst === 0) t.cd = (3.4 + Math.random() * 1.6) * this.fireScale * (this.phase === 3 ? 0.7 : 1);
        }
      } else if (!busy) { t.cd -= dt; if (t.cd <= 0) t.charge = 0.75; }
    }
  }

  podLogic(dt, ctx, busy) {
    this.missiles = 0; for (const e of ctx.groups.enemies) if (e.type === 'missile' && e.alive && e.spawnedBy === this) this.missiles++;
    for (const p of this.pods) {
      if (!p.alive) continue;
      if (p.charge > 0) {
        p.charge -= dt; this.setGlow(p.glow, 1 - Math.max(0, p.charge) / 0.9, 22);
        if (p.charge <= 0) {
          this.setGlow(p.glow, 0);
          const n = this.phase === 3 ? 4 : 3;
          for (let i = 0; i < n; i++) this.after(i * 0.24, () => { if (p.alive && !this.dying) this.launchMissile(p, i); });
          p.cd = (6.5 + Math.random() * 2) * this.fireScale * (this.phase === 3 ? 0.75 : 1);
        }
      } else if (!busy) { p.cd -= dt; if (p.cd <= 0 && this.missiles < 4) p.charge = 0.9; }
    }
    // P3: hull vents launch extra missiles if the pods are gone
    if (this.phase === 3 && !busy && this.pods.every((p) => !p.alive)) {
      this.ventCd = (this.ventCd ?? 3) - dt;
      if (this.ventCd <= 0 && this.missiles < 4) { this.ventCd = 6 * this.fireScale; for (let i = 0; i < 3; i++) this.after(i * 0.3, () => this.launchMissile(this.core.alive ? this.core : this.pods[0], i, true)); }
    }
  }

  launchMissile(p, i, fromCore = false) {
    if (this.dying) return;
    const ctx = this.ctx, pl = ctx.player.position;
    _o.copy(p.position); _o.z += 6 * SCALE; _o.x += (i - 1) * 1.6 * SCALE;
    if (_o.z > pl.z - 30) return;
    _d.set((p.side ?? (i - 1)) * 0.5, 0.45, 0.6).normalize().multiplyScalar(26);
    this.spawnMinion('missile', { position: _o.clone(), velocity: _d.clone(), damage: 12, speed: 44 });
    ctx.audio?.sfx?.('whoosh', { position: _o, pitch: 0.8 });
    ctx.fx?.muzzleFlash?.(_o, _d);
  }

  // siege cannon
  muzzleWorld(out) { out.set(0, 0, 20.5); this.cannon.localToWorld(out); return out; }

  cannonReset() { this.cannonState = 'idle'; this.cannonT = 2; this.setGlow(this.cannonGlow, 0); this.aimLine.visible = false; }

  cannonLogic(dt, ctx) {
    this.cannonT -= dt;
    if (this.cannonState === 'idle') {
      if (this.cannonT <= 0) {
        this.cannonState = 'charge'; this.cannonT = this.phase === 3 ? 1.8 : 2.3; this.cannonDur = this.cannonT; this.aimLocked = false;
        ctx.audio?.sfx?.('bossCharge', { position: this.position }); ctx.ui?.warning?.('SIEGE CANNON');
        if (!this.hinted && this.phase >= 2) { this.hinted = true; ctx.ui?.hint?.('FLIP: Q or E sends the siege shell back into the hull', 5); }
      }
    } else if (this.cannonState === 'charge') {
      const u = 1 - this.cannonT / this.cannonDur;
      this.setGlow(this.cannonGlow, u, 26);
      const lockAt = 0.62;
      if (u < lockAt) { // track the player until the lock, then freeze the aim so a sidestep works
        this.muzzleWorld(_o);
        this.aimDir = this.aimDir ?? new THREE.Vector3();
        leadDir(ctx, _o, 46, 0, 0.0, this.aimDir);
      } else if (!this.aimLocked) this.aimLocked = true;
      if (u > 0.3) { // aim line
        this.muzzleWorld(_o); this.aimLine.visible = true;
        this.aimLine.position.copy(_o); _t.copy(_o).add(this.aimDir); this.aimLine.lookAt(_t);
        const w = 0.25 + (this.aimLocked ? 0.35 : 0) + Math.sin(this.age * 40) * 0.05; this.aimLine.scale.set(w, w, 260);
        this.aimLine.material.opacity = this.aimLocked ? 0.95 : 0.4;
      }
      if (this.cannonT <= 0) this.fireCannon(ctx);
    } else if (this.cannonState === 'recover') {
      if (this.cannonT <= 0) {
        if (this.phase === 3 && this.cannonShots % 2 === 1) { this.cannonState = 'charge'; this.cannonT = 1.2; this.cannonDur = 1.2; this.aimLocked = false; }
        else { this.cannonState = 'idle'; this.cannonT = (this.phase === 3 ? 3.6 : 5.2) * this.fireScale; }
      }
    }
  }

  fireCannon(ctx) {
    this.muzzleWorld(_o);
    const shell = this.shoot(_o, this.aimDir, { speed: 46, radius: 3.4, damage: 26, color: 0xffa030, cap: 70, size: 1.15 });
    if (shell) { for (const s of this.shells) if (!s.alive) this.shells.delete(s); this.shells.add(shell); }
    ctx.fx?.explosion?.(_o, { scale: 3, color: 0xffb060 });
    ctx.fx?.shake?.(1.0, 0.4); ctx.audio?.sfx?.('bossCannon', { position: _o });
    this.setGlow(this.cannonGlow, 0); this.aimLine.visible = false;
    this.cannonState = 'recover'; this.cannonT = 0.7; this.cannonShots++; this.recoil = 1;
  }

  /** A siege shell was deflected by a barrel roll: send it into the armour plating (or the core once the hull is open). */
  shellReflected(shot) {
    if (!this.shells?.has(shot) || this.dying) return;
    let best = null, bd = 1e9;
    const cands = this.phase === 2 || this.plates.some((p) => p.alive) ? this.plates : [this.core];
    for (const p of cands) if (p.alive) { const d = p.position.distanceToSquared(shot.position); if (d < bd) { bd = d; best = p; } }
    shot.homing = best; shot.turn = 9; shot.life = shot.maxLife = 3.2; shot.damage = SHELL_DAMAGE; shot.radius = Math.max(shot.radius, 1.6); shot.size = 1.5;
    if (!this.reflectNoted) { this.reflectNoted = true; this.comm('LUMEN', 'Deflected round inbound on own hull.', 2.6); }
  }

  /** Part.takeDamage hook: reflected siege shells crack plating hard (and hit the core even while it is sealed). */
  onReflectedHit(p, shot) {
    if (!this.shells.has(shot)) return null;
    this.shells.delete(shot);
    if (p.name === 'armourPlate') {
      for (const q of this.plates) if (q !== p && q.alive && q.exposed && Math.abs(q.position.x - p.position.x) < 30 && Math.sign(q.position.x - this.position.x) === Math.sign(p.position.x - this.position.x)) { q.takeDamage(SHELL_SPLASH / q.armor, 'shell', this.ctx); break; }
      return { damage: SHELL_DAMAGE, force: true };
    }
    if (p === this.core) return { damage: CORE_SHELL_DAMAGE, force: true };
    return { damage: 12, force: false };
  }

  // visuals
  placeCable(c, dt) {
    if (c.cut) c.fall = Math.min(1, c.fall + dt * 0.75);
    const e = c.fall * c.fall, sway = c.cut ? Math.sin(this.age * 1.7 + c.i) * 0.12 * c.fall : 0;
    const tense = c.cut ? 0 : 1;
    for (const h of c.halves) {
      _d.copy(h.dir0);
      if (c.cut) _d.lerp(DOWN, Math.min(1, e * 1.05)).add(_c.set(sway, 0, sway * 0.5)).normalize();
      h.dark.position.copy(h.pivot); h.dark.quaternion.setFromUnitVectors(Z, _d); h.dark.scale.set(0.85, 0.85, h.len);
      h.glow.position.copy(h.pivot); h.glow.quaternion.copy(h.dark.quaternion);
      const gw = tense * (0.34 + Math.sin(this.age * 6 + c.i * 2) * 0.06); h.glow.scale.set(gw, gw, h.len); h.glow.visible = tense > 0;
    }
  }

  animate(dt, ctx) {
    const t = this.age;
    // hover: gentle heave and roll, repulsor pads pulse
    this.body.position.y = Math.sin(t * 1.7) * (this.phase === 1 ? 0.25 : 0.6);
    const lean = this.phase === 1 ? this.lurchDir * this.lurch * 0.05 : 0;
    this.body.rotation.z = Math.sin(t * 0.8) * (this.phase === 1 ? 0.01 : 0.03) + lean; this.body.rotation.x = Math.sin(t * 1.1 + 1) * 0.012;
    this.pads.forEach((p, i) => p.scale.setScalar(6 + Math.sin(t * 5 + i * 1.7) * 0.9));
    for (const e of this.engs) e.scale.setScalar(12 + Math.sin(t * 22) * 0.8);
    this.cannonRing.rotation.z += dt * (this.cannonState === 'charge' ? 9 : 0.8);
    if (this.recoil > 0) { this.recoil = Math.max(0, this.recoil - dt * 3); this.cannon.position.z = 24 - this.recoil * 3; }
    // cables
    for (const c of this.cables) this.placeCable(c, dt);
    for (const p of this.clamps) if (p.alive) { p.ring.rotation.z += dt * 1.6; p.halo.scale.setScalar(9 + Math.sin(t * 6 + p.idx * 2) * 1.1); }
    // hatch slides open and the core rises out of the silo while the cycle says open
    const C = this.cycle, want = this.phase === 3 && (C.state === 'open' || C.state === 'opening' || (C.state === 'closing' && C.t < 0.15)) ? 1 : 0;
    this.hatchOpen += (want - this.hatchOpen) * Math.min(1, dt * 3.2);
    for (const h of this.hatch) h.position.x = h.userData.s * (2.2 + this.hatchOpen * 3.4);
    this.coreUp += ((this.core.exposed ? 1 : 0) - this.coreUp) * Math.min(1, dt * 3);
    this.coreA.position.y = 1.4 + this.coreUp * 4.2;
    this.coreHalo.scale.setScalar((this.core.exposed ? 11 : 3 + this.hatchOpen * 3) + Math.sin(t * 8) * 0.9);
    this.coreA.rotation.y += dt * (this.core.exposed ? 2.2 : 0.8);
    // cracked hull and vents
    this.crackGlow += ((this.phase === 3 ? 1 : 0) - this.crackGlow) * Math.min(1, dt * 1.5);
    this.seam.visible = this.crackGlow > 0.05; this.seam.scale.set(1 + this.crackGlow * 0.6, 1, 1);
    for (const v of this.vents) {
      this.setGlow(v.halo, this.ventGlow, 20); v.cap.material.emissiveIntensity = 0.8 + this.ventGlow * 3.4 + (this.phase === 3 ? 0.4 : 0);
      if (this.ventGlow > 0.4 && Math.random() < dt * 8) { v.g.getWorldPosition(_o); ctx.fx?.smoke?.(_o); }
    }
    if (this.phase === 3 && Math.random() < dt * 5) ctx.fx?.smoke?.(this.core.position);
  }

  destroy(ctx) { this.offReflect?.(); this.aimLine?.removeFromParent(); super.destroy(ctx); }
}
