// Title music variants: kept as a thin view over the music styles (src/audio/styles/registry.js), which now own the
// selection, persistence (localStorage 'meridian-music-style') and the URL params (?style= and the ?title= alias).
import { STYLES, DEFAULT_STYLE, selectedStyle, saveStyle, styleList } from '../styles/registry.js';
import { VariantPlayer } from './player.js';

export const TITLE_VARIANTS = Object.fromEntries(Object.entries(STYLES).map(([id, s]) => [id, s.tracks.title]));
export { VariantPlayer };

export const DEFAULT_TITLE_VARIANT = DEFAULT_STYLE;
export const TITLE_ORDER = Object.keys(STYLES);

export const selectedTitleVariant = selectedStyle;
export const saveTitleVariant = saveStyle;
export const titleVariantList = styleList;
