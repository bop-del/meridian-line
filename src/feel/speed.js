// Feel parameters for the "speed" group (registered into src/core/feel.js).
// Every value is READ from feel.p.speed.<key> each frame by the code that uses it (src/fx/speedfx.js, src/fx/streaks.js,
// src/render/renderer.js, src/models/vanta.js), so the ?tune=1 panel takes effect instantly.
//
// Speed is described by one signed number s in -1..1: 0 at base flight speed, +1 at full boost, -1 at full brake. Every
// "Cruise / Boost / Brake" triple below is interpolated along s, so the three states can be tuned independently.
export function registerSpeed(feel) {
  feel.register('speed', {
    // ---- field of view
    baseFovGain: { section: 'Field of view', value: 2, min: 0, max: 10, step: 0.1, label: 'FOV gain at cruise', unit: 'deg', hint: 'Extra field of view at base flight speed compared with standing still (title screen).' },
    boostFov: { section: 'Field of view', value: 12, min: 0, max: 30, step: 0.5, label: 'Boost FOV', unit: 'deg', hint: 'Extra field of view at full boost speed.' },
    brakeFov: { section: 'Field of view', value: -6, min: -15, max: 0, step: 0.5, label: 'Brake FOV', unit: 'deg', hint: 'Field of view change at full brake. Negative narrows the view.' },
    fovCurve: { section: 'Field of view', value: 1.2, min: 0.5, max: 3, step: 0.05, label: 'Boost FOV curve', unit: '', hint: 'Above 1 the wide angle arrives late in the boost ramp, below 1 it arrives early.' },
    fovAttack: { section: 'Field of view', value: 7, min: 1, max: 30, step: 0.5, label: 'FOV attack', unit: '1/s', hint: 'How fast the field of view widens or narrows toward its target.' },
    fovRelease: { section: 'Field of view', value: 3.5, min: 0.5, max: 20, step: 0.5, label: 'FOV release', unit: '1/s', hint: 'How fast the field of view relaxes back toward cruise.' },
    boostPunch: { section: 'Field of view', value: 5, min: 0, max: 15, step: 0.5, label: 'Boost punch', unit: 'deg', hint: 'Brief extra widening on boost onset that overshoots and settles.' },
    brakePunch: { section: 'Field of view', value: -2, min: -10, max: 0, step: 0.5, label: 'Brake bite', unit: 'deg', hint: 'Brief extra narrowing on brake onset that overshoots and settles.' },
    punchSpeed: { section: 'Field of view', value: 11, min: 3, max: 30, step: 0.5, label: 'Punch stiffness', unit: 'rad/s', hint: 'Spring speed of the onset punch. Higher is snappier.' },
    punchDamping: { section: 'Field of view', value: 0.45, min: 0.1, max: 1, step: 0.05, label: 'Punch damping', unit: '', hint: 'Low values ring for longer after the punch, 1 is a single push with no overshoot.' },

    // ---- speed lines (long streaks)
    fxAttack: { section: 'Speed lines', value: 8, min: 1, max: 30, step: 0.5, label: 'Streak attack', unit: '1/s', hint: 'How fast streaks, dust and blur build up when speed rises.' },
    fxRelease: { section: 'Speed lines', value: 4, min: 0.5, max: 20, step: 0.5, label: 'Streak release', unit: '1/s', hint: 'How fast streaks, dust and blur fade when speed drops.' },
    linesBase: { section: 'Speed lines', value: 0.3, min: 0, max: 1, step: 0.02, label: 'Lines density, cruise', unit: '', hint: 'Fraction of speed lines visible at base speed.' },
    linesBoost: { section: 'Speed lines', value: 1, min: 0, max: 1, step: 0.02, label: 'Lines density, boost', unit: '', hint: 'Fraction of speed lines visible at full boost.' },
    linesBrake: { section: 'Speed lines', value: 0.06, min: 0, max: 1, step: 0.02, label: 'Lines density, brake', unit: '', hint: 'Fraction of speed lines visible at full brake.' },
    lineLenBase: { section: 'Speed lines', value: 6, min: 0.5, max: 40, step: 0.5, label: 'Line length, cruise', unit: 'u', hint: 'Streak length in world units at base speed.' },
    lineLenBoost: { section: 'Speed lines', value: 28, min: 0.5, max: 60, step: 0.5, label: 'Line length, boost', unit: 'u', hint: 'Streak length at full boost.' },
    lineLenBrake: { section: 'Speed lines', value: 1.5, min: 0.2, max: 40, step: 0.5, label: 'Line length, brake', unit: 'u', hint: 'Streak length at full brake. Short streaks make the stop readable.' },
    lineAlphaBase: { section: 'Speed lines', value: 0.2, min: 0, max: 1, step: 0.02, label: 'Line alpha, cruise', unit: '', hint: 'Brightness of speed lines at base speed.' },
    lineAlphaBoost: { section: 'Speed lines', value: 0.65, min: 0, max: 1.5, step: 0.02, label: 'Line alpha, boost', unit: '', hint: 'Brightness of speed lines at full boost.' },
    lineAlphaBrake: { section: 'Speed lines', value: 0.08, min: 0, max: 1, step: 0.02, label: 'Line alpha, brake', unit: '', hint: 'Brightness of speed lines at full brake.' },
    lineRadiusMin: { section: 'Speed lines', value: 3.5, min: 0.5, max: 15, step: 0.5, label: 'Line inner radius', unit: 'u', hint: 'Speed lines stay at least this far from the camera axis, keeping the ship and reticle clear.' },
    lineRadiusMax: { section: 'Speed lines', value: 24, min: 6, max: 60, step: 0.5, label: 'Line outer radius', unit: 'u', hint: 'Outer edge of the speed line tube.' },
    boostTint: { section: 'Speed lines', value: 0.7, min: 0, max: 1, step: 0.05, label: 'Boost colour shift', unit: '', hint: 'How far streak colour moves from cool blue toward hot teal white at full boost.' },
    brakeTint: { section: 'Speed lines', value: 0.35, min: 0, max: 1, step: 0.05, label: 'Brake colour shift', unit: '', hint: 'How far streak colour moves toward warm amber at full brake.' },

    // ---- space dust
    dustAlpha: { section: 'Space dust', value: 0.55, min: 0, max: 1.5, step: 0.02, label: 'Dust alpha', unit: '', hint: 'Brightness of the ambient dust motes.' },
    dustDensity: { section: 'Space dust', value: 1, min: 0, max: 1, step: 0.05, label: 'Dust density', unit: '', hint: 'Fraction of dust motes drawn.' },
    dustStretch: { section: 'Space dust', value: 0.03, min: 0, max: 0.12, step: 0.002, label: 'Dust stretch', unit: 's', hint: 'Dust streak length per unit of rail speed. Longer dust reads as faster.' },

    // ---- near parallax layer
    nearAlpha: { section: 'Near parallax layer', value: 0.4, min: 0, max: 1.5, step: 0.02, label: 'Near layer alpha', unit: '', hint: 'Brightness of the close, fast streaks that sweep past the camera. Makes speed obvious over empty water or space.' },
    nearDensity: { section: 'Near parallax layer', value: 1, min: 0, max: 1, step: 0.05, label: 'Near layer density', unit: '', hint: 'Fraction of near streaks drawn.' },
    nearStretch: { section: 'Near parallax layer', value: 0.05, min: 0, max: 0.2, step: 0.005, label: 'Near layer stretch', unit: 's', hint: 'Near streak length per unit of rail speed.' },
    nearRadiusMin: { section: 'Near parallax layer', value: 3.4, min: 0.5, max: 10, step: 0.1, label: 'Near layer inner radius', unit: 'u', hint: 'Closest distance from the camera axis.' },
    nearRadiusMax: { section: 'Near parallax layer', value: 10, min: 3, max: 30, step: 0.5, label: 'Near layer outer radius', unit: 'u', hint: 'Outer distance from the camera axis.' },

    // ---- motion blur and chromatic aberration
    blurBase: { section: 'Motion blur and chromatic aberration', value: 0.1, min: 0, max: 1, step: 0.02, label: 'Blur, cruise', unit: '', hint: 'Radial motion blur amount at base speed.' },
    blurBoost: { section: 'Motion blur and chromatic aberration', value: 0.85, min: 0, max: 1, step: 0.02, label: 'Blur, boost', unit: '', hint: 'Radial motion blur amount at full boost.' },
    blurBrake: { section: 'Motion blur and chromatic aberration', value: 0, min: 0, max: 1, step: 0.02, label: 'Blur, brake', unit: '', hint: 'Radial motion blur amount at full brake.' },
    blurStrength: { section: 'Motion blur and chromatic aberration', value: 0.075, min: 0, max: 0.2, step: 0.005, label: 'Blur reach', unit: '', hint: 'How far the radial blur smears at the screen edge when the blur amount is 1.' },
    blurClear: { section: 'Motion blur and chromatic aberration', value: 0.22, min: 0, max: 0.8, step: 0.02, label: 'Blur clear centre', unit: '', hint: 'Radius around the screen centre that stays sharp so the ship and reticle read clearly.' },
    chromaBase: { section: 'Motion blur and chromatic aberration', value: 0.0004, min: 0, max: 0.006, step: 0.0001, label: 'Chroma, cruise', unit: '', hint: 'Colour fringing added at base speed.' },
    chromaBoost: { section: 'Motion blur and chromatic aberration', value: 0.0012, min: 0, max: 0.012, step: 0.0002, label: 'Chroma, boost', unit: '', hint: 'Colour fringing at the screen edge at full boost, added on top of the hit chroma.' },

    // ---- ship boost and brake visuals
    flameBoost: { section: 'Ship boost and brake visuals', value: 1.2, min: 0, max: 3, step: 0.05, label: 'Flame growth, boost', unit: '', hint: 'How much the engine flame lengthens at full boost (0 keeps the idle length).' },
    flameBrake: { section: 'Ship boost and brake visuals', value: 0.55, min: 0, max: 1, step: 0.05, label: 'Flame shrink, brake', unit: '', hint: 'How much the engine flame shortens at full brake.' },
    boostFlash: { section: 'Ship boost and brake visuals', value: 1, min: 0, max: 3, step: 0.1, label: 'Boost onset flash', unit: '', hint: 'Size of the engine flash and flame surge when a boost starts.' },
    brakeFlare: { section: 'Ship boost and brake visuals', value: 1, min: 0, max: 3, step: 0.1, label: 'Air brake flare', unit: '', hint: 'Brightness of the amber flare ring at the engine while braking.' },
  });
}
