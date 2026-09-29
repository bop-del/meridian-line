// Wingmen AI (vex, ferro, pip). Formation flying relative to the rail, target shooting with weak lasers,
// loops and barrel rolls, damage and retreat, and the transponder-link mechanic (a contact jams an escort's link, clear it in
// time). The trouble type rotates: pursuer astern, pinned at a gate, engine disabled, cut off by a barrier.
//
// API: allies.chaseMe(name, enemy, {time=18, kind}) starts the transponder link timer (kind: 'tail'|'gate'|'engine'|'barrier',
// rotated automatically when omitted); allies.say(name, text) posts a comm line;
// wingmen expose {name, label, hp, maxHp, state, alive}. Ally shots are fired via projectiles.firePlayerShot with
// {owner:'ally', damage:0.6}. Events emitted: 'ally:down' {name}, 'ally:rescued' {name}, 'ally:retreat' {name}, 'ally:return' {name}.
import * as THREE from 'three';
import { createWingman } from '../models/wingman.js';
import { createVanta } from '../models/vanta.js';

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const NAMES = ['vex', 'ferro', 'pip'];
const SLOTS = {
  vex: { x: -16.5, y: 3.0, z: -15 },
  ferro: { x: 17.5, y: 2.0, z: -21 },
  pip: { x: -23, y: -0.5, z: -27 },
};
const SHOT_COLOR = { vex: 0x66aaff, ferro: 0x66ff99, pip: 0xffe066 };
const SPEAKER = { vex: 'VEX', ferro: 'FERRO', pip: 'PIP' };
// Voices. VEX: formal and clipped, procedure and bearings. FERRO: deadpan understatement, dry observations. PIP: an escort
// drone that reports status codes as a readout (lowercase status codes). Placeholders: {hp} hull percent of the
// speaker, {shield} player shield percent, {kills} kills this level.
const TROUBLE = ['tail', 'gate', 'engine', 'barrier'];
const TROUBLE_WARN = { tail: 'LINK JAMMED, PURSUER ASTERN', gate: 'LINK BLOCKED AT GATE', engine: 'DRIVE FAULT, LINK FADING', barrier: 'LINK CUT BY BARRIER' };
const LINES = {
  chase: {
    vex: {
      tail: ['Lead, pursuer astern, bearing 180. Transponder is jammed.', 'Wing two, pursuer astern. Link degrading, unable to shake it.'],
      gate: ['Wing two, wedged against the gate frame. Link blocked, unable to manoeuvre.'],
      engine: ['Wing two, port drive fault. Thrust at forty percent, link fading.'],
      barrier: ['Wing two, the barrier has cut my link. No route forward.'],
    },
    ferro: {
      tail: ['I have acquired a follower. He is very committed.', 'Something is astern of me. It has not introduced itself.'],
      gate: ['I am wedged against a gate and my link is not enjoying it.'],
      engine: ['The engine has left the conversation. The link is following it.'],
      barrier: ['Barrier ahead, company behind, link cut. Geometrically unfortunate.'],
    },
    pip: {
      tail: ['contact 4 astern, link jammed, evading', 'hostile lock, link noise rising'],
      gate: ['path blocked, gate 3 closed, link blocked'],
      engine: ['engine fault E2, thrust 40 percent, link fading'],
      barrier: ['barrier ahead, link cut, hull {hp} percent'],
    },
  },
  rescued: {
    vex: ['Contact eliminated. Wing two resuming station.', 'Threat cleared. Formation restored.'],
    ferro: ['Clear. That was a lot of attention for one afternoon.', 'Pursuer is gone. Position restored.'],
    pip: ['contact cleared. hull {hp} percent. formation restored', 'threat neutral. resuming station'],
  },
  hit: {
    vex: ['Impact logged. Hull serviceable.', 'Hit, starboard. Continuing.'],
    ferro: ['I have been hit. Noted.', 'A hit. The hull is unimpressed, and so am I.'],
    pip: ['impact. hull {hp} percent', 'shield fault. integrity {hp} percent'],
  },
  retreat: {
    vex: ['Hull below threshold. Disengaging. Wing two out.'],
    ferro: ['Hull at a quarter. I am going to sit the rest out somewhere quiet.'],
    pip: ['hull critical, {hp} percent. withdrawing to rear'],
  },
  down: {
    vex: ['Wing two, going down. Sable, continue without me.'],
    ferro: ['Going down. Someone note that I disliked the route.'],
    pip: ['hull failure. signal lost'],
  },
  back: {
    vex: ['Wing two, repairs complete. Rejoining.'],
    ferro: ['Ferro, patched up and rejoining.'],
    pip: ['repairs complete. hull {hp} percent. rejoining'],
  },
  cheer: {
    vex: ['Kill count logged. Continue.', 'Formation intact. Proceeding.'],
    ferro: ['I have lost count of how much I care. It is a lot of them.', 'That went well. Suspicious.'],
    pip: ['tally {kills} contacts', 'hostile count falling'],
  },
  playerLow: {
    vex: ['Lead, shield critical. Recommend a shield cell.'],
    ferro: ['Your shield is doing an impression of a sieve.'],
    pip: ['lead shield {shield} percent. cell advised'],
  },
  boss: {
    vex: ['Large contact ahead. Bearing 000.'],
    ferro: ['Something enormous. Naturally.'],
    pip: ['large contact. energy signature high'],
  },
  clear: {
    vex: ['Sector clear. Wing two standing down.'],
    ferro: ['Route complete. I would not rate the scenery.'],
    pip: ['objective complete. all systems logged'],
  },
};
const pick = (a) => a[(Math.random() * a.length) | 0];

const _v = new THREE.Vector3(), _o = new THREE.Vector3(), _d = new THREE.Vector3(), _q = new THREE.Vector3();

class Wingman {
  constructor(name, mgr, ctx) {
    this.mgr = mgr; this.ctx = ctx;
    this.name = name; this.type = 'wingman';
    this.ship = createWingman(name);
    this.label = this.ship.label;
    this.group = this.ship.group;
    this.position = this.group.position;
    this.radius = 2.4;
    this.alive = true;
    this.maxHp = 100; this.hp = 100;
    this.slot = SLOTS[name] || SLOTS.vex;
    this.side = Math.sign(this.slot.x) || 1;
    this.state = 'arrive';
    this.t = Math.random() * 10;
    this.phase = Math.random() * 6.28;
    this.off = new THREE.Vector3(this.side * 34, -6, 46); // start behind and below, fly in
    this.vel = new THREE.Vector3();
    this.tgt = new THREE.Vector3();
    this.maneuverT = 5 + Math.random() * 6;
    this.maneuver = null; this.mT = 0; this.mDur = 1; this.spin = 0; this.loopPhase = 0;
    this.target = null; this.scanT = Math.random() * 0.3;
    this.burst = 0; this.burstT = 0.6 + Math.random(); this.altGun = 0;
    this.chase = null; this.smoke = null;
    this.hitLine = 0; this.retreatT = 0;
    this.bank = 0; this.pitch = 0;
    ctx.scene.add(this.group);
    this.group.visible = true;
    this.group.userData.entity = this;
    this._place();
  }

  _place() { this.position.copy(this.ctx.rail.position).add(this.off); }

  say(text, dur = 3.2) { this.mgr.say(this.name, text, dur); }

  takeDamage(amount = 1, source, ctx = this.ctx) {
    if (!this.alive || this.state === 'gone' || this.state === 'arrive') return;
    this.hp -= amount * 0.5;
    ctx.fx?.hitSpark?.(this.position);
    this.ship.setDamage(1 - this.hp / this.maxHp);
    if (this.hitLine <= 0 && this.hp > 0) { this.hitLine = 9; if (Math.random() < 0.6) this.say(pick(LINES.hit[this.name]), 2.4); }
    if (this.hp <= 0) this.down(ctx);
    else this._checkDamageState(ctx);
  }

  _checkDamageState(ctx) {
    if (this.hp < this.maxHp * 0.45 && !this.smoke) this.smoke = ctx.fx?.damageSmoke?.(this) || null;
    if (this.hp < this.maxHp * 0.24 && !this.chase && this.state !== 'retreat' && this.state !== 'gone') {
      this.state = 'retreat'; this.retreatT = 0; this.maneuver = null; this.spin = 0;
      this.say(pick(LINES.retreat[this.name]), 3.5);
      ctx.events?.emit?.('ally:retreat', { name: this.name });
    }
  }

  down(ctx = this.ctx) {
    if (!this.alive) return;
    this.alive = false;
    this.smoke?.stop?.(); this.smoke = null;
    ctx.fx?.explosion?.(this.position, { scale: 1.8, color: 0xffaa33, debrisColor: 0x88aa99 });
    ctx.fx?.debris?.(this.position, 8, 0x9aa4b8);
    ctx.fx?.shake?.(0.5, 0.4);
    this.say(pick(LINES.down[this.name]), 3);
    ctx.events?.emit?.('ally:down', { name: this.name });
    this.chase = null; this.state = 'down';
    this.group.visible = false;
    this.mgr._prune();
  }

  destroy(ctx = this.ctx) {
    this.alive = false;
    this.smoke?.stop?.(); this.smoke = null;
    this.group.parent?.remove(this.group);
    this.ship.dispose?.();
  }

  // ==== AI ====
  _updateTarget(dt, ctx) {
    this.scanT -= dt;
    if (this.scanT > 0) return;
    this.scanT = 0.35;
    const enemies = ctx.groups.enemies;
    let best = null, bd = 1e9;
    const p = this.position;
    for (let i = 0; i < enemies.length; i++) {
      const e = enemies[i];
      if (!e || !e.alive) continue;
      const dz = p.z - e.position.z;
      if (dz < 10 || dz > 140) continue;
      const dx = Math.abs(e.position.x - p.x), dy = Math.abs(e.position.y - p.y);
      if (dx > dz * 0.5 + 6 || dy > dz * 0.45 + 6) continue;
      if (e.position.z > ctx.rail.position.z - 6) continue;
      const d = dz + dx * 0.6;
      if (d < bd) { bd = d; best = e; }
    }
    this.target = best;
  }

  _shoot(dt, ctx) {
    const tgt = this.target;
    if (!tgt || !tgt.alive || !ctx.projectiles?.firePlayerShot) return;
    this.burstT -= dt;
    if (this.burstT > 0) return;
    if (this.burst <= 0) { this.burst = 2 + ((Math.random() * 3) | 0); }
    this.burst--;
    this.burstT = this.burst > 0 ? 0.11 : 0.9 + Math.random() * 1.4;
    const a = this.altGun++ & 1 ? this.ship.anchors.cannonL : this.ship.anchors.cannonR;
    a.getWorldPosition(_o);
    _d.copy(tgt.position);
    if (tgt.velocity) _d.addScaledVector(tgt.velocity, 0.25);
    _d.sub(_o);
    const len = _d.length();
    if (len < 8) return;
    _d.divideScalar(len);
    ctx.projectiles.firePlayerShot(_o, _d, { damage: 0.6, speed: 150, color: SHOT_COLOR[this.name], owner: 'ally' });
    ctx.fx?.muzzleFlash?.(_o, _d, SHOT_COLOR[this.name]);
  }

  _startManeuver(kind) {
    this.maneuver = kind; this.mT = 0;
    if (kind === 'loop') { this.mDur = 2.6; this.loopBase = this.off.clone(); }
    else if (kind === 'roll') { this.mDur = 0.9; this.rollDir = Math.random() < 0.5 ? -1 : 1; }
    else if (kind === 'celebrate') { this.mDur = 1.0; this.rollDir = this.side; }
  }

  update(dt, ctx) {
    if (!this.alive) return;
    this.t += dt; this.hitLine -= dt;
    const rail = ctx.rail, pl = ctx.player;
    if (this.state === 'gone') return;
    const slot = this.slot;

    // ==== target offset (relative to rail) ====
    let k = 7, damp = 5.2;
    switch (this.state) {
      case 'arrive': {
        this.tgt.set(slot.x, slot.y, slot.z);
        k = 2.4; damp = 3.2;
        if (this.off.distanceTo(this.tgt) < 3) this.state = 'formation';
        break;
      }
      case 'retreat': {
        this.retreatT += dt;
        this.tgt.set(this.side * (30 + this.retreatT * 22), 10 + this.retreatT * 12, -20 - this.retreatT * 50);
        k = 2.2; damp = 2.6;
        if (this.retreatT > 3.4) { this._goGone(ctx); return; }
        break;
      }
      case 'chased': {
        const c = this.chase;
        if (!c) { this.state = 'formation'; break; }
        c.t += dt;
        const e = c.enemy;
        if (!e || !e.alive) { this._rescued(ctx); break; }
        if (c.t >= c.limit) { this.down(ctx); return; }
        // hp bleeds down towards the time limit
        this.hp = Math.min(this.hp, this.maxHp * (1 - 0.9 * c.t / c.limit));
        this.ship.setDamage(1 - this.hp / this.maxHp);
        if (this.hp < this.maxHp * 0.6 && !this.smoke) this.smoke = ctx.fx?.damageSmoke?.(this) || null;
        _q.copy(e.position).sub(rail.position);
        const wx = Math.sin(this.t * 2.3 + this.phase) * 3.5, wy = Math.cos(this.t * 1.9 + this.phase) * 2.5;
        if (c.kind === 'gate') {
          // pinned against a gate frame at the edge of the lane: barely moves
          this.tgt.set(this.side * 13 + Math.sin(this.t * 4) * 0.4, clamp(_q.y * 0.4, -4, 6) + Math.sin(this.t * 3) * 0.3, -32);
          k = 6; damp = 5;
        } else if (c.kind === 'engine') {
          // drive out: sluggish drift, slowly tumbling
          this.tgt.set(clamp(_q.x * 0.5 + wx * 0.6, -15, 15), clamp(_q.y * 0.7 - this.t * 0.15 + wy * 0.5, -6, 9), clamp(_q.z - 8, -46, -14));
          k = 2.2; damp = 2.4;
        } else if (c.kind === 'barrier') {
          // cut off: holds close to the rail, jinking short distances
          this.tgt.set(clamp(_q.x * 0.4 + wx * 0.5, -12, 12), clamp(_q.y + wy * 0.5 + 1, -6, 9), -19 + Math.sin(this.t * 1.7) * 2);
          k = 6; damp = 5;
        } else {
          // pursuer astern: weave just ahead of the pursuer, inside the play area
          this.tgt.set(clamp(_q.x * 0.6 + wx, -17, 17), clamp(_q.y + wy + 1, -6, 9), clamp(_q.z - 9, -46, -14));
          k = 9; damp = 6;
        }
        if (Math.abs(this.tgt.x) < 5.5) this.tgt.x = 5.5 * (this.tgt.x < 0 ? -1 : 1);
        // keep the pursuer glued to the escort, and let it take pot shots
        _d.copy(this.position).sub(e.position); const dist = _d.length();
        if (dist > 38) e.position.addScaledVector(_d, (24 * dt) / dist);
        c.shot -= dt;
        if (c.shot <= 0 && dist < 70 && ctx.projectiles?.fireEnemyShot) {
          c.shot = (c.kind === 'gate' ? 0.9 : 0.65) + Math.random() * 0.4;
          _d.divideScalar(dist || 1); _d.x += (Math.random() - 0.5) * 0.12; _d.y += (Math.random() - 0.5) * 0.12;
          ctx.projectiles.fireEnemyShot(e.position, _d, { damage: 1, speed: 70, radius: 0.6, color: 0xff5580 });
        }
        break;
      }
      default: { // formation
        const wx = Math.sin(this.t * 0.55 + this.phase) * 2.4, wy = Math.sin(this.t * 0.8 + this.phase * 2) * 1.2, wz = Math.sin(this.t * 0.35 + this.phase * 3) * 3;
        const px = pl?.localOffset?.x ?? 0, py = pl?.localOffset?.y ?? 0;
        let x = slot.x + wx + px * 0.3;
        this._updateTarget(dt, ctx);
        if (this.target && this.target.alive) {
          const dxT = this.target.position.x - rail.position.x;
          x += clamp((dxT - x) * 0.3, -5, 5);
        }
        if (Math.abs(x) < 6.5) x = 6.5 * this.side;
        this.tgt.set(x, slot.y + wy + py * 0.3, slot.z + wz);
        if (this.state === 'formation') this._shoot(dt, ctx);
        // random showboating
        if (!this.maneuver) {
          this.maneuverT -= dt;
          if (this.maneuverT <= 0) { this._startManeuver(Math.random() < 0.45 ? 'loop' : 'roll'); this.maneuverT = 9 + Math.random() * 9; }
        }
      }
    }

    // ==== maneuvers ====
    this.spin = 0;
    let loopPitch = 0;
    if (this.maneuver) {
      this.mT += dt;
      const u = clamp(this.mT / this.mDur, 0, 1);
      if (this.state === 'chased' || this.state === 'retreat' || this.state === 'arrive') this.maneuver = null;
      else if (this.maneuver === 'loop') {
        const ph = u * Math.PI * 2, R = 6.5;
        this.tgt.x = this.loopBase.x; this.tgt.y = this.loopBase.y + R * (1 - Math.cos(ph)); this.tgt.z = this.loopBase.z - R * Math.sin(ph) * 1.4;
        loopPitch = ph; k = 14; damp = 8;
        if (u >= 1) this.maneuver = null;
      } else {
        const e = u * u * (3 - 2 * u);
        this.spin = this.rollDir * Math.PI * 2 * e;
        this.tgt.x += this.rollDir * Math.sin(u * Math.PI) * 3.5;
        if (u >= 1) this.maneuver = null;
      }
    }
    if (this.state === 'chased') {
      // evasive rolls, scaled by the kind of trouble
      const amp = { tail: 0.9, gate: 0.12, engine: 0.55, barrier: 0.3 }[this.chase?.kind] ?? 0.6;
      this.spin = Math.sin(this.t * (this.chase?.kind === 'engine' ? 1.1 : 3.1) + this.phase) * amp;
    }

    // ==== integrate (critically damped spring in rail space) ====
    const ax = (this.tgt.x - this.off.x) * k - this.vel.x * damp;
    const ay = (this.tgt.y - this.off.y) * k - this.vel.y * damp;
    const az = (this.tgt.z - this.off.z) * k - this.vel.z * damp;
    this.vel.x += ax * dt; this.vel.y += ay * dt; this.vel.z += az * dt;
    this.off.addScaledVector(this.vel, dt);
    this.off.z = clamp(this.off.z, this.state === 'arrive' ? -90 : -70, 70);
    this._place();

    // never occupy the player's space or sit on the reticle line
    if (pl?.position && this.state !== 'arrive') {
      _d.copy(this.position).sub(pl.position);
      const dl = _d.length();
      if (dl < 8) {
        if (dl < 1e-3) _d.set(this.side, 0.3, -1); else _d.divideScalar(dl);
        const push = 8 - dl;
        this.position.addScaledVector(_d, push); this.off.addScaledVector(_d, push);
      }
    }

    // ==== pose ====
    const bankTarget = clamp(-this.vel.x * 0.055, -0.9, 0.9);
    this.bank += (bankTarget - this.bank) * (1 - Math.exp(-6 * dt));
    const pitchTarget = clamp(this.vel.y * 0.035, -0.5, 0.5);
    this.pitch += (pitchTarget - this.pitch) * (1 - Math.exp(-6 * dt));
    this.ship.setBank(loopPitch ? loopPitch : this.pitch, this.bank, clamp(-this.vel.x * 0.02, -0.4, 0.4));
    this.ship.setRoll(this.spin);
    this.ship.setBoost(pl?.isBoosting ? 1 : (this.state === 'retreat' ? 0.8 : 0));
    this.ship.setBrake(pl?.isBraking ? 1 : 0);
    this.ship.update?.(dt);
  }

  _rescued(ctx) {
    this.chase = null; this.state = 'formation';
    this.hp = Math.max(this.hp, this.maxHp * 0.6);
    this.ship.setDamage(1 - this.hp / this.maxHp);
    if (this.hp > this.maxHp * 0.45) { this.smoke?.stop?.(); this.smoke = null; }
    this._startManeuver('roll');
    this.say(pick(LINES.rescued[this.name]), 3.2);
    ctx.events?.emit?.('ally:rescued', { name: this.name });
  }

  _goGone(ctx) {
    this.state = 'gone';
    this.group.visible = false;
    this.smoke?.stop?.(); this.smoke = null;
    this.mgr._prune();
  }

  comeBack(ctx) {
    this.state = 'arrive'; this.alive = true;
    this.hp = this.maxHp * 0.7; this.ship.setDamage(0.3);
    this.off.set(this.side * 40, -8, 50); this.vel.set(0, 0, 0);
    this.group.visible = true; this._place();
    if (!ctx.groups.allies.includes(this)) ctx.groups.allies.push(this);
    this.say(pick(LINES.back[this.name]), 3);
    ctx.events?.emit?.('ally:return', { name: this.name });
  }
}

export const allies = {
  ctx: null, wingmen: [], enabled: true, autoSpawn: true, _autoT: -1, _chatT: 8, _kills: 0, _killTotal: 0, _lineT: 0, _troubleIdx: 0,
  titleFormation: null,

  init(ctx) {
    this.ctx = ctx;
    const ev = ctx.events;
    ev?.on?.('level:start', (e) => this._onLevelStart(e?.index ?? 0));
    ev?.on?.('enemy:killed', () => {
      this._killTotal++;
      if (++this._kills % 14 === 0) this._cheer();
    });
    ev?.on?.('player:damage', () => {
      const st = ctx.state;
      if (st && st.health < 28 && this._lineT <= 0) { this._lineT = 20; this._anyLine('playerLow'); }
    });
    ev?.on?.('boss:spawn', () => { this._anyLine('boss', 2.5); });
    ev?.on?.('level:complete', () => { this._anyLine('clear'); });
  },

  reset(ctx = this.ctx) {
    for (const w of this.wingmen) w.destroy(ctx);
    this.wingmen.length = 0;
    if (ctx?.groups?.allies) ctx.groups.allies.length = 0;
    this._autoT = -1; this._chatT = 8; this._kills = 0; this._killTotal = 0; this._lineT = 0;
  },

  _onLevelStart(index) {
    const ctx = this.ctx;
    this._autoT = 1.2;          // auto spawn fallback if the level script did not spawn any wingmen
    this._kills = 0; this._killTotal = 0; this._chatT = 10;
    if (index > 0) {
      // survivors that fell back return, downed wingmen are replaced (arcade generosity)
      for (const n of NAMES) {
        const w = this.wingmen.find((x) => x.name === n);
        if (w && w.state === 'gone') w.comeBack(ctx);
        else if (w && !w.alive && w.state === 'down') { w.destroy(ctx); this.wingmen.splice(this.wingmen.indexOf(w), 1); this.spawnWingmen([n]); }
        else if (w && w.alive) { w.hp = Math.min(w.maxHp, w.hp + 40); w.ship.setDamage(1 - w.hp / w.maxHp); }
      }
    }
  },

  _fill(text, name) {
    const w = this.wingmen.find((x) => x.name === name);
    const st = this.ctx?.state;
    return String(text)
      .replace('{hp}', String(Math.max(1, Math.round(((w?.hp ?? 60) / (w?.maxHp || 100)) * 100))))
      .replace('{shield}', String(Math.max(0, Math.round(((st?.health ?? 0) / (st?.maxHealth || 100)) * 100))))
      .replace('{kills}', String(this._killTotal));
  },
  say(name, text, duration = 3.5) {
    const ui = this.ctx?.ui;
    if (!this.enabled || !ui?.comm) return;
    ui.comm({ speaker: SPEAKER[name] || 'CONTROL', text: this._fill(text, name), duration });
  },
  _anyLine(kind, delay = 0) {
    const alive = this.wingmen.filter((w) => w.alive && w.state !== 'gone');
    if (!alive.length) return;
    const w = alive[(Math.random() * alive.length) | 0];
    const lines = LINES[kind]?.[w.name];
    if (lines) w.say(pick(lines), 3.2);
  },
  _cheer() { if (this._chatT <= 0) { this._chatT = 22; this._anyLine('cheer'); } },

  /** spawn wingmen by name (idempotent). */
  spawnWingmen(names = NAMES) {
    const ctx = this.ctx;
    if (!ctx) return this.wingmen;
    for (const raw of names) {
      const n = String(raw).toLowerCase();
      if (!SLOTS[n]) continue;
      const ex = this.wingmen.find((w) => w.name === n && w.alive);
      if (ex) continue;
      const w = new Wingman(n, this, ctx);
      w.group.visible = this.enabled;
      this.wingmen.push(w);
      ctx.groups.allies.push(w);
    }
    this._autoT = -1;
    return this.wingmen;
  },

  setEnabled(on) {
    this.enabled = !!on;
    for (const w of this.wingmen) if (w.alive && w.state !== 'gone') w.group.visible = this.enabled;
    const g = this.ctx?.groups?.allies;
    if (g) {
      g.length = 0;
      if (this.enabled) for (const w of this.wingmen) if (w.alive && w.state !== 'gone') g.push(w);
    }
  },

  /** an escort is in trouble because of `enemy`; clear it within `time` seconds or the escort goes down. The trouble kind
   *  rotates (pursuer astern, pinned at a gate, engine disabled, cut off by a barrier) unless opts.kind is given. */
  chaseMe(name, enemy, opts = {}) {
    if (!this.enabled) return;
    const n = String(name).toLowerCase();
    const w = this.wingmen.find((x) => x.name === n && x.alive && x.state !== 'gone' && x.state !== 'retreat');
    if (!w || !enemy) return;
    const limit = opts.time ?? 18;
    const kind = TROUBLE.includes(opts.kind) ? opts.kind : TROUBLE[this._troubleIdx++ % TROUBLE.length];
    w.chase = { enemy, t: 0, limit, shot: 1.2, kind };
    w.state = 'chased'; w.maneuver = null;
    w.say(pick(LINES.chase[n][kind]), 3.5);
    this.ctx?.ui?.warning?.(`${SPEAKER[n] || n.toUpperCase()}: ${TROUBLE_WARN[kind]}`);
  },

  rescue(name) { const w = this.wingmen.find((x) => x.name === String(name).toLowerCase()); if (w?.state === 'chased') w._rescued(this.ctx); },

  _prune() {
    const g = this.ctx.groups.allies;
    for (let i = g.length - 1; i >= 0; i--) { const w = g[i]; if (!w.alive || w.state === 'gone') g.splice(i, 1); }
  },

  update(dt, ctx = this.ctx) {
    if (!this.enabled) return;
    this._chatT -= dt; this._lineT -= dt;
    if (this._autoT > 0) { this._autoT -= dt; if (this._autoT <= 0 && this.autoSpawn && !this.wingmen.length) this.spawnWingmen(NAMES); }
    for (let i = 0; i < this.wingmen.length; i++) this.wingmen[i].update(dt, ctx);
  },

  /** title screen hero shot: the Vanta plus the three wingmen in a V. Returns {group, update(dt), dispose()}; self animating. */
  spawnTitleFormation(parent) {
    const ctx = this.ctx;
    const host = parent || ctx?.scene;
    const group = new THREE.Group(); group.name = 'titleFormation';
    const ships = [];
    const layout = [['vanta', 0, 0, 0], ['vex', -5.5, 0.3, 4.5], ['ferro', 5.5, 0.2, 4.5], ['pip', 0, 0.4, 9]];
    for (const [n, x, y, z] of layout) {
      const s = n === 'vanta' ? createVanta({ light: false }) : createWingman(n);
      s.group.position.set(x, y, z); group.add(s.group); ships.push({ s, x, y, z, ph: Math.random() * 6 });
      s.setBoost(0.5);
    }
    let last = performance.now();
    const update = (dt) => {
      const t = performance.now() / 1000;
      for (const o of ships) {
        o.s.group.position.set(o.x + Math.sin(t * 0.7 + o.ph) * 0.25, o.y + Math.sin(t * 0.9 + o.ph * 2) * 0.3, o.z);
        o.s.setBank(Math.sin(t * 0.6 + o.ph) * 0.05, Math.sin(t * 0.5 + o.ph) * 0.18, 0);
        o.s.update?.(dt);
      }
    };
    const driver = new THREE.Mesh(new THREE.PlaneGeometry(0.01, 0.01), new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false }));
    driver.onBeforeRender = () => { const now = performance.now(); if (now - last < 4) return; update(Math.min((now - last) / 1000, 0.1)); last = now; };
    group.add(driver);
    host.add(group);
    const obj = { group, ships, update, dispose: () => { host.remove(group); ships.forEach((o) => o.s.dispose?.()); driver.geometry.dispose(); driver.material.dispose(); if (this.titleFormation === obj) this.titleFormation = null; } };
    this.titleFormation = obj;
    return obj;
  },
};
