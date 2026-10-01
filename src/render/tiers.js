// Effect tiers and the adaptive quality controller. 
//
// QUALITY[q] describes tier q (0 is the best). render.tier is always QUALITY[render.quality], so any module can read the flags of
// the current tier each frame (ctx.render.tier.dof, ...). Every flag has a consumer:
//   pr       pixel ratio cap (multiplied by the device pixel ratio, capped by it)                 renderer.js setQuality
//   bloom    bloom resolution scale, on: bloom pass enabled                                        renderer.js _patchBloomSize
//   dof      far depth of field 0 or 1 (6 taps, far pixels only)                                   renderer.js -> passes/fogPass.js
//   shafts   light shafts 0, 0.5 (third resolution) or 1 (half resolution)                        renderer.js -> passes/sunPass.js
//   flare    lens flare 0 or 1                                                                     renderer.js -> passes/sunPass.js
//   water    water and sky detail 0, 1, 2 (ripple count, cloud lighting, nebula octaves, obstacle foam, caustics)
//                                                                                                  levels/thalassa.js -> world/liquids.js, world/sky.js
//   fog      height fog and depth based atmosphere 0 or 1                                          renderer.js -> passes/fogPass.js
//   grade    colour grading 0 or 1                                                                 renderer.js -> postShader.js
// Order in which the tiers give things up (design decision): depth of field (tier 1), light shafts (tier 2 half, tier 3 off), water
// detail (tier 2 reduced, tier 3 cheapest), bloom quality (tier 4 and 5), then the flare and fog. The pixel ratio steps down from
// tier 1 on because a 2x display renders four times the pixels of a 1x display: on a 1x display (pr is capped by the device pixel
// ratio) tiers 0 to 3 all render 1080p and only the effects change, on a 2x display tier 2 already renders 1080p.
// Measured on an Apple M5 at 1080p, dpr 1 (lower quartile ms): tier 0 3.7 to 7.1 depending on level, tier 3 3.2 to 6.0, tier 5 1.9 to 3.1.
// With 3x the pixels (looktest --stress=3, a GPU three times weaker) tier 2 is the first that holds 16.6 ms on every level and point.
// The speed effects (near layer from tier 2, blur taps from tier 3, speed blur from tier 4) are read from render.quality in
// src/fx/speedfx.js and src/render/renderer.js and stay as they are.
//
// TOUCH DEVICES (device.touch, phones and tablets, everything below only applies there, desktop never reads it)
//   start tier   phones tier 1 (pr 1.5, bloom, shafts at half resolution, flare, water 2, fog, grade: the desktop look minus depth of field),
//                tablets tier 2 (pr 1, shafts at third resolution, water 1). Never tier 0, the pixel count of a tablet is too high for it.
//   adapt        down only. Each step reallocates the targets when the pixel ratio or the bloom scale changes (a step between two tiers
//                with the same pr and bloom scale, like 2 to 3, costs nothing). A step that does not make frames clearly faster means the
//                frame rate is capped from outside (Low Power Mode 30 fps, thermal clamp): it is undone once and the controller locks for
//                good (r._capLocked), so there is at most one down and one up reallocation, never a loop. The lock is only lifted if the
//                frames get much slower later (thermal throttling), at most twice.
//   memory and pixel budget (arithmetic, verify on the device with ?phonediag=1, which prints the same estimate)
//     bytes per output pixel at the pixel ratio the tier renders at:
//       scene target   half float RGBA 8 + depth texture 24 bit 4                                     = 12
//       composer pair  2 x (half float RGBA 8 + depth renderbuffer 4)                                 = 24
//       bloom          bright target and 5 mips, horizontal and vertical, half float, quarter area    =  3.3 x bloom scale squared
//       sun pass       mask and shaft targets, half float, at 0.5 (shafts 1) or 0.33 (shafts 0.5, 0) = 4.0 or 1.7
//       canvas         drawing buffer RGBA8, front and back                                           =  8
//       total          51 B per pixel at tier 0 and 1, 49 at tier 2 and 3, 45 at tier 4, 44 at tier 5 (MB below means 1048576 bytes)
//     iPhone 12 (844 x 390 CSS, dpr 3, 2532 x 1170 = 2.96 MP native)
//       tier 0  pr 2     1688 x 780  = 1.32 MP   64 MB
//       tier 1  pr 1.5   1266 x 585  = 0.74 MP   36 MB   (phone start, 25 percent of the native pixels)
//       tier 2  pr 1      844 x 390  = 0.33 MP   15 MB
//       tier 4  pr 0.85   717 x 331  = 0.24 MP   10 MB
//       tier 5  pr 0.7    590 x 273  = 0.16 MP    7 MB
//     iPhone 14 (852 x 393 CSS, dpr 3, 2556 x 1179 = 3.01 MP native)
//       tier 0  pr 2     1704 x 786  = 1.34 MP   66 MB
//       tier 1  pr 1.5   1278 x 589  = 0.75 MP   37 MB
//       tier 2  pr 1      852 x 393  = 0.33 MP   16 MB
//       tier 4  pr 0.85   724 x 334  = 0.24 MP   10 MB
//       tier 5  pr 0.7    596 x 275  = 0.16 MP    7 MB
//     iPad Pro 13 (1376 x 1032 CSS, dpr 2): tier 0 is 5.68 MP and 278 MB, tier 1 3.2 MP and 156 MB, which is why tablets start at
//     tier 2 (pr 1, 1.42 MP, 66 MB). iPad Pro 11 (1194 x 834): tier 0 195 MB, tier 2 47 MB.
//     Desktop reference: the tier 0 figures above were measured at 1080p, 2.07 MP. A phone at tier 1 draws 0.36 times those pixels
//     (the per pixel shader work is the same chain), the GPU of an A14 is several times weaker than an M5, so the phone start is
//     a first guess and the down only controller is the safety net. Real iPhone readings (?phonediag=1) decide the final start tier.
import { device } from '../core/device.js';

export const QUALITY = [
  { pr: 2, bloom: 1, on: true, dof: 1, shafts: 1, flare: 1, water: 2, fog: 1, grade: 1 },
  { pr: 1.5, bloom: 1, on: true, dof: 0, shafts: 1, flare: 1, water: 2, fog: 1, grade: 1 },
  { pr: 1, bloom: 1, on: true, dof: 0, shafts: 0.5, flare: 1, water: 1, fog: 1, grade: 1 },
  { pr: 1, bloom: 1, on: true, dof: 0, shafts: 0, flare: 1, water: 0, fog: 1, grade: 1 },
  { pr: 0.85, bloom: 0.5, on: true, dof: 0, shafts: 0, flare: 0, water: 0, fog: 1, grade: 1 },
  { pr: 0.7, bloom: 0.35, on: false, dof: 0, shafts: 0, flare: 0, water: 0, fog: 0, grade: 1 },
];

/** tier a new session starts at: 0 on desktop, 1 on phones, 2 on tablets (see the touch notes in the header) */
export const startTier = () => (!device.touch ? 0 : device.phone ? 1 : 2);

/** rough render memory in MB for a canvas of w x h CSS px drawn at tier flags T (see the byte table in the header) */
export function estimateMB(w, h, T, dpr, composer = true) {
  const pr = Math.min(dpr || 1, T.pr), px = w * pr * h * pr;
  const sun = T.shafts >= 1 ? 4.0 : T.shafts > 0 || T.flare ? 1.7 : 0;
  const per = 8 + (composer ? 36 + (T.on ? 3.3 * T.bloom * T.bloom : 0) + sun : 0);
  return px * per / 1048576;
}

export const effectsFor = (q) => QUALITY[Math.max(0, Math.min(QUALITY.length - 1, q | 0))];

// Adaptive controller, called from render.render() after every frame with the wall clock interval in seconds. It never resizes
// anything itself: it sets r._pendingQ and renderer.js applies it before the next draw (a resize clears the canvas).
export function adapt(r, dt) {
  if (!r.adaptive) return;
  const ms = dt * 1000;
  if (ms > 200 || ms <= 0) return; // ignore tab switches and pauses
  r.avgMs += (ms - r.avgMs) * 0.05;
  r._sinceChange += dt;
  if (r._dropLock > 0) r._dropLock -= dt;
  if (r._sinceChange < 2.5) return;
  if (r.mobile) { adaptMobile(r, dt); return; }
  // A step down that did not make frames clearly faster means the frame rate is capped from outside (30 Hz display, browser
  // energy saver), not limited by the GPU. Undo it and stop dropping for a while, the lock doubles on each repeat.
  if (r._stepFrom) {
    const f = r._stepFrom; r._stepFrom = null;
    if (r.quality === f.q + 1 && r.avgMs > f.ms * 0.92) {
      r._pendingQ = f.q; r._dropLock = r._lockLen; r._lockLen = Math.min(600, r._lockLen * 2);
      return;
    }
  }
  if (r.avgMs > 24 && r.quality < QUALITY.length - 1 && r._dropLock <= 0) {
    r._slow += dt;
    if (r._slow > 1.2) { r._stepFrom = { q: r.quality, ms: r.avgMs }; r._pendingQ = r.quality + 1; r._slow = 0; r._sinceChange = 0; }
  } else { r._slow = 0; }
  if (r.avgMs < 12.5 && r.quality > 0) {
    r._fast += dt;
    if (r._fast > 12) { r._pendingQ = r.quality - 1; r._fast = 0; }
  } else { r._fast = 0; }
}

// Touch devices: down only, and a frame cap from outside is recognised once and then left alone. Runs after the same 2.5 s settle
// time as the desktop controller (the session starts at _sinceChange -3 so shader compiles and the first level load are skipped).
function adaptMobile(r, dt) {
  if (r._capLocked) {
    // locked: a frame rate much lower than the cap we locked at (thermal throttling) gets another test step, at most twice
    r._slowLocked = r.avgMs > Math.max(42, r._lockMs * 1.3) ? (r._slowLocked || 0) + dt : 0;
    if (r._slowLocked > 4 && r._unlocks < 2 && r.quality < QUALITY.length - 1) { r._capLocked = false; r._unlocks++; r._slowLocked = 0; }
    return;
  }
  if (r._stepFrom) {
    const f = r._stepFrom; r._stepFrom = null;
    if (r.quality === f.q + 1 && r.avgMs > f.ms * 0.92) {
      // the step did not help: go back once (nothing is lost, the frame rate is not limited by the GPU) and stop stepping
      r._pendingQ = f.q; r._capLocked = true; r._lockMs = f.ms; r._slow = 0;
      return;
    }
  }
  if (r.avgMs > 24 && r.quality < QUALITY.length - 1) {
    r._slow += dt;
    if (r._slow > 1.6) { r._stepFrom = { q: r.quality, ms: r.avgMs }; r._pendingQ = r.quality + 1; r._slow = 0; r._sinceChange = 0; }
  } else { r._slow = 0; }
}
