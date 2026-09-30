// Signature moments: one real time camera event per level, triggered by rail distance. The player keeps control and the chase
// camera stays in charge: a moment only offsets the chase TARGET (rail local camera and look offsets, an FOV push and a little roll),
// so the chase springs smooth it, the chase safety limits still apply (never inside or in front of the ship) and the ship, the
// reticle and the enemies stay in frame. Driven by the director (src/fx/cinema.js), applied by src/core/cameraRig.js.
//
// Keys: [t, cx, cy, cz, lx, ly, lz, fov, roll], t as a share of the moment; c* moves the camera (x right, y up, z BACK from the
// ship), l* moves the look target, fov in degrees (scaled by cinema.momentFov and cinema.fovKick), roll in radians. The first and
// the last key must be all zero so the moment starts and ends exactly on the chase pose.
import { track } from './helpers.js';

export const MOMENTS = {
  // The forge gate: the camera lifts and hangs back so the sealed wall and its opening loom over the ship (a tighter lens), then
  // swoops down behind it as it threads the opening, with a speed push that relaxes inside the forge.
  foundry: {
    name: 'forgeGate', at: 3770, dur: 4.6, landmark: { type: 'wall', at: 3905 },
    keys: [
      [0.0, 0, 0, 0, 0, 0, 0, 0, 0],
      [0.3, -2.5, 5.5, 9, 0, 6, 0, -5, 0.03],
      [0.55, -1.5, 3.5, 6, 0, 3.5, 0, 2, 0.015],
      [0.72, 0, -0.6, -1.5, 0, -0.5, 0, 12, -0.02],
      [0.86, 0, -0.3, -0.5, 0, 0, 0, 5, 0],
      [1.0, 0, 0, 0, 0, 0, 0, 0, 0],
    ],
  },
  // Out of the second wreckage tunnel into open space: pull wide and swing left while the aim point drifts right and up, so the
  // ring vessel ahead comes into frame beside the ship.
  cinder: {
    name: 'ringReveal', at: 5485, dur: 5.2, landmark: { type: 'tunnel', at: 5440 },
    keys: [
      [0.0, 0, 0, 0, 0, 0, 0, 0, 0],
      [0.25, -2.5, 3.5, 3.5, 5, 3.5, 0, 8, -0.03],
      [0.6, -4.5, 5.5, 5.5, 9, 6, 0, 12, -0.05],
      [1.0, 0, 0, 0, 0, 0, 0, 0, 0],
    ],
  },
  // Out of the coral canyon into the luminous reef: the camera sinks toward the ship and hangs back, the aim lifts to the great coral
  // span overhead as the ship flies under it, then everything eases back.
  thalassa: {
    name: 'reefSpan', at: 3860, dur: 5, landmark: { type: 'reefSpan', at: 4000 },
    keys: [
      [0.0, 0, 0, 0, 0, 0, 0, 0, 0],
      [0.3, 0, -1.8, 4, 0, 5, 0, 6, 0],
      [0.62, 0, -2.7, 6, 0, 8.5, 0, 12, 0.04],
      [0.8, 0, -1.2, 3, 0, 3.5, 0, 6, 0.015],
      [1.0, 0, 0, 0, 0, 0, 0, 0, 0],
    ],
  },
};

// per moment tracks, built once
const cache = new Map();
function tracksFor(def) {
  let tr = cache.get(def);
  if (!tr) {
    tr = [];
    for (let c = 1; c <= 8; c++) tr.push(def.keys.map((k) => [k[0], k[c]]));
    cache.set(def, tr);
  }
  return tr;
}

export function momentDef(theme) { return MOMENTS[theme] ?? null; }

/** True when the landmark of the moment is in the world (or the moment has none). */
export function landmarkPresent(def, ctx) {
  const lm = def.landmark;
  if (!lm) return true;
  const near = (list) => {
    for (let i = 0; i < (list?.length ?? 0); i++) {
      const o = list[i];
      if (o && o.alive !== false && o.type === lm.type && Math.abs(o.position.z + lm.at) < 60) return true;
    }
    return false;
  };
  return near(ctx.groups?.obstacles) || near(ctx.world?.decor);
}

/** Writes the offsets of the moment at share u, scaled by strength k and fov scale kf, into out {cx, cy, cz, lx, ly, lz, fov, roll}. */
export function momentOffset(def, u, k, kf, out) {
  const tr = tracksFor(def);
  out.cx = track(tr[0], u) * k; out.cy = track(tr[1], u) * k; out.cz = track(tr[2], u) * k;
  out.lx = track(tr[3], u) * k; out.ly = track(tr[4], u) * k; out.lz = track(tr[5], u) * k;
  out.fov = track(tr[6], u) * k * kf; out.roll = track(tr[7], u) * k;
  return out;
}
