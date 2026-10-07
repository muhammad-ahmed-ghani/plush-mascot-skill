// Page-scale look tuner: optimises the real controller against the artwork rescaled to the SAME on-screen density
// (fibre energy at three scales on six body patches + the face fabric, luminance distribution, large-scale tone).
//   node scripts/dev/tune2.mjs --ppus 350,246 --sweeps 5 --only tex|light|cord|all (comma-separated to combine) --out tuned.json [--resume] [--live] [--set JSON] [--freeze exp,...]
// Needs: python3 scripts/dev/scaled-ref.py   and a dev server on :4173.
import { writeFileSync, readFileSync, existsSync } from 'node:fs';
import { launch, watchErrors, ORIGIN } from './browser.mjs';

const args = Object.fromEntries(process.argv.slice(2).reduce((a, v, i, all) => (v.startsWith('--') ? [...a, [v.slice(2), all[i + 1] ?? true]] : a), []));
const ppus = String(args.ppus ?? '350,246').split(',').map(Number);
const sweeps = +(args.sweeps ?? 4);
const only = args.only ?? 'all';
const outPath = args.out ?? 'tuned2.json';
const frozen = new Set(String(args.freeze ?? '').split(',').filter(Boolean));

// name: [initial, min, max, step, group]
const SPACE = {
  env: [0.31, 0.05, 1.0, 0.06, 'light'], exp: [1.196, 0.8, 1.6, 0.06, 'light'],
  gr: [1, 0.4, 3, 0.08, 'light'], gg: [1, 0.4, 3, 0.08, 'light'], gb: [1, 0.4, 3, 0.08, 'light'], fk: [1, 0.3, 4, 0.12, 'light'],
  key: [1.05, 0.2, 4.0, 0.25, 'light'], keyAz: [-38.9, -80, 30, 8, 'light'], keyEl: [35.1, 5, 80, 6, 'light'],
  fill: [0.49, 0, 1.6, 0.1, 'light'], fillAz: [15.5, -30, 60, 8, 'light'], fillEl: [-2.6, -30, 50, 6, 'light'],
  shadowSoft: [26, 4, 90, 8, 'light'], shadowInt: [0.8, 0.2, 1, 0.1, 'light'],
  bounce: [0.0, 0, 1.2, 0.1, 'light'], bounceAz: [12, -40, 60, 8, 'light'], hemi: [0.0, 0, 1.5, 0.1, 'light'],
  'u.uWrap': [0.34, 0.05, 1.2, 0.08, 'light'], 'u.uRimAmount': [0.55, 0, 2.4, 0.1, 'light'], 'u.uRimPower': [2.5, 1.5, 5, 0.3, 'light'],
  'u.uRimUp': [0.9, 0, 1, 0.1, 'light'], 'u.uRimSide': [-0.4, -1.0, 0.9, 0.1, 'light'],
  'u.uAOPower': [2.4, 1, 3.5, 0.25, 'light'], 'u.uAODirect': [1, 0.3, 1, 0.1, 'light'], 'u.uAOFloor': [0.3, 0.12, 0.6, 0.05, 'light'], 'u.uToe': [0.8, 0, 1.3, 0.1, 'light'],
  sheen: [1, 0, 2.5, 0.25, 'light'], sr: [0.7, 0.3, 1, 0.1, 'light'],
  'u.uRimTightAmount': [0.9, 0, 5, 0.25, 'edge'], 'u.uRimTightPower': [8, 3, 24, 1.5, 'edge'],
  'u.uShellAlpha': [0.8, 0, 1, 0.1, 'edge'], 'u.uShellGlow': [0.22, 0, 1.5, 0.12, 'edge'], 'u.uShellEdge': [0.3, 0.1, 0.8, 0.06, 'edge'],
  'u.uEdgeLine': [0.92, 0.3, 1, 0.08, 'seam'], 'u.uEdgeDark': [0.5, 0.05, 2, 0.15, 'seam'], 'u.uEdgeLineWP': [0.0095, 0.002, 0.03, 0.002, 'seam'], 'u.uEdgeLineWH': [0.0038, 0.0015, 0.012, 0.001, 'seam'], 'u.uEdgeLineAt': [0.002, 0.0, 0.007, 0.001, 'seam'], 'u.uEdgeLineChin': [1.0, 0.2, 1.0, 0.1, 'seam'], 'u.uEdgeLineChinW': [1.0, 0.25, 1.0, 0.1, 'seam'],
  'u.uEdgePlateLR': [0.32, 0, 0.7, 0.06, 'seam'], 'u.uEdgePlateTB': [0.1, 0, 0.7, 0.06, 'seam'], 'u.uEdgePlateW': [0.065, 0.02, 0.15, 0.012, 'seam'],
  'u.uEdgeHem': [0.16, -0.5, 0.6, 0.05, 'seam'], 'u.uEdgeHemAt': [0.035, 0.01, 0.09, 0.008, 'seam'], 'u.uEdgeHemW': [0.03, 0.012, 0.08, 0.008, 'seam'],
  'u.uEdgeBump': [0.07, 0, 0.2, 0.02, 'seam'], 'u.uEdgeBumpW': [0.03, 0.015, 0.09, 0.008, 'seam'], 'u.uEdgeRim': [0.008, 0, 0.04, 0.005, 'seam'],
  'u.uNormalStrength': [0.24, 0.05, 0.45, 0.05, 'tex'], 'u.uFibAlbedo': [0.3, 0.15, 1.2, 0.05, 'tex'], 'u.uTipAmount': [0.5, 0, 2.2, 0.12, 'tex'],
  'u.uCavity': [0.2, 0, 0.7, 0.06, 'tex'], 'u.uCrestPow': [1, 0.7, 4, 0.25, 'tex'], 'u.uFeltBias': [-0.26, -1.6, 0.6, 0.2, 'tex'], 'u.uFibGain': [2.4, 1, 7, 0.4, 'tex'],
  cordAmp: [1, 0.15, 3.0, 0.15, 'cord'], cordBump: [9, 0, 20, 1.2, 'cord'], cordBright: [1, 0.5, 1.6, 0.08, 'cord'],
  'u.uFaceDetail': [1.4, 0.5, 4, 0.25, 'tex'], 'u.uFaceTip': [0.35, 0, 1.5, 0.1, 'tex'], 'u.uUpFibre': [0.6, 0, 2.5, 0.15, 'tex'], 'u.uFaceRelief': [1.2, 0, 6, 0.25, 'tex'], 'u.uFaceVignette': [0.16, 0, 0.5, 0.05, 'tex'],
};
const onlySet = new Set(String(only).split(','));
const names = Object.keys(SPACE).filter((k) => (onlySet.has('all') || onlySet.has(SPACE[k][4])) && !frozen.has(k));
let current = Object.fromEntries(Object.entries(SPACE).map(([k, v]) => [k, v[0]]));
if (args.resume && existsSync(outPath)) current = { ...current, ...JSON.parse(readFileSync(outPath, 'utf8')).params };

const browser = await launch({ width: 1600, height: 1600 });
const page = await browser.newPage();
const logs = watchErrors(page);
await page.goto(`${ORIGIN}/lab.html?size=600`, { waitUntil: 'load' });
await page.waitForFunction('window.__labReady === true', { timeout: 120000 });
if (logs.length) console.log(logs.join('\n'));

if (args.live) {                       // start from what the page actually uses, not from the (older) SPACE defaults
  const live = await page.evaluate(() => window.lab.getParams());
  for (const k of Object.keys(SPACE)) if (live[k] !== undefined) current[k] = live[k];
  console.log('starting from the live controller values');
}

if (args.set) Object.assign(current, JSON.parse(args.set));          // e.g. --set '{"keyAz":40,"fillAz":-40}' to start from another basin

const toParams = (c) => {
  const p = { u: {} };
  for (const [k, v] of Object.entries(c)) { if (k.startsWith('u.')) p.u[k.slice(2)] = v; else p[k] = v; }
  return p;
};
async function score(c) {
  const rs = [];
  for (const ppu of ppus) rs.push(await page.evaluate(async (p, ppu) => { window.lab.setParams(p); return window.lab.evaluate(ppu); }, toParams(c), ppu));
  const avg = (f) => rs.reduce((t, r) => t + f(r), 0) / rs.length;
  return { loss: avg((r) => r.loss), tone: avg((r) => r.tone), cells: avg((r) => r.cellErr), plate: avg((r) => r.plateErr), fshape: avg((r) => r.faceShapeErr), rim: avg((r) => r.rimErr), edge: avg((r) => r.edgeErr), soft: avg((r) => r.softErr), spread: avg((r) => r.spread), fibre: avg((r) => r.fibreLoss), faceTone: avg((r) => r.faceTone), faceFibre: avg((r) => r.faceFibre), hueC: avg((r) => r.hueBody), hueF: avg((r) => r.hueFace), cord: avg((r) => r.cordErr), skew: avg((r) => r.skewErr), kurt: avg((r) => r.kurtErr), even: avg((r) => r.evenErr), rs };
}
const fmt = (r) => `loss ${r.loss.toFixed(3)}  tone ${r.tone.toFixed(2)}  cells ${r.cells.toFixed(2)} plate ${r.plate.toFixed(2)} fshape ${r.fshape.toFixed(2)} rim ${r.rim.toFixed(1)} seam ${r.edge.toFixed(1)} soft ${r.soft.toFixed(2)}  spread ${r.spread.toFixed(2)}  fibre(log) ${r.fibre.toFixed(3)}  face tone ${r.faceTone.toFixed(2)} fibre ${r.faceFibre.toFixed(3)}  hue body ${r.hueC.toFixed(3)} face ${r.hueF.toFixed(3)}  cord(log) ${r.cord.toFixed(3)}  skewErr ${r.skew.toFixed(2)} kurtErr ${r.kurt.toFixed(2)} evenErr(log) ${r.even.toFixed(3)}`;
function ratios(r) {
  return r.rs.map((x) => {
    const fine = [], mid = [];
    for (const p of Object.values(x.patches)) { if (p.ref[0] && p.live[0]) fine.push(p.live[0] / p.ref[0]); if (p.ref[1] && p.live[1]) mid.push(p.live[1] / p.ref[1]); }
    const m = (a) => (a.reduce((t, v) => t + v, 0) / Math.max(1, a.length)).toFixed(2);
    return `ppu${x.ppu}: fibre energy live/ref fine ${m(fine)} mid ${m(mid)}  meanL ${x.meanLive.toFixed(0)}/${x.meanRef.toFixed(0)}  cord ${x.cordLive.toFixed(1)}/${x.cordRef.toFixed(1)} (mean ${x.cordMeanLive.toFixed(0)}/${x.cordMeanRef.toFixed(0)})`;
  }).join(' | ');
}

let best = await score(current);
console.log('start  ' + fmt(best)); console.log('       ' + ratios(best));
const step = Object.fromEntries(names.map((k) => [k, SPACE[k][3]]));
for (let s = 0; s < sweeps; s++) {
  for (const k of names) {
    const [, lo, hi] = SPACE[k];
    for (const dir of [1, -1]) {
      for (let improved = true; improved;) {
        improved = false;
        const v = Math.min(hi, Math.max(lo, current[k] + dir * step[k]));
        if (v === current[k]) break;
        const cand = { ...current, [k]: v };
        const r = await score(cand);
        if (r.loss < best.loss - 1e-4) { current = cand; best = r; improved = true; }
      }
    }
  }
  for (const k of names) step[k] *= 0.6;
  console.log(`sweep ${s + 1}  ${fmt(best)}`); console.log('       ' + ratios(best));
  writeFileSync(outPath, JSON.stringify({ params: current, best: { ...best, rs: undefined } }, null, 1));
}
console.log(JSON.stringify(Object.fromEntries(Object.entries(current).map(([k, v]) => [k, +v.toFixed(3)])), null, 1));
await browser.close();
