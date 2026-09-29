// The rail: an invisible anchor that flies forward along -Z. Speed lerps to boost/brake targets.
import * as THREE from 'three';
import { config } from '../config.js';

export const rail = {
  position: new THREE.Vector3(),
  speed: config.rail.baseSpeed,
  baseSpeed: config.rail.baseSpeed,
  distance: 0,
  speedMultiplier: 1,   // other modules (world, bosses, fly-outs) may scale the rail speed
  targetSpeed: config.rail.baseSpeed,
  frozen: false,        // set true to hold the rail still

  reset() {
    this.position.set(0, 0, 0);
    this.baseSpeed = config.rail.baseSpeed;
    this.speed = this.baseSpeed;
    this.targetSpeed = this.baseSpeed;
    this.speedMultiplier = 1;
    this.frozen = false;
    this.distance = 0;
  },

  update(dt, ctx) {
    const c = config.rail;
    const player = ctx?.player;
    let target;
    if (ctx?.state?.phase === 'title') {
      target = this.distance < c.titleMaxDistance ? c.titleSpeed : 0;
    } else if (player && player.alive === false) {
      target = this.baseSpeed * 0.18;               // wreck drifts to a near stop
    } else if (player?.isBoosting) {
      target = this.baseSpeed * (c.boostSpeed / c.baseSpeed);
    } else if (player?.isBraking) {
      target = this.baseSpeed * (c.brakeSpeed / c.baseSpeed);
    } else {
      target = this.baseSpeed;
    }
    target *= this.speedMultiplier;
    if (this.frozen) target = 0;
    this.targetSpeed = target;
    this.speed += (target - this.speed) * (1 - Math.exp(-c.accel * dt));
    if (Math.abs(target - this.speed) < 0.01) this.speed = target;
    this.position.z -= this.speed * dt;
    this.distance = -this.position.z;
  },
};
