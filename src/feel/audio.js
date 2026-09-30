// Feel parameters for the "audio" group (registered into src/core/feel.js).
// Every value is READ from feel.p.audio.<key> by the audio modules (src/audio/mix.js, spatial.js, engine.js, voice.js and
// audio.js), each frame or at the moment a sound starts, so the ?tune=1 panel takes effect instantly.
//
// Units: bus levels are linear gain multipliers on top of the pause menu sliders. Duck depths are the music gain while the duck
// is fully in (1 = no duck, 0.5 = -6 dB). Attack and release times are "time to about 95 percent" in seconds.
export function registerAudio(feel) {
  feel.register('audio', {
    // ---- mix bus
    busMusic: { section: 'Mix bus', value: 1, min: 0, max: 1.5, step: 0.02, label: 'Music bus', unit: 'x', hint: 'Music level on top of the music slider.' },
    busSfx: { section: 'Mix bus', value: 1, min: 0, max: 1.5, step: 0.02, label: 'Effects bus', unit: 'x', hint: 'Weapons, impacts, pickups and interface sounds.' },
    busVoice: { section: 'Mix bus', value: 1, min: 0, max: 2, step: 0.02, label: 'Voice bus', unit: 'x', hint: 'Pilot voice barks and data blips.' },
    busEngine: { section: 'Mix bus', value: 1, min: 0, max: 2, step: 0.02, label: 'Engine bus', unit: 'x', hint: 'The continuous engine voice.' },
    compThreshold: { section: 'Mix bus', value: -16, min: -40, max: 0, step: 0.5, label: 'Compressor threshold', unit: 'dB', hint: 'Master compressor threshold. Lower squeezes the whole mix harder.' },
    compRatio: { section: 'Mix bus', value: 4, min: 1, max: 20, step: 0.5, label: 'Compressor ratio', unit: ':1', hint: 'Master compressor ratio.' },
    limitThreshold: { section: 'Mix bus', value: -3, min: -12, max: 0, step: 0.5, label: 'Limiter ceiling', unit: 'dB', hint: 'Brick wall limiter threshold at the end of the chain.' },

    // ---- ducking
    duckVoiceDepth: { section: 'Ducking', value: 0.55, min: 0.15, max: 1, step: 0.02, label: 'Dialogue duck depth', unit: 'x', hint: 'Music gain while a pilot line is on the radio. 1 turns the duck off.' },
    duckVoiceAttack: { section: 'Ducking', value: 0.08, min: 0.01, max: 0.6, step: 0.01, label: 'Dialogue duck attack', unit: 's', hint: 'How fast the music dips when a line starts.' },
    duckVoiceRelease: { section: 'Ducking', value: 0.8, min: 0.1, max: 3, step: 0.05, label: 'Dialogue duck release', unit: 's', hint: 'How long the music takes to come back after the line.' },
    duckBoomDepth: { section: 'Ducking', value: 0.62, min: 0.15, max: 1, step: 0.02, label: 'Big blast duck depth', unit: 'x', hint: 'Music gain under bombs, big explosions and the player death.' },
    duckBoomHold: { section: 'Ducking', value: 0.3, min: 0, max: 2, step: 0.05, label: 'Big blast duck hold', unit: 's', hint: 'How long the dip is held before the release starts.' },
    duckBoomRelease: { section: 'Ducking', value: 0.9, min: 0.1, max: 4, step: 0.05, label: 'Big blast duck release', unit: 's', hint: 'Recovery time after a big blast.' },
    duckBossDepth: { section: 'Ducking', value: 0.35, min: 0.1, max: 1, step: 0.02, label: 'Boss defeat duck depth', unit: 'x', hint: 'Music gain during the boss defeat sequence, so the finale is heard.' },
    duckBossHold: { section: 'Ducking', value: 1.4, min: 0, max: 5, step: 0.1, label: 'Boss defeat duck hold', unit: 's', hint: 'How long the boss defeat dip is held.' },
    duckCinemaDepth: { section: 'Ducking', value: 0.55, min: 0.15, max: 1, step: 0.02, label: 'Takeover duck depth', unit: 'x', hint: 'Music gain while a camera takeover runs (boss entrance and finisher).' },
    duckCinemaRelease: { section: 'Ducking', value: 1, min: 0.1, max: 4, step: 0.05, label: 'Takeover duck release', unit: 's', hint: 'Recovery time after the takeover ends.' },
    duckEngine: { section: 'Ducking', value: 0.5, min: 0, max: 1, step: 0.05, label: 'Engine follows duck', unit: '', hint: 'How much of the music duck also lowers the engine (0 none, 1 the same amount).' },
    whooshCinema: { section: 'Ducking', value: 0.7, min: 0, max: 1.5, step: 0.05, label: 'Takeover whoosh', unit: 'x', hint: 'Level of the whoosh that marks the start and end of a camera takeover. 0 is off.' },

    // ---- spatial sound
    spatialStrength: { section: 'Spatial sound', value: 1, min: 0, max: 1, step: 0.05, label: 'Spatial strength', unit: '', hint: 'How far positioned sounds swing left and right. 0 puts everything in the centre.' },
    spatialRolloff: { section: 'Spatial sound', value: 70, min: 15, max: 400, step: 5, label: 'Distance rolloff', unit: 'u', hint: 'Distance at which a sound has lost half of its level.' },
    spatialFloor: { section: 'Spatial sound', value: 0.12, min: 0, max: 0.6, step: 0.01, label: 'Distance floor', unit: 'x', hint: 'Quietest a far sound can get (fraction of full level), so distant blasts stay audible.' },
    offscreenGain: { section: 'Spatial sound', value: 0.65, min: 0.1, max: 1, step: 0.02, label: 'Off screen level', unit: 'x', hint: 'Level of sounds outside the view or behind the camera.' },
    offscreenLP: { section: 'Spatial sound', value: 3200, min: 500, max: 12000, step: 100, label: 'Off screen filter', unit: 'Hz', hint: 'Low pass cutoff for fully off screen sounds. Lower is duller.' },
    spatialHRTF: { section: 'Spatial sound', value: 0, min: 0, max: 1, step: 1, label: 'HRTF panning', unit: '', hint: '0 equal power panning (cheap), 1 HRTF (headphones, more CPU).' },

    // ---- engine
    engBrakeHz: { section: 'Engine', value: 42, min: 20, max: 90, step: 1, label: 'Pitch at full brake', unit: 'Hz', hint: 'Rotor fundamental when braking.' },
    engCruiseHz: { section: 'Engine', value: 70, min: 30, max: 140, step: 1, label: 'Pitch at cruise', unit: 'Hz', hint: 'Rotor fundamental at base speed.' },
    engBoostHz: { section: 'Engine', value: 128, min: 60, max: 260, step: 1, label: 'Pitch at full boost', unit: 'Hz', hint: 'Rotor fundamental at full boost.' },
    engCutoffBrake: { section: 'Engine', value: 240, min: 100, max: 2000, step: 10, label: 'Brightness, brake', unit: 'Hz', hint: 'Rotor low pass cutoff when braking.' },
    engCutoffCruise: { section: 'Engine', value: 620, min: 150, max: 4000, step: 10, label: 'Brightness, cruise', unit: 'Hz', hint: 'Rotor low pass cutoff at base speed.' },
    engCutoffBoost: { section: 'Engine', value: 3400, min: 500, max: 9000, step: 50, label: 'Brightness, boost', unit: 'Hz', hint: 'Rotor low pass cutoff at full boost.' },
    engLevel: { section: 'Engine', value: 1, min: 0, max: 2, step: 0.05, label: 'Engine body level', unit: 'x', hint: 'Rotor, sub and wind layers (the boost roar has its own control).' },
    engRoar: { section: 'Engine', value: 1, min: 0, max: 2.5, step: 0.05, label: 'Boost roar', unit: 'x', hint: 'Level of the roar that builds while boosting.' },
    engRoarBuild: { section: 'Engine', value: 0.8, min: 0.1, max: 2, step: 0.05, label: 'Roar build time', unit: 's', hint: 'How long the boost roar takes to swell to full.' },
    engBrakeWhine: { section: 'Engine', value: 1, min: 0, max: 2.5, step: 0.05, label: 'Brake whine', unit: 'x', hint: 'Level of the falling whine and air hiss while braking.' },
    engRattle: { section: 'Engine', value: 1, min: 0, max: 2, step: 0.05, label: 'Low health rattle', unit: 'x', hint: 'Strength of the stuttering rattle and pitch wobble when the shield is low.' },
    engRattleAt: { section: 'Engine', value: 0.4, min: 0.05, max: 0.8, step: 0.01, label: 'Rattle starts at', unit: '', hint: 'Shield fraction below which the engine starts to rattle.' },
    engSteerPan: { section: 'Engine', value: 0.3, min: 0, max: 0.8, step: 0.02, label: 'Steering pan', unit: '', hint: 'How far the engine drifts to the side you are steering toward.' },

    // ---- pilot voices
    voicePitch: { section: 'Pilot voices', value: 1, min: 0.6, max: 1.6, step: 0.02, label: 'Voice pitch', unit: 'x', hint: 'Scales the pitch of all voice barks.' },
    voiceRate: { section: 'Pilot voices', value: 1, min: 0.5, max: 2, step: 0.05, label: 'Voice rate', unit: 'x', hint: 'Syllable speed. Higher is faster and clipped.' },
    radioLow: { section: 'Pilot voices', value: 340, min: 100, max: 900, step: 10, label: 'Radio high pass', unit: 'Hz', hint: 'Radio band pass, low edge.' },
    radioHigh: { section: 'Pilot voices', value: 3300, min: 1500, max: 8000, step: 100, label: 'Radio low pass', unit: 'Hz', hint: 'Radio band pass, high edge.' },
    radioGrit: { section: 'Pilot voices', value: 0.35, min: 0, max: 1, step: 0.05, label: 'Radio grit', unit: '', hint: 'Amount of soft distortion on the radio channel.' },
    radioStatic: { section: 'Pilot voices', value: 0.5, min: 0, max: 1.5, step: 0.05, label: 'Radio static', unit: 'x', hint: 'Level of the static bed and the key click around each line.' },
    blipLevel: { section: 'Pilot voices', value: 1, min: 0, max: 2, step: 0.05, label: 'Data blip level', unit: 'x', hint: 'Level of the non speech blips for PIP, LUMEN and CONTROL.' },
  });
}
