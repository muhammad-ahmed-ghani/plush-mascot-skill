// Load the exported GLB in a bare three.js scene (no studio code) and render a few frames of its clips.
//   node scripts/dev/glb-check.mjs [outPrefix]     (needs the dev server on :4173; the frames go to tests/glb-check_<clip>.png by default)
import { writeFileSync } from 'node:fs';
import { launch, watchErrors, ORIGIN } from './browser.mjs';

const prefix = process.argv[2] ?? 'tests/glb-check';
const browser = await launch({ width: 800, height: 800 });
try {
  const page = await browser.newPage();
  const logs = watchErrors(page);
  await page.goto(`${ORIGIN}/glb-check.html`, { waitUntil: 'load' });
  await page.waitForFunction('window.__glbReady === true', { timeout: 120000 });
  const info = await page.evaluate(() => ({ clips: window.glbCheck.clips, skinned: window.glbCheck.skinned, tree: window.glbCheck.tree }));
  if (process.env.TREE) console.log(info.tree.join('\n'));
  console.log(`${info.clips.length} clips: ${info.clips.map((c) => `${c.name}(${c.tracks} tracks, ${c.duration}s)`).join(' ')}`);
  console.log(`skinned meshes: ${info.skinned.map((m) => `${m.name}[${m.verts}] under ${m.parent}`).join(', ')}`);
  for (const [clip, t] of [['idle', 0], ['greeting', 1.2], ['working', 1.0], ['success', 0.9], ['resting', 1.0]]) {
    const r = await page.evaluate((c, tt) => window.glbCheck.frame(c, tt), clip, t);
    writeFileSync(`${prefix}_${clip}.png`, Buffer.from(r.png.split(',')[1], 'base64'));
    console.log(`${clip.padEnd(9)} t=${t}  y ${r.min[1].toFixed(2)}..${r.max[1].toFixed(2)}  x ${r.min[0].toFixed(2)}..${r.max[0].toFixed(2)}`);
  }
  console.log(logs.join('\n') || '(clean console)');
} finally {
  await browser.close();
}
