// What reads as "pixellated" along the hood-to-plate seam when the head turns, measured on the real studio page:
//   - roughness: how far the plate's outline (where the hood's red takes over from the charcoal, to a tenth of a pixel) wanders from its
//                own smooth curve (pixels).  A clean edge is well under a pixel at p95; the staircase that a cliff in the sculpt used
//                to cut was 1.4-1.8 px at p95 at the same views.
//   - specks:    bright pixels on the plate that stand well above their surroundings (white grains)
// for a few yaws at 1x and 2x display density.
//   node scripts/dev/turn-check.mjs [--yaws -0.5,0.5,0.9,1.3] [--max-rough 0.8]        (dev server on :4173 by default)
// The outline is found by casting rays from the plate's centre and, on each, walking in from the hood until its redness ends; rays that end
// at the head's own silhouette are skipped.  (The darkest point of the crevice line is not a good locator: the lip that brightens along the
// chin and the crevice are two dark bands a few pixels apart, and the darkest of them changes from ray to ray.)  Only views at 2x density
// with |yaw| <= 0.6 are scored (PASS / FAIL, exit 1); the rest are printed as `info`, because at 1x the line is narrower than a pixel and at
// larger yaws the hood's shadowed wall takes over.
import { launch, watchErrors, ORIGIN } from './browser.mjs';

const args = Object.fromEntries(process.argv.slice(2).reduce((a, v, i, all) => (v.startsWith('--') ? [...a, [v.slice(2), all[i + 1] ?? true]] : a), []));
const yaws = String(args.yaws ?? '-0.5,0.5,0.9').split(',').map(Number);
const maxRough = +(args['max-rough'] ?? 0.8);

/** Runs in the page: reads the canvas snapshot and returns { rough, p95, specks, rays }. */
async function analyse(dataUrl) {
  const img = new Image(); img.src = dataUrl; await img.decode();
  const W = img.width, H = img.height;
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const g = c.getContext('2d', { willReadFrequently: true }); g.drawImage(img, 0, 0);
  const d = g.getImageData(0, 0, W, H).data;
  const lum = new Float32Array(W * H), red = new Float32Array(W * H), plate = new Uint8Array(W * H), opaque = new Uint8Array(W * H);
  for (let i = 0; i < W * H; i++) {
    const r = d[i * 4], gr = d[i * 4 + 1], b = d[i * 4 + 2], a = d[i * 4 + 3];
    lum[i] = 0.2126 * r + 0.7152 * gr + 0.0722 * b;
    red[i] = r - b;
    opaque[i] = a > 200 ? 1 : 0;
    plate[i] = a > 200 && lum[i] < 100 && r - b < 50 ? 1 : 0;
  }
  // largest connected component of the plate mask (4-neighbour flood fill)
  const label = new Int32Array(W * H); let best = 0, bestId = 0, id = 0; const stack = [];
  for (let s = 0; s < W * H; s++) {
    if (!plate[s] || label[s]) continue;
    id++; let n = 0; stack.push(s); label[s] = id;
    while (stack.length) {
      const p = stack.pop(); n++;
      const x = p % W, y = (p - x) / W;
      for (const q of [x > 0 ? p - 1 : -1, x < W - 1 ? p + 1 : -1, y > 0 ? p - W : -1, y < H - 1 ? p + W : -1]) if (q >= 0 && plate[q] && !label[q]) { label[q] = id; stack.push(q); }
    }
    if (n > best) { best = n; bestId = id; }
  }
  if (best < 2000) return { rough: null };
  let sx = 0, sy = 0, cnt = 0;
  for (let i = 0; i < W * H; i++) if (label[i] === bestId) { sx += i % W; sy += Math.floor(i / W); cnt++; }
  const cx = sx / cnt, cy = sy / cnt;
  const inPlate = (x, y) => { const xi = Math.round(x), yi = Math.round(y); return xi >= 0 && yi >= 0 && xi < W && yi < H && label[yi * W + xi] === bestId; };
  const bil = (x, y) => {
    const x0 = Math.min(W - 2, Math.max(0, Math.floor(x))), y0 = Math.min(H - 2, Math.max(0, Math.floor(y))), fx = x - x0, fy = y - y0, i = y0 * W + x0;
    return red[i] * (1 - fx) * (1 - fy) + red[i + 1] * fx * (1 - fy) + red[i + W] * (1 - fx) * fy + red[i + W + 1] * fx * fy;
  };
  // outline radius per degree: the last plate pixel along the ray, refined by where the luminance crosses the threshold
  const N = 360, radius = new Float32Array(N).fill(NaN);
  const rmax = Math.hypot(W, H) / 2;
  for (let k = 0; k < N; k++) {
    const a = (k / N) * 2 * Math.PI, ux = Math.cos(a), uy = Math.sin(a);
    let last = -1;
    for (let r = 0; r < rmax; r += 0.5) if (inPlate(cx + ux * r, cy + uy * r)) last = r;
    if (last < 0) continue;
    // the pixel just outside must be head (opaque) - otherwise this ray ends at the silhouette
    const ox = cx + ux * (last + 6), oy = cy + uy * (last + 6);
    if (!opaque[Math.round(oy) * W + Math.round(ox)]) continue;
    // walk in from the hood until its redness (r - b >= 50) ends: that is the outline, found to a tenth of a pixel (an interior cheek is
    // red too, but it is separated from the hood by charcoal, so walking in from outside never reaches it)
    let edge = NaN;
    for (let r = last + 8; r >= Math.max(0, last - 8); r -= 0.1) if (bil(cx + ux * r, cy + uy * r) < 50) { edge = r + 0.05; break; }
    radius[k] = edge;
  }
  // deviation from a smooth curve: the outline with everything above 36 harmonics (finer than about 10 degrees) removed.  Missing rays
  // (ones that end at the silhouette) are bridged by straight lines for the fit and are not scored.
  const filled = Float32Array.from(radius);
  for (let k = 0; k < N; k++) {
    if (!Number.isNaN(filled[k])) continue;
    let a = 1; while (Number.isNaN(radius[(k - a + N) % N]) && a < N) a++;
    let b = 1; while (Number.isNaN(radius[(k + b) % N]) && b < N) b++;
    const ra = radius[(k - a + N) % N], rb = radius[(k + b) % N];
    filled[k] = Number.isNaN(ra) || Number.isNaN(rb) ? 0 : ra + (rb - ra) * (a / (a + b));
  }
  const smooth = new Float32Array(N);
  for (let h = 0; h <= 36; h++) {
    let re = 0, im = 0;
    for (let k = 0; k < N; k++) { const t = (2 * Math.PI * h * k) / N; re += filled[k] * Math.cos(t); im += filled[k] * Math.sin(t); }
    const w = h === 0 ? 1 / N : 2 / N;
    for (let k = 0; k < N; k++) { const t = (2 * Math.PI * h * k) / N; smooth[k] += w * (re * Math.cos(t) + im * Math.sin(t)); }
  }
  const dev = [];
  for (let k = 0; k < N; k++) if (!Number.isNaN(radius[k])) dev.push(Math.abs(radius[k] - smooth[k]));
  dev.sort((p, q) => p - q);
  const p95 = dev.length ? dev[Math.floor(dev.length * 0.95)] : null;
  // white grains: bright pixels well above the local median, well inside the plate
  let specks = 0;
  for (let y = 6; y < H - 6; y += 1) for (let x = 6; x < W - 6; x += 1) {
    const i = y * W + x;
    if (label[i] !== bestId || lum[i] < 70) continue;
    // interior only (8 px from the plate's edge)
    if (!inPlate(x - 8, y) || !inPlate(x + 8, y) || !inPlate(x, y - 8) || !inPlate(x, y + 8)) continue;
    const v = []; for (let j = -3; j <= 3; j++) for (let k2 = -3; k2 <= 3; k2++) v.push(lum[(y + j) * W + x + k2]);
    v.sort((p, q) => p - q);
    if (lum[i] > v[24] + 50) specks++;
  }
  return { rough: dev.length ? dev.reduce((p, q) => p + q, 0) / dev.length : null, p95, specks, rays: dev.length };
}

let failed = 0;
for (const dpr of [1, 2]) {
  const browser = await launch({ width: 1300, height: 590, dpr });       // (the stage is the whole window: 590 px tall, like the stage this was calibrated on)
  try {
    const page = await browser.newPage();
    const logs = watchErrors(page);
    await page.goto(`${ORIGIN}/`, { waitUntil: 'networkidle2', timeout: 120000 });
    await page.waitForFunction('window.mascot && window.mascot.loaded', { timeout: 120000 });
    await page.evaluate(() => document.querySelector('#motion').scrollIntoView({ behavior: 'instant' }));
    for (const yaw of yaws) {
      await page.evaluate((y) => window.mascot.freeze('idle', 1, { time: 0, override: { 'root.yaw': y }, look: [0, 0] }), yaw);
      await new Promise((r) => setTimeout(r, 300));
      const r = await page.evaluate(async (fn, dataUrlFn) => {
        const snap = window.mascot.snapshot();
        // eslint-disable-next-line no-new-func
        const analyseFn = new Function(`return (${fn})`)();
        return analyseFn(snap);
      }, analyse.toString(), null);
      const scored = dpr === 2 && Math.abs(yaw) <= 0.6;
      const ok = r.rough != null && r.p95 <= maxRough && r.specks <= 12;
      if (scored && !ok) failed++;
      console.log(`${scored ? (ok ? 'PASS' : 'FAIL') : 'info'}  ${dpr}x  yaw ${String(yaw).padStart(5)}   outline roughness mean ${r.rough?.toFixed(2)} p95 ${r.p95?.toFixed(2)} px   specks ${r.specks}   (${r.rays} rays)`);
    }
    if (logs.length) console.log(logs.join('\n'));
  } finally {
    await browser.close();
  }
}
process.exit(failed ? 1 : 0);
