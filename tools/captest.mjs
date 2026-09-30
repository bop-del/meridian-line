// Simulated 30 fps cap test (macOS Energy Saver, a 30 Hz display). requestAnimationFrame is replaced by a 33 ms timer, the game runs with
// the adaptive quality controller ON and ?diag=1, so the tool can check that
//   - no black frame is produced while the controller steps tiers (diag counts them on the canvas after every frame)
//   - the controller settles instead of dropping to the lowest tier or oscillating (the 30 fps cap must be recognised as an external cap)
//   - the tier table itself is sane: flags never come back when going down a tier, and effects drop in the agreed order
//     (depth of field, then light shafts, then water detail, then bloom quality)
// Usage: node tools/captest.mjs <port|url> [seconds=40] [options]     (needs a dev server, real GPU Chrome)
//   --level=0|1|2   level (default 0), --jump=<rail distance> start there
//   --dpr=2         device pixel ratio (default 2, the heaviest case), --w=1357 --h=929
//   --cap=30        simulated fps cap (default 30)
//   --maxsteps=10   fail when the tier changes more often than this (default 10), --maxtier=3 fail when the run ends on a worse tier
//   --no-order      do not fail on the drop order check (it is always printed)
// Output: one JSON line (frames, black frames, worst gap, tier per second, every tier change with time and flags) and the table check.
// Exit codes: 0 pass, 1 black frame, churn, bad end tier, table problem or console error, 2 usage or launch error.
import { parseArgs, usage, gameUrl, launch, sleep } from './_lib.mjs';

const { pos, opt } = parseArgs(process.argv.slice(2), { level: 0, dpr: 2, w: 1357, h: 929, cap: 30, maxsteps: 10, maxtier: 3 });
if (!pos[0]) usage('usage: node tools/captest.mjs <port|url> [seconds=40] [--level=0] [--dpr=2] [--cap=30] [--maxsteps=10] [--maxtier=3] [--no-order]');
const secs = +(pos[1] || 40);
const { browser, page, errs } = await launch({ w: opt.w, h: opt.h, dpr: opt.dpr });
try {
  await page.evaluateOnNewDocument((cap) => { window.requestAnimationFrame = (cb) => setTimeout(() => cb(performance.now()), Math.round(1000 / cap)); }, +opt.cap);
  await page.goto(gameUrl(pos[0], { autostart: 1, level: opt.level, god: 1, diag: 1 }), { waitUntil: 'load' });
  await sleep(1500);
  await page.evaluate((d) => {
    const c = window.__ctx, r = c.render; window.__changes = []; const t0 = performance.now(); let last = r.quality;
    const orig = r.setQuality.bind(r);
    r.setQuality = function (q) { orig(q); window.__changes.push({ t: +((performance.now() - t0) / 1000).toFixed(1), from: last, to: r.quality, tier: { ...r.tier } }); last = r.quality; };
    if (d) { c.game.advance(3); c.rail.position.z = -d; c.game.advance(1); }
  }, +(opt.jump || 0));
  const qs = []; const t0 = Date.now();
  await page.keyboard.down('Space');
  while (Date.now() - t0 < secs * 1000) { await sleep(1000); qs.push(await page.evaluate(() => window.__ctx.render.quality)); }
  await page.keyboard.up('Space');
  const d = await page.evaluate(() => ({ frames: window.__diag.n, black: window.__diag.black, worstGapMs: Math.round(window.__diag.worstMs), changes: window.__changes, lastBlack: window.__diag.last }));
  // tier table check (the module instance is the one the game uses)
  const table = await page.evaluate(async () => {
    const { QUALITY } = await import('/src/render/tiers.js'); const problems = [], first = {};
    const feats = { dof: (t) => t.dof, shafts: (t) => t.shafts, water: (t) => t.water, bloom: (t) => t.bloom };
    for (let i = 1; i < QUALITY.length; i++) for (const k of Object.keys(QUALITY[0])) {
      const a = QUALITY[i - 1][k], b = QUALITY[i][k]; if (typeof a === 'number' && b > a) problems.push(`tier ${i} raises ${k} (${a} to ${b})`);
      if (typeof a === 'boolean' && b && !a) problems.push(`tier ${i} enables ${k}`);
    }
    for (const [k, f] of Object.entries(feats)) { first[k] = QUALITY.findIndex((t) => f(t) < f(QUALITY[0])); }
    const order = ['dof', 'shafts', 'water', 'bloom'];
    for (let i = 1; i < order.length; i++) if (first[order[i - 1]] === -1 ? false : (first[order[i]] !== -1 && first[order[i]] < first[order[i - 1]])) problems.push(`order: ${order[i]} drops at tier ${first[order[i]]} before ${order[i - 1]} at tier ${first[order[i - 1]]}`);
    return { first, problems };
  });
  const endTier = qs[qs.length - 1];
  const out = { url: String(pos[0]), level: opt.level, dpr: opt.dpr, cap: opt.cap, seconds: secs, frames: d.frames, black: d.black, worstGapMs: d.worstGapMs, tierChanges: d.changes.length, endTier, qualityPerSecond: qs.join(''), errs: errs.slice(0, 5) };
  console.log(JSON.stringify(out));
  for (const c of d.changes) console.log(`  t=${c.t}s tier ${c.from} to ${c.to}  dof ${c.tier.dof} shafts ${c.tier.shafts} water ${c.tier.water} bloom ${c.tier.bloom} pr ${c.tier.pr}`);
  if (d.lastBlack) console.log('last black frame', JSON.stringify({ frame: d.lastBlack.frame, lum: d.lastBlack.lum, q: d.lastBlack.quality, canvas: d.lastBlack.canvas }));
  console.log('first tier that lowers each feature:', JSON.stringify(table.first), table.problems.length ? 'PROBLEMS: ' + table.problems.join('; ') : 'table ok');
  await browser.close();
  const why = [];
  if (d.black) why.push(`${d.black} black frames`);
  if (d.changes.length > opt.maxsteps) why.push(`tier churn ${d.changes.length} > ${opt.maxsteps}`);
  if (endTier > opt.maxtier) why.push(`ended on tier ${endTier} > ${opt.maxtier}`);
  if (table.problems.length && !opt['no-order']) why.push('tier table: ' + table.problems.join('; '));
  if (errs.length) why.push('console errors');
  console.log(why.length ? 'CAPTEST FAIL: ' + why.join(', ') : 'CAPTEST OK');
  process.exit(why.length ? 1 : 0);
} catch (e) { console.error('captest failed:', e.message); await browser.close(); process.exit(2); }
