// Headless smoke test + screenshot helper (system Chrome, WebGL via SwiftShader/ANGLE).
// Usage: node tools/shot.mjs <url> <out.png> [waitMs=3000] [--keys=Enter,Space] [--eval="js expr run in page before shot"]
// Prints console errors/warnings and page errors. Exit code 1 if any page error or console error occurred.
import puppeteer from 'puppeteer-core';
const [url, out = 'shot.png', wait = '3000', ...rest] = process.argv.slice(2);
const keys = (rest.find((a) => a.startsWith('--keys=')) || '').slice(7).split(',').filter(Boolean);
const evalExpr = (rest.find((a) => a.startsWith('--eval=')) || '').slice(7);
const browser = await puppeteer.launch({
  executablePath: process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: 'new',
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl', '--autoplay-policy=no-user-gesture-required', '--window-size=1280,720'],
  defaultViewport: { width: 1280, height: 720 },
});
const page = await browser.newPage();
let bad = 0;
page.on('console', (m) => { if (['error', 'warning'].includes(m.type())) { console.log(`[console.${m.type()}]`, m.text()); if (m.type() === 'error') bad++; } });
page.on('pageerror', (e) => { console.log('[pageerror]', e.message); bad++; });
await page.goto(url, { waitUntil: 'load' });
await new Promise((r) => setTimeout(r, 800));
for (const k of keys) { await page.keyboard.press(k); await new Promise((r) => setTimeout(r, 400)); }
if (evalExpr) console.log('[eval]', JSON.stringify(await page.evaluate(evalExpr)));
await new Promise((r) => setTimeout(r, Number(wait)));
await page.screenshot({ path: out });
console.log('saved', out, bad ? `ERRORS: ${bad}` : 'clean');
await browser.close();
process.exit(bad ? 1 : 0);
