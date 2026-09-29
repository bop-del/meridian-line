// Small deterministic score helpers for style A: piecewise-linear arcs and a leap-preferring arpeggio generator.
// Everything here runs once at module load and produces plain event lists, so scheduleBar stays a cheap lookup.

/** Piecewise-linear curve sampled per bar. pts: [[bar, value], ...] sorted by bar. */
export function arc(pts, bars) {
  const out = [];
  for (let b = 0; b < bars; b++) {
    let v = pts[pts.length - 1][1];
    if (b <= pts[0][0]) v = pts[0][1];
    else {
      for (let i = 1; i < pts.length; i++) {
        if (b <= pts[i][0]) {
          const [b0, v0] = pts[i - 1], [b1, v1] = pts[i];
          v = v0 + ((v1 - v0) * (b - b0)) / Math.max(1e-6, b1 - b0);
          break;
        }
      }
    }
    out.push(Math.round(v * 1000) / 1000);
  }
  return out;
}

/** Chord lookup from a pad list [[bar, len, notes]]: returns the notes sounding in a bar. */
export function chordAtFn(pads) {
  return (bar) => {
    let best = pads[0][2];
    for (const [b, len, notes] of pads) if (bar >= b && bar < b + len) return notes;
    for (const [b, , notes] of pads) if (b <= bar) best = notes;
    return best;
  };
}

/**
 * Sparse, leaping arpeggio events [bar, beat, midi, vel, minLevel] (no stepwise runs: consecutive pitches differ by
 * at least 3 semitones when possible). Later notes in a bar get a higher minLevel so density grows with the level.
 * o: { rng, from, to, poolAt(bar) -> midi[], count(bar) -> n, grid: beats, lo, hi, vel:[a,b], tiers: [minLevel per rank] }
 */
export function arpGen(o) {
  const ev = [];
  let prev = -1;
  for (let bar = o.from; bar < o.to; bar++) {
    const n = Math.min(o.grid.length, Math.max(0, o.count(bar)));
    if (!n) continue;
    const base = o.poolAt(bar);
    const pool = [];
    for (const m of base) for (const sh of [-12, 0, 12, 24]) { const x = m + sh; if (x >= o.lo && x <= o.hi && !pool.includes(x)) pool.push(x); }
    const slots = [...o.grid];
    const chosen = [];
    while (chosen.length < n && slots.length) chosen.push(slots.splice(Math.floor(o.rng() * slots.length), 1)[0]);
    chosen.sort((a, b) => a - b);
    // rank by how important a slot is: on-beat slots first
    const rank = [...chosen].sort((a, b) => (a % 1) - (b % 1) || a - b);
    for (const beat of chosen) {
      let cand = pool.filter((x) => prev < 0 || Math.abs(x - prev) >= 3);
      const good = cand.filter((x) => prev < 0 || (Math.abs(x - prev) >= 4 && Math.abs(x - prev) <= 12));
      if (good.length) cand = good;
      if (!cand.length) cand = pool;
      const m = cand[Math.floor(o.rng() * cand.length)];
      prev = m;
      const vel = o.vel[0] + (o.vel[1] - o.vel[0]) * o.rng();
      const min = (o.tiers || [0])[Math.min(rank.indexOf(beat), (o.tiers || [0]).length - 1)] ?? 0;
      ev.push([bar, beat, m, Math.round(vel * 100) / 100, min]);
    }
  }
  return ev;
}
