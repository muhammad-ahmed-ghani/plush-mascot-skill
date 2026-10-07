// Dev-only: page-scale comparison of the live model with the artwork rescaled to the SAME on-screen density
// (scripts/dev/scaled-ref.py).  Unlike lab-metrics.js this measures fibre energy at fibre scale (band-pass, 3 scales) on
// several body patches plus the face fabric, the luminance distribution and large-scale tone.
const BG = [246, 243, 238];

export const sizeFor = (ppu) => Math.max(600, Math.round((ppu * 4.2) / 2) * 2);
export const TY = 1.65;

// world-unit patches (x0, x1, y0, y1) that are pure body / pure face fabric in the artwork (no seams, features or edges)
export const BODY_PATCHES = {
  belly: [-0.31, 0.32, 0.58, 0.93],
  chest: [-0.43, -0.19, 1.0, 1.38],
  leg: [-0.6, -0.3, 0.3, 0.52],
  arm: [0.7, 0.9, 0.92, 1.1],
  ear: [0.72, 1.02, 2.95, 3.18],
  crown: [0.14, 0.44, 2.8, 2.95],
};
/** Cells whose mean luminance is compared with the artwork: they pin down where the key light comes from (left/right, above/below) and the depth of the big shadows. */
export const TONE_CELLS = {
  bellyL: [-0.5, -0.25, 0.6, 0.95], bellyC: [-0.12, 0.12, 0.6, 0.95], bellyR: [0.25, 0.5, 0.6, 0.95],
  headL: [-1.0, -0.85, 1.9, 2.6], headR: [0.85, 1.0, 1.9, 2.6],
  foreL: [-0.6, -0.3, 2.68, 2.9], foreR: [0.3, 0.6, 2.68, 2.9],
  chinL: [-0.6, -0.3, 1.5, 1.62], chinR: [0.3, 0.6, 1.5, 1.62],
  earL: [-1.15, -0.9, 2.85, 3.1], earR: [0.9, 1.15, 2.85, 3.1],
  armL: [-1.0, -0.75, 1.02, 1.2], armR: [0.75, 1.0, 1.02, 1.2],
  legL: [-0.6, -0.35, 0.3, 0.55], legR: [0.35, 0.6, 0.3, 0.55],
  footL: [-0.8, -0.5, 0.08, 0.22], footR: [0.5, 0.8, 0.08, 0.22],
  chest: [-0.43, -0.19, 1.0, 1.38],
};
/** Vertical structure of the charcoal plate (the artwork darkens toward the chin): mean luminance in bands down the middle. */
export const PLATE_CELLS = {
  plateTop: [-0.3, 0.3, 2.5, 2.62], plateUpper: [-0.1, 0.1, 2.3, 2.42], plateMid: [-0.1, 0.1, 2.05, 2.15], plateLow: [-0.3, 0.3, 1.7, 1.8],
  plateL: [-0.66, -0.56, 2.05, 2.3], plateR: [0.56, 0.68, 2.05, 2.3],
};
export const FACE_PATCHES = {
  between: [-0.1, 0.1, 2.0, 2.3],
  forehead: [-0.4, 0.4, 2.36, 2.54],
  lowL: [-0.55, -0.15, 1.69, 1.79],
  lowR: [0.15, 0.55, 1.69, 1.79],
};

const refCache = new Map();
async function loadRef(ppu, size) {
  const key = `${ppu}:${size}`;
  if (refCache.has(key)) return refCache.get(key);
  const img = new Image();
  img.src = `/scripts/dev/.refs/ref_${ppu}.png`;
  await img.decode();
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d', { willReadFrequently: true });
  g.drawImage(img, 0, 0);
  const d = g.getImageData(0, 0, size, size).data;
  refCache.set(key, d);
  return d;
}

function lumOf(d, n) {
  const L = new Float32Array(n);
  for (let i = 0; i < n; i++) L[i] = 0.2126 * d[i * 4] + 0.7152 * d[i * 4 + 1] + 0.0722 * d[i * 4 + 2];
  return L;
}
const bodyAt = (d, i) => d[i * 4 + 3] > 250 && d[i * 4] > 90 && d[i * 4] > d[i * 4 + 1] * 1.3 && d[i * 4] > d[i * 4 + 2] * 1.3;

function gaussKernel(sigma) {
  const r = Math.max(1, Math.ceil(sigma * 3));
  const k = new Float32Array(2 * r + 1);
  let s = 0;
  for (let i = -r; i <= r; i++) { k[i + r] = Math.exp(-(i * i) / (2 * sigma * sigma)); s += k[i + r]; }
  for (let i = 0; i < k.length; i++) k[i] /= s;
  return k;
}
/** Gaussian blur of a w x h window (edge-clamped). */
function blur(src, w, h, sigma) {
  const k = gaussKernel(sigma), r = (k.length - 1) / 2;
  const tmp = new Float32Array(w * h), out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let s = 0;
    for (let i = -r; i <= r; i++) s += src[y * w + Math.min(w - 1, Math.max(0, x + i))] * k[i + r];
    tmp[y * w + x] = s;
  }
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let s = 0;
    for (let i = -r; i <= r; i++) s += tmp[Math.min(h - 1, Math.max(0, y + i)) * w + x] * k[i + r];
    out[y * w + x] = s;
  }
  return out;
}

/** All band-pass values (L - blur_sigma(L)) inside the patch where maskFn holds (window padded for the blur). */
function bandValues(L, size, box, maskFn, sigma, pad) {
  const x0 = Math.max(0, box[0] - pad), x1 = Math.min(size, box[1] + pad), y0 = Math.max(0, box[2] - pad), y1 = Math.min(size, box[3] + pad);
  const w = x1 - x0, h = y1 - y0;
  const win = new Float32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) win[y * w + x] = L[(y0 + y) * size + x0 + x];
  const b = blur(win, w, h, sigma);
  const out = [];
  for (let y = box[2]; y < box[3]; y++) for (let x = box[0]; x < box[1]; x++) {
    if (maskFn(y * size + x)) out.push(L[y * size + x] - b[(y - y0) * w + (x - x0)]);
  }
  return out;
}
/**
 * Ridge-vs-edge character of the fibre texture: the ratio of scale-normalised second-derivative energy to first-derivative
 * energy.  A bright thin filament (albedo) is an even, ridge-like signal (high ratio); a lit bump is odd/edge-like (low ratio).
 * The artwork's nap is filaments, so this discriminates "fur" from "stucco" where band-pass energy and skew cannot.
 */
function evenness(L, size, box, maskFn, sigma, pad) {
  const x0 = Math.max(0, box[0] - pad), x1 = Math.min(size, box[1] + pad), y0 = Math.max(0, box[2] - pad), y1 = Math.min(size, box[3] + pad);
  const w = x1 - x0, h = y1 - y0;
  const win = new Float32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) win[y * w + x] = L[(y0 + y) * size + x0 + x];
  const b = blur(win, w, h, sigma);
  let g2 = 0, h2 = 0, n = 0;
  for (let y = Math.max(1, box[2] - y0); y < Math.min(h - 1, box[3] - y0); y++) for (let x = Math.max(1, box[0] - x0); x < Math.min(w - 1, box[1] - x0); x++) {
    if (!maskFn((y0 + y) * size + x0 + x)) continue;
    const i = y * w + x;
    const lx = (b[i + 1] - b[i - 1]) / 2, ly = (b[i + w] - b[i - w]) / 2;
    const lxx = b[i + 1] - 2 * b[i] + b[i - 1], lyy = b[i + w] - 2 * b[i] + b[i - w];
    const lxy = (b[i + w + 1] - b[i + w - 1] - b[i - w + 1] + b[i - w - 1]) / 4;
    g2 += lx * lx + ly * ly; h2 += lxx * lxx + 2 * lxy * lxy + lyy * lyy; n++;
  }
  return n > 80 && g2 > 0 ? (h2 * sigma * sigma) / g2 : null;
}

function moments(v) {
  const n = v.length;
  if (n < 80) return null;
  let m = 0;
  for (let i = 0; i < n; i++) m += v[i];
  m /= n;
  let s2 = 0, s3 = 0, s4 = 0;
  for (let i = 0; i < n; i++) { const d = v[i] - m; const d2 = d * d; s2 += d2; s3 += d2 * d; s4 += d2 * d2; }
  s2 /= n; s3 /= n; s4 /= n;
  const sd = Math.sqrt(s2);
  return { sd, skew: s3 / (sd ** 3 || 1), kurt: s4 / (s2 * s2 || 1) };
}

/** Std of the band-pass (L - blur_sigma(L)) inside the patch, ignoring pixels outside `mask` (window is padded for the blur). */
function bandEnergy(L, size, box, maskFn, sigma, pad) {
  const x0 = Math.max(0, box[0] - pad), x1 = Math.min(size, box[1] + pad), y0 = Math.max(0, box[2] - pad), y1 = Math.min(size, box[3] + pad);
  const w = x1 - x0, h = y1 - y0;
  const win = new Float32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) win[y * w + x] = L[(y0 + y) * size + x0 + x];
  const b = blur(win, w, h, sigma);
  let s = 0, s2 = 0, n = 0;
  for (let y = box[2]; y < box[3]; y++) for (let x = box[0]; x < box[1]; x++) {
    if (!maskFn(y * size + x)) continue;
    const v = L[y * size + x] - b[(y - y0) * w + (x - x0)];
    s += v; s2 += v * v; n++;
  }
  if (n < 50) return null;
  return Math.sqrt(Math.max(0, s2 / n - (s / n) ** 2));
}

/** Luminance std of the cord wraps along the '/' bar of the chest X (profile minus its own low-pass), like scripts/dev/audit.py. */
function cordContrast(L, size, ppu, cx, cy) {
  const px = size / 2 + cx * ppu, py = size / 2 - (cy - TY) * ppu;
  const nx = Math.SQRT1_2, ny = -Math.SQRT1_2, qx = -ny, qy = nx;
  const half = 0.128 * ppu, step = 0.5, k = ppu / 350;
  const bil = (x, y) => {
    const x0 = Math.floor(x), y0 = Math.floor(y), fx = x - x0, fy = y - y0;
    const a = L[y0 * size + x0], b = L[y0 * size + x0 + 1], c = L[(y0 + 1) * size + x0], d = L[(y0 + 1) * size + x0 + 1];
    return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
  };
  const v = [];
  for (let t = -half; t <= half + 1e-6; t += step) {
    let acc = 0;
    for (let j = -2; j <= 2; j++) acc += bil(px + nx * t + qx * j * k, py + ny * t + qy * j * k);
    v.push(acc / 5);
  }
  const sigma = 9 * k, r = Math.ceil(sigma * 3), w = [];
  let ws = 0;
  for (let i = -r; i <= r; i++) { const g = Math.exp(-(i * i) / (2 * sigma * sigma)); w.push(g); ws += g; }
  const lo = Math.floor(v.length * 0.18), hi = v.length - lo;
  let s = 0, s2 = 0, n = 0, m = 0;
  for (let i = lo; i < hi; i++) {
    let base = 0;
    for (let j = -r; j <= r; j++) base += v[Math.min(v.length - 1, Math.max(0, i + j))] * w[j + r];
    const d = v[i] - base / ws;
    s += d; s2 += d * d; n++; m += v[i];
  }
  return { std: Math.sqrt(Math.max(0, s2 / n - (s / n) ** 2)), mean: m / n };
}

export function pxBox(world, size, ppu) {
  const [a, b, c, d] = world;
  return [Math.round(size / 2 + a * ppu), Math.round(size / 2 + b * ppu), Math.round(size / 2 - (d - TY) * ppu), Math.round(size / 2 - (c - TY) * ppu)];
}


/**
 * Luminance profile ACROSS the seam between the red hood and the charcoal plate, per side of the plate.  The plate is found the same
 * way in the live render and in the artwork (the biggest dark, non-red region, holes filled), distances are measured to its own
 * boundary with a two-pass chamfer transform, and mean luminance is binned by signed distance (+ = into the hood) and by which side
 * of the plate the pixel lies on.  Everything the seam looks like - the bright rolled lip, the thin dark crevice, the plate tucking
 * in under it - lives in these few numbers.
 */
export const EDGE_BINS = { from: -0.036, step: 0.004, count: 24 };
const SIDES = { top: [60, 120], left: [150, 210], right: [-30, 30], bottom: [-120, -60] };
export function edgeProfiles(dat, size, ppu) {
  const n = size * size;
  const M = new Uint8Array(n), seen = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    const r = dat[i * 4], g = dat[i * 4 + 1], b = dat[i * 4 + 2];
    const L = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    if (dat[i * 4 + 3] > 250 && L < 95 && r < g * 1.5 + 30) M[i] = 1;
  }
  // biggest 4-connected component (flood fill with an explicit stack)
  const lab = new Int32Array(n);
  let best = 0, bestId = 0, id = 0;
  const stack = new Int32Array(n);
  for (let i = 0; i < n; i++) {
    if (!M[i] || lab[i]) continue;
    id++;
    let sp = 0, cnt = 0;
    stack[sp++] = i; lab[i] = id;
    while (sp) {
      const q = stack[--sp]; cnt++;
      const x = q % size, y = (q / size) | 0;
      if (x > 0 && M[q - 1] && !lab[q - 1]) { lab[q - 1] = id; stack[sp++] = q - 1; }
      if (x < size - 1 && M[q + 1] && !lab[q + 1]) { lab[q + 1] = id; stack[sp++] = q + 1; }
      if (y > 0 && M[q - size] && !lab[q - size]) { lab[q - size] = id; stack[sp++] = q - size; }
      if (y < size - 1 && M[q + size] && !lab[q + size]) { lab[q + size] = id; stack[sp++] = q + size; }
    }
    if (cnt > best) { best = cnt; bestId = id; }
  }
  const P = new Uint8Array(n);
  for (let i = 0; i < n; i++) P[i] = lab[i] === bestId ? 1 : 0;
  // fill holes: everything not reachable from the border without crossing the plate
  const out = new Uint8Array(n);
  let sp = 0;
  for (let x = 0; x < size; x++) for (const y of [0, size - 1]) { const q = y * size + x; if (!P[q] && !out[q]) { out[q] = 1; stack[sp++] = q; } }
  for (let y = 0; y < size; y++) for (const x of [0, size - 1]) { const q = y * size + x; if (!P[q] && !out[q]) { out[q] = 1; stack[sp++] = q; } }
  while (sp) {
    const q = stack[--sp];
    const x = q % size, y = (q / size) | 0;
    if (x > 0 && !P[q - 1] && !out[q - 1]) { out[q - 1] = 1; stack[sp++] = q - 1; }
    if (x < size - 1 && !P[q + 1] && !out[q + 1]) { out[q + 1] = 1; stack[sp++] = q + 1; }
    if (y > 0 && !P[q - size] && !out[q - size]) { out[q - size] = 1; stack[sp++] = q - size; }
    if (y < size - 1 && !P[q + size] && !out[q + size]) { out[q + size] = 1; stack[sp++] = q + size; }
  }
  for (let i = 0; i < n; i++) if (!out[i]) P[i] = 1;
  // signed chamfer distance to the plate's boundary (pixels): > 0 outside, < 0 inside
  const INF = 1e9, A = 1, B = 1.4142;
  const d1 = new Float32Array(n), d2 = new Float32Array(n);
  for (let i = 0; i < n; i++) { d1[i] = P[i] ? 0 : INF; d2[i] = P[i] ? INF : 0; }       // d1: distance to the plate (for outside px), d2: distance to the outside (for plate px)
  const pass = (d) => {
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      const i = y * size + x; let v = d[i];
      if (x > 0) v = Math.min(v, d[i - 1] + A);
      if (y > 0) { v = Math.min(v, d[i - size] + A); if (x > 0) v = Math.min(v, d[i - size - 1] + B); if (x < size - 1) v = Math.min(v, d[i - size + 1] + B); }
      d[i] = v;
    }
    for (let y = size - 1; y >= 0; y--) for (let x = size - 1; x >= 0; x--) {
      const i = y * size + x; let v = d[i];
      if (x < size - 1) v = Math.min(v, d[i + 1] + A);
      if (y < size - 1) { v = Math.min(v, d[i + size] + A); if (x < size - 1) v = Math.min(v, d[i + size + 1] + B); if (x > 0) v = Math.min(v, d[i + size - 1] + B); }
      d[i] = v;
    }
  };
  pass(d1); pass(d2);
  const cx = size / 2 + 0.019 * ppu, cy = size / 2 - (2.151 - TY) * ppu;
  const bins = EDGE_BINS;
  const sum = {}, cnt = {};
  for (const k of Object.keys(SIDES)) { sum[k] = new Float64Array(bins.count); cnt[k] = new Float64Array(bins.count); }
  const lo = bins.from, span = bins.step * bins.count;
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const i = y * size + x;
    if (dat[i * 4 + 3] <= 250) continue;
    const sd = (P[i] ? -d2[i] : d1[i]) / ppu;
    if (sd < lo || sd >= lo + span) continue;
    const ang = Math.atan2(cy - y, x - cx) * 180 / Math.PI;
    for (const [k, [a0, a1]] of Object.entries(SIDES)) {
      const rel = ((ang - a0) % 360 + 360) % 360;
      if (rel < a1 - a0) {
        const b = Math.floor((sd - lo) / bins.step);
        sum[k][b] += 0.2126 * dat[i * 4] + 0.7152 * dat[i * 4 + 1] + 0.0722 * dat[i * 4 + 2]; cnt[k][b]++;
      }
    }
  }
  const prof = {};
  for (const k of Object.keys(SIDES)) prof[k] = Array.from(sum[k], (v, b) => (cnt[k][b] > 8 ? v / cnt[k][b] : null));
  return prof;
}

export async function evaluateAt(canvas, ppu) {
  const size = sizeFor(ppu);
  const g = document.createElement('canvas');
  g.width = g.height = size;
  const ctx = g.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(canvas, 0, 0, size, size);
  const live = ctx.getImageData(0, 0, size, size).data;
  const ref = await loadRef(ppu, size);
  const n = size * size;
  const Ll = lumOf(live, n), Lr = lumOf(ref, n);
  const bodyL = (i) => bodyAt(live, i), bodyR = (i) => bodyAt(ref, i);
  const both = (i) => bodyAt(live, i) && bodyAt(ref, i);
  const pad = 10;
  const res = { ppu, patches: {}, face: {} };

  // fibre energy per patch and band (sigma 1.2 / 3 / 8 px, scaled a little with density so they stay the same *physical* scale)
  const sig = [1.2, 3.0, 8.0].map((s) => s * Math.max(0.6, ppu / 246));
  let fibreLoss = 0, fibreN = 0;
  for (const [name, world] of Object.entries(BODY_PATCHES)) {
    const box = pxBox(world, size, ppu);
    const er = sig.map((s) => bandEnergy(Lr, size, box, both, s, pad));
    const el = sig.map((s) => bandEnergy(Ll, size, box, both, s, pad));
    res.patches[name] = { ref: er, live: el };
    er.forEach((v, i) => {
      if (v == null || el[i] == null || v < 0.05) return;
      fibreLoss += Math.abs(Math.log(Math.max(el[i], 0.05) / v)) * (i === 2 ? 0.5 : 1);
      fibreN += i === 2 ? 0.5 : 1;
    });
  }
  res.fibreLoss = fibreN ? fibreLoss / fibreN : 0;
  // shape of the fibre distribution: the artwork's nap is sparse bright filaments on a darker ground (positive skew, heavy tails)
  let skewErr = 0, kurtErr = 0, sn = 0;
  res.shape = {};
  for (const [name, world] of Object.entries(BODY_PATCHES)) {
    const box = pxBox(world, size, ppu);
    const sg = 4 * Math.max(0.6, ppu / 246);
    const a = moments(bandValues(Lr, size, box, both, sg, pad)), b = moments(bandValues(Ll, size, box, both, sg, pad));
    if (!a || !b) continue;
    res.shape[name] = { ref: a, live: b };
    skewErr += Math.abs(b.skew - a.skew); kurtErr += Math.abs(b.kurt - a.kurt); sn++;
  }
  res.skewErr = sn ? skewErr / sn : 0; res.kurtErr = sn ? kurtErr / sn : 0;
  let evErr = 0, en = 0;
  res.even = {};
  for (const [name, world] of Object.entries(BODY_PATCHES)) {
    const box = pxBox(world, size, ppu);
    const sg = 1.5 * Math.max(0.6, ppu / 246);
    const a = evenness(Lr, size, box, both, sg, pad), b = evenness(Ll, size, box, both, sg, pad);
    if (a == null || b == null) continue;
    res.even[name] = { ref: a, live: b };
    evErr += Math.abs(Math.log(b / a)); en++;
  }
  res.evenErr = en ? evErr / en : 0;

  // face fabric: tone and fibre energy
  let faceTone = 0, faceFibre = 0, fn = 0;
  const isFaceL = (i) => live[i * 4 + 3] > 250 && Ll[i] < 95, isFaceR = (i) => ref[i * 4 + 3] > 250 && Lr[i] < 95;
  const bothFace = (i) => isFaceL(i) && isFaceR(i);
  for (const [name, world] of Object.entries(FACE_PATCHES)) {
    const box = pxBox(world, size, ppu);
    let sl = 0, sr = 0, c = 0;
    for (let y = box[2]; y < box[3]; y++) for (let x = box[0]; x < box[1]; x++) { const i = y * size + x; if (bothFace(i)) { sl += Ll[i]; sr += Lr[i]; c++; } }
    if (c < 50) continue;
    const sg = sig[0], sg2 = sig[1];
    const er = [bandEnergy(Lr, size, box, bothFace, sg, pad), bandEnergy(Lr, size, box, bothFace, sg2, pad)];
    const el = [bandEnergy(Ll, size, box, bothFace, sg, pad), bandEnergy(Ll, size, box, bothFace, sg2, pad)];
    res.face[name] = { toneRef: sr / c, toneLive: sl / c, ref: er, live: el };
    faceTone += Math.abs(sl / c - sr / c);
    er.forEach((v, i) => { if (v != null && el[i] != null && v > 0.05) faceFibre += Math.abs(Math.log(Math.max(el[i], 0.05) / v)); });
    fn++;
  }
  res.faceTone = fn ? faceTone / fn : 0;
  let plateErr = 0, pn = 0;
  res.plate = {};
  for (const [name, world] of Object.entries(PLATE_CELLS)) {
    const box = pxBox(world, size, ppu);
    let sl = 0, sr = 0, c = 0;
    for (let y = box[2]; y < box[3]; y++) for (let x = box[0]; x < box[1]; x++) { const i = y * size + x; if (bothFace(i)) { sl += Ll[i]; sr += Lr[i]; c++; } }
    if (c < 40) continue;
    res.plate[name] = [sl / c, sr / c];
    plateErr += Math.abs(sl / c - sr / c); pn++;
  }
  res.plateErr = pn ? plateErr / pn : 0;
  // shape of the plate's fibre distribution (thin light hairs on a dark ground: positive skew, but no bright sparkle)
  let fShape = 0, fsn = 0;
  res.faceShape = {};
  for (const [name, world] of Object.entries(FACE_PATCHES)) {
    const box = pxBox(world, size, ppu);
    const sg = 3 * Math.max(0.6, ppu / 246);
    const a = moments(bandValues(Lr, size, box, bothFace, sg, pad)), b = moments(bandValues(Ll, size, box, bothFace, sg, pad));
    if (!a || !b) continue;
    res.faceShape[name] = { ref: a, live: b };
    fShape += Math.abs(b.skew - a.skew) + 0.25 * Math.abs(b.kurt - a.kurt);
    const ea = evenness(Lr, size, box, bothFace, 1.5 * Math.max(0.6, ppu / 246), pad), eb = evenness(Ll, size, box, bothFace, 1.5 * Math.max(0.6, ppu / 246), pad);
    if (ea != null && eb != null) { fShape += 1.5 * Math.abs(Math.log(eb / ea)); res.faceShape[name].even = [eb, ea]; }
    fsn++;
  }
  res.faceShapeErr = fsn ? fShape / fsn : 0;
  res.faceFibre = fn ? faceFibre / (fn * 2) : 0;

  const cordR = cordContrast(Lr, size, ppu, 0.021, 1.164), cordL = cordContrast(Ll, size, ppu, 0.0, 1.164);
  res.cordRef = cordR.std; res.cordLive = cordL.std;
  res.cordMeanRef = cordR.mean; res.cordMeanLive = cordL.mean;
  // the wraps' contrast AND the cord's overall brightness (it is tone-on-tone in the artwork, not a dark thread)
  res.cordErr = Math.abs(Math.log(Math.max(cordL.std, 0.05) / Math.max(cordR.std, 0.05))) + Math.abs(cordL.mean - cordR.mean) / 30;

  // luminance distribution over the shared body surface
  const shared = [];
  for (let i = 0; i < n; i += 3) if (both(i)) shared.push(i);
  const q = [0.02, 0.05, 0.1, 0.25, 0.5, 0.75, 0.9, 0.95, 0.99];
  const pct = (arr, p) => arr[Math.min(arr.length - 1, Math.floor(p * (arr.length - 1)))];
  const a = shared.map((i) => Ll[i]).sort((x, y) => x - y), b = shared.map((i) => Lr[i]).sort((x, y) => x - y);
  res.pctLive = q.map((p) => pct(a, p)); res.pctRef = q.map((p) => pct(b, p));
  res.spread = q.reduce((t, p, i) => t + Math.abs(res.pctLive[i] - res.pctRef[i]), 0) / q.length;

  // large-scale tone: mean |blurred L difference| over the shared surface
  const S0 = 4, ds = Math.floor(size / S0);
  const dl = new Float32Array(ds * ds), dr = new Float32Array(ds * ds), dm = new Uint8Array(ds * ds);
  for (let y = 0; y < ds; y++) for (let x = 0; x < ds; x++) {
    const i = y * S0 * size + x * S0;
    if (both(i)) { dl[y * ds + x] = Ll[i]; dr[y * ds + x] = Lr[i]; dm[y * ds + x] = 1; }
  }
  const sigT = 2.5 * Math.max(0.6, ppu / 246);
  const bl = blur(dl, ds, ds, sigT), br = blur(dr, ds, ds, sigT), bm = blur(Float32Array.from(dm), ds, ds, sigT);
  let toneErr = 0, tn = 0;
  for (let i = 0; i < ds * ds; i++) if (dm[i] && bm[i] > 0.6) { toneErr += Math.abs(bl[i] / bm[i] - br[i] / bm[i]); tn++; }
  res.tone = tn ? toneErr / tn : 0;
  // hue: mean linear RGB of the shared body surface and of the face fabric, as a mean absolute log ratio per channel
  const lin = (v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
  const meanLin = (dat, ok, step) => { const t = [0, 0, 0]; let c = 0; for (let i = 0; i < n; i += step) if (ok(i)) { t[0] += lin(dat[i * 4]); t[1] += lin(dat[i * 4 + 1]); t[2] += lin(dat[i * 4 + 2]); c++; } return c ? t.map((v) => v / c) : [1, 1, 1]; };
  const cl = meanLin(live, both, 5), cr = meanLin(ref, both, 5);
  res.hueBody = (Math.abs(Math.log(cl[0] / cr[0])) + Math.abs(Math.log(cl[1] / cr[1])) + Math.abs(Math.log(cl[2] / cr[2]))) / 3;
  res.linBody = { live: cl, ref: cr };
  const fl = meanLin(live, bothFace, 3), fr = meanLin(ref, bothFace, 3);
  res.hueFace = (Math.abs(Math.log(fl[0] / fr[0])) + Math.abs(Math.log(fl[1] / fr[1])) + Math.abs(Math.log(fl[2] / fr[2]))) / 3;
  res.meanLive = a.reduce((t, v) => t + v, 0) / a.length; res.meanRef = b.reduce((t, v) => t + v, 0) / b.length;
  // The silhouette: the artwork's edge is a bright, soft, slightly fuzzy rim.  Compare (a) the mean luminance of a thin band just inside
  // the outline, per direction, and (b) how much of the outline is partially transparent (the fuzz).
  {
    const sc = Math.max(0.35, ppu / 350);
    const r1 = Math.max(1, Math.round(1.5 * sc)), r2 = Math.max(3, Math.round(9 * sc));
    const inside = (dat) => { const m = new Uint8Array(n); for (let i = 0; i < n; i++) m[i] = dat[i * 4 + 3] > 200 ? 1 : 0; return m; };
    const erodeBy = (m, r) => {                                              // separable box erosion
      const t = new Uint8Array(n), o = new Uint8Array(n);
      for (let y = 0; y < size; y++) { let run = 0; for (let x = 0; x < size; x++) { run = m[y * size + x] ? run + 1 : 0; t[y * size + x] = run > 2 * r ? 1 : 0; } }
      for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) if (t[y * size + Math.min(size - 1, x + r)]) o[y * size + x] = 1;
      const u = new Uint8Array(n);
      for (let x = 0; x < size; x++) { let run = 0; for (let y = 0; y < size; y++) { run = o[y * size + x] ? run + 1 : 0; u[y * size + x] = run > 2 * r ? 1 : 0; } }
      const w = new Uint8Array(n);
      for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) if (u[Math.min(size - 1, y + r) * size + x]) w[y * size + x] = 1;
      return w;
    };
    const eL = inside(live), eR = inside(ref);
    const a1L = erodeBy(eL, r1), a2L = erodeBy(eL, r2), a1R = erodeBy(eR, r1), a2R = erodeBy(eR, r2);
    const sectors = { left: [0, 0, 0, 0], right: [0, 0, 0, 0], top: [0, 0, 0, 0], bottom: [0, 0, 0, 0] };
    const cx = size / 2, cy = size / 2 - (1.7 - TY) * ppu;
    let perim = 0, partL = 0, partR = 0;
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      const i = y * size + x;
      const alphaL = live[i * 4 + 3], alphaR = ref[i * 4 + 3];
      if (alphaL > 8 && alphaL < 246) partL++;
      if (alphaR > 8 && alphaR < 246) partR++;
      if (a1L[i] && !a2L[i] && a1R[i] && !a2R[i]) {
        const ang = Math.atan2(cy - y, x - cx) * 180 / Math.PI;                 // 0 = right, 90 = up
        const key = Math.abs(ang) < 40 ? 'right' : Math.abs(ang) > 140 ? 'left' : ang > 0 ? 'top' : 'bottom';
        const sct = sectors[key];
        sct[0] += Ll[i]; sct[1] += Lr[i]; sct[2]++;
      }
    }
    let ringErr = 0, rn = 0;
    res.rim = {};
    for (const [k, v] of Object.entries(sectors)) if (v[2] > 60) { res.rim[k] = [v[0] / v[2], v[1] / v[2]]; ringErr += Math.abs(v[0] - v[1]) / v[2]; rn++; }
    res.rimErr = rn ? ringErr / rn : 0;
    res.softLive = partL; res.softRef = partR;
    res.softErr = Math.abs(Math.log(Math.max(partL, 50) / Math.max(partR, 50)));
  }

  // the seam between hood and plate, at the artwork's own density only (its features are a few pixels wide)
  if (ppu >= 300) {
    const pl = edgeProfiles(live, size, ppu), pr = edgeProfiles(ref, size, ppu);
    let e = 0, en = 0;
    for (const k of Object.keys(pl)) pl[k].forEach((v, b) => {
      const w = Math.abs(b - 9) <= 5 ? 2 : 1;                          // twice the weight within ~0.02 of the line
      if (v != null && pr[k][b] != null) { e += w * Math.abs(v - pr[k][b]); en += w; }
    });
    res.edgeProfile = { live: pl, ref: pr };
    res.edgeErr = en ? e / en : 0;
  } else res.edgeErr = 0;

  // cell means (left/right/up/down structure of the lighting)
  let cellErr = 0, cellN = 0;
  res.cells = {};
  for (const [name, world] of Object.entries(TONE_CELLS)) {
    const box = pxBox(world, size, ppu);
    let sl = 0, sr = 0, c = 0;
    for (let y = box[2]; y < box[3]; y++) for (let x = box[0]; x < box[1]; x++) { const i = y * size + x; if (both(i)) { sl += Ll[i]; sr += Lr[i]; c++; } }
    if (c < 40) continue;
    res.cells[name] = [sl / c, sr / c];
    cellErr += Math.abs(sl / c - sr / c); cellN++;
  }
  res.cellErr = cellN ? cellErr / cellN : 0;
  res.loss = res.tone / 8 + res.spread / 8 + res.cellErr / 5 + res.plateErr / 6 + res.edgeErr / 5 + 0.8 * res.faceShapeErr + res.rimErr / 6 + 0.8 * res.softErr + 1.6 * res.fibreLoss + res.faceTone / 10 + 0.9 * res.faceFibre + 6 * res.hueBody + 3 * res.hueFace + 1.5 * res.cordErr + 1.2 * res.skewErr + 0.3 * res.kurtErr + 2.2 * res.evenErr;
  return res;
}

export { BG };
