// Builder for the melodic techno level tracks (title, foundry, cinder, thalassa, boss). A track is a config object: the builder
// owns the bar loop so all of them share the same arrangement rules.
//
//   kick: a restrained, long pulse (sidechain on bass, pad and pluck)
//   bass: root and fifth, plucked offbeat or rolling 1/16, low passed, the cutoff follows the energy arc
//   arp:  plucked arpeggio, the main voice; hypnotic pattern, a small fill every 4 bars, another pattern every 8 bars
//   motif: a sparse 2 to 4 note phrase on the bell voice
//   pad:  slow detuned saws under a low pass, chord per two bars, LFO on LFO drift
//   reverb send of the plucks: low in the grooves, rising through the break, cut on the drop
//   break: the last half bar of a break is real silence (drums, plucks and the reverb return are muted)
// Intensity layers (skipped when cfg.fixed): oh .15, arp .2, shaker .3, tick .35, clap .4, rim .45, motif .55, tom .6.
import { createRig } from './rig.js';
import { mulberry32, smooth, lerp, makeIntensity, makeSections, makeCurve, ladderPick } from './util.js';
import { grooveBar } from './groove.js';
import { selectedVariant, applyVariant } from './variants.js';

/** 'Am F C G' -> ['Am','Am','F','F',...] with `per` bars for each chord. */
export const expand = (str, per = 2) => str.split(/\s+/).flatMap((n) => Array(per).fill(n));

const THR = { kick: -1, hat: -1, pad: -1, bass: -1, drone: -1, oh: 0.15, arp: 0.2, shaker: 0.3, tick: 0.35, clap: 0.4, rim: 0.45, motif: 0.55, tom: 0.6 };

export function makeMelodic(base) {
  const impls = {};
  const build = (name) => (impls[name] ||= buildTrack(applyVariant(base, name)));
  const first = build('melodic');
  return {
    meta: first.meta, SCORE: first.SCORE, SEC: first.SEC,
    create: (ac, out) => build(selectedVariant()).create(ac, out),
    variant: (name) => build(name),
  };
}

function buildTrack(cfg) {
  const { bpm, bars = 32 } = cfg;
  const BEAT = 60 / bpm, BAR = BEAT * 4, SD = BEAT / 4;
  const SEC = makeSections(cfg.sections);
  if (SEC.total !== bars) throw new Error(`${cfg.id}: sections add up to ${SEC.total}, not ${bars}`);
  if (cfg.progression.length !== bars) throw new Error(`${cfg.id}: progression has ${cfg.progression.length} bars`);
  const ARC = makeCurve(cfg.arc, bars);
  const LP = makeCurve(cfg.lp, bars);
  const thr = { ...THR, ...cfg.thr };
  const chordAt = (bar) => cfg.chords[cfg.progression[((bar % bars) + bars) % bars]];
  const meta = { id: cfg.id, name: cfg.name, description: cfg.description, bpm, bars };

  function create(ac, out) {
    const rig = createRig(ac, out, { bpm, ...cfg.rig });
    const inten = makeIntensity(ac, 0.6);
    const arpOpts = cfg.arp.voice || {};
    const revBase = cfg.arp.rev ?? 0.12;

    return {
      setIntensity: cfg.fixed ? undefined : (x) => inten.set(x),
      scheduleBar(t0, bar, loop) {
        const rnd = mulberry32(cfg.seed * 7919 + bar * 104729 + loop * 1299709);
        const sec = SEC.at(bar), ch = chordAt(bar);
        const e = cfg.fixed ? 1 : inten.get();
        const en = ARC(bar + 0.5) * (1 - (cfg.eCouple ?? 0) * (1 - e));   // 0..1 energy arc: the cutoffs follow it (and, in some variants, the intensity)
        const G = (l) => (sec.on(l) ? (cfg.fixed ? 1 : smooth(e, thr[l] ?? -1, 0.1)) : 0);
        const quiet = sec.name === 'break' && sec.last;   // last half bar of a break: real silence
        const cut = quiet ? 8 : 16;
        rig.sweep(t0, t0 + BAR, LP(bar), LP(bar + 0.999));

        // reverb send of the plucks and the bell: low in the grooves, rising through a break, cut on the drop
        const arpV = rig.arp(arpOpts, cfg.arp.sends || { rev: revBase, del: 0.4 });
        const bellV = cfg.motif ? rig.lead(cfg.motif.voice || {}, cfg.motif.sends || { rev: 0.45, del: 0.4 }) : null;
        const target = sec.name === 'break' ? lerp(0.16, 0.6, (sec.i + 1) / sec.n) : revBase;
        const tc = sec.name === 'break' ? 0.7 : 0.03;
        if (arpV.rev) arpV.rev.gain.setTargetAtTime(target, t0, tc);
        if (bellV && bellV.rev) bellV.rev.gain.setTargetAtTime(Math.min(0.75, target * 2.6), t0, tc);

        // drums
        const d = (cfg.drums && cfg.drums(sec, bar, e, en)) || {};
        grooveBar(rig, t0, { kick: G('kick'), hat: G('hat'), oh: G('oh'), shaker: G('shaker'), clap: G('clap'), perc: Math.max(G('tick'), G('rim'), G('tom')) }, {
          beat: BEAT, sd: SD, rnd, cut, kick: cfg.kick, duck: cfg.duck,
          kickPat: 'X...X...X...X...', hatPat: '.o.o.o.o.o.o.o.o', ohPat: '..x...x...x...x.', shakerPat: 'o-o-o-o-o-o-o-o-',
          clapPat: '....x.......x...', clap: { f: 1250, vol: 1.1, tail: 0.3, rev: 0.6 },
          ...cfg.drumStyle, ...d,
          perc: cfg.perc ? (t, v, s) => cfg.perc(rig, t, v, s, bar, { G, rnd, sec, ch, en }) : null,
        });

        // bass: root and fifth, plucked, the filter opens with the energy arc
        if (G('bass') > 0.05 && sec.on('bass')) {
          const bs = rig.bass(cfg.bass.voice || {});
          const pat = cfg.bass.pat(sec, bar, e);
          const cutB = cfg.bass.cut[0] * Math.pow(cfg.bass.cut[1] / cfg.bass.cut[0], en);
          for (let s = 0; s < cut; s++) {
            const c = pat[s];
            if (!c || c === '.') continue;
            const semi = c === 'f' ? 7 : c === 'o' ? 12 : c === 'g' ? 10 : 0;
            bs.note(t0 + s * SD, ch.bass + semi, SD * (cfg.bass.len ?? 0.7), {
              vol: cfg.bass.vol ?? 0.15, vel: s % 4 === 2 ? 1 : 0.8, cut: cutB, env: cfg.bass.env ?? 2.2, dec: 0.1, q: cfg.bass.q ?? 1.6, rel: 0.05,
            });
          }
        }

        // pluck arpeggio (main voice)
        const ga = G('arp');
        if (ga > 0.05) {
          const pats = cfg.arp.patterns;
          let pat = pats[(bar >> 3) % pats.length];
          const fill = bar % 4 === 3;
          const cutA = cfg.arp.cut[0] * Math.pow(cfg.arp.cut[1] / cfg.arp.cut[0], en);
          for (const [s, idx0] of pat) {
            if (s >= cut) continue;
            const idx = fill && s >= 8 && typeof idx0 === 'number' ? idx0 + 1 : idx0;
            const m = idx === 'b2' ? ch.bass + 25 : idx === 'f5' ? ch.bass + 31 : ladderPick(ch.pad, idx) + (cfg.arp.oct ?? 12);
            arpV.note(t0 + s * SD, m, SD * (cfg.arp.len ?? 0.8), {
              vol: (cfg.arp.vol ?? 0.07) * ga, vel: s % 4 === 0 ? 1 : s % 2 ? 0.6 : 0.8, cut: cutA, env: cfg.arp.env ?? 2.3, dec: cfg.arp.dec ?? 0.15, q: cfg.arp.q ?? 2.2, rel: 0.04,
            });
          }
        }

        // pad (chord per two bars), slow attack, detuned saws under a low pass
        if (sec.on('pad') && (bar % 2 === 0 || cfg.progression[bar] !== cfg.progression[bar - 1] || sec.first)) {
          let len = 1;
          while (len < 4 && cfg.progression[(bar + len) % bars] === cfg.progression[bar] && sec.i + len < sec.n) len++;
          const endsQuiet = sec.name === 'break' && sec.i + len === sec.n;   // this chord runs into the silent half bar
          const dur = (endsQuiet ? len - 0.5 : len) * BAR;
          const padCut = cfg.pad.cut[0] * Math.pow(cfg.pad.cut[1] / cfg.pad.cut[0], en);
          const notes = cfg.pad.notes ? cfg.pad.notes(ch) : [...ch.pad, ch.pad[2] + 12];
          if (cfg.pad.layers > 1) {
            // a second, slower and higher layer: triangles and saws an octave up, opening later
            rig.chord(t0 + 0.35, notes.map((n) => n + 12), Math.max(0.5, dur - 0.35), {
              vol: (cfg.pad.vol ?? 0.05) * 0.6, cut: padCut * 1.35, env: 1, lpEnd: 1.5, dec: dur, atk: (cfg.pad.atk ?? 1.4) * 1.6, rel: endsQuiet ? 0.2 : 1.8,
              group: 'pad', rev: Math.min(0.85, (cfg.pad.rev ?? 0.5) * 1.3), det: 9, q: 0.7, lfo: true, types: ['triangle', 'sawtooth'],
            });
          }
          rig.chord(t0, notes, dur, {
            vol: cfg.pad.vol ?? 0.05, cut: padCut, env: 1, lpEnd: 1.25, dec: dur, atk: cfg.pad.atk ?? 1.4, rel: endsQuiet ? 0.2 : 1.2,
            group: 'pad', rev: cfg.pad.rev ?? 0.5, det: 13, q: 0.8, lfo: true,
          });
        }
        // drone under everything (foundry, boss)
        if (cfg.drone && sec.on('drone') && (bar % 4 === 0 || sec.first)) {
          const len = Math.min(4, sec.n - sec.i);
          const endsQ = sec.name === 'break' && sec.i + len === sec.n;
          rig.chord(t0, [ch.bass + 12, ch.bass + 19], (endsQ ? len - 0.5 : len) * BAR, { vol: cfg.drone.vol ?? 0.05, cut: cfg.drone.cut ?? 300, env: 1, atk: 2, rel: endsQ ? 0.2 : 1.5, dec: len * BAR, group: 'drone', rev: 0.3, det: 9, lfo: true, types: ['sawtooth', 'triangle'] });
        }

        // sparse bell motif
        if (cfg.motif && G('motif') > 0.05 && sec.on('motif')) {
          const phrase = cfg.motif.notes(ch, bar, sec) || [];
          for (const [s, m, len] of phrase) {
            if (s >= cut) continue;
            bellV.note(t0 + s * SD, m, len * SD, { vol: (cfg.motif.vol ?? 0.08) * G('motif'), cut: 2400, env: 1.2, dec: 0.3, atk: 0.004, rel: cfg.motif.rel ?? 0.9, q: 0.7 });
          }
        }

        // a subtle filtered noise swell into the drop, low and dark, plus a soft low tom on the first beat of a section
        if (sec.on('swell') && sec.i >= sec.n - 2) rig.riser(t0, BAR, { f0: 250, f1: 2400, vol: 0.022, q: 1.2 });
        if (sec.fx && sec.first && cfg.impact) rig.boom(t0, cfg.impact, { f0: 70, f1: 30, len: 2.4, vol: 0.32 });
        if (quiet) rig.hush(t0 + 8 * SD, 8 * SD);
        if (cfg.extra) cfg.extra(rig, t0, bar, { sec, ch, G, rnd, en, cut, SD, BEAT, BAR });
      },
      dispose() { rig.dispose(); },
    };
  }

  const arpAt = (bar) => {
    const ch = chordAt(bar), pat = cfg.arp.patterns[(bar >> 3) % cfg.arp.patterns.length], fill = bar % 4 === 3;
    return pat.map(([s, i0]) => { const i = fill && s >= 8 && typeof i0 === 'number' ? i0 + 1 : i0; return [s, i === 'b2' ? ch.bass + 25 : ladderPick(ch.pad, i) + (cfg.arp.oct ?? 12)]; });
  };
  const score = { arpAt, motif: (bar) => (cfg.motif ? cfg.motif.notes(chordAt(bar), bar, SEC.at(bar)) || [] : []), arp: cfg.arp.patterns, bars };
  return { meta, create, SCORE: score, SEC };
}
