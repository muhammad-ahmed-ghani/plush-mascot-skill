// Smoke test: load the page, wait for the model, check the canvas is not blank and the console is clean.
//   node scripts/dev/smoke.mjs            (dev server or preview on MASCOT_ORIGIN, default http://127.0.0.1:4173)
import { launch, watchErrors, ORIGIN } from './browser.mjs';
const browser = await launch({ width: 1300, height: 900, dpr: 1 });
let failed = 0;
const check = (name, ok, detail = '') => { if (!ok) failed++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`); };
try {
  const page = await browser.newPage();
  const logs = watchErrors(page);
  await page.goto(`${ORIGIN}/`, { waitUntil: 'networkidle2', timeout: 120000 });
  await page.waitForFunction('window.mascot && window.mascot.loaded', { timeout: 120000 });
  await new Promise((r) => setTimeout(r, 1500));
  const px = await page.evaluate(() => {
    const m = window.mascot, gl = m.renderer.getContext(), W = gl.drawingBufferWidth, H = gl.drawingBufferHeight, buf = new Uint8Array(W * H * 4);
    m.renderer.render(m.scene, m.camera);
    gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, buf);
    let opaque = 0; for (let i = 3; i < buf.length; i += 4) if (buf[i] > 200) opaque++;
    return { opaque, total: W * H, states: Object.keys(window.MASCOT_STATES ?? {}).length };
  });
  check('the model loaded and the canvas shows an opaque figure', px.opaque > px.total * 0.05, `${(100 * px.opaque / px.total).toFixed(1)}% opaque`);
  check('ten states are defined', px.states === 10, `${px.states}`);
  check('no console errors or failed requests', logs.length === 0, logs.slice(0, 3).join(' | '));
} finally { await browser.close(); }
process.exit(failed ? 1 : 0);
