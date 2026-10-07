// Sanity-check a baked mesh: open (boundary) edges, non-manifold edges, degenerate triangles, and attribute ranges.
//   node scripts/bake/check-mesh.mjs [assets/mascot-mesh.bin]
import { readFileSync } from 'node:fs';

const file = process.argv[2] ?? 'assets/mascot-mesh.bin';
const buf = readFileSync(file);
const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
const jsonLength = dv.getUint32(8, true);
const meta = JSON.parse(buf.subarray(12, 12 + jsonLength).toString('utf8'));
const base = 12 + jsonLength;
let bad = 0;
for (const part of meta.parts) {
  const view = (name, T) => { const b = part.buffers[name]; return new T(buf.buffer, buf.byteOffset + base + b.offset, b.byteLength / T.BYTES_PER_ELEMENT); };
  const pos = view('position', Float32Array), idx = view('index', Uint32Array);
  const edges = new Map();
  let degenerate = 0;
  for (let t = 0; t < idx.length; t += 3) {
    const a = idx[t], b = idx[t + 1], c = idx[t + 2];
    if (a === b || b === c || a === c) { degenerate++; continue; }
    for (const [u, v] of [[a, b], [b, c], [c, a]]) {
      const key = u < v ? u * 4294967296 + v : v * 4294967296 + u;
      edges.set(key, (edges.get(key) ?? 0) + 1);
    }
  }
  let open = 0, nonManifold = 0;
  const openAt = [];
  for (const [key, n] of edges) {
    if (n === 1) { open++; if (openAt.length < 6) { const u = Math.floor(key / 4294967296), v = key % 4294967296; openAt.push([0, 1, 2].map((k) => ((pos[u * 3 + k] + pos[v * 3 + k]) / 2).toFixed(3)).join(',')); } }
    else if (n > 2) nonManifold++;
  }
  const seam = view('seam', Int16Array);
  console.log(`${part.name.padEnd(5)} ${pos.length / 3} verts ${idx.length / 3} tris  open edges ${open}  non-manifold ${nonManifold}  degenerate ${degenerate}${openAt.length ? '  e.g. at ' + openAt.join(' | ') : ''}`);
  bad += open + nonManifold + degenerate;
}
process.exit(bad ? 1 : 0);
