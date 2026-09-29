// Procedural Vanta Mk II. Graphite matte hull with amber and teal accents: a manta arrowhead planform whose outer wing
// panels are canted DOWN about 25 degrees, one twin barrel gun pod hung under the nose, a low flat blade canopy, one
// central ring engine (a flared shroud with an amber rim) plus two small ion vents.
// Faces -Z. Span about 5.6, length about 5.4 with the gun pod. Hull recipes live in hulls.js (the escorts reuse this builder).
//
// Boost and brake are shown by the engine shroud contracting (boost) and expanding (brake) and by the rear flare fins
// (low airbrake plates on the tail) laying back on boost and standing up on brake. The wings never fold.
//
// createVanta(opts) -> { group, model, setBoost, setBrake, setRoll, setBank, setDamage, update, wings, flames, anchors,
//                        engines, light, canopy, fuselage, dispose, ... }
// Conventions: setBank(pitch, roll, yaw) in radians, right handed: pitch > 0 nose up, roll > 0 rolls left (counter clockwise
// seen from behind), yaw > 0 nose left. setRoll(angle) is an extra spin about the ship's own Z axis (barrel roll).
// `wings.left` and `wings.right` are the rear flare fin pivots. `flames` holds one flame group per engine (main first) and
// `engines` the matching groups. All animation is self driven if vanta.update(dt) is never called (flame and glow shaders
// animate from a clock, articulation and damage flicker tick from onBeforeRender), and update(dt) is optional.
import * as THREE from 'three';
import { latheZ, canvasTex, glowTexture, scorchTexture, hexCss, mixHex, mergeGeos } from './modelUtils.js';
import { HULLS } from './hulls.js';

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

const DEFAULT_COLORS = {
  hull: 0x353a43,      // matte graphite body
  plate: 0x4a515c,     // lighter armour plates
  dark: 0x15181d,      // intakes, nozzle, struts
  metal: 0x8d95a3,     // barrels and fittings
  accent: 0xffa424,    // amber
  accent2: 0x2ed3c4,   // teal
  glass: 0x0e4a58,
  flame: 0xffd08a, flameEdge: 0xff5a14,        // main engine at idle
  boostCore: 0xd8fff6, boostEdge: 0x14b4ff,    // main engine while boosting
  ion: 0x66f4e6, ionEdge: 0x1d6dff,            // ion vents
};

// ------------------------------------------------------------------------------------------------ textures
function noise(g, W, H, n, k) {
  for (let i = 0; i < n; i++) { g.fillStyle = `rgba(0,0,0,${Math.random() * k})`; g.fillRect(Math.random() * W, Math.random() * H, 2 + Math.random() * 20, 1 + Math.random() * 3); }
}

// Hull texture, planar top down projection: u = (x - x0) / (x1 - x0), v = (z - z0) / (z1 - z0), nose at the bottom of the canvas.
// The recipe supplies half planform (x >= 0) polylines that are mirrored here.
function hullTexture(P, spec, em) {
  const { x0, x1, z0, z1 } = spec.bounds, pa = spec.paint;
  return canvasTex(1024, 1024, (g, W, H) => {
    const X = (x) => ((x - x0) / (x1 - x0)) * W, Y = (z) => (1 - (z - z0) / (z1 - z0)) * H;
    const both = (pts) => [pts, pts.map(([x, z]) => [-x, z])];
    const poly = (pts, col) => { for (const p of both(pts)) { g.fillStyle = col; g.beginPath(); p.forEach(([x, z], i) => (i ? g.lineTo(X(x), Y(z)) : g.moveTo(X(x), Y(z)))); g.closePath(); g.fill(); } };
    const line = (pts, col, w, cap = 'butt') => { for (const p of both(pts)) { g.strokeStyle = col; g.lineWidth = w; g.lineCap = cap; g.lineJoin = 'round'; g.beginPath(); p.forEach(([x, z], i) => (i ? g.lineTo(X(x), Y(z)) : g.moveTo(X(x), Y(z)))); g.stroke(); } };
    const amber = hexCss(P.accent), teal = hexCss(P.accent2);
    if (em) {
      g.fillStyle = '#000'; g.fillRect(0, 0, W, H);
      for (const e of pa.edge) line(e, teal, 7, 'round');
      for (const s of pa.stripes) poly(s, amber);
      return;
    }
    const grad = g.createLinearGradient(0, 0, W, 0);
    grad.addColorStop(0, hexCss(mixHex(P.hull, 0x000000, 0.2))); grad.addColorStop(0.5, hexCss(mixHex(P.hull, P.plate, 0.4))); grad.addColorStop(1, hexCss(mixHex(P.hull, 0x000000, 0.2)));
    g.fillStyle = grad; g.fillRect(0, 0, W, H);
    for (const pl of pa.plates) line(pl.pts, hexCss(mixHex(P.hull, P.plate, 0.75)), pl.w);
    // rear heat zone
    const hg = g.createLinearGradient(0, Y(z1 - 1.0), 0, Y(z1)); hg.addColorStop(0, 'rgba(0,0,0,0)'); hg.addColorStop(1, 'rgba(0,0,0,0.5)');
    g.fillStyle = hg; g.fillRect(0, Y(z1), W, Y(z1 - 1.0) - Y(z1));
    // markings (dim here, lit by the emissive map)
    for (const s of pa.stripes) poly(s, hexCss(mixHex(P.accent, P.hull, 0.35)));
    for (const e of pa.edge) line(e, hexCss(mixHex(P.accent2, P.hull, 0.4)), 7, 'round');
    // panel lines
    for (const l of pa.lines) { line(l, 'rgba(8,10,14,0.6)', 2.4); line(l.map(([x, z]) => [x, z + 0.012]), 'rgba(255,255,255,0.07)', 1.2); }
    noise(g, W, H, 380, 0.05);
  });
}

// ------------------------------------------------------------------------------------------------ shaders
const FLAME_VERT = `
  uniform float uTime, uLen, uWidth;
  varying float vT; varying vec3 vN; varying vec3 vV;
  void main() {
    float t = position.z;
    vec3 p = position;
    float ph = modelMatrix[3].x * 3.0;
    float fl = 1.0 + 0.11 * sin(uTime * 52.0 + ph) + 0.06 * sin(uTime * 97.0 + ph * 2.0);
    p.z *= uLen * fl;
    p.xy *= uWidth * (1.0 + 0.09 * sin(uTime * 70.0 + p.z * 9.0 + ph));
    vT = t;
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    vN = normalize(normalMatrix * normal); vV = normalize(-mv.xyz);
    gl_Position = projectionMatrix * mv;
  }`;
// main engine: soft cone, hot core kept below the bloom threshold so the hull stays readable from behind
const FLAME_FRAG = `
  uniform vec3 uCore, uEdge; uniform float uAlpha, uGlow;
  varying float vT; varying vec3 vN; varying vec3 vV;
  void main() {
    float f = abs(dot(normalize(vN), normalize(vV)));
    float fall = pow(1.0 - vT, 1.6);
    vec3 col = mix(uEdge, uCore, smoothstep(0.0, 1.0, f * 0.8 + (1.0 - vT) * 0.35));
    float a = fall * (0.12 + 0.6 * pow(f, 1.3)) * uAlpha;
    gl_FragColor = vec4(col * uGlow, a);
  }`;
// ion vents: thin needle with travelling bright bands
const ION_FRAG = `
  uniform vec3 uCore, uEdge; uniform float uAlpha, uGlow, uTime;
  varying float vT; varying vec3 vN; varying vec3 vV;
  void main() {
    float f = abs(dot(normalize(vN), normalize(vV)));
    float fall = pow(1.0 - vT, 1.1);
    float band = 0.62 + 0.38 * sin(vT * 30.0 - uTime * 46.0);
    vec3 col = mix(uEdge, uCore, smoothstep(0.1, 1.0, f)) * (0.65 + 0.7 * band);
    float a = fall * (0.15 + 0.85 * pow(f, 1.2)) * uAlpha;
    gl_FragColor = vec4(col * uGlow, a);
  }`;

function flameMaterial(core, edge, glow, frag = FLAME_FRAG) {
  return new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uLen: { value: 1 }, uWidth: { value: 1 }, uCore: { value: new THREE.Color(core) }, uEdge: { value: new THREE.Color(edge) }, uAlpha: { value: 1 }, uGlow: { value: glow } },
    vertexShader: FLAME_VERT, fragmentShader: frag, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false,
  });
}
let _flameGeo = null;
function flameGeometry() {
  if (_flameGeo) return _flameGeo;
  const g = new THREE.ConeGeometry(1, 1, 16, 5, true);
  g.rotateX(Math.PI / 2); g.translate(0, 0, 0.5);
  _flameGeo = g; return g;
}

// Engine shroud: dark flared bell with a dark throat cap, plus an amber rim ring. Built around local z = 0 (base) to z = len.
function shroudGeos(r, len) {
  const prof = [[0.94, 0], [1.0, 0.18], [1.1, 0.72], [1.14, 1.0], [1.03, 1.0], [0.97, 0.78], [0.9, 0.16], [0.84, 0]].map(([k, a]) => [k * r, a * len]);
  const bell = latheZ(prof, 28);
  const cap = new THREE.CircleGeometry(r * 0.85, 24); cap.translate(0, 0, len * 0.35);
  const rim = new THREE.TorusGeometry(r * 1.09, Math.max(0.016, r * 0.08), 8, 32); rim.translate(0, 0, len * 1.0);
  return { bell, cap, rim };
}

export function createVanta(opts = {}) {
  const P = { ...DEFAULT_COLORS, ...(opts.colors || {}) };
  const spec = (HULLS[opts.variant] || HULLS.vanta)(P);
  const disposables = [];
  const track = (o) => { disposables.push(o); return o; };

  const group = new THREE.Group(); group.name = opts.name || 'vanta';
  const model = new THREE.Group(); model.name = 'vantaModel'; model.rotation.order = 'YXZ'; group.add(model);

  // materials
  const emIntensity = 1.0;
  const hullMat = track(new THREE.MeshStandardMaterial({ map: track(hullTexture(P, spec, false)), emissiveMap: track(hullTexture(P, spec, true)), emissive: 0xffffff, emissiveIntensity: emIntensity, metalness: 0.1, roughness: 0.85 }));
  const solidMat = track(new THREE.MeshStandardMaterial({ color: P.plate, metalness: 0.4, roughness: 0.55 }));
  const finMat = track(new THREE.MeshStandardMaterial({ color: mixHex(P.hull, P.plate, 0.5), metalness: 0.1, roughness: 0.8 }));
  const darkMat = track(new THREE.MeshStandardMaterial({ color: P.dark, metalness: 0.7, roughness: 0.45, side: THREE.DoubleSide }));
  const metalMat = track(new THREE.MeshStandardMaterial({ color: P.metal, metalness: 0.92, roughness: 0.28 }));
  const amberMat = track(new THREE.MeshStandardMaterial({ color: P.accent, emissive: P.accent, emissiveIntensity: 0.8, metalness: 0.2, roughness: 0.45 }));
  const tealMat = track(new THREE.MeshStandardMaterial({ color: P.accent2, emissive: P.accent2, emissiveIntensity: 1.3, metalness: 0.2, roughness: 0.4, side: THREE.DoubleSide }));
  const glassMat = track(new THREE.MeshPhysicalMaterial({ color: P.glass, metalness: 0.0, roughness: 0.05, clearcoat: 1, clearcoatRoughness: 0.03, transparent: true, opacity: 0.86, envMapIntensity: 1.8, emissive: mixHex(P.glass, P.accent2, 0.4), emissiveIntensity: 0.35 }));
  const meshes = [];
  const addMesh = (parent, geo, mat, x = 0, y = 0, z = 0) => { track(geo); const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); parent.add(m); meshes.push(m); return m; };

  // merged hull with planar UVs (one draw call for body and wings)
  const hullGeo = mergeGeos(spec.hull);
  spec.hull.forEach((g) => g.dispose());
  {
    const { x0, x1, z0, z1 } = spec.bounds, p = hullGeo.attributes.position, uv = hullGeo.attributes.uv;
    for (let i = 0; i < p.count; i++) uv.setXY(i, (p.getX(i) - x0) / (x1 - x0), (p.getZ(i) - z0) / (z1 - z0));
  }
  const fus = addMesh(model, hullGeo, hullMat); fus.name = 'fuselage';

  // static parts folded into one draw call per material
  const bake = (list, mat, name) => { if (!list.length) return null; const m = addMesh(model, mergeGeos(list), mat); m.name = name; list.forEach((g) => g.dispose()); return m; };

  // engines: shroud bells are articulated (contract on boost, expand on brake); the ion vents are baked into the hull recipe
  const shrouds = [];
  const darkList = spec.parts.dark;
  for (const e of spec.engines) {
    if (e.kind !== 'main') continue;
    const { bell, cap, rim } = shroudGeos(e.r, e.len);
    const pivot = new THREE.Group(); pivot.position.set(e.x, e.y, e.z); pivot.name = 'shroud'; model.add(pivot);
    addMesh(pivot, mergeGeos([bell, cap]), darkMat).name = 'shroudBell';
    addMesh(pivot, rim, amberMat).name = 'shroudRim';
    bell.dispose(); cap.dispose();
    shrouds.push(pivot);
  }
  bake(spec.parts.solid, solidMat, 'plates'); bake(darkList, darkMat, 'darkParts'); bake(spec.parts.metal, metalMat, 'metalParts');
  bake(spec.parts.amber, amberMat, 'amberParts'); bake(spec.parts.teal, tealMat, 'tealParts');

  // canopy: low flat blade of glass, or the drone's forward sensor lens
  const cs = spec.canopy;
  const canopy = addMesh(model, cs.geo, glassMat, cs.x, cs.y, cs.z); canopy.name = 'canopy'; canopy.renderOrder = 2;

  // rear flare fins (articulated airbrake plates): the pair driven by wings.left and wings.right
  const wings = {}, finList = [];
  for (const f of spec.fins) {
    const pivot = new THREE.Group(); pivot.position.set(f.x, f.y, f.z); pivot.name = f.s < 0 ? 'flareFinL' : 'flareFinR'; model.add(pivot);
    addMesh(pivot, f.geo, finMat).name = 'flareFin';
    wings[f.s < 0 ? 'left' : 'right'] = pivot;
    finList.push({ pivot, f });
  }

  // flames and glow
  const flameGeo = flameGeometry();
  const mainOuter = track(flameMaterial(P.flame, P.flameEdge, 1.05));
  const mainInner = track(flameMaterial(P.flame, P.flame, 0.95));
  const ionOuter = track(flameMaterial(P.ion, P.ionEdge, 1.5, ION_FRAG));
  const ionInner = track(flameMaterial(0xffffff, P.ion, 1.9, ION_FRAG));
  const glowSprites = [];
  const flames = [], engines = [];
  spec.engines.forEach((e) => {
    const isMain = e.kind === 'main';
    const g = new THREE.Group(); g.position.set(e.x, e.y, e.z + (isMain ? e.len : 0)); g.name = 'engine'; model.add(g);
    const fg = new THREE.Group(); fg.name = 'flame'; g.add(fg);
    const outer = new THREE.Mesh(flameGeo, isMain ? mainOuter : ionOuter); outer.frustumCulled = false; outer.renderOrder = 5;
    const inner = new THREE.Mesh(flameGeo, isMain ? mainInner : ionInner); inner.frustumCulled = false; inner.renderOrder = 6;
    fg.add(outer); fg.add(inner);
    const k = isMain ? e.r / 0.4 : 1;
    fg.scale.setScalar(k);
    const sprSize = isMain ? 0.75 * k + 0.25 : 0.45;
    const spr = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color: new THREE.Color(isMain ? P.flame : P.ion).multiplyScalar(0.35), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, fog: false }));
    spr.scale.set(sprSize, sprSize, 1); spr.position.set(0, 0, 0.12); g.add(spr); track(spr.material);
    glowSprites.push({ spr, base: sprSize, main: isMain });
    flames.push(fg); engines.push(g);
  });

  // anchors
  const mkAnchor = (x, y, z) => { const o = new THREE.Object3D(); o.position.set(x, y, z); model.add(o); return o; };
  const mainEng = spec.engines.filter((e) => e.kind === 'main'), ionEng = spec.engines.filter((e) => e.kind === 'ion');
  const [engL, engR] = ionEng.length >= 2 ? ionEng : mainEng.length >= 2 ? [mainEng[0], mainEng[1]] : [{ ...mainEng[0], x: -(spec.engineSpread || 0.1) }, { ...mainEng[0], x: spec.engineSpread || 0.1 }];
  const anchors = {
    nose: mkAnchor(...spec.nose),
    cannonL: mkAnchor(...spec.muzzles[0]), cannonR: mkAnchor(...spec.muzzles[1]),
    tipL: mkAnchor(...spec.tips[0]), tipR: mkAnchor(...spec.tips[1]),
    engineL: mkAnchor(engL.x, engL.y, engL.z + (engL.len || 0) + 0.15), engineR: mkAnchor(engR.x, engR.y, engR.z + (engR.len || 0) + 0.15),
    engineC: mkAnchor(mainEng[0].x * (mainEng.length > 1 ? 0 : 1), mainEng[0].y, mainEng[0].z + mainEng[0].len + 0.6),
    cockpit: mkAnchor(...spec.cockpit),
  };

  // engine light
  let light = null;
  if (opts.light !== false && opts.light !== 0) {
    light = new THREE.PointLight(P.flame, 1.4, 9, 1.6); light.position.set(0, 0, spec.light); model.add(light);
  }

  // scorch decals and damage sparks
  const scorchMat = track(new THREE.MeshBasicMaterial({ map: scorchTexture(), transparent: true, depthWrite: false, opacity: 0, polygonOffset: true, polygonOffsetFactor: -2, fog: false }));
  const scorches = [];
  spec.scorch.forEach(([x, y, z, r], i) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(r * 2, r * 2).rotateX(-Math.PI / 2), scorchMat);
    m.position.set(x, y, z); m.rotation.y = i * 1.7; m.renderOrder = 3; m.visible = false; model.add(m);
    scorches.push({ m, th: 0.12 + i * 0.16 });
  });
  const sparkMat = track(new THREE.SpriteMaterial({ map: glowTexture(), color: new THREE.Color(0xffb060).multiplyScalar(2.5), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, fog: false }));
  const sparksSp = spec.sparks.map(([x, y, z]) => {
    const s = new THREE.Sprite(sparkMat); s.scale.set(0.5, 0.5, 1); s.position.set(x, y, z); s.visible = false; model.add(s); return s;
  });

  // state
  const state = { boost: 0, brake: 0, damage: 0, pitch: 0, roll: 0, yaw: 0, spin: 0, boostS: 0, brakeS: 0, flick: 0, time: Math.random() * 10, lastUpdate: 0, lastTick: 0 };
  const _c = new THREE.Color();
  const white = new THREE.Color(1, 1, 1);

  function applyPose() { model.rotation.set(state.pitch, state.yaw, state.roll + state.spin); }

  // Flare fins lie back low on boost, stand up and toe out on brake. Shrouds contract on boost and open up on brake.
  function applyArticulation(bs, brs, t) {
    const idle = Math.sin(t * 1.7) * 0.015;
    for (const { pivot, f } of finList) {
      const a = f.idle + (f.boost - f.idle) * bs + (f.brake - f.idle) * brs + idle;
      pivot.rotation.set(0, f.s * (-0.18 * bs + 0.16 * brs), f.s * a);
    }
    const k = 1 - 0.2 * bs + 0.26 * brs;
    for (const s of shrouds) s.scale.set(k, k, 1 + 0.12 * bs - 0.08 * brs);
  }
  function applyFlames(bs, brs, t) {
    const len = (1.0 + 1.2 * bs - 0.55 * brs) * (1 - 0.35 * state.flick);
    const wid = 0.34 * (1 - 0.12 * bs + 0.12 * brs);
    const al = 1 - 0.5 * state.flick;
    mainOuter.uniforms.uLen.value = len * 1.4; mainOuter.uniforms.uWidth.value = wid * 1.0;
    mainInner.uniforms.uLen.value = len * 0.8; mainInner.uniforms.uWidth.value = wid * 0.5;
    ionOuter.uniforms.uLen.value = (0.7 + 1.1 * bs - 0.3 * brs) * (1 - 0.35 * state.flick); ionOuter.uniforms.uWidth.value = 0.1 * (1 + 0.3 * bs);
    ionInner.uniforms.uLen.value = ionOuter.uniforms.uLen.value * 0.6; ionInner.uniforms.uWidth.value = 0.05 * (1 + 0.3 * bs);
    for (const m of [mainOuter, mainInner, ionOuter, ionInner]) { m.uniforms.uTime.value = t; m.uniforms.uAlpha.value = al; }
    // main engine: amber at idle, teal white when boosting
    mainOuter.uniforms.uCore.value.set(P.flame).lerp(_c.set(P.boostCore), bs);
    mainOuter.uniforms.uEdge.value.set(P.flameEdge).lerp(_c.set(P.boostEdge), bs);
    mainInner.uniforms.uCore.value.set(P.flame).lerp(_c.set(P.boostCore), bs);
    mainInner.uniforms.uEdge.value.set(P.flame).lerp(_c.set(P.boostCore), bs);
    glowSprites.forEach((g, i) => {
      const k = g.base * (1 + bs * 0.35) + 0.04 * Math.sin(t * 40 + i);
      g.spr.scale.set(k, k, 1);
      g.spr.material.color.set(g.main ? P.flame : P.ion).lerp(_c.set(g.main ? P.boostCore : 0xffffff), bs * 0.5).multiplyScalar(0.38);
    });
    if (light) { light.intensity = 1.1 + bs * 5 + Math.sin(t * 45) * 0.2; light.color.set(P.flame).lerp(_c.set(P.boostEdge), bs); }
  }
  function applyDamage(t) {
    const d = state.damage;
    hullMat.color.copy(white).lerp(_c.setRGB(0.3, 0.27, 0.25), d * 0.85);
    solidMat.color.set(P.plate).lerp(_c.setRGB(0.12, 0.11, 0.1), d * 0.8);
    finMat.color.set(mixHex(P.hull, P.plate, 0.5)).lerp(_c.setRGB(0.1, 0.09, 0.09), d * 0.85);
    state.flick = d > 0.55 && Math.random() < (d - 0.4) * 0.35 ? Math.random() : state.flick * 0.8;
    for (const s of scorches) { s.m.visible = d > s.th; }
    scorchMat.opacity = clamp(d * 1.6, 0, 0.92);
    // failing accent lights: flicker and dim as damage climbs
    const dropout = d > 0.45 && Math.sin(t * 29) * Math.sin(t * 13) > 0.25 ? 0.15 : 1;
    const k = (1 - 0.55 * d) * dropout;
    hullMat.emissiveIntensity = emIntensity * k;
    amberMat.emissiveIntensity = 0.8 * k; tealMat.emissiveIntensity = 1.3 * k;
    for (let i = 0; i < sparksSp.length; i++) {
      const spk = sparksSp[i];
      const on = d > 0.3 + i * 0.12 && Math.random() < 0.28 + d * 0.3;
      spk.visible = on;
      if (on) { const s = 0.3 + Math.random() * 0.7 * d; spk.scale.set(s, s, 1); }
    }
  }

  function tick(dt, t) {
    state.time = t;
    // ease toward targets so raw setter calls look smooth even if player.js snaps them
    const kb = 1 - Math.exp(-9 * dt);
    state.boostS += (state.boost - state.boostS) * kb;
    state.brakeS += (state.brake - state.brakeS) * kb;
    applyArticulation(state.boostS, state.brakeS, t);
    applyDamage(t);
    applyFlames(state.boostS, state.brakeS, t);
  }

  const api = {
    group, model, wings, flames, anchors, engines, light, meshes,
    canopy, fuselage: fus,
    setBoost(v) { state.boost = clamp(v || 0, 0, 1); },
    setBrake(v) { state.brake = clamp(v || 0, 0, 1); },
    setRoll(a) { state.spin = a || 0; applyPose(); },
    setBank(pitch = 0, roll = 0, yaw = 0) { state.pitch = pitch; state.roll = roll; state.yaw = yaw; applyPose(); },
    setDamage(d) { state.damage = clamp(d || 0, 0, 1); },
    getState() { return state; },
    /** optional per frame update; safe to skip */
    update(dt = 1 / 60) { state.lastUpdate = performance.now(); tick(dt, state.time + dt); },
    setColors() { /* palette is baked into textures at creation time: build a new ship instead */ },
    dispose() { disposables.forEach((d) => d.dispose?.()); light?.dispose?.(); group.parent?.remove(group); },
  };

  // self driving when update() is not called
  let lastNow = performance.now();
  fus.onBeforeRender = () => {
    const now = performance.now();
    if (now - state.lastUpdate < 80) { lastNow = now; return; }
    if (now - lastNow < 3) return; // once per frame even when the ship is drawn several times (multiple passes)
    const dt = Math.min((now - lastNow) / 1000, 0.1); lastNow = now;
    tick(dt, state.time + dt);
  };

  applyPose(); tick(0.016, 0);
  state.boostS = 0; state.brakeS = 0;
  group.userData.vanta = api;
  return api;
}
