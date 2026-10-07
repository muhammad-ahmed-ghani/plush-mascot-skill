// Geometry helpers for the laptop prop: a rounded-rectangle footprint swept along a height profile (the unibody base and the lid:
// large plan-corner radius, separately rounded top and bottom edges, a tapered underside), a deck cap with a recessed keyboard
// well, keycaps and flat rounded plates.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

/**
 * Points of a rounded rectangle (half extents hx, hz, corner radius r) in the xz plane: a closed loop, counter-clockwise seen from
 * +y is NOT guaranteed; corners run (+x,+z) (-x,+z) (-x,-z) (+x,-z), each from its first to its last angle, with outward normals.
 */
export function ring(hx, hz, r, cornerSegs) {
  const pts = [];
  const cx = Math.max(hx - r, 0), cz = Math.max(hz - r, 0);
  for (let k = 0; k < 4; k++) {
    const sx = k === 0 || k === 3 ? 1 : -1, sz = k < 2 ? 1 : -1;
    for (let s = 0; s <= cornerSegs; s++) {
      const a = (k + s / cornerSegs) * Math.PI / 2;
      const nx = Math.cos(a), nz = Math.sin(a);
      pts.push({ x: sx * cx + r * nx, z: sz * cz + r * nz, nx, nz });
    }
  }
  return pts;
}

/**
 * Sweep a rounded-rect footprint along a profile.  Each profile sample is { inset, y, nr, ny }: how far the outline is inset from
 * the footprint, its height, and the surface normal split into a radial (outward) and a vertical component.  Groups: 0 = walls and
 * bottom cap (uvs in world units x wallUvScale), 1 = top cap (uv 0..1 across the footprint), optionally with a recessed `well`
 * (a rounded-rect hole { x, z, w, d, r, depth } whose walls and floor also belong to group 1), 2 = the last `rimRows` bands of the
 * profile (the rounded top edge: a polished chamfer can take its own material).
 */
export function sweepGeometry({ hx, hz, rc, profile, cornerSegs = 8, capTop = true, capBottom = true, wallUvScale = 1, well = null, rimRows = 0 }) {
  const positions = [], normals = [], uvs = [], idxWalls = [], idxTop = [], idxRim = [];
  const rings = profile.map((p) => ring(hx - p.inset, hz - p.inset, Math.max(rc - p.inset, 0.0015), cornerSegs));
  const N = rings[0].length;
  const per = [0];
  for (let i = 1; i < N; i++) { const a = rings[0][i - 1], b = rings[0][i]; per.push(per[i - 1] + Math.hypot(b.x - a.x, b.z - a.z)); }
  const closeLen = Math.hypot(rings[0][0].x - rings[0][N - 1].x, rings[0][0].z - rings[0][N - 1].z);
  const arc = [0];
  for (let j = 1; j < profile.length; j++) arc.push(arc[j - 1] + Math.hypot(profile[j].inset - profile[j - 1].inset, profile[j].y - profile[j - 1].y));
  const vert = (x, y, z, nx, ny, nz, u, v) => { positions.push(x, y, z); normals.push(nx, ny, nz); uvs.push(u, v); return positions.length / 3 - 1; };
  for (let j = 0; j < profile.length; j++) {
    const p = profile[j], rg = rings[j];
    for (let i = 0; i <= N; i++) {                       // duplicate the first column so the uv seam closes cleanly
      const q = rg[i % N];
      const n = new THREE.Vector3(q.nx * p.nr, p.ny, q.nz * p.nr).normalize();
      vert(q.x, p.y, q.z, n.x, n.y, n.z, (i < N ? per[i] : per[N - 1] + closeLen) * wallUvScale, arc[j] * wallUvScale);
    }
  }
  const cols = N + 1;
  for (let j = 0; j < profile.length - 1; j++) {
    const into = j >= profile.length - 1 - rimRows ? idxRim : idxWalls;
    for (let i = 0; i < N; i++) {
      const a = j * cols + i, b = a + 1, c = a + cols, d = c + 1;
      into.push(a, c, b, b, c, d);
    }
  }
  const footUv = (x, z) => [x / (2 * hx) + 0.5, 0.5 - z / (2 * hz)];     // v grows toward -z (the back), like a texture seen from above
  // top cap: the exact top ring as the outline (no cracks), triangulated around the optional well hole
  if (capTop) {
    const p = profile[profile.length - 1], rg = rings[profile.length - 1];
    const contour = rg.map((q) => new THREE.Vector2(q.x, q.z));
    let hole = null;
    if (well) hole = ring(well.w / 2, well.d / 2, well.r, 6).map((q) => ({ ...q, x: q.x + well.x, z: q.z + well.z }));
    const holes = hole ? [hole.map((q) => new THREE.Vector2(q.x, q.z))] : [];
    const faces = THREE.ShapeUtils.triangulateShape(contour, holes);
    const all = [...contour, ...(holes[0] ?? [])];
    const base = positions.length / 3;
    for (const v of all) { const [u, w] = footUv(v.x, v.y); vert(v.x, p.y, v.y, 0, 1, 0, u, w); }
    for (const [a, b, c] of faces) {
      // keep the cap facing +y whatever winding the triangulator returns
      const A = all[a], B = all[b], C = all[c];
      const cross = (B.x - A.x) * (C.y - A.y) - (B.y - A.y) * (C.x - A.x);
      if (cross < 0) idxTop.push(base + a, base + b, base + c); else idxTop.push(base + a, base + c, base + b);
    }
    if (hole) {
      // well walls (facing inward) and floor
      const yTop = p.y, yBot = p.y - well.depth, M = hole.length;
      const w0 = positions.length / 3;
      for (const q of hole) { const [u, w] = footUv(q.x, q.z); vert(q.x, yTop, q.z, -q.nx, 0, -q.nz, u, w); vert(q.x, yBot, q.z, -q.nx, 0, -q.nz, u, w); }
      for (let i = 0; i < M; i++) {
        const a = w0 + 2 * i, b = w0 + 2 * ((i + 1) % M);
        idxTop.push(a, a + 1, b, b, a + 1, b + 1);
      }
      const f0 = positions.length / 3;
      const [cu, cv] = footUv(well.x, well.z);
      vert(well.x, yBot, well.z, 0, 1, 0, cu, cv);
      for (const q of hole) { const [u, w] = footUv(q.x, q.z); vert(q.x, yBot, q.z, 0, 1, 0, u, w); }
      for (let i = 0; i < M; i++) idxTop.push(f0, f0 + 1 + ((i + 1) % M), f0 + 1 + i);
      // (winding checked against the wall ring order: see checkWinding in the dev notes; the top cap uses the same test)
    }
  }
  if (capBottom) {
    const p = profile[0], rg = rings[0];
    const centre = vert(0, p.y, 0, 0, -1, 0, 0, 0);
    for (const q of rg) vert(q.x, p.y, q.z, 0, -1, 0, q.x * wallUvScale, q.z * wallUvScale);
    for (let i = 0; i < N; i++) { const a = centre + 1 + i, b = centre + 1 + (i + 1) % N; idxWalls.push(centre, a, b); }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  g.setIndex([...idxWalls, ...idxTop, ...idxRim]);
  g.addGroup(0, idxWalls.length, 0);
  if (idxTop.length) g.addGroup(idxWalls.length, idxTop.length, 1);
  if (idxRim.length) g.addGroup(idxWalls.length + idxTop.length, idxRim.length, 2);
  return g;
}

/**
 * Profile of a slab with a rounded bottom edge (rb), a rounded top edge (rt) and a wall that leans inward by `taper` toward the
 * bottom (a unibody's undercut).  Samples run from the bottom cap edge up to the top cap edge.
 */
export function slabProfile({ height, rb, rt, taper = 0, roundSegs = 6, topSegs = roundSegs }) {
  const prof = [];
  for (let s = 0; s <= roundSegs; s++) {              // bottom round: normal from straight down to horizontal
    const a = (s / roundSegs) * Math.PI / 2;
    prof.push({ inset: taper + rb * (1 - Math.sin(a)), y: rb * (1 - Math.cos(a)), nr: Math.sin(a), ny: -Math.cos(a) });
  }
  const wallH = height - rt - rb;
  const wn = new THREE.Vector2(wallH, taper).normalize();        // outward normal of the leaning wall (radial, vertical)
  prof[prof.length - 1].nr = wn.x; prof[prof.length - 1].ny = wn.y;
  prof.push({ inset: 0, y: height - rt, nr: wn.x, ny: wn.y });
  for (let s = 1; s <= topSegs; s++) {                // top round: normal from horizontal to straight up
    const a = (s / topSegs) * Math.PI / 2;
    prof.push({ inset: rt * (1 - Math.cos(a)), y: height - rt + rt * Math.sin(a), nr: Math.cos(a), ny: Math.sin(a) });
  }
  return prof;
}

/** A low-profile keycap: rounded box whose sides taper in slightly toward the top, sitting on y = 0. */
export function keycapGeometry(w, h, d, radius = 0.0035, taper = 0.06) {
  const g = new RoundedBoxGeometry(w, h, d, 2, radius);
  const pos = g.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i);
    const t = (y + h / 2) / h;
    const k = 1 - taper * t;
    pos.setXYZ(i, pos.getX(i) * k, y + h / 2, pos.getZ(i) * k);
  }
  g.computeVertexNormals();
  return g;
}

/** Flat rounded rectangle in the xz plane facing +y (uv 0..1, v growing toward -z). */
export function roundedPlane(w, d, r, segs = 6) {
  const pts = ring(w / 2, d / 2, r, segs);
  const contour = pts.map((q) => new THREE.Vector2(q.x, q.z));
  const faces = THREE.ShapeUtils.triangulateShape(contour, []);
  const positions = [], uvs = [], index = [];
  for (const v of contour) { positions.push(v.x, 0, v.y); uvs.push(v.x / w + 0.5, 0.5 - v.y / d); }
  for (const [a, b, c] of faces) {
    const A = contour[a], B = contour[b], C = contour[c];
    const cross = (B.x - A.x) * (C.y - A.y) - (B.y - A.y) * (C.x - A.x);
    if (cross < 0) index.push(a, b, c); else index.push(a, c, b);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  g.setIndex(index);
  g.computeVertexNormals();
  return g;
}

/** A thin rounded plate (port opening, foot) lying in the xz plane, facing +y, `h` thick: rounded box with a flat face. */
export function plate(w, d, h, r) {
  return new RoundedBoxGeometry(w, h, d, 2, Math.min(r, w / 2, d / 2, h / 2 - 1e-4));
}
