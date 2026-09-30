// OBSIDIAN FOUNDRY: the Regent's forge. A floor of black glass cut by channels of molten metal, walls of obsidian
// with slow giant gears and hydraulic rams, blue-white smelter beams, narrows, a sealed interior with beam gates and
// spinning rotors, and a wide arena for the boss fight.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { Rng, SlotPool, ChunkStreamer, texturedBox, cloudTexture, softDotTexture, canvasTexture, billboardPool, gearGeometry } from '../util.js';
import { metalMaterial, motionMetal } from '../materials.js';
import { createFoundryFloor } from '../atmosphere/foundryFloor.js';
import { getAtmosphere } from '../atmosphere/index.js';
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
    // cold blue steel with hot orange edges. The light rig is modulated every frame in update() (zone, surge, feel parameters)
    lights: { sunColor: 0xa8c4ff, sunIntensity: 1.7, sunDir: new THREE.Vector3(-0.3, 0.85, 0.4), skyColor: 0x2c4a80, groundColor: 0xff7428, hemiIntensity: 1.0, rimColor: 0xff8438, rimIntensity: 0.6, rimDir: new THREE.Vector3(0.85, 0.12, -0.25) },
    look: info.look, env: 0.45,
  });

  const floor = createFoundryFloor();
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
  // glowing strips: the colour is HDR on purpose (bloom picks the seams up) but capped, and scaled live by the feel parameter
  const STRIP_B = new THREE.Color(0x8ac8ff).multiplyScalar(1.15), STRIP_A = new THREE.Color(0xff9a30).multiplyScalar(1.35);
  const glowMat = (key, base) => res.get(key, () => new THREE.MeshBasicMaterial({ color: base.clone(), toneMapped: false }));
  const stripBMat = glowMat('vstripB', STRIP_B), stripAMat = glowMat('vstripA', STRIP_A);
  const stripsB = new SlotPool(new THREE.BoxGeometry(1, 1, 1), stripBMat, CH, 20, { colors: false });
  const stripsA = new SlotPool(new THREE.BoxGeometry(1, 1, 1), stripAMat, CH, 8, { colors: false });
  // giant gears (two tooth counts) and hydraulic rams on the walls
  const gearMat = motionMetal(res, 'spin', uTime, { speed: 0.5 });
  const gearA = new SlotPool(res.get('gearA', () => gearGeometry({ teeth: 20, holes: 6 })), gearMat, CH, 3);
  const gearB = new SlotPool(res.get('gearB', () => gearGeometry({ teeth: 32, ri: 0.92, hole: 0.12, holes: 8, thick: 0.1 })), gearMat, CH, 3);
  const ramHousing = new SlotPool(res.get('ramH', () => { const g = new THREE.CylinderGeometry(6.5, 7.2, 8, 10); g.rotateZ(Math.PI / 2); g.translate(3, 0, 0); return g; }), metal, CH, 3);
  const ramRod = new SlotPool(res.get('ramR', () => { const g = new THREE.CylinderGeometry(3.4, 3.4, 12, 10); g.rotateZ(Math.PI / 2); g.translate(8, 0, 0); const p = new THREE.CylinderGeometry(6, 6, 1.6, 10); p.rotateZ(Math.PI / 2); p.translate(14.8, 0, 0); return mergeTwoNonIndexed(g, p); }), motionMetal(res, 'slide', uTime, { amp: 11, speed: 0.45 }), CH, 3, { colors: false });
  // smelter beams: a narrow blue-white core and a wide blue halo, brightness fading up the column. Colours stay below 1 so the
  // additive stack of core plus halo plus bloom cannot clip to pure white.
  const beamCore = res.get('beamCoreG', () => columnGeometry(1, 0xcfe2ff));
  const beamHalo = res.get('beamHaloG', () => columnGeometry(1, 0x3f7cff));
  const beamMatA = res.get('beamMatA', () => new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }));
  const beamMatB = res.get('beamMatB', () => new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.3, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false, side: THREE.DoubleSide }));
  const beamsA = new SlotPool(beamCore, beamMatA, CH, 3, { colors: false });
  const beamsB = new SlotPool(beamHalo, beamMatB, CH, 3, { colors: false });
  const flare = billboardPool(res.own(softDotTexture('170,210,255')), CH, 4, { additive: true, opacity: 0.6, near: 60 });
  // molten floor glow: a smooth gaussian-like falloff that reaches zero well inside the quad, so nothing can show a hard edge
  const glow = billboardPool(res.own(glowTexture('255,120,36')), CH, 5, { additive: true, opacity: 0.1, near: 140 });
  const smoke = billboardPool(res.own(cloudTexture('60,72,96', '14,18,30')), CH, 5, { opacity: 0.55, near: 80 });
  const all = [...wallPools, ridge, ceil, beam, lintel, stacks, stripsB, stripsA, gearA, gearB, ramHousing, ramRod, beamsA, beamsB, flare, glow, smoke];
  for (const p of all) root.add(p.mesh);
  const dust = createDust({ count: 200, color: 0xffc070, depth: 300, spreadX: 50, spreadY: 32, len: 0.02, opacity: 0.6, seed: 9, rise: 7 });
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
      // Everything below is placed by its OWN rail distance, not by the zone of the chunk centre. A 240 unit chunk that straddles the
      // sealed forge (rail 3900 to 4900) used to drop stacks, floor glow, smoke and beams into the interior, where the additive glow
      // sprites sat next to the camera and made the entrance stretch far too bright.
      const dz = -z0 - LEN / 2;
      const L2 = layout(dz);
      // gantries and heavy lintels across the corridor
      const nb = L2.narrows ? 3 : rng.chance(0.5) ? 1 : 0;
      for (let i = 0; i < nb; i++) { const z = z0 - rng.r() * LEN, Li = layout(-z); if (!Li.interior) beam.add(0, rng.range(30, 55), z, (Li.hw + 24) * 2, 1, 1, 0, 0, 0, 0xffffff); }
      if (!L2.arena && dz < 6100 && rng.chance(0.75)) { const z = z0 - rng.r() * LEN, Li = layout(-z); if (!Li.interior) lintel.add(0, rng.range(64, 76), z, (Li.hw + 70) * 2, 1, 1, 0, 0, 0, 0xffffff); }
      // smelter stacks and beams beyond the walls, molten glow and smoke
      for (let i = 0; i < 3; i++) {
        const h = rng.range(90, 170), sg = rng.sign(), off = rng.range(60, 220), z = z0 - rng.r() * LEN, Li = layout(-z);
        if (Li.interior) continue;
        const x = sg * (Li.hw + off);
        stacks.add(x, FLOOR, z, 1, h, 1, 0, 0, 0, 0xffffff);
        flare.add(x, FLOOR + h + 6, z, 46, 46, 1);
      }
      for (let i = 0; i < (L2.arena ? 3 : 2); i++) {
        const inside = rng.chance(0.5), sg = rng.sign(), z = z0 - rng.r() * LEN, Li = layout(-z);
        const off = rng.range(20, Li.arena ? 260 : 120), off2 = rng.range(6, 16), r = rng.range(1.8, 3.4);
        if (Li.interior) continue;
        const x = sg * (inside && !Li.arena ? Math.max(38, Li.hw - off2) : Li.hw + off);
        beamsA.add(x, FLOOR, z, r * 0.45, 320, r * 0.45);
        beamsB.add(x, FLOOR, z, r * 1.7, 320, r * 1.7);
      }
      for (let i = 0; i < 5; i++) {
        const gw = rng.range(120, 260), gh = rng.range(50, 90), gx = rng.range(-160, 160), z = z0 - rng.r() * LEN;
        if (!layout(-z).interior) glow.add(gx, FLOOR + gh * 0.6, z, gw, gh, 1);
      }
      for (let i = 0; i < 5; i++) {
        const x = rng.range(-500, 500), y = rng.range(60, 220), z = z0 - rng.r() * LEN, w = rng.range(250, 500), h = rng.range(90, 180);
        if (!layout(-z).interior) smoke.add(x, y, z, w, h, 1, 0, 0, 0, i % 2 ? 0xffffff : 0xa0b0d0);
      }
      for (const p of all) p.end();
    },
  });

  // ---- light rig. The two atmosphere point lights (see src/world/atmosphere/rig.js) act as a cold fill that travels with the
  // ship and an orange furnace light from below; both hand over to the boss hero lights during the boss fight.
  const atmo = getAtmosphere(ctx);
  let nextSurge = 4, surge = 0, inScale = 1, furnace = 1;
  const sky = W.sky.uniforms;
  atmo.setIdle(W, (o, dt, c, w, P) => {
    const rp = c.rail.position;
    o.aPos.set(rp.x, rp.y + 5, rp.z - 34); o.aCol.setHex(0x8db4ff); o.aI = 420 * P.foundry_coldFill * inScale; o.aDist = 130;
    o.bPos.set(rp.x, FLOOR + 5, rp.z - 22); o.bCol.setHex(0xff7a26); o.bI = 640 * P.foundry_furnaceLight * furnace * (0.5 + 0.5 * inScale); o.bDist = 110;
  });
  const tmpBase = { hemi: 1.0, sun: 1.7, rim: 0.6 };

  return {
    update(dt, ctx, force) {
      const P = ctx.feel.p.atmosphere;
      uTime.value = W.time;
      const d = ctx.rail.distance ?? -ctx.rail.position.z;
      // the sealed forge is a tight, glossy box: dim the whole rig there so the walls do not blow out
      const inter = smooth(3860, 3910, d) * (1 - smooth(4890, 4940, d));
      inScale = 1 - inter * (1 - P.foundry_interior);
      nextSurge -= dt;
      if (nextSurge <= 0) { nextSurge = 6 + Math.random() * 4; surge = 1; }
      surge = Math.max(0, surge - dt * 0.9);
      const pulse = surge * surge;
      furnace = 1 + P.foundry_furnacePulse * (pulse * 0.9 + 0.18 * Math.sin(W.time * 1.7) + 0.08 * Math.sin(W.time * 4.3));
      sky.uFlash.value = pulse * 0.08;
      const L = W.lights;
      L.hemi.intensity = (tmpBase.hemi + pulse * 0.25) * P.foundry_steel * inScale;
      L.sun.intensity = tmpBase.sun * P.foundry_steel * inScale;
      L.rim.intensity = tmpBase.rim * P.foundry_rimLight * inScale * (1 + pulse * 0.4);
      // seams and beams: bounded brightness, breathing with the surge
      const sg = P.foundry_stripGlow * (0.94 + 0.06 * pulse);
      stripBMat.color.copy(STRIP_B).multiplyScalar(sg); stripAMat.color.copy(STRIP_A).multiplyScalar(sg * (0.9 + 0.2 * furnace));
      beamMatA.color.setScalar(P.foundry_beamGlow); beamMatB.color.setScalar(P.foundry_beamHalo);
      beamMatA.opacity = 0.7 + pulse * 0.2 + Math.sin(W.time * 3.1) * 0.04;
      beamMatB.opacity = 0.24 + pulse * 0.16;
      flare.mesh.material.uniforms.uOpacity.value = 0.6 * P.foundry_poolGlow;
      glow.mesh.material.uniforms.uOpacity.value = 0.1 * P.foundry_floorHaze * (1 + pulse * 0.3);
      smoke.mesh.material.uniforms.uOpacity.value = 0.55 * P.foundry_smoke;
      floor.update(W.time, ctx.rail.position, FLOOR, { glow: P.foundry_poolGlow * (0.95 + 0.1 * furnace), pool: P.foundry_poolGlow, haze: P.foundry_floorHaze });
      stream.update(ctx.rail.position.z, 3, !!force);
      dust.update(dt, ctx);
    },
    invalidate() { stream.invalidate(); },
    reset(ctx) { dust.reset(ctx); nextSurge = 4; surge = 0; },
    dispose() { floor.dispose(); dust.dispose(); for (const p of all) p.mesh.dispose(); sky.uFlash.value = 0; },
  };
}

/** Radial glow whose alpha follows a smooth bell and is exactly zero at 85 percent of the radius (no visible rim). */
function glowTexture(rgb) {
  return canvasTexture(128, 128, (g, w, h) => {
    const gr = g.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
    const stops = 14;
    for (let i = 0; i <= stops; i++) {
      const k = i / stops, r = Math.min(1, k / 0.85);
      const a = r >= 1 ? 0 : Math.pow(1 - r * r * (3 - 2 * r), 1.6) * 0.9;
      gr.addColorStop(k, `rgba(${rgb},${a.toFixed(4)})`);
    }
    g.clearRect(0, 0, w, h);
    g.fillStyle = gr; g.fillRect(0, 0, w, h);
  });
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

  T(15, [['CONTROL', 'Transit inbound. The Regent\'s forge lies inside that structure. Bring the core down.']]);
  S.wave(260, 'vee', 0, 2, { type: 'grunt', count: 6 });
  S.wave(430, 'pincer', 0, 1, { type: 'interceptor', count: 4 });
  S.cells(600, 'shieldCell', 0, 0, 4, 'arc');
  T(660, [['FERRO', 'Emplacements on the walls. They have opinions about us.']]);
  pad(740, -30, -10); pad(790, 30, -10); pad(850, -30, -10); pad(900, 30, -10);
  S.wave(800, 'convoy', 0, 0, { type: 'gunship', count: 3 });

  // smelter beam gates, with a slipstream lane that only works if you time it
  S.comm(930, 'LUMEN', 'Smelter beams cycling. 3.6 second period.', 3.2);
  S.hint(50, 'CHARGE: hold SPACE, release to send a lock-on volley', 5);
  S.hint(420, 'BOOST: SHIFT   BRAKE: C', 4);
  S.hint(760, 'FLIP: Q or E deflects incoming fire', 5);
  S.hint(1010, 'GATES: fly through while the beams are dark', 5);
  S.hint(1300, 'BOMB: X clears the screen', 4);
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
  S.escort('pip', { trigger: 'dist', at: 2440, type: 'grunt', x: 12, ahead: 170, time: 18, trouble: 'pinned', note: ['LUMEN', 'Transponder link to PIP is degrading. Clear the jamming contact.'] });
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
  S.escort('ferro', { trigger: 'cells', arm: 3330, giveUp: 3620, type: 'interceptor', x: -15, ahead: 170, time: 18, trouble: 'cutoff', note: ['LUMEN', 'Transponder link to FERRO is degrading. Clear the jamming contact.'] });
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
