// Feel parameters for the "handling" group (registered into src/core/feel.js).
// Every value is READ from feel.p.handling.<key> each frame by the code that uses it:
//   src/core/input.js (key*, stick*, doubleTap*), src/entities/player.js (ship, bank, surge, roll*),
//   src/core/rail.js (boost and brake speed ramps), src/core/cameraRig.js (cam*).
// The registered defaults are the `tight` preset (picked after playing all three). `weighty` and `floaty` stay as presets.
//
// Units: u = world units, u/s = units per second, 1/s = exponential rate (higher is faster), Hz = spring frequency
// (higher is stiffer), damping = spring damping ratio (1 is critical: no overshoot, below 1 overshoots and settles).

const DEFS = {
  // ---- input
  keyAttack: { value: 0.08, min: 0.01, max: 0.4, step: 0.005, label: 'Input: key ramp up', unit: 's', hint: 'Time for a held steering key to reach full deflection. Lower is snappier. The first frame always moves.' },
  keyRelease: { value: 0.06, min: 0.01, max: 0.4, step: 0.005, label: 'Input: key ramp down', unit: 's', hint: 'Time for the steering to return to centre after the key is released.' },
  keyExpo: { value: 1.15, min: 1, max: 2.5, step: 0.05, label: 'Input: key curve', unit: '', hint: 'Response curve on the keyboard ramp. 1 is linear, higher makes short taps finer while a held key still reaches full speed.' },
  stickDeadzone: { value: 0.16, min: 0, max: 0.4, step: 0.01, label: 'Input: stick deadzone', unit: '', hint: 'Gamepad stick deflection that is ignored around the centre.' },
  stickExpo: { value: 1.35, min: 1, max: 3, step: 0.05, label: 'Input: stick curve', unit: '', hint: 'Gamepad stick response curve. 1 is linear, higher gives finer control near the centre.' },
  stickSmooth: { value: 0.03, min: 0, max: 0.2, step: 0.005, label: 'Input: stick smoothing', unit: 's', hint: 'Light smoothing on analog steering. 0 is raw.' },
  doubleTap: { value: 1, min: 0, max: 1, step: 1, label: 'Input: double tap roll', unit: 'on', hint: 'Barrel roll on a quick double tap of left or right. Q and E always roll. 0 turns double tap off.' },
  doubleTapWindow: { value: 0.16, min: 0.08, max: 0.4, step: 0.01, label: 'Input: double tap gap', unit: 's', hint: 'Longest gap between the release of the first tap and the second press.' },
  doubleTapPress: { value: 0.11, min: 0.05, max: 0.3, step: 0.01, label: 'Input: double tap press', unit: 's', hint: 'The first press must be shorter than this to count as a tap. Longer presses are steering.' },
  doubleTapQuiet: { value: 0.3, min: 0, max: 1, step: 0.05, label: 'Input: double tap quiet', unit: 's', hint: 'No left or right key may be touched this long before the first tap. Stops rapid corrective taps from rolling.' },

  // ---- ship response
  speedX: { value: 32, min: 10, max: 60, step: 0.5, label: 'Ship: top lateral speed', unit: 'u/s', hint: 'Sideways speed at full deflection.' },
  speedY: { value: 23, min: 8, max: 45, step: 0.5, label: 'Ship: top vertical speed', unit: 'u/s', hint: 'Up and down speed at full deflection.' },
  accel: { value: 14, min: 2, max: 40, step: 0.5, label: 'Ship: acceleration', unit: '1/s', hint: 'How fast the ship reaches the speed you steer for. Higher is tighter.' },
  reverseAccel: { value: 24, min: 2, max: 60, step: 0.5, label: 'Ship: reverse bite', unit: '1/s', hint: 'Acceleration when steering against the current motion. Higher changes direction faster.' },
  decel: { value: 10, min: 1, max: 40, step: 0.5, label: 'Ship: coast stop', unit: '1/s', hint: 'How fast the ship stops after the key is released. Lower drifts further (more mass).' },
  edgeSoft: { value: 2.6, min: 0, max: 6, step: 0.1, label: 'Ship: soft edge', unit: 'u', hint: 'Distance from the play area edge over which the ship eases to a stop instead of hitting a wall. 0 is a hard stop.' },
  boostSteer: { value: 0.88, min: 0.4, max: 1.4, step: 0.01, label: 'Ship: boost steering', unit: 'x', hint: 'Steering speed multiplier while boosting.' },
  brakeSteer: { value: 1.12, min: 0.6, max: 1.6, step: 0.01, label: 'Ship: brake steering', unit: 'x', hint: 'Steering speed multiplier while braking.' },

  // ---- banking and attitude (springs, so the ship shows mass)
  bankRoll: { value: 38, min: 0, max: 75, step: 1, label: 'Bank: roll angle', unit: 'deg', hint: 'Roll at full sideways speed.' },
  bankPitch: { value: 16, min: 0, max: 40, step: 0.5, label: 'Bank: pitch angle', unit: 'deg', hint: 'Nose up or down at full vertical speed.' },
  bankYaw: { value: 8, min: 0, max: 25, step: 0.5, label: 'Bank: yaw angle', unit: 'deg', hint: 'Nose turn into the direction of travel at full sideways speed.' },
  bankIntent: { value: 0.35, min: 0, max: 1, step: 0.05, label: 'Bank: stick lead', unit: '', hint: 'Share of the attitude taken from the stick instead of the actual speed. Higher leans the ship the moment you press.' },
  bankAccel: { value: 0.3, min: 0, max: 1, step: 0.05, label: 'Bank: from acceleration', unit: '', hint: 'Extra lean from sideways acceleration: the ship leans in hard when a turn starts and counter leans briefly when it stops.' },
  bankFreq: { value: 3.0, min: 0.5, max: 8, step: 0.1, label: 'Bank: roll stiffness', unit: 'Hz', hint: 'Spring frequency of the roll. Lower feels heavier and slower.' },
  bankDamping: { value: 0.4, min: 0.15, max: 1.5, step: 0.01, label: 'Bank: roll damping', unit: '', hint: 'Below 1 the roll overshoots and settles (mass). 1 is no overshoot.' },
  attFreq: { value: 3.2, min: 0.5, max: 8, step: 0.1, label: 'Bank: pitch and yaw stiffness', unit: 'Hz', hint: 'Spring frequency of pitch and yaw.' },
  attDamping: { value: 0.45, min: 0.15, max: 1.5, step: 0.01, label: 'Bank: pitch and yaw damping', unit: '', hint: 'Below 1 pitch and yaw overshoot and settle.' },
  surgeGain: { value: 0.012, min: 0, max: 0.05, step: 0.001, label: 'Ship: surge', unit: 's2', hint: 'The ship slips back on boost and forward on brake relative to its lane, from the change in speed.' },
  surgeMax: { value: 1.4, min: 0, max: 4, step: 0.05, label: 'Ship: surge limit', unit: 'u', hint: 'Largest forward or backward slip.' },
  surgeFreq: { value: 1.8, min: 0.3, max: 6, step: 0.1, label: 'Ship: surge stiffness', unit: 'Hz', hint: 'Spring frequency of the slip. Lower is floatier.' },

  // ---- barrel roll
  rollTime: { value: 0.42, min: 0.2, max: 1, step: 0.01, label: 'Roll: duration', unit: 's', hint: 'Length of a barrel roll. The ship is safe from shots while rolling.' },
  rollKick: { value: 14, min: 0, max: 45, step: 0.5, label: 'Roll: side kick', unit: 'u/s', hint: 'Sideways burst of speed in the roll direction.' },
  rollCommit: { value: 0.14, min: 0, max: 0.4, step: 0.01, label: 'Roll: commit', unit: 's', hint: 'Time at the start of a roll that holds the side kick and ignores steering.' },
  rollSteer: { value: 0.65, min: 0, max: 1, step: 0.05, label: 'Roll: steering', unit: 'x', hint: 'Steering authority for the rest of the roll.' },
  rollShape: { value: 0.6, min: 0, max: 1, step: 0.05, label: 'Roll: snap', unit: '', hint: '0 eases in and out evenly, 1 spins fast at the start and eases out.' },
  rollCooldown: { value: 0.2, min: 0, max: 1, step: 0.01, label: 'Roll: cooldown', unit: 's', hint: 'Pause after a roll before the next one.' },

  // ---- boost and brake (rail speed)
  boostSpeed: { value: 75, min: 45, max: 120, step: 1, label: 'Boost: top speed', unit: 'u/s', hint: 'Forward speed at full boost (base is 40).' },
  boostRamp: { value: 3.2, min: 0.5, max: 12, step: 0.1, label: 'Boost: ramp up', unit: '1/s', hint: 'How fast the forward speed climbs to boost speed.' },
  boostPunch: { value: 7, min: 0, max: 25, step: 0.5, label: 'Boost: onset punch', unit: 'u/s', hint: 'Instant speed added the moment boost starts.' },
  boostRelease: { value: 2.2, min: 0.5, max: 10, step: 0.1, label: 'Boost: ramp down', unit: '1/s', hint: 'How fast the speed returns to base after boost.' },
  brakeSpeed: { value: 22, min: 5, max: 38, step: 1, label: 'Brake: low speed', unit: 'u/s', hint: 'Forward speed at full brake.' },
  brakeBite: { value: 5, min: 0.5, max: 15, step: 0.1, label: 'Brake: bite', unit: '1/s', hint: 'How fast the speed drops when braking.' },
  brakePunch: { value: 5, min: 0, max: 15, step: 0.5, label: 'Brake: onset punch', unit: 'u/s', hint: 'Instant speed removed the moment the brake bites.' },
  brakeRelease: { value: 2.8, min: 0.5, max: 10, step: 0.1, label: 'Brake: ramp back', unit: '1/s', hint: 'How fast the speed returns to base after the brake.' },

  // ---- chase camera
  camFov: { value: 68, min: 50, max: 90, step: 0.5, label: 'Camera: base FOV', unit: 'deg', hint: 'Field of view at base speed. The speed group adds its FOV kick on top.' },
  camDistance: { value: 12.5, min: 6, max: 24, step: 0.1, label: 'Camera: distance', unit: 'u', hint: 'Distance behind the ship at base speed.' },
  camHeight: { value: 3.4, min: 0, max: 8, step: 0.05, label: 'Camera: height', unit: 'u', hint: 'Height above the ship lane.' },
  camFollowX: { value: 0.58, min: 0, max: 1, step: 0.01, label: 'Camera: follow sideways', unit: 'x', hint: 'Share of the ship sideways offset the camera follows. Lower keeps the frame steady and lets the ship move across it.' },
  camFollowY: { value: 0.5, min: 0, max: 1, step: 0.01, label: 'Camera: follow vertical', unit: 'x', hint: 'Share of the ship vertical offset the camera follows.' },
  camLookX: { value: 0.78, min: 0, max: 1.2, step: 0.01, label: 'Camera: aim sideways', unit: 'x', hint: 'Share of the ship sideways offset the camera looks toward.' },
  camLookY: { value: 0.7, min: 0, max: 1.2, step: 0.01, label: 'Camera: aim vertical', unit: 'x', hint: 'Share of the ship vertical offset the camera looks toward.' },
  camLookAhead: { value: 38, min: 10, max: 80, step: 1, label: 'Camera: look ahead', unit: 'u', hint: 'Distance ahead of the ship the camera aims at.' },
  camLookLead: { value: 0.12, min: 0, max: 0.4, step: 0.01, label: 'Camera: turn lead', unit: 's', hint: 'The aim point leads into the turn by this much of the sideways speed.' },
  camSwing: { value: 0.035, min: 0, max: 0.12, step: 0.005, label: 'Camera: swing', unit: 's', hint: 'The camera swings out against sideways speed, which yaws the view into the turn.' },
  camFreqX: { value: 2.1, min: 0.5, max: 8, step: 0.1, label: 'Camera: lag sideways', unit: 'Hz', hint: 'Stiffness of the sideways follow spring. Lower trails more.' },
  camFreqY: { value: 2.3, min: 0.5, max: 8, step: 0.1, label: 'Camera: lag vertical', unit: 'Hz', hint: 'Stiffness of the vertical follow spring.' },
  camFreqZ: { value: 1.7, min: 0.3, max: 8, step: 0.1, label: 'Camera: lag distance', unit: 'Hz', hint: 'Stiffness of the distance spring (boost and brake changes).' },
  camLookFreq: { value: 3.0, min: 0.5, max: 10, step: 0.1, label: 'Camera: aim lag', unit: 'Hz', hint: 'Stiffness of the aim point spring.' },
  camDamping: { value: 1, min: 0.6, max: 1.6, step: 0.02, label: 'Camera: damping', unit: '', hint: '1 is critical damping: smooth, no jelly. Below 1 the camera bounces.' },
  camRoll: { value: 0.22, min: 0, max: 0.6, step: 0.01, label: 'Camera: roll with bank', unit: 'x', hint: 'Share of the ship bank the camera rolls with.' },
  camRollFreq: { value: 1.8, min: 0.3, max: 6, step: 0.1, label: 'Camera: roll lag', unit: 'Hz', hint: 'Stiffness of the camera roll spring.' },
  camBoostPush: { value: 1.3, min: -3, max: 4, step: 0.05, label: 'Camera: boost push in', unit: 'u', hint: 'The camera moves closer at full boost speed (the FOV widens, so the ship keeps its size and the world stretches).' },
  camBoostHeight: { value: -0.35, min: -2, max: 2, step: 0.05, label: 'Camera: boost height', unit: 'u', hint: 'Height change at full boost speed. Negative drops the camera for more speed.' },
  camBrakePull: { value: 2.2, min: -2, max: 6, step: 0.05, label: 'Camera: brake pull back', unit: 'u', hint: 'The camera moves back at full brake.' },
  camBrakeHeight: { value: 0.45, min: -2, max: 2, step: 0.05, label: 'Camera: brake height', unit: 'u', hint: 'Height change at full brake.' },
  camAccelLag: { value: 0.022, min: 0, max: 0.08, step: 0.001, label: 'Camera: speed lag', unit: 's2', hint: 'The camera falls back when the speed jumps up and closes in when it drops, then settles.' },
  camMinDist: { value: 6, min: 3, max: 12, step: 0.1, label: 'Camera: min distance', unit: 'u', hint: 'Hard limit: the camera never gets closer to the ship than this.' },
};

// Presets. `tight` is the registered default (applied in registerHandling), `weighty` is a full snapshot of the original defaults.
// Paths are 'handling.<key>'. Keys not listed in a preset keep their default.
const P = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [`handling.${k}`, v]));
const WEIGHTY = P(Object.fromEntries(Object.entries(DEFS).map(([k, d]) => [k, d.value])));
const TIGHT = P({
  keyAttack: 0.04, keyRelease: 0.035, keyExpo: 1,
  accel: 22, reverseAccel: 36, decel: 20, edgeSoft: 1.4,
  bankRoll: 30, bankPitch: 12, bankYaw: 5, bankIntent: 0.5, bankAccel: 0.15, bankFreq: 4.5, bankDamping: 0.85, attFreq: 5, attDamping: 0.9,
  surgeGain: 0.006, surgeFreq: 3,
  rollTime: 0.34, rollKick: 20, rollCommit: 0.08, rollSteer: 0.85, rollShape: 0.8, rollCooldown: 0.12,
  boostRamp: 5.5, boostPunch: 10, boostRelease: 4, brakeBite: 8, brakePunch: 7, brakeRelease: 4.5,
  camFreqX: 3.6, camFreqY: 3.8, camFreqZ: 3, camLookFreq: 5, camLookLead: 0.06, camSwing: 0.015, camRoll: 0.12, camRollFreq: 3.5,
  camAccelLag: 0.01, camBoostPush: 0.8, camBrakePull: 1.4,
});
const FLOATY = { ...WEIGHTY, ...P({
  keyAttack: 0.2, keyRelease: 0.25, keyExpo: 1.4,
  accel: 5, reverseAccel: 7, decel: 3, edgeSoft: 5,
  bankRoll: 55, bankPitch: 24, bankYaw: 14, bankIntent: 0.1, bankAccel: 0.5, bankFreq: 1.2, bankDamping: 0.28, attFreq: 1.4, attDamping: 0.3,
  surgeGain: 0.03, surgeMax: 3, surgeFreq: 0.9,
  rollTime: 0.7, rollKick: 12, rollCommit: 0.25, rollSteer: 0.4, rollShape: 0.2, rollCooldown: 0.3,
  boostRamp: 1.4, boostPunch: 2, boostRelease: 1, brakeBite: 2, brakePunch: 1, brakeRelease: 1.2,
  camFreqX: 0.9, camFreqY: 1, camFreqZ: 0.8, camLookFreq: 1.3, camLookLead: 0.25, camSwing: 0.07, camRoll: 0.4, camRollFreq: 0.9,
  camDamping: 0.75, camAccelLag: 0.045, camBoostPush: 2, camBrakePull: 3.5,
}) };

export function registerHandling(feel) {
  // `tight` values become the registered defaults
  for (const [path, v] of Object.entries(TIGHT)) DEFS[path.slice('handling.'.length)].value = v;
  feel.register('handling', DEFS);
  feel.definePreset('weighty', WEIGHTY);
  feel.definePreset('tight', TIGHT);
  feel.definePreset('floaty', FLOATY);
}
