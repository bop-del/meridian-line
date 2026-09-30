// Rendering pipeline: WebGLRenderer + EffectComposer (scene target, UnrealBloom, custom grade pass, OutputPass),
// adaptive quality, camera shake application and full screen flash / damage pulse.
//
// API: render.render(dt) applies fx.shakeRoll (and fx.shakeOffset if the cameraRig does not already add it,
// detected by cameraRig.trauma or cameraRig.appliesShake) to the camera around the draw call. render.flash(css, alpha, dur)
// is the screen flash used by fx.flash. render.update(dt, ctx) is optional: render(dt) runs it itself if needed.
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { FXAAShader } from 'three/addons/shaders/FXAAShader.js';
import { PostShader, SanitizeShader } from './postShader.js';
import { makeEnvironment } from './environment.js';

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const damp = (cur, target, rate, dt) => cur + (target - cur) * (1 - Math.exp(-rate * dt));

// quality levels: [pixelRatioCap, bloomScale, bloomEnabled]
const QUALITY = [
  { pr: 2, bloom: 1, on: true },
  { pr: 1.5, bloom: 0.75, on: true },
  { pr: 1.25, bloom: 0.5, on: true },
  { pr: 1, bloom: 0.5, on: true },
  { pr: 0.85, bloom: 0.35, on: true },
  { pr: 0.7, bloom: 0.25, on: false },
];

export const render = {
  ctx: null, composer: null, bloom: null, post: null, mount: null,
  quality: 0, adaptive: true, avgMs: 16, _slow: 0, _fast: 0, _sinceChange: 0,
  _pendingQ: -1, _stepFrom: null, _dropLock: 0, _lockLen: 45,
  look: { bloom: 0.55, exposure: 1.0, vignette: 0.35, tint: new THREE.Color(1, 1, 1) },
  _tgt: { bloom: 0.55, exposure: 1.0, vignette: 0.35, tint: new THREE.Color(1, 1, 1) },
  _extra: { chroma: null, grain: null, blur: null, damage: null, flash: null },
  _damagePulse: 0, _kick: 0, _boostSm: 0, _blurSm: 0, _lowHp: 0,
  _flash: { color: new THREE.Color(1, 1, 1), alpha: 0, dur: 0.2, t: 1 },
  _time: 0, _updated: false, _w: 1, _h: 1, _tmpV: new THREE.Vector3(),

  init(ctx, mount) {
    this.ctx = ctx;
    mount = mount || document.body;
    this.mount = mount;
    const params = new URLSearchParams(location.search);
    const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance', stencil: false, alpha: false });
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.0;
    renderer.info.autoReset = false;
    renderer.domElement.style.display = 'block';
    renderer.domElement.style.width = '100%';
    renderer.domElement.style.height = '100%';
    mount.appendChild(renderer.domElement);
    ctx.renderer = renderer;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x02030a);
    ctx.scene = scene;
    const camera = new THREE.PerspectiveCamera(70, 1, 0.1, 4000);
    camera.position.set(0, 3, 12);
    ctx.camera = camera;

    try { scene.environment = makeEnvironment(renderer); scene.environmentIntensity = 0.7; } catch (e) { console.warn('env failed', e); }
    // gentle default fill in case the world adds no lights yet (world may remove it via scene.getObjectByName)
    const fill = new THREE.HemisphereLight(0xbcd0ff, 0x1a1c30, 0.5); fill.name = 'renderFill'; scene.add(fill);

    this.adaptive = !(params.has('noadapt') || window.__noAdaptive);
    const startQ = params.has('q') ? clamp(Number(params.get('q')) | 0, 0, QUALITY.length - 1) : 0;
    this._buildPipeline(startQ);
    this.resize();
    this._onResize = () => this.resize();
    addEventListener('resize', this._onResize);

    const ev = ctx.events;
    ev?.on?.('player:damage', (e) => {
      const a = clamp((e?.amount ?? 10) / 25, 0.35, 1);
      this._damagePulse = Math.max(this._damagePulse, a); this._kick = Math.max(this._kick, a);
    });
    ev?.on?.('player:boost', () => { this._kick = Math.max(this._kick, 0.25); });
    ev?.on?.('player:dead', () => { this._damagePulse = 1; this._kick = 1; });
    ev?.on?.('game:start', () => this.reset());
  },

  _buildPipeline(q) {
    const { renderer, scene, camera } = this.ctx;
    this.quality = q;
    const Q = QUALITY[q];
    renderer.setPixelRatio(Math.min(devicePixelRatio || 1, Q.pr));
    // ?nopost=1 (diagnosis): no composer at all, the scene is drawn straight to the canvas
    if (new URLSearchParams(location.search).has('nopost')) { this.composer = null; this.bloom = null; this.post = null; return; }
    try {
      // MSAA on the composer targets renders large black blocks on Apple GPUs (Metal via ANGLE), so the default is no MSAA
      // plus an FXAA pass for edges. ?msaa=rt2 and ?msaa=both stay available for comparison (tools/gpuflicker.mjs).
      const mode = new URLSearchParams(location.search).get('msaa') || 'off';
      let composer;
      if (mode === 'both') {
        const size = renderer.getDrawingBufferSize(new THREE.Vector2());
        const rt = new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType, samples: 4 });
        composer = new EffectComposer(renderer, rt);
      } else {
        composer = new EffectComposer(renderer);
        if (mode === 'rt2') composer.renderTarget2.samples = 4; // MSAA only on the buffer the scene renders into
      }
      composer.addPass(new RenderPass(scene, camera));
      // HDR values above the half-float range (very bright additive beams) turn into Inf or NaN and the bloom blur spreads
      // them into large black blocks on some GPUs, so sanitise and clamp the scene buffer before bloom reads it.
      const sanitize = new ShaderPass(SanitizeShader);
      composer.addPass(sanitize);
      this.sanitize = sanitize;
      const bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), this.look.bloom, 0.55, 0.9);
      composer.addPass(bloom);
      const post = new ShaderPass(PostShader);
      post.uniforms.uFlashColor.value = new THREE.Color(1, 1, 1);
      post.uniforms.uTint.value = new THREE.Color(1, 1, 1);
      composer.addPass(post);
      composer.addPass(new OutputPass());
      const fxaa = new ShaderPass(FXAAShader); // runs after tone mapping, on display-referred colour
      composer.addPass(fxaa);
      this.fxaa = fxaa;
      this.composer = composer; this.bloom = bloom; this.post = post;
      this._patchBloomSize(Q.bloom);
    } catch (e) {
      console.warn('[render] composer failed, using direct rendering', e);
      this.composer = null; this.bloom = null; this.post = null;
    }
  },

  _patchBloomSize(scale) {
    const b = this.bloom;
    if (!b) return;
    const proto = UnrealBloomPass.prototype.setSize;
    b.setSize = (w, h) => proto.call(b, Math.max(8, Math.round(w * scale)), Math.max(8, Math.round(h * scale)));
    b.enabled = QUALITY[this.quality].on;
  },

  setQuality(q) {
    q = clamp(q | 0, 0, QUALITY.length - 1);
    const { renderer } = this.ctx;
    this.quality = q;
    renderer.setPixelRatio(Math.min(devicePixelRatio || 1, QUALITY[q].pr));
    if (this.composer) { this.composer.setPixelRatio(renderer.getPixelRatio()); this._patchBloomSize(QUALITY[q].bloom); }
    this.resize();
    this._sinceChange = 0; this._slow = 0; this._fast = 0;
  },

  resize() {
    const { renderer, camera } = this.ctx;
    const w = this.mount === document.body ? innerWidth : (this.mount.clientWidth || innerWidth);
    const h = this.mount === document.body ? innerHeight : (this.mount.clientHeight || innerHeight);
    this._w = w; this._h = h;
    renderer.setSize(w, h, false);
    if (this.composer) { this.composer.setPixelRatio(renderer.getPixelRatio()); this.composer.setSize(w, h); }
    if (this.fxaa) { const pr = renderer.getPixelRatio(); this.fxaa.uniforms.resolution.value.set(1 / (w * pr), 1 / (h * pr)); }
    camera.aspect = w / h; camera.updateProjectionMatrix();
  },

  reset() {
    this._damagePulse = 0; this._kick = 0; this._flash.alpha = 0; this._flash.t = 1;
  },

  /** {bloom, exposure, vignette, tint}. tint: hex number, css string or THREE.Color. Smoothly blended. */
  setLevelLook(o = {}) {
    const t = this._tgt;
    if (o.bloom !== undefined) t.bloom = o.bloom;
    if (o.exposure !== undefined) t.exposure = o.exposure;
    if (o.vignette !== undefined) t.vignette = o.vignette;
    if (o.tint !== undefined) t.tint.set(o.tint);
    if (o.immediate) { this.look.bloom = t.bloom; this.look.exposure = t.exposure; this.look.vignette = t.vignette; this.look.tint.copy(t.tint); }
  },

  /** transient overrides: {chroma, grain, blur, damage, flash} (null to release). */
  setPost(o = {}) { Object.assign(this._extra, o); },

  flash(color = '#ffffff', alpha = 0.4, duration = 0.2) {
    const f = this._flash;
    if (alpha < f.alpha * (1 - f.t / Math.max(f.dur, 1e-3))) return; // do not weaken a stronger running flash
    f.color.set(color); f.alpha = alpha; f.dur = Math.max(0.02, duration); f.t = 0;
  },

  update(dt, ctx = this.ctx) {
    this._updated = true;
    this._time += dt;
    const L = this.look, T = this._tgt, k = 1 - Math.exp(-2.5 * dt);
    L.bloom += (T.bloom - L.bloom) * k; L.exposure += (T.exposure - L.exposure) * k; L.vignette += (T.vignette - L.vignette) * k;
    L.tint.r += (T.tint.r - L.tint.r) * k; L.tint.g += (T.tint.g - L.tint.g) * k; L.tint.b += (T.tint.b - L.tint.b) * k;

    const pl = ctx?.player, rail = ctx?.rail, st = ctx?.state;
    const base = rail?.baseSpeed ?? 40, boostSpd = ctx?.config?.rail?.boostSpeed ?? 75;
    const spd = rail ? clamp((rail.speed - base) / Math.max(1, boostSpd - base), 0, 1) : 0;
    const boosting = pl?.isBoosting ? 1 : 0;
    this._boostSm = damp(this._boostSm, Math.max(boosting, spd), boosting ? 6 : 3, dt);
    this._blurSm = this._boostSm;
    this._damagePulse = Math.max(0, this._damagePulse - dt * 1.7);
    this._kick = Math.max(0, this._kick - dt * 3.5);
    const hp = st ? st.health / Math.max(1, st.maxHealth || 100) : 1;
    const low = hp < 0.3 && st?.phase === 'playing' ? (1 - hp / 0.3) * (0.5 + 0.5 * Math.sin(this._time * 6.5)) * 0.35 : 0;
    this._lowHp = damp(this._lowHp, low, 10, dt);

    const f = this._flash;
    f.t += dt / f.dur;
    const flashAmt = f.t < 1 ? f.alpha * (1 - f.t) * (1 - f.t * 0.3) : 0;

    if (this.post) {
      const u = this.post.uniforms, e = this._extra;
      u.uTime.value = this._time;
      u.uVignette.value = L.vignette + this._damagePulse * 0.15;
      // speed effects come from speedfx (blur amount, extra chroma) and are tunable in feel.p.speed; the hit kick stays here.
      // Quality tiers: 3 taps from tier 3, no speed blur from tier 4 (the effects drop before bloom does).
      const sfx = ctx.speedfx, sp = ctx.feel?.p?.speed, q = this.quality;
      u.uChroma.value = (e.chroma ?? (0.0007 + this._kick * 0.006)) + (sfx ? sfx.chroma : this._boostSm * 0.0028);
      u.uGrain.value = e.grain ?? 0.03;
      u.uBlur.value = e.blur ?? (q >= 4 ? 0 : sfx ? sfx.blur : this._blurSm * 0.85);
      u.uTaps.value = q >= 3 ? 3 : 6;
      if (sp) { u.uBlurReach.value = sp.blurStrength; u.uBlurClear.value = sp.blurClear; }
      u.uDamage.value = e.damage ?? clamp(this._damagePulse * 0.85 + this._lowHp, 0, 1);
      u.uFlash.value = e.flash ?? clamp(flashAmt, 0, 1);
      u.uFlashColor.value.copy(f.color);
      u.uTint.value.copy(L.tint);
      // less bloom while a boss is up, so the boss and its weak points stay readable through beams and shots
      const bossUp = (st?.boss?.hp ?? 0) > 0 ? 1 : 0;
      this._bossSm = damp(this._bossSm ?? 0, bossUp, 2.5, dt);
      this.bloom.strength = L.bloom * (1 + this._boostSm * 0.1) * (1 - 0.4 * this._bossSm);
    }
    ctx.renderer.toneMappingExposure = L.exposure;
  },

  render(dt = 1 / 60) {
    const ctx = this.ctx;
    if (!ctx) return;
    // Quality changes resize the canvas, which clears it. They are requested from _adapt (after the draw) and applied here,
    // before drawing, so the frame that follows a resize is never presented blank.
    if (this._pendingQ >= 0) {
      const q = this._pendingQ, up = q < this.quality; this._pendingQ = -1;
      if (q !== this.quality) { this.setQuality(q); if (up) this._sinceChange = -6; }
    }
    if (!this._updated) this.update(Math.min(dt, 0.1), ctx);
    this._updated = false;
    const { renderer, scene, camera } = ctx;

    // camera shake (applied around the draw, so cameraRig positions stay clean)
    const fx = ctx.fx;
    let so = null, roll = 0;
    // the real cameraRig already adds fx.shakeOffset to its position, so only the roll is applied here in that case
    const rigOwnsOffset = ctx.cameraRig && ('trauma' in ctx.cameraRig || ctx.cameraRig.appliesShake);
    if (fx?.shakeOffset && !ctx.cameraRig?.appliesShakeRoll) { so = rigOwnsOffset ? null : fx.shakeOffset; roll = fx.shakeRoll || 0; }
    if (so) camera.position.add(so);
    if (roll) camera.rotateZ(roll);

    renderer.info.reset();
    const now0 = performance.now();
    const wall = this._lastWall ? now0 - this._lastWall : 16; this._lastWall = now0;
    if (this.composer) {
      try { this.composer.render(dt); } catch (e) {
        console.warn('[render] composer error, falling back', e);
        this.composer = null; this.post = null; this.bloom = null;
        renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 1.5)); this.resize();
        renderer.render(scene, camera);
      }
    } else {
      renderer.render(scene, camera);
    }
    if (roll) camera.rotateZ(-roll);
    if (so) camera.position.sub(so);
    this._adapt(wall / 1000);
  },

  // Adaptive quality: uses the wall clock frame interval (immune to hit stop time scaling).
  _adapt(dt) {
    if (!this.adaptive) return;
    const ms = dt * 1000;
    if (ms > 200 || ms <= 0) return; // ignore tab switches and pauses
    this.avgMs += (ms - this.avgMs) * 0.05;
    this._sinceChange += dt;
    if (this._dropLock > 0) this._dropLock -= dt;
    if (this._sinceChange < 2.5) return;
    // A step down that did not make frames clearly faster means the frame rate is capped from outside (30 Hz display, browser
    // energy saver), not limited by the GPU. Undo it and stop dropping for a while, the lock doubles on each repeat.
    if (this._stepFrom) {
      const f = this._stepFrom; this._stepFrom = null;
      if (this.quality === f.q + 1 && this.avgMs > f.ms * 0.92) {
        this._pendingQ = f.q; this._dropLock = this._lockLen; this._lockLen = Math.min(600, this._lockLen * 2);
        return;
      }
    }
    if (this.avgMs > 24 && this.quality < QUALITY.length - 1 && this._dropLock <= 0) {
      this._slow += dt;
      if (this._slow > 1.2) { this._stepFrom = { q: this.quality, ms: this.avgMs }; this._pendingQ = this.quality + 1; this._slow = 0; this._sinceChange = 0; }
    } else { this._slow = 0; }
    if (this.avgMs < 12.5 && this.quality > 0) {
      this._fast += dt;
      if (this._fast > 12) { this._pendingQ = this.quality - 1; this._fast = 0; }
    } else { this._fast = 0; }
  },


  /** small stats blob for debugging */
  stats() {
    const i = this.ctx.renderer.info;
    return { calls: i.render.calls, triangles: i.render.triangles, geometries: i.memory.geometries, textures: i.memory.textures, quality: this.quality, avgMs: +this.avgMs.toFixed(1), composer: !!this.composer };
  },

  dispose() { removeEventListener('resize', this._onResize); this.composer?.dispose?.(); },
};
