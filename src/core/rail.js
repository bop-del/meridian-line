// The rail: an invisible anchor that flies forward along -Z. Speed ramps to boost/brake targets with separate ramp rates
// and an instant onset punch (feel.p.handling.boost*, brake*); everything else uses config.rail.accel.
// Public: position, speed, baseSpeed, distance, targetSpeed, speedMultiplier, frozen,
//   boostSpeed / brakeSpeed (live boost and brake top speeds, from the feel registry), accel (smoothed u/s per s).
import * as THREE from 'three';
import { config } from '../config.js';
import { feel } from './feel.js';

export const rail = {
  position: new THREE.Vector3(),
  speed: config.rail.baseSpeed,
  baseSpeed: config.rail.baseSpeed,
  boostSpeed: config.rail.boostSpeed,
  brakeSpeed: config.rail.brakeSpeed,
  distance: 0,
  speedMultiplier: 1,   // other modules (world, bosses, fly-outs) may scale the rail speed
  targetSpeed: config.rail.baseSpeed,
  accel: 0,             // smoothed forward acceleration (camera speed lag, ship surge)
  frozen: false,        // set true to hold the rail still
  _mode: 'base',        // 'base' | 'boost' | 'brake' | 'other', for ramp selection and onset punches
  _prevSpeed: config.rail.baseSpeed,
  _fromBoost: false, _fromBrake: false,   // returning to base after boost or brake (selects the release ramp)

  reset() {
    this.position.set(0, 0, 0);
    this.baseSpeed = config.rail.baseSpeed;
    this.speed = this.baseSpeed;
    this._prevSpeed = this.speed;
    this.targetSpeed = this.baseSpeed;
    this.speedMultiplier = 1;
    this.frozen = false;
    this.distance = 0;
    this.accel = 0;
    this._mode = 'base';
    this._fromBoost = this._fromBrake = false;
  },

  update(dt, ctx) {
    const c = config.rail, h = feel.p.handling || {};
    const player = ctx?.player;
    this.boostSpeed = h.boostSpeed ?? c.boostSpeed;
    this.brakeSpeed = h.brakeSpeed ?? c.brakeSpeed;
    let target, mode, rate = c.accel;
    if (ctx?.state?.phase === 'title') {
      target = this.distance < c.titleMaxDistance ? c.titleSpeed : 0; mode = 'other';
    } else if (player && player.alive === false) {
      target = this.baseSpeed * 0.18; mode = 'other';     // wreck drifts to a near stop
    } else if (player?.isBoosting) {
      target = this.baseSpeed * (this.boostSpeed / c.baseSpeed); mode = 'boost'; rate = h.boostRamp ?? c.accel;
    } else if (player?.isBraking) {
      target = this.baseSpeed * (this.brakeSpeed / c.baseSpeed); mode = 'brake'; rate = h.brakeBite ?? c.accel;
    } else {
      target = this.baseSpeed; mode = 'base';
      if (this._mode === 'boost' || this._fromBoost) rate = h.boostRelease ?? c.accel;
      else if (this._mode === 'brake' || this._fromBrake) rate = h.brakeRelease ?? c.accel;
    }
    target *= this.speedMultiplier;
    if (this.frozen) { target = 0; mode = 'other'; }
    // onset punches: an instant step toward the new target the moment boost or brake starts (never past the target)
    if (mode !== this._mode && dt > 0) {
      if (mode === 'boost') { this.speed = Math.min(target, this.speed + (h.boostPunch ?? 0) * this.speedMultiplier); }
      else if (mode === 'brake') { this.speed = Math.max(target, this.speed - (h.brakePunch ?? 0) * this.speedMultiplier); }
      this._fromBoost = this._mode === 'boost' && mode === 'base';
      this._fromBrake = this._mode === 'brake' && mode === 'base';
      this._mode = mode;
    }
    this.targetSpeed = target;
    this.speed += (target - this.speed) * (1 - Math.exp(-rate * dt));
    if (Math.abs(target - this.speed) < 0.01) { this.speed = target; this._fromBoost = this._fromBrake = false; }
    this.position.z -= this.speed * dt;
    this.distance = -this.position.z;
    if (dt > 0) {
      const a = (this.speed - this._prevSpeed) / dt;
      this.accel += (a - this.accel) * (1 - Math.exp(-12 * dt));
      if (!Number.isFinite(this.accel)) this.accel = 0;
    }
    this._prevSpeed = this.speed;
  },
};
