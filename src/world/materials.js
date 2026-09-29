// Shared, cached materials and textures used by obstacles and level scenery. Everything goes through `res`
// (a per level resource cache that is disposed on level unload).
import * as THREE from 'three';
import { canvasTexture, Rng } from './util.js';

export class Resources {
  constructor() { this.map = new Map(); this.list = []; }
  get(key, factory) {
    let v = this.map.get(key);
    if (!v) { v = factory(); this.map.set(key, v); this.list.push(v); }
    return v;
  }
  own(x) { this.list.push(x); return x; }
  dispose() {
    for (const v of this.list) {
      if (!v) continue;
      if (Array.isArray(v)) { v.forEach((g) => g?.dispose?.()); continue; }
      v.dispose?.();
    }
    this.map.clear(); this.list.length = 0;
  }
}

export function panelTextures(res, key = 'panel') {
  return res.get(key + 'Tex', () => {
    // black volcanic glass plates: faceted dark blue-black tones, thin cold seams, sparse molten veins
    const draw = (emissive) => (g, w, h) => {
      const r = new Rng(11);
      g.fillStyle = emissive ? '#000' : '#070a12'; g.fillRect(0, 0, w, h);
      if (!emissive) {
        for (let i = 0; i < 46; i++) {
          const x = r.r() * w, y = r.r() * h, pw = 12 + r.r() * 46, ph = 10 + r.r() * 38, v = r.r();
          g.fillStyle = `rgba(${16 + v * 26},${22 + v * 34},${40 + v * 56},0.8)`;
          g.beginPath(); g.moveTo(x, y); g.lineTo(x + pw, y + ph * 0.2 * (v - 0.5)); g.lineTo(x + pw * 0.85, y + ph); g.lineTo(x + pw * 0.05, y + ph * 0.9); g.closePath(); g.fill();
        }
        g.strokeStyle = '#02030a'; g.lineWidth = 3;
        g.strokeRect(1, 1, w - 2, h - 2);
        g.beginPath(); g.moveTo(w * 0.5, 0); g.lineTo(w * 0.5, h); g.moveTo(0, h * 0.62); g.lineTo(w, h * 0.62); g.stroke();
        g.strokeStyle = 'rgba(120,160,220,0.22)'; g.lineWidth = 1;
        g.beginPath(); g.moveTo(4, 6); g.lineTo(w - 8, 30); g.moveTo(20, h - 6); g.lineTo(w * 0.7, h * 0.66); g.stroke();
      } else {
        g.fillStyle = 'rgba(70,130,220,0.5)'; g.fillRect(0, 0, w, 1.5); g.fillRect(0, h * 0.62 - 1, w, 1.5); g.fillRect(w / 2 - 1, 0, 1.5, h);
        // a jagged molten vein
        g.strokeStyle = 'rgba(255,140,50,0.62)'; g.lineWidth = 1.6; g.beginPath();
        let x = 8, y = h * 0.86; g.moveTo(x, y);
        for (let i = 0; i < 8; i++) { x += 12 + r.r() * 8; y += (r.r() - 0.5) * 14; g.lineTo(x, y); }
        g.stroke();
        g.fillStyle = '#a8d8ff';
        for (let i = 0; i < 3; i++) if (r.r() < 0.5) g.fillRect(10 + r.r() * (w - 30), 12 + r.r() * 40, 5 + r.r() * 9, 2);
        g.fillStyle = '#ffb060';
        g.fillRect(w * 0.25, h * 0.45, 3, 3);
      }
    };
    return [canvasTexture(128, 128, draw(false), { repeat: true }), canvasTexture(128, 128, draw(true), { repeat: true })];
  });
}

/**
 * Bioluminescent coral: flat shaded vertex colours, glowing cyan veins (ridges of a 3D noise field, per instance
 * brightness) and, on unit height spires, a soft glow toward the tips.
 */
export function coralMaterial(res, { tip = 0.55, heat = 0.9, freq = 1 } = {}) {
  const key = `${tip}_${heat}_${freq}`;
  return res.get('coralMat' + key, () => {
    const m = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.78, metalness: 0.02, emissive: 0x241018, emissiveIntensity: 0.5 });
    m.onBeforeCompile = (sh) => injectCracks(sh, { heat, freq, veinA: [0.05, 0.78, 0.72], veinB: [0.62, 1.0, 0.92], core: 1.15, halo: 0.2, tip, tipColor: [0.3, 0.95, 0.85] });
    m.customProgramCacheKey = () => 'coralBio' + key;
    return m;
  });
}

export function rockMaterial(res, variant = 'grey') {
  return res.get('rockMat_' + variant, () => {
    const c = { grey: 0xffffff, rust: 0xffc8a8, ice: 0xbcd8ff, sand: 0xffffff, dark: 0x9a9aa8 }[variant] ?? 0xffffff;
    return new THREE.MeshStandardMaterial({ color: c, vertexColors: true, flatShading: true, roughness: 0.95, metalness: 0.02 });
  });
}

/**
 * Adds glowing ember cracks to a standard material. Cracks are ridges of a 3D noise field sampled in object space,
 * so they stay crisp at any size. Instanced meshes get a per instance heat (some pieces are nearly cold).
 */
export function injectCracks(sh, { heat = 1, veinA = [1.0, 0.22, 0.04], veinB = [1.0, 0.78, 0.36], core = 1.7, halo = 0.22, freq = 1, tip = 0, tipColor = [0.3, 0.95, 0.85] } = {}) {
  sh.uniforms.uHeat = { value: heat };
  const f3 = (v) => `vec3(${v.map((x) => x.toFixed(3)).join(',')})`;
  sh.vertexShader = sh.vertexShader
    .replace('#include <common>', `#include <common>
varying vec3 vLoc; varying float vHot; varying float vUnitY;`)
    .replace('#include <begin_vertex>', `#include <begin_vertex>
vLoc = position; vHot = 1.0; vUnitY = position.y;
#ifdef USE_INSTANCING
  float ish = fract(sin(dot(instanceMatrix[3].xyz, vec3(12.9898, 78.233, 45.164))) * 43758.5453);
  vLoc += ish * 17.0; vHot = 0.06 + 0.94 * pow(smoothstep(0.2, 0.95, fract(ish * 7.7)), 1.6);
#endif`);
  sh.fragmentShader = sh.fragmentShader
    .replace('#include <common>', `#include <common>
varying vec3 vLoc; varying float vHot; varying float vUnitY; uniform float uHeat;
float ch3(vec3 p){ p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float cn3(vec3 x){ vec3 i = floor(x), f = fract(x); f = f*f*(3.0-2.0*f);
  return mix(mix(mix(ch3(i), ch3(i+vec3(1,0,0)), f.x), mix(ch3(i+vec3(0,1,0)), ch3(i+vec3(1,1,0)), f.x), f.y),
             mix(mix(ch3(i+vec3(0,0,1)), ch3(i+vec3(1,0,1)), f.x), mix(ch3(i+vec3(0,1,1)), ch3(i+vec3(1,1,1)), f.x), f.y), f.z); }`)
    .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
{
  float cnv = cn3(vLoc * ${(2.1 * freq).toFixed(3)}) * 0.62 + cn3(vLoc * ${(4.9 * freq).toFixed(3)}) * 0.38;
  float d = abs(cnv - 0.5);
  float core = 1.0 - smoothstep(0.0, 0.026, d);
  float halo = 1.0 - smoothstep(0.0, 0.09, d);
  vec3 ember = mix(${f3(veinA)}, ${f3(veinB)}, core);
  totalEmissiveRadiance += ember * (core * ${core.toFixed(3)} + halo * ${halo.toFixed(3)}) * vHot * uHeat;
  ${tip > 0 ? `totalEmissiveRadiance += ${f3(tipColor)} * smoothstep(0.55, 1.0, vUnitY) * ${tip.toFixed(3)} * (0.4 + 0.6 * vHot);` : ''}
}`);
}

/** Charred wreckage material with glowing cracks. */
export function debrisMaterial(res, variant = 'ember') {
  return res.get('debrisMat_' + variant, () => {
    const heat = { ember: 1, ash: 0.45, hot: 1.5, tunnel: 0.6 }[variant] ?? 1;
    const m = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.9, metalness: 0.12 });
    m.onBeforeCompile = (sh) => injectCracks(sh, { heat });
    m.customProgramCacheKey = () => 'debris' + variant;
    return m;
  });
}

/** Black glass with cold seams and molten veins. */
export function metalMaterial(res) {
  return res.get('metalMat', () => {
    const [map, em] = panelTextures(res);
    return new THREE.MeshStandardMaterial({ map, color: 0xffffff, metalness: 0.7, roughness: 0.22, emissive: 0xffffff, emissiveMap: em, emissiveIntensity: 0.95 });
  });
}

/**
 * Black glass metal with per instance motion driven by the shared uTime uniform.
 * mode 'spin': rotates about the local z axis, slower for bigger instances, direction from instanceColor.r (>0.9 is clockwise).
 * mode 'slide': ram that slides out and in along local +x.
 */
export function motionMetal(res, mode, uTime, { amp = 9, speed = 0.4 } = {}) {
  return res.get('motionMetal_' + mode, () => {
    const [map, em] = panelTextures(res);
    const m = new THREE.MeshStandardMaterial({ map, color: 0xffffff, metalness: 0.75, roughness: 0.32, emissive: 0xffffff, emissiveMap: em, emissiveIntensity: 1.2 });
    m.onBeforeCompile = (sh) => {
      sh.uniforms.uTime = uTime;
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nuniform float uTime;');
      if (mode === 'spin') {
        sh.vertexShader = sh.vertexShader
          .replace('#include <beginnormal_vertex>', `#include <beginnormal_vertex>
float gDir = instanceColor.r > 0.9 ? 1.0 : -1.0;
float gAng = uTime * gDir * (${(speed * 30).toFixed(2)} / max(length(instanceMatrix[0].xyz), 0.001));
mat2 gR = mat2(cos(gAng), sin(gAng), -sin(gAng), cos(gAng));
objectNormal.xy = gR * objectNormal.xy;`)
          .replace('#include <begin_vertex>', `#include <begin_vertex>
transformed.xy = gR * transformed.xy;`);
      } else {
        sh.vertexShader = sh.vertexShader
          .replace('#include <begin_vertex>', `#include <begin_vertex>
float sPh = fract(sin(dot(instanceMatrix[3].xyz, vec3(12.9898, 78.233, 45.164))) * 43758.5453) * 6.283;
transformed.x += ${amp.toFixed(2)} * (0.5 + 0.5 * sin(uTime * ${speed.toFixed(2)} + sPh));`);
      }
    };
    m.customProgramCacheKey = () => 'motionMetal_' + mode;
    return m;
  });
}

export function glowMaterial(res, color = 0x9ad0ff, mult = 2.2) {
  return res.get('glow_' + color.toString(16), () => new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(mult), toneMapped: false }));
}

export function additiveMaterial(res, color = 0x7ab8ff, opacity = 0.35) {
  return res.get('add_' + color.toString(16) + opacity, () => new THREE.MeshBasicMaterial({ color, transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }));
}
