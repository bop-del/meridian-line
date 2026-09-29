// Low level WebAudio building blocks shared by sfx.js and music.js.
// Every helper takes an AudioContext (or OfflineAudioContext) and an output node, schedules its
// nodes at absolute time t and cleans itself up when finished.

const noiseCache = new WeakMap();

export function mtof(m) { return 440 * Math.pow(2, (m - 69) / 12); }

export function getNoise(ac) {
  let n = noiseCache.get(ac);
  if (n) return n;
  const len = Math.floor(ac.sampleRate * 2);
  const white = ac.createBuffer(1, len, ac.sampleRate);
  const brown = ac.createBuffer(1, len, ac.sampleRate);
  const w = white.getChannelData(0), b = brown.getChannelData(0);
  let last = 0;
  // deterministic LCG so offline renders are repeatable
  let seed = 12345;
  const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  for (let i = 0; i < len; i++) {
    const x = rnd() * 2 - 1;
    w[i] = x;
    last = (last + 0.02 * x) / 1.02;
    b[i] = last * 3.5;
  }
  n = { white, brown, shaper: null };
  noiseCache.set(ac, n);
  return n;
}

export function shaperCurve(k = 30) {
  const n = 1024, c = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = (i * 2) / n - 1;
    c[i] = ((3 + k) * x * 20 * (Math.PI / 180)) / (Math.PI + k * Math.abs(x));
  }
  return c;
}

const fin = (v, d) => (Number.isFinite(v) ? v : d);

/**
 * Oscillator voice with pitch sweep, envelope, optional filter and waveshaper.
 * o: {type, f0, f1, t, dur, vol, a, sweep, lp, lpEnd, hp, q, detune, shape, rel}
 */
export function tone(ac, out, o) {
  const t = fin(o.t, ac.currentTime);
  const dur = Math.max(0.02, fin(o.dur, 0.2));
  const vol = Math.max(0.0002, fin(o.vol, 0.2));
  const a = Math.min(fin(o.a, 0.003), dur * 0.9);
  const f0 = Math.max(1, fin(o.f0, 440));
  const f1 = Math.max(1, fin(o.f1, f0));
  const osc = ac.createOscillator();
  osc.type = o.type || 'sine';
  osc.frequency.setValueAtTime(f0, t);
  if (f1 !== f0) osc.frequency.exponentialRampToValueAtTime(f1, t + dur * (o.sweep ?? 1));
  if (o.detune) osc.detune.value = o.detune;
  const g = ac.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(vol, t + Math.max(a, 0.001));
  const hold = Math.min(dur * fin(o.hold, 0.25), dur - a - 0.005);
  if (hold > a + 0.004) g.gain.setValueAtTime(vol, t + hold);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  let node = osc;
  const chain = [osc, g];
  if (o.shape) {
    const ws = ac.createWaveShaper();
    ws.curve = shaperCurve(o.shape);
    node.connect(ws); node = ws; chain.push(ws);
  }
  if (o.hp) {
    const f = ac.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = o.hp;
    node.connect(f); node = f; chain.push(f);
  }
  if (o.lp) {
    const f = ac.createBiquadFilter(); f.type = 'lowpass'; f.Q.value = o.q ?? 0.7;
    f.frequency.setValueAtTime(o.lp, t);
    if (o.lpEnd) f.frequency.exponentialRampToValueAtTime(Math.max(20, o.lpEnd), t + dur);
    node.connect(f); node = f; chain.push(f);
  }
  node.connect(g);
  g.connect(out);
  osc.start(t);
  osc.stop(t + dur + 0.05);
  osc.onended = () => { for (const n of chain) { try { n.disconnect(); } catch (e) { /* already gone */ } } };
  return t + dur;
}

/**
 * Filtered noise burst. o: {t, dur, vol, type, f0, f1, fmid, tmid, q, buf, a}
 */
export function noise(ac, out, o) {
  const t = fin(o.t, ac.currentTime);
  const dur = Math.max(0.02, fin(o.dur, 0.2));
  const vol = Math.max(0.0002, fin(o.vol, 0.2));
  const a = Math.min(fin(o.a, 0.002), dur * 0.9);
  const src = ac.createBufferSource();
  const nb = getNoise(ac);
  src.buffer = o.buf === 'brown' ? nb.brown : nb.white;
  src.loop = true;
  const off = (o.offset ?? Math.random()) * 1.5;
  const f = ac.createBiquadFilter();
  f.type = o.type || 'lowpass';
  f.Q.value = o.q ?? 0.8;
  const f0 = Math.max(20, fin(o.f0, 1000));
  const f1 = Math.max(20, fin(o.f1, f0));
  f.frequency.setValueAtTime(f0, t);
  if (o.fmid) {
    f.frequency.exponentialRampToValueAtTime(Math.max(20, o.fmid), t + dur * (o.tmid ?? 0.4));
    f.frequency.exponentialRampToValueAtTime(f1, t + dur);
  } else if (f1 !== f0) f.frequency.exponentialRampToValueAtTime(f1, t + dur);
  const g = ac.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(vol, t + Math.max(a, 0.001));
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  src.connect(f); f.connect(g); g.connect(out);
  src.start(t, off);
  src.stop(t + dur + 0.05);
  src.onended = () => { try { src.disconnect(); f.disconnect(); g.disconnect(); } catch (e) { /* ignore */ } };
  return t + dur;
}
