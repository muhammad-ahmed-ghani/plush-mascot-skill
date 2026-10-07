// Local mesh refinement for the baked sculpt.
//
// The surface-nets grid is uniform (0.021 units on the head).  That is plenty for the round forms, but the hood's rolled edge and the
// crevice around the face plate are only a few hundredths of a unit wide, so at grid resolution they come out as a ragged staircase that
// shows as teeth and specks whenever the head turns and the edge is seen at a slant.  This splits the triangles that lie near such a
// feature (red-green refinement, so no cracks open between refined and untouched triangles) and re-projects the new vertices onto the
// exact zero level set of the field, which then carries the feature at the finer scale.
//
//   refineMesh(mesh, f, near, radius, h)   one pass: every triangle with `near(x, y, z) < radius` at a corner or at its centre is split in four
//
// `h` is the edge length of the triangles being split (it only sets how far a new vertex may travel while it is projected).

const key = (a, b) => (a < b ? a * 4294967296 + b : b * 4294967296 + a);

/** Newton-project (x, y, z) onto f = 0 and return the unit gradient there.  Leaves the point where it started if it does not converge. */
function project(f, p, h, iterations, eps, stats) {
  const g = [0, 0, 0];
  const grad = (x, y, z) => {
    g[0] = f(x + eps, y, z) - f(x - eps, y, z);
    g[1] = f(x, y + eps, z) - f(x, y - eps, z);
    g[2] = f(x, y, z + eps) - f(x, y, z - eps);
  };
  const x0 = p[0], y0 = p[1], z0 = p[2];
  let x = x0, y = y0, z = z0;
  for (let it = 0; it < iterations; it++) {
    const d = f(x, y, z);
    grad(x, y, z);
    const gg = (g[0] * g[0] + g[1] * g[1] + g[2] * g[2]) / (4 * eps * eps);
    if (gg < 1e-8) break;
    const s = d / gg / (2 * eps);
    let dx = -g[0] * s, dy = -g[1] * s, dz = -g[2] * s;
    const len = Math.hypot(dx, dy, dz), cap = h * 0.75;
    if (len > cap) { dx *= cap / len; dy *= cap / len; dz *= cap / len; }
    x += dx; y += dy; z += dz;
    if (len < 1e-6) break;
  }
  // (a vertex that wandered, or ended nowhere near the surface, goes back to the midpoint it started from)
  if (Math.hypot(x - x0, y - y0, z - z0) > h * 1.2 || Math.abs(f(x, y, z)) > h * 0.05) { x = x0; y = y0; z = z0; stats.reverted++; }
  grad(x, y, z);
  const l = Math.hypot(g[0], g[1], g[2]) || 1;
  p[0] = x; p[1] = y; p[2] = z;
  return [g[0] / l, g[1] / l, g[2] / l];
}

export function refineMesh(mesh, f, near, radius, h, { project: iterations = 6, gradEps = h * 0.125 } = {}) {
  const { positions: P, normals: N, indices: I } = mesh;
  const nv = P.length / 3, nt = I.length / 3;
  const dist = (v) => near(P[v * 3], P[v * 3 + 1], P[v * 3 + 2]);

  // 1. the triangles to split
  const vNear = new Float32Array(nv);
  for (let v = 0; v < nv; v++) vNear[v] = dist(v);
  const mark = new Uint8Array(nt);
  let marked = 0;
  for (let t = 0; t < nt; t++) {
    const a = I[t * 3], b = I[t * 3 + 1], c = I[t * 3 + 2];
    let near3 = Math.min(vNear[a], vNear[b], vNear[c]) < radius;
    if (!near3) {
      const cx = (P[a * 3] + P[b * 3] + P[c * 3]) / 3, cy = (P[a * 3 + 1] + P[b * 3 + 1] + P[c * 3 + 1]) / 3, cz = (P[a * 3 + 2] + P[b * 3 + 2] + P[c * 3 + 2]) / 3;
      near3 = near(cx, cy, cz) < radius;
    }
    if (near3) { mark[t] = 1; marked++; }
  }
  if (!marked) return { ...mesh, split: 0, reverted: 0, folded: mesh.folded ?? 0 };

  // 2. every edge of a marked triangle gets a midpoint vertex (shared by whichever triangles use that edge)
  const mid = new Map();
  const extra = [];                      // new vertex positions
  const midOf = (a, b) => {
    const k = key(a, b);
    let m = mid.get(k);
    if (m === undefined) {
      m = nv + extra.length / 3;
      mid.set(k, m);
      extra.push((P[a * 3] + P[b * 3]) / 2, (P[a * 3 + 1] + P[b * 3 + 1]) / 2, (P[a * 3 + 2] + P[b * 3 + 2]) / 2);
    }
    return m;
  };
  for (let t = 0; t < nt; t++) {
    if (!mark[t]) continue;
    const a = I[t * 3], b = I[t * 3 + 1], c = I[t * 3 + 2];
    midOf(a, b); midOf(b, c); midOf(c, a);
  }
  const has = (a, b) => mid.get(key(a, b)) ?? -1;
  const at = (v, k) => (v < nv ? P[v * 3 + k] : extra[(v - nv) * 3 + k]);
  const len2 = (u, v) => (at(u, 0) - at(v, 0)) ** 2 + (at(u, 1) - at(v, 1)) ** 2 + (at(u, 2) - at(v, 2)) ** 2;

  // 3. new triangle list: marked triangles split in four; their unmarked neighbours split only along the edges that were cut
  const out = [];
  const tri = (a, b, c) => out.push(a, b, c);
  // a quad p0 p1 p2 p3 (in order), cut along its shorter diagonal
  const quad = (p0, p1, p2, p3) => {
    if (len2(p0, p2) <= len2(p1, p3)) { tri(p0, p1, p2); tri(p0, p2, p3); } else { tri(p0, p1, p3); tri(p1, p2, p3); }
  };
  for (let t = 0; t < nt; t++) {
    const a = I[t * 3], b = I[t * 3 + 1], c = I[t * 3 + 2];
    const mab = has(a, b), mbc = has(b, c), mca = has(c, a);
    const n = (mab >= 0) + (mbc >= 0) + (mca >= 0);
    if (n === 0) { tri(a, b, c); continue; }
    if (n === 3) { tri(a, mab, mca); tri(mab, b, mbc); tri(mca, mbc, c); tri(mab, mbc, mca); continue; }
    if (n === 1) {
      if (mab >= 0) { tri(a, mab, c); tri(mab, b, c); }
      else if (mbc >= 0) { tri(b, mbc, a); tri(mbc, c, a); }
      else { tri(c, mca, b); tri(mca, a, b); }
      continue;
    }
    // two cut edges: the corner between them becomes a triangle, the rest a quad
    if (mab < 0) { tri(c, mca, mbc); quad(mca, a, b, mbc); }           // cut: bc, ca  (corner c)
    else if (mbc < 0) { tri(a, mab, mca); quad(mab, b, c, mca); }      // cut: ab, ca  (corner a)
    else { tri(b, mbc, mab); quad(mbc, c, a, mab); }                   // cut: ab, bc  (corner b)
  }

  // 4. project the new vertices onto the surface
  const total = nv + extra.length / 3;
  const pos = new Float32Array(total * 3), nor = new Float32Array(total * 3);
  pos.set(P); nor.set(N);
  const p = [0, 0, 0];
  const stats = { reverted: 0 };
  for (let v = nv; v < total; v++) {
    p[0] = extra[(v - nv) * 3]; p[1] = extra[(v - nv) * 3 + 1]; p[2] = extra[(v - nv) * 3 + 2];
    const n = project(f, p, h, iterations, gradEps, stats);
    pos[v * 3] = p[0]; pos[v * 3 + 1] = p[1]; pos[v * 3 + 2] = p[2];
    nor[v * 3] = n[0]; nor[v * 3 + 1] = n[1]; nor[v * 3 + 2] = n[2];
  }
  // the old vertices next to a refined feature keep their positions but get the gradient at the finer scale, so the normals agree along the join
  const touched = new Uint8Array(nv);
  for (let t = 0; t < nt; t++) if (mark[t]) { touched[I[t * 3]] = 1; touched[I[t * 3 + 1]] = 1; touched[I[t * 3 + 2]] = 1; }
  for (let v = 0; v < nv; v++) {
    if (!touched[v]) continue;
    p[0] = pos[v * 3]; p[1] = pos[v * 3 + 1]; p[2] = pos[v * 3 + 2];
    const g = [f(p[0] + gradEps, p[1], p[2]) - f(p[0] - gradEps, p[1], p[2]), f(p[0], p[1] + gradEps, p[2]) - f(p[0], p[1] - gradEps, p[2]), f(p[0], p[1], p[2] + gradEps) - f(p[0], p[1], p[2] - gradEps)];
    const l = Math.hypot(g[0], g[1], g[2]) || 1;
    nor[v * 3] = g[0] / l; nor[v * 3 + 1] = g[1] / l; nor[v * 3 + 2] = g[2] / l;
  }

  const index = new Uint32Array(out);
  let folded = 0;
  for (let t = 0; t < index.length; t += 3) {
    const a = index[t], b = index[t + 1], c = index[t + 2];
    const ux = pos[b * 3] - pos[a * 3], uy = pos[b * 3 + 1] - pos[a * 3 + 1], uz = pos[b * 3 + 2] - pos[a * 3 + 2];
    const vx = pos[c * 3] - pos[a * 3], vy = pos[c * 3 + 1] - pos[a * 3 + 1], vz = pos[c * 3 + 2] - pos[a * 3 + 2];
    const fx = uy * vz - uz * vy, fy = uz * vx - ux * vz, fz = ux * vy - uy * vx;
    if (fx * (nor[a * 3] + nor[b * 3] + nor[c * 3]) + fy * (nor[a * 3 + 1] + nor[b * 3 + 1] + nor[c * 3 + 1]) + fz * (nor[a * 3 + 2] + nor[b * 3 + 2] + nor[c * 3 + 2]) < 0) folded++;
  }
  return { positions: pos, normals: nor, indices: index, vertexCount: total, folded, split: marked, reverted: stats.reverted };
}
