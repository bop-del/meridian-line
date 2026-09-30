// Rendering pipeline: WebGLRenderer + EffectComposer and the post chain, adaptive quality, camera shake application and full screen
// flash / damage pulse.
//
// Post chain (every pass tier gated through render.tier, see src/render/tiers.js, and NaN safe):
//   ScenePass      scene into its own HDR target with a depth texture (render.depthTexture)
//   SanitizeFog    NaN/Inf removal and HDR ceiling (must stay first), far only depth of field (tier.dof), height fog and
//                  aerial depth from depth (tier.fog), all in one full screen pass
//   Bloom          soft knee threshold plus a cap on what enters the glow, per level strength                  tier.on, tier.bloom
//   SunPass        low resolution: shaft mask, sun visibility and mean luminance (scene plus glow), radial shafts from
//                  ctx.world.sky.getSuns() plus lens flare                                                     tier.shafts, tier.flare
//   PostShader     speed blur, chroma, + bloom, + shafts and flare, white-out guard, ACES, per level grade, vignette, damage,
//                  flash, grain                                                                                tier.grade
//   OutputPass     sRGB encode only (renderer.toneMapping is NoToneMapping while the composer runs, the tone curve is in PostShader)
//   FXAA
// Look values come from the feel registry group `look` (src/feel/look.js), per level through ctx.world.theme.
// ?nopost=1 draws the scene straight to the canvas with ACES from the renderer.
//
// API: render.render(dt) applies fx.shakeRoll (and fx.shakeOffset if the cameraRig does not already add it,
// detected by cameraRig.trauma or cameraRig.appliesShake) to the camera around the draw call. render.flash(css, alpha, dur)
// is the screen flash used by fx.flash. render.update(dt, ctx) is optional: render(dt) runs it itself if needed.
// render.setLevelLook(o) blends to a level look (registry values win for the shipped levels, o is the fallback for others).
// render.setPost({ chroma, grain, blur, damage, flash, bloomScale, shaftsScale, flareScale, fogScale }) transient overrides, null releases.
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { FXAAShader } from 'three/addons/shaders/FXAAShader.js';
import { PostShader } from './postShader.js';
import { makeEnvironment } from './environment.js';
import { QUALITY, adapt as adaptQuality } from './tiers.js';
import { ScenePass } from './passes/scenePass.js';
import { SanitizeFogShader } from './passes/fogPass.js';
import { SunPass } from './passes/sunPass.js';
import { MeridianBloomPass } from './passes/bloomPass.js';
import { feel as feelRegistry } from '../core/feel.js';
import { LEVEL_DEFAULTS } from '../feel/look.js';

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const damp = (cur, target, rate, dt) => cur + (target - cur) * (1 - Math.exp(-rate * dt));
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const LOOK_KEYS = Object.keys(LEVEL_DEFAULTS.thalassa).filter((k) => !/Hue$|Tint$/.test(k));
// hue in degrees to a zero average colour offset (full saturation, mid lightness), used for the split tone tints
const hueOffset = (h, out) => {
  const f = (n) => { const k = (n + h / 30) % 12; return 0.5 - 0.5 * Math.max(-1, Math.min(k - 3, 9 - k, 1)); };
  const r = f(0), g = f(8), b = f(4), m = (r + g + b) / 3;
  return out.set(r - m, g - m, b - m);
};
const _hv = new THREE.Vector3();

export const render = {
  ctx: null, composer: null, bloom: null, post: null, mount: null, scenePass: null, sanitize: null, sun: null,
  quality: 0, tier: QUALITY[0], adaptive: true, avgMs: 16, _slow: 0, _fast: 0, _sinceChange: 0,
  _pendingQ: -1, _stepFrom: null, _dropLock: 0, _lockLen: 45,
  // live look (blended toward the registry values of the current level), bloom/exposure/vignette/tint keep their round 1 names
  look: { ...LEVEL_DEFAULTS.thalassa, tint: new THREE.Color(1, 1, 1), shadowCol: new THREE.Vector3(1, 1, 1), highCol: new THREE.Vector3(1, 1, 1) },
  _lvl: {}, _lvlTint: new THREE.Color(1, 1, 1), _snap: true,
  _extra: { chroma: null, grain: null, blur: null, damage: null, flash: null, bloomScale: null, shaftsScale: null, flareScale: null, fogScale: null },
  _damagePulse: 0, _kick: 0, _boostSm: 0, _blurSm: 0, _lowHp: 0, _bossSm: 0,
  _flash: { color: new THREE.Color(1, 1, 1), alpha: 0, dur: 0.2, t: 1 },
  _time: 0, _updated: false, _w: 1, _h: 1, _tmpV: new THREE.Vector3(),
  _sun: [new THREE.Vector3(), new THREE.Vector3()], _sunCol: [new THREE.Color(0, 0, 0), new THREE.Color(0, 0, 0)],
  _sunDir: [new THREE.Vector3(0, 0, -1), new THREE.Vector3(0, 0, -1)], _sunFogCol: [new THREE.Color(0, 0, 0), new THREE.Color(0, 0, 0)],
  _reticle: new THREE.Vector2(0.5, 0.5), _fwd: new THREE.Vector3(),

  /** depth of the scene drawn this frame (composer path only, null with ?nopost=1) */
  get depthTexture() { return this.scenePass?.depthTexture ?? null; },

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
    this.quality = q; this.tier = QUALITY[q];
    const Q = QUALITY[q];
    renderer.setPixelRatio(Math.min(devicePixelRatio || 1, Q.pr));
    // ?nopost=1 (diagnosis): no composer at all, the scene is drawn straight to the canvas
    if (new URLSearchParams(location.search).has('nopost')) { this._noComposer(); return; }
    // half float render targets need one of these extensions in WebGL2, without them the composer would give a black screen
    if (!renderer.extensions.has('EXT_color_buffer_float') && !renderer.extensions.has('EXT_color_buffer_half_float')) {
      console.warn('[render] no float render targets, drawing without post-processing');
      this._noComposer(); return;
    }
    try {
      // MSAA on the composer targets renders large black blocks on Apple GPUs (Metal via ANGLE), so the default is no MSAA
      // plus an FXAA pass for edges. ?msaa=rt2 (or both) puts 4x MSAA on the scene target only, for comparison (tools/gpuflicker.mjs).
      const mode = new URLSearchParams(location.search).get('msaa') || 'off';
      const composer = new EffectComposer(renderer);
      const scenePass = new ScenePass(scene, camera);
      if (mode === 'rt2' || mode === 'both') scenePass.target.samples = 4;
      composer.addPass(scenePass);
      // Sanitise first (NaN/Inf to black, HDR ceiling) so bloom never spreads a bad value into black blocks; the height fog rides along.
      // It reads the scene target directly (textureID 'none': the composer read buffer is not used).
      const sanitize = new ShaderPass(SanitizeFogShader, 'none');
      const su = sanitize.uniforms;
      su.tDiffuse.value = scenePass.target.texture; su.tDepth.value = scenePass.depthTexture;
      su.uInvProj.value = camera.projectionMatrixInverse; su.uCamWorld.value = camera.matrixWorld;
      su.uFogColor.value = new THREE.Color(0.5, 0.6, 0.7);
      su.uSunDir0.value = this._sunDir[0]; su.uSunDir1.value = this._sunDir[1];
      su.uSunCol0.value = this._sunFogCol[0]; su.uSunCol1.value = this._sunFogCol[1];
      composer.addPass(sanitize);
      su.uDofRadius.value = new THREE.Vector2(0.001, 0.002);
      const sun = new SunPass();
      sun.tDepth = scenePass.depthTexture;
      sun.sunUniforms.uSun0.value = this._sun[0]; sun.sunUniforms.uSun1.value = this._sun[1];
      const bloom = new MeridianBloomPass(new THREE.Vector2(256, 256), this.look.bloom, 0.5, 1.0);
      composer.addPass(bloom);
      sun.bloom = bloom;
      composer.addPass(sun);
      const post = new ShaderPass(PostShader);
      const pu = post.uniforms;
      pu.uFlashColor.value = new THREE.Color(1, 1, 1);
      pu.uTint.value = new THREE.Color(1, 1, 1);
      pu.tBloom.value = bloom.texture; pu.tShafts.value = sun.shaftTexture; pu.tVis.value = sun.visTexture; sun.visUniform = pu.tVis;
      sun.shaft.uniforms.uFlareCol0.value = this._sunCol[0]; sun.shaft.uniforms.uFlareCol1.value = this._sunCol[1];
      sun.shaft.uniforms.uReticle.value = this._reticle;
      pu.uShadowTint.value = this.look.shadowCol; pu.uHighTint.value = this.look.highCol;
      composer.addPass(post);
      composer.addPass(new OutputPass());
      const fxaa = new ShaderPass(FXAAShader); // runs after the tone curve, on display referred colour
      composer.addPass(fxaa);
      this.fxaa = fxaa;
      this.composer = composer; this.bloom = bloom; this.post = post;
      this.scenePass = scenePass; this.sanitize = sanitize; this.sun = sun;
      // the tone curve lives in PostShader; OutputPass only encodes sRGB. Scene materials never tone map into a render target.
      renderer.toneMapping = THREE.NoToneMapping;
      this._patchBloomSize(Q.bloom);
    } catch (e) {
      console.warn('[render] composer failed, using direct rendering', e);
      this._noComposer();
    }
  },

  _noComposer() {
    this.composer = null; this.bloom = null; this.post = null; this.scenePass = null; this.sanitize = null; this.sun = null;
    this.ctx.renderer.toneMapping = THREE.ACESFilmicToneMapping;
  },

  _patchBloomSize(scale) {
    const b = this.bloom;
    if (!b) return;
    const proto = MeridianBloomPass.prototype.setSize;
    b.setSize = (w, h) => proto.call(b, Math.max(8, Math.round(w * scale)), Math.max(8, Math.round(h * scale)));
    b.enabled = QUALITY[this.quality].on;
  },

  setQuality(q) {
    q = clamp(q | 0, 0, QUALITY.length - 1);
    const { renderer } = this.ctx;
    this.quality = q; this.tier = QUALITY[q];
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
    renderer.setPixelRatio(Math.min(devicePixelRatio || 1, (this.tier || QUALITY[0]).pr));   // follows browser zoom and moving the window between screens
    renderer.setSize(w, h, false);
    if (this.composer) { this.composer.setPixelRatio(renderer.getPixelRatio()); this.composer.setSize(w, h); }
    if (this.fxaa) { const pr = renderer.getPixelRatio(); this.fxaa.uniforms.resolution.value.set(1 / (w * pr), 1 / (h * pr)); }
    camera.aspect = w / h; camera.updateProjectionMatrix();
  },

  reset() {
    this._damagePulse = 0; this._kick = 0; this._flash.alpha = 0; this._flash.t = 1;
  },

  /**
   * Level look. For the shipped levels the values come from the feel registry (src/feel/look.js, per level keys), so o only
   * supplies tint and the fallback for a level id without registry defaults. Accepted keys: bloom, exposure, vignette, tint (hex,
   * css or Color), any per level look key (shafts, flare, dof, fogDensity, contrast, ...), grade: { contrast, saturation, lift,
   * gamma, gain }, heightFog: { density, falloff }, immediate (snap instead of the half second blend).
   */
  setLevelLook(o = {}) {
    const lv = {};
    for (const k of LOOK_KEYS) if (typeof o[k] === 'number') lv[k] = o[k];
    if (o.grade) for (const k of ['contrast', 'saturation', 'lift', 'gamma', 'gain']) if (typeof o.grade[k] === 'number') lv[k] = o.grade[k];
    if (o.heightFog) { if (typeof o.heightFog.density === 'number') lv.fogDensity = o.heightFog.density; if (typeof o.heightFog.falloff === 'number') lv.fogFalloff = o.heightFog.falloff; }
    this._lvl = lv;
    this._lvlTint.set(o.tint !== undefined ? o.tint : 0xffffff);
    if (o.immediate) this._snap = true;
  },

  /** transient overrides: {chroma, grain, blur, damage, flash} replace, {bloomScale, shaftsScale, flareScale, fogScale} multiply. null releases. */
  setPost(o = {}) { Object.assign(this._extra, o); },

  flash(color = '#ffffff', alpha = 0.4, duration = 0.2) {
    const f = this._flash;
    alpha = Math.min(alpha, 0.8);   // never a fully blank frame, the ship and the boss stay visible under the strongest flash
    if (alpha < f.alpha * (1 - f.t / Math.max(f.dur, 1e-3))) return; // do not weaken a stronger running flash
    f.color.set(color); f.alpha = alpha; f.dur = Math.max(0.02, duration); f.t = 0;
  },

  /** blend the live look toward the registry values of the current level */
  _updateLook(dt, ctx) {
    const P = (ctx?.feel ?? feelRegistry).p.look || {};
    const theme = ctx?.world?.theme || 'thalassa';
    const D = LEVEL_DEFAULTS[theme] || LEVEL_DEFAULTS.thalassa;
    const L = this.look, lv = this._lvl;
    const k = this._snap ? 1 : 1 - Math.exp(-5 * Math.min(dt, 0.1));
    this._snap = false;
    const get = (key) => { const v = P[`${theme}_${key}`]; return typeof v === 'number' ? v : typeof lv[key] === 'number' ? lv[key] : D[key]; };
    for (const key of LOOK_KEYS) L[key] += (get(key) - L[key]) * k;
    const tint = (hueKey, amtKey, out) => {
      hueOffset(get(hueKey), _hv).multiplyScalar(2 * get(amtKey)).addScalar(1);
      out.lerp(_hv, k);
    };
    tint('shadowHue', 'shadowTint', L.shadowCol);
    tint('highlightHue', 'highlightTint', L.highCol);
    L.tint.lerp(this._lvlTint, k);
    return P;
  },

  update(dt, ctx = this.ctx) {
    this._updated = true;
    this._time += dt;
    const P = this._updateLook(dt, ctx);
    const L = this.look;

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
    // less bloom, shafts and flare while a boss is up, so the boss and its weak points stay readable through beams and shots
    const bossUp = (st?.boss?.hp ?? 0) > 0 ? 1 : 0;
    this._bossSm = damp(this._bossSm, bossUp, 2.5, dt);

    const f = this._flash;
    f.t += dt / f.dur;
    const flashAmt = f.t < 1 ? f.alpha * (1 - f.t) * (1 - f.t * 0.3) : 0;

    if (this.post) {
      const u = this.post.uniforms, e = this._extra, T = this.tier;
      const fxCut = 1 - (P.bossFxCut ?? 0.5) * this._bossSm;
      u.uTime.value = this._time;
      u.uVignette.value = L.vignette + this._damagePulse * 0.15;
      // speed effects come from speedfx (blur amount, extra chroma) and are tunable in feel.p.speed; the hit kick stays here.
      // Quality tiers: 3 taps from tier 3, no speed blur from tier 4 (the effects drop before bloom does).
      const sfx = ctx.speedfx, sp = ctx.feel?.p?.speed, q = this.quality;
      u.uChroma.value = (e.chroma ?? (0.0007 + this._kick * 0.006)) + (sfx ? sfx.chroma : this._boostSm * 0.0028);
      u.uGrain.value = e.grain ?? (P.grain ?? 0.022);
      u.uBlur.value = e.blur ?? (q >= 4 ? 0 : sfx ? sfx.blur : this._blurSm * 0.85);
      u.uTaps.value = q >= 3 ? 3 : 6;
      if (sp) { u.uBlurReach.value = sp.blurStrength; u.uBlurClear.value = sp.blurClear; }
      u.uDamage.value = e.damage ?? clamp(this._damagePulse * 0.85 + this._lowHp, 0, 1);
      u.uFlash.value = e.flash ?? clamp(flashAmt, 0, 1);
      u.uFlashColor.value.copy(f.color);
      u.uTint.value.copy(L.tint);
      u.uExposure.value = Math.max(0.01, L.exposure);
      u.uGuard.value = L.whiteoutGuard;
      u.uGradeOn.value = T.grade ? 1 : 0;
      u.uLift.value = L.lift; u.uGamma.value = L.gamma; u.uGain.value = L.gain; u.uContrast.value = L.contrast; u.uSat.value = L.saturation;

      // bloom: per level strength, soft knee and cap
      const b = this.bloom;
      b.strength = L.bloom * (1 + this._boostSm * 0.1) * (1 - (P.bossBloomCut ?? 0.35) * this._bossSm) * (e.bloomScale ?? 1);
      b.threshold = L.bloomThreshold; b.knee = L.bloomKnee; b.cap = L.bloomCap; b.radius = L.bloomRadius;
      u.uBloomOn.value = b.enabled ? 1 : 0;

      // light shafts and flare
      const shafts = T.shafts > 0 ? L.shafts * fxCut * (e.shaftsScale ?? 1) : 0;
      const flare = T.flare ? L.flare * fxCut * (e.flareScale ?? 1) : 0;
      const sun = this.sun;
      sun.shaftsOn = shafts > 0.001 ? 1 : 0; sun.flareOn = flare > 0.001 ? 1 : 0;
      sun.setScale(T.shafts);
      sun.mask.uniforms.uThr.value = L.shaftsThreshold;
      sun.shaft.uniforms.uLength.value = L.shaftsLength;
      sun.shaft.uniforms.uTime.value = this._time;
      sun.shafts = shafts; sun.flare = flare;
      sun.shaft.uniforms.uFlareStreak.value = P.flareStreak ?? 0.6; sun.shaft.uniforms.uClear.value = P.flareClear ?? 0.14;
      u.uShaftsOn.value = sun.shaftsOn || sun.flareOn ? 1 : 0;

      // height fog and aerial depth
      const su = this.sanitize.uniforms, fs = e.fogScale ?? 1;
      su.uMax.value = P.hdrMax ?? 24;
      su.uFogOn.value = T.fog && (L.fogDensity > 0 || L.fogDistance > 0) ? 1 : 0;
      su.uHDensity.value = L.fogDensity * fs; su.uHFalloff.value = L.fogFalloff; su.uDist.value = L.fogDistance * fs;
      su.uSunFog.value = L.fogSun; su.uSkyAmt.value = L.fogSky;
      su.uStart.value = P.fogStart ?? 40; su.uFogMax.value = P.fogMax ?? 0.85;
      su.uFloorY.value = ctx.world?.floorY ?? -26;
      const fog = ctx.scene?.fog;
      if (fog?.color) su.uFogColor.value.copy(fog.color);
      else if (ctx.scene?.background?.isColor) su.uFogColor.value.copy(ctx.scene.background);

      // far blur (tier 0 only)
      const dofAmt = T.dof ? L.dof * fxCut : 0;
      su.uDofAmt.value = dofAmt > 0.01 ? dofAmt : 0; su.uDofStart.value = P.dofStart ?? 90; su.uDofRange.value = P.dofRange ?? 500;
      su.uNear.value = ctx.camera.near; su.uFar.value = ctx.camera.far;
      const rad = (P.dofRadius ?? 2.2) / 1080;
      su.uDofRadius.value.set(rad * this._h / Math.max(1, this._w), rad);
    }
    ctx.renderer.toneMappingExposure = L.exposure;
  },

  /** sun screen positions, colours and the reticle position for shafts, flare and fog (after the camera shake is applied) */
  _updateSuns(ctx) {
    const cam = ctx.camera, suns = ctx.world?.sky?.getSuns?.() || [];
    cam.updateMatrixWorld();
    cam.getWorldDirection(this._fwd);
    const v = this._tmpV;
    let maxSize = 0;
    for (const s of suns) maxSize = Math.max(maxSize, s.size || 0);
    for (let i = 0; i < 2; i++) {
      const s = suns[i], o = this._sun[i];
      if (!s || !s.dir) { o.set(0, 0, 0); this._sunCol[i].setRGB(0, 0, 0); this._sunFogCol[i].setRGB(0, 0, 0); continue; }
      const facing = s.dir.dot(this._fwd);
      v.copy(s.dir).multiplyScalar(1000).add(cam.position).project(cam);
      const edge = Math.max(Math.abs(v.x), Math.abs(v.y));
      const w = facing > 0 ? smooth(0.05, 0.3, facing) * clamp(1 - (edge - 1) / 0.35, 0, 1) : 0;
      const sz = maxSize > 0 ? clamp((s.size || maxSize) / maxSize, 0.4, 1) : 1;
      o.set(v.x * 0.5 + 0.5, v.y * 0.5 + 0.5, Number.isFinite(v.x + v.y) ? w * sz : 0);
      // flare colour: the sun colour normalised to its brightest channel
      const c = s.color, m = Math.max(1e-3, c.r, c.g, c.b);
      this._sunCol[i].setRGB(c.r / m, c.g / m, c.b / m).multiplyScalar(sz);
      this._sunDir[i].copy(s.dir);
      this._sunFogCol[i].setRGB(c.r / m, c.g / m, c.b / m).multiplyScalar(0.5 * sz);
    }
    const ret = ctx.player?.reticleFar;
    if (ret && ctx.player?.alive !== false) {
      v.copy(ret).project(cam);
      if (Number.isFinite(v.x + v.y) && v.z < 1) this._reticle.set(v.x * 0.5 + 0.5, v.y * 0.5 + 0.5); else this._reticle.set(0.5, 0.5);
    } else this._reticle.set(0.5, 0.5);
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
      try { this._updateSuns(ctx); this.composer.render(dt); } catch (e) {
        console.warn('[render] composer error, falling back', e);
        this._noComposer();
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

  // Adaptive quality: the controller lives in src/render/tiers.js (wall clock frame interval, immune to hit stop time scaling).
  _adapt(dt) { adaptQuality(this, dt); },

  /** small stats blob for debugging */
  stats() {
    const i = this.ctx.renderer.info;
    return { calls: i.render.calls, triangles: i.render.triangles, geometries: i.memory.geometries, textures: i.memory.textures, quality: this.quality, avgMs: +this.avgMs.toFixed(1), composer: !!this.composer };
  },

  dispose() { removeEventListener('resize', this._onResize); this.composer?.dispose?.(); },
};
