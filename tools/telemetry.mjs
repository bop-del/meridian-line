// Frame-time report from a real-GPU run (Metal via ANGLE on macOS). Records with window.__telemetry for the given time and prints
// frame time (avg, p50, p95, p99, worst), camera lag, input latency, rail speed, fov and shake.
// Usage: node tools/telemetry.mjs <url> <seconds> [--weave] [--w=1920] [--h=1080] [--dpr=1] [--json] [--out=report.json]
//   --weave   fly a steering pattern with real key presses (left and right, boost, brake, fire) while recording
//   --json    print only the raw JSON report
// Example: node tools/telemetry.mjs "http://localhost:5173/?autostart=1&level=0&god=1" 30 --weave
import puppeteer from 'puppeteer-core';
import { writeFileSync } from 'node:fs';

const args = process.argv.slice(2);
const flag = (n) => args.find((a) => a.startsWith(`--${n}=`))?.slice(n.length + 3);
const pos = args.filter((a) => !a.startsWith('--'));
const [rawUrl, secs = '20'] = pos;
if (!rawUrl) { console.error('usage: node tools/telemetry.mjs <url> <seconds> [--weave] [--w=1920] [--h=1080] [--dpr=1] [--json] [--out=file]'); process.exit(2); }
const weave = args.includes('--weave'), jsonOnly = args.includes('--json');
const W = +(flag('w') || 1920), H = +(flag('h') || 1080), DPR = +(flag('dpr') || 1);
const u = new URL(rawUrl);
if (!u.searchParams.has('telemetry') && !u.searchParams.has('tune')) u.searchParams.set('telemetry', '1');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({
  executablePath: process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: 'new',
  args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', `--window-size=${W},${H}`], defaultViewport: { width: W, height: H, deviceScaleFactor: DPR },
});
const page = await browser.newPage();
const errs = [];
page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
page.on('pageerror', (e) => errs.push('PAGEERR ' + e.message));
await page.goto(u.toString(), { waitUntil: 'load' });
await page.waitForFunction(() => window.__ctx && window.__telemetry, { timeout: 30000 });
await sleep(1500);
// get past the title if the url did not autostart
for (let i = 0; i < 6; i++) {
  if ((await page.evaluate(() => window.__ctx.state.phase)) === 'playing') break;
  await page.keyboard.press('Enter'); await sleep(900);
}
await sleep(4000);   // let the intro camera finish and shaders warm up
const env = await page.evaluate(() => {
  const c = window.__ctx, gl = c.renderer?.getContext?.(), dbg = gl?.getExtension('WEBGL_debug_renderer_info');
  return { gpu: dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : 'n/a', phase: c.state.phase, calls: c.renderer?.info?.render?.calls, triangles: c.renderer?.info?.render?.triangles, pixelRatio: c.renderer?.getPixelRatio?.() };
});
await page.evaluate(() => window.__telemetry.start());
const t0 = Date.now();
const hold = async (code, ms) => { await page.keyboard.down(code); await sleep(ms); await page.keyboard.up(code); };
if (weave) {
  await page.keyboard.down('Space');
  let i = 0;
  while ((Date.now() - t0) / 1000 < +secs) {
    const t = (Date.now() - t0) / 1000;
    if (i % 7 === 3) hold('ShiftLeft', 1200);
    if (i % 11 === 8) hold('KeyC', 900);
    await hold(i % 2 ? 'KeyA' : 'KeyD', 650);
    if (i % 3 === 0) await hold(i % 2 ? 'KeyW' : 'KeyS', 350);
    await sleep(120);
    i++;
    if (t > 1e6) break;
  }
  await page.keyboard.up('Space');
} else {
  await sleep(+secs * 1000);
}
const rep = await page.evaluate(() => { window.__telemetry.stop(); return window.__telemetry.report(); });
await browser.close();

const out = { env: { ...env, viewport: `${W}x${H}@${DPR}`, weave }, report: rep, errors: errs };
if (flag('out')) writeFileSync(flag('out'), JSON.stringify(out, null, 2));
if (jsonOnly) { console.log(JSON.stringify(out, null, 2)); process.exit(errs.length ? 1 : 0); }

const f = rep.frameMs, l = rep.inputLatency;
console.log(`GPU ${env.gpu}, ${W}x${H} @${DPR}x, ${rep.seconds}s, ${rep.frames} frames${weave ? ', weaving' : ''}`);
console.log(`draw calls ${env.calls ?? 'n/a'}, triangles ${env.triangles ?? 'n/a'}`);
console.log(`frame ms   avg ${f.avg}  p50 ${f.p50}  p95 ${f.p95}  p99 ${f.p99}  worst ${f.worst}   (${f.fpsAvg} fps avg)`);
console.log(`           over 18 ms: ${f.framesOver18ms}   over 33 ms: ${f.framesOver33ms}   hitches over 25 ms: ${f.hitches25ms}   stalls: ${f.stalls}`);
console.log(`camera lag avg ${rep.camLag.avg}  p95 ${rep.camLag.p95}  max ${rep.camLag.max}  (${rep.camLag.samples} chase frames, world units)`);
if (l.supported) {
  const r = l.fromRest;
  console.log(r.samples
    ? `input lag  from rest: ${r.samples} presses, avg ${r.avgMs} ms (${r.avgFrames} frames), p50 ${r.p50Ms} ms, max ${r.maxMs} ms (${r.maxFrames} frames), missed ${l.missed}`
    : `input lag  no presses from rest recorded${weave ? '' : ' (use --weave to fly a pattern)'}`);
} else console.log(`input lag  ${l.note}`);
if (rep.railSpeed) console.log(`rail speed min ${rep.railSpeed.min}  avg ${rep.railSpeed.avg}  max ${rep.railSpeed.max}`);
if (rep.fov) console.log(`fov        min ${rep.fov.min}  avg ${rep.fov.avg}  max ${rep.fov.max}`);
console.log(`shake      peak offset ${rep.shake.peakOffset}  rms ${rep.shake.rmsOffset}  peak roll ${rep.shake.peakRollDeg} deg`);
console.log(errs.length ? `console errors: ${errs.length}\n${errs.slice(0, 5).join('\n')}` : 'console errors: 0');
process.exit(errs.length ? 1 : 0);
