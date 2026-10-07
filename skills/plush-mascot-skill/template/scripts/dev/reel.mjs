// Record the ten-state motion reel deterministically: the real controller is stepped at exactly 60 fps and every
// frame is captured (about 130 ms a frame, so the ~32 s reel takes ~4 minutes), then encoded with ffmpeg.
//   node scripts/dev/reel.mjs [--out assets] [--fps 60] [--keep frames-dir]
import { mkdirSync, rmSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { launch, watchErrors, ORIGIN } from './browser.mjs';

const args = Object.fromEntries(process.argv.slice(2).reduce((a, v, i, all) => (v.startsWith('--') ? [...a, [v.slice(2), all[i + 1] ?? true]] : a), []));
const out = args.out ?? 'assets';
const fps = +(args.fps ?? 60);
const dir = args.keep ?? `${process.env.TMPDIR ?? '/tmp'}/mascot-reel-frames`;
if (existsSync(dir)) rmSync(dir, { recursive: true });
mkdirSync(dir, { recursive: true });

const browser = await launch({ width: 800, height: 800, dpr: 1 });
try {
  const page = await browser.newPage();
  const logs = watchErrors(page);
  await page.goto(`${ORIGIN}/reel.html`, { waitUntil: 'networkidle2', timeout: 120000 });
  await page.waitForFunction('window.__reelReady === true', { timeout: 120000 });
  const { states, seconds } = await page.evaluate(() => ({ states: window.reel.states, seconds: window.reel.states.map((_, i) => window.reel.seconds(i)) }));
  const total = seconds.reduce((a, b) => a + Math.round(b * fps), 0);
  const frame = await page.$('#frame');
  let n = 0;
  // let the idle pose settle before the first state starts
  await page.evaluate(() => window.reel.begin(0));
  for (let i = 0; i < 12; i++) await page.evaluate((dt) => window.reel.step(dt), 1 / fps);
  const t0 = Date.now();
  for (let s = 0; s < states.length; s++) {
    await page.evaluate((i) => window.reel.begin(i), s);
    for (let f = 0, N = Math.round(seconds[s] * fps); f < N; f++) {
      await page.evaluate((dt) => window.reel.step(dt), 1 / fps);
      await frame.screenshot({ path: `${dir}/f${String(n++).padStart(5, '0')}.png`, optimizeForSpeed: true });
    }
    process.stdout.write(`\r${states[s].padEnd(10)} ${n}/${total} frames  ${((Date.now() - t0) / 1000).toFixed(0)}s   `);
  }
  console.log('\n' + (logs.join('\n') || '(clean console)'));
} finally {
  await browser.close();
}
const enc = (extra, file) => {
  const r = spawnSync('ffmpeg', ['-y', '-v', 'error', '-framerate', String(fps), '-i', `${dir}/f%05d.png`, ...extra, file], { stdio: 'inherit' });
  if (r.status !== 0) throw new Error('ffmpeg failed for ' + file);
  console.log('wrote', file);
};
enc(['-c:v', 'libx264', '-preset', 'slow', '-crf', '17', '-pix_fmt', 'yuv420p', '-movflags', '+faststart'], `${out}/mascot-motion-reel.mp4`);
enc(['-c:v', 'libvpx-vp9', '-crf', '30', '-b:v', '0', '-pix_fmt', 'yuv420p'], `${out}/mascot-motion-reel.webm`);
