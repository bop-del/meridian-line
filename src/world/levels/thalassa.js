// THALASSA COAST: a warm evening under twin low suns over a teal sea. A Dominion landing fleet lies at anchor among
// bioluminescent coral: warm coral spires and arches on the coast, a canyon of tall spires, then a cool luminous reef
// with huge coral spans overhead, and the boss arena over open water.
import * as THREE from 'three';
import { Rng, SlotPool, ChunkStreamer, rockGeometry, coralSpireGeometry, platformGeometry, hexFrameGeometry, cloudTexture, billboardPool } from '../util.js';
import { coralMaterial } from '../materials.js';
import { bargeGeometry, coralTorus, archHoop, REEF_PALETTE } from '../obstacles.js';
import { createOcean } from '../liquids.js';
import { createDust } from '../dust.js';

const info = {
  name: 'THALASSA COAST', subtitle: 'Strike the landing fleet', length: 6900, bossAt: 6300, music: 'thalassa', theme: 'thalassa', floorY: -26,
  look: { bloom: 0.5, exposure: 1.02, vignette: 0.3 },
};

const HAZE = 0xa9cfc0;
const SUN = new THREE.Vector3(-0.26, 0.15, -0.95);
const SUN2 = new THREE.Vector3(0.3, 0.1, -0.95);

function zoneAt(d) {
  if (d < 1300) return 'anchorage';
  if (d < 3000) return 'coast';
  if (d < 3850) return 'canyon';
  if (d < 6050) return 'reef';
  return 'arena';
}

function buildEnvironment(ctx, W) {
  const res = W.res, root = W.root, floor = info.floorY;
  W.setup({
    fog: { color: HAZE, near: 220, far: 1500 },
    sky: { top: 0x12507a, mid: 0x3fa6ac, horizon: HAZE, bottom: 0x8fbfb0, sunDir: SUN, sunColor: 0xffc978, sunSize: 0.034, sunGlow: 1.1, sunDir2: SUN2, sunColor2: 0xff9860, sunSize2: 0.022, haze: 0.9, stars: 0, nebula: 0, horizonWidth: 0.45 },
    lights: { sunColor: 0xffc890, sunIntensity: 2.4, sunDir: new THREE.Vector3(-0.7, 0.42, 0.45), skyColor: 0x86d0c8, groundColor: 0x2a7a80, hemiIntensity: 1.1, rimColor: 0xffa860, rimIntensity: 1.3, rimDir: new THREE.Vector3(0.1, 0.25, -1) },
    look: info.look, env: 0.8,
  });

  // ------------------------------------------------ water: teal body, gold glitter from two suns
  const ocean = createOcean({ sunDir: SUN, sunColor: 0xffd48a, sunDir2: SUN2, sunColor2: 0xff9a60, sky: 0xe8c890, deep: 0x05505e, shallow: 0x38bcae, foam: 0xfff0d0 });
  root.add(ocean.mesh);

  // ------------------------------------------------ pools (one draw call each)
  const CH = 11, LEN = 240;
  const coralM = coralMaterial(res);
  const coralArchM = coralMaterial(res, { tip: 0, freq: 0.3, heat: 0.7 });
  const platM = coralMaterial(res, { tip: 0, heat: 0.3 });
  const rockM = coralMaterial(res, { tip: 0, heat: 0.1 });
  const warmSpires = [1, 2, 3].map((i) => res.get('spireG' + i, () => coralSpireGeometry(i * 3 + 1, { branches: 2 + (i % 2), shelves: 2 })));
  const coolSpires = [1, 2].map((i) => res.get('coolG' + i, () => coralSpireGeometry(i * 5 + 2, { branches: 3, shelves: 2, ...REEF_PALETTE })));
  const reefGeo = res.get('reefG', () => rockGeometry(3, { detail: 1, rough: 0.4, squash: 0.55, base: 0xd9705a, tint: 0x7a3444 }));
  const farGeo = res.get('farG', () => coralSpireGeometry(11, { branches: 4, shelves: 0, low: 0x6a5a78, mid: 0x9a7a90, tip: 0xe8b896 }));
  const platGeo = res.get('platG', () => platformGeometry(2));
  const rimGeo = res.get('rimG', () => hexFrameGeometry(0.06));
  const budGeo = res.get('budG', () => new THREE.OctahedronGeometry(1.1, 0));
  const bargeGeo = res.get('bargeBG', () => bargeGeometry([]));
  const archWarmGeo = res.get('archWG', () => coralTorus(17, 5.5, 0));
  const archCoolGeo = res.get('archCG', () => coralTorus(17, 5.5, 0, REEF_PALETTE));
  const hoopGeo = res.get('hoopG', () => archHoop(17, 5.5, 0, 0.8));
  const aquaM = res.get('aquaM', () => new THREE.MeshBasicMaterial({ color: new THREE.Color(0x58f0dc).multiplyScalar(0.95), toneMapped: false }));
  const budM = res.get('budM', () => new THREE.MeshBasicMaterial({ color: new THREE.Color(0xffffff).multiplyScalar(0.9), toneMapped: false }));
  const bargeM = res.get('bargeM', () => new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.62, metalness: 0.35 }));
  const bargeLightM = res.get('bargeLM', () => new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false, color: new THREE.Color(1.35, 1.35, 1.35) }));
  const pools = {
    spA: new SlotPool(warmSpires[0], coralM, CH, 6),
    spB: new SlotPool(warmSpires[1], coralM, CH, 6),
    spC: new SlotPool(warmSpires[2], coralM, CH, 5),
    coolA: new SlotPool(coolSpires[0], coralM, CH, 8),
    coolB: new SlotPool(coolSpires[1], coralM, CH, 8),
    reefs: new SlotPool(reefGeo, rockM, CH, 10),
    far: new SlotPool(farGeo, coralM, CH, 4),
    plat: new SlotPool(platGeo, platM, CH, 9),
    rim: new SlotPool(rimGeo, aquaM, CH, 9, { colors: false }),
    buds: new SlotPool(budGeo, budM, CH, 34),
    barges: new SlotPool(bargeGeo[0], bargeM, CH, 8),
    bargeLights: new SlotPool(bargeGeo[1], bargeLightM, CH, 8, { colors: false }),
    archW: new SlotPool(archWarmGeo, coralArchM, CH, 3),
    archC: new SlotPool(archCoolGeo, coralArchM, CH, 4),
    hoops: new SlotPool(hoopGeo, aquaM, CH, 7, { colors: false }),
  };
  const warm = [pools.spA, pools.spB, pools.spC];
  const cool = [pools.coolA, pools.coolB];
  const hazeTex = res.own(cloudTexture('255,226,176', '120,190,180'));
  const clouds = billboardPool(hazeTex, CH, 9, { opacity: 0.8, near: 60 });
  const all = [...Object.values(pools), clouds];
  for (const p of all) root.add(p.mesh);

  const dust = createDust({ count: 90, color: 0xffe2a0, depth: 260, spreadX: 45, spreadY: 24, len: 0.03, opacity: 0.3, seed: 11, tail: 0.0 });
  root.add(dust.object);

  const cream = [0xffffff, 0xfff0e0, 0xffe0d0, 0xf6d8e8, 0xffe8b8];
  const coolTints = [0xffffff, 0xe8e0ff, 0xd8fff4, 0xf4e8ff];
  const budCols = [0x66f0dc, 0x66f0dc, 0xff9cd0, 0xb0a0ff, 0xfff0a0];
  const barTints = [0xffffff, 0xe6e0da, 0xd8dee4, 0xf0e2d8];

  // ------------------------------------------------ chunk population
  const stream = new ChunkStreamer({
    len: LEN, count: CH, behind: 1,
    populate(slot, idx, z0, z1) {
      const rng = new Rng(idx * 7919 + 101);
      const d = -z0 - LEN * 0.5;
      const zone = zoneAt(d);
      const Z = () => z0 - rng.r() * LEN;
      for (const p of all) p.begin(slot);
      const spire = (side, edge, rMin, rMax, hMin, hMax, spread, y0 = floor - 4, set = warm, tints = cream) => {
        const r = rng.range(rMin, rMax), h = rng.range(hMin, hMax);
        const x = side * (edge + r * 1.1 + rng.range(0, spread));
        rng.pick(set).add(x, y0, Z(), r, h, r, 0, rng.range(0, 6.28), 0, rng.pick(tints));
      };
      const coolSpire = (side, edge, rMin, rMax, hMin, hMax, spread) => spire(side, edge, rMin, rMax, hMin, hMax, spread, floor - 4, cool, coolTints);
      const reef = (n) => {
        for (let i = 0; i < n; i++) {
          const r = rng.range(2.5, 9), s = rng.sign();
          pools.reefs.add(s * rng.range(30, 170), floor + r * 0.08, Z(), r, r * 0.8, r * 1.1, rng.r(), rng.r() * 6, 0, rng.pick(cream));
        }
      };
      const far = (n, xMin = 520, xMax = 1300) => {
        for (let i = 0; i < n; i++) {
          const s = rng.sign(), h = rng.range(160, 420), r = rng.range(90, 200);
          pools.far.add(s * rng.range(xMin, xMax), floor - 10, Z(), r, h, r, 0, rng.range(0, 6), 0);
        }
      };
      const buds = (n, xMin, xMax, yMin, yMax) => {
        for (let i = 0; i < n; i++) pools.buds.add(rng.sign() * rng.range(xMin, xMax), rng.range(yMin, yMax), Z(), 1, 1.5, 1, 0, rng.range(0, 6), 0, rng.pick(budCols));
      };
      const platform = (n, xMin = 46, xMax = 230, yMin = -8, yMax = 46, rMin = 8, rMax = 22, set = warm, tints = cream) => {
        for (let i = 0; i < n; i++) {
          const r = rng.range(rMin, rMax), x = rng.sign() * rng.range(xMin, xMax), y = rng.range(yMin, yMax), z = Z();
          const sy = r * 0.8;
          pools.plat.add(x, y, z, r, sy, r, 0, rng.range(0, 6.28), 0, rng.pick(cream));
          pools.rim.add(x, y, z, r, sy, r, 0, 0, 0);
          pools.buds.add(x + r * 0.55, y + 1.1, z, 0.8, 0.8, 0.8, 0, 0, 0, rng.pick(budCols));
          // a little garden of coral on top
          if (rng.chance(0.6)) rng.pick(set).add(x - r * 0.25, y, z + r * 0.2, r * 0.16, r * rng.range(0.5, 1.2), r * 0.16, 0, rng.range(0, 6), 0, rng.pick(tints));
        }
      };
      // the Dominion landing fleet: barges at anchor in loose rows, bows toward the coast
      const fleet = (n, xMin, xMax) => {
        for (let i = 0; i < n; i++) {
          const s = rng.range(1.0, 1.55), x = rng.sign() * rng.range(xMin, xMax), z = Z(), yaw = rng.range(-0.28, 0.28) + (rng.chance(0.15) ? Math.PI : 0);
          const y = floor + rng.range(-0.2, 0.2);
          pools.barges.add(x, y, z, s, s, s, 0, yaw, 0, rng.pick(barTints));
          pools.bargeLights.add(x, y, z, s, s, s, 0, yaw, 0);
        }
      };
      const arch = (n, xMin, xMax, set, sMin = 1.6, sMax = 3.4) => {
        for (let i = 0; i < n; i++) {
          const sc = rng.range(sMin, sMax), x = rng.sign() * rng.range(xMin, xMax), z = Z(), y = floor - 6 * sc, yaw = rng.range(-0.5, 0.5);
          set.add(x, y, z, sc, sc, sc, 0, yaw, 0, rng.pick(cream));
          pools.hoops.add(x, y, z, sc, sc, sc, 0, yaw, 0);
        }
      };

      if (zone === 'anchorage') {
        for (let i = 0; i < 3; i++) spire(rng.sign(), 110, 8, 20, 40, 110, 300);
        platform(4); reef(9); far(4); fleet(8, 26, 170);
        if (d > 700) for (let i = 0; i < Math.floor((d - 700) / 150); i++) spire(1, 60 + (1300 - d) * 0.15, 12, 26, 50, 120, 100);
      } else if (zone === 'coast') {
        for (let i = 0; i < 7; i++) spire(1, 46, 10, 22, 60, 150, 60);
        for (let i = 0; i < 3; i++) spire(-1, 100, 8, 18, 30, 90, 260);
        platform(3); reef(8); far(4); fleet(5, 62, 190); arch(2, 90, 220, pools.archW);
      } else if (zone === 'canyon') {
        for (let i = 0; i < 5; i++) { spire(1, 48, 12, 26, 100, 210, 40); spire(-1, 48, 12, 26, 100, 210, 40); }
        platform(2, 60, 220, 20, 90, 8, 16); reef(6); far(3); arch(3, 70, 200, pools.archW, 1.8, 3.6); buds(6, 30, 120, -10, 40);
      } else if (zone === 'reef') {
        // the luminous reef: cool towers of coral on both sides, coral arches standing in the water, drifting light buds
        for (let side = -1; side <= 1; side += 2) for (let i = 0; i < 6; i++) coolSpire(side, 40, 8, 17, 60, 170, 55);
        for (let i = 0; i < 4; i++) coolSpire(rng.sign(), 120, 12, 26, 70, 180, 260);
        platform(3, 60, 240, 30, 90, 10, 22, cool, coolTints); reef(4); far(3, 620, 1300);
        arch(4, 70, 230, pools.archC, 1.8, 3.8); buds(16, 26, 150, -12, 60);
        if (d < 5500) fleet(1, 90, 200);
      } else {
        for (let i = 0; i < 3; i++) spire(rng.sign(), 200, 14, 34, 60, 160, 350);
        platform(4, 90, 340, -6, 50, 12, 30); reef(6); far(5); fleet(3, 140, 320); buds(6, 60, 200, 0, 40);
      }
      // haze banks over the water and thin strata high up
      for (let i = 0; i < 9; i++) {
        const high = i < 5;
        const s = rng.range(90, 240);
        clouds.add(rng.range(-900, 900), high ? rng.range(80, 170) : rng.range(-14, 22), Z(), s * 1.7, s * (high ? 0.4 : 0.32), 1, 0, 0, 0, rng.pick([0xffe2b0, 0xffd0a0, 0xb8f0e0, 0xffffff, 0xffc890]));
      }
      for (const p of all) p.end();
    },
  });

  return {
    update(dt, ctx, force) {
      const rz = ctx.rail.position.z;
      stream.update(rz, 3, !!force);
      ocean.update(W.time, ctx.rail.position, floor);
      dust.update(dt, ctx);
    },
    invalidate() { stream.invalidate(); },
    reset(ctx) { dust.reset(ctx); },
    dispose() { ocean.dispose(); dust.dispose(); for (const p of all) p.mesh.dispose(); },
  };
}

// ---------------------------------------------------------------------------------------------- script
// Pacing: an anchorage strike, a coast run past gun barges, a coral canyon with a hidden capacitor, then the luminous
// reef with a slalom lane through coral arches. Escort trouble: PIP on a chain trigger, FERRO on a kill count, VEX at
// a fixed spot in the reef.
function script(ctx, S, W) {
  const T = S.talk;

  // ---- the strike: the landing fleet is at anchor and we hit first
  T(15, [['CONTROL', 'Dominion landing fleet at anchor off Thalassa. Twelve barges. Ninth Flight, strike now.'], ['VEX', 'Wing two. Anchorage in sight, bearing 350.']]);
  S.hint(50, 'CHARGE: hold SPACE, release to send a lock-on volley', 5);
  S.wingmen(70);
  S.comm(160, 'LUMEN', 'Landing barges bearing 000. Screen fighters light.', 3.2);
  S.hint(420, 'BOOST: SHIFT   BRAKE: C', 4);
  S.wave(330, 'line', 0, 2, { type: 'grunt', count: 3 });
  S.comm(430, 'VEX', 'Screen contacts, three. Engaging.', 3);
  S.wave(560, 'vee', 0, 2, { type: 'grunt', count: 5 });
  S.cells(620, 'shieldCell', 0, 0, 4, 'arc');
  S.hint(760, 'FLIP: Q or E deflects incoming fire', 5);
  S.enemy(840, 'dart', -10, 3); S.enemy(870, 'dart', 10, 3);
  S.wave(1000, 'wave', 0, 1, { type: 'grunt', count: 6 });
  S.comm(1060, 'FERRO', 'The barges are not shooting back. Yet.', 3.2);
  S.pickup(1180, 'bomb', 9, -3);
  S.hint(1200, 'BOMB: X clears the screen', 4);

  // a two chain slipstream lane; finishing a chain puts a tail on PIP
  S.cells(1260, 'shieldCell', 0, 0, 8, 'wave');
  S.escort('pip', { trigger: 'cells', arm: 1250, giveUp: 1560, type: 'grunt', ahead: 160, time: 16, trouble: 'engine', note: ['LUMEN', 'Transponder link to PIP is degrading. Clear the jamming contact.'] });
  S.wave(1500, 'vee', 0, 2, { type: 'grunt', count: 5 });
  S.enemy(1560, 'gunship', -8, 3);
  S.enemy(1600, 'gunship', 8, 4);
  S.comm(1570, 'FERRO', 'Gunships on the screen. Bursts, then a pause.', 3.4);

  // gun barges on the coast
  S.comm(1660, 'LUMEN', 'Gun barges beaching. Turrets on the pedestals.', 3.4);
  S.barge(1740, -38, { h: 9, rot: 0.15 });
  S.barge(1830, 36, { h: 10, rot: -0.12 });
  S.obstacle(1900, 'arch', 0, 0);
  S.cells(1850, 'shieldCell', 0, 0, 4, 'line');
  S.wave(2000, 'pincer', 0, 0, { type: 'grunt', count: 6 });
  S.barge(2200, -40, { h: 9, rot: 0.2 });
  S.barge(2270, 38, { h: 10, rot: -0.1 });
  S.barge(2340, -36, { h: 8, rot: 0.05 });
  S.enemy(2330, 'gunship', 0, 4);
  S.wave(2450, 'circle', 0, 0, { type: 'dart', count: 6 });
  S.escort('ferro', { trigger: 'kills', arm: 2440, kills: 5, giveUp: 2800, type: 'grunt', x: 16, ahead: 150, time: 18, trouble: 'pinned', note: ['LUMEN', 'Transponder link to FERRO is degrading. Clear the jamming contact.'] });
  S.enemy(2760, 'bomber', 0, 3);
  S.cells(2850, 'shieldCell', 0, 0, 4, 'zigzag');
  S.pickup(2960, 'repair', -9, 3);

  // coral canyon: spires, arches, tighter flying, a capacitor off the lane
  T(3020, [['FERRO', 'Coral canyon. It looks soft.']]);
  S.obstacle(3140, 'stack', 8, 0, { r: 6, h: 62 });
  S.obstacle(3230, 'stack', -8, 0, { r: 6, h: 62 });
  S.obstacle(3350, 'lowArch', 0, 0);
  S.wave(3300, 'line', 0, 3, { type: 'grunt', count: 4 });
  S.pickup(3400, 'capacitor', 12.5, 6);
  S.obstacle(3440, 'stack', 9, 0, { r: 6, h: 62 });
  S.obstacle(3540, 'arch', 0, 0);
  S.cells(3500, 'shieldCell', 0, 0, 4, 'line');
  S.enemy(3480, 'gunship', 0, 4);
  S.wave(3600, 'vee', 0, 2, { type: 'grunt', count: 5 });
  S.obstacle(3720, 'stack', -9, 0, { r: 6, h: 62 });

  // the luminous reef: a slalom lane through three coral arches
  T(3900, [['LUMEN', 'Uncharted reef. Luminous growth registers as solid terrain.']]);
  S.decor(4000, 'reefSpan', 0, 0);
  S.obstacle(4040, 'arch', -5, 0);
  S.obstacle(4120, 'arch', 5, 0);
  S.obstacle(4200, 'arch', -4, 0);
  S.cells(3990, 'shieldCell', 0, 0, 8, 'slalom');
  S.wave(4090, 'vee', 0, 2, { type: 'grunt', count: 5 });
  S.obstacle(4290, 'stack', 9, 0, { r: 6, h: 70, cool: true });
  S.obstacle(4340, 'stack', -9, 0, { r: 6, h: 70, cool: true });
  S.barge(4400, 40, { h: 10, rot: -0.2 });
  S.wave(4360, 'convoy', 0, 0, { type: 'gunship', count: 3 });
  S.decor(4460, 'reefSpan', 0, 0, { R: 110, yBase: -52 });
  S.enemy(4420, 'bomber', 0, 2); S.enemy(4470, 'bomber', -9, 4);
  S.escort('vex', { trigger: 'dist', at: 4560, type: 'interceptor', ahead: 170, time: 20, trouble: 'cutoff', note: ['LUMEN', 'Transponder link to VEX is degrading. Clear the jamming contact.'] });
  S.cells(4640, 'shieldCell', 0, 0, 4, 'spiral');
  S.wave(4700, 'pincer', 0, 0, { type: 'grunt', count: 6 });
  // a forest of spires: alternating stacks
  S.obstacle(4720, 'stack', 8, 0, { r: 5, h: 66, cool: true });
  S.obstacle(4790, 'stack', -8, 0, { r: 5, h: 66, cool: true });
  S.obstacle(4860, 'stack', 8, 0, { r: 5, h: 66, cool: true });
  S.obstacle(4930, 'stack', -8, 0, { r: 5, h: 66, cool: true });
  S.enemy(4780, 'interceptor', -8, 3); S.enemy(4800, 'interceptor', 8, 3);
  S.decor(4950, 'reefSpan', 0, 0, { R: 100, yBase: -48 });
  S.wave(4900, 'convoy', 0, 0, { type: 'gunship', count: 4 });
  S.pickup(5060, 'pulseUpgrade', 0, 0);
  S.wave(5100, 'circle', 0, 0, { type: 'dart', count: 8 });
  S.obstacle(5180, 'arch', 4, 0);
  S.obstacle(5260, 'arch', -4, 0);
  S.wave(5250, 'vee', 0, 3, { type: 'grunt', count: 7 });
  S.enemy(5330, 'bomber', 0, 3);
  S.cells(5420, 'shieldCell', 0, 0, 4, 'wave');
  S.comm(5470, 'LUMEN', 'Supply barges grounded on the reef. Turrets active.', 3.4);
  S.barge(5540, -38, { h: 9, rot: 0.18 });
  S.barge(5600, 40, { h: 10, rot: -0.15 });
  S.wave(5520, 'pincer', 0, 0, { type: 'gunship', count: 4 });
  S.pickup(5700, 'repair', 8, 2);
  S.cells(5760, 'shieldCell', 0, 0, 4, 'arc');
  S.wave(5850, 'line', 0, 2, { type: 'grunt', count: 5 });

  // the siege barge
  T(5930, [['CONTROL', 'Siege barge Tidebreaker ahead, moored to the reef by three cables. Cut it loose.'], ['FERRO', 'Three cables. Not four. Small mercies.']]);
  S.boss(6300, 'tidebreaker', { warning: 'SIEGE BARGE', lines: [['LUMEN', 'Heavy vessel. Mooring cables: 3. Armour plating intact.']] });
}

export default { info, buildEnvironment, script };
