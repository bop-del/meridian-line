// Animated liquid planes that follow the rail: ocean (Thalassa Coast) and molten glass floor (Obsidian Foundry). World space waves, snapped to the
// vertex grid so nothing swims while the plane follows the player.
import * as THREE from 'three';

const NOISE = /* glsl */ `
float h13(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float vn(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f);
  return mix(mix(h13(i), h13(i+vec2(1,0)), f.x), mix(h13(i+vec2(0,1)), h13(i+vec2(1,1)), f.x), f.y); }
float fbm2(vec2 p){ float a = 0.5, s = 0.0; for(int i=0;i<5;i++){ s += a*vn(p); p = p*2.02 + 5.3; a *= 0.5; } return s; }
`;

const WATER_VERT = /* glsl */ `
uniform float uTime;
varying vec3 vWorld; varying float vH;
#include <fog_pars_vertex>
float wv(vec2 p, float t){
  return sin(p.x*0.045 + t*0.9)*1.5 + sin(p.y*0.037 - t*0.7 + p.x*0.02)*1.2
       + sin((p.x+p.y)*0.11 + t*1.6)*0.45 + sin((p.x-p.y)*0.19 - t*2.1)*0.2;
}
void main(){
  vec4 wp = modelMatrix * vec4(position, 1.0);
  float h = wv(wp.xz, uTime);
  wp.y += h; vH = h; vWorld = wp.xyz;
  vec4 mvPosition = viewMatrix * wp;
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}`;

const WATER_FRAG = /* glsl */ `
uniform float uTime; uniform vec3 uDeep, uShallow, uSky, uSunColor, uSunDir, uFoam, uSunDir2, uSunColor2;
varying vec3 vWorld; varying float vH;
${NOISE}
#include <fog_pars_fragment>
float wv(vec2 p, float t){
  return sin(p.x*0.045 + t*0.9)*1.5 + sin(p.y*0.037 - t*0.7 + p.x*0.02)*1.2
       + sin((p.x+p.y)*0.11 + t*1.6)*0.45 + sin((p.x-p.y)*0.19 - t*2.1)*0.2;
}
float wn(vec2 p, float t){
  return wv(p, t) + (vn(p*0.35 + vec2(t*0.6, -t*0.4)) - 0.5) * 1.6 + (vn(p*0.9 - vec2(t*0.9, t*0.5)) - 0.5) * 0.7;
}
void main(){
  vec2 p = vWorld.xz;
  float e = 0.8;
  float h0 = wn(p, uTime), hx = wn(p + vec2(e, 0.0), uTime), hz = wn(p + vec2(0.0, e), uTime);
  vec3 n = normalize(vec3(-(hx - h0) / e * 0.55, 1.0, -(hz - h0) / e * 0.55));
  vec3 V = normalize(cameraPosition - vWorld);
  float ndv = max(dot(n, V), 0.0);
  float fres = pow(1.0 - ndv, 4.0);
  fres = clamp(0.03 + fres * 0.62, 0.0, 1.0);
  float depthMix = clamp(0.5 + vH * 0.18 + (vn(p * 0.02) - 0.5) * 0.9, 0.0, 1.0);
  vec3 body = mix(uDeep, uShallow, depthMix);
  vec3 col = mix(body, uSky, fres);
  // sun glitter
  vec3 R = reflect(-uSunDir, n);
  float spec = pow(max(dot(R, V), 0.0), 160.0) * 2.4 + pow(max(dot(R, V), 0.0), 18.0) * 0.18;
  col += uSunColor * spec;
  vec3 R2 = reflect(-uSunDir2, n);
  col += uSunColor2 * (pow(max(dot(R2, V), 0.0), 140.0) * 2.0 + pow(max(dot(R2, V), 0.0), 16.0) * 0.16);
  // foam on crests
  float foam = smoothstep(1.5, 2.3, vH + (vn(p * 0.5 + uTime * 0.3) - 0.5) * 1.2);
  col = mix(col, uFoam, foam * 0.5);
  // fine sparkle
  float sp = smoothstep(0.93, 1.0, vn(p * 1.7 + uTime * 0.8)) * 0.25;
  col += uSunColor * sp * (1.0 - fres);
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <fog_fragment>
}`;

const MOLTEN_FRAG = /* glsl */ `
uniform float uTime; uniform vec3 uHot, uAmber, uGlass, uSheen;
varying vec3 vWorld;
${NOISE}
#include <fog_pars_fragment>
float h21(vec2 p){ return h13(p); }
void main(){
  vec2 p = vWorld.xz + vec2(47.0, 23.0);
  const float CELL = 140.0;
  vec2 g = p / CELL, cell = floor(g), f = fract(g);
  vec2 e = min(f, 1.0 - f) * CELL;
  float dist, id;
  if (e.x < e.y) { float ix = f.x < 0.5 ? cell.x : cell.x + 1.0; id = h21(vec2(ix, cell.y)); dist = e.x; }
  else { float iy = f.y < 0.5 ? cell.y : cell.y + 1.0; id = h21(vec2(cell.x + 31.0, iy)); dist = e.y; }
  float present = step(0.42, id);
  float wide = 0.9 + 1.7 * vn(p * 0.03) + id * 0.9;
  float flow = 0.62 + 0.38 * sin(uTime * 0.9 + (p.x + p.y) * 0.02 + id * 20.0);
  // channel core, bright edge of the melt, and light bleeding onto the glass
  float core = (1.0 - smoothstep(wide * 0.15, wide * 0.7, dist)) * present;
  float body = (1.0 - smoothstep(wide * 0.5, wide * 1.3, dist)) * present;
  float bleed = exp(-dist * 0.16) * present * 0.14;
  // crucible pools at some junctions
  vec2 c = (cell + 0.5) * CELL;
  float ph = h21(cell + 7.0);
  float pr = 11.0 + ph * 12.0;
  float pool = step(0.78, ph) * (1.0 - smoothstep(pr * 0.7, pr, length(p - c)));
  float poolRing = step(0.78, ph) * (1.0 - smoothstep(pr, pr + 5.0, length(p - c)));
  float m = clamp(body + pool, 0.0, 1.0);
  vec3 col = uGlass * (0.55 + 0.9 * vn(p * 0.03)) + vec3(0.0, 0.01, 0.03) * vn(p * 0.6 + uTime * 0.1);
  col += uAmber * (bleed + poolRing * 0.1 * flow);
  vec3 V = normalize(cameraPosition - vWorld);
  col += uSheen * pow(1.0 - clamp(V.y, 0.0, 1.0), 4.0) * (0.6 + 0.6 * vn(p * 0.05));
  vec3 melt = mix(uAmber, uHot, clamp(core + pool * 0.85, 0.0, 1.0));
  col = mix(col, melt * (0.75 + 0.6 * flow), m);
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <fog_fragment>
}`;

const LAVA_VERT = /* glsl */ `
varying vec3 vWorld;
#include <fog_pars_vertex>
void main(){
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorld = wp.xyz;
  vec4 mvPosition = viewMatrix * wp;
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}`;
const LAVA_FRAG = /* glsl */ `
uniform float uTime; uniform vec3 uHot, uMid, uCrust;
varying vec3 vWorld;
${NOISE}
#include <fog_pars_fragment>
void main(){
  vec2 p = vWorld.xz * 0.018;
  vec2 q = vec2(fbm2(p + uTime * 0.03), fbm2(p + vec2(5.2, 1.3) - uTime * 0.02));
  float n = fbm2(p * 1.6 + q * 2.2 + vec2(0.0, uTime * 0.05));
  float cracks = smoothstep(0.30, 0.48, n);
  float veins = 1.0 - smoothstep(0.0, 0.06, abs(n - 0.46));
  vec3 col = mix(uHot, uMid, smoothstep(0.3, 0.7, n));
  col = mix(col, uCrust, cracks * 0.94);
  col += uHot * veins * 1.1;
  float pulse = 0.85 + 0.15 * sin(uTime * 1.3 + n * 8.0);
  col *= pulse;
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <fog_fragment>
}`;

export function createOcean(opts = {}) {
  const size = opts.size ?? 3600, seg = opts.seg ?? 160;
  const geo = new THREE.PlaneGeometry(size, size, seg, seg);
  geo.rotateX(-Math.PI / 2);
  const mat = new THREE.ShaderMaterial({
    vertexShader: WATER_VERT, fragmentShader: WATER_FRAG, fog: true,
    uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {
      uTime: { value: 0 },
      uDeep: { value: new THREE.Color(opts.deep ?? 0x0a4a86) }, uShallow: { value: new THREE.Color(opts.shallow ?? 0x2aa5c8) },
      uSky: { value: new THREE.Color(opts.sky ?? 0xb6d8f0) }, uSunColor: { value: new THREE.Color(opts.sunColor ?? 0xfff1cc) },
      uSunDir: { value: (opts.sunDir ?? new THREE.Vector3(-0.4, 0.5, -0.75)).clone().normalize() }, uFoam: { value: new THREE.Color(opts.foam ?? 0xf2fbff) },
      uSunDir2: { value: (opts.sunDir2 ?? new THREE.Vector3(0.3, 0.3, -0.9)).clone().normalize() }, uSunColor2: { value: new THREE.Color(opts.sunColor2 ?? 0x000000) },
    }]),
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  const step = size / seg;
  return {
    mesh, mat,
    update(time, railPos, y) {
      mat.uniforms.uTime.value = time;
      mesh.position.set(Math.round(railPos.x / step) * step, y, Math.round(railPos.z / step) * step);
    },
    dispose() { geo.dispose(); mat.dispose(); },
  };
}

export function createLava(opts = {}) {
  const size = opts.size ?? 3200;
  const geo = new THREE.PlaneGeometry(size, size, 2, 2);
  geo.rotateX(-Math.PI / 2);
  const mat = new THREE.ShaderMaterial({
    vertexShader: LAVA_VERT, fragmentShader: LAVA_FRAG, fog: true,
    uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {
      uTime: { value: 0 },
      uHot: { value: new THREE.Color(opts.hot ?? 0xff7a18).multiplyScalar(1.05) }, uMid: { value: new THREE.Color(opts.mid ?? 0x8a1404) },
      uCrust: { value: new THREE.Color(opts.crust ?? 0x1a0806) },
    }]),
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  return {
    mesh, mat,
    update(time, railPos, y) {
      mat.uniforms.uTime.value = time;
      mesh.position.set(railPos.x, y, railPos.z);
    },
    dispose() { geo.dispose(); mat.dispose(); },
  };
}

/** Black glass smelter floor with a grid of molten metal channels and crucible pools. Follows the rail. */
export function createMolten(opts = {}) {
  const size = opts.size ?? 3200;
  const geo = new THREE.PlaneGeometry(size, size, 2, 2);
  geo.rotateX(-Math.PI / 2);
  const mat = new THREE.ShaderMaterial({
    vertexShader: LAVA_VERT, fragmentShader: MOLTEN_FRAG, fog: true,
    uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {
      uTime: { value: 0 },
      uHot: { value: new THREE.Color(opts.hot ?? 0xffe6c0).multiplyScalar(0.95) }, uAmber: { value: new THREE.Color(opts.amber ?? 0xff7a18).multiplyScalar(0.85) },
      uGlass: { value: new THREE.Color(opts.glass ?? 0x080b14) }, uSheen: { value: new THREE.Color(opts.sheen ?? 0x22345c).multiplyScalar(1.3) },
    }]),
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  return {
    mesh, mat,
    update(time, railPos, y) {
      mat.uniforms.uTime.value = time;
      mesh.position.set(railPos.x, y, railPos.z);
    },
    dispose() { geo.dispose(); mat.dispose(); },
  };
}
