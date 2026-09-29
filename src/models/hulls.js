// Hull recipes for the Vanta Mk II and the three escorts. Each recipe returns plain data (geometries and positions in
// ship space, nose toward -Z) that vanta.js assembles into one ship: a merged textured hull, baked accent parts, an
// articulated engine shroud per main engine, articulated rear flare fins, a flat blade canopy and the cannon anchors.
//
// Silhouette families:
//   vanta  a manta arrowhead, wingtips canted down 25 degrees, a twin barrel gun pod hung under the nose, one central
//          ring engine flanked by two ion vents, low blade canopy.
//   vex    a twin boom: a slim central pod, two tail booms with an engine each, a tailplane bridging the booms.
//   ferro  a flying wing: blunt broad manta, no boom, a shallow dome and twin flush engines.
//   pip    a small blunt bodied drone with a forward sensor lens (no cockpit), a collar hoop and short swept stubs.
import * as THREE from 'three';
import { loft, planform, place, clipX, bendGeo, bladeLoft } from './modelUtils.js';

const RAD = Math.PI / 180;
const cyl = (r0, r1, len) => new THREE.CylinderGeometry(r0, r1, len, 12).rotateX(Math.PI / 2);

// stations: [z, w, t, b, y, n] -> loft geometry, optionally translated to (x, y)
function body(stations, x = 0, y = 0) {
  const g = loft(stations.map(([z, w, t, b, yy = 0, n = 2.2]) => ({ z, w, t, b, y: yy, n })), 28);
  g.translate(x, y, 0);
  return g;
}

// A wing given as a half planform (x >= 0, [x, z] pairs) mirrored to both sides. Beyond `hinge` the panel is canted down by
// `ang` radians (anhedral). Returns merged-ready geometries.
function wingPair(half, { hinge = 99, ang = 0, thick = 0.2, taper = [1.5, 0.35], span = 3, bevel = 0.02 } = {}) {
  const out = [];
  const opts = { bevel, taper, span, uSpan: 1, zMin: 0, zRange: 1 };
  for (const s of [1, -1]) {
    const mir = (pts) => pts.map(([x, z]) => [s * x, z]);
    const inner = clipX(half, -1e9, hinge);
    if (inner.length > 2) out.push(planform(mir(inner), thick, opts));
    const outer = hinge < 90 ? clipX(half, hinge, 1e9) : [];
    if (outer.length > 2) out.push(bendGeo(planform(mir(outer), thick, opts), hinge, ang, s));
  }
  return out;
}

// Small flare plate hinged along its inner edge (local z axis), extending to +X for s = 1 and -X for s = -1.
function flarePlate(s, w, z0, z1, zOut0, zOut1, thick = 0.035) {
  const pts = [[0, z0], [w, zOut0], [w, zOut1], [0, z1]].map(([x, z]) => [s * x, z]);
  return planform(pts, thick, { bevel: 0.008, taper: [1, 1], span: 1, uSpan: 1, zMin: 0, zRange: 1 });
}

// polyline offset toward the body centre and rear (for a nose to tip leading edge on the +X side)
function offsetLine(pts, d) {
  return pts.map((p, i) => {
    const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)];
    const dx = b[0] - a[0], dz = b[1] - a[1], l = Math.hypot(dx, dz) || 1;
    return [p[0] - (dz / l) * d, p[1] + (dx / l) * d];
  });
}
const band = (pts, d0, d1) => [...offsetLine(pts, d0), ...offsetLine(pts, d1).reverse()];

const emptyParts = () => ({ solid: [], dark: [], metal: [], amber: [], teal: [] });

// ---------------------------------------------------------------------------------------------------- VANTA
export function vantaHull() {
  const parts = emptyParts();
  const half = [[0, -2.72], [0.42, -2.38], [1.0, -1.62], [1.8, -0.62], [2.4, 0.28], [2.8, 0.98], [2.66, 1.2], [1.9, 1.26], [1.2, 1.56], [0.6, 1.9], [0, 2.0]];
  const hull = wingPair(half, { hinge: 1.05, ang: 25 * RAD, thick: 0.2, taper: [1.5, 0.3], span: 2.8 });
  hull.push(body([
    [-2.75, 0.01, 0.01, 0.01, 0.03], [-2.4, 0.12, 0.07, 0.05, 0.03], [-1.8, 0.27, 0.15, 0.09, 0.03], [-1.0, 0.4, 0.23, 0.13, 0.03],
    [-0.2, 0.46, 0.27, 0.15, 0.03], [0.6, 0.47, 0.27, 0.17, 0.03], [1.4, 0.44, 0.27, 0.22, 0.03], [1.95, 0.42, 0.3, 0.3, 0.03],
    [2.15, 0.4, 0.34, 0.34, 0.03],
  ]));
  // shoulder intakes
  for (const s of [-1, 1]) parts.dark.push(place(new THREE.BoxGeometry(0.3, 0.06, 0.85), { x: s * 0.6, y: 0.17, z: -0.95, ry: -s * 0.12 }));
  // gun pod under the nose: pylon, twin barrel housing, barrels, muzzle rings
  parts.dark.push(place(new THREE.BoxGeometry(0.16, 0.26, 1.0), { y: -0.16, z: -1.9 }));
  parts.solid.push(place(cyl(0.2, 0.22, 1.35), { y: -0.36, z: -2.15 }));
  parts.solid.push(place(new THREE.SphereGeometry(0.2, 14, 10, 0, Math.PI * 2, 0, Math.PI / 2).rotateX(-Math.PI / 2), { y: -0.36, z: -2.83 }));
  parts.solid.push(place(new THREE.ConeGeometry(0.22, 0.6, 12).rotateX(-Math.PI / 2), { y: -0.36, z: -1.2 }));
  parts.amber.push(place(new THREE.TorusGeometry(0.215, 0.016, 6, 16), { y: -0.36, z: -1.62 }));
  for (const s of [-1, 1]) {
    parts.metal.push(place(cyl(0.032, 0.04, 0.95), { x: s * 0.095, y: -0.36, z: -3.3 }));
    parts.teal.push(place(new THREE.TorusGeometry(0.038, 0.011, 6, 10), { x: s * 0.095, y: -0.36, z: -3.78 }));
    // ion vents: nacelle, rim, throat cap
    parts.dark.push(place(cyl(0.13, 0.15, 0.95), { x: s * 0.82, y: 0.03, z: 1.72 }));
    parts.teal.push(place(new THREE.TorusGeometry(0.135, 0.017, 6, 16), { x: s * 0.82, y: 0.03, z: 2.2 }));
    parts.dark.push(place(new THREE.CircleGeometry(0.12, 12), { x: s * 0.82, y: 0.03, z: 2.12 }));
  }
  // keel and nose sensor
  parts.dark.push(place(new THREE.BoxGeometry(0.18, 0.08, 1.6), { y: -0.16, z: 0.6 }));
  parts.metal.push(place(cyl(0.012, 0.022, 0.7), { y: 0.03, z: -3.0 }));
  return {
    bounds: { x0: -3.0, x1: 3.0, z0: -3.0, z1: 2.4 },
    hull, parts,
    canopy: { geo: bladeLoft(-1.5, -0.1, 0.2, 0.13), x: 0, y: 0.2, z: 0 },
    engines: [
      { kind: 'main', x: 0, y: 0.03, z: 2.0, r: 0.42, len: 0.6 },
      { kind: 'ion', x: -0.82, y: 0.03, z: 2.22, r: 0.1, len: 0 },
      { kind: 'ion', x: 0.82, y: 0.03, z: 2.22, r: 0.1, len: 0 },
    ],
    fins: [-1, 1].map((s) => ({ s, x: s * 0.5, y: 0.31, z: 1.1, geo: flarePlate(s, 0.62, -0.05, 0.85, 0.3, 0.85), idle: 0.2, boost: 0.02, brake: 1.0 })),
    muzzles: [[-0.095, -0.36, -3.8], [0.095, -0.36, -3.8]],
    tips: [[-2.8, -0.95, 1.05], [2.8, -0.95, 1.05]],
    nose: [0, -0.36, -3.9], cockpit: [0, 0.4, -0.8], light: 3.6,
    scorch: [[0.95, 0.06, 0.5, 0.55], [-1.5, -0.1, 0.5, 0.5], [0.05, 0.33, 0.9, 0.4], [-0.4, 0.3, -0.9, 0.3], [1.9, -0.3, 0.3, 0.4]],
    sparks: [[1.9, -0.35, 0.6], [-1.9, -0.35, 0.6], [0.2, 0.4, 0.9]],
    paint: {
      edge: [[[0.4, -2.2], [0.95, -1.45], [1.7, -0.5], [2.3, 0.35], [2.66, 0.92]]],
      stripes: [
        band([[1.15, -1.3], [1.85, -0.42], [2.3, 0.26]], 0.42, 0.5), band([[1.15, -1.3], [1.85, -0.42], [2.3, 0.26]], 0.58, 0.65),
        [[-0.05, -1.9], [0.05, -1.9], [0.09, 0.5], [0.05, 1.5], [-0.05, 1.5], [-0.09, 0.5]],
        ...[0, 1, 2].map((i) => [[1.45 + i * 0.15, 0.78 - i * 0.05], [1.53 + i * 0.15, 0.78 - i * 0.05], [1.53 + i * 0.15, 1.0 - i * 0.05], [1.45 + i * 0.15, 1.0 - i * 0.05]]),
      ],
      plates: [{ pts: offsetLine([[0.42, -2.38], [1.0, -1.62], [1.8, -0.62], [2.4, 0.28], [2.8, 0.98]], 0.08), w: 26 }],
      lines: [[[1.05, -1.5], [1.05, 1.5]], [[0.3, -1.2], [2.6, -0.15]], [[0.3, -0.4], [2.7, 0.55]], [[0.3, 0.3], [2.5, 1.0]], [[0.3, 0.95], [1.4, 1.35]], [[0.55, -2.0], [0.55, 1.8]]],
    },
  };
}

// ---------------------------------------------------------------------------------------------------- VEX (twin boom)
export function vexHull() {
  const parts = emptyParts();
  const bx = 1.35;
  const hull = wingPair([[0, -0.7], [bx, -0.4], [2.5, 0.3], [2.55, 0.8], [bx, 0.9], [0, 0.95]], { hinge: bx, ang: 18 * RAD, thick: 0.12, taper: [1.3, 0.4], span: 2.55 });
  hull.push(...wingPair([[0, 1.72], [bx + 0.1, 1.84], [bx + 0.1, 2.24], [0, 2.14]], { thick: 0.07, taper: [1, 1], span: 1.5 }));
  hull.push(body([[-2.75, 0.01, 0.01, 0.01, 0.03], [-2.45, 0.1, 0.07, 0.05, 0.03], [-1.6, 0.25, 0.16, 0.1, 0.03], [-0.6, 0.33, 0.24, 0.16, 0.03], [0.4, 0.33, 0.22, 0.16, 0.03], [1.0, 0.22, 0.16, 0.12, 0.03], [1.3, 0.07, 0.05, 0.04, 0.03]]));
  for (const s of [-1, 1]) {
    hull.push(body([[-1.95, 0.01, 0.01, 0.01], [-1.75, 0.09, 0.09, 0.08], [-1.35, 0.17, 0.17, 0.15], [-0.5, 0.21, 0.2, 0.17], [0.7, 0.21, 0.2, 0.17], [1.6, 0.2, 0.19, 0.17], [2.1, 0.19, 0.19, 0.19]], s * bx, 0));
    // boom guns
    parts.solid.push(place(cyl(0.11, 0.12, 0.7), { x: s * bx, y: -0.04, z: -1.3 }));
    parts.metal.push(place(cyl(0.034, 0.042, 0.6), { x: s * bx, y: -0.04, z: -1.95 }));
    parts.teal.push(place(new THREE.TorusGeometry(0.03, 0.009, 6, 10), { x: s * bx, y: -0.04, z: -2.26 }));
    parts.amber.push(place(new THREE.TorusGeometry(0.12, 0.014, 6, 16), { x: s * bx, y: -0.04, z: -0.98 }));
    parts.dark.push(place(new THREE.BoxGeometry(0.26, 0.04, 0.6), { x: s * 0.6, y: 0.09, z: -0.75, ry: -s * 0.1 }));
    parts.amber.push(place(new THREE.TorusGeometry(0.2, 0.013, 6, 20), { x: s * bx, y: 0, z: 1.2 }));
  }
  parts.metal.push(place(cyl(0.012, 0.022, 0.7), { y: 0.03, z: -3.0 }));
  return {
    bounds: { x0: -2.9, x1: 2.9, z0: -3.0, z1: 2.6 },
    hull, parts,
    canopy: { geo: bladeLoft(-1.6, -0.2, 0.19, 0.12), x: 0, y: 0.22, z: 0 },
    engines: [-1, 1].map((s) => ({ kind: 'main', x: s * bx, y: 0, z: 2.02, r: 0.2, len: 0.42 })),
    fins: [-1, 1].map((s) => ({ s, x: s * 0.5, y: 0.05, z: 1.7, geo: flarePlate(s, 0.7, 0, 0.5, 0.1, 0.5, 0.03), idle: 0.14, boost: 0.02, brake: 1.0 })),
    muzzles: [[-bx, -0.04, -2.3], [bx, -0.04, -2.3]],
    tips: [[-2.55, -0.55, 0.55], [2.55, -0.55, 0.55]],
    nose: [0, 0.03, -2.9], cockpit: [0, 0.35, -0.9], light: 3.2,
    scorch: [[0.95, 0.1, 0.5, 0.45], [-1.5, 0.15, 0.3, 0.45], [0.05, 0.3, -0.6, 0.35], [1.35, 0.22, 1.2, 0.4], [-1.35, 0.2, 0.2, 0.4]],
    sparks: [[1.35, 0.2, 0.8], [-1.35, 0.2, 0.8], [0.2, 0.3, -0.6]],
    paint: {
      edge: [[[0.2, -0.62], [1.35, -0.32], [2.4, 0.3]], [[0.1, 1.95], [1.4, 2.05]]],
      stripes: [band([[0.3, -0.62], [1.3, -0.35]], 0.25, 0.32), [[-0.04, -1.9], [0.04, -1.9], [0.08, 0.6], [-0.08, 0.6]]],
      plates: [{ pts: [[0.05, -0.55], [1.3, -0.25], [2.3, 0.4]], w: 24 }],
      lines: [[[bx, -0.5], [bx, 1.0]], [[0.1, 0.2], [2.5, 0.55]], [[0.3, -1.6], [0.3, 1.0]]],
    },
  };
}

// ---------------------------------------------------------------------------------------------------- FERRO (flying wing)
export function ferroHull() {
  const parts = emptyParts();
  const half = [[0, -2.3], [0.8, -2.2], [1.8, -1.5], [2.7, -0.4], [3.05, 0.5], [2.85, 1.2], [1.7, 1.55], [0.6, 1.7], [0, 1.7]];
  const hull = wingPair(half, { hinge: 1.6, ang: 16 * RAD, thick: 0.26, taper: [1.35, 0.28], span: 3.05, bevel: 0.03 });
  hull.push(body([[-2.0, 0.02, 0.02, 0.02, 0.05], [-1.6, 0.32, 0.14, 0.08, 0.05], [-0.8, 0.62, 0.26, 0.12, 0.05], [0.2, 0.7, 0.28, 0.12, 0.05], [1.0, 0.66, 0.24, 0.12, 0.05], [1.62, 0.55, 0.2, 0.12, 0.05]]));
  for (const s of [-1, 1]) {
    parts.dark.push(place(new THREE.BoxGeometry(0.42, 0.05, 0.7), { x: s * 0.66, y: 0.19, z: -1.15, ry: -s * 0.1 }));
    // wing root cannon pods on the leading edge
    parts.solid.push(place(cyl(0.14, 0.16, 1.0), { x: s * 1.3, y: -0.08, z: -1.5 }));
    parts.metal.push(place(cyl(0.045, 0.055, 0.6), { x: s * 1.3, y: -0.08, z: -2.0 }));
    parts.teal.push(place(new THREE.TorusGeometry(0.04, 0.011, 6, 10), { x: s * 1.3, y: -0.08, z: -2.3 }));
    parts.amber.push(place(new THREE.TorusGeometry(0.16, 0.016, 6, 16), { x: s * 1.3, y: -0.08, z: -1.02 }));
  }
  return {
    bounds: { x0: -3.2, x1: 3.2, z0: -2.6, z1: 2.4 },
    hull, parts,
    canopy: { geo: bladeLoft(-1.25, -0.25, 0.2, 0.11), x: 0, y: 0.28, z: 0 },
    engines: [-1, 1].map((s) => ({ kind: 'main', x: s * 0.66, y: 0.03, z: 1.58, r: 0.3, len: 0.48 })),
    fins: [-1, 1].map((s) => ({ s, x: s * 1.75, y: 0.1, z: 0.95, geo: flarePlate(s, 0.75, 0, 0.6, 0.15, 0.6, 0.04), idle: 0.14, boost: 0.02, brake: 1.15 })),
    muzzles: [[-1.3, -0.08, -2.35], [1.3, -0.08, -2.35]],
    tips: [[-3.05, -0.4, 0.5], [3.05, -0.4, 0.5]],
    nose: [0, 0.05, -2.4], cockpit: [0, 0.4, -0.75], light: 3.1,
    scorch: [[1.6, 0.1, 0.4, 0.6], [-1.9, -0.1, 0.6, 0.5], [0.05, 0.33, 0.8, 0.4], [-0.5, 0.25, -1.2, 0.35], [2.3, -0.2, 0.2, 0.4]],
    sparks: [[2.0, -0.05, 0.7], [-2.0, -0.05, 0.7], [0.2, 0.35, 0.8]],
    paint: {
      edge: [[[0.75, -2.05], [1.7, -1.35], [2.55, -0.35], [2.9, 0.5]]],
      stripes: [band([[1.7, -1.35], [2.55, -0.35], [2.9, 0.5]], 0.45, 0.6), band([[1.7, -1.35], [2.55, -0.35], [2.9, 0.5]], 0.7, 0.78), [[-0.06, -1.7], [0.06, -1.7], [0.1, 1.2], [-0.1, 1.2]]],
      plates: [{ pts: offsetLine([[0.8, -2.2], [1.8, -1.5], [2.7, -0.4], [3.05, 0.5]], 0.09), w: 28 }],
      lines: [[[1.6, -1.6], [1.6, 1.5]], [[0.4, -0.8], [2.9, 0.1]], [[0.4, 0.5], [2.9, 0.95]], [[0.9, -1.9], [0.9, 1.6]]],
    },
  };
}

// ---------------------------------------------------------------------------------------------------- PIP (drone)
export function pipHull() {
  const parts = emptyParts();
  const hull = wingPair([[0.35, -0.5], [1.15, -0.1], [1.75, 0.5], [1.6, 0.78], [0.5, 0.75]], { hinge: 0.75, ang: 30 * RAD, thick: 0.09, taper: [1.2, 0.4], span: 1.75, bevel: 0.015 });
  hull.push(body([[-1.75, 0.01, 0.01, 0.01], [-1.62, 0.2, 0.19, 0.19, 0, 2.4], [-1.25, 0.42, 0.42, 0.4, 0, 2.2], [-0.4, 0.52, 0.5, 0.47], [0.5, 0.5, 0.48, 0.45], [1.05, 0.4, 0.38, 0.36], [1.35, 0.26, 0.25, 0.24]]));
  parts.amber.push(place(new THREE.TorusGeometry(0.64, 0.05, 8, 32), { z: -0.35 }));
  parts.teal.push(place(new THREE.TorusGeometry(0.29, 0.02, 8, 20), { z: -1.62 }));
  for (const s of [-1, 1]) {
    parts.dark.push(place(new THREE.BoxGeometry(0.2, 0.16, 0.5), { x: s * 0.34, y: 0.4, z: 0.3, ry: s * 0.25 }));
    parts.solid.push(place(cyl(0.09, 0.1, 0.6), { x: s * 0.52, y: -0.14, z: -1.2 }));
    parts.metal.push(place(cyl(0.024, 0.03, 0.55), { x: s * 0.52, y: -0.14, z: -1.75 }));
    parts.teal.push(place(new THREE.TorusGeometry(0.028, 0.008, 6, 10), { x: s * 0.52, y: -0.14, z: -2.05 }));
  }
  return {
    bounds: { x0: -1.9, x1: 1.9, z0: -2.1, z1: 1.9 },
    hull, parts,
    // no cockpit: a forward sensor lens takes its place
    canopy: { geo: new THREE.SphereGeometry(0.24, 16, 10, 0, Math.PI * 2, 0, Math.PI / 2).rotateX(-Math.PI / 2), x: 0, y: 0, z: -1.6, lens: true },
    engines: [{ kind: 'main', x: 0, y: 0, z: 1.28, r: 0.24, len: 0.4 }],
    fins: [-1, 1].map((s) => ({ s, x: s * 0.28, y: 0.44, z: 0.75, geo: flarePlate(s, 0.42, -0.1, 0.4, 0.1, 0.4, 0.03), idle: 0.16, boost: 0.02, brake: 1.15 })),
    muzzles: [[-0.52, -0.14, -2.08], [0.52, -0.14, -2.08]],
    tips: [[-1.7, -0.3, 0.6], [1.7, -0.3, 0.6]],
    nose: [0, 0, -1.9], cockpit: [0, 0.3, -1.2], light: 2.8, engineSpread: 0.12,
    scorch: [[0.3, 0.45, 0.2, 0.4], [-0.35, 0.44, -0.6, 0.35], [1.0, -0.1, 0.4, 0.35], [-1.0, -0.1, 0.4, 0.35], [0, 0.45, 0.8, 0.3]],
    sparks: [[0.9, 0.0, 0.5], [-0.9, 0.0, 0.5], [0.0, 0.5, 0.2]],
    paint: {
      edge: [[[0.5, -0.4], [1.1, -0.05], [1.6, 0.5]]],
      stripes: [[[-0.06, -1.5], [0.06, -1.5], [0.08, 1.0], [-0.08, 1.0]], band([[0.5, -0.4], [1.1, -0.05], [1.6, 0.5]], 0.25, 0.32)],
      plates: [],
      lines: [[[0.75, -0.3], [0.75, 0.8]], [[0.3, -1.0], [0.3, 1.1]], [[0, -0.9], [1.0, -0.9]], [[0, 0.4], [1.0, 0.4]]],
    },
  };
}

export const HULLS = { vanta: vantaHull, vex: vexHull, ferro: ferroHull, pip: pipHull };
