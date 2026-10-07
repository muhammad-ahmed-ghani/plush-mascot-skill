// Render Mascot near-orthographically from the front at a chosen on-screen density, ready for audit.py to compare against the
// artwork rescaled to the SAME density.
//   node scripts/dev/audit.mjs --ppu 246 --out /tmp/live.png [--state idle] [--t 1] [--size 1000] [--zoom auto|N]
// ppu = drawing-buffer pixels per character-unit.  A 590 px stage on a 2x display is ~246; on a 1x display ~123; the artwork is 350.
import { writeFileSync } from 'node:fs';
import { launch, watchErrors, ORIGIN } from './browser.mjs';

const args = Object.fromEntries(process.argv.slice(2).reduce((a, v, i, all) => (v.startsWith('--') ? [...a, [v.slice(2), all[i + 1] ?? true]] : a), []));
const ppu = +(args.ppu ?? 246), out = args.out ?? 'live.png';
const size = +(args.size ?? Math.max(600, Math.round((ppu * 4.2) / 2) * 2));      // must match sizeFor() in src/lab-metrics.js
const fov = 6;
const visible = size / ppu;
const dist = visible / (2 * Math.tan((fov * Math.PI) / 360));
const q = new URLSearchParams({ size: String(size), state: args.state ?? 'idle', t: String(args.t ?? 1), time: String(args.time ?? 0), yaw: String(args.yaw ?? 0), fov: String(fov), cx: '0', cy: '1.65', cz: String(dist), tx: '0', ty: '1.65', tz: '0', transparent: '1' });
if (args.zoom && args.zoom !== 'auto') q.set('napzoom', args.zoom);
const browser = await launch({ width: size + 100, height: size + 100, dpr: 1 });
try {
  const page = await browser.newPage();
  const logs = watchErrors(page);
  await page.goto(`${ORIGIN}/lab.html?${q}`, { waitUntil: 'load' });
  await page.waitForFunction('window.__labReady === true', { timeout: 90000 }).catch(() => logs.push('[timeout] lab not ready'));
  const zoom = await page.evaluate(() => window.lab?.napZoom?.());
  const data = await page.evaluate(() => window.lab?.toDataURL?.());
  if (data) writeFileSync(out, Buffer.from(data.split(',')[1], 'base64'));
  console.log(JSON.stringify({ ppu, size, dist: +dist.toFixed(3), napZoom: zoom, logs }));
} finally {
  await browser.close();
}
