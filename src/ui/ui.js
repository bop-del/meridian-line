// ctx.ui: DOM overlay (HUD, comm box, menus). Driven by ctx.state and ctx.events.
// API: ui.comm({speaker, text, duration}), ui.banner(text, sub), ui.warning(text), ui.hint(text, duration = 4, label),
// ui.toast(text, kind), ui.setCrosshair(bool), ui.hud, ui.screens, ui.commBox.
import './style.css';
import { h } from './dom.js';
import { Hud } from './hud.js';
import { Screens } from './screens.js';
import { Comm } from './comm.js';

const PHASE_SCREEN = { title: 'title', paused: 'pause', pause: 'pause', gameover: 'gameover', levelcomplete: 'levelcomplete', victory: 'victory' };
const HUD_HIDDEN = new Set(['title', 'victory']);

function normPhase(p) {
  return String(p || '').toLowerCase().replace(/[^a-z]/g, '');
}

export const ui = {
  ctx: null,
  root: null,
  hud: null,
  screens: null,
  commBox: null,
  lastPhase: null,
  introT: 0,
  fallbackScreen: false,

  init(ctx, root) {
    this.ctx = ctx;
    root = root || document.getElementById('ui-root');
    this.root = root;
    const wrap = (this.wrap = h('div', 'ui', null, root));
    this.hud = new Hud(ctx, wrap);
    this.commBox = new Comm(ctx, wrap);
    this.buildIntro(wrap);
    this.buildCinema(wrap);
    this.screens = new Screens(ctx, wrap, this);
    h('div', 'ui-scan', null, wrap);

    const ev = ctx.events;
    ev.on('level:start', () => this.onLevelStart());
    ev.on('game:start', () => { if (this.fallbackScreen) this.hideScreens(); });
    ev.on('warning', (p) => this.warning(typeof p === 'string' ? p : p?.text));
    ev.on('boss:spawn', (p) => {
      // world scripts usually raise their own warning; only add one if none appeared recently
      // bosses with an entrance takeover show their own WARNING when the shot ends (Boss.showWarning), so no second banner here
      const hasEntrance = !!ctx.cinema?.shots?.[`boss.${p?.key}.entrance`] || !!ctx.cinema?.active;
      if (!hasEntrance && this.hud.clock - this.hud.lastWarn > 5) this.warning('LARGE CONTACT');
    });
    ev.on('game:over', () => this.fallback('gameover'));
    ev.on('level:complete', () => this.fallback('levelcomplete'));
    ev.on('game:victory', () => this.fallback('victory'));
    ev.on('ui:resume', () => setTimeout(() => {
      if (this.screens.current === 'pause' && normPhase(ctx.state.phase) !== 'paused') this.hideScreens();
    }, 250));
    window.addEventListener('resize', () => this.hud.measure());

    this.syncPhase(true);
  },

  reset() {
    this.hud?.reset();
    this.commBox?.reset();
    // the level intro card is deliberately left alone: 'level:start' may fire before or after reset()
  },

  update(dt, ctx) {
    dt = Math.min(dt || 0.016, 0.1);
    this.syncPhase(false);
    const ph = normPhase(ctx.state.phase);
    if (!HUD_HIDDEN.has(ph)) this.hud.update(dt);
    if (ph !== 'title') this.commBox.update(dt);
    this.screens.update(dt);
    if (this.introT > 0) {
      this.introT -= dt;
      if (this.introT <= 0) this.introEl.classList.remove('on');
    }
    this.updateCinema(ctx);
  },

  // ==== letterbox bars and HUD fade, driven by the cinema director (ctx.cinema.bars, barSize, hudAlpha; frozen while paused)
  buildCinema(parent) {
    const el = (this.cineEl = h('div', 'cine-bars', null, parent));
    this.cineTop = h('div', 'cine-bar top', null, el);
    this.cineBot = h('div', 'cine-bar bot', null, el);
    this._cine = { bars: -1, size: -1, hud: -1 };
  },

  updateCinema(ctx) {
    const c = ctx.cinema, k = this._cine;
    if (!c || !this.cineEl) return;
    const title = normPhase(ctx.state.phase) === 'title';
    let b = title ? Math.min(c.holdBars || 0, c.bars) : c.bars;
    b = Math.max(0, Math.min(1, Number.isFinite(b) ? b : 0));
    b = b * b * (3 - 2 * b);
    const size = Math.max(0, Math.min(0.25, Number.isFinite(c.barSize) ? c.barSize : 0.085));
    if (Math.abs(size - k.size) > 1e-4) { k.size = size; this.cineEl.style.setProperty('--cine-size', `${(size * 100).toFixed(2)}%`); }
    if (Math.abs(b - k.bars) > 1e-3 || (b === 0 && k.bars !== 0)) {
      k.bars = b;
      const s = `scaleY(${b.toFixed(4)})`;
      this.cineTop.style.transform = s; this.cineBot.style.transform = s;
      this.cineEl.classList.toggle('on', b > 0.001);
    }
    let a = title ? 1 : c.hudAlpha;
    a = Math.max(0, Math.min(1, Number.isFinite(a) ? a : 1));
    if (Math.abs(a - k.hud) > 2e-3 || (a === 1 && k.hud !== 1)) {
      k.hud = a;
      this.wrap.style.setProperty('--cine-hud', a.toFixed(3));
      this.wrap.classList.toggle('cine-fade', a < 0.999);
    }
  },

  // ==== phase
  syncPhase(force) {
    const raw = this.ctx.state.phase;
    const ph = normPhase(raw);
    if (!force && ph === this.lastPhase) return;
    const prev = this.lastPhase;
    this.lastPhase = ph;
    this.fallbackScreen = false;
    const name = PHASE_SCREEN[ph];
    if (name) this.screens.show(name); else this.screens.hide();
    this.hud.setVisible(!HUD_HIDDEN.has(ph));
    const a = this.ctx.audio;
    if (ph === 'paused' || ph === 'pause') a?.pauseMusic?.(true);
    else if (prev === 'paused' || prev === 'pause') a?.pauseMusic?.(false);
    if (ph === 'title') { a?.music?.('title'); this.commBox.reset(); this.hud.reset(); this.introEl.classList.remove('on'); }
    if (ph === 'victory') a?.music?.('victory');
    if (ph === 'gameover') a?.music?.('gameover');
  },

  fallback(name) {
    setTimeout(() => {
      const ph = normPhase(this.ctx.state.phase);
      if (ph === 'playing' && !this.screens.current) {
        this.fallbackScreen = true;
        this.screens.show(name);
      }
    }, 2000);
  },

  // ==== level intro card
  buildIntro(parent) {
    const el = (this.introEl = h('div', 'intro', null, parent));
    h('div', 'intro-bar top', null, el);
    h('div', 'intro-bar bot', null, el);
    const c = h('div', 'intro-card', null, el);
    this.introStage = h('div', 'intro-stage', '', c);
    this.introName = h('div', 'intro-name', '', c);
    h('div', 'intro-rule', null, c);
    this.introSub = h('div', 'intro-sub', '', c);
  },

  onLevelStart() {
    const ctx = this.ctx;
    const info = ctx.world?.levelInfo || {};
    this.screens.markLevelStart();
    if (this.fallbackScreen || (this.screens.current && normPhase(ctx.state.phase) === 'playing')) this.hideScreens();
    this.introStage.textContent = 'SORTIE ' + String((ctx.state.levelIndex ?? 0) + 1).padStart(2, '0');
    this.introName.textContent = String(info.name || 'MISSION').toUpperCase();
    this.introSub.textContent = String(info.subtitle || '').toUpperCase();
    this.introEl.classList.remove('on'); void this.introEl.offsetWidth; this.introEl.classList.add('on');
    this.introT = 3.6;
    ctx.audio?.sfx?.('whoosh', { volume: 0.7 });
  },

  // ==== public API
  comm(a, text, duration) {
    if (typeof a === 'string') a = { speaker: a, text, duration };
    a = a ? { ...a } : {};
    this.commBox?.push(a);
  },

  banner(text, sub) { this.hud?.banner(text, sub); },

  warning(text) {
    if (!this.hud) return;
    if (this.hud.warning(text)) this.ctx.audio?.sfx?.('warning');
  },

  // small prompt line for control tips: hint('hold SPACE, release', 4, 'CHARGE'). Without a label the text is split at
  // a colon only when a single short word precedes the only colon, e.g. hint('FLIP: Q or E deflects incoming fire').
  hint(text, duration = 4, label) { this.hud?.hint(text, duration, label); },

  toast(text, kind) { this.hud?.toast(text, kind); },

  showScreen(name) {
    name = String(name || '').toLowerCase().replace(/[^a-z]/g, '');
    const s = PHASE_SCREEN[name] || (this.screens.defs[name] ? name : null);
    if (!s) { this.hideScreens(); return; }
    this.screens.show(s);
  },

  hideScreens() { this.screens?.hide(); },

  setCrosshair(v) { this.hud?.el.classList.toggle('no-reticle', v === false); },
};
