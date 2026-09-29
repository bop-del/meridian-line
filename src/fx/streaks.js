// World stationary streak fields around the camera (ambient space dust and boost speed lines).
// Fully GPU driven: each streak wraps along Z relative to the camera, so there is no CPU work per frame
// beyond a handful of uniforms.
import * as THREE from 'three';

const VERT = /* glsl */ `
  attribute vec2 corner;
  attribute vec4 iSeed;
  uniform vec3 uCam;
  uniform vec2 uR;        // inner/outer radius around the camera axis
  uniform float uDepth, uNear, uLen, uWidth, uAmount, uAlpha;
  varying vec2 vC; varying float vA;
  void main() {
    float ang = iSeed.x * 6.2831853;
    float rad = mix(uR.x, uR.y, iSeed.y);
    float m = mod(iSeed.z * uDepth + uCam.z, uDepth);
    vec3 c = vec3(uCam.x + cos(ang) * rad, uCam.y + sin(ang) * rad * 0.75, uCam.z - uNear - m);
    float fade = smoothstep(0.0, 8.0, m) * (1.0 - smoothstep(uDepth * 0.55, uDepth, m));
    float vis = step(iSeed.w, uAmount);
    vA = uAlpha * fade * vis * (0.35 + 0.65 * fract(iSeed.w * 13.7));
    vec3 t = uCam - c;
    vec3 side = normalize(vec3(-t.y, t.x, 0.0) + vec3(1e-4, 0.0, 0.0));
    float len = uLen * (0.6 + 0.8 * fract(iSeed.x * 7.3));
    vec3 wp = c + vec3(0.0, 0.0, 1.0) * corner.y * len + side * corner.x * uWidth;
    vC = corner;
    gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
  }`;

const FRAG = /* glsl */ `
  uniform vec3 uColor;
  varying vec2 vC; varying float vA;
  void main() {
    float s = (1.0 - abs(vC.x)) * (1.0 - vC.y * vC.y);
    float a = vA * s * s;
    if (a < 0.003) discard;
    gl_FragColor = vec4(uColor, a);
  }`;

export class StreakField {
  constructor(scene, count, opts = {}) {
    const geo = new THREE.InstancedBufferGeometry();
    geo.setAttribute('corner', new THREE.BufferAttribute(new Float32Array([-1, -1, 1, -1, 1, 1, -1, 1]), 2));
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(12), 3));
    geo.setIndex([0, 1, 2, 0, 2, 3]);
    const seed = new Float32Array(count * 4);
    for (let i = 0; i < count; i++) {
      seed[i * 4] = Math.random(); seed[i * 4 + 1] = Math.random(); seed[i * 4 + 2] = (i + Math.random()) / count; seed[i * 4 + 3] = (i * 0.61803398875) % 1;
    }
    geo.setAttribute('iSeed', new THREE.InstancedBufferAttribute(seed, 4));
    geo.instanceCount = count;
    this.uniforms = {
      uCam: { value: new THREE.Vector3() },
      uR: { value: new THREE.Vector2(opts.rMin ?? 2, opts.rMax ?? 20) },
      uDepth: { value: opts.depth ?? 120 }, uNear: { value: opts.near ?? 2 },
      uLen: { value: opts.len ?? 4 }, uWidth: { value: opts.width ?? 0.05 },
      uAmount: { value: 1 }, uAlpha: { value: opts.alpha ?? 0.5 },
      uColor: { value: new THREE.Color(opts.color ?? 0xaaccff) },
    };
    this.material = new THREE.ShaderMaterial({
      uniforms: this.uniforms, vertexShader: VERT, fragmentShader: FRAG,
      transparent: true, depthWrite: false, depthTest: true, blending: THREE.AdditiveBlending, fog: false, side: THREE.DoubleSide,
    });
    this.mesh = new THREE.Mesh(geo, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = opts.renderOrder ?? 9;
    this.mesh.name = opts.name || 'fxStreaks';
    scene.add(this.mesh);
  }
  set(cam, amount, len) {
    this.uniforms.uCam.value.copy(cam);
    this.uniforms.uAmount.value = amount;
    if (len !== undefined) this.uniforms.uLen.value = len;
    this.mesh.visible = amount > 0.005;
  }
  dispose() { this.mesh.geometry.dispose(); this.material.dispose(); this.mesh.parent?.remove(this.mesh); }
}
