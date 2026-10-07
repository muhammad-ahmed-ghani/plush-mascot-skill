// The page's colours, from mascot.config.json: `palette` (the character's own colours) and `page.colors` (the few the page derives
// from them for text).  The 3D model does not use these: its fabric colours are fitted to the artwork (see src/mascot-fabric.js).
//
//   CSS token        config key                  what it colours
//   --ink            palette.ink                 dark words, dark stitches, the working room
//   --mascot         palette.body                felt pieces, the patch button's stitching, the prints' tape, the selection
//   --face           palette.face                the primary button's felt patch, felt pieces
//   --eye            palette.eye                 its swatch
//   --paper          palette.paper               the page's paper: the first room, its swatch, the browser's theme colour
//   --accent-base    palette.accent              the glows behind the working and night scenes, felt pieces
//   --ink-light      page.colors.lightInk        light words on dark rooms, light stitches, cream felt
//   --accent-light   page.colors.accentOnLight   handwriting, emphasis and focus rings on light rooms (the default --accent)
//   --accent-dark    page.colors.accentOnDark    ... on dark rooms (src/page/story.js picks the one that reads best)
//   --mascot-text    page.colors.mascotText      words set in the mascot's colour (large, so 3:1 on the paper is enough)
//
// style.css carries the example's values as fallbacks; index.html writes the configured ones into :root before the first paint (a token
// block filled by vite.config.js), and applyPalette() writes them again when the page's script starts, so a page that uses the scripts
// without that block stays in step.  The scripts read the same values from PALETTE and PAGE_COLORS.
import config from '../config.js';
import { hexToRgb } from './color.js';

const lower = (o) => Object.fromEntries(Object.entries(o ?? {}).filter(([, v]) => typeof v === 'string').map(([k, v]) => [k, v.toLowerCase()]));

export const PALETTE = { ink: '#16171c', body: '#f05c63', face: '#24252b', eye: '#fff1dd', paper: '#f2e8d7', accent: '#f53b63', ...lower(config.palette) };
export const PAGE_COLORS = { lightInk: '#fff1dd', accentOnLight: '#b3203f', accentOnDark: '#ff8fa6', mascotText: '#e2474f', ...lower(config.page?.colors) };

export const TOKENS = {
  '--ink': PALETTE.ink, '--mascot': PALETTE.body, '--face': PALETTE.face, '--eye': PALETTE.eye, '--paper': PALETTE.paper, '--accent-base': PALETTE.accent,
  '--ink-light': PAGE_COLORS.lightInk, '--accent-light': PAGE_COLORS.accentOnLight, '--accent-dark': PAGE_COLORS.accentOnDark, '--mascot-text': PAGE_COLORS.mascotText,
};

/** Write the colour tokens onto :root. */
export function applyPalette(root = document.documentElement) {
  for (const [name, value] of Object.entries(TOKENS)) root.style.setProperty(name, value);
}

/** A hex colour as CSS rgb(), optionally at partial opacity: rgb(r g b) or rgb(r g b / a). */
export function rgb(hex, a) {
  const [r, g, b] = hexToRgb(hex);
  return a === undefined ? `rgb(${r} ${g} ${b})` : `rgb(${r} ${g} ${b} / ${a})`;
}
