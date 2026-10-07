// Print the page-scale metrics (lab.evaluate) for the controller as it is now.
//   node scripts/dev/eval.mjs [--ppus 350,246,123] [--json]
import { launch, watchErrors, ORIGIN } from './browser.mjs';

const args = Object.fromEntries(process.argv.slice(2).reduce((a, v, i, all) => (v.startsWith('--') ? [...a, [v.slice(2), all[i + 1] ?? true]] : a), []));
const ppus = String(args.ppus ?? '350,246,123').split(',').map(Number);
const browser = await launch({ width: 1600, height: 1600 });
try {
  const page = await browser.newPage();
  const logs = watchErrors(page);
  await page.goto(`${ORIGIN}/lab.html?size=600`, { waitUntil: 'load' });
  await page.waitForFunction('window.__labReady === true', { timeout: 120000 });
  for (const ppu of ppus) {
    const r = await page.evaluate((p) => window.lab.evaluate(p), ppu);
    if (args.json) { console.log(JSON.stringify(r)); continue; }
    const f = (v) => (v == null ? '  -  ' : v.toFixed(3));
    console.log(`\n== ${ppu} ppu   loss ${r.loss.toFixed(3)}  tone ${r.tone.toFixed(2)}  cells ${r.cellErr.toFixed(2)} plate ${r.plateErr.toFixed(2)} faceShape ${r.faceShapeErr.toFixed(2)} seam ${r.edgeErr.toFixed(1)}  spread ${r.spread.toFixed(2)}  fibre(log) ${r.fibreLoss.toFixed(3)}  skewErr ${r.skewErr.toFixed(2)}  kurtErr ${r.kurtErr.toFixed(2)}  evenErr ${r.evenErr.toFixed(3)}  face tone ${r.faceTone.toFixed(2)} fibre ${r.faceFibre.toFixed(3)}  cord ${r.cordLive.toFixed(1)}/${r.cordRef.toFixed(1)} (mean ${r.cordMeanLive.toFixed(0)}/${r.cordMeanRef.toFixed(0)})`);
    for (const [name, p] of Object.entries(r.patches)) {
      const sh = r.shape?.[name], ev = r.even?.[name];
      console.log(`  ${name.padEnd(10)} energy live/ref  ${p.ref.map((v, i) => `${f(p.live[i])}/${f(v)}`).join('  ')}   skew ${sh ? `${f(sh.live.skew)}/${f(sh.ref.skew)}` : '-'}  kurt ${sh ? `${f(sh.live.kurt)}/${f(sh.ref.kurt)}` : '-'}  even ${ev ? `${f(ev.live)}/${f(ev.ref)}` : '-'}`);
    }
    for (const [name, p] of Object.entries(r.faceShape ?? {})) console.log(`  face ${name.padEnd(9)} skew ${f(p.live.skew)}/${f(p.ref.skew)}  kurt ${f(p.live.kurt)}/${f(p.ref.kurt)}  even ${p.even ? `${f(p.even[0])}/${f(p.even[1])}` : '-'}`);
    if (r.edgeProfile) {
      console.log('  hood/plate seam profile (mean luminance by distance from the plate edge, live / artwork):');
      console.log('     d ' + Array.from({ length: 24 }, (_, b) => (-0.036 + 0.004 * b + 0.002).toFixed(3).padStart(8)).join(''));
      for (const k of Object.keys(r.edgeProfile.live)) console.log(('  ' + k).padEnd(7) + r.edgeProfile.live[k].map((v, b) => `${v == null ? '-' : v.toFixed(0)}/${r.edgeProfile.ref[k][b] == null ? '-' : r.edgeProfile.ref[k][b].toFixed(0)}`.padStart(8)).join(''));
    }
    console.log(`  edge ring luminance (live/ref): ${Object.entries(r.rim ?? {}).map(([k, v]) => `${k} ${v[0].toFixed(0)}/${v[1].toFixed(0)}`).join('  ')}   soft-edge pixels ${r.softLive}/${r.softRef}`);
    console.log(`  luminance percentiles live: ${r.pctLive.map((v) => v.toFixed(0)).join(' ')}\n                        ref : ${r.pctRef.map((v) => v.toFixed(0)).join(' ')}`);
  }
  if (logs.length) console.log(logs.join('\n'));
} finally {
  await browser.close();
}
