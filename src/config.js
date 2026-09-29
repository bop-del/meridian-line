// Central tunables. Every module reads from here.
export const config = {
  rail: {
    baseSpeed: 40, boostSpeed: 75, brakeSpeed: 22,
    accel: 2.8,          // 1/s smoothing of rail speed towards its target
    titleSpeed: 5,       // gentle drift behind the title screen
    titleMaxDistance: 90,
  },
  bounds: { x: 14, y: 8 },
  player: {
    maxHealth: 100, lives: 3, bombs: 3, maxBombs: 9,
    invulnerableAfterHit: 1.2, respawnInvulnerable: 3.0, fireRate: 7,
    radius: 1.6,          // broad radius (pickups, ram tests)
    hitRadius: 1.15,      // radius used against enemy shots and obstacles (fair hitbox)
    // steering
    speedX: 34, speedY: 24, accel: 12, reverseAccel: 20, decel: 9,
    boostSteer: 0.88, brakeSteer: 1.12,
    bankRoll: 0.72, bankPitch: 0.34, bankYaw: 0.16,
    // barrel roll
    rollTime: 0.5, rollCooldown: 0.2, rollKick: 20, doubleTapWindow: 0.26,
    // boost
    boostDrain: 0.5, boostRegen: 0.28, boostRegenDelay: 0.6, boostLockout: 2.4, boostMinStart: 0.08,
    // weapons. Damage units: 1 = one twin-laser hit; enemy hp in enemies/types is expressed in these units.
    laser: {
      1: { rate: 8.0, damage: 1, speed: 230, radius: 0.5, size: 1.0, both: false, color: 0xffb02e },
      2: { rate: 6.8, damage: 1, speed: 240, radius: 0.55, size: 1.15, both: true, color: 0xffd76a },
      3: { rate: 5.6, damage: 2, speed: 260, radius: 0.9, size: 1.9, both: true, color: 0xff5ad0 },
    },
    laserLife: 1.25,
    aimAssist: 0.3,
    chargeTime: 0.6, lockTime: 0.1, maxLocks: 6, volleyDamage: 3, volleySpeed: 150, volleyStagger: 0.055,
    bombCooldown: 0.9, bombRadius: 58, bombDamage: 14, bombBossFactor: 0.3,
  },
  camera: {
    fov: 68, height: 3.4, distance: 12.5, followX: 0.58, followY: 0.5, lookX: 0.78, lookY: 0.7, lookAhead: 38,
    boostFov: 15, brakeFov: -4, boostPull: 1.4, brakePull: 3.2, roll: 0.55, damping: 7.5,
    introTime: 2.8, shakeMax: 1.0,
  },
  difficulty: {
    easy:   { enemyHp: 0.8, enemyDamage: 0.7, enemyFireRate: 0.8, enemyCount: 0.8 },
    normal: { enemyHp: 1.0, enemyDamage: 1.0, enemyFireRate: 1.0, enemyCount: 1.0 },
    hard:   { enemyHp: 1.3, enemyDamage: 1.4, enemyFireRate: 1.25, enemyCount: 1.2 },
  },
  combo: { window: 2.6, step: 4, maxMultiplier: 5 },
  levels: ['thalassa', 'cinder', 'foundry'],
};
