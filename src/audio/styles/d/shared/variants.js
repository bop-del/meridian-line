// Mix variants of the style D tracks. Every track is a config for the builder in ./track.js; a variant is a pure function that takes
// that config and returns a changed copy, so all variants share the same code, keys, tempos and arrangements.
//
//   melodic   the reference: pluck arps and a sparse bell motif are the main voice (unchanged config)
//   pressure  strongest kick and bass: tighter punchy kick with a second sub layer, louder rolling bass with a moving filter,
//             arps low and filtered as rhythm texture, a very quiet motif only at high intensity
//   deep      pads forward: two wide pad layers, slower filter drift, longer reverb, rounder kick and sub bass, a single bell note
//             now and then, less percussion
//   hypno     groove first: kick, bass and percussion carry it, arps only as short filtered ticks, no motif, low steady pads,
//             one long filter movement over the whole loop
//
// The page picks one with ?dvar=melodic|pressure|deep|hypno (default deep); globalThis.__dVariant does the same for offline renders.
export const VARIANT_NAMES = ['melodic', 'pressure', 'deep', 'hypno'];
export const DEFAULT_VARIANT = 'deep';   // the default mix for every track

export function selectedVariant() {
  const ok = (v) => (typeof v === 'string' && VARIANT_NAMES.includes(v.toLowerCase()) ? v.toLowerCase() : null);
  const g = ok(globalThis.__dVariant);
  if (g) return g;
  try { const q = ok(new URLSearchParams(location.search).get('dvar')); if (q) return q; } catch (e) { /* not in a browser */ }
  return DEFAULT_VARIANT;
}

// Output trim per track and variant, measured so that the integrated K-weighted loudness stays within about 1 dB of the melodic version.
const TRIM = {
  d: { pressure: 0.891, deep: 0.821, hypno: 0.991 },
  'd-foundry': { pressure: 0.926, deep: 0.94, hypno: 0.999 },
  'd-cinder': { pressure: 0.891, deep: 0.808, hypno: 0.985 },
  'd-thalassa': { pressure: 0.871, deep: 0.806, hypno: 0.977 },
  'd-boss': { pressure: 0.891, deep: 0.915, hypno: 0.974 },
};

const mulLevels = (base = {}, m) => {
  const out = { ...base };
  for (const [k, v] of Object.entries(m)) out[k] = (base[k] ?? 1) * v;
  return out;
};
const scaleCut = (cut, a, b = a) => [cut[0] * a, cut[1] * b];
const mapLayers = (sections, fn) => sections.map(([n, bars, layers]) => [n, bars, fn(new Set(layers.split(/\s+/).filter(Boolean)), n).join(' ')]);
const without = (names) => (set) => [...set].filter((l) => !names.includes(l));
const withAdded = (names, inSections) => (set, sec) => (inSections.includes(sec) ? [...new Set([...set, ...names])] : [...set]);
const ROLLING = '.rrf.rrr.rfr.rrf';

export function applyVariant(cfg, name) {
  if (name === 'melodic' || !VARIANT_NAMES.includes(name)) return cfg;
  const trim = (cfg.rig.trim ?? 0.2) * (TRIM[cfg.id]?.[name] ?? 1);
  const c = { ...cfg, rig: { ...cfg.rig, trim }, eCouple: 0.7 };   // cutoffs also follow the level progress, so the intensity layers stay audible

  if (name === 'pressure') {
    c.rig.levels = mulLevels(cfg.rig.levels, { kick: 1.5, bass: 1.9, arp: 0.5, lead: 0.45, drone: 1.1, pad: 0.85 });
    c.kick = { ...cfg.kick, f0: (cfg.kick.f0 ?? 150) * 1.1, sweepT: (cfg.kick.sweepT ?? 0.05) * 0.85, drive: (cfg.kick.drive ?? 1) + 0.5, click: (cfg.kick.click ?? 0.2) * 1.4, sub: 0.55, hold: 0.5 };
    c.bass = { ...cfg.bass, pat: (sec) => (sec.name === 'intro' ? '..r...r...r...f.' : ROLLING), cut: scaleCut(cfg.bass.cut, 1.0, 1.5), len: 0.8, env: 2.6, vol: (cfg.bass.vol ?? 0.15) * 1.05 };
    c.arp = { ...cfg.arp, cut: scaleCut(cfg.arp.cut, 0.6), len: (cfg.arp.len ?? 0.8) * 0.8 };
    c.motif = cfg.motif && { ...cfg.motif, vol: (cfg.motif.vol ?? 0.07) * 0.5 };
    c.thr = { ...cfg.thr, motif: 0.85 };
    c.pad = { ...cfg.pad, cut: scaleCut(cfg.pad.cut, 0.85), vol: (cfg.pad.vol ?? 0.05) * 1.1 };
  } else if (name === 'deep') {
    c.rig.levels = mulLevels(cfg.rig.levels, { kick: 1.1, bass: 1.35, arp: 0.35, lead: 0.6, pad: 2.0, drone: 1.8, drums: 0.7 });
    c.rig.revSec = (cfg.rig.revSec ?? 4.2) + 0.9;
    c.rig.revLevel = (cfg.rig.revLevel ?? 0.3) * 1.25;
    c.rig.modRate = 0.55;
    c.kick = { ...cfg.kick, f0: (cfg.kick.f0 ?? 150) * 0.92, drive: (cfg.kick.drive ?? 1) * 0.7, click: (cfg.kick.click ?? 0.2) * 0.5, len: (cfg.kick.len ?? 0.45) * 1.05, sub: 0.4 };
    c.bass = {
      ...cfg.bass, cut: scaleCut(cfg.bass.cut, 0.8, 0.85), len: 0.85,
      voice: { oscs: [{ type: 'sine', gain: 1.3 }, { type: 'triangle', gain: 0.18 }], q: 1.0 },
    };
    c.arp = { ...cfg.arp, cut: scaleCut(cfg.arp.cut, 0.55) };
    c.motif = cfg.motif && { ...cfg.motif, vol: (cfg.motif.vol ?? 0.07) * 0.9, rel: 1.8, notes: (ch, bar, sec) => { const n = bar % 4 === 0 ? cfg.motif.notes(ch, bar, sec) || cfg.motif.notes(ch, bar + 2, sec) : null; return n ? [n[0]] : null; } };
    c.thr = { ...cfg.thr, motif: 0.6, tick: 2, shaker: 2, rim: 2, tom: 2, oh: 0.3 };
    c.pad = { ...cfg.pad, layers: 2, cut: scaleCut(cfg.pad.cut, 0.85), atk: 2.6, rev: 0.7 };
    c.drone = cfg.drone || { vol: 0.05, cut: 260 };
    c.sections = mapLayers(cfg.sections, (set, n) => { const l = without(['tick', 'shaker', 'rim', 'tom'])(set); l.push('drone'); return [...new Set(l)]; });
  } else if (name === 'hypno') {
    c.rig.levels = mulLevels(cfg.rig.levels, { kick: 1.2, bass: 1.35, arp: 0.45, lead: 0, pad: 0.6, drone: 0.8, drums: 1.3 });
    c.motif = null;
    c.kick = { ...cfg.kick, click: (cfg.kick.click ?? 0.2) * 1.2, drive: (cfg.kick.drive ?? 1) + 0.2, sub: 0.3 };
    c.bass = { ...cfg.bass, pat: (sec) => (sec.name === 'intro' ? '..r...r...r...f.' : ROLLING), cut: scaleCut(cfg.bass.cut, 1.0, 1.4), len: 0.72 };
    c.arp = { ...cfg.arp, cut: scaleCut(cfg.arp.cut, 0.45), len: 0.35, dec: 0.06, env: 2.6 };
    c.pad = { ...cfg.pad, cut: [cfg.pad.cut[0] * 0.8, cfg.pad.cut[0] * 1.15], atk: 2, vol: (cfg.pad.vol ?? 0.05) * 0.9 };
    c.arc = [[0, 0.15], [16, 1], [32, 0.15]];
    c.thr = { ...cfg.thr, tick: 0.2, shaker: 0.1, rim: 0.3, tom: 0.4, oh: 0, arp: 0.1 };
    c.sections = mapLayers(cfg.sections, withAdded(['tick', 'shaker', 'rim', 'tom'], ['groove', 'drop', 'outro']));
  }
  return c;
}
