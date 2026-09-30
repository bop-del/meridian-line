// Feel parameters for the "atmosphere" group (registered into src/core/feel.js). Owner: the level atmosphere agent.
// Every value is READ from feel.p.atmosphere.<key> each frame (or when the level loads AND on feel.onChange) by the code that uses it,
// so the ?tune=1 panel takes effect instantly. Sections fold in the panel.
// Per level values carry the level prefix (thalassa_, cinder_, foundry_) and are read with the theme of ctx.world.theme.
//
// Brightness values are multipliers on colours that are already tuned to stay inside the bloom budget: 1 is the intended look,
// 0 switches the element off, above 1 is allowed for taste but eats into the headroom the lighting lead set up.
export function registerAtmosphere(feel) {
  const motes = (lv, label, d) => ({
    [`${lv}_motes`]: { section: `${label} particles`, value: d.amount, min: 0, max: 2, step: 0.05, label: 'Ambient particles', unit: 'x', hint: 'Amount of floating dressing (embers, sparks, ash, pollen) that gives depth cues. 0 is off.' },
    [`${lv}_moteSize`]: { section: `${label} particles`, value: d.size, min: 0.3, max: 3, step: 0.05, label: 'Particle size', unit: 'x', hint: 'Size of the ambient particles.' },
    [`${lv}_moteBright`]: { section: `${label} particles`, value: d.bright, min: 0, max: 2.5, step: 0.05, label: 'Particle brightness', unit: 'x', hint: 'Brightness of the ambient particles.' },
  });

  feel.register('atmosphere', {
    // ---------------------------------------------------------------- safety
    flashGuard: { section: 'Safety', value: 1, min: 0, max: 1, step: 0.05, label: 'Flash guard', unit: '', hint: 'Thins explosions that stack up right in front of the camera so a chain of close blasts cannot white out the screen. 0 is off.' },
    flashGuardLimit: { section: 'Safety', value: 9, min: 2, max: 40, step: 0.5, label: 'Flash guard: limit', unit: '', hint: 'How much close explosion energy is allowed before new blasts get smaller. Higher lets more pile up.' },

    // ---------------------------------------------------------------- boss hero light
    bossKey: { section: 'Boss light', value: 1, min: 0, max: 3, step: 0.05, label: 'Key light strength', unit: 'x', hint: 'Strength of the warm or cold key light that reveals the boss shape during a boss fight.' },
    bossRim: { section: 'Boss light', value: 1, min: 0, max: 3, step: 0.05, label: 'Rim light strength', unit: 'x', hint: 'Strength of the back light that separates the boss from the background.' },
    bossPhasePunch: { section: 'Boss light', value: 1, min: 0, max: 3, step: 0.05, label: 'Phase change punch', unit: 'x', hint: 'How hard the lights flare when a boss changes phase or is defeated.' },
    bossFade: { section: 'Boss light', value: 1.6, min: 0.2, max: 6, step: 0.1, label: 'Fade time', unit: 's', hint: 'How long the boss lights take to fade in on spawn and out after the fight.' },
    tidebreaker_boss: { section: 'Boss light', value: 1, min: 0, max: 2.5, step: 0.05, label: 'Tidebreaker light', unit: 'x', hint: 'Extra multiplier for the Thalassa boss.' },
    orrery_boss: { section: 'Boss light', value: 1, min: 0, max: 2.5, step: 0.05, label: 'Orrery light', unit: 'x', hint: 'Extra multiplier for the Cinder Belt boss.' },
    regent_boss: { section: 'Boss light', value: 1, min: 0, max: 2.5, step: 0.05, label: 'Regent light', unit: 'x', hint: 'Extra multiplier for the Foundry boss.' },

    // ---------------------------------------------------------------- Thalassa (dressing only, the sea and sky are in the sky group)
    ...motes('thalassa', 'Thalassa', { amount: 1, size: 1, bright: 1 }),

    // ---------------------------------------------------------------- Cinder Belt
    ...motes('cinder', 'Cinder', { amount: 1, size: 1, bright: 1 }),
    cinder_fogDensity: { section: 'Cinder fog and dust', value: 1, min: 0.4, max: 2.5, step: 0.05, label: 'Fog density', unit: 'x', hint: 'Scales how quickly the dark cyan void swallows distant debris.' },
    cinder_fogLayers: { section: 'Cinder fog and dust', value: 1, min: 0, max: 2.5, step: 0.05, label: 'Fog layers', unit: 'x', hint: 'Drifting sheets of cold mist and ember haze between the wreckage.' },
    cinder_dustRing: { section: 'Cinder fog and dust', value: 1, min: 0, max: 2.5, step: 0.05, label: 'Dust ring', unit: 'x', hint: 'Brightness of the thin lit ring of dust that arcs across the void.' },
    cinder_debrisGlow: { section: 'Cinder light', value: 1, min: 0, max: 2.5, step: 0.05, label: 'Debris crack glow', unit: 'x', hint: 'How hot the cracks in the drifting wreckage glow.' },
    cinder_crackPulse: { section: 'Cinder light', value: 0.5, min: 0, max: 1, step: 0.05, label: 'Crack pulse', unit: '', hint: 'How much the cracks breathe in and out.' },
    cinder_emberLight: { section: 'Cinder light', value: 1, min: 0, max: 3, step: 0.05, label: 'Ember light', unit: 'x', hint: 'Strength of the hot orange light that rakes the debris from the ember side.' },
    cinder_tension: { section: 'Cinder light', value: 0.6, min: 0, max: 1, step: 0.05, label: 'Tension flicker', unit: '', hint: 'Slow flare and dip of the ember light, stronger as the ring vessel gets close.' },
    cinder_voidLight: { section: 'Cinder light', value: 1, min: 0, max: 2.5, step: 0.05, label: 'Void fill light', unit: 'x', hint: 'Strength of the dark cyan fill that keeps the shadow side readable.' },

    // ---------------------------------------------------------------- Obsidian Foundry
    ...motes('foundry', 'Foundry', { amount: 1, size: 1, bright: 1 }),
    foundry_fogDensity: { section: 'Foundry fog', value: 1, min: 0.4, max: 2.5, step: 0.05, label: 'Fog density', unit: 'x', hint: 'Scales how quickly the smelter haze swallows the far corridor.' },
    foundry_smoke: { section: 'Foundry fog', value: 1, min: 0, max: 2.5, step: 0.05, label: 'Smoke sheets', unit: 'x', hint: 'Opacity of the slow smoke banks high in the hall.' },
    foundry_beamGlow: { section: 'Foundry glow', value: 1, min: 0, max: 2, step: 0.05, label: 'Smelter beam glow', unit: 'x', hint: 'Brightness of the blue-white smelter beams. 1 stays inside the bloom budget.' },
    foundry_beamHalo: { section: 'Foundry glow', value: 1, min: 0, max: 2.5, step: 0.05, label: 'Smelter beam halo', unit: 'x', hint: 'Strength of the blue halo around each beam.' },
    foundry_stripGlow: { section: 'Foundry glow', value: 1, min: 0, max: 2, step: 0.05, label: 'Wall seam glow', unit: 'x', hint: 'Brightness of the cold seams and molten runoff on the walls.' },
    foundry_poolGlow: { section: 'Foundry glow', value: 1, min: 0, max: 2, step: 0.05, label: 'Molten pool glow', unit: 'x', hint: 'Brightness of the crucible pools and channels in the floor.' },
    foundry_floorHaze: { section: 'Foundry glow', value: 1, min: 0, max: 2.5, step: 0.05, label: 'Floor glow haze', unit: 'x', hint: 'Soft orange haze above the molten floor.' },
    foundry_coldFill: { section: 'Foundry light', value: 1, min: 0, max: 3, step: 0.05, label: 'Cold fill light', unit: 'x', hint: 'Blue-white fill that travels with the ship and picks out the steel.' },
    foundry_furnaceLight: { section: 'Foundry light', value: 1, min: 0, max: 3, step: 0.05, label: 'Furnace light', unit: 'x', hint: 'Orange furnace light from below that pulses with the smelter surge.' },
    foundry_furnacePulse: { section: 'Foundry light', value: 0.6, min: 0, max: 1, step: 0.05, label: 'Furnace pulse', unit: '', hint: 'How deep the furnace light pulses.' },
    foundry_rimLight: { section: 'Foundry light', value: 1, min: 0, max: 3, step: 0.05, label: 'Orange edge light', unit: 'x', hint: 'Directional orange light that puts hot edges on the ship and steel.' },
    foundry_steel: { section: 'Foundry light', value: 1, min: 0, max: 2.5, step: 0.05, label: 'Cold steel light', unit: 'x', hint: 'Strength of the cold blue key and sky light on the walls.' },
    foundry_interior: { section: 'Foundry light', value: 0.55, min: 0.1, max: 1.5, step: 0.05, label: 'Forge interior level', unit: 'x', hint: 'Overall brightness of the light rig inside the sealed forge (rail 3900 to 4900).' },
  });
}
