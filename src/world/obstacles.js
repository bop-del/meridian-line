// Obstacle entities (ctx.groups.obstacles). All colliders are custom: `collider === 'box'` with hitTest(pos, radius).
// Each obstacle exposes: group, position, radius (bounding sphere), alive, boxes[] (local AABBs, optional rotation a),
// spheres[] (local), contactDamage/damage, destroyOnContact, hitTest(pos, r), takeDamage, destroy, update.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { rockGeometry, cliffGeometry, coralSpireGeometry, debrisGeometry, texturedBox, fbm3, Rng } from './util.js';
import { coralMaterial, rockMaterial, debrisMaterial, metalMaterial, glowMaterial, additiveMaterial } from './materials.js';

const _v = new THREE.Vector3();

export class Obstacle {
  constructor(type, radius, opts = {}) {
    this.type = type; this.kind = 'obstacle';
    this.group = new THREE.Group();
    this.position = this.group.position;
    this.radius = radius;
    this.alive = true;
    this.collider = 'box';
    this.boxes = []; this.spheres = [];
    this.angle = 0; this._c = 1; this._s = 0;
    this.contactDamage = opts.damage ?? 22; this.damage = this.contactDamage;
    this.destroyOnContact = false;
    this.hp = Infinity; this.maxHp = Infinity;
    this.decor = false;
    this.active = true;
    this.time = 0;
    this.extras = [];
  }
  addBox(x, y, z, hx, hy, hz, a = 0, extra = null) {
    const b = { x, y, z, hx, hy, hz, a, c: Math.cos(a), s: Math.sin(a), off: false };
    if (extra) Object.assign(b, extra);
    this.boxes.push(b); return b;
  }
  setAngle(a) { this.angle = a; this.group.rotation.z = a; this._c = Math.cos(a); this._s = Math.sin(a); }
  hitTest(pos, r) {
    if (!this.alive || !this.active || this.decor) return false;
    const dx = pos.x - this.position.x, dy = pos.y - this.position.y, dz = pos.z - this.position.z;
    const rr = this.radius + r;
    if (dx * dx + dy * dy + dz * dz > rr * rr) return false;
    const c = this._c, s = this._s;
    const lx = dx * c + dy * s, ly = -dx * s + dy * c;
    for (let i = 0; i < this.boxes.length; i++) {
      const b = this.boxes[i];
      if (b.off) continue;
      let px = lx - b.x, py = ly - b.y;
      if (b.a) { const t = px * b.c + py * b.s; py = -px * b.s + py * b.c; px = t; }
      const ex = Math.max(Math.abs(px) - b.hx, 0), ey = Math.max(Math.abs(py) - b.hy, 0), ez = Math.max(Math.abs(dz - b.z) - b.hz, 0);
      if (ex * ex + ey * ey + ez * ez < r * r) return true;
    }
    for (let i = 0; i < this.spheres.length; i++) {
      const sp = this.spheres[i];
      const ex = dx - sp.x, ey = dy - sp.y, ez = dz - sp.z, rs = sp.r + r;
      if (ex * ex + ey * ey + ez * ez < rs * rs) return true;
    }
    return false;
  }
  update(dt, ctx) { this.time += dt; }
  takeDamage(amount, source, ctx) { return false; }
  onPlayerHit(ctx) { if (this.destroyOnContact) this.shatter?.(ctx ?? this.W?.ctx); }
  onRemove() {}
  destroy(ctx) {
    if (!this.alive) return;
    this.alive = false;
    this.group.parent?.remove(this.group);
    this.onRemove();
  }
}

// ---------------------------------------------------------------- geometry helpers
function prep(geo, colorHex = 0xffffff) {
  let g = geo.index ? geo.toNonIndexed() : geo.clone();
  for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv', 'color'].includes(k)) g.deleteAttribute(k);
  const n = g.attributes.position.count;
  if (!g.attributes.uv) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(n * 2), 2));
  if (!g.attributes.color) {
    const c = new THREE.Color(colorHex), a = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { a[i * 3] = c.r; a[i * 3 + 1] = c.g; a[i * 3 + 2] = c.b; }
    g.setAttribute('color', new THREE.BufferAttribute(a, 3));
  }
  return g;
}
function mergeAll(list) { return mergeGeometries(list.map((g) => prep(g)), false); }

function panelBox(w, h, d, cx, cy, cz, uvScale = 0.12) {
  const g = texturedBox(w, h, d, uvScale);
  g.translate(cx, cy - h / 2, cz);
  return g;
}
const mesh = (geo, mat) => { const m = new THREE.Mesh(geo, mat); return m; };

// ---------------------------------------------------------------- THALASSA
function boxAt(w, h, d, x, y, z, hex, rx = 0) {
  const g = new THREE.BoxGeometry(w, h, d);
  if (rx) g.rotateX(rx);
  g.translate(x, y, z);
  const c = new THREE.Color(hex), n = g.attributes.position.count, a = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { a[i * 3] = c.r; a[i * 3 + 1] = c.g; a[i * 3 + 2] = c.b; }
  g.setAttribute('color', new THREE.BufferAttribute(a, 3));
  return g;
}

/**
 * Dominion landing barge: a flat graphite hull, raised bow door, stern bridge, stacked cargo and amber running lights.
 * Length runs along z with the bow at -z, the waterline is y = 0, the deck is at y = 3.5. `towers` adds gun pedestals
 * [x, z, height] rising from the deck. Returns [hull (vertex colours), lights (vertex colours, unlit)].
 */
export function bargeGeometry(towers = []) {
  const H = [], G = [];
  H.push(boxAt(15, 4.6, 40, 0, 0.8, 0, 0x26313b));
  H.push(boxAt(11, 3.6, 5, 0, 0.6, -22.5, 0x2c3944));
  H.push(boxAt(13.4, 0.4, 36, 0, 3.3, 0, 0x59666f));
  H.push(boxAt(12, 5, 0.7, 0, 6, -24.4, 0x7a848c, -0.32));
  H.push(boxAt(9, 5, 8, 0, 6, 15, 0x33404a));
  H.push(boxAt(6, 2, 5, 0, 9.5, 15, 0x3d4b56));
  for (const [x, z, c] of [[-3.4, -6, 0x8a4f3a], [3.4, -6, 0x4e6a68], [-3.4, 4, 0x6a5a44], [3.4, 4, 0x8a4f3a], [0, -13, 0x4e6a68]]) H.push(boxAt(5.2, 3, 8.5, x, 5.2, z, c));
  for (const s of [-1, 1]) H.push(boxAt(2.4, 2.2, 5, s * 5.2, 0, 19, 0x1c242c));
  for (let z = -16; z <= 16; z += 8) for (const s of [-1, 1]) G.push(boxAt(0.6, 0.6, 0.6, s * 6.9, 3.9, z, 0xff8a30));
  G.push(boxAt(5.4, 0.5, 0.3, 0, 9.6, 12.4, 0xffb060));
  for (const s of [-1, 1]) { G.push(boxAt(0.8, 0.8, 0.5, s * 4, 4.6, -24.9, 0xff4a30)); G.push(boxAt(1.6, 1.4, 0.3, s * 5.2, 0, 21.6, 0xff5a2a)); }
  for (const [x, z, hh] of towers) {
    H.push(boxAt(3.2, hh, 3.2, x, 3.5 + hh / 2, z, 0x2b3640));
    H.push(boxAt(5.4, 0.8, 5.4, x, 3.5 + hh + 0.4, z, 0x3a4753));
    G.push(boxAt(5.6, 0.25, 5.6, x, 3.5 + hh + 0.9, z, 0xff8a30));
  }
  return [mergeAll(H), mergeAll(G)];
}

function buildBarge(ctx, W, o = {}) {
  const towers = o.towers ?? [];
  const built = W.res.get(`bargeG_${JSON.stringify(towers)}`, () => bargeGeometry(towers));
  const ob = new Obstacle('barge', 46, {});
  ob.decor = true;
  const y0 = o.base ?? W.floorY;
  ob.position.set(o.x ?? 0, y0, o.z ?? 0);
  ob.group.rotation.y = o.rot ?? 0;
  ob.group.add(mesh(built[0], W.res.get('bargeMat', () => new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.62, metalness: 0.35 }))));
  ob.group.add(mesh(built[1], W.res.get('bargeGlow', () => new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false, color: new THREE.Color(1.35, 1.35, 1.35) }))));
  const ph = Math.random() * 6;
  ob.update = function (dt) { this.time += dt; this.position.y = y0 + Math.sin(this.time * 0.7 + ph) * 0.3; this.group.rotation.z = Math.sin(this.time * 0.55 + ph) * 0.02; };
  ob.radius = 48;
  return ob;
}

const CORAL_LOW = 0x8a3f4c, CORAL_MID = 0xe5765a, CORAL_TIP = 0xffcf8c;
/** the luminous reef: indigo stems, violet bodies, aqua tips */
export const REEF_PALETTE = { low: 0x2c4088, mid: 0x6f7ed8, tip: 0xa6f5e6 };

function buildStack(ctx, W, o = {}) {
  const r = o.r ?? 6, h = o.h ?? 50, floor = o.base ?? W.floorY;
  const seed = o.seed ?? Math.floor(r * 3 + h);
  const geo = W.res.get(`spireG_${seed % 5}${o.cool ? 'c' : ''}`, () => coralSpireGeometry(seed % 5 + 1, { branches: 2, shelves: 2, ...(o.cool ? REEF_PALETTE : {}) }));
  const ob = new Obstacle('stack', Math.hypot(r, h) * 0.6, { damage: 26 });
  ob.position.set(o.x ?? 0, floor, o.z ?? 0);
  const m = mesh(geo, coralMaterial(W.res)); m.scale.set(r, h, r); m.rotation.y = seed;
  ob.group.add(m);
  // the spire tapers to a needle: box slabs follow the silhouette (a wide base, a narrower mid, a slim top)
  ob.addBox(0, h * 0.2, 0, r * 0.82, h * 0.2, r * 0.82);
  ob.addBox(0, h * 0.55, 0, r * 0.55, h * 0.15, r * 0.55);
  ob.addBox(0, h * 0.78, 0, r * 0.3, h * 0.12, r * 0.3);
  ob.addBox(0, h * 0.9, 0, r * 0.13, h * 0.1, r * 0.13);
  return ob;
}

/** Half torus of lumpy coral in the xy plane, base at y = yBase. `pal` picks the colours (warm coral by default). */
export function coralTorus(R, t, yBase, pal = {}) {
  const tor = new THREE.TorusGeometry(R, t, 10, 22, Math.PI);
  const p = tor.attributes.position, v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    const n = fbm3(v.x * 0.16 + 3, v.y * 0.16, v.z * 0.16, 3);
    const k = 1 + (n - 0.5) * 0.7;
    const ang = Math.atan2(v.y, v.x);
    const c = new THREE.Vector3(R * Math.cos(ang), R * Math.sin(ang), 0);
    v.sub(c).multiplyScalar(k).add(c);
    v.z *= 1.5;
    p.setXYZ(i, v.x, v.y, v.z);
  }
  const col = new Float32Array(p.count * 3);
  const cA = new THREE.Color(pal.mid ?? CORAL_MID), cB = new THREE.Color(pal.low ?? CORAL_LOW), cT = new THREE.Color(pal.tip ?? CORAL_TIP);
  const tc = new THREE.Color();
  for (let i = 0; i < p.count; i++) {
    const y = p.getY(i), x = p.getX(i), z = p.getZ(i);
    const n = fbm3(x * 0.3, y * 0.3, z * 0.3, 3);
    tc.copy(cA).lerp(cB, n * 1.1 - 0.15);
    if (y > R * 0.5) tc.lerp(cT, Math.min(1, (y - R * 0.5) / (R * 0.6)) * 0.75);
    col[i * 3] = tc.r; col[i * 3 + 1] = tc.g; col[i * 3 + 2] = tc.b;
  }
  tor.setAttribute('color', new THREE.BufferAttribute(col, 3));
  tor.translate(0, yBase, 0);
  return tor;
}

/** Thin glowing hoop along the inner edge of an arch, so the flyable gap reads at a glance. */
export function archHoop(R, t, yBase, thick = 0.5) {
  const g = new THREE.TorusGeometry(R - t * 1.02, thick, 6, 34, Math.PI);
  g.translate(0, yBase, 0);
  return g;
}

function buildArch(ctx, W, o = {}) {
  const R = o.R ?? 17, t = o.t ?? 5.5, yBase = o.yBase ?? -4;
  const floor = o.base ?? W.floorY;
  const key = `arch_${R}_${t}_${yBase}_${floor}`;
  const legH = yBase - floor + 4;
  const geo = W.res.get(key, () => {
    const tor = coralTorus(R, t, yBase);
    const legs = [];
    for (const s of [-1, 1]) {
      const c = cliffGeometry(s > 0 ? 2 : 3, { taper: 0.75, topAmount: 0.0, rock: CORAL_MID, dark: CORAL_LOW });
      c.scale(t * 1.3, legH + 4, t * 1.5);
      c.translate(s * R, floor - 2, 0);
      legs.push(c);
    }
    return mergeAll([tor, ...legs]);
  });
  const ob = new Obstacle('arch', Math.hypot(R + t, legH + R) * 0.85, { damage: 28 });
  ob.position.set(o.x ?? 0, 0, o.z ?? 0);
  ob.group.add(mesh(geo, coralMaterial(W.res, { tip: 0, freq: 0.3, heat: 0.7 })));
  ob.group.add(mesh(W.res.get(`archHoop_${R}_${t}_${yBase}`, () => archHoop(R, t, yBase, 0.8)), glowMaterial(W.res, 0x50f0dc, 1.15)));
  for (const s of [-1, 1]) ob.addBox(s * R, floor + legH / 2 - 1, 0, t * 1.0, legH / 2, t * 1.2);
  const N = 9;
  for (let i = 0; i < N; i++) {
    const th = (Math.PI * (i + 0.5)) / N;
    const seg = R * Math.sin(Math.PI / (2 * N)) * 1.05;
    ob.addBox(R * Math.cos(th), yBase + R * Math.sin(th), 0, t * 0.88, seg + 0.3, t * 1.15, th);
  }
  ob.gapHalf = R - t; ob.gapTop = yBase + R - t;
  ob.radius = R + t + 6;
  ob.position.y = 0;
  return ob;
}

/** Reef span: a huge luminous coral arch high over the lane (decor, flown under, its feet are below the sea). */
function buildReefSpan(ctx, W, o = {}) {
  const R = o.R ?? 96, t = o.t ?? 7, yBase = o.yBase ?? -46;
  const built = W.res.get(`spanG_${R}_${t}_${yBase}`, () => [coralTorus(R, t, yBase, REEF_PALETTE), archHoop(R, t, yBase, 0.7)]);
  const ob = new Obstacle('reefSpan', R * 1.2, {});
  ob.decor = true;
  ob.pruneBehind = 60;
  ob.position.set(o.x ?? 0, 0, o.z ?? 0);
  ob.group.add(mesh(built[0], coralMaterial(W.res, { tip: 0, freq: 0.07, heat: 0.7 })));
  ob.group.add(mesh(built[1], glowMaterial(W.res, 0x7af4e4, 1.05)));
  return ob;
}

function buildPad(ctx, W, o = {}) {
  const floor = o.base ?? W.floorY, h = o.h ?? 12, r = o.r ?? 5;
  const built = W.res.get(`padG_${h}_${r}`, () => {
    const c = panelBox(r * 2, h, r * 2, 0, floor + h / 2, 0, 0.08);
    const top = panelBox(r * 2.5, 1.6, r * 2.5, 0, floor + h + 0.8, 0, 0.08);
    const slit = new THREE.BoxGeometry(r * 2.6, 0.35, r * 2.6); slit.translate(0, floor + h - 0.2, 0);
    return [mergeGeometries([c, top], false), slit];
  });
  const ob = new Obstacle('pad', r + h, {});
  ob.decor = true; ob.position.set(o.x ?? 0, 0, o.z ?? 0);
  ob.group.add(mesh(built[0], metalMaterial(W.res)));
  ob.group.add(mesh(built[1], glowMaterial(W.res, 0x8ac8ff, 1.8)));
  return ob;
}

// ---------------------------------------------------------------- CINDER
class Rock extends Obstacle {
  constructor(ctx, W, o) {
    const r = o.r ?? 3;
    super('rock', r * 0.95, { damage: r >= 6 ? 26 : r >= 3 ? 16 : 10 });
    this.W = W;
    this.r = r;
    this.hp = this.maxHp = o.hp ?? (r < 3.6 ? 2 : r < 8 ? 7 : 16);
    this.destroyOnContact = r < 6;
    const variant = o.variant ?? (W.rng.r() < 0.22 ? 'hot' : W.rng.r() < 0.25 ? 'ash' : 'ember');
    const gi = o.shape ?? Math.floor(W.rng.r() * 5);
    const geo = W.res.get(`debrisG_${gi}`, () => debrisGeometry(gi + 2, gi % 3));
    this.mesh = mesh(geo, debrisMaterial(W.res, variant));
    this.mesh.scale.setScalar(r);
    this.group.add(this.mesh);
    this.vel = new THREE.Vector3(o.vx ?? 0, o.vy ?? 0, o.vz ?? 0);
    this.spin = new THREE.Vector3((W.rng.r() - 0.5) * 0.8, (W.rng.r() - 0.5) * 0.8, (W.rng.r() - 0.5) * 0.6);
    this.mesh.rotation.set(W.rng.r() * 6, W.rng.r() * 6, W.rng.r() * 6);
    this.spheres.push({ x: 0, y: 0, z: 0, r: r * 0.95 });
    this.punch = 0;
  }
  update(dt, ctx) {
    this.position.addScaledVector(this.vel, dt);
    const ahead = ctx.rail.position.z - this.position.z;
    if (ahead > 640) { this.mesh.scale.setScalar(Math.max(0.001, this.r * Math.min(1, (830 - ahead) / 190))); return; }
    this.mesh.rotation.x += this.spin.x * dt; this.mesh.rotation.y += this.spin.y * dt; this.mesh.rotation.z += this.spin.z * dt;
    if (this.punch > 0.001) { this.punch *= Math.exp(-dt * 10); this.mesh.scale.setScalar(this.r * (1 + this.punch)); }
  }
  takeDamage(amount, source, ctx) {
    if (!this.alive) return false;
    this.hp -= amount;
    this.punch = 0.1;
    if (this.hp <= 0) { if (ctx?.state) ctx.state.score += this.r >= 6 ? 200 : 50; this.shatter(ctx); return true; }
    return false;
  }
  shatter(ctx) {
    if (!this.alive) return;
    ctx = ctx ?? this.W.ctx;
    const fx = ctx?.fx;
    fx?.explosion?.(this.position, { scale: Math.min(2.4, 0.5 + this.r * 0.14), color: 0xff8a40, big: this.r > 8 });
    fx?.debris?.(this.position, 8 + Math.floor(this.r), 0x5a4640);
    if (this.r >= 6.5) {
      const n = this.r > 10 ? 3 : 2;
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2 + this.W.rng.r();
        this.W.spawnObstacle('rock', _v.set(this.position.x + Math.cos(a) * this.r * 0.5, this.position.y + Math.sin(a) * this.r * 0.5, this.position.z), {
          r: this.r * 0.38, vx: Math.cos(a) * 9, vy: Math.sin(a) * 9, vz: 0, hp: 2,
        });
      }
    }
    this.destroy(ctx);
  }
}

/** A cluster of static rocks in ONE instanced mesh. Used for tunnels (walls of rocks around the flight path). */
class RockCluster extends Obstacle {
  constructor(ctx, W, o) {
    super('tunnel', o.radius ?? 80, { damage: 26 });
    const list = o.rocks; // [{x,y,z,r,collide}]
    const n = list.length;
    const geo = W.res.get('debrisG_c0', () => debrisGeometry(9, 0));
    const im = new THREE.InstancedMesh(geo, debrisMaterial(W.res, o.variant ?? 'tunnel'), n);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), p = new THREE.Vector3(), s = new THREE.Vector3();
    const c = new THREE.Color();
    im.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(n * 3), 3);
    for (let i = 0; i < n; i++) {
      const r = list[i];
      e.set(W.rng.r() * 6, W.rng.r() * 6, W.rng.r() * 6); q.setFromEuler(e);
      m.compose(p.set(r.x, r.y, r.z), q, s.setScalar(r.r));
      im.setMatrixAt(i, m);
      const t = 0.75 + W.rng.r() * 0.4;
      im.setColorAt(i, c.setRGB(t, t * (0.92 + W.rng.r() * 0.1), t * 0.9));
      if (r.collide !== false) this.spheres.push({ x: r.x, y: r.y, z: r.z, r: r.r * 0.92 });
    }
    im.frustumCulled = false;
    this.im = im;
    this.group.add(im);
  }
  onRemove() { this.im.dispose(); }
}

// ---------------------------------------------------------------- FOUNDRY
class LaserGate extends Obstacle {
  constructor(ctx, W, o) {
    super('laserGate', 34, { damage: 28 });
    const res = W.res;
    const half = 21;
    this.period = o.period ?? 3.6; this.phase = o.phase ?? 0;
    this.tWarn = 0.8; this.tOn = 1.7;
    const frame = res.get('gateFrame', () => mergeGeometries([
      panelBox(6, 64, 6, -half - 3, -2, 0), panelBox(6, 64, 6, half + 3, -2, 0),
      panelBox(2 * half + 12, 4, 6, 0, 28, 0),
      panelBox(10, 3, 10, -half - 3, -33, 0), panelBox(10, 3, 10, half + 3, -33, 0),
    ], false));
    this.group.add(mesh(frame, metalMaterial(res)));
    const emit = res.get('gateEmit', () => mergeGeometries([
      new THREE.BoxGeometry(1.2, 60, 1.2).translate(-half + 0.3, -2, 3.2), new THREE.BoxGeometry(1.2, 60, 1.2).translate(half - 0.3, -2, 3.2),
    ], false));
    this.group.add(mesh(emit, glowMaterial(res, 0x8ac8ff, 1.05)));
    this.beams = [];
    const kind = o.kind ?? 'twin';
    const defs = {
      twin: [{ y: 6.5, th: 1.5 }, { y: -6.5, th: 1.5 }],
      low: [{ y: -2.5, th: 2.2 }],
      high: [{ y: 3.6, th: 2.2 }],
      center: [{ x: 0, vert: true, th: 2.2 }],
      left: [{ x: -8, vert: true, th: 2.4 }, { x: -12, vert: true, th: 2.4 }],
    }[kind] ?? [{ y: 0, th: 2 }];
    const cylG = res.get('beamG', () => new THREE.CylinderGeometry(0.5, 0.5, 1, 10, 1, true));
    const warnM = additiveMaterial(res, 0xffb030, 0.55), onM = additiveMaterial(res, 0x5aa8ff, 0.55), dimM = additiveMaterial(res, 0x3a70c0, 0.14);
    const coreM = glowMaterial(res, 0xeaf6ff, 1.5);
    for (const d of defs) {
      const len = d.vert ? 30 : 2 * half;
      const holder = new THREE.Group();
      const core = mesh(cylG, coreM), glow = mesh(cylG, onM);
      core.scale.set(d.th * 0.45, len, d.th * 0.45); glow.scale.set(d.th * 1.6, len, d.th * 1.6);
      holder.add(core, glow);
      if (d.vert) { holder.position.set(d.x, 0, 0); } else { holder.rotation.z = Math.PI / 2; holder.position.set(0, d.y, 0); }
      this.group.add(holder);
      const box = d.vert ? this.addBox(d.x, 0, 0, d.th / 2, len / 2, 0.9) : this.addBox(0, d.y, 0, len / 2, d.th / 2, 0.9);
      this.beams.push({ holder, core, glow, box, warnM, onM, dimM, th: d.th });
    }
    // pylon collision
    this.addBox(-half - 3, -2, 0, 3, 32, 3); this.addBox(half + 3, -2, 0, 3, 32, 3);
    this.addBox(0, 28, 0, half + 6, 2, 3);
    this.state = -1;
    this.applyState(2, 0);
  }
  applyState(s, k) {
    for (const b of this.beams) {
      b.box.off = s !== 1;
      if (s === 2) {
        b.holder.visible = true; b.core.visible = false; b.glow.material = b.dimM;
        b.glow.scale.x = b.glow.scale.z = b.th * 0.35;
      } else if (s === 0) {
        b.core.visible = false; b.glow.material = b.warnM;
        const f = 0.12 + 0.18 * (0.5 + 0.5 * Math.sin(k * 40));
        b.glow.scale.x = b.glow.scale.z = b.th * f * 3;
      } else if (s === 1) {
        b.core.visible = true; b.glow.material = b.onM;
        b.glow.scale.x = b.glow.scale.z = b.th * 1.6;
      }
    }
  }
  update(dt, ctx) {
    this.time += dt;
    const t = (this.time + this.phase) % this.period;
    let s = 2;
    if (t < this.tWarn) s = 0; else if (t < this.tWarn + this.tOn) s = 1;
    this.applyState(s, this.time);
    this.state = s;
  }
}

class Spinner extends Obstacle {
  constructor(ctx, W, o) {
    super('spinner', 22, { damage: 24 });
    const res = W.res;
    this.speed = (o.speed ?? 1.05) * (o.dir ?? 1);
    const arms = res.get('spinnerG', () => {
      const parts = [];
      for (let k = 0; k < 4; k++) {
        const a = mergeGeometries([panelBox(13, 2.6, 3.2, 0, 0, 0, 0.2), panelBox(3, 4.2, 3.6, 6.6, 0, 0, 0.2)], false);
        a.rotateZ(k * Math.PI / 2 + 0.0);
        const dir = new THREE.Vector2(Math.cos(k * Math.PI / 2), Math.sin(k * Math.PI / 2));
        a.translate(dir.x * 12, dir.y * 12, 0);
        parts.push(a);
      }
      return mergeGeometries(parts, false);
    });
    this.group.add(mesh(arms, metalMaterial(res)));
    const hub = res.get('spinnerHub', () => new THREE.TorusGeometry(5.6, 0.45, 8, 28));
    this.group.add(mesh(hub, glowMaterial(res, 0x7ac0ff, 1.15)));
    const tip = res.get('spinnerTips', () => {
      const parts = [];
      for (let k = 0; k < 4; k++) { const b = new THREE.BoxGeometry(1.4, 1.4, 4.2); b.translate(18.6, 0, 0); b.rotateZ(k * Math.PI / 2); parts.push(b); }
      return mergeGeometries(parts, false);
    });
    this.group.add(mesh(tip, glowMaterial(res, 0xffa838, 1.5)));
    for (let k = 0; k < 4; k++) {
      const a = k * Math.PI / 2;
      this.addBox(Math.cos(a) * 12, Math.sin(a) * 12, 0, 6.6, 1.5, 1.8, a);
    }
    this.setAngle(o.angle ?? 0);
  }
  update(dt, ctx) { this.time += dt; this.setAngle(this.angle + this.speed * dt); }
}

function buildWall(ctx, W, o = {}) {
  const ox = o.ox ?? 0, oy = o.oy ?? 0, ow = o.ow ?? 22, oh = o.oh ?? 15;
  const HW = 64, yTop = 44, yBot = -34, T = 7;
  const key = `wall_${ox}_${oy}_${ow}_${oh}`;
  const geos = W.res.get(key, () => {
    const l = ox - ow / 2, r = ox + ow / 2, t = oy + oh / 2, b = oy - oh / 2;
    const body = mergeGeometries([
      panelBox(l + HW, yTop - yBot, T, (l - HW) / 2, (yTop + yBot) / 2, 0),
      panelBox(HW - r, yTop - yBot, T, (r + HW) / 2, (yTop + yBot) / 2, 0),
      panelBox(ow, yTop - t, T, ox, (yTop + t) / 2, 0),
      panelBox(ow, b - yBot, T, ox, (b + yBot) / 2, 0),
    ], false);
    const e = 0.7, zz = T / 2 + 0.2;
    const glow = mergeGeometries([
      new THREE.BoxGeometry(ow + 1.4, e, 0.6).translate(ox, t, zz), new THREE.BoxGeometry(ow + 1.4, e, 0.6).translate(ox, b, zz),
      new THREE.BoxGeometry(e, oh, 0.6).translate(l, oy, zz), new THREE.BoxGeometry(e, oh, 0.6).translate(r, oy, zz),
      new THREE.BoxGeometry(ow + 1.4, e, 0.6).translate(ox, t, -zz), new THREE.BoxGeometry(ow + 1.4, e, 0.6).translate(ox, b, -zz),
      new THREE.BoxGeometry(e, oh, 0.6).translate(l, oy, -zz), new THREE.BoxGeometry(e, oh, 0.6).translate(r, oy, -zz),
    ], false);
    return [body, glow];
  });
  const ob = new Obstacle('wall', 80, { damage: 32 });
  ob.position.set(0, 0, o.z ?? 0);
  ob.group.add(mesh(geos[0], metalMaterial(W.res)));
  ob.group.add(mesh(geos[1], glowMaterial(W.res, 0xffa838, 1.6)));
  const l = ox - ow / 2, r = ox + ow / 2, t = oy + oh / 2, b = oy - oh / 2;
  ob.addBox((l - HW) / 2, (yTop + yBot) / 2, 0, (l + HW) / 2, (yTop - yBot) / 2, T / 2);
  ob.addBox((r + HW) / 2, (yTop + yBot) / 2, 0, (HW - r) / 2, (yTop - yBot) / 2, T / 2);
  ob.addBox(ox, (yTop + t) / 2, 0, ow / 2, (yTop - t) / 2, T / 2);
  ob.addBox(ox, (b + yBot) / 2, 0, ow / 2, (b - yBot) / 2, T / 2);
  ob.radius = 90;
  ob.opening = { ox, oy, ow, oh };
  return ob;
}

function buildPylon(ctx, W, o = {}) {
  const r = o.r ?? 3.4, h = o.h ?? 70, floor = o.base ?? W.floorY;
  const geo = W.res.get(`pylonG_${r}_${h}_${floor}`, () => {
    const c = new THREE.CylinderGeometry(r, r * 1.25, h, 8, 1); c.translate(0, floor + h / 2, 0);
    const cap = new THREE.CylinderGeometry(r * 1.4, r, 3, 8); cap.translate(0, floor + h + 1.5, 0);
    return mergeAll([c, cap]);
  });
  const ring = W.res.get(`pylonR_${r}_${h}_${floor}`, () => {
    const parts = [];
    for (let i = 0; i < 6; i++) { const t = new THREE.TorusGeometry(r * 1.32, 0.28, 6, 14); t.rotateX(Math.PI / 2); t.translate(0, floor + 8 + i * (h - 12) / 5, 0); parts.push(t); }
    return mergeAll(parts);
  });
  const ob = new Obstacle('pylon', h * 0.6, { damage: 26 });
  ob.position.set(o.x ?? 0, 0, o.z ?? 0);
  ob.group.add(mesh(geo, metalMaterial(W.res)));
  ob.group.add(mesh(ring, glowMaterial(W.res, 0x8ac8ff, 1.3)));
  ob.addBox(0, floor + h / 2, 0, r * 1.05, h / 2, r * 1.05);
  return ob;
}

// ---------------------------------------------------------------- factory
export function createObstacle(type, ctx, W, pos, opts = {}) {
  const o = { ...opts };
  if (pos) { o.x = pos.x; o.z = pos.z; o.y = pos.y; }
  let ob = null;
  switch (type) {
    case 'barge': ob = buildBarge(ctx, W, o); break;
    case 'stack': ob = buildStack(ctx, W, o); break;
    case 'arch': ob = buildArch(ctx, W, o); break;
    case 'lowArch': ob = buildArch(ctx, W, { R: 16, t: 6.5, yBase: -6.5, ...o }); break;
    case 'reefSpan': ob = buildReefSpan(ctx, W, o); break;
    case 'pad': ob = buildPad(ctx, W, o); break;
    case 'rock': ob = new Rock(ctx, W, o); if (pos) ob.position.set(pos.x, pos.y, pos.z); break;
    case 'tunnel': ob = new RockCluster(ctx, W, o); if (pos) ob.position.set(pos.x, pos.y, pos.z); break;
    case 'laserGate': ob = new LaserGate(ctx, W, o); if (pos) ob.position.set(pos.x, pos.y ?? 0, pos.z); break;
    case 'spinner': ob = new Spinner(ctx, W, o); if (pos) ob.position.set(pos.x, pos.y ?? 0, pos.z); break;
    case 'wall': ob = buildWall(ctx, W, o); break;
    case 'pylon': ob = buildPylon(ctx, W, o); break;
    default: return null;
  }
  // towers, stacks, arches etc. keep their own y (base offsets are baked in), free floaters take pos.y
  if (['rock', 'tunnel', 'laserGate', 'spinner'].includes(type) && pos) ob.position.y = pos.y ?? 0;
  return ob;
}

/** Builds the tunnel rock list: length along z, rings of rocks around the flight path. */
export function tunnelRocks(rng, { length = 120, spacing = 26, innerR = 24, pinch = null }) {
  const rocks = [];
  const rings = Math.max(2, Math.round(length / spacing));
  for (let i = 0; i < rings; i++) {
    const z = -length / 2 + (i + 0.5) * (length / rings);
    const n = 9;
    for (let k = 0; k < n; k++) {
      const a = (k / n) * Math.PI * 2 + rng.range(-0.15, 0.15) + i * 0.4;
      const sr = rng.range(5.5, 9.5);
      let rad = innerR + sr * 0.55 + rng.range(-1, 3);
      // ellipse: the flight area is wider than tall
      rocks.push({ x: Math.cos(a) * rad * 1.15, y: Math.sin(a) * rad * 0.9, z: z + rng.range(-4, 4), r: sr });
    }
    // outer filler (not collidable)
    for (let k = 0; k < 6; k++) {
      const a = rng.range(0, Math.PI * 2), rad = innerR + 22 + rng.range(0, 14);
      rocks.push({ x: Math.cos(a) * rad, y: Math.sin(a) * rad * 0.85, z: z + rng.range(-10, 10), r: rng.range(10, 16), collide: false });
    }
    if (pinch && i === pinch.ring) {
      // a boulder that narrows the passage on one side
      rocks.push({ x: pinch.x, y: pinch.y, z: z, r: 9 });
    }
  }
  return rocks;
}

export { Rng };
