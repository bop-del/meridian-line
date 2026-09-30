// Feel regression bot. Drives scripted scenarios through ctx.game.step with deterministic input (real key events, fixed 1/60 s
// steps, the render loop paused) and checks the results against budgets in tools/feel-budgets.json.
// Usage: node tools/feelbot.mjs <port> <outDir> [budgets.json] [--preset=name] [--set=group.key=value,group.key=value]
// --preset and --set run the same scenarios on another feel setup (the page is opened with ?tune=1 and the values applied first).
// Prints a PASS/FAIL table, writes <outDir>/feelbot.json, exits non-zero when any check fails.
//
// Checks: no NaN in ship or camera, lateral response time and overshoot, settle time, bank returns to zero, camera never inside
// the ship or flipped, camera lag under a hard turn, roll finishes at exactly 0, boost and brake reach speed and return, fov
// returns to base after boost, shake stays under its caps and decays to zero, hit-stop restores the time scale to 1.
import puppeteer from 'puppeteer-core';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';

const argv = process.argv.slice(2);
const opts = argv.filter((a) => a.startsWith('--'));
const [port, outDir = '.', budgetPath] = argv.filter((a) => !a.startsWith('--'));
const optPreset = (opts.find((a) => a.startsWith('--preset=')) || '').slice(9);
const optSet = (opts.find((a) => a.startsWith('--set=')) || '').slice(6);
if (!port) { console.error('usage: node tools/feelbot.mjs <port> <outDir> [budgets.json]'); process.exit(2); }
mkdirSync(outDir, { recursive: true });
const B = JSON.parse(readFileSync(budgetPath || new URL('./feel-budgets.json', import.meta.url), 'utf8'));

// ---------------------------------------------------------------------------------------------------------------- page side
// Everything in this function runs inside the game page. It installs window.__bot with the scenarios.
function harness() {
  const ctx = window.__ctx;
  const DT = 1 / 60;
  const R2D = 180 / Math.PI;
  const bot = window.__bot = { bad: [], minShipDist: Infinity, minUpY: Infinity, maxFwdZ: -Infinity, frames: 0 };
  const T = ctx.THREE;
  const up = new T.Vector3(), fwd = new T.Vector3();
  const pl = ctx.player, rig = ctx.cameraRig, cam = ctx.camera, rail = ctx.rail;

  const key = (code, on) => window.dispatchEvent(new KeyboardEvent(on ? 'keydown' : 'keyup', { code, key: code, bubbles: true }));
  const finite = (label, ...vals) => { for (const v of vals) if (!Number.isFinite(v)) { if (bot.bad.length < 20) bot.bad.push(`${label}=${v}`); return false; } return true; };
  const clean = () => {
    if (ctx.groups.enemies.length) ctx.enemies.killAll?.();
    for (const k of ['obstacles', 'enemyShots']) for (const o of ctx.groups[k].slice()) { try { o.destroy?.(ctx); } catch (e) { /* ignore */ } }
  };
  const check = () => {
    bot.frames++;
    const p = pl.position, q = cam.quaternion;
    finite('player.position', p.x, p.y, p.z);
    finite('player.localOffset', pl.localOffset.x, pl.localOffset.y);
    finite('player.localVelocity', pl.localVelocity.x, pl.localVelocity.y);
    finite('player.bank', pl.bank, pl.rollAngle);
    finite('camera.position', cam.position.x, cam.position.y, cam.position.z);
    finite('camera.quaternion', q.x, q.y, q.z, q.w);
    finite('camera.fov', cam.fov);
    finite('rail.speed', rail.speed);
    finite('impact', ctx.impact.offset.x, ctx.impact.offset.y, ctx.impact.offset.z, ctx.impact.roll);
    finite('timeScale', ctx.timeScale);
    if (rig.mode === 'chase' && ctx.state.phase === 'playing') {
      bot.minShipDist = Math.min(bot.minShipDist, cam.position.distanceTo(p));
      up.set(0, 1, 0).applyQuaternion(q); fwd.set(0, 0, -1).applyQuaternion(q);
      bot.minUpY = Math.min(bot.minUpY, up.y);
      bot.maxFwdZ = Math.max(bot.maxFwdZ, fwd.z);
    }
  };
  const step = (n = 1) => { for (let i = 0; i < n; i++) { ctx.game.step(DT, false); clean(); check(); } };
  const secs = (s) => Math.round(s / DT);
  const settle = (s) => { for (const k of ['KeyA', 'KeyD', 'KeyW', 'KeyS', 'KeyQ', 'KeyE', 'ShiftLeft', 'KeyC']) key(k, false); step(secs(s)); };
  const snap = () => ({
    ox: pl.localOffset.x, oy: pl.localOffset.y, vx: pl.localVelocity.x, vy: pl.localVelocity.y,
    bankDeg: (pl.bankAngle ?? NaN) * R2D, pitchDeg: (pl.pitchAngle ?? NaN) * R2D, yawDeg: (pl.yawAngle ?? NaN) * R2D,
    rollAngle: pl.rollAngle, rolling: pl.isRolling, rs: rail.speed, fov: cam.fov, lag: rig.lag ?? 0,
    ts: ctx.timeScale, sh: ctx.impact.offset.length(), shr: Math.abs(ctx.impact.roll), camRollDeg: (rig.roll ?? 0) * R2D,
  });
  const firstIdx = (arr, fn) => { for (let i = 0; i < arr.length; i++) if (fn(arr[i], i)) return i; return -1; };

  bot.start = () => {
    // wait for the level to be running and the intro to be over, then stop the render loop so only scripted steps advance the game
    const raf = window.requestAnimationFrame.bind(window);
    window.requestAnimationFrame = (cb) => (window.__hold ? 0 : raf(cb));
    window.__hold = true;
    let guard = 0;
    while ((ctx.state.phase !== 'playing' || rig.mode !== 'chase') && guard++ < 1200) step(1);
    ctx.state.god = true;
    settle(2);
    return { phase: ctx.state.phase, mode: rig.mode, hasStamp: typeof ctx.input.stamp === 'number', hasLag: typeof rig.lag === 'number', hasBankAngle: typeof pl.bankAngle === 'number' };
  };

  // hold one steering key from a start offset; measure response, overshoot, settle, attitude, camera lag
  bot.axisTest = ({ code, axis, start, hold, total }) => {
    settle(4);
    const v = axis === 'x' ? 'vx' : 'vy', o = axis === 'x' ? 'ox' : 'oy';
    pl.localOffset.set(axis === 'x' ? start : 0, axis === 'y' ? start : 0);
    pl.localVelocity.set(0, 0);
    settle(4.5);
    const s0 = snap();
    const dir = Math.sign(code === 'KeyD' || code === 'KeyW' ? 1 : -1);
    const N = secs(total), H = secs(hold), S = [];
    key(code, true);
    for (let i = 0; i < N; i++) {
      if (i === H) key(code, false);
      step(1);
      S.push(snap());
    }
    key(code, false);
    const vel = S.map((s) => s[v] * dir);
    const holdVel = vel.slice(0, H);
    const vPeak = Math.max(...holdVel);
    const plateau = holdVel.slice(-6).reduce((a, b) => a + b, 0) / 6;
    const iMove = firstIdx(vel, (x) => Math.abs(x) > 0.05);
    const i90 = firstIdx(holdVel, (x) => x >= 0.9 * plateau);
    const after = vel.slice(H);
    const minAfter = Math.min(...after);
    const iSettle = firstIdx(after, (x, i) => Math.abs(x) < 0.5 && after.slice(i).every((y) => Math.abs(y) < 0.5));
    const banks = S.map((s) => Math.abs(s.bankDeg)).filter(Number.isFinite);
    const lags = S.map((s) => s.lag);
    const endSnap = S[S.length - 1];
    const coast = (S[S.length - 1][o] - S[H - 1][o]) * dir;
    // camera settles after the input ends
    settle(5);
    const fin = snap();
    return {
      firstMoveFrames: iMove < 0 ? null : iMove + 1,
      t90: i90 < 0 ? null : (i90 + 1) * DT,
      plateau, vPeak,
      overshootPct: plateau > 0.5 ? Math.max(0, (vPeak - plateau) / plateau * 100) : null,
      reverseOvershootPct: vPeak > 0.5 ? Math.max(0, -minAfter) / vPeak * 100 : null,
      settleT: iSettle < 0 ? null : (iSettle) * DT,
      coast,
      maxBankDeg: banks.length ? Math.max(...banks) : null,
      maxLag: Math.max(...lags),
      startOffset: s0[o], endOffset: endSnap[o],
      finalBankDeg: fin.bankDeg, finalPitchDeg: fin.pitchDeg, finalYawDeg: fin.yawDeg, finalLag: fin.lag, finalCamRollDeg: fin.camRollDeg,
    };
  };

  bot.speedTest = ({ code, kind }) => {
    settle(4);
    const base = snap();
    const boostT = rail.baseSpeed * (rail.boostSpeed ?? ctx.config.rail.boostSpeed) / ctx.config.rail.baseSpeed;
    const brakeT = rail.baseSpeed * (rail.brakeSpeed ?? ctx.config.rail.brakeSpeed) / ctx.config.rail.baseSpeed;
    const target = kind === 'boost' ? boostT : brakeT;
    const sgn = kind === 'boost' ? 1 : -1;
    ctx.state.boost = 1;
    const S = [];
    key(code, true);
    const H = secs(2.6);
    for (let i = 0; i < H; i++) { ctx.state.boost = 1; step(1); S.push(snap()); }
    key(code, false);
    const R = secs(9), S2 = [];
    for (let i = 0; i < R; i++) { step(1); S2.push(snap()); }
    const frac = (s) => (s.rs - base.rs) / (target - base.rs);
    const i90 = firstIdx(S, (s) => frac(s) >= 0.9);
    const peak = sgn > 0 ? Math.max(...S.map((s) => s.rs)) : Math.min(...S.map((s) => s.rs));
    const lastOut = (arr, fn) => { let k = -1; arr.forEach((s, i) => { if (fn(s)) k = i; }); return k; };
    const iRet = lastOut(S2, (s) => Math.abs(s.rs - base.rs) > 0.03 * base.rs);
    const iFov = lastOut(S2, (s) => Math.abs(s.fov - base.fov) > 0.3);
    const fin = S2[S2.length - 1];
    return {
      baseSpeed: base.rs, target, peak, reachT: i90 < 0 ? null : (i90 + 1) * DT,
      fovBase: base.fov, fovPeak: Math.max(...S.map((s) => s.fov)), fovMin: Math.min(...S.map((s) => s.fov)),
      returnT: iRet + 1 >= S2.length ? null : (iRet + 1) * DT,
      fovReturnT: iFov + 1 >= S2.length ? null : (iFov + 1) * DT,
      finalSpeedErr: Math.abs(fin.rs - base.rs) / base.rs, finalFovErr: Math.abs(fin.fov - base.fov),
      maxLag: Math.max(...S.concat(S2).map((s) => s.lag)),
    };
  };

  bot.boostSteer = () => {
    settle(3);
    pl.localOffset.set(-6, 0);
    settle(3);
    ctx.state.boost = 1;
    key('ShiftLeft', true); key('KeyD', true);
    for (let i = 0; i < secs(1.6); i++) { ctx.state.boost = 1; step(1); }
    key('ShiftLeft', false); key('KeyD', false);
    key('KeyA', true); step(secs(0.6)); key('KeyA', false);
    settle(4);
    return { ok: true };
  };

  bot.rollTest = ({ code }) => {
    settle(4);
    pl.localOffset.set(0, 0); pl.localVelocity.set(0, 0);
    settle(3);
    const x0 = pl.localOffset.x;
    let started = false, frames = 0, peak = 0, maxVx = 0;
    key(code, true); step(3); key(code, false);
    for (let i = 0; i < secs(3); i++) {
      if (pl.isRolling) { started = true; frames++; }
      peak = Math.max(peak, Math.abs(pl.rollAngle));
      maxVx = Math.max(maxVx, Math.abs(pl.localVelocity.x));
      if (started && !pl.isRolling) break;
      step(1);
    }
    step(1);
    const endAngle = pl.rollAngle, endRolling = pl.isRolling;
    const disp = pl.localOffset.x - x0;
    settle(4);
    const fin = snap();
    return { started, duration: frames * DT, peakAngleDeg: peak * R2D, endAngle, endRolling, displacement: disp, maxVx, finalBankDeg: fin.bankDeg };
  };

  // taps: list of [code, downFrames, gapFrames]; returns whether a roll started
  const tapSeq = (seq) => {
    let rolled = false;
    for (const [code, d, g] of seq) {
      key(code, true); for (let i = 0; i < d; i++) { step(1); rolled ||= pl.isRolling; }
      key(code, false); for (let i = 0; i < g; i++) { step(1); rolled ||= pl.isRolling; }
    }
    for (let i = 0; i < 60; i++) { step(1); rolled ||= pl.isRolling; }
    return rolled;
  };
  bot.tapTest = () => {
    const out = {};
    settle(4); pl.localOffset.set(0, 0); settle(3);
    // steering, then a quick re-press right after: must not roll
    key('KeyD', true); step(secs(0.5)); key('KeyD', false); step(6);
    out.accidentalSteerTap = tapSeq([['KeyD', 5, 4], ['KeyD', 5, 4]]);
    settle(5); pl.localOffset.set(0, 0); settle(3);
    // rapid corrective taps left and right: must not roll
    out.accidentalCorrective = tapSeq([['KeyA', 4, 3], ['KeyD', 4, 3], ['KeyA', 4, 3], ['KeyD', 4, 3]]);
    settle(6); pl.localOffset.set(0, 0); settle(3);
    // a deliberate double tap after a quiet second
    out.deliberateRolls = tapSeq([['KeyD', 6, 6], ['KeyD', 6, 6]]);
    settle(5);
    out.doubleTapOn = (ctx.feel.p.handling?.doubleTap ?? 1) > 0.5;
    return out;
  };

  const KINDS = ['hit', 'blast', 'boss', 'roll', 'death', 'fx', 'charge', 'reflect'];
  const trace = (secsMax) => {
    let peak = 0, peakRoll = 0, lastAbove = -1;
    const n = secs(secsMax);
    for (let i = 0; i < n; i++) {
      step(1);
      const m = ctx.impact.offset.length(), r = Math.abs(ctx.impact.roll);
      peak = Math.max(peak, m); peakRoll = Math.max(peakRoll, r);
      if (m > 1e-4 || r > 1e-5) lastAbove = i;
    }
    return { peak, peakRollDeg: peakRoll * R2D, decayT: (lastAbove + 1) * DT, residual: ctx.impact.offset.length() + Math.abs(ctx.impact.roll) };
  };
  bot.shakeTest = () => {
    const out = {};
    settle(3);
    for (const kind of KINDS) { ctx.impact.addShake(1, 0.8, kind); out[kind] = trace(8); settle(0.5); }
    for (let i = 0; i < 16; i++) ctx.impact.addShake(1, 0.8, KINDS[i % KINDS.length]);
    out.stacked = trace(10);
    const hp = () => new T.Vector3(-3, 0.5, -5).add(pl.position);
    ctx.events.emit('player:damage', { amount: 30, source: 'bot', position: hp(), health: ctx.state.health, maxHealth: ctx.state.maxHealth });
    out.eventDamage30 = trace(8);
    ctx.events.emit('boss:phase', {});
    out.eventBossPhase = trace(8);
    ctx.events.emit('bomb:detonate', { position: pl.position.clone() });
    out.eventBomb = trace(8);
    settle(2);
    return out;
  };

  const stopTrace = (secsMax) => {
    let stopped = 0, minTs = 1, last = -1;
    const n = secs(secsMax);
    for (let i = 0; i < n; i++) {
      step(1);
      stopped += (1 - ctx.timeScale) * DT; minTs = Math.min(minTs, ctx.timeScale);
      if (ctx.timeScale < 1) last = i;
    }
    return { stopped, minTs, restoreT: (last + 1) * DT, finalTs: ctx.timeScale };
  };
  bot.hitStopTest = () => {
    const out = {};
    settle(3);
    const dmg = (a) => ctx.events.emit('player:damage', { amount: a, source: 'bot', position: new T.Vector3(3, 0.5, -5).add(pl.position), health: ctx.state.health, maxHealth: ctx.state.maxHealth });
    const cases = {
      direct: () => ctx.game.hitStop(0.3, 0.05),
      damage10: () => dmg(10),
      damage30: () => dmg(30),
      fxEvent: () => ctx.events.emit('fx:hitstop', { duration: 0.3 }),
      impactCall: () => ctx.impact.hitStop(0.3, 0.05),
      bossPhase: () => ctx.events.emit('boss:phase', {}),
      bomb: () => ctx.events.emit('bomb:detonate', { position: pl.position.clone() }),
    };
    for (const [name, fn] of Object.entries(cases)) { settle(1.5); fn(); out[name] = stopTrace(3); }
    settle(1.5);
    for (let i = 0; i < 24; i++) { ctx.game.hitStop(0.5, 0.02); step(1); }
    out.burst = stopTrace(5);
    return out;
  };

  bot.summary = () => ({ bad: bot.bad, minShipDist: bot.minShipDist, minUpY: bot.minUpY, maxFwdZ: bot.maxFwdZ, frames: bot.frames });
  return true;
}

// ---------------------------------------------------------------------------------------------------------------- node side
const browser = await puppeteer.launch({
  executablePath: process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: 'new',
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--window-size=1280,720'], defaultViewport: { width: 1280, height: 720 },
});
const page = await browser.newPage();
const errs = [];
page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
page.on('pageerror', (e) => errs.push('PAGEERR ' + e.message));
await page.goto(`http://localhost:${port}/?autostart=1&level=0&god=1&telemetry=1${optPreset || optSet ? '&tune=1' : ''}`, { waitUntil: 'load' });
await page.waitForFunction(() => window.__ctx && window.__ctx.state && window.__ctx.state.phase === 'playing', { timeout: 60000 });
if (optPreset || optSet) {
  const applied = await page.evaluate((preset, set) => {
    const f = window.__ctx.feel;
    if (preset && !f.applyPreset(preset)) return `unknown preset ${preset} (have: ${Object.keys(f.presets).join(', ')})`;
    for (const kv of set ? set.split(',') : []) { const [path, v] = kv.split('='); if (!f.set(path, Number(v))) return `unknown value ${path}`; }
    return 'ok';
  }, optPreset, optSet);
  if (applied !== 'ok') { console.error('feelbot:', applied); await browser.close(); process.exit(2); }
  console.log(`feel setup: ${optPreset ? 'preset ' + optPreset : 'defaults'}${optSet ? ', set ' + optSet : ''}`);
}
await page.evaluate(harness);
const setup = await page.evaluate(() => window.__bot.start());
const run = (name, arg) => page.evaluate((n, a) => window.__bot[n](a), name, arg);

const R = {};
R.left = await run('axisTest', { code: 'KeyA', axis: 'x', start: 10, hold: 0.6, total: 3.5 });
R.right = await run('axisTest', { code: 'KeyD', axis: 'x', start: -10, hold: 0.6, total: 3.5 });
R.up = await run('axisTest', { code: 'KeyW', axis: 'y', start: -5, hold: 0.4, total: 3.5 });
R.down = await run('axisTest', { code: 'KeyS', axis: 'y', start: 5, hold: 0.4, total: 3.5 });
R.boost = await run('speedTest', { code: 'ShiftLeft', kind: 'boost' });
R.brake = await run('speedTest', { code: 'KeyC', kind: 'brake' });
R.boostSteer = await run('boostSteer');
R.rollQ = await run('rollTest', { code: 'KeyQ' });
R.rollE = await run('rollTest', { code: 'KeyE' });
R.taps = await run('tapTest');
R.shake = await run('shakeTest');
R.hitstop = await run('hitStopTest');
R.summary = await page.evaluate(() => window.__bot.summary());
R.telemetry = await page.evaluate(() => window.__telemetry?.report?.() ?? null);
await browser.close();

// ---- checks
const rows = [];
const fmt = (v) => (v == null ? 'n/a' : typeof v === 'number' ? (Math.abs(v) >= 100 ? v.toFixed(0) : Math.abs(v) < 0.001 && v !== 0 ? v.toExponential(1) : +v.toFixed(3)).toString() : String(v));
const add = (name, value, op, budget, unit = '') => {
  let status;
  if (value == null || Number.isNaN(value)) status = 'SKIP';
  else if (op === '<=') status = value <= budget ? 'PASS' : 'FAIL';
  else if (op === '>=') status = value >= budget ? 'PASS' : 'FAIL';
  else if (op === '==') status = value === budget ? 'PASS' : 'FAIL';
  rows.push({ name, value: fmt(value) + unit, budget: `${op} ${fmt(budget)}${unit}`, status });
};
const info = (name, value, note = '') => rows.push({ name, value: fmt(value), budget: note, status: 'INFO' });
const warn = (name, ok, note) => rows.push({ name, value: ok ? 'yes' : 'no', budget: note, status: ok ? 'PASS' : 'WARN' });

add('page errors', errs.length, '==', 0);
add('no NaN or Infinity in ship or camera', R.summary.bad.length, '==', 0);
if (R.summary.bad.length) info('  first bad values', R.summary.bad.slice(0, 4).join(', '));
info('frames stepped', R.summary.frames);
info('input.stamp present', setup.hasStamp ? 'yes' : 'no');

for (const [name, key] of [['left', 'left'], ['right', 'right']]) {
  const r = R[key], b = B.lateral;
  add(`lateral ${name}: frames to first move`, r.firstMoveFrames, '<=', b.firstMoveFramesMax);
  add(`lateral ${name}: time to 90% speed`, r.t90, '<=', b.t90Max, ' s');
  add(`lateral ${name}: overshoot`, r.overshootPct, '<=', b.overshootPctMax, ' %');
  add(`lateral ${name}: reverse swing after release`, r.reverseOvershootPct, '<=', b.reverseOvershootPctMax, ' %');
  add(`lateral ${name}: settle time after release`, r.settleT, '<=', b.settleMax, ' s');
  info(`lateral ${name}: coast after release`, r.coast, 'units');
}
add('lateral left/right asymmetry (t90)', R.left.t90 != null && R.right.t90 != null ? Math.abs(R.left.t90 - R.right.t90) : null, '<=', B.lateral.symmetryTol, ' s');
for (const key of ['up', 'down']) {
  const r = R[key], b = B.vertical;
  add(`vertical ${key}: frames to first move`, r.firstMoveFrames, '<=', b.firstMoveFramesMax);
  add(`vertical ${key}: time to 90% speed`, r.t90, '<=', b.t90Max, ' s');
  add(`vertical ${key}: settle time after release`, r.settleT, '<=', b.settleMax, ' s');
}
for (const key of ['left', 'right', 'up', 'down']) {
  const r = R[key];
  add(`bank ${key}: returns to zero (roll)`, Math.abs(r.finalBankDeg), '<=', B.attitude.zeroTolDeg, ' deg');
  add(`bank ${key}: returns to zero (pitch)`, Math.abs(r.finalPitchDeg), '<=', B.attitude.zeroTolDeg, ' deg');
  add(`bank ${key}: returns to zero (yaw)`, Math.abs(r.finalYawDeg), '<=', B.attitude.zeroTolDeg, ' deg');
}
add('bank left: visible lean', R.left.maxBankDeg, '>=', B.attitude.minBankDeg, ' deg');
add('bank left: max lean', R.left.maxBankDeg, '<=', B.attitude.maxBankDeg, ' deg');
add('bank right: max lean', R.right.maxBankDeg, '<=', B.attitude.maxBankDeg, ' deg');
add('camera lag under a hard turn (left)', R.left.maxLag, '<=', B.camera.lagMax, ' u');
add('camera lag under a hard turn (right)', R.right.maxLag, '<=', B.camera.lagMax, ' u');
add('camera lag after the turn settles', Math.max(R.left.finalLag, R.right.finalLag, R.up.finalLag, R.down.finalLag), '<=', B.camera.lagSettledMax, ' u');
add('camera roll returns to zero', Math.max(Math.abs(R.left.finalCamRollDeg), Math.abs(R.right.finalCamRollDeg)), '<=', B.attitude.zeroTolDeg, ' deg');
add('camera never inside the ship (min distance)', R.summary.minShipDist, '>=', B.camera.minShipDist, ' u');
add('camera never flips (min up.y)', R.summary.minUpY, '>=', B.camera.minUpY);
add('camera always looks forward (max dir.z)', R.summary.maxFwdZ, '<=', B.camera.maxForwardZ);

for (const [name, r] of [['Q', R.rollQ], ['E', R.rollE]]) {
  add(`roll ${name}: started`, r.started ? 1 : 0, '==', 1);
  add(`roll ${name}: duration`, r.duration, '>=', B.roll.durationMin, ' s');
  add(`roll ${name}: duration`, r.duration, '<=', B.roll.durationMax, ' s');
  add(`roll ${name}: ends at exactly 0 rotation`, Math.abs(r.endAngle), '<=', B.roll.endTol);
  add(`roll ${name}: finished (not rolling)`, r.endRolling ? 1 : 0, '==', 0);
  add(`roll ${name}: bank returns to zero`, Math.abs(r.finalBankDeg), '<=', B.attitude.zeroTolDeg, ' deg');
  info(`roll ${name}: peak angle / side displacement`, `${fmt(r.peakAngleDeg)} deg / ${fmt(r.displacement)} u`);
}

for (const [name, r, b] of [['boost', R.boost, B.boost], ['brake', R.brake, B.brake]]) {
  add(`${name}: time to ${Math.round(b.reachFrac * 100)}% of target speed`, r.reachT, '<=', b.reachMax, ' s');
  add(`${name}: speed returns to base (within ${Math.round(b.returnTolFrac * 100)}%)`, r.returnT, '<=', b.returnMax, ' s');
  add(`${name}: final speed error`, r.finalSpeedErr, '<=', b.returnTolFrac);
  info(`${name}: base ${fmt(r.baseSpeed)}, target ${fmt(r.target)}, peak ${fmt(r.peak)}`, '', 'u/s');
}
add('boost: fov returns to base', R.boost.finalFovErr, '<=', B.boost.fovReturnTolDeg, ' deg');
add('boost: fov back within tolerance by', R.boost.fovReturnT, '<=', B.boost.fovReturnMax, ' s');
add('brake: fov returns to base', R.brake.finalFovErr, '<=', B.boost.fovReturnTolDeg, ' deg');
info('fov base / boost peak / brake min', `${fmt(R.boost.fovBase)} / ${fmt(R.boost.fovPeak)} / ${fmt(R.brake.fovMin)}`, 'deg');
add('boost lag (camera)', R.boost.maxLag, '<=', B.camera.lagMax, ' u');

if (R.taps.doubleTapOn) warn('deliberate double tap rolls', R.taps.deliberateRolls, 'only when double tap is on');
add('tap-tap after steering does not roll', R.taps.accidentalSteerTap ? 1 : 0, '==', 0);
add('rapid corrective taps do not roll', R.taps.accidentalCorrective ? 1 : 0, '==', 0);

for (const kind of ['hit', 'blast', 'boss', 'roll', 'death', 'fx', 'charge', 'reflect', 'stacked', 'eventDamage30', 'eventBossPhase', 'eventBomb']) {
  const r = R.shake[kind], b = B.shake;
  add(`shake ${kind}: peak offset`, r.peak, '<=', b.maxOffset, ' u');
  add(`shake ${kind}: peak roll`, r.peakRollDeg, '<=', b.maxRollDeg, ' deg');
  add(`shake ${kind}: decays to zero by`, r.decayT, '<=', b.decayMax, ' s');
  add(`shake ${kind}: residual`, r.residual, '<=', b.residual);
}
for (const [name, r] of Object.entries(R.hitstop)) {
  const b = B.hitstop;
  add(`hit-stop ${name}: timeScale restored to exactly 1`, r.finalTs, '==', 1);
  add(`hit-stop ${name}: restored within`, r.restoreT, '<=', name === 'burst' ? b.restoreMax * 2 : b.restoreMax, ' s');
  if (name !== 'burst' && name !== 'direct' && name !== 'impactCall') add(`hit-stop ${name}: total time lost`, r.stopped, '<=', b.stoppedTotalMax, ' s');
  else info(`hit-stop ${name}: total time lost / min scale`, `${fmt(r.stopped)} s / ${fmt(r.minTs)}`);
}

// ---- print
const w = Math.max(...rows.map((r) => r.name.length));
const w2 = Math.max(...rows.map((r) => r.value.length));
const w3 = Math.max(...rows.map((r) => r.budget.length));
console.log(`feelbot: ${rows.length} rows, level 0, 60 Hz steps, render loop paused`);
for (const r of rows) console.log(`${r.status.padEnd(4)}  ${r.name.padEnd(w)}  ${r.value.padStart(w2)}  ${r.budget.padEnd(w3)}`);
const fails = rows.filter((r) => r.status === 'FAIL');
const skips = rows.filter((r) => r.status === 'SKIP');
const warns = rows.filter((r) => r.status === 'WARN');
console.log(`\n${fails.length ? 'FAIL' : 'PASS'}: ${rows.filter((r) => r.status === 'PASS').length} passed, ${fails.length} failed, ${warns.length} warnings, ${skips.length} skipped (no data)`);
if (errs.length) console.log('page errors:', errs.slice(0, 5));
writeFileSync(`${outDir}/feelbot.json`, JSON.stringify({ setup, rows, results: R, errors: errs }, null, 2));
process.exit(fails.length ? 1 : 0);
