// Visual effects: pooled GPU particles, debris, shockwave spheres, trails, camera shake, speed lines, space dust.
//
// API: fx.trail(target, opts), fx.shakeOffset / fx.shakeRoll (applied by
// render.render unless ctx.cameraRig.appliesShake), fx.stats(), fx.setDensity(0..1), fx.explosion opts {sound:false}.
import * as THREE from 'three';
import { ParticlePool, K_GLOW, K_SPARK, K_SMOKE, K_RING, K_FLARE, K_EMBER, K_FIRE } from './particles.js';
import { StreakField } from './streaks.js';
import { DebrisPool } from './debris.js';

const R = Math.random;
const rr = (a, b) => a + (b - a) * R();
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const cA = new THREE.Color(), cB = new THREE.Color();
const _v = new THREE.Vector3(), _p = new THREE.Vector3(), _d = new THREE.Vector3();
const NOOP_HANDLE = { stop() {}, active: false, intensity: 0 };

// scratch random direction
let rx = 0, ry = 0, rz = 0;
function rndDir() {
  let l;
  do { rx = R() * 2 - 1; ry = R() * 2 - 1; rz = R() * 2 - 1; l = rx * rx + ry * ry + rz * rz; } while (l > 1 || l < 0.01);
  l = Math.sqrt(l); rx /= l; ry /= l; rz /= l;
}

const SPHERE_VERT = `varying vec3 vN; varying vec3 vV;
  void main(){ vec4 mv = modelViewMatrix * vec4(position,1.0); vN = normalize(normalMatrix * normal); vV = normalize(-mv.xyz); gl_Position = projectionMatrix * mv; }`;
const SPHERE_FRAG = `uniform vec3 uColor; uniform float uFade; varying vec3 vN; varying vec3 vV;
  void main(){ float f = pow(1.0 - abs(dot(normalize(vN), normalize(vV))), 2.2); gl_FragColor = vec4(uColor * (0.25 + f * 2.2), uFade * (0.18 + f * 0.8)); }`;

export const fx = {
  ctx: null, time: 0,
  shakeOffset: new THREE.Vector3(), shakeRoll: 0,
  _trauma: 0, _shakeRate: 0, _density: 1,
  _speedManual: 0, _speedAmt: 0,

  init(ctx) {
    this.ctx = ctx;
    const scene = ctx.scene;
    this.add = new ParticlePool(scene, 7000, { additive: true, renderOrder: 12 });
    this.alpha = new ParticlePool(scene, 1400, { additive: false, renderOrder: 11 });
    this.debrisPool = new DebrisPool(scene, (x, y, z, vx, vy, vz) => {
      this.add.emit(x, y, z, vx, vy, vz, rr(0.3, 0.6), 1.6, 0.8, 0.25, 0.22, 0.6, 0.12, 0.02, 0.05, 1.5, 0, 0, K_EMBER);
    });
    this.speedField = new StreakField(scene, 110, { rMin: 3.5, rMax: 24, depth: 170, near: 3, len: 14, width: 0.045, alpha: 0.55, color: 0xbfd8ff, name: 'fxSpeedLines', renderOrder: 9 });
    this.dust = new StreakField(scene, 260, { rMin: 4, rMax: 55, depth: 110, near: 0, len: 0.7, width: 0.05, alpha: 0.55, color: 0x9fb4d8, name: 'fxDust', renderOrder: 8 });

    // shockwave spheres (bomb)
    this.spheres = [];
    const sg = new THREE.SphereGeometry(1, 32, 20);
    this._sphereGeo = sg;
    for (let i = 0; i < 3; i++) {
      const m = new THREE.ShaderMaterial({ uniforms: { uColor: { value: new THREE.Color() }, uFade: { value: 0 } }, vertexShader: SPHERE_VERT, fragmentShader: SPHERE_FRAG, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false });
      const mesh = new THREE.Mesh(sg, m); mesh.visible = false; mesh.frustumCulled = false; mesh.renderOrder = 13; scene.add(mesh);
      this.spheres.push({ mesh, mat: m, t: 0, dur: 0.8, radius: 1, active: false });
    }

    // delayed sub explosions (boss chain blasts)
    this.sched = [];
    for (let i = 0; i < 48; i++) this.sched.push({ t: -1, x: 0, y: 0, z: 0, s: 1, color: 0xffaa33 });

    // persistent trails / damage smoke handles
    this.trails = [];
    for (let i = 0; i < 64; i++) {
      const h = { active: false, target: null, mode: 0, acc: 0, intensity: 1, last: new THREE.Vector3(), cur: new THREE.Vector3(), first: true,
        offset: new THREE.Vector3(), hasOffset: false, color: 0x66aaff, color2: 0x2244ff, size: 0.5, life: 0.4, rate: 80, spread: 0.1, stop() { this.active = false; this.target = null; } };
      this.trails.push(h);
    }
    ctx.events?.on?.('fx:hitstop', () => {});
    ctx.events?.on?.('game:start', () => this.reset());
  },

  reset() {
    this.add?.clear(); this.alpha?.clear(); this.debrisPool?.clear();
    this._trauma = 0; this._shakeRate = 0; this.shakeOffset.set(0, 0, 0); this.shakeRoll = 0;
    if (this.sched) for (const s of this.sched) s.t = -1;
    if (this.trails) for (const h of this.trails) h.stop();
    if (this.spheres) for (const s of this.spheres) { s.active = false; s.mesh.visible = false; }
  },

  setDensity(d) { this._density = clamp(d, 0.2, 1); },
  _q() { return clamp(1 - this.add.spawnedFrame / 2600, 0.25, 1) * this._density; },

  // ---------- low level emit helpers ----------
  _glow(x, y, z, vx, vy, vz, life, hex0, k0, size0, hex1, k1, size1, drag = 2, opacity = 0, kind = K_GLOW) {
    cA.setHex(hex0); cB.setHex(hex1);
    this.add.emit(x, y, z, vx, vy, vz, life, cA.r * k0, cA.g * k0, cA.b * k0, size0, cB.r * k1, cB.g * k1, cB.b * k1, size1, drag, 0, opacity, kind);
  },
  _puff(x, y, z, vx, vy, vz, life, size0, size1, shade = 0.22, opacity = 0.55) {
    this.alpha.emit(x, y, z, vx, vy, vz, life, shade, shade * 0.95, shade * 0.9, size0, shade * 0.25, shade * 0.25, shade * 0.25, size1, 1.4, 0, opacity, K_SMOKE);
  },

  // ---------- public API ----------
  explosion(pos, o = {}) {
    if (!this.add) return;
    const big = !!o.big, hex = o.color ?? 0xffaa33;
    // during a boss fight the small blasts around the boss (drones, turrets, parts) are thinned so their fire and smoke do
    // not pile up into a haze that hides the boss; the boss's own big blasts are left alone
    const bossUp = !big && (this.ctx.state?.boss?.hp ?? 0) > 0;
    const s = (o.scale ?? 1) * (bossUp ? 0.7 : 1);
    const q = this._q() * (bossUp ? 0.6 : 1);
    const x = pos.x, y = pos.y, z = pos.z;
    const S = big ? s * 1.8 : s;
    // flash core
    this._glow(x, y, z, 0, 0, 0, big ? 0.26 : 0.16, 0xffffff, 2.8, 3.0 * S, hex, 1.2, 5.0 * S, 3);
    // fireball puffs
    const nf = Math.max(4, Math.round((8 + 3 * S) * q));
    for (let i = 0; i < nf; i++) {
      rndDir(); const sp = rr(2.5, 9) * S;
      cA.setHex(hex).lerp(cB.setHex(0xfff2c0), 0.18);
      this.add.emit(x + rx * S * 0.5, y + ry * S * 0.5, z + rz * S * 0.5, rx * sp, ry * sp, rz * sp, rr(0.5, big ? 1.4 : 1.0),
        cA.r * 1.9, cA.g * 1.6, cA.b * 1.3, rr(1.0, 1.7) * S, cA.r * 0.35, cA.g * 0.06, 0.0, rr(2.0, 3.6) * S, 3.0, 0, 1.0, K_FIRE);
    }
    // shock ring
    this._glow(x, y, z, 0, 0, 0, big ? 0.85 : 0.5, hex, big ? 0.8 : 1.1, 0.5 * S, hex, 0.3, (big ? 9 : 6) * S, 0, 0, K_RING);
    if (big) this._glow(x, y, z, 0, 0, 0, 1.15, 0xffffff, 0.7, 0.3 * S, 0xff8844, 0.2, 11 * S, 0, 0, K_RING);
    // sparks
    const ns = Math.round((12 + 8 * S) * q * (big ? 1.4 : 1));
    for (let i = 0; i < ns; i++) {
      rndDir(); const sp = rr(12, 40) * Math.sqrt(S);
      this.add.emit(x, y, z, rx * sp, ry * sp, rz * sp, rr(0.4, 1.1), 2.4, 1.7, 0.7, rr(0.45, 0.85), 1.3, 0.28, 0.05, 0.05, 1.5, 3, 1.8, K_SPARK);
    }
    // smoke
    const nm = Math.round((3 + 2 * S) * q);
    for (let i = 0; i < nm; i++) {
      rndDir(); const sp = rr(0.6, 3.2) * S;
      this._puff(x + rx * S * 0.6, y + ry * S * 0.6, z + rz * S * 0.6, rx * sp, ry * sp + 0.6, rz * sp, rr(1.4, 2.6) * (big ? 1.3 : 1), rr(0.9, 1.5) * S, rr(3, 5.2) * S, rr(0.13, 0.28), 0.6);
    }
    // debris
    const nd = Math.round((big ? 16 : 5 + 2 * S) * q);
    for (let i = 0; i < nd; i++) {
      rndDir(); const sp = rr(5, 19) * Math.sqrt(S);
      this.debrisPool.spawn(x, y, z, rx * sp, ry * sp, rz * sp, 0.22 * Math.sqrt(S), o.debrisColor ?? 0x777f8c, rr(1.2, 2.6));
    }
    // delayed chain blasts for big explosions
    if (big) {
      const n = 5;
      for (let i = 0; i < n; i++) {
        const e = this._sched(); if (!e) break;
        rndDir(); const rad = rr(1.2, 3.5) * s;
        e.t = 0.08 + i * rr(0.09, 0.16); e.x = x + rx * rad; e.y = y + ry * rad; e.z = z + rz * rad; e.s = rr(0.45, 0.8) * s; e.color = hex;
      }
    }
    // camera feedback by distance
    const cam = this.ctx.camera;
    if (cam && !o.quiet) {
      const dist = cam.position.distanceTo(_v.set(x, y, z));
      const fall = clamp(1 - dist / (big ? 260 : 90), 0, 1);
      if (fall > 0) this.shake(clamp((big ? 0.55 : 0.14) * S * fall, 0, 1), big ? 0.7 : 0.25);
      if (big) this.flash('#ffffff', 0.28 * Math.max(fall, 0.3), 0.3);
    }
  },

  sparks(pos, dir, count = 12) {
    if (!this.add) return;
    const n = Math.max(1, Math.round(count * this._q()));
    for (let i = 0; i < n; i++) {
      rndDir();
      let dx = rx, dy = ry, dz = rz;
      if (dir) { dx = dir.x + rx * 0.9; dy = dir.y + ry * 0.9; dz = dir.z + rz * 0.9; const l = Math.hypot(dx, dy, dz) || 1; dx /= l; dy /= l; dz /= l; }
      const sp = rr(10, 34);
      this.add.emit(pos.x, pos.y, pos.z, dx * sp, dy * sp, dz * sp, rr(0.3, 0.75), 2.2, 1.6, 0.7, rr(0.22, 0.36), 1.2, 0.3, 0.06, 0.04, 2.0, 4, 1.0, K_SPARK);
    }
  },

  debris(pos, count = 8, color = 0x888888) {
    if (!this.add) return;
    const n = Math.max(1, Math.round(count * this._q()));
    for (let i = 0; i < n; i++) {
      rndDir(); const sp = rr(4, 16);
      this.debrisPool.spawn(pos.x, pos.y, pos.z, rx * sp, ry * sp, rz * sp, 0.2, color, rr(1.2, 2.4));
    }
  },

  smoke(pos, scale = 1) {
    if (!this.add) return;
    rndDir();
    this._puff(pos.x, pos.y, pos.z, rx * 1.2, ry * 1.2 + 0.4, rz * 1.2, rr(1.2, 2.0), 0.6 * scale, rr(2, 3.2) * scale, rr(0.14, 0.3), 0.55);
    this._puff(pos.x, pos.y, pos.z, ry * 1.2, rz * 1.2, rx * 1.2, rr(1.0, 1.8), 0.5 * scale, rr(1.6, 2.6) * scale, rr(0.14, 0.3), 0.5);
  },

  muzzleFlash(pos, dir, color = 0xaaddff) {
    if (!this.add) return;
    this._glow(pos.x, pos.y, pos.z, 0, 0, 0, 0.07, 0xffffff, 3.5, 0.75, color, 1.4, 0.4, 0, 0, K_FLARE);
    this._glow(pos.x, pos.y, pos.z, 0, 0, 0, 0.11, color, 1.6, 0.6, color, 0.3, 1.2, 0);
    if (dir) {
      for (let i = 0; i < 3; i++) {
        rndDir(); const sp = rr(20, 45);
        this.add.emit(pos.x, pos.y, pos.z, (dir.x + rx * 0.25) * sp, (dir.y + ry * 0.25) * sp, (dir.z + rz * 0.25) * sp, rr(0.08, 0.16), 1.6, 1.8, 2.2, 0.16, 0.4, 0.6, 1.2, 0.03, 2, 0, 1.4, K_SPARK);
      }
    }
  },

  hitSpark(pos, color = 0xffe2a0) {
    if (!this.add) return;
    this._glow(pos.x, pos.y, pos.z, 0, 0, 0, 0.13, 0xffffff, 3.2, 0.9, color, 1.2, 0.55, 0, 0, K_FLARE);
    const n = Math.max(2, Math.round(6 * this._q()));
    for (let i = 0; i < n; i++) {
      rndDir(); const sp = rr(8, 24);
      this.add.emit(pos.x, pos.y, pos.z, rx * sp, ry * sp, rz * sp, rr(0.18, 0.4), 2.0, 1.5, 0.6, rr(0.16, 0.26), 1.0, 0.25, 0.05, 0.03, 2.2, 2, 1.0, K_SPARK);
    }
  },

  shockwave(pos, o = {}) {
    if (!this.add) return;
    const radius = o.radius ?? 60, hex = o.color ?? 0x66ccff;
    const x = pos.x, y = pos.y, z = pos.z;
    // expanding translucent sphere
    let sp = this.spheres.find((s) => !s.active) || this.spheres[0];
    sp.active = true; sp.t = 0; sp.dur = 0.85; sp.radius = radius; sp.mesh.visible = true;
    sp.mesh.position.set(x, y, z); sp.mat.uniforms.uColor.value.setHex(hex).multiplyScalar(1.4);
    // rings and core flash
    this._glow(x, y, z, 0, 0, 0, 0.35, 0xffffff, 6, radius * 0.16, hex, 1.5, radius * 0.24, 3);
    this._glow(x, y, z, 0, 0, 0, 0.75, hex, 2.2, 1, hex, 0.4, radius * 1.05, 0, 0, K_RING);
    this._glow(x, y, z, 0, 0, 0, 1.0, 0xffffff, 1.2, 1, hex, 0.3, radius * 1.35, 0, 0, K_RING);
    const n = Math.round(48 * this._q());
    for (let i = 0; i < n; i++) {
      rndDir(); const s = rr(30, 90) * (radius / 60);
      this.add.emit(x, y, z, rx * s, ry * s, rz * s, rr(0.5, 1.1), 2.4, 2.4, 2.8, rr(0.3, 0.6), 0.6, 0.9, 1.6, 0.05, 1.0, 0, 1.2, K_SPARK);
    }
    this.flash(o.flashColor ?? '#cfe8ff', 0.4, 0.4);
    this.shake(1.0, 0.8);
  },

  shake(intensity = 0.5, duration = 0.3) {
    const nt = Math.min(1, this._trauma + intensity * 0.75);
    const remain = this._shakeRate > 0 ? this._trauma / this._shakeRate : 0;
    this._trauma = nt;
    this._shakeRate = nt / Math.max(duration, remain, 0.05);
  },

  flash(color = '#ffffff', alpha = 0.4, duration = 0.2) { this.ctx?.render?.flash?.(color, alpha, duration); },

  /** persistent smoke plus embers from a low health entity. handle.stop() ends it, handle.intensity 0..1 scales it. */
  damageSmoke(target, o = {}) {
    const h = this._trail(target, o, 1);
    h.rate = o.rate ?? 26; h.size = o.size ?? 0.7;
    return h;
  },

  /** engine or vapor trail attached to a target (Object3D or entity with .position/.group). opts: color, color2, size, life, rate, offset, spread */
  trail(target, o = {}) {
    const h = this._trail(target, o, 0);
    h.color = o.color ?? 0x66aaff; h.color2 = o.color2 ?? 0x1133ff; h.size = o.size ?? 0.5; h.life = o.life ?? 0.4; h.rate = o.rate ?? 80; h.spread = o.spread ?? 0.1;
    return h;
  },

  _trail(target, o, mode) {
    if (!this.trails) return NOOP_HANDLE;
    let h = null;
    for (let i = 0; i < this.trails.length; i++) if (!this.trails[i].active) { h = this.trails[i]; break; }
    if (!h) return { stop() {}, active: false, intensity: 0 };
    h.active = true; h.target = target; h.mode = mode; h.acc = 0; h.intensity = 1; h.first = true; h.hasOffset = !!o.offset;
    if (o.offset) h.offset.copy(o.offset);
    return h;
  },

  /** speed lines: amount 0..1 (persistent until changed; boost and rail speed add automatically) */
  speedLines(amount = 0) { this._speedManual = clamp(amount, 0, 1); },

  cellPickup(pos, color = 0xffd54a) {
    if (!this.add) return;
    const x = pos.x, y = pos.y, z = pos.z;
    this._glow(x, y, z, 0, 0, 0, 0.5, color, 2.6, 0.3, color, 0.6, 3.6, 0, 0, K_RING);
    this._glow(x, y, z, 0, 0, 0, 0.75, 0xffffff, 1.1, 0.2, color, 0.3, 5.2, 0, 0, K_RING);
    this._glow(x, y, z, 0, 0, 0, 0.2, 0xffffff, 4.5, 1.1, color, 1.4, 1.9, 0, 0, K_FLARE);
    const n = Math.round(16 * this._q());
    for (let i = 0; i < n; i++) {
      rndDir(); const sp = rr(3, 10);
      this._glow(x, y, z, rx * sp, ry * sp, rz * sp, rr(0.5, 0.95), color, 2.2, rr(0.16, 0.3), color, 0.3, 0.05, 3.2, 0, K_GLOW);
    }
  },

  // ---------- internals ----------
  _sched() { for (const s of this.sched) if (s.t < 0) return s; return null; },

  _updateTrails(dt) {
    for (let i = 0; i < this.trails.length; i++) {
      const h = this.trails[i];
      if (!h.active) continue;
      const t = h.target;
      const obj = t && (t.group || t);
      if (!t || t.alive === false || (obj.isObject3D && !obj.parent)) { h.stop(); continue; }
      if (obj.isObject3D && !t.group) obj.getWorldPosition(h.cur); else h.cur.copy(t.position || obj.position);
      if (h.hasOffset && obj.isObject3D) { obj.updateWorldMatrix(true, false); obj.localToWorld(_p.copy(h.offset)); h.cur.copy(_p); }
      if (h.first) { h.last.copy(h.cur); h.first = false; }
      const rate = h.rate * h.intensity * this._density;
      h.acc += rate * dt;
      const n = Math.min(h.acc | 0, 12);
      h.acc -= h.acc | 0;
      for (let k = 0; k < n; k++) {
        const f = (k + 1) / n;
        const px = h.last.x + (h.cur.x - h.last.x) * f, py = h.last.y + (h.cur.y - h.last.y) * f, pz = h.last.z + (h.cur.z - h.last.z) * f;
        if (h.mode === 0) {
          rndDir(); const sp = h.spread * 8;
          this._glow(px, py, pz, rx * sp, ry * sp, rz * sp, h.life * rr(0.7, 1.1), h.color, 2.0, h.size, h.color2, 0.4, h.size * 0.15, 2.0);
        } else {
          rndDir();
          this._puff(px, py, pz, rx * 0.9, ry * 0.9 + 0.7, rz * 0.9, rr(0.9, 1.7), h.size * 0.5, h.size * rr(2.2, 3.4), rr(0.06, 0.16), 0.6);
          if (R() < 0.35) { rndDir(); this._glow(px, py, pz, rx * 3, ry * 3 + 1, rz * 3, rr(0.25, 0.5), 0xffa040, 2.2, 0.16, 0xff3010, 0.4, 0.04, 1.5, 0, K_EMBER); }
        }
      }
      h.last.copy(h.cur);
    }
  },

  update(dt, ctx = this.ctx) {
    if (!this.add) return;
    this.time += dt;
    const cam = ctx.camera;

    // shake
    if (this._trauma > 0) {
      this._trauma = Math.max(0, this._trauma - this._shakeRate * dt);
      const a = this._trauma * this._trauma, t = this.time;
      this.shakeOffset.set(
        a * 0.7 * (Math.sin(t * 47.1) + 0.5 * Math.sin(t * 83.3 + 1.7)),
        a * 0.7 * (Math.sin(t * 53.9 + 2.1) + 0.5 * Math.sin(t * 79.7)),
        a * 0.25 * Math.sin(t * 61.3 + 0.6));
      this.shakeRoll = a * 0.05 * Math.sin(t * 41.7 + 1.1);
    } else if (this.shakeRoll !== 0 || this.shakeOffset.lengthSq() > 0) { this.shakeOffset.set(0, 0, 0); this.shakeRoll = 0; }

    // delayed chain blasts
    for (let i = 0; i < this.sched.length; i++) {
      const e = this.sched[i];
      if (e.t < 0) continue;
      e.t -= dt;
      if (e.t <= 0) {
        e.t = -1; _v.set(e.x, e.y, e.z);
        this.explosion(_v, { scale: e.s, color: e.color, quiet: true });
        if (this.ctx.camera) this.shake(0.22, 0.2);
      }
    }

    // shockwave spheres
    for (const s of this.spheres) {
      if (!s.active) continue;
      s.t += dt / s.dur;
      if (s.t >= 1) { s.active = false; s.mesh.visible = false; continue; }
      const e = 1 - Math.pow(1 - s.t, 3);
      s.mesh.scale.setScalar(Math.max(0.01, s.radius * e));
      s.mat.uniforms.uFade.value = (1 - s.t) * (1 - s.t) * 1.1;
    }

    this._updateTrails(dt);
    this.debrisPool.update(dt);

    // speed lines and dust
    const rail = ctx.rail, cfg = ctx.config?.rail;
    const base = rail?.baseSpeed ?? 40, bs = cfg?.boostSpeed ?? 75;
    const spd = rail ? clamp((rail.speed - base) / Math.max(1, bs - base), 0, 1) : 0;
    const auto = Math.max(spd, ctx.player?.isBoosting ? 1 : 0) * 0.9;
    const target = Math.max(this._speedManual, auto);
    this._speedAmt += (target - this._speedAmt) * (1 - Math.exp(-(target > this._speedAmt ? 8 : 4) * dt));
    const railSpeed = rail?.speed ?? 40;
    this.speedField.set(cam.position, this._speedAmt * 0.95, 8 + this._speedAmt * 16);
    this.speedField.uniforms.uAlpha.value = 0.22 + 0.4 * this._speedAmt;
    this.dust.set(cam.position, 1, 0.4 + railSpeed * 0.018);

    this.alpha.update(dt);
    this.add.update(dt);
  },

  stats() {
    return { addSpawnedLastFrame: this.add?.spawnedFrame, debris: this.debrisPool?.active, trauma: +this._trauma.toFixed(2), speedAmt: +this._speedAmt.toFixed(2), trails: this.trails.filter((t) => t.active).length };
  },

  dispose() { this.add?.dispose(); this.alpha?.dispose(); this.debrisPool?.dispose(); this.speedField?.dispose(); this.dust?.dispose(); },
};
