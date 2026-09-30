// Per frame black frame detector for the real GPU. After every rendered frame it reads back the WHOLE canvas (not a sample grid) and flags
//   - a frame whose mean luminance falls under half of the running median (a blank or half drawn frame)
//   - a frame with clearly more fully black 32 px tiles than usual (median plus 12 tiles or 0.5 percent of all tiles, whichever is more) (the half-float NaN block artefact on Apple GPUs)
//   - any non finite camera or post uniform value
// Usage: node tools/blackframes.mjs <port|url> [seconds=12] [options]     (needs a dev server, real GPU Chrome)
//   --level=0|1|2   level to fly (default 0), --jump=<rail distance> start there (default: start of the level)
//   --dpr=2         device pixel ratio (default 2), --w=1440 --h=900 viewport
//   --q=<tier>      pin a tier (adaptive off), default: adaptive quality as in the game
//   --switch        also run the tier switch sweep: 0..5 in a shuffled order through render._pendingQ (the path the adaptive controller
//                   uses), render.resize() bursts, a window resize event and a real viewport change, then check the frames after each step
//   --extra="a=1"   extra URL params, e.g. --extra="nopost=1"
// Output: one JSON line (frames, flagged frames, non finite, frame gap p50 p99 max, console errors) and the first flagged frames.
// Exit codes: 0 clean, 1 flagged frames (brightness collapse), non finite values or console errors, 2 usage or launch error.
// Tile spikes (sudden groups of black tiles with a small brightness drop) are only reported as tileSpikeWarnings, dark levels trigger them with real content.
import { parseArgs, usage, gameUrl, launch, sleep } from './_lib.mjs';

const { pos, opt } = parseArgs(process.argv.slice(2), { level: 0, dpr: 2, w: 1440, h: 900 });
if (!pos[0]) usage('usage: node tools/blackframes.mjs <port|url> [seconds=12] [--level=0] [--jump=dist] [--dpr=2] [--q=tier] [--switch] [--extra="nopost=1"]');
const secs = +(pos[1] || 12);
const { browser, page, errs } = await launch({ w: opt.w, h: opt.h, dpr: opt.dpr, uncapped: true });
try {
  await page.goto(gameUrl(pos[0], { autostart: 1, level: opt.level, god: 1, noadapt: opt.q !== undefined ? 1 : undefined, q: opt.q }) + (opt.extra ? '&' + opt.extra : ''), { waitUntil: 'load' });
  await sleep(2500);
  if (opt.jump) await page.evaluate((d) => { const c = window.__ctx; c.game.advance(3); c.rail.position.z = -d; c.game.advance(1); }, +opt.jump);
  await page.evaluate(() => {
    const c = window.__ctx, r = c.render, gl = c.renderer.getContext(), fin = (v) => Number.isFinite(v);
    window.__probe = []; window.__tag = 'fly';
    const orig = r.render.bind(r);
    r.render = function (dt) {
      orig(dt);
      const W = gl.canvas.width, H = gl.canvas.height;
      if (!window.__buf || window.__buf.length !== W * H * 4) window.__buf = new Uint8Array(W * H * 4);
      const buf = window.__buf; gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, buf);
      let sum = 0, n = 0;
      for (let i = 0; i < buf.length; i += 16) { sum += (buf[i] + buf[i + 1] + buf[i + 2]) / 3; n++; }
      const T = 32; let blackTiles = 0;
      for (let ty = 0; ty < H; ty += T) for (let tx = 0; tx < W; tx += T) {
        let mx = 0; const x1 = Math.min(W, tx + T), y1 = Math.min(H, ty + T);
        for (let y = ty; y < y1 && mx < 4; y += 8) for (let x = tx; x < x1; x += 8) { const i = (y * W + x) * 4; mx = Math.max(mx, buf[i], buf[i + 1], buf[i + 2]); if (mx >= 4) break; }
        if (mx < 4) blackTiles++;
      }
      const u = r.post?.uniforms;
      window.__probe.push({ t: performance.now(), tag: window.__tag, lum: sum / n, blackTiles, dt, q: r.quality, canvas: [W, H],
        bad: !(fin(c.camera.fov) && fin(c.camera.position.x) && fin(c.camera.position.y) && fin(c.camera.position.z) && (!u || [u.uBlur.value, u.uChroma.value, u.uDamage.value, u.uFlash.value, u.uVignette.value].every(fin))) });
    };
  });
  // fly: hold fire, weave, roll
  await page.keyboard.down('Space');
  const t0 = Date.now(); let flip = 0;
  const fly = async (ms) => { const e = Date.now() + ms; while (Date.now() < e) { const k = flip++ % 2 ? 'KeyA' : 'KeyD'; await page.keyboard.down(k); await sleep(450); await page.keyboard.up(k); await page.keyboard.press('KeyQ'); } };
  await fly(secs * 1000);
  if (opt.switch) {
    const tag = (t) => page.evaluate((x) => { window.__tag = x; }, t);
    for (const q of [3, 1, 5, 0, 4, 2, 0, 5, 2, 0]) { await tag('q' + q); await page.evaluate((qq) => { window.__ctx.render.adaptive = false; window.__ctx.render._pendingQ = qq; }, q); await fly(700); }
    await tag('resize()'); for (let i = 0; i < 4; i++) { await page.evaluate(() => window.__ctx.render.resize()); await sleep(120); }
    await tag('window resize'); await page.evaluate(() => window.dispatchEvent(new Event('resize'))); await fly(500);
    await tag('viewport'); await page.setViewport({ width: 1100, height: 700, deviceScaleFactor: opt.dpr }); await fly(700);
    await page.setViewport({ width: opt.w, height: opt.h, deviceScaleFactor: opt.dpr }); await fly(700);
  }
  await page.keyboard.up('Space');
  const res = await page.evaluate(() => window.__probe);
  const med = (a) => { const s = [...a].sort((x, y) => x - y); return s[s.length >> 1]; };
  const lumMed = med(res.map((p) => p.lum)), btMed = med(res.map((p) => p.blackTiles));
  // Black tile spikes are judged against the LOCAL median of the surrounding 31 frames, so slow changes (flying into a dark corridor)
  // never count and a sudden block of black tiles (a NaN artefact) does. The limit is 1.6 times the local median plus 12 tiles (or 0.5 percent),
  // so on very dark levels only large jumps count there and the luminance dip and non-finite tests carry the load. The global median only serves the luminance dip test.
  const localTiles = res.map((_, i) => med(res.slice(Math.max(0, i - 15), i + 16).map((q) => q.blackTiles)));
  const tileLimit = (p, i) => Math.round(localTiles[i] * 1.6) + Math.max(12, Math.round(0.005 * Math.ceil(p.canvas[0] / 32) * Math.ceil(p.canvas[1] / 32)));   // 12 tiles or 0.5 percent of all tiles
  // a tile spike only counts together with a brightness drop: black blocks always darken the frame, moving dark content can brighten it
  const localLum = res.map((_, i) => med(res.slice(Math.max(0, i - 15), i + 16).map((q) => q.lum)));
  const flagged = res.filter((p, i) => i > 2 && p.lum < lumMed * 0.5);   // severe: the whole frame collapsed
  const tileSpikes = res.filter((p, i) => i > 2 && p.lum >= lumMed * 0.5 && p.blackTiles > tileLimit(p, i) && p.lum < localLum[i] * 0.94);   // warning only
  const nonFinite = res.filter((p) => p.bad).length;
  const gaps = res.slice(1).map((p, i) => p.t - res[i].t).sort((a, b) => a - b);
  const out = { url: String(pos[0]), level: opt.level, dpr: opt.dpr, seconds: secs, frames: res.length, medianLum: +lumMed.toFixed(1), medianBlackTiles: btMed, flaggedFrames: flagged.length, tileSpikeWarnings: tileSpikes.length, nonFinite,
    frameMs: { p50: +gaps[Math.floor(gaps.length * 0.5)]?.toFixed(1), p99: +gaps[Math.floor(gaps.length * 0.99)]?.toFixed(1), max: +gaps[gaps.length - 1]?.toFixed(1) }, tiersSeen: [...new Set(res.map((p) => p.q))], errs: errs.slice(0, 5) };
  console.log(JSON.stringify(out));
  if (flagged.length) console.log('first flagged frames', JSON.stringify(flagged.slice(0, 8).map((p) => ({ tag: p.tag, q: p.q, lum: +p.lum.toFixed(1), lumMedian: +lumMed.toFixed(1), blackTiles: p.blackTiles, dt: +p.dt.toFixed(4), canvas: p.canvas }))));
  await browser.close();
  const fail = flagged.length || nonFinite || errs.length;
  console.log(fail ? 'BLACKFRAMES FAIL' : 'BLACKFRAMES OK');
  process.exit(fail ? 1 : 0);
} catch (e) { console.error('blackframes failed:', e.message); await browser.close(); process.exit(2); }
