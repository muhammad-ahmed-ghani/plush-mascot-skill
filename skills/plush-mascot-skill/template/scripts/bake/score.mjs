// Plain silhouette agreement between the sculpt and the reference artwork (needs `python3 scripts/bake/refmasks.py`).
//   node scripts/bake/score.mjs [--size 627]
import { readFileSync } from 'node:fs';
import { buildModel } from './model.mjs';
import { renderMask, iou } from './silhouette.mjs';

const args = Object.fromEntries(process.argv.slice(2).reduce((a, v, i, all) => (v.startsWith('--') ? [...a, [v.slice(2), all[i + 1] ?? true]] : a), []));
const size = +(args.size ?? 627);
const refs = new URL('./.refs/', import.meta.url).pathname;
const load = (name) => new Uint8Array(readFileSync(`${refs}${name}_${size}.bin`));
const model = buildModel();
const front = renderMask(model.scene, 'front', size), side = renderMask(model.scene, 'side', size);
const rf = load('ref_front_sym'), rs = load('ref_side');
const scale = (350 * size) / 1254, oy = (1204 * size) / 1254;
const rowsAbove = (h) => Math.ceil(oy - h * scale) * size;     // pixel count above height h
const region = (a, b, from, to) => iou(a.subarray(rowsAbove(to), rowsAbove(from)), b.subarray(rowsAbove(to), rowsAbove(from)));
console.log(`front IoU ${iou(front, rf).toFixed(4)}   side IoU ${iou(side, rs).toFixed(4)}   (${size}px)`);
console.log(`front  ears(2.55-3.4) ${region(front, rf, 2.55, 3.4).toFixed(3)}   head(1.6-2.55) ${region(front, rf, 1.6, 2.55).toFixed(3)}   body(0.6-1.6) ${region(front, rf, 0.6, 1.6).toFixed(3)}   legs(0-0.6) ${region(front, rf, 0, 0.6).toFixed(3)}`);
console.log(`side   ears(2.55-3.4) ${region(side, rs, 2.55, 3.4).toFixed(3)}   head(1.6-2.55) ${region(side, rs, 1.6, 2.55).toFixed(3)}   body(0.6-1.6) ${region(side, rs, 0.6, 1.6).toFixed(3)}   legs(0-0.6) ${region(side, rs, 0, 0.6).toFixed(3)}`);
