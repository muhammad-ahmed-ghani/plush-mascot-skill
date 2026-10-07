// The hood's seam loop: where the padded frame around the face plate is sewn to the rest of the head.
//
// Measured on assets/mascot-transparent.png (python3 scripts/bake/extract-seams.py and a distance-from-plate ridge profile): a thin
// dark seam runs down each cheek about 0.2 units outside the visible edge of the plate (0.205 on the viewer's left, 0.17-0.2 on the
// right), bending toward the ears at the top and under the jaw at the bottom, and it all but disappears across the crown and
// under the chin.  The loop is the plate's outline offset by that constant distance and laid on the head's front surface.
import { lift } from './lift.mjs';
import { faceOpening } from './model.mjs';

const OFFSET = 0.1922, OFFSET_TOP = 0.31;   // distance outside the plate's visible edge (units): down the cheeks / across the crown
const SIDE = -0.0127;                       // ... and how much nearer the seam lies on the viewer's right than the left (measured: 0.1795 against 0.205; the artwork's head is turned a little)
const TOP = 0.05, BOTTOM = 0.5;            // relative strength across the crown / under the chin (1 = down the cheeks); the artwork has no seam over the crown

const sstep = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

/**
 * @param head  the head field
 * @param p     the parameter table (for the plate's outline)
 * @returns {{ pts: number[][], weights: number[] }}  closed polyline on the head surface (last point repeats the first) and, per
 *          point, how strongly the seam shows.
 */
export function hoodLoop(head, p, n = 240) {
  const F = p.face;
  const pts = [], weights = [];
  for (let k = 0; k < n; k++) {
    const th = (k / n) * Math.PI * 2 - Math.PI;
    const c = Math.cos(th), s = Math.sin(th);
    // the point on the ray from the plate's centre where the outline distance reaches the offset (larger across the crown)
    const up = sstep(0.25, 0.95, Math.abs(s));                    // 0 on the cheeks, 1 at the crown / chin
    const offset = OFFSET + (OFFSET_TOP - OFFSET) * (s > 0 ? up : 0) + SIDE * c * (1 - up);
    let lo = 0.2, hi = 1.6;
    for (let i = 0; i < 40; i++) {
      const mid = (lo + hi) / 2;
      if (faceOpening(F.cx + c * mid, F.cy + s * mid, p) < offset) lo = mid; else hi = mid;
    }
    const r = (lo + hi) / 2, x = F.cx + c * r, y = F.cy + s * r;
    const z = lift(head, 'z', x, y, 1);
    if (Number.isNaN(z)) continue;
    pts.push([x, y, z]);
    const edge = s >= 0 ? TOP : BOTTOM;
    weights.push(1 + (edge - 1) * up);
  }
  pts.push(pts[0].slice()); weights.push(weights[0]);
  return { pts, weights };
}
