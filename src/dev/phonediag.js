// Phone diagnostics overlay for ?phonediag=1: a small monospace box so the numbers can be read on the phone itself (no Web Inspector).
// It sits in the top left corner, clear of the sound gate steps, the stick zone and the button cluster. One tap cycles collapsed / expanded.
//   collapsed   one line: smoothed fps, frame p95 and the tier
//   expanded    one line per registered entry. Built in (render): fps, frame ms p50 and p95 over the last 5 s, tier and its flags,
//               pixel ratio, canvas size, post chain state (full or the fallback and why), float target extensions, draw calls,
//               render memory estimate, adaptive state, context lost count.
// API (used by the other modules, game.js sets ctx.phonediag when the parameter is present and calls init and update):
//   phonediag.add(name, fn)   register a line, fn() returns a short string, refreshed twice a second. A throwing fn shows "?".
//                             add() may be called before init (the entries are kept). Adding the same name again replaces it.
//   phonediag.init(ctx)       build the overlay and the render entries
//   phonediag.update(dt, ctx) called once per game step: samples the wall clock frame interval
// Off unless ?phonediag=1 (nothing is imported or drawn otherwise).
import { estimateMB } from '../render/tiers.js';

const lines = new Map();
const frames = [];          // [timestamp, interval ms] of the last 5 s
let fpsSm = 0, last = 0, lastDraw = 0, box = null, expanded = false;

const pct = (sorted, f) => (sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * f))] : 0);

export const phonediag = {
  ctx: null,

  add(name, fn) { lines.set(name, fn); },

  init(ctx) {
    this.ctx = ctx;
    const r = ctx.render, gl = ctx.renderer.getContext();
    this.add('fps', () => {
      const avg = frames.length ? frames.reduce((a, f) => a + f[1], 0) / frames.length : 0;
      return `${fpsSm.toFixed(1)} smoothed  ${avg ? (1000 / avg).toFixed(1) : '0'} over 5 s`;
    });
    this.add('frame ms', () => {
      const s = frames.map((f) => f[1]).sort((a, b) => a - b);
      return `p50 ${pct(s, 0.5).toFixed(1)}  p95 ${pct(s, 0.95).toFixed(1)}  max ${pct(s, 1).toFixed(0)}`;
    });
    this.add('tier', () => {
      const T = r.tier;
      return `${r.quality} pr${T.pr} sh${T.shafts} fl${T.flare} dof${T.dof} w${T.water} fog${T.fog} bl${T.on ? T.bloom : 'off'}`;
    });
    this.add('pixel ratio', () => `${ctx.renderer.getPixelRatio()} of dpr ${(devicePixelRatio || 1).toFixed(2)}`);
    this.add('canvas', () => `${gl.drawingBufferWidth}x${gl.drawingBufferHeight}  css ${innerWidth}x${innerHeight}`);
    this.add('post', () => (r.composer ? 'full chain' : r.fallback ? 'fallback: ' + r.fallback : 'direct'));
    this.add('float rt', () => r.floatExt || '?');
    this.add('draw', () => { const i = ctx.renderer.info.render; return `${i.calls} calls  ${(i.triangles / 1000).toFixed(0)}k tris`; });
    this.add('rt memory', () => `~${estimateMB(r._w || innerWidth, r._h || innerHeight, r.tier, devicePixelRatio, !!r.composer).toFixed(0)} MB`);
    this.add('adapt', () => (!r.adaptive ? 'off' : !r.mobile ? 'desktop' : r._capLocked ? `locked at ${r._lockMs.toFixed(0)} ms` : 'down only'));
    this.add('ctx lost', () => `${r.lostCount}${r.lost ? ' LOST NOW' : ''}`);

    box = document.createElement('div');
    box.style.cssText = 'position:fixed;left:calc(env(safe-area-inset-left, 0px) + 4px);top:calc(env(safe-area-inset-top, 0px) + 4px);z-index:9998;' +
      'max-width:36vw;min-width:150px;padding:3px 6px;font:10px/1.35 ui-monospace,Menlo,monospace;color:#dff;background:rgba(0,0,0,.86);' +
      'border:1px solid rgba(70,230,210,.6);white-space:pre;pointer-events:auto;touch-action:manipulation;user-select:none;-webkit-user-select:none;';
    const swallow = (e) => e.stopPropagation();
    box.addEventListener('pointerdown', swallow);
    box.addEventListener('pointerup', (e) => { e.stopPropagation(); expanded = !expanded; this.draw(); });
    document.body.appendChild(box);
    this.draw();
  },

  reset() {},

  update() {
    const now = performance.now();
    if (last) {
      const ms = now - last;
      if (ms < 1000) { frames.push([now, ms]); fpsSm += (1000 / Math.max(ms, 1) - fpsSm) * 0.05; }
    }
    last = now;
    while (frames.length && now - frames[0][0] > 5000) frames.shift();
    if (now - lastDraw > 500) this.draw();
  },

  draw() {
    lastDraw = performance.now();
    if (!box) return;
    const val = (fn) => { try { return String(fn()); } catch (e) { return '?'; } };
    if (!expanded) {
      const s = frames.map((f) => f[1]).sort((a, b) => a - b);
      box.textContent = `${fpsSm.toFixed(0)} fps  p95 ${pct(s, 0.95).toFixed(0)}ms  T${this.ctx?.render?.quality ?? '?'}`;
      return;
    }
    const out = [];
    for (const [name, fn] of lines) out.push(`${name}: ${val(fn)}`);
    box.textContent = out.join('\n');
  },
};
