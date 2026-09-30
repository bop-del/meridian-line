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
export const QUALITY = [
  { pr: 2, bloom: 1, on: true, dof: 1, shafts: 1, flare: 1, water: 2, fog: 1, grade: 1 },
  { pr: 1.5, bloom: 1, on: true, dof: 0, shafts: 1, flare: 1, water: 2, fog: 1, grade: 1 },
  { pr: 1, bloom: 1, on: true, dof: 0, shafts: 0.5, flare: 1, water: 1, fog: 1, grade: 1 },
  { pr: 1, bloom: 1, on: true, dof: 0, shafts: 0, flare: 1, water: 0, fog: 1, grade: 1 },
  { pr: 0.85, bloom: 0.5, on: true, dof: 0, shafts: 0, flare: 0, water: 0, fog: 1, grade: 1 },
  { pr: 0.7, bloom: 0.35, on: false, dof: 0, shafts: 0, flare: 0, water: 0, fog: 0, grade: 1 },
];

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
