// Animated liquid planes that follow the rail: ocean (Thalassa Coast) and molten glass floor (Obsidian Foundry). World space waves, snapped to the
// vertex grid so nothing swims while the plane follows the player.
import * as THREE from 'three';
import { SKY_UNIFORMS, SKY_LIB, makeSkyUniforms } from './sky.js';

export const SRC_MAX = 24;

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

// Ocean fragment. uDetail is render.tier.water: 2 = full (ripples, sky and cloud reflection, obstacle foam, caustics),
// 1 = fewer ripples and no cloud reflection or obstacle foam, 0 = analytic wave normals only.
// Every pow() argument is clamped to >= 0 and every division is guarded, so the shader cannot produce NaN.
const WATER_FRAG = /* glsl */ `
${SKY_UNIFORMS}
uniform vec3 uDeep, uShallow, uFoam;
uniform float uRipple, uReflect, uGlint, uFoamAmt, uShore, uCaustic, uCrest, uHorizonFog;
uniform vec4 uSrc[${SRC_MAX * 2}];
varying vec3 vWorld; varying float vH;
${SKY_LIB}
#include <fog_pars_fragment>
// height, d/dx, d/dz of the large swell (identical to the vertex displacement)
vec3 wvg(vec2 p, float t){
  float a1 = p.x*0.045 + t*0.9, a2 = p.y*0.037 - t*0.7 + p.x*0.02, a3 = (p.x+p.y)*0.11 + t*1.6, a4 = (p.x-p.y)*0.19 - t*2.1;
  float c1 = cos(a1), c2 = cos(a2), c3 = cos(a3), c4 = cos(a4);
  return vec3(sin(a1)*1.5 + sin(a2)*1.2 + sin(a3)*0.45 + sin(a4)*0.2,
              c1*0.0675 + c2*0.024 + c3*0.0495 + c4*0.038,
              c2*0.0444 + c3*0.0495 - c4*0.038);
}
// wind ripples: a fan of sines with phase warping, each wave fades before it can alias (wavelength vs pixel footprint)
vec3 ripples(vec2 p, float t, float dist, int n){
  vec3 r = vec3(0.0);
  float kk = 0.7;
  for (int i = 0; i < 8; i++){
    if (i >= n) break;
    float fi = float(i);
    float ang = fi * 2.399 + 0.6;
    vec2 dir = vec2(cos(ang), sin(ang));
    float k = kk; kk *= 1.42;
    float ph = dot(dir, p) * k + t * (0.9 + sqrt(k) * 1.1) + skN(p * 0.035 + fi * 7.0) * 3.0;
    float fade = 1.0 - smoothstep(0.30, 0.95, k * dist * 0.0018);
    float sl = 0.085 * fade;
    r += vec3(sl / k * sin(ph), sl * cos(ph) * dir);
  }
  return r;
}
void main(){
  vec2 p = vWorld.xz;
  vec3 toCam = cameraPosition - vWorld;
  float dist = max(length(toCam), 0.001);
  vec3 V = toCam / dist;
  vec3 w = wvg(p, uTime);
  int nr = uDetail > 1.5 ? 6 : (uDetail > 0.5 ? 4 : 0);   // 6 at the full tier: the two finest waves fade out within about 20 u of the camera
  vec3 rp = nr > 0 ? ripples(p, uTime, dist, nr) : vec3(0.0);
  vec2 slope = w.yz * 0.85 + rp.yz * uRipple;
  vec3 n = normalize(vec3(-slope.x, 1.0, -slope.y));
  float geoNdv = clamp(V.y, 0.0, 1.0);
  float ndv = clamp(dot(n, V), 0.0, 1.0);
  float fres = 0.02 + 0.98 * pow(1.0 - mix(geoNdv, ndv, 0.6), 5.0);
  float refl = clamp(fres * uReflect, 0.0, 1.0);

  // obstacle foam and the pale shallows that ring every rock, spire and hull (full tier only)
  float lace = 0.5;
  if (uDetail > 0.5) lace = skN(p * 0.9 + vec2(uTime * 0.25, -uTime * 0.18)) * 0.6 + skN(p * 2.7 - vec2(uTime * 0.3, 0.0)) * 0.4;
  float foamS = 0.0, shallow = 0.0;
  if (uDetail > 1.5 && uShore > 0.0) {
    for (int i = 0; i < ${SRC_MAX}; i++) {
      vec4 A = uSrc[i * 2], B = uSrc[i * 2 + 1];
      if (B.y <= 0.0) break;
      vec2 dv = p - A.xy;
      float ax = dot(A.zw, A.zw);
      float tt = ax > 0.001 ? clamp(dot(dv, A.zw) / ax, -1.0, 1.0) : 0.0;
      float dd = length(dv - A.zw * tt) - B.x + (lace - 0.5) * 3.5;
      float wdt = 3.5 + B.x * 0.32;
      if (dd > wdt * 3.2 + 10.0) continue;
      float rings = 0.5 + 0.5 * sin(dd * 0.9 - uTime * 1.6);
      float f = (1.0 - smoothstep(0.0, wdt, dd)) * mix(1.0, 0.55 + 0.45 * rings, smoothstep(0.0, wdt * 0.6, dd));
      foamS = max(foamS, f * B.y);
      shallow = max(shallow, (1.0 - smoothstep(0.0, wdt * 3.2 + 10.0, dd)) * B.y);
    }
    foamS *= uShore; shallow = clamp(shallow * uShore, 0.0, 1.0);
  }

  // colour depth: deep teal looking straight down, pale turquoise in patches and around obstacles, sky at grazing angles
  float depthMix = clamp(0.4 + w.x * 0.09 + (skN(p * 0.012) - 0.5) * 0.9 + shallow * 0.75, 0.0, 1.0);
  vec3 body = mix(uDeep, uShallow, depthMix);
  body *= 0.7 + 0.3 * sqrt(geoNdv);
  // light through the swell: crests glow teal when the suns are behind them
  vec2 vf = normalize(-toCam.xz + vec2(1e-4));
  vec2 s1 = normalize(uSunDir.xz + vec2(1e-4));
  float back = pow(max(dot(vf, s1), 0.0), 2.0);
  if (uSunSize2 > 0.0) back = max(back, pow(max(dot(vf, normalize(uSunDir2.xz + vec2(1e-4))), 0.0), 2.0) * 0.8);
  body += uShallow * vec3(0.9, 1.2, 1.0) * smoothstep(-0.3, 2.3, w.x + rp.x * 0.6) * back * uCrest * (0.4 + 0.6 * geoNdv);

  vec3 R = reflect(-V, n); R.y = max(R.y, 0.03);
  vec3 sky = skyScatter(skyGradient(R), R);
  if (uDetail > 1.5) sky = skyClouds(sky, R, 1.0);
  sky += skySunTerms(R, 0.0, 0.45);
  vec3 col = mix(body, sky, refl);

  // sun glitter path from both suns
  float glit = 0.0;
  vec3 gc = vec3(0.0);
  {
    vec3 H = normalize(uSunDir + V);
    float ndh = clamp(dot(n, H), 0.0, 1.0);
    float g = pow(ndh, 1600.0) * 3.0 + pow(ndh, 260.0) * 0.9 + pow(ndh, 40.0) * 0.16 + pow(ndh, 8.0) * 0.03;
    gc += uSunColor * g / (1.0 + g * 0.4);
  }
  if (uSunSize2 > 0.0) {
    vec3 H = normalize(uSunDir2 + V);
    float ndh = clamp(dot(n, H), 0.0, 1.0);
    float g = pow(ndh, 1400.0) * 2.6 + pow(ndh, 220.0) * 0.8 + pow(ndh, 36.0) * 0.14 + pow(ndh, 8.0) * 0.025;
    gc += uSunColor2 * g / (1.0 + g * 0.4);
  }
  col += gc * uGlint * (0.3 + 0.7 * fres) * 3.2;

  // caustic sparkle in the shallows
  if (uDetail > 1.5 && uCaustic > 0.0 && dist < 420.0 && (shallow > 0.02 || depthMix > 0.62)) {
    vec2 cp = p * 0.3;
    float c1 = 1.0 - abs(skN(cp + vec2(uTime * 0.11, 0.0)) * 2.0 - 1.0);
    float c2 = 1.0 - abs(skN(cp * 1.9 + vec2(4.0, -uTime * 0.09)) * 2.0 - 1.0);
    float cs = pow(clamp(c1 * c2, 0.0, 1.0), 5.0);
    float sh = max(shallow, smoothstep(0.62, 0.95, depthMix) * 0.6);
    col += uSunColor * cs * sh * uCaustic * (1.0 - refl) * (1.0 - smoothstep(80.0, 420.0, dist)) * 0.9;
  }

  // foam: thin lacy whitecaps on the steepest crests plus the rings around obstacles, crisp near and calmer far
  float laceM = 0.5;
  if (uDetail > 0.5 && dist < 420.0) {
    float lace2 = skN(p * 2.4 + vec2(uTime * 0.35, -uTime * 0.22)) * 0.6 + skN(p * 5.3 - vec2(uTime * 0.4, uTime * 0.1)) * 0.4;
    laceM = mix(smoothstep(0.42, 0.6, lace2), 0.5, smoothstep(120.0, 420.0, dist));
  }
  float steep = length(w.yz);
  float cap = smoothstep(2.0, 2.9, w.x + (lace - 0.5) * 1.2 + rp.x * 1.0) * 0.8 + smoothstep(0.16, 0.22, steep) * 0.15;
  float foam = clamp(cap * laceM * uFoamAmt, 0.0, 1.0);
  foam = max(foam, foamS * (0.55 + 0.45 * laceM));
  float foamLit = 0.85 + 0.15 * back;
  col = mix(col, uFoam * foamLit, clamp(foam, 0.0, 1.0) * (1.0 - 0.35 * refl));

  gl_FragColor = vec4(max(col, vec3(0.0)), 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  // fog: fade to the sky at the horizon in that very direction (the sea meets the dome without a seam)
  vec3 hd = normalize(vec3(-toCam.x, 0.0, -toCam.z) + vec3(1e-4));
  float ff = smoothstep(fogNear, fogFar, vFogDepth);
  if (ff > 0.001) {
    vec3 hdir = normalize(vec3(hd.x, 0.02, hd.z));
    vec3 hz = skyScatter(skyGradient(hdir), hdir);
    if (uDetail > 0.5) hz = skyClouds(hz, hdir, 0.7);
    gl_FragColor.rgb = mix(gl_FragColor.rgb, mix(fogColor, hz, uHorizonFog), ff);
  }
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

/**
 * Ocean plane that follows the rail, snapped to the vertex grid so nothing swims. Pass `skyUniforms` (Sky.uniforms) so the sea
 * reflects the very same sky, clouds and suns. `applyFeel` pushes the registry, `sources` feeds foam and shallows around obstacles.
 */
export function createOcean(opts = {}) {
  const size = opts.size ?? 3600, seg = opts.seg ?? 240;
  const geo = new THREE.PlaneGeometry(size, size, seg, seg);
  geo.rotateX(-Math.PI / 2);
  const skyU = opts.skyUniforms ?? makeSkyUniforms();
  const srcArr = Array.from({ length: SRC_MAX * 2 }, () => new THREE.Vector4());
  const uniforms = THREE.UniformsUtils.merge([THREE.UniformsLib.fog]);
  Object.assign(uniforms, skyU, {
    uDeep: { value: new THREE.Color(opts.deep ?? 0x0a4a86) }, uShallow: { value: new THREE.Color(opts.shallow ?? 0x2aa5c8) },
    uFoam: { value: new THREE.Color(opts.foam ?? 0xf2fbff) },
    uRipple: { value: 1 }, uReflect: { value: 1 }, uGlint: { value: 1 }, uFoamAmt: { value: 1 }, uShore: { value: 1 }, uCaustic: { value: 1 }, uCrest: { value: 0.5 },
    uHorizonFog: { value: 0.85 }, uSrc: { value: srcArr },
  });
  const mat = new THREE.ShaderMaterial({ vertexShader: WATER_VERT, fragmentShader: WATER_FRAG, fog: true, uniforms });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  const step = size / seg;
  let nSrc = 0;
  const u = uniforms;
  return {
    mesh, mat,
    /** Foam and shallows around things standing in the water: call clearSources(), addSource() for each, then the next update uploads them. */
    clearSources() { nSrc = 0; },
    addSource(x, z, ax, az, r, strength = 1) {
      if (nSrc >= SRC_MAX) return false;
      srcArr[nSrc * 2].set(x, z, ax, az); srcArr[nSrc * 2 + 1].set(r, strength, 0, 0); nSrc++;
      return true;
    },
    get sourceCount() { return nSrc; },
    /** Registry group `sky` for one level (see src/feel/sky.js) and the water tier (0 cheap, 1, 2 full). */
    applyFeel(p, theme, detail = 2) {
      const g = (k, d) => p[theme + '_' + k] ?? d;
      u.uDeep.value.setHSL(g('deepHue', 0.5), g('deepSat', 0.8), g('deepLight', 0.1));
      u.uShallow.value.setHSL(g('shallowHue', 0.48), g('shallowSat', 0.6), g('shallowLight', 0.4));
      u.uRipple.value = g('ripple', 1); u.uReflect.value = g('reflect', 1); u.uGlint.value = g('glitter', 1);
      u.uFoamAmt.value = g('foam', 1); u.uShore.value = g('foamShore', 1); u.uCaustic.value = g('caustic', 1); u.uCrest.value = g('crestGlow', 0.5);
      u.uDetail.value = detail;
    },
    update(time, railPos, y) {
      u.uTime.value = time;
      for (let i = nSrc; i < SRC_MAX; i++) srcArr[i * 2 + 1].set(0, 0, 0, 0);
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
