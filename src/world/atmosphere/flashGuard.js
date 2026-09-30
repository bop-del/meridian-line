// Flash guard: keeps a pile of explosions that go off right in front of the camera from adding up to a full screen white-out.
//
// Root cause of the Foundry white-out (bisected with a per object visibility test): it is not scene light and not level geometry. Every
// enemy blast is an additive fire particle system, and when a whole wave dies or rams the ship at once (the Foundry arena run has
// eight to thirty enemies converging on the ship) hundreds of fire, ring and spark billboards of 1 to 5 units overlap at 8 to 20 units
// from the camera, and their additive sum clips the whole screen for half a second. The particle code lives in src/fx and belongs to
// somebody else, so the guard wraps fx.explosion from here: it keeps an energy counter that grows with each blast (size squared over
// distance squared) and decays in about half a second. The more energy is already on screen, the smaller the next blast becomes, and
// past a hard limit close blasts are replaced by a few sparks. A single blast, or blasts far away (bosses), are never touched.
import * as THREE from 'three';

const _v = new THREE.Vector3();

export function installFlashGuard(ctx) {
  const fx = ctx.fx;
  if (!fx || fx.__flashGuard || typeof fx.explosion !== 'function') return;
  const orig = fx.explosion;
  const S = { e: 0, t: 0 };
  fx.explosion = function guardedExplosion(pos, o = {}) {
    const cam = ctx.camera, P = ctx.feel?.p?.atmosphere;
    if (!cam || !P || P.flashGuard <= 0 || !pos) return orig.call(this, pos, o);
    const now = (this.time ?? performance.now() / 1000);
    S.e *= Math.exp(-Math.max(0, now - S.t) / 0.45); S.t = now;
    const d = Math.max(10, cam.position.distanceTo(_v.set(pos.x, pos.y, pos.z)));
    const size = (o.scale ?? 1) * (o.big ? 1.8 : 1);
    const limit = Math.max(1, P.flashGuardLimit);
    // shrink in proportion to the energy already on screen
    let m = Math.max(0.3, Math.sqrt(1 / (1 + S.e / limit)));
    // one huge blast close to the camera is enough to fill the screen on its own (a mine blast is three fire puffs' worth of
    // 10 to 20 units wide at 20 units distance), so also cap the size by the distance: fireballs may span about a third of the view
    if (d < 60) m = Math.min(m, Math.max(0.3, (d * 0.095) / size));
    m = 1 - P.flashGuard * (1 - m);
    if (S.e > limit * 3 && d < 60 && !o.big && P.flashGuard > 0.5) {
      // saturated: a few sparks instead of a full blast
      S.e += (size * size * 900) / (d * d) * 0.05;
      return fx.sparks?.(pos, null, 5);
    }
    S.e += (size * size * m * m * 900) / (d * d);
    if (m >= 0.999) return orig.call(this, pos, o);
    return orig.call(this, pos, { ...o, scale: (o.scale ?? 1) * m });
  };
  fx.__flashGuard = true;
}
