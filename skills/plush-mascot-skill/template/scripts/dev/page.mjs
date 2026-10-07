// Screenshot the real page.  --scroll jumps to a scene (#hello #motion #thinking #working #approval #done #closer #goodnight, or any selector);
// the scene then performs its own state, so give slow ones time with --wait (working takes about 4 s to settle); --state forces a state instead.
// --mobile uses a phone (390 x 844 at 2x).
//   node scripts/dev/page.mjs out.png [--width 1300] [--height 1000] [--dpr 1] [--full] [--state working] [--scroll #approval] [--wait 1500] [--mobile]
import { launch, watchErrors, ORIGIN } from './browser.mjs';

const [out = 'page.png'] = process.argv.slice(2).filter((a) => !a.startsWith('--') && !/^\d/.test(a));
const args = Object.fromEntries(process.argv.slice(2).reduce((a, v, i, all) => (v.startsWith('--') ? [...a, [v.slice(2), all[i + 1] && !all[i + 1].startsWith('--') ? all[i + 1] : true]] : a), []));
const browser = await launch({ width: +(args.width ?? 1300), height: +(args.height ?? 1000), dpr: +(args.dpr ?? 1) });
try {
  const page = await browser.newPage();
  if (args.mobile) await page.emulate({ viewport: { width: +(args.width ?? 390), height: +(args.height ?? 844), deviceScaleFactor: +(args.dpr ?? 2), isMobile: true, hasTouch: true }, userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1' });
  const logs = watchErrors(page);
  await page.goto(`${ORIGIN}/`, { waitUntil: 'networkidle2', timeout: 90000 });
  await page.waitForFunction('window.mascot && window.mascot.loaded', { timeout: 90000 });
  if (args.state) await page.evaluate((s) => window.mascot.setState(s), args.state);
  if (args.scroll) await page.evaluate((sel) => document.querySelector(sel)?.scrollIntoView({ behavior: 'instant' }), args.scroll);
  await new Promise((r) => setTimeout(r, +(args.wait ?? 1500)));
  await page.screenshot({ path: out, fullPage: Boolean(args.full) });
  console.log(logs.join('\n') || '(clean console)');
  console.log('saved', out);
} finally {
  await browser.close();
}
