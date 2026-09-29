// Geometry and texture helpers for the procedural ship models.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

export const hexCss = (h) => '#' + new THREE.Color(h).getHexString();
export function mixHex(a, b, t) { return new THREE.Color(a).lerp(new THREE.Color(b), t).getHex(); }

/**
 * Loft a smooth body along Z through superelliptic cross sections.
 * stations: [{z, w (half width), t (top half height), b (bottom half height), y (centre), n (exponent, 2 = ellipse)}]
 * UV: u = angle around (0 at +X, 0.25 at top, 0.5 at -X, 0.75 at bottom), v = 0 at first station to 1 at last.
 */
export function loft(stations, seg = 28) {
  const rings = stations.length, stride = seg + 1;
  const pos = new Float32Array(rings * stride * 3), uv = new Float32Array(rings * stride * 2);
  const z0 = stations[0].z, z1 = stations[rings - 1].z;
  for (let r = 0; r < rings; r++) {
    const st = stations[r], ex = 2 / (st.n || 2), v = (st.z - z0) / (z1 - z0);
    for (let i = 0; i <= seg; i++) {
      const a = (i / seg) * Math.PI * 2, c = Math.cos(a), s = Math.sin(a);
      const k = (r * stride + i);
      pos[k * 3] = st.w * Math.sign(c) * Math.pow(Math.abs(c), ex);
      pos[k * 3 + 1] = (st.y || 0) + (s >= 0 ? st.t : st.b) * Math.sign(s) * Math.pow(Math.abs(s), ex);
      pos[k * 3 + 2] = st.z;
      uv[k * 2] = i / seg; uv[k * 2 + 1] = v;
    }
  }
  const idx = [];
  for (let r = 0; r < rings - 1; r++) for (let i = 0; i < seg; i++) {
    const a = r * stride + i, b = a + 1, c = a + stride, d = c + 1;
    idx.push(a, b, c, b, d, c);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  // remove the shading seam where the ring closes
  const n = g.attributes.normal;
  for (let r = 0; r < rings; r++) {
    const a = r * stride, b = r * stride + seg;
    const x = n.getX(a) + n.getX(b), y = n.getY(a) + n.getY(b), z = n.getZ(a) + n.getZ(b);
    const l = Math.hypot(x, y, z) || 1;
    n.setXYZ(a, x / l, y / l, z / l); n.setXYZ(b, x / l, y / l, z / l);
  }
  return g;
}

/**
 * Extruded flat planform. pts are [x, z] pairs in world orientation (nose is -z). Thickness along Y.
 * Vertices are tapered in thickness from the root (|x| = 0) to the tip (|x| = span). UV maps to (|x|/uSpan, (z - zMin)/zRange).
 */
export function planform(pts, thickness, { bevel = 0.02, taper = [1.5, 0.5], span = 3, uSpan = 3, zMin = -1.2, zRange = 3 } = {}) {
  const shape = new THREE.Shape();
  pts.forEach(([x, z], i) => (i ? shape.lineTo(x, -z) : shape.moveTo(x, -z)));
  shape.closePath();
  const g = new THREE.ExtrudeGeometry(shape, { depth: thickness, bevelEnabled: bevel > 0, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 1, curveSegments: 1 });
  g.rotateX(-Math.PI / 2);
  g.translate(0, -thickness / 2, 0);
  const p = g.attributes.position, uv = g.attributes.uv;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const t = Math.min(1, Math.abs(x) / span);
    p.setY(i, y * (taper[0] + (taper[1] - taper[0]) * t));
    uv.setXY(i, Math.abs(x) / uSpan, (z - zMin) / zRange);
  }
  g.computeVertexNormals();
  return g;
}

/** Flat vertical fin: pts are [z, y] pairs, thickness along X, centred on x = 0. */
export function fin(pts, thickness, bevel = 0.01) {
  const shape = new THREE.Shape();
  pts.forEach(([z, y], i) => (i ? shape.lineTo(z, y) : shape.moveTo(z, y)));
  shape.closePath();
  const g = new THREE.ExtrudeGeometry(shape, { depth: thickness, bevelEnabled: bevel > 0, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 1, curveSegments: 1 });
  g.rotateY(-Math.PI / 2); // shape x -> world z, extrusion -> world -x
  g.translate(thickness / 2, 0, 0);
  return g;
}

/** Lathe about the Z axis (increasing profile y goes toward +Z). profile: [[radius, along], ...] */
export function latheZ(profile, seg = 20) {
  const g = new THREE.LatheGeometry(profile.map(([r, y]) => new THREE.Vector2(r, y)), seg);
  g.rotateX(Math.PI / 2);
  return g;
}

export function canvasTex(w, h, draw, { srgb = true, aniso = 8, repeat } = {}) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const g = c.getContext('2d'); draw(g, w, h);
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = aniso;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.needsUpdate = true;
  return t;
}

let _glowTex = null;
export function glowTexture() {
  if (_glowTex) return _glowTex;
  _glowTex = canvasTex(128, 128, (g, w, h) => {
    const gr = g.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
    gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.25, 'rgba(255,255,255,0.55)'); gr.addColorStop(0.6, 'rgba(255,255,255,0.12)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr; g.fillRect(0, 0, w, h);
  }, { srgb: false, aniso: 1 });
  return _glowTex;
}

let _scorchTex = null;
export function scorchTexture() {
  if (_scorchTex) return _scorchTex;
  _scorchTex = canvasTex(128, 128, (g, w, h) => {
    const gr = g.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
    gr.addColorStop(0, 'rgba(8,6,5,0.95)'); gr.addColorStop(0.5, 'rgba(15,10,8,0.7)'); gr.addColorStop(1, 'rgba(15,10,8,0)');
    g.fillStyle = gr; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 40; i++) { g.fillStyle = `rgba(0,0,0,${Math.random() * 0.35})`; g.beginPath(); g.arc(w / 2 + (Math.random() - 0.5) * w * 0.7, h / 2 + (Math.random() - 0.5) * h * 0.7, 2 + Math.random() * 7, 0, 7); g.fill(); }
  }, { srgb: true, aniso: 1 });
  return _scorchTex;
}

// baking helpers: fold many static parts into one draw call
const _bm = new THREE.Matrix4(), _bq = new THREE.Quaternion(), _be = new THREE.Euler(), _bp = new THREE.Vector3(), _bs = new THREE.Vector3();

/** Clone a geometry and bake a transform into it. t: {x,y,z, rx,ry,rz (radians, XYZ order), sx,sy,sz}. */
export function place(geo, t = {}) {
  const { x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1 } = t;
  _bq.setFromEuler(_be.set(rx, ry, rz)); _bp.set(x, y, z); _bs.set(sx, sy, sz);
  _bm.compose(_bp, _bq, _bs);
  return geo.clone().applyMatrix4(_bm);
}

/** Merge geometries (position, normal, uv only) into one non indexed geometry. Inputs are left untouched. */
export function mergeGeos(list) {
  const clean = list.map((g) => {
    const c = g.index ? g.toNonIndexed() : g.clone();
    for (const k of Object.keys(c.attributes)) if (k !== 'position' && k !== 'normal' && k !== 'uv') c.deleteAttribute(k);
    return c;
  });
  const out = mergeGeometries(clean, false);
  clean.forEach((c) => c.dispose());
  return out;
}

/** Clip a 2D polygon ([x, z] pairs) to xmin <= x <= xmax (Sutherland-Hodgman against two vertical lines). */
export function clipX(poly, xmin, xmax) {
  const pass = (pts, keep, edge) => {
    const out = [];
    for (let i = 0; i < pts.length; i++) {
      const a = pts[(i + pts.length - 1) % pts.length], b = pts[i];
      const ka = keep(a[0]), kb = keep(b[0]);
      const cut = () => { const t = (edge - a[0]) / (b[0] - a[0]); return [edge, a[1] + t * (b[1] - a[1])]; };
      if (kb) { if (!ka) out.push(cut()); out.push(b); } else if (ka) out.push(cut());
    }
    return out;
  };
  let p = pass(poly, (x) => x >= xmin, xmin);
  if (p.length) p = pass(p, (x) => x <= xmax, xmax);
  return p;
}

/** Rotate a geometry about the fore-aft axis line (x = hx, y = 0). ang > 0 lowers the outboard side of the side s (+1 or -1). */
export function bendGeo(geo, hx, ang, s) {
  geo.translate(-s * hx, 0, 0); geo.rotateZ(-s * ang); geo.translate(s * hx, 0, 0);
  return geo;
}

/** Flat blade shaped lens: pointed at both ends, lofted from z0 to z1. Returns a geometry with its base at y = 0. */
export function bladeLoft(z0, z1, halfW, height, seg = 20) {
  const st = [];
  const N = 12;
  for (let i = 0; i <= N; i++) {
    const t = i / N, z = z0 + (z1 - z0) * t;
    const prof = Math.pow(Math.sin(Math.PI * Math.pow(t, 0.72)), 0.85);
    st.push({ z, w: Math.max(0.005, halfW * prof), t: Math.max(0.004, height * prof), b: 0.004, y: 0, n: 2.4 });
  }
  return loft(st, seg);
}
