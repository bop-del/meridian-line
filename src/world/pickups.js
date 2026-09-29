// Pickups (ctx.groups.pickups): shield cells, capacitors and items. Each is an entity with kind + collect(ctx).
//
// SHIELD CELL: a small lit hexagonal capsule. Cells are laid out along a slipstream lane (a faint ribbon that links them)
// in chains of four. CAPACITOR: rare, one per level, a violet crystal in a hex cage.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

/** Display names shown by the HUD and banners. */
export const PICKUP_NAMES = { shieldCell: 'SHIELD CELL', capacitor: 'CAPACITOR', pulseUpgrade: 'PULSE UPGRADE', bomb: 'BOMB', repair: 'REPAIR' };

const KINDS = {
  shieldCell: { color: 0x2cd4b4, glow: 0x0c9c8c },
  capacitor: { color: 0xb684ff, glow: 0x7a3cff },
  bomb: { color: 0xff7a3a, glow: 0xff3a10 },
  repair: { color: 0x7dff9a, glow: 0x20e060 },
  pulseUpgrade: { color: 0x66b8ff, glow: 0x2a7bff },
};

/** shield cell chain size, heal per cell and the bonus on the last one */
export const CELL_CHAIN = 4;
const CELL_HEAL = 3, CELL_HEAL_LONE = 10, CELL_BONUS_HEAL = 16;

function shared(res, key, f) { return res.get('pk_' + key, f); }

function basic(res, color, mult = 1.8) {
  return shared(res, 'b' + color.toString(16) + mult, () => new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(mult), toneMapped: false }));
}
function add(res, color, opacity) {
  return shared(res, 'a' + color.toString(16) + opacity, () => new THREE.MeshBasicMaterial({ color, transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, toneMapped: false }));
}

/** Hexagonal prism with its axis along z. */
function hexPrism(r, len, open = false) {
  const g = new THREE.CylinderGeometry(r, r, len, 6, 1, open);
  g.rotateX(Math.PI / 2);
  return g;
}

/** Six thin bars along the corner edges of a hexagonal prism (axis z). */
function hexEdges(r, len, th) {
  const parts = [];
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    const b = new THREE.BoxGeometry(th, th, len * 1.02);
    b.translate(Math.cos(a) * r, Math.sin(a) * r, 0);
    parts.push(b);
  }
  for (const s of [-1, 1]) {
    for (let i = 0; i < 6; i++) {
      const a0 = (i / 6) * Math.PI * 2, a1 = ((i + 1) / 6) * Math.PI * 2;
      const x0 = Math.cos(a0) * r, y0 = Math.sin(a0) * r, x1 = Math.cos(a1) * r, y1 = Math.sin(a1) * r;
      const seg = Math.hypot(x1 - x0, y1 - y0);
      const b = new THREE.BoxGeometry(seg, th, th);
      b.rotateZ(Math.atan2(y1 - y0, x1 - x0));
      b.translate((x0 + x1) / 2, (y0 + y1) / 2, s * len * 0.5);
      parts.push(b);
    }
  }
  return mergeGeometries(parts.map((p) => (p.index ? p.toNonIndexed() : p)), false);
}

export class Pickup {
  constructor(kind, W, opts = {}) {
    const res = W.res;
    const K = KINDS[kind] ?? KINDS.shieldCell;
    this.kind = kind; this.W = W;
    this.group = new THREE.Group();
    this.position = this.group.position;
    this.alive = true;
    this.radius = kind === 'capacitor' ? 3.2 : kind === 'shieldCell' ? 2.5 : 2.3;
    this.chain = opts.chain ?? null;
    if (this.chain) this.chain.alive = (this.chain.alive ?? 0) + 1;
    this.time = Math.random() * 6;
    this.baseY = 0;
    this.isCell = kind === 'shieldCell' || kind === 'capacitor';
    this.spin = kind === 'shieldCell' ? 1.6 : kind === 'capacitor' ? 1.1 : 1.8;
    this.color = K.color;
    this.displayName = PICKUP_NAMES[kind] ?? kind.toUpperCase();
    this.parts = [];
    const g = this.group;
    if (kind === 'shieldCell') {
      // capsule: translucent hexagonal body, a bright inner rod, lit edges and end caps
      const R = 1.1, L = 3.1;
      // yawed so the capsule reads from behind; the inner group rolls about the capsule axis
      const yaw = new THREE.Group(); yaw.rotation.y = 0.75; g.add(yaw);
      const roll = new THREE.Group(); yaw.add(roll); this.roll = roll;
      roll.add(new THREE.Mesh(shared(res, 'cellBody', () => hexPrism(R, L)), add(res, K.glow, 0.42)));
      roll.add(new THREE.Mesh(shared(res, 'cellRod', () => hexPrism(R * 0.34, L * 0.86)), basic(res, K.color, 0.9)));
      roll.add(new THREE.Mesh(shared(res, 'cellEdges', () => hexEdges(R, L, 0.13)), basic(res, 0x9ff0e0, 0.85)));
      for (const s of [-1, 1]) {
        const cap = new THREE.Mesh(shared(res, 'cellCap', () => hexPrism(R * 0.72, 0.22)), basic(res, K.color, 0.9));
        cap.position.z = s * (L / 2 + 0.16); roll.add(cap);
      }
      this.halo = new THREE.Mesh(shared(res, 'cellHalo', () => new THREE.SphereGeometry(2.1, 12, 8)), add(res, K.glow, 0.05));
      g.add(this.halo);
    } else if (kind === 'capacitor') {
      // violet crystal cell: a faceted bipyramid, a hot core, a hex cage and three orbiting shards
      const crystal = shared(res, 'capCrystal', () => { const o = new THREE.OctahedronGeometry(1.55, 0); o.scale(0.8, 1.55, 0.8); return o; });
      g.add(new THREE.Mesh(crystal, shared(res, 'capMat', () => new THREE.MeshStandardMaterial({ color: 0x8a52ff, emissive: 0x5a20e0, emissiveIntensity: 0.8, flatShading: true, roughness: 0.18, metalness: 0.25 }))));
      const core = new THREE.Mesh(shared(res, 'capCore', () => { const o = new THREE.OctahedronGeometry(0.85, 0); o.scale(0.8, 1.55, 0.8); return o; }), basic(res, 0xc8a8ff, 0.85));
      g.add(core);
      const cage = new THREE.Mesh(shared(res, 'capCage', () => hexEdges(2.75, 0.5, 0.16)), basic(res, K.color, 0.85));
      this.parts.push(cage); g.add(cage);
      const shardGeo = shared(res, 'capShard', () => { const o = new THREE.OctahedronGeometry(0.42, 0); o.scale(0.7, 1.4, 0.7); return o; });
      const orbit = new THREE.Group();
      for (let i = 0; i < 3; i++) {
        const s = new THREE.Mesh(shardGeo, basic(res, K.color, 0.95));
        const a = (i / 3) * Math.PI * 2;
        s.position.set(Math.cos(a) * 2.2, Math.sin(a * 2) * 0.6, Math.sin(a) * 2.2);
        orbit.add(s);
      }
      this.orbit = orbit; g.add(orbit);
      this.halo = new THREE.Mesh(shared(res, 'capHalo', () => new THREE.SphereGeometry(3.4, 14, 10)), add(res, K.glow, 0.07));
      g.add(this.halo);
    } else if (kind === 'bomb') {
      const s = shared(res, 'bombS', () => new THREE.SphereGeometry(1.15, 14, 10));
      const b = shared(res, 'bombB', () => new THREE.TorusGeometry(1.55, 0.16, 6, 20));
      g.add(new THREE.Mesh(s, shared(res, 'bombM', () => new THREE.MeshStandardMaterial({ color: 0x2a2f38, metalness: 0.7, roughness: 0.3, emissive: 0xff3a10, emissiveIntensity: 0.55 }))));
      const band = new THREE.Mesh(b, basic(res, 0xff8a40, 2)); band.rotation.x = Math.PI / 2.4; g.add(band); this.parts.push(band);
      this.halo = new THREE.Mesh(shared(res, 'bombH', () => new THREE.SphereGeometry(2.0, 12, 8)), add(res, K.glow, 0.18)); g.add(this.halo);
    } else if (kind === 'repair') {
      const bar = shared(res, 'repB', () => new THREE.BoxGeometry(2.6, 0.85, 0.85));
      const m = basic(res, K.color, 1.7);
      const a = new THREE.Mesh(bar, m), b = new THREE.Mesh(bar, m); b.rotation.z = Math.PI / 2; g.add(a, b);
      const ring = new THREE.Mesh(shared(res, 'repR', () => new THREE.TorusGeometry(1.95, 0.1, 6, 28)), basic(res, K.color, 1.4)); g.add(ring);
      this.halo = new THREE.Mesh(shared(res, 'repH', () => new THREE.SphereGeometry(2.3, 12, 8)), add(res, K.glow, 0.14)); g.add(this.halo);
    } else if (kind === 'pulseUpgrade') {
      const o = shared(res, 'lasO', () => new THREE.OctahedronGeometry(1.4, 0));
      const d = new THREE.Mesh(o, basic(res, K.color, 1.9)); d.scale.set(0.8, 1.35, 0.8); g.add(d);
      const w = new THREE.Mesh(o, add(res, K.glow, 0.3)); w.scale.set(1.25, 2.1, 1.25); g.add(w); this.halo = w;
      const ring = new THREE.Mesh(shared(res, 'lasR', () => new THREE.TorusGeometry(2.2, 0.09, 6, 28)), basic(res, K.color, 1.4)); ring.rotation.x = Math.PI / 2; g.add(ring); this.parts.push(ring);
    }
    g.userData.pickup = true;
  }

  setBase(x, y, z) { this.position.set(x, y, z); this.baseY = y; }

  update(dt, ctx) {
    if (!this.alive) return;
    this.time += dt;
    const t = this.time;
    const pl = ctx.player?.position;
    // subtle bob and pulse
    let y = this.baseY + Math.sin(t * 2.1) * (this.kind === 'shieldCell' ? 0.3 : 0.45);
    // gentle magnet toward the ship so near misses still count
    if (pl) {
      const dx = pl.x - this.position.x, dy = pl.y - y, dz = pl.z - this.position.z;
      if (dz > -14 && dz < 40 && dx * dx + dy * dy < 100) {
        const k = Math.min(1, dt * (this.kind === 'shieldCell' ? 2.4 : 3));
        this.position.x += dx * k; this.baseY += dy * k; y = this.baseY;
      }
    }
    this.position.y = y;
    if (this.kind === 'shieldCell') {
      if (this.roll) this.roll.rotation.z += this.spin * dt; // the capsule rolls about its own axis
      if (this.halo) this.halo.scale.setScalar(1 + Math.sin(t * 5 + 1) * 0.08);
    } else if (this.kind === 'capacitor') {
      this.group.rotation.y += this.spin * dt;
      this.group.rotation.x = Math.sin(t * 0.8) * 0.12;
      if (this.orbit) this.orbit.rotation.y = -t * 1.9;
      for (const s of this.parts) s.rotation.z = t * 0.9;
      if (this.halo) this.halo.scale.setScalar(1 + Math.sin(t * 3) * 0.07);
    } else {
      this.group.rotation.y += this.spin * dt;
      this.group.rotation.x = Math.sin(t) * 0.25;
      if (this.halo) this.halo.scale.setScalar(1 + Math.sin(t * 4) * 0.08);
      for (const s of this.parts) s.rotation.z += dt * 2;
    }
    if (this.position.z > ctx.rail.position.z + 30) this.destroy(ctx);
  }

  takeDamage() { return false; }

  collect(ctx) {
    if (!this.alive) return;
    const pl = ctx.player, st = ctx.state;
    const pos = this.position;
    const heal = (n) => {
      if (pl?.heal) pl.heal(n); else st.health = Math.min(st.maxHealth, st.health + n);
    };
    ctx.fx?.cellPickup?.(pos, this.color);
    const ev = ctx.events;
    if (this.kind === 'shieldCell') {
      const ch = this.chain;
      let got = 1, total = 1;
      if (ch) { ch.got++; got = ch.got; total = ch.total; }
      ctx.audio?.sfx?.('cell', { pitch: 1 + (got - 1) * 0.16 });
      heal(ch ? CELL_HEAL : CELL_HEAL_LONE);
      ev.emit('cell:collected', { kind: 'shieldCell', position: pos, chain: got, total });
      if (ch && got >= total && !ch.done) {
        ch.done = true;
        heal(CELL_BONUS_HEAL);
        st.score += 500;
        ctx.audio?.sfx?.('pickup', { pitch: 1.2 });
        ctx.fx?.flash?.('#58f0d4', 0.22, 0.3);
        ev.emit('cell:set', { kind: 'shieldCell', position: pos, bonus: true, total });
      } else st.score += 100;
    } else if (this.kind === 'capacitor') {
      st.maxHealth = Math.min(200, (st.maxHealth ?? 100) + 25);
      heal(999);
      st.score += 1000;
      ctx.audio?.sfx?.('pickup', { pitch: 0.9 });
      ctx.fx?.flash?.('#a06cff', 0.18, 0.3);
      ctx.ui?.banner?.('CAPACITOR', 'MAX SHIELD UP');
      ev.emit('cell:collected', { kind: 'capacitor', position: pos, chain: 1, total: 1 });
    } else if (this.kind === 'bomb') {
      if (pl?.addBombs) pl.addBombs(1); else st.bombs = Math.min(9, st.bombs + 1);
      ctx.audio?.sfx?.('pickup');
      st.score += 200;
    } else if (this.kind === 'repair') {
      heal(35);
      ctx.audio?.sfx?.('pickup', { pitch: 1.1 });
      ctx.fx?.flash?.('#60ff90', 0.2, 0.25);
      st.score += 200;
    } else if (this.kind === 'pulseUpgrade') {
      if (st.laserLevel < 3) { st.laserLevel++; ctx.ui?.banner?.('PULSE UPGRADE', st.laserLevel === 3 ? 'TWIN EMITTERS: MAX' : 'FIREPOWER UP'); } else { heal(15); st.score += 500; }
      ctx.audio?.sfx?.('pickup', { pitch: 0.8 });
      ctx.fx?.flash?.('#66b8ff', 0.25, 0.3);
    }
    ev.emit('pickup:collected', { kind: this.kind, position: pos });
    this.destroy(ctx);
  }

  destroy(ctx) {
    if (!this.alive) return;
    this.alive = false;
    this.group.parent?.remove(this.group);
    const ch = this.chain;
    if (ch && --ch.alive <= 0 && ch.lane) { ch.lane.parent?.remove(ch.lane); ch.lane.geometry.dispose(); ch.lane = null; }
  }
}

// ---------------------------------------------------------------- cell formations
// Offsets are [x, y, z] from the anchor; z steps run down the lane (away from the ship).
const SHAPES = {
  line: (i, n) => [0, 0, -i * 18],
  wave: (i, n) => [Math.sin(i * 0.9) * 8, Math.cos(i * 0.7) * 1.5, -i * 18],
  arc: (i, n) => [0, Math.sin((i / Math.max(1, n - 1)) * Math.PI) * 6 - 3, -i * 16],
  spiral: (i, n) => [Math.cos(i * 1.7) * 6, Math.sin(i * 1.7) * 4, -i * 16],
  zigzag: (i, n) => [(i % 2 ? 1 : -1) * 6, (i % 2 ? -1 : 1) * 2, -i * 17],
  circle: (i, n) => [Math.cos((i / n) * Math.PI * 2) * 8, Math.sin((i / n) * Math.PI * 2) * 5, 0],
  vee: (i, n) => [(i - (n - 1) / 2) * 5.5, -Math.abs(i - (n - 1) / 2) * 1.6, -Math.abs(i - (n - 1) / 2) * 10],
  climb: (i, n) => [0, -5 + (i / Math.max(1, n - 1)) * 10, -i * 17],
  dive: (i, n) => [0, 5 - (i / Math.max(1, n - 1)) * 10, -i * 17],
  slalom: (i, n) => [Math.sin(i * 1.25) * 9, Math.sin(i * 0.6) * 3.5, -i * 17],
};

/** A faint ribbon with chevrons that links the cells of one chain: the slipstream lane. */
function makeLane(W, pts) {
  const bars = [];
  const up = new THREE.Vector3(0, 1, 0), dir = new THREE.Vector3(), q = new THREE.Quaternion(), m = new THREE.Matrix4(), s = new THREE.Vector3(1, 1, 1);
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i], b = pts[i + 1];
    dir.subVectors(b, a); const len = dir.length(); dir.normalize();
    const g = new THREE.BoxGeometry(0.14, 0.05, Math.max(0.1, len - 4));
    q.setFromUnitVectors(new THREE.Vector3(0, 0, 1), dir);
    m.compose(new THREE.Vector3().addVectors(a, b).multiplyScalar(0.5), q, s);
    g.applyMatrix4(m);
    bars.push(g);
    // a chevron pointing down the lane, mid-way between two cells
    const c = new THREE.Vector3().addVectors(a, b).multiplyScalar(0.5);
    for (const sx of [-1, 1]) {
      const v = new THREE.BoxGeometry(0.1, 0.05, 1.6);
      v.rotateY(sx * 0.7);
      v.translate(sx * 0.55, 0, 0.55);
      v.applyMatrix4(new THREE.Matrix4().compose(c, q, s));
      bars.push(v);
    }
  }
  const geo = mergeGeometries(bars, false);
  const mesh = new THREE.Mesh(geo, add(W.res, 0x2cd4b4, 0.16));
  mesh.frustumCulled = false; mesh.renderOrder = 3;
  return mesh;
}

export function spawnCellSet(W, ctx, kind, pos, count = CELL_CHAIN, shape = 'line', opts = {}) {
  const f = SHAPES[shape] ?? SHAPES.line;
  const out = [];
  let chain = null;
  for (let i = 0; i < count; i++) {
    if (kind === 'shieldCell' && i % CELL_CHAIN === 0) chain = { got: 0, total: Math.min(CELL_CHAIN, count - i), done: false, alive: 0, lane: null, first: out.length };
    const o = f(i, count);
    const p = W.spawnPickup(kind, { x: pos.x + o[0], y: pos.y + o[1], z: pos.z + o[2] }, { raw: opts.raw ?? false, chain: kind === 'shieldCell' && count > 1 ? chain : null });
    if (p) out.push(p);
    // close a chain: draw its lane
    if (kind === 'shieldCell' && chain && count > 1 && ((i + 1) % CELL_CHAIN === 0 || i === count - 1) && opts.lane !== false) {
      const mine = out.slice(chain.first);
      if (mine.length > 1) {
        chain.lane = makeLane(W, mine.map((c) => c.position.clone()));
        ctx.scene.add(chain.lane);
      }
    }
  }
  return out;
}
