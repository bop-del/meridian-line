// Look test: screenshots at the fixed rail check points of the chosen levels, a montage sheet, and frame cost per effect tier.
//
// Usage: node tools/looktest.mjs <port|url> [outDir] [options]     (needs a dev server, real GPU Chrome)
//   outDir            default /tmp/ml-looktest
//   --levels=0,1,2    levels to test (default all)
//   --points=1,3      indices 0..4 of the check points (default all five)
//                     check points (rail distance): L0 (Foundry) 300 1500 4200 5400 6800, L1 (Cinder Belt) 300 1900 3500 5200 6900, L2 (Thalassa) 300 2200 3400 5000 6400
//   --shots=0         skip screenshots and the montage (default 1)
//   --q=0             tier used for the screenshots (default 0)
//   --ms              measure frame cost per tier (all tiers 0..5), or --ms=0,3,5 for a list
//   --dprs=1,2        device pixel ratios for the cost run (default 1). Tier pr is min(dpr, tier.pr), so dpr 1 renders 1080p on tiers 0 to 3
//   --stress=3        weak GPU emulation: every tier renders 3x the pixels (pixel ratio x sqrt(3)), so its ms figure is roughly what a GPU
//                     three times slower needs at the normal size. Replaces --dprs. The tier table is patched in the page only.
//   --frames=90       frames measured per tier and point (default 90), --warm=24 warm up frames, --warmms=700 minimum warm up time in ms (GPU clock ramp)
//   --repeat=1        measure every cell N times and keep the run with the lowest Q1 (use 3 when other programs share the GPU)
//   --budget=5        fail (exit 1) when the tier 0 GPU time exceeds this many ms at dpr 1 (default off)
//   --patch="water=1,dof=0"   A/B test: set these tier flags on every tier in the page (tier table on disk stays untouched)
//   --hide="motes_,dustRing,atmoRig"   A/B test: hide scene objects whose name starts with one of these (atmoRig hides the hero lights)
//   --w=1920 --h=1080 viewport, --extra="foo=1&bar=2" extra URL params
//
// Cost figures (ms per frame). The table shows the lower quartile (Q1) because the GPU is usually shared with other programs, the JSON
// also holds the median and p95. sync = render call plus a readPixels that waits for the GPU (CPU submit plus GPU, wall clock, always
// available, the headline figure), gpu = EXT_disjoint_timer_query_webgl2 (GPU timestamps of the whole render call, null when the
// extension is missing; on Apple GPUs it can read higher than the wall clock when passes overlap), cpu = JS side only. The game loop is stopped and stepped by hand (60 Hz steps), so every tier sees exactly the same scene. Nothing is presented
// between frames, so compositor cost is not included.
// Output: <outDir>/<name>.png per shot, montage.png (rows levels, columns check points), looktest.json and a text table.
// Exit codes: 0 ok, 1 console error, page error or budget exceeded, 2 usage or launch error.
import fs from 'node:fs';
import path from 'node:path';
import { parseArgs, usage, gameUrl, launch, sleep, CHECKS, LEVEL_NAMES, measureInPage } from './_lib.mjs';

const { pos, opt } = parseArgs(process.argv.slice(2), { shots: 1, q: 0, frames: 90, warm: 24, w: 1920, h: 1080, levels: '0,1,2', points: '0,1,2,3,4', dprs: '1', stress: 1 });
if (!pos[0]) usage('usage: node tools/looktest.mjs <port|url> [outDir] [--levels=0,1,2] [--points=0..4] [--shots=1] [--q=0] [--ms[=0,1,..]] [--dprs=1,2] [--stress=3] [--budget=5]');
const out = pos[1] || '/tmp/ml-looktest';
fs.mkdirSync(out, { recursive: true });
const list = (v) => String(v).split(',').filter((s) => s !== '').map(Number);
const levels = list(opt.levels), points = list(opt.points), stress = +opt.stress;
const tiers = opt.ms === undefined ? [] : opt.ms === true ? [0, 1, 2, 3, 4, 5] : list(opt.ms);
const dprs = stress > 1 ? [1] : list(opt.dprs);
const result = { url: String(pos[0]), stress, shots: [], cost: [], errors: [] };
let failed = false;

for (const dpr of dprs) {
  const wantShots = opt.shots && dpr === dprs[0];
  const { browser, page, errs } = await launch({ w: opt.w, h: opt.h, dpr: stress > 1 ? Math.ceil(2 * Math.sqrt(stress)) : dpr });
  try {
    for (const L of levels) {
      await page.goto(gameUrl(pos[0], { autostart: 1, level: L, god: 1, noadapt: 1 }) + (opt.extra ? '&' + opt.extra : ''), { waitUntil: 'load' });
      await sleep(2500);
      // stop the game loop (the callback already queued runs once and does not reschedule), then drive frames by hand
      await page.evaluate(async (st, patch) => {
        window.requestAnimationFrame = () => 0;
        window.__ctx.render.adaptive = false;
        const t = await import('/src/render/tiers.js');
        if (st > 1) t.QUALITY.forEach((q) => { q.pr = q.pr * Math.sqrt(st); });
        for (const kv of patch.split(',').filter(Boolean)) { const [k, v] = kv.split('='); t.QUALITY.forEach((q) => { q[k] = Number(v); }); }
        await new Promise((r) => setTimeout(r, 150));
      }, stress, String(opt.patch || ''));
      for (const pi of points) {
        const d = CHECKS[L][pi]; const name = `L${L}-${LEVEL_NAMES[L]}-${d}`;
        await page.evaluate((dist, q) => { const c = window.__ctx; c.game.advance(3); c.rail.position.z = -dist; c.game.advance(2); c.render.setQuality(q); for (let i = 0; i < 24; i++) { c.game.step(1 / 60, false); c.render.render(1 / 60); } }, d, +opt.q);
        if (opt.hide) await page.evaluate((names) => { const pre = names.split(','); window.__ctx.scene.traverse((o) => { if (o.name && pre.some((p) => o.name.startsWith(p))) Object.defineProperty(o, 'visible', { get: () => false, set() {} }); }); for (let i = 0; i < 12; i++) { window.__ctx.game.step(1 / 60, false); window.__ctx.render.render(1 / 60); } }, String(opt.hide));
        if (wantShots) {
          await page.evaluate(() => { const c = window.__ctx; c.game.step(1 / 60, false); c.render.render(1 / 60); });
          const file = path.join(out, `${name}.png`);
          await page.screenshot({ path: file });
          result.shots.push({ level: L, point: pi, dist: d, file });
        }
        for (const q of tiers) {
          await page.evaluate((qq) => window.__ctx.render.setQuality(qq), q);
          await sleep(50);
          let m = null;
          for (let k = 0; k < +(opt.repeat || 1); k++) {
            const x = await page.evaluate(measureInPage, { frames: +opt.frames, warm: +opt.warm, warmMs: +(opt.warmms ?? 700) });
            if (!m || x.syncQ1 < m.syncQ1) m = x;
          }
          result.cost.push({ level: L, point: pi, dist: d, tier: q, dpr: stress > 1 ? `stress${stress}` : dpr, ...Object.fromEntries(Object.entries(m).map(([k, v]) => [k, typeof v === 'number' ? +v.toFixed(2) : v])) });
        }
      }
    }
  } catch (e) { console.error('looktest failed:', e.message); await browser.close(); process.exit(2); }
  result.errors.push(...errs);
  await browser.close();
}

// montage: rows = levels, columns = check points, drawn on a canvas in a scratch page
if (result.shots.length) {
  const { browser, page } = await launch({ w: 800, h: 600 });
  const CW = 512, CH = 288, LAB = 22;
  const items = result.shots.map((s) => ({ ...s, b64: fs.readFileSync(s.file).toString('base64') }));
  const png = await page.evaluate(async (items, levels, points, CW, CH, LAB, names) => {
    const cv = document.createElement('canvas'); cv.width = points.length * CW; cv.height = levels.length * (CH + LAB);
    const g = cv.getContext('2d'); g.fillStyle = '#000'; g.fillRect(0, 0, cv.width, cv.height); g.font = '14px monospace'; g.textBaseline = 'middle';
    for (const it of items) {
      const img = new Image(); img.src = 'data:image/png;base64,' + it.b64; await img.decode();
      const x = points.indexOf(it.point) * CW, y = levels.indexOf(it.level) * (CH + LAB);
      g.drawImage(img, x, y + LAB, CW, CH); g.fillStyle = '#9fd'; g.fillText(`L${it.level} ${names[it.level]}  rail ${it.dist}`, x + 6, y + LAB / 2); 
    }
    return cv.toDataURL('image/png').split(',')[1];
  }, items, levels, points, CW, CH, LAB, LEVEL_NAMES);
  fs.writeFileSync(path.join(out, 'montage.png'), Buffer.from(png, 'base64'));
  await browser.close();
  console.log('montage', path.join(out, 'montage.png'));
}

if (result.cost.length) {
    console.log(`frame cost per tier, lower quartile ms (sync, gpu timer in brackets); rows level/rail point, columns tiers`);
  const groups = new Map();
  for (const r of result.cost) { const k = `${r.dpr}|L${r.level}|${r.dist}`; if (!groups.has(k)) groups.set(k, []); groups.get(k).push(r); }
  for (const [k, rows] of groups) {
    const [dpr, lv, dist] = k.split('|');
    console.log(`dpr ${dpr} ${lv} ${String(dist).padStart(4)}  ` + rows.map((r) => `t${r.tier} ${String(r.syncQ1).padStart(5)} (${String(r.gpuQ1 ?? '-').padStart(5)}) ${r.canvas[0]}x${r.canvas[1]}`).join('  |  '));
  }
  const cvals = result.cost.filter((r) => r.tier === 0 && (r.dpr === 1 || r.dpr === '1'));
  if (opt.budget && cvals.length) {
    const worst = cvals.reduce((a, b) => (b.syncQ1 > a.syncQ1 ? b : a));
    const v = worst.syncQ1;
    console.log(`tier 0 dpr 1 worst sync Q1 ${v} ms at L${worst.level} rail ${worst.dist}, budget ${opt.budget} ms: ${v <= opt.budget ? 'OK' : 'OVER'}`);
    if (v > opt.budget) failed = true;
  }
}
fs.writeFileSync(path.join(out, 'looktest.json'), JSON.stringify(result, null, 1));
if (result.errors.length) { console.log('console errors:', [...new Set(result.errors)].slice(0, 6)); failed = true; }
console.log(failed ? 'LOOKTEST FAIL' : 'LOOKTEST OK', path.join(out, 'looktest.json'));
process.exit(failed ? 1 : 0);
