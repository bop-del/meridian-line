// In-game HUD. All elements are cached, values are written only on change.
// Layout: lives top-left; score and KILLS counter top-centre with the boss bar under them; shield (vertical) with boost
// beside it on the left edge, bombs and pulse level under that block; transponder link readout top-right;
// comm and readout strips bottom-right (see comm.js); hint line bottom-centre.
import { h, setText, setClass, fmt, safeAnimate } from './dom.js';
import { hitDirection } from '../fx/impact.js';
import { device } from '../core/device.js';

const SEGMENTS = 20;
const MAX_LOCKS = 6;
const POP_POOL = 10;
const POP_MAX_ACTIVE = 3;     // popups on screen at once; more kills add into the nearest one
const POP_MERGE_WINDOW = 0.9; // seconds: kills at one target or spot inside this window add into a single popup
const POP_LIFE = 0.9;
const CHAIN_WINDOW = 2.4;
const TOAST_LIFE = 1.5;
const TOAST_DEDUPE = 1.5;     // same text inside this window shows once
const LINK_BARS = 5;
const VIGNETTE_BASE = 'radial-gradient(ellipse at center, rgba(255,0,0,0) 40%, rgba(255,20,20,0.5) 100%)';   // softer than .hud-vignette in style.css, the post pass adds its own edge pulse

// hexagon frame: six edges with small gaps at the corners, plus a faint inner hexagon that counter-rotates
const HEX_PTS = (r) => Array.from({ length: 6 }, (_, i) => { const a = (Math.PI / 3) * i - Math.PI / 2; return (Math.cos(a) * r).toFixed(2) + ',' + (Math.sin(a) * r).toFixed(2); }).join(' ');
const HEX_SVG = '<svg viewBox="-50 -50 100 100" aria-hidden="true">'
  + '<polygon class="hx-in" points="' + HEX_PTS(35) + '"/>'
  + '<polygon class="hx" points="' + HEX_PTS(47) + '"/></svg>';

// control tips are written for a keyboard; on touch they are reworded to name the on-screen buttons
const TOUCH_HINTS = [
  [/hold SPACE, release/gi, 'hold FIRE, release'],
  [/BOOST: SHIFT BRAKE: C/i, 'SPEED: hold BOOST to go faster, BRAKE to slow down'],
  [/Q or E (deflects|sends)/gi, (m, v) => 'tap a ROLL button to ' + v.slice(0, -1)],
  [/BOMB: X clears/i, 'BOMB: tap BOMB to clear'],
];
const touchText = (t) => TOUCH_HINTS.reduce((a, [re, to]) => a.replace(re, to), t);

// what jams the escort's transponder link, shown next to its name
const TROUBLE_TEXT = { gate: 'BLOCKED BY GATE', engine: 'DRIVE FAULT', barrier: 'CUT BY BARRIER', tail: 'JAMMED BY CONTACT' };

export class Hud {
  constructor(ctx, parent) {
    this.ctx = ctx;
    this.W = 1280; this.H = 720;
    this.dispScore = 0;
    this.chain = 0; this.chainT = 0;
    this.hitFlicker = 0;
    this.alarmT = 0;
    this.popIdx = 0;
    this.toastCool = new Map();
    this.toastQueue = [];
    this.lockOwners = new Array(MAX_LOCKS).fill(null);
    this.lastWarn = -99; this.clock = 0;
    this.hintT = 0; this.hintText = ''; this.hintAt = -9;
    this.escortRows = new Map();
    this.escortShown = 0;
    this.touch = device.touch;   // touch layout: shield and boost run along the top, see the TOUCH block in style.css
    this.build(parent);
    this.measure();
    this.bind();
  }

  // ==== DOM
  build(parent) {
    const root = (this.el = h('div', 'hud', null, parent));

    // world-anchored layer first (behind panels)
    this.vignette = h('div', 'hud-vignette', null, root);
    this.lowhp = h('div', 'hud-lowhp', null, root);
    this.flash = h('div', 'hud-flash', null, root);

    // level progress along the top
    const pr = h('div', 'h-progress', null, root);
    this.progFill = h('i', 'h-progress-fill', null, pr);
    this.bossTick = h('b', 'h-progress-boss', null, pr);
    this.progShip = h('em', 'h-progress-ship', null, pr);

    // top left: lives
    const tl = h('div', 'h-tl', null, root);
    const lives = h('div', 'h-lives', null, tl);
    h('span', 'lbl', 'LIVES', lives);
    h('i', 'ship', null, lives);
    h('span', 'x', 'x', lives);
    this.livesEl = h('b', null, '3', lives);

    // top centre: score, KILLS counter, chain, boss bar
    const tc = h('div', 'h-tc', null, root);
    h('div', 'lbl', 'SCORE', tc);
    this.scoreEl = h('div', 'h-score', '0', tc);
    const row = h('div', 'h-tc-row', null, tc);
    const hitBox = h('div', 'h-hit', null, row);
    h('span', 'lbl', 'KILLS', hitBox);
    this.hitEl = h('b', null, '0', hitBox);
    this.chainEl = h('div', 'h-chain', '', row);
    const bs = (this.bossEl = h('div', 'h-boss', null, tc));
    this.bossName = h('div', 'h-boss-name', '', bs);
    const bbar = h('div', 'h-boss-bar', null, bs);
    this.bossLag = h('i', 'lag', null, bbar);
    this.bossFill = h('i', 'fill', null, bbar);
    this.bossLag._v = 1;

    // top right: level name and the transponder link readout
    const tr = h('div', 'h-tr', null, root);
    this.levelEl = h('div', 'h-level', '', tr);
    this.escortEl = h('div', 'h-escort', null, tr);
    h('div', 'lbl', 'TRANSPONDER LINK', this.escortEl);
    this.escortList = h('div', 'h-escort-list', null, this.escortEl);

    // left edge: vertical shield bar with boost beside it, bombs and pulse level below
    const lf = (this.blEl = h('div', 'h-l', null, root));
    const gauges = h('div', 'h-gauges', null, lf);
    const sh = h('div', 'h-gauge', null, gauges);
    this.hpNum = h('span', 'g-num', '100', sh);
    this.hpBar = h('div', 'h-hp', null, sh);
    this.segs = [];
    for (let i = 0; i < SEGMENTS; i++) this.segs.push(h('i', null, null, this.hpBar));
    h('span', 'g-lbl', 'SHIELD', sh);
    const bo = h('div', 'h-gauge boost', null, gauges);
    this.boostTag = h('span', 'g-num', '', bo);
    this.boostBar = h('div', 'h-boost', null, bo);
    this.boostFill = h('i', null, null, this.boostBar);
    h('span', 'g-lbl', 'BOOST', bo);
    const sub = h('div', 'h-sub', null, lf);
    const bb = h('div', 'h-subrow', null, sub);
    h('span', 'lbl', 'BOMBS', bb);
    this.bombRow = h('div', 'h-bombs', null, bb);
    this.bombs = [];
    for (let i = 0; i < 9; i++) this.bombs.push(h('i', 'bomb', null, this.bombRow));
    this.bombExtra = h('span', 'bomb-x', '', this.bombRow);
    const lz = h('div', 'h-subrow', null, sub);
    h('span', 'lbl', 'PULSE', lz);
    const lp = h('div', 'h-laser', null, lz);
    this.laserPips = [0, 1, 2].map(() => h('i', null, null, lp));

    // reticle: one thin ring with four ticks at the aim point
    this.ret = h('div', 'h-ret', null, root);
    h('i', 'ring', null, this.ret);
    for (const c of ['t', 'b', 'l', 'r']) h('i', 'tick ' + c, null, this.ret);
    h('i', 'charge', null, this.ret);
    this.hitMarker = h('div', 'h-hitmarker', null, root);
    for (let i = 0; i < 4; i++) h('i', 'hm' + i, null, this.hitMarker);

    // lock-on indicators: a slowly rotating hexagon frame (broken into six arcs) with a numbered pip
    this.locks = [];
    for (let i = 0; i < MAX_LOCKS; i++) {
      const l = h('div', 'h-lock', null, root);
      const inner = h('div', 'in', null, l);
      const spin = h('div', 'spin', null, inner);
      spin.innerHTML = HEX_SVG;
      l._num = h('b', 'num', String(i + 1), inner);
      l._in = inner; l._vis = false;
      this.locks.push(l);
    }

    // transient layers
    this.pops = [];
    this.popState = new Array(POP_POOL).fill(null);
    for (let i = 0; i < POP_POOL; i++) { const p = h('div', 'h-pop', '', root); this.pops.push(p); }
    this.toasts = h('div', 'h-toasts', null, root);
    this.hintEl = h('div', 'h-hint', null, root);
    this.hintLabel = h('span', 'hl', '', this.hintEl);
    this.hintBody = h('span', 'hb', '', this.hintEl);
    this.bannerEl = h('div', 'h-banner', null, root);
    this.bannerMain = h('div', 'main', '', this.bannerEl);
    this.bannerSub = h('div', 'sub', '', this.bannerEl);
    this.warnEl = h('div', 'h-warning', null, root);
    h('div', 'bar', null, this.warnEl);
    this.warnMain = h('div', 'main', 'WARNING', this.warnEl);
    this.warnSub = h('div', 'sub', '', this.warnEl);
    h('div', 'bar', null, this.warnEl);
  }

  measure() {
    this.W = window.innerWidth || 1280;
    this.H = window.innerHeight || 720;
  }

  bind() {
    const ev = this.ctx.events;
    const on = (n, f) => ev.on(n, f);
    on('player:damage', (p) => this.onDamage(p));
    on('enemy:killed', (p) => this.onKill(p));
    on('enemy:hit', () => this.onHit());
    on('pickup:collected', (p) => this.onPickup(p?.kind));
    on('cell:collected', (p) => this.onPickup(p?.kind, p));
    on('cell:set', () => this.toast('CELL SET COMPLETE', 'gold'));
    on('player:bomb', () => this.screenFlash('rgba(255,210,140,0.9)', 0.55, 420));
    on('boss:defeated', () => this.screenFlash('rgba(255,255,255,0.95)', 0.7, 900));
    on('boss:phase', () => this.screenFlash('rgba(255,120,60,0.7)', 0.35, 300));
    on('ally:rescued', (p) => this.toast('ESCORT SECURE' + (p?.name ? ': ' + String(p.name).toUpperCase() : ''), 'good'));
    on('ally:down', (p) => this.toast('ESCORT LOST' + (p?.name ? ': ' + String(p.name).toUpperCase() : ''), 'bad'));
    on('player:heal', () => this.screenFlash('rgba(70,255,150,0.8)', 0.25, 350));
    on('level:start', () => this.onLevelStart());
  }

  reset() {
    const s = this.ctx.state;
    this.dispScore = s.score || 0;
    this.chain = 0; this.chainT = 0;
    this.hitFlicker = 0; this.alarmT = 0;
    this.bossEl.classList.remove('on');
    setClass(this.el, 'boss-on', false);
    this.bannerEl.classList.remove('on');
    this.warnEl.classList.remove('on');
    this.hintEl.classList.remove('on'); this.hintT = 0;
    this.annCur = null; this.annQueue = []; this.annSeen?.clear();
    this.toasts.textContent = '';
    for (let i = 0; i < POP_POOL; i++) { this.pops[i].style.opacity = '0'; this.popState[i] = null; }
    this.hideLocks(0);
    this.ret.style.opacity = '0';
    this.vignette.style.opacity = '0';
    this.escortList.textContent = ''; this.escortRows.clear(); this.escortShown = 0;
    this.toastQueue.length = 0;
    setClass(this.escortEl, 'on', false);
    setText(this.chainEl, '');
  }

  setVisible(v) { setClass(this.el, 'on', v); }

  // ==== events
  onLevelStart() {
    const info = this.ctx.world?.levelInfo;
    setText(this.levelEl, info?.name ? String(info.name).toUpperCase() : '');
    this.chain = 0; this.chainT = 0;
    this.bossEl.classList.remove('on');
    this.hideLocks(0);
    const bossAt = info?.bossAt, len = info?.length;
    this.bossTick.style.left = bossAt && len ? Math.min(99, (bossAt / len) * 100).toFixed(1) + '%' : '100%';
  }

  onDamage(p) {
    const a = Math.min(1, 0.35 + (p?.amount || 10) / 40);
    // directional marker: a red glow on the screen edge on the side the hit came from, layered over the ordinary vignette
    const dirK = this.ctx.feel?.p.impact.hudDamageDir ?? 0;
    const d = hitDirection(p?.source, this.ctx.player?.position, this._hd ??= { x: 0, y: 0, has: false });
    this.vignette.style.background = d.has && dirK > 0
      ? `radial-gradient(ellipse 60% 60% at ${(50 + d.x * 58).toFixed(1)}% ${(50 - d.y * 58).toFixed(1)}%, rgba(255,60,30,${(0.95 * dirK).toFixed(2)}) 0%, rgba(255,0,0,0) 100%), ${VIGNETTE_BASE}`
      : VIGNETTE_BASE;
    safeAnimate(this.vignette, [{ opacity: a }, { opacity: 0 }], { duration: 650, easing: 'ease-out' });
    this.hitFlicker = 0.55;
    safeAnimate(this.blEl, [
      { transform: 'translate(0,0)' }, { transform: 'translate(-6px,3px)' }, { transform: 'translate(5px,-2px)' },
      { transform: 'translate(-3px,1px)' }, { transform: 'translate(0,0)' }], { duration: 300 });
    this.screenFlash('rgba(255,40,40,0.9)', Math.min(0.12, 0.04 + (p?.amount || 10) / 300), 180);
  }

  onHit() {
    safeAnimate(this.hitMarker, [{ opacity: 1, transform: 'translate(-50%,-50%) scale(1.3)' }, { opacity: 0, transform: 'translate(-50%,-50%) scale(0.8)' }], { duration: 180 });
  }

  onKill(p) {
    const pts = p?.points ?? 0;
    this.chain = this.chainT > 0 ? this.chain + 1 : 1;
    this.chainT = CHAIN_WINDOW;
    if (this.chain >= 2) {
      setText(this.chainEl, 'CHAIN x' + Math.min(this.chain, 99));
      safeAnimate(this.chainEl, [{ transform: 'scale(1.7)', opacity: 0.4 }, { transform: 'scale(1)', opacity: 1 }], { duration: 220, easing: 'cubic-bezier(.2,1.6,.4,1)' });
    }
    const pos = p?.position || p?.enemy?.position;
    if (pos && pts) {
      const s = this.project(pos);
      if (s) this.pop(s.x, s.y, pts, p?.enemy?.boss ?? p?.enemy?.parent ?? p?.enemy ?? null);
    }
  }

  onPickup(kind, info) {
    const map = {
      repair: ['REPAIR', 'good'], health: ['REPAIR', 'good'], bomb: ['BOMB', 'warn'], pulseUpgrade: ['PULSE UPGRADE', 'cyan'],
      shieldCell: ['SHIELD CELL', 'good'], capacitor: ['CAPACITOR', 'violet'],
    };
    const m = map[kind];
    if (!m) return;
    const n = info && typeof info === 'object' && kind === 'shieldCell' && info.chain > 1 ? ' ' + info.chain : '';
    this.toast(m[0] + n, m[1]);
    this.screenFlash(kind === 'bomb' ? 'rgba(255,190,80,0.8)' : kind === 'pulseUpgrade' ? 'rgba(80,230,255,0.8)' : kind === 'capacitor' ? 'rgba(190,130,255,0.8)' : 'rgba(80,255,160,0.8)', 0.2, 320);
  }

  screenFlash(color, alpha, ms) {
    this.flash.style.background = color;
    safeAnimate(this.flash, [{ opacity: alpha }, { opacity: 0 }], { duration: ms, easing: 'ease-out' });
  }

  // Toasts: the same text inside TOAST_DEDUPE shows once (a pickup can fire two events). While the HUD is full (two of
  // banner, transponder panel and comm are up) a toast waits in a short queue instead of piling on.
  toast(text, kind = 'good') {
    const now = this.clock;
    if (this.toastCool.get(text) > now - TOAST_DEDUPE) return;
    this.toastCool.set(text, now);
    if (this.crowded()) {
      if (this.toastQueue.length < 3) this.toastQueue.push({ text, kind, at: now });
      return;
    }
    this.showToast(text, kind);
  }

  showToast(text, kind) {
    const t = h('div', 'toast ' + kind, text, this.toasts);
    while (this.toasts.childElementCount > 2) this.toasts.firstChild.remove();
    setTimeout(() => t.remove(), TOAST_LIFE * 1000);
  }

  // ==== clutter control: banner, transponder panel, comm and toasts. At most two are up at the same moment.
  // Priority: banner, transponder panel, comm, toasts. Comm holds its message and toasts queue while the HUD is full.
  layersUp() {
    return (this.annCur ? 1 : 0) + (this.escortShown > 0 ? 1 : 0);
  }

  // on touch the level title card owns the top of the screen for its 3.6 seconds, so the first comm line waits for it
  commBlocked() { return this.layersUp() >= 2 || (this.touch && this.ctx.ui?.introT > 0); }

  crowded() { return this.layersUp() + (this.ctx.ui?.commBox?.visible ? 1 : 0) >= 2; }

  tickToasts() {
    const q = this.toastQueue;
    if (!q.length) return;
    while (q.length && this.clock - q[0].at > 3) q.shift();
    if (q.length && !this.crowded()) { const t = q.shift(); this.showToast(t.text, t.kind); }
  }

  // A small unobtrusive prompt line for control tips: hint('CHARGE: hold SPACE, release', 4) or, with an explicit label,
  // hint('hold SPACE, release', 4, 'CHARGE'). Without a label the text is split at the colon only when there is exactly one
  // colon and what precedes it is a single short word; anything else is shown whole.
  hint(text, duration = 4, label = null) {
    text = String(text || '').replace(/\s+/g, ' ').trim();
    if (this.touch) text = touchText(text);
    if (!text) return;
    if (text === this.hintText && this.clock - this.hintAt < 1) return;
    this.hintText = text; this.hintAt = this.clock;
    let lab = label ? String(label).trim() : '', body = text;
    if (!lab) {
      const i = text.indexOf(':');
      if (i > 0 && text.indexOf(':', i + 1) < 0 && i <= 12 && !/\s/.test(text.slice(0, i))) { lab = text.slice(0, i); body = text.slice(i + 1).trim(); }
    }
    setText(this.hintLabel, lab);
    setText(this.hintBody, body);
    this.hintLabel.style.display = lab ? '' : 'none';
    this.hintT = Math.max(1.2, Number(duration) || 4);
    this.hintEl.classList.remove('on'); void this.hintEl.offsetWidth; this.hintEl.classList.add('on');
  }

  // Banner and warning share one announcement channel: only one is on screen at a time.
  // Identical text within 3s is dropped (world script and boss code often announce the same thing).
  banner(text, sub) {
    return this.announce('banner', String(text || ''), String(sub || ''), String(text || '') + '|' + String(sub || ''));
  }

  warning(text) {
    const t = text ? String(text) : '';
    const sub = !t || /^warning$/i.test(t) ? '' : t.replace(/^warning[:\s]*/i, '');
    return this.announce('warning', 'WARNING', sub, sub);
  }

  announce(kind, main, sub, rawKey) {
    const key = rawKey.toLowerCase().replace(/[^a-z0-9|]/g, '').replace(/\|$/, '');
    const now = this.clock;
    const seen = this.annSeen ??= new Map();
    if (key && seen.get(key) > now - 3) return false;
    // a bare "WARNING" repeats at most every 0.6s
    if (kind === 'warning' && !sub && now - this.lastWarn < 0.6) return false;
    seen.set(key, now);
    if (kind === 'warning') this.lastWarn = now;
    const item = { kind, main, sub };
    const q = this.annQueue ??= [];
    if (!this.annCur) this.showAnn(item);
    else if (kind === 'warning' && this.annCur.kind === 'banner') { this.showAnn(item); }
    else if (kind === 'warning') { q.unshift(item); }
    else q.push(item);
    while (q.length > 2) q.pop();
    return true;
  }

  showAnn(item) {
    this.annCur = item;
    this.annT = 2.8;
    const banner = item.kind === 'banner';
    const el = banner ? this.bannerEl : this.warnEl;
    this.bannerEl.classList.remove('on'); this.warnEl.classList.remove('on');
    if (banner) { setText(this.bannerMain, item.main); setText(this.bannerSub, item.sub); }
    else { setText(this.warnMain, item.main); setText(this.warnSub, item.sub); }
    void el.offsetWidth;
    el.classList.add('on');
  }

  tickAnn(dt) {
    if (!this.annCur) return;
    this.annT -= dt;
    if (this.annT > 0) return;
    this.bannerEl.classList.remove('on'); this.warnEl.classList.remove('on');
    this.annCur = null;
    const next = this.annQueue?.shift();
    if (next) this.showAnn(next);
  }

  // Score popups. Kills at one target or spot inside POP_MERGE_WINDOW add into a single popup, at most POP_MAX_ACTIVE are up at
  // once (more kills add into the nearest live one), they stagger vertically, and they stay out of the banner and boss bar.
  pop(x, y, pts, key = null) {
    const now = this.clock;
    const R = Math.max(80, this.H * 0.13);
    const live = [];
    for (let i = 0; i < POP_POOL; i++) { const st = this.popState[i]; if (st && now - st.t < POP_LIFE) live.push(i); }
    // same target, or close by: add into the existing popup
    let best = -1, bd = 1e9;
    for (const i of live) {
      const st = this.popState[i];
      const d = Math.hypot(st.x - x, st.y - y);
      const same = key != null && st.key === key;
      if ((same || (now - st.t < POP_MERGE_WINDOW && d < R)) && d < bd) { best = i; bd = d; }
    }
    // full: fold into the most recent popup
    if (best < 0 && live.length >= (this.ctx.state?.boss ? 2 : POP_MAX_ACTIVE)) best = live.reduce((a, i) => (this.popState[i].t > this.popState[a].t ? i : a), live[0]);
    if (best >= 0) {
      const st = this.popState[best];
      st.pts += pts; st.n++; st.t = now;
      this.showPop(best);
      return;
    }
    const i = this.popIdx++ % POP_POOL;
    // stagger: step up until clear of popups that are still floating nearby (allowing for how far they have risen)
    const rise = (st) => 44 * Math.min(1, (now - st.t) / POP_LIFE);
    let py = y;
    for (let tries = 0; tries < 4; tries++) {
      const clash = this.popState.some((st, j) => st && j !== i && now - st.t < POP_LIFE && Math.abs(st.x - x) < R && Math.abs(st.y - rise(st) - py) < 42);
      if (!clash) break;
      py -= 44;
    }
    py = this.clearOfBanners(x, py);
    this.popState[i] = { x, y: py, pts, n: 1, t: now, key };
    this.showPop(i);
  }

  // push a popup position out of the warning banner and the boss bar (the popup then rises 54px, so leave room)
  clearOfBanners(x, y) {
    const H = this.H;
    const bands = [];
    if (this.annCur) {
      const el = this.annCur.kind === 'banner' ? this.bannerEl : this.warnEl;
      const r = el.getBoundingClientRect();
      if (r.height > 0) bands.push([r.top - 8, r.bottom + 8]);
    }
    if (this.ctx.state?.boss) {
      const r = this.bossEl.getBoundingClientRect();
      bands.push([0, Math.max(r.bottom + 6, H * 0.14)]);
    }
    for (const [t, b] of bands) {
      // rises 54px from y: the whole travel range [y - 54, y + 22] must miss the band
      if (y + 22 > t && y - 54 < b) y = b + 58 < H * 0.86 ? b + 58 : t - 26;
    }
    return Math.max(40, Math.min(H * 0.9, y));
  }

  showPop(i) {
    const st = this.popState[i], p = this.pops[i];
    // size follows the value: small kills stay small, big values and combo totals are larger
    p.className = 'h-pop' + (st.pts >= 500 || st.n >= 4 || (st.n >= 3 && st.pts >= 300) ? ' big' : st.pts < 200 && st.n < 3 ? ' sm' : '');
    p.textContent = '+' + fmt(st.pts);
    p.style.left = Math.max(40, Math.min(this.W - 40, st.x)).toFixed(0) + 'px';
    p.style.top = st.y.toFixed(0) + 'px';
    p.getAnimations?.().forEach((a) => a.cancel());
    safeAnimate(p, [
      { opacity: 0, transform: 'translate(-50%,0) scale(0.6)' },
      { opacity: 1, transform: 'translate(-50%,-14px) scale(1.15)', offset: 0.18 },
      { opacity: 1, transform: 'translate(-50%,-30px) scale(1)', offset: 0.62 },
      { opacity: 0, transform: 'translate(-50%,-54px) scale(0.95)' }], { duration: POP_LIFE * 1000, fill: 'forwards', easing: 'ease-out' });
  }

  // ==== projection
  _v = null;
  project(pos, out = this._out ??= { x: 0, y: 0, dist: 0, size: 1 }) {
    const cam = this.ctx.camera;
    if (!cam || !pos) return null;
    const T = this.ctx.THREE;
    const v = this._v ??= new T.Vector3();
    v.set(pos.x, pos.y, pos.z).applyMatrix4(cam.matrixWorldInverse);
    if (v.z > -0.2) return null; // behind the camera
    const dist = -v.z;
    v.applyMatrix4(cam.projectionMatrix);
    if (!(v.x > -1.3 && v.x < 1.3 && v.y > -1.3 && v.y < 1.3)) return null;
    out.x = (v.x * 0.5 + 0.5) * this.W;
    out.y = (-v.y * 0.5 + 0.5) * this.H;
    out.dist = dist;
    out.focal = cam.projectionMatrix.elements[5] * this.H * 0.5;
    return out;
  }

  hideLocks(from) {
    for (let i = from; i < MAX_LOCKS; i++) {
      const l = this.locks[i];
      if (l._vis) { l._vis = false; l.style.opacity = '0'; this.lockOwners[i] = null; }
    }
  }

  // ==== per frame
  update(dt) {
    const ctx = this.ctx, s = ctx.state, pl = ctx.player;
    this.clock += dt;
    this.tickAnn(dt);
    this.tickToasts();
    if (this.hintT > 0) { this.hintT -= dt; if (this.hintT <= 0) this.hintEl.classList.remove('on'); }
    const cam = ctx.camera;
    if (cam) cam.updateMatrixWorld?.();

    // score count-up
    const target = s.score || 0;
    if (this.dispScore !== target) {
      const d = target - this.dispScore;
      this.dispScore = Math.abs(d) < 2 ? target : this.dispScore + d * Math.min(1, dt * 9);
      if (d > 0 && this.dispScore === target) safeAnimate(this.scoreEl, [{ transform: 'scale(1.18)' }, { transform: 'scale(1)' }], { duration: 200 });
    }
    const scoreTxt = fmt(this.dispScore).padStart(1, '0');
    setText(this.scoreEl, scoreTxt);
    if (this.touch) setClass(this.scoreEl, 'long', scoreTxt.length >= 7);   // 100,000 and up shrink so the score keeps clear of the gauges
    if (this._hits !== s.hits) {
      if (this._hits !== undefined && s.hits > this._hits) safeAnimate(this.hitEl, [{ transform: 'scale(1.5)', color: '#fff' }, { transform: 'scale(1)' }], { duration: 220 });
      this._hits = s.hits;
      setText(this.hitEl, String(s.hits || 0));
    }
    if (this.chainT > 0) {
      this.chainT -= dt;
      if (this.chainT <= 0) { this.chain = 0; setText(this.chainEl, ''); }
    }
    setText(this.livesEl, String(Math.max(0, s.lives ?? 0)));

    // progress
    const prog = Math.max(0, Math.min(1, ctx.world?.progress || 0));
    if (this._prog !== prog) {
      this._prog = prog;
      this.progFill.style.transform = `scaleX(${prog.toFixed(4)})`;
      this.progShip.style.left = (prog * 100).toFixed(2) + '%';
    }

    this.updateHealth(dt, s);
    this.updateBoost(s, pl);
    this.updateBombs(s);
    this.updateBoss(dt, s);
    this.updateEscorts();
    this.updateReticles(pl);
  }

  updateHealth(dt, s) {
    const max = s.maxHealth || 100;
    const frac = Math.max(0, Math.min(1, (s.health ?? 0) / max));
    const lit = Math.ceil(frac * SEGMENTS - 1e-6);
    const level = frac > 0.5 ? 0 : frac > 0.25 ? 1 : 2;
    if (this._lit !== lit || this._lvl !== level) {
      this._lit = lit; this._lvl = level;
      for (let i = 0; i < SEGMENTS; i++) setClass(this.segs[i], 'on', i < lit);
      this.hpBar.dataset.lvl = level;
    }
    setText(this.hpNum, String(Math.ceil(frac * 100)));
    // damage flicker
    if (this.hitFlicker > 0) {
      this.hitFlicker -= dt;
      setClass(this.hpBar, 'flick', ((this.hitFlicker * 18) | 0) % 2 === 0);
      if (this.hitFlicker <= 0) setClass(this.hpBar, 'flick', false);
    }
    // low health warning
    const low = frac < 0.3 && frac > 0 && s.phase === 'playing';
    setClass(this.lowhp, 'on', low);
    setClass(this.hpBar, 'low', low);
    // the edge glow follows the same heartbeat as the post pass (src/fx/impact.js) instead of its own CSS pulse
    const imp = this.ctx.impact;
    if (low && imp) {
      const o = (0.12 + 0.75 * imp.lowBeat * (0.4 + 0.6 * imp.lowSev)).toFixed(2);
      if (this._lowO !== o) { this._lowO = o; this.lowhp.style.animation = 'none'; this.lowhp.style.opacity = o; }
    } else if (this._lowO !== undefined) { this._lowO = undefined; this.lowhp.style.animation = ''; this.lowhp.style.opacity = ''; }
    if (low) {
      this.alarmT -= dt;
      if (this.alarmT <= 0) { this.alarmT = frac < 0.15 ? 0.7 : 1.15; this.ctx.audio?.sfx?.('alarm', { volume: 0.5 }); }
    } else this.alarmT = 0;
  }

  updateBoost(s, pl) {
    const b = Math.max(0, Math.min(1, s.boost ?? 1));
    if (this._boost !== b) { this._boost = b; this.boostFill.style.transform = this.touch ? `scaleX(${b.toFixed(3)})` : `scaleY(${b.toFixed(3)})`; }
    const cool = (s.boostCooldown || 0) > 0;
    setClass(this.boostBar, 'cool', cool);
    setClass(this.boostBar, 'burn', !!pl?.isBoosting && !cool);
    setText(this.boostTag, cool ? 'WAIT' : pl?.isBoosting ? 'ON' : pl?.isBraking ? 'BRK' : '');
  }

  updateBombs(s) {
    const n = s.bombs ?? 0;
    if (this._bombs !== n) {
      const grew = this._bombs !== undefined && n > this._bombs;
      this._bombs = n;
      const slots = Math.max(this.ctx.config?.player?.bombs ?? 3, n);
      for (let i = 0; i < this.bombs.length; i++) { setClass(this.bombs[i], 'on', i < n); this.bombs[i].style.display = i < slots ? '' : 'none'; }
      setText(this.bombExtra, n > this.bombs.length ? '+' + (n - this.bombs.length) : '');
      if (grew) safeAnimate(this.bombRow, [{ transform: 'scale(1.3)' }, { transform: 'scale(1)' }], { duration: 260 });
    }
    const lv = s.laserLevel ?? 1;
    if (this._laser !== lv) { this._laser = lv; this.laserPips.forEach((p, i) => setClass(p, 'on', i < lv)); }
  }

  updateBoss(dt, s) {
    const b = s.boss;
    const on = !!b && (b.hp ?? 0) > 0;
    setClass(this.bossEl, 'on', on);
    setClass(this.el, 'boss-on', on);   // the touch comm panel sits under the boss bar
    if (!on) return;
    setText(this.bossName, String(b.name || 'BOSS').toUpperCase());
    const f = Math.max(0, Math.min(1, (b.hp ?? 0) / (b.maxHp || 1)));
    if (this._bossF !== f) { this._bossF = f; this.bossFill.style.transform = `scaleX(${f.toFixed(4)})`; }
    // trailing damage bar
    let lag = this.bossLag._v ?? 1;
    if (lag > f) lag = Math.max(f, lag - dt * 0.35); else lag = f;
    if (lag !== this.bossLag._v) { this.bossLag._v = lag; this.bossLag.style.transform = `scaleX(${lag.toFixed(4)})`; }
  }

  // TRANSPONDER LINK: one row per escort whose link is jammed. Signal bars show how much of the link is left before the
  // contact cuts it (the same countdown as the escort timer, without a percentage).
  updateEscorts() {
    const wm = this.ctx.allies?.wingmen;
    let shown = 0;
    if (wm) {
      for (const w of wm) {
        const c = w.state === 'chased' && w.alive ? w.chase : null;
        let row = this.escortRows.get(w.name);
        if (!c) { if (row) setClass(row.el, 'on', false); continue; }
        if (!row) {
          const el = h('div', 'h-esc', null, this.escortList);
          const head = h('div', 'esc-head', null, el);
          row = { el, name: h('span', 'esc-name', String(w.name).toUpperCase(), head), why: h('span', 'esc-why', '', head), bars: [] };
          const sig = h('span', 'esc-sig', null, head);
          for (let i = 0; i < LINK_BARS; i++) row.bars.push(h('i', null, null, sig));
          this.escortRows.set(w.name, row);
        }
        const frac = Math.max(0, Math.min(1, 1 - c.t / (c.limit || 1)));
        const lit = Math.ceil(frac * LINK_BARS - 1e-6);
        setClass(row.el, 'on', true);
        setClass(row.el, 'low', frac < 0.35);
        setText(row.why, TROUBLE_TEXT[c.kind] || '');
        if (row.lit !== lit) { row.lit = lit; row.bars.forEach((b, i) => setClass(b, 'on', i < lit)); }
        shown++;
      }
    }
    this.escortShown = shown;
    setClass(this.escortEl, 'on', shown > 0);
  }

  updateReticles(pl) {
    if (!pl) return;
    const alive = pl.alive !== false;
    // one ring at the aim point (where the lock scan happens); falls back to the near point
    const pt = alive ? this.project(pl.reticleFar || pl.reticle) : null;
    if (pt) {
      // hit / kill / lock pulse from the impact module: the ring grows and brightens, then settles
      const rp = this.ctx.impact?.reticlePulse || 0, F = this.ctx.feel?.p.impact;
      const sc = F ? 1 + rp * F.reticlePulseScale : 1;
      this.ret.style.opacity = '1';
      this.ret.style.transform = `translate3d(${pt.x.toFixed(1)}px,${pt.y.toFixed(1)}px,0) scale(${sc.toFixed(3)})`;
      const rq = F ? Math.round(rp * 24) : 0;
      if (this._rq !== rq) {
        this._rq = rq;
        this.ret.style.filter = rq ? `brightness(${(1 + (rq / 24) * F.reticlePulseBright).toFixed(2)}) drop-shadow(0 0 ${(rq / 24 * 5).toFixed(1)}px rgba(200,255,250,0.9))` : '';
      }
      this.hitMarker.style.left = pt.x.toFixed(1) + 'px';
      this.hitMarker.style.top = pt.y.toFixed(1) + 'px';
    } else this.ret.style.opacity = '0';
    const charge = typeof pl.charge === 'number' ? pl.charge : typeof pl.chargeLevel === 'number' ? pl.chargeLevel : 0;
    const cv = Math.max(0, Math.min(1, charge)).toFixed(2);
    if (this._charge !== cv) {
      this._charge = cv;
      this.ret.style.setProperty('--charge', cv);
      setClass(this.ret, 'charging', charge > 0.02);
      setClass(this.ret, 'charged', charge >= 0.99);
    }
    setClass(this.ret, 'hot', !!(pl.hovered && pl.hovered.length));

    // lock-on indicators
    const locks = pl.locks;
    let n = 0;
    if (locks && locks.length) {
      for (let i = 0; i < locks.length && n < MAX_LOCKS; i++) {
        const e = locks[i]?.enemy ?? locks[i];
        if (!e || e.alive === false || !e.position) continue;
        const sc = this.project(e.position);
        if (!sc) continue;
        const el = this.locks[n];
        const size = Math.max(38, Math.min(170, ((e.radius || 2) * 2.4 * sc.focal) / sc.dist));
        el.style.width = el.style.height = size.toFixed(0) + 'px';
        el.style.transform = `translate3d(${(sc.x - size / 2).toFixed(1)}px,${(sc.y - size / 2).toFixed(1)}px,0)`;
        if (!el._vis) el.style.opacity = '1';
        el._vis = true;
        if (this.lockOwners[n] !== e) {
          this.lockOwners[n] = e;
          // the frame snaps in from large, overshoots slightly small and settles, bright at first: a clear "tick" per lock
          safeAnimate(el._in, [
            { transform: 'scale(2.6) rotate(70deg)', opacity: 0, filter: 'brightness(3)' },
            { transform: 'scale(0.86) rotate(-4deg)', opacity: 1, filter: 'brightness(2.2)', offset: 0.6 },
            { transform: 'scale(1) rotate(0deg)', opacity: 1, filter: 'brightness(1)' }], { duration: 240, easing: 'cubic-bezier(.2,.9,.3,1)' });
          safeAnimate(el._num, [{ transform: 'scale(1.9)' }, { transform: 'scale(1)' }], { duration: 220, easing: 'cubic-bezier(.2,.9,.3,1.2)' });
        }
        n++;
      }
      this.hideLocks(n);
    } else this.hideLocks(0);
  }
}
