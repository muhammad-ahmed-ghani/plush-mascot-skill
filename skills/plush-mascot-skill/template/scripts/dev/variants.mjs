// Render several parameter variants at one density and tile the same crop of each (plus the artwork) for side-by-side judging.
//   node scripts/dev/variants.mjs --ppu 350 --crop belly --out /tmp/v.png '{"u":{"uFeltBias":-0.5}}' '{"u":{"uTipAmount":1.2}}' ...
// Each positional argument is a JSON param set for window.lab.setParams (applied on top of the shipped defaults).
import { writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { launch, watchErrors, ORIGIN } from './browser.mjs';
import { sizeFor, TY } from '../../src/lab-metrics.js';

const argv = process.argv.slice(2);
const args = {}; const sets = [];
for (let i = 0; i < argv.length; i++) { if (argv[i].startsWith('--')) { args[argv[i].slice(2)] = argv[i + 1]; i++; } else sets.push(JSON.parse(argv[i])); }
const ppu = +(args.ppu ?? 350);
const CROPS = { belly: [-0.5, 0.5, 0.45, 1.05], ear: [0.45, 1.3, 2.75, 3.32], head: [-1.3, 1.3, 1.6, 3.35], eye: [-0.85, -0.05, 1.85, 2.42], x: [-0.3, 0.3, 0.88, 1.45], leg: [-0.85, -0.05, 0.02, 0.62], arm: [0.45, 1.25, 0.55, 1.4], face: [-0.95, 0.95, 1.55, 2.75] };
const cropName = args.crop ?? 'belly';
const size = sizeFor(ppu);
const box = (c) => { const [x0, x1, y0, y1] = c; return { x: Math.round(size / 2 + x0 * ppu), y: Math.round(size / 2 - (y1 - TY) * ppu), w: Math.round((x1 - x0) * ppu), h: Math.round((y1 - y0) * ppu) }; };
const b = box(CROPS[cropName]);
const out = args.out ?? 'variants.png';
const dir = out.replace(/\.png$/, '_parts');
spawnSync('mkdir', ['-p', dir]);

const browser = await launch({ width: 1200, height: 1200 });
try {
  const page = await browser.newPage();
  const logs = watchErrors(page);
  await page.goto(`${ORIGIN}/lab.html?size=600`, { waitUntil: 'load' });
  await page.waitForFunction('window.__labReady === true', { timeout: 120000 });
  const files = [];
  // artwork crop first
  const ref = await page.evaluate(async (ppu, b) => {
    const img = new Image(); img.src = `/scripts/dev/.refs/ref_${ppu}.png`; await img.decode();
    const c = document.createElement('canvas'); c.width = b.w; c.height = b.h;
    const g = c.getContext('2d'); g.fillStyle = '#f6f3ee'; g.fillRect(0, 0, b.w, b.h); g.drawImage(img, -b.x, -b.y);
    return c.toDataURL('image/png');
  }, ppu, b);
  writeFileSync(`${dir}/0_art.png`, Buffer.from(ref.split(',')[1], 'base64')); files.push(`${dir}/0_art.png`);
  for (let i = 0; i < sets.length; i++) {
    const png = await page.evaluate(async (p, ppu, b) => {
      window.lab.setParams(p);
      window.lab.renderAt(ppu);                             // frames + renders; read back in the same task (the drawing buffer is not preserved)
      const src = window.lab.mascot.renderer.domElement;
      const c = document.createElement('canvas'); c.width = b.w; c.height = b.h;
      const g = c.getContext('2d'); g.fillStyle = '#f6f3ee'; g.fillRect(0, 0, b.w, b.h); g.drawImage(src, -b.x, -b.y);
      return c.toDataURL('image/png');
    }, sets[i], ppu, b);
    const f = `${dir}/${i + 1}_v.png`; writeFileSync(f, Buffer.from(png.split(',')[1], 'base64')); files.push(f);
  }
  if (logs.length) console.log(logs.join('\n'));
  const r = spawnSync('magick', [...files, '+append', out], { stdio: 'inherit' });
  console.log(r.status === 0 ? `wrote ${out} (${files.length} panels: art + ${sets.length} variants, crop ${cropName} @ ${ppu} ppu)` : 'montage failed');
} finally {
  await browser.close();
}
