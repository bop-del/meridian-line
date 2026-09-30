// Feel parameters for the "impact" group (registered into src/core/feel.js).
// Every value is READ from feel.p.impact.<key> each frame by the code that uses it (src/fx/impact.js, fx.js, hud.js, enemy.js).
//
// Shake units: "amp" is the peak camera offset in world units at intensity 1 (before the master scale and the caps).
// "freq" is the oscillation rate in Hz. "dur" multiplies the duration the caller asks for.

// per shake kind: [key, label, amp, freq, dur, hint]
const KINDS = [
  ['hit', 'Player hit', 0.5, 17, 1.0, 'Sharp, short and directional. Fires when the ship takes damage.'],
  ['blast', 'Blast', 0.85, 8, 1.0, 'Low frequency and heavy. Bombs, big kills and mine blasts.'],
  ['boss', 'Boss', 1.0, 6, 1.0, 'Boss phase changes, boss defeat and the largest explosions.'],
  ['roll', 'Barrel roll', 0.1, 14, 1.0, 'A very small ripple when the barrel roll starts.'],
  ['death', 'Death', 1.1, 5.5, 1.0, 'The ship is destroyed. Long and rumbling.'],
  ['fx', 'Explosion', 0.6, 11, 1.0, 'Generic effect shake: nearby explosions, shockwaves, part hits.'],
  ['charge', 'Charge', 0.35, 22, 1.0, 'Rising rumble used by charge up effects.'],
  ['reflect', 'Reflect', 0.22, 20, 1.0, 'A crisp tick when a rolling ship deflects a shot.'],
];

export function registerImpact(feel) {
  const defs = {
    // ---- shake, global
    shakeScale: { value: 1, min: 0, max: 2, step: 0.05, label: 'Shake: master scale', unit: 'x', hint: 'Multiplies every shake. 0 turns camera shake off.' },
    shakeRollScale: { value: 1, min: 0, max: 2, step: 0.05, label: 'Shake: roll scale', unit: 'x', hint: 'Multiplies the camera roll part of every shake.' },
    shakeMaxOffset: { value: 1.2, min: 0.2, max: 3, step: 0.05, label: 'Shake: max offset', unit: 'u', hint: 'Soft cap on the total camera offset from all layers together. Lower is calmer.' },
    shakeMaxRollDeg: { value: 3.5, min: 0, max: 10, step: 0.1, label: 'Shake: max roll', unit: 'deg', hint: 'Soft cap on the total camera roll from shake. Keep low to avoid nausea.' },
  };

  for (const [k, label, amp, freq, dur, hint] of KINDS) {
    defs[k + 'Amp'] = { value: amp, min: 0, max: 3, step: 0.01, label: `Shake ${label}: amplitude`, unit: 'u', hint: `${hint} Peak offset at intensity 1.` };
    defs[k + 'Freq'] = { value: freq, min: 1, max: 30, step: 0.5, label: `Shake ${label}: frequency`, unit: 'Hz', hint: 'Oscillation rate. Low feels heavy, high feels sharp.' };
    defs[k + 'Dur'] = { value: dur, min: 0.2, max: 3, step: 0.05, label: `Shake ${label}: duration`, unit: 'x', hint: 'Multiplies how long this kind of shake lasts.' };
  }

  Object.assign(defs, {
    // ---- player hit kick
    hitKick: { value: 0.32, min: 0, max: 1.5, step: 0.01, label: 'Hit kick: push', unit: 'u', hint: 'Camera shove away from the hit direction, settles quickly.' },
    hitKickBack: { value: 0.25, min: 0, max: 1.5, step: 0.01, label: 'Hit kick: pull back', unit: 'u', hint: 'Camera lurch backwards along the view axis on a hit.' },
    hitKickRollDeg: { value: 1.4, min: 0, max: 5, step: 0.1, label: 'Hit kick: roll', unit: 'deg', hint: 'Camera roll flick toward the side that was hit.' },
    hitKickDecay: { value: 11, min: 3, max: 30, step: 0.5, label: 'Hit kick: settle rate', unit: '1/s', hint: 'How fast the kick returns to zero. Higher is snappier.' },
    hitDirectional: { value: 0.7, min: 0, max: 1, step: 0.05, label: 'Hit shake: directional', unit: '', hint: '0 shakes in random directions, 1 shakes along the direction the hit came from.' },
    killShake: { value: 0.07, min: 0, max: 0.4, step: 0.005, label: 'Kill shake: per radius', unit: '', hint: 'Shake intensity per unit of enemy radius for kills of medium and large enemies.' },
    killShakeMinRadius: { value: 3, min: 0, max: 8, step: 0.1, label: 'Kill shake: min radius', unit: 'u', hint: 'Enemies smaller than this die without camera shake.' },
    explosionShake: { value: 1, min: 0, max: 2, step: 0.05, label: 'Explosion shake: scale', unit: 'x', hint: 'Scales shake caused by nearby explosion effects (big blasts only).' },

    // ---- hit-stop (gameplay time slows or stops for a moment, the render clock keeps running)
    hitStopMaster: { value: 1, min: 0, max: 2, step: 0.05, label: 'Hit-stop: master scale', unit: 'x', hint: 'Multiplies every hit-stop duration. 0 turns hit-stop off.' },
    hsBudget: { value: 0.3, min: 0, max: 1.5, step: 0.01, label: 'Hit-stop: budget', unit: 's', hint: 'Most stopped time available at once. Stops the game from stuttering in busy fights.' },
    hsRegen: { value: 0.2, min: 0, max: 1, step: 0.01, label: 'Hit-stop: budget regen', unit: 's/s', hint: 'How fast the budget refills.' },
    hsSmallKillDur: { value: 0, min: 0, max: 0.05, step: 0.005, label: 'Hit-stop: small kill', unit: 's', hint: 'Freeze on killing a small enemy. Off by default.' },
    hsSmallKillScale: { value: 0.3, min: 0, max: 1, step: 0.01, label: 'Hit-stop: small kill speed', unit: 'x', hint: 'Game speed during a small kill freeze.' },
    hsBigKillDur: { value: 0.05, min: 0, max: 0.3, step: 0.005, label: 'Hit-stop: big kill', unit: 's', hint: 'Freeze on killing a large enemy.' },
    hsBigKillScale: { value: 0.1, min: 0, max: 1, step: 0.01, label: 'Hit-stop: big kill speed', unit: 'x', hint: 'Game speed during a big kill freeze. 0 is a full stop.' },
    hsDamageDur: { value: 0.06, min: 0, max: 0.3, step: 0.005, label: 'Hit-stop: player damage', unit: 's', hint: 'Freeze when the ship takes a solid hit.' },
    hsDamageScale: { value: 0.1, min: 0, max: 1, step: 0.01, label: 'Hit-stop: damage speed', unit: 'x', hint: 'Game speed during the damage freeze.' },
    hsDamageMin: { value: 8, min: 0, max: 40, step: 1, label: 'Hit-stop: damage threshold', unit: 'hp', hint: 'Hits weaker than this do not freeze the game.' },
    hsBossPhaseDur: { value: 0.1, min: 0, max: 0.4, step: 0.005, label: 'Hit-stop: boss phase', unit: 's', hint: 'Freeze when a boss changes phase.' },
    hsBossPhaseScale: { value: 0.08, min: 0, max: 1, step: 0.01, label: 'Hit-stop: boss phase speed', unit: 'x', hint: 'Game speed during a boss phase freeze.' },
    hsBossDefeatDur: { value: 0.35, min: 0, max: 1, step: 0.01, label: 'Hit-stop: boss defeat', unit: 's', hint: 'Freeze when a boss is defeated.' },
    hsBossDefeatScale: { value: 0.14, min: 0, max: 1, step: 0.01, label: 'Hit-stop: boss defeat speed', unit: 'x', hint: 'Game speed during the boss defeat freeze.' },
    hsBombDur: { value: 0.07, min: 0, max: 0.3, step: 0.005, label: 'Hit-stop: bomb', unit: 's', hint: 'Freeze when a bomb detonates.' },
    hsBombScale: { value: 0.1, min: 0, max: 1, step: 0.01, label: 'Hit-stop: bomb speed', unit: 'x', hint: 'Game speed during the bomb freeze.' },
    hsDeathDur: { value: 0.3, min: 0, max: 1, step: 0.01, label: 'Hit-stop: death', unit: 's', hint: 'Freeze when the ship is destroyed.' },
    hsDeathScale: { value: 0.2, min: 0, max: 1, step: 0.01, label: 'Hit-stop: death speed', unit: 'x', hint: 'Game speed during the death freeze.' },
    hsEventScale: { value: 0.5, min: 0, max: 2, step: 0.05, label: 'Hit-stop: other events', unit: 'x', hint: 'Scales freezes requested by other code (boss parts and boss sequences).' },
    hsEventMax: { value: 0.2, min: 0, max: 1, step: 0.01, label: 'Hit-stop: other events cap', unit: 's', hint: 'Longest freeze allowed from those requests.' },
    hsEventSpeed: { value: 0.1, min: 0, max: 1, step: 0.01, label: 'Hit-stop: other events speed', unit: 'x', hint: 'Game speed during those freezes.' },

    // ---- damage feedback
    damageFlash: { value: 0.16, min: 0, max: 0.6, step: 0.01, label: 'Damage: hit flash', unit: '', hint: 'Strength of the brief red screen flash on the hit frame (fades in under 0.2 s).' },
    damagePulse: { value: 0.9, min: 0, max: 1.5, step: 0.05, label: 'Damage: edge pulse', unit: '', hint: 'Peak strength of the red edge vignette after a hit.' },
    damagePulseTime: { value: 0.55, min: 0.1, max: 2, step: 0.05, label: 'Damage: edge pulse time', unit: 's', hint: 'How long the red edge vignette takes to fade.' },
    hudDamageDir: { value: 0.85, min: 0, max: 1, step: 0.05, label: 'Damage: direction marker', unit: '', hint: 'Strength of the screen edge glow that shows which side the hit came from.' },
    lowHpThreshold: { value: 0.3, min: 0, max: 0.6, step: 0.01, label: 'Low health: threshold', unit: '', hint: 'Shield fraction below which the low health warning starts.' },
    lowHpStrength: { value: 0.35, min: 0, max: 1, step: 0.01, label: 'Low health: strength', unit: '', hint: 'Strength of the red edge heartbeat while shield is low.' },
    lowHpRate: { value: 1.1, min: 0.3, max: 3, step: 0.05, label: 'Low health: heartbeat', unit: 'Hz', hint: 'Heartbeat rate at the threshold. It speeds up as shield drops.' },

    // ---- hit confirm and kills
    hitSparkScale: { value: 1, min: 0, max: 3, step: 0.05, label: 'Hit spark: size', unit: 'x', hint: 'Size of the spark where a shot lands.' },
    hitSparkDistance: { value: 1, min: 0, max: 1, step: 0.05, label: 'Hit spark: distance boost', unit: '', hint: 'How much distant sparks are enlarged so they read at range. 0 is off.' },
    killBurstScale: { value: 1, min: 0, max: 3, step: 0.05, label: 'Kill burst: size', unit: 'x', hint: 'Size of the extra flash and ring on every kill.' },
    reticleHitPulse: { value: 0.45, min: 0, max: 1, step: 0.01, label: 'Reticle: hit pulse', unit: '', hint: 'Reticle pulse strength when a shot lands.' },
    reticleKillPulse: { value: 1, min: 0, max: 1, step: 0.01, label: 'Reticle: kill pulse', unit: '', hint: 'Reticle pulse strength on a kill.' },
    reticleLockPulse: { value: 0.35, min: 0, max: 1, step: 0.01, label: 'Reticle: lock pulse', unit: '', hint: 'Reticle pulse strength when a target lock is acquired.' },
    reticlePulseDecay: { value: 10, min: 2, max: 30, step: 0.5, label: 'Reticle: pulse decay', unit: '1/s', hint: 'How fast the reticle pulse fades.' },
    reticlePulseScale: { value: 0.16, min: 0, max: 0.6, step: 0.01, label: 'Reticle: pulse growth', unit: '', hint: 'How much the reticle grows at full pulse.' },
    reticlePulseBright: { value: 0.9, min: 0, max: 2, step: 0.05, label: 'Reticle: pulse brightness', unit: '', hint: 'How much brighter the reticle gets at full pulse.' },

    // ---- enemy telegraphs
    telegraphRing: { value: 1, min: 0, max: 1, step: 0.05, label: 'Telegraph: converging ring', unit: '', hint: 'Strength of the ring that closes on a muzzle just before an enemy fires.' },
    telegraphLine: { value: 0.7, min: 0, max: 1, step: 0.05, label: 'Telegraph: aim line', unit: '', hint: 'Strength of the thin line toward the ship during the last part of a wind-up.' },
    telegraphLineStart: { value: 0.45, min: 0, max: 0.95, step: 0.05, label: 'Telegraph: line starts at', unit: '', hint: 'Fraction of the wind-up after which the aim line appears.' },
    telegraphFlare: { value: 1, min: 0, max: 3, step: 0.05, label: 'Telegraph: fire flare', unit: 'x', hint: 'Size of the flash at the muzzle when the enemy actually fires.' },
    enemyShotPop: { value: 0.8, min: 0, max: 2, step: 0.05, label: 'Enemy shot: spawn pop', unit: '', hint: 'Enemy shots start larger and shrink to size in the first tenth of a second.' },
  });

  feel.register('impact', defs);
}
