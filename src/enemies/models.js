// Shared procedural modelling kit for enemies and bosses: cached geometry, shared materials,
// geometry merging and glow sprites. All models face +Z (nose toward the player, who looks down -Z).
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const cache = new Map();
const memo = (k, f) => { let v = cache.get(k); if (!v) { v = f(); cache.set(k, v); } return v; };

export const G = {
  box: (w, h, d) => memo(`b${w},${h},${d}`, () => new THREE.BoxGeometry(w, h, d)),
  cyl: (rt, rb, h, s = 8) => memo(`c${rt},${rb},${h},${s}`, () => new THREE.CylinderGeometry(rt, rb, h, s)),
  cone: (r, h, s = 6) => memo(`n${r},${h},${s}`, () => new THREE.ConeGeometry(r, h, s)),
  oct: (r, d = 0) => memo(`o${r},${d}`, () => new THREE.OctahedronGeometry(r, d)),
  ico: (r, d = 0) => memo(`i${r},${d}`, () => new THREE.IcosahedronGeometry(r, d)),
  sph: (r, w = 14, h = 10) => memo(`s${r},${w},${h}`, () => new THREE.SphereGeometry(r, w, h)),
  tor: (r, t, rs = 8, ts = 24) => memo(`t${r},${t},${rs},${ts}`, () => new THREE.TorusGeometry(r, t, rs, ts)),
};

// Swept trapezoid wing (flat shaded prism). side +1 = right (+x), -1 = left. sweep < 0 sweeps the tip backwards (-Z).
export function wingGeo(rootChord, tipChord, span, sweep, thick, side = 1, tipThick = thick * 0.5) {
  return memo(`w${rootChord},${tipChord},${span},${sweep},${thick},${side},${tipThick}`, () => {
    const s = side, rc = rootChord / 2, tc = tipChord / 2, t = thick / 2, tt = tipThick / 2;
    const v = [[0, t, rc], [0, t, -rc], [0, -t, -rc], [0, -t, rc], [s * span, tt, sweep + tc], [s * span, tt, sweep - tc], [s * span, -tt, sweep - tc], [s * span, -tt, sweep + tc]];
    const c = new THREE.Vector3(); v.forEach((p) => c.add(new THREE.Vector3(...p))); c.divideScalar(8);
    const pos = [];
    const tri = (a, b, d) => {
      const A = new THREE.Vector3(...v[a]), B = new THREE.Vector3(...v[b]), D = new THREE.Vector3(...v[d]);
      const n = new THREE.Vector3().crossVectors(B.clone().sub(A), D.clone().sub(A));
      const f = A.clone().add(B).add(D).divideScalar(3).sub(c);
      if (n.dot(f) < 0) { pos.push(...A.toArray(), ...D.toArray(), ...B.toArray()); } else pos.push(...A.toArray(), ...B.toArray(), ...D.toArray());
    };
    for (const q of [[0, 1, 5, 4], [3, 7, 6, 2], [0, 4, 7, 3], [1, 2, 6, 5], [4, 5, 6, 7], [0, 3, 2, 1]]) { tri(q[0], q[1], q[2]); tri(q[0], q[2], q[3]); }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.computeVertexNormals();
    return g;
  });
}
/** Two mirrored wings as parts. dih = dihedral (z rotation, radians, positive tips up). */
export const wingPair = (rootChord, tipChord, span, sweep, thick, x = 0, y = 0, z = 0, dih = 0, tipThick) => [
  part(wingGeo(rootChord, tipChord, span, sweep, thick, 1, tipThick), x, y, z, 0, 0, dih),
  part(wingGeo(rootChord, tipChord, span, sweep, thick, -1, tipThick), -x, y, z, 0, 0, -dih),
];

/** Annular sector plate (extruded along Z, centred), angle in radians. rIn = 0 gives a pie slice. */
export function arcPlate(rIn, rOut, angle, depth) {
  return memo(`ap${rIn},${rOut},${angle},${depth}`, () => {
    const sh = new THREE.Shape(), c0 = Math.cos(0), s0 = Math.sin(0), c1 = Math.cos(angle), s1 = Math.sin(angle);
    if (rIn > 0) { sh.moveTo(rIn * c0, rIn * s0); sh.lineTo(rOut * c0, rOut * s0); sh.absarc(0, 0, rOut, 0, angle, false); sh.lineTo(rIn * c1, rIn * s1); sh.absarc(0, 0, rIn, angle, 0, true); }
    else { sh.moveTo(0, 0); sh.lineTo(rOut, 0); sh.absarc(0, 0, rOut, 0, angle, false); sh.lineTo(0, 0); }
    const g = new THREE.ExtrudeGeometry(sh, { depth, bevelEnabled: false, curveSegments: 5 });
    g.translate(0, 0, -depth / 2);
    return g;
  });
}

export const part = (geo, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1) =>
  ({ geo, x, y, z, rx, ry, rz, sx, sy, sz });
/** Returns the parts plus x-mirrored copies (rotations mirrored across the YZ plane). */
export const sym = (...parts) => parts.flatMap((p) => (p.x === 0 && p.ry === 0 && p.rz === 0 ? [p] : [p, { ...p, x: -p.x, ry: -p.ry, rz: -p.rz }]));

const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _p = new THREE.Vector3(), _s = new THREE.Vector3();
/** Merge parts into one cached BufferGeometry (flat shaded, one draw call). */
export function merged(key, parts) {
  return memo(`m${key}`, () => {
    const gs = parts.flat().map((p) => {
      const g = p.geo.index ? p.geo.toNonIndexed() : p.geo.clone();
      g.deleteAttribute('uv');
      _m.compose(_p.set(p.x, p.y, p.z), _q.setFromEuler(_e.set(p.rx, p.ry, p.rz)), _s.set(p.sx, p.sy, p.sz));
      g.applyMatrix4(_m);
      return g;
    });
    const out = mergeGeometries(gs, false);
    gs.forEach((g) => g.dispose());
    return out;
  });
}

const std = (color, o = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.5, metalness: 0.55, flatShading: true, ...o });
export const makeStd = std;
const glow = (hex, i = 2.6) => new THREE.MeshStandardMaterial({ color: 0x140a0a, emissive: hex, emissiveIntensity: i, roughness: 0.4, metalness: 0, flatShading: true });

export const MAT = {
  red: std(0xd2323f, { emissive: 0x3a0609 }),
  darkRed: std(0x7a1a2a, { emissive: 0x1c0410 }),
  orange: std(0xf07a20, { emissive: 0x3a1a06 }),
  purple: std(0x8a3cc4, { emissive: 0x220a44 }),
  darkPurple: std(0x42205a, { emissive: 0x120620 }),
  steel: std(0x6a6e82, { metalness: 0.35, roughness: 0.6, emissive: 0x0a0b12 }),
  dark: std(0x3a3644, { metalness: 0.6, roughness: 0.5, emissive: 0x0a0810 }),
  bone: std(0xcbb9a6, { metalness: 0.3, roughness: 0.6, emissive: 0x100c08 }),
  cyan: glow(0x4de8ff),
  yellow: glow(0xffd23a),
  redGlow: glow(0xff2a1a),
  orangeGlow: glow(0xff8a1f),
  purpleGlow: glow(0xd04dff, 2.8),
  pink: glow(0xff4d9a, 2.8),
  shield: new THREE.MeshBasicMaterial({ color: 0x3ad8ff, transparent: true, opacity: 0.16, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false }),
};
// Accent materials pulse gently (updated once per frame by the manager).
const pulsing = [[MAT.cyan, 2.6], [MAT.yellow, 2.6], [MAT.redGlow, 2.6], [MAT.orangeGlow, 2.6], [MAT.purpleGlow, 2.8], [MAT.pink, 2.8]];
export function pulseMaterials(t) {
  const k = 1 + Math.sin(t * 5) * 0.22;
  for (const [m, base] of pulsing) m.emissiveIntensity = base * k;
}

export const mesh = (geo, mat, parent) => { const m = new THREE.Mesh(geo, mat); if (parent) parent.add(m); return m; };

// Glow sprite (additive radial gradient). One shared SpriteMaterial per colour; scale drives brightness.
const spriteMats = new Map();
let glowTex = null;
function glowTexture() {
  if (glowTex) return glowTex;
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const g = c.getContext('2d');
  const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.25, 'rgba(255,255,255,0.65)');
  gr.addColorStop(0.6, 'rgba(255,255,255,0.14)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
  glowTex = new THREE.CanvasTexture(c); glowTex.colorSpace = THREE.SRGBColorSpace;
  return glowTex;
}
export function glowSprite(color, size = 1, parent = null, x = 0, y = 0, z = 0) {
  let m = spriteMats.get(color);
  if (!m) { m = new THREE.SpriteMaterial({ map: glowTexture(), color, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false }); spriteMats.set(color, m); }
  const s = new THREE.Sprite(m);
  s.position.set(x, y, z); s.scale.setScalar(size); s.userData.size = size;
  if (parent) parent.add(s);
  return s;
}

/** Shared unit beam/cylinder geometry along +Z (length 1). */
export const beamGeo = memo('beam', () => new THREE.CylinderGeometry(1, 1, 1, 10, 1, true).rotateX(Math.PI / 2).translate(0, 0, 0.5));
/** Tapered flame/trail cone: base at z=0, tip at z=-1 (scale z for length). */
export const flameGeo = memo('flame', () => new THREE.ConeGeometry(0.5, 1, 8, 1, true).rotateX(-Math.PI / 2).translate(0, 0, -0.5));
export const beamMat = (color) => memo(`beam${color}`, () => new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.85, depthWrite: false, blending: THREE.AdditiveBlending, fog: false, side: THREE.DoubleSide }));
