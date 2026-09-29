// Shared helpers for the world module: rng, noise, procedural geometry, canvas textures,
// slot based instanced pools and a fog aware billboard material.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// ---------------------------------------------------------------- random
export function mulberry32(seed) {
  let a = seed | 0;
  return function () {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class Rng {
  constructor(seed = 1) { this.f = mulberry32(seed); }
  r() { return this.f(); }
  range(a, b) { return a + (b - a) * this.f(); }
  int(a, b) { return Math.floor(this.range(a, b + 1)); }
  sign() { return this.f() < 0.5 ? -1 : 1; }
  pick(arr) { return arr[Math.floor(this.f() * arr.length)]; }
  chance(p) { return this.f() < p; }
}

// ---------------------------------------------------------------- noise (cpu, for geometry)
function h3(x, y, z) {
  let n = Math.sin(x * 127.1 + y * 311.7 + z * 74.7) * 43758.5453;
  return n - Math.floor(n);
}
export function noise3(x, y, z) {
  const ix = Math.floor(x), iy = Math.floor(y), iz = Math.floor(z);
  const fx = x - ix, fy = y - iy, fz = z - iz;
  const ux = fx * fx * (3 - 2 * fx), uy = fy * fy * (3 - 2 * fy), uz = fz * fz * (3 - 2 * fz);
  const l = (a, b, t) => a + (b - a) * t;
  return l(
    l(l(h3(ix, iy, iz), h3(ix + 1, iy, iz), ux), l(h3(ix, iy + 1, iz), h3(ix + 1, iy + 1, iz), ux), uy),
    l(l(h3(ix, iy, iz + 1), h3(ix + 1, iy, iz + 1), ux), l(h3(ix, iy + 1, iz + 1), h3(ix + 1, iy + 1, iz + 1), ux), uy),
    uz,
  );
}
export function fbm3(x, y, z, oct = 4) {
  let a = 0.5, s = 0, f = 1;
  for (let i = 0; i < oct; i++) { s += a * noise3(x * f, y * f, z * f); f *= 2.03; a *= 0.5; }
  return s;
}

// ---------------------------------------------------------------- geometry
const _c = new THREE.Color();
function paintColors(geo, fn) {
  const pos = geo.attributes.position;
  const col = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    fn(pos.getX(i), pos.getY(i), pos.getZ(i), _c);
    col[i * 3] = _c.r; col[i * 3 + 1] = _c.g; col[i * 3 + 2] = _c.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
}

/** Lumpy unit rock (radius about 1) with vertex colours; use flatShading materials. */
export function rockGeometry(seed = 1, { detail = 1, rough = 0.35, squash = 1, base = 0x8a8478, tint = 0x5a544c, stretch = 1 } = {}) {
  const geo = new THREE.IcosahedronGeometry(1, detail);
  const pos = geo.attributes.position;
  const o = seed * 17.31;
  const v = new THREE.Vector3();
  const cA = new THREE.Color(base), cB = new THREE.Color(tint);
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const n = fbm3(v.x * 1.6 + o, v.y * 1.6 + o, v.z * 1.6 + o, 3);
    const d = 1 + (n - 0.5) * 2 * rough;
    v.multiplyScalar(d);
    v.y *= squash; v.z *= stretch;
    pos.setXYZ(i, v.x, v.y, v.z);
  }
  paintColors(geo, (x, y, z, c) => {
    const n = fbm3(x * 2.2 + o, y * 2.2, z * 2.2 + o, 3);
    c.copy(cA).lerp(cB, n * 1.3 - 0.2);
  });
  geo.computeVertexNormals();
  geo.computeBoundingSphere();
  return geo;
}

/** Tall lumpy cliff or sea stack: unit footprint radius 1, height 1, base at y=0. */
export function cliffGeometry(seed = 1, { rock = 0x8c806c, dark = 0x54493d, top = 0x5b8a3c, topAmount = 0.35, taper = 0.62, rough = 0.32 } = {}) {
  const geo = new THREE.CylinderGeometry(taper, 1, 1, 11, 7, false);
  geo.translate(0, 0.5, 0);
  const pos = geo.attributes.position;
  const o = seed * 9.13;
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const n = fbm3(v.x * 1.3 + o, v.y * 2.2, v.z * 1.3 + o, 3);
    const d = 1 + (n - 0.5) * 2 * rough;
    const cap = v.y > 0.99;
    if (!cap) { v.x *= d; v.z *= d; }
    else { v.x *= 0.9 + (n - 0.5) * 0.4; v.z *= 0.9 + (n - 0.5) * 0.4; }
    v.y += (n - 0.5) * 0.06;
    pos.setXYZ(i, v.x, v.y, v.z);
  }
  const cR = new THREE.Color(rock), cD = new THREE.Color(dark), cT = new THREE.Color(top);
  paintColors(geo, (x, y, z, c) => {
    const n = fbm3(x * 3 + o, y * 5, z * 3, 3);
    c.copy(cR).lerp(cD, (1 - y) * 0.6 + n * 0.5 - 0.15);
    if (y > 1 - topAmount + (n - 0.5) * 0.25) c.copy(cT).lerp(cR, n * 0.5);
  });
  geo.computeVertexNormals();
  return geo;
}

/** Coral-like spire: unit footprint radius 1, height 1, base at y=0. Twisted main tine, side branches and shelves. */
export function coralSpireGeometry(seed = 1, { low = 0x8a3f4c, mid = 0xe5765a, tip = 0xffcf8c, branches = 3, shelves = 2 } = {}) {
  const o = seed * 5.71;
  const cL = new THREE.Color(low), cM = new THREE.Color(mid), cT = new THREE.Color(tip);
  const parts = [];
  const v = new THREE.Vector3();
  const tine = (rBot, rTop, h, tx, tz, ox, oy, oz, twist) => {
    const g = new THREE.CylinderGeometry(rTop, rBot, h, 6, Math.max(3, Math.round(h * 4)), false);
    g.translate(0, h / 2, 0);
    const p = g.attributes.position, col = new Float32Array(p.count * 3);
    for (let i = 0; i < p.count; i++) {
      v.fromBufferAttribute(p, i);
      const y01 = v.y / h;
      const n = fbm3(v.x * 1.5 + o, v.y * 3.0, v.z * 1.5 + o, 3);
      const k = 1 + (n - 0.5) * 0.7 * (1 - y01 * 0.5);
      const a = twist * y01, ca = Math.cos(a), sa = Math.sin(a);
      const x = v.x * k, z = v.z * k;
      v.x = x * ca - z * sa; v.z = x * sa + z * ca;
      p.setXYZ(i, v.x, v.y, v.z);
      const t = Math.min(1, Math.max(0, y01 + (n - 0.5) * 0.3));
      const c = t < 0.55 ? _c.copy(cL).lerp(cM, t / 0.55) : _c.copy(cM).lerp(cT, (t - 0.55) / 0.45);
      col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
    }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.rotateX(tx); g.rotateZ(tz); g.translate(ox, oy, oz);
    parts.push(g);
  };
  tine(1, 0.05, 1, 0, 0, 0, 0, 0, 1.2);
  const rr = new Rng(seed * 31 + 7);
  for (let i = 0; i < branches; i++) {
    const a = rr.range(0, Math.PI * 2), y0 = rr.range(0.1, 0.4), h = rr.range(0.4, 0.7), lean = rr.range(0.5, 0.95);
    tine(0.34, 0.03, h, Math.sin(a) * lean, -Math.cos(a) * lean, Math.cos(a) * 0.55, y0, Math.sin(a) * 0.55, rr.range(-1.4, 1.4));
  }
  for (let i = 0; i < shelves; i++) {
    const y = rr.range(0.28, 0.62), r = rr.range(0.55, 0.8) * (1 - y * 0.6);
    const g = new THREE.CylinderGeometry(r, r * 0.55, 0.035, 8, 1, false);
    const p = g.attributes.position, col = new Float32Array(p.count * 3);
    for (let k = 0; k < p.count; k++) { const c = _c.copy(cM).lerp(cT, 0.35 + (p.getY(k) > 0 ? 0.35 : 0)); col[k * 3] = c.r; col[k * 3 + 1] = c.g; col[k * 3 + 2] = c.b; }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.rotateX(rr.range(-0.15, 0.15)); g.rotateY(rr.range(0, 6));
    g.translate(0, y, 0);
    parts.push(g);
  }
  const out = mergeGeometries(parts, false);
  out.computeVertexNormals();
  out.computeBoundingSphere();
  return out;
}

/** Floating platform: hex slab with a rocky keel. Radius 1, top surface at y=0, keel hangs below. */
export function platformGeometry(seed = 1) {
  const o = seed * 3.3;
  const parts = [];
  const paint = (g, fn) => {
    const p = g.attributes.position, col = new Float32Array(p.count * 3);
    for (let i = 0; i < p.count; i++) { fn(p.getX(i), p.getY(i), p.getZ(i), p.getY(i), _c); col[i * 3] = _c.r; col[i * 3 + 1] = _c.g; col[i * 3 + 2] = _c.b; }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  };
  const slab = new THREE.CylinderGeometry(1, 0.94, 0.16, 6, 1, false);
  slab.translate(0, -0.08, 0);
  paint(slab, (x, y, z, yy, c) => { if (yy > -0.01) c.set(0xf0dcae); else c.set(0x2c8d90).lerp(new THREE.Color(0x7a3a44), Math.min(1, (-yy - 0.02) * 6)); });
  parts.push(slab);
  const inset = new THREE.CylinderGeometry(0.62, 0.66, 0.05, 6, 1, false);
  inset.translate(0, 0.02, 0);
  paint(inset, (x, y, z, yy, c) => c.set(0xffe9b8));
  parts.push(inset);
  const keel = new THREE.CylinderGeometry(0.93, 0.1, 0.95, 6, 4, false);
  keel.translate(0, -0.16 - 0.475, 0);
  const p = keel.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const n = fbm3(x * 2 + o, y * 3, z * 2 + o, 3);
    const k = 1 + (n - 0.5) * 0.7;
    if (y < -0.2) p.setXYZ(i, x * k, y - Math.max(0, n - 0.4) * 0.3, z * k);
  }
  paint(keel, (x, y, z, yy, c) => { const t = Math.min(1, (-yy - 0.16) / 0.95); c.set(0x8a4550).lerp(new THREE.Color(0x2a1a2a), t); });
  parts.push(keel);
  const g = mergeGeometries(parts, false);
  g.computeVertexNormals();
  return g;
}

/** Hex frame (thin glowing edges) matching platformGeometry, for an emissive material. */
export function hexFrameGeometry(w = 0.05) {
  const parts = [];
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    const b = new THREE.BoxGeometry(1.02, 0.045, w);
    b.rotateY(-a - Math.PI / 2);
    b.translate(Math.cos(a) * 0.87, 0.03, Math.sin(a) * 0.87);
    parts.push(b);
  }
  return mergeGeometries(parts, false);
}

/** Charred wreckage: shape 0 chunk, 1 slab (hull plate), 2 shard. Unit size, vertex coloured charcoal. Cracks glow via debrisMaterial. */
export function debrisGeometry(seed = 1, shape = 0, { base = 0x3b302d, tint = 0x161112, ash = 0x6b5b54 } = {}) {
  let geo;
  if (shape === 1) geo = new THREE.BoxGeometry(1.7, 0.3, 1.25, 3, 1, 3);
  else if (shape === 2) { geo = new THREE.OctahedronGeometry(1, 1); }
  else geo = new THREE.IcosahedronGeometry(1, 1);
  const pos = geo.attributes.position;
  const o = seed * 13.7 + shape * 4.1;
  const v = new THREE.Vector3();
  const rough = shape === 1 ? 0.22 : 0.4;
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const n = fbm3(v.x * 1.5 + o, v.y * 1.5 + o, v.z * 1.5 + o, 3);
    v.multiplyScalar(1 + (n - 0.5) * 2 * rough);
    if (shape === 2) { v.x *= 0.5; v.y *= 0.45; v.z *= 1.7; }
    if (shape === 1) { v.y += (fbm3(v.x * 0.9 + o, 3.3, v.z * 0.9, 2) - 0.5) * 0.3; }
    pos.setXYZ(i, v.x, v.y, v.z);
  }
  const cA = new THREE.Color(base), cB = new THREE.Color(tint), cC = new THREE.Color(ash);
  paintColors(geo, (x, y, z, c) => {
    const n = fbm3(x * 2.4 + o, y * 2.4, z * 2.4 + o, 3);
    c.copy(cA).lerp(cB, Math.min(1, Math.max(0, n * 1.5 - 0.25)));
    if (n > 0.62) c.lerp(cC, 0.6);
  });
  geo.computeVertexNormals();
  geo.computeBoundingSphere();
  return geo;
}

/** Toothed gear with lightening holes, axis along z, radius 1, thickness `thick`, centred on the origin. */
export function gearGeometry({ teeth = 20, ri = 0.88, hole = 0.16, thick = 0.14, holes = 6, uv = 0.02 } = {}) {
  const sh = new THREE.Shape();
  const step = (Math.PI * 2) / teeth;
  for (let i = 0; i < teeth; i++) {
    const a = i * step;
    const pts = [[ri, a], [1, a + step * 0.12], [1, a + step * 0.42], [ri, a + step * 0.54]];
    pts.forEach(([r, ang], k) => { const x = Math.cos(ang) * r, y = Math.sin(ang) * r; if (i === 0 && k === 0) sh.moveTo(x, y); else sh.lineTo(x, y); });
  }
  sh.closePath();
  const axle = new THREE.Path(); axle.absarc(0, 0, hole, 0, Math.PI * 2, true); sh.holes.push(axle);
  for (let i = 0; i < holes; i++) {
    const a = (i / holes) * Math.PI * 2, r = 0.2;
    const h = new THREE.Path(); h.absarc(Math.cos(a) * 0.53, Math.sin(a) * 0.53, r, 0, Math.PI * 2, true); sh.holes.push(h);
  }
  const g = new THREE.ExtrudeGeometry(sh, { depth: thick, bevelEnabled: false, curveSegments: 5 });
  g.translate(0, 0, -thick / 2);
  const u = g.attributes.uv;
  for (let i = 0; i < u.count; i++) u.setXY(i, u.getX(i) * uv * 30, u.getY(i) * uv * 30);
  g.computeVertexNormals();
  return g;
}

/** Box from y=0 to y=h with UVs scaled to real size so a tiling window texture works. */
export function texturedBox(w, h, d, uvScale = 0.25) {
  const g = new THREE.BoxGeometry(w, h, d);
  g.translate(0, h / 2, 0);
  const uv = g.attributes.uv, n = g.attributes.normal;
  for (let i = 0; i < uv.count; i++) {
    const nx = Math.abs(n.getX(i)), nz = Math.abs(n.getZ(i)), ny = Math.abs(n.getY(i));
    let su = nx > 0.5 ? d : w, sv = h;
    if (ny > 0.5) { su = w; sv = d; }
    if (nz > 0.5) su = w;
    uv.setXY(i, uv.getX(i) * su * uvScale, uv.getY(i) * sv * uvScale);
  }
  return g;
}

// ---------------------------------------------------------------- textures
export function canvasTexture(w, h, draw, { repeat = false, srgb = true } = {}) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const g = c.getContext('2d');
  draw(g, w, h);
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 4;
  return t;
}

export function cloudTexture(tint = '255,255,255', shade = '170,190,215') {
  return canvasTexture(128, 128, (g, w, h) => {
    const r = new Rng(7);
    g.clearRect(0, 0, w, h);
    for (let i = 0; i < 26; i++) {
      const x = w * (0.22 + r.r() * 0.56), y = h * (0.36 + r.r() * 0.3), rad = w * (0.1 + r.r() * 0.15);
      const gr = g.createRadialGradient(x, y, 0, x, y, rad);
      gr.addColorStop(0, `rgba(${tint},0.55)`);
      gr.addColorStop(0.6, `rgba(${tint},0.22)`);
      gr.addColorStop(1, `rgba(${tint},0)`);
      g.fillStyle = gr; g.fillRect(0, 0, w, h);
    }
    // soft underside shading
    g.globalCompositeOperation = 'source-atop';
    const sh = g.createLinearGradient(0, h * 0.3, 0, h * 0.75);
    sh.addColorStop(0, `rgba(${shade},0)`);
    sh.addColorStop(1, `rgba(${shade},0.55)`);
    g.fillStyle = sh; g.fillRect(0, 0, w, h);
    g.globalCompositeOperation = 'source-over';
  });
}

export function softDotTexture(inner = '255,255,255') {
  return canvasTexture(64, 64, (g, w, h) => {
    const gr = g.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
    gr.addColorStop(0, `rgba(${inner},1)`);
    gr.addColorStop(0.35, `rgba(${inner},0.35)`);
    gr.addColorStop(1, `rgba(${inner},0)`);
    g.fillStyle = gr; g.fillRect(0, 0, w, h);
  });
}

// ---------------------------------------------------------------- instanced slot pool
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _p = new THREE.Vector3(), _s = new THREE.Vector3(), _col = new THREE.Color();
const ZERO = new THREE.Matrix4().makeScale(0, 0, 0);

/** One InstancedMesh split in equal slots, one slot per streaming chunk. */
export class SlotPool {
  constructor(geometry, material, slots, perSlot, { colors = true } = {}) {
    this.per = perSlot;
    this.mesh = new THREE.InstancedMesh(geometry, material, slots * perSlot);
    this.mesh.frustumCulled = false;
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    for (let i = 0; i < slots * perSlot; i++) this.mesh.setMatrixAt(i, ZERO);
    if (colors) {
      this.mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(slots * perSlot * 3).fill(1), 3);
      this.mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
    }
    this.base = 0; this.cur = 0; this.colors = colors;
  }
  begin(slot) { this.base = slot * this.per; this.cur = 0; }
  add(x, y, z, sx, sy, sz, rx = 0, ry = 0, rz = 0, color = null) {
    if (this.cur >= this.per) return -1;
    _p.set(x, y, z); _s.set(sx, sy, sz); _e.set(rx, ry, rz); _q.setFromEuler(_e);
    _m.compose(_p, _q, _s);
    const i = this.base + this.cur++;
    this.mesh.setMatrixAt(i, _m);
    if (this.colors && color !== null) this.mesh.setColorAt(i, _col.set(color));
    else if (this.colors) this.mesh.setColorAt(i, _col.setRGB(1, 1, 1));
    return i;
  }
  end() {
    for (let i = this.cur; i < this.per; i++) this.mesh.setMatrixAt(this.base + i, ZERO);
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.colors) this.mesh.instanceColor.needsUpdate = true;
  }
  clearAll() {
    for (let i = 0; i < this.mesh.count; i++) this.mesh.setMatrixAt(i, ZERO);
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}

// ---------------------------------------------------------------- chunk streaming
/**
 * Keeps `count` chunks of length `len` populated around the rail. populate(slot, index, zStart, zEnd)
 * is called for every (re)used slot. Robust to teleporting the rail. maxPerFrame limits hitches.
 */
export class ChunkStreamer {
  constructor({ len, count, behind = 1, populate }) {
    this.len = len; this.count = count; this.behind = behind; this.populate = populate;
    this.idx = new Int32Array(count).fill(-99999);
  }
  invalidate() { this.idx.fill(-99999); }
  update(railZ, maxPerFrame = 3, force = false) {
    const cur = Math.floor(-railZ / this.len) - this.behind;
    let done = 0;
    for (let k = 0; k < this.count; k++) {
      const index = cur + k;
      if (index < 0) continue;
      const slot = ((index % this.count) + this.count) % this.count;
      if (this.idx[slot] === index) continue;
      // nearest chunks first, so populate in order of k
      if (!force && done >= maxPerFrame) break;
      this.idx[slot] = index;
      this.populate(slot, index, -index * this.len, -(index + 1) * this.len);
      done++;
    }
    return done;
  }
}

// ---------------------------------------------------------------- billboard material
const BB_VERT = /* glsl */ `
varying vec2 vUv; varying vec3 vTint;
#include <fog_pars_vertex>
void main(){
  vUv = uv;
  #ifdef USE_INSTANCING_COLOR
    vTint = instanceColor;
  #else
    vTint = vec3(1.0);
  #endif
  vec3 c = instanceMatrix[3].xyz;
  float sx = length(instanceMatrix[0].xyz), sy = length(instanceMatrix[1].xyz);
  vec4 mvPosition = modelViewMatrix * vec4(c, 1.0);
  mvPosition.xy += position.xy * vec2(sx, sy);
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}`;
const BB_FRAG = /* glsl */ `
uniform sampler2D map; uniform vec3 uColor; uniform float uOpacity; uniform float uNear; uniform float uFade;
varying vec2 vUv; varying vec3 vTint;
#include <fog_pars_fragment>
void main(){
  vec4 t = texture2D(map, vUv);
  gl_FragColor = vec4(uColor * vTint * t.rgb, t.a * uOpacity);
  #ifdef USE_FOG
    #ifdef ADDITIVE
      float f = smoothstep(fogNear, fogFar, vFogDepth);
      gl_FragColor.a *= 1.0 - f;
    #else
      #include <fog_fragment>
    #endif
  #endif
  // fade out when very close to the camera so puffs do not pop over the ship
  #ifdef USE_FOG
    gl_FragColor.a *= smoothstep(uNear, uNear * 2.0, vFogDepth);
  #endif
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

export function billboardMaterial(map, { color = 0xffffff, opacity = 1, additive = false, near = 30 } = {}) {
  const m = new THREE.ShaderMaterial({
    uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {
      map: { value: map }, uColor: { value: new THREE.Color(color) }, uOpacity: { value: opacity }, uNear: { value: near }, uFade: { value: 1 },
    }]),
    vertexShader: BB_VERT, fragmentShader: BB_FRAG,
    transparent: true, depthWrite: false, fog: true,
    blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    defines: additive ? { ADDITIVE: '' } : {},
  });
  return m;
}

export function billboardPool(map, slots, per, opts = {}) {
  const geo = new THREE.PlaneGeometry(1, 1);
  const mat = billboardMaterial(map, opts);
  const pool = new SlotPool(geo, mat, slots, per, { colors: true });
  pool.mesh.renderOrder = opts.renderOrder ?? 2;
  return pool;
}

export const V = {
  tmp: new THREE.Vector3(),
};

/** Dispose everything under an object3d that we created (geometry and materials flagged shared are skipped). */
export function disposeTree(obj, sharedSet) {
  obj.traverse((o) => {
    if (o.geometry && !(sharedSet && sharedSet.has(o.geometry))) o.geometry.dispose?.();
    const mats = Array.isArray(o.material) ? o.material : o.material ? [o.material] : [];
    for (const m of mats) if (!(sharedSet && sharedSet.has(m))) m.dispose?.();
  });
}
