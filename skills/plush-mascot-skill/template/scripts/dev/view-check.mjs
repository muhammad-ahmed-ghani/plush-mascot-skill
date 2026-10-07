// Does the artwork poster (placed from figureBox()) stay on the live model when setView() moves, raises or magnifies him?  The page fades
// from the poster to the canvas, so a poster that is off by more than a few pixels would jump.  For several views the opaque extent of the
// rendered figure is read back from the drawing buffer and compared with where figureBox() says the artwork's head and feet are.
//   node scripts/dev/view-check.mjs [--tol 6]          (dev server on :4173 by default; exits 1 when a view is off by more than --tol px)
import { launch, watchErrors, ORIGIN } from './browser.mjs';

const args = Object.fromEntries(process.argv.slice(2).reduce((a, v, i, all) => (v.startsWith('--') ? [...a, [v.slice(2), all[i + 1] ?? true]] : a), []));
const tol = +(args.tol ?? 6);
const browser = await launch({ width: 1300, height: 900, dpr: 1 });
let failed = 0;
try {
  const page = await browser.newPage();
  const logs = watchErrors(page);
  await page.goto(`${ORIGIN}/`, { waitUntil: 'networkidle2', timeout: 120000 });
  await page.waitForFunction('window.mascot && window.mascot.loaded', { timeout: 120000 });
  const rows = await page.evaluate(() => {
    const w = window.mascot, out = [];
    w.paused = true;
    for (const v of [{ x: 0, y: 0, zoom: 1 }, { x: 0.22, y: 0.05, zoom: 1.2 }, { x: -0.3, y: -0.1, zoom: 0.85 }, { x: 0.1, y: 0.02, zoom: 0.7 }]) {
      w.setView(v, { immediate: true });
      w.freeze('idle', 1, { time: 0, override: { 'root.yaw': 0 }, look: [0, 0] });
      const gl = w.renderer.getContext(), W = gl.drawingBufferWidth, H = gl.drawingBufferHeight, px = new Uint8Array(W * H * 4);
      w.renderer.render(w.scene, w.camera);
      gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, px);
      let top = H, bottom = -1, left = W, right = -1;
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (px[(y * W + x) * 4 + 3] > 200) { const yy = H - 1 - y; if (yy < top) top = yy; if (yy > bottom) bottom = yy; if (x < left) left = x; if (x > right) right = x; }
      const b = w.figureBox(), k = b.size / 1254, s = W / w.renderer.domElement.clientWidth;
      // the neutral artwork's figure spans rows 47..1204 of its 1254 px square (head top to feet), centred on column 627.5
      out.push({ view: v, top: top / s - (b.top + 47 * k), feet: bottom / s - (b.top + 1204 * k), centre: (left + right) / 2 / s - (b.left + 627.5 * k) });
    }
    return out;
  });
  for (const r of rows) {
    const worst = Math.max(Math.abs(r.top), Math.abs(r.feet), Math.abs(r.centre)), ok = worst <= tol;
    if (!ok) failed++;
    console.log(`${ok ? 'PASS' : 'FAIL'}  view ${JSON.stringify(r.view)}  head ${r.top.toFixed(1)} px, feet ${r.feet.toFixed(1)} px, axis ${r.centre.toFixed(1)} px off`);
  }
  if (logs.length) console.log(logs.join('\n'));
} finally {
  await browser.close();
}
process.exit(failed ? 1 : 0);
