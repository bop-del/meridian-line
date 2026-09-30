// The Obsidian Foundry floor: black glass cut by a grid of molten metal channels, with crucible pools at some junctions.
// It replaces the shared molten plane for this level so the look is fully controlled from here:
//  * channels and pools have a capped peak brightness (uGlow, uPool) that stays inside the bloom budget instead of clipping to white,
//  * pool discs use a long smooth falloff, so bloom cannot turn them into hard white ellipses,
//  * every high frequency term is faded by the screen space footprint of a pixel (fwidth), so channels melt into a soft glow at the
//    horizon instead of aliasing into moire bands, and the black glass gets a whisper of dither against colour banding,
//  * a grazing angle sheen gives the glass a cold reflection of the smelter haze.
// The plane follows the rail like the old one and is snapped to nothing (the pattern is a function of world position).
import * as THREE from 'three';

const VERT = /* glsl */ `
varying vec3 vWorld;
#include <fog_pars_vertex>
void main(){
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorld = wp.xyz;
  vec4 mvPosition = viewMatrix * wp;
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}`;

const FRAG = /* glsl */ `
uniform float uTime, uGlow, uPool, uHaze;
uniform vec3 uHot, uAmber, uGlass, uSheen;
varying vec3 vWorld;
float h13(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float vn(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f);
  return mix(mix(h13(i), h13(i+vec2(1,0)), f.x), mix(h13(i+vec2(0,1)), h13(i+vec2(1,1)), f.x), f.y); }
#include <fog_pars_fragment>
void main(){
  vec2 p = vWorld.xz + vec2(47.0, 23.0);
  // world units covered by one pixel, at least a little so the maths below never divides by zero
  float fw = max(length(fwidth(p)), 0.02);
  const float CELL = 140.0;
  vec2 g = p / CELL, cell = floor(g), f = fract(g);
  vec2 e = min(f, 1.0 - f) * CELL;
  float dist, id;
  if (e.x < e.y) { float ix = f.x < 0.5 ? cell.x : cell.x + 1.0; id = h13(vec2(ix, cell.y)); dist = e.x; }
  else { float iy = f.y < 0.5 ? cell.y : cell.y + 1.0; id = h13(vec2(cell.x + 31.0, iy)); dist = e.y; }
  float present = step(0.42, id);
  float wide = 0.9 + 1.7 * vn(p * 0.03) + id * 0.9;
  float flow = 0.62 + 0.38 * sin(uTime * 0.9 + (p.x + p.y) * 0.02 + id * 20.0);
  // channel: widen the soft edges by the pixel footprint, and blend to the average coverage once the channel is thinner than ~2 px
  float aa = fw * 1.4;
  float cover = clamp(wide / (fw * 2.0), 0.0, 1.0);
  float coreN = (1.0 - smoothstep(wide * 0.15, wide * 0.7 + aa, dist)) * present;
  float bodyN = (1.0 - smoothstep(wide * 0.5, wide * 1.3 + aa, dist)) * present;
  float avgCore = present * clamp(wide * 0.5 / (CELL * 0.5), 0.0, 0.12);
  float avgBody = present * clamp(wide * 1.3 / (CELL * 0.5), 0.0, 0.2);
  float core = mix(avgCore, coreN, cover), body = mix(avgBody, bodyN, cover);
  float bleed = exp(-dist * 0.16) * present * 0.14 * mix(0.6, 1.0, cover);
  // crucible pools at some junctions: long smooth falloff, capped peak
  vec2 c = (cell + 0.5) * CELL;
  float ph = h13(cell + 7.0);
  float pr = 11.0 + ph * 12.0;
  float pdn = clamp(length(p - c) / (pr * 1.5), 0.0, 1.0);
  float pfall = 1.0 - pdn * pdn * (3.0 - 2.0 * pdn);
  float isPool = step(0.78, ph);
  float pool = isPool * pfall * pfall * 0.62;
  float poolRing = isPool * pfall * pfall * 0.5;
  float m = clamp(body + pool, 0.0, 1.0);
  float fineFade = 1.0 - smoothstep(0.25, 1.1, fw);
  vec3 col = uGlass * (0.55 + 0.9 * vn(p * 0.03)) + vec3(0.0, 0.01, 0.03) * vn(p * 0.6 + uTime * 0.1) * fineFade;
  col += uAmber * (bleed * uHaze + poolRing * 0.1 * flow * uPool);
  vec3 V = normalize(cameraPosition - vWorld);
  float graze = pow(1.0 - clamp(V.y, 0.0, 1.0), 4.0);
  col += uSheen * graze * (0.6 + 0.6 * mix(0.5, vn(p * 0.05), fineFade));
  vec3 melt = mix(uAmber, uHot, clamp(core + pool * 0.85, 0.0, 1.0));
  float poolShare = clamp(pool / max(body + pool, 0.001), 0.0, 1.0);
  col = mix(col, melt * (0.75 + 0.6 * flow) * mix(uGlow, uPool, poolShare), m);
  col += (h13(gl_FragCoord.xy + fract(uTime) * 91.0) - 0.5) * 0.004;
  col = max(col, vec3(0.0));
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <fog_fragment>
}`;

export function createFoundryFloor(opts = {}) {
  const size = opts.size ?? 3200;
  const geo = new THREE.PlaneGeometry(size, size, 2, 2);
  geo.rotateX(-Math.PI / 2);
  const mat = new THREE.ShaderMaterial({
    vertexShader: VERT, fragmentShader: FRAG, fog: true,
    uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {
      uTime: { value: 0 }, uGlow: { value: 1 }, uPool: { value: 1 }, uHaze: { value: 1 },
      uHot: { value: new THREE.Color(opts.hot ?? 0xffe0b0).multiplyScalar(0.9) }, uAmber: { value: new THREE.Color(opts.amber ?? 0xff6a14).multiplyScalar(0.8) },
      uGlass: { value: new THREE.Color(opts.glass ?? 0x080b14) }, uSheen: { value: new THREE.Color(opts.sheen ?? 0x1c2c52).multiplyScalar(1.2) },
    }]),
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  return {
    mesh, mat,
    update(time, railPos, y, { glow = 1, pool = 1, haze = 1 } = {}) {
      const u = mat.uniforms;
      u.uTime.value = time; u.uGlow.value = glow; u.uPool.value = pool; u.uHaze.value = haze;
      mesh.position.set(railPos.x, y, railPos.z);
    },
    dispose() { geo.dispose(); mat.dispose(); },
  };
}
