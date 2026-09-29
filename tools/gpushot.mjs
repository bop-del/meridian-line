// Screenshot using the real GPU (Metal via ANGLE) instead of SwiftShader, to catch GPU-only artefacts.
// Usage: node tools/gpushot.mjs <url> <out.png> [waitMs] [w] [h] [dpr]
import puppeteer from 'puppeteer-core';
const [url, out, wait = '6000', w = '1600', h = '900', dpr = '2'] = process.argv.slice(2);
const browser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: 'new',
  args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', `--window-size=${w},${h}`], defaultViewport: { width: +w, height: +h, deviceScaleFactor: +dpr } });
const page = await browser.newPage(); const errs = [];
page.on('console', (m) => { if (['error', 'warning'].includes(m.type())) errs.push(m.type() + ': ' + m.text()); });
page.on('pageerror', (e) => errs.push('PAGEERR ' + e.message));
await page.goto(url, { waitUntil: 'load' });
await new Promise(r => setTimeout(r, +wait));
const info = await page.evaluate(() => { const c = window.__ctx; const gl = c?.renderer?.getContext(); const dbg = gl?.getExtension('WEBGL_debug_renderer_info');
  return { gpu: dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : 'n/a', fps: c?.render?.stats?.() ?? null, phase: c?.state?.phase, calls: c?.renderer?.info?.render?.calls }; });
console.log(JSON.stringify(info)); console.log(errs.slice(0, 8));
await page.screenshot({ path: out });
await browser.close();
