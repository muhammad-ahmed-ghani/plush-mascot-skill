// Fast software preview of the SDF sculpt (no browser, no meshing).
//   node scripts/bake/preview.mjs --view front --size 627 --out /tmp/front.png
//   views: front | side | back | q3 (three-quarter) | q3r ; --mode shaded | mask
// Uses every core via worker_threads; orthographic camera whose scale matches
// assets/mascot-transparent.png (350 px per unit, feet at y=0) so masks overlay 1:1.
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import { availableParallelism } from 'node:os';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import { buildModel, cloneParams, faceOpening } from './model.mjs';
import { writePNG } from './png.mjs';
import { VIEW_YAW } from './silhouette.mjs';

const args = Object.fromEntries(process.argv.slice(2).reduce((a, v, i, all) => (v.startsWith('--') ? [...a, [v.slice(2), all[i + 1] ?? true]] : a), []));

const REF = 1254, REF_S = 350, REF_X0 = 625, REF_Y0 = 1204;

function renderRows(y0, y1, size, view, mode, overrides) {
  const model = buildModel(overrides ? cloneParams(overrides) : undefined);
  const f = model.scene;
  const scale = (REF_S * size) / REF, ox = (REF_X0 * size) / REF, oy = (REF_Y0 * size) / REF;
  const yaw = VIEW_YAW[view] ?? 0;
  const cy = Math.cos(yaw), sy = Math.sin(yaw);
  const out = new Uint8ClampedArray((y1 - y0) * size * 4);
  const L = (() => { const v = [-0.55, 0.75, 0.62]; const n = Math.hypot(...v); return v.map((c) => c / n); })();
  const e = 0.004;
  const N = [0, 0, 0];
  for (let py = y0; py < y1; py++) {
    for (let px = 0; px < size; px++) {
      const ux = (px + 0.5 - ox) / scale;
      const uy = (oy - (py + 0.5)) / scale;
      // ray in view space: origin (ux, uy, +5) dir (0,0,-1); rotate by yaw around y into model space
      let t = 0, hit = false, hx = 0, hy = 0, hz = 0;
      for (let i = 0; i < 140; i++) {
        const vz = 5 - t;
        const mx = cy * ux + sy * vz, mz = -sy * ux + cy * vz;
        const d = f(mx, uy, mz);
        if (d < 0.0015) { hit = true; hx = mx; hy = uy; hz = mz; break; }
        t += Math.max(d * 0.85, 0.002);
        if (t > 10) break;
      }
      const o = ((py - y0) * size + px) * 4;
      if (!hit) { out[o + 3] = 0; continue; }
      if (mode === 'mask') { out[o] = out[o + 1] = out[o + 2] = 255; out[o + 3] = 255; continue; }
      N[0] = f(hx + e, hy, hz) - f(hx - e, hy, hz);
      N[1] = f(hx, hy + e, hz) - f(hx, hy - e, hz);
      N[2] = f(hx, hy, hz + e) - f(hx, hy, hz - e);
      const nl = Math.hypot(N[0], N[1], N[2]) || 1;
      const nx = N[0] / nl, ny = N[1] / nl, nz = N[2] / nl;
      // AO along the normal
      let occ = 0, w = 1;
      for (let k = 1; k <= 5; k++) {
        const h = 0.035 * k * k * 0.6;
        occ += (h - f(hx + nx * h, hy + ny * h, hz + nz * h)) * w;
        w *= 0.7;
      }
      const ao = Math.max(0, Math.min(1, 1 - 1.4 * occ));
      // light in model space (light is fixed in view space)
      const lx = cy * L[0] - sy * L[2], lz = sy * L[0] + cy * L[2], ly = L[1];
      const ndl = nx * lx + ny * ly + nz * lz;
      const wrap = Math.max(0, (ndl + 0.5) / 1.5);
      const hemi = 0.5 + 0.5 * ny;
      const isFace = hz > 0.45 && hy > 1.55 && hy < 2.75 && faceOpening(hx, hy) < 0.0 && Math.abs(hx) < 0.9;
      let r = 0.86, g = 0.28, b = 0.26; // body
      if (isFace) { r = 0.16; g = 0.16; b = 0.18; }
      const lit = (0.18 + 0.55 * hemi) * ao + 0.72 * wrap * (0.35 + 0.65 * ao);
      // peach sheen at grazing angles
      const vz = cy * 0 + 1; // view dir in model space z-comp (approx)
      const vdn = Math.max(0, Math.min(1, -sy * nx * 0 + (cy * nz + sy * nx)));
      const rim = Math.pow(1 - vdn, 3) * 0.35 * ao;
      const R = Math.min(1, r * lit + rim * 0.95), G = Math.min(1, g * lit + rim * 0.55), B = Math.min(1, b * lit + rim * 0.4);
      const gm = 1 / 2.2;
      out[o] = 255 * Math.pow(R, gm); out[o + 1] = 255 * Math.pow(G, gm); out[o + 2] = 255 * Math.pow(B, gm); out[o + 3] = 255;
    }
  }
  return out;
}

if (isMainThread) {
  const size = +(args.size ?? 627), view = args.view ?? 'front', mode = args.mode ?? 'shaded', outPath = args.out ?? 'preview.png';
  const overrides = args.fit ? JSON.parse(readFileSync(args.fit, 'utf8')) : args.params ? JSON.parse(args.params) : undefined;
  const n = availableParallelism();
  const rowsPer = Math.ceil(size / (n * 4));
  const jobs = [];
  for (let y = 0; y < size; y += rowsPer) jobs.push([y, Math.min(size, y + rowsPer)]);
  const image = new Uint8ClampedArray(size * size * 4);
  const t0 = performance.now();
  let next = 0, done = 0;
  await new Promise((resolve, reject) => {
    const launch = () => {
      if (next >= jobs.length) return;
      const [a, b] = jobs[next++];
      const w = new Worker(fileURLToPath(import.meta.url), { workerData: { a, b, size, view, mode, overrides } });
      w.on('message', (rows) => { image.set(rows, a * size * 4); });
      w.on('error', reject);
      w.on('exit', () => { done++; if (done === jobs.length) resolve(); else launch(); });
    };
    for (let i = 0; i < Math.min(n, jobs.length); i++) launch();
  });
  writePNG(outPath, size, size, image, 4);
  console.log(`${view}/${mode} ${size}px -> ${outPath} in ${((performance.now() - t0) / 1000).toFixed(1)}s`);
} else {
  const { a, b, size, view, mode, overrides } = workerData;
  parentPort.postMessage(renderRows(a, b, size, view, mode, overrides));
}
