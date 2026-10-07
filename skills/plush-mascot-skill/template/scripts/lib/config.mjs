// Shared by the node scripts: the project root and mascot.config.json (the single source of truth for names, the registration frame, art paths).
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const loadConfig = (root = ROOT) => JSON.parse(readFileSync(resolve(root, 'mascot.config.json'), 'utf8'));
export const config = loadConfig();

/** Registration frame of the canonical neutral art: size px square, ppu px per unit, axisX column of the body axis, feetY row of the soles, topY row of the head top. */
export const FRAME = config.frame;
export const figureHeightUnits = (FRAME.feetY - FRAME.topY) / FRAME.ppu;
export const path = (...p) => resolve(ROOT, ...p);
