// Shared drum groove for the style D tracks: a restrained kick, soft hats, offbeat open hat, shaker, reverb'd clap and optional
// tick/rim/tom percussion, all driven by 16 step pattern strings so each track only supplies its own patterns and sounds.
import { steps, vel as velOf } from './util.js';

/**
 * o: { beat, sd, kick:{...rig.kick params}, kickPat, hatPat, ohPat, shakerPat, clapPat, percPat, perc(t, vel, step), hatDec, hatVol, ohDec,
 *      ohVol, clap:{...}, duck:{depth, rel}, air (bool, drop the last beat's kick), rnd, cut (steps >= cut are skipped: real silence) }
 * g: { kick, hat, oh, shaker, clap, perc } layer gains 0..1 (0 = layer off)
 */
export function grooveBar(rig, t0, g, o) {
  const { beat, sd, rnd = Math.random } = o;
  const cut = o.cut ?? 16;
  const each = (pat, fn) => steps(pat, (s, c) => { if (s < cut) fn(s, c); });
  if (g.kick > 0.05) {
    each(o.kickPat || 'x...x...x...x...', (s, c) => {
      if (o.air && s >= 12) return;
      rig.kick(t0 + s * sd, velOf(c) * (0.6 + 0.4 * g.kick) * (s % 4 ? 0.8 : 1), o.kick);
      rig.duck(t0 + s * sd, o.duck?.depth ?? 0.4, o.duck?.rel ?? beat * 0.7);
    });
  }
  if (g.hat > 0.05 && o.hatPat) each(o.hatPat, (s, c) => rig.hat(t0 + s * sd, velOf(c) * g.hat * (0.9 + rnd() * 0.2), (o.hatDec ?? 0.03) + rnd() * 0.008, o.hatHP ?? 7000, (o.hatVol ?? 0.12) * 3.7));
  if (g.oh > 0.05 && o.ohPat) each(o.ohPat, (s, c) => rig.oh(t0 + s * sd, velOf(c) * g.oh, o.ohDec ?? 0.2, o.ohVol ?? 0.11, o.ohHP ?? 6500));
  if (g.shaker > 0.05 && o.shakerPat) each(o.shakerPat, (s, c) => rig.shaker(t0 + s * sd, velOf(c) * g.shaker * (0.85 + rnd() * 0.3), 0.055, (o.shakerVol ?? 0.12) * 2.2));
  if (g.clap > 0.05 && o.clapPat) each(o.clapPat, (s, c) => rig.clap(t0 + s * sd, velOf(c) * g.clap, o.clap));
  if (g.perc > 0.05 && o.percPat && o.perc) each(o.percPat, (s, c) => o.perc(t0 + s * sd, velOf(c) * g.perc, s));
}
