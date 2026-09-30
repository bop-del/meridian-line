// Feel parameters for the "look" group (registered into src/core/feel.js). Post-processing and grade.
// Read every frame by src/render/renderer.js (feel.p.look.<key>), so the ?tune=1 panel takes effect at once (values blend over
// about half a second, the same blend a level change uses).
//
// Per level values carry the level id as prefix (thalassa_, cinder_, foundry_) and are read as feel.p.look[theme + '_' + key]
// for the current level (ctx.world.theme). These are the per level look defaults: the level files only hold content, their
// info.look is a fallback for a level id that has no entry here.
//
// The post chain (src/render/renderer.js): scene with depth, sanitise plus height fog, depth of field, sun pass (shaft mask, radial
// shafts, sun visibility), bloom with a soft knee and a cap, grade pass (speed blur, bloom, shafts, lens flare, ACES, grade,
// vignette), output, FXAA. The effect tiers (src/render/tiers.js) switch the passes off in the order dof, shafts, water, bloom.

export const LOOK_LEVELS = ['thalassa', 'cinder', 'foundry'];
const NAME = { thalassa: 'Thalassa', cinder: 'Cinder', foundry: 'Foundry' };

// One def per key, the per level default values follow in LEVEL_DEFAULTS.
const PER_LEVEL = {
  // exposure and bloom
  exposure: { part: 'exposure and bloom', min: 0.3, max: 2.5, step: 0.01, label: 'Exposure', hint: 'Scene exposure before the ACES curve. Lower values give a darker, moodier frame.' },
  vignette: { part: 'exposure and bloom', min: 0, max: 1, step: 0.01, label: 'Vignette', hint: 'Darkening toward the screen corners.' },
  bloom: { part: 'exposure and bloom', min: 0, max: 2, step: 0.01, label: 'Bloom strength', hint: 'How much of the glow is added back on top of the image.' },
  bloomThreshold: { part: 'exposure and bloom', min: 0, max: 4, step: 0.02, label: 'Bloom threshold', unit: 'lum', hint: 'HDR luminance where glow starts. Above 1 only emissive and hot pixels glow, lit surfaces stay clean.' },
  bloomKnee: { part: 'exposure and bloom', min: 0, max: 2, step: 0.02, label: 'Bloom soft knee', unit: 'lum', hint: 'Width of the soft ramp around the threshold. Larger is gentler, smaller is a hard cut.' },
  bloomCap: { part: 'exposure and bloom', min: 0.5, max: 20, step: 0.1, label: 'Bloom cap', unit: 'lum', hint: 'Highest luminance a pixel may feed into the glow. Stops stacked additive beams and explosions from flooding the screen.' },
  bloomRadius: { part: 'exposure and bloom', min: 0, max: 1, step: 0.01, label: 'Bloom radius', hint: 'Mix toward the wide, soft glow levels. Low is tight halos.' },
  whiteoutGuard: { part: 'exposure and bloom', min: 0, max: 4, step: 0.05, label: 'White-out guard', unit: 'lum', hint: 'Mean frame luminance (scene plus glow) above which exposure eases down, so explosions, beams and light floods never wash the screen out. 0 turns the guard off.' },
  // light
  shafts: { part: 'shafts, flare, fog, focus', min: 0, max: 2, step: 0.01, label: 'Light shafts', hint: 'Strength of the screen space sun shafts (tiers 0 to 2).' },
  shaftsLength: { part: 'shafts, flare, fog, focus', min: 0.1, max: 1, step: 0.01, label: 'Shaft length', hint: 'How far the shafts reach from the sun, as a fraction of the distance to the sun on screen.' },
  shaftsThreshold: { part: 'shafts, flare, fog, focus', min: 0, max: 3, step: 0.02, label: 'Shaft source threshold', unit: 'lum', hint: 'Sky luminance needed to cast shafts. Higher keeps shafts to the sun disc and its glow.' },
  flare: { part: 'shafts, flare, fog, focus', min: 0, max: 1.5, step: 0.01, label: 'Lens flare', hint: 'Ghosts and a soft streak from visible suns. Faded near the reticle and when the sun is covered.' },
  fogDensity: { part: 'shafts, flare, fog, focus', min: 0, max: 0.05, step: 0.0005, label: 'Height fog density', unit: '1/u', hint: 'Fog density at the water or floor level. It thins out with height.' },
  fogFalloff: { part: 'shafts, flare, fog, focus', min: 1, max: 300, step: 1, label: 'Height fog falloff', unit: 'u', hint: 'Height over which the height fog thins to a third. Small values hug the floor.' },
  fogDistance: { part: 'shafts, flare, fog, focus', min: 0, max: 0.004, step: 0.00005, label: 'Aerial depth', unit: '1/u', hint: 'Distance haze that fades far scenery into the fog colour everywhere, for depth.' },
  fogSun: { part: 'shafts, flare, fog, focus', min: 0, max: 3, step: 0.02, label: 'Fog sun glow', hint: 'Sun coloured in scatter in the fog when looking toward a sun.' },
  fogSky: { part: 'shafts, flare, fog, focus', min: 0, max: 1, step: 0.01, label: 'Fog on sky', hint: 'How much of the fog also lies over the sky near the horizon.' },
  dof: { part: 'shafts, flare, fog, focus', min: 0, max: 1, step: 0.01, label: 'Far blur', hint: 'Depth of field on far scenery only (tier 0). Nothing near the ship is blurred.' },
  // grade
  contrast: { part: 'grade', min: 0.6, max: 1.6, step: 0.01, label: 'Contrast', hint: 'Contrast around mid grey after the tone curve.' },
  saturation: { part: 'grade', min: 0, max: 2, step: 0.01, label: 'Saturation', hint: 'Colour saturation after the tone curve.' },
  lift: { part: 'grade', min: -0.15, max: 0.15, step: 0.005, label: 'Lift', hint: 'Raises (positive) or crushes (negative) the blacks.' },
  gamma: { part: 'grade', min: 0.6, max: 1.6, step: 0.01, label: 'Gamma', hint: 'Mid tones. Above 1 brighter, below 1 darker.' },
  gain: { part: 'grade', min: 0.6, max: 1.5, step: 0.01, label: 'Gain', hint: 'Highlights level.' },
  shadowHue: { part: 'grade', min: 0, max: 360, step: 1, label: 'Shadow tint hue', unit: 'deg', hint: 'Hue pushed into the shadows (0 red, 30 orange, 50 gold, 180 cyan, 210 steel blue).' },
  shadowTint: { part: 'grade', min: 0, max: 0.6, step: 0.01, label: 'Shadow tint amount', hint: 'Strength of the shadow tint.' },
  highlightHue: { part: 'grade', min: 0, max: 360, step: 1, label: 'Highlight tint hue', unit: 'deg', hint: 'Hue pushed into the highlights.' },
  highlightTint: { part: 'grade', min: 0, max: 0.6, step: 0.01, label: 'Highlight tint amount', hint: 'Strength of the highlight tint.' },
};

// Thalassa: warm gold and teal evening. Cinder: ember and cyan in a dark void, fog kept thin. Foundry: cold blue steel with hot orange.
export const LEVEL_DEFAULTS = {
  thalassa: {
    exposure: 0.9, vignette: 0.34, bloom: 0.42, bloomThreshold: 1.15, bloomKnee: 0.6, bloomCap: 5, bloomRadius: 0.5, whiteoutGuard: 1.0,
    shafts: 0.6, shaftsLength: 0.75, shaftsThreshold: 0.9, flare: 0.35,
    fogDensity: 0.003, fogFalloff: 10, fogDistance: 0.00015, fogSun: 0.6, fogSky: 0.3, dof: 0.6,
    contrast: 1.14, saturation: 1.1, lift: -0.012, gamma: 0.98, gain: 1.0, shadowHue: 188, shadowTint: 0.2, highlightHue: 38, highlightTint: 0.12,
  },
  cinder: {
    exposure: 1.0, vignette: 0.42, bloom: 0.55, bloomThreshold: 1.0, bloomKnee: 0.5, bloomCap: 4.5, bloomRadius: 0.55, whiteoutGuard: 0.5,
    shafts: 0.5, shaftsLength: 0.6, shaftsThreshold: 0.55, flare: 0.4,
    fogDensity: 0.002, fogFalloff: 160, fogDistance: 0.00025, fogSun: 0.4, fogSky: 0.1, dof: 0.5,
    contrast: 1.14, saturation: 1.08, lift: -0.005, gamma: 1.0, gain: 1.0, shadowHue: 186, shadowTint: 0.22, highlightHue: 22, highlightTint: 0.22,
  },
  foundry: {
    exposure: 1.0, vignette: 0.48, bloom: 0.5, bloomThreshold: 1.25, bloomKnee: 0.5, bloomCap: 3.5, bloomRadius: 0.42, whiteoutGuard: 0.45,
    shafts: 0.4, shaftsLength: 0.55, shaftsThreshold: 0.7, flare: 0.22,
    fogDensity: 0.014, fogFalloff: 12, fogDistance: 0.0006, fogSun: 0.45, fogSky: 0.25, dof: 0.5,
    contrast: 1.07, saturation: 0.92, lift: 0.02, gamma: 0.98, gain: 1.0, shadowHue: 212, shadowTint: 0.2, highlightHue: 28, highlightTint: 0.2,
  },
};

const GLOBAL = {
  bossBloomCut: { section: 'Global', value: 0.45, min: 0, max: 1, step: 0.01, label: 'Boss fight bloom cut', hint: 'Bloom is reduced by this fraction while a boss is up, so weak points read through the beams.' },
  bossFxCut: { section: 'Global', value: 0.5, min: 0, max: 1, step: 0.01, label: 'Boss fight shafts and flare cut', hint: 'Light shafts, lens flare and far blur are reduced by this fraction while a boss is up.' },
  flareStreak: { section: 'Global', value: 0.6, min: 0, max: 2, step: 0.02, label: 'Flare streak', hint: 'Brightness of the thin horizontal streak through the sun relative to the ghosts.' },
  flareClear: { section: 'Global', value: 0.14, min: 0, max: 0.4, step: 0.01, label: 'Flare clear zone', unit: 'scr', hint: 'Radius around the reticle, as a fraction of the screen height, where lens flare fades out.' },
  fogStart: { section: 'Global', value: 40, min: 0, max: 200, step: 1, label: 'Fog start', unit: 'u', hint: 'Post fog begins this far from the camera, so the ship and near enemies are never fogged.' },
  fogMax: { section: 'Global', value: 0.85, min: 0, max: 1, step: 0.01, label: 'Fog max', hint: 'Upper limit of post fog opacity, keeps far silhouettes readable.' },
  dofStart: { section: 'Global', value: 90, min: 20, max: 600, step: 5, label: 'Far blur start', unit: 'u', hint: 'Distance where the far blur begins. The ship sits at about 12 u.' },
  dofRange: { section: 'Global', value: 500, min: 50, max: 2000, step: 10, label: 'Far blur ramp', unit: 'u', hint: 'Distance over which the far blur grows to full.' },
  dofRadius: { section: 'Global', value: 2.2, min: 0.5, max: 6, step: 0.1, label: 'Far blur radius', unit: 'px', hint: 'Blur radius at full strength, in pixels at 1080p.' },
  grain: { section: 'Global', value: 0.022, min: 0, max: 0.1, step: 0.001, label: 'Film grain', hint: 'Grain amount, stronger in the shadows.' },
  hdrMax: { section: 'Global', value: 24, min: 4, max: 64, step: 1, label: 'HDR ceiling', unit: 'lum', hint: 'Scene values are clamped to this before bloom and grade (also removes NaN and Inf).' },
};

export function registerLook(feel) {
  const defs = { ...GLOBAL };
  for (const lv of LOOK_LEVELS) {
    for (const [key, d] of Object.entries(PER_LEVEL)) {
      const { part, ...rest } = d;
      defs[`${lv}_${key}`] = { ...rest, section: `${NAME[lv]}: ${part}`, value: LEVEL_DEFAULTS[lv][key], label: `${NAME[lv]} ${d.label.toLowerCase()}`, unit: d.unit ?? '' };
    }
  }
  feel.register('look', defs);

  // cinematic: the defaults. clean: every effect mild, neutral grade, for players who want a plain image.
  feel.definePreset('cinematic', {});
  const clean = { 'look.grain': 0.01, 'look.bossBloomCut': 0.5 };
  for (const lv of LOOK_LEVELS) {
    const D = LEVEL_DEFAULTS[lv], k = (key) => `look.${lv}_${key}`;
    Object.assign(clean, {
      [k('exposure')]: Math.min(1, D.exposure + 0.05), [k('vignette')]: 0.18, [k('bloom')]: +(D.bloom * 0.7).toFixed(3), [k('bloomCap')]: Math.min(D.bloomCap, 3),
      [k('shafts')]: +(D.shafts * 0.35).toFixed(3), [k('flare')]: +(D.flare * 0.3).toFixed(3),
      [k('fogDensity')]: +(D.fogDensity * 0.5).toFixed(5), [k('fogDistance')]: +(D.fogDistance * 0.5).toFixed(6), [k('fogSun')]: +(D.fogSun * 0.5).toFixed(3), [k('dof')]: 0,
      [k('contrast')]: 1.03, [k('saturation')]: 1.0, [k('lift')]: 0, [k('gamma')]: 1, [k('gain')]: 1, [k('shadowTint')]: 0.05, [k('highlightTint')]: 0.05,
    });
  }
  feel.definePreset('clean', clean);
}
