// Touch controls test. Chrome (puppeteer-core) emulating an iPhone 14 in landscape (844x390, dpr 3, hasTouch, isMobile) with ?touch=1,
// driven by real multi-touch through CDP Input.dispatchTouchEvent (several fingers at once, like two thumbs). Asserts on
// __ctx.input and the ship: steering plus fire together, a long fire hold, bomb, boost, brake, rolls, sliding between hold buttons,
// autopilot priority, pause, release on pause and on blur, gamepad hiding, cinema fade, dead zones of the screen, and that a plain
// desktop page has no touch layer at all. Screenshots of the control layer go to <outDir>.
// Usage: node tools/touchtest.mjs <port> [outDir] [--software] [--dpr=3] [--w=844] [--h=390]
// Exit codes: 0 pass, 1 a check failed, 2 usage or launch error.
import { mkdirSync } from 'node:fs';
import puppeteer from 'puppeteer-core';
import { parseArgs, usage, gameUrl, sleep } from './_lib.mjs';

const { pos, opt } = parseArgs(process.argv.slice(2), { dpr: 3, w: 844, h: 390 });
const [port, outDir = '/tmp/ml-touchtest'] = pos;
if (!port) usage('usage: node tools/touchtest.mjs <port> [outDir] [--software] [--dpr=3] [--w=844] [--h=390]');
mkdirSync(outDir, { recursive: true });

const IPHONE_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1';
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok: !!ok, detail }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  ' + detail : ''}`); };
const chromeArgs = (o) => [...(o.software ? ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] : ['--use-angle=metal', '--enable-gpu']), '--ignore-gpu-blocklist'];

async function launch(mobile) {
  const browser = await puppeteer.launch({
    executablePath: process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: 'new',
    args: [...chromeArgs(opt), `--window-size=${opt.w},${opt.h}`],
  });
  const page = await browser.newPage();
  const errs = [];
  page.on('console', (m) => { if (m.type() === 'error') errs.push('console: ' + m.text()); });
  page.on('pageerror', (e) => errs.push('PAGEERR ' + e.message));
  if (mobile) {
    await page.setUserAgent(IPHONE_UA);
    await page.setViewport({ width: opt.w, height: opt.h, deviceScaleFactor: opt.dpr, isMobile: true, hasTouch: true, isLandscape: true });
  } else await page.setViewport({ width: 1280, height: 720, deviceScaleFactor: 1 });
  return { browser, page, errs };
}

// ---------------------------------------------------------------------------------------------------------------- desktop guard
async function desktopCheck() {
  const { browser, page, errs } = await launch(false);
  try {
    await page.goto(gameUrl(port, { autostart: 1, level: 0, god: 1 }), { waitUntil: 'load' });
    await page.waitForFunction(() => window.__ctx && window.__ctx.state.phase === 'playing', { timeout: 40000 });
    await sleep(800);
    const r = await page.evaluate(() => ({ layer: !!document.querySelector('.tctl'), touchClass: document.body.classList.contains('touch'), active: window.__ctx.input.touch.active, enabled: window.__ctx.touch.enabled }));
    check('desktop: no touch layer, no body.touch, touch source idle', !r.layer && !r.touchClass && !r.active && !r.enabled, JSON.stringify(r));
    check('desktop: no console errors', errs.length === 0, errs.slice(0, 3).join(' | '));
  } finally { await browser.close(); }
}

// ---------------------------------------------------------------------------------------------------------------- touch
async function touchRun() {
  const { browser, page, errs } = await launch(true);
  const cdp = await page.createCDPSession();
  const pts = new Map();
  // Input.dispatchTouchEvent takes only the point that changes: the new finger for touchStart, the moved one for touchMove, the lifted one for touchEnd
  const dispatch = (type, id, p) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: [{ x: p.x, y: p.y, id, radiusX: 12, radiusY: 12, force: 1 }] });
  const down = async (id, x, y) => { pts.set(id, { x, y }); await dispatch('touchStart', id, pts.get(id)); };
  const move = async (id, x, y) => { pts.set(id, { x, y }); await dispatch('touchMove', id, pts.get(id)); };
  const up = async (id) => { const p = pts.get(id); pts.delete(id); await dispatch('touchEnd', id, p); };
  const upAll = async () => { for (const id of [...pts.keys()]) await up(id); };
  const slideTo = async (id, x, y, steps = 6) => {
    const p = pts.get(id);
    for (let i = 1; i <= steps; i++) { await move(id, p.x + ((x - p.x) * i) / steps, p.y + ((y - p.y) * i) / steps); await sleep(16); }
  };
  const ev = (fn, ...a) => page.evaluate(fn, ...a);
  const rec = () => ev(() => JSON.parse(JSON.stringify(window.__rec)));
  const resetRec = () => ev(() => window.__rec.reset());

  try {
    await page.goto(gameUrl(port, { touch: 1, autostart: 1, level: 0, god: 1 }), { waitUntil: 'load' });
    await page.waitForFunction(() => window.__ctx && window.__ctx.state.phase === 'playing' && window.__ctx.touch && window.__ctx.touch.enabled, { timeout: 60000 });
    // wait until the level intro is over: the ship takes input and the HUD is fully on
    await page.waitForFunction(() => { const c = window.__ctx; return c.state.levelTime > 1 && !c.cinema.lockInput && c.cinema.hudAlpha > 0.99; }, { timeout: 60000, polling: 100 });

    // recorder: wraps input.update (outermost) and counts what the game saw
    await ev(() => {
      const c = window.__ctx, inp = c.input, orig = inp.update;
      const R = window.__rec = {
        reset() { Object.assign(R, { frames: 0, fire: 0, firePressed: 0, fireReleased: 0, boost: 0, brake: 0, bomb: 0, rollL: 0, rollR: 0, pause: 0, axMax: -9, axMin: 9, ayMax: -9, ayMin: 9, rollMax: 0, shots: 0, offMoved: 0 }); R._off0 = c.player.localOffset.x; },
      };
      R.reset();
      inp.update = function (...a) {
        const r = orig.apply(this, a);
        R.frames++; if (this.fire) R.fire++; if (this.firePressed) R.firePressed++; if (this.fireReleased) R.fireReleased++;
        if (this.boost) R.boost++; if (this.brake) R.brake++; if (this.bomb) R.bomb++; if (this.rollLeft) R.rollL++; if (this.rollRight) R.rollR++; if (this.pause) R.pause++;
        R.axMax = Math.max(R.axMax, this.axis.x); R.axMin = Math.min(R.axMin, this.axis.x); R.ayMax = Math.max(R.ayMax, this.axis.y); R.ayMin = Math.min(R.ayMin, this.axis.y);
        R.rollMax = Math.max(R.rollMax, Math.abs(c.player.rollAngle));
        R.offMoved = c.player.localOffset.x - R._off0;
        return r;
      };
      c.events.on('player:fire', () => { R.shots++; });
    });
    const g = await ev(() => { const c = window.__ctx, t = c.touch; t.resize(); const rects = t.measure(); return { W: innerWidth, H: innerHeight, dpr: devicePixelRatio, ts: t.ts, btn: Object.fromEntries(rects.map((r) => [r.d.k, { x: r.cx, y: r.cy, r: r.r }])), pause: t.pauseRect, live: t.layer.classList.contains('on'), ios: document.body.classList.contains('ios'), touchCls: document.body.classList.contains('touch'), phone: document.body.classList.contains('phone') }; });
    console.log(`viewport ${g.W}x${g.H} dpr ${g.dpr} scale ${g.ts.toFixed(2)}  body.touch ${g.touchCls} body.phone ${g.phone}`);
    check('layer is live while playing', g.live && g.touchCls);
    const minBtn = Math.min(...Object.values(g.btn).map((b) => b.r * 2));
    check('every button is at least 44 CSS px', minBtn >= 44, `smallest ${minBtn.toFixed(1)} px`);
    const ps = g.pause; check('pause target is at least 44 px and top centre', ps.r - ps.l >= 44 && ps.b - ps.t >= 44 && Math.abs((ps.l + ps.r) / 2 - g.W / 2) < 2 && ps.t < 12, `${(ps.r - ps.l).toFixed(0)}x${(ps.b - ps.t).toFixed(0)} at y ${ps.t.toFixed(0)}`);
    // zone contract: every button centre inside the BUTTON CLUSTER (right 30 percent, below 35 percent of the height)
    const inCluster = Object.entries(g.btn).every(([, b]) => b.x - b.r >= g.W * 0.7 && b.y - b.r >= g.H * 0.35);
    check('buttons sit inside the button cluster zone', inCluster);
    await page.screenshot({ path: `${outDir}/01-idle.png` });

    // ---- dead zones: a touch in the middle of the screen or in the top left does nothing
    await down(9, g.W * 0.55, g.H * 0.6); await sleep(150);
    let st = await ev(() => ({ stick: window.__ctx.touch.stick.id, n: window.__ctx.touch.ptr.size, fire: window.__ctx.input.touch.fire }));
    await up(9);
    await down(8, 100, 30); await sleep(150);
    const st2 = await ev(() => ({ stick: window.__ctx.touch.stick.id, n: window.__ctx.touch.ptr.size }));
    await up(8);
    check('touches outside both zones are ignored', st.stick < 0 && st.n === 0 && st2.stick < 0 && st2.n === 0, JSON.stringify([st, st2]));

    // ---- two thumbs: steer (up and right) plus fire at the same time
    await resetRec();
    const fire = g.btn.fire;
    await down(1, 130, 270);
    await down(2, fire.x, fire.y);
    await slideTo(1, 130 + 50, 270 - 30);
    await sleep(700);
    let r = await rec();
    const live = await ev(() => { const t = window.__ctx.touch, i = window.__ctx.input; return { stickX: t.stick.x, stickY: t.stick.y, axis: { ...i.axis }, fire: i.fire, off: window.__ctx.player.localOffset.x, ringOn: t.stickEl.classList.contains('on'), fireOn: t.btn.fire.classList.contains('on') }; });
    check('steering: stick right and up moves the axis right and up', live.axis.x > 0.3 && live.axis.y > 0.1, `axis ${live.axis.x.toFixed(2)},${live.axis.y.toFixed(2)} stick ${live.stickX.toFixed(2)},${live.stickY.toFixed(2)}`);
    check('two fingers at once: fire is held while steering', live.fire && r.fire > 10, `fire frames ${r.fire}`);
    check('the ship really moved sideways', r.offMoved > 0.5, `localOffset.x +${r.offMoved.toFixed(2)}`);
    check('the ship really fired', r.shots >= 3, `${r.shots} volleys`);
    check('pressed state is visible on the ring and on FIRE', live.ringOn && live.fireOn);
    await page.screenshot({ path: `${outDir}/02-stick-and-fire.png` });

    // ---- long hold keeps firing with one press edge (the charge logic keys off the same held flag as a pad)
    await sleep(1500);
    r = await rec();
    const hold = await ev(() => ({ hold: window.__ctx.player._hold, fire: window.__ctx.input.fire }));
    check('long fire hold: still held after 2+ s, a single press edge', hold.fire && r.firePressed === 1 && hold.hold > 1.2, `press edges ${r.firePressed}, hold ${Number(hold.hold).toFixed(2)} s`);
    await up(2);
    await sleep(250);
    r = await rec();
    const after = await ev(() => window.__ctx.input.fire);
    check('releasing the thumb releases fire (one release edge)', !after && r.fireReleased === 1, `release edges ${r.fireReleased}`);

    // ---- stick release centres the axis and hides the ring
    await up(1);
    await sleep(700);
    const cen = await ev(() => ({ x: window.__ctx.input.axis.x, y: window.__ctx.input.axis.y, ring: window.__ctx.touch.stickEl.classList.contains('on') }));
    check('releasing the stick recentres the axis and fades the ring', Math.abs(cen.x) < 0.05 && Math.abs(cen.y) < 0.05 && !cen.ring, `axis ${cen.x.toFixed(3)},${cen.y.toFixed(3)}`);

    // ---- a stick deflection below the deadzone does nothing, a full one saturates
    await resetRec();
    await down(3, 120, 280); await slideTo(3, 120 + 5, 280); await sleep(300);
    const small = await ev(() => window.__ctx.input.axis.x);
    await slideTo(3, 120 + 70, 280); await sleep(500);
    const full = await ev(() => window.__ctx.input.axis.x);
    await up(3); await sleep(400);
    check('stick deadzone ignores a 5 px nudge, full throw reaches about 1', Math.abs(small) < 0.02 && full > 0.85, `nudge ${small.toFixed(3)}, full ${full.toFixed(2)}`);

    // ---- bomb
    const bombs0 = await ev(() => window.__ctx.state.bombs);
    await resetRec();
    await down(4, g.btn.bomb.x, g.btn.bomb.y); await sleep(120); await up(4); await sleep(400);
    r = await rec();
    const bombs1 = await ev(() => window.__ctx.state.bombs);
    check('bomb: one pulse, a bomb is spent', r.bomb === 1 && bombs1 === bombs0 - 1, `pulses ${r.bomb}, bombs ${bombs0} -> ${bombs1}`);

    // ---- boost and brake
    await resetRec();
    await down(5, g.btn.boost.x, g.btn.boost.y); await sleep(700);
    const bo = await ev(() => ({ amt: window.__ctx.player.boostAmount, on: window.__ctx.touch.btn.boost.classList.contains('on') }));
    await page.screenshot({ path: `${outDir}/03-boost.png` });
    await up(5); await sleep(300);
    r = await rec();
    check('boost: held while the thumb is down', r.boost > 10 && bo.amt > 0.3 && bo.on, `frames ${r.boost}, boostAmount ${bo.amt.toFixed(2)}`);
    await sleep(600);
    await resetRec();
    await down(5, g.btn.brake.x, g.btn.brake.y); await sleep(700);
    const br = await ev(() => ({ amt: window.__ctx.player.brakeAmount }));
    await up(5); await sleep(300);
    r = await rec();
    check('brake: held while the thumb is down', r.brake > 10 && br.amt > 0.3, `frames ${r.brake}, brakeAmount ${br.amt.toFixed(2)}`);

    // ---- rolls (pulse, the ship rolls), then the other side after its cooldown
    await sleep(800);
    await resetRec();
    await down(6, g.btn.rollL.x, g.btn.rollL.y); await sleep(100); await up(6); await sleep(900);
    r = await rec();
    check('roll L: one pulse and the ship rolls', r.rollL === 1 && r.rollR === 0 && r.rollMax > 0.5, `pulses ${r.rollL}, max angle ${r.rollMax.toFixed(2)}`);
    await sleep(900);
    await resetRec();
    await down(6, g.btn.rollR.x, g.btn.rollR.y); await sleep(100); await up(6); await sleep(900);
    r = await rec();
    check('roll R: one pulse and the ship rolls', r.rollR === 1 && r.rollL === 0 && r.rollMax > 0.5, `pulses ${r.rollR}, max angle ${r.rollMax.toFixed(2)}`);

    // ---- sliding from FIRE onto BOOST without lifting, and a pulse button is never triggered by sliding
    await resetRec();
    await down(7, g.btn.fire.x, g.btn.fire.y); await sleep(200);
    await slideTo(7, g.btn.boost.x, g.btn.boost.y, 10); await sleep(300);
    const sl = await ev(() => ({ fire: window.__ctx.input.touch.fire, boost: window.__ctx.input.touch.boost }));
    await slideTo(7, g.btn.bomb.x, g.btn.bomb.y, 10); await sleep(200);
    r = await rec();
    await up(7); await sleep(200);
    check('sliding from FIRE to BOOST switches the held button', !sl.fire && sl.boost, JSON.stringify(sl));
    check('sliding over BOMB does not spend a bomb', r.bomb === 0, `pulses ${r.bomb}`);

    // ---- autopilot (showcase) wins over touch
    await down(10, 120, 280); await slideTo(10, 120 + 60, 280); await sleep(300);
    await ev(() => { window.__ctx.input.autopilot = { axis: { x: -1, y: 0 }, fire: false }; });
    await sleep(250);
    const ap = await ev(() => ({ x: window.__ctx.input.axis.x, fire: window.__ctx.input.fire }));
    await ev(() => { window.__ctx.input.autopilot = null; });
    await up(10); await sleep(400);
    check('autopilot keeps winning over touch', ap.x === -1 && !ap.fire, JSON.stringify(ap));

    // ---- gamepad hides the controls
    await ev(() => { window.__ctx.input.usingGamepad = true; });
    await sleep(250);
    const gp = await ev(() => ({ on: window.__ctx.touch.layer.classList.contains('on'), active: window.__ctx.input.touch.active }));
    await ev(() => { window.__ctx.input.usingGamepad = false; });
    await sleep(250);
    const gp2 = await ev(() => window.__ctx.touch.layer.classList.contains('on'));
    check('controls hide once a gamepad reports input, and return', !gp.on && !gp.active && gp2, JSON.stringify(gp));

    // ---- cinema takeovers fade the controls with the HUD
    const fade = await ev(() => {
      const c = window.__ctx, t = c.touch, was = c.cinema.hudAlpha;
      c.cinema.hudAlpha = 0; t.update(0.016, c);
      const faded = { a: t.alpha, v: t.layer.style.getPropertyValue('--tctl-a') };
      // a new finger on a button while faded out is ignored
      c.cinema.hudAlpha = was; t.update(0.016, c);
      return { faded, back: t.alpha };
    });
    check('cinema fade: alpha follows hudAlpha to 0 and back', fade.faded.a === 0 && fade.back > 0.99, JSON.stringify(fade));

    // ---- pause button: a tap pauses, the layer hides, a held finger is released
    await resetRec();
    await down(11, 120, 280); await slideTo(11, 120 + 40, 280);
    await down(12, g.btn.fire.x, g.btn.fire.y); await sleep(250);
    const pc = { x: (g.pause.l + g.pause.r) / 2, y: (g.pause.t + g.pause.b) / 2 };
    await down(13, pc.x, pc.y); await sleep(120);
    const pressed = await ev(() => window.__ctx.touch.pauseEl.classList.contains('on'));
    await up(13); await sleep(500);
    const pz = await ev(() => { const c = window.__ctx, t = c.touch; return { phase: c.state.phase, on: t.layer.classList.contains('on'), fire: c.input.touch.fire, sx: c.input.touch.x, ptr: t.ptr.size, held: t.holders.fire.size }; });
    check('pause button: a tap pauses, pressed state shows', pz.phase === 'paused' && pressed, JSON.stringify(pz));
    check('pausing hides the layer and releases every finger', !pz.on && !pz.fire && pz.sx === 0 && pz.ptr === 0 && pz.held === 0);
    await page.screenshot({ path: `${outDir}/04-paused.png` });
    await upAll();
    await ev(() => window.__ctx.game.resume());
    await sleep(600);
    const back = await ev(() => ({ phase: window.__ctx.state.phase, on: window.__ctx.touch.layer.classList.contains('on'), fire: window.__ctx.input.fire }));
    check('resume brings the controls back with nothing stuck', back.phase === 'playing' && back.on && !back.fire, JSON.stringify(back));

    // ---- release on blur: fingers down, the page loses focus
    await down(14, 120, 280); await slideTo(14, 120 + 40, 280);
    await down(15, g.btn.fire.x, g.btn.fire.y); await sleep(300);
    const preBlur = await ev(() => window.__ctx.input.fire);
    await ev(() => window.dispatchEvent(new Event('blur')));
    await sleep(400);
    const bl = await ev(() => { const c = window.__ctx, t = c.touch; return { phase: c.state.phase, fire: c.input.fire, tf: c.input.touch.fire, sid: t.stick.id, ptr: t.ptr.size, ax: c.input.axis.x }; });
    check('blur releases stick and buttons (and pauses)', preBlur && bl.phase === 'paused' && !bl.fire && !bl.tf && bl.sid < 0 && bl.ptr === 0 && Math.abs(bl.ax) < 0.05, JSON.stringify(bl));
    await upAll();
    await ev(() => window.__ctx.game.resume());
    await sleep(500);

    // ---- title and menus: no layer
    await ev(() => window.__ctx.game.toTitle());
    await sleep(600);
    const ti = await ev(() => ({ phase: window.__ctx.state.phase, on: window.__ctx.touch.layer.classList.contains('on') }));
    check('controls are off on the title screen', ti.phase === 'title' && !ti.on, JSON.stringify(ti));

    check('no console errors on emulated touch', errs.length === 0, errs.slice(0, 4).join(' | '));
  } catch (e) {
    check('test run completed', false, String(e && e.stack ? e.stack.split('\n').slice(0, 3).join(' / ') : e));
  } finally { await browser.close(); }
}

try {
  await desktopCheck();
  await touchRun();
} catch (e) { console.error(e); process.exit(2); }
const failed = results.filter((x) => !x.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
