// Comm system. Two presentations, one active at a time, both bottom-right:
//  - portrait box (canvas portrait, name, typewriter text, radio static) for VEX, FERRO and REGENT
//  - text readout strip (monospace tag, left rule, typed text) for PIP, LUMEN, CONTROL and SABLE
// The portrait is drawn BEFORE the box is shown, so a new speaker never flashes the previous face.
import { h } from './dom.js';
import { PORTRAITS, READOUTS, drawPortrait, normalizeSpeaker } from './portraits.js';

const CPS = 44; // typewriter characters per second
const CPS_READOUT = 62; // readouts type faster, like a log
const MAX_QUEUE = 5;

export class Comm {
  constructor(ctx, parent) {
    this.ctx = ctx;
    this.queue = [];
    this.cur = null;
    this.t = 0;
    this.mouthT = 0;
    this.lastKey = '';
    this.lastKeyAt = -9;
    this.clock = 0;
    this.staticLeft = 0;
    this.nextBlip = 2;
    this._frame = -1;

    // portrait box
    const box = (this.el = h('div', 'comm', null, parent));
    const pw = h('div', 'comm-portrait', null, box);
    this.canvas = h('canvas', 'comm-canvas', null, pw);
    this.canvas.width = 128; this.canvas.height = 128;
    this.staticCanvas = h('canvas', 'comm-static', null, pw);
    this.staticCanvas.width = 48; this.staticCanvas.height = 48;
    h('div', 'comm-scan', null, pw);
    const body = h('div', 'comm-body', null, box);
    this.nameEl = h('div', 'comm-name', '', body);
    this.textEl = h('div', 'comm-text', '', body);
    this.barEl = h('div', 'comm-bar', null, body);
    this.barFill = h('i', null, null, this.barEl);
    this.sg = this.staticCanvas.getContext('2d');
    this.img = this.sg.createImageData(48, 48);

    // text readout strip
    const strip = (this.strip = h('div', 'comm-strip', null, parent));
    this.tagEl = h('div', 'strip-tag', '', strip);
    const sb = h('div', 'strip-body', null, strip);
    this.stripText = h('span', 'strip-text', '', sb);
    h('i', 'strip-cursor', null, sb);
    this.stripBar = h('i', 'strip-bar', null, strip);
  }

  reset() {
    this.queue.length = 0;
    this.cur = null;
    this.el.classList.remove('on');
    this.strip.classList.remove('on');
  }

  push({ speaker = 'LUMEN', text = '', duration = 3.5 } = {}) {
    const sp = normalizeSpeaker(speaker);
    const key = sp + '|' + text;
    // dedupe identical lines pushed by several systems in quick succession
    if (key === this.lastKey && this.clock - this.lastKeyAt < 1.5) return;
    this.lastKey = key; this.lastKeyAt = this.clock;
    if (!text) return;
    if (this.queue.length >= MAX_QUEUE) this.queue.shift();
    this.queue.push({ sp, text: String(text), duration: Math.max(1.2, duration) });
  }

  start(msg) {
    const portrait = !!PORTRAITS[msg.sp];
    this.cur = { ...msg, idx: 0, typed: 0, hold: 0, done: false, total: 0, portrait };
    this.staticLeft = 0;
    if (portrait) {
      const p = PORTRAITS[msg.sp];
      // draw first, then reveal: the canvas never shows the previous speaker under the new name
      this._frame = -1;
      drawPortrait(this.canvas, msg.sp, 0, this.mouthT, 0);
      this.nameEl.textContent = p.label;
      this.nameEl.style.color = p.accent;
      this.el.style.setProperty('--comm-accent', p.accent);
      this.textEl.textContent = '';
      this.barFill.style.transform = 'scaleX(1)';
      this.staticLeft = 0.45;
      this.strip.classList.remove('on');
      this.el.classList.add('on');
    } else {
      const r = READOUTS[msg.sp];
      this.tagEl.textContent = r.tag;
      this.tagEl.style.color = r.accent;
      this.strip.style.setProperty('--comm-accent', r.accent);
      this.stripText.textContent = '';
      this.stripBar.style.transform = 'scaleX(1)';
      this.el.classList.remove('on');
      this.strip.classList.add('on');
    }
    this.ctx.audio?.sfx?.('comm', { volume: portrait ? 0.7 : 0.45, pitch: portrait ? 1 : 1.35 });
  }

  finish() {
    this.cur = null;
    if (this.queue.length) { this.start(this.queue.shift()); return; }
    const wasPortrait = this.el.classList.contains('on');
    this.el.classList.remove('on');
    this.strip.classList.remove('on');
    this.ctx.audio?.sfx?.('comm', { volume: wasPortrait ? 0.35 : 0.2, pitch: 0.8 });
  }

  update(dt) {
    this.clock += dt;
    this.mouthT += dt;
    if (!this.cur) {
      if (this.queue.length) this.start(this.queue.shift());
      else return;
    }
    const c = this.cur;
    const textEl = c.portrait ? this.textEl : this.stripText;
    const barEl = c.portrait ? this.barFill : this.stripBar;
    if (!c.done) {
      const base = c.portrait ? CPS : CPS_READOUT;
      const speed = this.queue.length > 1 ? base * 1.6 : base;
      c.typed += dt * speed;
      const n = Math.min(c.text.length, Math.floor(c.typed));
      if (n !== c.idx) { c.idx = n; textEl.textContent = c.text.slice(0, n); }
      if (n >= c.text.length) {
        c.done = true;
        c.hold = Math.max(c.duration - c.text.length / speed, 1.4);
        c.total = c.hold;
      }
    } else {
      c.hold -= dt;
      barEl.style.transform = `scaleX(${Math.max(0, c.hold / c.total).toFixed(3)})`;
      // advance early when more lines are waiting
      const early = this.queue.length > 0 && c.hold < c.total - 0.9;
      if (c.hold <= 0 || early) { this.finish(); return; }
    }
    if (!c.portrait) return;
    // radio static: burst at message start and random blips
    this.nextBlip -= dt;
    if (this.nextBlip <= 0) { this.staticLeft = Math.max(this.staticLeft, 0.06 + Math.random() * 0.1); this.nextBlip = 1.5 + Math.random() * 2.5; }
    const talking = !c.done;
    const mouth = talking ? (Math.sin(this.mouthT * 22) > -0.2 ? 0.3 + 0.7 * Math.abs(Math.sin(this.mouthT * 13)) : 0) : 0;
    const frame = (this.mouthT * 14) | 0;
    if (frame !== this._frame) {
      this._frame = frame;
      drawPortrait(this.canvas, c.sp, mouth, this.mouthT, Math.min(1, this.staticLeft * 3));
    }
    if (this.staticLeft > 0) {
      this.staticLeft -= dt;
      this.drawStatic(Math.min(1, this.staticLeft * 4));
      this.staticCanvas.style.opacity = '1';
    } else if (this.staticCanvas.style.opacity !== '0.07') {
      this.staticCanvas.style.opacity = '0.07';
    }
  }

  drawStatic(amount) {
    const d = this.img.data;
    for (let i = 0; i < d.length; i += 4) {
      const v = Math.random() * 255;
      d[i] = v; d[i + 1] = v; d[i + 2] = v; d[i + 3] = 25 + amount * 140;
    }
    this.sg.putImageData(this.img, 0, 0);
  }
}
