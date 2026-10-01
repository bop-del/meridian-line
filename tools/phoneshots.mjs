// Phone layout screenshots: every menu and several HUD moments on an iPhone 12 and an iPhone 14 in landscape, Chrome emulation with
// touch (?touch=1). Real taps go through CDP touch events, so this also proves the menus are tap operable. After the shots it audits
// the tap targets (44 CSS px) of every visible control on each screen and prints a table of the ones that are too small.
// Usage: node tools/phoneshots.mjs <port|url> [outDir=/tmp/ml-phoneshots] [options]
//   --device=iphone12|iphone14|both   (default both)      --dpr=3   device pixel ratio (default 3)
//                                     also: short290 (844x290, Safari tab with the bars up), short260 (740x260), se375 (667x375),
//                                     all (every size above), --short (both plus short290 and short260)
//   --only=gate,title,...             only these shots     --zones   draw the stick zone and the button cluster over the game shots
//   --until=<shot>                    stop after this shot (quick iteration on the early screens)
//   --gpu                             real GPU Chrome (default is the software renderer: layout does not need the GPU)
//   --inset=47,0,47,21                safe area insets left,top,right,bottom in CSS px (iPhone landscape default), 0 turns it off
// Shots (files <device>-<name>.png): gate, title, mission, legend, intro, hud-start, hud-hint, hud-comm, hud-boss, hud-low, hud-escort,
// hud-toast, pause, settings, levelcomplete, gameover, victory.
// Exit codes: 0 done (and no console errors), 1 console errors or a tap target under 44 px, 2 usage or launch error.
import puppeteer from 'puppeteer-core';
import { mkdirSync } from 'node:fs';
import { parseArgs, usage, gameUrl, sleep } from './_lib.mjs';

const { pos, opt } = parseArgs(process.argv.slice(2), { device: 'both', dpr: 3, inset: '47,0,47,21' });
if (!pos[0]) usage('usage: node tools/phoneshots.mjs <port|url> [outDir] [--device=iphone12|iphone14|both] [--dpr=3] [--only=a,b] [--zones] [--gpu] [--inset=47,0,47,21]');
const OUT = pos[1] || '/tmp/ml-phoneshots';
mkdirSync(OUT, { recursive: true });
// inset: safe area left,top,right,bottom. The short sizes are a phone in a Safari tab with the bars up: the notch side insets stay, the
// bottom inset is gone because the toolbar covers the home indicator.
const DEVICES = {
  iphone12: { w: 844, h: 390 }, iphone14: { w: 852, h: 393 },
  short290: { w: 844, h: 290, inset: [47, 0, 47, 0] }, short260: { w: 740, h: 260, inset: [47, 0, 47, 0] }, se375: { w: 667, h: 375, inset: [0, 0, 0, 21] },
};
const which = opt.device === 'all' ? Object.keys(DEVICES) : opt.short ? ['iphone12', 'iphone14', 'short290', 'short260'] : opt.device === 'both' ? ['iphone12', 'iphone14'] : [String(opt.device)];
if (which.some((d) => !DEVICES[d])) usage('unknown device ' + opt.device);
const only = opt.only ? new Set(String(opt.only).split(',')) : null;
const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.4 Mobile/15E148 Safari/604.1';
const BOSS_AT = [7300, 6800, 6300];
const insetOpt = String(opt.inset).split(',').map(Number);   // left, top, right, bottom

const gpu = opt.gpu ? ['--use-angle=metal', '--enable-gpu'] : ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'];
let failed = false;
const errs = [];

for (const dev of which) {
  const { w, h } = DEVICES[dev];
  const inset = DEVICES[dev].inset && !opt.inset_set ? DEVICES[dev].inset : insetOpt;
  const browser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: 'new',
    args: [...gpu, '--ignore-gpu-blocklist', `--window-size=${w},${h}`], defaultViewport: { width: w, height: h, deviceScaleFactor: +opt.dpr, isMobile: true, hasTouch: true } });
  try {
    const page = await browser.newPage();
    await page.setUserAgent(UA);
    await page.setViewport({ width: w, height: h, deviceScaleFactor: +opt.dpr, isMobile: true, hasTouch: true });
    page.on('console', (m) => { if (m.type() === 'error') errs.push(`${dev} console: ${m.text()}`); });
    page.on('pageerror', (e) => errs.push(`${dev} PAGEERR ${e.message}`));
    const cdp = await page.createCDPSession();
    if (inset.some((v) => v > 0)) {
      try { await cdp.send('Emulation.setSafeAreaInsetsOverride', { insets: { left: inset[0], top: inset[1], right: inset[2], bottom: inset[3] } }); }
      catch (e) { console.log(`[${dev}] safe area override not available: ${e.message}`); }
    }
    const want = (n) => !only || only.has(n);
    const shot = async (name) => {
      if (!want(name)) return;
      if (opt.zones) await page.evaluate(() => {
        if (document.getElementById('zones')) return;
        const d = document.createElement('div'); d.id = 'zones'; d.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:99999';
        d.innerHTML = '<div style="position:absolute;left:0;top:25%;width:42%;bottom:0;background:rgba(255,0,80,.12);outline:1px dashed rgba(255,0,80,.6)"></div><div style="position:absolute;right:0;top:35%;width:30%;bottom:0;background:rgba(0,120,255,.12);outline:1px dashed rgba(0,120,255,.6)"></div>';
        document.body.appendChild(d);
      });
      await page.screenshot({ path: `${OUT}/${dev}-${name}.png` });
      if (opt.zones) await page.evaluate(() => document.getElementById('zones')?.remove());
      console.log(`[${dev}] shot ${name}`);
      if (opt.until === name) throw new Error('STOP');
    };
    const tap = async (sel, idx = 0) => {
      const p = await page.evaluate((s, i) => { const e = document.querySelectorAll(s)[i]; if (!e) return null; const r = e.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; }, sel, idx);
      if (!p) { console.log(`[${dev}] tap: no element ${sel}`); return false; }
      await page.touchscreen.tap(p.x, p.y); return true;
    };
    const tapXY = async (x, y) => { await page.touchscreen.tap(x, y); };
    const settle = async (ms = 700) => { await sleep(ms); };

    // tap target audit: every visible interactive element on the current screen
    const audit = async (label) => {
      const bad = await page.evaluate(() => {
        const out = [];
        const sels = ['.screen.on .btn', '.screen.on .pill', '.screen.on .arrow', '.screen.on .speaker', '.screen.on .press', '.screen.on .sl-i', '.screen.on .touch-help', '.screen.on .tl-btn', '.sound-gate'];
        for (const s of sels) for (const e of document.querySelectorAll(s)) {
          const cs = getComputedStyle(e); if (cs.display === 'none' || cs.visibility === 'hidden') continue;
          const r = e.getBoundingClientRect(); if (r.width === 0 || r.height === 0) continue;
          if (r.width < 43.5 || r.height < 43.5) out.push(`${s} ${e.textContent.trim().slice(0, 14)} ${r.width.toFixed(0)}x${r.height.toFixed(0)}`);
        }
        return out;
      });
      if (bad.length) { failed = true; console.log(`[${dev}] TAP TARGETS UNDER 44 on ${label}:\n   ` + bad.join('\n   ')); }
      else console.log(`[${dev}] tap targets ok on ${label}`);
      // controls must be fully on screen, must not overlap each other, and the screen must not clip its content
      const geo = await page.evaluate(() => {
        const out = [], list = [];
        const sels = ['.screen.on .btn', '.screen.on .pill', '.screen.on .arrow', '.screen.on .speaker', '.screen.on .press', '.screen.on .helpbtn', '.screen.on .touch-help', '.sound-gate'];
        for (const s of sels) for (const e of document.querySelectorAll(s)) {
          const cs = getComputedStyle(e); if (cs.display === 'none' || cs.visibility === 'hidden' || !e.getClientRects().length) continue;
          const r = e.getBoundingClientRect(); if (r.width === 0 || r.height === 0 || cs.opacity === '0') continue;
          const name = `${s.replace('.screen.on ', '')} "${e.textContent.trim().slice(0, 12)}"`;
          if (!e.matches('.touch-help, .sound-gate') && (r.top < -1 || r.left < -1 || r.bottom > innerHeight + 1 || r.right > innerWidth + 1)) out.push(`${name} off screen (${r.left.toFixed(0)},${r.top.toFixed(0)} to ${r.right.toFixed(0)},${r.bottom.toFixed(0)}) in ${innerWidth}x${innerHeight}`);
          if (!e.matches('.touch-help, .sound-gate')) list.push([name, r]);
        }
        for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
          const a = list[i][1], b = list[j][1];
          const ox = Math.min(a.right, b.right) - Math.max(a.left, b.left), oy = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
          if (ox > 2 && oy > 2) out.push(`${list[i][0]} overlaps ${list[j][0]} by ${ox.toFixed(0)}x${oy.toFixed(0)}`);
        }
        const sc = document.querySelector('.screen.on');
        if (sc && sc.scrollHeight > sc.clientHeight + 1) out.push(`screen content taller than the screen: scrollHeight ${sc.scrollHeight} vs clientHeight ${sc.clientHeight} (ok only when the screen scrolls: overflow-y ${getComputedStyle(sc).overflowY})`);
        const pn = document.querySelector('.screen.on .panel');
        if (pn && pn.scrollHeight > pn.clientHeight + 1 && !/auto|scroll/.test(getComputedStyle(pn).overflowY)) out.push(`panel clips its content: ${pn.scrollHeight} vs ${pn.clientHeight}`);
        return out;
      });
      if (geo.length) { failed = true; console.log(`[${dev}] LAYOUT PROBLEMS on ${label}:\n   ` + geo.join('\n   ')); }
    };
    // text size audit: smallest rendered font among visible text nodes
    const tiny = async (label, min = 10) => {
      const list = await page.evaluate((m) => {
        const out = new Map();
        for (const e of document.querySelectorAll('.ui *')) {
          if (!e.childNodes.length) continue;
          let own = ''; for (const n of e.childNodes) if (n.nodeType === 3) own += n.textContent.trim();
          if (!own) continue;
          const cs = getComputedStyle(e); if (cs.display === 'none' || cs.visibility === 'hidden' || !e.getClientRects().length) continue;
          let el = e, op = 1; while (el && el !== document.body) { op *= +getComputedStyle(el).opacity; el = el.parentElement; }
          if (op < 0.3) continue;
          const fs = parseFloat(cs.fontSize); if (fs < m) out.set(`${e.className || e.tagName} "${own.slice(0, 16)}"`, fs.toFixed(1));
        }
        return [...out].map(([k, v]) => `${k} ${v}px`);
      }, min);
      if (list.length) console.log(`[${dev}] text under ${min}px on ${label}:\n   ` + list.join('\n   '));
    };
    const ev = (fn, ...a) => page.evaluate(fn, ...a);
    // HUD parts that matter must stay out of the stick zone (left 42 percent, below 25 percent) and the button cluster (right 30 percent,
    // below 35 percent). Prints the overlap in CSS px of every visible HUD element that crosses a zone.
    const zoneAudit = async (label) => {
      const hits = await page.evaluate(() => {
        const W = innerWidth, H = innerHeight, out = [];
        const zones = { STICK: [0, H * 0.25, W * 0.42, H], CLUSTER: [W * 0.7, H * 0.35, W, H] };
        const sels = ['.h-tl', '.h-gauge', '.h-sub', '.h-tc > .lbl', '.h-score', '.h-tc-row', '.h-boss.on', '.h-tr .h-level', '.h-escort.on', '.comm.on', '.comm-strip.on', '.h-hint.on', '.toast'];
        for (const s of sels) for (const e of document.querySelectorAll('.hud ' + s + ', .ui > ' + s)) {
          const r = e.getBoundingClientRect(); if (!r.width || !r.height) continue;
          for (const [zn, [x0, y0, x1, y1]] of Object.entries(zones)) {
            const ox = Math.min(r.right, x1) - Math.max(r.left, x0), oy = Math.min(r.bottom, y1) - Math.max(r.top, y0);
            if (ox > 2 && oy > 2) out.push(`${s} in ${zn}: ${ox.toFixed(0)}x${oy.toFixed(0)} px (element ${r.left.toFixed(0)},${r.top.toFixed(0)} ${r.width.toFixed(0)}x${r.height.toFixed(0)})`);
          }
        }
        return out;
      });
      console.log(`[${dev}] zone overlaps on ${label}: ${hits.length ? '\n   ' + hits.join('\n   ') : 'none'}`);
    };

    // ---- title flow from a cold load: sound gate, title, mission select
    await page.goto(gameUrl(pos[0], { touch: 1 }), { waitUntil: 'load', timeout: 180000 });
    await settle(3500);
    console.log(`[${dev}] viewport ${w}x${h} dpr ${opt.dpr}, classes: ${await ev(() => document.body.className)}, safe area left/bottom: ${await ev(() => { const c = getComputedStyle(document.querySelector('.screen')); return c.paddingLeft + ' / ' + c.paddingBottom; })}`);
    await shot('gate');
    await audit('gate');
    if (want('rotate')) {   // the same page held upright: the rotate prompt with the install steps
      await page.setViewport({ width: 390, height: 844, deviceScaleFactor: +opt.dpr, isMobile: true, hasTouch: true });
      await settle(1500); await shot('rotate');
      await page.setViewport({ width: w, height: h, deviceScaleFactor: +opt.dpr, isMobile: true, hasTouch: true });
      await settle(1500);
    }
    await tapXY(w / 2, h / 2);   // the gate consumes the first tap
    await settle(2500);
    await shot('title');
    await audit('title'); await tiny('title');
    await tap('.mission-sel .pill', 1);   // mission 2 by tap
    await tap('.diff:not(.mission-sel):not(.music-sel) .pill', 2);   // HARD by tap
    await settle(500);
    await shot('mission');
    await tap('.mission-sel .pill', 0);
    await tap('.diff:not(.mission-sel):not(.music-sel) .pill', 1);
    await settle(300);
    // first START: the one-time controls legend appears on touch, a tap dismisses it and the game starts
    await tap('.press');
    await settle(900);
    await shot('legend');
    await audit('legend'); await tiny('legend');
    await tapXY(w / 2, h / 2);
    await settle(1200);
    console.log(`[${dev}] phase after start:`, await ev(() => window.__ctx.state.phase));
    await ev(() => window.__ctx.game.advance(0.6));
    await settle(500);
    await shot('intro');
    await tiny('intro');

    // ---- HUD moments (the game is frozen between advance calls, time passes only through advance)
    await ev(() => window.__ctx.game.advance(5));
    await settle(700);
    await shot('hud-start'); await tiny('hud-start'); await zoneAudit('hud-start');
    await ev(() => window.__ctx.game.advance(1.2));   // the CHARGE hint sits at rail distance 50
    await ev(() => window.__ctx.ui.hint('CHARGE: hold SPACE, release to send a lock-on volley', 30));
    await settle(700);
    await shot('hud-hint');
    await ev(() => { window.__ctx.ui.hud.hintT = 0; window.__ctx.ui.hud.hintEl.classList.remove('on'); });
    await ev(() => window.__ctx.ui.comm({ speaker: 'VEX', text: 'Wing two. Anchorage in sight, bearing 350. Keep it tight, leader.', duration: 30 }));
    await ev(() => window.__ctx.game.advance(3));
    await settle(700);
    await shot('hud-comm'); await tiny('hud-comm'); await zoneAudit('hud-comm');
    await ev(() => window.__ctx.ui.comm({ speaker: 'LUMEN', text: 'Transponder link to PIP is degrading. Clear the jamming contact.', duration: 30 }));
    await ev(() => window.__ctx.game.advance(3));
    await settle(500);
    await shot('hud-comm-strip');
    await ev(() => { window.__ctx.ui.commBox.reset(); window.__ctx.ui.toast('SHIELD CELL 3', 'good'); window.__ctx.ui.toast('PULSE UPGRADE', 'cyan'); });
    await settle(250);
    await shot('hud-toast');
    await settle(1800);
    // a damaged, low shield state with an escort in trouble
    await ev(() => {
      const c = window.__ctx; c.state.god = false; c.state.health = 22; c.state.boost = 0.4; c.state.bombs = 2;
      c.game.advance(0.4);
      const w = c.allies?.wingmen?.[0]; if (w) { w.state = 'chased'; w.chase = { kind: 'gate', t: 6, limit: 60, enemy: { alive: true, position: c.rail.position } }; w.alive = true; }
      c.ui.hud.updateEscorts();
    });
    await settle(900);
    await shot('hud-escort'); await zoneAudit('hud-escort'); await shot('hud-low');
    await ev(() => { const c = window.__ctx; c.state.health = c.state.maxHealth; const w = c.allies?.wingmen?.[0]; if (w) { w.state = 'follow'; w.chase = null; } c.state.god = true; });
    // boss approach
    await ev((d) => { const c = window.__ctx; c.rail.position.z = -d; c.game.advance(2.5); c.ui.commBox.reset(); }, BOSS_AT[0] - 250);
    await ev(() => window.__ctx.game.advance(14));
    await settle(900);
    await shot('hud-boss'); await zoneAudit('hud-boss');
    await ev(() => window.__ctx.ui.commBox.push({ speaker: 'FERRO', text: 'Shield generators first, then the core. Stay off its centreline.', duration: 30 }));
    await ev(() => window.__ctx.game.advance(3));
    await settle(700);
    await shot('hud-boss-comm');
    await ev(() => window.__ctx.ui.commBox.reset());

    // ---- pause (real tap path: the pause button belongs to the controls layer, so use the phase directly, then test RESUME by tap)
    await ev(() => window.__ctx.game.pause());
    await settle(900);
    console.log(`[${dev}] phase paused?`, await ev(() => window.__ctx.state.phase));
    await shot('pause'); await audit('pause'); await tiny('pause');
    // settings: drag the master slider by tap, toggle sound
    const sp = await ev(() => { const e = document.querySelector('.screen.pause .sl-i'); if (!e) return null; const r = e.getBoundingClientRect(); return { x: r.left + r.width * 0.3, y: r.top + r.height / 2 }; });
    if (sp) await tapXY(sp.x, sp.y);
    await tap('.screen.pause .btn.option');
    await settle(400);
    await shot('settings');
    await tap('.screen.pause .btn:not(.slider):not(.option)');   // the first button is RESUME
    await settle(1200);
    console.log(`[${dev}] phase after RESUME tap:`, await ev(() => window.__ctx.state.phase));

    // ---- level complete, game over, victory
    await ev(() => window.__ctx.events.emit('level:complete'));
    await settle(4200);
    await shot('levelcomplete'); await audit('levelcomplete'); await tiny('levelcomplete');
    await ev(() => window.__ctx.events.emit('ui:nextLevel'));
    await settle(2500);
    await ev(() => { const c = window.__ctx; c.state.god = false; c.state.lives = 1; c.player.takeDamage(9999, 'test'); c.game.advance(6); });
    await settle(4200);
    await shot('gameover'); await audit('gameover'); await tiny('gameover');
    await ev(() => { const c = window.__ctx; c.game.setPhase('victory'); });
    await settle(2500);
    await shot('victory'); await audit('victory');
  } catch (e) {
    if (e.message !== 'STOP') { console.error(`[${dev}] phoneshots failed:`, e.message); failed = true; }
  }
  await browser.close();
}
console.log('console errors:', errs.length); for (const e of errs.slice(0, 8)) console.log('  ' + e);
console.log('files in', OUT);
process.exit(failed || errs.length ? 1 : 0);
