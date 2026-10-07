// Bake Mascot's sculpt into a compact binary the browser can load instantly.
//   node scripts/bake/bake.mjs [--quality draft|final] [--out assets/mascot-mesh.bin]
//
// Per part: surface-nets mesh (projected to the exact SDF surface), skin
// weights, baked ambient occlusion + curvature and the construction-seam field (signed distance + direction), packed into MSCT v2.
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import { availableParallelism } from 'node:os';
import { fileURLToPath } from 'node:url';
import { writeFileSync, mkdirSync, copyFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { P, buildModel as buildPlainModel, cloneParams, faceOpening } from './model.mjs';
import { buildCarvedModel as buildModel } from './folds.mjs';
import { meshSDF, dropDegenerate } from './mesher.mjs';
import { refineMesh } from './refine.mjs';
import { makeSkeleton, makeSkinners } from './skeleton.mjs';
import { clamp, smoothstep } from './sdf.mjs';
import { buildSeams, seamAttributes, emptySeamAttributes, SEAM_MAX } from './seams.mjs';
import { FACE_SHAPES, ARTWORK_VIEW } from '../../src/mascot-face-shapes.js';

const args = Object.fromEntries(process.argv.slice(2).reduce((a, v, i, all) => (v.startsWith('--') ? [...a, [v.slice(2), all[i + 1] ?? true]] : a), []));
// refine: distances from the face plate's outline within which the head's triangles are split again (each entry halves the edge length there)
const QUALITY = {
  draft: { head: 0.034, body: 0.034, arm: 0.03, rays: 24, refine: [] },
  lite: { head: 0.03, body: 0.031, arm: 0.027, rays: 40, refine: [0.07] },      // ~70k triangles, for phones / low-power GPUs
  final: { head: 0.021, body: 0.023, arm: 0.019, rays: 56, refine: [0.1] },
};
const AO_RADIUS = 0.5;

// ------------------------------------------------------------ AO worker ---
function fibonacciHemisphere(n) {
  const dirs = [];
  const golden = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < n; i++) {
    const y = (i + 0.5) / n;                 // cos(theta), cosine-weighted below
    const r = Math.sqrt(1 - y);              // sin(theta) with cosine weighting
    const ct = Math.sqrt(y);
    const phi = i * golden;
    dirs.push([Math.cos(phi) * r, Math.sin(phi) * r, ct]);
  }
  return dirs;
}

function aoWork({ part, positions, normals, rays }) {
  // Occlusion and curvature describe the LARGE form (ears, chin, body).  The hood's crevice around the face plate is drawn by the
  // shader with a line and a gentle plate shading, so leave it out here: at mesh resolution it would only alias into a dark smear.
  const model = buildPlainModel(cloneParams({ 'face.hem': 0, 'face.tuck': 0 }));
  // Baked occlusion must not depend on the rest pose of PARTS THAT MOVE: an arm hanging beside the torso
  // would leave the shoulder permanently dark once it swings away.  So each part is occluded by the rigid
  // volumes it cannot leave (head + torso) and by itself - never by the other limbs.
  const rigid = (x, y, z) => Math.min(model.head(x, y, z), model.body(x, y, z));
  const scenes = {
    head: rigid,
    body: rigid,
    armL: (x, y, z) => Math.min(rigid(x, y, z), model.armL(x, y, z)),
    armR: (x, y, z) => Math.min(rigid(x, y, z), model.armR(x, y, z)),
  };
  const scene = scenes[part];
  const own = model[part];
  const dirs = fibonacciHemisphere(rays);
  const V = positions.length / 3;
  const ao = new Uint8Array(V), curv = new Int8Array(V);
  const e = 0.03;
  for (let v = 0; v < V; v++) {
    const px = positions[v * 3], py = positions[v * 3 + 1], pz = positions[v * 3 + 2];
    // The hemisphere is oriented by the LARGE form's normal: the mesh normal on the carved crevice / belly fold tilts by 15-30 degrees,
    // which would tip part of the ray hemisphere below the plain surface and darken the crevice's flanks in a triangle-by-triangle pattern.
    const ge = 0.004;
    let nx = own(px + ge, py, pz) - own(px - ge, py, pz), ny = own(px, py + ge, pz) - own(px, py - ge, pz), nz = own(px, py, pz + ge) - own(px, py, pz - ge);
    const gl = Math.hypot(nx, ny, nz);
    if (gl > 1e-9) { nx /= gl; ny /= gl; nz /= gl; } else { nx = normals[v * 3]; ny = normals[v * 3 + 1]; nz = normals[v * 3 + 2]; }
    // tangent frame
    let tx, ty, tz;
    if (Math.abs(ny) < 0.9) { tx = nz; ty = 0; tz = -nx; } else { tx = 0; ty = -nz; tz = ny; }
    const tl = Math.hypot(tx, ty, tz) || 1; tx /= tl; ty /= tl; tz /= tl;
    const bx = ny * tz - nz * ty, by = nz * tx - nx * tz, bz = nx * ty - ny * tx;
    let sum = 0;
    // the mesh surface may lie slightly inside the plain surface (by at most the crevice depth): start from just outside the latter
    const inset = own(px, py, pz);
    const lift = inset < 0 ? -inset + 0.004 : 0;
    for (let k = 0; k < dirs.length; k++) {
      const d = dirs[k];
      const dx = tx * d[0] + bx * d[1] + nx * d[2];
      const dy = ty * d[0] + by * d[1] + ny * d[2];
      const dz = tz * d[0] + bz * d[1] + nz * d[2];
      let t = 0.012, vis = 1;
      for (let s = 0; s < 40; s++) {
        const dist = scene(px + dx * t + nx * (0.008 + lift), py + dy * t + ny * (0.008 + lift), pz + dz * t + nz * (0.008 + lift));
        if (dist < 0.004) { vis = t / AO_RADIUS; break; }
        t += Math.max(dist * 0.9, 0.01);
        if (t >= AO_RADIUS) break;
      }
      sum += vis > 1 ? 1 : vis;
    }
    let occl = clamp(sum / dirs.length, 0, 1);
    if (part === 'armL' || part === 'armR') {
      // Arms swing away from the torso, so occlusion baked against it in the hanging pose would be wrong (and near black
      // where the shoulder is buried in the chest).  Keep only a gentle self-occlusion, and treat anything within reach of
      // the torso surface as fully open: the key light's shadow map supplies the real contact shadow at run time.
      const nearBody = model.body(px, py, pz) < 0.06;
      occl = nearBody ? 1 : 0.8 + 0.2 * occl;
    }
    ao[v] = Math.round(255 * occl);
    // mean curvature via the laplacian of the part's own field (convex > 0)
    const f0 = own(px, py, pz);
    const lap = (own(px + e, py, pz) + own(px - e, py, pz) + own(px, py + e, pz) + own(px, py - e, pz) + own(px, py, pz + e) + own(px, py, pz - e) - 6 * f0) / (e * e);
    curv[v] = Math.round(127 * clamp(lap * 0.045, -1, 1));
  }
  return { ao, curv };
}

// -------------------------------------------------------------- packing ---
function packContainer(meta, parts) {
  const chunks = [];
  let offset = 0;
  const push = (typed) => {
    const bytes = new Uint8Array(typed.buffer, typed.byteOffset, typed.byteLength);
    const pad = (4 - (bytes.length % 4)) % 4;
    const start = offset;
    chunks.push(bytes);
    if (pad) chunks.push(new Uint8Array(pad));
    offset += bytes.length + pad;
    return { offset: start, byteLength: bytes.length };
  };
  const partMeta = parts.map((p) => ({
    name: p.name,
    vertexCount: p.vertexCount,
    indexCount: p.indices.length,
    buffers: {
      position: push(p.positions), normal: push(p.normals), ao: push(p.ao), curv: push(p.curv),
      skinIndex: push(p.skinIndex), skinWeight: push(p.skinWeight), index: push(p.indices),
      seam: push(p.seam), seamDir: push(p.seamDir),
    },
  }));
  const json = Buffer.from(JSON.stringify({ ...meta, parts: partMeta }), 'utf8');
  const jsonPad = (4 - (json.length % 4)) % 4;
  const header = Buffer.alloc(12);
  header.write('MSCT', 0, 'ascii');
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(json.length + jsonPad, 8);
  return Buffer.concat([header, json, Buffer.alloc(jsonPad, 0x20), ...chunks.map((c) => Buffer.from(c))]);
}

// ----------------------------------------------------------- anchors -----
function marchZ(f, x, y, z0 = 1.6) {
  // walk from the front toward -z until the field goes negative
  let z = z0;
  for (let i = 0; i < 400; i++) {
    const d = f(x, y, z);
    if (d < 0.0004) break;
    z -= Math.max(d * 0.7, 0.0008);
  }
  const e = 0.004;
  const g = [f(x + e, y, z) - f(x - e, y, z), f(x, y + e, z) - f(x, y - e, z), f(x, y, z + e) - f(x, y, z - e)];
  const l = Math.hypot(...g) || 1;
  return { p: [x, y, z], n: g.map((c) => c / l) };
}

/**
 * The point of the head surface that the artwork's view shows at image position (xa, ya): the artwork is matched from a distant camera
 * (ARTWORK_VIEW), from which something standing z in front of the body axis plane is magnified by D / (D - z) about the view axis.
 */
function artworkPoint(f, xa, ya) {
  const { distance: D, targetY } = ARTWORK_VIEW;
  let x = xa, y = ya, r;
  for (let i = 0; i < 4; i++) {
    r = marchZ(f, x, y);
    const k = (D - r.p[2]) / D;
    x = xa * k; y = targetY + (ya - targetY) * k;
  }
  return r;
}

function anchors(model) {
  const h = model.head, b = model.body;
  const q = (r) => ({ p: r.p.map((v) => +v.toFixed(5)), n: r.n.map((v) => +v.toFixed(5)) });
  // Each facial feature sits at the centre of its outline as measured from the artwork (scripts/dev/fit-face.py -> src/mascot-face-shapes.js);
  // "L" is the character's left = the viewer's right (+x).  The anchor is the point of the head surface behind that centre.  The mouth's
  // anchor is the lowest point of its smile (the vertex of the parabola).
  const F = FACE_SHAPES;
  return {
    eyeL: q(artworkPoint(h, F.eye.L.cx, F.eye.L.cy)), eyeR: q(artworkPoint(h, F.eye.R.cx, F.eye.R.cy)),
    cheekL: q(artworkPoint(h, F.cheek.L.cx, F.cheek.L.cy)), cheekR: q(artworkPoint(h, F.cheek.R.cx, F.cheek.R.cy)),
    mouth: q(artworkPoint(h, F.mouth.xc, F.mouth.y0)),
    chestX: q(marchZ(b, 0.021, 1.164)),
  };
}

// ---------------------------------------------------------------- main ----
async function runWorkers(jobs) {
  const n = Math.max(1, availableParallelism() - 1);
  const results = new Array(jobs.length);
  let next = 0, active = 0;
  await new Promise((resolveAll, reject) => {
    const launch = () => {
      while (active < n && next < jobs.length) {
        const idx = next++;
        active++;
        const w = new Worker(fileURLToPath(import.meta.url), { workerData: jobs[idx] });
        w.on('message', (r) => { results[idx] = r; });
        w.on('error', reject);
        w.on('exit', () => { active--; if (next >= jobs.length && active === 0) resolveAll(); else launch(); });
      }
    };
    launch();
  });
  return results;
}

if (isMainThread) {
  const q = QUALITY[args.quality ?? 'final'];
  const out = resolve(args.out ?? (args.quality === 'lite' ? 'assets/mascot-mesh-lite.bin' : 'assets/mascot-mesh.bin'));
  const t0 = performance.now();
  const model = buildModel();
  const sk = makeSkeleton();
  const skin = makeSkinners(sk);
  const defs = [
    { name: 'head', key: 'head', h: q.head, min: [-1.5, 1.25, -1.2], max: [1.5, 3.55, 1.2] },
    { name: 'body', key: 'body', h: q.body, min: [-1.05, -0.12, -0.85], max: [1.05, 1.95, 0.85] },
    { name: 'armL', key: 'armL', h: q.arm, min: [0.15, 0.55, -0.45], max: [1.25, 1.55, 0.45] },
    { name: 'armR', key: 'armR', h: q.arm, min: [-1.25, 0.55, -0.45], max: [-0.15, 1.55, 0.45] },
  ];
  const parts = [];
  for (const d of defs) {
    const t1 = performance.now();
    let m = dropDegenerate(meshSDF(model[d.key], d.min, d.max, d.h));
    if (d.key === 'head') {
      // the hood's rolled edge and the crevice around the face plate are finer than the grid: split the triangles along the outline (refine.mjs)
      const nearPlate = (x, y, z) => (z > 0.08 ? Math.abs(faceOpening(x, y)) : 1e9);
      let edge = d.h;
      for (const radius of q.refine) {
        m = refineMesh(m, model.head, nearPlate, radius, edge);
        console.log(`  refined within ${radius} of the plate outline: ${m.split} triangles split, ${m.reverted} vertices left at the midpoint, ${m.folded} folded`);
        edge /= 2;
      }
      m = dropDegenerate(m);
    }
    // keep only vertices that are referenced
    const used = new Int32Array(m.vertexCount).fill(-1);
    let nv = 0;
    for (const i of m.indices) if (used[i] < 0) used[i] = nv++;
    const positions = new Float32Array(nv * 3), normals = new Float32Array(nv * 3);
    for (let i = 0; i < m.vertexCount; i++) if (used[i] >= 0) {
      const o = used[i] * 3;
      positions[o] = m.positions[i * 3]; positions[o + 1] = m.positions[i * 3 + 1]; positions[o + 2] = m.positions[i * 3 + 2];
      normals[o] = m.normals[i * 3]; normals[o + 1] = m.normals[i * 3 + 1]; normals[o + 2] = m.normals[i * 3 + 2];
    }
    const indices = new Uint32Array(m.indices.length);
    for (let i = 0; i < indices.length; i++) indices[i] = used[m.indices[i]];
    // skin
    const skinIndex = new Uint8Array(nv * 4), skinWeight = new Uint8Array(nv * 4);
    for (let v = 0; v < nv; v++) {
      const w = skin[d.key](positions[v * 3], positions[v * 3 + 1], positions[v * 3 + 2]);
      let acc = 0;
      for (let k = 0; k < 4; k++) {
        skinIndex[v * 4 + k] = w[k][0];
        const q8 = Math.round(w[k][1] * 255);
        skinWeight[v * 4 + k] = q8; acc += q8;
      }
      skinWeight[v * 4] += 255 - acc;      // make the row sum to exactly 255
    }
    parts.push({ name: d.name, key: d.key, vertexCount: nv, positions, normals, indices, skinIndex, skinWeight });
    console.log(`meshed ${d.name}: ${nv} verts, ${indices.length / 3} tris, ${m.folded} folded (${((performance.now() - t1) / 1000).toFixed(1)}s)`);
  }

  // AO + curvature in parallel, chunked per part
  const jobs = [];
  for (const p of parts) {
    const chunk = Math.ceil(p.vertexCount / 24);
    for (let s = 0; s < p.vertexCount; s += chunk) {
      const e = Math.min(p.vertexCount, s + chunk);
      jobs.push({ kind: 'ao', part: p.key, start: s, positions: p.positions.slice(s * 3, e * 3), normals: p.normals.slice(s * 3, e * 3), rays: q.rays });
    }
  }
  const t2 = performance.now();
  const res = await runWorkers(jobs);
  const cursor = Object.fromEntries(parts.map((p) => [p.key, 0]));
  for (const p of parts) { p.ao = new Uint8Array(p.vertexCount); p.curv = new Int8Array(p.vertexCount); }
  jobs.forEach((j, i) => {
    const p = parts.find((x) => x.key === j.part);
    p.ao.set(res[i].ao, j.start);
    p.curv.set(res[i].curv, j.start);
  });
  console.log(`AO + curvature: ${((performance.now() - t2) / 1000).toFixed(1)}s (${q.rays} rays)`);

  // construction seams lifted from the artwork onto the sculpt (see seams.mjs)
  const t3 = performance.now();
  const seamLines = buildSeams();
  for (const p of parts) {
    const lines = seamLines[p.key] ?? [];
    const a = lines.length ? seamAttributes(p.positions, p.normals, lines) : emptySeamAttributes(p.vertexCount);
    p.seam = a.seam; p.seamDir = a.dir;
    console.log(`seams ${p.name}: ${lines.length} polylines`);
  }
  console.log(`seam field: ${((performance.now() - t3) / 1000).toFixed(1)}s`);

  const meta = {
    format: 'MSCT', version: 2, quality: args.quality ?? 'final', seamRange: SEAM_MAX,
    bones: sk.bones.map((b) => ({ name: b.name, parent: b.parent, pos: b.pos.map((v) => +v.toFixed(5)) })),
    anchors: anchors(model),
    params: P,
  };
  const bin = packContainer(meta, parts);
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, bin);
  const pub = resolve(dirname(out), '../public/assets', out.split('/').pop());
  try { mkdirSync(dirname(pub), { recursive: true }); copyFileSync(out, pub); } catch { /* public/ is optional */ }
  const totalTris = parts.reduce((t, p) => t + p.indices.length / 3, 0);
  console.log(`wrote ${out}  ${(bin.length / 1024).toFixed(0)} KB, ${totalTris} triangles, total ${((performance.now() - t0) / 1000).toFixed(1)}s`);
} else if (workerData?.kind === 'ao') {
  parentPort.postMessage(aoWork(workerData));
}
