// Track factory for the style C tracks. A track file builds a Score (see kit.js) plus a spec (levels, arc, layers) and
// gets back a variant module { meta, create } as the music engine expects (see src/audio/title/player.js).
//
// Levels: levels[kind] = [hi, rangeDb]: amplitude at arc = 1 and how many dB it falls towards arc = 0. `arc` is the
// composed dynamic curve of the piece, one value 0..1 per bar. `layers` maps a layer name to { on, full, min }: the layer
// fades in between engine intensity `on` and `full` (gain `min` below, 1 above); setIntensity() moves the layer gains
// smoothly (time constant `tc` seconds), the first call sets them at once.
import { createVoices, mulberry32 } from './voices.js';

const ss = (x) => { const t = Math.max(0, Math.min(1, x)); return t * t * (3 - 2 * t); };
export const DEFAULT_LAYER_OF = {
  horn: 'horn', str: 'str', tstr: 'str', brass: 'brass', wind: 'wind', pad: 'pad', bass: 'bass', ost: 'ost', spic: 'pulse',
  pluck: 'pluck', timp: 'timp', roll: 'timp', riser: 'fx', crash: 'fx', tam: 'fx',
};
const JIT = { horn: 0.014, str: 0.012, tstr: 0.012, brass: 0.012, wind: 0.012, ost: 0.009, spic: 0.009, pluck: 0.012, timp: 0.006 };

export function createTrack(spec) {
  const { meta, score: S, arc, levels, layers = null, layerOf = {}, reverb, wet = 1, tc = 0.9, bright, masterGain, padOpts = {}, bassOpts = {}, hornOpts = {}, seed = 0, xTrim = 0 } = spec;
  const BPM = meta.bpm, BEAT = 60 / BPM, BAR = (meta.beatsPerBar ?? 4) * BEAT;
  const lo = (k) => layerOf[k] ?? DEFAULT_LAYER_OF[k] ?? k;
  const lvl = (kind, a) => { const L = levels[kind]; if (!L) return 0; return L[0] * Math.pow(10, (-(1 - a) * (L[1] || 0)) / 20); };

  const module = {
    meta: { beatsPerBar: 4, ...meta },
    create(ac, out) {
      const V = createVoices(ac, out, { barDur: BAR, reverb, wet, masterGain });
      const layerGain = (name, x) => {
        const c = layers && layers[name]; if (!c) return 1;
        const min = c.min ?? 0; return min + (1 - min) * ss((x - c.on) / Math.max(1e-6, c.full - c.on));
      };
      let x = layers ? 0.5 : 1; let seen = false;
      const trimAt = (xx) => Math.pow(10, (-(1 - xx) * xTrim) / 20);
      const applyLayers = (at) => {
        if (!layers) return;
        if (xTrim) { if (at === undefined) V.setTrim(trimAt(x)); else V.setTrim(trimAt(x), at, 1.4); }
        for (const name of Object.keys(layers)) {
          const g = layerGain(name, x);
          if (at === undefined) V.setLayer(name, g); else if (Math.abs(g - V.layerValue(name)) > 0.002) V.setLayer(name, g, at, tc);
        }
      };
      applyLayers(undefined); // sensible default before the engine reports
      const audible = (name) => !layers || !layers[name] || layerGain(name, x) > 0.02;

      return {
        setIntensity(v, at) {
          const nx = Math.max(0, Math.min(1, Number.isFinite(v) ? v : 0.5));
          if (!layers) { x = nx; return; }
          x = nx;
          if (!seen) { seen = true; applyLayers(undefined); } else applyLayers(at === undefined ? ac.currentTime : at);
        },

        scheduleBar(t0, bar, loop) {
          const rng = mulberry32(bar * 977 + loop * 131 + 7 + seed);
          const vari = () => 0.92 + rng() * 0.16;
          const a = arc[bar];

          V.setBrightness(t0, bright ? bright(a, x) : 1500 + 3300 * a, 0.5);

          const solo = globalThis.__C_SOLO || null; // optional test hook: array of event kinds to render alone (stems)
          // Pad and bass runs starting this bar.
          const pd = S.pads.get(bar);
          if (pd && audible(pd.layer) && (!solo || solo.includes('pad'))) {
            const amps = [];
            for (let i = 0; i < pd.bars; i++) { const b = Math.min(S.bars - 1, bar + i); const lv = Array.isArray(pd.level) ? pd.level[i] : pd.level; amps.push(Math.max(0, lvl('pad', arc[b]) * lv)); }
            V.padRun(t0 + 0.01, pd.bars, pd.midis, amps, { layer: pd.layer, tail: bar + pd.bars >= S.bars ? 0.7 : 0.28, ...padOpts, ...(pd.o || {}) });
          }
          const bs = S.basses.get(bar);
          if (bs && audible(bs.layer) && (!solo || solo.includes('bass'))) {
            const amps = [];
            for (let i = 0; i < bs.bars; i++) { const b = Math.min(S.bars - 1, bar + i); const lv = Array.isArray(bs.level) ? bs.level[i] : bs.level; amps.push(Math.max(0, lvl('bass', arc[b]) * lv)); }
            V.bassRun(t0 + 0.005, bs.bars, bs.midi, amps, { layer: bs.layer, tail: bar + bs.bars >= S.bars ? 0.7 : 0.4, ...bassOpts, ...(bs.o || {}) });
          }

          // Events.
          for (const e of S.ev[bar]) {
            const k = e.k, layer = e.o?.layer ?? lo(k);
            if (!audible(layer) || (solo && !solo.includes(k))) continue;
            const j = (JIT[k] || 0) * rng();
            const t = t0 + e.b * BEAT + j;
            const dur = e.d * BEAT * 0.97;
            const amp = lvl(k, a) * e.v * vari();
            const o = e.o || {};
            switch (k) {
              case 'horn': V.horn(t, dur, e.m, amp, { beat: BEAT, bright: 0.25 + 0.6 * a, attack: 0.2, ...hornOpts, ...o, layer }); break;
              case 'str': V.strings(t, dur, e.m, amp, { beat: BEAT, attack: 0.11, ...o, layer }); break;
              case 'tstr': V.strings(t, dur, e.m, amp, { beat: BEAT, attack: 0.16, trem: 0.75, ...o, layer }); break;
              case 'brass': V.brass(t, dur, e.m, amp, { bright: 0.35 + 0.5 * a, ...o, layer }); break;
              case 'wind': V.wind(t, dur, e.m, amp, { bright: 0.3 + 0.4 * a, ...o, layer }); break;
              case 'ost': V.ostinato(t, e.m, amp, 0.2 + 0.7 * a, { hold: o.hold || 0, dec: o.dec || 0.05, layer }); break;
              case 'spic': V.spiccato(t, e.m, amp, o.pan ?? 0.3, layer); break;
              case 'pluck': V.pluck(t, e.m, amp, o.pan ?? (rng() - 0.5) * 0.9, { decay: o.decay ?? 0.34, layer }); break;
              case 'timp': V.timpani(t, e.m, amp * (o.gain ?? 1), o.decay ?? (0.6 + 0.6 * e.v), layer); break;
              case 'roll': {
                const n = Math.max(2, Math.round((e.d * BEAT) / 0.085));
                for (let i = 0; i < n; i++) { const kk = i / (n - 1); const vel = o.v0 * Math.pow(o.v1 / o.v0, kk); V.timpani(t + i * 0.085 + rng() * 0.008, e.m, lvl('timp', a) * vel * 0.8 * vari(), 0.35, layer); }
                break;
              }
              case 'riser': V.riser(t0, e.d * BEAT, lvl('riser', a) * e.v, 0.31 + bar * 0.013, layer); break;
              case 'crash': V.crash(t0 + e.b * BEAT + 0.004, lvl('crash', a) * e.v, 0.71 + bar * 0.007, layer); break;
              case 'tam': V.tam(t0 + e.b * BEAT + 0.004, lvl('tam', a) * e.v, o.midi ?? 38, layer, o.len ?? 6); break;
              default: throw new Error('unknown event kind ' + k);
            }
          }
        },
        dispose() { V.dispose(); },
      };
    },
  };
  return module;
}
