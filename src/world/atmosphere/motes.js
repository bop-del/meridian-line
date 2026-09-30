// Ambient particle fields: embers, sparks, ash and pollen that hang in the air around the flight path and give the eye depth and
// speed cues. One THREE.Points draw call per field, every particle is placed by the vertex shader from a static seed attribute, so
// the CPU only writes a handful of uniforms per frame. Particles live in world space (they streak past as the ship flies), wrap in
// depth around the rail, are depth tested (walls and rocks hide them) and fade out near the camera and in the distance, so they add
// depth without ever covering the ship, the reticle, enemies or pickups. Additive, colours are kept at or below 1 so bloom cannot
// blow them out. Every shader path is NaN safe (clamped divisions, no pow of negatives).
import * as THREE from 'three';
import { Rng } from '../util.js';

const VERT = /* glsl */ `
attribute vec4 aSeed;
uniform vec3 uRail; uniform float uTime, uDepth, uPx, uSize, uMinPx, uMaxPx, uNearFade, uFlick, uRise, uSway;
uniform vec2 uSpread; uniform vec3 uDrift; uniform float uYMin, uYMax;
varying float vA; varying float vT;
float wrap(float v, float lo, float hi){ float r = hi - lo; return lo + mod(v - lo, r); }
void main(){
  vec4 s = aSeed;
  float spd = 0.45 + s.w;
  // world space depth: each particle sits at zBase + n * depth, choose the copy inside (rail.z - depth, rail.z]
  float zBase = -s.z * uDepth;
  float z = uRail.z - mod(uRail.z - zBase, uDepth);
  float x0 = (s.x * 2.0 - 1.0) * uSpread.x;
  float y0 = mix(uYMin, uYMax, s.y);
  float x = wrap(x0 + uDrift.x * uTime * spd + sin(uTime * 0.31 * spd + s.w * 40.0) * uSway, -uSpread.x, uSpread.x) + uRail.x;
  float y = wrap(y0 + (uDrift.y + uRise * spd) * uTime, uYMin, uYMax) + uRail.y * 0.0;
  z += uDrift.z * uTime * spd;
  vec4 mv = viewMatrix * vec4(x, y, z, 1.0);
  float dist = max(-mv.z, 0.5);
  float fadeFar = 1.0 - smoothstep(uDepth * 0.55, uDepth * 0.98, dist);
  float fadeNear = smoothstep(uNearFade * 0.5, uNearFade, dist);
  float tw = 1.0 - uFlick + uFlick * (0.5 + 0.5 * sin(uTime * (2.0 + 5.0 * s.w) + s.z * 91.0));
  vA = fadeFar * fadeNear * tw * (0.4 + 0.6 * s.y);
  vT = s.w;
  float px = clamp(uSize * (0.5 + s.y) * uPx / dist, uMinPx, uMaxPx);
  // sub pixel particles fade instead of shimmering
  vA *= clamp(uSize * (0.5 + s.y) * uPx / dist / max(uMinPx, 0.001), 0.0, 1.0);
  gl_PointSize = px;
  gl_Position = projectionMatrix * mv;
}`;
const FRAG = /* glsl */ `
uniform vec3 uColA, uColB; uniform float uBright;
varying float vA; varying float vT;
void main(){
  vec2 c = gl_PointCoord * 2.0 - 1.0;
  float d = dot(c, c);
  float a = clamp(1.0 - d, 0.0, 1.0);
  a = a * a;
  vec3 col = mix(uColA, uColB, vT) * uBright;
  gl_FragColor = vec4(col, a * vA);
}`;

/** kinds are just parameter sets, see below */
const KINDS = {
  // hot ember flecks drifting sideways and up, flickering
  ember: { count: 380, spread: [70, 46], y: [-46, 46], depth: 420, drift: [-2.2, 0.9, 0], rise: 0.6, sway: 4, size: 0.42, colA: 0xff7a2a, colB: 0xffd08a, flick: 0.75, bright: 0.95, px: [1.6, 9], near: 16 },
  // cold pale ash and dust motes, slow and dim
  ash: { count: 320, spread: [80, 50], y: [-50, 50], depth: 460, drift: [1.2, -0.5, 0], rise: 0, sway: 6, size: 0.3, colA: 0x5fb8c8, colB: 0xa8d8e0, flick: 0.35, bright: 0.5, px: [1.4, 6], near: 14 },
  // smelter sparks lifting off the floor, quick and short lived looking
  spark: { count: 340, spread: [64, 0], y: [-34, 46], depth: 380, drift: [0, 0, 0], rise: 7.5, sway: 3, size: 0.34, colA: 0xff8a30, colB: 0xffe0a0, flick: 0.7, bright: 0.95, px: [1.5, 8], near: 14 },
  // cold ash falling slowly in the hall
  soot: { count: 240, spread: [64, 0], y: [-34, 60], depth: 420, drift: [0.8, -1.6, 0], rise: 0, sway: 5, size: 0.28, colA: 0x4a6aa8, colB: 0x9ab8ee, flick: 0.3, bright: 0.45, px: [1.3, 6], near: 14 },
  // warm pollen and sea spray hanging over the water
  pollen: { count: 260, spread: [70, 0], y: [-20, 40], depth: 380, drift: [0.6, 0.35, 0], rise: 0.5, sway: 5, size: 0.36, colA: 0xffe0a0, colB: 0xfff4d8, flick: 0.5, bright: 0.55, px: [1.4, 7], near: 14 },
};

export function createMotes(kind, opts = {}) {
  const K = { ...KINDS[kind], ...opts };
  const rng = new Rng(K.seed ?? 101);
  const seed = new Float32Array(K.count * 4);
  for (let i = 0; i < K.count; i++) { seed[i * 4] = rng.r(); seed[i * 4 + 1] = rng.r(); seed[i * 4 + 2] = (i + rng.r()) / K.count; seed[i * 4 + 3] = rng.r(); }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(K.count * 3), 3));
  geo.setAttribute('aSeed', new THREE.BufferAttribute(seed, 4));
  const u = {
    uRail: { value: new THREE.Vector3() }, uTime: { value: 0 }, uDepth: { value: K.depth }, uPx: { value: 800 },
    uSize: { value: K.size }, uMinPx: { value: K.px[0] }, uMaxPx: { value: K.px[1] }, uNearFade: { value: K.near },
    uFlick: { value: K.flick }, uRise: { value: K.rise }, uSway: { value: K.sway },
    uSpread: { value: new THREE.Vector2(K.spread[0], K.spread[1]) }, uDrift: { value: new THREE.Vector3(...K.drift) },
    uYMin: { value: K.y[0] }, uYMax: { value: K.y[1] },
    uColA: { value: new THREE.Color(K.colA) }, uColB: { value: new THREE.Color(K.colB) }, uBright: { value: K.bright },
  };
  const mat = new THREE.ShaderMaterial({ uniforms: u, vertexShader: VERT, fragmentShader: FRAG, transparent: true, depthWrite: false, depthTest: true, blending: THREE.AdditiveBlending, fog: false });
  const pts = new THREE.Points(geo, mat);
  pts.frustumCulled = false;
  pts.renderOrder = 6;
  pts.name = 'motes_' + kind;
  // tier scaling: fewer particles on weaker tiers
  const TIER = [1, 1, 0.8, 0.65, 0.45, 0.3];
  const _cam = new THREE.Vector3();
  return {
    object: pts, uniforms: u,
    /** amount: feel multiplier, size: feel multiplier, bright: feel multiplier */
    update(ctx, time, { amount = 1, size = 1, bright = 1, yBase = null } = {}) {
      const rp = ctx.rail.position;
      u.uRail.value.set(rp.x, rp.y, rp.z);
      u.uTime.value = time;
      const cam = ctx.camera;
      const h = ctx.renderer?.domElement?.height ?? 900;
      const dpr = ctx.renderer?.getPixelRatio?.() ?? 1;
      const fov = cam ? cam.fov : 60;
      u.uPx.value = (h) / (2 * Math.tan((fov * Math.PI) / 360));
      u.uSize.value = K.size * size;
      u.uMinPx.value = K.px[0] * Math.max(0.6, dpr * 0.75);
      u.uMaxPx.value = K.px[1] * Math.max(0.8, dpr * 0.8);
      u.uBright.value = K.bright * bright;
      const q = ctx.render?.quality ?? 0;
      const n = Math.max(0, Math.min(K.count, Math.round(K.count * amount * TIER[Math.min(5, q | 0)])));
      geo.setDrawRange(0, n);
      pts.visible = n > 0 && bright > 0;
      if (yBase !== null) { u.uYMin.value = K.y[0] + yBase; u.uYMax.value = K.y[1] + yBase; }
    },
    dispose() { geo.dispose(); mat.dispose(); },
  };
}
