// GPU particle pool. Particles are simulated analytically in the vertex shader from spawn data
// (position, velocity, drag, gravity, birth time), so the CPU only writes a ring buffer on spawn
// and never touches live particles again. One draw call per pool, zero per frame allocation.
import * as THREE from 'three';

// kinds
export const K_GLOW = 0, K_SPARK = 1, K_SMOKE = 2, K_RING = 3, K_FLARE = 4, K_EMBER = 5, K_FIRE = 6;

const STRIDE = 20; // floats per particle: A(pos,birth) B(vel,life) C(c0,size0) D(c1,size1) E(drag,grav,stretch|opacity,kind)

const VERT = /* glsl */ `
  attribute vec2 corner;
  attribute vec4 iA; attribute vec4 iB; attribute vec4 iC; attribute vec4 iD; attribute vec4 iE;
  uniform float uTime;
  varying vec2 vUv; varying vec4 vCol; varying float vKind; varying float vAge; varying float vSeed;
  float hash1(float n) { return fract(sin(n * 12.9898) * 43758.5453); }
  void main() {
    float age = uTime - iA.w;
    float life = iB.w;
    float a = age / life;
    if (age < 0.0 || a >= 1.0) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
    float drag = iE.x;
    float k = (1.0 - exp(-drag * age)) / drag;
    vec3 wp = iA.xyz + iB.xyz * k + vec3(0.0, -0.5 * iE.y * age * age, 0.0);
    vec3 vel = iB.xyz * exp(-drag * age) + vec3(0.0, -iE.y * age, 0.0);
    float seed = hash1(float(gl_InstanceID) + iA.w * 3.1);
    float kind = iE.w;
    float ea = 1.0 - (1.0 - a) * (1.0 - a);
    float size = mix(iC.w, iD.w, kind > 2.5 && kind < 3.5 ? ea : (kind == 2.0 ? sqrt(a) : ea));
    vec3 col = mix(iC.rgb, iD.rgb, sqrt(a));
    float alpha;
    if (kind == 3.0) alpha = (1.0 - a) * smoothstep(0.0, 0.04, a);
    else if (kind == 2.0) alpha = smoothstep(0.0, 0.12, a) * (1.0 - a) * (1.0 - a);
    else alpha = smoothstep(0.0, 0.03, a) * (1.0 - a) * (1.0 - a);
    vec4 vp = viewMatrix * vec4(wp, 1.0);
    vec2 c = corner;
    if (iE.z > 0.0 && kind == 1.0) {
      // streak: long axis along projected velocity
      vec3 vv = (viewMatrix * vec4(vel, 0.0)).xyz;
      vec2 d2 = vv.xy;
      float l = length(d2);
      d2 = l > 1e-4 ? d2 / l : vec2(1.0, 0.0);
      float sp = length(vel);
      float len = size * (1.0 + iE.z * min(sp * 0.06, 4.0));
      vec2 side = vec2(-d2.y, d2.x);
      vp.xy += d2 * c.x * len + side * c.y * size * 0.22;
      vUv = c;
    } else {
      float ang = (kind == 2.0 || kind == 4.0 || kind == 6.0) ? seed * 6.2831 + age * (seed - 0.5) * 2.0 : 0.0;
      float cs = cos(ang), sn = sin(ang);
      vp.xy += vec2(c.x * cs - c.y * sn, c.x * sn + c.y * cs) * size;
      vUv = c;
    }
    if (kind != 1.0 && iE.z > 0.0) alpha *= iE.z; // opacity multiplier for non streak kinds
    gl_Position = projectionMatrix * vp;
    vCol = vec4(col, alpha);
    vKind = kind; vAge = a; vSeed = seed;
  }`;

const FRAG = /* glsl */ `
  varying vec2 vUv; varying vec4 vCol; varying float vKind; varying float vAge; varying float vSeed;
  float hash21(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
  float vnoise(vec2 p) {
    vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash21(i), hash21(i + vec2(1, 0)), f.x), mix(hash21(i + vec2(0, 1)), hash21(i + vec2(1, 1)), f.x), f.y);
  }
  void main() {
    float d = length(vUv);
    float shape;
    if (vKind < 0.5) {            // glow
      shape = exp(-d * d * 3.2) * smoothstep(1.0, 0.7, d) + 0.6 * smoothstep(0.45, 0.0, d);
    } else if (vKind < 1.5) {     // spark streak (long axis = x)
      float along = 1.0 - abs(vUv.x);
      shape = pow(clamp(along, 0.0, 1.0), 1.4) * smoothstep(1.0, 0.0, abs(vUv.y)) * (0.35 + 0.65 * smoothstep(-1.0, 0.6, vUv.x));
      shape *= 1.6;
    } else if (vKind < 2.5) {     // smoke puff
      vec2 q = vUv * 2.2 + vSeed * 17.0;
      float n = vnoise(q) * 0.55 + vnoise(q * 2.1 + 3.7) * 0.3 + vnoise(q * 4.3) * 0.15;
      shape = smoothstep(1.0, 0.25, d + (n - 0.5) * 0.7) * (0.55 + 0.7 * n);
    } else if (vKind < 3.5) {     // ring
      float w = mix(0.16, 0.02, vAge);
      float r = 0.86;
      shape = smoothstep(r - w, r, d) * smoothstep(r + w * 0.55, r, d);
      shape += 0.06 * smoothstep(0.86, 0.0, d);
    } else if (vKind < 4.5) {     // flare (star)
      float core = exp(-d * d * 14.0);
      float cross = exp(-abs(vUv.x) * 26.0) * smoothstep(1.0, 0.0, abs(vUv.y)) + exp(-abs(vUv.y) * 26.0) * smoothstep(1.0, 0.0, abs(vUv.x));
      shape = core * 1.4 + cross * 0.8 + 0.25 * exp(-d * d * 3.0);
      shape *= smoothstep(1.0, 0.85, d);
    } else if (vKind < 5.5) {     // ember: small hard dot
      shape = smoothstep(1.0, 0.3, d);
    } else {                      // fire: noisy hot puff, bright core fading to red edges
      vec2 q = vUv * 1.8 + vSeed * 13.0 + vec2(vAge * 0.7, -vAge * 1.1);
      float n = vnoise(q) * 0.55 + vnoise(q * 2.3 + 1.7) * 0.3 + vnoise(q * 5.1) * 0.15;
      shape = smoothstep(1.0, 0.05, d + (n - 0.5) * 0.85);
      vec3 c2 = vCol.rgb * mix(vec3(0.55, 0.22, 0.12), vec3(1.25, 1.1, 0.95), shape * shape);
      float a2 = vCol.a * shape;
      if (a2 < 0.002) discard;
      gl_FragColor = vec4(c2, a2);
      return;
    }
    float a = vCol.a * shape;
    if (a < 0.002) discard;
    gl_FragColor = vec4(vCol.rgb, a);
  }`;

export class ParticlePool {
  constructor(scene, count, { additive = true, renderOrder = 10 } = {}) {
    this.count = count;
    this.cursor = 0;
    this.time = 0;
    this.data = new Float32Array(count * STRIDE);
    for (let i = 0; i < count; i++) { this.data[i * STRIDE + 3] = -1e6; this.data[i * STRIDE + 7] = 1; this.data[i * STRIDE + 16] = 1; }
    const geo = new THREE.InstancedBufferGeometry();
    geo.setAttribute('corner', new THREE.BufferAttribute(new Float32Array([-1, -1, 1, -1, 1, 1, -1, 1]), 2));
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(12), 3)); // dummy, required for bounds
    geo.setIndex([0, 1, 2, 0, 2, 3]);
    this.buffer = new THREE.InstancedInterleavedBuffer(this.data, STRIDE, 1);
    this.buffer.setUsage(THREE.DynamicDrawUsage);
    const names = ['iA', 'iB', 'iC', 'iD', 'iE'];
    names.forEach((n, i) => geo.setAttribute(n, new THREE.InterleavedBufferAttribute(this.buffer, 4, i * 4)));
    geo.instanceCount = count;
    this.uniforms = { uTime: { value: 0 } };
    this.material = new THREE.ShaderMaterial({
      uniforms: this.uniforms, vertexShader: VERT, fragmentShader: FRAG,
      transparent: true, depthWrite: false, depthTest: true, fog: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    this.mesh = new THREE.Mesh(geo, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = renderOrder;
    this.mesh.name = additive ? 'fxParticlesAdd' : 'fxParticlesAlpha';
    scene.add(this.mesh);
    this.dirtyMin = Infinity; this.dirtyMax = -1;
    this.spawnedFrame = 0;
  }

  /** Spawn one particle. Colors are linear RGB (values above 1 give HDR bloom). */
  emit(px, py, pz, vx, vy, vz, life, r0, g0, b0, size0, r1, g1, b1, size1, drag, grav, stretch, kind) {
    const i = this.cursor;
    this.cursor = (i + 1) % this.count;
    const d = this.data, o = i * STRIDE;
    d[o] = px; d[o + 1] = py; d[o + 2] = pz; d[o + 3] = this.time;
    d[o + 4] = vx; d[o + 5] = vy; d[o + 6] = vz; d[o + 7] = life;
    d[o + 8] = r0; d[o + 9] = g0; d[o + 10] = b0; d[o + 11] = size0;
    d[o + 12] = r1; d[o + 13] = g1; d[o + 14] = b1; d[o + 15] = size1;
    d[o + 16] = drag > 0.001 ? drag : 0.001; d[o + 17] = grav; d[o + 18] = stretch; d[o + 19] = kind;
    if (i < this.dirtyMin) this.dirtyMin = i;
    if (i > this.dirtyMax) this.dirtyMax = i;
    this.spawnedFrame++;
  }

  update(dt) {
    this.time += dt;
    this.uniforms.uTime.value = this.time;
    this.spawnedFrame = 0;
    if (this.dirtyMax >= 0) {
      const b = this.buffer;
      b.clearUpdateRanges();
      // ring wrap makes the dirty span potentially huge; if so upload everything (still cheap: <1MB)
      b.addUpdateRange(this.dirtyMin * STRIDE, (this.dirtyMax - this.dirtyMin + 1) * STRIDE);
      b.needsUpdate = true;
      this.dirtyMin = Infinity; this.dirtyMax = -1;
    }
  }

  clear() {
    const d = this.data;
    for (let i = 0; i < this.count; i++) d[i * STRIDE + 3] = -1e6;
    this.dirtyMin = 0; this.dirtyMax = this.count - 1;
  }

  dispose() { this.mesh.geometry.dispose(); this.material.dispose(); this.mesh.parent?.remove(this.mesh); }
}
