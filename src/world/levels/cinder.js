// THE CINDER BELT: a dark cyan void above a dying world. Drifting charred wreckage with glowing cracks, tunnels of
// wreckage, enemy ambushes, a thin ring of dust and the distant ring warship that looms until the boss fight.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { Rng, SlotPool, ChunkStreamer, debrisGeometry, softDotTexture, billboardPool } from '../util.js';
import { injectCracks } from '../materials.js';
import { tunnelRocks } from '../obstacles.js';
import { createDust } from '../dust.js';

const info = {
  name: 'THE CINDER BELT', subtitle: 'Through the burning debris', length: 7400, bossAt: 6800, music: 'cinder', theme: 'cinder', floorY: -400,
  look: { bloom: 0.72, exposure: 1.05, vignette: 0.42 },
};

const FOG = 0x04202a;

/** density 0..1 of background debris by distance */
function density(d) {
  if (d < 700) return 0.35;
  if (d < 1800) return 0.6;
  if (d < 3600) return 1.0;
  if (d < 3950) return 0.35;
  if (d < 5300) return 0.8;
  if (d < 6600) return 0.6;
  return 0.25;
}

function tumbleMaterial(res, uTime) {
  return res.get('tumbleMat', () => {
    const m = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.9, metalness: 0.12 });
    m.onBeforeCompile = (sh) => {
      sh.uniforms.uTime = uTime;
      injectCracks(sh, { heat: 1 });
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', `#include <common>
uniform float uTime;
mat3 tumbleM(vec3 seed){
  float h = fract(sin(dot(seed, vec3(12.9898, 78.233, 45.164))) * 43758.5453);
  vec3 ax = normalize(vec3(fract(h * 7.13) - 0.5, fract(h * 3.71) - 0.5, fract(h * 11.3) - 0.5) + vec3(0.001, 0.002, 0.003));
  float a = uTime * (0.08 + 0.35 * fract(h * 5.3)) + h * 6.283;
  float s = sin(a), c = cos(a), t = 1.0 - c;
  return mat3(t*ax.x*ax.x + c, t*ax.x*ax.y + s*ax.z, t*ax.x*ax.z - s*ax.y,
              t*ax.x*ax.y - s*ax.z, t*ax.y*ax.y + c, t*ax.y*ax.z + s*ax.x,
              t*ax.x*ax.z + s*ax.y, t*ax.y*ax.z - s*ax.x, t*ax.z*ax.z + c);
}`)
        .replace('#include <beginnormal_vertex>', `#include <beginnormal_vertex>
mat3 TM = tumbleM(instanceMatrix[3].xyz);
objectNormal = TM * objectNormal;`)
        .replace('#include <begin_vertex>', `#include <begin_vertex>
transformed = TM * transformed;`);
    };
    m.customProgramCacheKey = () => 'cinderTumble';
    return m;
  });
}

/**
 * The distant ring warship: two counter rotating rings of armoured segments joined by spokes, a core hub and a
 * band of cold light. It only foreshadows the real boss, so it is one cheap silhouette.
 */
function buildRingShip(res) {
  const hullM = res.get('rsHull', () => new THREE.MeshStandardMaterial({ color: 0x4a6068, metalness: 0.55, roughness: 0.5, emissive: 0x0e3640, emissiveIntensity: 1 }));
  const glowM = res.get('rsGlow', () => new THREE.MeshBasicMaterial({ color: new THREE.Color(0x60e8ff).multiplyScalar(1.5), toneMapped: false, fog: false }));
  const seg = (R, n, w, h, d, gap = 0.94) => {
    const parts = [];
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      const len = 2 * R * Math.sin(Math.PI / n) * gap;
      const b = new THREE.BoxGeometry(len, h * (1 + 0.35 * (i % 2)), d);
      b.rotateZ(a + Math.PI / 2);
      b.translate(Math.cos(a) * R, Math.sin(a) * R, 0);
      parts.push(b.toNonIndexed());
    }
    return parts;
  };
  const outer = mergeGeometries([...seg(300, 16, 0, 46, 120), ...[0, 4, 8, 12].map((i) => { const a = (i / 16) * Math.PI * 2; const t = new THREE.CylinderGeometry(9, 14, 46, 6).toNonIndexed(); t.translate(Math.cos(a) * 330, Math.sin(a) * 330 + 0, 0); t.rotateZ(0); return t; })], false);
  const inner = mergeGeometries([...seg(190, 12, 0, 30, 90), ...[0, 1, 2, 3, 4, 5].map((k) => { const a = (k / 6) * Math.PI * 2; const s = new THREE.BoxGeometry(150, 8, 18).toNonIndexed(); s.translate(75, 0, 0); s.rotateZ(a); return s; })], false);
  const hub = new THREE.SphereGeometry(48, 14, 10);
  const glow = mergeGeometries([
    new THREE.TorusGeometry(300, 1.3, 4, 96).translate(0, 0, 61).toNonIndexed(),
    new THREE.TorusGeometry(190, 1.0, 4, 72).translate(0, 0, 46).toNonIndexed(),
    new THREE.SphereGeometry(20, 10, 8).toNonIndexed(),
  ], false);
  const group = new THREE.Group();
  const ringA = new THREE.Mesh(outer, hullM), ringB = new THREE.Mesh(inner, hullM);
  group.add(ringA, ringB, new THREE.Mesh(hub, hullM), new THREE.Mesh(glow, glowM));
  res.own([outer, inner, hub, glow]);
  group.userData.rings = [ringA, ringB];
  return group;
}

function buildEnvironment(ctx, W) {
  const res = W.res, root = W.root;
  const ember = new THREE.Vector3(0.6, 0.2, -0.78);
  W.setup({
    fog: { color: FOG, near: 220, far: 1600 },
    sky: { top: 0x010609, mid: 0x02141a, horizon: 0x0a3d48, bottom: 0x020a0d, sunDir: ember, sunColor: 0xff5a26, sunSize: 0.042, sunGlow: 0.5, stars: 0.75, nebula: 0.3, nebScale: 1.8, nebA: 0x0a4a55, nebB: 0x06333e, nebC: 0x0c7580, horizonWidth: 0.45, haze: 0.08 },
    lights: { sunColor: 0xff8040, sunIntensity: 2.6, sunDir: new THREE.Vector3(0.6, 0.32, -0.5), skyColor: 0x1d6a76, groundColor: 0x30100a, hemiIntensity: 0.75, rimColor: 0x40d4e8, rimIntensity: 1.5, rimDir: new THREE.Vector3(-0.5, 0.3, 0.8) },
    look: info.look, env: 0.4,
    planets: [
      { radius: 300, dir: new THREE.Vector3(-0.5, 0.2, -0.84), distance: 1300, colors: [0x0b3c46, 0x05202a, 0x1a7a80], atmo: 0x33d2e0, bands: 6, noise: 2.6, ring: { rgb: '255,140,70', tilt: 0.1, roll: 0.16, inner: 1.55, outer: 1.82 }, sun: ember, seed: 6, spin: 0.004 },
    ],
  });

  const CH = 11, LEN = 240;
  const uTime = { value: 0 };
  const mat = tumbleMaterial(res, uTime);
  const geos = [0, 1, 2].map((i) => res.get('bgDebris' + i, () => debrisGeometry(20 + i * 5, i)));
  const pools = geos.map((g, i) => new SlotPool(g, mat, CH, i === 0 ? 42 : 34));
  const wisp = billboardPool(res.own(softDotTexture('255,255,255')), CH, 6, { additive: true, opacity: 0.1, near: 100 });
  const dust = createDust({ count: 260, color: 0xff9448, depth: 320, spreadX: 55, spreadY: 32, len: 0.055, opacity: 0.8, seed: 4 });
  const ms = buildRingShip(res);
  root.add(ms, dust.object, wisp.mesh);
  for (const p of pools) root.add(p.mesh);

  let away = 0;
  const tints = [0xffffff, 0xd8d0cc, 0xffd8c0, 0xc0d0d4, 0xb0a8a0, 0xf0c8a8];
  const wispCols = [0x0e8a9a, 0x0a6a7a, 0x12a0b0, 0x0a7a8a, 0xff5a20];

  const stream = new ChunkStreamer({
    len: LEN, count: CH, behind: 1,
    populate(slot, idx, z0, z1) {
      const rng = new Rng(idx * 6271 + 33);
      const d = -z0 - LEN * 0.5;
      const k = density(d);
      for (const p of pools) p.begin(slot);
      wisp.begin(slot);
      const n = Math.round(k * 62);
      for (let i = 0; i < n; i++) {
        const big = rng.chance(0.08), mid = !big && rng.chance(0.3);
        const s = big ? rng.range(28, 90) : mid ? rng.range(8, 20) : rng.range(2, 7);
        const minR = 34 + s * 0.9;
        const rad = minR + Math.pow(rng.r(), big ? 0.8 : 1.7) * (big ? 700 : 300);
        const a = rng.range(0, Math.PI * 2);
        const c = rng.pick(tints);
        pools[rng.int(0, 2)].add(Math.cos(a) * rad * 1.2, Math.sin(a) * rad * 0.8, z0 - rng.r() * LEN, s, s * rng.range(0.7, 1), s, rng.r() * 6, rng.r() * 6, 0, c);
      }
      for (const p of pools) p.end();
      for (let i = 0; i < 6; i++) {
        const s = rng.range(300, 800), a = rng.range(0, 6.28), r = rng.range(250, 900);
        wisp.add(Math.cos(a) * r, Math.sin(a) * r * 0.7, z0 - rng.r() * LEN, s, s * 0.7, 1, 0, 0, 0, rng.pick(wispCols));
      }
      wisp.end();
    },
  });

  return {
    update(dt, ctx, force) {
      uTime.value = W.time;
      stream.update(ctx.rail.position.z, 3, !!force);
      dust.update(dt, ctx);
      const prog = Math.min(1, ctx.rail.distance / info.bossAt);
      // the decorative ring ship looms closer, then slips back into the fog once the real boss shows up
      away += ((W.bossStarted ? 1 : 0) - away) * Math.min(1, dt * 0.8);
      ms.position.set(360 - prog * 220 + away * 500, 120 - prog * 40, ctx.rail.position.z - (2350 - prog * 1250) - away * 1800);
      ms.rotation.y = -0.55 + prog * 0.35;
      ms.rotation.x = 0.18;
      const [a, b] = ms.userData.rings;
      a.rotation.z = W.time * 0.05; b.rotation.z = -W.time * 0.08;
    },
    invalidate() { stream.invalidate(); },
    reset(ctx) { dust.reset(ctx); away = 0; },
    dispose() { dust.dispose(); for (const p of pools) p.mesh.dispose(); wisp.mesh.dispose(); },
  };
}

// ---------------------------------------------------------------------------------------------- script
function script(ctx, S, W) {
  const rng = S.rng;
  const T = S.talk;

  /** wreckage in the flight corridor. small pieces are shootable, medium ones need a few hits. */
  function field(from, to, { step = 55, small = 1.2, med = 0.5, big = 0.0 } = {}) {
    S.stream(from, to, step, (at) => {
      const z = -at;
      const ns = Math.floor(small + (rng.r() < small % 1 ? 1 : 0));
      for (let i = 0; i < ns; i++) W.spawnObstacle('rock', new THREE.Vector3(rng.range(-24, 24), rng.range(-14, 14), z - rng.range(0, step)), { r: rng.range(1.8, 3.6), vx: rng.range(-1.2, 1.2), vy: rng.range(-1.2, 1.2), vz: rng.range(-6, 6) });
      if (rng.r() < med) {
        const a = rng.range(0, 6.28), rad = rng.range(15, 30);
        W.spawnObstacle('rock', new THREE.Vector3(Math.cos(a) * rad, Math.sin(a) * rad * 0.6, z - rng.range(0, step)), { r: rng.range(5, 9), vx: rng.range(-2, 2), vy: rng.range(-2, 2) });
      }
      if (rng.r() < big) {
        const sx = rng.sign();
        W.spawnObstacle('rock', new THREE.Vector3(sx * rng.range(7, 11), rng.range(-6, 6), z - step * 0.5), { r: rng.range(11, 14), hp: 16, vx: 0, vy: 0, vz: 0 });
      }
    });
  }
  /** a tunnel of static wreckage, `segs` pieces of 120 units */
  function tunnel(dist, segs = 3, pinch = false, innerR = 27) {
    for (let i = 0; i < segs; i++) {
      const at = dist + i * 120;
      S.at(at - 1150, () => {
        const list = tunnelRocks(rng, { length: 120, innerR, pinch: pinch && i === Math.floor(segs / 2) ? { ring: 2, x: rng.range(-6, 6), y: rng.range(-3, 3) - 12 * 0 } : null });
        const ob = W.spawnObstacle('tunnel', new THREE.Vector3(0, 0, -(at + 60)), { rocks: list, radius: 130 });
        if (ob) ob.pruneBehind = 130;
      });
    }
  }

  // Pacing: a lane through the field, a wingman on a roll trigger, a tunnel with a lane inside it, a quiet stretch with a
  // capacitor hidden behind a hulk, then a carrier ambush and a second tunnel. Escorts: FERRO (roll), VEX (kill count).

  // ---- intro
  T(15, [['CONTROL', 'Dominion fleet is hiding in the Cinder Belt, the wreckage of our old shipyards. Find the ring vessel.'], ['FERRO', 'Everything in there used to be ours.']]);
  S.hint(70, 'DEBRIS: shoot the small pieces, steer around the large ones', 5);
  field(150, 950, { step: 70, small: 0.9, med: 0.15 });
  S.wave(520, 'line', 0, 2, { type: 'grunt', count: 3 });
  S.cells(700, 'shieldCell', 0, 0, 8, 'slalom');
  S.wave(840, 'vee', 0, 2, { type: 'grunt', count: 5 });

  // ---- rising field, drones hiding in the wreckage
  field(950, 1800, { step: 55, small: 1.3, med: 0.4, big: 0.08 });
  S.comm(1050, 'VEX', 'Wing two. Fighters astern, bearing 180. Engaging.', 3.4);
  S.wave(1120, 'pincer', 0, 0, { type: 'grunt', count: 6 });
  S.enemy(1300, 'asteroidDrone', -9, 3); S.enemy(1330, 'asteroidDrone', 10, -3); S.enemy(1360, 'asteroidDrone', 0, 5);
  S.cells(1480, 'shieldCell', 0, 0, 4, 'spiral');
  S.pickup(1620, 'bomb', -8, 3);
  S.wave(1700, 'wave', 0, 1, { type: 'dart', count: 6 });

  // ---- first tunnel, with a slipstream lane through it
  T(1620, [['PIP', 'tunnel ahead. gap 28 units. single file advised.']]);
  tunnel(1800, 3, false, 28);
  S.cells(1830, 'shieldCell', 0, 0, 8, 'line');
  S.wave(2200, 'vee', 0, 2, { type: 'grunt', count: 6 });

  // ---- dense field with large pieces
  S.comm(2230, 'LUMEN', 'Large debris ahead. A charged volley fractures it.', 3.2);
  field(2260, 3550, { step: 48, small: 1.4, med: 0.55, big: 0.26 });
  S.hint(2300, 'FLIP: Q or E deflects incoming fire', 5);
  S.wave(2450, 'circle', 0, 0, { type: 'dart', count: 7 });
  S.escort('ferro', { trigger: 'roll', arm: 2400, giveUp: 2800, type: 'interceptor', x: 15, ahead: 170, time: 18, trouble: 'tail', note: ['LUMEN', 'Transponder link to FERRO is degrading. Clear the jamming contact.'] });
  S.enemy(2900, 'gunship', -8, 4); S.enemy(2940, 'gunship', 9, 2);
  S.cells(3050, 'shieldCell', 0, 0, 4, 'zigzag');
  S.wave(3150, 'pincer', 0, 1, { type: 'grunt', count: 6 });
  S.escort('vex', { trigger: 'kills', arm: 3140, kills: 6, giveUp: 3420, type: 'grunt', x: -15, ahead: 170, time: 18, trouble: 'cutoff', note: ['LUMEN', 'Transponder link to VEX is degrading. Clear the jamming contact.'] });
  S.wave(3400, 'line', 0, 0, { type: 'interceptor', count: 3 });

  // ---- quiet stretch: a hulk in the lane and a capacitor tucked behind it
  S.obstacle(3700, 'rock', -7, -3, { r: 12, hp: 16, vx: 0, vy: 0, vz: 0 });
  S.pickup(3760, 'capacitor', 13, -6);
  S.cells(3620, 'shieldCell', 0, 0, 4, 'arc');
  S.pickup(3900, 'repair', 8, -3);
  T(3830, [['LUMEN', 'Large energy signature ahead. Carrier group, bearing 000.']]);

  // ---- carrier ambush
  field(3990, 5200, { step: 60, small: 0.9, med: 0.35, big: 0.1 });
  S.enemy(4000, 'carrier', 0, 6, { ahead: 380 });
  S.wave(4100, 'pincer', 0, 0, { type: 'grunt', count: 7 });
  S.enemy(4250, 'interceptor', -10, 3); S.enemy(4280, 'interceptor', 10, 3);
  S.enemy(4400, 'swarmer', 0, 0, { count: 10 });
  S.comm(4450, 'LUMEN', 'Proximity mines, five contacts. Range them.', 3.2);
  for (let i = 0; i < 5; i++) S.enemy(4520 + i * 12, 'mine', -14 + i * 7, (i % 2) * 4 - 2);
  S.wave(4640, 'convoy', 0, 0, { type: 'gunship', count: 3 });
  S.cells(4790, 'shieldCell', 0, 0, 4, 'spiral');

  // ---- second tunnel with a boulder pinch
  T(4870, [['PIP', 'tunnel two. movement detected inside.']]);
  tunnel(5020, 4, true, 27);
  S.cells(5040, 'shieldCell', 0, 0, 8, 'wave');
  S.enemy(5100, 'asteroidDrone', -8, 0); S.enemy(5150, 'asteroidDrone', 8, 0);
  S.pickup(5400, 'pulseUpgrade', 0, 0);

  // ---- the ring vessel
  field(5450, 6600, { step: 70, small: 1.0, med: 0.35, big: 0.12 });
  T(5480, [['LUMEN', 'Large contact, ring class. Turret ring, then the rotating segments.']]);
  S.wave(5560, 'vee', 0, 2, { type: 'interceptor', count: 5 });
  S.wave(5760, 'circle', 0, 0, { type: 'dart', count: 8 });
  S.enemy(5900, 'bomber', 0, 3); S.enemy(5960, 'bomber', -9, 4);
  S.wave(6050, 'convoy', 0, 0, { type: 'gunship', count: 4 });
  S.cells(6250, 'shieldCell', 0, 0, 4, 'arc');
  S.pickup(6350, 'repair', -8, 3);
  S.wave(6450, 'pincer', 0, 0, { type: 'grunt', count: 6 });
  S.pickup(6560, 'bomb', 8, -2);
  T(6620, [['FERRO', 'Turret ring first. It is the part shooting at us.'], ['VEX', 'Wing two. Holding your left.']]);
  S.boss(6800, 'orrery', { warning: 'RING VESSEL', lines: [['LUMEN', 'Ring vessel on approach. Turret ring active.']] });
}

export default { info, buildEnvironment, script };
