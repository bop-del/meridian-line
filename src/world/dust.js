// Streaks of space dust / embers / spray around the rail: a strong speed cue. One LineSegments draw call.
import * as THREE from 'three';
import { Rng } from './util.js';

export function createDust({ count = 260, color = 0xaad0ff, depth = 320, spreadX = 60, spreadY = 34, len = 0.05, opacity = 0.7, rise = 0, seed = 3, tail = 0.0 } = {}) {
  const rng = new Rng(seed);
  const pos = new Float32Array(count * 6), col = new Float32Array(count * 6);
  const base = new Float32Array(count * 3);
  const c = new THREE.Color(color);
  for (let i = 0; i < count; i++) {
    base[i * 3] = rng.range(-spreadX, spreadX);
    base[i * 3 + 1] = rng.range(-spreadY, spreadY);
    base[i * 3 + 2] = -rng.range(0, depth);
    const b = rng.range(0.35, 1);
    col[i * 6] = c.r * tail; col[i * 6 + 1] = c.g * tail; col[i * 6 + 2] = c.b * tail;
    col[i * 6 + 3] = c.r * b; col[i * 6 + 4] = c.g * b; col[i * 6 + 5] = c.b * b;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  const mat = new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false, fog: false, toneMapped: false });
  const lines = new THREE.LineSegments(geo, mat);
  lines.frustumCulled = false;
  lines.renderOrder = 5;
  let zOff = 0;
  return {
    object: lines,
    update(dt, ctx) {
      const rz = ctx.rail.position.z, rx = ctx.rail.position.x, ry = ctx.rail.position.y;
      const speed = ctx.rail.speed ?? 40;
      const L = Math.max(0.6, speed * len);
      for (let i = 0; i < count; i++) {
        let z = base[i * 3 + 2];
        const rel = z - rz;
        if (rel > 12 || rel < -depth - 12) {
          z = rel > 12 ? rz - depth - rng.range(0, 12) : rz - rng.range(0, depth);
          base[i * 3] = rng.range(-spreadX, spreadX); base[i * 3 + 1] = rng.range(-spreadY, spreadY);
        }
        base[i * 3 + 2] = z;
        if (rise) base[i * 3 + 1] += rise * dt;
        if (base[i * 3 + 1] > spreadY) base[i * 3 + 1] = -spreadY;
        const x = rx + base[i * 3], y = ry + base[i * 3 + 1];
        pos[i * 6] = x; pos[i * 6 + 1] = y; pos[i * 6 + 2] = z;
        pos[i * 6 + 3] = x; pos[i * 6 + 4] = y; pos[i * 6 + 5] = z + L;
      }
      geo.attributes.position.needsUpdate = true;
    },
    reset(ctx) { for (let i = 0; i < count; i++) base[i * 3 + 2] = ctx.rail.position.z - rng.range(0, depth); },
    dispose() { geo.dispose(); mat.dispose(); },
  };
}
