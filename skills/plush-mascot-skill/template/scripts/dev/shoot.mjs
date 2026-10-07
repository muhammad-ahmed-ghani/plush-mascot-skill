// Render /lab.html (the real MascotController in a fixed-size square, no page chrome) to a PNG.
//   node scripts/dev/shoot.mjs "size=1254&state=greeting&t=1.2&yaw=0.5&fov=24&cx=0&cy=1.8&cz=10&ty=1.6" out.png
// Query options are documented at the top of src/lab-ctrl.js.
import { writeFileSync } from 'node:fs';
import { launch, watchErrors, ORIGIN } from './browser.mjs';

const [query = '', out = 'shot.png'] = process.argv.slice(2);
const browser = await launch({ width: 1400, height: 1400, dpr: +(process.env.DPR ?? 1) });
try {
  const page = await browser.newPage();
  const logs = watchErrors(page);
  await page.goto(`${ORIGIN}/lab.html?${query}`, { waitUntil: 'load' });
  await page.waitForFunction('window.__labReady === true', { timeout: 90000 }).catch(() => logs.push('[timeout] lab not ready'));
  const data = await page.evaluate(() => window.lab?.toDataURL?.());
  if (data) writeFileSync(out, Buffer.from(data.split(',')[1], 'base64'));
  if (logs.length) console.log(logs.join('\n'));
  console.log(data ? `saved ${out}` : 'NO IMAGE');
} finally {
  await browser.close();
}
