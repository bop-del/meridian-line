// Shared helpers for the verification tools (captest, blackframes, whiteout, looktest). Not a tool itself.
//   parseArgs(argv, defaults)  positional args plus --key=value / --flag options, numbers are converted
//   launch(opts)               real GPU Chrome (Metal via ANGLE), returns { browser, page, errs }
//   CHECKS / BOSS_AT           fixed rail check points per level, boss approach distance per level
//   measureInPage(o)           runs inside the page: GPU and sync frame cost of the current scene (see looktest.mjs)
// Exit codes used by all tools: 0 pass, 1 a check failed (black frames, white-out, budget, console errors), 2 usage or launch error.
import puppeteer from 'puppeteer-core';

export const CHECKS = [[300, 1500, 4200, 5400, 6800], [300, 1900, 3500, 5200, 6900], [300, 2200, 3400, 5000, 6400]];   // play order: Foundry, Cinder Belt, Thalassa
export const BOSS_AT = [7300, 6800, 6300];
export const LEVEL_NAMES = ['foundry', 'cinder', 'thalassa'];   // play order, same as config.levels

export function parseArgs(argv, defaults = {}) {
  const pos = [], opt = { ...defaults };
  for (const a of argv) {
    if (a.startsWith('--')) {
      const [k, v] = a.slice(2).split('=');
      opt[k] = v === undefined ? true : (v !== '' && !isNaN(v) ? Number(v) : v);
    } else pos.push(a);
  }
  return { pos, opt };
}

export function usage(text) { console.error(text); process.exit(2); }

/** Build a game URL. base may be a port number ("5214"), "localhost:5214" or a full URL. */
export function gameUrl(base, params = {}) {
  let b = String(base);
  if (/^\d+$/.test(b)) b = `http://localhost:${b}/`;
  else if (!/^https?:/.test(b)) b = `http://${b}`;
  const u = new URL(b);
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== false) u.searchParams.set(k, v === true ? '1' : String(v));
  return u.toString();
}

export async function launch({ w = 1920, h = 1080, dpr = 1, args = [], uncapped = false, software = false } = {}) {
  const gpu = software ? ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] : ['--use-angle=metal', '--enable-gpu'];
  const browser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: 'new',
    args: [...gpu, '--ignore-gpu-blocklist', `--window-size=${w},${h}`, ...(uncapped ? ['--disable-frame-rate-limit', '--disable-gpu-vsync'] : []), ...args],
    defaultViewport: { width: w, height: h, deviceScaleFactor: dpr } });
  const page = await browser.newPage(); const errs = [];
  page.on('console', (m) => { if (m.type() === 'error') errs.push('console: ' + m.text()); });
  page.on('pageerror', (e) => errs.push('PAGEERR ' + e.message));
  return { browser, page, errs };
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const median = (a) => { if (!a.length) return NaN; const s = [...a].sort((x, y) => x - y); return s[s.length >> 1]; };
export const pct = (a, p) => { if (!a.length) return NaN; const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(s.length * p))]; };

/**
 * Runs INSIDE the page (serialised by puppeteer, so it must stay self-contained). Renders `frames` frames of the frozen scene at the
 * current tier (step: true also runs one game step per frame, which moves the scene on and adds noise), each render timed. The rAF loop must already be stopped by the caller.
 * Reports per frame medians in ms:
 *   gpu   GPU time of the whole render call (EXT_disjoint_timer_query_webgl2, null when the extension is missing). gpuQ1 is the
 *         lower quartile: the GPU is shared with other processes, so Q1 rejects most of the contention noise of the median
 *   sync  render call plus a 1 pixel readPixels that waits for the GPU, i.e. serialised CPU submit plus GPU time (always available)
 *   cpu   time until render() returns (JS side only)
 *   upd   game update (step) time, not part of the render budget
 */
export async function measureInPage({ frames = 90, warm = 24, warmMs = 700, step = false }) {
  const c = window.__ctx, r = c.render, gl = c.renderer.getContext();
  const ext = gl.getExtension('EXT_disjoint_timer_query_webgl2');
  const px = new Uint8Array(4), dt = 1 / 60;
  const med = (a) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[s.length >> 1] : null; };
  const pc = (a, f) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.min(s.length - 1, Math.floor(s.length * f))] : null; };
  const p95 = (a) => pc(a, 0.95);
  const cpu = [], sync = [], upd = [], queries = [];
  // the GPU clocks down when idle: run the warm up for at least warmMs of wall time so the first frames are not measured at a low clock
  const tw = performance.now();
  for (let i = 0; i < warm; i++) { if (step) c.game.step(dt, false); r.render(dt); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px); }
  while (performance.now() - tw < warmMs) { if (step) c.game.step(dt, false); r.render(dt); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px); }
  for (let i = warm; i < warm + frames; i++) {
    const u0 = performance.now(); if (step) c.game.step(dt, false); const u1 = performance.now();
    let q = null;
    if (ext) { q = gl.createQuery(); gl.beginQuery(ext.TIME_ELAPSED_EXT, q); }
    const t0 = performance.now(); r.render(dt); const t1 = performance.now();
    if (q) gl.endQuery(ext.TIME_ELAPSED_EXT);
    gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px); const t2 = performance.now();
    { cpu.push(t1 - t0); sync.push(t2 - t0); upd.push(u1 - u0); if (q) queries.push(q); }
  }
  const gpu = [];
  if (ext) {
    for (let tries = 0; tries < 200 && queries.length; tries++) {
      if (queries.every((q) => gl.getQueryParameter(q, gl.QUERY_RESULT_AVAILABLE))) break;
      await new Promise((res) => setTimeout(res, 10));
    }
    const disjoint = gl.getParameter(ext.GPU_DISJOINT_EXT);
    if (!disjoint) for (const q of queries) if (gl.getQueryParameter(q, gl.QUERY_RESULT_AVAILABLE)) gpu.push(gl.getQueryParameter(q, gl.QUERY_RESULT) / 1e6);
    for (const q of queries) gl.deleteQuery(q);
  }
  const cv = gl.canvas;
  return { gpu: med(gpu), gpuQ1: pc(gpu, 0.25), gpuP95: p95(gpu), sync: med(sync), syncQ1: pc(sync, 0.25), syncP95: p95(sync), cpu: med(cpu), upd: med(upd), canvas: [cv.width, cv.height], pr: c.renderer.getPixelRatio(), timer: !!ext, n: sync.length,
    calls: c.renderer.info.render.calls, tris: c.renderer.info.render.triangles };
}
