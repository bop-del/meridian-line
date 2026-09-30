// Live tunables for the feel work. One registry, three groups (handling, impact, speed), each registered by its module in
// src/feel/<group>.js. Modules read feel.p.<group>.<key> EVERY FRAME (never cache the value) so the ?tune=1 panel takes
// effect instantly.
//
//   feel.register(group, { key: { value, min, max, step, label, unit?, hint? }, ... })
//   feel.p.handling.accel            live value
//   feel.get('handling.accel') / feel.set('handling.accel', 14) / feel.reset('handling.accel') / feel.reset()
//   feel.snapshot()                  { group: { key: value } } of every registered value
//   feel.toConfigText()              copy-paste text of the values that differ from the defaults
//   feel.definePreset(name, { 'group.key': value })   feel.applyPreset(name)   feel.presets
//   feel.onChange(fn)                fn(path, value) after every set
//
// Dev-only additions (used by the ?tune=1 panel and the feel bot):
//   feel.diff()                      { 'group.key': value } of every value that differs from its default
//   feel.isTuned()                   true when any value differs from its default
//   feel.applyOverrides(obj)         loads { group: { key: v } } or { 'group.key': v }; returns { applied, ignored }
//   feel.parseText(text)             JSON snapshot, flat JSON, or the toConfigText() format, returns an overrides object
//   feel.encodeShare() / feel.decodeShare(str)   url-safe base64 of the nested overrides (the ?feel= parameter)
//   feel.presetMatches(name)         true when the live values equal the defaults plus that preset
// With ?tune=1 the registry loads its saved values at startup: ?feel=<base64 overrides> when present (the share link is
// the complete set of overrides), otherwise localStorage 'meridian-feel'. Every later change is saved back.
import { registerHandling } from '../feel/handling.js';
import { registerImpact } from '../feel/impact.js';
import { registerSpeed } from '../feel/speed.js';
import { registerLook } from '../feel/look.js';
import { registerSky } from '../feel/sky.js';
import { registerAtmosphere } from '../feel/atmosphere.js';
import { registerCinema } from '../feel/cinema.js';
import { registerAudio } from '../feel/audio.js';

const listeners = new Set();

export const feel = {
  p: {},          // live values, feel.p[group][key]
  meta: {},       // feel.meta[group][key] = { value (default), min, max, step, label, unit, hint }
  presets: {},

  register(group, defs) {
    const p = (this.p[group] ??= {});
    const m = (this.meta[group] ??= {});
    for (const [key, d] of Object.entries(defs)) {
      m[key] = { min: 0, max: 1, step: 0.01, label: key, unit: '', hint: '', ...d };
      p[key] = d.value;
    }
  },

  // only registered names count: a crafted path such as 'constructor.name' or '__proto__.x' must never reach an inherited property
  has(g, k) { return Object.hasOwn(this.meta, g) && Object.hasOwn(this.meta[g], k); },

  get(path) { const [g, k] = path.split('.'); return this.has(g, k) ? this.p[g][k] : undefined; },

  set(path, v) {
    const [g, k] = path.split('.');
    if (!this.has(g, k)) return false;
    const m = this.meta[g][k];
    v = Number(v);
    if (!Number.isFinite(v)) return false;
    this.p[g][k] = Math.min(m.max, Math.max(m.min, v));
    listeners.forEach((fn) => fn(path, this.p[g][k]));
    return true;
  },

  reset(path) {
    if (path) { const [g, k] = path.split('.'); return this.set(path, this.meta[g]?.[k]?.value); }
    for (const g of Object.keys(this.meta)) for (const k of Object.keys(this.meta[g])) this.set(`${g}.${k}`, this.meta[g][k].value);
    return true;
  },

  snapshot() {
    const out = {};
    for (const g of Object.keys(this.p)) out[g] = { ...this.p[g] };
    return out;
  },

  toConfigText() {
    const lines = [];
    for (const g of Object.keys(this.meta)) {
      for (const k of Object.keys(this.meta[g])) {
        const cur = this.p[g][k], def = this.meta[g][k].value;
        if (Math.abs(cur - def) > 1e-9) lines.push(`  ${g}.${k}: ${+cur.toFixed(4)},   // default ${def}`);
      }
    }
    return lines.length ? `feel overrides:\n${lines.join('\n')}` : 'feel overrides: none (all defaults)';
  },

  diff() {
    const out = {};
    for (const g of Object.keys(this.meta)) {
      for (const k of Object.keys(this.meta[g])) {
        const cur = this.p[g][k], def = this.meta[g][k].value;
        if (Math.abs(cur - def) > 1e-9) out[`${g}.${k}`] = +cur.toFixed(6);
      }
    }
    return out;
  },

  isTuned() { return Object.keys(this.diff()).length > 0; },

  // Accepts nested { group: { key: v } } (snapshot or overrides) or flat { 'group.key': v }. Unknown keys are counted, not fatal.
  applyOverrides(obj) {
    let applied = 0, ignored = 0;
    const put = (path, v) => { if (this.set(path, v)) applied++; else ignored++; };
    if (obj && typeof obj === 'object') {
      for (const [a, b] of Object.entries(obj)) {
        if (b && typeof b === 'object') for (const [k, v] of Object.entries(b)) put(`${a}.${k}`, v);
        else put(a, b);
      }
    }
    return { applied, ignored };
  },

  parseText(text) {
    const t = String(text ?? '').trim();
    try {
      const j = JSON.parse(t);
      if (j && typeof j === 'object') return j;
    } catch (e) { /* fall through to the text format */ }
    const out = {};
    const re = /^\s*([A-Za-z0-9_]+)\.([A-Za-z0-9_]+)\s*:\s*(-?\d*\.?\d+(?:e[+-]?\d+)?)/i;
    for (const line of t.split(/\r?\n/)) {
      const m = re.exec(line);
      if (m) (out[m[1]] ??= {})[m[2]] = Number(m[3]);
    }
    return out;
  },

  encodeShare() {
    const nested = {};
    for (const [path, v] of Object.entries(this.diff())) { const [g, k] = path.split('.'); (nested[g] ??= {})[k] = v; }
    return btoa(JSON.stringify(nested)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  },

  decodeShare(str) {
    try {
      let b = String(str).replace(/-/g, '+').replace(/_/g, '/');
      while (b.length % 4) b += '=';
      return JSON.parse(atob(b));
    } catch (e) { return null; }
  },

  presetMatches(name) {
    const pre = this.presets[name];
    if (!pre) return false;
    for (const g of Object.keys(this.meta)) {
      for (const k of Object.keys(this.meta[g])) {
        const path = `${g}.${k}`;
        const m = this.meta[g][k];
        const want = path in pre ? Math.min(m.max, Math.max(m.min, pre[path])) : m.value;
        if (Math.abs(this.p[g][k] - want) > 1e-9) return false;
      }
    }
    return true;
  },

  definePreset(name, values) { this.presets[name] = values; },
  applyPreset(name) {
    const v = this.presets[name];
    if (!v) return false;
    this.reset();
    for (const [path, val] of Object.entries(v)) this.set(path, val);
    return true;
  },

  onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); },
};

registerHandling(feel);
registerImpact(feel);
registerSpeed(feel);
registerLook(feel);
registerSky(feel);
registerAtmosphere(feel);
registerCinema(feel);
registerAudio(feel);

// ?tune=1 only: restore saved values (share link first, then localStorage) and keep saving. Never runs on the normal path.
export const FEEL_STORAGE_KEY = 'meridian-feel';
if (typeof location !== 'undefined' && new URLSearchParams(location.search).get('tune') === '1') {
  const params = new URLSearchParams(location.search);
  const safeStore = (fn) => { try { return fn(localStorage); } catch (e) { return null; } };
  feel.loadedFrom = 'defaults';
  const shared = params.get('feel');
  if (shared) {
    const o = feel.decodeShare(shared);
    if (o) { feel.applyOverrides(o); feel.loadedFrom = 'share link'; }
  } else {
    const saved = safeStore((ls) => ls.getItem(FEEL_STORAGE_KEY));
    if (saved) {
      try { const r = feel.applyOverrides(JSON.parse(saved)); if (r.applied) feel.loadedFrom = 'saved values'; } catch (e) { /* ignore a corrupt entry */ }
    }
  }
  const flush = () => {
    const d = feel.diff();
    safeStore((ls) => { if (Object.keys(d).length) ls.setItem(FEEL_STORAGE_KEY, JSON.stringify(d)); else ls.removeItem(FEEL_STORAGE_KEY); });
  };
  feel.onChange(flush);   // tiny JSON, written straight away so a closed tab never loses a tweak
  flush();
}
