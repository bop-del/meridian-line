// Boss takeover shots: an ENTRANCE and a DEFEAT FINISHER for each boss, registered with ctx.cinema (src/fx/cinema.js).
// Boss.onSpawn plays `boss.<key>.entrance`, Boss.dyingUpdate plays `boss.<key>.finisher` (both in boss.js). Shots are pure data:
//
//   keys: [{ u, p:[x,y,z], pf:'p'|'r'|'f', l:[x,y,z], lf:'f'|'p'|'r', fov, roll }, ...]   u runs 0..1 over the shot
//   frames (pf for the camera, lf for the look target):
//     'p'  the player ship position          (offsets in world units, +z is behind the ship, -z ahead)
//     'r'  the rail anchor (the moving lane) (same axes)
//     'f'  the boss focus (boss.focus())     (world axes, +z toward the player, so +z is the front of every boss)
//   beats: [{ u, shake, kind, sfx, vol, call }]   one shot events, fired once when the shot passes u
//
// The camera path is a cubic Hermite spline through the resolved world keys (tangents from the neighbours, zero at both ends so the
// shot eases out of and back into the chase camera), evaluated every frame, so keys in the moving frames follow the ship and the boss.
// Timing note: the shot length is in game seconds, a slow motion beat stretches it in real time (see boss.js: hitStop in the finisher).
// Look here to retune a shot: only the numbers in SHOTS change, nothing else.
import * as THREE from 'three';

const _f = new THREE.Vector3(), _a = new THREE.Vector3(), _b = new THREE.Vector3();
const MAXK = 8;
const CP = Array.from({ length: MAXK }, () => new THREE.Vector3());   // camera keys, resolved to world
const CL = Array.from({ length: MAXK }, () => new THREE.Vector3());   // look keys, resolved to world

// Per play state (one takeover runs at a time)
const S = { boss: null, key: '', fired: 0, last: new THREE.Vector3(), lastOk: false, fov0: 68 };

function focusOf(ctx) {
  const b = S.boss;
  if (b && b.alive && b.group?.parent) { b.focus(_f); S.last.copy(_f); S.lastOk = true; }
  else if (!S.lastOk) _f.copy(ctx.rail.position).add(_a.set(0, 0, -120)); else _f.copy(S.last);
  return _f;
}

function resolve(out, frame, o, ctx, fo) {
  const base = frame === 'f' ? fo : frame === 'r' ? ctx.rail.position : ctx.player.position;
  return out.set(base.x + o[0], base.y + o[1], base.z + o[2]);
}

// Hermite value of one channel at u between keys (finite difference tangents, zero at the ends)
function hermite(u, us, n, get, out) {
  let i = 0; while (i < n - 2 && u > us[i + 1]) i++;
  const u0 = us[i], u1 = us[i + 1], h = Math.max(1e-4, u1 - u0), s = Math.min(1, Math.max(0, (u - u0) / h));
  const tan = (k) => (k <= 0 || k >= n - 1) ? 0 : (get(k + 1) - get(k - 1)) / Math.max(1e-4, us[k + 1] - us[k - 1]);
  const p0 = get(i), p1 = get(i + 1), m0 = tan(i) * h, m1 = tan(i + 1) * h;
  const s2 = s * s, s3 = s2 * s;
  return (2 * s3 - 3 * s2 + 1) * p0 + (s3 - 2 * s2 + s) * m0 + (-2 * s3 + 3 * s2) * p1 + (s3 - s2) * m1;
}

const US = new Float32Array(MAXK), FOV = new Float32Array(MAXK), ROLL = new Float32Array(MAXK);

function makePose(shot) {
  const keys = shot.keys, n = keys.length;
  return (u, t, ctx, out) => {
    const fo = focusOf(ctx);
    for (let i = 0; i < n; i++) {
      const k = keys[i];
      US[i] = k.u; FOV[i] = k.fov ?? S.fov0; ROLL[i] = k.roll ?? 0;
      resolve(CP[i], k.pf ?? 'p', k.p, ctx, fo); resolve(CL[i], k.lf ?? 'f', k.l, ctx, fo);
    }
    const uu = Math.min(1, Math.max(0, u));
    const px = hermite(uu, US, n, (i) => CP[i].x), py = hermite(uu, US, n, (i) => CP[i].y), pz = hermite(uu, US, n, (i) => CP[i].z);
    const lx = hermite(uu, US, n, (i) => CL[i].x), ly = hermite(uu, US, n, (i) => CL[i].y), lz = hermite(uu, US, n, (i) => CL[i].z);
    const fov = hermite(uu, US, n, (i) => FOV[i]), roll = hermite(uu, US, n, (i) => ROLL[i]);
    if (![px, py, pz, lx, ly, lz, fov, roll].every(Number.isFinite)) return;   // keep the previous pose
    const floor = (ctx.world?.info?.floorY ?? -1e9) + 5;
    out.pos.set(px, Math.max(py, floor), pz); out.look.set(lx, ly, lz); out.fov = Math.min(110, Math.max(20, fov)); out.roll = roll;
    // one shot beats
    const bs = shot.beats;
    if (bs) while (S.fired < bs.length && uu >= bs[S.fired].u) {
      const b = bs[S.fired++];
      if (b.shake) ctx.fx?.shake?.(b.shake, b.dur ?? 0.5, b.kind ?? 'boss');
      if (b.sfx) ctx.audio?.sfx?.(b.sfx, { position: fo, volume: b.vol ?? 1, pitch: b.pitch });
      if (b.call) S.boss?.[b.call]?.(ctx);
    }
  };
}

const R = 'r', F = 'f', P = 'p';
// chase-like end keys: the camera leaves the shot where the chase camera would be, so the blend back has nothing to correct
const HOME = { p: [0, 3.6, 12.5], pf: P, l: [0, 1.2, -38], lf: P, fov: 68 };

export const SHOTS = {
  // ---------------------------------------------------------------- REGENT (Foundry): tall crystal, look up its height
  'boss.regent.entrance': { duration: 3.8, keys: [
    { u: 0, ...HOME },
    { u: 0.22, p: [-5, -3.2, 7], pf: P, l: [0, 14, 0], lf: F, fov: 58 },
    { u: 0.52, p: [-36, -10, 62], pf: F, l: [0, 8, 0], lf: F, fov: 50 },
    { u: 0.78, p: [30, 4, 110], pf: F, l: [0, 8, 0], lf: F, fov: 52 },
    { u: 1, ...HOME },
  ], beats: [{ u: 0.06, shake: 0.35, dur: 0.5 }, { u: 0.55, shake: 0.5, dur: 0.6, sfx: 'chargedShot', vol: 0.6 }] },
  'boss.regent.finisher': { duration: 3.2, keys: [
    { u: 0, ...HOME },
    { u: 0.2, p: [-9, -2, 9], pf: P, l: [0, 6, 0], lf: F, fov: 54 },
    { u: 0.48, p: [-13, -3.5, 6], pf: P, l: [0, 5, 0], lf: F, fov: 40 },
    { u: 0.62, p: [-15, -3, 4], pf: P, l: [0, 4, 0], lf: F, fov: 62 },
    { u: 0.85, p: [-8, 3, 14], pf: P, l: [0, 4, -30], lf: F, fov: 66 },
    { u: 1, ...HOME },
  ] },
  // ---------------------------------------------------------------- ORRERY (Cinder): a huge ring, dolly toward it, then a side view of its depth
  'boss.orrery.entrance': { duration: 3.8, keys: [
    { u: 0, ...HOME },
    { u: 0.25, p: [0, 2.5, 6], pf: P, l: [0, 4, 0], lf: F, fov: 62 },
    { u: 0.55, p: [70, 12, 30], pf: F, l: [-6, 0, -20], lf: F, fov: 54 },
    { u: 0.8, p: [24, 20, 120], pf: F, l: [0, 0, 0], lf: F, fov: 56 },
    { u: 1, ...HOME },
  ], beats: [{ u: 0.06, shake: 0.35, dur: 0.5 }, { u: 0.5, shake: 0.45, dur: 0.6 }] },
  'boss.orrery.finisher': { duration: 3.2, keys: [
    { u: 0, ...HOME },
    { u: 0.22, p: [12, 6, 10], pf: P, l: [0, 0, 0], lf: F, fov: 56 },
    { u: 0.48, p: [15, 7, 6], pf: P, l: [0, 0, 0], lf: F, fov: 42 },
    { u: 0.62, p: [16, 8, 4], pf: P, l: [0, 0, 0], lf: F, fov: 64 },
    { u: 0.85, p: [8, 5, 14], pf: P, l: [0, 0, -30], lf: F, fov: 66 },
    { u: 1, ...HOME },
  ] },
  // ---------------------------------------------------------------- TIDEBREAKER (Thalassa): low over the water beside the ship
  'boss.tidebreaker.entrance': { duration: 3.8, keys: [
    { u: 0, ...HOME },
    { u: 0.24, p: [-14, -9, 4], pf: P, l: [0, 4, 0], lf: F, fov: 60 },
    { u: 0.55, p: [-62, -5, 108], pf: F, l: [0, 4, 0], lf: F, fov: 52 },
    { u: 0.8, p: [44, 9, 135], pf: F, l: [0, 4, 0], lf: F, fov: 54 },
    { u: 1, ...HOME },
  ], beats: [{ u: 0.06, shake: 0.35, dur: 0.5 }, { u: 0.55, shake: 0.5, dur: 0.6 }] },
  'boss.tidebreaker.finisher': { duration: 3.2, keys: [
    { u: 0, ...HOME },
    { u: 0.22, p: [-16, -5, 8], pf: P, l: [0, 5, 0], lf: F, fov: 56 },
    { u: 0.48, p: [-19, -4, 6], pf: P, l: [0, 5, 0], lf: F, fov: 42 },
    { u: 0.62, p: [-20, -4, 4], pf: P, l: [0, 5, 0], lf: F, fov: 64 },
    { u: 0.85, p: [-9, 3, 14], pf: P, l: [0, 4, -30], lf: F, fov: 66 },
    { u: 1, ...HOME },
  ] },
};

/** Register the six boss shots with ctx.cinema (idempotent). Called from Boss.onSpawn. */
export function ensureBossShots(ctx) {
  const cin = ctx.cinema;
  if (!cin || cin.__bossShots === true) return;
  cin.__bossShots = true;
  for (const [name, shot] of Object.entries(SHOTS)) {
    const entrance = name.endsWith('.entrance');
    cin.register(name, {
      duration: shot.duration, letterbox: 1, hideHud: true, lockInput: true, invulnerable: true,
      pose: makePose(shot),
      onStart(c, opts) {
        S.boss = opts?.data?.boss ?? c.enemies?.boss ?? null; S.key = name; S.fired = 0; S.lastOk = false;
        S.fov0 = c.cameraRig?.cur?.fov ?? 68;
        if (S.boss?.alive && S.boss.group) S.boss.focus(S.last), S.lastOk = true;
      },
      onEnd(c, opts) {
        const b = S.boss; S.boss = null;
        if (entrance) b?.showWarning?.();
      },
    });
  }
}
