// Lead-aiming helpers (allocation free). Aim error is tuned per difficulty so Normal is fair.
import * as THREE from 'three';

const _dir = new THREE.Vector3(), _r = new THREE.Vector3(), _u = new THREE.Vector3(), _tgt = new THREE.Vector3();
const AIM_SCALE = { easy: 1.6, normal: 1, hard: 0.7 };
const UP = new THREE.Vector3(0, 1, 0);

export const diff = (ctx) => ctx.config.difficulty[ctx.state.difficulty] ?? ctx.config.difficulty.normal;

/** Player velocity in world space. Falls back to the rail velocity if the player reports none. */
export function playerVel(ctx, out) {
  const v = ctx.player.velocity;
  out.set(v.x, v.y, Math.abs(v.z) < 0.5 ? -ctx.rail.speed : v.z);
  return out;
}

const _pv = new THREE.Vector3();
/**
 * Direction from origin that intercepts the player for a projectile of `speed`.
 * err: max angular error in radians (scaled by difficulty). leadK: fraction of lateral lead (0..1).
 * Returns a shared scratch vector: copy it if you need to keep it.
 */
export function leadDir(ctx, origin, speed, err = 0.05, leadK = 0.8, out = _dir) {
  const p = ctx.player.position;
  playerVel(ctx, _pv);
  _pv.x *= leadK; _pv.y *= leadK;
  const dx = p.x - origin.x, dy = p.y - origin.y, dz = p.z - origin.z;
  const a = _pv.x * _pv.x + _pv.y * _pv.y + _pv.z * _pv.z - speed * speed;
  const b = 2 * (dx * _pv.x + dy * _pv.y + dz * _pv.z);
  const c = dx * dx + dy * dy + dz * dz;
  let t = Math.sqrt(c) / speed;
  if (Math.abs(a) > 1e-4) {
    const disc = b * b - 4 * a * c;
    if (disc >= 0) {
      const sq = Math.sqrt(disc);
      const t1 = (-b - sq) / (2 * a), t2 = (-b + sq) / (2 * a);
      const tt = t1 > 0 && t2 > 0 ? Math.min(t1, t2) : Math.max(t1, t2);
      if (tt > 0) t = tt;
    }
  }
  t = Math.min(t, 3.5);
  _tgt.set(p.x + _pv.x * t, p.y + _pv.y * t, p.z + _pv.z * t);
  out.subVectors(_tgt, origin).normalize();
  const e = err * (AIM_SCALE[ctx.state.difficulty] ?? 1);
  if (e > 0) jitter(out, e);
  return out;
}

/** Rotate a unit vector by a random angle inside a cone of half angle `e`. */
export function jitter(dir, e) {
  _r.crossVectors(dir, UP);
  if (_r.lengthSq() < 1e-4) _r.set(1, 0, 0);
  _r.normalize();
  _u.crossVectors(_r, dir);
  const a = (Math.random() * 2 - 1) * e, b = (Math.random() * 2 - 1) * e;
  dir.addScaledVector(_r, a).addScaledVector(_u, b).normalize();
  return dir;
}

/** Direction straight at the player (no lead). */
export function toPlayer(ctx, origin, out = _dir) {
  return out.subVectors(ctx.player.position, origin).normalize();
}
