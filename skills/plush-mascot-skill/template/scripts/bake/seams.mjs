// Construction seams that the analytic shader seams do not cover, baked as a per-vertex distance-to-seam field.
//
// The polylines come from the artwork (scripts/bake/extract-seams.py writes candidates with ids into .seams/);
// this file picks the ones worth keeping, lifts each from its 2D view onto the sculpt surface, and measures every vertex's
// distance to the nearest seam.  A distance field is linear across a seam, so it survives per-vertex interpolation exactly:
// the shader recovers a crisp groove (and its bump) from it at any resolution.
import { readFileSync, existsSync } from 'node:fs';
import { buildModel } from './model.mjs';
import { lift } from './lift.mjs';
import { hoodLoop } from './loops.mjs';
import { clamp } from './sdf.mjs';

const SEAM_DIR = new URL('./.seams/', import.meta.url).pathname;
export const SEAM_MAX = 0.16;             // distances are clamped here (nothing in the shader looks farther than this)

/**
 * Each entry: which extracted candidates (src file + ids) to use, which sculpt part to lift onto, and how.
 *   axis  : the direction the 2D view looks along ('x' side view, 'z' front view)
 *   fit   : optional { part } - scale/shift the polyline to sit inside that part's silhouette (the artwork's limb is a different size)
 *   mirror: also emit the mirrored copy (x -> -x), for symmetric seams seen on only one side
 */
export const SEAM_SPEC = [
  { name: 'headSide', src: 't_side', ids: [1, 3], part: 'head', axis: 'x', mirror: true, join: true },
  { name: 'legFront', src: 'neutral', ids: [9, 10], part: 'body', axis: 'z', mirror: false },
  // The thin seam along the inside of the ear, where its front panel meets the side gusset: traced from the artwork's ear on the viewer's
  // right (front view, units).  The other ear gets the same seam mirrored, fainter (the artwork's head is turned a little, so it shows
  // only this one clearly).
  { name: 'earSeam', inline: [[0.901, 3.267], [0.880, 3.245], [0.841, 3.221], [0.803, 3.193], [0.775, 3.160], [0.746, 3.126], [0.718, 3.088], [0.694, 3.055], [0.665, 3.021], [0.637, 2.983], [0.608, 2.952], [0.599, 2.943]],
    part: 'head', axis: 'z', mirror: true, mirrorWeight: 0.35, taper: 0.03 },
  // (the arm outline seen in profile, t_side #4, is where the arm lies against the torso: contact shading, not a seam)
];

function loadPaths(src, ids) {
  const file = `${SEAM_DIR}seams_${src}.json`;
  if (!existsSync(file)) throw new Error(`missing ${file}; run: python3 scripts/bake/extract-seams.py`);
  const data = JSON.parse(readFileSync(file, 'utf8'));
  return ids.map((id) => {
    const p = data.paths.find((q) => q.id === id);
    if (!p) throw new Error(`${src}: no candidate seam #${id}`);
    return p.pts.map(([u, v]) => [u, v]);
  });
}

/** Densify a polyline to a maximum step and smooth it a little. */
function resample(pts, step = 0.008) {
  const out = [pts[0]];
  for (let i = 1; i < pts.length; i++) {
    const [ax, ay] = pts[i - 1], [bx, by] = pts[i];
    const n = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) / step));
    for (let k = 1; k <= n; k++) out.push([ax + ((bx - ax) * k) / n, ay + ((by - ay) * k) / n]);
  }
  return out;
}

/** Bounding box of a part's projection along `axis` (samples the SDF on a grid; y from 0 to 3.6). */
function projectedBox(f, axis, side = 1) {
  let umin = 9, umax = -9, vmin = 9, vmax = -9;
  for (let v = 0; v <= 3.6; v += 0.02) {
    for (let u = -1.2; u <= 1.2; u += 0.02) {
      const hit = lift(f, axis, u, v, axis === 'x' ? side : 1);
      if (Number.isNaN(hit)) continue;
      umin = Math.min(umin, u); umax = Math.max(umax, u); vmin = Math.min(vmin, v); vmax = Math.max(vmax, v);
    }
  }
  return { umin, umax, vmin, vmax };
}

/** Build every seam polyline in 3D. Returns { part: [ [ [x,y,z], ... ], ... ] } keyed by 'head' | 'body' | 'armL' | 'armR'. */
export function buildSeams() {
  const model = buildModel();
  const byPart = { head: [], body: [], armL: [], armR: [] };
  for (const spec of SEAM_SPEC) {
    const paths = spec.inline ? [spec.inline] : loadPaths(spec.src, spec.ids);
    // 'join' fuses consecutive candidates (they are pieces of one long seam) into a single polyline
    const groups = spec.join ? [paths.flat().sort((a, b) => b[1] - a[1])] : paths;
    for (const group of groups) {
      let poly = resample(group);
      const sides = spec.part === 'arm' ? ['armL', 'armR'] : [spec.part];
      for (const target of sides) {
        const sgn = target === 'armR' ? -1 : 1;                   // armL is the +x arm
        const f = spec.part === 'arm' ? model[target] : model[spec.part];
        let pl = poly;
        if (spec.fit) {
          // Fit the artwork's limb outline into this limb's silhouette: map the polyline's bbox onto the limb's projected bbox.
          const box = projectedBox(f, spec.axis, sgn);
          const us = pl.map((p) => p[0]), vs = pl.map((p) => p[1]);
          const u0 = Math.min(...us), u1 = Math.max(...us), v0 = Math.min(...vs), v1 = Math.max(...vs);
          const cu = (box.umin + box.umax) / 2, cv = (box.vmin + box.vmax) / 2;
          const su = ((box.umax - box.umin) * spec.fit.inset) / (u1 - u0), sv = ((box.vmax - box.vmin) * spec.fit.inset) / (v1 - v0);
          pl = pl.map(([u, v]) => [cu + (u - (u0 + u1) / 2) * su, cv + (v - (v0 + v1) / 2) * sv]);
        }
        const variants = spec.mirror && spec.part !== 'arm' ? [1, -1] : [sgn];
        for (const side of variants) {
          const pts = [];
          for (const [u0, v] of pl) {
            const u = spec.axis === 'z' && side !== sgn ? -u0 : u0;           // (front view: the mirrored copy is x -> -x)
            const hit = lift(f, spec.axis, u, v, spec.axis === 'x' ? side : 1);
            if (Number.isNaN(hit)) continue;
            pts.push(spec.axis === 'x' ? [hit, v, u] : [u, v, hit]);
          }
          if (pts.length > 4) byPart[target].push(spec.taper || (spec.mirrorWeight && side !== sgn) ? { pts, taper: spec.taper, weights: spec.mirrorWeight && side !== sgn ? pts.map(() => spec.mirrorWeight) : undefined } : pts);
        }
      }
    }
  }
  const loop = hoodLoop(model.head, model.P);
  byPart.head.push({ pts: loop.pts, weights: loop.weights, closed: true });
  return byPart;
}

/**
 * Per-vertex seam attributes for one part.
 *   seam    Int16 x2 (normalised): [signed distance to the nearest seam / SEAM_MAX, presence 0..1]
 *   seamDir Int8  x4 (normalised): unit vector across the seam in the surface's tangent plane (the gradient of the signed distance)
 * The distance is SIGNED (which side of the curve the vertex lies on), so it is a straight ramp through zero across the seam and a
 * triangle that straddles the seam interpolates to the right zero crossing - an unsigned distance would fold at the seam and lose it.
 * Presence tapers to zero over `taper` units at each open end of a polyline, so the branch cut beyond an end never shows.
 */
export function seamAttributes(positions, normals, polylines, taper = 0.14) {
  const V = positions.length / 3;
  const seam = new Int16Array(V * 2);
  const dir = new Int8Array(V * 4);
  const segs = [];
  for (const entry of polylines) {
    // a polyline is either an array of points (an open seam that tapers out at both ends) or { pts, weights, closed }
    const poly = Array.isArray(entry) ? entry : entry.pts;
    const closed = !Array.isArray(entry) && !!entry.closed;
    const weights = Array.isArray(entry) ? null : entry.weights;
    const tp = Array.isArray(entry) ? taper : entry.taper ?? taper;
    const cum = [0];
    for (let i = 1; i < poly.length; i++) cum.push(cum[i - 1] + Math.hypot(poly[i][0] - poly[i - 1][0], poly[i][1] - poly[i - 1][1], poly[i][2] - poly[i - 1][2]));
    const L = cum[cum.length - 1];
    for (let i = 1; i < poly.length; i++) segs.push({ a: poly[i - 1], b: poly[i], s0: cum[i - 1], len: cum[i] - cum[i - 1], L, closed, tp, w0: weights ? weights[i - 1] : 1, w1: weights ? weights[i] : 1 });
  }
  const R2 = SEAM_MAX * SEAM_MAX;
  for (let v = 0; v < V; v++) {
    const px = positions[v * 3], py = positions[v * 3 + 1], pz = positions[v * 3 + 2];
    const nx = normals[v * 3], ny = normals[v * 3 + 1], nz = normals[v * 3 + 2];
    let best = R2, hit = null, ht = 0;
    for (let k = 0; k < segs.length; k++) {
      const { a, b } = segs[k];
      const abx = b[0] - a[0], aby = b[1] - a[1], abz = b[2] - a[2];
      const apx = px - a[0], apy = py - a[1], apz = pz - a[2];
      const l2 = abx * abx + aby * aby + abz * abz || 1e-12;
      let t = (apx * abx + apy * aby + apz * abz) / l2;
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      const dx = apx - abx * t, dy = apy - aby * t, dz = apz - abz * t;
      const d2 = dx * dx + dy * dy + dz * dz;
      if (d2 < best) { best = d2; hit = k; ht = t; }
    }
    if (hit === null) { seam[v * 2] = 32767; seam[v * 2 + 1] = 0; continue; }
    const { a, b, s0, len, L, closed, tp, w0, w1 } = segs[hit];
    let tx = b[0] - a[0], ty = b[1] - a[1], tz = b[2] - a[2];
    const tl = Math.hypot(tx, ty, tz) || 1; tx /= tl; ty /= tl; tz /= tl;
    // side = n x t (left of the curve seen from outside), re-orthogonalised against n
    let sx = ny * tz - nz * ty, sy = nz * tx - nx * tz, sz = nx * ty - ny * tx;
    const sl = Math.hypot(sx, sy, sz) || 1; sx /= sl; sy /= sl; sz /= sl;
    const qx = a[0] + (b[0] - a[0]) * ht, qy = a[1] + (b[1] - a[1]) * ht, qz = a[2] + (b[2] - a[2]) * ht;
    const side = (px - qx) * sx + (py - qy) * sy + (pz - qz) * sz;
    const d = Math.sqrt(best) * (side < 0 ? -1 : 1);
    const along = s0 + len * ht;
    const e = closed ? 1 : Math.min(along, L - along) / tp;
    const presence = (e >= 1 ? 1 : e <= 0 ? 0 : e * e * (3 - 2 * e)) * (w0 + (w1 - w0) * ht);
    seam[v * 2] = Math.round(clamp(d / SEAM_MAX, -1, 1) * 32767);
    seam[v * 2 + 1] = Math.round(presence * 32767);
    dir[v * 4] = Math.round(sx * 127); dir[v * 4 + 1] = Math.round(sy * 127); dir[v * 4 + 2] = Math.round(sz * 127);
  }
  return { seam, dir };
}

/** "No seam" attributes for parts without any. */
export function emptySeamAttributes(vertexCount) {
  const seam = new Int16Array(vertexCount * 2);
  for (let v = 0; v < vertexCount; v++) seam[v * 2] = 32767;
  return { seam, dir: new Int8Array(vertexCount * 4) };
}
