// mascot.config.json as the page and the controller see it (Vite inlines JSON imports).  Browser side only: node scripts read the same
// file through scripts/lib/config.mjs (a JSON import without an import attribute does not load in node).
import config from '../mascot.config.json';

export default config;
export const FRAME = config.frame;                                        // size, ppu, axisX, feetY, topY of the canonical neutral art
export const FIGURE_HEIGHT = (FRAME.feetY - FRAME.topY) / FRAME.ppu;      // character height in units (ear tips to soles)

/**
 * A runtime file's name inside assets/, from its path in mascot.config.json (paths there are relative to the project root).  The page and
 * the build serve assets/ (scripts/sync-public.mjs copies it to public/assets/) and the controller fetches everything relative to its
 * `assetsUrl` option (default `${BASE_URL}assets/`), so a runtime file has to live in assets/.
 */
export function assetPath(path) {
  const m = /^(?:\.?\/)?assets\/(.+)$/.exec(path ?? '');
  if (!m) throw new Error(`mascot.config.json: runtime files must live in assets/ (got "${path}")`);
  return m[1];
}
