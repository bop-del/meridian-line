// Boss 2 (Cinder Belt): THE ORRERY, a Dominion ring-class warship. A long spindle carries a rotating turret ring on
// spoke arms, two tilted armillary rings and a cage of six turning shell segments around the reactor core. Hangar arms
// on the spindle launch interceptor waves, and the core drives a sweeping beam once it is exposed.
//  P1 SEGMENTS: shoot down the six shell segments as they turn (ring turrets and interceptor waves harass).
//  P2 CORE:     the cage is open and the core pushes out. The beam sweeps across the lane after a telegraph.
//  P3 OVERDRIVE: core below 40%. Faster ring, a second beam sweep on the other axis, bigger interceptor waves.
import * as THREE from 'three';
import { Boss } from './boss.js';
import { G, part, sym, merged, mesh, glowSprite, beamGeo, beamMat, makeStd } from '../models.js';

const PI2 = Math.PI / 2, SCALE = 1.7, RING_R = 30, NSEG = 6, NTUR = 8, CAGE_R = 10.5, CAGE_Z = 16;
const _o = new THREE.Vector3(), _d = new THREE.Vector3(), _t = new THREE.Vector3(), _q = new THREE.Vector3();

// Dark navy plating, brass fittings, cool glowing seams.
const NAVY = makeStd(0x22366e, { fog: false, metalness: 0.55, roughness: 0.5, emissive: 0x070d22 });
const NAVY_D = makeStd(0x121c40, { fog: false, metalness: 0.6, roughness: 0.5, emissive: 0x04081a });
const SHELL = makeStd(0x2a4088, { fog: false, metalness: 0.6, roughness: 0.4, emissive: 0x081030, side: THREE.DoubleSide });
const BRASS = makeStd(0xd09a3e, { fog: false, metalness: 0.75, roughness: 0.35, emissive: 0x2e1c05 });
const BRASS_D = makeStd(0x8e6a2a, { fog: false, metalness: 0.7, roughness: 0.4, emissive: 0x1c1204 });
const glowMat = (hex, i = 2.6) => new THREE.MeshStandardMaterial({ color: 0x0c1418, emissive: hex, emissiveIntensity: i, roughness: 0.4, metalness: 0, flatShading: true, fog: false });
const SEAM = glowMat(0x69e6ff, 2.0);
const AMBER = glowMat(0xffb340, 2.6);
const CORE_GLOW = glowMat(0xffe89a, 2.4);

// One gore of the shell sphere (front dome, poles on +Z). All six share the geometry, rotated about Z.
const SECTOR = Math.PI * 2 / NSEG;
const gore = (r, phiLen, phiStart = 0, t0 = 0, t1 = 1.75, ws = 3) => new THREE.SphereGeometry(r, ws, 7, phiStart, phiLen, t0, t1 - t0).rotateX(PI2);
const GORE = gore(CAGE_R, SECTOR * 0.94, 0, 0, 1.75, 4);
const GORE_SPINE = gore(CAGE_R + 0.5, 0.07, SECTOR * 0.47 - 0.035, 0.08, 1.75, 1);
const GORE_SEAM_A = gore(CAGE_R + 0.35, 0.05, 0.0, 0.35, 1.75, 1);
const GORE_SEAM_B = gore(CAGE_R + 0.35, 0.05, SECTOR * 0.94 - 0.05, 0.35, 1.75, 1);
// direction (around Z) of the gore's centroid, measured from the geometry itself
const GORE_PSI = (() => { const a = GORE.attributes.position; let sx = 0, sy = 0; for (let i = 0; i < a.count; i++) { sx += a.getX(i); sy += a.getY(i); } return Math.atan2(sy, sx); })();

export class Orrery extends Boss {
  constructor(ctx) { super(ctx, 'orrery', 'THE ORRERY'); }

  build() {
    this.holdZ = 152; this.introT = 5; this.introY = 2;
    this.parts = []; this.crit = [];
    this.group.scale.setScalar(SCALE);
    this.body.position.z = 20;
    this.radius = 13; this.bounds = new THREE.Vector3(26, 20, 40);
    this.deathColors = [0x8fe0ff, 0xffb340]; this.debrisColor = 0x22366e;
    const b = this.body;
    // central spindle
    mesh(merged('orSpindle', [
      part(G.cyl(5, 6, 62, 10), 0, 0, -20, PI2),
      part(G.cyl(3.6, 5, 10, 10), 0, 0, 14, PI2),                                // neck into the cage
      part(G.cyl(7.6, 5.8, 8, 10), 0, 0, -52, PI2),                              // engine housing
      ...[0, 1, 2, 3].map((i) => part(G.box(0.8, 12, 16), 0, 0, -44, 0, 0, i * PI2 + Math.PI / 4)), // stern fins
      ...sym(part(G.box(14, 3.4, 7), 10.5, -1, -28)),                            // hangar arms
    ]), NAVY, b);
    mesh(merged('orSpindleD', [
      ...sym(part(G.box(6.4, 8, 17), 17.5, -1, -28)),                            // hangar blisters
      part(G.cyl(6.4, 6.4, 3, 10), 0, 0, 9, PI2),
    ]), NAVY_D, b);
    mesh(merged('orCollars', [
      ...[-44, -34, -12, 0, 8].map((z) => part(G.tor(6.2, 0.75, 5, 14), 0, 0, z)),
      part(G.tor(7.6, 0.8, 5, 16), 0, 0, -56),
      ...sym(part(G.box(1.2, 2.4, 17.6), 21, 3.2, -28)),                          // blister roof rails
    ]), BRASS, b);
    mesh(merged('orSeams', [
      ...[[1, 1], [-1, 1], [1, -1], [-1, -1]].map(([x, y]) => part(G.box(0.4, 0.4, 44), x * 3.9, y * 3.9, -22)),
    ]), SEAM, b);
    // hangar bays (window glow when launching)
    this.bays = [];
    for (const s of [-1, 1]) {
      const w = mesh(merged('orBayW', [part(G.box(4.6, 5.2, 0.5), 0, 0, 0)]), AMBER, b); w.position.set(s * 17.5, -1, -19.5); w.visible = false;
      const gl = this.makeGlow(0xffb340, 20, b, s * 17.5, -1, -18);
      this.bays.push({ w, gl, s });
    }
    // engines: central bell plus a ring of four
    this.engs = [glowSprite(0x69e6ff, 20, b, 0, 0, -58)];
    mesh(merged('orEng', [part(G.cyl(4.2, 4.2, 0.6, 12), 0, 0, -56.3, PI2), ...[0, 1, 2, 3].map((i) => part(G.cyl(1.9, 1.9, 0.6, 8), Math.cos(i * PI2 + 0.785) * 6.3, Math.sin(i * PI2 + 0.785) * 6.3, -55.6, PI2))]), SEAM, b);
    for (let i = 0; i < 4; i++) this.engs.push(glowSprite(0x69e6ff, 9, b, Math.cos(i * PI2 + 0.785) * 6.3, Math.sin(i * PI2 + 0.785) * 6.3, -57));

    // turret ring (rotates about Z) on six spoke arms
    this.ringG = new THREE.Group(); this.ringG.position.z = 4; b.add(this.ringG);
    mesh(merged('orRing', [
      part(G.tor(RING_R, 2.6, 6, 48)),
      ...[0, 1, 2, 3, 4, 5].map((i) => part(G.box(RING_R - 5, 1.8, 2.2), Math.cos(i * Math.PI / 3) * (RING_R + 6) / 2, Math.sin(i * Math.PI / 3) * (RING_R + 6) / 2, 0, 0, 0, i * Math.PI / 3)),
      part(G.cyl(7, 7, 4.4, 12), 0, 0, 0, PI2),
    ]), NAVY, this.ringG);
    mesh(merged('orRingB', [
      part(G.tor(RING_R + 0.4, 0.6, 5, 48), 0, 0, 2.2), part(G.tor(RING_R + 0.4, 0.6, 5, 48), 0, 0, -2.2),
      ...[0, 1, 2, 3, 4, 5, 6, 7].map((i) => part(G.box(3, 5.6, 5.8), Math.cos(i * Math.PI / 4 + 0.39) * RING_R, Math.sin(i * Math.PI / 4 + 0.39) * RING_R, 0, 0, 0, i * Math.PI / 4 + 0.39 - PI2)),
      ...[0, 1, 2, 3, 4, 5].map((i) => part(G.box(1.2, 1.2, 2.6), Math.cos(i * Math.PI / 3) * 12, Math.sin(i * Math.PI / 3) * 12, 1.4, 0, 0, i * Math.PI / 3)),
    ]), BRASS, this.ringG);
    mesh(merged('orRingL', [part(G.tor(RING_R - 2.2, 0.32, 4, 48), 0, 0, 1.2), part(G.tor(RING_R - 2.2, 0.32, 4, 48), 0, 0, -1.2)]), SEAM, this.ringG);
    this.turrets = [];
    for (let i = 0; i < NTUR; i++) {
      const a = (i / NTUR) * Math.PI * 2 + 0.39, tg = new THREE.Group(); tg.position.set(Math.cos(a) * RING_R, Math.sin(a) * RING_R, 2.4); tg.rotation.z = a - PI2; this.ringG.add(tg);
      const base = mesh(merged('orTB', [part(G.cyl(2.6, 3.2, 1.6, 8), 0, 0.6, 0, PI2), part(G.box(3.6, 3, 3.6), 0, 0, 2)]), BRASS_D, tg);
      const gun = new THREE.Group(); gun.position.z = 3.2; tg.add(gun);
      const barrel = mesh(merged('orTG', [...sym(part(G.cyl(0.36, 0.44, 5.4, 6), 0.8, 0, 2.8, PI2)), part(G.box(2.6, 1.6, 2.2))]), NAVY_D, gun);
      const lamp = mesh(merged('orTE', [part(G.oct(0.5), 0, 1, 0.4)]), SEAM, gun);
      const p = this.addPart(tg, { name: 'ringTurret', radius: 3.4 * SCALE, hp: 8, points: 200, explScale: 3 }, [base, barrel, lamp]);
      p.gun = gun; p.glow = this.makeGlow(0x8fe8ff, 6, gun, 0, 0, 6); p.charge = 0; p.cd = 1 + i * 0.5;
      this.turrets.push(p);
    }

    // orbital arms: two armillary rings with brass beads, tilted and turning about the cage
    this.arms = [];
    for (const [r, tx, ty, n] of [[22, 1.05, 0, 2], [16.5, 0.35, 1.2, 3]]) {
      const g = new THREE.Group(); g.position.z = CAGE_Z; b.add(g);
      const tilt = new THREE.Group(); tilt.rotation.set(tx, ty, 0); g.add(tilt);
      mesh(merged(`orArm${r}`, [part(G.tor(r, 0.55, 5, 56)), ...Array.from({ length: n }, (_, k) => part(G.sph(1.5, 8, 6), Math.cos(k * Math.PI * 2 / n) * r, Math.sin(k * Math.PI * 2 / n) * r, 0))]), BRASS, tilt);
      mesh(merged(`orArmL${r}`, [part(G.tor(r, 0.2, 4, 56), 0, 0, 0.3)]), SEAM, tilt);
      for (let k = 0; k < n; k++) glowSprite(0xffcf70, 4.5, tilt, Math.cos(k * Math.PI * 2 / n) * r, Math.sin(k * Math.PI * 2 / n) * r, 0);
      this.arms.push(g);
    }

    // shell segments (six gores of a dome, turn about Z, counter to the ring)
    this.discG = new THREE.Group(); this.discG.position.z = CAGE_Z; b.add(this.discG);
    this.segs = [];
    for (let i = 0; i < NSEG; i++) {
      const g = new THREE.Group(); g.rotation.z = i * SECTOR; this.discG.add(g);
      const shell = mesh(GORE, SHELL, g), spine = mesh(GORE_SPINE, BRASS, g);
      const s1 = mesh(GORE_SEAM_A, SEAM, g), s2 = mesh(GORE_SEAM_B, SEAM, g);
      const cap = mesh(G.cone(2.4, 3, 6), BRASS, g); cap.rotation.x = PI2; cap.position.z = CAGE_R + 0.6;
      const th = 0.75, rr = CAGE_R * Math.sin(th);
      const a = new THREE.Group(); a.position.set(Math.cos(GORE_PSI) * rr, Math.sin(GORE_PSI) * rr, CAGE_R * Math.cos(th)); g.add(a);
      const p = this.addPart(a, { name: 'shellSegment', radius: 7.2 * SCALE, hp: 24, points: 250, critical: true, explScale: 4 }, [shell, spine, s1, s2, cap]);
      p.seg = g; this.segs.push(p);
    }

    // core
    this.coreA = new THREE.Group(); this.coreA.position.set(0, 0, CAGE_Z); b.add(this.coreA);
    const cm = mesh(G.ico(4.6, 1), CORE_GLOW, this.coreA);
    this.gimbal = mesh(merged('orGimbal', [part(G.tor(6.6, 0.32, 5, 24)), part(G.tor(6.6, 0.32, 5, 24), 0, 0, 0, PI2)]), BRASS, this.coreA);
    this.coreHalo = glowSprite(0xffe9a0, 18, this.coreA);
    this.core = this.addPart(this.coreA, { name: 'core', radius: 6.2 * SCALE, hp: 150, points: 2000, critical: true, exposed: false, explScale: 7 }, [cm]);
    this.cm = cm;
    this.chargeGlow = this.makeGlow(0x69e6ff, 34, this.coreA, 0, 0, 5);
    // beam meshes (scene space)
    this.beamOuter = mesh(beamGeo, beamMat(0x2a9fe8), this.ctx.scene); this.beamInner = mesh(beamGeo, beamMat(0x9fe6ff), this.ctx.scene);
    this.beamOuter.visible = this.beamInner.visible = false;
    this.marker = glowSprite(0x62d8ff, 8, this.ctx.scene); this.marker.visible = false;
    this.aimOffset.set(0, 0, 30);
  }

  intro() {
    this.after(0.4, () => this.comm('LUMEN', 'Large contact, ring class. Six shell segments, eight turret mounts, one core.'));
    this.after(3.4, () => this.comm('CONTROL', 'Designation ORRERY. Holds the Belt lane. Engage.', 3.2));
    this.after(7.4, () => this.comm('FERRO', 'It is very round. I had hoped for a corner.', 3.2));
    this.segsLeft = NSEG; this.calm = 0; this.waveCd = 6; this.beamCd = 7; this.beam = { state: 'idle', t: 0 }; this.coreOut = 0; this.discA = 1; this.shots = 0;
    this.turretIdx = 0; this.turretCd = 1.5; this.launching = 0;
  }

  onPhase(n, silent) {
    if (n === 1) { for (const p of this.parts) p.exposed = p !== this.core; return; }
    if (silent) return;
    if (n === 2) {
      this.calm = 2.2; this.core.exposed = true; this.beamCd = 5;
      this.comm('LUMEN', 'Shell breached. Core exposed. Beam emitter charging.');
      this.after(3.6, () => this.comm('VEX', 'Wing two, core bearing zero zero five. Open.', 3.0));
    } else if (n === 3) {
      this.calm = 1.2; this.comm('PIP', 'ring spin up, beam axes h and v', 3.0); this.beamCd = 2.5;
    }
  }

  partDestroyed(p) {
    p.anchor.visible = false;
    if (p.name === 'shellSegment') {
      p.seg.visible = false;
      this.segsLeft--;
      if (this.segsLeft === 3) this.comm('LUMEN', 'Shell integrity 50 percent.', 2.8);
      if (this.segsLeft <= 0 && this.phase === 1) this.setPhase(2);
    } else if (p === this.core) { this.stopBeam(); this.bossDown(); }
  }

  startDeath(ctx) {
    super.startDeath(ctx);
    this.after(1.2, () => this.comm('CONTROL', 'Orrery dark. Belt lane open. Logging.', 3.2));
  }

  // fight
  fight(dt, ctx) {
    this.phaseT += dt;
    if (this.calm > 0) this.calm -= dt;
    const busy = this.calm > 0, r = this.rel, k = Math.min(1, dt * 1.4);
    const amp = this.phase === 3 ? 12 : 8;
    r.x += (Math.sin(this.age * 0.33) * amp - r.x) * k;
    r.y += (2 + Math.sin(this.age * 0.47) * 3 - r.y) * k;
    r.z += (-this.holdZ + Math.sin(this.age * 0.21) * 7 - r.z) * k;
    if (this.phase === 2 && this.core.alive && this.core.hp < this.core.maxHp * 0.4) this.setPhase(3);
    this.turretLogic(dt, ctx, busy);
    this.waveLogic(dt, ctx, busy);
    if (this.phase >= 2) this.beamLogic(dt, ctx, busy);
  }

  turretLogic(dt, ctx, busy) {
    const rate = (this.phase === 3 ? 0.55 : 0.85) * this.fireScale;
    for (const t of this.turrets) {
      if (!t.alive) continue;
      t.gun.lookAt(ctx.player.position);
      if (t.charge > 0) {
        t.charge -= dt; this.setGlow(t.glow, 1 - Math.max(0, t.charge) / 0.55, 24);
        if (t.charge <= 0) {
          this.setGlow(t.glow, 0);
          _o.copy(t.glow.position); t.gun.localToWorld(_o);
          this.shootAt(_o, 58, 0.04, { radius: 0.95, size: 0.75, color: 0xffd27a, damage: 7, cap: 60 });
        }
      }
    }
    if (busy) return;
    this.turretCd -= dt;
    if (this.turretCd <= 0) { // one turret at a time, working round the ring
      this.turretCd = rate * (0.6 + Math.random() * 0.6);
      for (let n = 0; n < NTUR; n++) { const t = this.turrets[(this.turretIdx++) % NTUR]; if (t.alive && t.charge <= 0) { t.charge = 0.55; break; } }
    }
  }

  waveLogic(dt, ctx, busy) {
    if (this.launching > 0) {
      this.launching -= dt; const k = 1 - Math.max(0, this.launching) / 1.2;
      for (const bay of this.bays) { bay.w.visible = true; this.setGlow(bay.gl, k, 14); }
      if (this.launching <= 0) {
        for (const bay of this.bays) { bay.w.visible = false; this.setGlow(bay.gl, 0); }
        const n = this.phase === 3 ? 3 : 2; let made = 0;
        for (const bay of this.bays) for (let i = 0; i < n; i++) {
          if (this.fighters() >= 6) break;
          _o.set(bay.s * 17.5, -1, -20); this.body.localToWorld(_o);
          const rel = _o.sub(ctx.rail.position);
          rel.x += bay.s * i * 6; rel.y += i * 2 - 2;
          const e = this.spawnMinion('interceptor', { rel: rel.clone(), engageTime: 8, side: bay.s });
          if (e) { e.side = bay.s; made++; }
        }
        if (made) ctx.audio?.sfx?.('whoosh', { position: this.position, pitch: 0.7 });
        this.waveCd = (this.phase === 3 ? 12 : 15) * this.fireScale;
      }
      return;
    }
    if (busy) return;
    this.waveCd -= dt;
    if (this.waveCd <= 0 && this.fighters() < 3) {
      this.launching = 1.2; ctx.audio?.sfx?.('warning');
      if (this.phase === 1 && !this.warned) { this.warned = true; this.comm('PIP', 'hangar arms open, interceptors closing', 3.0); }
    }
  }
  fighters() { let n = 0; for (const e of this.ctx.groups.enemies) if (e.type === 'interceptor' && e.alive && e.spawnedBy === this) n++; return n; }

  // main beam
  beamLogic(dt, ctx, busy) {
    const B = this.beam; B.t += dt;
    if (B.state === 'idle') {
      if (!busy) { this.beamCd -= dt; if (this.beamCd <= 0) this.startBeam(); }
      return;
    }
    // emitter: the core
    this.coreA.getWorldPosition(_o); _o.z += 4 * SCALE;
    const u = B.state === 'aim' ? B.t / B.aimT : B.t / B.sweepT;
    if (B.state === 'aim') {
      this.tgt(B, 0, _t);                       // start point of the sweep
      this.setGlow(this.chargeGlow, Math.min(1, u), 26);
      this.drawBeam(_o, _t, 0.3 + Math.sin(this.age * 40) * 0.05, 0, 0.55);
      if (B.t >= B.aimT) { B.state = 'sweep'; B.t = 0; ctx.audio?.sfx?.('chargedShot', { position: _o }); ctx.fx?.shake?.(0.8, 0.3); }
    } else if (B.state === 'sweep') {
      const w = Math.min(1, B.t / B.sweepT);
      this.tgt(B, w, _t);
      this.setGlow(this.chargeGlow, 1.1, 26);
      this.drawBeam(_o, _t, 2.0 + Math.sin(this.age * 50) * 0.3, 1.0, 0.7);
      // hit test against the beam line
      _d.subVectors(_t, _o).normalize();
      _q.subVectors(ctx.player.position, _o); const along = _q.dot(_d);
      if (along > 0) {
        const dist = _q.addScaledVector(_d, -along).length();
        B.hitCd -= dt;
        if (dist < 2.8 + ctx.player.radius * 0.8 && B.hitCd <= 0 && !ctx.player.invulnerable) {
          ctx.player.takeDamage?.(16 * (ctx.config.difficulty[ctx.state.difficulty]?.enemyDamage ?? 1), this);
          ctx.fx?.sparks?.(ctx.player.position, null, 10); ctx.fx?.shake?.(0.7, 0.3); B.hitCd = 0.5;
        }
      }
      if (B.t >= B.sweepT) {
        if (this.phase === 3 && B.second) { B.second = false; this.beginSweep(B, B.orient === 'h' ? 'v' : 'h'); }
        else this.stopBeam();
      }
    }
  }

  startBeam() {
    const B = this.beam;
    B.orient = this.phase === 3 ? (Math.random() < 0.5 ? 'h' : 'v') : 'h';
    B.second = this.phase === 3; this.beginSweep(B, B.orient);
    this.ctx.ui?.warning?.('SWEEPING BEAM');
  }
  beginSweep(B, orient) {
    B.state = 'aim'; B.t = 0; B.orient = orient; B.hitCd = 0;
    B.aimT = this.phase === 3 ? 1.5 : 1.9; B.sweepT = this.phase === 3 ? 2.2 : 2.9;
    B.dir = Math.random() < 0.5 ? -1 : 1;
    B.fix = (orient === 'h' ? (Math.random() * 2 - 1) * 5.5 : (Math.random() * 2 - 1) * 9);
    this.ctx.audio?.sfx?.('laserCharge', { position: this.position });
  }
  /** Target point of the beam (world) at sweep progress w in [0,1]: a point in the player's plane, rail relative. */
  tgt(B, w, out) {
    const rp = this.ctx.rail.position, span = B.orient === 'h' ? 32 : 17;
    const s = B.dir * (-span + 2 * span * w);
    if (B.orient === 'h') out.set(rp.x + s, rp.y + B.fix, rp.z - 4); else out.set(rp.x + B.fix, rp.y + s, rp.z - 4);
    return out;
  }
  drawBeam(o, t, w, inner, op) {
    _d.subVectors(t, o); const len = _d.length() * 1.5; _d.normalize();
    this.beamOuter.visible = true; this.beamOuter.position.copy(o); this.beamOuter.lookAt(_q.copy(o).add(_d)); this.beamOuter.scale.set(w, w, len); this.beamOuter.material.opacity = op;
    this.beamInner.visible = inner > 0; if (inner > 0) { this.beamInner.position.copy(o); this.beamInner.lookAt(_q.copy(o).add(_d)); this.beamInner.scale.set(w * 0.34, w * 0.34, len); }
    this.marker.visible = true; this.marker.position.copy(t); this.marker.scale.setScalar(6 + Math.sin(this.age * 30) * 1);
  }
  stopBeam() {
    const B = this.beam; B.state = 'idle'; B.t = 0; this.beamCd = (this.phase === 3 ? 4.5 : 7) * this.fireScale;
    this.beamOuter.visible = this.beamInner.visible = false; this.marker.visible = false; this.setGlow(this.chargeGlow, 0);
  }

  // visuals
  animate(dt, ctx) {
    const t = this.age;
    const spin = this.phase === 3 ? 0.55 : 0.28;
    this.ringG.rotation.z += dt * spin;
    this.discG.rotation.z -= dt * (this.phase === 1 ? 0.5 + 0.1 * (NSEG - this.segsLeft) : 0.5);
    this.arms[0].rotation.z += dt * 0.32; this.arms[0].rotation.y += dt * 0.12;
    this.arms[1].rotation.z -= dt * 0.5; this.arms[1].rotation.x += dt * 0.15;
    for (let i = 0; i < this.engs.length; i++) { const e = this.engs[i]; e.scale.setScalar(e.userData.size + Math.sin(t * 20 + i) * 0.8); }
    // core pushes out of the cage once exposed
    const out = this.core.exposed ? 1 : 0;
    this.coreOut += (out - this.coreOut) * Math.min(1, dt * 2);
    this.coreA.position.z = CAGE_Z + this.coreOut * 9;
    this.cm.rotation.y += dt * 1.3; this.cm.rotation.x += dt * 0.7;
    this.gimbal.rotation.z += dt * 0.9; this.gimbal.rotation.x += dt * 0.5;
    this.coreHalo.scale.setScalar((this.core.exposed ? 13 : 3.5) + Math.sin(t * 8) * 0.9);
    if (this.phase === 3 && Math.random() < dt * 6) ctx.fx?.smoke?.(this.core.position);
  }

  destroy(ctx) { this.stopBeam?.(); this.beamOuter?.removeFromParent(); this.beamInner?.removeFromParent(); this.marker?.removeFromParent(); super.destroy(ctx); }
}
