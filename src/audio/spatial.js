// Spatial sound for positioned sfx: a small POOL of ready made voice slots (low pass -> gain -> PannerNode -> sfx bus).
// audio.sfx(name, { position }) acquires a slot, the voice plays into slot.input and audio.js releases the slot when the voice
// ends. Nothing is created per sound except the voice itself, so an explosion storm cannot grow the graph: when the pool is
// empty the caller falls back to a plain stereo pan (spatial.fallback) without allocating.
//
// Per frame (spatial.update(cam)) every ACTIVE slot is re-aimed at its world position relative to the camera, so a blast that
// the ship flies past sweeps from front to side to back. The listener stays at the origin looking down -z (camera space), the
// PannerNode only carries direction; distance level, floor, off screen dimming and the off screen low pass are computed here.
//   level  = max(floor, 1 / (1 + dist / rolloff)) * lerp(1, offscreenGain, off)
//   cutoff = lerp(20 kHz -> offscreenLP, off), plus a gentle distance roll off
// off is 0 when the source is inside a ~46 degree cone around the view direction (about the screen edge) and 1 beyond ~81 degrees or behind the camera.
import { feel } from '../core/feel.js';

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };

/** Camera space vector of a world position: right, up, back components, distance and the off screen amount. Writes into out. */
export function relative(cam, pos, out) {
  const e = cam.matrixWorld.elements;
  const dx = pos.x - e[12], dy = pos.y - e[13], dz = pos.z - e[14];
  const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
  out.x = dx * e[0] + dy * e[1] + dz * e[2];
  out.y = dx * e[4] + dy * e[5] + dz * e[6];
  out.z = dx * e[8] + dy * e[9] + dz * e[10];   // positive = behind the camera
  out.dist = dist;
  const fwd = dist > 1e-4 ? -out.z / dist : 1;
  out.off = 1 - smooth(0.15, 0.7, fwd);
  return out;
}

/** Level and low pass cutoff for a relative position (pure, used by slots, the fallback and the tests). */
export function shape(rel, P, out) {
  const g = Math.max(P.spatialFloor, 1 / (1 + rel.dist / Math.max(1, P.spatialRolloff)));
  out.gain = g * (1 + (P.offscreenGain - 1) * rel.off);
  const lpOff = Math.log(20000) + (Math.log(Math.max(200, P.offscreenLP)) - Math.log(20000)) * rel.off;
  out.cutoff = Math.exp(lpOff) / (1 + rel.dist / 900);
  if (!Number.isFinite(out.gain)) out.gain = 1;
  if (!Number.isFinite(out.cutoff)) out.cutoff = 20000;
  return out;
}

export class Spatial {
  /** ac: audio context, dest: node the slots feed (the sfx bus), size: pooled slot count. */
  constructor(ac, dest, { size = 20, getP = () => feel.p.audio } = {}) {
    this.ac = ac;
    this.dest = dest;
    this.getP = getP;
    this.size = size;
    this.free = [];
    this.active = new Set();
    this.rel = { x: 0, y: 0, z: -1, dist: 1, off: 0 };
    this.sh = { gain: 1, cutoff: 20000 };
    this.overflow = 0;
    this.hasPanner = typeof ac.createPanner === 'function';
    for (let i = 0; i < size; i++) this.free.push(this._make());
  }

  _make() {
    const ac = this.ac;
    const input = ac.createBiquadFilter(); input.type = 'lowpass'; input.frequency.value = 20000; input.Q.value = 0.5;
    const gain = ac.createGain(); gain.gain.value = 1;
    input.connect(gain);
    let panner = null, pan = null;
    if (this.hasPanner) {
      panner = ac.createPanner();
      panner.panningModel = 'equalpower'; panner.distanceModel = 'linear'; panner.refDistance = 1; panner.maxDistance = 10000; panner.rolloffFactor = 0;
      panner.coneInnerAngle = 360; panner.coneOuterAngle = 360;
      gain.connect(panner);
      this._setPos(panner, 0, 0, -1);
    } else if (ac.createStereoPanner) {
      pan = ac.createStereoPanner();
      gain.connect(pan);
    }
    const out = panner || pan || gain;
    out.connect(this.dest);
    return { input, gain, panner, pan, pos: { x: 0, y: 0, z: 0 }, live: false, hrtf: false, out };
  }

  _setPos(p, x, y, z) {
    if (p.positionX) { p.positionX.value = x; p.positionY.value = y; p.positionZ.value = z; } else p.setPosition(x, y, z);
  }

  /** Take a slot for a sound at world position pos (any object with x, y, z). Returns null when the pool is empty. */
  acquire(cam, pos) {
    const s = this.free.pop();
    if (!s) { this.overflow++; return null; }
    s.live = true;
    s.pos.x = pos.x; s.pos.y = pos.y; s.pos.z = pos.z;
    const P = this.getP();
    if (s.panner) {
      const hrtf = P.spatialHRTF >= 0.5;
      if (hrtf !== s.hrtf) { s.panner.panningModel = hrtf ? 'HRTF' : 'equalpower'; s.hrtf = hrtf; }
    }
    this._aim(s, cam, P, true);
    this.active.add(s);
    return s;
  }

  release(s) {
    if (!s || !s.live) return;
    s.live = false;
    this.active.delete(s);
    this.free.push(s);
  }

  _aim(s, cam, P, immediate) {
    if (!cam) return;
    const rel = relative(cam, s.pos, this.rel);
    const sh = shape(rel, P, this.sh);
    const t = this.ac.currentTime;
    const d = Math.max(1e-3, rel.dist), k = P.spatialStrength;
    if (s.panner) this._setPos(s.panner, (rel.x / d) * k, (rel.y / d) * k * 0.5, rel.z / d);
    else if (s.pan) s.pan.pan.value = clamp((rel.x / Math.max(8, d * 0.7)) * k, -1, 1) * 0.85;
    if (immediate) {
      s.gain.gain.cancelScheduledValues(t); s.gain.gain.value = sh.gain;
      s.input.frequency.cancelScheduledValues(t); s.input.frequency.value = sh.cutoff;
    } else {
      s.gain.gain.setTargetAtTime(sh.gain, t, 0.03);
      s.input.frequency.setTargetAtTime(sh.cutoff, t, 0.03);
    }
  }

  /** Per frame: re-aim every active slot at the camera. Cheap (a handful of multiplies and 5 parameter writes per live sound). */
  update(cam) {
    if (!cam || !this.active.size) return;
    const P = this.getP();
    for (const s of this.active) this._aim(s, cam, P, false);
  }

  /** Allocation free stereo pan and level, used when the pool is empty or a sound is not worth a slot. */
  fallback(cam, pos, out = { gain: 1, pan: 0 }) {
    if (!cam || pos.x === undefined) { out.gain = 1; out.pan = 0; return out; }
    const P = this.getP();
    const rel = relative(cam, pos, this.rel);
    const sh = shape(rel, P, this.sh);
    out.gain = sh.gain;
    const pan = clamp(rel.x / Math.max(8, rel.dist * 0.7), -1, 1) * 0.85 * P.spatialStrength;
    out.pan = Number.isFinite(pan) ? pan : 0;
    return out;
  }

  get stats() { return { free: this.free.length, active: this.active.size, size: this.size, overflow: this.overflow }; }
}
