// Render the apple-touch-icon (assets/apple-touch-icon.png, 180 x 180) from the real app icon, assets/app-icon.svg.
//   node scripts/dev/render-icons.mjs
// iOS applies its own rounded mask, so the tile is full-bleed: the icon's squircle (it occupies 100..924 of its 1024 box, the rest is
// room for its drop shadow) is scaled to fill the square, over the same ink gradient the squircle is filled with, so its corners do not
// show. The SVG itself is never edited; it is drawn through an <img>, like everywhere else on the page.
import { readFileSync, writeFileSync } from 'node:fs';
import { launch } from './browser.mjs';

const SIZE = 180;
const svg = readFileSync('assets/app-icon.svg');
const scale = 1024 / 824;                              // squircle edge to tile edge
const browser = await launch({ width: SIZE, height: SIZE, dpr: 1 });
try {
  const page = await browser.newPage();
  await page.setViewport({ width: SIZE, height: SIZE, deviceScaleFactor: 1 });
  await page.setContent(`<style>
    html,body{margin:0;width:${SIZE}px;height:${SIZE}px;overflow:hidden;background:linear-gradient(#25262E,#15161B 50%,#0B0C10)}
    img{position:absolute;width:${SIZE * scale}px;height:${SIZE * scale}px;left:${-100 / 1024 * SIZE * scale}px;top:${-100 / 1024 * SIZE * scale}px}
  </style><img src="data:image/svg+xml;base64,${svg.toString('base64')}" alt="">`);
  await page.evaluate(() => document.querySelector('img').decode());
  writeFileSync('assets/apple-touch-icon.png', await page.screenshot({ type: 'png' }));
  console.log('wrote assets/apple-touch-icon.png');
} finally {
  await browser.close();
}
