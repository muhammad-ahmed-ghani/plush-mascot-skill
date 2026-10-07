// Geometry over a measured outline.  The artwork's eye whites, cheeks and the like are not ellipses, so their footprints come from the
// polar tables in mascot-face-shapes.js (scripts/dev/fit-face.py) and the felt pieces are built to land on those outlines exactly.
import * as THREE from 'three';

/** Radius of a polar outline (rho[k] at angle 2 pi k / rho.length) at angle `a`, linearly interpolated. */
export function polarRadius(rho, a) {
  const n = rho.length;
  const k = (((a / (2 * Math.PI)) % 1) + 1) % 1 * n;
  const k0 = Math.floor(k) % n, k1 = (k0 + 1) % n, t = k - Math.floor(k);
  return rho[k0] * (1 - t) + rho[k1] * t;
}

/**
 * A pillow over a measured outline, in the unit space of that outline (x / rx, y / ry), so it scales with (rx, ry, height).
 *
 * The height profile is z = (1 - t^n)^(1/n) with t the normalised radius, so the top is flat and only the last few percent of the
 * radius rolls over.  `grow` (units) pushes the rim that far outside the measured outline; the extra band is where a dark contact
 * line is drawn.  Per-vertex attributes for the shaders:
 *   aEdge  distance in units from the measured outline, measured radially and positive INSIDE it (negative in the `grow` band)
 * `neutral` also adds the flat 'ao' / 'curv' attributes that the felt material expects.
 */
export function outlinePillow(shape, { n = 4.6, rings = 20, segs = 72, grow = 0, neutral = false } = {}) {
  const { rho, rx, ry } = shape;
  const pos = [0, 0, 1], uv = [0.5, 0.5], edge = [0], index = [];
  // the centre vertex's edge distance is that of the shortest way out
  edge[0] = Math.min(...rho);
  for (let i = 1; i <= rings; i++) {
    // denser rings toward the rim where the profile bends
    const t = i / rings, s = 1 - Math.pow(1 - t, 1.6);
    const z = Math.pow(Math.max(0, 1 - Math.pow(s, n)), 1 / n);
    for (let j = 0; j < segs; j++) {
      const a = (j / segs) * Math.PI * 2, c = Math.cos(a), sn = Math.sin(a);
      const rim = polarRadius(rho, a);
      const r = s * (rim + grow);                        // distance from the centre, units
      pos.push(r * c / rx, r * sn / ry, z);
      uv.push(0.5 + 0.5 * r * c / rx, 0.5 + 0.5 * r * sn / ry);
      edge.push(rim - r);
    }
  }
  for (let j = 0; j < segs; j++) index.push(0, 1 + j, 1 + ((j + 1) % segs));
  for (let i = 1; i < rings; i++) {
    for (let j = 0; j < segs; j++) {
      const a = 1 + (i - 1) * segs + j, b = 1 + (i - 1) * segs + ((j + 1) % segs), c = 1 + i * segs + j, d = 1 + i * segs + ((j + 1) % segs);
      index.push(a, c, b, b, c, d);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('aEdge', new THREE.Float32BufferAttribute(edge, 1));
  g.setIndex(index);
  g.computeVertexNormals();
  if (neutral) neutralAttributes(g);
  return g;
}

/** The felt material reads baked 'ao' and 'curv' attributes; hand-built shapes have none, so give them a neutral value. */
export function neutralAttributes(geo, count = geo.attributes.position.count) {
  const n = count;
  geo.setAttribute('ao', new THREE.BufferAttribute(new Float32Array(n).fill(1), 1));
  geo.setAttribute('curv', new THREE.BufferAttribute(new Float32Array(n), 1));
  return geo;
}

/**
 * Fit a group that sits on the tilted face plate to the artwork's flat view, so shapes measured on the artwork can be built in the group's
 * x / y (units) and heights in its z directly.  The group's frame is deliberately oblique:
 *  - x / y lie in the plate but are rescaled so that they read as image coordinates: this undoes (a) the foreshortening of the tilted plate
 *    (the plate below the eyes leans away, so a distance along it looks shorter from the front) and (b) the magnification of the distant
 *    camera the artwork is matched from (a piece standing z in front of the body axis plane looks D / (D - z) larger);
 *  - z points at the viewer rather than along the plate's normal, so a dome, an iris or a cord standing h above the plate appears exactly
 *    h above its footprint at the neutral view - the artwork shows the pieces face on, and their outlines and shading were measured that way.
 * From other views everything parallaxes as it should.  Call after the group's position and quaternion are set.
 */
export function fitToArtworkView(group, distance) {
  group.updateMatrix();
  const q = group.quaternion;
  const ex = new THREE.Vector3(1, 0, 0).applyQuaternion(q), ey = new THREE.Vector3(0, 1, 0).applyQuaternion(q);
  const det = ex.x * ey.y - ey.x * ex.y;                                // screen position of local (x, y) is  x * (ex.x, ex.y) + y * (ey.x, ey.y)
  const k = 1 - group.position.z / distance;
  const inv = [ey.y / det, -ey.x / det, -ex.y / det, ex.x / det];       // row-major inverse of [[ex.x, ey.x], [ex.y, ey.y]]
  const v = new THREE.Vector3(0, 0, 1).applyQuaternion(q.clone().invert());      // the direction to the viewer, in the group's own frame
  const S = new THREE.Matrix4().set(
    k * inv[0], k * inv[1], v.x, 0,
    k * inv[2], k * inv[3], v.y, 0,
    0, 0, v.z, 0,
    0, 0, 0, 1);
  group.matrix.multiply(S);
  group.matrixAutoUpdate = false;
  return group;
}
