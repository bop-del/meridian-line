// Feel parameters for the "cinema" group (registered into src/core/feel.js). Camera choreography.
// Read every frame by src/fx/cinema.js (takeovers, letterbox, HUD fade, intros, moments), src/core/cameraRig.js and
// src/cinema/helpers.js (fovKick), so the ?tune=1 panel takes effect at once. Per level values use the level id as prefix
// (foundry_, cinder_, thalassa_, see ctx.world.theme).
// Presets: 'cinematic' is the defaults (the same empty preset the look group defines), 'restrained' shortens the intros, halves the
// signature moments and FOV kicks and uses thinner bars.
const LEVELS = [['foundry', 'Foundry'], ['cinder', 'Cinder'], ['thalassa', 'Thalassa']];

export function registerCinema(feel) {
  const defs = {
    // takeovers (boss entrance and defeat shots, showcase shots)
    blendIn: { section: 'Takeovers', value: 0.55, min: 0, max: 2, step: 0.05, label: 'Blend in', unit: 's', hint: 'Default time a takeover shot takes to ease in from the chase camera (a shot may set its own).' },
    blendOut: { section: 'Takeovers', value: 0.75, min: 0, max: 2, step: 0.05, label: 'Blend out', unit: 's', hint: 'Default time the camera takes to ease back to the chase pose at the end of a shot, inside the 4 s cap.' },
    letterbox: { section: 'Takeovers', value: 0.085, min: 0, max: 0.16, step: 0.005, label: 'Letterbox bar size', unit: 'x', hint: 'Height of each black bar as a share of the screen height at full letterbox.' },
    barTime: { section: 'Takeovers', value: 0.4, min: 0.05, max: 1.5, step: 0.05, label: 'Letterbox slide time', unit: 's', hint: 'Time the bars take to slide in and out.' },
    hudFade: { section: 'Takeovers', value: 1, min: 0, max: 1, step: 0.05, label: 'HUD fade', unit: 'x', hint: 'How far the HUD fades during a shot that hides it (1 fully, 0 not at all). Warnings, banners and comm lines stay.' },
    fovKick: { section: 'Takeovers', value: 1, min: 0, max: 2, step: 0.05, label: 'FOV kicks', unit: 'x', hint: 'Scale of every FOV kick in shots (helpers fovKick) and in the signature moments.' },
    graceAfter: { section: 'Takeovers', value: 0.6, min: 0, max: 2, step: 0.05, label: 'Grace after a shot', unit: 's', hint: 'Extra invulnerability after a shot that makes the player invulnerable, so control never returns into a hit.' },
    // level intros
    introBars: { section: 'Level intros', value: 1, min: 0, max: 1, step: 0.05, label: 'Intro letterbox', unit: 'x', hint: 'Letterbox during the level intro flythrough (share of the full bar size).' },
    introHud: { section: 'Level intros', value: 0.3, min: 0, max: 0.8, step: 0.02, label: 'Intro HUD return', unit: 'x', hint: 'Share of the intro after which the HUD fades back in (it is fully back 0.2 later).' },
    // signature moments
    momentFov: { section: 'Signature moments', value: 1, min: 0, max: 2, step: 0.05, label: 'Moment FOV push', unit: 'x', hint: 'Scale of the FOV push in the signature moments (on top of FOV kicks).' },
  };
  for (const [id, name] of LEVELS) {
    defs[`${id}_intro`] = { section: 'Level intros', value: 1, min: 0.5, max: 1.5, step: 0.05, label: `${name} intro length`, unit: 'x', hint: `Time scale of the ${name} flythrough (1 is about 6 s).` };
  }
  for (const [id, name] of LEVELS) {
    defs[`${id}_moment`] = { section: 'Signature moments', value: 1, min: 0, max: 1.5, step: 0.05, label: `${name} moment strength`, unit: 'x', hint: `Strength of the ${name} signature camera move (0 turns it off).` };
  }
  feel.register('cinema', defs);

  const restrained = { 'cinema.letterbox': 0.06, 'cinema.fovKick': 0.5, 'cinema.momentFov': 0.5, 'cinema.introBars': 0.6, 'cinema.introHud': 0.15 };
  for (const [id] of LEVELS) { restrained[`cinema.${id}_intro`] = 0.7; restrained[`cinema.${id}_moment`] = 0.5; }
  feel.definePreset('restrained', restrained);
}
