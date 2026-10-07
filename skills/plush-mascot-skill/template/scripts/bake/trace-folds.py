"""Trace the plush's soft construction folds from the neutral artwork as world-space polylines.

    python3 scripts/bake/trace-folds.py [--preview]

Stitched seams are thin and easy to find (extract-seams.py).  The soft folds - the belly's lower edge where it overhangs the legs,
the creases around the hips - are broad and faint, so instead of thresholding they are traced: for each fold we give a few
waypoints read off the artwork (world units, feet at y = 0, +x = viewer's right) and follow the strongest dark-crease ridge
between them with a minimum-cost path.  The output, scripts/bake/.seams/folds.json, is consumed by scripts/bake/folds.mjs.
"""
import argparse, heapq, json, os, warnings
warnings.filterwarnings('ignore')
import numpy as np, cv2
from PIL import Image, ImageDraw

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..')) + '/'
AX, GY, S = 627.5, 1204.0, 349.8        # neutral artwork registration (see refmasks.py): x = 0 column, feet row, pixels per unit

# name -> waypoints (x, y) in world units.  Read off the ridge map of assets/mascot-transparent.png (sigma 5 px, dark creases).
FOLDS = {
    # the belly's lower edge: from the left hip, under the belly, to the right hip
    'belly': [(-0.64, 0.64), (-0.52, 0.44), (-0.30, 0.345), (0.0, 0.325), (0.30, 0.345), (0.52, 0.44), (0.64, 0.62)],
}

FIT_POLY = {'belly': 6}          # polynomial order for folds that are a smooth function y(x)


def ridge(L, sigma):
    g = cv2.GaussianBlur(L, (0, 0), sigma)
    gxx = cv2.Sobel(g, cv2.CV_32F, 2, 0, ksize=5)
    gyy = cv2.Sobel(g, cv2.CV_32F, 0, 2, ksize=5)
    gxy = cv2.Sobel(g, cv2.CV_32F, 1, 1, ksize=5)
    return np.clip((gxx + gyy) * 0.5 + np.sqrt(((gxx - gyy) * 0.5) ** 2 + gxy ** 2), 0, None)


def dijkstra(cost, start, goal, corridor):
    h, w = cost.shape
    dist = np.full((h, w), np.inf, np.float64)
    prev = np.full((h, w, 2), -1, np.int32)
    dist[start] = 0
    pq = [(0.0, start)]
    nbrs = [(-1, -1, 1.414), (-1, 0, 1), (-1, 1, 1.414), (0, -1, 1), (0, 1, 1), (1, -1, 1.414), (1, 0, 1), (1, 1, 1.414)]
    while pq:
        d, (y, x) = heapq.heappop(pq)
        if (y, x) == goal:
            break
        if d > dist[y, x]:
            continue
        for dy, dx, step in nbrs:
            ny, nx = y + dy, x + dx
            if 0 <= ny < h and 0 <= nx < w and corridor[ny, nx]:
                nd = d + step * cost[ny, nx]
                if nd < dist[ny, nx]:
                    dist[ny, nx] = nd
                    prev[ny, nx] = (y, x)
                    heapq.heappush(pq, (nd, (ny, nx)))
    path, cur = [], goal
    while cur != (-1, -1) and tuple(cur) != start:
        path.append(cur)
        cur = tuple(prev[cur])
    path.append(start)
    return path[::-1]


def smooth(pts, step=0.012, win=11):
    a = np.array(pts, np.float64)
    k = np.ones(win) / win
    a = np.stack([np.convolve(np.pad(a[:, i], win // 2, mode='edge'), k, mode='valid') for i in (0, 1)], 1)
    d = np.r_[0, np.cumsum(np.hypot(*np.diff(a, axis=0).T))]
    t = np.arange(0, d[-1], step)
    return np.stack([np.interp(t, d, a[:, 0]), np.interp(t, d, a[:, 1])], 1)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--out', default=ROOT + 'scripts/bake/.seams')
    ap.add_argument('--preview', action='store_true')
    ap.add_argument('--sigma', type=float, default=5.0)
    args = ap.parse_args()
    os.makedirs(args.out, exist_ok=True)
    im = Image.open(ROOT + 'assets/mascot-transparent.png').convert('RGBA')
    a = np.array(im).astype(np.float32)
    L = 0.2126 * a[..., 0] + 0.7152 * a[..., 1] + 0.0722 * a[..., 2]
    r = ridge(L, args.sigma)
    r = r / np.percentile(r[a[..., 3] > 250], 99.0)
    # costs: cheap along strong dark ridges, expensive elsewhere (never zero, so the path stays short and smooth)
    cost = 1.0 / (0.05 + np.clip(r, 0, 1.5)) ** 1.5
    to_px = lambda p: (int(round(GY - p[1] * S)), int(round(AX + p[0] * S)))          # (row, col)
    out = {}
    for name, way in FOLDS.items():
        full = []
        for p0, p1 in zip(way[:-1], way[1:]):
            s, g = to_px(p0), to_px(p1)
            corridor = np.zeros(cost.shape, bool)
            # stay within a tube around the straight segment between waypoints
            n = 60
            for t in np.linspace(0, 1, n):
                cy = int(round(s[0] + (g[0] - s[0]) * t)); cx = int(round(s[1] + (g[1] - s[1]) * t))
                cv2.circle(corridor.view(np.uint8), (cx, cy), 26, 1, -1)
            seg = dijkstra(cost, s, g, corridor)
            full += seg if not full else seg[1:]
        pts = np.array([[(c - AX) / S, (GY - r_) / S] for r_, c in full])
        # the traced ridge is noisy (it follows individual fibres); the fold itself is a smooth arc, so fit y(x) with a low-order polynomial
        if FIT_POLY.get(name):
            c = np.polyfit(pts[:, 0], pts[:, 1], FIT_POLY[name])
            xs = np.arange(pts[:, 0].min(), pts[:, 0].max(), 0.012)
            pts = np.stack([xs, np.polyval(c, xs)], 1)
        else:
            pts = smooth(pts)
        out[name] = pts.round(4).tolist()
        print(f'{name}: {len(pts)} points, length {np.hypot(*np.diff(pts, axis=0).T).sum():.2f} units')
    json.dump(out, open(args.out + '/folds.json', 'w'))
    if args.preview:
        vis = im.convert('RGB').copy()
        d = ImageDraw.Draw(vis)
        for name, pts in out.items():
            d.line([(AX + x * S, GY - y * S) for x, y in pts], fill=(0, 255, 190), width=2)
        vis.crop((int(AX - 0.95 * S), int(GY - 1.3 * S), int(AX + 0.95 * S), int(GY))).save(args.out + '/preview_folds.png')


if __name__ == '__main__':
    main()
