// Black frame detector for ?diag=1. After every rendered frame it samples a grid of pixels from the WebGL canvas and counts
// frames that came out (nearly) black. A small badge shows the counters, and every black frame is logged with the render state.
//   canvas counter stays 0 but you SEE flicker  -> the canvas is fine, the browser compositor or a page overlay is the cause
//   canvas counter grows                         -> the WebGL pipeline produced the black frame (the log says in which state)
// ?nopost=1 skips the whole post-processing chain, ?nooverlay=1 removes the scanline overlay, blend modes and backdrop filters.
export const diag = {
  ctx: null,
  n: 0, black: 0, worstMs: 0, last: null, badge: null, recent: [], hist: [],

  init(ctx) {
    this.ctx = ctx;
    const r = ctx.render, gl = ctx.renderer.getContext(), px = new Uint8Array(4), self = this;
    // ?report=<port>: every black frame and a 5 s summary are POSTed to http://localhost:<port>/ (a receiver run by the developer)
    const rq = new URLSearchParams(location.search).get('report');
    const local = ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname);
    const rp = local && /^\d{2,5}$/.test(rq || '') ? rq : null;   // a port number only, never a host, and only from a page served locally
    this.send = rp ? (obj) => { try { fetch(`http://localhost:${rp}/`, { method: 'POST', mode: 'no-cors', body: JSON.stringify(obj) }); } catch (e) { /* ignore */ } } : () => {};
    this.badge = document.createElement('div');
    this.badge.style.cssText = 'position:fixed;left:8px;bottom:8px;z-index:9999;padding:4px 8px;font:11px/1.4 ui-monospace,monospace;color:#dff;background:rgba(0,0,0,.75);border:1px solid #46e6d2;pointer-events:none;white-space:pre';
    document.body.appendChild(this.badge);
    const orig = r.render.bind(r);
    let prev = performance.now(), med = 0;
    r.render = function (dt) {
      orig(dt);
      const now = performance.now(), gap = now - prev; prev = now;
      const W = gl.canvas.width, H = gl.canvas.height; let s = 0, cnt = 0;
      for (let iy = 1; iy < 8; iy++) for (let ix = 1; ix < 8; ix++) {
        gl.readPixels((W * ix / 8) | 0, (H * iy / 8) | 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
        s += (px[0] + px[1] + px[2]) / 3; cnt++;
      }
      const lum = s / cnt; self.n++;
      self.hist.push([+lum.toFixed(0), +gap.toFixed(1), +dt.toFixed(4)]); if (self.hist.length > 12) self.hist.shift();
      if (self.n > 30) {
        if (!med) med = lum;
        if (lum < med * 0.35) {
          self.black++;
          const u = r.post?.uniforms, e = { frame: self.n, lum: +lum.toFixed(1), median: +med.toFixed(1), gapMs: +gap.toFixed(1), dt: +dt.toFixed(4),
            quality: r.quality, timeScale: ctx.timeScale, fov: ctx.camera.fov, uBlur: u?.uBlur.value, uDamage: u?.uDamage.value, uFlash: u?.uFlash.value, phase: ctx.state.phase,
            focus: document.hasFocus(), vis: document.visibilityState, lost: gl.isContextLost(), pr: ctx.renderer.getPixelRatio(), canvas: [W, H],
            hist: self.hist.slice(), mem: { geo: ctx.renderer.info.memory.geometries, tex: ctx.renderer.info.memory.textures }, boost: ctx.player?.boostAmount, speed: ctx.rail?.speed };
          self.send({ type: 'black', ...e });
          self.last = e; self.recent.push(e); if (self.recent.length > 20) self.recent.shift();
          console.warn('[diag] black frame', JSON.stringify(e));
        } else med += (lum - med) * 0.02;
        self.worstMs = Math.max(self.worstMs, gap);
      }
    };
    setInterval(() => this.send({ type: 'summary', n: this.n, black: this.black, worstMs: this.worstMs, q: r.quality, dpr: devicePixelRatio, size: [innerWidth, innerHeight],
      pr: ctx.renderer.getPixelRatio(), phase: ctx.state.phase, focus: document.hasFocus(), ua: navigator.userAgent.slice(0, 80), url: location.search }), 5000);
    gl.canvas.addEventListener('webglcontextlost', () => console.warn('[diag] WEBGL CONTEXT LOST'));
    gl.canvas.addEventListener('webglcontextrestored', () => console.warn('[diag] webgl context restored'));
    window.__diag = this;
  },

  reset() {},
  update() {
    if (this.ctx.render.quality !== undefined && this.badge && this.n % 10 === 0) {
      this.badge.textContent = `DIAG canvas frames ${this.n}  BLACK ${this.black}  worst gap ${this.worstMs.toFixed(0)} ms  q${this.ctx.render.quality}` +
        (this.last ? `\nlast black: frame ${this.last.frame} lum ${this.last.lum} q${this.last.quality} dt ${this.last.dt}` : '');
    }
  },
};
