// Level intro flythroughs (about 6 s each). The player keeps control the whole time: the camera flies a designed path relative
// to the rail anchor and eases into the live chase pose over the second half, so there is never a cut or a pop when it ends.
// Driven by the director (src/fx/cinema.js): startIntro(ctx) at level start, then introPose() every frame; the camera rig blends
// the result over the damped chase camera with the weight returned here.
//
// Keys are in rail local space (x right, y up, z BEHIND the anchor, the rail flies toward -Z), times as a share of the intro:
//   { t, p: [x, y, z] camera, l: [x, y, z] look target, fov, roll (radians), f: share of the ship sideways and vertical offset the
//   camera and look target follow (0 for a fixed shot, about 0.6 like the chase camera near the end) }
// settle: share of the intro after which the path hands over to the chase camera (smooth weight 1 to 0 until the end).
// set(ctx, W): optional set dressing placed at the start (a drifting rock for the Cinder sweep); it lives in the world and is pruned
// with it.
import * as THREE from 'three';
import { path, track, ease, finite } from './helpers.js';
import { Rng } from '../world/util.js';

export const INTROS = {
  // a high wide view down the trench toward the forge: walls, gears, smelter beams, then the camera drops into the trench behind
  // the ship and settles
  foundry: {
    dur: 6.5, settle: 0.5,
    keys: [
      { t: 0.0, p: [22, 96, 120], l: [0, -30, -360], fov: 58, roll: -0.06, f: 0.1 },
      { t: 0.28, p: [14, 56, 76], l: [0, -20, -240], fov: 61, roll: -0.04, f: 0.15 },
      { t: 0.55, p: [-3, 18, 34], l: [0, -4, -110], fov: 65, roll: 0.03, f: 0.35 },
      { t: 0.8, p: [0, 6, 16], l: [0, 0.3, -48], fov: 67, roll: 0.01, f: 0.55 },
      { t: 1.0, p: [0, 3.4, 12.5], l: [0, 0.6, -38], fov: 68, roll: 0, f: 0.58 },
    ],
  },
  // a slow sweep from the left, past a drifting rock that slides by in the foreground, revealing the ring vessel and the ringed planet, then round
  // behind the ship
  cinder: {
    dur: 6.5, settle: 0.5,
    keys: [
      { t: 0.0, p: [-15, 6, 42], l: [-40, 14, -76], fov: 60, roll: 0.07, f: 0.1 },
      { t: 0.35, p: [-11, 5.5, 30], l: [-26, 9, -72], fov: 62, roll: 0.05, f: 0.2 },
      { t: 0.65, p: [-4, 4.5, 18], l: [-7, 2.5, -52], fov: 65, roll: 0.02, f: 0.45 },
      { t: 1.0, p: [0, 3.4, 12.5], l: [0, 0.6, -38], fov: 68, roll: 0, f: 0.58 },
    ],
    set(ctx, W) {
      // world fixed, so it drifts toward and past the camera as the rail flies on
      const keep = W.rng;
      W.rng = new Rng(77);
      try {
        const rock = W.spawnDecor?.('rock', new THREE.Vector3(-34, 9, -40), { r: 9, vx: 0.8, vy: -0.4, vz: 3, variant: 'ember', shape: 2 });
        if (rock) { rock.pruneBehind = 120; rock.spin?.set(0.12, 0.2, 0.08); }
      } finally { W.rng = keep; }
    },
  },
  // low over the water toward the twin suns and the coral, then rising behind the ship into the chase pose
  thalassa: {
    dur: 6, settle: 0.5,
    keys: [
      { t: 0.0, p: [4, -22.5, 36], l: [2, 6, -64], fov: 62, roll: 0.03, f: 0.05 },
      { t: 0.3, p: [3, -19, 30], l: [1, 4, -62], fov: 63, roll: 0.02, f: 0.1 },
      { t: 0.62, p: [1, -6, 20], l: [0, 1, -52], fov: 66, roll: -0.02, f: 0.35 },
      { t: 1.0, p: [0, 3.4, 12.5], l: [0, 0.6, -38], fov: 68, roll: 0, f: 0.58 },
    ],
  },
};

// Keyframe tracks built once per intro (shared, read only)
const tracks = new Map();
function tracksFor(def) {
  let tr = tracks.get(def);
  if (!tr) {
    tr = {
      p: def.keys.map((k) => [k.t, ...k.p]),
      l: def.keys.map((k) => [k.t, ...k.l]),
      fov: def.keys.map((k) => [k.t, k.fov]),
      roll: def.keys.map((k) => [k.t, k.roll ?? 0]),
      f: def.keys.map((k) => [k.t, k.f ?? 0]),
    };
    tracks.set(def, tr);
  }
  return tr;
}

export function introDef(theme) { return INTROS[theme] ?? null; }

/**
 * Pose of the intro path at share u (0..1) in world space. Writes out.pos, out.look, out.fov, out.roll and returns the weight of the
 * path against the chase camera (1 until def.settle, then a smooth fall to 0 at u = 1).
 */
export function introPose(def, u, ctx, out) {
  const tr = tracksFor(def);
  u = finite(u, 1);
  path(tr.p, u, out.pos);
  path(tr.l, u, out.look);
  const f = track(tr.f, u);
  const rp = ctx.rail.position, off = ctx.player.localOffset;
  const fx = off.x * f, fy = off.y * f;
  out.pos.x += rp.x + fx; out.pos.y += rp.y + fy; out.pos.z += rp.z;
  out.look.x += rp.x + fx; out.look.y += rp.y + fy; out.look.z += rp.z;
  out.fov = track(tr.fov, u);
  out.roll = track(tr.roll, u);
  const s = def.settle ?? 0.5;
  return 1 - ease.smooth((u - s) / Math.max(0.05, 1 - s));
}
