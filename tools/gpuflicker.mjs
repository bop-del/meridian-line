// Measures the fraction of near-black pixels in the central play area across many frames on the real GPU (Metal).
// Usage: node tools/gpuflicker.mjs <baseUrl, e.g. http://localhost:5173> <mode1,mode2,...> [frames=10] [extraQuery]
// Env: LEVEL=0|1|2 (default 2, the bright Thalassa Coast, the black pixel threshold does not suit the dark Foundry), JUMP=<rail distance to skip to>. Needs the dev server running.
import puppeteer from 'puppeteer-core';
const [base, modes = 'rt2,both,off', frames = '10', extra = ''] = process.argv.slice(2);
const browser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: 'new',
  args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--window-size=1280,720'], defaultViewport: { width: 1280, height: 720, deviceScaleFactor: 2 } });
const analyzer = await browser.newPage();
async function blackFrac(png64) {
  return analyzer.evaluate(async (b64) => {
    const img = new Image(); img.src = 'data:image/png;base64,' + b64; await img.decode();
    const c = document.createElement('canvas'); c.width = img.width; c.height = img.height; const g = c.getContext('2d'); g.drawImage(img, 0, 0);
    const x0 = Math.floor(img.width * 0.2), y0 = Math.floor(img.height * 0.25), w = Math.floor(img.width * 0.6), h = Math.floor(img.height * 0.4);
    const d = g.getImageData(x0, y0, w, h).data; let black = 0;
    for (let i = 0; i < d.length; i += 4) if (d[i] + d[i + 1] + d[i + 2] < 15) black++;
    return black / (d.length / 4);
  }, png64);
}
for (const mode of modes.split(',')) {
  const page = await browser.newPage(); const errs = [];
  page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); }); page.on('pageerror', (e) => errs.push('PAGEERR ' + e.message));
  await page.goto(`${base.replace(/\/$/, '')}/?autostart=1&level=${process.env.LEVEL || 2}&msaa=${mode}${extra}`, { waitUntil: 'load' });
  await new Promise(r => setTimeout(r, 4000));
  if (process.env.JUMP) await page.evaluate((d) => { __ctx.state.god = true; __ctx.rail.position.z = -d; }, +process.env.JUMP);
  if (process.env.JUMP) await new Promise(r => setTimeout(r, 6000));
  const fr = [];
  for (let i = 0; i < +frames; i++) { const b = await page.screenshot({ encoding: 'base64' }); fr.push(await blackFrac(b)); await new Promise(r => setTimeout(r, 250)); }
  const bad = fr.filter(f => f > 0.02).length;
  console.log(`msaa=${mode.padEnd(5)} frames=${fr.length} badFrames=${bad} maxBlack=${Math.max(...fr).toFixed(3)} errs=${errs.length}`, fr.map(f => f.toFixed(2)).join(' '));
  await page.close();
}
await browser.close();
