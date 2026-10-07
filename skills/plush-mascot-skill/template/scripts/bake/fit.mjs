// Fit the sculpt parameters to the reference silhouettes (front + profile)
// with a parallel coordinate descent.  Dev tool only - the result is copied
// back into P in model.mjs.
//   node scripts/bake/fit.mjs --refs <dir with ref_*_209.bin> [--iters 12] [--size 209]
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import { availableParallelism } from 'node:os';
import { fileURLToPath } from 'node:url';
import { readFileSync, writeFileSync } from 'node:fs';
import { buildModel, cloneParams, getPath } from './model.mjs';
import { renderMask, iou } from './silhouette.mjs';

const args = Object.fromEntries(process.argv.slice(2).reduce((a, v, i, all) => (v.startsWith('--') ? [...a, [v.slice(2), all[i + 1] ?? true]] : a), []));

// name: [min, max]  (initial value comes from model.mjs)
export const SPACE = {
  'head.cy': [2.15, 2.35], 'head.hw': [1.0, 1.25], 'head.hh': [0.7, 1.0], 'head.hd': [0.7, 0.95],
  'head.n': [2.3, 4.5], 'head.m': [2.0, 3.6], 'head.mF': [2.0, 6.0], 'head.taperX': [0, 0.35], 'head.taperZ': [-0.05, 0.25], 'head.jowl': [-0.14, 0.12], 'head.cz': [-0.05, 0.16],
  'ear.x': [0.65, 1.1], 'ear.y': [2.7, 3.25], 'ear.z': [-0.45, -0.05],
  'ear.hx': [0.24, 0.36], 'ear.hy': [0.4, 0.62], 'ear.hz': [0.24, 0.4], 'ear.r': [0.12, 0.22], 'ear.tilt': [0.3, 0.9], 'ear.blend': [0.06, 0.22],
  'torso.belly.c.1': [0.75, 1.0], 'torso.belly.c.2': [-0.05, 0.15],
  'torso.belly.r.0': [0.55, 0.8], 'torso.belly.r.1': [0.5, 0.75], 'torso.belly.r.2': [0.45, 0.72],
  'torso.chest.c.1': [1.1, 1.45], 'torso.chest.r.0': [0.35, 0.65], 'torso.chest.r.1': [0.25, 0.5], 'torso.chest.r.2': [0.3, 0.55],
  'leg.hip.0': [0.3, 0.5], 'leg.hip.1': [0.5, 0.75], 'leg.hipR': [0.28, 0.45],
  'leg.ankle.0': [0.3, 0.55], 'leg.ankle.1': [0.15, 0.35], 'leg.ankleR': [0.24, 0.4],
  'leg.foot.c.0': [0.35, 0.6], 'leg.foot.c.2': [0.0, 0.25], 'leg.foot.r.0': [0.28, 0.5], 'leg.foot.r.1': [0.14, 0.28], 'leg.foot.r.2': [0.32, 0.55], 'leg.foot.yaw': [0, 0.35],
  'leg.arch.w': [0.06, 0.2], 'leg.arch.h': [0.3, 0.6],
  'arm.shoulder.0': [0.4, 0.75], 'arm.shoulder.1': [1.1, 1.45], 'arm.shoulderR': [0.18, 0.32],
  'arm.elbow.0': [0.55, 1.0], 'arm.elbow.1': [0.85, 1.2], 'arm.elbowR': [0.15, 0.3],
  'arm.hand.0': [0.65, 1.15], 'arm.hand.1': [0.6, 1.0], 'arm.handR': [0.17, 0.32],
};

const W_FRONT = 1.0, W_SIDE = 1.5;
const W_BAND = 0.6; // weight of the boundary-band agreement vs plain IoU
const W_LEGS = 1.2; // extra weight on the lower body (legs, crotch arch, feet)
const W_EAR = +(process.env.W_EAR ?? 0); // extra weight on the ear zone (rows above 2.55 units), both views
const W_CROWN = +(process.env.W_CROWN ?? 0); // extra weight on the crown arc between the ears (|x| < 0.5, heights 2.9 - 3.15), front view

function load(path) { return new Uint8Array(readFileSync(path)); }

if (isMainThread) {
  const size = +(args.size ?? 209);
  const refs = args.refs;
  const iters = +(args.iters ?? 12);
  const n = Math.max(2, availableParallelism() - 1);
  const workers = Array.from({ length: n }, () => new Worker(fileURLToPath(import.meta.url), { workerData: { size, refs } }));
  const pending = new Map();
  let nextId = 0;
  for (const w of workers) w.on('message', ({ id, score, front, side }) => { pending.get(id)?.({ score, front, side }); pending.delete(id); });
  const free = [...workers];
  const queue = [];
  const pump = () => {
    while (free.length && queue.length) {
      const w = free.pop(), job = queue.shift();
      const id = nextId++;
      pending.set(id, (r) => { free.push(w); job.resolve(r); pump(); });
      w.postMessage({ id, edits: job.edits });
    }
  };
  const evaluate = (edits) => new Promise((resolve) => { queue.push({ edits, resolve }); pump(); });

  const base = cloneParams();
  const only = args.only ? String(args.only).split(',') : null;
  const names = Object.keys(SPACE).filter((k) => !only || only.some((o) => k.startsWith(o)));
  const cur = Object.fromEntries(names.map((k) => [k, getPath(base, k)]));
  const step = Object.fromEntries(names.map((k) => [k, (SPACE[k][1] - SPACE[k][0]) * 0.08]));
  const clampTo = (k, v) => Math.min(SPACE[k][1], Math.max(SPACE[k][0], v));
  let best = await evaluate(cur);
  console.log(`start  score ${best.score.toFixed(4)}  front ${best.front.toFixed(4)}  side ${best.side.toFixed(4)}`);
  for (let it = 0; it < iters; it++) {
    const cands = [];
    for (const k of names) for (const dir of [-1, 1]) {
      const v = clampTo(k, cur[k] + dir * step[k]);
      if (v !== cur[k]) cands.push({ k, v });
    }
    const results = await Promise.all(cands.map((c) => evaluate({ ...cur, [c.k]: c.v })));
    // apply the best improvement per parameter (greedy, then verify jointly)
    const improve = {};
    cands.forEach((c, i) => {
      const gain = results[i].score - best.score;
      if (gain > 1e-5 && (!improve[c.k] || gain > improve[c.k].gain)) improve[c.k] = { v: c.v, gain, r: results[i] };
    });
    const keys = Object.keys(improve);
    if (!keys.length) {
      for (const k of names) step[k] *= 0.5;
      console.log(`iter ${it + 1}  no gain -> halve steps`);
      continue;
    }
    const trial = { ...cur };
    for (const k of keys) trial[k] = improve[k].v;
    const joint = await evaluate(trial);
    if (joint.score > best.score) { Object.assign(cur, trial); best = joint; }
    else {
      // fall back to the single best move
      const kBest = keys.sort((a, b) => improve[b].gain - improve[a].gain)[0];
      cur[kBest] = improve[kBest].v; best = improve[kBest].r;
    }
    console.log(`iter ${it + 1}  score ${best.score.toFixed(4)}  front ${best.front.toFixed(4)}  side ${best.side.toFixed(4)}  moved ${keys.length}`);
  }
  writeFileSync(new URL('./fit.result.json', import.meta.url), JSON.stringify(cur, null, 1));
  console.log('wrote fit.result.json');
  workers.forEach((w) => w.terminate());
} else {
  const { size, refs } = workerData;
  const refFront = load(`${refs}/ref_front_sym_${size}.bin`);
  const refSide = load(`${refs}/ref_side_${size}.bin`);
  const bandFront = load(`${refs}/ref_front_sym_band_${size}.bin`);
  const bandSide = load(`${refs}/ref_side_band_${size}.bin`);
  const bandIoU = (a, b, band) => { let i = 0, u = 0; for (let k = 0; k < a.length; k++) if (band[k]) { i += a[k] & b[k]; u += a[k] | b[k]; } return u ? i / u : 0; };
  parentPort.on('message', ({ id, edits }) => {
    const model = buildModel(cloneParams(edits));
    const mf = renderMask(model.scene, 'front', size), ms = renderMask(model.scene, 'side', size);
    const lowFrom = Math.floor(size * (1204 - 0.62 * 350) / 1254) * size;   // rows below ~0.62 units high
    const lowIoU = iou(mf.subarray(lowFrom), refFront.subarray(lowFrom));
    const earRows = Math.ceil(size * (1204 - 2.55 * 350) / 1254) * size;   // rows above ~2.55 units
    const earF = iou(mf.subarray(0, earRows), refFront.subarray(0, earRows));
    const earS = iou(ms.subarray(0, earRows), refSide.subarray(0, earRows));
    const earTerm = (W_FRONT * earF + W_SIDE * earS) / (W_FRONT + W_SIDE);
    let crownTerm = 0;
    if (W_CROWN > 0) {
      const scale = (350 * size) / 1254, ox = (625 * size) / 1254, oy = (1204 * size) / 1254;
      const y0 = Math.floor(oy - 3.15 * scale), y1 = Math.ceil(oy - 2.9 * scale), x0 = Math.floor(ox - 0.5 * scale), x1 = Math.ceil(ox + 0.5 * scale);
      let inter = 0, uni = 0;
      for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) { const a = mf[y * size + x], b = refFront[y * size + x]; inter += a & b; uni += a | b; }
      crownTerm = uni ? inter / uni : 1;
    }
    const front = ((1 - W_BAND) * iou(mf, refFront) + W_BAND * bandIoU(mf, refFront, bandFront) + W_LEGS * lowIoU + W_EAR * earTerm + W_CROWN * crownTerm) / (1 + W_LEGS + W_EAR + W_CROWN);
    const side = ((1 - W_BAND) * iou(ms, refSide) + W_BAND * bandIoU(ms, refSide, bandSide) + W_EAR * earTerm) / (1 + W_EAR);
    parentPort.postMessage({ id, front, side, score: (W_FRONT * front + W_SIDE * side) / (W_FRONT + W_SIDE) });
  });
}
