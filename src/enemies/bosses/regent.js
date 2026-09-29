// Boss 3 (Obsidian Foundry): THE REGENT, a tall crystalline sovereign core of dark glass. A luminous core seed sits at
// its heart and four prism emitters orbit it. Nothing in it is a body: the whole fight is light and glass.
//  P1 EMITTERS: each emitter drifts to the front of its orbit, cracks its lens shut-to-open after a telegraph and sweeps a
//               prismatic beam across the lane. It can only be damaged while the lens is open. Burn out all four.
//  P2 FRACTURE: the crystal breaks into shards that orbit the seed and fly through the lane in walls with a hole in them
//               (fly through the hole, or barrel roll to send a shard back into the seed). The seed shows in timed windows,
//               about 2 s in every 6 s, and can only be damaged then.
//  P3 OVERLOAD: the burnt-out emitters relight. They discharge concentric burst rings, each ring with a safe gap. The seed
//               window is longer and comes after every pair of rings.
import * as THREE from 'three';
import { Boss } from './boss.js';
import { G, makeStd, part, merged, mesh, glowSprite, beamGeo } from '../models.js';
import { leadDir } from '../aim.js';

const PI2 = Math.PI / 2, A60 = Math.PI / 3, S = 2.2, BODY_Z = 12, H = 19, R = 6, EM_R = 8.4, EM_R_FAR = 15.5, NEM = 4;
const LOWER = 0.6;
const EM_TINT = [0x59d4ff, 0xb08cff, 0xff7ac8, 0xffd070];
const EM_COMP = [0xff7ac8, 0x59d4ff, 0xffd070, 0xb08cff];
const SEED_HP = 48, EM_HP = 14;
const FWD = new THREE.Vector3(0, 0, 1), UPV = new THREE.Vector3(0, 1, 0), YAXIS = new THREE.Vector3(0, 1, 0);
const _o = new THREE.Vector3(), _d = new THREE.Vector3(), _t = new THREE.Vector3(), _q = new THREE.Vector3(), _s = new THREE.Vector3(), _u = new THREE.Vector3(), _c = new THREE.Vector3();

// Black glass with blue reflections, cold light seams and a white-hot seed.
const GLASS = makeStd(0x0a1226, { fog: false, emissive: 0x143680, metalness: 0.9, roughness: 0.16 });
const GLASS_L = makeStd(0x1a2c54, { fog: false, emissive: 0x1a44a0, metalness: 0.85, roughness: 0.2 });
const SHARD = makeStd(0x14224a, { fog: false, emissive: 0x3a6cff, metalness: 0.8, roughness: 0.2 });
const glowMat = (hex, i = 2.8) => new THREE.MeshStandardMaterial({ color: 0x0a1018, emissive: hex, emissiveIntensity: i, roughness: 0.4, metalness: 0, flatShading: true, fog: false });
const FROST = glowMat(0x9fd0ff, 1.5);
const SEEDMAT = glowMat(0xeaffff, 3.4);
const edgeMat = (hex, o = 0.85) => new THREE.LineBasicMaterial({ color: hex, transparent: true, opacity: o, fog: false });
const EDGE = edgeMat(0xb4dcff, 1);   // bright seams: the dark glass reads through its edges

/** One sector of the bipyramid: a tetrahedron (apex, centre, two equator points), recentred on its centroid. */
const PIECE = (() => {
  const E0 = [R, 0, 0], E1 = [R * Math.cos(A60), 0, R * Math.sin(A60)], A = [0, H, 0], O = [0, 0, 0];
  const cen = [(E0[0] + E1[0]) / 4, H / 4, (E0[2] + E1[2]) / 4];
  const pts = [A, O, E0, E1].map((p) => [p[0] - cen[0], p[1] - cen[1], p[2] - cen[2]]);
  const pos = [];
  for (const [a, b, c] of [[0, 1, 2], [0, 3, 1], [0, 2, 3], [1, 3, 2]]) {
    const pa = new THREE.Vector3(...pts[a]), pb = new THREE.Vector3(...pts[b]), pc = new THREE.Vector3(...pts[c]);
    const n = new THREE.Vector3().crossVectors(pb.clone().sub(pa), pc.clone().sub(pa));
    const f = pa.clone().add(pb).add(pc).divideScalar(3);
    if (n.dot(f) < 0) pos.push(...pa.toArray(), ...pc.toArray(), ...pb.toArray()); else pos.push(...pa.toArray(), ...pb.toArray(), ...pc.toArray());
  }
  const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); geo.computeVertexNormals();
  return { geo, edges: new THREE.EdgesGeometry(geo), cen: new THREE.Vector3(...cen) };
})();

const LEAF = merged('rgLeaf', [part(G.box(1.9, 0.9, 0.22)), part(G.box(0.4, 0.5, 0.28), 0.7, 0, 0.02)]);
const EM_BODY = (() => {
  const parts = [part(G.cyl(1.9, 1.9, 5.2, 3), 0, 0, -0.2, PI2, 0, 0), part(G.tor(2.0, 0.24, 4, 6), 0, 0, 2.3),
    ...[0, 1, 2].map((i) => part(G.box(0.25, 3.4, 2.6), Math.sin(i * 2.094) * 1.7, Math.cos(i * 2.094) * 1.7, -2.9, 0, 0, -i * 2.094))];
  return merged('rgEmBody', parts);
})();
const EM_EDGES = new THREE.EdgesGeometry(EM_BODY, 20);

export class Regent extends Boss {
  constructor(ctx) { super(ctx, 'regent', 'THE REGENT'); }

  build() {
    this.holdZ = 158; this.introT = 5.2; this.introY = -2;
    this.parts = []; this.crit = [];
    this.group.scale.setScalar(S);
    this.body.position.z = BODY_Z;
    this.radius = 12; this.bounds = new THREE.Vector3(12, 22, 12);
    this.deathColors = [0x9fd0ff, 0xe6f4ff]; this.debrisColor = 0x22417e;
    const b = this.body;
    // the crystal: twelve tetrahedral pieces that assemble into a tall hexagonal bipyramid, plus an equator ring
    this.crystal = new THREE.Group(); b.add(this.crystal);
    this.pieces = [];
    for (let n = 0; n < 12; n++) {
      const k = n % 6, up = n < 6, flip = up ? 1 : -1;
      const pg = new THREE.Group(); this.crystal.add(pg);
      // the lower pyramid is shorter (LOWER) so the foot spike stays above the Foundry floor plane
      const yk = flip * (up ? 1 : LOWER);
      const m = mesh(PIECE.geo, (n % 2) ? GLASS_L : GLASS, pg); m.rotation.y = -k * A60; m.scale.y = yk;
      const e = new THREE.LineSegments(PIECE.edges, EDGE); m.add(e);
      const home = PIECE.cen.clone(); home.y *= yk; home.applyAxisAngle(YAXIS, -k * A60);
      pg.position.copy(home);
      this.pieces.push({ pg, m, home, k, up, ph: k * A60 + (up ? 0 : 0.5), ring: up ? 0 : 1, spin: (n % 3 - 1) * 0.5 + 0.4 });
    }
    this.equator = mesh(merged('rgEq', [part(G.tor(R + 0.9, 0.16, 4, 6), 0, 0, 0, PI2)]), FROST, this.crystal);
    this.orbitRing = mesh(merged('rgOrb', [part(G.tor(EM_R, 0.07, 4, 72), 0, 0, 0, PI2)]), FROST, b);
    this.orbitRing.material = this.orbitRing.material.clone(); this.orbitRing.material.emissiveIntensity = 0.7;

    // the core seed, inside a cage of three rings that closes and opens
    this.seedG = new THREE.Group(); b.add(this.seedG);
    const seedMesh = mesh(G.ico(2.3, 1), SEEDMAT, this.seedG);
    this.cage = new THREE.Group(); this.seedG.add(this.cage);
    this.cageMat = FROST.clone();
    this.cageRings = [0, 1, 2].map((i) => { const r = mesh(G.tor(1, 0.07, 4, 40), this.cageMat, this.cage); r.rotation.set(i * A60, i * A60 * 1.6, 0); return r; });
    this.seedHalo = glowSprite(0xcdeaff, 7, this.seedG);
    this.seedGlow = this.makeGlow(0xe8fbff, 17, this.seedG, 0, 0, 3);
    this.seed = this.addPart(this.seedG, { name: 'coreSeed', radius: 4.6 * S, hp: SEED_HP, points: 2500, critical: true, exposed: false, explScale: 7, explColor: 0xcfe8ff, debrisColor: 0x22417e }, [seedMesh]);

    // four prism emitters on an orbit ring. Each is a triangular glass prism with an iris lens on its front.
    this.ems = [];
    for (let i = 0; i < NEM; i++) {
      const tint = EM_TINT[i];
      const eg = new THREE.Group(); b.add(eg);
      const bodyM = mesh(EM_BODY, i % 2 ? GLASS_L : GLASS, eg);
      const edgeM = edgeMat(tint, 0.9); bodyM.add(new THREE.LineSegments(EM_EDGES, edgeM));
      const lensMat = glowMat(tint, 0.5);
      const lens = new THREE.Group(); lens.position.z = 3.0; eg.add(lens);
      mesh(merged('rgLens', [part(G.cyl(1.35, 1.35, 0.3, 18), 0, 0, 0, PI2)]), lensMat, lens);
      const iris = new THREE.Group(); iris.position.z = 0.25; lens.add(iris);
      const leaves = [0, 1, 2, 3].map((k) => { const lg = new THREE.Group(); lg.rotation.z = k * PI2; iris.add(lg); const lf = mesh(LEAF, GLASS, lg); lf.position.x = 0.55; return lf; });
      const halo = glowSprite(tint, 5.5, lens, 0, 0, 0.6);
      const bmat = (hex, op) => new THREE.MeshBasicMaterial({ color: hex, transparent: true, opacity: op, depthWrite: false, blending: THREE.AdditiveBlending, fog: false, side: THREE.DoubleSide });
      const beams = [mesh(beamGeo, bmat(new THREE.Color(tint).lerp(new THREE.Color(0xffffff), 0.4), 0.5), this.ctx.scene), mesh(beamGeo, bmat(tint, 0.42), this.ctx.scene), mesh(beamGeo, bmat(EM_COMP[i], 0.42), this.ctx.scene)];
      beams.forEach((m) => { m.visible = false; });
      const glow = this.makeGlow(tint, 14, lens, 0, 0, 1.2);
      const p = this.addPart(eg, { name: 'prismEmitter', radius: 4.0 * S, hp: EM_HP, points: 500, critical: true, exposed: false, explScale: 4, explColor: tint, debrisColor: 0x22417e }, [bodyM]);
      const em = { p, eg, bodyM, edgeM, lens, lensMat, iris, leaves, halo, glow, beams, tint, i, th: 0.2 + i * PI2, st: 'closed', t: 0, open: 0, dead: false, bolt: 0, hitCd: 0, over: 0 };
      p.em = em; this.ems.push(em);
    }
    // shard pool: crystal fragments that fly through the lane (meshes follow enemy shots), and a gap marker
    this.pool = [];
    for (let i = 0; i < 30; i++) {
      const m = mesh(G.oct(1.25), SHARD, this.ctx.scene); m.scale.set(0.95, 2.4, 0.95); m.visible = false;
      m.add(new THREE.LineSegments(new THREE.EdgesGeometry(G.oct(1.25)), EDGE));
      this.pool.push(m);
    }
    this.gapMark = glowSprite(0x7fffe0, 14, this.ctx.scene); this.gapMark.visible = false;
    this.aimOffset.set(0, 0, 18);
  }

  intro() {
    this.after(0.6, () => this.comm('REGENT', 'Ninth Flight. Your approach has been logged. It will not be required again.', 3.6));
    this.after(4.2, () => this.comm('LUMEN', 'Sovereign core, crystalline. Four orbital emitters. Lens open only while firing.', 3.6));
    this.calm = 0; this.emLeft = NEM; this.frac = 0; this.over = 0; this.fly = []; this.pat = null; this.patCd = 3; this.patCount = 0;
    this.reflected = new Set(); this.win = { state: 'closed', t: 0, dur: 2.6 }; this.winHinted = false; this.reflectNoted = false; this.ringEm = 0; this.phaseSpin = 0;
    this.offReflect = this.ctx.events.on('shot:reflected', ({ shot }) => this.shardReflected(shot));
  }

  onPhase(n, silent) {
    if (n === 1) { for (const p of this.parts) p.exposed = false; this.seed.untargetable = true; return; }
    if (silent) return;
    if (n === 2) {
      this.calm = 2.6; this.patCd = 2.4; this.win = { state: 'closed', t: 0, dur: 2.4 };
      this.seed.untargetable = false;
      this.comm('REGENT', 'The shell is a courtesy. Observe what remains.', 3.2);
      this.after(3.4, () => this.comm('LUMEN', 'Crystal fractured. Core seed exposed in short windows.', 3.4));
    } else if (n === 3) {
      this.calm = 1.8; this.patCd = 1.2; this.patCount = 0; this.win = { state: 'closed', t: 0, dur: 3.8 };
      this.ctx.ui?.warning?.('FINAL BURST');
      this.comm('REGENT', 'Final process engaged. Nothing you do will be recorded.', 3.4);
      this.after(3.8, () => this.comm('LUMEN', 'Emitters overloading. Burst rings inbound, one gap in each.', 3.4));
      this.after(7.6, () => this.comm('FERRO', 'It has decided to be unpleasant.', 3.0));
    }
  }

  partDestroyed(p) {
    if (p.name === 'prismEmitter') {
      const em = p.em; em.dead = true; em.st = 'closed'; em.open = 0; p.anchor.visible = true;
      for (const bm of em.beams) bm.visible = false;
      em.bodyM.material.emissive.setHex(0x04060c); em.bodyM.material.emissiveIntensity = 0.3; em.edgeM.opacity = 0.25;
      this.emLeft--;
      if (this.emLeft === 3) this.comm('VEX', 'Wing two, emitter offline. Three remain.', 3.0);
      else if (this.emLeft === 1) this.comm('PIP', 'emitters 1 of 4 active', 2.6);
      if (this.emLeft <= 0 && this.phase === 1) this.setPhase(2);
    } else if (p === this.seed) this.bossDown();
  }

  startDeath(ctx) {
    for (const e of this.ems) for (const bm of e.beams) bm.visible = false;
    for (const it of this.fly) { it.shot.alive = false; this.release(it); }
    this.fly.length = 0; this.wallItems?.forEach((it) => { it.m.visible = false; }); this.wallItems = null; this.pat = null; this.gapMark.visible = false;
    super.startDeath(ctx);
    this.after(0.8, () => this.comm('REGENT', 'This cycle is incomplete. The archive is... lost.', 3.6));
    this.after(4.4, () => this.comm('SABLE', 'Cycle closed.', 2.2));
  }

  // fight
  fight(dt, ctx) {
    this.phaseT += dt;
    if (this.calm > 0) this.calm -= dt;
    const r = this.rel, k = Math.min(1, dt * 1.2), rage = this.phase === 3;
    r.x += (Math.sin(this.age * 0.28) * (rage ? 4.5 : 3) - r.x) * k;   // small sway keeps every target in laser reach
    r.y += (-2 + Math.sin(this.age * 0.41) * 1.5 - r.y) * k;
    r.z += (-this.holdZ + Math.sin(this.age * 0.19) * 7 - r.z) * k;
    // covered seed must not soak up shots aimed at the emitters
    this.seed.untargetable = this.phase < 2;
    if (this.phase === 1) this.emitterLogic(dt, ctx);
    if (this.phase === 2 && this.seed.alive && this.seed.hp < this.seed.maxHp * 0.45) this.setPhase(3);
    if (this.phase >= 2) { this.windowLogic(dt, ctx); this.patternLogic(dt, ctx); }
    this.flyLogic(dt, ctx);
  }

  // ---- P1: emitters ----
  emitterLogic(dt, ctx) {
    const dead = NEM - this.emLeft, base = 0.55 + 0.3 * dead;
    const pl = ctx.player.position, rp = ctx.rail.position;
    for (const em of this.ems) {
      if (em.dead) continue;
      const busy = em.st !== 'closed';
      em.th += dt * (busy ? 0.16 : base);
      em.t += dt;
      if (em.st === 'closed') {
        const a = ((em.th % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
        if (em.t > 0.9 && this.calm <= 0 && a > 0.1 && a < 1.9) this.startEmitter(em, ctx);
      } else if (em.st === 'tele') {
        this.setGlow(em.glow, em.t / 1.0, 24);
        this.emLensPos(em, _o); this.emTarget(em, 0, _t); this.drawBeams(em, _o, _t, 0.12, 0.5, false);
        if (em.t >= 1.0) { em.st = 'open'; em.t = 0; em.hitCd = 0; em.bolt = 0.5; this.setGlow(em.glow, 0); ctx.audio?.sfx?.('chargedShot', { position: _o }); ctx.fx?.shake?.(0.5, 0.2); }
      } else if (em.st === 'open') {
        const w = Math.min(1, em.t / em.sweepT);
        this.emLensPos(em, _o); this.emTarget(em, w, _t);
        this.drawBeams(em, _o, _t, 0.7 + Math.sin(this.age * 50) * 0.08, 1, true);
        this.beamHit(em, _o, _t, dt, ctx);
        em.bolt -= dt;
        if (em.bolt <= 0 && w < 0.85) { em.bolt = 0.55; this.shootAt(_o, 62, 0.06, { radius: 0.8, size: 0.6, color: em.tint, glowColor: em.tint, damage: 6, cap: 70 }); }
        if (em.t >= em.sweepT) { em.st = 'shut'; em.t = 0; for (const bm of em.beams) bm.visible = false; }
      } else if (em.st === 'shut') {
        if (em.t >= 0.45) { em.st = 'closed'; em.t = -1.1; }
      }
    }
  }

  startEmitter(em, ctx) {
    em.st = 'tele'; em.t = 0; em.orient = Math.random() < 0.5 ? 'h' : 'v'; em.dir = Math.random() < 0.5 ? -1 : 1; em.sweepT = 2.8 - 0.12 * (NEM - this.emLeft);
    const pl = ctx.player.position, rp = ctx.rail.position;
    em.fix = em.orient === 'h' ? THREE.MathUtils.clamp(pl.y - rp.y + (Math.random() * 2 - 1) * 3, -6, 6) : THREE.MathUtils.clamp(pl.x - rp.x + (Math.random() * 2 - 1) * 5, -12, 12);
    ctx.audio?.sfx?.('laserCharge', { position: this.position });
  }

  emLensPos(em, out) { em.lens.getWorldPosition(out); return out; }

  /** Beam target (world) at sweep progress w: a point in the player's plane, rail relative. */
  emTarget(em, w, out) {
    const rp = this.ctx.rail.position, span = em.orient === 'h' ? 32 : 17, s = em.dir * (-span + 2 * span * w);
    if (em.orient === 'h') out.set(rp.x + s, rp.y + em.fix, rp.z - 4); else out.set(rp.x + em.fix, rp.y + s, rp.z - 4);
    return out;
  }

  /** Three thin beams: a white centre and two tinted flanks that split apart like light through a prism. */
  drawBeams(em, o, t, w, spread, full) {
    _d.subVectors(t, o); const len = _d.length() * 1.09; _d.normalize();   // ends just past the player's plane, never at the camera
    _u.crossVectors(_d, UPV).normalize();
    for (let i = 0; i < 3; i++) {
      const bm = em.beams[i]; bm.visible = full || i === 0;
      const off = (i - 1) * 0.024 * spread;
      _q.copy(_d).addScaledVector(_u, off).normalize();
      bm.position.copy(o); bm.lookAt(_c.copy(o).add(_q));
      const ww = i === 0 ? w : w * 0.6; bm.scale.set(ww, ww, len);
    }
  }

  beamHit(em, o, t, dt, ctx) {
    em.hitCd -= dt;
    if (em.hitCd > 0 || ctx.player.invulnerable) return;
    _d.subVectors(t, o).normalize(); _u.crossVectors(_d, UPV).normalize();
    for (let i = 0; i < 3; i++) {
      _q.copy(_d).addScaledVector(_u, (i - 1) * 0.024).normalize();
      _s.subVectors(ctx.player.position, o); const along = _s.dot(_q); if (along <= 0) continue;
      const dist = _s.addScaledVector(_q, -along).length();
      if (dist < 1.9 + ctx.player.radius * 0.7) {
        ctx.player.takeDamage?.(14 * (ctx.config.difficulty[ctx.state.difficulty]?.enemyDamage ?? 1), this);
        ctx.fx?.sparks?.(ctx.player.position, null, 10); ctx.fx?.shake?.(0.7, 0.3); em.hitCd = 0.6; return;
      }
    }
  }

  // ---- P2/P3: seed windows ----
  windowLogic(dt, ctx) {
    const W = this.win; W.t += dt;
    if (this.calm > 0) { this.seed.exposed = false; return; }
    if (W.state === 'closed') {
      this.seed.exposed = false;
      if (W.t >= W.dur) { W.state = 'warn'; W.t = 0; ctx.audio?.sfx?.('laserCharge', { position: this.seed.position }); }
    } else if (W.state === 'warn') {
      this.seed.exposed = false;
      this.setGlow(this.seedGlow, W.t / 0.6, 22);
      if (W.t >= 0.6) {
        W.state = 'open'; W.t = 0; W.openDur = this.phase === 3 ? 3.2 : 2.0; this.setGlow(this.seedGlow, 0);
        ctx.fx?.flash?.('#cfe6ff', 0.12, 0.15);
        if (!this.winHinted) { this.winHinted = true; ctx.ui?.hint?.('Fire at the core seed while its cage is open', 4); }
      }
    } else {
      this.seed.exposed = true;
      if (W.t >= W.openDur) { W.state = 'closed'; W.t = 0; W.dur = this.phase === 3 ? 5.0 : 4.0; this.seed.exposed = false; }
    }
  }

  // ---- P2/P3: patterns ----
  patternLogic(dt, ctx) {
    if (this.pat) { this.runPattern(this.pat, dt, ctx); return; }
    if (this.calm > 0) return;
    this.patCd -= dt;
    if (this.patCd > 0) return;
    this.patCount++;
    let kind;
    if (this.phase === 3) kind = this.patCount % 3 === 0 ? 'spear' : 'ring';
    else kind = this.patCount % 2 ? 'wall' : 'spear';
    this.pat = { kind, t: 0, tele: kind === 'wall' ? 1.5 : kind === 'ring' ? 1.5 : 0.9, done: false, n: 0 };
    if (kind === 'wall') this.beginWall(ctx);
    else if (kind === 'ring') {
      this.ringEm = (this.ringEm + 1) % NEM;
      ctx.ui?.warning?.('BURST RING');
    }
    ctx.audio?.sfx?.('laserCharge', { position: this.position });
  }

  runPattern(p, dt, ctx) {
    p.t += dt;
    const u = Math.min(1, p.t / p.tele);
    if (p.kind === 'wall') {
      const items = this.wallItems ?? [];
      for (const it of items) { it.m.visible = true; const s = 0.15 + 0.85 * u; it.m.scale.set(0.95 * s, 2.4 * s, 0.95 * s); this.wallPos(it, _o); it.m.position.copy(_o); it.m.rotation.y += dt * 2; }
      this.gapMark.visible = true; this.gapMark.position.set(ctx.rail.position.x + this.gap.x, ctx.rail.position.y + this.gap.y, ctx.rail.position.z + this.rel.z + this.wallZ);
      this.gapMark.scale.setScalar(10 + Math.sin(this.age * 10) * 2 * u);
      this.setGlow(this.seedGlow, u, 22);
      if (p.t >= p.tele && !p.done) {
        p.done = true; this.gapMark.visible = false; this.setGlow(this.seedGlow, 0);
        for (const it of items) {
          this.wallPos(it, _o);
          const shot = this.shoot(_o, FWD, { speed: 42, radius: 2.1, size: 0.38, damage: 14, color: 0x6fa8ff, glowColor: 0x3a6cff, cap: 140 });
          if (shot) this.fly.push({ shot, m: it.m, lastAge: 0, spin: Math.random() * 2 + 1 }); else it.m.visible = false;
        }
        this.wallItems = null;
        ctx.fx?.shake?.(0.6, 0.25); ctx.audio?.sfx?.('chargedShot', { position: this.seed.position });
      }
      if (p.done) this.endPattern();
    } else if (p.kind === 'spear') {
      this.setGlow(this.seedGlow, Math.min(1, u), 24);
      if (p.t >= p.tele) {
        p.cd = (p.cd ?? 0) - dt;
        if (p.cd <= 0 && p.n < 3) {
          p.cd = 0.32; p.n++;
          this.seed.anchor.getWorldPosition(_o); _o.z += 10;
          const shot = this.shootAt(_o, 64, 0.03, { radius: 1.7, size: 0.4, damage: 12, color: 0x9fd0ff, glowColor: 0x4a80ff, cap: 120, leadK: 0.9 });
          const m = this.take();
          if (shot && m) { m.visible = true; m.scale.set(1.2, 3.0, 1.2); this.fly.push({ shot, m, lastAge: 0, spin: 3 }); }
          else if (m) m.visible = false;
          ctx.audio?.sfx?.('chargedShot', { position: _o });
        }
        if (p.n >= 3) { this.setGlow(this.seedGlow, 0); this.endPattern(); }
      }
    } else { // ring: an emitter overloads, then discharges concentric rings that each leave one gap
      const em = this.ems[this.ringEm];
      em.over = u;
      this.setGlow(em.glow, u, 26);
      if (p.t >= p.tele && !p.done) {
        p.done = true; this.setGlow(em.glow, 0);
        this.fireRings(em, ctx);
        ctx.fx?.shake?.(0.9, 0.3); ctx.fx?.flash?.('#cfe6ff', 0.2, 0.2);
      }
      if (p.done && p.t > p.tele + 1.0) { em.over = 0; this.endPattern(); }
    }
  }

  endPattern() {
    this.pat = null; this.gapMark.visible = false;
    this.patCd = (this.phase === 3 ? 2.4 : 3.0) * this.fireScale;
  }

  beginWall(ctx) {
    const gx = (Math.random() * 2 - 1) * 11, gy = (Math.random() * 2 - 1) * 3.5;
    this.gap = { x: gx, y: gy }; this.wallZ = 24; this.wallItems = [];
    for (let x = -15; x <= 15.1; x += 5) for (const y of [-6, 0, 6]) {
      if (Math.hypot(x - gx, (y - gy) * 1.15) < 7.6) continue;
      const m = this.take(); if (!m) continue;
      this.wallItems.push({ m, x, y });
    }
  }
  wallPos(it, out) { const rp = this.ctx.rail.position; return out.set(rp.x + it.x, rp.y + it.y, rp.z + this.rel.z + this.wallZ); }

  /** Two-ring burst from an emitter, each ring aimed to pass through the player's position with a gap toward it. */
  fireRings(em, ctx) {
    this.emLensPos(em, _o);
    const pl = ctx.player.position, v = 48, vr = ctx.rail.speed || 40;
    const zm = _o.z + (pl.z - _o.z) * v / (v + vr);           // where the shots and the player meet
    const ap = Math.random() * Math.PI * 2, R1 = 7.5;
    const cx = pl.x - Math.cos(ap) * R1, cy = pl.y - Math.sin(ap) * R1;   // ring centre: the player sits on the first ring
    const gapA = ap + (Math.random() < 0.5 ? -1 : 1) * (0.5 + Math.random() * 0.4), gapH = 0.62;
    const rings = [[R1, 18, 0], [13, 28, 0.3], [18.5, 36, 0.6]];
    for (const [Rr, n, delay] of rings) {
      const fire = () => {
        if (this.dying) return;
        this.emLensPos(em, _o);
        for (let i = 0; i < n; i++) {
          const a = (i / n) * Math.PI * 2 + (Rr === 13 ? 0.1 : 0);
          let da = Math.abs(a - gapA) % (Math.PI * 2); if (da > Math.PI) da = Math.PI * 2 - da;
          if (da < gapH) continue;
          _t.set(cx + Math.cos(a) * Rr, cy + Math.sin(a) * Rr, zm);
          _d.subVectors(_t, _o).normalize();
          this.shoot(_o, _d, { speed: v, radius: 1.0, size: 0.45, damage: 8, color: 0xe6f4ff, glowColor: em.tint, cap: 130 });
        }
      };
      if (delay <= 0) fire(); else this.after(delay, fire);
    }
  }

  // ---- shard meshes that follow shots ----
  take() { for (const m of this.pool) if (!m.visible && !m.userData.held) { m.userData.held = true; return m; } return null; }
  release(it) { it.m.visible = false; it.m.userData.held = false; }

  flyLogic(dt, ctx) {
    for (let i = this.fly.length - 1; i >= 0; i--) {
      const it = this.fly[i], sh = it.shot;
      if (!sh.alive || sh.age < it.lastAge || sh.owner !== 'enemy') { this.release(it); this.fly.splice(i, 1); continue; }
      it.lastAge = sh.age; it.m.position.copy(sh.position); it.m.rotation.x += dt * it.spin; it.m.rotation.z += dt * it.spin * 0.6; it.m.visible = true;
    }
  }

  /** A shard was rolled back: send it into the seed. */
  shardReflected(shot) {
    const it = this.fly.find((f) => f.shot === shot);
    if (!it) return;
    this.release(it); this.fly.splice(this.fly.indexOf(it), 1);
    this.reflected.add(shot);
    shot.homing = this.seed; shot.turn = 9; shot.life = shot.maxLife = 3.2; shot.damage = 12; shot.radius = Math.max(shot.radius, 1.5);
    if (!this.reflectNoted) { this.reflectNoted = true; this.comm('LUMEN', 'Shard deflected toward core.', 2.6); }
  }

  /** Part.takeDamage hook: a reflected shard hits the seed hard even while its cage is shut. */
  onReflectedHit(p, shot) {
    if (p === this.seed && this.reflected.has(shot)) { this.reflected.delete(shot); return { damage: 12, force: true }; }
    return null;
  }

  // ---- visuals ----
  animate(dt, ctx) {
    const t = this.age, p1 = this.phase === 1;
    // crystal turns slowly; from P2 the pieces peel off and orbit the seed
    this.frac += ((this.phase >= 2 ? 1 : 0) - this.frac) * Math.min(1, dt * 1.1);
    const e = this.frac * this.frac * (3 - 2 * this.frac);
    this.crystal.rotation.y += dt * 0.18;
    this.crystal.position.y = Math.sin(t * 0.9) * 0.6;
    const spin = this.phase === 3 ? 0.9 : 0.55;
    for (const pc of this.pieces) {
      const a = pc.ph + t * spin * (pc.ring ? -1 : 1), Ro = 8 + pc.ring * 3.2 + Math.sin(t * 0.8 + pc.k) * 0.8, yo = (pc.ring ? -1 : 1) * (3.5 + 2 * Math.sin(t * 0.7 + pc.k));
      _o.set(Math.cos(a) * Ro, yo + Math.sin(a) * 2.5, Math.sin(a) * Ro);
      pc.pg.position.lerpVectors(pc.home, _o, e);
      const sc = 1 - 0.42 * e; pc.m.scale.set(sc, sc * (pc.up ? 1 : -(LOWER + (1 - LOWER) * e)), sc);
      pc.m.rotation.x = e * Math.sin(t * pc.spin + pc.k) * 0.9; pc.m.rotation.z = e * Math.cos(t * pc.spin * 0.8 + pc.k) * 0.7;
    }
    this.equator.scale.setScalar(1 + e * 0.5); this.equator.rotation.z += dt * 0.4;
    // seed cage: shut tight in P1 and between windows, spread wide while a window is open
    const W = this.win, wopen = this.phase >= 2 && (W.state === 'open') ? 1 : this.phase >= 2 && W.state === 'warn' ? 0.35 : 0;
    this.cageOpen = (this.cageOpen ?? 0) + (wopen - (this.cageOpen ?? 0)) * Math.min(1, dt * 6);
    const cs = 3.3 + this.cageOpen * 3.6; this.cage.scale.setScalar(cs);
    this.cageRings[0].rotation.x += dt * 1.2; this.cageRings[1].rotation.y += dt * 0.9; this.cageRings[2].rotation.z -= dt * 1.1;
    this.cageMat.emissiveIntensity = 0.8 + this.cageOpen * 1.6;
    this.seedHalo.scale.setScalar((p1 ? 5 : 6) + this.cageOpen * 8 + (this.phase === 3 ? 2 : 0) + Math.sin(t * 7) * 0.7);
    this.seedG.rotation.y += dt * 0.8;
    // emitters
    const far = this.phase >= 2 ? 1 : 0; this.orbFar = (this.orbFar ?? 0) + (far - (this.orbFar ?? 0)) * Math.min(1, dt * 1.2);
    const Rr = EM_R + (EM_R_FAR - EM_R) * this.orbFar;
    this.orbitRing.scale.setScalar(Rr / EM_R); this.orbitRing.material.emissiveIntensity = 0.5 + (this.phase === 3 ? 0.9 : 0) + Math.sin(t * 2) * 0.1;
    const dead = NEM - this.emLeft;
    for (const em of this.ems) {
      if (em.dead) em.th += dt * (this.phase === 3 ? 0.6 : 0.32);
      const th = em.th;
      em.eg.position.set(Math.cos(th) * Rr, 0.8 + 1.4 * Math.sin(t * 0.8 + em.i * 1.9), Math.sin(th) * Rr);
      em.eg.lookAt(ctx.player.position);
      // iris and lens: open only in the 'open' state, cracking during 'tele'; husks relight when overloaded
      const want = em.dead ? 0 : em.st === 'open' ? 1 : em.st === 'tele' ? 0.28 : 0;
      em.open += (want - em.open) * Math.min(1, dt * (em.st === 'shut' ? 7 : 5));
      const r = 0.55 + em.open * 1.85;
      for (const lf of em.leaves) lf.position.x = r;
      em.iris.rotation.z = em.open * 0.9 + (em.st === 'open' ? Math.sin(t * 3) * 0.05 : 0);
      const live = em.dead ? em.over * 0.5 + (this.phase === 3 ? 0.35 : 0) : 0.4 + em.open * 2.6 + (em.p.flashT || 0) * 1.5;
      em.lensMat.emissiveIntensity = live + (this.phase === 3 && em.dead ? 0.6 + Math.sin(t * 9 + em.i) * 0.5 : 0);
      em.halo.scale.setScalar(3.6 + live * 1.9 + em.over * 3);
      em.p.exposed = !em.dead && em.st === 'open' && em.open > 0.8;
      if (em.dead && this.phase === 3) { em.edgeM.opacity = 0.5 + 0.4 * Math.sin(t * 9 + em.i); em.bodyM.material.emissive.setHex(em.tint); em.bodyM.material.emissiveIntensity = 0.25 + em.over * 0.9; }
    }
    if (this.phase >= 2 && Math.random() < dt * (this.phase === 3 ? 7 : 2.5)) ctx.fx?.smoke?.(this.seed.position);
  }

  destroy(ctx) {
    this.offReflect?.();
    for (const e of this.ems ?? []) for (const bm of e.beams) bm.removeFromParent();
    for (const m of this.pool ?? []) m.removeFromParent();
    this.gapMark?.removeFromParent();
    super.destroy(ctx);
  }
}
