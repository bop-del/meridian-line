// Camera helpers for takeover shots, level intros and signature moments. Everything here is allocation free per call (results are
// written into an `out` vector you pass in) and NaN safe (non finite input falls back to a sane value).
//
// Typical takeover pose (see the pose contract at the top of src/fx/cinema.js):
//   import { ease, orbit, lookEase, fovKick, shipPoint, anchor } from '../../cinema/helpers.js';
//   const _c = new THREE.Vector3(), _a = new THREE.Vector3();
//   ctx.cinema.register('bossIntro', { duration: 3.6, letterbox: 1, hideHud: true, lockInput: true, invulnerable: true,
//     pose(u, t, ctx, out) {
//       anchor(boss.group, 0, 4, 0, _c);                                  // world point on the boss
//       orbit(_c, 60, -0.6, 0.5, 12, ease.inOutCubic(u), out.pos);        // swing around it
//       shipPoint(ctx, 0, 0, -10, _a);
//       lookEase(_a, _c, u, ease.smooth, out.look);                       // start on the ship, end on the boss
//       out.fov = fovKick(50, 8, u, 0.8, 0.1, 0.2);                       // short widen at 80 percent of the shot
//       out.roll = 0;
//     } });
//
// Exports
//   ease.{ linear, smooth, smoother, inCubic, outCubic, inOutCubic, outExpo, inOutSine }   f(x) for x in 0..1 (clamped)
//   clamp01(x), mix(a, b, k), finite(v, fallback)
//   env(u, inFrac, outFrac)          0..1 envelope that rises over the first inFrac and falls over the last outFrac of u (smooth)
//   track(keys, t)                   scalar keyframes [[t, v], ...] (t ascending), C1 smooth (Hermite, Catmull-Rom tangents)
//   path(keys, t, out)               vec3 keyframes [[t, x, y, z], ...] or [[t, Vector3], ...], C1 smooth, writes out
//   dolly(a, b, u, easeFn, out)      straight move from a to b with easing
//   curve(points, closed?)           returns { at(u, out) } along a centripetal Catmull-Rom through Vector3 points (dolly on a curve)
//   orbit(center, r, a0, a1, h, u, out, easeFn?)   point on a horizontal circle around center (angle in radians, 0 = +Z, the side
//                                    behind the ship), from a0 to a1, at height h above center
//   lookEase(a, b, u, easeFn, out)   look target that eases from point a to point b
//   fovKick(base, amount, u, at, attack, release)  base FOV plus a kick that rises over `attack` (fraction of u) to peak at `at`
//                                    and falls over `release`; the amount is scaled by the feel value cinema.fovKick
//   handheld(t, amp, out, seed?)     adds a slow, smooth camera drift (sum of sines) of about amp units to out
//   railPoint(ctx, x, y, z, out)     rail local offset to world (x right, y up, z BEHIND the anchor, the rail flies toward -Z)
//   shipPoint(ctx, x, y, z, out)     offset from the player ship position (same axes)
//   anchor(obj3d, x, y, z, out)      world position of an Object3D (updated matrix) plus an offset
//   chasePose(ctx)                   { pos, look, fov } of the live chase camera (read only), handy to start or end a shot on it
import * as THREE from 'three';
import { feel } from '../core/feel.js';

export const clamp01 = (x) => (x > 0 ? (x < 1 ? x : 1) : 0);
export const mix = (a, b, k) => a + (b - a) * k;
export const finite = (v, fb = 0) => (Number.isFinite(v) ? v : fb);

export const ease = {
  linear: (x) => clamp01(x),
  smooth: (x) => { x = clamp01(x); return x * x * (3 - 2 * x); },
  smoother: (x) => { x = clamp01(x); return x * x * x * (x * (x * 6 - 15) + 10); },
  inCubic: (x) => { x = clamp01(x); return x * x * x; },
  outCubic: (x) => { x = 1 - clamp01(x); return 1 - x * x * x; },
  inOutCubic: (x) => { x = clamp01(x); return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2; },
  outExpo: (x) => { x = clamp01(x); return x >= 1 ? 1 : 1 - Math.pow(2, -10 * x); },
  inOutSine: (x) => -(Math.cos(Math.PI * clamp01(x)) - 1) / 2,
};

/** Envelope for u in 0..1: smooth rise over the first inFrac, smooth fall over the last outFrac. */
export function env(u, inFrac, outFrac) {
  const a = inFrac > 1e-4 ? ease.smooth(u / inFrac) : 1;
  const b = outFrac > 1e-4 ? ease.smooth((1 - u) / outFrac) : 1;
  return Math.min(a, b);
}

// ---------------------------------------------------------------- keyframes (cubic Hermite with Catmull-Rom tangents in time)
function seg(keys, t) {
  const n = keys.length;
  if (t <= keys[0][0]) return 0;
  for (let i = 0; i < n - 1; i++) if (t < keys[i + 1][0]) return i;
  return n - 2;
}

// tangent (value per unit t) at key i for component c, reading v(i) through get
function tangent(keys, i, get, c) {
  const n = keys.length;
  if (i <= 0 || i >= n - 1) return 0;   // ends: zero slope, so a shot starts and settles without a jolt
  const dt = keys[i + 1][0] - keys[i - 1][0];
  return dt > 1e-6 ? (get(keys[i + 1], c) - get(keys[i - 1], c)) / dt : 0;
}

function hermite(keys, t, get, c) {
  const n = keys.length;
  if (n === 1) return get(keys[0], c);
  if (t <= keys[0][0]) return get(keys[0], c);
  if (t >= keys[n - 1][0]) return get(keys[n - 1], c);
  const i = seg(keys, t);
  const t0 = keys[i][0], t1 = keys[i + 1][0], h = Math.max(1e-6, t1 - t0);
  const s = (t - t0) / h, s2 = s * s, s3 = s2 * s;
  const p0 = get(keys[i], c), p1 = get(keys[i + 1], c);
  const m0 = tangent(keys, i, get, c) * h, m1 = tangent(keys, i + 1, get, c) * h;
  return (2 * s3 - 3 * s2 + 1) * p0 + (s3 - 2 * s2 + s) * m0 + (-2 * s3 + 3 * s2) * p1 + (s3 - s2) * m1;
}

const getScalar = (k) => k[1];
const getVec = (k, c) => (typeof k[1] === 'object' ? k[1].getComponent(c) : k[1 + c]);

/** Scalar keyframes [[t, v], ...]. */
export function track(keys, t) { return finite(hermite(keys, finite(t), getScalar, 0), keys[0]?.[1] ?? 0); }

/** Vec3 keyframes [[t, x, y, z], ...] or [[t, Vector3], ...]. */
export function path(keys, t, out) {
  t = finite(t);
  return out.set(finite(hermite(keys, t, getVec, 0)), finite(hermite(keys, t, getVec, 1)), finite(hermite(keys, t, getVec, 2)));
}

export function dolly(a, b, u, easeFn = ease.smooth, out) { return out.lerpVectors(a, b, easeFn(u)); }

/** Dolly along a smooth curve through the given Vector3 points. Returns { at(u, out), curve }. */
export function curve(points, closed = false) {
  const c = new THREE.CatmullRomCurve3(points, closed, 'centripetal');
  return { curve: c, at(u, out) { return c.getPoint(clamp01(finite(u)), out); } };
}

export function orbit(center, r, a0, a1, h, u, out, easeFn = ease.linear) {
  const a = mix(a0, a1, easeFn(u));
  return out.set(center.x + Math.sin(a) * r, center.y + h, center.z + Math.cos(a) * r);
}

export function lookEase(a, b, u, easeFn = ease.smooth, out) { return out.lerpVectors(a, b, easeFn(u)); }

export function fovKick(base, amount, u, at = 0.5, attack = 0.1, release = 0.25) {
  const k = feel.p.cinema?.fovKick ?? 1;
  let e = 0;
  if (u < at) e = attack > 1e-4 ? ease.smooth(1 - (at - u) / attack) : 0;
  else e = release > 1e-4 ? ease.smooth(1 - (u - at) / release) : 0;
  return base + amount * k * e;
}

export function handheld(t, amp, out, seed = 0) {
  const s = seed * 1.7;
  out.x += amp * (Math.sin(t * 0.83 + s) * 0.6 + Math.sin(t * 1.91 + s * 2.3) * 0.4);
  out.y += amp * (Math.sin(t * 0.67 + 1.3 + s) * 0.6 + Math.sin(t * 1.53 + s * 1.1) * 0.4) * 0.7;
  out.z += amp * Math.sin(t * 0.51 + 2.1 + s) * 0.5;
  return out;
}

export function railPoint(ctx, x, y, z, out) { return out.copy(ctx.rail.position).add(_v.set(x, y, z)); }
export function shipPoint(ctx, x, y, z, out) { return out.copy(ctx.player.position).add(_v.set(x, y, z)); }
export function anchor(obj, x, y, z, out) {
  if (!obj) return out.set(x, y, z);
  obj.getWorldPosition(out);
  return out.add(_v.set(x, y, z));
}
export function chasePose(ctx) { return ctx.cameraRig.chaseOut; }

const _v = new THREE.Vector3();
