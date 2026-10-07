"""Build Mascot's fabric-nap textures from the artwork.

    python3 scripts/nap/build.py [--out assets] [--size 1024] [--preview DIR]

The plush artwork is the visual master.  This reads its real needle-felt nap (dense, short, hooked
filaments about one pixel wide) out of the flat, evenly lit regions of assets/mascot-transparent.png and
assets/mascot-hero.png, then image-quilts (Efros & Freeman, toroidal, min-error seams) those samples into
seamless tiles whose scale matches the artwork (1 texel = 1/350 character-unit).

Outputs (RGB8, no alpha so browsers cannot premultiply the data):
    mascot-nap-body.png   R,G = tangent-space normal xy   B = filament height (0.5 = mean)
    mascot-nap-face.png    same layout, from the charcoal face fabric
"""
import argparse, json, os, sys
import numpy as np, cv2
from PIL import Image

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..')) + '/'
PX_PER_UNIT = 350.0            # scale of assets/mascot-transparent.png


def load(name):
    return np.array(Image.open(ROOT + 'assets/' + name).convert('RGBA')).astype(np.float32)


def multiplicative_highpass(chan, sigma):
    base = cv2.GaussianBlur(chan, (0, 0), sigma)
    return (chan - base) / (base + 1e-3)


# --------------------------------------------------------------------------------------------------
# source pools
# --------------------------------------------------------------------------------------------------
def edge_energy(g, sigma=3.0):
    gm = cv2.GaussianBlur(g, (0, 0), sigma)
    gx = cv2.Sobel(gm, cv2.CV_32F, 1, 0, ksize=3) / 8
    gy = cv2.Sobel(gm, cv2.CV_32F, 0, 1, ksize=3) / 8
    return np.hypot(gx, gy)


def coherence_map(d, sigma=9.0):
    """Local orientation coherence of the nap (0 = isotropic curly felt, 1 = combed in one direction)."""
    ds = cv2.GaussianBlur(d, (0, 0), 1.0)
    gx = cv2.Sobel(ds, cv2.CV_32F, 1, 0, ksize=3)
    gy = cv2.Sobel(ds, cv2.CV_32F, 0, 1, ksize=3)
    jxx = cv2.GaussianBlur(gx * gx, (0, 0), sigma)
    jyy = cv2.GaussianBlur(gy * gy, (0, 0), sigma)
    jxy = cv2.GaussianBlur(gx * gy, (0, 0), sigma)
    return (np.sqrt((jxx - jyy) ** 2 + 4 * jxy ** 2) / (jxx + jyy + 1e-6)).astype(np.float32)


def band_limit(d, ok):
    """Remove residual mid-frequency blobs (shading remnants) and equalise contrast, keeping only the filaments."""
    d = d - cv2.GaussianBlur(d, (0, 0), 7.0)
    w = ok.astype(np.float32)
    var = cv2.GaussianBlur(d * d * w, (0, 0), 22.0) / (cv2.GaussianBlur(w, (0, 0), 22.0) + 1e-6)
    std = np.sqrt(np.maximum(var, 1e-6))
    d = d / np.maximum(std, np.median(std[ok]) * 0.6)          # flatten local contrast (never boosts flat areas)
    d = d / (d[ok].std() + 1e-6)                                  # unit variance over the clean pixels
    return d.astype(np.float32)


def body_pool(img, scale=1.0, exclude_circles=(), edge_thr=2.6):
    rgb, alpha = img[..., :3], img[..., 3] > 250
    R, G, B = rgb[..., 0], rgb[..., 1], rgb[..., 2]
    body = alpha & (R > 90) & (R > G * 1.3) & (R > B * 1.3)
    inside = cv2.erode(alpha.astype(np.uint8), np.ones((31, 31), np.uint8)) > 0
    bad = cv2.dilate((edge_energy(G) > edge_thr).astype(np.uint8), np.ones((5, 5), np.uint8)) > 0
    # bridge isolated flagged specks (they are nap ridges, not seams)
    bad = cv2.morphologyEx(bad.astype(np.uint8), cv2.MORPH_OPEN, np.ones((7, 7), np.uint8)) > 0
    ok = body & inside & ~bad
    for (cx, cy, r) in exclude_circles:
        yy, xx = np.ogrid[:ok.shape[0], :ok.shape[1]]
        ok &= ((xx - cx) ** 2 + (yy - cy) ** 2) > r * r
    d = band_limit(multiplicative_highpass(G, 5.0), ok)
    return d, ok, scale


def face_pool(img, edge_thr=2.6):
    rgb, alpha = img[..., :3], img[..., 3] > 250
    lum = 0.2126 * rgb[..., 0] + 0.7152 * rgb[..., 1] + 0.0722 * rgb[..., 2]
    dark = alpha & (lum < 95)
    features = alpha & (lum >= 95)
    near_feature = cv2.dilate(features.astype(np.uint8), np.ones((51, 51), np.uint8)) > 0
    # the face plate is the big dark component
    n, lab, st, _ = cv2.connectedComponentsWithStats(dark.astype(np.uint8), connectivity=8)
    big = 1 + np.argmax(st[1:, cv2.CC_STAT_AREA])
    plate = lab == big
    inside = cv2.erode(plate.astype(np.uint8), np.ones((21, 21), np.uint8)) > 0
    ok = inside & ~near_feature
    l = 0.5 * rgb[..., 0] + 0.4 * rgb[..., 1] + 0.1 * rgb[..., 2]
    d = band_limit(multiplicative_highpass(l, 5.0), ok)
    return d, ok, 1.0


def rescale(d, ok, s):
    if abs(s - 1) < 1e-3:
        return d, ok
    h, w = d.shape
    nd = cv2.resize(d, (int(w * s), int(h * s)), interpolation=cv2.INTER_AREA if s < 1 else cv2.INTER_CUBIC)
    nk = cv2.resize(ok.astype(np.uint8), (nd.shape[1], nd.shape[0]), interpolation=cv2.INTER_NEAREST) > 0
    return nd, nk


# --------------------------------------------------------------------------------------------------
# toroidal image quilting
# --------------------------------------------------------------------------------------------------
def dihedral(a):
    out = []
    for k in range(4):
        r = np.rot90(a, k)
        out.append(np.ascontiguousarray(r))
        out.append(np.ascontiguousarray(r[:, ::-1]))
    return out


def seam_v(err):
    """Min-cumulative-error vertical seam through err (rows x cols); returns the seam column per row."""
    h, w = err.shape
    cost = err.copy()
    back = np.zeros((h, w), np.int8)
    for r in range(1, h):
        prev = cost[r - 1]
        left = np.concatenate(([np.inf], prev[:-1]))
        right = np.concatenate((prev[1:], [np.inf]))
        stack = np.stack((left, prev, right))
        idx = np.argmin(stack, axis=0)
        cost[r] += stack[idx, np.arange(w)]
        back[r] = idx - 1
    path = np.zeros(h, np.int32)
    path[-1] = int(np.argmin(cost[-1]))
    for r in range(h - 1, 0, -1):
        path[r - 1] = path[r] + back[r, path[r]]
    return path


def quilt_torus(sources, N=1024, B=80, W=16, seed=1, topk=12, margin=0.10, coh_weight=0.7, log=None):
    """sources: list of (unit-variance detail, valid-mask).  Returns an NxN float32 tile that wraps seamlessly.

    margin: candidates within `margin` x (overlap pixels) of squared error of the best one are equally
    acceptable, so the choice is random among genuinely good matches instead of always the exact continuation.
    """
    S = B - W
    assert N % S == 0, 'N must be a multiple of the block step'
    n = N // S
    rng = np.random.default_rng(seed)
    cands = []
    ones = np.ones((B, B), np.float32)
    for d, ok in sources:
        bad = (~ok).astype(np.float32)
        coh = coherence_map(d.astype(np.float32))
        for dt, bt, ct in zip(dihedral(d.astype(np.float32)), dihedral(bad), dihedral(coh)):
            if dt.shape[0] < B or dt.shape[1] < B:
                continue
            invalid = cv2.matchTemplate(bt, ones, cv2.TM_CCORR) > 0.5
            cohw = cv2.matchTemplate(ct, ones, cv2.TM_CCORR) / float(B * B)      # mean coherence of every window
            if (~invalid).any():
                cands.append((dt, invalid, cohw.astype(np.float32)))
    if not cands:
        raise RuntimeError('no valid source windows; relax the pool masks')
    canvas = np.zeros((N, N), np.float32)
    filled = np.zeros((N, N), bool)
    chosen = {}                                        # (i, j) -> (source id, py, px) for the continuation ban

    def get(a, y, x):
        return np.roll(a, (-y, -x), (0, 1))[:B, :B].copy()

    def put(a, blk, y, x):
        t = np.roll(a, (-y, -x), (0, 1))
        t[:B, :B] = blk
        a[:] = np.roll(t, (y, x), (0, 1))

    cols = np.arange(W)[None, :]
    rows = np.arange(W)[:, None]
    for j in range(n):
        for i in range(n):
            y, x = j * S, i * S
            known = get(filled, y, x)
            old = get(canvas, y, x)
            banned = []
            for (di, dj, dy, dx) in ((-1, 0, 0, S), (1, 0, 0, -S), (0, -1, S, 0), (0, 1, -S, 0)):
                nb = chosen.get(((i + di) % n, (j + dj) % n))
                if nb is not None:
                    banned.append((nb[0], nb[1] + dy, nb[2] + dx))        # where an exact continuation would sit
            if not known.any():
                k = int(rng.integers(len(cands)))
                valid = np.argwhere(~cands[k][1])
                py, px = valid[int(rng.integers(len(valid)))]
            else:
                mask = known.astype(np.float32)
                options = []
                for k, (src, invalid, cohw) in enumerate(cands):
                    res = cv2.matchTemplate(src, old, cv2.TM_SQDIFF, mask=mask)
                    res = res + coh_weight * float(known.sum()) * cohw                # prefer isotropic nap over combed
                    res = np.where(invalid, np.inf, res)
                    for (bk, by, bx) in banned:                                # forbid verbatim continuation
                        if bk == k:
                            y0, y1 = max(0, by - 6), min(res.shape[0], by + 7)
                            x0, x1 = max(0, bx - 6), min(res.shape[1], bx + 7)
                            if y0 < y1 and x0 < x1:
                                res[y0:y1, x0:x1] = np.inf
                    flat = res.ravel()
                    m = min(topk * 4, flat.size - 1)
                    idx = np.argpartition(flat, m)[:m]
                    for q in idx:
                        if np.isfinite(flat[q]):
                            options.append((float(flat[q]), k, tuple(int(v) for v in np.unravel_index(q, res.shape))))
                options.sort(key=lambda t: t[0])
                best = options[0][0]
                tol = best + margin * float(known.sum())
                near = []
                for o in options:                                              # non-max suppression inside a source
                    if o[0] > tol:
                        break
                    if all(not (o[1] == q[1] and abs(o[2][0] - q[2][0]) < 10 and abs(o[2][1] - q[2][1]) < 10) for q in near):
                        near.append(o)
                    if len(near) >= topk:
                        break
                _, k, (py, px) = near[int(rng.integers(len(near)))]
            chosen[(i, j)] = (k, int(py), int(px))
            new = cands[k][0][py:py + B, px:px + B].copy()
            m = np.ones((B, B), np.float32)
            if known[:, :W].all():                                   # left overlap
                p = seam_v((new[:, :W] - old[:, :W]) ** 2)
                m[:, :W] *= (cols >= p[:, None])
            if known[:, B - W:].all():                               # right overlap
                p = seam_v((new[:, B - W:] - old[:, B - W:]) ** 2)
                m[:, B - W:] *= (cols < p[:, None])
            if known[:W, :].all():                                   # top overlap
                p = seam_v(((new[:W, :] - old[:W, :]) ** 2).T)
                m[:W, :] *= (rows >= p[None, :])
            if known[B - W:, :].all():                               # bottom overlap
                p = seam_v(((new[B - W:, :] - old[B - W:, :]) ** 2).T)
                m[B - W:, :] *= (rows < p[None, :])
            blk = np.where(known, old * (1 - m) + new * m, new)                # hard cut: feathering would halve the fibre contrast along the seam
            put(canvas, blk, y, x)
            put(filled, np.ones((B, B), bool), y, x)
        if log:
            log(f'  quilt row {j + 1}/{n}')
    return canvas


# --------------------------------------------------------------------------------------------------
# tile -> texture channels
# --------------------------------------------------------------------------------------------------
def wrap_blur(a, sigma):
    """Gaussian blur that wraps around (OpenCV has no BORDER_WRAP for filters): pad by wrapping, blur, crop."""
    pad = int(sigma * 4) + 2
    p = np.pad(a, pad, mode='wrap')
    p = cv2.GaussianBlur(p, (0, 0), sigma)
    return np.ascontiguousarray(p[pad:-pad, pad:-pad])


def radial_spectrum(windows, nb=40):
    """Mean radial power spectrum of equally sized square windows (Hann-tapered, unit total power)."""
    n = windows[0].shape[0]
    han = np.hanning(n)[:, None] * np.hanning(n)[None, :]
    acc = np.zeros((n, n), np.float64)
    for w in windows:
        w = (w - w.mean()) * han
        acc += np.abs(np.fft.fftshift(np.fft.fft2(w))) ** 2
    fy = (np.arange(n) - n // 2) / n
    r = np.hypot(fy[None, :], fy[:, None])
    edges = np.linspace(0, 0.5, nb + 1)
    which = np.clip(np.digitize(r, edges) - 1, 0, nb - 1)
    spec = np.array([acc[(which == i) & (r <= 0.5)].mean() if ((which == i) & (r <= 0.5)).any() else 0.0 for i in range(nb)])
    return spec / spec.sum(), 0.5 * (edges[1:] + edges[:-1])


def sample_windows(d, ok, n=64, count=400, seed=3):
    """Random n x n windows of d lying entirely on valid pixels (or anywhere, if ok is None)."""
    rng = np.random.default_rng(seed)
    h, w = d.shape
    if ok is not None:
        good = cv2.erode(ok.astype(np.uint8), np.ones((n, n), np.uint8), anchor=(0, 0), borderType=cv2.BORDER_CONSTANT, borderValue=0) > 0
        ys, xs = np.nonzero(good[: h - n, : w - n])
    else:
        ys, xs = rng.integers(0, h - n, count), rng.integers(0, w - n, count)
    pick = rng.choice(len(ys), size=min(count, len(ys)), replace=False)
    return [d[ys[i]:ys[i] + n, xs[i]:xs[i] + n] for i in pick]


def match_spectrum(tile, target_spec, centres, max_gain=4.0, log=None):
    """Re-shape the tile's radial power spectrum to the artwork's (the quilt and the mild blur that removes block noise soften the
    finest filaments; the artwork's nap is thinner and crisper).  Done in the Fourier domain, so the tile stays seamless."""
    win = sample_windows(tile, None)
    have, _ = radial_spectrum(win)
    ratio = np.sqrt(np.maximum(target_spec, 1e-9) / np.maximum(have, 1e-9))
    ratio = np.clip(ratio, 1.0 / max_gain, max_gain)
    k = np.ones(3) / 3
    ratio = np.convolve(np.pad(ratio, 1, mode='edge'), k, mode='valid')                # smooth across neighbouring bins
    n = tile.shape[0]
    fy = np.fft.fftfreq(n)
    fx = np.fft.rfftfreq(n)
    r = np.hypot(fy[:, None], fx[None, :])
    gain = np.interp(r, centres, ratio)
    gain[0, 0] = 1.0
    out = np.fft.irfft2(np.fft.rfft2(tile) * gain, s=tile.shape).astype(np.float32)
    if log:
        log('  spectrum gain by band: ' + ' '.join(f'{g:.2f}' for g in ratio[::4]))
    return out



def default_emphasis(max_gain=2.0):
    """Inverse of the blur of a bilinear fetch, per radial frequency (cycles per texel): linear interpolation attenuates a pattern of
    frequency r by about sinc(r)^2, so boost by the inverse, capped, and let the boost fade out again toward the texel pitch (a boost
    right at Nyquist turns into a visible lattice)."""
    rs = np.linspace(0.0, 0.5, 11)
    resp = np.sinc(rs) ** 2
    taper = np.clip((0.5 - rs) / 0.1, 0.0, 1.0)                     # 1 up to 0.4, then down to 1 at 0.5 (gain 1 = no boost)
    gain = 1.0 + (np.minimum(1.0 / np.maximum(resp, 1e-3), max_gain) - 1.0) * taper
    return [[float(r), float(g)] for r, g in zip(rs, gain)]


def load_emphasis(tag):
    """The emphasis fitted for a tile (scripts/dev/fit-nap-spectrum.py writes scripts/nap/<tag>-emphasis.json).  The charcoal tile falls back to
    the analytic one; the body tile to none."""
    path = ROOT + f'scripts/nap/{tag}-emphasis.json'
    if os.path.exists(path):
        return json.load(open(path))['knots']
    return default_emphasis() if tag == 'face' else None


def emphasize(d, knots):
    """Pre-emphasis that cancels the blur of texture fetches: each radial frequency is scaled by the knots' gain (log-linear between
    them), in the Fourier domain so the tile stays seamless.  On the charcoal plate, where the filaments ARE the texture, the blur
    shows as cloudy blotches instead of the artwork's fine crisp hairs."""
    n = d.shape[0]
    fy, fx = np.fft.fftfreq(n), np.fft.rfftfreq(n)
    r = np.hypot(fy[:, None], fx[None, :])
    rs, gs = zip(*knots)
    gain = np.exp(np.interp(r, rs, np.log(gs)))
    gain[0, 0] = 1.0
    return np.fft.irfft2(np.fft.rfft2(d) * gain, s=d.shape).astype(np.float32)


def to_maps(d, normal_sigma=0.75, normal_strength=2.4, target=None, log=None, emphasis=None):
    """Tile detail -> RGB8: R,G = tangent-space normal xy, B = filament height (centred on 0.5)."""
    d = d - d.mean()
    d = d / (d.std() + 1e-6)
    # Quilting (hard block cuts) and the local-contrast equalisation push the tile toward slightly finer detail than the
    # artwork's own nap (median spatial frequency 0.60 vs 0.55 of Nyquist, evenness 1.97 vs 1.66).  A hair of blur restores it.
    d = wrap_blur(d, 0.62)
    d = d / (d.std() + 1e-6)
    if target is not None:
        d = match_spectrum(d, target[0], target[1], log=log)
        d = d - d.mean()
        d = d / (d.std() + 1e-6)
    if emphasis is not None:
        d = emphasize(d, emphasis)
        d = d - d.mean()
        d = d / (d.std() + 1e-6)
    d = np.clip(d, -4, 4)
    h = wrap_blur(d, normal_sigma)
    gx = (np.roll(h, -1, 1) - np.roll(h, 1, 1)) * 0.5
    gy = (np.roll(h, -1, 0) - np.roll(h, 1, 0)) * 0.5
    nx, ny, nz = -gx * normal_strength * 0.5, -gy * normal_strength * 0.5, np.ones_like(h)
    l = np.sqrt(nx * nx + ny * ny + nz * nz)
    nx, ny = nx / l, ny / l
    height = np.clip(0.5 + d / 5.0, 0, 1)
    rgb = np.stack([(nx * 0.5 + 0.5), (ny * 0.5 + 0.5), height], axis=-1)
    return (np.clip(rgb, 0, 1) * 255 + 0.5).astype(np.uint8), d


def seamless_report(d):
    """Mean abs difference across the wrap seam relative to an interior column pair."""
    seam = np.abs(d[:, 0] - d[:, -1]).mean()
    inner = np.abs(d[:, 500] - d[:, 501]).mean()
    seam_y = np.abs(d[0, :] - d[-1, :]).mean()
    inner_y = np.abs(d[500, :] - d[501, :]).mean()
    return seam / inner, seam_y / inner_y


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--out', default=ROOT + 'assets')
    ap.add_argument('--size', type=int, default=1024)
    ap.add_argument('--preview', default=None)
    ap.add_argument('--seed', type=int, default=1)
    ap.add_argument('--fresh', action='store_true', help='ignore cached quilted tiles')
    ap.add_argument('--no-emphasis', action='store_true', help='build the tiles without the pre-emphasis (see emphasize)')
    ap.add_argument('--only', default=None, choices=['body', 'face'], help='rebuild just one tile')
    args = ap.parse_args()

    transp, hero = load('mascot-transparent.png'), load('mascot-hero.png')
    # the chest X sits near (650, 805) in the neutral artwork; keep it out of the sample pool
    body_srcs = []
    d, ok, _ = body_pool(transp, exclude_circles=[(650, 800, 80)])
    body_srcs.append((d, ok))
    # (the hero is drawn ~30% softer than the neutral art, so it is not used as a source: mixing would blur the nap)
    face_srcs = [face_pool(transp)[:2]]
    for name, s in (('body', body_srcs), ('face', face_srcs)):
        px = sum(int(o.sum()) for _, o in s)
        print(f'{name}: {px} clean source pixels in {len(s)} image(s)')

    os.makedirs(args.out, exist_ok=True)
    for tag, srcs, seed in (('body', body_srcs, args.seed), ('face', face_srcs, args.seed + 11)):
        if args.only and tag != args.only:
            continue
        os.makedirs(ROOT + 'scripts/nap/.cache', exist_ok=True)
        cache = ROOT + f'scripts/nap/.cache/{tag}-{args.size}-{seed}.npy'   # raw quilted tiles: the slow step, kept across runs
        if os.path.exists(cache) and not args.fresh:
            tile = np.load(cache)
            print(f'quilting {tag}: reusing {cache}')
        else:
            print(f'quilting {tag} ...')
            tile = quilt_torus(srcs, N=args.size, seed=seed, log=lambda s: None)
            np.save(cache, tile)
        sx, sy = seamless_report(tile)
        print(f'  wrap-seam / interior neighbour difference: x {sx:.2f}, y {sy:.2f}  (about 1.0 = invisible)')
        wins = [w for (dd, ok) in srcs for w in sample_windows(dd, ok)]
        target = radial_spectrum(wins)
        rgba, d = to_maps(tile, target=target, log=print, emphasis=None if args.no_emphasis else load_emphasis(tag))
        Image.fromarray(rgba, 'RGB').save(f'{args.out}/mascot-nap-{tag}.png', optimize=True)
        print(f'  wrote {args.out}/mascot-nap-{tag}.png  ({os.path.getsize(f"{args.out}/mascot-nap-{tag}.png") / 1024:.0f} KB)')
        if args.preview:
            os.makedirs(args.preview, exist_ok=True)
            v = np.clip(0.5 + d / 6, 0, 1)
            Image.fromarray((v * 255).astype(np.uint8)).save(f'{args.preview}/tile_{tag}.png')
            half = np.roll(v, (args.size // 2, args.size // 2), (0, 1))
            Image.fromarray((half * 255).astype(np.uint8)).save(f'{args.preview}/tile_{tag}_rolled.png')


if __name__ == '__main__':
    main()
