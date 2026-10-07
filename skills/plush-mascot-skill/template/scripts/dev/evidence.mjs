// Regenerate the validation evidence from the live page: one still per state on a plain stage (light and dark), a contact sheet of the
// eight scenes on a desktop and on a phone, the phone's working scene, the transparent runtime snapshot and the animated GLB (which is
// then run through the Khronos validator).
//   node scripts/dev/evidence.mjs [--only states,pages,snapshot,glb]
// Needs the dev server on :4173 (npm run dev -- --port 4173) or MASCOT_ORIGIN.
import { mkdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { launch, watchErrors, ORIGIN } from './browser.mjs';

const args = Object.fromEntries(process.argv.slice(2).reduce((a, v, i, all) => (v.startsWith('--') ? [...a, [v.slice(2), all[i + 1] ?? true]] : a), []));
const only = new Set(String(args.only ?? 'states,pages,snapshot,glb').split(','));
const OUT = 'tests';
mkdirSync(OUT, { recursive: true });

// where in each state's one-shot the frame is taken (seconds): the settled pose, not the first moment (working has sat down and is typing by ~4 s)
const WHEN = { idle: 1, greeting: 1.3, listening: 1.2, thinking: 1.4, working: 4, approval: 2, success: 0.65, error: 1.4, speaking: 1, resting: 4 };
const SCENES = ['hello', 'motion', 'thinking', 'working', 'approval', 'done', 'closer', 'goodnight'];
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function open(browser, { width, height, dpr, mobile = false }) {
  const page = await browser.newPage();
  if (mobile) await page.emulate({ viewport: { width, height, deviceScaleFactor: dpr, isMobile: true, hasTouch: true }, userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1' });
  else await page.setViewport({ width, height, deviceScaleFactor: dpr });
  const logs = watchErrors(page);
  await page.goto(`${ORIGIN}/`, { waitUntil: 'networkidle2', timeout: 120000 });
  await page.waitForFunction('window.mascot && window.mascot.loaded', { timeout: 120000 });
  await wait(1200);
  return { page, logs };
}

/** Mascot alone on a plain stage, framed whole and centred, posed exactly (freeze), in the light or the dark. */
async function stateShot(page, state, file, dark = false) {
  await page.evaluate((dark) => { document.documentElement.classList.add('capture'); document.documentElement.classList.toggle('capture--dark', dark); window.mascot.setView({ x: 0, y: 0, zoom: 1, yaw: 0 }, { immediate: true }); }, dark);
  await page.evaluate((s, t) => window.mascot.freeze(s, t, { time: 1.0 }), state, WHEN[state]);
  await wait(350);
  await page.screenshot({ path: file });
}

/** Screenshot every scene (each after a jump and long enough to settle) and lay them out on one sheet. */
async function sceneSheet(browser, opts, cols, file) {
  const { page, logs } = await open(browser, opts);
  const shots = [];
  for (const id of SCENES) {
    await page.evaluate((id) => document.getElementById(id).scrollIntoView({ behavior: 'instant' }), id);
    await wait(id === 'working' ? 4500 : 2600);
    shots.push((await page.screenshot({ encoding: 'base64' })));
  }
  const sheetPage = await browser.newPage();
  const data = await sheetPage.evaluate(async (shots, cols, w, h) => {
    const c = document.createElement('canvas'), rows = Math.ceil(shots.length / cols);
    c.width = cols * w; c.height = rows * h;
    const g = c.getContext('2d');
    for (let i = 0; i < shots.length; i++) { const img = new Image(); img.src = `data:image/png;base64,${shots[i]}`; await img.decode(); g.drawImage(img, (i % cols) * w, Math.floor(i / cols) * h, w, h); }
    return c.toDataURL('image/png').split(',')[1];
  }, shots, cols, opts.width * opts.dpr, opts.height * opts.dpr);
  writeFileSync(file, Buffer.from(data, 'base64'));
  await sheetPage.close();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth);
  console.log(`${file}:`, logs.join('\n') || 'clean console', '| scrollWidth', overflow);
  return page;
}

const browser = await launch({ width: 1000, height: 760, dpr: 2 });
try {
  if (only.has('states')) {
    const { page, logs } = await open(browser, { width: 1000, height: 760, dpr: 2 });
    for (const state of Object.keys(WHEN)) await stateShot(page, state, `${OUT}/state-${state}.png`);
    await stateShot(page, 'idle', `${OUT}/stage-dark.png`, true);
    await stateShot(page, 'greeting', `${OUT}/final-motion.png`);
    console.log('states:', logs.join('\n') || 'clean console');
    await page.close();
  }
  if (only.has('pages')) {
    (await sceneSheet(browser, { width: 960, height: 600, dpr: 1 }, 3, `${OUT}/final-studio.png`)).close();
    const phone = await sceneSheet(browser, { width: 390, height: 844, dpr: 1, mobile: true }, 4, `${OUT}/mobile.png`);
    await phone.evaluate(() => document.getElementById('working').scrollIntoView({ behavior: 'instant' }));
    await wait(4500);
    await phone.screenshot({ path: `${OUT}/mobile-motion.png` });
    await phone.close();
  }
  if (only.has('snapshot') || only.has('glb')) {
    const { page, logs } = await open(browser, { width: 1000, height: 760, dpr: 2 });
    if (only.has('snapshot')) {
      await page.evaluate(() => window.mascot.freeze('idle', 1, { time: 0, override: { 'root.yaw': 0 } }));
      await wait(300);
      const url = await page.evaluate(() => window.mascot.snapshot());
      writeFileSync('assets/mascot-runtime-idle.png', Buffer.from(url.split(',')[1], 'base64'));
      console.log('wrote assets/mascot-runtime-idle.png');
    }
    if (only.has('glb')) {
      const b64 = await page.evaluate(async () => {
        const buf = await window.mascot.exportGLB();
        const bytes = new Uint8Array(buf);
        let s = '';
        for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
        return btoa(s);
      });
      const glb = Buffer.from(b64, 'base64');
      writeFileSync('assets/mascot-animated.glb', glb);
      console.log(`wrote assets/mascot-animated.glb (${(glb.length / 1e6).toFixed(1)} MB)`);
      const validator = createRequire(import.meta.url)('gltf-validator');
      const report = await validator.validateBytes(new Uint8Array(glb), { uri: 'mascot-animated.glb', maxIssues: 200 });
      writeFileSync(`${OUT}/gltf-validation.json`, JSON.stringify(report, null, 1));
      const m = report.issues;
      console.log(`glTF validator: ${m.numErrors} errors, ${m.numWarnings} warnings, ${m.numInfos} infos, ${m.numHints} hints`);
    }
    console.log('snapshot/glb:', logs.join('\n') || 'clean console');
    await page.close();
  }
} finally {
  await browser.close();
}
