// Soft construction folds carved into the sculpt itself.
//
// Stitched seams are thin and live in the shader (seams.mjs).  A fold - the belly's lower edge where it overhangs the legs - is a
// broad soft crease, so it is worth having in the geometry: it then takes light, shadow and baked occlusion like any other form.
// The fold curve is traced from the artwork (python3 scripts/bake/trace-folds.py), lifted onto the torso surface, and the torso
// field is pushed inward around it with a Gaussian profile.
import { readFileSync, existsSync } from 'node:fs';
import { buildModel, P } from './model.mjs';
import { lift } from './lift.mjs';
import { hoodLoop } from './loops.mjs';

const FOLD_FILE = new URL('./.seams/folds.json', import.meta.url).pathname;

/** name -> { part, depth, width } : how deep (units) and how wide (Gaussian sigma, units) each fold is cut. */
export const FOLD_SPEC = {
  belly: { part: 'body', depth: 0.009, width: 0.034 },
};
/** The hood's seam loop (see loops.mjs): a narrower, deeper groove, cut into the head. */
export const LOOP_SPEC = { depth: 0.008, width: 0.02 };

function foldLines(model) {
  if (!existsSync(FOLD_FILE)) return {};
  const data = JSON.parse(readFileSync(FOLD_FILE, 'utf8'));
  const out = {};
  for (const [name, spec] of Object.entries(FOLD_SPEC)) {
    if (!data[name]) continue;
    const pts = [];
    for (const [x, y] of data[name]) {
      const z = lift(model[spec.part], 'z', x, y, 1);
      if (!Number.isNaN(z)) pts.push([x, y, z]);
    }
    if (pts.length > 4) out[name] = pts;
  }
  return out;
}

/** d + depth * exp(-(r / width)^2), r = distance to the fold polyline (3D). Cheap bounding-box reject keeps it fast. */
function carve(field, poly, depth, width, weights = null) {
  const R = width * 3.2, R2 = R * R;
  let x0 = 9, x1 = -9, y0 = 9, y1 = -9, z0 = 9, z1 = -9;
  for (const [x, y, z] of poly) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); z0 = Math.min(z0, z); z1 = Math.max(z1, z); }
  x0 -= R; x1 += R; y0 -= R; y1 += R; z0 -= R; z1 += R;
  const n = poly.length - 1;
  const ax = new Float64Array(n), ay = new Float64Array(n), az = new Float64Array(n), bx = new Float64Array(n), by = new Float64Array(n), bz = new Float64Array(n), il = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    [ax[i], ay[i], az[i]] = poly[i]; [bx[i], by[i], bz[i]] = poly[i + 1];
    const l2 = (bx[i] - ax[i]) ** 2 + (by[i] - ay[i]) ** 2 + (bz[i] - az[i]) ** 2;
    il[i] = 1 / (l2 || 1e-12);
  }
  const inv = 1 / (width * width);
  return (x, y, z) => {
    const d = field(x, y, z);
    if (x < x0 || x > x1 || y < y0 || y > y1 || z < z0 || z > z1) return d;
    let best = R2, bi = -1;
    for (let i = 0; i < n; i++) {
      const abx = bx[i] - ax[i], aby = by[i] - ay[i], abz = bz[i] - az[i];
      const apx = x - ax[i], apy = y - ay[i], apz = z - az[i];
      let t = (apx * abx + apy * aby + apz * abz) * il[i];
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      const dx = apx - abx * t, dy = apy - aby * t, dz = apz - abz * t;
      const r2 = dx * dx + dy * dy + dz * dz;
      if (r2 < best) { best = r2; bi = i; }
    }
    if (best >= R2) return d;
    const w = weights ? 0.5 * (weights[bi] + weights[bi + 1]) : 1;
    return d + depth * w * Math.exp(-best * inv);
  };
}

/** The sculpt with its folds carved in.  Use this (not buildModel) for anything that ends up on screen: the bake and its AO pass. */
export function buildCarvedModel(p = P) {
  const base = buildModel(p);
  const lines = foldLines(base);
  const parts = { head: base.head, body: base.body, armL: base.armL, armR: base.armR };
  for (const [name, poly] of Object.entries(lines)) {
    const spec = FOLD_SPEC[name];
    parts[spec.part] = carve(parts[spec.part], poly, spec.depth, spec.width);
  }
  const loop = hoodLoop(base.head, base.P);
  parts.head = carve(parts.head, loop.pts, LOOP_SPEC.depth, LOOP_SPEC.width, loop.weights);
  const scene = (x, y, z) => Math.min(parts.head(x, y, z), parts.body(x, y, z), parts.armL(x, y, z), parts.armR(x, y, z));
  return { ...parts, scene, P: p, foldLines: lines };
}
