// Geometry helpers for the headphones: surfaces swept around an oval (cups, pads, trim rings, cushions) and a
// rounded-section tube swept along a curve (the headband).  Every surface gets analytic, smooth normals - there are
// no faceted edges and no duplicated seam vertices - plus the 'ao' / 'curv' vertex attributes the felt shader reads.
import * as THREE from 'three';

const smoothstep = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

/** Build an indexed geometry from flat arrays; triangle winding is made to agree with the analytic normals. */
function assemble(pos, nor, ao, index) {
  for (let t = 0; t < index.length; t += 3) {
    const a = index[t] * 3, b = index[t + 1] * 3, c = index[t + 2] * 3;
    const abx = pos[b] - pos[a], aby = pos[b + 1] - pos[a + 1], abz = pos[b + 2] - pos[a + 2];
    const acx = pos[c] - pos[a], acy = pos[c + 1] - pos[a + 1], acz = pos[c + 2] - pos[a + 2];
    const fx = aby * acz - abz * acy, fy = abz * acx - abx * acz, fz = abx * acy - aby * acx;
    const nx = nor[a] + nor[b] + nor[c], ny = nor[a + 1] + nor[b + 1] + nor[c + 1], nz = nor[a + 2] + nor[b + 2] + nor[c + 2];
    if (fx * nx + fy * ny + fz * nz < 0) { const tmp = index[t + 1]; index[t + 1] = index[t + 2]; index[t + 2] = tmp; }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('ao', new THREE.Float32BufferAttribute(ao, 1));
  g.setAttribute('curv', new THREE.Float32BufferAttribute(new Float32Array(ao.length), 1));
  g.setIndex(index);
  return g;
}

/**
 * A surface swept around an oval with half axes `a` (local Y) and `b` (local Z), built along local X.
 * The profile is a list of stations in the (d, x) plane: d = inward offset from the outline along its 2D normal,
 * x = axial position.  A station may give `k` instead of `d`: the last offset curve scaled toward the centre by k
 * (k = 0 collapses to one centre vertex), which keeps faces smooth where a large offset would form cusps.
 * The profile is traversed so that the OUTWARD normal lies to the left of the direction of travel in the (d, x)
 * plane (d to the right, x up); `closed` joins the last station back to the first (a ring / pillow).
 * `ao(station, i, x, y, z)` returns the baked-occlusion value per vertex.
 */
export function ovalSweep(a, b, stations, segs = 72, { closed = false, ao = () => 1, transform } = {}) {
  const pos = [], nor = [], aoArr = [], rings = [];
  let lastD = 0;
  // effective (d, x) per station for the profile tangent
  const eff = stations.map((st) => {
    if (st.d !== undefined) lastD = st.d;
    const k = st.k ?? 1;
    return { d: st.d !== undefined ? st.d : lastD + (1 - k) * (Math.min(a, b) - lastD), x: st.x, k, dOff: lastD };
  });
  const n = eff.length;
  const tangent = (j) => {
    const p = eff[(j - 1 + n) % n], q = eff[(j + 1) % n];
    let dd, dx;
    if (closed) { dd = q.d - p.d; dx = q.x - p.x; }
    else if (j === 0) { dd = eff[1].d - eff[0].d; dx = eff[1].x - eff[0].x; }
    else if (j === n - 1) { dd = eff[n - 1].d - eff[n - 2].d; dx = eff[n - 1].x - eff[n - 2].x; }
    else { dd = q.d - p.d; dx = q.x - p.x; }
    const l = Math.hypot(dd, dx) || 1;
    return [dd / l, dx / l];
  };
  for (let j = 0; j < n; j++) {
    const st = stations[j], e = eff[j];
    const [td, tx] = tangent(j);
    const npd = -tx, npx = td;                 // left normal of the travel direction in (d, x)
    if (e.k === 0) {
      rings.push({ start: pos.length / 3, single: true });
      const v = [st.x, 0, 0], nv = [npx, 0, 0];
      if (transform) transform(v, nv);
      pos.push(...v); nor.push(...nv); aoArr.push(ao(st, 0, ...v));
      continue;
    }
    rings.push({ start: pos.length / 3, single: false });
    for (let i = 0; i < segs; i++) {
      const u = (i / segs) * Math.PI * 2;
      const cy = a * Math.cos(u), cz = b * Math.sin(u);
      let ny = cy / (a * a), nz = cz / (b * b);
      const l = Math.hypot(ny, nz); ny /= l; nz /= l;
      const y = (cy - e.dOff * ny) * e.k, z = (cz - e.dOff * nz) * e.k;
      const v = [st.x, y, z];
      // +d points inward (against the outline normal), so the 3D normal is n_x * X - n_d * (outline normal)
      const nv = [npx, -npd * ny, -npd * nz];
      const ln = Math.hypot(...nv) || 1; nv[0] /= ln; nv[1] /= ln; nv[2] /= ln;
      if (transform) transform(v, nv);
      pos.push(...v); nor.push(...nv); aoArr.push(ao(st, i, ...v));
    }
  }
  const index = [];
  const link = (r0, r1) => {
    if (r0.single && r1.single) return;
    if (r0.single || r1.single) {
      const c = r0.single ? r0.start : r1.start, r = r0.single ? r1 : r0;
      for (let i = 0; i < segs; i++) index.push(c, r.start + i, r.start + (i + 1) % segs);
      return;
    }
    for (let i = 0; i < segs; i++) {
      const i1 = (i + 1) % segs;
      index.push(r0.start + i, r0.start + i1, r1.start + i);
      index.push(r0.start + i1, r1.start + i1, r1.start + i);
    }
  };
  for (let j = 0; j < n - 1; j++) link(rings[j], rings[j + 1]);
  if (closed) link(rings[n - 1], rings[0]);
  return assemble(pos, nor, aoArr, index);
}

/** Quarter-circle fillet stations from (d0, x0) sweeping `steps` points toward (d1, x1); `centre` is the arc centre. */
export function arcStations(centre, radius, angFrom, angTo, steps) {
  const out = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps, ang = angFrom + (angTo - angFrom) * t;
    out.push({ d: centre[0] + radius * Math.cos(ang), x: centre[1] + radius * Math.sin(ang) });
  }
  return out;
}

/**
 * Closed loop of points around a rounded rectangle in a 2D plane, half sizes (hw, ht), corner radius rc,
 * counter-clockwise (so the outward normal is the RIGHT normal of the direction of travel).
 */
export function roundedRectLoop(hw, ht, rc, arcPts = 7, edgePts = 2) {
  rc = Math.min(rc, hw, ht);
  const pts = [];
  const cx = hw - rc, cy = ht - rc;
  const arc = (ccx, ccy, a0) => { for (let i = 0; i <= arcPts; i++) { const a = a0 + (Math.PI / 2) * (i / arcPts); pts.push([ccx + rc * Math.cos(a), ccy + rc * Math.sin(a)]); } };
  const edge = (x0, y0, x1, y1) => { for (let i = 1; i <= edgePts; i++) { const t = i / (edgePts + 1); pts.push([x0 + (x1 - x0) * t, y0 + (y1 - y0) * t]); } };
  arc(cx, -cy, -Math.PI / 2); edge(hw, -cy, hw, cy);          // bottom-right corner, right side going up
  arc(cx, cy, 0); edge(cx, ht, -cx, ht);                       // top-right corner, top edge going left
  arc(-cx, cy, Math.PI / 2); edge(-hw, cy, -hw, -cy);          // top-left corner, left side going down
  arc(-cx, -cy, Math.PI); edge(-cx, -ht, cx, -ht);             // bottom-left corner, bottom edge going right
  return pts;
}

/**
 * Sweep a closed 2D loop along a polyline of stations.  Each station: { p: [x,y,z], N: [x,y,z], B: [x,y,z], loop: [[u, v], ...] }
 * where a loop point maps to p + u * B + v * N.  All loops must have the same length and be CCW in (u, v).
 * `ao(stationIndex, loopIndex, v)` returns occlusion; `extra(stationIndex, loopIndex)` can return a per-vertex vec3 that
 * is collected into `result.extra` (used for the band's flex directions).  Both ends are capped with fans.
 */
export function tubeSweep(stations, { ao = () => 1, extra = null, caps = true } = {}) {
  const pos = [], nor = [], aoArr = [], ex = [];
  const m = stations[0].loop.length, ns = stations.length;
  for (let j = 0; j < ns; j++) {
    const st = stations[j];
    for (let i = 0; i < m; i++) {
      const [u, v] = st.loop[i];
      const [pu, pv] = st.loop[(i - 1 + m) % m], [qu, qv] = st.loop[(i + 1) % m];
      let tu = qu - pu, tv = qv - pv; const l = Math.hypot(tu, tv) || 1; tu /= l; tv /= l;
      const nu = tv, nv = -tu;                        // right normal of a CCW loop = outward
      pos.push(st.p[0] + u * st.B[0] + v * st.N[0], st.p[1] + u * st.B[1] + v * st.N[1], st.p[2] + u * st.B[2] + v * st.N[2]);
      nor.push(nu * st.B[0] + nv * st.N[0], nu * st.B[1] + nv * st.N[1], nu * st.B[2] + nv * st.N[2]);
      aoArr.push(ao(j, i, v));
      if (extra) ex.push(...extra(j, i));
    }
  }
  const index = [];
  for (let j = 0; j < ns - 1; j++) {
    const s0 = j * m, s1 = (j + 1) * m;
    for (let i = 0; i < m; i++) {
      const i1 = (i + 1) % m;
      index.push(s0 + i, s0 + i1, s1 + i);
      index.push(s0 + i1, s1 + i1, s1 + i);
    }
  }
  if (caps) {
    for (const [j, sgn] of [[0, -1], [ns - 1, 1]]) {
      const st = stations[j];
      // fan centre with the tangent as normal
      const T = st.T ?? [0, 0, 0];
      const c = pos.length / 3;
      pos.push(...st.p); nor.push(sgn * T[0], sgn * T[1], sgn * T[2]); aoArr.push(ao(j, 0, 0));
      if (extra) ex.push(...extra(j, 0));
      for (let i = 0; i < m; i++) index.push(c, j * m + i, j * m + (i + 1) % m);
    }
  }
  const g = assemble(pos, nor, aoArr, index);
  return { geometry: g, extra: extra ? new Float32Array(ex) : null };
}

/** Strip UVs and give a stock three.js geometry the neutral felt attributes so it can be merged with the sweeps. */
export function plainAttributes(geometry, aoValue = 1) {
  geometry.deleteAttribute('uv');
  geometry.deleteAttribute('uv1');
  const n = geometry.attributes.position.count;
  geometry.setAttribute('ao', new THREE.BufferAttribute(new Float32Array(n).fill(aoValue), 1));
  geometry.setAttribute('curv', new THREE.BufferAttribute(new Float32Array(n), 1));
  return geometry;
}

/** Cubic Hermite point and tangent. */
export function hermite(p0, t0, p1, t1, s) {
  const s2 = s * s, s3 = s2 * s;
  const h00 = 2 * s3 - 3 * s2 + 1, h10 = s3 - 2 * s2 + s, h01 = -2 * s3 + 3 * s2, h11 = s3 - s2;
  return [h00 * p0[0] + h10 * t0[0] + h01 * p1[0] + h11 * t1[0], h00 * p0[1] + h10 * t0[1] + h01 * p1[1] + h11 * t1[1]];
}

/** Resample a 2D polyline at `count` points spaced evenly by arc length. */
export function resample2(points, count) {
  const cum = [0];
  for (let i = 1; i < points.length; i++) cum.push(cum[i - 1] + Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1]));
  const total = cum[cum.length - 1];
  const out = [];
  let k = 0;
  for (let i = 0; i < count; i++) {
    const s = (i / (count - 1)) * total;
    while (k < cum.length - 2 && cum[k + 1] < s) k++;
    const t = (s - cum[k]) / Math.max(1e-9, cum[k + 1] - cum[k]);
    out.push([points[k][0] + (points[k + 1][0] - points[k][0]) * t, points[k][1] + (points[k + 1][1] - points[k][1]) * t, s / total]);
  }
  return out;
}

export { smoothstep };
