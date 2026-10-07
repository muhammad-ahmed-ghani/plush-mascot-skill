// Ray-march helper shared by the seam and fold builders.

/** Ray-march an SDF along ±axis from far away toward the origin plane; returns the hit coordinate or NaN. */
export function lift(f, axis, u, v, sign) {
  const at = (t) => (axis === 'x' ? f(t, v, u) : f(u, v, t));       // side view: (u, v) = (z, y); front view: (u, v) = (x, y)
  let t = 2.2 * sign;
  for (let i = 0; i < 500; i++) {
    const d = at(t);
    if (d < 0.0004) return t;
    t -= sign * Math.max(d * 0.7, 0.0008);
    if (sign * t < -0.2) return NaN;
  }
  return NaN;
}

