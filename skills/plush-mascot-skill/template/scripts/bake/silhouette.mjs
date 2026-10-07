// Silhouette rasteriser shared by preview.mjs and fit.mjs.
// The pixel grid matches assets/mascot-transparent.png scaled to `size`
// (350 px/unit at 1254, feet at y = 0, axis at x = 625 * size / 1254).
const REF = 1254, REF_S = 350, REF_X0 = 625, REF_Y0 = 1204;

export const VIEW_YAW = { front: 0, side: Math.PI / 2, back: Math.PI, q3: -0.62, q3r: 0.62 };

export function gridFor(size) {
  return { scale: (REF_S * size) / REF, ox: (REF_X0 * size) / REF, oy: (REF_Y0 * size) / REF };
}

/** Sphere-trace a binary mask (1 = hit). Orthographic camera looking down -z after yawing the model. */
export function renderMask(sdf, view, size, y0 = 0, y1 = size) {
  const { scale, ox, oy } = gridFor(size);
  const yaw = VIEW_YAW[view] ?? 0;
  const cy = Math.cos(yaw), sy = Math.sin(yaw);
  const out = new Uint8Array((y1 - y0) * size);
  for (let py = y0; py < y1; py++) {
    const uy = (oy - (py + 0.5)) / scale;
    if (uy < -0.05 || uy > 3.6) continue;
    for (let px = 0; px < size; px++) {
      const ux = (px + 0.5 - ox) / scale;
      let t = 0;
      for (let i = 0; i < 90; i++) {
        const vz = 5 - t;
        const d = sdf(cy * ux + sy * vz, uy, -sy * ux + cy * vz);
        if (d < 0.004) { out[(py - y0) * size + px] = 1; break; }
        t += Math.max(d * 0.9, 0.004);
        if (t > 10) break;
      }
    }
  }
  return out;
}

export function iou(a, b) {
  let i = 0, u = 0;
  for (let k = 0; k < a.length; k++) {
    const x = a[k], y = b[k];
    i += x & y;
    u += x | y;
  }
  return u ? i / u : 0;
}
