// Single source of truth for HUD and game flow.
import { config } from '../config.js';

function fresh() {
  return {
    score: 0, hits: 0, kills: 0,   // hits is the KILLS counter shown on the HUD
    health: config.player.maxHealth, maxHealth: config.player.maxHealth,
    lives: config.player.lives, bombs: config.player.bombs,
    boost: 1, boostCooldown: 0, laserLevel: 1, boss: null,
    comboTimer: 0, combo: 0, multiplier: 1, levelTime: 0,
    levelStart: { score: 0, hits: 0, kills: 0, lives: 0 },   // snapshot at level start (used for restart and per level stats)
    levelStats: null,                               // set on level complete: { hits, kills, score, time, levelIndex, health, maxHealth, lives, livesLost, escortsAlive, escortsTotal }
  };
}

export const state = {
  phase: 'title', difficulty: 'normal', levelIndex: 0, god: false,
  ...fresh(),
  reset() { Object.assign(state, fresh()); },
};
