// Surface-nets mesher for signed distance fields.
//
// 1. Sample the field on a regular grid.
// 2. One vertex per sign-changing cell (average of edge crossings).
// 3. Quads across every sign-changing grid edge, split on the shorter diagonal.
// 4. Every vertex is then Newton-projected onto the exact zero level set and
//    given the analytic gradient as its normal.  That projection is what keeps
//    the result silky at a coarse grid: silhouettes and shading follow the
//    true surface, not the voxel lattice.

const EDGES = [
  [0, 1], [2, 3], [4, 5], [6, 7],   // along x
  [0, 2], [1, 3], [4, 6], [5, 7],   // along y
  [0, 4], [1, 5], [2, 6], [3, 7],   // along z
];

export function meshSDF(f, min, max, h, { project = 3, gradEps = h * 0.25 } = {}) {
  const nx = Math.ceil((max[0] - min[0]) / h) + 1;
  const ny = Math.ceil((max[1] - min[1]) / h) + 1;
  const nz = Math.ceil((max[2] - min[2]) / h) + 1;
  const stepY = nx, stepZ = nx * ny;
  const field = new Float32Array(nx * ny * nz);
  for (let k = 0, idx = 0; k < nz; k++) {
    const z = min[2] + k * h;
    for (let j = 0; j < ny; j++) {
      const y = min[1] + j * h;
      for (let i = 0; i < nx; i++, idx++) field[idx] = f(min[0] + i * h, y, z);
    }
  }

  const cnx = nx - 1, cny = ny - 1, cnz = nz - 1;
  const cellVert = new Int32Array(cnx * cny * cnz).fill(-1);
  const positions = [];
  const c = new Float32Array(8);
  const off = [0, 1, stepY, stepY + 1, stepZ, stepZ + 1, stepZ + stepY, stepZ + stepY + 1];
  const cx = [0, 1, 0, 1, 0, 1, 0, 1], cyo = [0, 0, 1, 1, 0, 0, 1, 1], czo = [0, 0, 0, 0, 1, 1, 1, 1];

  for (let k = 0; k < cnz; k++) {
    for (let j = 0; j < cny; j++) {
      for (let i = 0; i < cnx; i++) {
        const base = i + nx * (j + ny * k);
        let mask = 0;
        for (let n = 0; n < 8; n++) { c[n] = field[base + off[n]]; if (c[n] < 0) mask |= 1 << n; }
        if (mask === 0 || mask === 255) continue;
        let sx = 0, sy = 0, sz = 0, cnt = 0;
        for (let e = 0; e < 12; e++) {
          const a = EDGES[e][0], b = EDGES[e][1];
          const va = c[a], vb = c[b];
          if ((va < 0) === (vb < 0)) continue;
          const t = va / (va - vb);
          sx += cx[a] + (cx[b] - cx[a]) * t;
          sy += cyo[a] + (cyo[b] - cyo[a]) * t;
          sz += czo[a] + (czo[b] - czo[a]) * t;
          cnt++;
        }
        cellVert[i + cnx * (j + cny * k)] = positions.length / 3;
        positions.push(min[0] + (i + sx / cnt) * h, min[1] + (j + sy / cnt) * h, min[2] + (k + sz / cnt) * h);
      }
    }
  }

  const cellAt = (i, j, k) => cellVert[i + cnx * (j + cny * k)];
  const tris = [];
  const P = positions;
  const quad = (a, b, cc, d, inwardFirst) => {
    // The four cells are listed counter-clockwise about +axis, which gives an outward normal when the inside lies on the low side
    // of the grid edge; when it lies on the high side, run the loop the other way.  Winding from the grid's own topology (rather
    // than testing each triangle against its vertex normals afterwards) keeps neighbouring triangles consistent, even for the
    // slivers that projection produces, so no triangle is back-face culled by mistake.
    if (!inwardFirst) { const t = b; b = d; d = t; }
    // split along the shorter diagonal (a-cc vs b-d)
    const d1 = (P[a * 3] - P[cc * 3]) ** 2 + (P[a * 3 + 1] - P[cc * 3 + 1]) ** 2 + (P[a * 3 + 2] - P[cc * 3 + 2]) ** 2;
    const d2 = (P[b * 3] - P[d * 3]) ** 2 + (P[b * 3 + 1] - P[d * 3 + 1]) ** 2 + (P[b * 3 + 2] - P[d * 3 + 2]) ** 2;
    if (d1 <= d2) tris.push(a, b, cc, a, cc, d);
    else tris.push(a, b, d, b, cc, d);
  };
  for (let k = 1; k < nz - 1; k++) {
    for (let j = 1; j < ny - 1; j++) {
      for (let i = 1; i < nx - 1; i++) {
        const idx = i + nx * (j + ny * k);
        const v0 = field[idx] < 0;
        if ((field[idx + 1] < 0) !== v0 && j >= 1 && k >= 1 && i < cnx)
          quad(cellAt(i, j - 1, k - 1), cellAt(i, j, k - 1), cellAt(i, j, k), cellAt(i, j - 1, k), v0);
        if ((field[idx + stepY] < 0) !== v0 && i >= 1 && k >= 1 && j < cny)
          quad(cellAt(i - 1, j, k - 1), cellAt(i - 1, j, k), cellAt(i, j, k), cellAt(i, j, k - 1), v0);
        if ((field[idx + stepZ] < 0) !== v0 && i >= 1 && j >= 1 && k < cnz)
          quad(cellAt(i - 1, j - 1, k), cellAt(i, j - 1, k), cellAt(i, j, k), cellAt(i - 1, j, k), v0);
      }
    }
  }

  // ---- project vertices to the exact surface, compute normals -------------
  const count = positions.length / 3;
  const pos = new Float32Array(positions);
  const nor = new Float32Array(count * 3);
  const g = [0, 0, 0];
  const e = gradEps;
  const grad = (x, y, z) => {
    g[0] = f(x + e, y, z) - f(x - e, y, z);
    g[1] = f(x, y + e, z) - f(x, y - e, z);
    g[2] = f(x, y, z + e) - f(x, y, z - e);
    return g;
  };
  for (let v = 0; v < count; v++) {
    let x = pos[v * 3], y = pos[v * 3 + 1], z = pos[v * 3 + 2];
    const x0 = x, y0 = y, z0 = z;
    for (let it = 0; it < project; it++) {
      const d = f(x, y, z);
      grad(x, y, z);
      const gg = (g[0] * g[0] + g[1] * g[1] + g[2] * g[2]) / (4 * e * e);   // |grad|^2
      if (gg < 1e-8) break;
      const s = d / gg / (2 * e);
      let dx = -g[0] * s, dy = -g[1] * s, dz = -g[2] * s;
      const len = Math.hypot(dx, dy, dz);
      const cap = h * 0.75;
      if (len > cap) { dx *= cap / len; dy *= cap / len; dz *= cap / len; }
      x += dx; y += dy; z += dz;
    }
    // keep within a generous neighbourhood of the original cell vertex
    const drift = Math.hypot(x - x0, y - y0, z - z0);
    if (drift > h * 1.2) { x = x0; y = y0; z = z0; }
    pos[v * 3] = x; pos[v * 3 + 1] = y; pos[v * 3 + 2] = z;
    grad(x, y, z);
    const l = Math.hypot(g[0], g[1], g[2]) || 1;
    nor[v * 3] = g[0] / l; nor[v * 3 + 1] = g[1] / l; nor[v * 3 + 2] = g[2] / l;
  }

  // ---- winding comes from the grid (see quad()); count triangles that projection folded over, for information ----
  const index = new Uint32Array(tris);
  let folded = 0;
  for (let t = 0; t < index.length; t += 3) {
    const a = index[t], b = index[t + 1], cc = index[t + 2];
    const ux = pos[b * 3] - pos[a * 3], uy = pos[b * 3 + 1] - pos[a * 3 + 1], uz = pos[b * 3 + 2] - pos[a * 3 + 2];
    const vx = pos[cc * 3] - pos[a * 3], vy = pos[cc * 3 + 1] - pos[a * 3 + 1], vz = pos[cc * 3 + 2] - pos[a * 3 + 2];
    const fx = uy * vz - uz * vy, fy = uz * vx - ux * vz, fz = ux * vy - uy * vx;
    const nxs = nor[a * 3] + nor[b * 3] + nor[cc * 3];
    const nys = nor[a * 3 + 1] + nor[b * 3 + 1] + nor[cc * 3 + 1];
    const nzs = nor[a * 3 + 2] + nor[b * 3 + 2] + nor[cc * 3 + 2];
    if (fx * nxs + fy * nys + fz * nzs < 0) folded++;
  }
  return { positions: pos, normals: nor, indices: index, vertexCount: count, folded };
}

/**
 * Remove triangles that are degenerate by INDEX (two corners are the same vertex).  Triangles that merely collapsed to a sliver
 * after projection are kept on purpose: they cover no pixels, but dropping them opens a hole in the surface, because their
 * neighbours' shared edges lose their partner (the earlier area threshold left a few hundred such cracks in the head alone).
 */
export function dropDegenerate(mesh, minArea = 0) {
  const { positions: p, indices } = mesh;
  const keep = [];
  for (let t = 0; t < indices.length; t += 3) {
    const a = indices[t], b = indices[t + 1], c = indices[t + 2];
    if (a === b || b === c || a === c) continue;
    const ux = p[b * 3] - p[a * 3], uy = p[b * 3 + 1] - p[a * 3 + 1], uz = p[b * 3 + 2] - p[a * 3 + 2];
    const vx = p[c * 3] - p[a * 3], vy = p[c * 3 + 1] - p[a * 3 + 1], vz = p[c * 3 + 2] - p[a * 3 + 2];
    const area2 = (uy * vz - uz * vy) ** 2 + (uz * vx - ux * vz) ** 2 + (ux * vy - uy * vx) ** 2;
    if (area2 > minArea || minArea <= 0) keep.push(a, b, c);
  }
  mesh.indices = new Uint32Array(keep);
  return mesh;
}
