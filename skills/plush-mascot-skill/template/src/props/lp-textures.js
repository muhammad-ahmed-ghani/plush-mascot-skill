// Procedural textures for the laptop prop, all generated in code: bead-blasted anodised aluminium (tiling normal + roughness), the
// lid back with a very subtle embossed emblem, the deck (keyboard well, speaker grilles, glass trackpad), the keycap legend
// atlas and the small animated screen UI.
import config, { assetPath } from '../config.js';
import * as THREE from 'three';

// ---- bead blast ----------------------------------------------------------------------------------------------------------------
function rng(seed) {
  let s = seed >>> 0;
  return () => { s = (s + 0x6d2b79f5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

/**
 * Height field of a bead-blasted surface: a dense field of tiny, overlapping impact craters (smooth bowls of random size and
 * depth), which is what blasting leaves - isotropic by construction, uniform, never blotchy.  w x h texels, optionally wrapping.
 */
function craterHeight(w, h, { seed = 7, cover = 4, rMin = 1.2, rMax = 2.8, wrap = true } = {}) {
  const f = new Float32Array(w * h).fill(1);
  const rnd = rng(seed);
  const mean = (rMin + rMax) / 2, n = Math.round((cover * w * h) / (Math.PI * mean * mean));
  for (let k = 0; k < n; k++) {
    const cx = rnd() * w, cy = rnd() * h, r = rMin + (rMax - rMin) * rnd(), d = 0.35 + 0.65 * rnd();
    const x0 = Math.floor(cx - r), x1 = Math.ceil(cx + r), y0 = Math.floor(cy - r), y1 = Math.ceil(cy + r);
    for (let y = y0; y <= y1; y++) {
      let yy = y;
      if (wrap) yy = ((y % h) + h) % h; else if (y < 0 || y >= h) continue;
      for (let x = x0; x <= x1; x++) {
        let xx = x;
        if (wrap) xx = ((x % w) + w) % w; else if (x < 0 || x >= w) continue;
        const q = ((x + 0.5 - cx) ** 2 + (y + 0.5 - cy) ** 2) / (r * r);
        if (q < 1) f[yy * w + xx] -= d * (1 - q) * (1 - q) * 0.35;
      }
    }
  }
  let lo = Infinity, hi = -Infinity;
  for (const v of f) { if (v < lo) lo = v; if (v > hi) hi = v; }
  for (let i = 0; i < f.length; i++) f[i] = (f[i] - lo) / (hi - lo || 1);
  return f;
}

const dataTex = (data, w, h, srgb = false) => {
  const t = new THREE.DataTexture(data, w, h, THREE.RGBAFormat, THREE.UnsignedByteType);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearMipmapLinearFilter; t.generateMipmaps = true; t.anisotropy = 8;
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.needsUpdate = true;
  return t;
};

/** Tangent-space normal map (RGBA8) from a height field (w x h, wrapping), plus roughness (G) / metalness (B) with gentle variation. */
function mapsFromHeight(hf, w, h, { strength = 1, roughBase = 0.9, roughVar = 0.1, metal = 1 } = {}) {
  const n = new Uint8Array(w * h * 4), r = new Uint8Array(w * h * 4);
  const at = (x, y) => hf[((y + h) % h) * w + ((x + w) % w)];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const dx = (at(x + 1, y) - at(x - 1, y)) * strength, dy = (at(x, y + 1) - at(x, y - 1)) * strength;
    const inv = 1 / Math.hypot(dx, dy, 1);
    const i = (y * w + x) * 4;
    n[i] = 255 * (0.5 - 0.5 * dx * inv); n[i + 1] = 255 * (0.5 - 0.5 * dy * inv); n[i + 2] = 255 * (0.5 + 0.5 * inv); n[i + 3] = 255;
    const rough = Math.min(1, Math.max(0, roughBase + roughVar * (at(x, y) - 0.5) * 2));
    r[i] = 255; r[i + 1] = 255 * rough; r[i + 2] = 255 * metal; r[i + 3] = 255;
  }
  return { normal: dataTex(n, w, h), rough: dataTex(r, w, h) };
}

/** Tiling bead-blast maps for the unibody (one tile spans 1 / wallUvScale world units). */
export function beadBlastMaps(size = 256) {
  return mapsFromHeight(craterHeight(size, size, { seed: 11, rMin: 1.1, rMax: 2.4 }), size, size, { strength: 0.9, roughBase: 0.95, roughVar: 0.12 });
}

/**
 * The lid back: the same blasted grain plus the embossed emblem (assets/emblem.svg, white on transparent, filling 62 percent of its box: set
 * in mascot.config.json page.emblem), a few tenths of a millimetre high and a touch smoother than the aluminium around it, and a very gentle
 * bow.  Non-tiling, uv 0..1 across the lid (v = 0 at the lid's top edge); w / h follow the lid's aspect so texels are square.  Without an
 * emblem the lid stays plain.
 * @param {number} w  texture width (the height follows `aspect`)
 * @param {number} aspect  lid width / lid height
 * @param {number} markScale  mark height as a fraction of the lid height
 * @param {HTMLImageElement|null} emblem  the loaded emblem (see loadEmblem)
 */
export function lidBackMaps(w = 1024, aspect = 1.5, markScale = 0.13, emblem = null) {
  const h = Math.round(w / aspect);
  const grain = craterHeight(w, h, { seed: 23, rMin: 1.2, rMax: 2.6, wrap: false });
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const g = c.getContext('2d');
  g.fillStyle = '#000'; g.fillRect(0, 0, w, h);
  if (emblem) {                                                       // the emblem fills 62 of its 100 viewBox units, like the mark it replaced
    g.filter = `blur(${Math.max(1, w / 700)}px)`;
    const size = (h * markScale) / 0.62;
    g.drawImage(emblem, w / 2 - size / 2, h * 0.5 - size / 2, size, size);
  }
  const px = g.getImageData(0, 0, w, h).data;
  // (canvas row 0 is the top of the mark and the lid's v = 0 edge is its top edge, so rows map straight through)
  const hh = new Float32Array(w * h), mark = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) { mark[i] = px[i * 4] / 255; hh[i] = grain[i] * 0.5 + mark[i] * 0.8; }
  const maps = mapsFromHeight(hh, w, h, { strength: 0.9, roughBase: 0.95, roughVar: 0.12 });
  // a lid is never optically flat: a very gentle bow (~1.5 degrees at the rim) gives it the soft light falloff of the artwork
  const nd = maps.normal.image.data, bow = 0.026;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = (y * w + x) * 4, bx = ((x + 0.5) / w - 0.5) * 2, by = ((y + 0.5) / h - 0.5) * 2;
    let nx = nd[i] / 127.5 - 1 + bow * bx * Math.abs(bx), ny = nd[i + 1] / 127.5 - 1 + bow * by * Math.abs(by), nz = nd[i + 2] / 127.5 - 1;
    const l = Math.hypot(nx, ny, nz); nx /= l; ny /= l; nz /= l;
    nd[i] = 127.5 * (nx + 1); nd[i + 1] = 127.5 * (ny + 1); nd[i + 2] = 127.5 * (nz + 1);
  }
  maps.normal.needsUpdate = true;
  maps.normal.wrapS = maps.normal.wrapT = maps.rough.wrapS = maps.rough.wrapT = THREE.ClampToEdgeWrapping;
  const rd = maps.rough.image.data;
  for (let i = 0; i < w * h; i++) if (mark[i] > 0.05) rd[i * 4 + 1] = Math.max(0, rd[i * 4 + 1] - 22 * Math.min(1, mark[i] * 1.4));
  maps.rough.needsUpdate = true;
  return maps;
}

// ---- keycap legends ---------------------------------------------------------------------------------------------------------
export const LEGEND_COLS = 16, LEGEND_ROWS = 8;
/** Atlas of key legends (white on transparent); returns the texture and a map label -> cell index (0 = blank). */
export function legendAtlas(labels) {
  const cell = 64, c = document.createElement('canvas');
  c.width = cell * LEGEND_COLS; c.height = cell * LEGEND_ROWS;
  const g = c.getContext('2d');
  g.clearRect(0, 0, c.width, c.height);
  g.fillStyle = '#fff'; g.textAlign = 'center'; g.textBaseline = 'middle';
  const index = new Map([['', 0]]);
  labels.forEach((label, k) => {
    const i = k + 1, x = (i % LEGEND_COLS) * cell + cell / 2, y = Math.floor(i / LEGEND_COLS) * cell + cell / 2;
    const long = label.length > 2;
    g.font = long ? `500 ${label.length > 6 ? 12 : 14}px -apple-system, "Helvetica Neue", Arial, sans-serif` : `500 ${label.length === 1 && /[a-z0-9]/i.test(label) ? 26 : 22}px -apple-system, "Helvetica Neue", Arial, sans-serif`;
    if (long) g.fillText(label, x, y + 15); else g.fillText(label, x, y + 1);       // word legends sit low on the cap like a real keyboard
    index.set(label, i);
  });
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.NoColorSpace;
  t.anisotropy = 8; t.generateMipmaps = true; t.minFilter = THREE.LinearMipmapLinearFilter;
  return { texture: t, index };
}

// ---- deck ---------------------------------------------------------------------------------------------------------------------
/**
 * The deck top (uv 0..1 across W x D, v = 1 at the hinge edge): colour multiplier (sRGB) and roughness (G) / metalness (B).  The
 * keyboard well is near-black plastic, the two speaker grilles are fields of drilled holes, the glass trackpad is a shade darker and
 * smoother than the blasted aluminium, with a hairline gap around it.  Coordinates in laptop units (x the user's right, z toward the
 * user).
 */
export function deckMaps({ W, D, well, pad, grilles, ppu = 420 }) {
  const w = Math.round(W * ppu), h = Math.round(D * ppu);
  const c = document.createElement('canvas'), rc = document.createElement('canvas');
  c.width = rc.width = w; c.height = rc.height = h;
  const g = c.getContext('2d'), rg = rc.getContext('2d');
  const X = (x) => (x / W + 0.5) * w, Z = (z) => (0.5 + z / D) * h;          // canvas row 0 = the hinge edge (flipY puts it at v = 1)
  const S = (u) => u * ppu;
  const rrect = (ctx, x, z, ww, dd, r) => { ctx.beginPath(); ctx.roundRect(X(x) - S(ww) / 2, Z(z) - S(dd) / 2, S(ww), S(dd), S(r)); };
  g.fillStyle = '#ffffff'; g.fillRect(0, 0, w, h);                            // the material colour is the aluminium
  rg.fillStyle = 'rgb(0,240,255)'; rg.fillRect(0, 0, w, h);                  // roughness from the tiling bead-blast map (x0.94), metal
  // keyboard well: near-black plastic, a hairline machined edge where the aluminium meets it
  rrect(g, well.x, well.z, well.w + 0.005, well.d + 0.005, well.r + 0.0025); g.fillStyle = '#d9d9dc'; g.fill();
  rrect(g, well.x, well.z, well.w, well.d, well.r); g.fillStyle = '#26262a'; g.fill();
  rrect(rg, well.x, well.z, well.w, well.d, well.r); rg.fillStyle = 'rgb(0,200,0)'; rg.fill();
  // speaker grilles: staggered fields of drilled holes
  for (const gr of grilles) {
    const pitch = 0.0085, r = S(0.0024);
    let row = 0;
    for (let z = gr.z - gr.d / 2 + pitch / 2; z <= gr.z + gr.d / 2; z += pitch * 0.866, row++) {
      for (let x = gr.x - gr.w / 2 + pitch / 2 + (row % 2) * pitch / 2; x <= gr.x + gr.w / 2 - pitch / 4; x += pitch) {
        g.beginPath(); g.arc(X(x), Z(z), r, 0, Math.PI * 2); g.fillStyle = '#1b1b1f'; g.fill();
        rg.beginPath(); rg.arc(X(x), Z(z), r, 0, Math.PI * 2); rg.fillStyle = 'rgb(0,255,0)'; rg.fill();
      }
    }
  }
  // glass trackpad: hairline gap, then etched glass a shade darker and smoother than the aluminium
  rrect(g, pad.x, pad.z, pad.w + 0.005, pad.d + 0.005, pad.r + 0.0025); g.fillStyle = '#3a3a3f'; g.fill();
  rrect(g, pad.x, pad.z, pad.w, pad.d, pad.r); g.fillStyle = '#b4b4b9'; g.fill();
  rrect(rg, pad.x, pad.z, pad.w, pad.d, pad.r); rg.fillStyle = 'rgb(0,150,30)'; rg.fill();
  const mk = (canvas, srgb) => { const t = new THREE.CanvasTexture(canvas); t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace; t.anisotropy = 8; return t; };
  return { map: mk(c, true), rm: mk(rc, false) };
}

// ---- screen UI --------------------------------------------------------------------------------------------------------------
/**
 * A calm, abstract "agent at work" interface on the display, inside the glass's black bezel (the canvas covers the whole glass).
 * Redrawn at most `fps` times a second, only while the screen is actually drawn facing the camera (see laptop.js).  Deterministic in
 * `time`, with the line being typed advancing a character per keystroke.
 */
export class ScreenUI {
  /** @param {{w:number,h:number}} glass glass size (units)  @param {{l:number,r:number,t:number,b:number}} bezel (units) */
  constructor(glass, bezel, ppu = 300) {
    const c = this.canvas = document.createElement('canvas');
    c.width = Math.round(glass.w * ppu); c.height = Math.round(glass.h * ppu);
    this.area = { x: Math.round(bezel.l * ppu), y: Math.round(bezel.t * ppu), w: Math.round((glass.w - bezel.l - bezel.r) * ppu), h: Math.round((glass.h - bezel.t - bezel.b) * ppu) };
    this.g = c.getContext('2d');
    this.texture = new THREE.CanvasTexture(c);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.anisotropy = 4;
    this.fps = 12;
    this.last = -1;
    this.keys = 0;
    this.draw(0);
  }
  /** Count a keystroke (the typed line grows by one character). */
  keystroke() { this.keys++; }
  /** @param {number} time seconds */
  update(time) {
    if (this.last >= 0 && time >= this.last && time - this.last < 1 / this.fps) return false;
    this.last = time;
    this.draw(time);
    this.texture.needsUpdate = true;
    return true;
  }
  draw(time) {
    const g = this.g, { x, y, w, h } = this.area, u = w / 400;          // layout authored on a 400-wide display
    g.fillStyle = '#050506'; g.fillRect(0, 0, this.canvas.width, this.canvas.height);
    g.save(); g.translate(x, y); g.beginPath(); g.roundRect(0, 0, w, h, 3 * u); g.clip();
    g.scale(u, u);
    const H = h / u;
    const rr = (px, py, pw, ph, r, col) => { g.fillStyle = col; g.beginPath(); g.roundRect(px, py, pw, ph, r); g.fill(); };
    // desktop: a deep blue-grey with a soft vignette
    const bg = g.createLinearGradient(0, 0, 0, H); bg.addColorStop(0, '#1d2029'); bg.addColorStop(1, '#16181f');
    g.fillStyle = bg; g.fillRect(0, 0, 400, H);
    // sidebar with the emblem and a few calm icons (one active, body)
    rr(0, 0, 44, H, 0, '#14161c');
    rr(12, 12, 20, 20, 6, '#f05c63'); rr(17, 19, 10, 7, 3, '#24252b');
    for (let i = 0; i < 4; i++) rr(15, 48 + i * 24, 14, 14, 4, i === 0 ? '#3a3f4f' : '#262a35');
    // title bar: a task pill and a live dot that breathes
    rr(56, 12, 110, 10, 5, '#2b303d'); rr(56, 28, 64, 6, 3, '#232733');
    const live = 0.55 + 0.45 * Math.sin(time * 2.2);
    g.globalAlpha = 0.5 + 0.5 * live; rr(382, 13, 8, 8, 4, '#5fb58a'); g.globalAlpha = 1;
    // document card: finished lines, then the line being typed with a caret
    rr(56, 46, 216, H - 58, 7, '#20242e');
    const lines = [150, 176, 120, 168, 92, 158];
    const n = this.keys % 240, done = Math.floor(n / 40), cur = n % 40;
    for (let i = 0; i < Math.min(done, 4); i++) rr(68, 60 + i * 14, lines[(done - Math.min(done, 4) + i) % 6], 6, 3, '#4a5061');
    const row = Math.min(done, 4), typed = 6 + cur * 4.2;
    rr(68, 60 + row * 14, typed, 6, 3, '#6b7286');
    if (Math.floor(time * 1.6) % 2 === 0) rr(70 + typed, 58 + row * 14, 1.6, 10, 0.8, '#ece8e1');
    rr(68, 60 + 6 * 14, 40, 14, 7, '#f05c63'); rr(114, 60 + 6 * 14, 40, 14, 7, '#2e3341');
    // side cards: progress toward the brief, a quiet sparkline
    rr(282, 46, 108, 56, 7, '#20242e');
    rr(292, 56, 56, 6, 3, '#4a5061');
    const prog = 0.18 + 0.64 * (0.5 - 0.5 * Math.cos(((time % 60) / 60) * Math.PI * 2));
    rr(292, 78, 88, 6, 3, '#2d3240'); rr(292, 78, 88 * prog, 6, 3, '#f05c63');
    rr(282, 110, 108, H - 122, 7, '#20242e');
    g.strokeStyle = '#7c86a2'; g.lineWidth = 1.4; g.beginPath();
    for (let i = 0; i <= 32; i++) { const px = 292 + i * 2.75, py = 110 + (H - 122) * 0.62 - 7 * Math.sin(i * 0.45 + time * 0.6) - 4 * Math.sin(i * 1.3 - time * 0.4); i ? g.lineTo(px, py) : g.moveTo(px, py); }
    g.stroke();
    g.restore();
  }
  dispose() { this.texture.dispose(); }
}

/** Load the laptop lid's emblem (mascot.config.json page.emblem) relative to the assets folder; resolves null when it is missing (the lid stays plain). */
export function loadEmblem(assetsUrl) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = assetsUrl + assetPath(config.page.emblem);
  });
}
