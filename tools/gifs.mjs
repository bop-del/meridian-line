// README GIF renderer: plays the showcase route (?showcase=1) on the real GPU with a fixed time step and writes the GIFs (four by default, see CLIPS).
// Usage: node tools/gifs.mjs <port> <outDir> [levels=0,1,2] [--w=720] [--fps=15] [--maxmb=2.5 (decimal megabytes)] [--kind=<name>] [--len=<seconds>] [--fade=0.5]
//                            [--software] [--keep] [--hud=0] [--bars=0]
//   <port>     a running dev server (npx vite --port <port>) or preview server of this repo
//   <outDir>   where the GIFs go (docs/ for the README), frames are kept in <outDir>/.frames-<name> only with --keep
//   levels     comma separated level indexes in play order (0 Obsidian Foundry, 1 Cinder Belt, 2 Thalassa Coast)
//   --w        GIF width in px (default 720), --fps the top frame rate (default 15, lowered automatically to fit --maxmb)
//   --kind     force the moment for every level: start | moment | fight | entrance | orbit | finisher (default: see CLIPS)
//   --len      seconds of game time per GIF (default 3.5; longer clips do not fit 2.5 MB at this size)
//   --fade     seconds of cross fade that make the loop seamless (default 0.5, 0 turns it off); the capture is this much longer
//   --software render with SwiftShader instead of the GPU (slow, for machines without a GPU, looks slightly different)
//   --hud=0    hide the HUD and comm boxes   --bars=0 no letterbox bars
// How it works (deterministic): the page runs with a seeded Math.random that is reseeded before every step and with requestAnimationFrame
// stopped, so the game only advances when this tool calls ctx.game.step at a fixed 1/30 s. Pass 1 finds the step at which the moment
// happens (no rendering, fast), pass 2 replays to a little before it, renders and screenshots every step, and ffmpeg builds the GIF with a
// two pass palette (palettegen, paletteuse). CSS animations of the HUD are advanced by hand in the same fixed steps.
// Film grain and the scan line overlay are switched off for the GIFs (noise does not compress). If a GIF is over --maxmb the frame rate,
// the palette and last the width are lowered until it fits.
// Needs ffmpeg on the PATH and Google Chrome (CHROME_PATH or the macOS default). Exit codes: 0 all GIFs written, 1 a level failed
// (moment not found, no frames, page error, GIF too large), 2 usage or launch error.
import { mkdirSync, rmSync, readdirSync, statSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { resolve, join } from 'node:path';
import { parseArgs, usage, launch, gameUrl } from './_lib.mjs';

const { pos, opt } = parseArgs(process.argv.slice(2), { w: 720, fps: 15, maxmb: 2.5 });
if (pos.length < 2) usage('usage: node tools/gifs.mjs <port> <outDir> [levels=0,1,2] [--w=720] [--fps=15] [--maxmb=2.5] [--kind=start|moment|fight|entrance|orbit|finisher] [--len=s] [--software] [--keep] [--hud=0] [--bars=0]');
const [port, outArg, lv = '0,1,2'] = pos;
const outDir = resolve(outArg);
const levels = String(lv).split(',').map(Number).filter((n) => n >= 0 && n <= 2);
if (!levels.length) usage('no valid level in ' + lv);
if (spawnSync('ffmpeg', ['-version']).status !== 0) { console.error('ffmpeg not found on the PATH'); process.exit(2); }
mkdirSync(outDir, { recursive: true });

const DT = 1 / 30;
// What each level's GIF shows. find: a predicate on the game context c, evaluated after every step; pre: seconds to start before it; len: seconds.
const KINDS = {
  start: { find: 'c.state.phase === "playing"', pre: -1, len: 3.5, note: 'level intro flythrough (after the sound gate has faded)' },
  moment: { find: 'c.cinema.moment && c.cinema.moment.on', pre: 0.8, len: 3.5, note: 'signature moment' },
  fight: { find: 'c.state.combo >= 9 && !c.cinema.active && c.state.levelTime > 20 && !c.state.boss', pre: 2.5, len: 3.5, note: 'a fight' },
  entrance: { find: 'c.cinema.active && /entrance/.test(c.cinema.name)', pre: 0.4, len: 3.5, note: 'boss entrance' },
  orbit: { find: 'c.cinema.active && c.cinema.name === "showcase.orbit"', pre: -1.2, len: 3.5, note: 'orbit shot round a boss fight' },
  finisher: { find: 'c.cinema.active && /finisher/.test(c.cinema.name)', pre: 0.3, len: 3.5, note: 'boss defeat finisher' },
};
// one or more clips per level: [file name, kind]
const CLIPS = [[['foundry', 'orbit'], ['regent', 'finisher']], [['cinder', 'finisher']], [['thalassa', 'entrance']]];

const { browser, page, errs } = await launch({ w: 1280, h: 720, dpr: 1, software: !!opt.software }).catch((e) => { console.error('launch failed:', e.message); process.exit(2); });
await page.evaluateOnNewDocument(() => {
  let s = 1;
  Math.random = () => { s = (s + 0x6D2B79F5) | 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  window.__seed = (n) => { s = Math.imul(n + 1, 2654435761) | 0; };
  window.requestAnimationFrame = () => 0;   // the tool steps the game itself
  window.__idx = 0;
});

// step helpers living in the page
async function loadLevel(level) {
  const url = gameUrl(port, { showcase: 1, level, noadapt: 1, q: 5, nooverlay: 1, hud: opt.hud === 0 ? 0 : undefined, bars: opt.bars === 0 ? 0 : undefined });
  await page.goto(url, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__ctx && __ctx.showcase && __ctx.showcase.started && __ctx.state.phase === 'playing', { timeout: 60000 });
  await page.evaluate((dt) => {
    const c = window.__ctx;
    window.__idx = 0;
    c.render.setPost?.({ grain: 0 });   // film grain is noise: it would triple the size of a GIF
    window.__step = (n, render) => { for (let i = 0; i < n; i++) { window.__seed(window.__idx++); c.game.step(dt, render); } };
    // advance CSS animations and transitions by hand: they follow game time instead of the wall clock
    const seen = new WeakSet();
    window.__anim = () => {
      for (const a of document.getAnimations()) {
        if (!seen.has(a)) { seen.add(a); a.pause(); a.currentTime = dt * 1000; } else if (a.playState !== 'finished') a.currentTime = (a.currentTime || 0) + dt * 1000;
      }
    };
  }, DT);
}

async function findStep(find, maxSeconds) {
  const maxSteps = Math.round(maxSeconds / DT);
  return page.evaluate((src, max) => {
    const c = window.__ctx, pred = new Function('c', 'return !!(' + src + ')');
    for (let i = 0; i < max; i++) { window.__step(1, false); if (pred(c)) return window.__idx; }
    return -1;
  }, find, maxSteps);
}

// Encoder ladder, best looking first. The first entry that fits --maxmb wins. Bright gradients (sea, haze, sky) band badly with a small
// palette, so the ladder starts with a big palette built from all frames and gives up frame rate first, then palette, then length.
// hqdn3d takes the last noise out (bloom and speed lines are busy) and ordered dithering compresses better than error diffusion.
// Seamless loop: the capture is FADE seconds longer than the clip; the last FADE seconds are cross faded over the first ones, so the
// last frame continues straight into the first one when the GIF repeats.
function fitGif(frameDir, gif, W, fps, maxBytes, nCap, fadeFrames) {
  const pal = [[192, 'bayer:bayer_scale=3', 'hqdn3d=3:3:8:8,'], [128, 'bayer:bayer_scale=3', 'hqdn3d=3:3:8:8,'], [96, 'bayer:bayer_scale=4', 'hqdn3d=4:4:10:10,'], [64, 'bayer:bayer_scale=5', 'hqdn3d=4:4:10:10,']];
  const runs = [];
  const fpsList = [fps, 12, 10, 8].filter((f, i, a) => f <= fps && a.indexOf(f) === i);
  for (const [colors, dither, pre] of pal) for (const f of fpsList) runs.push({ f, w: W, colors, dither, pre, k: 1 });
  const last = pal[pal.length - 1];
  for (const k of [0.85, 0.7]) runs.push({ f: 8, w: W, colors: 96, dither: last[1], pre: last[2], k }, { f: 8, w: Math.round(W * 0.9), colors: 64, dither: last[1], pre: last[2], k });
  const K = fadeFrames, total = nCap - K;
  let lastRes = null;
  for (const t of runs) {
    const M = Math.max(Math.round(2.4 / DT), Math.round(total * t.k)), N = M + K;
    const loop = K > 0
      ? `[0:v]split=3[a][b][c];[a]trim=start_frame=${M}:end_frame=${N},setpts=PTS-STARTPTS[t];[b]trim=end_frame=${K},setpts=PTS-STARTPTS[h];[t][h]blend=all_expr='A*(1-(N+1)/${K})+B*((N+1)/${K})'[x];[c]trim=start_frame=${K}:end_frame=${M},setpts=PTS-STARTPTS[m];[x][m]concat=n=2:v=1:a=0[o];[o]`
      : '[0:v]';
    const fc = `${loop}fps=${t.f},${t.pre}scale=${t.w}:-1:flags=lanczos,split[s0][s1];[s0]palettegen=max_colors=${t.colors}:stats_mode=full[p];[s1][p]paletteuse=dither=${t.dither}:diff_mode=rectangle`;
    const r = spawnSync('ffmpeg', ['-y', '-loglevel', 'error', '-framerate', String(Math.round(1 / DT)), '-i', join(frameDir, 'f%04d.png'), '-filter_complex', fc, '-loop', '0', gif], { encoding: 'utf8' });
    if (r.status !== 0) { console.error('ffmpeg failed:', r.stderr); return null; }
    lastRes = { fps: t.f, w: t.w, colors: t.colors, size: statSync(gif).size, seconds: M * DT };
    if (lastRes.size <= maxBytes) return lastRes;
  }
  return { ...lastRes, tooBig: true };
}

let failed = 0;
for (const [level, name, defaultKind] of levels.flatMap((l) => CLIPS[l].map(([n, k]) => [l, n, k]))) {
  const m = { name };
  const kindName = typeof opt.kind === 'string' ? opt.kind : defaultKind;
  const kind = KINDS[kindName];
  if (!kind) { console.error('unknown --kind', kindName); process.exit(2); }
  const len = Number(opt.len) || kind.len;
  const frameDir = join(outDir, `.frames-${m.name}`);
  rmSync(frameDir, { recursive: true, force: true });
  mkdirSync(frameDir, { recursive: true });
  console.log(`level ${level} ${m.name}: ${kind.note} (${kindName}), ${len} s`);

  // pass 1: find the moment
  await loadLevel(level);
  const at = await findStep(kind.find, 420);
  if (at < 0) { console.error(`  FAIL: moment "${kindName}" not found in 420 s of game time`); failed++; continue; }
  const startStep = Math.max(0, at - Math.round(kind.pre / DT));   // a negative pre starts after the moment
  console.log(`  found at step ${at} (${(at * DT).toFixed(1)} s), capture from step ${startStep}`);

  // pass 2: replay, warm the renderer for a few frames, then step, screenshot and advance the HUD animations
  await loadLevel(level);
  const WARM = 12;
  await page.evaluate((n) => window.__step(n, false), Math.max(0, startStep - WARM));
  await page.evaluate((n) => { for (let i = 0; i < n; i++) { window.__step(1, true); window.__anim(); } }, Math.min(WARM, startStep));
  const FADE = opt.fade === undefined ? 0.5 : Number(opt.fade);
  const fadeFrames = Math.round(FADE / DT);
  const frames = Math.round(len / DT) + fadeFrames;
  for (let i = 0; i < frames; i++) {
    await page.evaluate(() => { window.__step(1, true); window.__anim(); });
    await page.screenshot({ path: join(frameDir, `f${String(i + 1).padStart(4, '0')}.png`), type: 'png' });
  }
  const st = await page.evaluate(() => ({ idx: window.__idx, phase: __ctx.state.phase, health: Math.round(__ctx.state.health), cin: __ctx.cinema.active ? __ctx.cinema.name : '', dist: Math.round(__ctx.rail.distance), boss: !!__ctx.state.boss }));
  console.log('  state after capture:', JSON.stringify(st));
  const files = readdirSync(frameDir).filter((f) => f.endsWith('.png'));
  const tiny = files.filter((f) => statSync(join(frameDir, f)).size < 15000);
  if (tiny.length > files.length * 0.05) console.error(`  WARNING: ${tiny.length} nearly blank frames (files under 15 KB)`);
  if (files.length < frames * 0.9) { console.error('  FAIL: frames missing'); failed++; continue; }

  const gif = join(outDir, `${m.name}.gif`);
  const res = fitGif(frameDir, gif, Number(opt.w), Number(opt.fps), Math.round(Number(opt.maxmb) * 1e6), files.length, fadeFrames);
  if (!res) { failed++; continue; }
  console.log(`  ${gif}: ${(res.size / 1e6).toFixed(2)} MB, ${res.w} px wide, ${res.fps} fps, ${res.colors} colors, ${res.seconds.toFixed(1)} s, loops seamlessly${res.tooBig ? '  TOO BIG' : ''}`);
  if (res.tooBig) failed++;
  if (!opt.keep) rmSync(frameDir, { recursive: true, force: true });
}

if (errs.length) { console.error('console errors:', errs.slice(0, 5)); failed++; }
await browser.close();
process.exit(failed ? 1 : 0);
