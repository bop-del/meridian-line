// Touch controls for phones and tablets. Only does anything when device.touch is true (a coarse pointer, or ?touch=1 to test on a
// desktop); on every other device init() returns before it creates a single element or listener.
//
//   LEFT THUMB  a floating stick. It appears where the thumb lands inside the stick zone (left 42 percent of the width, from 25
//               percent of the height down), radius about 56 CSS px, and fades when released. The raw deflection (-1..1, +y up)
//               goes to input.touch.x/y, where src/core/input.js shapes it with stickDeadzone and stickExpo and smooths it with
//               stickSmooth, the same path as a gamepad stick, so the tuned handling applies unchanged.
//   RIGHT THUMB buttons in the cluster (right 30 percent of the width, from 35 percent of the height down): FIRE (hold, holding
//               charges the lock volley exactly like fire held on a pad), BOOST and BRAKE (hold), BOMB, ROLL L and ROLL R (pulse).
//   PAUSE       a small button at the top centre with a 44 px target, triggers on release.
//
// One pointer id per control. Every finger lands on this layer, which captures the pointer, and the control is chosen by hit testing
// the button circles (with a little padding and nearest wins) so a thumb that lands between two buttons still does something
// sensible. A finger that started on FIRE, BOOST or BRAKE and slides onto another hold button switches to it without lifting.
// Bomb and roll pulses fire on touch down only, never by sliding.
//
// Barrel roll flick gesture: NOT implemented. A quick out and back swing past 85 percent is exactly what a hard dodge jab looks
// like on a thumb stick, so it would roll by accident during normal steering. The two ROLL buttons cover it.
//
// Visibility: shown only while state.phase is 'playing', and not once a gamepad reports input (input.usingGamepad). The controls fade
// with the HUD during cinema takeovers (ctx.cinema.hudAlpha); new touches on the stick and buttons are ignored while faded out,
// the pause button stays available at a low opacity because pause works during a takeover. Leaving the playing phase, blur and
// visibilitychange release every finger.
//
// API: touch.init(ctx, root), touch.update(dt, ctx) (call before input.update), touch.releaseAll(), touch.describe() for phonediag.
import './touch.css';
import { device } from '../core/device.js';

const STICK_ZONE_W = 0.42;      // fraction of the width
const STICK_ZONE_TOP = 0.25;    // fraction of the height
const STICK_RADIUS = 56;        // CSS px at scale 1
const HIT_PAD = 8;              // CSS px of extra hit area around every button at scale 1
const FADE_MIN = 0.3;           // below this alpha (cinema takeover) the stick and buttons ignore new touches
const GHOST_SECONDS = 14;       // how long the idle stick hint shows, counted over the page session

const BUTTONS = [
  { k: 'fire', cls: 'k-fire', html: 'FIRE', hold: true },
  { k: 'boost', cls: 'k-boost', html: 'BOOST', hold: true },
  { k: 'brake', cls: 'k-brake', html: 'BRAKE', hold: true },
  { k: 'bomb', cls: 'k-bomb', html: 'BOMB', pulse: 'bomb' },
  { k: 'rollL', cls: 'k-rollL', html: '<b>L</b><small>ROLL</small>', pulse: 'rollLeft' },
  { k: 'rollR', cls: 'k-rollR', html: '<b>R</b><small>ROLL</small>', pulse: 'rollRight' },
];

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

function el(tag, cls, parent, html) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html) e.innerHTML = html;
  if (parent) parent.appendChild(e);
  return e;
}

export const touch = {
  enabled: false,
  ctx: null,
  layer: null,
  shown: false,           // the layer is live (playing, no gamepad)
  alpha: 1,
  ts: 1,                  // size scale
  ptr: new Map(),         // pointerId -> { type: 'stick' | 'btn' | 'pause', btn }
  stick: { id: -1, ox: 0, oy: 0, x: 0, y: 0 },
  holders: {},            // hold button key -> Set of pointerIds
  rects: null,            // cached button circles
  ghostLeft: GHOST_SECONDS,
  downs: 0,               // total pointerdowns handled (tests and phonediag)

  init(ctx, root) {
    if (!device.touch || this.enabled) return this;
    this.enabled = true;
    this.ctx = ctx;
    root = root || document.getElementById('ui-root') || document.body;
    const layer = (this.layer = el('div', 'tctl', root));
    layer.setAttribute('aria-hidden', 'true');

    this.ghost = el('div', 'tctl-ghost', layer, 'STEER');
    const st = (this.stickEl = el('div', 'tctl-st', layer));
    el('div', 'tctl-ring', st);
    this.knob = el('div', 'tctl-knob', st);

    const cl = el('div', 'tctl-cl', layer);
    this.btn = {};
    for (const d of BUTTONS) {
      this.btn[d.k] = el('div', `tctl-b ${d.cls}`, cl, d.html);
      if (d.hold) this.holders[d.k] = new Set();
    }
    this.pauseEl = el('div', 'tctl-pause', layer, '<i></i>');

    layer.addEventListener('pointerdown', (e) => this.onDown(e));
    layer.addEventListener('pointermove', (e) => this.onMove(e));
    layer.addEventListener('pointerup', (e) => this.onUp(e));
    layer.addEventListener('pointercancel', (e) => this.onCancel(e));
    layer.addEventListener('lostpointercapture', (e) => this.onCancel(e));
    layer.addEventListener('contextmenu', (e) => e.preventDefault());
    // iOS Safari ignores user-scalable=no: stop the page gestures here instead
    const stop = (e) => { if (e.cancelable) e.preventDefault(); };
    layer.addEventListener('touchstart', stop, { passive: false });
    layer.addEventListener('touchmove', stop, { passive: false });
    layer.addEventListener('touchend', stop, { passive: false });
    for (const g of ['gesturestart', 'gesturechange', 'gestureend']) document.addEventListener(g, stop, { passive: false });
    // pinch anywhere (menus included) and a double tap on the canvas must not zoom the page
    document.addEventListener('touchmove', (e) => { if (e.touches && e.touches.length > 1) stop(e); }, { passive: false });
    let lastEnd = 0;
    document.addEventListener('touchend', (e) => {
      const now = performance.now();
      const t = e.target;
      if (now - lastEnd < 320 && t && (t.tagName === 'CANVAS' || (t.closest && t.closest('.tctl')))) stop(e);
      lastEnd = now;
    }, { passive: false });

    this.resize();
    addEventListener('resize', () => this.resize());
    addEventListener('orientationchange', () => setTimeout(() => this.resize(), 120));
    return this;
  },

  // ------------------------------------------------------------------ geometry
  resize() {
    if (!this.layer) return;
    // short landscape (a phone in a browser tab with the bars up) uses a compact cluster drawn at scale 1, see touch.css
    this.ts = innerHeight <= 340 && innerWidth > innerHeight ? 1 : clamp(innerHeight / 390, 0.95, 1.5);
    this.layer.style.setProperty('--ts', this.ts.toFixed(3));
    this.rects = null;
  },

  // button circles in viewport px, measured lazily (the layer is always laid out, even when faded out)
  measure() {
    const out = [];
    for (const d of BUTTONS) {
      const r = this.btn[d.k].getBoundingClientRect();
      out.push({ d, cx: r.left + r.width / 2, cy: r.top + r.height / 2, r: r.width / 2 });
    }
    const p = this.pauseEl.getBoundingClientRect();
    this.pauseRect = { l: p.left, r: p.right, t: p.top, b: p.bottom };
    this.rects = out;
    return out;
  },

  // nearest button whose padded circle contains the point, or null. strict: no padding (used when sliding between buttons)
  pick(x, y, strict) {
    const rects = this.rects || this.measure();
    const pad = strict ? 0 : HIT_PAD * this.ts;
    let best = null, bestScore = Infinity;
    for (const b of rects) {
      const gap = Math.hypot(x - b.cx, y - b.cy) - b.r;
      if (gap <= pad && gap < bestScore) { best = b.d; bestScore = gap; }
    }
    return best;
  },

  inPause(x, y) {
    if (!this.rects) this.measure();
    const p = this.pauseRect;
    return x >= p.l && x <= p.r && y >= p.t && y <= p.b;
  },

  // ------------------------------------------------------------------ pointers
  onDown(e) {
    if (e.cancelable) e.preventDefault();
    if (!this.shown || this.ptr.has(e.pointerId)) return;
    this.rects = null;          // fresh measure, the size may have changed (toolbars, rotation)
    const x = e.clientX, y = e.clientY;
    const pauseOk = this.inPause(x, y);
    if (pauseOk) { this.capture(e); this.ptr.set(e.pointerId, { type: 'pause' }); this.pauseEl.classList.add('on'); this.downs++; return; }
    if (this.alpha < FADE_MIN) return;
    const d = this.pick(x, y, false);
    if (d) {
      this.capture(e);
      this.ptr.set(e.pointerId, { type: 'btn', btn: d });
      this.press(d, e.pointerId);
      this.downs++;
      return;
    }
    const s = this.stick;
    if (s.id < 0 && x <= innerWidth * STICK_ZONE_W && y >= innerHeight * STICK_ZONE_TOP) {
      this.capture(e);
      this.ptr.set(e.pointerId, { type: 'stick' });
      s.id = e.pointerId; s.ox = x; s.oy = y; s.x = 0; s.y = 0;
      this.stickEl.style.transform = `translate3d(${x.toFixed(1)}px,${y.toFixed(1)}px,0)`;
      this.knob.style.transform = 'translate3d(0,0,0)';
      this.stickEl.classList.add('on');
      this.downs++;
    }
  },

  capture(e) { try { this.layer.setPointerCapture(e.pointerId); } catch (err) { /* synthetic or already gone */ } },

  onMove(e) {
    const p = this.ptr.get(e.pointerId);
    if (!p) return;
    if (e.cancelable) e.preventDefault();
    const x = e.clientX, y = e.clientY;
    if (p.type === 'stick') {
      const s = this.stick, R = STICK_RADIUS * this.ts;
      let dx = x - s.ox, dy = y - s.oy;
      const len = Math.hypot(dx, dy);
      if (len > R) {
        // the thumb ran past the ring: drag the ring along so it never takes a full reversal to come back
        const over = (len - R) / len;
        s.ox += dx * over; s.oy += dy * over;
        dx = x - s.ox; dy = y - s.oy;
        this.stickEl.style.transform = `translate3d(${s.ox.toFixed(1)}px,${s.oy.toFixed(1)}px,0)`;
      }
      s.x = clamp(dx / R, -1, 1);
      s.y = clamp(-dy / R, -1, 1);
      this.knob.style.transform = `translate3d(${dx.toFixed(1)}px,${dy.toFixed(1)}px,0)`;
    } else if (p.type === 'btn' && p.btn.hold) {
      // slide from one hold button to another without lifting
      const n = this.pick(x, y, true);
      if (n && n !== p.btn && n.hold) {
        const cur = this.rects.find((r) => r.d === p.btn);
        if (!cur || Math.hypot(x - cur.cx, y - cur.cy) > cur.r) { this.unpress(p.btn, e.pointerId); p.btn = n; this.press(n, e.pointerId); }
      }
    }
  },

  onUp(e) {
    const p = this.ptr.get(e.pointerId);
    if (!p) return;
    if (p.type === 'pause') {
      if (this.shown && this.inPause(e.clientX, e.clientY) && this.ctx) this.ctx.input.touch.pause = true;
    }
    this.end(e.pointerId);
  },

  onCancel(e) { if (this.ptr.has(e.pointerId)) this.end(e.pointerId); },

  press(d, id) {
    const t = this.ctx.input.touch;
    if (d.hold) this.holders[d.k].add(id);
    else t[d.pulse] = true;
    this.btn[d.k].classList.add('on');
  },

  unpress(d, id) {
    if (d.hold) {
      this.holders[d.k].delete(id);
      if (this.holders[d.k].size) return;
    }
    this.btn[d.k].classList.remove('on');
  },

  end(id) {
    const p = this.ptr.get(id);
    if (!p) return;
    this.ptr.delete(id);
    try { this.layer.releasePointerCapture(id); } catch (err) { /* already released */ }
    if (p.type === 'stick') {
      const s = this.stick;
      s.id = -1; s.x = 0; s.y = 0;
      this.stickEl.classList.remove('on');
    } else if (p.type === 'btn') this.unpress(p.btn, id);
    else this.pauseEl.classList.remove('on');
  },

  // Drop every finger and clear the published state. Called on blur, visibility loss, pause and any change of phase.
  releaseAll() {
    if (!this.enabled) return;
    for (const id of [...this.ptr.keys()]) this.end(id);
    for (const k in this.holders) this.holders[k].clear();
    for (const d of BUTTONS) this.btn[d.k].classList.remove('on');
    this.pauseEl.classList.remove('on');
    this.stickEl.classList.remove('on');
    const s = this.stick; s.id = -1; s.x = 0; s.y = 0;
    const t = this.ctx?.input?.touch;
    if (t) { t.x = t.y = 0; t.fire = t.boost = t.brake = false; t.bomb = t.rollLeft = t.rollRight = t.pause = false; }
  },

  // ------------------------------------------------------------------ per frame
  update(dt, ctx) {
    if (!this.enabled) return;
    const input = ctx.input, t = input.touch;
    const live = ctx.state.phase === 'playing' && !input.usingGamepad;
    if (live !== this.shown) {
      this.shown = live;
      this.layer.classList.toggle('on', live);
      if (!live) { this.releaseAll(); t.active = false; }
    }
    // fade with the HUD during cinema takeovers
    let a = live ? ctx.cinema?.hudAlpha : 0;
    a = Number.isFinite(a) ? clamp(a, 0, 1) : (live ? 1 : 0);
    if (Math.abs(a - this.alpha) > 0.01 || (a !== this.alpha && (a === 0 || a === 1))) {
      this.alpha = a;
      this.layer.style.setProperty('--tctl-a', a.toFixed(3));
    }
    if (!live) return;
    // the idle hint for the stick
    if (this.ghostLeft > 0) {
      this.ghostLeft -= dt;
      const on = this.ghostLeft > 0 && this.stick.id < 0 && a > 0.5;
      if (on !== this._ghostOn) { this._ghostOn = on; this.ghost.classList.toggle('on', on); }
    } else if (this._ghostOn) { this._ghostOn = false; this.ghost.classList.remove('on'); }
    // publish
    t.active = true;
    t.x = this.stick.x; t.y = this.stick.y;
    t.fire = this.holders.fire.size > 0;
    t.boost = this.holders.boost.size > 0;
    t.brake = this.holders.brake.size > 0;
  },

  // one short line for ?phonediag=1
  describe() {
    if (!this.enabled) return 'off';
    const t = this.ctx.input.touch, s = this.stick;
    const keys = [t.fire ? 'F' : '', t.boost ? 'B' : '', t.brake ? 'K' : ''].join('');
    return `pts ${this.ptr.size} stick ${s.id >= 0 ? `${s.x.toFixed(2)},${s.y.toFixed(2)}` : '-'} btn ${keys || '-'} ${this.shown ? 'live' : 'hidden'} downs ${this.downs}`;
  },
};
