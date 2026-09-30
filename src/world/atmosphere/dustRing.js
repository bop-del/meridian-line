// A thin, lit ring of dust that arcs across the sky of the Cinder Belt: the belt seen from inside. One ring shaped mesh with a
// fragment shader (no textures): a narrow bright core with a wider faint skirt, streaked by noise along the ring, lit hot orange on
// the side that faces the ember sun and dim cyan on the far side, with a scatter of sparkling grains. It sits in the sky (follows the
// camera, no parallax, depth test off, drawn before the level geometry), so it can never cover the ship, enemies, shots or pickups.
import * as THREE from 'three';

const VERT = /* glsl */ `
varying vec2 vP; varying vec3 vDir;
void main(){
  vP = position.xy;
  vec4 w = modelMatrix * vec4(position, 1.0);
  vDir = w.xyz - modelMatrix[3].xyz;
  gl_Position = projectionMatrix * viewMatrix * w;
}`;
const FRAG = /* glsl */ `
uniform float uR, uW, uTime, uBright; uniform vec3 uSun, uLit, uCold, uCenter;
varying vec2 vP; varying vec3 vDir;
float h11(float n){ return fract(sin(n * 12.9898) * 43758.5453); }
float h21(vec2 p){ p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float vn(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f);
  return mix(mix(h21(i), h21(i+vec2(1,0)), f.x), mix(h21(i+vec2(0,1)), h21(i+vec2(1,1)), f.x), f.y); }
void main(){
  float r = length(vP);
  float a = atan(vP.y, vP.x);
  float k = (r - uR) / max(uW, 1e-3);
  // narrow core, faint skirt, both broken up by streaks that run along the ring
  float core = exp(-k * k * 5.0);
  float skirt = exp(-k * k * 0.5) * 0.25;
  float streak = 0.35 + 0.65 * vn(vec2(a * 70.0 + uTime * 0.02, k * 3.0));
  float clump = 0.45 + 0.75 * vn(vec2(a * 6.0 + 3.0, 1.7));
  float prof = (core * streak + skirt * streak * 0.6) * clump;
  // sparkling grains inside the band
  vec2 gp = vec2(a * 260.0, k * 9.0);
  float grain = step(0.965, h21(floor(gp))) * (0.5 + 0.5 * sin(uTime * (1.0 + 3.0 * h21(floor(gp) + 7.0)) + h21(floor(gp)) * 40.0)) * exp(-k * k * 0.7);
  // hot on the sun side, cold and dim on the far side
  vec3 dir = normalize(vDir);
  float lit = clamp(dot(dir, uSun) * 0.5 + 0.55, 0.0, 1.0);
  vec3 col = mix(uCold, uLit, lit * lit);
  float v = (prof * (0.55 + 0.9 * lit) + grain * 1.4) * uBright;
  gl_FragColor = vec4(col * clamp(v, 0.0, 1.6), 1.0);
}`;

export function createDustRing(opts = {}) {
  const R = opts.radius ?? 1500, Wd = opts.width ?? 46;
  const geo = new THREE.RingGeometry(R - Wd * 5, R + Wd * 5, 360, 1);
  const mat = new THREE.ShaderMaterial({
    vertexShader: VERT, fragmentShader: FRAG,
    uniforms: {
      uR: { value: R }, uW: { value: Wd }, uTime: { value: 0 }, uBright: { value: 1 },
      uSun: { value: (opts.sun ?? new THREE.Vector3(0.6, 0.2, -0.78)).clone().normalize() },
      uLit: { value: new THREE.Color(opts.lit ?? 0xff9a52).multiplyScalar(0.8) }, uCold: { value: new THREE.Color(opts.cold ?? 0x2a8fa0).multiplyScalar(0.5) },
      uCenter: { value: new THREE.Vector3() },
    },
    transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false, side: THREE.DoubleSide, fog: false, toneMapped: false,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = -880;
  mesh.name = 'dustRing';
  const off = opts.offset ?? new THREE.Vector3(-150, -700, -1300);
  mesh.rotation.set(opts.tiltX ?? 1.32, opts.tiltY ?? 0.0, opts.tiltZ ?? 0.32, 'YXZ');
  return {
    mesh,
    update(time, camera, bright) {
      mat.uniforms.uTime.value = time; mat.uniforms.uBright.value = bright;
      mesh.position.copy(camera.position).add(off);
      mesh.visible = bright > 0.001;
    },
    dispose() { geo.dispose(); mat.dispose(); },
  };
}
