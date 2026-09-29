// Aimbot playthrough: jumps to the boss, aims at exposed weak points, verifies the flow reaches level complete.
// Usage: node tools/bossbot.mjs <port> <outDir> [levels=0,1,2]
import puppeteer from 'puppeteer-core';
const [port, SP, lv = '0,1,2'] = process.argv.slice(2);
const browser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: 'new',
  args: ['--use-angle=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist','--window-size=1280,720'], defaultViewport: { width: 1280, height: 720 } });
const page = await browser.newPage();
const errs = [];
page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
page.on('pageerror', (e) => errs.push('PAGEERR ' + e.message));
const info = () => page.evaluate(() => ({ phase: __ctx.state.phase, dist: Math.round(__ctx.rail.distance), hp: Math.round(__ctx.state.health), lives: __ctx.state.lives, en: __ctx.groups.enemies.length, boss: __ctx.state.boss && { n: __ctx.state.boss.name, hp: Math.round(__ctx.state.boss.hp), ph: __ctx.state.boss.phase } }));
for (const level of lv.split(',').map(Number)) {
  await page.goto(`http://localhost:${port}/?autostart=1&level=${level}&god=1`, { waitUntil: 'load' });
  await new Promise(r => setTimeout(r, 1500));
  const bossAt = [6300, 6800, 7300][level];
  await page.evaluate((d) => { __ctx.game.advance(3); __ctx.rail.position.z = -(d - 500); }, bossAt);
  let ended = null;
  for (let i = 0; i < 60 && !ended; i++) {
    await page.evaluate(() => {
      const c = __ctx; c.input.update = () => {}; c.input.axis.x = 0; c.input.axis.y = 0; c.input.fire = true;
      for (let k = 0; k < 50; k++) {
        c.__t = (c.__t || 0) + 0.1; c.input.fire = (c.__t % 1.4) < 1.15; // hold to charge and lock, release to fire the volley
        const p = c.player, r = c.rail.position;
        const cands = c.groups.enemies.filter(e => e.alive && e.lockable !== false && !e.untargetable && e.position.z < r.z - 10);
        const boss = c.state.boss;
        cands.sort((a, b) => (b.type === 'part') - (a.type === 'part') || b.position.z - a.position.z);
        const t = cands[0];
        if (t) { p.localOffset.set(Math.max(-14, Math.min(14, t.position.x - r.x)), Math.max(-8, Math.min(8, t.position.y - r.y))); }
        c.game.advance(0.1);
      }
    });
    const s = await info();
    if (i % 3 === 0) console.log(`L${level} +${(i + 1) * 5}s`, JSON.stringify(s));
    if (s.phase === 'levelcomplete' || s.phase === 'victory' || s.phase === 'gameover') { ended = s.phase; }
  }
  console.log(`L${level} RESULT:`, ended || 'did NOT finish', JSON.stringify(await info()));
  if (ended) { await new Promise(r => setTimeout(r, 2500)); await page.screenshot({ path: `${SP}/L${level}_end.png` }); }
}
console.log('ERRORS', errs.length, errs.slice(0, 5));
await browser.close();
