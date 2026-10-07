// Small canvas-painted textures for the face: sclera weave, iris, pupil, catchlight, the wound chest cord.
import * as THREE from 'three';

const seeded = (seed) => () => ((seed = (seed * 16807) % 2147483647) / 2147483647);

function canvasTexture(canvas, { srgb = true, anisotropy = 1 } = {}) {
  const t = new THREE.CanvasTexture(canvas);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = anisotropy;
  return t;
}
function makeCanvas(w, h = w) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return c;
}

/**
 * Sclera: cream felt with the artwork's fine brushed hatch (short strokes leaning to the right, slightly lighter than the ground) and
 * a faint warm tint toward the rim.  u, v = 0.5 + 0.5 * (x / rx, y / ry) of the eye's outline.
 */
export function scleraTexture() {
  const S = 512;
  const c = makeCanvas(S);
  const g = c.getContext('2d');
  g.fillStyle = 'rgb(238,225,209)';
  g.fillRect(0, 0, S, S);
  const rnd = seeded(7);
  g.lineCap = 'round';
  // the hatch lies along one direction with a little scatter, in two weights: fine dark grain and rarer bright strokes
  for (let i = 0; i < 2600; i++) {
    const x = rnd() * S, y = rnd() * S;
    const len = 26 + rnd() * 70;
    const a = (-64 + (rnd() - 0.5) * 22) * Math.PI / 180;
    const bright = rnd() < 0.4;
    g.strokeStyle = bright ? `rgba(255,250,240,${0.05 + rnd() * 0.07})` : `rgba(196,176,156,${0.05 + rnd() * 0.08})`;
    g.lineWidth = 1.1 + rnd() * 1.3;
    for (const [ox, oy] of [[0, 0], [S, 0], [-S, 0], [0, S], [0, -S]]) {      // wrap so the tile repeats seamlessly
      g.beginPath();
      g.moveTo(x + ox, y + oy);
      g.lineTo(x + ox + Math.cos(a) * len, y + oy - Math.sin(a) * len);
      g.stroke();
    }
  }
  return canvasTexture(c, { anisotropy: 4 });
}

/**
 * Iris: dark chocolate felt, a touch warmer half-way out, fine radial streaks (the artwork's iris has exactly this), and a black outline.
 * On the side facing the window (the lower left) the outline is edged with a hairline of copper - the felt appliqué's cut edge, as the
 * artwork shows it.  u,v = 0.5 + 0.5 * (x, y) of the unit disc.
 */
export const IRIS_PLANE = 1.0;
export function irisTexture() {
  const S = 512;
  const c = makeCanvas(S);
  const g = c.getContext('2d');
  const img = g.createImageData(S, S);
  const rnd = seeded(41);
  const streak = new Float32Array(720);
  for (let a = 0; a < 720; a++) streak[a] = 0.5 + 0.5 * Math.sin(a * 0.37 + rnd() * 6) * Math.sin(a * 0.11 + rnd() * 6);
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const dx = (x + 0.5) / S * 2 - 1, dy = 1 - (y + 0.5) / S * 2;
      const rt = Math.hypot(dx, dy), r = rt * IRIS_PLANE;              // r = 1 is the iris ellipse itself
      const angle = Math.atan2(dy, dx);
      const deg = ((angle * 180 / Math.PI) + 360) % 360;
      const warm = Math.sin(Math.min(1, r * 1.1) * Math.PI * 0.9);
      let R = 30 + 19 * warm, G = 19 + 10 * warm, B = 14 + 6 * warm;
      const lidShade = 0.82 + 0.18 * Math.min(1, Math.max(0, 0.5 + 0.5 * dy + 0.15));         // the upper lid darkens the top of the iris
      const k = (0.8 + 0.4 * streak[Math.floor(deg * 2) % 720] * Math.min(1, r * 1.7)) * lidShade;
      R *= k; G *= k; B *= k;
      if (r >= 0.9) { const t = Math.min(1, (r - 0.9) / 0.03); R = R * (1 - t) + 5 * t; G = G * (1 - t) + 4 * t; B = B * (1 - t) + 3 * t; }      // black outline
      if (r >= 0.955) {
        // the cut edge: a copper hairline toward the lower left
        const facing = Math.max(0, -0.62 * dx / Math.max(rt, 1e-3) - 0.78 * dy / Math.max(rt, 1e-3));
        const cu = Math.pow(facing, 1.2) * Math.min(1, (r - 0.955) / 0.02);
        R = R * (1 - cu) + 185 * cu; G = G * (1 - cu) + 126 * cu; B = B * (1 - cu) + 96 * cu;
      }
      const o = (y * S + x) * 4;
      img.data[o] = R; img.data[o + 1] = G; img.data[o + 2] = B; img.data[o + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  return canvasTexture(c, { anisotropy: 4 });
}

/** Pupil: a dark felt disc whose edge is slightly soft (the artwork's pupil has no razor edge). */
export function pupilTexture() {
  const S = 128;
  const c = makeCanvas(S);
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  grad.addColorStop(0, 'rgba(14,9,7,1)');
  grad.addColorStop(0.84, 'rgba(14,9,7,1)');
  grad.addColorStop(0.94, 'rgba(14,9,7,0.5)');
  grad.addColorStop(1, 'rgba(14,9,7,0)');
  g.fillStyle = grad; g.fillRect(0, 0, S, S);
  return canvasTexture(c);
}

/**
 * The catchlight: a small light-grey felt disc with a fine near-black outline and a soft shadow ring outside it - a raised button, not a
 * glowing highlight.  The disc fills the inner 0.78 of the plane's half size; the outline sits at 0.80-0.92.
 */
export function glintTexture() {
  const S = 128;
  const c = makeCanvas(S);
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  grad.addColorStop(0, 'rgba(194,184,174,1)');
  grad.addColorStop(0.76, 'rgba(190,180,170,1)');
  grad.addColorStop(0.79, 'rgba(160,150,140,1)');
  grad.addColorStop(0.805, 'rgba(14,9,7,1)');
  grad.addColorStop(0.92, 'rgba(10,6,5,0.97)');
  grad.addColorStop(0.97, 'rgba(8,5,4,0.4)');
  grad.addColorStop(1, 'rgba(8,5,4,0)');
  g.fillStyle = grad; g.fillRect(0, 0, S, S);
  return canvasTexture(c);
}

/**
 * A wound cord: fine ridges running ACROSS the bar (v runs along the capsule).  The artwork's X has about 31 wraps per bar (measured: 2.9 px
 * pitch over a ~90 px cord).  Returns matching bump + colour maps so the wraps read through albedo (dark groove / bright crest) as well as
 * shading - bump alone averages out to a faint hatch at display size.
 */
export const THREAD_WRAPS = 31;
export function threadMaps(amp = 0.900) {
  const W = 16, H = 512, WRAPS = THREAD_WRAPS;
  const wander = new Float32Array(H);
  { const rnd = seeded(5); const r2 = () => (rnd() - 0.5) * 2; let a = 0, b = 0;
    for (let i = 0; i < H; i++) { a += (r2() - a) * 0.08; b += (r2() - b) * 0.3; wander[i] = 0.75 * a + 0.5 * b; } }
  const paint = (canvas, fill) => {
    const g = canvas.getContext('2d');
    const img = g.createImageData(W, H);
    for (let y = 0; y < H; y++) {
      // hand-wound cord: the pitch wanders a little and some wraps sit tighter or lie flatter than others
      const u = y / H;
      const ph = (u + 0.022 * wander[y] + 0.010 * wander[(y * 3) % H]) * Math.PI * 2 * WRAPS;
      const ridge = Math.pow(0.5 + 0.5 * Math.cos(ph), 0.75);
      const local = 0.3 + 1.5 * Math.abs(wander[(y * 7 + 91) % H]);                  // 0.3 .. 1.8 wrap-to-wrap contrast
      const rgb = fill(Math.min(1, Math.max(0, 0.5 + (ridge - 0.5) * amp * local)));  // amp < 1 flattens the wraps toward their mean
      for (let x = 0; x < W; x++) { const o = (y * W + x) * 4; img.data[o] = rgb[0]; img.data[o + 1] = rgb[1]; img.data[o + 2] = rgb[2]; img.data[o + 3] = 255; }
    }
    g.putImageData(img, 0, 0);
  };
  const bumpFill = (r) => { const v = 50 + 170 * r; return [v, v, v]; };
  const mapFill = (r) => [231 + 24 * r, 56 + 44 * r, 42 + 48 * r];        // the body's own red: a shade deeper in the groove, lighter on the crest
  const mk = (fill, srgb) => {
    const c = makeCanvas(W, H);
    paint(c, fill);
    const t = new THREE.CanvasTexture(c);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.anisotropy = 16;
    if (srgb) t.colorSpace = THREE.SRGBColorSpace;
    return t;
  };
  const bump = mk(bumpFill, false), map = mk(mapFill, true);
  return {
    bump, map,
    /** Repaint both maps with a new wrap amplitude (1 = the full groove-to-crest range). */
    setAmp(v) { amp = v; paint(bump.image, bumpFill); paint(map.image, mapFill); bump.needsUpdate = map.needsUpdate = true; },
    getAmp() { return amp; },
  };
}
