// Scroll through the whole page in small steps and, at every stop, measure (1) the contrast of every piece of text that is actually on screen
// against the colour of the room at that moment (so mid cross-fade counts), and (2) whether any of the words sit on top of Mascot.
//   node scripts/dev/contrast.mjs [--width 1440] [--height 900] [--step 140] [--wait 130]      (MASCOT_ORIGIN=... for another origin)
// Text that is half way through fading in or out (effective opacity 0.5 to 0.85) only has to be no worse than 2.2:1, because it is on its way
// (and below 0.5 it is a ghost); anything a person could be reading (0.85 or more) must reach 4.5:1 (3:1 for large text: 24 px, or 18.66 px bold).
// Exits 1 on any failure.
import { launch, watchErrors, ORIGIN } from './browser.mjs';

const args = Object.fromEntries(process.argv.slice(2).reduce((a, v, i, all) => (v.startsWith('--') ? [...a, [v.slice(2), all[i + 1] ?? true]] : a), []));
const width = +(args.width ?? 1440), height = +(args.height ?? 900), step = +(args.step ?? 140), wait = +(args.wait ?? 130);
const mobile = width < 600;

const browser = await launch({ width, height, dpr: 1 });
try {
  const page = await browser.newPage();
  if (mobile) await page.emulate({ viewport: { width, height, deviceScaleFactor: 2, isMobile: true, hasTouch: true }, userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1' });
  const logs = watchErrors(page);
  await page.goto(`${ORIGIN}/`, { waitUntil: 'networkidle2', timeout: 120000 });
  await page.waitForFunction('window.mascot && window.mascot.loaded', { timeout: 120000 });
  await new Promise((r) => setTimeout(r, 1500));
  const total = await page.evaluate(() => document.documentElement.scrollHeight - innerHeight);

  const sample = () => page.evaluate(() => {
    const lum = ([r, g, b]) => { const f = (c) => { c /= 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
    const ratio = (a, b) => { const la = lum(a), lb = lum(b); return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05); };
    const parse = (s) => { const m = s.match(/[\d.]+/g).map(Number); return { rgb: m.slice(0, 3), a: m.length > 3 ? m[3] : 1 }; };
    const root = getComputedStyle(document.documentElement);
    const hex = (name) => { const v = root.getPropertyValue(name).trim(); const n = parseInt(v.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
    const bg = hex('--bg'), disc = hex('--disc');
    const sel = '.scene__text h1, .scene__text h2, .scene__text p, .scene__text button, .note span, .scribble, .decision__result, .swatch b, .swatch i, .print figcaption, .foot p, .foot a, .bar .btn, .bar .tag, .brand__word, .night__note';
    const out = [];
    const W = innerWidth, H = innerHeight;
    // Mascot's body on the stage, from the controller's own view (x, y, zoom); on a tall screen the part of him under the frame's sheet is hidden
    const tall = matchMedia('(max-aspect-ratio: 23/20), (max-width: 719px)').matches;
    const mascotBox = (() => {
      const v = window.mascot.view, ppu = v.zoom * Math.min(H / 4.4, W / 3.5), size = ppu * (1254 / 350), feetY = H / 2 + 1.75 * ppu - v.y * H, left = W / 2 + v.x * W - size * (627.5 / 1254), top = feetY - size * (1204 / 1254);
      return { l: left + size * 0.22, r: left + size * 0.78, t: top + size * 0.04, b: top + size * 0.97 };
    })();
    const shown = (el) => {
      if (!tall) return mascotBox;
      const f = el.closest('.scene__frame'), sheet = f ? parseFloat(getComputedStyle(f).getPropertyValue('--sheet')) : NaN;
      if (Number.isNaN(sheet) || !(sheet > 0) || +getComputedStyle(f, '::after').opacity < 0.5) return mascotBox;
      return { ...mascotBox, b: Math.min(mascotBox.b, f.getBoundingClientRect().bottom - sheet) };
    };
    for (const el of document.querySelectorAll(sel)) {
      const r = el.getBoundingClientRect();
      if (r.width < 2 || r.height < 2 || r.bottom < 0 || r.top > H || r.right < 0 || r.left > W) continue;
      const cs = getComputedStyle(el);
      if (cs.visibility === 'hidden' || cs.display === 'none') continue;
      let alpha = 1;
      for (let n = el; n && n !== document.documentElement; n = n.parentElement) alpha *= +getComputedStyle(n).opacity;
      if (alpha < 0.03) continue;
      const c = parse(cs.color), fgA = c.a * alpha;
      // what is behind: the room, or (for the bar and the tags) their own fill
      let back = bg;
      const own = el.closest('.btn, .tag, .brand');
      if (own) { const bgc = parse(getComputedStyle(own).backgroundColor); if (bgc.a > 0.9) back = bgc.rgb; }
      if (el.closest('.btn--patch')) back = [36, 37, 43];
      const sw = el.closest('.swatch');
      if (sw) { const n = parseInt(getComputedStyle(sw).getPropertyValue('--c').trim().slice(1), 16); back = [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }
      const backs = own || sw || el.closest('.btn--patch') ? [back] : [back, disc];         // (words may sit over the lighter disc too)
      const eff = c.rgb.map((v, i) => v * fgA + back[i] * (1 - fgA));
      const worst = Math.min(...backs.map((b) => ratio(c.rgb.map((v, i) => v * fgA + b[i] * (1 - fgA)), b)));
      const size = parseFloat(cs.fontSize), bold = +cs.fontWeight >= 700;
      const large = size >= 24 || (size >= 18.66 && bold);
      // do the words sit on Mascot?
      const box = shown(el), onMascot = alpha > 0.5 && r.left < box.r && r.right > box.l && r.top < box.b && r.bottom > box.t && !el.closest('.bar, .tag, .brand');
      out.push({ cls: (el.className && el.className.baseVal === undefined ? el.className : el.tagName).toString().slice(0, 28), text: el.textContent.trim().slice(0, 26), ratio: +worst.toFixed(2), alpha: +alpha.toFixed(2), large, onMascot, scene: document.documentElement.dataset.scene });
    }
    return { y: Math.round(scrollY), bg: root.getPropertyValue('--bg').trim(), out };
  });

  const failures = [], overlaps = [];
  let stops = 0, checked = 0, minSettled = 99, fading = 0;
  for (let y = 0; y <= total + step; y += step) {
    await page.evaluate((y) => scrollTo({ top: Math.min(y, document.documentElement.scrollHeight), behavior: 'instant' }), y);
    await new Promise((r) => setTimeout(r, wait));
    const s = await sample();
    stops++;
    for (const e of s.out) {
      checked++;
      const settled = e.alpha >= 0.85, need = settled ? (e.large ? 3 : 4.5) : 2.2;      // (text that is half way through fading in or out only has to be no worse than a faint ghost)
      if (!settled) fading++;
      else minSettled = Math.min(minSettled, e.ratio / (e.large ? 3 / 4.5 : 1));
      if (e.ratio < need && e.alpha >= 0.5) failures.push(`${s.y}px ${e.scene} "${e.text}" (${e.cls}) ${e.ratio}:1 < ${need}:1 at opacity ${e.alpha}, room ${s.bg}`);
      if (e.onMascot) overlaps.push(`${s.y}px ${e.scene} "${e.text}" (${e.cls}) overlaps Mascot`);
    }
  }
  console.log(`${width}x${height}: ${stops} stops, ${checked} text samples (${fading} still fading), lowest settled ratio ${minSettled.toFixed(2)}:1 (normalised to 4.5)`);
  const show = (title, list) => { console.log(`${list.length ? 'FAIL' : 'PASS'}  ${title}${list.length ? ` (${list.length})` : ''}`); [...new Set(list)].slice(0, 12).forEach((l) => console.log('   ', l)); };
  show('contrast at every stop, mid-transition included', failures);
  show('words never sit on Mascot', overlaps);
  if (logs.length) console.log(logs.join('\n'));
  process.exitCode = failures.length || overlaps.length ? 1 : 0;
} finally {
  await browser.close();
}
