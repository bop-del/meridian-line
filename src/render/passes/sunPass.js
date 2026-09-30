// Sun pass: screen space light shafts and lens flare at low resolution, plus the sun visibility and the mean frame luminance.
// Draws only into its own small targets and never touches the composer buffers (needsSwap false); the grade pass adds shaftTexture.
//   1. mask   (half or a third of the resolution, when shafts or flare are on): bright sky pixels near a sun, rgb = light that may
//             cast shafts, a = 1 where the depth buffer is empty (open sky), so anything drawn in front of the sun occludes it.
//   2. vis    (4 x 1, always): per sun, the open sky fraction in a small disc around the sun (hides the flare when the sun is
//             covered), and the mean frame luminance (the white-out guard), smoothed over a few frames. Pixel centres u 0.125, 0.375, 0.625.
//   3. light  (mask resolution): radial blur of the mask toward each sun (shafts, tier flag shafts) plus the lens flare ghosts, halo
//             and streak (tier flag flare), both already scaled by their strengths. Soft, low frequency light, so a low resolution
//             target is enough, and the flare costs nothing per full resolution pixel.
// Suns come from the renderer each frame: uSun0/1 = (u, v, weight), weight 0..1 for facing and on screen; uFlareCol0/1 flare colours.
import * as THREE from 'three';
import { Pass, FullScreenQuad } from 'three/addons/postprocessing/Pass.js';

const VERT = /* glsl */ `
  varying vec2 vUv;
  void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;

const SUN_UNIFORMS = () => ({
  uSun0: { value: new THREE.Vector3() }, uSun1: { value: new THREE.Vector3() }, uAspect: { value: 1.78 },
});

const MASK_FRAG = /* glsl */ `
  uniform sampler2D tColor, tDepth;
  uniform vec3 uSun0, uSun1;
  uniform float uAspect, uThr;
  uniform vec2 uTexel;
  varying vec2 vUv;
  float near(vec3 s) {
    if (s.z < 0.001) return 0.0;
    vec2 d = (vUv - s.xy) * vec2(uAspect, 1.0);
    return s.z * smoothstep(0.6, 0.0, length(d));
  }
  void main() {
    // 2 x 2 depth taps: a pixel is sky only when all taps are open, so thin occluders still cut the shafts
    float sky = 1.0;
    for (int i = 0; i < 4; i++) {
      vec2 o = (vec2(float(i - (i / 2) * 2), float(i / 2)) - 0.5) * uTexel;
      sky *= step(0.9999995, texture2D(tDepth, vUv + o).x);
    }
    vec3 c = texture2D(tColor, vUv).rgb;
    if (any(isnan(c)) || any(isinf(c))) c = vec3(0.0);
    c = clamp(c, vec3(0.0), vec3(16.0));
    float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
    float k = max(l - uThr, 0.0) / max(l, 1e-4);
    float w = sky * k * max(near(uSun0), near(uSun1));
    gl_FragColor = vec4(min(c * w, vec3(8.0)), sky);
  }`;

const LIGHT_FRAG = /* glsl */ `
  uniform sampler2D tMask, tVis;
  uniform vec3 uSun0, uSun1, uFlareCol0, uFlareCol1;
  uniform vec2 uReticle;
  uniform float uAspect, uLength, uSamples, uTime, uShafts, uFlare, uFlareStreak, uClear;
  varying vec2 vUv;
  float hash(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
  vec3 march(vec3 s) {
    if (s.z < 0.001) return vec3(0.0);
    vec2 delta = (vUv - s.xy) * uLength / uSamples;
    vec2 p = vUv - delta * hash(vUv * 731.3 + fract(uTime * 7.1));
    vec3 acc = vec3(0.0);
    float decay = 1.0, wsum = 0.0;
    for (int i = 0; i < 40; i++) {
      if (float(i) >= uSamples) break;
      p -= delta;
      vec2 q = clamp(p, vec2(0.001), vec2(0.999));
      acc += texture2D(tMask, q).rgb * decay;
      wsum += decay;
      decay *= 0.965;
    }
    return acc / max(wsum, 1e-3) * s.z;
  }
  float disc(vec2 c, float r) {
    float d = length((vUv - c) * vec2(uAspect, 1.0));
    return smoothstep(r, r * 0.5, d) * (0.55 + 0.45 * smoothstep(r * 0.3, r * 0.95, d));
  }
  vec3 flare(vec3 s, vec3 col, float vis) {
    float w = s.z * vis;
    if (w < 0.002) return vec3(0.0);
    vec2 toC = vec2(0.5) - s.xy;
    // ghosts line up through the screen centre; they fade out when the sun is near the centre, where they would stack
    float gf = smoothstep(0.05, 0.28, length(toC * vec2(uAspect, 1.0)));
    vec3 g = vec3(0.0);
    g += disc(s.xy + toC * 0.55, 0.035) * vec3(1.0, 0.62, 0.32) * 0.4;
    g += disc(s.xy + toC * 1.3, 0.07) * vec3(0.35, 0.8, 1.0) * 0.22;
    g += disc(s.xy + toC * 1.55, 0.022) * vec3(0.8, 1.0, 0.55) * 0.45;
    g += disc(s.xy + toC * 1.95, 0.12) * vec3(0.9, 0.45, 0.75) * 0.12;
    g += disc(s.xy + toC * 2.3, 0.05) * vec3(0.45, 0.65, 1.0) * 0.25;
    g *= gf;
    vec2 ds = (vUv - s.xy) * vec2(uAspect, 1.0);
    float streak = exp(-abs(ds.y) * 160.0) * exp(-abs(ds.x) * 2.6) * uFlareStreak * 0.6;
    float hr = (length(ds) - 0.2) * 22.0;
    float halo = exp(-hr * hr) * 0.08 * gf;
    return (g + vec3(streak + halo)) * col * w;
  }
  void main() {
    vec3 r = vec3(0.0);
    if (uShafts > 0.001) r += (march(uSun0) + march(uSun1)) * uShafts;
    if (uFlare > 0.001) {
      vec3 fl = flare(uSun0, uFlareCol0, texture2D(tVis, vec2(0.125, 0.5)).r) + flare(uSun1, uFlareCol1, texture2D(tVis, vec2(0.375, 0.5)).r);
      // never over the reticle
      float keep = smoothstep(uClear * 0.45, uClear, length((vUv - uReticle) * vec2(uAspect, 1.0)));
      r += fl * uFlare * keep;
    }
    if (any(isnan(r)) || any(isinf(r))) r = vec3(0.0);
    gl_FragColor = vec4(clamp(r, vec3(0.0), vec3(6.0)), 1.0);
  }`;

const VIS_FRAG = /* glsl */ `
  uniform sampler2D tMask, tPrev, tColor, tBloom;
  uniform vec3 uSun0, uSun1;
  uniform float uAspect, uBlend, uRad, uFlareOn, uLumUp, uLumDown, uBloomOn;
  varying vec2 vUv;
  float vis(vec3 s) {
    if (s.z < 0.001 || uFlareOn < 0.5) return 0.0;
    float acc = 0.0;
    for (int i = 0; i < 12; i++) {
      float fi = float(i) + 0.5;
      float r = sqrt(fi / 12.0) * uRad;
      float a = fi * 2.39996;
      vec2 uv = s.xy + vec2(cos(a) / uAspect, sin(a)) * r;
      float inside = step(0.0, uv.x) * step(uv.x, 1.0) * step(0.0, uv.y) * step(uv.y, 1.0);
      acc += texture2D(tMask, uv).a * inside;
    }
    return acc / 12.0;
  }
  // mean HDR luminance of the frame including the glow (8 x 8 sparse grid, each sample clamped), for the white-out guard in the grade pass
  float meanLum() {
    float acc = 0.0;
    for (int y = 0; y < 8; y++) for (int x = 0; x < 8; x++) {
      vec2 uv = (vec2(float(x), float(y)) + 0.5) / 8.0;
      vec3 c = texture2D(tColor, uv).rgb;
      if (uBloomOn > 0.5) c += texture2D(tBloom, uv).rgb;
      if (any(isnan(c)) || any(isinf(c))) c = vec3(0.0);
      acc += min(dot(c, vec3(0.2126, 0.7152, 0.0722)), 16.0);
    }
    return acc / 64.0;
  }
  void main() {
    float prev = texture2D(tPrev, vUv).r;
    if (prev != prev) prev = 0.0;
    float v, b = uBlend;
    if (vUv.x < 0.25) v = vis(uSun0);
    else if (vUv.x < 0.5) v = vis(uSun1);
    else { v = meanLum(); b = v > prev ? uLumUp : uLumDown; }
    gl_FragColor = vec4(vec3(mix(prev, v, b)), 1.0);
  }`;

const rt = (w, h, filter = THREE.LinearFilter) => new THREE.WebGLRenderTarget(w, h, { type: THREE.HalfFloatType, depthBuffer: false, stencilBuffer: false, minFilter: filter, magFilter: filter });

export class SunPass extends Pass {
  constructor() {
    super();
    this.needsSwap = false;
    this.tDepth = null;
    this.shaftsOn = 0; this.flareOn = 0; this.shafts = 0; this.flare = 0; this.scale = 0.5; // 0.5: half resolution (shafts tier 1), 0.33 (tier 0.5) this._w = 2; this._h = 2;
    this.maskRT = rt(2, 2); this.shaftRT = rt(2, 2);
    this.visA = rt(4, 1, THREE.NearestFilter); this.visB = rt(4, 1, THREE.NearestFilter);
    const common = SUN_UNIFORMS();
    this.mask = new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader: MASK_FRAG, depthTest: false, depthWrite: false,
      uniforms: { ...common, tColor: { value: null }, tDepth: { value: null }, uThr: { value: 0.8 }, uTexel: { value: new THREE.Vector2(1, 1) } } });
    this.shaft = new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader: LIGHT_FRAG, depthTest: false, depthWrite: false,
      uniforms: { ...common, tMask: { value: this.maskRT.texture }, tVis: { value: this.visA.texture }, uLength: { value: 0.7 }, uSamples: { value: 24 }, uTime: { value: 0 },
        uShafts: { value: 0 }, uFlare: { value: 0 }, uFlareStreak: { value: 0.6 }, uClear: { value: 0.14 }, uReticle: { value: new THREE.Vector2(0.5, 0.5) },
        uFlareCol0: { value: new THREE.Color(0, 0, 0) }, uFlareCol1: { value: new THREE.Color(0, 0, 0) } } });
    this.vis = new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader: VIS_FRAG, depthTest: false, depthWrite: false,
      uniforms: { ...common, tMask: { value: this.maskRT.texture }, tPrev: { value: this.visB.texture }, tColor: { value: null }, uBlend: { value: 0.35 }, uRad: { value: 0.025 },
        uFlareOn: { value: 0 }, uLumUp: { value: 0.3 }, uLumDown: { value: 0.06 }, tBloom: { value: null }, uBloomOn: { value: 0 } } });
    this.quad = new FullScreenQuad(null);
    this.sunUniforms = common;
    this.bloom = null; // the bloom pass (runs before this pass), its glow counts toward the mean luminance
    this.visUniform = null; // the grade pass uniform that samples the visibility, updated after each ping pong
  }

  /** visibility texture written this frame (r: sun 0 at u 0.125, sun 1 at u 0.375, mean luminance at u 0.625) */
  get visTexture() { return this.visA.texture; }
  /** shafts plus flare of this frame, HDR, to add in the grade pass (valid when shaftsOn or flareOn) */
  get shaftTexture() { return this.shaftRT.texture; }

  setScale(s) {
    s = s >= 1 ? 0.5 : 0.33;
    if (s === this.scale) return;
    this.scale = s; this.setSize(this._w, this._h);
  }

  setSize(w, h) {
    this._w = w; this._h = h;
    const sw = Math.max(8, Math.round(w * this.scale)), sh = Math.max(8, Math.round(h * this.scale));
    this.maskRT.setSize(sw, sh); this.shaftRT.setSize(sw, sh);
    this.mask.uniforms.uTexel.value.set(0.5 / sw, 0.5 / sh);
    this.sunUniforms.uAspect.value = w / Math.max(1, h);
  }

  render(renderer, writeBuffer, readBuffer) {
    const old = renderer.autoClear; renderer.autoClear = false;
    const light = this.shaftsOn || this.flareOn;
    if (light) {
      this.mask.uniforms.tColor.value = readBuffer.texture;
      this.mask.uniforms.tDepth.value = this.tDepth;
      this.quad.material = this.mask;
      renderer.setRenderTarget(this.maskRT); this.quad.render(renderer);
    }
    // ping pong the 4 x 1 visibility and luminance so they ease over a few frames (always on: the white-out guard needs it)
    const t = this.visA; this.visA = this.visB; this.visB = t;
    const vu = this.vis.uniforms;
    vu.tPrev.value = this.visB.texture; vu.tColor.value = readBuffer.texture; vu.uFlareOn.value = this.flareOn ? 1 : 0;
    vu.tBloom.value = this.bloom?.enabled ? this.bloom.texture : null; vu.uBloomOn.value = this.bloom?.enabled ? 1 : 0;
    this.quad.material = this.vis;
    renderer.setRenderTarget(this.visA); this.quad.render(renderer);
    if (this.visUniform) this.visUniform.value = this.visA.texture;
    if (light) {
      const su = this.shaft.uniforms;
      su.uSamples.value = this.scale >= 0.5 ? 24 : 16;
      su.tVis.value = this.visA.texture;
      su.uShafts.value = this.shaftsOn ? this.shafts : 0; su.uFlare.value = this.flareOn ? this.flare : 0;
      this.quad.material = this.shaft;
      renderer.setRenderTarget(this.shaftRT); this.quad.render(renderer);
    }
    renderer.autoClear = old;
  }

  dispose() {
    for (const r of [this.maskRT, this.shaftRT, this.visA, this.visB]) r.dispose();
    this.mask.dispose(); this.shaft.dispose(); this.vis.dispose(); this.quad.dispose();
  }
}
