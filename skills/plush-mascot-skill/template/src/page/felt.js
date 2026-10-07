// The cut-felt pieces of the backdrop, the pinked swatches, the stars of the last scene and the little DOM helpers that make words and
// buttons feel sewn: hand-cut shapes (a wandering edge, a running stitch inside it, a hard offset shadow, a layer of nap) built as SVG in
// real pixels, so stitches and fibres keep their size whatever the piece is scaled to.  The colours that belong to the character come from
// mascot.config.json (src/page/palette.js); the other felt tints are the page's own.

import { PALETTE, PAGE_COLORS, rgb } from './palette.js';
import { luminance, contrast } from './color.js';

const NS = 'http://www.w3.org/2000/svg';
const INK = PALETTE.ink, CREAM = PAGE_COLORS.lightInk;
const n1 = (v) => Math.round(v * 10) / 10;

export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A closed, smooth curve through the points (Catmull-Rom, written as cubic Béziers). */
export function smoothClosed(pts) {
  const n = pts.length;
  let d = `M${n1(pts[0][0])} ${n1(pts[0][1])}`;
  for (let i = 0; i < n; i++) {
    const p0 = pts[(i - 1 + n) % n], p1 = pts[i], p2 = pts[(i + 1) % n], p3 = pts[(i + 2) % n];
    d += `C${n1(p1[0] + (p2[0] - p0[0]) / 6)} ${n1(p1[1] + (p2[1] - p0[1]) / 6)} ${n1(p2[0] - (p3[0] - p1[0]) / 6)} ${n1(p2[1] - (p3[1] - p1[1]) / 6)} ${n1(p2[0])} ${n1(p2[1])}`;
  }
  return `${d}Z`;
}

/** The outline of a hand-cut piece: a superellipse whose edge wanders a little, like scissors do. */
export function cutShape(seed, { rx, ry, p = 2, n = 12, wobble = 0.07 }) {
  const rand = rng(seed);
  const a1 = rand() * 6.28, a2 = rand() * 6.28, f1 = 2 + Math.floor(rand() * 2), f2 = 3 + Math.floor(rand() * 3), k = 2 / p;
  const pts = [];
  for (let i = 0; i < n; i++) {
    const t = (i / n) * Math.PI * 2, c = Math.cos(t), s = Math.sin(t);
    const w = 1 + wobble * (0.6 * Math.sin(f1 * t + a1) + 0.4 * Math.sin(f2 * t + a2)) + wobble * 0.45 * (rand() * 2 - 1);
    pts.push([Math.sign(c) * Math.abs(c) ** k * rx * w, Math.sign(s) * Math.abs(s) ** k * ry * w]);
  }
  return pts;
}

/** A felt piece as SVG markup: shadow, colour, nap, running stitch.  `w` x `h` are the piece's size in pixels. */
export function feltSvg({ seed, w, h, p = 2.2, n = 12, wobble = 0.07, color, stitch = rgb(CREAM, 0.75), inset = 0.9, stitched = true }) {
  const rx = w / 2, ry = h / 2, pts = cutShape(seed, { rx: rx * 0.94, ry: ry * 0.94, p, n, wobble });
  const d = smoothClosed(pts), shade = Math.max(2, Math.min(w, h) * 0.022);
  const inner = stitched ? `<path class="felt-stitch" d="${smoothClosed(pts.map(([x, y]) => [x * inset, y * inset]))}" style="--st:${stitch}"/>` : '';
  return `<svg viewBox="${-rx} ${-ry} ${w} ${h}" width="${n1(w)}" height="${n1(h)}" aria-hidden="true" focusable="false"><path class="felt-shade" d="${d}" transform="translate(${n1(shade)} ${n1(shade * 1.5)})"/><path class="felt" d="${d}" style="--c:${color}"/><path class="felt-nap" d="${d}"/>${inner}</svg>`;
}

/** A sewn-on felt button: a round of felt with a raised rim, four holes and a cross of thread through them (the page's cross-stitch again). */
export function buttonSvg({ seed, d, color, thread = rgb(CREAM, 0.92) }) {
  const base = feltSvg({ seed, w: d, h: d, p: 2, n: 10, wobble: 0.018, color, stitched: false });
  const o = d * 0.105, r = d * 0.036, sw = Math.max(2.4, d * 0.034), rim = d * 0.33;
  const holes = [[-o, -o], [o, -o], [-o, o], [o, o]].map(([x, y]) => `<circle cx="${n1(x)}" cy="${n1(y)}" r="${n1(r)}" fill="rgb(20 10 8 / 0.6)"/>`).join('');
  const cross = `<path d="M${n1(-o)} ${n1(-o)}L${n1(o)} ${n1(o)}M${n1(o)} ${n1(-o)}L${n1(-o)} ${n1(o)}" fill="none" stroke="${thread}" stroke-width="${n1(sw)}" stroke-linecap="round"/>`;
  return base.replace('</svg>', `<circle r="${n1(rim)}" fill="none" stroke="rgb(20 10 8 / 0.2)" stroke-width="${n1(Math.max(1.6, d * 0.022))}"/><circle r="${n1(rim - d * 0.03)}" fill="none" stroke="rgb(255 255 255 / 0.22)" stroke-width="1.4"/>${holes}${cross}</svg>`);
}

/** A swatch cut with pinking shears: zigzag edge all the way round, a stitched line inside. */
export function swatchSvg({ seed, w, h, color, stitch }) {
  const rand = rng(seed), tooth = 9, amp = 4.2, pts = [];
  const edge = (x0, y0, x1, y1, nx, ny) => {
    const len = Math.hypot(x1 - x0, y1 - y0), steps = Math.max(2, Math.round(len / tooth));
    for (let i = 0; i < steps; i++) {
      const t = i / steps, out = i % 2 === 0 ? 0 : amp + (rand() - 0.5) * 0.8;
      pts.push([x0 + (x1 - x0) * t + nx * out, y0 + (y1 - y0) * t + ny * out]);
    }
  };
  edge(0, 0, w, 0, 0, 1); edge(w, 0, w, h, -1, 0); edge(w, h, 0, h, 0, -1); edge(0, h, 0, 0, 1, 0);
  const d = `M${pts.map(([x, y]) => `${n1(x)} ${n1(y)}`).join('L')}Z`;
  const m = 11;
  return `<svg viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" aria-hidden="true" focusable="false"><path class="felt-shade" d="${d}" transform="translate(3 5)"/><path class="felt" d="${d}" style="--c:${color}"/><path class="felt-nap" d="${d}"/><rect class="felt-stitch" x="${m}" y="${m}" width="${w - 2 * m}" height="${h - 2 * m}" rx="6" style="--st:${stitch}"/></svg>`;
}

// ---- the backdrop pieces -------------------------------------------------------------------------------------------------------
// mascot, face and accent are the character's colours (palette.body, .face, .accent) and cream the page's light ink (page.colors.lightInk);
// ink, oat, blush, butter, sand, plum and peach are felt tints of the page (a lighter ink and a darker oat than the palette's).
export const FELT = { mascot: PALETTE.body, face: PALETTE.face, ink: '#2a2b33', cream: CREAM, oat: '#e8dcc4', blush: '#f2b7a7', butter: '#efc765', sand: '#d9c59f', accent: PALETTE.accent, plum: '#2b2031', peach: '#f7c3ad' };
const LIGHT_STITCH = rgb(CREAM, 0.8), DARK_STITCH = rgb(INK, 0.42);
const LIGHT_STITCH_BELOW = 0.4;            // felt darker than this (relative luminance) is sewn with light thread: the body colour and the darks

// s: the scene it belongs to; x, y: where its centre sits (% of the viewport) when that scene is fully on stage; size: long side in vmin;
// ar: width / height; r: tilt (degrees); k: parallax (1 would travel exactly with the page); at: where in the scene's scroll it sits (0..1).
// `wide` and `stacked` restrict a piece to one layout.
export const PIECES = [
  // hello
  { s: 0, c: 'mascot', x: 4, y: 96, size: 46, ar: 1.1, r: 18, k: 0.3, seed: 3, p: 2.6 },
  { s: 0, c: 'face', x: 99, y: 6, size: 30, ar: 0.7, r: -26, k: 0.55, seed: 5, p: 3.4, calm: true },
  { s: 0, c: 'butter', x: 42, y: 106, size: 26, ar: 1.7, r: -7, k: 0.42, seed: 11, p: 2.4, wide: true },
  // listening
  { s: 1, c: 'cream', x: 92, y: 12, size: 40, ar: 1, r: -14, k: 0.3, seed: 21, p: 2.4 },
  { s: 1, c: 'mascot', x: 60, y: 104, size: 32, ar: 1.5, r: 9, k: 0.5, seed: 22, p: 3 },
  { s: 1, c: 'face', x: 2, y: 62, size: 20, ar: 1, r: 12, k: 0.6, seed: 23, p: 2.2, wide: true },
  // thinking
  { s: 2, c: 'blush', x: 5, y: 92, size: 44, ar: 1.2, r: -10, k: 0.3, seed: 31, p: 2.5 },
  { s: 2, c: 'cream', x: 98, y: 6, size: 30, ar: 1.3, r: 20, k: 0.5, seed: 32, p: 2.3 },
  { s: 2, c: 'face', x: 92, y: 100, size: 18, ar: 1.8, r: -18, k: 0.6, seed: 33, p: 3.2 },
  // a trail of sewn buttons climbing out of the mascot's head: the thought bubble
  { s: 2, c: 'cream', x: 60.5, y: 27, size: 2.6, ar: 1, r: 10, k: 0.5, seed: 91, button: true, thread: rgb(PALETTE.body), wide: true },
  { s: 2, c: 'butter', x: 56, y: 18, size: 4.4, ar: 1, r: -14, k: 0.55, seed: 92, button: true, thread: rgb(PALETTE.face, 0.8), wide: true },
  { s: 2, c: 'mascot', x: 50.5, y: 8, size: 7, ar: 1, r: 18, k: 0.6, seed: 93, button: true, wide: true },
  // working
  { s: 3, c: 'ink', x: 96, y: 10, size: 44, ar: 1.2, r: 14, k: 0.3, seed: 41, p: 2.6, stitch: rgb(CREAM, 0.4) },
  { s: 3, c: 'plum', x: 6, y: 100, size: 38, ar: 1.4, r: -8, k: 0.45, seed: 42, p: 2.4, stitch: rgb(CREAM, 0.4) },
  { s: 3, c: 'accent', x: 94, y: 96, size: 10, ar: 1, r: 30, k: 0.7, seed: 43, p: 2.8 },
  // approval
  { s: 4, c: 'butter', x: 96, y: 92, size: 40, ar: 1.3, r: 12, k: 0.3, seed: 51, p: 2.5 },
  { s: 4, c: 'mascot', x: 3, y: 66, size: 26, ar: 0.8, r: -30, k: 0.55, seed: 52, p: 3.4 },
  { s: 4, c: 'face', x: 50, y: 108, size: 22, ar: 2, r: 4, k: 0.4, seed: 53, p: 2.4, wide: true },
  // done
  { s: 5, c: 'mascot', x: 6, y: 92, size: 34, ar: 1.2, r: 20, k: 0.3, seed: 61, p: 2.6 },
  { s: 5, c: 'cream', x: 97, y: 12, size: 28, ar: 1, r: -12, k: 0.5, seed: 62, p: 2.3 },
  { s: 5, c: 'accent', x: 54, y: 8, size: 9, ar: 1, r: 14, k: 0.8, seed: 63, p: 2.6 },
  { s: 5, c: 'face', x: 92, y: 98, size: 14, ar: 1.6, r: 8, k: 0.65, seed: 64, p: 3 },
  { s: 5, c: 'cream', x: 41, y: 13, size: 7, ar: 1, r: -12, k: 0.5, seed: 65, button: true, thread: rgb(PALETTE.body) },
  { s: 5, c: 'mascot', x: 93, y: 82, size: 5.5, ar: 1, r: 20, k: 0.7, seed: 66, button: true },
  // look closer
  { s: 6, c: 'face', x: 99, y: 12, size: 26, ar: 0.8, r: -20, k: 0.3, seed: 71, p: 3, at: 0.06 },
  { s: 6, c: 'blush', x: 3, y: 90, size: 30, ar: 1.3, r: -10, k: 0.4, seed: 72, p: 2.5, at: 0.3 },
  { s: 6, c: 'butter', x: 98, y: 88, size: 26, ar: 1.2, r: 16, k: 0.45, seed: 73, p: 2.6, at: 0.52 },
  // goodnight
  { s: 7, c: 'plum', x: 8, y: 96, size: 44, ar: 1.3, r: 14, k: 0.3, seed: 81, p: 2.5, stitch: rgb(CREAM, 0.35) },
  { s: 7, c: 'ink', x: 60, y: 3, size: 34, ar: 1.6, r: -6, k: 0.5, seed: 82, p: 2.4, stitch: rgb(CREAM, 0.35) },
  { s: 7, c: 'mascot', x: 99, y: 100, size: 14, ar: 1.2, r: -20, k: 0.7, seed: 83, p: 2.8 },
];

/** (Re)build the pieces for a viewport: returns [{ el, cfg, w, h }] with their SVG inside; the story moves them. */
export function buildPieces(container, vw, vh, stacked, previous = []) {
  previous.forEach((p) => p.el.remove());
  const vmin = Math.min(vw, vh) / 100, out = [];
  for (const cfg of PIECES) {
    if ((cfg.wide && stacked) || (cfg.stacked && !stacked)) continue;
    const long = cfg.size * vmin * (stacked ? 1.15 : 1), w = cfg.ar >= 1 ? long : long * cfg.ar, h = cfg.ar >= 1 ? long / cfg.ar : long;
    const color = FELT[cfg.c] ?? cfg.c, light = luminance(color) < LIGHT_STITCH_BELOW;
    const el = document.createElement('div');
    el.className = 'piece';
    el.innerHTML = cfg.button ? buttonSvg({ seed: cfg.seed, d: w, color, thread: cfg.thread }) : feltSvg({ seed: cfg.seed, w, h, p: cfg.p, color, stitch: cfg.stitch ?? (light ? LIGHT_STITCH : DARK_STITCH) });
    container.append(el);
    // on a tall screen the words take the lower half, so the felt goes up (and to the right, away from the brand)
    let xPct = cfg.x, yPct = cfg.y;
    if (stacked && yPct > 55) { yPct = 100 - yPct; xPct = 100 - xPct; }
    if (xPct < 38 && yPct < 24) xPct = 100 - xPct;
    out.push({ el, cfg, w, h, x: (xPct / 100) * vw, y: (yPct / 100) * vh, shown: true, alpha: 1 });
  }
  return out;
}

/** The disc that sits behind the mascot: a big round of felt in the scene's lighter tone (its colour is the --disc variable). */
export function buildDisc(el, d) {
  const rx = d / 2;
  el.style.width = el.style.height = `${d}px`;
  el.style.marginLeft = el.style.marginTop = `${-rx}px`;
  const pts = cutShape(7, { rx: rx * 0.95, ry: rx * 0.95, p: 2, n: 14, wobble: 0.028 });
  const path = smoothClosed(pts), inner = smoothClosed(pts.map(([x, y]) => [x * 0.93, y * 0.93]));
  el.innerHTML = `<svg viewBox="${-rx} ${-rx} ${d} ${d}" width="${d}" height="${d}" aria-hidden="true" focusable="false"><path d="${path}" transform="translate(${n1(d * 0.008)} ${n1(d * 0.014)})" fill="rgb(32 14 8 / 0.09)"/><path d="${path}" fill="var(--disc)"/><path d="${path}" fill="url(#nap)" opacity="0.2"/><path d="${inner}" fill="none" stroke="var(--disc-stitch, ${rgb(INK, 0.14)})" stroke-width="2.2" stroke-linecap="round" stroke-dasharray="9 9"/></svg>`;
}

/** The night sky of the last scene: a scatter of tiny stitched crosses. */
export function buildStars(container, count = 28) {
  container.textContent = '';
  const rand = rng(99);
  for (let i = 0; i < count; i++) {
    const svg = document.createElementNS(NS, 'svg'), use = document.createElementNS(NS, 'use');
    use.setAttribute('href', '#x-stitch');
    svg.append(use);
    const size = 10 + rand() * 16;
    Object.assign(svg.style, { left: `${rand() * 100}%`, top: `${rand() * 62}%`, width: `${size}px`, height: `${size}px`, opacity: String(0.35 + rand() * 0.6), transform: `rotate(${Math.round(rand() * 90 - 45)}deg)` });
    svg.setAttribute('aria-hidden', 'true');
    container.append(svg);
  }
}

/**
 * Fill the four colour swatches with pinked felt.  Each swatch's colour is its --c (a palette token, see style.css); its words take the ink
 * that reads best on it, and only a really dark swatch gets a light stitch.
 */
export function buildSwatches(root = document) {
  for (const el of root.querySelectorAll('.swatch')) {
    el.querySelector(':scope > svg')?.remove();
    const w = el.offsetWidth, h = el.offsetHeight;
    if (!w || !h) continue;
    const cs = getComputedStyle(el), c = cs.getPropertyValue('--c').trim().toLowerCase();
    if (!/^#[0-9a-f]{6}$/.test(c)) continue;
    const dark = luminance(c) < 0.1;
    el.style.setProperty('--label', contrast(c, INK) >= contrast(c, CREAM) ? INK : CREAM);
    el.insertAdjacentHTML('afterbegin', swatchSvg({ seed: c.length * 7 + w, w, h, color: c, stitch: dark ? rgb(CREAM, 0.6) : rgb(INK, 0.4) }));
  }
}
