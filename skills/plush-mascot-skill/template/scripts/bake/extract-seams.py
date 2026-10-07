"""Extract the plush construction seams from the character artwork as world-space polylines.

    python3 scripts/bake/extract-seams.py [--out scripts/bake/.seams] [--preview]

For every view (neutral front, and the turnaround's front / profile / back) this:
  1. finds dark thin creases with a scale-selected Hessian ridge filter on the body fabric, away from silhouettes and features,
  2. thresholds with hysteresis, thins to 1px skeletons, and walks each skeleton into an ordered path,
  3. converts pixels to character units (the same frame as scripts/bake/model.mjs: feet at y = 0, +z toward the viewer),
  4. writes  <out>/seams_<view>.json  (candidate polylines with ids) and, with --preview, an overlay PNG with a unit grid so the
     candidates worth keeping can be picked by id in scripts/bake/seams.mjs.

The view registration constants come from scripts/bake/refmasks.py (front) and the silhouette fit (turnaround figures).
"""
import argparse, json, os, warnings
warnings.filterwarnings('ignore')
import numpy as np, cv2
from PIL import Image, ImageDraw

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..')) + '/'


def thin(mask):
    """Zhang-Suen thinning on a boolean mask (small images only)."""
    img = mask.astype(np.uint8).copy()
    changed = True
    while changed:
        changed = False
        for step in (0, 1):
            p = np.pad(img, 1)
            P2, P3, P4, P5, P6, P7, P8, P9 = p[:-2, 1:-1], p[:-2, 2:], p[1:-1, 2:], p[2:, 2:], p[2:, 1:-1], p[2:, :-2], p[1:-1, :-2], p[:-2, :-2]
            nb = P2 + P3 + P4 + P5 + P6 + P7 + P8 + P9
            seq = np.stack([P2, P3, P4, P5, P6, P7, P8, P9, P2], -1)
            trans = ((seq[..., :-1] == 0) & (seq[..., 1:] == 1)).sum(-1)
            if step == 0:
                c = (P2 * P4 * P6 == 0) & (P4 * P6 * P8 == 0)
            else:
                c = (P2 * P4 * P8 == 0) & (P2 * P6 * P8 == 0)
            rm = (img == 1) & (nb >= 2) & (nb <= 6) & (trans == 1) & c
            if rm.any():
                img[rm] = 0
                changed = True
    return img.astype(bool)


def walk(skel):
    """Turn a thinned component into ordered paths (longest path between endpoints, greedy)."""
    ys, xs = np.where(skel)
    pts = set(zip(ys.tolist(), xs.tolist()))
    if len(pts) < 8:
        return []

    def nbrs(p):
        y, x = p
        return [(y + dy, x + dx) for dy in (-1, 0, 1) for dx in (-1, 0, 1) if (dy or dx) and (y + dy, x + dx) in pts]

    ends = [p for p in pts if len(nbrs(p)) == 1] or [next(iter(pts))]
    best = []
    for s in ends[:12]:
        seen = {s}
        path = [s]
        cur = s
        while True:
            nx = [q for q in nbrs(cur) if q not in seen]
            if not nx:
                break
            # prefer the neighbour that keeps going straight
            if len(path) > 3:
                dy, dx = path[-1][0] - path[-4][0], path[-1][1] - path[-4][1]
                nx.sort(key=lambda q: -((q[0] - cur[0]) * dy + (q[1] - cur[1]) * dx))
            cur = nx[0]
            seen.add(cur)
            path.append(cur)
        if len(path) > len(best):
            best = path
    return [(x, y) for y, x in best]


def smooth_resample(path, step=6.0, win=9):
    a = np.array(path, np.float32)
    if len(a) < win:
        return a
    k = np.ones(win) / win
    a = np.stack([np.convolve(np.pad(a[:, i], win // 2, mode='edge'), k, mode='valid') for i in (0, 1)], 1)
    d = np.r_[0, np.cumsum(np.hypot(*np.diff(a, axis=0).T))]
    t = np.arange(0, d[-1], step)
    return np.stack([np.interp(t, d, a[:, 0]), np.interp(t, d, a[:, 1])], 1)


def ridge(L, sigma):
    g = cv2.GaussianBlur(L, (0, 0), sigma)
    gxx = cv2.Sobel(g, cv2.CV_32F, 2, 0, ksize=5)
    gyy = cv2.Sobel(g, cv2.CV_32F, 0, 2, ksize=5)
    gxy = cv2.Sobel(g, cv2.CV_32F, 1, 1, ksize=5)
    l1 = (gxx + gyy) * 0.5 + np.sqrt(((gxx - gyy) * 0.5) ** 2 + gxy ** 2)          # >0 across dark creases
    return np.clip(l1, 0, None)


def candidates(rgb, body, exclude, sigma, hi_pct, lo_pct, min_len, inner_px):
    L = 0.2126 * rgb[..., 0] + 0.7152 * rgb[..., 1] + 0.0722 * rgb[..., 2]
    r = ridge(L, sigma)
    inner = cv2.erode(body.astype(np.uint8), np.ones((inner_px, inner_px), np.uint8)) > 0
    ok = inner & ~exclude
    hi, lo = np.percentile(r[ok], hi_pct), np.percentile(r[ok], lo_pct)
    strong = (r > hi) & ok
    weak = (r > lo) & ok
    n, lab = cv2.connectedComponents(weak.astype(np.uint8), connectivity=8)
    keep = np.zeros_like(weak)
    for i in range(1, n):
        comp = lab == i
        if (comp & strong).any():
            keep |= comp
    keep = cv2.morphologyEx(keep.astype(np.uint8), cv2.MORPH_CLOSE, np.ones((3, 3), np.uint8)) > 0
    n, lab, st, _ = cv2.connectedComponentsWithStats(keep.astype(np.uint8), connectivity=8)
    paths = []
    for i in range(1, n):
        if max(st[i, cv2.CC_STAT_WIDTH], st[i, cv2.CC_STAT_HEIGHT]) < min_len:
            continue
        sk = thin(lab == i)
        p = walk(sk)
        if len(p) >= min_len * 0.8:
            paths.append(smooth_resample(p))
    return paths, r


VIEWS = {
    # name: (image, crop box (x0,y0,x1,y1), pixel->world: x = (px - ax) / s, y = (gy - py) / s   [front/back]   or   z = (ax - px) / s [profile])
    'neutral': dict(img='assets/mascot-transparent.png', crop=None, ax=627.5, gy=1204.0, s=349.8, kind='front', sigma=3.4, hi=97.0, lo=93.0, min_len=44, inner=17),
    # soft folds (belly over the legs, hip and leg creases): a coarser ridge scale, so the fibre-scale nap does not register
    'neutral_fold': dict(img='assets/mascot-transparent.png', crop=None, ax=627.5, gy=1204.0, s=349.8, kind='front', sigma=6.0, hi=98.0, lo=95.0, min_len=70, inner=25),
    't_front': dict(img='assets/mascot-turnaround.png', crop=(20, 120, 570, 870), ax=292.5, gy=842.0, s=210.3, kind='front', sigma=2.4, hi=97.0, lo=93.5, min_len=30, inner=13),
    't_side': dict(img='assets/mascot-turnaround.png', crop=(575, 120, 985, 870), ax=776.0, gy=845.0, s=213.3, kind='side', sigma=2.4, hi=97.0, lo=93.5, min_len=30, inner=13),
    't_back': dict(img='assets/mascot-turnaround.png', crop=(985, 120, 1520, 870), ax=1242.5, gy=840.0, s=210.0, kind='back', sigma=2.4, hi=97.0, lo=93.5, min_len=30, inner=13),
}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--out', default=ROOT + 'scripts/bake/.seams')
    ap.add_argument('--preview', action='store_true')
    args = ap.parse_args()
    os.makedirs(args.out, exist_ok=True)
    for name, v in VIEWS.items():
        im = Image.open(ROOT + v['img']).convert('RGBA')
        a = np.array(im).astype(np.float32)
        x0, y0, x1, y1 = v['crop'] or (0, 0, a.shape[1], a.shape[0])
        sub = a[y0:y1, x0:x1]
        rgb = sub[..., :3]
        R, G, B = rgb[..., 0], rgb[..., 1], rgb[..., 2]
        alpha_ok = sub[..., 3] > 250
        body = alpha_ok & (R > 90) & (R > G * 1.2) & (R > B * 1.2)
        L = 0.2126 * R + 0.7152 * G + 0.0722 * B
        # keep away from the face plate, eyes and the chest X: everything that is opaque but not body, dilated, plus a disc at the X
        feature = alpha_ok & ~body
        feature = cv2.dilate(feature.astype(np.uint8), np.ones((21, 21), np.uint8)) > 0
        if v['kind'] in ('front', 'back'):
            xc = (v['ax'] + 0.02 * v['s']) - x0
            yc = (v['gy'] - 1.164 * v['s']) - y0
            cv2.circle(feature_u8 := feature.astype(np.uint8), (int(xc), int(yc)), int(0.17 * v['s']), 1, -1)
            feature = feature_u8 > 0
        paths, r = candidates(rgb, body, feature, v['sigma'], v['hi'], v['lo'], v['min_len'], v['inner'])
        out = []
        for pid, p in enumerate(paths):
            px = p[:, 0] + x0
            py = p[:, 1] + y0
            if v['kind'] == 'side':
                u = (v['ax'] - px) / v['s']                    # z: the character faces LEFT in the profile, so +z is to the left
            else:
                u = (px - v['ax']) / v['s']                    # x (the back view is mirrored: viewer's right = character's left)
                if v['kind'] == 'back':
                    u = -u
            y = (v['gy'] - py) / v['s']
            out.append({'id': pid, 'pts': [[round(float(a_), 4), round(float(b_), 4)] for a_, b_ in zip(u, y)]})
        json.dump({'view': name, 'kind': v['kind'], 'paths': out}, open(f'{args.out}/seams_{name}.json', 'w'))
        print(f'{name:8s} {len(out)} candidate seams')
        if args.preview:
            ov = im.convert('RGB').crop((x0, y0, x1, y1)).copy()
            d = ImageDraw.Draw(ov)
            for pid, p in enumerate(paths):
                d.line([tuple(q) for q in p.tolist()], fill=(0, 255, 190), width=2)
                mid = p[len(p) // 2]
                d.text((mid[0] + 4, mid[1]), str(pid), fill=(255, 255, 0))
            z = 2
            ov = ov.resize((ov.width * z, ov.height * z), Image.LANCZOS)
            d = ImageDraw.Draw(ov)
            for u in np.arange(-2.0, 2.01, 0.5):                       # unit grid
                px = (v['ax'] - x0 - (u * v['s'] if v['kind'] == 'side' else -u * v['s'] if v['kind'] == 'back' else -u * v['s'] * -1)) * z
                px = ((v['ax'] + (-u if v['kind'] in ('side', 'back') else u) * v['s']) - x0) * z
                d.line([(px, 0), (px, ov.height)], fill=(90, 90, 255), width=1)
                d.text((px + 3, 3), f'{u:+.1f}', fill=(90, 90, 255))
            for yv in np.arange(0.0, 3.6, 0.5):
                py = (v['gy'] - yv * v['s'] - y0) * z
                d.line([(0, py), (ov.width, py)], fill=(90, 90, 255), width=1)
                d.text((3, py + 2), f'{yv:.1f}', fill=(90, 90, 255))
            ov.save(f'{args.out}/preview_{name}.png')


if __name__ == '__main__':
    main()
