// Music styles. The style chosen on the title screen sets the music for the whole game (title, levels, bosses, stingers).
import { style as a } from './a/index.js';
import { style as b } from './b/index.js';
import { style as c } from './c/index.js';

export const STYLES = { b, a, c };                  // insertion order is the cycle order in the UI (B is the default)
export const DEFAULT_STYLE = 'b';
export const TRACK_NAMES = ['title', 'thalassa', 'cinder', 'foundry', 'boss', 'victory', 'gameover'];

// The selected style persists in localStorage 'meridian-music-style'. The URL param ?style=a|b|c (alias ?title=) wins for
// that page load. The old key 'meridian-title-variant' is read once and migrated.
export const STYLE_KEY = 'meridian-music-style';
export const OLD_STYLE_KEY = 'meridian-title-variant';

const valid = (id, styles = STYLES) => (typeof id === 'string' && id.toLowerCase() in styles ? id.toLowerCase() : null);

/** Returns the selected style id (URL param, then storage, then the old key once, then the default). */
export function selectedStyle(styles = STYLES, def = DEFAULT_STYLE) {
  try {
    const q = new URLSearchParams(location.search);
    const u = valid(q.get('style'), styles) || valid(q.get('title'), styles);
    if (u) return u;
  } catch (e) { /* not in a browser */ }
  try {
    const s = valid(localStorage.getItem(STYLE_KEY), styles);
    if (s) return s;
    const old = valid(localStorage.getItem(OLD_STYLE_KEY), styles);
    if (old) {
      localStorage.setItem(STYLE_KEY, old);
      localStorage.removeItem(OLD_STYLE_KEY);
      return old;
    }
  } catch (e) { /* storage blocked */ }
  return def;
}

export function saveStyle(id) {
  try { localStorage.setItem(STYLE_KEY, id); localStorage.removeItem(OLD_STYLE_KEY); } catch (e) { /* storage blocked */ }
}

/** [{id, name}] in registry (cycle) order. */
export function styleList(styles = STYLES) {
  return Object.keys(styles).map((id) => ({ id, name: styles[id].name }));
}

/** The track module of a style, or null when that style has no track of that name. */
export function styleTrack(styleId, name, styles = STYLES) {
  return styles[styleId]?.tracks?.[name] || null;
}
