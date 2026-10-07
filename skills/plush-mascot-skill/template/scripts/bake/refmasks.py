"""Reference silhouettes for the sculpt fitter (scripts/bake/fit.mjs).

    python3 scripts/bake/refmasks.py            # writes scripts/bake/.refs/ref_{front_sym,side}[_band]_{209,418,627}.bin

Front = assets/mascot-transparent.png (alpha).  Profile = the middle figure of assets/mascot-turnaround.png.
Both are resampled onto the preview grid used by preview.mjs / silhouette.mjs (350 px per unit at 1254, feet at
y = 0, symmetry axis at x = 0), symmetrised (the front artwork is 1.3% asymmetric) and turned into boundary bands.
"""
import os
import numpy as np, cv2
from PIL import Image

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..')) + '/'
OUT = ROOT + 'scripts/bake/.refs/'
os.makedirs(OUT, exist_ok=True)
HEIGHT_UNITS = 3.31            # overall character height the artwork is scaled to (ear tips to soles)


def to_grid(mask, N, axis_x, ground_y, s_src):
    """Resample a source mask (s_src px per unit, symmetry axis at axis_x, feet at ground_y) onto the N x N preview grid."""
    scale, ox, oy = 350.0 * N / 1254, 625.0 * N / 1254, 1204.0 * N / 1254
    ux = (np.arange(N) + 0.5 - ox) / scale
    uy = (oy - (np.arange(N) + 0.5)) / scale
    mapx = (axis_x + ux * s_src).astype(np.float32)[None, :].repeat(N, 0)
    mapy = (ground_y - uy * s_src).astype(np.float32)[:, None].repeat(N, 1)
    return cv2.remap(mask.astype(np.float32), mapx, mapy, cv2.INTER_LINEAR, borderValue=0)


def symmetrise(m):
    """Mirror-average a mask by averaging the signed distance to its boundary (so each row ends up at the MEAN of its left and right
    edges; an intersection would keep the narrower side and shrink the fit target by half the artwork's asymmetry)."""
    def sd(x):
        x = x.astype(np.uint8)
        inside = cv2.distanceTransform(x, cv2.DIST_L2, 5)
        outside = cv2.distanceTransform(1 - x, cv2.DIST_L2, 5)
        return inside - outside
    a = sd(m)
    return (((a + a[:, ::-1]) / 2) > 0).astype(np.uint8)


def band(m, N):
    k = max(2, int(round(N * 0.024)))
    ker = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (2 * k + 1, 2 * k + 1))
    return (cv2.dilate(m, ker) - cv2.erode(m, ker)).astype(np.uint8)


def main():
    # ---- front -----------------------------------------------------------------
    a = np.array(Image.open(ROOT + 'assets/mascot-transparent.png').convert('RGBA'))
    al = (a[..., 3] > 128).astype(np.uint8)
    best = None
    for c2 in range(1180, 1340):                      # 2 * axis column
        cols = np.arange(al.shape[1])
        src = c2 - cols
        ok = (src >= 0) & (src < al.shape[1])
        flip = np.zeros_like(al)
        flip[:, cols[ok]] = al[:, src[ok]]
        iou = (al & flip).sum() / max(1, (al | flip).sum())
        if best is None or iou > best[0]:
            best = (iou, c2 / 2)
    axis = best[1]
    ys, xs = np.where(al > 0)
    ground, top = ys.max() + 1, ys.min()
    s_front = (ground - top) / HEIGHT_UNITS
    print(f'front: axis x={axis:.1f}, height {ground - top}px -> {s_front:.1f} px/unit')

    # ---- profile (middle figure of the turnaround) -----------------------------------
    im = np.array(Image.open(ROOT + 'assets/mascot-turnaround.png').convert('RGB')).astype(np.float32)
    R, G, B = im[..., 0], im[..., 1], im[..., 2]
    sat = R - np.minimum(G, B)
    lum = 0.2126 * R + 0.7152 * G + 0.0722 * B
    fg = ((sat > 45) | (lum < 95)).astype(np.uint8)
    fg = cv2.morphologyEx(fg, cv2.MORPH_CLOSE, np.ones((5, 5), np.uint8))
    n, lab, st, _ = cv2.connectedComponentsWithStats(fg, connectivity=8)
    idx = sorted(np.argsort(-st[1:, cv2.CC_STAT_AREA])[:4] + 1, key=lambda i: st[i][0])
    mid = idx[1]
    x, y, w, h, _ = st[mid]
    prof = (lab == mid).astype(np.uint8)
    ff = prof.copy()
    cv2.floodFill(ff, np.zeros((prof.shape[0] + 2, prof.shape[1] + 2), np.uint8), (0, 0), 1)
    prof = (prof | (1 - ff)).astype(np.uint8)
    s_prof = h / HEIGHT_UNITS
    axis_p = x + 0.83 * s_prof                         # head-centre depth measured from the profile's front-most extent
    print(f'profile: bbox {x},{y},{w},{h}  {s_prof:.1f} px/unit')

    for N in (209, 418, 627):
        front = (to_grid(al, N, axis, ground, s_front) > 0.5).astype(np.uint8)
        front = symmetrise(front)
        side = (to_grid(prof, N, axis_p, y + h, s_prof) > 0.5).astype(np.uint8)
        front.tofile(f'{OUT}ref_front_sym_{N}.bin')
        side.tofile(f'{OUT}ref_side_{N}.bin')
        band(front, N).tofile(f'{OUT}ref_front_sym_band_{N}.bin')
        band(side, N).tofile(f'{OUT}ref_side_band_{N}.bin')
    print('wrote', OUT)


if __name__ == '__main__':
    main()
