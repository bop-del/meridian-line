// White-out detector: per frame luminance of the finished canvas (7 x 7 sample grid), then the longest run of frames over a threshold.
// It starts the level 450 rail units before the boss approach (level 0 is the Obsidian Foundry, where the white-out was found), holds fire and weaves.
// Usage: node tools/whiteout.mjs <port|url> [seconds=25] [options]     (needs a dev server, real GPU Chrome)
//   --level=0|1|2      level (default 0, the Foundry), --from=<rail distance> start there (default: boss approach minus 450: 6850, 6350, 5850)
//   --dpr=1            device pixel ratio (default 1), --w=1600 --h=900
//   --settle=0         seconds to wait after the jump before recording (lets the level warm up)
//   --thresh=200       luminance (0..255) that counts as white (default 200)
//   --max-run=3        longest allowed run of white frames at cruise, --boss-max-run=6 while a boss is alive (defaults 3 and 6)
//   --shots=2          save up to N screenshots of white frames to <out> and list the meshes, lights and sprites within 30 u of the camera
//   --out=/tmp/ml-whiteout   screenshot folder, --extra="nopost=1" extra URL params
// Output: one JSON line (frames, median, p99, max luminance, white frame count, runs, longest run at cruise and in boss fights) and, for
// the first white frame, the events around it. Exit codes: 0 pass, 1 a run is too long or console errors, 2 usage or launch error.
import fs from 'node:fs';
import { parseArgs, usage, gameUrl, launch, sleep, BOSS_AT } from './_lib.mjs';

const { pos, opt } = parseArgs(process.argv.slice(2), { level: 0, dpr: 1, w: 1600, h: 900, settle: 0, thresh: 200, 'max-run': 3, 'boss-max-run': 6, shots: 0, out: '/tmp/ml-whiteout' });
if (!pos[0]) usage('usage: node tools/whiteout.mjs <port|url> [seconds=25] [--level=0] [--from=dist] [--settle=8] [--thresh=200] [--max-run=3] [--boss-max-run=6] [--shots=2]');
const secs = +(pos[1] || 25), level = +opt.level, from = opt.from !== undefined ? +opt.from : BOSS_AT[level] - 450;
const { browser, page, errs } = await launch({ w: opt.w, h: opt.h, dpr: opt.dpr });
try {
  await page.goto(gameUrl(pos[0], { autostart: 1, level, god: 1 }) + (opt.extra ? '&' + opt.extra : ''), { waitUntil: 'load' });
  await sleep(2500);
  await page.evaluate((d) => {
    const c = window.__ctx; c.game.advance(3); c.rail.position.z = -d;
    window.__lum = []; window.__ev = [];
    const em = c.events.emit.bind(c.events); c.events.emit = (n, p) => { window.__ev.push([window.__lum.length, n]); return em(n, p); };
    const gl = c.renderer.getContext(), px = new Uint8Array(4), r = c.render, o = r.render.bind(r);
    r.render = function (dt) {
      o(dt); const W = gl.canvas.width, H = gl.canvas.height; let s = 0, n = 0;
      for (let iy = 1; iy < 8; iy++) for (let ix = 1; ix < 8; ix++) { gl.readPixels((W * ix / 8) | 0, (H * iy / 8) | 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px); s += (px[0] + px[1] + px[2]) / 3; n++; }
      window.__lum.push([s / n, (c.state.boss?.hp ?? 0) > 0 ? 1 : 0]);
    };
  }, from);
  if (opt.settle) { await sleep(opt.settle * 1000); await page.evaluate(() => { window.__lum.length = 0; }); }
  await page.keyboard.down('Space');
  let shots = 0; fs.mkdirSync(opt.out, { recursive: true }); const t0 = Date.now();
  while (Date.now() - t0 < secs * 1000) {
    if (shots < opt.shots) {
      const l = await page.evaluate(() => { const a = window.__lum.slice(-3); return a.reduce((x, y) => x + y[0], 0) / Math.max(1, a.length); });
      if (l > opt.thresh) {
        await page.screenshot({ path: `${opt.out}/white-L${level}-${shots++}.png` });
        console.log('near camera', JSON.stringify(await page.evaluate(() => { const c = window.__ctx, cam = c.camera.position, out = [];
          c.scene.traverse((o) => { if (!o.visible || !(o.isMesh || o.isPoints || o.isSprite || o.isLight)) return; const d = o.getWorldPosition(new c.THREE.Vector3()).distanceTo(cam);
            if (o.isLight) out.push(['LIGHT ' + o.type, +o.intensity.toFixed(1), +d.toFixed(0)]); else if (d < 30) out.push([o.name || o.type, +d.toFixed(1), o.material && o.material.blending, o.material && +(o.material.opacity ?? 1).toFixed(2)]); });
          return out.slice(0, 40); })));
      }
    }
    await page.keyboard.down('KeyA'); await sleep(700); await page.keyboard.up('KeyA'); await page.keyboard.down('KeyD'); await sleep(700); await page.keyboard.up('KeyD');
  }
  await page.keyboard.up('Space');
  const rec = await page.evaluate(() => window.__lum), evs = await page.evaluate(() => window.__ev);
  const lum = rec.map((r) => r[0]), s = [...lum].sort((a, b) => a - b), med = s[s.length >> 1];
  const runs = { cruise: 0, boss: 0 }; let cur = 0, curBoss = 0, nRuns = 0;
  rec.forEach(([l, b], i) => {
    if (l > opt.thresh) { if (!cur) nRuns++; cur++; if (b) curBoss++; else curBoss = 0; const isBoss = curBoss > 0; if (isBoss) runs.boss = Math.max(runs.boss, cur); else runs.cruise = Math.max(runs.cruise, cur); } else { cur = 0; curBoss = 0; }
  });
  const fw = lum.findIndex((l) => l > opt.thresh);
  if (fw >= 0) console.log('first white frame', fw, 'events before it:', JSON.stringify(evs.filter(([f]) => f > fw - 45 && f < fw + 6).map(([f, n]) => `${f}:${n}`)));
  console.log(JSON.stringify({ url: String(pos[0]), level, from, frames: lum.length, median: +med.toFixed(0), p99: +s[Math.floor(s.length * 0.99)]?.toFixed(0), max: +s[s.length - 1]?.toFixed(0), framesOverThresh: lum.filter((l) => l > opt.thresh).length,
    whiteRuns: nRuns, longestRunCruise: runs.cruise, longestRunBoss: runs.boss, bossFrames: rec.filter((r) => r[1]).length, errs: errs.slice(0, 5) }));
  await browser.close();
  const why = [];
  if (runs.cruise > opt['max-run']) why.push(`cruise run ${runs.cruise} > ${opt['max-run']}`);
  if (runs.boss > opt['boss-max-run']) why.push(`boss run ${runs.boss} > ${opt['boss-max-run']}`);
  if (errs.length) why.push('console errors');
  console.log(why.length ? 'WHITEOUT FAIL: ' + why.join(', ') : 'WHITEOUT OK');
  process.exit(why.length ? 1 : 0);
} catch (e) { console.error('whiteout failed:', e.message); await browser.close(); process.exit(2); }
