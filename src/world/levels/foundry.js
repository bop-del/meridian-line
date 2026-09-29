// OBSIDIAN FOUNDRY: the Regent's forge. A floor of black glass cut by channels of molten metal, walls of obsidian
// with slow giant gears and hydraulic rams, blue-white smelter beams, narrows, a sealed interior with beam gates and
// spinning rotors, and a wide arena for the final fight.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { Rng, SlotPool, ChunkStreamer, texturedBox, cloudTexture, softDotTexture, billboardPool, gearGeometry } from '../util.js';
import { metalMaterial, motionMetal } from '../materials.js';
import { createMolten } from '../liquids.js';
import { createDust } from '../dust.js';

const info = {
  name: 'OBSIDIAN FOUNDRY', subtitle: "The Regent's forge", length: 8000, bossAt: 7300, music: 'foundry', theme: 'foundry', floorY: -34,
  look: { bloom: 0.8, exposure: 1.0, vignette: 0.5 },
};

const FLOOR = -34;
const FOG = 0x080b14;
const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

/** corridor half width at distance d, plus zone flags */
function layout(d) {
  let hw = 70;
  hw = 70 + (46 - 70) * smooth(1660, 1740, d);
  hw += (62 - 46) * smooth(2300, 2380, d);
  hw += (30 - 62) * smooth(3820, 3900, d);
  hw += (60 - 30) * smooth(4900, 4980, d);
  hw += (250 - 60) * smooth(6250, 6500, d);
  return { hw, interior: d >= 3900 && d <= 4900, narrows: d >= 1700 && d <= 2300, arena: d > 6400 };
}

function buildEnvironment(ctx, W) {
  const res = W.res, root = W.root;
  W.setup({
    fog: { color: FOG, near: 130, far: 1150 },
    sky: { top: 0x010207, mid: 0x060a16, horizon: 0x1a2438, bottom: 0x04060b, sunDir: new THREE.Vector3(0.05, 0.05, -1), sunColor: 0x8fb8ff, sunSize: 0.05, sunGlow: 0.6, stars: 0.12, nebula: 0.3, nebScale: 1.5, nebA: 0x0a1a3c, nebB: 0x101a32, nebC: 0x24427a, horizonWidth: 0.3, haze: 0.55 },
    lights: { sunColor: 0xb0d4ff, sunIntensity: 2.1, sunDir: new THREE.Vector3(-0.3, 0.85, 0.4), skyColor: 0x3a5a90, groundColor: 0xff8a34, hemiIntensity: 1.35, rimColor: 0xff9a44, rimIntensity: 0.9, rimDir: new THREE.Vector3(0.3, -0.15, -1) },
    look: info.look, env: 0.45,
  });

  const floor = createMolten();
  root.add(floor.mesh);

  const uTime = { value: 0 };
  const CH = 11, LEN = 240, SL = 60;
  const metal = metalMaterial(res);
  const geoW = [0, 1, 2].map((i) => res.get('vw' + i, () => texturedBox([34, 24, 44][i], 100, [64, 64, 64][i], 0.035)));
  const wallPools = geoW.map((g) => new SlotPool(g, metal, CH, 8));
  const ridge = new SlotPool(res.get('vridge', () => texturedBox(20, 40, 50, 0.05)), metal, CH, 8);
  const ceil = new SlotPool(res.get('vceil', () => texturedBox(70, 6, 62, 0.05)), metal, CH, 4);
  const beam = new SlotPool(res.get('vbeam', () => texturedBox(1, 5, 7, 0.1)), metal, CH, 3);
  const lintel = new SlotPool(res.get('vlintel', () => texturedBox(1, 12, 20, 0.03)), metal, CH, 2);
  const stackG = res.get('vstack', () => { const g = new THREE.CylinderGeometry(6, 10, 1, 8); g.translate(0, 0.5, 0); return g; });
  const stacks = new SlotPool(stackG, metal, CH, 3);
  const glowMat = (key, hex, mult) => res.get(key, () => new THREE.MeshBasicMaterial({ color: new THREE.Color(hex).multiplyScalar(mult), toneMapped: false }));
  const stripsB = new SlotPool(new THREE.BoxGeometry(1, 1, 1), glowMat('vstripB', 0x8ac8ff, 1.35), CH, 20, { colors: false });
  const stripsA = new SlotPool(new THREE.BoxGeometry(1, 1, 1), glowMat('vstripA', 0xff9a30, 1.6), CH, 8, { colors: false });
  // giant gears (two tooth counts) and hydraulic rams on the walls
  const gearMat = motionMetal(res, 'spin', uTime, { speed: 0.5 });
  const gearA = new SlotPool(res.get('gearA', () => gearGeometry({ teeth: 20, holes: 6 })), gearMat, CH, 3);
  const gearB = new SlotPool(res.get('gearB', () => gearGeometry({ teeth: 32, ri: 0.92, hole: 0.12, holes: 8, thick: 0.1 })), gearMat, CH, 3);
  const ramHousing = new SlotPool(res.get('ramH', () => { const g = new THREE.CylinderGeometry(6.5, 7.2, 8, 10); g.rotateZ(Math.PI / 2); g.translate(3, 0, 0); return g; }), metal, CH, 3);
  const ramRod = new SlotPool(res.get('ramR', () => { const g = new THREE.CylinderGeometry(3.4, 3.4, 12, 10); g.rotateZ(Math.PI / 2); g.translate(8, 0, 0); const p = new THREE.CylinderGeometry(6, 6, 1.6, 10); p.rotateZ(Math.PI / 2); p.translate(14.8, 0, 0); return mergeTwoNonIndexed(g, p); }), motionMetal(res, 'slide', uTime, { amp: 11, speed: 0.45 }), CH, 3, { colors: false });
  // smelter beams: a narrow white core and a wide blue halo, brightness fading up the column
  const beamCore = res.get('beamCoreG', () => columnGeometry(1, 0xffffff));
  const beamHalo = res.get('beamHaloG', () => columnGeometry(1, 0x4a90ff));
  const beamMatA = res.get('beamMatA', () => new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }));
  const beamMatB = res.get('beamMatB', () => new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.32, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false, side: THREE.DoubleSide }));
  const beamsA = new SlotPool(beamCore, beamMatA, CH, 3, { colors: false });
  const beamsB = new SlotPool(beamHalo, beamMatB, CH, 3, { colors: false });
  const flare = billboardPool(res.own(softDotTexture('170,210,255')), CH, 4, { additive: true, opacity: 0.85, near: 60 });
  const glow = billboardPool(res.own(softDotTexture('255,140,40')), CH, 5, { additive: true, opacity: 0.22, near: 100 });
  const smoke = billboardPool(res.own(cloudTexture('60,72,96', '14,18,30')), CH, 5, { opacity: 0.55, near: 80 });
  const all = [...wallPools, ridge, ceil, beam, lintel, stacks, stripsB, stripsA, gearA, gearB, ramHousing, ramRod, beamsA, beamsB, flare, glow, smoke];
  for (const p of all) root.add(p.mesh);
  const dust = createDust({ count: 200, color: 0xffc070, depth: 300, spreadX: 50, spreadY: 32, len: 0.02, opacity: 0.75, seed: 9, rise: 7 });
  root.add(dust.object);
  const tint = [0xffffff, 0xdde4f4, 0xc8d4ea, 0xe8ecf8, 0xb8c4de];

  const stream = new ChunkStreamer({
    len: LEN, count: CH, behind: 1,
    populate(slot, idx, z0) {
      const rng = new Rng(idx * 4241 + 9);
      for (const p of all) p.begin(slot);
      for (let s = 0; s < LEN / SL; s++) {
        const zc = z0 - (s + 0.5) * SL;
        const d = -zc;
        const L = layout(d);
        const hw = L.hw;
        for (const side of [-1, 1]) {
          if (L.arena) {
            if (rng.chance(0.55)) {
              const w = rng.range(0.9, 1.6), h = rng.range(0.8, 2.2);
              wallPools[rng.int(0, 2)].add(side * (hw + rng.range(0, 90)), FLOOR, zc + rng.range(-20, 20), w, h, rng.range(0.9, 1.7), 0, rng.range(-0.15, 0.15), 0, rng.pick(tint));
            }
          } else {
            const wi = L.interior ? 1 : rng.int(0, 2);
            const wWidth = [34, 24, 44][wi];
            const jitter = L.interior ? 0 : rng.range(-4, 6);
            wallPools[wi].add(side * (hw + wWidth / 2 + jitter), FLOOR, zc, 1, L.interior ? 0.85 : rng.range(0.75, 1.5), 1.0, 0, 0, 0, rng.pick(tint));
            if (!L.interior && !L.narrows && rng.chance(0.6)) {
              ridge.add(side * (hw - rng.range(2, 9)), FLOOR, zc + rng.range(-20, 20), 1, rng.range(0.3, 0.6), rng.range(0.6, 1.1), 0, 0, 0, rng.pick(tint));
            }
            // cold seam along the wall inner face, and a molten runoff low down
            const sx = side * (hw + 0.4);
            stripsB.add(sx, rng.range(-6, 30), zc, 0.5, 0.9, SL * 0.8);
            if (rng.chance(0.5)) stripsB.add(sx, rng.range(30, 56), zc, 0.5, 0.9, SL * 0.6);
            if (rng.chance(0.55)) stripsA.add(sx, rng.range(-30, -20), zc, 0.6, 1.4, SL * 0.7);
            if (L.interior) stripsB.add(side * (hw - 0.3), 16.3, zc, 0.6, 0.7, SL * 0.9);
            // gears and rams set into the wall (not in the tight interior)
            if (!L.interior) {
              const gi = s + (idx & 1);
              if (rng.chance(0.4)) {
                const R = rng.range(18, 34), y = rng.range(-8, 34) + (R > 26 ? 6 : 0);
                const pool = rng.chance(0.5) ? gearA : gearB;
                pool.add(side * (hw - 1), y, zc + rng.range(-16, 16), R, R, R * 1.0, 0, Math.PI / 2, 0, rng.chance(0.5) ? 0xffffff : 0xcccccc);
              }
              if (!L.narrows && rng.chance(0.3)) {
                const y = rng.range(-16, 28), z = zc + rng.range(-20, 20);
                const ry = side > 0 ? Math.PI : 0;
                ramHousing.add(side * (hw - 4), y, z, 1, 1, 1, 0, ry, 0, 0xffffff);
                ramRod.add(side * (hw - 4), y, z, 1, 1, 1, 0, ry, 0);
              }
            }
          }
        }
        if (L.interior) ceil.add(0, 18, zc, 1, 1, 1, 0, 0, 0, 0xffffff);
        if (L.interior) stripsB.add(0, 17.2, zc, 2.2, 0.4, SL * 0.7);
      }
      // gantries and heavy lintels across the corridor
      const dz = -z0 - LEN / 2;
      const L2 = layout(dz);
      if (!L2.interior) {
        const n = L2.narrows ? 3 : rng.chance(0.5) ? 1 : 0;
        for (let i = 0; i < n; i++) beam.add(0, rng.range(30, 55), z0 - rng.r() * LEN, (L2.hw + 24) * 2, 1, 1, 0, 0, 0, 0xffffff);
        if (!L2.arena && dz < 6100 && rng.chance(0.75)) lintel.add(0, rng.range(64, 76), z0 - rng.r() * LEN, (L2.hw + 70) * 2, 1, 1, 0, 0, 0, 0xffffff);
      }
      // smelter stacks and beams beyond the walls, molten glow and smoke
      for (let i = 0; i < 3; i++) {
        if (L2.interior) break;
        const h = rng.range(90, 170), x = rng.sign() * (L2.hw + rng.range(60, 220)), z = z0 - rng.r() * LEN;
        stacks.add(x, FLOOR, z, 1, h, 1, 0, 0, 0, 0xffffff);
        flare.add(x, FLOOR + h + 6, z, 46, 46, 1);
      }
      if (!L2.interior) {
        for (let i = 0; i < (L2.arena ? 3 : 2); i++) {
          const inside = !L2.arena && rng.chance(0.5);
          const x = rng.sign() * (inside ? Math.max(38, L2.hw - rng.range(6, 16)) : L2.hw + rng.range(20, L2.arena ? 260 : 120)), z = z0 - rng.r() * LEN;
          const r = rng.range(1.8, 3.4);
          beamsA.add(x, FLOOR, z, r * 0.45, 320, r * 0.45);
          beamsB.add(x, FLOOR, z, r * 1.7, 320, r * 1.7);
        }
      }
      if (!L2.interior) for (let i = 0; i < 5; i++) glow.add(rng.range(-160, 160), FLOOR + 6, z0 - rng.r() * LEN, rng.range(120, 260), rng.range(50, 90), 1);
      for (let i = 0; i < 5; i++) smoke.add(rng.range(-500, 500), rng.range(60, 220), z0 - rng.r() * LEN, rng.range(250, 500), rng.range(90, 180), 1, 0, 0, 0, i % 2 ? 0xffffff : 0xa0b0d0);
      for (const p of all) p.end();
    },
  });

  // a cold fill light that travels with the ship so the black glass catches highlights
  const fill = new THREE.PointLight(0x9ac8ff, 1100, 160, 2);
  W.lights.group.add(fill);

  // slow smelter surge: a pressure pulse that brightens the beams and the floor light every few seconds
  let nextSurge = 4, surge = 0;
  const sky = W.sky.uniforms;

  return {
    update(dt, ctx, force) {
      uTime.value = W.time;
      fill.position.set(ctx.rail.position.x, ctx.rail.position.y + 2, ctx.rail.position.z - 30);
      stream.update(ctx.rail.position.z, 3, !!force);
      floor.update(W.time, ctx.rail.position, FLOOR);
      dust.update(dt, ctx);
      nextSurge -= dt;
      if (nextSurge <= 0) { nextSurge = 6 + Math.random() * 4; surge = 1; }
      surge = Math.max(0, surge - dt * 0.9);
      const pulse = surge * surge;
      sky.uFlash.value = pulse * 0.12;
      W.lights.hemi.intensity = 1.35 + pulse * 0.5;
      beamMatA.opacity = 0.75 + pulse * 0.25 + Math.sin(W.time * 3.1) * 0.05;
      beamMatB.opacity = 0.26 + pulse * 0.2;
    },
    invalidate() { stream.invalidate(); },
    reset(ctx) { dust.reset(ctx); nextSurge = 4; surge = 0; },
    dispose() { W.lights.group.remove(fill); fill.dispose?.(); floor.dispose(); dust.dispose(); for (const p of all) p.mesh.dispose(); sky.uFlash.value = 0; },
  };
}

/** Open cylinder column, unit radius and height, base at y=0, colour fading to black at the top. */
function columnGeometry(r, hex) {
  const g = new THREE.CylinderGeometry(r, r, 1, 10, 6, true);
  g.translate(0, 0.5, 0);
  const p = g.attributes.position, col = new Float32Array(p.count * 3), c = new THREE.Color(hex);
  for (let i = 0; i < p.count; i++) {
    const k = Math.pow(1 - p.getY(i), 1.4);
    col[i * 3] = c.r * k; col[i * 3 + 1] = c.g * k; col[i * 3 + 2] = c.b * k;
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return g;
}

function mergeTwoNonIndexed(a, b) {
  const A = a.toNonIndexed(), B = b.toNonIndexed();
  for (const g of [A, B]) for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(k)) g.deleteAttribute(k);
  return mergeGeometries([A, B], false);
}

// ---------------------------------------------------------------------------------------------- script
function script(ctx, S, W) {
  const T = S.talk;
  const rng = S.rng;
  const pad = (d, x, y) => S.turretPad(d, x, y, { r: 3.6 });

  // Pacing: beam gates with a lane threaded through them, a narrows of bulkheads, rotors, the forge interior, a capacitor
  // past the last gate, then the run to the arena. Escorts: PIP at a fixed spot, FERRO when a lane chain is completed.

  T(15, [['CONTROL', 'Final transit. The Regent\'s forge lies inside that structure. Bring the core down.']]);
  S.wave(260, 'vee', 0, 2, { type: 'grunt', count: 6 });
  S.wave(430, 'pincer', 0, 1, { type: 'interceptor', count: 4 });
  S.cells(600, 'shieldCell', 0, 0, 4, 'arc');
  T(660, [['FERRO', 'Emplacements on the walls. They have opinions about us.']]);
  pad(740, -30, -10); pad(790, 30, -10); pad(850, -30, -10); pad(900, 30, -10);
  S.wave(800, 'convoy', 0, 0, { type: 'gunship', count: 3 });

  // smelter beam gates, with a slipstream lane that only works if you time it
  S.comm(930, 'LUMEN', 'Smelter beams cycling. 3.6 second period.', 3.2);
  S.hint(1010, 'GATES: fly through while the beams are dark', 5);
  S.obstacle(1080, 'laserGate', 0, 0, { kind: 'twin', phase: 0.4 });
  S.wave(1100, 'line', 0, 2, { type: 'grunt', count: 5 });
  S.obstacle(1200, 'laserGate', 0, 0, { kind: 'low', phase: 1.6 });
  S.obstacle(1280, 'laserGate', 0, 0, { kind: 'high', phase: 0.9 });
  S.cells(1060, 'shieldCell', 0, 0, 8, 'wave');
  S.obstacle(1440, 'spinner', 0, 0, { speed: 1.0, dir: 1 });
  S.wave(1420, 'circle', 0, 0, { type: 'dart', count: 6 });
  S.pickup(1560, 'repair', 8, 2);
  S.wave(1600, 'vee', 0, 2, { type: 'interceptor', count: 5 });

  // the narrows: bulkheads with openings
  T(1690, [['VEX', 'Wing two. Bulkhead openings ahead: left, right, centre.']]);
  S.obstacle(1800, 'wall', 0, 0, { ox: -7, oy: 1 });
  S.obstacle(1890, 'wall', 0, 0, { ox: 7, oy: -1 });
  S.obstacle(1980, 'wall', 0, 0, { ox: 0, oy: 2 });
  S.cells(1780, 'shieldCell', 0, 0, 8, 'slalom');
  S.enemy(1860, 'bomber', 0, 3);
  S.wave(1940, 'wave', 0, 1, { type: 'grunt', count: 6 });
  S.obstacle(2080, 'wall', 0, 0, { ox: -6, oy: -2 });
  S.obstacle(2170, 'wall', 0, 0, { ox: 6, oy: 2 });

  // PIP is pinned against a beam gate
  S.pickup(2360, 'bomb', -8, 2);
  S.escort('pip', { trigger: 'dist', at: 2440, type: 'grunt', x: 12, ahead: 170, time: 18, trouble: 'pinned', note: ['LUMEN', 'Escort PIP integrity falling. Clear the contact.'] });
  S.wave(2560, 'pincer', 0, 0, { type: 'gunship', count: 4 });

  // rotors and beam gates
  S.obstacle(2780, 'spinner', 0, 0, { speed: 1.1, dir: 1 });
  S.obstacle(2860, 'spinner', 0, 0, { speed: 1.25, dir: -1, angle: 0.8 });
  S.wave(2840, 'circle', 0, 0, { type: 'dart', count: 8 });
  S.obstacle(3000, 'laserGate', 0, 0, { kind: 'center', phase: 0 });
  S.obstacle(3080, 'laserGate', 0, 0, { kind: 'twin', phase: 1.5 });
  S.obstacle(3160, 'laserGate', 0, 0, { kind: 'left', phase: 0.7 });
  S.wave(3120, 'vee', 0, 2, { type: 'interceptor', count: 6 });
  for (let i = 0; i < 5; i++) S.enemy(3290 + i * 10, 'mine', -14 + i * 7, (i % 2) * 5 - 2);
  S.cells(3340, 'shieldCell', 0, 0, 4, 'spiral');
  S.escort('ferro', { trigger: 'cells', arm: 3330, giveUp: 3620, type: 'interceptor', x: -15, ahead: 170, time: 18, trouble: 'cutoff', note: ['LUMEN', 'Escort FERRO integrity falling. Clear the contact.'] });
  S.enemy(3420, 'carrier', 0, 8, { ahead: 380 });
  S.enemy(3560, 'swarmer', 0, 0, { count: 12 });
  S.wave(3650, 'convoy', 0, 0, { type: 'gunship', count: 4 });
  S.pickup(3700, 'repair', -8, 3);

  // forge interior
  T(3720, [['LUMEN', 'Forge interior. Heavy resistance. Hull temperature rising.']]);
  S.obstacle(3905, 'wall', 0, 0, { ox: 0, oy: 0, ow: 38, oh: 24 });
  S.cells(3960, 'shieldCell', 0, 0, 8, 'line');
  S.obstacle(4030, 'laserGate', 0, 0, { kind: 'twin', phase: 0.2 });
  pad(4060, -26, 0); pad(4100, 26, 0);
  S.wave(4020, 'circle', 0, 0, { type: 'dart', count: 7 });
  S.obstacle(4130, 'spinner', 0, 0, { speed: 1.15, dir: 1 });
  S.obstacle(4220, 'laserGate', 0, 0, { kind: 'low', phase: 1.0 });
  S.wave(4260, 'pincer', 0, 0, { type: 'grunt', count: 6 });
  S.obstacle(4310, 'pylon', 9, 0, { h: 52 });
  S.obstacle(4370, 'pylon', -9, 0, { h: 52 });
  S.obstacle(4430, 'pylon', 9, 0, { h: 52 });
  S.wave(4350, 'vee', 0, 2, { type: 'interceptor', count: 5 });
  S.obstacle(4520, 'wall', 0, 0, { ox: 4, oy: -1, ow: 24, oh: 16 });
  S.obstacle(4610, 'laserGate', 0, 0, { kind: 'center', phase: 0.9 });
  pad(4640, -26, 2); pad(4680, 26, 2);
  S.obstacle(4700, 'spinner', 0, 0, { speed: 1.2, dir: -1 });
  S.wave(4700, 'convoy', 0, 0, { type: 'gunship', count: 3 });
  S.obstacle(4890, 'wall', 0, 0, { ox: 0, oy: 0, ow: 38, oh: 24 });

  // out of the forge
  S.cells(4980, 'shieldCell', 0, 0, 4, 'arc');
  S.pickup(5060, 'pulseUpgrade', 0, 0);
  S.pickup(5120, 'repair', 8, -2);
  S.wave(5200, 'convoy', 0, 0, { type: 'gunship', count: 5 });
  S.wave(5330, 'circle', 0, 0, { type: 'dart', count: 8 });
  S.obstacle(5480, 'spinner', 0, 0, { speed: 1.2, dir: 1 });
  S.obstacle(5580, 'laserGate', 0, 0, { kind: 'twin', phase: 0.6 });
  S.obstacle(5660, 'laserGate', 0, 0, { kind: 'low', phase: 1.9 });
  S.obstacle(5740, 'laserGate', 0, 0, { kind: 'high', phase: 0.3 });
  S.cells(5560, 'shieldCell', 0, 0, 8, 'slalom');
  S.enemy(5800, 'bomber', 0, 3); S.enemy(5860, 'bomber', -9, 4);
  S.wave(5940, 'vee', 0, 2, { type: 'interceptor', count: 6 });
  S.pickup(6200, 'capacitor', 12.5, 6);
  S.pickup(6140, 'bomb', -8, 2);
  S.pickup(6300, 'repair', 0, 2);

  // the gauntlet before the arena
  S.wave(6440, 'pincer', 0, 0, { type: 'grunt', count: 8 });
  S.wave(6620, 'convoy', 0, 0, { type: 'gunship', count: 4 });
  S.wave(6820, 'vee', 0, 2, { type: 'interceptor', count: 6 });
  S.cells(6900, 'shieldCell', 0, 0, 4, 'arc');
  S.pickup(7000, 'repair', 6, 2);
  S.pickup(7060, 'bomb', -8, 2);
  T(7080, [['FERRO', 'Last one. Try not to make it interesting.'], ['VEX', 'Wing two. Covering.']]);
  S.boss(7300, 'regent', { warning: 'SOVEREIGN CORE', lines: [['LUMEN', 'Sovereign core. Four prism emitters, lenses open only while firing.'], ['REGENT', 'You have come far to end here. I will be brief.']] });
}

export default { info, buildEnvironment, script };
