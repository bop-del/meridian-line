// Full-screen menus: title, pause, game over, level complete, victory. Keyboard and mouse driven.
import { h, setText, fmt } from './dom.js';

const DIFFS = ['easy', 'normal', 'hard'];
const fmtTime = (t) => { t = Math.max(0, Math.round(t || 0)); return Math.floor(t / 60) + ':' + String(t % 60).padStart(2, '0'); };
const VOL_KEY = 'meridian-line-volumes-v1';

const CREDITS = [
  ['MERIDIAN LINE', 'h'],
  ['A NINTH FLIGHT SORTIE', 's'],
  ['', 'gap'],
  ['FLIGHT LEAD', 'r'], ['Sable, Vanta Mk II', 'n'],
  ['ESCORTS', 'r'], ['Vex, Ferro and the drone Pip', 'n'],
  ['FLIGHT CONTROL', 'r'], ['Meridian Control, dispatch and logging', 'n'],
  ['SHIP SYSTEMS', 'r'], ['LUMEN', 'n'],
  ['THE MERIDIAN REACH', 'r'], ['Thalassa Coast, the Cinder Belt, the Obsidian Foundry', 'n'],
  ['THE OPPOSITION', 'r'], ['The Halvane Dominion, and the Regent, patient to the last', 'n'],
  ['VISUAL EFFECTS', 'r'], ['Fire, glass, dust and light', 'n'],
  ['MUSIC AND SOUND', 'r'], ['Every note and every beep is synthesized live', 'n'],
  ['', 'gap'],
  ['BUILT WITH THREE.JS AND WEB AUDIO', 's'],
  ['NO ASSET FILES WERE USED', 's'],
  ['', 'gap'],
  ['FOR THE PILOTS WHO DID NOT COME BACK', 's'],
  ['', 'gap'],
  ['THANK YOU FOR FLYING', 'h'],
];

// ==== letter rank: S, A, B or C from a composite of score against a per-level par, shield remaining, lives lost,
// time and escorts alive. levelInfo.par / levelInfo.parTime override the defaults below.
const PAR_SCORE = [24000, 26000, 30000];
const PAR_TIME = [200, 215, 230]; // seconds
const RANK_CUTS = [['S', 85], ['A', 70], ['B', 50], ['C', 0]];

const clamp01 = (v) => Math.max(0, Math.min(1, v));

export function rankOf(m) {
  const scoreF = clamp01((m.score || 0) / (m.par || 1));
  const over = Math.max(0, Math.min(0.25, (m.score || 0) / (m.par || 1) - 1));
  const shieldF = clamp01(m.shield ?? 1);
  const livesF = clamp01(1 - (m.livesLost || 0) / 2);
  const timeF = clamp01(((m.timePar || 1) * 1.5 - (m.time || 0)) / ((m.timePar || 1) * 0.75));
  const escF = m.escortsTotal ? clamp01((m.escortsAlive || 0) / m.escortsTotal) : 1;
  const total = scoreF * 50 + over * 16 + shieldF * 14 + livesF * 10 + timeF * 6 + escF * 14;
  const letter = RANK_CUTS.find(([, cut]) => total >= cut)[0];
  return { letter, total, scoreF, shieldF, livesF, timeF, escF, livesLost: m.livesLost || 0, escortsAlive: m.escortsAlive, escortsTotal: m.escortsTotal };
}

export class Screens {
  constructor(ctx, parent, ui) {
    this.ctx = ctx; this.ui = ui;
    this.current = null;
    this.defs = {};
    this.difficulty = ctx.state?.difficulty && DIFFS.includes(ctx.state.difficulty) ? ctx.state.difficulty : 'normal';
    this.counters = [];
    this.stars = null;
    this.busyUntil = 0;
    this.volumes = this.loadVolumes();
    this.baseline = { score: 0, hits: 0, kills: 0, lives: 0 };
    this.levelName = '';
    this.results = {};

    this.root = h('div', 'screens', null, parent);
    this.buildTitle();
    this.buildPause();
    this.buildGameOver();
    this.buildLevelComplete();
    this.buildVictory();
    ctx.events.on('game:start', () => { this.results = {}; });
    ctx.events.on('ui:quitToTitle', () => { this.results = {}; });
    window.addEventListener('keydown', (e) => this.onKey(e), true);
    this.applyVolumes(false);
  }

  // ==== helpers
  sfx(n, o) { this.ctx.audio?.sfx?.(n, o); }
  emit(n, p) { this.ctx.events.emit(n, p); }

  screen(name, cls = '') {
    const el = h('div', 'screen ' + name + ' ' + cls, null, this.root);
    const def = { name, el, items: [], index: 0 };
    this.defs[name] = def;
    return def;
  }

  button(def, parent, label, act, cls = '') {
    const b = h('button', 'btn ' + cls, null, parent);
    h('span', 'btn-t', label, b);
    b.type = 'button';
    b.tabIndex = -1;
    const item = { el: b, kind: 'button', act };
    b.addEventListener('click', () => { def.index = def.items.indexOf(item); this.refreshSel(def); this.activate(item); });
    b.addEventListener('mouseenter', () => this.setIndex(def, def.items.indexOf(item)));
    def.items.push(item);
    return item;
  }

  slider(def, parent, label, key) {
    const row = h('div', 'btn slider', null, parent);
    h('span', 'sl-l', label, row);
    const input = h('input', 'sl-i', null, row);
    input.type = 'range'; input.min = '0'; input.max = '100'; input.step = '1'; input.tabIndex = -1;
    input.value = String(Math.round(this.volumes[key] * 100));
    const val = h('span', 'sl-v', input.value, row);
    const item = { el: row, kind: 'slider', key, input, val };
    input.addEventListener('input', () => { this.setVolume(key, input.value / 100); });
    row.addEventListener('mouseenter', () => this.setIndex(def, def.items.indexOf(item)));
    input.addEventListener('mousedown', () => this.setIndex(def, def.items.indexOf(item)));
    def.items.push(item);
    return item;
  }

  setIndex(def, i) {
    if (i < 0 || def.index === i) return;
    def.index = i;
    this.refreshSel(def);
    this.sfx('uiMove', { volume: 0.6 });
  }

  refreshSel(def) {
    def.items.forEach((it, i) => it.el.classList.toggle('sel', i === def.index));
  }

  activate(item) {
    if (performance.now() < this.busyUntil) return;
    if (item.kind === 'button') { this.sfx('uiSelect'); item.act?.(); }
  }

  guard(ms = 500) { this.busyUntil = performance.now() + ms; }

  // ==== volumes
  loadVolumes() {
    const v = { master: 0.8, music: 0.6, sfx: 0.9 };
    try {
      const s = JSON.parse(localStorage.getItem(VOL_KEY) || 'null');
      if (s) for (const k of Object.keys(v)) if (typeof s[k] === 'number') v[k] = Math.max(0, Math.min(1, s[k]));
    } catch (e) { /* storage unavailable */ }
    return v;
  }

  setVolume(key, v) {
    v = Math.max(0, Math.min(1, v));
    this.volumes[key] = v;
    const it = this.defs.pause.items.find((i) => i.key === key);
    if (it) { it.input.value = String(Math.round(v * 100)); it.val.textContent = it.input.value; }
    this.applyVolumes(true);
  }

  applyVolumes(save) {
    this.ctx.audio?.setVolumes?.({ ...this.volumes });
    if (save) { try { localStorage.setItem(VOL_KEY, JSON.stringify(this.volumes)); } catch (e) { /* ignore */ } }
  }

  // ==== title
  buildTitle() {
    const d = this.screen('title');
    this.starCanvas = h('canvas', 'stars', null, d.el);
    h('div', 'title-lift', null, d.el);
    h('div', 'title-grad', null, d.el);
    h('div', 'title-glow', null, d.el);
    const inner = h('div', 'title-inner', null, d.el);
    h('div', 'kicker', 'NINTH FLIGHT PRESENTS', inner);
    const logo = h('div', 'logo', null, inner);
    logo.setAttribute('aria-label', 'MERIDIAN LINE');
    const l1 = h('div', 'logo-1', null, logo);
    [...'MERIDIAN'].forEach((ch, i) => { const sp = h('span', 'lt', ch, l1); sp.style.animationDelay = 0.15 + i * 0.08 + 's'; });
    const rule = h('div', 'logo-rule', null, logo);
    h('i', 'ra', null, rule);
    h('div', 'logo-2', 'LINE', rule);
    h('i', 'rb', null, rule);

    const press = h('button', 'press', null, inner);
    press.type = 'button'; press.tabIndex = -1;
    h('span', null, 'PRESS ENTER', press);
    press.addEventListener('click', () => this.startGame());

    const opts = h('div', 'title-opts', null, inner);
    const diff = h('div', 'diff', null, opts);
    h('div', 'diff-l', 'DIFFICULTY', diff);
    const row = h('div', 'diff-row', null, diff);
    const prev = h('button', 'arrow', '<', row); prev.type = 'button'; prev.tabIndex = -1;
    this.diffPills = DIFFS.map((k) => {
      const b = h('button', 'pill', k.toUpperCase(), row);
      b.type = 'button'; b.tabIndex = -1;
      b.addEventListener('click', () => { this.setDifficulty(k); });
      return b;
    });
    const next = h('button', 'arrow', '>', row); next.type = 'button'; next.tabIndex = -1;
    prev.addEventListener('click', () => this.cycleDifficulty(-1));
    next.addEventListener('click', () => this.cycleDifficulty(1));
    this.diffHint = h('div', 'diff-hint', '', diff);

    // title music selector (M key or click): B is the default, A and C are alternatives
    const mus = h('div', 'diff music-sel', null, opts);
    h('div', 'diff-l', 'TITLE MUSIC', mus);
    const mrow = h('div', 'diff-row', null, mus);
    const mprev = h('button', 'arrow', '<', mrow); mprev.type = 'button'; mprev.tabIndex = -1;
    this.musicName = h('div', 'pill sel music-name', '', mrow);
    const mnext = h('button', 'arrow', '>', mrow); mnext.type = 'button'; mnext.tabIndex = -1;
    mprev.addEventListener('click', () => this.cycleTitleMusic(-1));
    mnext.addEventListener('click', () => this.cycleTitleMusic(1));

    const leg = h('div', 'legend', null, d.el);
    const keys = [
      ['WASD / ARROWS', 'STEER'], ['SPACE / Z', 'FIRE, HOLD TO LOCK'], ['X', 'BOMB'], ['SHIFT', 'BOOST'],
      ['CTRL / C', 'BRAKE'], ['Q / E', 'BARREL ROLL'], ['ESC / P', 'PAUSE'], ['M', 'TITLE MUSIC'],
    ];
    for (const [k, v] of keys) {
      const r = h('div', 'lg', null, leg);
      h('kbd', null, k, r); h('span', null, v, r);
    }
    this.refreshDifficulty();
    this.refreshTitleMusic();
  }

  cycleTitleMusic(d = 1) {
    const a = this.ctx.audio; if (!a?.titleVariants) return;
    const list = a.titleVariants();
    const cur = list.findIndex((v) => v.id === a.getTitleVariant());
    const next = list[(cur + d + list.length) % list.length];
    this.sfx('uiMove', { volume: 0.6 });
    a.setTitleVariant(next.id);
    this.refreshTitleMusic();
  }

  refreshTitleMusic() {
    const a = this.ctx.audio; if (!a?.titleVariants || !this.musicName) return;
    const cur = a.getTitleVariant();
    const v = a.titleVariants().find((x) => x.id === cur);
    this.musicName.textContent = (v ? v.name : 'ORIGINAL').toUpperCase();
  }

  setDifficulty(k) {
    if (!DIFFS.includes(k)) return;
    if (k !== this.difficulty) this.sfx('uiMove', { volume: 0.6 });
    this.difficulty = k;
    this.refreshDifficulty();
  }

  cycleDifficulty(d) {
    const i = (DIFFS.indexOf(this.difficulty) + d + DIFFS.length) % DIFFS.length;
    this.setDifficulty(DIFFS[i]);
  }

  refreshDifficulty() {
    this.diffPills.forEach((p, i) => p.classList.toggle('sel', DIFFS[i] === this.difficulty));
    const hints = { easy: 'Lighter resistance, forgiving damage', normal: 'Standard Halvane resistance', hard: 'Fast, accurate, unforgiving' };
    this.diffHint.textContent = hints[this.difficulty];
  }

  startGame() {
    if (performance.now() < this.busyUntil) return;
    this.guard(900);
    this.ctx.audio?.unlock?.();
    this.sfx('uiSelect');
    if (this.ctx.state) this.ctx.state.difficulty = this.difficulty;
    this.emit('ui:start', { difficulty: this.difficulty });
  }

  // ==== pause
  buildPause() {
    const d = this.screen('pause');
    h('div', 'dim', null, d.el);
    const p = h('div', 'panel', null, d.el);
    h('div', 'panel-title', 'PAUSED', p);
    h('div', 'panel-sub', 'FLIGHT ON HOLD', p);
    const menu = h('div', 'menu', null, p);
    this.button(d, menu, 'RESUME', () => this.doResume());
    this.button(d, menu, 'RESTART MISSION', () => { this.guard(); this.emit('ui:restart'); });
    this.button(d, menu, 'QUIT TO TITLE', () => { this.guard(); this.emit('ui:quitToTitle'); });
    h('div', 'sep', 'AUDIO', menu);
    this.slider(d, menu, 'MASTER', 'master');
    this.slider(d, menu, 'MUSIC', 'music');
    this.slider(d, menu, 'SFX', 'sfx');
    h('div', 'hint', 'ARROWS SELECT  |  ENTER CONFIRM  |  ESC RESUME', p);
  }

  doResume() { this.guard(); this.emit('ui:resume'); }

  // ==== game over
  buildGameOver() {
    const d = this.screen('gameover');
    h('div', 'dim red', null, d.el);
    const p = h('div', 'panel', null, d.el);
    const t = h('div', 'panel-title big red glitch', 'SIGNAL LOST', p);
    t.dataset.t = 'SIGNAL LOST';
    h('div', 'panel-sub', 'VANTA MK II DOWN', p);
    this.goStats = this.statBlock(p, ['SCORE', 'KILLS']);
    const menu = h('div', 'menu', null, p);
    this.button(d, menu, 'RETRY MISSION', () => { this.guard(); this.emit('ui:restart'); });
    this.button(d, menu, 'QUIT TO TITLE', () => { this.guard(); this.emit('ui:quitToTitle'); });
  }

  statBlock(parent, labels) {
    const box = h('div', 'stats', null, parent);
    const out = {};
    for (const l of labels) {
      const r = h('div', 'stat', null, box);
      h('span', 'sk', l, r);
      out[l] = h('b', 'sv', '0', r);
    }
    return out;
  }

  // ==== level complete
  buildLevelComplete() {
    const d = this.screen('levelcomplete');
    h('div', 'dim', null, d.el);
    const p = h('div', 'panel wide', null, d.el);
    h('div', 'panel-title big cyan', 'MISSION COMPLETE', p);
    this.lcName = h('div', 'panel-sub', '', p);
    const body = h('div', 'lc-body', null, p);
    this.lcStats = this.statBlock(body, ['SCORE', 'KILLS']);
    this.lcRank = this.buildRank(body);
    const menu = h('div', 'menu', null, p);
    this.button(d, menu, 'NEXT MISSION', () => { this.guard(); this.emit('ui:nextLevel'); });
    this.button(d, menu, 'QUIT TO TITLE', () => { this.guard(); this.emit('ui:quitToTitle'); });
  }

  // a large thin letter in a hairline frame, with the composite parts as small readout lines
  buildRank(parent) {
    const box = h('div', 'rank-box', null, parent);
    const frame = h('div', 'rank rank-C', null, box);
    h('i', 'rk-corner tl', null, frame); h('i', 'rk-corner br', null, frame);
    const letter = h('div', 'rk-letter', 'C', frame);
    h('div', 'rk-cap', 'RANK', box);
    const lines = h('div', 'rk-lines', null, box);
    return { box, frame, letter, lines };
  }

  // ==== victory
  buildVictory() {
    const d = this.screen('victory');
    this.vStars = h('div', 'dim deep', null, d.el);
    const wrap = h('div', 'victory-wrap', null, d.el);
    const left = h('div', 'v-left', null, wrap);
    h('div', 'panel-title big gold', 'THE LINE HOLDS', left);
    h('div', 'panel-sub', 'THE REGENT IS SILENT', left);
    const vbody = h('div', 'lc-body v-body', null, left);
    this.vStats = this.statBlock(vbody, ['SCORE', 'KILLS']);
    this.vRank = this.buildRank(vbody);
    const menu = h('div', 'menu', null, left);
    this.button(d, menu, 'RETURN TO TITLE', () => { this.guard(); this.emit('ui:quitToTitle'); });
    const cr = h('div', 'credits', null, wrap);
    const roll = h('div', 'roll', null, cr);
    for (const [text, kind] of CREDITS) h('div', 'cr-' + kind, text, roll);
  }

  // ==== show / hide
  bumpStats(target, values, ms = 900) {
    for (const [k, v] of Object.entries(values)) {
      const el = target[k];
      el.textContent = '0';
      this.counters.push({ el, to: v, t: 0, dur: ms / 1000, delay: 0.5 + this.counters.length * 0.12 });
    }
  }

  fillStats(name) {
    const s = this.ctx.state || {};
    const b = this.baseline;
    this.counters.length = 0;
    if (name === 'gameover') this.bumpStats(this.goStats, { SCORE: s.score || 0, KILLS: s.kills || 0 });
    else if (name === 'victory') {
      this.bumpStats(this.vStats, { SCORE: s.score || 0, KILLS: s.kills || 0 });
      this.levelResult(); // make sure the final sortie is recorded
      this.showRank(this.vRank, this.runResult(), true);
    }
    else if (name === 'levelcomplete') {
      const ls = s.levelStats;
      const base = s.levelStart || b;
      const lvlHits = ls ? ls.hits : Math.max(0, (s.hits || 0) - (base.hits || 0));
      const lvlKills = ls ? ls.kills : Math.max(0, (s.kills || 0) - (base.kills || 0));
      this.bumpStats(this.lcStats, { SCORE: s.score || 0, KILLS: lvlKills });
      this.showRank(this.lcRank, this.levelResult());
      const info = this.ctx.world?.levelInfo;
      this.lcName.textContent = String(this.levelName || info?.name || '').toUpperCase() + ' SECURED';
      const last = (s.levelIndex ?? 0) >= (this.ctx.config?.levels?.length ?? 3) - 1;
      this.defs.levelcomplete.items[0].el.style.display = last ? 'none' : '';
    }
  }

  // rank inputs for the sortie that just ended, recorded once per level index
  levelResult() {
    const s = this.ctx.state || {};
    const ls = s.levelStats;
    const idx = ls?.levelIndex ?? s.levelIndex ?? 0;
    const info = this.ctx.world?.levelInfo || {};
    const cfg = this.ctx.config;
    const par = info.par ?? PAR_SCORE[idx] ?? PAR_SCORE[PAR_SCORE.length - 1];
    const timePar = info.parTime ?? PAR_TIME[idx] ?? PAR_TIME[PAR_TIME.length - 1];
    const base = s.levelStart || this.baseline;
    const wm = this.ctx.allies?.wingmen || [];
    const maxHp = ls?.maxHealth ?? s.maxHealth ?? 100;
    const res = rankOf({
      score: ls?.score ?? Math.max(0, (s.score || 0) - (base.score || 0)), par,
      shield: (ls?.health ?? s.health ?? maxHp) / maxHp,
      livesLost: ls?.livesLost ?? Math.max(0, (base.lives ?? this.baseline.lives ?? s.lives) - (s.lives ?? 0)),
      time: ls?.time ?? s.levelTime ?? 0, timePar,
      escortsAlive: ls?.escortsAlive ?? wm.filter((w) => w.alive).length,
      escortsTotal: ls?.escortsTotal ?? wm.length,
    });
    res.score = ls?.score ?? 0; res.par = par; res.time = ls?.time ?? s.levelTime ?? 0;
    this.results[idx] = res;
    return res;
  }

  // whole-run rank: the mean composite of the recorded sorties
  runResult() {
    const list = Object.entries(this.results).sort((a, b) => a[0] - b[0]).map(([, r]) => r);
    const total = list.length ? list.reduce((a, r) => a + r.total, 0) / list.length : 0;
    const letter = RANK_CUTS.find(([, cut]) => total >= cut)[0];
    const sum = (k) => list.reduce((a, r) => a + (r[k] || 0), 0);
    return { letter, total, sorties: list, scoreF: sum('scoreF') / (list.length || 1), shieldF: sum('shieldF') / (list.length || 1),
      livesLost: sum('livesLost'), escortsAlive: list.length ? list[list.length - 1].escortsAlive : 0, escortsTotal: list.length ? list[list.length - 1].escortsTotal : 0 };
  }

  showRank(r, res, run = false) {
    r.frame.className = 'rank rank-' + res.letter;
    r.letter.textContent = res.letter;
    r.lines.textContent = '';
    const row = (k, v) => { const e = h('div', 'rk-l', null, r.lines); h('span', null, k, e); h('b', null, v, e); };
    const pct = (v) => Math.round(v * 100) + '%';
    row('SCORE VS PAR', pct(res.scoreF));
    row('SHIELD LEFT', pct(res.shieldF));
    row('LIVES LOST', String(res.livesLost));
    if (!run) row('TIME', fmtTime(res.time));
    row('ESCORTS', (res.escortsAlive ?? 0) + ' OF ' + (res.escortsTotal ?? 0));
    if (run && res.sorties?.length > 1) {
      const e = h('div', 'rk-sorties', null, r.lines);
      res.sorties.forEach((x, i) => h('span', 'rk-s rank-' + x.letter, String(i + 1) + ' ' + x.letter, e));
    }
    // restart the reveal animation
    r.frame.style.animation = 'none'; void r.frame.offsetWidth; r.frame.style.animation = '';
  }

  show(name) {
    if (this.current === name) return;
    const prev = this.current && this.defs[this.current];
    if (prev) prev.el.classList.remove('on');
    this.current = null;
    const d = this.defs[name];
    if (!d) return;
    this.current = name;
    // restart CSS entrance animations
    d.el.classList.remove('on'); void d.el.offsetWidth; d.el.classList.add('on');
    d.index = 0;
    this.refreshSel(d);
    this.fillStats(name);
    this.guard(350);
    this.root.dataset.screen = name;
    if (name === 'title') this.initStars();
  }

  hide() {
    if (!this.current) return;
    this.defs[this.current].el.classList.remove('on');
    this.current = null;
    this.root.dataset.screen = '';
  }

  markLevelStart() {
    const s = this.ctx.state || {};
    this.baseline = { score: s.score || 0, hits: s.hits || 0, kills: s.kills || 0, lives: s.lives ?? 0 };
    this.levelName = this.ctx.world?.levelInfo?.name || '';
  }

  // ==== input
  onKey(e) {
    const name = this.current;
    if (!name || e.ctrlKey || e.metaKey || e.altKey) return;
    const d = this.defs[name];
    const k = e.key;
    let used = true;
    if (name === 'title') {
      if (k === 'Enter' || k === ' ') { if (!e.repeat) this.startGame(); }
      else if (k === 'm' || k === 'M') this.cycleTitleMusic(1);
      else if (k === 'ArrowLeft' || k === 'a' || k === 'A') this.cycleDifficulty(-1);
      else if (k === 'ArrowRight' || k === 'd' || k === 'D') this.cycleDifficulty(1);
      else if (k === 'ArrowUp' || k === 'ArrowDown' || k === 'w' || k === 's') this.cycleDifficulty(k === 'ArrowUp' || k === 'w' ? -1 : 1);
      else used = false;
      if (used) e.preventDefault();
      return;
    }
    const n = d.items.length;
    if (k === 'ArrowDown' || k === 's' || k === 'S') this.setIndex(d, (d.index + 1) % n);
    else if (k === 'ArrowUp' || k === 'w' || k === 'W') this.setIndex(d, (d.index - 1 + n) % n);
    else if (k === 'ArrowLeft' || k === 'ArrowRight' || k === 'a' || k === 'd') {
      const it = d.items[d.index];
      if (it?.kind === 'slider') {
        const dir = k === 'ArrowLeft' || k === 'a' ? -1 : 1;
        this.setVolume(it.key, this.volumes[it.key] + dir * 0.05);
        this.sfx('uiMove', { volume: 0.5, pitch: 1 + this.volumes[it.key] * 0.6 });
      }
    } else if ((k === 'Enter' || k === ' ') && !e.repeat) {
      const it = d.items[d.index];
      if (it && it.el.style.display !== 'none') this.activate(it);
    } else if (k === 'Escape' && !e.repeat && name === 'pause') {
      // game.js may already toggle pause from input; only resume if it did not
      setTimeout(() => { if (this.ctx.state?.phase === 'paused' && this.current === 'pause') this.doResume(); }, 90);
      used = false;
    } else used = false;
    if (used) e.preventDefault();
  }

  // ==== per frame
  update(dt) {
    if (!this.current) return;
    if (this.counters.length) {
      for (const c of this.counters) {
        c.delay -= dt;
        if (c.delay > 0) continue;
        c.t += dt;
        const f = Math.min(1, c.t / c.dur);
        const e = 1 - Math.pow(1 - f, 3);
        const v = Math.round(c.to * e);
        if (c._v !== v) { c._v = v; c.el.textContent = fmt(v); }
      }
      if (this.counters.every((c) => c.t >= c.dur)) this.counters.length = 0;
    }
    if (this.current === 'title') this.drawStars(dt);
  }

  initStars() {
    const c = this.starCanvas;
    const w = (c.width = Math.min(1280, window.innerWidth));
    const hh = (c.height = Math.min(720, window.innerHeight));
    if (!this.stars) {
      this.stars = Array.from({ length: 170 }, () => ({ x: Math.random() * 2 - 1, y: Math.random() * 2 - 1, z: Math.random(), hue: Math.random() }));
    }
    this.sw = w; this.sh = hh;
  }

  drawStars(dt) {
    const c = this.starCanvas, g = (this.sg ??= c.getContext('2d'));
    if (c.width !== this.sw) this.initStars();
    const w = c.width, hh = c.height;
    g.clearRect(0, 0, w, hh);
    const cx = w * 0.5, cy = hh * 0.46;
    for (const s of this.stars) {
      const pz = s.z;
      s.z -= dt * 0.28;
      if (s.z <= 0.02) { s.z = 1; s.x = Math.random() * 2 - 1; s.y = Math.random() * 2 - 1; continue; }
      const k = 1 / s.z;
      const x = cx + s.x * k * w * 0.05 * 3, y = cy + s.y * k * hh * 0.05 * 3;
      const px = cx + s.x * (1 / pz) * w * 0.15, py = cy + s.y * (1 / pz) * hh * 0.15;
      if (x < -20 || x > w + 20 || y < -20 || y > hh + 20) { s.z = 1; continue; }
      const a = Math.min(1, (1 - s.z) * 1.4);
      g.strokeStyle = s.hue > 0.8 ? `rgba(255,190,110,${a})` : `rgba(160,240,228,${a})`;
      g.lineWidth = 0.6 + (1 - s.z) * 1.8;
      g.beginPath(); g.moveTo(px, py); g.lineTo(x, y); g.stroke();
    }
  }
}
