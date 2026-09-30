// Level atmosphere controller (one per game, created on the first tick). Owns: the two-light rig (boss hero light and per level
// idle light), the flash guard, and the ambient particle fields of every level. Ticked every frame from src/world/dust.js (all
// three levels build a dust field and update it from their environment update), and also directly by the Cinder and Foundry files.
// The tick is idempotent per frame, so calling it from several places is harmless.
import { AtmoRig } from './rig.js';
import { installFlashGuard } from './flashGuard.js';
import { createMotes } from './motes.js';

const states = new WeakMap();

const AMBIENT = {
  thalassa: [['pollen', { seed: 31 }]],
  cinder: [['ember', { seed: 41 }], ['ash', { seed: 43 }]],
  foundry: [['spark', { seed: 51 }], ['soot', { seed: 53 }]],
};

class Atmosphere {
  constructor(ctx) {
    this.ctx = ctx;
    this.rig = new AtmoRig(ctx.scene);
    this.res = null;           // Resources object of the level the ambient fields belong to
    this.fields = [];
    this.fog = null;           // { fog, near, far } base values of the current level
    this.lastT = -1;
    const ev = ctx.events;
    ev.on('boss:spawn', (e) => this.rig.onSpawn(e?.key ?? ''));
    ev.on('boss:phase', (e) => this.rig.onPhase(e?.phase ?? 1));
    ev.on('boss:defeated', () => this.rig.onDefeated());
    ev.on('game:start', () => this.rig.reset());
    ev.on('level:start', () => this.rig.reset());
    installFlashGuard(ctx);
  }

  /** Called by a level file: describe what the two rig lights do outside boss fights. fn(out, dt, ctx, W, P) fills out.aPos/aCol/aI/aDist/bPos/bCol/bI/bDist. */
  setIdle(W, fn) { this.rig.setIdle(W.res, fn); }

  _onLevel(W) {
    // the old fields were children of the old world root and are disposed with it
    this.fields = [];
    this.res = W.res;
    this.rig.reset();
    const f = W.theme in AMBIENT ? AMBIENT[W.theme] : [];
    for (const [kind, o] of f) {
      const m = createMotes(kind, o);
      W.root.add(m.object);
      this.fields.push(m);
    }
    const fg = this.ctx.scene.fog;
    this.fog = fg ? { fog: fg, near: fg.near, far: fg.far } : null;
  }

  tick(dt) {
    const ctx = this.ctx, W = ctx.world;
    if (!W || !W.root || !W.res) return;
    const now = W.time;
    if (now === this.lastT && dt > 0) return;   // already ticked this frame
    this.lastT = now;
    if (this.res !== W.res) this._onLevel(W);
    const P = ctx.feel.p.atmosphere, th = W.theme;
    for (let i = 0; i < this.fields.length; i++) {
      const f = this.fields[i];
      const secondary = i > 0;
      f.update(ctx, now, {
        amount: P[th + '_motes'] * (secondary ? 0.8 : 1),
        size: P[th + '_moteSize'], bright: P[th + '_moteBright'],
      });
    }
    if (this.fog && (th === 'cinder' || th === 'foundry') && ctx.scene.fog === this.fog.fog) {
      const d = Math.max(0.2, P[th + '_fogDensity'] ?? 1);
      this.fog.fog.far = this.fog.far / d; this.fog.fog.near = this.fog.near / Math.sqrt(d);
    }
    this.rig.update(Math.min(dt, 0.1), ctx, W);
  }
}

export function getAtmosphere(ctx) {
  let s = states.get(ctx);
  if (!s) { s = new Atmosphere(ctx); states.set(ctx, s); }
  return s;
}

export function tickAtmosphere(ctx, dt) {
  if (!ctx || !ctx.scene || !ctx.feel || !ctx.events) return;
  getAtmosphere(ctx).tick(dt);
}
