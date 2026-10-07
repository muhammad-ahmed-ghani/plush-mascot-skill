// Small helpers shared by the prop modules.

export const clamp01 = (x) => Math.min(1, Math.max(0, x));
export const smooth = (x) => { const t = clamp01(x); return t * t * (3 - 2 * t); };
export const easeOutCubic = (x) => 1 - Math.pow(1 - clamp01(x), 3);
/** Ease with a small overshoot at the end (c = overshoot strength). */
export const easeOutBack = (x, c = 1.70158) => { const t = clamp01(x) - 1; return 1 + (c + 1) * t * t * t + c * t * t; };
/** Position of `x` inside the window [a, b], clamped to 0..1. */
export const window01 = (x, a, b) => clamp01((x - a) / (b - a));
