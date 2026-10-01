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
// ?nofloat=1 pretends the GPU has no half float render targets (debug): the game then takes the same path as a device without
// them, a scene draw with ACES from the renderer plus one cheap grade pass (see FALLBACK_FRAG): copy of the canvas, FXAA-lite edge
// smoothing, lift/gamma/gain/contrast/saturation and tints, vignette, damage pulse, flash and grain. No bloom, fog, shafts or flare.
// Touch devices (device.touch): start tier from tiers.js (phones 1, tablets 2), adaptive quality goes down only, resize events are
// debounced, and a lost WebGL context pauses the game and rebuilds the pipeline when the browser gives it back (render.lostCount).
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
import { FullScreenQuad } from 'three/addons/postprocessing/Pass.js';
import { FXAAShader } from 'three/addons/shaders/FXAAShader.js';
import { PostShader } from './postShader.js';
import { makeEnvironment } from './environment.js';
import { QUALITY, adapt as adaptQuality, startTier } from './tiers.js';
import { device } from '../core/device.js';
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

// Fallback grade (no half float render targets, or the composer failed): the scene is drawn straight to the canvas (ACES and sRGB
// from the renderer), then this pass reads a copy of the canvas and writes the graded result back over it. It works on display
// values, the grade maths is the one of PostShader (perceptual space = square root of linear light), so the level looks stay close.
const FALLBACK_FRAG = /* glsl */ `
  uniform sampler2D tColor;
  uniform vec2 uTexel;
  uniform float uGradeOn, uLift, uGamma, uGain, uContrast, uSat, uVignette, uDamage, uFlash, uGrain, uTime;
  uniform vec3 uShadowTint, uHighTint, uTint, uFlashColor;
  varying vec2 vUv;
  float hash(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
  vec3 toLin(vec3 e) { return mix(e / 12.92, pow((e + 0.055) / 1.055, vec3(2.4)), step(0.04045, e)); }
  vec3 toSrgb(vec3 l) { l = clamp(l, 0.0, 1.0); return mix(l * 12.92, 1.055 * pow(l, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, l)); }
  float luma(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }
  void main() {
    vec2 c = vUv - 0.5;
    float d0 = length(c) * 1.4142;
    vec3 m = texture2D(tColor, vUv).rgb;
    // FXAA-lite: where the local contrast is high, blend toward the four neighbours (one pass, five fetches)
    vec3 n = texture2D(tColor, vUv + vec2(0.0, uTexel.y)).rgb, s = texture2D(tColor, vUv - vec2(0.0, uTexel.y)).rgb;
    vec3 e = texture2D(tColor, vUv + vec2(uTexel.x, 0.0)).rgb, w = texture2D(tColor, vUv - vec2(uTexel.x, 0.0)).rgb;
    float lm = luma(m);
    float edge = max(max(abs(luma(n) - lm), abs(luma(s) - lm)), max(abs(luma(e) - lm), abs(luma(w) - lm)));
    m = mix(m, (m + n + s + e + w) * 0.2, smoothstep(0.05, 0.25, edge) * 0.65);
    vec3 col = toLin(m) * uTint;
    if (uGradeOn > 0.5) {
      vec3 p = sqrt(clamp(col, 0.0, 1.0));
      p = uGain * (p + uLift * (1.0 - p));
      p = pow(max(p, vec3(1e-5)), vec3(1.0 / max(uGamma, 0.05)));
      p = (p - 0.5) * uContrast + 0.5;
      float l = dot(p, vec3(0.2126, 0.7152, 0.0722));
      p = max(mix(vec3(l), p, uSat), 0.0);
      l = clamp(dot(p, vec3(0.2126, 0.7152, 0.0722)), 0.0, 1.0);
      p *= mix(uShadowTint, uHighTint, smoothstep(0.08, 0.85, l));
      p = clamp(p, 0.0, 1.0);
      col = p * p;
    }
    col *= 1.0 - uVignette * smoothstep(0.3, 1.05, d0);
    if (uDamage > 0.001) {
      float ed = smoothstep(0.15, 1.0, d0);
      col = mix(col, vec3(0.75, 0.02, 0.015) * (0.45 + 0.55 * ed), uDamage * (0.04 + 0.42 * ed * ed));
    }
    vec3 pg = sqrt(clamp(col, 0.0, 1.0));
    pg += (hash(vUv * 1531.7 + fract(uTime) * 91.3) - 0.5) * uGrain * (0.5 + 0.5 * (1.0 - clamp(dot(pg, vec3(0.333)), 0.0, 1.0)));
    if (uFlash > 0.001) pg = mix(pg, sqrt(clamp(uFlashColor, 0.0, 1.0)), min(uFlash * 0.85, 0.8));
    gl_FragColor = vec4(toSrgb(clamp(pg, 0.0, 1.0) * clamp(pg, 0.0, 1.0)), 1.0);
  }`;

export const render = {
  ctx: null, composer: null, bloom: null, post: null, mount: null, scenePass: null, sanitize: null, sun: null,
  quality: 0, tier: QUALITY[0], adaptive: true, avgMs: 16, _slow: 0, _fast: 0, _sinceChange: 0,
  _pendingQ: -1, _stepFrom: null, _dropLock: 0, _lockLen: 45,
  // touch devices: mobile switches the down only controller on (tiers.js), the rest is its state
  mobile: false, _capLocked: false, _lockMs: 0, _slowLocked: 0, _unlocks: 0,
  // context loss and capability state, read by src/dev/phonediag.js
  lost: false, lostCount: 0, floatExt: '', fallback: '', _sizeKey: '', _fb: null, _resizeT: 0, _lostT: 0, _pausedByLoss: false, _notice: null,
  // live look (blended toward the registry values of the current level), bloom/exposure/vignette/tint keep their original names
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
    this.mobile = device.touch;
    const startQ = params.has('q') ? clamp(Number(params.get('q')) | 0, 0, QUALITY.length - 1) : startTier();
    if (this.mobile) this._sinceChange = -3;   // shader compiles and the first level load must not count as a slow GPU
    this._buildPipeline(startQ);
    this.resize();
    // Resize events: desktop reallocates at once (only when the size or ratio really changed, see resize). On touch devices
    // rotation and the toolbar animation fire a burst of them: the camera follows at once, the targets wait for the burst to end.
    this._onResize = () => {
      if (!this.mobile) { this.resize(); return; }
      clearTimeout(this._resizeT);
      this._resizeT = setTimeout(() => this.resize(), 160);
      this._aspectNow();
    };
    addEventListener('resize', this._onResize);
    if (this.mobile) addEventListener('orientationchange', this._onResize);
    this._initContextLoss(renderer.domElement);

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
    const qp = new URLSearchParams(location.search);
    const ext = renderer.extensions;
    this.floatExt = [ext.has('EXT_color_buffer_float') && 'float', ext.has('EXT_color_buffer_half_float') && 'half'].filter(Boolean).join('+') || 'none';
    this.fallback = '';
    // ?nopost=1 (diagnosis): no composer at all, the scene is drawn straight to the canvas
    if (qp.has('nopost')) { this._noComposer(); this.fallback = 'nopost'; return; }
    // half float render targets need one of these extensions in WebGL2, without them the composer would give a black screen.
    // ?nofloat=1 pretends they are missing, to look at the fallback on a desktop GPU.
    if (qp.has('nofloat') || this.floatExt === 'none') {
      console.warn('[render] no float render targets, using the cheap grade pass instead of the post chain');
      this._buildFallback(qp.has('nofloat') ? 'forced by ?nofloat=1' : 'no float render targets'); return;
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
      this._buildFallback('composer failed: ' + (e && e.message ? e.message : e));
    }
  },

  /** no post chain: scene straight to the canvas plus the cheap grade pass (FALLBACK_FRAG). reason is shown by phonediag */
  _buildFallback(reason) {
    this._noComposer();
    this.fallback = reason;
    try {
      const u = {
        tColor: { value: null }, uTexel: { value: new THREE.Vector2() }, uGradeOn: { value: 1 }, uLift: { value: 0 }, uGamma: { value: 1 },
        uGain: { value: 1 }, uContrast: { value: 1 }, uSat: { value: 1 }, uVignette: { value: 0.35 }, uDamage: { value: 0 }, uFlash: { value: 0 },
        uGrain: { value: 0.02 }, uTime: { value: 0 }, uShadowTint: { value: new THREE.Vector3(1, 1, 1) }, uHighTint: { value: new THREE.Vector3(1, 1, 1) },
        uTint: { value: new THREE.Color(1, 1, 1) }, uFlashColor: { value: new THREE.Color(1, 1, 1) },
      };
      const mat = new THREE.ShaderMaterial({
        uniforms: u, depthTest: false, depthWrite: false, transparent: false,
        vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
        fragmentShader: FALLBACK_FRAG,
      });
      this._fb = { u, mat, quad: new FullScreenQuad(mat), tex: null };
      this._sizeKey = '';   // the copy texture is (re)created by resize
    } catch (e) {
      console.warn('[render] fallback grade failed, plain scene draw', e);
      this._fb = null; this.fallback += ' (plain)';
    }
  },

  _fbResize() {
    const fb = this._fb;
    if (!fb) return;
    const v = this._tmpV2 || (this._tmpV2 = new THREE.Vector2());
    this.ctx.renderer.getDrawingBufferSize(v);
    const w = Math.max(1, v.x | 0), h = Math.max(1, v.y | 0);
    if (fb.tex) fb.tex.dispose();
    fb.tex = new THREE.FramebufferTexture(w, h);
    fb.tex.minFilter = THREE.LinearFilter; fb.tex.magFilter = THREE.LinearFilter;
    fb.u.tColor.value = fb.tex; fb.u.uTexel.value.set(1 / w, 1 / h);
  },

  _fbDraw() {
    const fb = this._fb, renderer = this.ctx.renderer;
    if (!fb || !fb.tex) return;
    renderer.setRenderTarget(null);
    renderer.copyFramebufferToTexture(fb.tex);
    const old = renderer.autoClear;
    renderer.autoClear = false;
    fb.quad.render(renderer);
    renderer.autoClear = old;
  },

  _noComposer() {
    this._disposePipeline();
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
    this.quality = q; this.tier = QUALITY[q];
    if (this.composer) this._patchBloomSize(QUALITY[q].bloom);
    this.resize();   // reallocates only when the pixel ratio or the bloom scale differs from the tier before (see _sizeKey)
    this._sinceChange = 0; this._slow = 0; this._fast = 0;
  },

  _viewSize() {
    const body = this.mount === document.body;
    return [body ? innerWidth : (this.mount.clientWidth || innerWidth), body ? innerHeight : (this.mount.clientHeight || innerHeight)];
  },

  /** camera aspect only (cheap), used while a burst of resize events is still running on touch devices */
  _aspectNow() {
    const [w, h] = this._viewSize();
    if (w < 2 || h < 2) return;
    const cam = this.ctx.camera;
    cam.aspect = w / h; cam.updateProjectionMatrix();
  },

  /**
   * Canvas and target size. Reallocation (the expensive part, and a leak risk on iOS) happens only when the CSS size, the pixel
   * ratio the tier renders at or the bloom scale really changed since the last call; force = true always reallocates.
   */
  resize(force = false) {
    const { renderer, camera } = this.ctx;
    const [w, h] = this._viewSize();
    if (w < 2 || h < 2) return;   // hidden, or a transient zero size in the middle of a rotation
    this._w = w; this._h = h;
    camera.aspect = w / h; camera.updateProjectionMatrix();
    const T = this.tier || QUALITY[0];
    const pr = Math.min(devicePixelRatio || 1, T.pr);   // follows browser zoom and moving the window between screens
    const key = w + 'x' + h + '@' + pr + '/' + T.bloom;
    if (!force && key === this._sizeKey) return;
    this._sizeKey = key;
    renderer.setPixelRatio(pr);
    renderer.setSize(w, h, false);
    if (this.composer) { this.composer.setPixelRatio(pr); this.composer.setSize(w, h); }
    if (this.fxaa) this.fxaa.uniforms.resolution.value.set(1 / (w * pr), 1 / (h * pr));
    if (this._fb) this._fbResize();
  },

  // ------------------------------------------------------------------ context loss
  // The browser may take the WebGL context away (iOS under memory pressure or after the page was in the background). preventDefault
  // on the lost event is what allows a restore. While it is lost nothing is drawn and a running game is paused. When it comes back
  // the three.js renderer re-creates its GL state on its own, but targets and the baked environment map hold no data any more,
  // so the pipeline and the environment are rebuilt. If nothing comes back within a few seconds a tap-to-reload message appears.
  _initContextLoss(canvas) {
    canvas.addEventListener('webglcontextlost', (e) => { e.preventDefault(); this._onLost(); }, false);
    canvas.addEventListener('webglcontextrestored', () => this._onRestored(), false);
  },

  _onLost() {
    this.lost = true; this.lostCount++;
    console.warn('[render] webgl context lost (' + this.lostCount + ')');
    const ctx = this.ctx;
    if (ctx.state?.phase === 'playing') { this._pausedByLoss = true; try { ctx.game?.pause?.(); } catch (e) { /* ignore */ } }
    clearTimeout(this._lostT);
    this._lostT = setTimeout(() => { if (this.lost) this._showNotice('GRAPHICS INTERRUPTED', 'The browser has not returned the graphics yet. Tap or click to reload the page.'); }, 4000);
  },

  _onRestored() {
    clearTimeout(this._lostT);
    const ctx = this.ctx, renderer = ctx.renderer;
    try {
      // The old targets, passes and environment belonged to the lost context: freeing them now would only make the browser
      // warn about foreign GL objects, so they are dropped and left to the garbage collector.
      this.composer = null; this._fb = null; this.fallback = '';
      this._buildPipeline(this.quality);
      this.resize(true);
      try { ctx.scene.environment = makeEnvironment(renderer); } catch (e) { console.warn('env failed', e); }
      this.lost = false; this._lastWall = 0;
      this._clearNotice();
      console.warn('[render] webgl context restored, pipeline rebuilt (paused by the loss: ' + this._pausedByLoss + ')');
      this._pausedByLoss = false;   // the game stays paused, the player resumes it
    } catch (e) {
      console.error('[render] could not rebuild after context loss', e);
      this._showNotice('GRAPHICS COULD NOT RESTART', 'Tap or click to reload the page.');
    }
  },

  _showNotice(title, text) {
    if (this._notice) return;
    const box = document.createElement('div');
    box.style.cssText = 'position:fixed;inset:0;z-index:10000;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:10px;padding:24px;text-align:center;background:rgba(2,6,12,0.92);color:#dff6f2;font:14px/1.5 system-ui,sans-serif;pointer-events:auto;cursor:pointer;';
    const t = document.createElement('div'); t.style.cssText = 'font-size:18px;letter-spacing:0.3em;font-weight:300'; t.textContent = title;
    const d = document.createElement('div'); d.style.cssText = 'max-width:32em;opacity:.8'; d.textContent = text;
    box.append(t, d);
    box.addEventListener('click', () => location.reload());
    document.body.appendChild(box);
    this._notice = box;
  },

  _clearNotice() { if (this._notice) { this._notice.remove(); this._notice = null; } },

  _disposePipeline() {
    try { this.composer?.dispose?.(); } catch (e) { /* the context may be gone, nothing to free then */ }
    const fb = this._fb;
    if (fb) { try { fb.tex?.dispose(); fb.mat.dispose(); fb.quad.dispose(); } catch (e) { /* ignore */ } }
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
    else if (this._fb) {
      // fallback grade pass: the same look values as the post chain, applied to display colour after the renderer's own ACES
      const u = this._fb.u, e = this._extra;
      u.uTime.value = this._time;
      u.uVignette.value = L.vignette + this._damagePulse * 0.15;
      u.uGrain.value = e.grain ?? (P.grain ?? 0.022);
      u.uDamage.value = e.damage ?? clamp(this._damagePulse * 0.85 + this._lowHp, 0, 1);
      u.uFlash.value = e.flash ?? clamp(flashAmt, 0, 1);
      u.uFlashColor.value.copy(f.color);
      u.uTint.value.copy(L.tint);
      u.uGradeOn.value = this.tier.grade ? 1 : 0;
      u.uLift.value = L.lift; u.uGamma.value = L.gamma; u.uGain.value = L.gain; u.uContrast.value = L.contrast; u.uSat.value = L.saturation;
      u.uShadowTint.value.copy(L.shadowCol); u.uHighTint.value.copy(L.highCol);
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
    if (this.lost) return;   // context lost: draw nothing until _onRestored has rebuilt the pipeline
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
        if (this.lost || renderer.getContext().isContextLost()) { this.lost = true; return; }   // lost in the middle of the frame, the event follows
        console.warn('[render] composer error, falling back', e);
        this._buildFallback('composer error: ' + (e && e.message ? e.message : e));
        this.resize(true);
        renderer.render(scene, camera);
        this._fbDraw();
      }
    } else {
      renderer.render(scene, camera);
      if (this._fb) this._fbDraw();
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

  dispose() {
    removeEventListener('resize', this._onResize); removeEventListener('orientationchange', this._onResize);
    clearTimeout(this._resizeT); clearTimeout(this._lostT);
    this._disposePipeline();
  },
};
