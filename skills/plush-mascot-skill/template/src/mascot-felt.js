// Procedural needle-felt / micro-bouclé fabric maps for the mascot: the fallback when the nap tiles extracted from the art are missing.
//
// Reference study (the example's neutral artwork at 4x): the pile is a web of
// thin, short, curly hook-shaped fibres (about 1 px wide and 4-9 px long at the
// artwork's native scale) lying over soft dark mottling.  This generator draws
// exactly that into a tileable RGBA map, dependency-free so it runs in the
// browser and in Node for offline tuning.
//
//   R = tangent-space normal x   G = tangent-space normal y
//   B = fibre height (0..1)       A = soft mottling (0..1)
//
// World size of one tile is `FELT_TILE` units; the shader maps it triplanarly.

export const FELT_TILE = 0.5;

function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function gauss(rand) {
  return Math.sqrt(-2 * Math.log(rand() + 1e-9)) * Math.cos(2 * Math.PI * rand());
}

/** Tileable value noise (bilinear on a wrapped lattice), 0..1. */
function makeNoise(cells, rand) {
  const lattice = new Float32Array(cells * cells);
  for (let i = 0; i < lattice.length; i++) lattice[i] = rand();
  return (u, v) => {
    const x = u * cells, y = v * cells;
    const x0 = Math.floor(x), y0 = Math.floor(y);
    const fx = x - x0, fy = y - y0;
    const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
    const at = (i, j) => lattice[(((j % cells) + cells) % cells) * cells + (((i % cells) + cells) % cells)];
    const a = at(x0, y0), b = at(x0 + 1, y0), c = at(x0, y0 + 1), d = at(x0 + 1, y0 + 1);
    return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
  };
}

const DEFAULTS = {
  size: 1024,
  seed: 7341,
  strokes: 900,           // hook fibres per tile
  width: 3.0,             // fibre half-width in texels
  lengthMin: 22, lengthMax: 56,   // texels
  curl: 2.6,              // typical total turning angle (radians) along a fibre
  heightScale: 1.0,
  mottle: 0.55,           // strength of the soft dark mottling
  normalStrength: 3.4,
};

/**
 * Returns { size, data (Uint8Array RGBA) }.  All work is on typed arrays.
 */
export function generateFeltMaps(options = {}) {
  const o = { ...DEFAULTS, ...options };
  const N = o.size;
  const rand = mulberry32(o.seed);
  const height = new Float32Array(N * N);

  // ---- fibres: thin curling hooks, composed with max() so they overlap cleanly
  const px = new Float32Array(16), py = new Float32Array(16);
  for (let s = 0; s < o.strokes; s++) {
    const x0 = rand() * N, y0 = rand() * N;
    const len = o.lengthMin + (o.lengthMax - o.lengthMin) * Math.pow(rand(), 1.3);
    const segs = 9;
    let theta = rand() * Math.PI * 2;
    // hooks: mostly one-directional curl with a little wobble
    const turn = gauss(rand) * o.curl * 0.55 + Math.sign(rand() - 0.5) * o.curl * 0.55;
    const step = len / segs;
    let x = x0, y = y0;
    px[0] = x; py[0] = y;
    for (let k = 1; k <= segs; k++) {
      const u = k / segs;
      theta += (turn / segs) * (0.6 + 0.9 * u) + gauss(rand) * 0.22;
      x += Math.cos(theta) * step; y += Math.sin(theta) * step;
      px[k] = x; py[k] = y;
    }
    const amp = (0.55 + 0.45 * rand()) * o.heightScale;
    const w = o.width * (0.8 + 0.5 * rand());
    // rasterise (distance to polyline), wrapping at the tile borders
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (let k = 0; k <= segs; k++) {
      if (px[k] < minX) minX = px[k]; if (px[k] > maxX) maxX = px[k];
      if (py[k] < minY) minY = py[k]; if (py[k] > maxY) maxY = py[k];
    }
    const pad = Math.ceil(w * 2.2);
    for (let yy = Math.floor(minY) - pad; yy <= Math.ceil(maxY) + pad; yy++) {
      for (let xx = Math.floor(minX) - pad; xx <= Math.ceil(maxX) + pad; xx++) {
        let d2 = 1e9, along = 0;
        for (let k = 0; k < segs; k++) {
          const ax = px[k], ay = py[k], bx = px[k + 1], by = py[k + 1];
          const dx = bx - ax, dy = by - ay;
          const l2 = dx * dx + dy * dy || 1;
          let t = ((xx - ax) * dx + (yy - ay) * dy) / l2;
          t = t < 0 ? 0 : t > 1 ? 1 : t;
          const qx = ax + dx * t - xx, qy = ay + dy * t - yy;
          const dd = qx * qx + qy * qy;
          if (dd < d2) { d2 = dd; along = (k + t) / segs; }
        }
        const d = Math.sqrt(d2);
        if (d > w * 2.2) continue;
        const r = d / w;
        // rounded profile, tapered toward both fibre ends
        const taper = Math.sin(Math.PI * Math.min(1, Math.max(0, along))) ** 0.5;
        const h = amp * Math.exp(-r * r * 1.35) * (0.35 + 0.65 * taper);
        const ix = ((xx % N) + N) % N, iy = ((yy % N) + N) % N;
        const idx = iy * N + ix;
        if (h > height[idx]) height[idx] = h;
      }
    }
  }

  // ---- soft mottling: two octaves of wrapped value noise -------------------
  const n1 = makeNoise(38, rand), n2 = makeNoise(97, rand);
  const mottle = new Float32Array(N * N);
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const u = x / N, v = y / N;
    mottle[y * N + x] = 0.6 * n1(u, v) + 0.4 * n2(u, v);
  }

  // ---- normal map from (fibres + a touch of mottling) ----------------------
  const data = new Uint8Array(N * N * 4);
  const hAt = (x, y) => {
    const i = (((y % N) + N) % N) * N + (((x % N) + N) % N);
    return height[i] + mottle[i] * 0.05 * o.mottle;
  };
  const s = o.normalStrength;
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const gx = (hAt(x + 1, y - 1) + 2 * hAt(x + 1, y) + hAt(x + 1, y + 1)) - (hAt(x - 1, y - 1) + 2 * hAt(x - 1, y) + hAt(x - 1, y + 1));
      const gy = (hAt(x - 1, y + 1) + 2 * hAt(x, y + 1) + hAt(x + 1, y + 1)) - (hAt(x - 1, y - 1) + 2 * hAt(x, y - 1) + hAt(x + 1, y - 1));
      let nx = -gx * s * 0.25, ny = -gy * s * 0.25, nz = 1;
      const l = Math.sqrt(nx * nx + ny * ny + nz * nz);
      nx /= l; ny /= l;
      const i = (y * N + x) * 4;
      data[i] = Math.round((nx * 0.5 + 0.5) * 255);
      data[i + 1] = Math.round((ny * 0.5 + 0.5) * 255);
      data[i + 2] = Math.round(Math.min(1, height[y * N + x]) * 255);
      data[i + 3] = Math.round(mottle[y * N + x] * 255);
    }
  }
  return { size: N, data };
}


// ---------------------------------------------------------------------------------------------
// Extracted nap tiles (scripts/nap/build.py): the real fibre structure of the plush artwork.
// ---------------------------------------------------------------------------------------------
/**
 * World size of one extracted tile.  The tiles are cut from the artwork at its own density (mascot.config.json frame.ppu texels per
 * unit), so a tile `texels` wide spans texels / ppu units: 1024 / 350 for the example.
 */
export const napTileSize = (texels, ppu) => texels / ppu;

/**
 * Load the body and face nap tiles and the face maps measured from the art, from their URLs.  Resolves to { body, face, halo, eyeRim,
 * eyeShade } as image elements, or rejects if a tile is missing (callers fall back to generateFeltMaps()).
 */
export async function loadNapImages({ body, face, halo, eyeRim, eyeShade }) {
  const load = (url) => new Promise((resolve, reject) => {
    const img = new Image();
    img.decoding = 'async';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`nap tile failed to load: ${url}`));
    img.src = url;
  });
  // (the face maps are optional: without them the face fabric is simply lit evenly around its features and the eye whites are plain)
  const optional = (url) => (url ? load(url).catch(() => null) : Promise.resolve(null));
  const images = await Promise.all([load(body), load(face), optional(halo), optional(eyeRim), optional(eyeShade)]);
  return { body: images[0], face: images[1], halo: images[2], eyeRim: images[3], eyeShade: images[4] };
}
