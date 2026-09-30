// Screen flow check: title, Enter to start, pause and resume, level complete, next level, game over, restart.
// Usage: node tools/flow.mjs <port> <outDir>   (needs the dev server running; screenshots land in outDir)
import puppeteer from 'puppeteer-core';
import { mkdirSync } from 'node:fs';
const [port, SP] = process.argv.slice(2);
mkdirSync(SP, { recursive: true });
const browser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: 'new',
  args: ['--use-angle=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist','--window-size=1280,720'], defaultViewport: { width: 1280, height: 720 } });
const page = await browser.newPage(); const errs = [];
page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); }); page.on('pageerror', (e) => errs.push('PAGEERR ' + e.message));
const wait = (ms) => new Promise(r => setTimeout(r, ms));
// real title flow: no autostart, press Enter
await page.goto(`http://localhost:${port}/`, { waitUntil: 'load' }); await wait(1500);
await page.keyboard.press('Enter'); await wait(800); // the first key press only unlocks audio (sound gate)
await page.keyboard.press('Enter'); await wait(2500);
console.log('after Enter', await page.evaluate(() => ({ phase: __ctx.state.phase, level: __ctx.state.levelIndex })));
await page.evaluate(() => __ctx.game.advance(8)); await page.screenshot({ path: `${SP}/flow_play.png` });
// pause / resume
await page.keyboard.press('Escape'); await wait(600);
console.log('after Esc', await page.evaluate(() => __ctx.state.phase)); await page.screenshot({ path: `${SP}/flow_pause.png` });
await page.keyboard.press('Escape'); await wait(600);
console.log('after Esc again', await page.evaluate(() => __ctx.state.phase));
// force level complete then next level
await page.evaluate(() => { __ctx.events.emit('level:complete'); }); await wait(3500);
console.log('levelcomplete?', await page.evaluate(() => __ctx.state.phase)); await page.screenshot({ path: `${SP}/flow_levelcomplete.png` });
await page.evaluate(() => __ctx.events.emit('ui:nextLevel')); await wait(2500);
console.log('next level', await page.evaluate(() => ({ phase: __ctx.state.phase, level: __ctx.state.levelIndex, name: __ctx.world.levelInfo.name })));
// game over path
await page.evaluate(() => { __ctx.state.god = false; __ctx.state.lives = 1; __ctx.player.takeDamage(9999, 'test'); __ctx.game.advance(6); }); await wait(3500);
console.log('after death', await page.evaluate(() => __ctx.state.phase)); await page.screenshot({ path: `${SP}/flow_gameover.png` });
await page.evaluate(() => __ctx.events.emit('ui:restart')); await wait(2500);
console.log('after restart', await page.evaluate(() => ({ phase: __ctx.state.phase, lives: __ctx.state.lives, health: __ctx.state.health })));
console.log('ERRORS', errs.length, errs.slice(0, 5));
await browser.close();
