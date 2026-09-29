// Formations: groups of enemies sharing a leader path with staggered timing. If the player destroys EVERY member
// a score bonus is awarded (and the combo counter is credited). Clearing a formation never drops a pickup.
import * as THREE from 'three';
import { swoop, approachTime } from './paths.js';

export class Formation {
  constructor(name, total, bonus) {
    this.name = name; this.total = total; this.bonus = bonus;
    this.killed = 0; this.spawned = 0; this.done = false; this.cancelled = false;
    this.lastPos = new THREE.Vector3();
  }
  memberKilled(e, ctx) {
    this.killed++; this.lastPos.copy(e.position);
    if (!this.done && !this.cancelled && this.killed >= this.total) {
      this.done = true;
      const pos = this.lastPos.clone();
      ctx.state.score += this.bonus; // direct: enemy:killed would also bump the kill counter
      const st = ctx.state, cc = ctx.config.combo; // the clear itself extends the combo
      st.combo++; st.comboTimer = cc.window;
      st.multiplier = 1 + Math.min(cc.maxMultiplier - 1, Math.floor((st.combo - 1) / cc.step));
      ctx.events.emit('formation:cleared', { name: this.name, bonus: this.bonus, position: pos });
      ctx.events.emit('score:add', { points: this.bonus, base: this.bonus, multiplier: 1, position: pos, bonus: true, formation: this.name });
      ctx.audio?.sfx?.('pickup', { position: pos });
    }
  }
  memberGone() {}
}

const R = Math.random;

/**
 * Build member specs for a formation. `o` = rail-relative origin (Vector3).
 * Returns [{type, delay, opts}] where opts.rel is the initial rail-relative position and opts.path the member path.
 */
export function buildFormation(name, o, opts, count) {
  const specs = [];
  const type = opts.type ?? 'grunt';
  const xc = opts.xc ?? THREE.MathUtils.clamp(o.x * 0.4, -10, 10), yc = opts.yc ?? THREE.MathUtils.clamp(o.y * 0.4 + 1, -3, 4);
  const zh = opts.zh ?? -(54 + R() * 8);
  const dirL = opts.dir ?? (R() < 0.5 ? -1 : 1);
  const ph = R() * 6.28;
  const swoopMember = (slot, o2 = {}, delay = 0, t = type) => {
    const p = { x0: o.x + slot.x, y0: o.y + slot.y, z0: o.z + slot.z, xc: xc + slot.x, yc: yc + slot.y, zh: zh + slot.z, dir: dirL, up: 1, amp: 6, ph, bulge: 0, ...o2 };
    const path = (tt, out) => swoop(tt, out, p);
    const rel = new THREE.Vector3(p.x0, p.y0, p.z0);
    specs.push({ type: t, delay, opts: { rel, path, dir: p.dir, A: (p.A = approachTime(p.z0, p.zh)), ...(opts.memberOpts ?? {}) } });
  };
  const S = (x, y, z) => new THREE.Vector3(x, y, z);

  switch (name) {
    case 'vee': {
      for (let i = 0; i < count; i++) {
        const k = Math.ceil(i / 2), side = i === 0 ? 0 : (i % 2 ? -1 : 1);
        swoopMember(S(side * k * 5.5, k * 0.7, -k * 5.5), { dir: side || dirL });
      }
      break;
    }
    case 'line': {
      for (let i = 0; i < count; i++) {
        const x = (i - (count - 1) / 2) * 8;
        swoopMember(S(x, 0, 0), { dir: x === 0 ? dirL : Math.sign(x), amp: 3 });
      }
      break;
    }
    case 'wave': { // snake: same wiggly path, staggered start
      for (let i = 0; i < count; i++) swoopMember(S(0, 0, 0), { amp: 12, dir: dirL }, i * 0.42);
      break;
    }
    case 'circle': {
      for (let i = 0; i < count; i++) {
        const a0 = (i / count) * Math.PI * 2, Rr = 8.5;
        const p = { x0: o.x, y0: o.y, z0: o.z, xc, yc, zh, dir: dirL, up: 1, amp: 3, ph, bulge: 0 };
        const path = (t, out) => {
          swoop(t, out, p);
          const w = Math.min(1, t / 1.5), a = a0 + t * 1.7;
          out.x += Math.cos(a) * Rr * w; out.y += Math.sin(a) * Rr * 0.75 * w;
          return out;
        };
        p.A = approachTime(p.z0, p.zh);
        specs.push({ type, delay: 0, opts: { rel: new THREE.Vector3(o.x, o.y, o.z), path, dir: dirL, A: p.A, ...(opts.memberOpts ?? {}) } });
      }
      break;
    }
    case 'pincer': {
      for (let i = 0; i < count; i++) {
        const side = i % 2 ? 1 : -1, k = Math.floor(i / 2);
        const p = { x0: side * 52, y0: o.y + (k % 2 ? 4 : -2), z0: o.z + 10 - k * 6, xc: side * 10, yc: yc + k * 0.8, zh: zh - k * 5, dir: -side, up: 1, amp: 2.5, ph, bulge: -side * 10 };
        p.A = approachTime(p.z0, p.zh);
        specs.push({ type, delay: k * 0.3, opts: { rel: new THREE.Vector3(p.x0, p.y0, p.z0), path: (t, out) => swoop(t, out, p), dir: -side, A: p.A, ...(opts.memberOpts ?? {}) } });
      }
      break;
    }
    case 'convoy': { // staggered column in two lanes; mixed types
      const types = opts.types ?? ['grunt', 'grunt', 'bomber'];
      for (let i = 0; i < count; i++) {
        const lane = i % 2 ? 1 : -1, t = types[i % types.length];
        const rel = new THREE.Vector3(lane * 12 + o.x, o.y + (i % 3) * 1.5, o.z);
        const base = { rel, dir: lane, xc: lane * 10 + (t === 'grunt' ? 0 : -lane * 4), yc: yc + 2, zh: -(72 + i * 7), ...(opts.memberOpts ?? {}) };
        specs.push({ type: t, delay: i * 0.9, opts: base });
      }
      break;
    }
    case 'swarm': {
      const origin = o.clone();
      const lead = (t, out) => out.set(origin.x + Math.sin(t * 0.9 + ph) * 10, origin.y + Math.sin(t * 1.3) * 3, origin.z + Math.min(t, 5.5) * 36 + Math.max(0, t - 5.5) * 64);
      for (let i = 0; i < count; i++) specs.push({ type: 'swarmer', delay: i * 0.05, opts: { rel: o.clone(), lead, origin, spread: 5 + R() * 2, ...(opts.memberOpts ?? {}) } });
      break;
    }
    default: return null;
  }
  return specs;
}

export const FORMATION_DEFAULT_COUNT = { vee: 5, line: 4, wave: 5, circle: 6, pincer: 6, convoy: 4, swarm: 8 };
export const FORMATION_NAMES = Object.keys(FORMATION_DEFAULT_COUNT);
