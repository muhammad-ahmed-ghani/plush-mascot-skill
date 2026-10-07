// Shared headless-Chrome launcher for the dev/test scripts (uses the system Chrome with Metal-backed WebGL).
import puppeteer from 'puppeteer-core';

export const CHROME = process.env.CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
export const ORIGIN = process.env.MASCOT_ORIGIN ?? 'http://127.0.0.1:4173';

export async function launch({ width = 1300, height = 1000, dpr = 1 } = {}) {
  return puppeteer.launch({
    executablePath: CHROME,
    headless: 'new',
    // (MASCOT_CHROME_ARGS adds flags, space separated.  Note that on battery below 20% Chrome's Energy Saver holds every page to 30 fps, and
    // no flag lifts that without also removing the display's pacing: for frame-rate measurements, plug in)
    args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--hide-scrollbars', '--no-first-run', ...(process.env.MASCOT_CHROME_ARGS?.split(' ').filter(Boolean) ?? [])],
    defaultViewport: { width, height, deviceScaleFactor: dpr },
  });
}

/** Collect console errors / page errors while a page is open (404s for favicons and the like are ignored). */
export function watchErrors(page) {
  const logs = [];
  page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error' && !/404|Failed to load resource/.test(m.text())) logs.push(`[console.error] ${m.text().slice(0, 500)}`);
  });
  return logs;
}
