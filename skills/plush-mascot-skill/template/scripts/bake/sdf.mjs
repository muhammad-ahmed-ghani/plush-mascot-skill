// Signed-distance-field toolkit used to sculpt Mascot.
// Every function takes plain numbers and returns a number, so the hot loops
// never allocate. Negative = inside the surface. Units are the character's own
// (about 3.3 tall, feet on y = 0, +z toward the viewer).

export const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
export const mix = (a, b, t) => a + (b - a) * t;
export const smoothstep = (a, b, x) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};

/** Polynomial smooth union. k is the blend radius in distance units. */
export function smin(a, b, k) {
  if (k <= 1e-9) return a < b ? a : b;
  const h = Math.max(k - Math.abs(a - b), 0) / k;
  return Math.min(a, b) - h * h * k * 0.25;
}
/** Smooth intersection: rounds convex edges where two solids meet. */
export function smax(a, b, k) {
  return -smin(-a, -b, k);
}

export function sdSphere(x, y, z, r) {
  return Math.sqrt(x * x + y * y + z * z) - r;
}

export function sdEllipsoid(x, y, z, rx, ry, rz) {
  const ax = x / rx, ay = y / ry, az = z / rz;
  const k0 = Math.sqrt(ax * ax + ay * ay + az * az);
  const bx = x / (rx * rx), by = y / (ry * ry), bz = z / (rz * rz);
  const k1 = Math.sqrt(bx * bx + by * by + bz * bz);
  if (k1 < 1e-9) return -Math.min(rx, ry, rz);
  return (k0 * (k0 - 1)) / k1;
}

/** Box with half extents (hx,hy,hz) whose edges are rounded by r. */
export function sdRoundBox(x, y, z, hx, hy, hz, r) {
  const qx = Math.abs(x) - (hx - r), qy = Math.abs(y) - (hy - r), qz = Math.abs(z) - (hz - r);
  const ox = qx > 0 ? qx : 0, oy = qy > 0 ? qy : 0, oz = qz > 0 ? qz : 0;
  return Math.sqrt(ox * ox + oy * oy + oz * oz) + Math.min(Math.max(qx, qy, qz), 0) - r;
}

export function sdCapsule(x, y, z, ax, ay, az, bx, by, bz, r) {
  const pax = x - ax, pay = y - ay, paz = z - az;
  const bax = bx - ax, bay = by - ay, baz = bz - az;
  const h = clamp((pax * bax + pay * bay + paz * baz) / (bax * bax + bay * bay + baz * baz), 0, 1);
  const dx = pax - bax * h, dy = pay - bay * h, dz = paz - baz * h;
  return Math.sqrt(dx * dx + dy * dy + dz * dz) - r;
}

/** Tapered capsule (Inigo Quilez "round cone"): radius r1 at a, r2 at b. */
export function sdRoundCone(x, y, z, ax, ay, az, bx, by, bz, r1, r2) {
  const bax = bx - ax, bay = by - ay, baz = bz - az;
  const l2 = bax * bax + bay * bay + baz * baz;
  const rr = r1 - r2;
  const a2 = l2 - rr * rr;
  const il2 = 1 / l2;
  const pax = x - ax, pay = y - ay, paz = z - az;
  const yy = pax * bax + pay * bay + paz * baz;
  const zz = yy - l2;
  const qx = pax * l2 - bax * yy, qy = pay * l2 - bay * yy, qz = paz * l2 - baz * yy;
  const x2 = qx * qx + qy * qy + qz * qz;
  const y2 = yy * yy * l2;
  const z2 = zz * zz * l2;
  const k = Math.sign(rr) * rr * rr * x2;
  if (Math.sign(zz) * a2 * z2 > k) return Math.sqrt(x2 + z2) * il2 - r2;
  if (Math.sign(yy) * a2 * y2 < k) return Math.sqrt(x2 + y2) * il2 - r1;
  return (Math.sqrt(x2 * a2 * il2) + yy * rr) * il2 - r1;
}

/**
 * Superellipsoid  ((|x/a|^n + |y/b|^n)^(m/n) + |z/c|^m)^(1/m) = 1  - a squircle of exponent n in the xy plane whose
 * depth profile has exponent m (m = 2 is elliptical).  Smooth everywhere for n, m > 2, so unlike a rounded box
 * intersected with an ellipsoid it has no creases.  Returns a first-order distance estimate (F - 1) / |grad F|,
 * with the analytic gradient of the degree-1 homogeneous radial function F.  `mFront` (default m) is the depth exponent used in front
 * of the centre plane: a flatter, squarer face than the round back of the skull.
 */
export function sdSuperEllipsoid(x, y, z, a, b, c, n, m, mFront = m) {
  if (z > 0) m = mFront;                    // F is continuous (and C1) across z = 0 for any exponent, so the front half may be squarer than the back
  const u = Math.abs(x) / a, v = Math.abs(y) / b, w = Math.abs(z) / c;
  const un1 = Math.pow(u, n - 1), vn1 = Math.pow(v, n - 1);
  let P = un1 * u + vn1 * v;
  if (P < 1e-9) P = 1e-9;
  const Pm = Math.pow(P, m / n);
  const wm1 = Math.pow(w, m - 1);
  let Q = Pm + wm1 * w;
  if (Q < 1e-9) Q = 1e-9;
  const F = Math.pow(Q, 1 / m);
  const q = Math.pow(Q, 1 / m - 1), pp = Math.pow(P, m / n - 1);
  const gx = (q * pp * un1) / a, gy = (q * pp * vn1) / b, gz = (q * wm1) / c;
  const g = Math.sqrt(gx * gx + gy * gy + gz * gz);
  return (F - 1) / (g > 1e-6 ? g : 1e-6);
}

/**
 * 2D super-ellipse "squircle" distance estimate. a,b are half axes; n the
 * exponent (2 = ellipse, large = rectangle). First-order distance, accurate
 * near the boundary where it matters.
 */
export function sdSuperEllipse2(x, y, a, b, n) {
  const ax = Math.abs(x) / a, ay = Math.abs(y) / b;
  const px = Math.pow(ax, n), py = Math.pow(ay, n);
  const f = Math.pow(px + py, 1 / n);
  if (f < 1e-6) return -Math.min(a, b);
  // gradient of f wrt x,y (in unit space) to normalise into a distance
  const s = Math.pow(px + py, 1 / n - 1);
  const gx = (s * Math.pow(ax, n - 1)) / a;
  const gy = (s * Math.pow(ay, n - 1)) / b;
  const g = Math.sqrt(gx * gx + gy * gy);
  return (f - 1) / Math.max(g, 1e-6);
}

// ---- rotations -----------------------------------------------------------
// Rotate a point about an axis through the origin. Returns via `out`.
export function rotZ(x, y, a, out) {
  const c = Math.cos(a), s = Math.sin(a);
  out[0] = c * x - s * y;
  out[1] = s * x + c * y;
}

// ---- noise ---------------------------------------------------------------
const perm = new Uint8Array(512);
{
  let s = 1337;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  const p = Array.from({ length: 256 }, (_, i) => i);
  for (let i = 255; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [p[i], p[j]] = [p[j], p[i]];
  }
  for (let i = 0; i < 512; i++) perm[i] = p[i & 255];
}
const fade = (t) => t * t * t * (t * (t * 6 - 15) + 10);
function grad3(h, x, y, z) {
  switch (h & 15) {
    case 0: return x + y; case 1: return -x + y; case 2: return x - y; case 3: return -x - y;
    case 4: return x + z; case 5: return -x + z; case 6: return x - z; case 7: return -x - z;
    case 8: return y + z; case 9: return -y + z; case 10: return y - z; case 11: return -y - z;
    case 12: return x + y; case 13: return -x + y; case 14: return -y + z; default: return -y - z;
  }
}
/** Classic gradient noise, roughly in [-1, 1]. */
export function noise3(x, y, z) {
  const X = Math.floor(x) & 255, Y = Math.floor(y) & 255, Z = Math.floor(z) & 255;
  x -= Math.floor(x); y -= Math.floor(y); z -= Math.floor(z);
  const u = fade(x), v = fade(y), w = fade(z);
  const A = perm[X] + Y, AA = perm[A] + Z, AB = perm[A + 1] + Z;
  const B = perm[X + 1] + Y, BA = perm[B] + Z, BB = perm[B + 1] + Z;
  return mix(
    mix(mix(grad3(perm[AA], x, y, z), grad3(perm[BA], x - 1, y, z), u),
        mix(grad3(perm[AB], x, y - 1, z), grad3(perm[BB], x - 1, y - 1, z), u), v),
    mix(mix(grad3(perm[AA + 1], x, y, z - 1), grad3(perm[BA + 1], x - 1, y, z - 1), u),
        mix(grad3(perm[AB + 1], x, y - 1, z - 1), grad3(perm[BB + 1], x - 1, y - 1, z - 1), u), v),
    w,
  );
}

/** Central-difference gradient of any (x,y,z)=>d field. Writes into out[0..2]. */
export function gradient(f, x, y, z, e, out) {
  out[0] = f(x + e, y, z) - f(x - e, y, z);
  out[1] = f(x, y + e, z) - f(x, y - e, z);
  out[2] = f(x, y, z + e) - f(x, y, z - e);
  return out;
}
