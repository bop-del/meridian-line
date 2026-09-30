// Sound effect analysis: measures wav/mp3 reference files and renders our own weapon recipes offline, then prints a side by side table.
// Pure Node (own FFT in src/audio/sfx2/analyze.js, shared with the sound lab page, no numpy). ffmpeg is used only to decode files; recipes are rendered by OfflineAudioContext in headless Chrome
// against a running dev server (the same recipe code and the same gain/compressor/limiter chain as the game).
//
// Usage:
//   node tools/sfxanalyze.mjs file <a.wav|a.mp3> [more files] [--json]
//   node tools/sfxanalyze.mjs frames <file> [--ms=20] [--n=30]     level, centroid, dominant frequency and bands per frame
//   node tools/sfxanalyze.mjs render [--brief] [--port=5173] [--names=laser,laser2,laser3,enemyShot] [--sets=new,prev,legacy]
//                                    [--ref=<file-or-dir>[,..]] [--wav=<outDir>] [--json] [--shots=12] [--budget=0.5] [--burst=enemyLaser,turretLaser]
//     render: renders each name from each set (new = WEAPON_SFX, prev = WEAPON_SFX_PREV (the recipes before the redesign),
//             legacy = LEGACY_WEAPONS (v1)), analyses them and any --ref files, prints the table, per name variation over --shots
//             random shots, a rapid fire train check and the node count per shot. --wav writes the rendered single shots and trains.
// Metrics per signal: duration, peak, RMS (active region), crest, attack and decay times, spectral centroid over time, band energies
//   (sub 30-120, low 120-500, mid 500-2k, high 2k-8k, air above 8k, in percent of energy), the low share of the first 60 ms (punch),
//   dominant pitch track (start, end, sweep in octaves per second), ridge fall (how far the whole harmonic stack slides down the log frequency axis,
//   in total octaves and as an early and late rate; this is the shape that makes a laser a laser), zero crossing noisiness and stereo width.
//   --burst=name,.. also runs 20 shots of that sound from 6 emitters in one second (thinned by the game's gap and voice limits) over the player's fire.
// Exit codes: 0 ok, 1 usage error or missing input, 2 a rendered signal contains NaN, or clips (peak above 0.95) in the render mode.
import { spawnSync } from 'node:child_process';
import { writeFileSync, mkdirSync, existsSync, statSync, readdirSync } from 'node:fs';
import { basename, extname, join } from 'node:path';
import { analyze, powerSpec, db, BANDS } from '../src/audio/sfx2/analyze.js';

const SR = 44100;

// ---------- decoding ----------
function decodeFile(path) {
  const r = spawnSync('ffmpeg', ['-v', 'error', '-i', path, '-f', 'f32le', '-ac', '2', '-ar', String(SR), '-'], { maxBuffer: 1 << 28 });
  if (r.status !== 0) throw new Error(`ffmpeg failed for ${path}: ${r.stderr}`);
  const buf = r.stdout, f = new Float32Array(buf.buffer, buf.byteOffset, Math.floor(buf.length / 4));
  const n = Math.floor(f.length / 2), L = new Float32Array(n), R = new Float32Array(n);
  for (let i = 0; i < n; i++) { L[i] = f[2 * i]; R[i] = f[2 * i + 1]; }
  return { L, R };
}

function writeWav(path, L, R) {
  const n = L.length, b = Buffer.alloc(44 + n * 4);
  b.write('RIFF', 0); b.writeUInt32LE(36 + n * 4, 4); b.write('WAVEfmt ', 8); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(2, 22);
  b.writeUInt32LE(SR, 24); b.writeUInt32LE(SR * 4, 28); b.writeUInt16LE(4, 32); b.writeUInt16LE(16, 34); b.write('data', 36); b.writeUInt32LE(n * 4, 40);
  let o = 44;
  for (let i = 0; i < n; i++) for (const ch of [L, R]) { const v = Math.max(-1, Math.min(1, Number.isFinite(ch[i]) ? ch[i] : 0)); b.writeInt16LE(Math.round(v < 0 ? v * 32768 : v * 32767), o); o += 2; }
  writeFileSync(path, b);
}

// ---------- table ----------
const ROWS = [
  ['dur (ms, -40dB)', (a) => a.dur40Ms, 0], ['peak', (a) => a.peak, 3], ['RMS dB', (a) => a.rmsDb, 1], ['crest dB', (a) => a.crestDb, 1], ['A-wtd energy dB', (a) => a.aExpDb, 1],
  ['attack 10-90 ms', (a) => a.attackMs, 0], ['to peak ms', (a) => a.timeToPeakMs, 0], ['decay -20dB ms', (a) => a.decay20Ms, 0],
  ['centroid Hz', (a) => a.centroid, 0], ['cent @0ms', (a) => a.cent?.[0], 0], ['cent @25ms', (a) => a.cent?.[25], 0], ['cent @100ms', (a) => a.cent?.[100], 0],
  ['sub 30-120 %', (a) => a.bands?.sub, 1], ['low 120-500 %', (a) => a.bands?.low, 1], ['mid 500-2k %', (a) => a.bands?.mid, 1],
  ['high 2-8k %', (a) => a.bands?.high, 1], ['air >8k %', (a) => a.bands?.air, 1], ['punch <500 60ms %', (a) => a.punchLowPct, 1],
  ['attack <500 %', (a) => a.atk?.lo, 1], ['attack 0.5-2k %', (a) => a.atk?.mid, 1], ['attack >2k %', (a) => a.atk?.hi, 1],
  ['pitch start Hz', (a) => a.pitch0, 0], ['pitch end Hz', (a) => a.pitch1, 0], ['sweep oct/s (peak)', (a) => a.sweepOct, 1], ['ridge fall oct', (a) => a.ridgeTotalOct, 2], ['ridge span ms', (a) => a.ridgeSpanMs, 0],
  ['ridge oct/s early', (a) => a.ridgeRateEarly, 1], ['ridge oct/s late', (a) => a.ridgeRateLate, 1],
  ['zcr/centroid', (a) => a.zcrOverCentroid, 2], ['side-mid dB', (a) => a.sideMidDb, 1], ['L/R corr', (a) => a.corr, 2],
];
function printTable(cols, title) {
  const per = 7, w = 11;
  for (let c0 = 0; c0 < cols.length; c0 += per) {
    const part = cols.slice(c0, c0 + per);
    if (title) console.log(`\n${title}`);
    console.log('metric'.padEnd(20) + part.map((c) => c.label.slice(0, w - 1).padStart(w)).join(''));
    for (const [nm, fn, d] of ROWS) {
      console.log(nm.padEnd(20) + part.map((c) => { const v = c.a.silent ? NaN : fn(c.a); return (Number.isFinite(v) ? v.toFixed(d) : '-').padStart(w); }).join(''));
    }
  }
}

// ---------- page side (runs in the browser) ----------
async function renderInPage(spec) {
  const { SFX_META } = await import('/src/audio/sfx.js');
  const reg = await import('/src/audio/sfx2/registry.js');
  const wp = await import('/src/audio/sfx2/weapons.js');
  const { SFX } = await import('/src/audio/sfx.js');
  const sets = { new: SFX, prev: wp.WEAPON_SFX_PREV || null, legacy: { ...reg.LEGACY_WEAPONS, enemyShot: null } };
  const SRr = 44100;
  const rng = (seed) => { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; };
  const b64 = (f32) => { const u = new Uint8Array(f32.buffer, f32.byteOffset, f32.byteLength); let s = ''; for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000)); return btoa(s); };
  const results = [];
  // Shots start at 0.3 s: the browser compressor attenuates anything in the first ~40 ms of a fresh context, the game's runs continuously.
  // count node creations while a recipe runs
  const counted = {};
  const proto = OfflineAudioContext.prototype, orig = {};
  for (const k of Object.getOwnPropertyNames(BaseAudioContext.prototype)) {
    if (k.startsWith('create') && k !== 'createBuffer') {
      orig[k] = BaseAudioContext.prototype[k];
      BaseAudioContext.prototype[k] = function (...a) { counted.n = (counted.n || 0) + 1; counted[k] = (counted[k] || 0) + 1; return orig[k].apply(this, a); };
    }
  }
  async function one(set, name, seed, pitch, vol) {
    const recipe = sets[set]?.[name]; if (!recipe) return null;
    const meta = SFX_META[name] || { gap: 0.04, max: 4, prio: 2 };
    const ac = new OfflineAudioContext(2, Math.ceil(SRr * 1.2), SRr), chain = reg.createSfxChain(ac, 0.8);
    for (const k in counted) delete counted[k];
    const t0 = performance.now();
    const dur = reg.playSfx(ac, chain, name, { t: 0.3, r: rng(seed), pitch, volume: vol, offline: true, recipe: set === 'new' ? undefined : recipe });
    const made = { ...counted };
    const buf = await ac.startRendering();
    return { L: buf.getChannelData(0).slice(), R: buf.getChannelData(1).slice(), dur, made, ms: performance.now() - t0, gain: meta.gain };
  }
  async function train(set, name, seed, n, interval, pitch) {
    const recipe = sets[set]?.[name]; if (!recipe) return null;
    const ac = new OfflineAudioContext(2, Math.ceil(SRr * (0.3 + n * interval + 0.6)), SRr), chain = reg.createSfxChain(ac, 0.8), r = rng(seed);
    const t0 = performance.now();
    for (let i = 0; i < n; i++) reg.playSfx(ac, chain, name, { t: 0.3 + i * interval, r, pitch: pitch * (1 + (r() * 2 - 1) * 0.04), offline: true, recipe: set === 'new' ? undefined : recipe });
    const buf = await ac.startRendering();
    return { L: buf.getChannelData(0).slice(), R: buf.getChannelData(1).slice(), ms: performance.now() - t0 };
  }
  // Burst test: `spec.burst` shots of one name from 6 emitters inside one second, thinned by the game's per name gap and voice limits
  // (audio.js sfx()), on top of the player's level 1 laser at 8 per second. Reports accepted shots, nodes created and the peak through the chain.
  const bursts = [];
  for (const name of spec.bursts) {
    const meta = SFX_META[name] || { gap: 0.04, max: 4 }, r = rng(7), sched = [];
    for (let i = 0; i < 20; i++) sched.push(0.3 + Math.floor(r() * 6) / 6 * 0.35 + r() * 0.6);
    sched.sort((a, b) => a - b);
    const ac = new OfflineAudioContext(2, Math.ceil(SRr * 2.6), SRr), chain = reg.createSfxChain(ac, 0.8);
    for (const k in counted) delete counted[k];
    let last = -9, live = [], ok = 0, drop = 0;
    for (const t of sched) {
      live = live.filter((e2) => e2 > t);
      if (t - last < meta.gap || live.length >= meta.max) { drop++; continue; }
      last = t; ok++;
      const d = reg.playSfx(ac, chain, name, { t, r, pitch: 1, volume: 1, offline: true });
      live.push(t + d + 0.3);
    }
    for (let i = 0; i < 8; i++) reg.playSfx(ac, chain, 'laser', { t: 0.3 + i / 8, r, offline: true });
    const nodes = counted.n || 0, buf = await ac.startRendering();
    let pk = 0; for (const ch of [buf.getChannelData(0), buf.getChannelData(1)]) for (let i = 0; i < ch.length; i++) pk = Math.max(pk, Math.abs(ch[i]));
    bursts.push({ name, ok, drop, nodes, peak: pk, maxLive: meta.max });
  }
  if (spec.bursts.length) results.push({ bursts });
  for (const name of spec.names) {
    for (const set of spec.sets) {
      if (!sets[set]?.[name]) continue;
      const shots = [];
      for (let i = 0; i < spec.shots; i++) { const r = await one(set, name, 1000 + i * 7919, 1, 1); shots.push({ b: [b64(r.L), b64(r.R)], made: r.made, ms: r.ms, gain: r.gain }); }
      const tr = await train(set, name, 42, spec.trainN, 1 / (spec.rates[name] || 6), 1);
      results.push({ name, set, shots, train: { b: [b64(tr.L), b64(tr.R)], ms: tr.ms, rate: spec.rates[name] || 6, n: spec.trainN } });
    }
  }
  for (const k in orig) BaseAudioContext.prototype[k] = orig[k];
  return results;
}

// ---------- main ----------
const argv = process.argv.slice(2);
const flag = (k, d) => { const a = argv.find((x) => x.startsWith(`--${k}=`)); return a ? a.slice(k.length + 3) : d; };
const has = (k) => argv.includes(`--${k}`);
const cmd = argv[0];
const f32 = (b64) => { const b = Buffer.from(b64, 'base64'); return new Float32Array(b.buffer, b.byteOffset, b.length / 4); };
const mean = (a) => a.reduce((x, y) => x + y, 0) / Math.max(1, a.length);
const sd = (a) => { const m = mean(a); return Math.sqrt(mean(a.map((x) => (x - m) ** 2))); };

function listRefs(spec) {
  const files = [];
  for (const p of (spec || '').split(',').filter(Boolean)) {
    if (!existsSync(p)) { console.error(`missing reference path ${p}`); process.exit(1); }
    if (statSync(p).isDirectory()) for (const f of readdirSync(p).sort()) { if (/\.(wav|mp3|ogg|flac)$/i.test(f)) files.push(join(p, f)); }
    else files.push(p);
  }
  return files;
}

if (cmd === 'frames') {
  // per 20 ms frames of one file: level, centroid, dominant frequency and band shares (to see how a sound evolves)
  const f = argv[1]; if (!f) { console.error('usage: sfxanalyze.mjs frames <file> [--ms=20] [--n=30]'); process.exit(1); }
  const { L, R } = decodeFile(f), step = Math.round(SR * Number(flag('ms', '20')) / 1000), N = Math.max(512, step);
  const m = new Float64Array(L.length); for (let i = 0; i < m.length; i++) m[i] = (L[i] + R[i]) / 2;
  let pk = 0; for (let i = 0; i < m.length; i++) pk = Math.max(pk, Math.abs(m[i]));
  let start = 0; for (let i = 0; i < m.length; i++) if (Math.abs(m[i]) > pk * 0.01) { start = i; break; }
  console.log('  t ms   dB   centroid  domHz   sub  low  mid high air');
  for (let k = 0; k < Number(flag('n', '30')); k++) {
    const st = start + k * step; if (st + 64 > m.length) break;
    const p = powerSpec(m, st, Math.min(N, m.length - st), 4096); let e = 0, fn = 0, bi = 0, bv = 0; const be = BANDS.map(() => 0);
    for (let j = 1; j < p.length; j++) { const fr = j * SR / 4096; e += p[j]; fn += p[j] * fr; if (fr > 40 && p[j] > bv) { bv = p[j]; bi = j; } BANDS.forEach((b, q) => { if (fr >= b[1] && fr < b[2]) be[q] += p[j]; }); }
    let q2 = 0; for (let i = st; i < Math.min(m.length, st + step); i++) q2 += m[i] * m[i];
    console.log(String(Math.round(k * step * 1000 / SR)).padStart(5), db(Math.sqrt(q2 / step) / pk).toFixed(0).padStart(5), (e > 0 ? fn / e : 0).toFixed(0).padStart(9), (bi * SR / 4096).toFixed(0).padStart(7), ...be.map((x) => (e > 0 ? (100 * x / e).toFixed(0) : '0').padStart(4)));
  }
} else if (cmd === 'file') {
  const files = argv.slice(1).filter((a) => !a.startsWith('--'));
  if (!files.length) { console.error('usage: sfxanalyze.mjs file <audio files> [--json]'); process.exit(1); }
  const cols = files.map((f) => { const { L, R } = decodeFile(f); return { label: basename(f, extname(f)), a: analyze(L, R) }; });
  if (has('json')) console.log(JSON.stringify(cols, null, 1)); else { printTable(cols); for (const c of cols) console.log(`${c.label} pitch track: ${(c.a.pitchTrack || []).join('  ')}`); }
} else if (cmd === 'render') {
  const port = flag('port', '5173'), names = flag('names', 'laser,laser2,laser3,enemyShot').split(',');
  const sets = flag('sets', 'new,prev,legacy').split(','), shots = Number(flag('shots', '12'));
  const rates = { laser: 8, laser2: 6.8, laser3: 5.6, enemyShot: 4, enemyLaser: 4, turretLaser: 1.6, bossCharge: 0.8, bossCannon: 0.6, bossBeam: 0.4, allyLaser: 6, allyBlip: 6 };
  const puppeteer = (await import('puppeteer-core')).default;
  const browser = await puppeteer.launch({
    executablePath: process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: 'new',
    args: ['--autoplay-policy=no-user-gesture-required'], protocolTimeout: 600000,
  });
  const page = await browser.newPage();
  let errs = 0;
  page.on('pageerror', (e) => { console.log('[pageerror]', e.message); errs++; });
  page.on('console', (m) => { if (m.type() === 'error') { console.log('[console.error]', m.text()); errs++; } });
  await page.goto(`http://localhost:${port}/sfx-lab.html`, { waitUntil: 'load' });
  const bursts = flag('burst', '').split(',').filter(Boolean);
  const results = await page.evaluate(renderInPage, { names, sets, shots, rates, trainN: 16, bursts });
  await browser.close();
  const outDir = flag('wav', ''); if (outDir) mkdirSync(outDir, { recursive: true });
  let bad = 0;
  const refs = listRefs(flag('ref', '')).map((f) => { const { L, R } = decodeFile(f); return { label: 'ref:' + basename(f, extname(f)).replace('sound-effects-library-', ''), a: analyze(L, R) }; });
  const json = [], briefRows = [];
  for (const b of results.filter((q) => q.bursts).flatMap((q) => q.bursts)) {
    console.log(`burst ${b.name}: 20 shots from 6 emitters in 1 s (plus the player's laser at 8/s): ${b.ok} played, ${b.drop} dropped by gap/max ${b.maxLive}, ${b.nodes} nodes created, peak ${b.peak.toFixed(3)}`);
  }
  for (const name of names) {
    const cols = [], varRows = [], nodeRows = [], trainRows = [];
    for (const set of sets) {
      const r = results.find((x) => x.name === name && x.set === set); if (!r) continue;
      const an = r.shots.map((s) => analyze(f32(s.b[0]), f32(s.b[1])));
      cols.push({ label: `${set}:${name}`, a: an[0] });
      const nn = mean(r.shots.map((s) => s.made.n || 0)), types = r.shots[0].made;
      const tl = f32(r.train.b[0]), trr = f32(r.train.b[1]), ta = analyze(tl, trr);
      const rmsOf = (x, y) => { let q = 0; for (let i = 0; i < x.length; i++) q += x[i] * x[i] + y[i] * y[i]; return Math.sqrt(q / (2 * x.length)); };
      const nonNaN = an.every((a) => a.nan === 0) && ta.nan === 0;
      if (!nonNaN) bad |= 2;
      const clip = Math.max(...an.map((a) => a.peak), ta.peak);
      if (clip > 0.95) bad |= 2;
      varRows.push({ set, peak: [mean(an.map((a) => a.peak)), sd(an.map((a) => a.peak)), Math.max(...an.map((a) => a.peak))], rms: [mean(an.map((a) => a.rmsDb)), sd(an.map((a) => a.rmsDb))],
        cent: [mean(an.map((a) => a.centroid)), sd(an.map((a) => a.centroid))], p0: [mean(an.map((a) => a.pitch0)), sd(an.map((a) => a.pitch0))], dur: mean(an.map((a) => a.dur40Ms)) });
      nodeRows.push({ set, nodes: nn, types, ms: mean(r.shots.map((s) => s.ms)) });
      trainRows.push({ set, rate: r.train.rate, peak: ta.peak, rmsDb: ta.rmsDb, nan: ta.nan, crest: ta.crestDb, ms: r.train.ms });
      if (outDir) {
        writeWav(join(outDir, `${set}_${name}.wav`), f32(r.shots[0].b[0]), f32(r.shots[0].b[1]));
        writeWav(join(outDir, `${set}_${name}_train.wav`), tl, trr);
      }
      json.push({ name, set, single: an[0], variation: varRows[varRows.length - 1], train: trainRows[trainRows.length - 1], nodes: nodeRows[nodeRows.length - 1] });
    }
    if (has('brief')) {
      cols.forEach((c, i) => { const a = c.a; briefRows.push([c.label, a.dur40Ms, a.peak.toFixed(2), a.rmsDb.toFixed(1), a.crestDb.toFixed(1), a.centroid.toFixed(0), a.bands.sub.toFixed(0), a.bands.low.toFixed(0), a.bands.mid.toFixed(0), (a.bands.high + a.bands.air).toFixed(0), a.atk.lo.toFixed(0), a.atk.mid.toFixed(0), a.atk.hi.toFixed(0), `${a.pitch0.toFixed(0)}>${a.pitch1.toFixed(0)}`, trainRows[i].peak.toFixed(2), varRows[i].cent[1].toFixed(0), nodeRows[i].nodes.toFixed(0), a.aExpDb.toFixed(1)]); });
    } else if (!has('json')) {
      printTable([...cols, ...refs], `=== ${name}: single shot through the game sfx chain (master 0.8) ===`);
      console.log(`\n${name}: variation over ${shots} random shots (mean, sd)`);
      console.log('set'.padEnd(9) + ['peak', 'peak max', 'RMS dB', 'centroid Hz', 'pitch0 Hz', 'dur ms'].map((s) => s.padStart(13)).join(''));
      for (const v of varRows) console.log(v.set.padEnd(9) + [`${v.peak[0].toFixed(3)}+-${v.peak[1].toFixed(3)}`, v.peak[2].toFixed(3), `${v.rms[0].toFixed(1)}+-${v.rms[1].toFixed(1)}`, `${v.cent[0].toFixed(0)}+-${v.cent[1].toFixed(0)}`, `${v.p0[0].toFixed(0)}+-${v.p0[1].toFixed(0)}`, v.dur.toFixed(0)].map((s) => s.padStart(13)).join(''));
      console.log(`${name}: rapid fire train of 16 at the game rate, and cost per shot`);
      console.log('set'.padEnd(9) + ['rate/s', 'train peak', 'train RMS dB', 'crest dB', 'nodes/shot', 'render ms/shot', 'NaN'].map((s) => s.padStart(15)).join(''));
      trainRows.forEach((t, i) => console.log(t.set.padEnd(9) + [t.rate, t.peak.toFixed(3), t.rmsDb.toFixed(1), t.crest.toFixed(1), nodeRows[i].nodes.toFixed(0), nodeRows[i].ms.toFixed(1), t.nan].map((s) => String(s).padStart(15)).join('')));
      const cls = nodeRows.find((x) => x.set === 'new'); if (cls) console.log(`  node kinds per shot (new): ${Object.entries(cls.types).filter(([k]) => k !== 'n').map(([k, v]) => `${k.replace('create', '')}:${v}`).join(' ')}`);
    }
  }
  if (briefRows.length) {
    console.log(['signal', 'ms', 'peak', 'rmsdB', 'crest', 'centr', 'sub%', 'low%', 'mid%', 'hi%', 'atk<500', 'atkmid', 'atk>2k', 'pitch', 'trnPk', 'sdCen', 'nodes', 'A-dB'].map((s, i) => (i ? s.padStart(7) : s.padEnd(16))).join(''));
    for (const r of briefRows) console.log(r.map((s, i) => (i ? String(s).padStart(7) : String(s).padEnd(16))).join(''));
    for (const r of refs) console.log(r.label.padEnd(16) + `centroid ${r.a.centroid.toFixed(0)} peak ${r.a.peak.toFixed(2)} sub ${r.a.bands.sub.toFixed(0)} low ${r.a.bands.low.toFixed(0)} mid ${r.a.bands.mid.toFixed(0)} hi ${(r.a.bands.high + r.a.bands.air).toFixed(0)}`);
  }
  const budget = Number(flag('budget', '0.5'));
  for (const j of json.filter((q) => q.set === 'new' && /^laser[23]?$/.test(q.name))) {
    const worst = Math.max(j.variation.peak[2], j.train.peak);
    console.log(`peak budget ${budget}: ${j.name} worst single ${j.variation.peak[2].toFixed(3)}, train ${j.train.peak.toFixed(3)} -> ${worst <= budget ? 'within budget' : 'OVER BUDGET'}`);
  }
  if (has('json')) console.log(JSON.stringify(json, null, 1));
  if (errs) bad |= 1;
  console.log(bad ? `\nFAIL flags=${bad} (1 page errors, 2 NaN or peak above 0.95)` : '\nOK: no NaN, no clipping above 0.95, no page errors');
  process.exit(bad ? (bad & 2 ? 2 : 1) : 0);
} else {
  console.error('usage: sfxanalyze.mjs file <files>  |  sfxanalyze.mjs render [--port=N] [--names=..] [--sets=new,prev,legacy] [--ref=path] [--wav=dir]');
  process.exit(1);
}
