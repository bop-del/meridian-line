// Sound analysis used by tools/sfxanalyze.mjs (Node) and by the sound lab page (browser). Pure functions, no dependencies.
// analyze(L, R, sr) takes two sample arrays and returns duration, peak, RMS, attack and decay times, spectral centroid over time,
// band energies (sub 30-120, low 120-500, mid 500-2k, high 2k-8k, air above), pitch track, zero crossing noisiness and stereo width.
const SR = 44100;

// ---------- FFT ----------
function fft(re, im) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) { let t = re[i]; re[i] = re[j]; re[j] = t; t = im[i]; im[i] = im[j]; im[j] = t; }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = -2 * Math.PI / len, wr = Math.cos(ang), wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const a = i + k, b = i + k + len / 2;
        const tr = re[b] * cr - im[b] * ci, ti = re[b] * ci + im[b] * cr;
        re[b] = re[a] - tr; im[b] = im[a] - ti; re[a] += tr; im[a] += ti;
        const ncr = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = ncr;
      }
    }
  }
}
const hann = (n) => { const w = new Float64Array(n); for (let i = 0; i < n; i++) w[i] = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / n); return w; };
const W = {}; const win = (n) => (W[n] ||= hann(n));

/** Power spectrum of x[start .. start+n) zero padded to nfft. Returns Float64Array of nfft/2 bins. */
export function powerSpec(x, start, n, nfft) {
  const re = new Float64Array(nfft), im = new Float64Array(nfft), w = win(n);
  for (let i = 0; i < n; i++) { const v = x[start + i]; re[i] = (v === undefined ? 0 : v) * w[i]; }
  fft(re, im);
  const p = new Float64Array(nfft / 2);
  for (let k = 0; k < p.length; k++) p[k] = re[k] * re[k] + im[k] * im[k];
  return p;
}

export const db = (x) => 20 * Math.log10(Math.max(x, 1e-9));
/** Squared A-weighting gain (IEC 61672 curve) at f Hz. */
const aw2 = (f) => { const f2 = f * f, n = 12194 ** 2 * f2 * f2, d = (f2 + 20.6 ** 2) * Math.sqrt((f2 + 107.7 ** 2) * (f2 + 737.9 ** 2)) * (f2 + 12194 ** 2); const g = n / d; return g * g * 1.2589 ** 2; };
export const BANDS = [['sub', 30, 120], ['low', 120, 500], ['mid', 500, 2000], ['high', 2000, 8000], ['air', 8000, 22050]];

// ---------- analysis ----------
/** L, R: Float32Array or number arrays at sample rate sr. Returns a flat metrics object. */
export function analyze(L, R, sr = SR) {
  const n = L.length, m = new Float64Array(n), s = new Float64Array(n);
  let peak = 0, nan = 0;
  for (let i = 0; i < n; i++) {
    const a = L[i], b = R[i];
    if (!Number.isFinite(a) || !Number.isFinite(b)) { nan++; continue; }
    m[i] = (a + b) / 2; s[i] = (a - b) / 2;
    peak = Math.max(peak, Math.abs(a), Math.abs(b));
  }
  const out = { nan, peak, peakDb: db(peak), fileDur: n / sr };
  if (peak < 1e-6) return { ...out, silent: true };
  // 1 ms peak envelope
  const hop = Math.round(sr / 1000), ne = Math.ceil(n / hop), env = new Float64Array(ne);
  for (let e = 0; e < ne; e++) { let mx = 0; for (let i = e * hop; i < Math.min(n, (e + 1) * hop); i++) mx = Math.max(mx, Math.abs(L[i]), Math.abs(R[i])); env[e] = mx; }
  const thr = (d) => peak * Math.pow(10, d / 20);
  const first = (t) => { for (let e = 0; e < ne; e++) if (env[e] >= t) return e; return 0; };
  const last = (t) => { for (let e = ne - 1; e >= 0; e--) if (env[e] >= t) return e; return 0; };
  const onset = first(thr(-40)), pk = env.indexOf(Math.max(...env));
  const e10 = first(thr(-20)), e90 = first(thr(-0.9));
  out.onsetMs = onset;
  out.attackMs = Math.max(0, e90 - e10);                       // 10 percent to 90 percent of the peak
  out.timeToPeakMs = Math.max(0, pk - onset);
  out.dur40Ms = last(thr(-40)) - onset;                        // onset to the last time above -40 dB
  out.dur20Ms = last(thr(-20)) - onset;
  out.decay20Ms = Math.max(0, last(thr(-20)) - pk);            // peak to the last time above -20 dB
  const a0 = Math.round(onset * hop), a1 = Math.min(n, Math.round((last(thr(-40)) + 1) * hop));
  let q = 0; for (let i = a0; i < a1; i++) q += L[i] * L[i] + R[i] * R[i];
  out.rms = Math.sqrt(q / Math.max(1, 2 * (a1 - a0))); out.rmsDb = db(out.rms); out.crestDb = out.peakDb - out.rmsDb;
  // spectral centroid track: 512 sample windows starting at onset + t
  const cent = (start, N = 512) => {
    const p = powerSpec(m, Math.max(0, start), N, 2048); let num = 0, den = 0;
    for (let k = 1; k < p.length; k++) { const f = k * sr / 2048; num += Math.sqrt(p[k]) * f; den += Math.sqrt(p[k]); }
    return den > 1e-12 ? num / den : 0;
  };
  out.cent = {}; for (const t of [0, 10, 25, 50, 100]) out.cent[t] = a0 + t * hop < a1 ? cent(a0 + t * hop - 128) : 0;
  // averaged spectrum over the active region (Welch 2048), band shares, energy weighted centroid
  const bandE = BANDS.map(() => 0); let tot = 0, wc = 0, wsum = 0, aTot = 0;
  for (let st = a0; st + 1024 < Math.max(a1, a0 + 1025); st += 512) {
    const p = powerSpec(m, st, 2048, 2048); let fe = 0, fn = 0;
    for (let k = 1; k < p.length; k++) {
      const f = k * sr / 2048; fe += p[k]; fn += Math.sqrt(p[k]) * f; aTot += p[k] * aw2(f);
      for (let b = 0; b < BANDS.length; b++) if (f >= BANDS[b][1] && f < BANDS[b][2]) { bandE[b] += p[k]; break; }
    }
    tot += fe; if (fe > 0) { wc += fn / Math.sqrt(fe) / Math.sqrt(1); wsum += 1; }
  }
  out.aExpDb = 10 * Math.log10(Math.max(aTot, 1e-20) / 2048 / 2048 * 4);   // A-weighted energy summed over the shot, a relative loudness figure for shots of different length
  out.bands = {}; BANDS.forEach(([nm], b) => { out.bands[nm] = tot > 0 ? 100 * bandE[b] / tot : 0; });
  out.bandsDb = {}; BANDS.forEach(([nm], b) => { out.bandsDb[nm] = 10 * Math.log10(Math.max(bandE[b] / Math.max(tot, 1e-30), 1e-9)); });
  // overall centroid: mean of the frame centroids weighted by frame energy
  { let num = 0, den = 0;
    for (let st = a0; st + 512 < Math.max(a1, a0 + 513); st += 256) {
      const p = powerSpec(m, st, 512, 2048); let fe = 0, fn = 0;
      for (let k = 1; k < p.length; k++) { const f = k * sr / 2048; fe += p[k]; fn += p[k] * f; }
      num += fn; den += fe;
    }
    out.centroid = den > 0 ? num / den : 0; }
  // attack window: band shares of the first ~23 ms (this is what reads as crisp, punchy or dull; the whole shot is dominated by the body)
  { const p = powerSpec(m, a0, 1024, 2048); let all = 0, lo = 0, mi = 0, hi = 0;
    for (let k = 1; k < p.length; k++) { const f = k * sr / 2048; all += p[k]; if (f < 500) lo += p[k]; else if (f < 2000) mi += p[k]; else hi += p[k]; }
    out.atk = all > 0 ? { lo: 100 * lo / all, mid: 100 * mi / all, hi: 100 * hi / all } : { lo: 0, mid: 0, hi: 0 }; }
  // punch: share of energy below 500 Hz in the first 60 ms after onset
  { const p = powerSpec(m, a0, Math.min(2048, Math.round(0.06 * sr)), 4096); let lo = 0, all = 0;
    for (let k = 1; k < p.length; k++) { const f = k * sr / 4096; all += p[k]; if (f < 500) lo += p[k]; }
    out.punchLowPct = all > 0 ? 100 * lo / all : 0; }
  // pitch track: dominant spectral peak 60..6000 Hz, frames 1024 hop 256, frames above -30 dB of the loudest frame
  { const N = 1024, HOP = 256, NF = 8192, fr = [];
    let maxE = 0;
    for (let st = a0; st < a1; st += HOP) { let e = 0; for (let i = st; i < Math.min(n, st + N); i++) e += m[i] * m[i]; fr.push({ st, e }); maxE = Math.max(maxE, e); }
    const track = [];
    for (const f of fr) {
      if (f.e < maxE * 1e-3) continue;
      const p = powerSpec(m, f.st, N, NF); let bi = 0, bv = 0;
      for (let k = Math.ceil(60 * NF / sr); k < Math.floor(6000 * NF / sr); k++) if (p[k] > bv) { bv = p[k]; bi = k; }
      if (bi < 2) continue;
      const y0 = Math.log(Math.max(p[bi - 1], 1e-30)), y1 = Math.log(Math.max(p[bi], 1e-30)), y2 = Math.log(Math.max(p[bi + 1], 1e-30));
      const d = (y0 - 2 * y1 + y2) !== 0 ? 0.5 * (y0 - y2) / (y0 - 2 * y1 + y2) : 0;
      track.push({ t: (f.st + N / 2 - a0) / sr, f: (bi + d) * sr / NF });
    }
    if (track.length >= 2) {
      const med = (a) => a.slice().sort((x, y) => x - y)[Math.floor(a.length / 2)];
      const p0 = med(track.slice(0, 3).map((x) => x.f)), p1 = med(track.slice(-3).map((x) => x.f));
      const dt = track[track.length - 1].t - track[0].t;
      out.pitch0 = p0; out.pitch1 = p1; out.sweepOct = dt > 0.01 ? Math.log2(p1 / p0) / dt : 0;
      out.pitchTrack = track.filter((_, i) => i % Math.max(1, Math.floor(track.length / 6)) === 0).map((x) => `${(x.t * 1000).toFixed(0)}ms:${x.f.toFixed(0)}`);
    } else { out.pitch0 = track[0]?.f ?? 0; out.pitch1 = out.pitch0; out.sweepOct = 0; out.pitchTrack = []; }
  }
  // ridge sweep: how fast the whole spectrum slides along the log-frequency axis (works for any harmonic stack). Frames of 1024 samples,
  // 400 Hz to 12 kHz in 1/32 octave bins, the shift between neighbouring frames comes from the peak of their cross-correlation.
  { const N = 1024, HOP = 256, NF = 4096, B = 32, J = Math.floor(Math.log2(12000 / 400) * B), S = 12, frames = [];
    for (let st = a0; st + N < Math.min(n, a1 + N); st += HOP) {
      let e = 0; for (let i = st; i < st + N; i++) e += m[i] * m[i];
      const p = powerSpec(m, st, N, NF), v = new Float64Array(J);
      let mx = 0;
      for (let j = 0; j < J; j++) { const pos = 400 * Math.pow(2, j / B) * NF / sr, k = Math.floor(pos), fr = pos - k; v[j] = 10 * Math.log10(Math.max(p[k] * (1 - fr) + p[k + 1] * fr, 1e-20)); mx = Math.max(mx, v[j]); }
      let mean = 0; for (let j = 0; j < J; j++) { v[j] = Math.max(v[j] - (mx - 40), 0); mean += v[j]; } mean /= J;
      for (let j = 0; j < J; j++) v[j] -= mean;
      frames.push({ e, v });
    }
    const maxE = Math.max(...frames.map((f) => f.e), 1e-20), shifts = [];
    for (let i = 0; i + 1 < frames.length; i++) {
      if (frames[i].e < maxE * 1e-3 || frames[i + 1].e < maxE * 1e-3) continue;
      const a = frames[i].v, b = frames[i + 1].v; let best = -1e30, bs = 0, c0 = 0, cs = [];
      for (let sh = -S; sh <= S; sh++) { let c = 0; for (let j = Math.max(0, -sh); j < Math.min(J, J - sh); j++) c += a[j] * b[j + sh]; cs.push(c); if (c > best) { best = c; bs = sh; } }
      let refined = bs; const ix = bs + S;
      if (ix > 0 && ix < cs.length - 1) { const d = cs[ix - 1] - 2 * cs[ix] + cs[ix + 1]; if (d < 0) refined = bs + 0.5 * (cs[ix - 1] - cs[ix + 1]) / d; }
      shifts.push({ t: (i * HOP) / sr, oct: refined / B });
    }
    if (shifts.length) {
      const hopS = HOP / sr, rates = shifts.map((x) => x.oct / hopS).sort((x, y) => x - y);
      out.ridgeTotalOct = shifts.reduce((x, y) => x + y.oct, 0);
      out.ridgeSpanMs = (shifts[shifts.length - 1].t - shifts[0].t + hopS) * 1000;
      out.ridgeRate = out.ridgeTotalOct / (shifts.length * hopS);
      const third = Math.max(1, Math.floor(shifts.length / 3));
      out.ridgeRateEarly = shifts.slice(0, third).reduce((x, y) => x + y.oct, 0) / (third * hopS);
      out.ridgeRateLate = shifts.slice(-third).reduce((x, y) => x + y.oct, 0) / (third * hopS);
      void rates;
    } else { out.ridgeTotalOct = 0; out.ridgeSpanMs = 0; out.ridgeRate = 0; out.ridgeRateEarly = 0; out.ridgeRateLate = 0; }
  }
  // zero crossings of the mid signal over the active region
  { let zc = 0; for (let i = a0 + 1; i < a1; i++) if ((m[i - 1] < 0) !== (m[i] < 0)) zc++;
    out.zcrHz = zc / 2 / Math.max(1e-6, (a1 - a0) / sr); out.zcrOverCentroid = out.centroid > 0 ? out.zcrHz / out.centroid : 0; }
  // stereo: side to mid level, and L/R correlation
  { let em = 0, es = 0, ll = 0, rr = 0, lr = 0;
    for (let i = a0; i < a1; i++) { em += m[i] * m[i]; es += s[i] * s[i]; ll += L[i] * L[i]; rr += R[i] * R[i]; lr += L[i] * R[i]; }
    out.sideMidDb = 10 * Math.log10(Math.max(es, 1e-20) / Math.max(em, 1e-20)); out.corr = ll > 0 && rr > 0 ? lr / Math.sqrt(ll * rr) : 1; }
  return out;
}

