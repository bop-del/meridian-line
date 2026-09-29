// Title music variants. Default is B (dark synthwave). A and C are selectable on the title screen (M key), in the music
// lab, or with ?title=a|b|c in the URL. 
// The choice persists in localStorage 'meridian-title-variant'.
import * as a from './variant_a.js';
import * as b from './variant_b.js';
import * as c from './variant_c.js';
import { VariantPlayer } from './player.js';

export const TITLE_VARIANTS = { a, b, c };
export { VariantPlayer };

export const DEFAULT_TITLE_VARIANT = 'b';
export const TITLE_ORDER = ['b', 'a', 'c']; // cycle order in the game UI

const KEY = 'meridian-title-variant';

/** Returns the selected title variant id (default B). */
export function selectedTitleVariant() {
  let id = null;
  try { id = new URLSearchParams(location.search).get('title'); } catch (e) { /* not in a browser */ }
  if (!id) { try { id = localStorage.getItem(KEY); } catch (e) { /* storage blocked */ } }
  return id && TITLE_VARIANTS[id] ? id : DEFAULT_TITLE_VARIANT;
}

export function saveTitleVariant(id) {
  try { localStorage.setItem(KEY, id); } catch (e) { /* storage blocked */ }
}

export function titleVariantList() {
  return TITLE_ORDER.map((id) => ({ id, name: TITLE_VARIANTS[id].meta.name }));
}
