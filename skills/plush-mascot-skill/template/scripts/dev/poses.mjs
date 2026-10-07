// Capture Mascot on a plain stage in chosen poses (deterministic, via MascotController.freeze).
//   node scripts/dev/poses.mjs outPrefix "greeting:1.2" "success:0.65" "idle:1:f.lt=1,root.yaw=0" ...
// spec = state:seconds[:key=value,...]  (keys are pose keys, see src/mascot-pose.js)
// The page is put in capture mode (html.capture: no words, no felt, no header, a plain light stage) and Mascot is framed whole and centred
// (setView x 0, y 0, zoom 1), so the stills do not depend on where the story had him.
import { launch, watchErrors, ORIGIN } from './browser.mjs';

const [prefix, ...specs] = process.argv.slice(2);
const browser = await launch({ width: 1000, height: 760, dpr: 2 });
try {
  const page = await browser.newPage();
  const logs = watchErrors(page);
  await page.goto(`${ORIGIN}/`, { waitUntil: 'networkidle2', timeout: 90000 });
  await page.waitForFunction('window.mascot && window.mascot.loaded', { timeout: 90000 });
  await page.evaluate(() => {
    document.documentElement.classList.add('capture');
    window.mascot.setView({ x: 0, y: 0, zoom: 1, yaw: 0 }, { immediate: true });
  });
  let i = 0;
  for (const spec of specs) {
    const [state, t = '1', ov = ''] = spec.split(':');
    const override = Object.fromEntries(ov.split(',').filter(Boolean).map((kv) => { const [k, v] = kv.split('='); return [k, +v]; }));
    await page.evaluate((s, tt, o) => window.mascot.freeze(s, +tt, { time: 1.0, override: o }), state, t, override);
    await new Promise((r) => setTimeout(r, 250));
    await page.screenshot({ path: `${prefix}_${i++}_${state}.png` });
  }
  console.log(logs.join('\n') || '(clean console)');
} finally {
  await browser.close();
}
