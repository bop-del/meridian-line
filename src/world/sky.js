// Sky dome (gradient, sun, stars, nebula), planets and the light rig for a level.
import * as THREE from 'three';
import { canvasTexture, Rng } from './util.js';

const NOISE_GLSL = /* glsl */ `
float hash13(vec3 p){ p = fract(p * 0.1031); p += dot(p, p.zyx + 31.32); return fract((p.x + p.y) * p.z); }
vec3 hash33(vec3 p){ p = fract(p * vec3(0.1031, 0.1030, 0.0973)); p += dot(p, p.yxz + 33.33); return fract((p.xxy + p.yxx) * p.zyx); }
float vnoise(vec3 p){
  vec3 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f);
  return mix(mix(mix(hash13(i), hash13(i+vec3(1,0,0)), f.x), mix(hash13(i+vec3(0,1,0)), hash13(i+vec3(1,1,0)), f.x), f.y),
             mix(mix(hash13(i+vec3(0,0,1)), hash13(i+vec3(1,0,1)), f.x), mix(hash13(i+vec3(0,1,1)), hash13(i+vec3(1,1,1)), f.x), f.y), f.z);
}
float fbm(vec3 p){ float a = 0.5, s = 0.0; for(int i=0;i<5;i++){ s += a*vnoise(p); p = p*2.03 + 7.1; a *= 0.5; } return s; }
`;

const SKY_VERT = /* glsl */ `
varying vec3 vDir;
void main(){
  vDir = normalize(position);
  vec4 p = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * p;
  gl_Position.z = gl_Position.w * 0.99999;
}`;

const SKY_FRAG = /* glsl */ `
uniform vec3 uTop, uMid, uHorizon, uBottom, uSunDir, uSunColor, uNebA, uNebB, uNebC, uSunDir2, uSunColor2;
uniform float uSunSize2, uHaze;
uniform float uSunSize, uSunGlow, uStars, uNebula, uTime, uFlash, uHorizonWidth, uNebScale;
varying vec3 vDir;
${NOISE_GLSL}
float starLayer(vec3 d, float scale, float density, float size){
  vec3 p = d * scale; vec3 id = floor(p); vec3 f = fract(p) - 0.5;
  vec3 r = hash33(id) - 0.5;
  float h = hash13(id + 3.7);
  float dist = length(f - r * 0.7);
  float tw = 0.75 + 0.25 * sin(uTime * (1.5 + h * 3.0) + h * 40.0);
  return step(1.0 - density, h) * smoothstep(size, 0.0, dist) * tw * (0.5 + h);
}
void main(){
  vec3 d = normalize(vDir);
  float h = d.y;
  vec3 col;
  if (h >= 0.0) {
    float t1 = pow(clamp(h / uHorizonWidth, 0.0, 1.0), 0.65);
    col = mix(uHorizon, uMid, t1);
    col = mix(col, uTop, smoothstep(uHorizonWidth, 1.0, h));
  } else {
    col = mix(uHorizon, uBottom, smoothstep(0.0, -0.45, h));
  }
  // nebula
  if (uNebula > 0.001) {
    vec3 q = d * uNebScale;
    float n1 = fbm(q + vec3(0.0, 0.0, uTime * 0.004));
    float n2 = fbm(q * 1.7 + 11.0);
    float n3 = fbm(q * 0.6 - 5.0);
    float m = smoothstep(0.38, 0.85, n1);
    vec3 nc = mix(uNebA, uNebB, smoothstep(0.3, 0.8, n2));
    nc = mix(nc, uNebC, smoothstep(0.45, 0.9, n3) * 0.7);
    col += nc * m * uNebula * (0.5 + 0.8 * n2);
    col += uNebC * pow(smoothstep(0.55, 0.95, n2 * n1 * 2.0), 2.0) * uNebula * 0.6;
  }
  // stars
  if (uStars > 0.001) {
    float s = starLayer(d, 140.0, 0.16, 0.28) + starLayer(d, 70.0, 0.10, 0.22) * 1.4 + starLayer(d, 320.0, 0.25, 0.3) * 0.6;
    float vis = uStars * smoothstep(-0.05, 0.1, h + 0.3);
    col += vec3(0.85, 0.9, 1.0) * s * vis * 1.6;
  }
  // sun
  float sd = max(dot(d, uSunDir), 0.0);
  float disc = smoothstep(cos(uSunSize), cos(uSunSize * 0.92), sd);
  float glow = pow(sd, 6.0) * 0.28 + pow(sd, 48.0) * 0.55 + pow(sd, 700.0) * 1.2;
  col += uSunColor * (disc * 3.0 + glow * uSunGlow);
  if (uSunSize2 > 0.0) {
    float sd2 = max(dot(d, uSunDir2), 0.0);
    float disc2 = smoothstep(cos(uSunSize2), cos(uSunSize2 * 0.92), sd2);
    float glow2 = pow(sd2, 6.0) * 0.22 + pow(sd2, 40.0) * 0.5 + pow(sd2, 600.0) * 1.0;
    col += uSunColor2 * (disc2 * 3.0 + glow2 * uSunGlow);
  }
  // horizon haze band (sea mist glow)
  col += uSunColor * uHaze * exp(-abs(h) * 9.0) * (0.35 + 0.65 * pow(sd, 3.0));
  col += vec3(1.0, 0.95, 0.9) * uFlash * (0.4 + 0.6 * vnoise(d * 6.0 + uTime));
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

export class Sky {
  constructor() {
    const mat = new THREE.ShaderMaterial({
      vertexShader: SKY_VERT, fragmentShader: SKY_FRAG,
      side: THREE.BackSide, depthWrite: false, depthTest: false, fog: false,
      uniforms: {
        uTop: { value: new THREE.Color(0x2f6fd6) }, uMid: { value: new THREE.Color(0x66a8ee) },
        uHorizon: { value: new THREE.Color(0xcfe6f7) }, uBottom: { value: new THREE.Color(0x9fc4e0) },
        uSunDir: { value: new THREE.Vector3(0.5, 0.6, -0.6).normalize() }, uSunColor: { value: new THREE.Color(0xfff2d0) },
        uSunSize: { value: 0.03 }, uSunGlow: { value: 1 }, uStars: { value: 0 }, uNebula: { value: 0 }, uNebScale: { value: 2.2 },
        uNebA: { value: new THREE.Color(0x6020a0) }, uNebB: { value: new THREE.Color(0x1050b0) }, uNebC: { value: new THREE.Color(0xe04080) },
        uTime: { value: 0 }, uFlash: { value: 0 }, uHorizonWidth: { value: 0.35 },
        uSunDir2: { value: new THREE.Vector3(0.2, 0.2, -1).normalize() }, uSunColor2: { value: new THREE.Color(0xffffff) }, uSunSize2: { value: 0 }, uHaze: { value: 0 },
      },
    });
    this.mesh = new THREE.Mesh(new THREE.SphereGeometry(1500, 40, 24), mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = -1000;
    this.uniforms = mat.uniforms;
    this.group = new THREE.Group();
    this.group.add(this.mesh);
    this.planets = [];
  }

  configure(cfg) {
    const u = this.uniforms;
    for (const k of ['top', 'mid', 'horizon', 'bottom', 'sunColor', 'nebA', 'nebB', 'nebC']) {
      if (cfg[k] !== undefined) u['u' + k[0].toUpperCase() + k.slice(1)].value.set(cfg[k]);
    }
    if (cfg.sunDir) u.uSunDir.value.copy(cfg.sunDir).normalize();
    if (cfg.sunDir2) u.uSunDir2.value.copy(cfg.sunDir2).normalize();
    if (cfg.sunColor2 !== undefined) u.uSunColor2.value.set(cfg.sunColor2);
    if (cfg.sunSize2 !== undefined) u.uSunSize2.value = cfg.sunSize2;
    if (cfg.haze !== undefined) u.uHaze.value = cfg.haze;
    if (cfg.sunSize !== undefined) u.uSunSize.value = cfg.sunSize;
    if (cfg.sunGlow !== undefined) u.uSunGlow.value = cfg.sunGlow;
    if (cfg.stars !== undefined) u.uStars.value = cfg.stars;
    if (cfg.nebula !== undefined) u.uNebula.value = cfg.nebula;
    if (cfg.nebScale !== undefined) u.uNebScale.value = cfg.nebScale;
    if (cfg.horizonWidth !== undefined) u.uHorizonWidth.value = cfg.horizonWidth;
  }

  addPlanet(opts) {
    const p = createPlanet(opts);
    this.group.add(p.group);
    this.planets.push(p);
    return p;
  }

  /** a free standing dust ring (no planet), drawn as a thin ellipse in the sky */
  addRing(opts) {
    const p = createSkyRing(opts);
    this.group.add(p.group);
    this.planets.push(p);
    return p;
  }

  update(dt, camera, time) {
    this.uniforms.uTime.value = time;
    this.group.position.copy(camera.position);
    for (const p of this.planets) p.update(dt, time);
  }

  dispose() {
    this.mesh.geometry.dispose(); this.mesh.material.dispose();
    for (const p of this.planets) p.dispose();
  }
}

// ---------------------------------------------------------------- planets
const PLANET_VERT = /* glsl */ `
varying vec3 vN; varying vec3 vP; varying vec3 vView;
void main(){
  vP = position;
  vN = normalize(mat3(modelMatrix) * normal);
  vec4 w = modelMatrix * vec4(position, 1.0);
  vView = normalize(cameraPosition - w.xyz);
  gl_Position = projectionMatrix * viewMatrix * w;
}`;
const PLANET_FRAG = /* glsl */ `
uniform vec3 uA, uB, uC, uSun, uAtmo; uniform float uBands, uNoise, uTime, uSeed, uCloud;
varying vec3 vN; varying vec3 vP; varying vec3 vView;
${NOISE_GLSL}
void main(){
  vec3 p = normalize(vP);
  float band = sin(p.y * uBands + fbm(p * 3.0 + uSeed) * uNoise) * 0.5 + 0.5;
  float n = fbm(p * 4.0 + uSeed * 3.0);
  vec3 col = mix(uA, uB, band);
  col = mix(col, uC, smoothstep(0.45, 0.8, n) * 0.7);
  float cl = smoothstep(0.55, 0.85, fbm(p * 7.0 + uSeed + uTime * 0.01)) * uCloud;
  col = mix(col, vec3(1.0), cl);
  float ndl = dot(normalize(vN), uSun);
  float lit = smoothstep(-0.15, 0.55, ndl);
  col *= 0.05 + lit * 1.05;
  float rim = pow(1.0 - max(dot(normalize(vN), normalize(vView)), 0.0), 3.0);
  col += uAtmo * rim * (0.25 + 0.9 * lit);
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

function createPlanet({ radius = 300, dir = new THREE.Vector3(0.4, 0.2, -1), distance = 1350, colors = [0xc98d5a, 0x8a5a3a, 0xf0d0a0], atmo = 0x88aaff, bands = 8, noise = 3, ring = null, sun = new THREE.Vector3(0.6, 0.4, 0.5), cloud = 0, seed = 1, spin = 0.0 }) {
  const group = new THREE.Group();
  const mat = new THREE.ShaderMaterial({
    vertexShader: PLANET_VERT, fragmentShader: PLANET_FRAG, fog: false,
    uniforms: {
      uA: { value: new THREE.Color(colors[0]) }, uB: { value: new THREE.Color(colors[1]) }, uC: { value: new THREE.Color(colors[2]) },
      uSun: { value: sun.clone().normalize() }, uAtmo: { value: new THREE.Color(atmo) }, uBands: { value: bands }, uNoise: { value: noise },
      uTime: { value: 0 }, uSeed: { value: seed }, uCloud: { value: cloud },
    },
  });
  const sphere = new THREE.Mesh(new THREE.SphereGeometry(radius, 48, 32), mat);
  sphere.renderOrder = -900;
  group.add(sphere);
  let ringMesh = null;
  if (ring) {
    const tex = canvasTexture(256, 8, (g, w, h) => {
      const r = new Rng(seed + 5);
      for (let x = 0; x < w; x++) {
        const t = x / w;
        const a = Math.max(0, Math.sin(t * Math.PI)) * (0.35 + 0.65 * r.r()) * (t > 0.42 && t < 0.47 ? 0.05 : 1);
        g.fillStyle = `rgba(${ring.rgb ?? '220,200,170'},${a.toFixed(3)})`;
        g.fillRect(x, 0, 1, h);
      }
    });
    const r0 = radius * (ring.inner ?? 1.35), r1 = radius * (ring.outer ?? 2.3);
    const rg = new THREE.RingGeometry(r0, r1, 96, 1);
    const pos = rg.attributes.position, uv = rg.attributes.uv;
    for (let i = 0; i < pos.count; i++) {
      const r = Math.hypot(pos.getX(i), pos.getY(i));
      uv.setXY(i, (r - r0) / (r1 - r0), 0.5);
    }
    ringMesh = new THREE.Mesh(rg, new THREE.MeshBasicMaterial({ map: tex, transparent: true, side: THREE.DoubleSide, depthWrite: false, fog: false }));
    ringMesh.rotation.x = Math.PI / 2 - (ring.tilt ?? 0.35);
    ringMesh.rotation.y = ring.roll ?? 0.2;
    ringMesh.renderOrder = -899;
    group.add(ringMesh);
  }
  group.position.copy(dir).normalize().multiplyScalar(distance);
  return {
    group, mesh: sphere,
    update(dt, time) { mat.uniforms.uTime.value = time; sphere.rotation.y += spin * dt; },
    dispose() { sphere.geometry.dispose(); mat.dispose(); if (ringMesh) { ringMesh.geometry.dispose(); ringMesh.material.map.dispose(); ringMesh.material.dispose(); } },
  };
}

function createSkyRing({ dir = new THREE.Vector3(0.1, 0.25, -1), distance = 1300, inner = 600, outer = 1100, tilt = 1.3, roll = 0.15, rgb = '255,150,70', seed = 4, opacity = 0.9, spin = 0.0015 }) {
  const group = new THREE.Group();
  const tex = canvasTexture(512, 8, (g, w, h) => {
    const r = new Rng(seed);
    let v = 0.5;
    for (let x = 0; x < w; x++) {
      const t = x / w;
      v += (r.r() - 0.5) * 0.28; v = Math.min(1, Math.max(0.1, v));
      const env = Math.pow(Math.max(0, Math.sin(t * Math.PI)), 0.8);
      const gap = (t > 0.55 && t < 0.6) || (t > 0.83 && t < 0.85) ? 0.06 : 1;
      g.fillStyle = `rgba(${rgb},${(env * v * gap).toFixed(3)})`;
      g.fillRect(x, 0, 1, h);
    }
  });
  const rg = new THREE.RingGeometry(inner, outer, 128, 1);
  const pos = rg.attributes.position, uv = rg.attributes.uv;
  for (let i = 0; i < pos.count; i++) uv.setXY(i, (Math.hypot(pos.getX(i), pos.getY(i)) - inner) / (outer - inner), 0.5);
  const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, opacity, side: THREE.DoubleSide, depthWrite: false, depthTest: false, fog: false, blending: THREE.AdditiveBlending, toneMapped: false });
  const mesh = new THREE.Mesh(rg, mat);
  mesh.rotation.x = Math.PI / 2 - tilt;
  mesh.rotation.y = roll;
  mesh.renderOrder = -899;
  const holder = new THREE.Group();
  holder.add(mesh);
  group.add(holder);
  group.position.copy(dir).normalize().multiplyScalar(distance);
  return {
    group, mesh,
    update(dt) { holder.rotation.y += spin * dt; },
    dispose() { rg.dispose(); tex.dispose(); mat.dispose(); },
  };
}

// ---------------------------------------------------------------- light rig
export class LightRig {
  constructor(scene) {
    this.group = new THREE.Group();
    this.hemi = new THREE.HemisphereLight(0xffffff, 0x444444, 1);
    this.sun = new THREE.DirectionalLight(0xffffff, 2);
    this.rim = new THREE.DirectionalLight(0xffffff, 0.8);
    this.group.add(this.hemi, this.sun, this.sun.target, this.rim, this.rim.target);
    scene.add(this.group);
  }
  configure({ sunColor = 0xffffff, sunIntensity = 2, sunDir = new THREE.Vector3(0.5, 0.8, 0.4), skyColor = 0xbfd8ff, groundColor = 0x445566, hemiIntensity = 1, rimColor = 0x88aaff, rimIntensity = 0.8, rimDir = new THREE.Vector3(-0.4, 0.2, -1) }) {
    this.sun.color.set(sunColor); this.sun.intensity = sunIntensity;
    this.sun.position.copy(sunDir).normalize().multiplyScalar(100);
    this.hemi.color.set(skyColor); this.hemi.groundColor.set(groundColor); this.hemi.intensity = hemiIntensity;
    this.rim.color.set(rimColor); this.rim.intensity = rimIntensity;
    this.rim.position.copy(rimDir).normalize().multiplyScalar(100);
  }
  dispose(scene) { scene.remove(this.group); this.hemi.dispose?.(); this.sun.dispose?.(); this.rim.dispose?.(); }
}
