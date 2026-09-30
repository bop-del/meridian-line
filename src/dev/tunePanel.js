// Live tuning overlay for ?tune=1. Loaded by dynamic import from game.js, never part of the normal path.
// Plain DOM, no libraries. Reads the registry in src/core/feel.js generically (feel.meta), so any value a module registers
// shows up here with no change to this file: one row per value (label, slider, number, unit, reset dot, hint on hover).
//
// The panel never takes keyboard focus for long: buttons are not focusable, sliders and fields are blurred as soon as you let
// go or move the pointer off the panel, so the keys keep flying the ship. F2 or ` (backquote) shows and hides it.
import { feel, FEEL_STORAGE_KEY } from '../core/feel.js';

const UI_KEY = 'meridian-feel-ui';
const TEST = { turnMs: 800, boostMs: 1200, brakeMs: 1000, rollMs: 60 };
const GROUP_INFO = {
  handling: 'How the ship flies: steering response, banking, camera follow',
  impact: 'Hits and kills: shake, hit-stop, damage feedback',
  speed: 'Sense of speed: FOV, streaks, blur, boost and brake looks',
};

const CSS = `
.mlt, .mlt * { box-sizing: border-box; }
.mlt { position: fixed; top: 8px; right: 8px; bottom: 8px; width: 356px; z-index: 99999; display: flex; flex-direction: column;
  font: 11px/1.3 system-ui, -apple-system, 'Segoe UI', sans-serif; color: #d5dde6; background: rgba(12,15,19,.93);
  border: 1px solid #27313b; border-radius: 8px; box-shadow: 0 6px 28px rgba(0,0,0,.55); opacity: .9; pointer-events: auto;
  user-select: none; -webkit-user-select: none; max-height: calc(100vh - 16px); }
.mlt:hover { opacity: 1; }
.mlt-num, .mlt input[type=number], .mlt-cell b { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
.mlt-head { display: flex; align-items: center; gap: 6px; padding: 7px 9px; border-bottom: 1px solid #222b34; cursor: default; }
.mlt-title { font-weight: 700; letter-spacing: .12em; color: #7fe3d4; }
.mlt-key { color: #667585; font-size: 10px; }
.mlt-badge { display: none; padding: 1px 7px; border-radius: 9px; background: #f2b13d; color: #201400; font-weight: 700; font-size: 10px; letter-spacing: .06em; }
.mlt.mlt-tuned .mlt-badge { display: inline-block; }
.mlt-grow { flex: 1; }
.mlt button { font: inherit; color: #d5dde6; background: #1b242d; border: 1px solid #2c3944; border-radius: 4px; padding: 3px 7px; cursor: pointer; white-space: nowrap; }
.mlt button:hover { background: #26333f; border-color: #3b4c5b; }
.mlt button:active { background: #2f414f; }
.mlt button.mlt-hot { background: #3a2a10; border-color: #7a5a1c; color: #ffd48a; }
.mlt button.mlt-rec { color: #ff8b8b; }
.mlt button.mlt-rec.on { background: #4a1616; border-color: #a03030; color: #ffb0b0; }
.mlt-body { display: flex; flex-direction: column; min-height: 0; flex: 1; }
.mlt.mlt-min { bottom: auto; width: auto; }
.mlt.mlt-min .mlt-body, .mlt.mlt-min .mlt-key { display: none; }
.mlt.mlt-min .mlt-head { border-bottom: 0; }
.mlt-read { display: grid; grid-template-columns: repeat(3, 1fr); gap: 4px; padding: 7px 9px 4px; }
.mlt-cell { padding: 2px 6px !important; }
.mlt-cell { background: #10161c; border: 1px solid #1f2933; border-radius: 4px; padding: 3px 6px; }
.mlt-cell span { display: block; color: #6b7b8b; font-size: 9px; letter-spacing: .08em; }
.mlt-cell b { font-size: 12px; font-weight: 600; color: #e6edf3; }
.mlt-cell b.warn { color: #f2b13d; } .mlt-cell b.bad { color: #ff6b6b; }
.mlt-row1 { display: flex; gap: 4px; padding: 3px 9px; align-items: center; flex-wrap: wrap; }
.mlt-row1 input[type=text], .mlt-row1 select, .mlt textarea { font: inherit; color: #d5dde6; background: #10161c; border: 1px solid #2c3944; border-radius: 4px; padding: 3px 6px; user-select: text; -webkit-user-select: text; }
.mlt-row1 input[type=text] { flex: 1; min-width: 0; }
.mlt-row1 select { flex: 1; min-width: 0; }
.mlt-row1 label { color: #8797a7; display: inline-flex; gap: 4px; align-items: center; }
.mlt-lbl { color: #667585; font-size: 9px; letter-spacing: .1em; width: 100%; padding-top: 2px; }
.mlt-paste { display: none; padding: 3px 9px; }
.mlt-paste.on { display: block; }
.mlt textarea { width: 100%; height: 90px; resize: vertical; font-family: ui-monospace, Menlo, monospace; font-size: 10px; }
.mlt-status { padding: 2px 9px 4px; min-height: 17px; color: #7fe3d4; font-size: 10px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.mlt-status.err { color: #ff8b8b; }
.mlt-scroll { flex: 1; min-height: 60px; margin-top: 4px; overflow-y: auto; overscroll-behavior: contain; border-top: 1px solid #222b34; scrollbar-width: thin; scrollbar-color: #33414e #0c0f13; }
.mlt-group-h { display: flex; align-items: center; gap: 6px; padding: 6px 9px; background: #141b22; border-bottom: 1px solid #1f2933; cursor: pointer; position: sticky; top: 0; z-index: 2; }
.mlt-group-h:hover { background: #19232c; }
.mlt-caret { color: #667585; width: 10px; display: inline-block; transition: transform .12s; }
.mlt-group.open > .mlt-group-h .mlt-caret { transform: rotate(90deg); }
.mlt-gname { font-weight: 700; letter-spacing: .1em; text-transform: uppercase; }
.mlt-gcount { color: #667585; }
.mlt-gtuned { color: #f2b13d; font-weight: 700; }
.mlt-group > .mlt-rows { display: none; }
.mlt-group.open > .mlt-rows, .mlt.mlt-searching .mlt-group > .mlt-rows { display: block; }
.mlt-ginfo { padding: 4px 9px 2px; color: #667585; font-size: 10px; }
.mlt-sec { display: flex; align-items: center; gap: 6px; padding: 5px 9px 4px; color: #6fb8ac; font-size: 10px; letter-spacing: .1em; text-transform: uppercase; background: #0f151a; border-bottom: 1px solid #1a232b; cursor: pointer; }
.mlt-sec:hover { background: #131b21; }
.mlt-sec .mlt-caret { font-size: 9px; }
.mlt-sgroup.open > .mlt-sec .mlt-caret { transform: rotate(90deg); }
.mlt-sgroup > .mlt-srows { display: none; }
.mlt-sgroup.open > .mlt-srows, .mlt.mlt-searching .mlt-sgroup > .mlt-srows { display: block; }
.mlt-stuned { color: #f2b13d; font-weight: 700; }
.mlt-sgroup.hide { display: none; }
.mlt-row { padding: 4px 9px 5px; border-bottom: 1px solid #161d24; }
.mlt-row:hover { background: #121a21; }
.mlt-row.hide, .mlt-group.hide, .mlt-sec.hide, .mlt-ginfo.hide { display: none; }
.mlt-r1 { display: flex; align-items: center; gap: 6px; }
.mlt-name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: #b7c3cf; }
.mlt-row.changed .mlt-name { color: #ffd48a; }
.mlt-unit { color: #667585; font-size: 10px; }
.mlt-dot { width: 12px; height: 12px; padding: 0 !important; border-radius: 50% !important; border: 1px solid #3a4854 !important; background: transparent !important; flex: none; }
.mlt-row.changed .mlt-dot { background: #f2b13d !important; border-color: #f2b13d !important; }
.mlt-row:not(.changed) .mlt-dot { opacity: .35; cursor: default; }
.mlt-r2 { display: flex; align-items: center; gap: 8px; margin-top: 2px; }
.mlt-slot { position: relative; flex: 1; height: 18px; display: flex; align-items: center; }
.mlt-slot input[type=range] { width: 100%; margin: 0; accent-color: #4fc3b3; height: 18px; background: transparent; }
.mlt-row.changed .mlt-slot input[type=range] { accent-color: #f2b13d; }
.mlt-tick { position: absolute; top: 2px; bottom: 2px; width: 2px; margin-left: -1px; background: #8797a7; opacity: .55; pointer-events: none; border-radius: 1px; }
.mlt input[type=number] { width: 68px; font-size: 11px; color: #e6edf3; background: #10161c; border: 1px solid #2c3944; border-radius: 4px; padding: 2px 4px; text-align: right; user-select: text; }
.mlt input[type=number]:focus { border-color: #4fc3b3; outline: none; }
.mlt-empty { padding: 14px; color: #667585; text-align: center; display: none; }
.mlt-hint { border-top: 1px solid #222b34; padding: 5px 9px; min-height: 56px; color: #8797a7; font-size: 10.5px; }
.mlt-hint b { color: #d5dde6; }
.mlt-hint i { color: #667585; font-style: normal; }
`;

const el = (tag, cls, text) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
};
const fmt = (v) => String(+Number(v).toFixed(4));
const safeLS = (fn) => { try { return fn(localStorage); } catch (e) { return null; } };
const isFocusable = (t) => t && (t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA');

export const tunePanel = {
  ctx: null,
  rows: new Map(),        // path -> { row, range, num, dot, tick, meta, group, hay }
  groups: new Map(),      // group -> { el, header, tuned, count, rows: [] }
  ui: { open: true, closed: {} },
  _held: new Map(),
  _readAt: 0,
  _side: 1,

  init(ctx) {
    this.ctx = ctx;
    if (this.root) return;
    const saved = safeLS((ls) => ls.getItem(UI_KEY));
    if (saved) { try { Object.assign(this.ui, JSON.parse(saved)); } catch (e) { /* ignore */ } }
    this._title = document.title;
    this.build();
    this.bindKeys();
    this.unsub = feel.onChange((path) => this.onFeelChange(path));
    this.refreshAll();
    // sections holding loaded overrides start open so a saved or shared setup is visible
    for (const [g, e] of this.groups) for (const sc of e.sections) {
      if (this.ui.closed[`${g}/${sc.name}`] === undefined && sc.list.some((r) => r.row.classList.contains('changed'))) sc.el.classList.add('open');
    }
    if (feel.loadedFrom && feel.loadedFrom !== 'defaults') this.status(`Loaded ${feel.loadedFrom} (${Object.keys(feel.diff()).length} overrides)`);
  },

  reset() {},

  // ------------------------------------------------------------------ build
  build() {
    const style = el('style'); style.textContent = CSS; document.head.appendChild(style);
    const root = this.root = el('div', 'mlt');
    // pointer only: the panel must never eat game input
    for (const ev of ['mousedown', 'contextmenu', 'wheel', 'touchstart']) root.addEventListener(ev, (e) => e.stopPropagation(), { passive: true });
    root.addEventListener('pointerleave', (e) => { if (!e.buttons && document.activeElement !== this.pasteArea) this.releaseFocus(); });
    root.addEventListener('keydown', (e) => { if (e.code === 'Escape') this.releaseFocus(); });

    // header
    const head = el('div', 'mlt-head');
    head.append(el('span', 'mlt-title', 'FEEL'));
    this.badge = el('span', 'mlt-badge', 'TUNED');
    head.append(this.badge, el('span', 'mlt-grow'), el('span', 'mlt-key', 'F2 or ` to hide'));
    this.minBtn = this.button('–', () => this.toggle(), 'Hide the panel (F2)');
    head.append(this.minBtn);
    root.append(head);

    const body = this.body = el('div', 'mlt-body');
    root.append(body);

    // readouts
    const read = el('div', 'mlt-read');
    this.cells = {};
    for (const [k, label] of [['fps', 'FPS'], ['p95', 'FRAME P95'], ['lag', 'CAM LAG'], ['speed', 'RAIL SPEED'], ['fov', 'FOV'], ['shake', 'SHAKE']]) {
      const c = el('div', 'mlt-cell'); c.append(el('span', null, label));
      const b = el('b', null, '-'); c.append(b); this.cells[k] = b; read.append(c);
    }
    body.append(read);

    // search + preset
    const r1 = el('div', 'mlt-row1');
    this.search = el('input'); this.search.type = 'text'; this.search.placeholder = 'Filter values (name, hint, group)';
    this.search.addEventListener('input', () => this.applyFilter());
    this.search.addEventListener('keydown', (e) => { if (e.code === 'Enter' || e.code === 'Escape') { if (e.code === 'Escape') { this.search.value = ''; this.applyFilter(); } this.search.blur(); } e.stopPropagation(); });
    this.presetSel = el('select'); this.presetSel.style.flex = '0 0 132px';
    this.presetSel.addEventListener('change', () => { const v = this.presetSel.value; this.presetSel.blur(); if (v && v !== '__custom') { feel.applyPreset(v); this.status(`Preset ${v} applied`); } });
    r1.append(this.search, this.presetSel);
    body.append(r1);

    // groups (the only part that scrolls)
    const scroll = this.scroll = el('div', 'mlt-scroll');
    for (const g of Object.keys(feel.meta)) this.buildGroup(g, scroll);
    this.empty = el('div', 'mlt-empty', 'Nothing matches the filter.');
    scroll.append(this.empty);
    body.append(scroll);

    // file operations
    const r3 = el('div', 'mlt-row1');
    r3.append(
      this.button('Copy values', () => this.copy(feel.toConfigText(), 'Copied the changed values'), 'Copy only the values that differ from the defaults, as text you can send back'),
      this.button('JSON', () => this.copy(JSON.stringify(feel.snapshot(), null, 2), 'Copied the full JSON snapshot'), 'Copy every value as a JSON snapshot'),
      this.button('Paste', () => this.togglePaste(), 'Load values from a JSON snapshot or a copied values text'),
      this.button('Share link', () => this.shareLink(), 'Copy a link that opens the game with your values applied'),
      this.button('Reset all', () => { feel.reset(); this.status('All values reset to defaults'); }, 'Put every value back to its default'));
    body.append(r3);

    const paste = this.pasteBox = el('div', 'mlt-paste');
    this.pasteArea = el('textarea'); this.pasteArea.placeholder = 'Paste a JSON snapshot or the text from "Copy values" here';
    this.pasteArea.spellcheck = false;
    this.pasteArea.addEventListener('keydown', (e) => e.stopPropagation());
    const pr = el('div', 'mlt-row1'); pr.style.padding = '3px 0 0';
    const lab = el('label'); this.pasteReset = el('input'); this.pasteReset.type = 'checkbox'; this.pasteReset.checked = true;
    lab.append(this.pasteReset, 'reset first');
    pr.append(this.button('Apply', () => this.applyPaste()), this.button('Close', () => this.togglePaste(false)), lab);
    paste.append(this.pasteArea, pr);
    body.append(paste);

    // test moves and hits (synthetic keys and events, same code path as real play)
    const t1 = el('div', 'mlt-row1');
    t1.append(
      this.button('◀ Turn', () => this.press('KeyA', TEST.turnMs), 'Test move: hold left for 0.8 s'),
      this.button('Turn ▶', () => this.press('KeyD', TEST.turnMs), 'Test move: hold right for 0.8 s'),
      this.button('Boost', () => this.press('ShiftLeft', TEST.boostMs), 'Test move: hard boost pulse, 1.2 s'),
      this.button('Brake', () => this.press('KeyC', TEST.brakeMs), 'Test move: brake pulse, 1.0 s'),
      this.button('Roll', () => this.press('KeyQ', TEST.rollMs), 'Test move: barrel roll (Q)'));
    body.append(t1);
    const t2 = el('div', 'mlt-row1');
    this.recBtn = this.button('REC', () => this.toggleRec(), 'Start or stop a telemetry recording');
    this.recBtn.classList.add('mlt-rec');
    t2.append(
      this.button('Damage 10', () => this.damage(10), 'Test hit: the player damage event for 10 points, alternating left and right. No health is lost.'),
      this.button('Damage 25', () => this.damage(25), 'Test hit: a big hit, 25 points. No health is lost.'),
      this.button('Blast', () => this.blast(), 'Test hit: a heavy blast shake'),
      this.recBtn,
      this.button('Report', () => this.copyReport(), 'Copy the telemetry report (frame time, camera lag, input latency) as JSON'));
    body.append(t2);

    this.statusEl = el('div', 'mlt-status');
    body.append(this.statusEl);

    // hint bar
    this.hint = el('div', 'mlt-hint');
    this.setHint(null);
    body.append(this.hint);

    document.body.appendChild(root);
    this.applyOpen();
  },

  button(text, fn, title) {
    const b = el('button', null, text);
    b.type = 'button'; b.tabIndex = -1;
    if (title) b.title = title;
    b.addEventListener('mousedown', (e) => e.preventDefault());   // a click must not leave the button focused (Space would press it)
    b.addEventListener('click', (e) => { e.stopPropagation(); fn(e); b.blur(); });
    return b;
  },

  buildGroup(g, parent) {
    const defs = feel.meta[g];
    const keys = Object.keys(defs);
    const box = el('div', 'mlt-group');
    const h = el('div', 'mlt-group-h');
    const caret = el('span', 'mlt-caret', '▸');
    const name = el('span', 'mlt-gname', g);
    const count = el('span', 'mlt-gcount', `${keys.length}`);
    const tuned = el('span', 'mlt-gtuned', '');
    const resetBtn = this.button('reset', (e) => { e.stopPropagation(); for (const k of keys) feel.reset(`${g}.${k}`); this.status(`${g} reset`); }, `Reset every ${g} value`);
    resetBtn.style.padding = '1px 6px';
    h.append(caret, name, count, tuned, el('span', 'mlt-grow'), resetBtn);
    h.addEventListener('click', () => { box.classList.toggle('open'); this.ui.closed[g] = !box.classList.contains('open'); this.saveUi(); });
    box.append(h);
    const rows = el('div', 'mlt-rows');
    const info = GROUP_INFO[g];
    if (info) rows.append(el('div', 'mlt-ginfo', info));
    const entry = { el: box, tuned, count, rows: [], keys, sections: [] };
    if (!keys.length) rows.append(el('div', 'mlt-ginfo', 'No values registered yet.'));
    // Rows are sectioned by the registered `section` field, or by the text before ": " in the label. Big groups start collapsed.
    const secOf = (m) => m.section || (m.label.includes(': ') ? m.label.split(': ')[0] : null);
    const nSec = new Set(keys.map((k) => secOf(defs[k])).filter(Boolean)).size;
    const foldByDefault = keys.length > 20 && nSec > 2;
    let cur = null;
    for (const k of keys) {
      const m = defs[k];
      const sec = secOf(m);
      const existing = sec && entry.sections.find((x) => x.name === sec);
      if (existing) cur = existing;
      else if (sec && (!cur || cur.name !== sec)) {
        const sg = el('div', 'mlt-sgroup');
        const sh = el('div', 'mlt-sec');
        const sTuned = el('span', 'mlt-stuned', '');
        sh.append(el('span', 'mlt-caret', '▸'), el('span', null, sec), sTuned);
        const sid = `${g}/${sec}`;
        const sRows = el('div', 'mlt-srows');
        sg.append(sh, sRows);
        const closed = this.ui.closed[sid] ?? foldByDefault;
        if (!closed) sg.classList.add('open');
        sh.addEventListener('click', () => { sg.classList.toggle('open'); this.ui.closed[sid] = !sg.classList.contains('open'); this.saveUi(); });
        rows.append(sg);
        cur = { name: sec, el: sg, rows: sRows, tuned: sTuned, list: [] };
        entry.sections.push(cur);
      } else if (!sec) cur = null;
      const rowEl = this.buildRow(g, k, m, entry, sec);
      (cur ? cur.rows : rows).append(rowEl);
      if (cur) cur.list.push(this.rows.get(`${g}.${k}`));
    }
    box.append(rows);
    if (!this.ui.closed[g]) box.classList.add('open');
    this.groups.set(g, entry);
    parent.append(box);
  },

  buildRow(g, k, m, entry, sec) {
    const path = `${g}.${k}`;
    const row = el('div', 'mlt-row');
    row.dataset.path = path;
    const r1 = el('div', 'mlt-r1');
    const name = el('span', 'mlt-name', sec && m.label.startsWith(sec + ': ') ? m.label.slice(sec.length + 2) : m.label);
    name.title = m.hint || m.label;
    const unit = el('span', 'mlt-unit', m.unit || '');
    const dot = el('button', 'mlt-dot'); dot.type = 'button'; dot.tabIndex = -1; dot.title = 'Reset to default';
    dot.addEventListener('mousedown', (e) => e.preventDefault());
    dot.addEventListener('click', (e) => { e.stopPropagation(); feel.reset(path); });
    name.addEventListener('dblclick', () => feel.reset(path));
    r1.append(name, unit, dot);

    const r2 = el('div', 'mlt-r2');
    const slot = el('div', 'mlt-slot');
    const range = el('input'); range.type = 'range'; range.min = m.min; range.max = m.max; range.step = m.step; range.tabIndex = -1;
    range.addEventListener('input', () => feel.set(path, range.value));
    range.addEventListener('pointerup', () => range.blur());
    range.addEventListener('change', () => range.blur());
    const span = m.max - m.min;
    const tick = el('div', 'mlt-tick'); tick.style.left = `calc(7px + (100% - 14px) * ${span > 0 ? (m.value - m.min) / span : 0})`;
    slot.append(range, tick);
    const num = el('input'); num.type = 'number'; num.min = m.min; num.max = m.max; num.step = m.step;
    const commit = () => { const v = parseFloat(num.value); if (Number.isFinite(v)) feel.set(path, v); this.refreshRow(path); };
    num.addEventListener('change', commit);
    num.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.code === 'Enter') { commit(); num.blur(); } else if (e.code === 'Escape') { this.refreshRow(path); num.blur(); }
    });
    r2.append(slot, num);
    row.append(r1, r2);

    row.addEventListener('mouseenter', () => this.setHint(path));
    row.addEventListener('mouseleave', () => this.setHint(null));
    const rec = { row, range, num, dot, tick, meta: m, group: g, hay: `${path} ${m.label} ${m.hint || ''} ${m.section || ''} ${m.unit || ''}`.toLowerCase() };
    this.rows.set(path, rec);
    entry.rows.push(rec);
    return row;
  },

  // ------------------------------------------------------------------ state refresh
  onFeelChange(path) { this.refreshRow(path); this.refreshSummary(); },

  refreshRow(path) {
    const r = this.rows.get(path);
    if (!r) return;
    const [g, k] = path.split('.');
    const v = feel.p[g][k];
    const changed = Math.abs(v - r.meta.value) > 1e-9;
    r.range.value = v;
    if (document.activeElement !== r.num) r.num.value = fmt(v);
    r.row.classList.toggle('changed', changed);
    r.dot.disabled = !changed;
  },

  refreshAll() {
    for (const path of this.rows.keys()) this.refreshRow(path);
    this.refreshSummary();
    this.applyFilter();
  },

  refreshSummary() {
    const d = feel.diff();
    const n = Object.keys(d).length;
    this.root.classList.toggle('mlt-tuned', n > 0);
    this.badge.textContent = `TUNED ${n}`;
    this.badge.title = `${n} value${n === 1 ? '' : 's'} differ from the defaults`;
    document.title = (n ? '[TUNED] ' : '') + this._title;
    for (const [g, e] of this.groups) {
      const c = Object.keys(d).filter((p) => p.startsWith(`${g}.`)).length;
      e.tuned.textContent = c ? `● ${c}` : '';
      for (const sc of e.sections) { const n2 = sc.list.filter((r) => r.row.classList.contains('changed')).length; sc.tuned.textContent = n2 ? `● ${n2}` : ''; }
    }
    // presets
    const names = Object.keys(feel.presets);
    let match = '__custom';
    for (const nme of names) if (feel.presetMatches(nme)) { match = nme; break; }
    const sig = names.join('|');
    if (this._presetSig !== sig) {
      this._presetSig = sig;
      this.presetSel.textContent = '';
      const c = el('option', null, 'Preset: custom'); c.value = '__custom'; c.disabled = true; this.presetSel.append(c);
      for (const nme of names) { const o = el('option', null, `Preset: ${nme}`); o.value = nme; this.presetSel.append(o); }
    }
    this.presetSel.value = match;
  },

  applyFilter() {
    const q = this.search.value.trim().toLowerCase();
    const tokens = q ? q.split(/\s+/) : [];
    this.root.classList.toggle('mlt-searching', tokens.length > 0);
    let any = false;
    for (const e of this.groups.values()) {
      let shown = 0;
      for (const r of e.rows) {
        const ok = tokens.every((t) => r.hay.includes(t));
        r.row.classList.toggle('hide', !ok);
        if (ok) shown++;
      }
      for (const sc of e.sections) sc.el.classList.toggle('hide', tokens.length > 0 && !sc.list.some((r) => !r.row.classList.contains('hide')));
      e.el.classList.toggle('hide', tokens.length > 0 && shown === 0);
      if (shown) any = true;
    }
    this.empty.style.display = tokens.length && !any ? 'block' : 'none';
  },

  setHint(path) {
    const h = this.hint;
    h.textContent = '';
    const r = path && this.rows.get(path);
    if (!r) { h.append('Hover a value to see what it does. Double-click a name or press the dot to reset it. The grey tick on a slider is the default.'); return; }
    const m = r.meta;
    h.append(Object.assign(el('b', null, m.label)), ' ', el('i', null, path), document.createElement('br'), m.hint || 'No description.', document.createElement('br'),
      el('i', null, `default ${fmt(m.value)}${m.unit ? ' ' + m.unit : ''}, range ${fmt(m.min)} to ${fmt(m.max)}, step ${fmt(m.step)}`));
  },

  status(msg, err = false) {
    this.statusEl.textContent = msg;
    this.statusEl.classList.toggle('err', !!err);
    clearTimeout(this._statusT);
    this._statusT = setTimeout(() => { this.statusEl.textContent = ''; }, 5000);
  },

  // ------------------------------------------------------------------ panel visibility and keys
  saveUi() { safeLS((ls) => ls.setItem(UI_KEY, JSON.stringify(this.ui))); },

  applyOpen() {
    this.root.classList.toggle('mlt-min', !this.ui.open);
    this.minBtn.textContent = this.ui.open ? '–' : 'FEEL ▸';
    this.minBtn.title = this.ui.open ? 'Hide the panel (F2)' : 'Show the panel (F2)';
    const t = this.root.querySelector('.mlt-title');
    if (t) t.style.display = this.ui.open ? '' : 'none';
  },

  toggle(force) {
    this.ui.open = typeof force === 'boolean' ? force : !this.ui.open;
    this.applyOpen(); this.saveUi(); this.releaseFocus();
  },

  bindKeys() {
    this._onKey = (e) => {
      if (e.code !== 'F2' && e.code !== 'Backquote') return;
      if (e.code === 'Backquote' && isFocusable(e.target) && e.target.type !== 'range') return;   // let a backquote be typed
      e.preventDefault();
      this.toggle();
    };
    addEventListener('keydown', this._onKey);
  },

  // Give the keyboard back to the game: no control inside the panel keeps focus
  releaseFocus() {
    const a = document.activeElement;
    if (a && this.root.contains(a) && a !== document.body) a.blur();
  },

  // ------------------------------------------------------------------ clipboard, paste, share
  async copy(text, okMsg) {
    let ok = false;
    try { await navigator.clipboard.writeText(text); ok = true; } catch (e) {
      try {
        const ta = el('textarea'); ta.value = text; ta.style.cssText = 'position:fixed;left:-9999px;top:0;';
        document.body.appendChild(ta); ta.select(); ok = document.execCommand('copy'); ta.remove();
      } catch (e2) { ok = false; }
    }
    if (ok) this.status(okMsg);
    else { this.togglePaste(true); this.pasteArea.value = text; this.pasteArea.select(); this.status('Clipboard blocked: the text is in the box below, copy it by hand', true); }
    return ok;
  },

  copyReport() {
    const t = this.ctx.telemetry || window.__telemetry;
    if (!t) { this.status('Telemetry is not loaded yet', true); return; }
    this.copy(JSON.stringify(t.report(), null, 2), 'Copied the telemetry report');
  },

  toggleRec() {
    const t = this.ctx.telemetry || window.__telemetry;
    if (!t) { this.status('Telemetry is not loaded yet', true); return; }
    if (t.recording) { t.stop(); this.status('Recording stopped. Press Copy report to copy the numbers.'); }
    else { t.start(); this.status('Recording. Fly, then stop and copy the report.'); }
  },

  togglePaste(force) {
    const on = typeof force === 'boolean' ? force : !this.pasteBox.classList.contains('on');
    this.pasteBox.classList.toggle('on', on);
    if (on) this.pasteArea.focus(); else { this.pasteArea.blur(); }
  },

  applyPaste() {
    const text = this.pasteArea.value;
    const o = feel.parseText(text);
    if (!o || !Object.keys(o).length) { this.status('Nothing to apply: expected a JSON snapshot or the copied values text', true); return; }
    if (this.pasteReset.checked) feel.reset();
    const r = feel.applyOverrides(o);
    this.status(`Applied ${r.applied} value${r.applied === 1 ? '' : 's'}${r.ignored ? `, ignored ${r.ignored} unknown` : ''}`, r.applied === 0);
    if (r.applied) { this.pasteArea.value = ''; this.togglePaste(false); }
  },

  shareLink() {
    const n = Object.keys(feel.diff()).length;
    const url = new URL(location.href);
    url.searchParams.set('tune', '1');
    if (n) url.searchParams.set('feel', feel.encodeShare()); else url.searchParams.delete('feel');
    const s = url.toString();
    this.copy(s, `Share link copied (${n} override${n === 1 ? '' : 's'}, ${s.length} characters)`);
  },

  // ------------------------------------------------------------------ test moves
  // Synthetic key events go through the real input path (smoothing, stamp, double-tap logic), exactly like the keyboard.
  press(code, ms) {
    const ctx = this.ctx;
    if (ctx.state.phase !== 'playing') { this.status('Start a level first (Enter on the title), then use the test moves', true); return; }
    const key = code.startsWith('Key') ? code.slice(3).toLowerCase() : code;
    const send = (type) => window.dispatchEvent(new KeyboardEvent(type, { code, key, bubbles: true }));
    const cur = this._held.get(code);
    if (cur) clearTimeout(cur); else send('keydown');
    this._held.set(code, setTimeout(() => { this._held.delete(code); send('keyup'); }, ms));
  },

  damage(amount) {
    const ctx = this.ctx, pl = ctx.player, st = ctx.state;
    this._side = -this._side;
    const T = ctx.THREE;
    const pos = new T.Vector3(this._side * 3.2, 0.8, -5).add(pl.position);
    // the same event the player emits, without touching health or invulnerability
    ctx.events.emit('player:damage', { amount, source: 'tune-panel', position: pos, health: st.health, maxHealth: st.maxHealth });
    ctx.fx?.flash?.('#ff2a10', 0.32, 0.28);
    this.status(`Damage ${amount} from the ${this._side < 0 ? 'left' : 'right'}`);
  },

  blast() {
    const ctx = this.ctx;
    ctx.impact?.addShake?.(0.6, 0.45, 'blast');
    ctx.fx?.flash?.('#ffffff', 0.18, 0.2);
    this.status('Blast shake');
  },

  // ------------------------------------------------------------------ per frame
  update(raw) {
    if (!this.root) return;
    const now = performance.now();
    if (now - this._readAt < 250) return;
    this._readAt = now;
    const t = this.ctx.telemetry || window.__telemetry;
    const L = t?.live;
    if (L) {
      const c = this.cells;
      c.fps.textContent = L.fps ? L.fps.toFixed(0) : '-';
      c.p95.textContent = L.msP95 ? `${L.msP95.toFixed(1)} ms` : '-';
      c.p95.className = L.msP95 > 25 ? 'bad' : L.msP95 > 18.5 ? 'warn' : '';
      c.fps.className = L.fps && L.fps < 45 ? 'bad' : L.fps && L.fps < 57 ? 'warn' : '';
      c.lag.textContent = `${L.camLag.toFixed(2)} u`;
      c.speed.textContent = L.speed.toFixed(1);
      c.fov.textContent = `${L.fov.toFixed(1)}°`;
      c.shake.textContent = L.shake.toFixed(3);
      const rec = t.recording;
      this.recBtn.classList.toggle('on', rec);
      this.recBtn.textContent = rec ? `STOP ${((now - t._t0) / 1000).toFixed(0)}s` : 'REC';
    }
  },

  dispose() {
    this.unsub?.();
    removeEventListener('keydown', this._onKey);
    for (const [code, t] of this._held) { clearTimeout(t); window.dispatchEvent(new KeyboardEvent('keyup', { code, bubbles: true })); }
    this._held.clear();
    this.root?.remove();
  },
};

export { FEEL_STORAGE_KEY };
