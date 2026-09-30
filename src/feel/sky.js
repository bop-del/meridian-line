// Feel parameters for the "sky" group (registered into src/core/feel.js). Owner: the water and sky agent.
// Every value is READ from feel.p.sky.<key> each frame by the code that uses it (Sky.applyFeel and the ocean's applyFeel, called from the
// level's update), so the ?tune=1 panel takes effect instantly. Per level values carry a level prefix (thalassa_, cinder_, foundry_).
//
// Sea colours are HSL in the renderer's linear working space (that is why the lightness numbers look small). Cinder and Foundry have no
// sea, they only get the sky block. Their cloud and scatter defaults are 0 (off): the level opts in by calling
// `W.sky.applyFeel(ctx.feel.p.sky, '<theme>', detail)` from its update, and can then raise these values (or set the sky.configure
// fields cloudsLow, clouds, cloudLight, scatter directly instead).
export function registerSky(feel) {
  // horizon glow / sun glare defaults of the two space levels are the values their level files already use
  const skyBlock = (lv, label, d) => ({
    [`${lv}_cloudCover`]: { section: `${label} sky`, value: d.cloudCover, min: 0, max: 1, step: 0.01, label: 'High cloud cover', hint: 'Thin high veil, 0 = clear' },
    [`${lv}_cloudLow`]: { section: `${label} sky`, value: d.cloudLow, min: 0, max: 1, step: 0.01, label: 'Low cloud band', hint: 'Billowing band hugging the horizon, 0 = none' },
    [`${lv}_cloudLight`]: { section: `${label} sky`, value: d.cloudLight, min: 0, max: 2.5, step: 0.01, label: 'Cloud light', hint: 'Brightness of sunlit clouds' },
    [`${lv}_cloudSpeed`]: { section: `${label} sky`, value: d.cloudSpeed, min: 0, max: 6, step: 0.05, label: 'Cloud drift', hint: 'Drift speed multiplier' },
    [`${lv}_scatter`]: { section: `${label} sky`, value: d.scatter, min: 0, max: 2, step: 0.01, label: 'Scatter strength', hint: 'Warm light scattered toward the suns, cooler sky on the far side' },
    [`${lv}_horizonGlow`]: { section: `${label} sky`, value: d.horizonGlow, min: 0, max: 2, step: 0.01, label: 'Horizon glow', hint: 'Sun coloured haze band on the horizon' },
    [`${lv}_sunGlow`]: { section: `${label} sky`, value: d.sunGlow, min: 0, max: 2, step: 0.01, label: 'Sun glare', hint: 'Size of the glow around the sun discs' },
  });
  feel.register('sky', {
    ...skyBlock('thalassa', 'Thalassa', { cloudCover: 0.4, cloudLow: 0.45, cloudLight: 1.0, cloudSpeed: 1, scatter: 0.9, horizonGlow: 0.3, sunGlow: 0.8 }),

    thalassa_deepHue: { section: 'Thalassa sea', value: 0.57, min: 0, max: 1, step: 0.005, label: 'Deep water hue', hint: 'Colour looking straight down into open water' },
    thalassa_deepSat: { section: 'Thalassa sea', value: 0.96, min: 0, max: 1, step: 0.01, label: 'Deep water saturation' },
    thalassa_deepLight: { section: 'Thalassa sea', value: 0.043, min: 0, max: 0.4, step: 0.001, label: 'Deep water lightness', hint: 'Linear light, small numbers are normal' },
    thalassa_shallowHue: { section: 'Thalassa sea', value: 0.475, min: 0, max: 1, step: 0.005, label: 'Shallow water hue', hint: 'Pale turquoise in patches and around coral and hulls' },
    thalassa_shallowSat: { section: 'Thalassa sea', value: 0.83, min: 0, max: 1, step: 0.01, label: 'Shallow water saturation' },
    thalassa_shallowLight: { section: 'Thalassa sea', value: 0.29, min: 0, max: 0.8, step: 0.005, label: 'Shallow water lightness' },
    thalassa_reflect: { section: 'Thalassa sea', value: 1, min: 0, max: 1.6, step: 0.01, label: 'Sky reflection', hint: 'Fresnel reflection of sky, clouds and suns' },
    thalassa_crestGlow: { section: 'Thalassa sea', value: 0.55, min: 0, max: 2, step: 0.01, label: 'Backlit crest glow', hint: 'Teal light through wave crests when the suns are behind them' },
    thalassa_ripple: { section: 'Thalassa sea', value: 1, min: 0, max: 2.5, step: 0.01, label: 'Ripple strength', hint: 'Fine ripple normals, drives the sparkle' },

    thalassa_glitter: { section: 'Thalassa glitter and foam', value: 1, min: 0, max: 2, step: 0.01, label: 'Sun glitter', hint: 'Glitter path of both suns' },
    thalassa_foam: { section: 'Thalassa glitter and foam', value: 1, min: 0, max: 2, step: 0.01, label: 'Crest foam', hint: 'Whitecaps on the swell' },
    thalassa_foamShore: { section: 'Thalassa glitter and foam', value: 1, min: 0, max: 2, step: 0.01, label: 'Foam around obstacles', hint: 'Foam rings and pale shallows around spires, reefs, arches and hulls (water tier 2)' },
    thalassa_caustic: { section: 'Thalassa glitter and foam', value: 0.8, min: 0, max: 2, step: 0.01, label: 'Shallow sparkle', hint: 'Caustic like sparkle in the shallows (water tier 2)' },

    ...skyBlock('cinder', 'Cinder', { cloudCover: 0, cloudLow: 0, cloudLight: 1, cloudSpeed: 1, scatter: 0, horizonGlow: 0.08, sunGlow: 0.5 }),
    ...skyBlock('foundry', 'Foundry', { cloudCover: 0, cloudLow: 0, cloudLight: 1, cloudSpeed: 1, scatter: 0, horizonGlow: 0.55, sunGlow: 0.6 }),
  });
}
