// Destroyable sub-entity attached to a parent enemy or boss (a turret on a carrier, a cable clamp, an armour plate, an
// emitter lens, a core...). It is a full entity in ctx.groups.enemies so collision and lock-on treat it like any enemy.
//
// Reflected shots: when a shot that the player deflected with a barrel roll lands on a part, the owner may answer
// `owner.onReflectedHit(part, shot)` with `{damage, force}`. The damage replaces the shot's own (armour is ignored) and
// `force: true` lets it land even while the part is closed. Returning nothing keeps the ordinary rules.
import * as THREE from 'three';

const WHITE = new THREE.Color(1, 1, 1);

export class Part {
  /**
   * @param owner   parent entity; receives onPartHit(part, amount) / onPartDestroyed(part)
   * @param anchor  Object3D inside the owner's model; its world position drives this.position
   * opts: {name, radius, hp, points, exposed, lockable, meshes[], armor, explScale, debrisColor, noScale}
   */
  constructor(owner, ctx, anchor, opts = {}) {
    this.owner = owner; this.ctx = ctx; this.group = anchor; this.anchor = anchor;
    this.position = new THREE.Vector3(); this.aimOffset = new THREE.Vector3();
    this.name = opts.name ?? 'part'; this.type = 'part';
    this.radius = opts.radius ?? 2; this.points = opts.points ?? 0;
    const dscale = ctx.config.difficulty[ctx.state.difficulty]?.enemyHp ?? 1;
    this.maxHp = this.hp = (opts.hp ?? 10) * (opts.noScale ? 1 : dscale);
    this.exposed = opts.exposed ?? true; this.armor = opts.armor ?? 1;
    this.lockable = opts.lockable ?? true; this.alive = true; this.invulnerable = false;
    this.explScale = opts.explScale ?? this.radius * 0.6;
    this.debrisColor = opts.debrisColor ?? 0xb02733; this.explColor = opts.explColor ?? 0xffaa33;
    this.contactDamage = 0;
    this.flashT = 0; this._destroyed = false;
    this._flash = [];
    for (const m of opts.meshes ?? []) {
      if (!m.material?.isMeshStandardMaterial) continue;
      m.material = m.material.clone();
      this._flash.push({ m: m.material, e: m.material.emissive.clone(), i: m.material.emissiveIntensity });
    }
    anchor.getWorldPosition(this.position);
  }

  sync() { if (this.alive) this.anchor.getWorldPosition(this.position); }

  update(dt) {
    if (!this.alive || this.flashT <= 0) return;
    this.flashT = Math.max(0, this.flashT - dt * 7);
    const f = this.flashT * this.flashT;
    for (const x of this._flash) { x.m.emissive.copy(x.e).lerp(WHITE, f); x.m.emissiveIntensity = x.i + f * 1.6; }
  }

  takeDamage(amount, source, ctx = this.ctx, info = null) {
    if (!this.alive || this._destroyed || this.owner.dying) return;
    let forced = false, raw = false;
    if (info?.shot?.reflected && this.owner.onReflectedHit) {
      const r = this.owner.onReflectedHit(this, info.shot);
      if (r) { amount = r.damage; forced = !!r.force; raw = true; }
    }
    if (!(this.exposed || forced) || this.invulnerable || this.owner.invulnerable) {
      ctx.fx?.sparks?.(this.position, null, 4);
      ctx.audio?.sfx?.('hit', { pitch: 0.55, volume: 0.6, position: this.position });
      return;
    }
    this.hp -= raw ? amount : amount * this.armor;
    this.flashT = 1;
    ctx.fx?.hitSpark?.(info?.position ?? this.position, undefined, Math.min(1.6, 0.8 + amount * 0.08));
    ctx.audio?.sfx?.('bossHit', { position: this.position });
    if (raw) { ctx.fx?.explosion?.(this.position, { scale: this.explScale * 0.8, color: 0xffe0a0 }); ctx.fx?.shake?.(0.6, 0.3); ctx.events.emit('fx:hitstop', { duration: 0.07 }); }
    this.owner.onPartHit?.(this, amount);
    if (this.hp <= 0) this.die(ctx);
  }

  die(ctx = this.ctx) {
    if (!this.alive || this._destroyed) return;
    this.hp = 0;
    ctx.fx?.explosion?.(this.position, { scale: this.explScale, big: this.explScale > 3, color: this.explColor });
    ctx.fx?.debris?.(this.position, 10, this.debrisColor);
    ctx.fx?.shake?.(0.3, 0.25);   // parts with points also shake through the enemy:killed event
    ctx.audio?.sfx?.('explosion', { position: this.position });
    if (this.points) ctx.events.emit('enemy:killed', { enemy: this, points: this.points, position: this.position.clone() });
    this.owner.onPartDestroyed?.(this);
    this.destroy(ctx);
  }

  /** Remove from the game without effects. The anchor stays in the owner's model (owner decides visuals). */
  destroy() {
    if (this._destroyed) return;
    this._destroyed = true; this.alive = false; this.lockable = false;
    for (const x of this._flash) x.m.dispose();
    this._flash = [];
  }
}
