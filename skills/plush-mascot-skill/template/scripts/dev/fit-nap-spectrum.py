"""Fit the charcoal nap tile's frequency emphasis against the artwork.

    python3 scripts/dev/fit-nap-spectrum.py [--iterations 4] [--ppus 350,246,123] [--damping 0.8]

Needs the dev server on :4173 and `python3 scripts/dev/scaled-ref.py` already run (for the rescaled artwork).

The plate's texture is thin, crisp hairs.  The tile carries them, but fetching it at the on-screen density (bilinear taps, mip levels) blurs
the finest ones, and the lighting then shows the softened pattern as cloudy blotches instead of the artwork's crisp hairs.  This renders the
live plate at each density, compares its radial power spectrum over feature-free windows of the plate with the artwork rescaled to the same
density, and adjusts scripts/nap/face-emphasis.json - a gain per radial frequency (cycles per texel) that scripts/nap/build.py applies to the
tile - until the two agree.  Only the SHAPE of the spectrum is fitted (the tile is renormalised to unit variance; the overall contrast is
the `uFaceDetail` uniform's job, and the script prints the change it would take).
"""
import argparse, json, os, subprocess, sys, warnings
warnings.filterwarnings('ignore')
import numpy as np
import cv2
from PIL import Image

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..')) + '/'
EMPHASIS = None             # scripts/nap/<tile>-emphasis.json, set in main()
BODY_PATCHES = {           # world-unit patches (x0, x1, y0, y1) of pure body in the artwork: src/lab-metrics.js
    'belly': [-0.31, 0.32, 0.58, 0.93], 'chest': [-0.43, -0.19, 1.0, 1.38], 'leg': [-0.6, -0.3, 0.3, 0.52],
    'arm': [0.7, 0.9, 0.92, 1.1], 'ear': [0.72, 1.02, 2.95, 3.18], 'crown': [0.14, 0.44, 2.8, 2.95],
}
REFS = ROOT + 'scripts/dev/.refs/'
TMP = ROOT + 'scripts/dev/.fit-tmp/'
KNOTS = [0.0, 0.03, 0.06, 0.09, 0.12, 0.16, 0.20, 0.25, 0.30, 0.35, 0.40, 0.45, 0.50]      # cycles per texel
EDGES = np.geomspace(0.035, 0.5, 11)                                                     # cycles per pixel
ZOOM = {350: 1.0, 246: 1.0845, 123: 1.369}                                              # the nap zoom the controller picks at each density (audit.mjs prints it)


def lum_display(path):
    """Luminance of the DISPLAYED values (sRGB-encoded, 0..255): what the eye compares, and what scripts/dev/tune2.mjs measures."""
    im = np.array(Image.open(path).convert('RGBA')).astype(np.float32)
    return im[..., :3] @ np.array([0.2126, 0.7152, 0.0722], np.float32), im


def body_windows(ref_rgba, ppu, size):
    """Windows wholly inside the body patches (and body in the artwork)."""
    a = ref_rgba[..., 3] > 250
    R, G, B = ref_rgba[..., 0], ref_rgba[..., 1], ref_rgba[..., 2]
    body = (a & (R > 90) & (R > G * 1.3) & (R > B * 1.3)).astype(np.uint8)
    integral = cv2.integral(body)
    H = body.shape[0]
    s = max(4, size // 2)
    wins = []
    for x0, x1, y0, y1 in BODY_PATCHES.values():
        px0, px1 = int(H / 2 + x0 * ppu), int(H / 2 + x1 * ppu)
        py0, py1 = int(H / 2 - (y1 - 1.65) * ppu), int(H / 2 - (y0 - 1.65) * ppu)
        for y in range(py0, py1 - size + 1, s):
            for x in range(px0, px1 - size + 1, s):
                tot = integral[y + size, x + size] - integral[y, x + size] - integral[y + size, x] + integral[y, x]
                if tot == size * size:
                    wins.append((y, x))
    return wins


def plate_windows(ref_rgba, ppu, size):
    """Top-left corners of square windows lying wholly on the plate, away from its edge and from the facial features."""
    a = ref_rgba[..., 3] > 250
    lum = 0.2126 * ref_rgba[..., 0] + 0.7152 * ref_rgba[..., 1] + 0.0722 * ref_rgba[..., 2]
    dark = a & (lum < 95)
    feat = a & (lum >= 95)
    k = max(3, int(round(51 * ppu / 350)) | 1)
    near = cv2.dilate(feat.astype(np.uint8), np.ones((k, k), np.uint8)) > 0
    n, lab, st, _ = cv2.connectedComponentsWithStats(dark.astype(np.uint8), connectivity=8)
    big = 1 + np.argmax(st[1:, cv2.CC_STAT_AREA])
    plate = lab == big
    e = max(3, int(round(21 * ppu / 350)) | 1)
    ok = (cv2.erode(plate.astype(np.uint8), np.ones((e, e), np.uint8)) > 0) & ~near
    # (the hood's edge band and the feature halos are excluded by `near`; also keep clear of the very top, where the seam's shadow reaches)
    ys, xs = np.nonzero(ok)
    n = size
    s = max(4, n // 2)
    wins = []
    integral = cv2.integral(ok.astype(np.uint8))
    for y in range(int(ys.min()), int(ys.max()) - n, s):
        for x in range(int(xs.min()), int(xs.max()) - n, s):
            tot = integral[y + n, x + n] - integral[y, x + n] - integral[y + n, x] + integral[y, x]
            if tot == n * n:
                wins.append((y, x))
    return wins


def band_energy(L, wins, n):
    han = np.hanning(n)[:, None] * np.hanning(n)[None, :]
    fy = np.fft.fftfreq(n)[:, None]; fx = np.fft.fftfreq(n)[None, :]
    r = np.hypot(fx, fy)
    which = np.digitize(r, EDGES) - 1
    acc = np.zeros(len(EDGES) - 1)
    for (y, x) in wins:
        p = L[y:y + n, x:x + n].astype(np.float64)
        p = (p - p.mean()) * han
        F = np.abs(np.fft.fft2(p)) ** 2
        for b in range(len(acc)):
            acc[b] += F[which == b].sum()
    return acc / max(1, len(wins)) / (han ** 2).sum()


def render(ppu, out):
    subprocess.run(['node', ROOT + 'scripts/dev/audit.mjs', '--ppu', str(ppu), '--out', out], check=True, cwd=ROOT, stdout=subprocess.DEVNULL)


def load_knots(tile):
    if os.path.exists(EMPHASIS):
        return json.load(open(EMPHASIS))['knots']
    if tile == 'body':                                   # the body tile ships without emphasis: start flat
        return [[r, 1.0] for r in KNOTS]
    sys.path.insert(0, ROOT + 'scripts/nap')
    import importlib.util
    spec = importlib.util.spec_from_file_location('napbuild', ROOT + 'scripts/nap/build.py')
    m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
    return m.default_emphasis()


def resample(knots):
    rs, gs = zip(*knots)
    return [[r, float(np.exp(np.interp(r, rs, np.log(gs))))] for r in KNOTS]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--tile', default='face', choices=['face', 'body'])
    ap.add_argument('--iterations', type=int, default=4)
    ap.add_argument('--ppus', default='350,246,123')
    ap.add_argument('--damping', type=float, default=0.8)
    ap.add_argument('--min-freq', type=float, default=0.06, help='ignore bands below this many cycles per pixel: that is shading across the window, not texture')
    args = ap.parse_args()
    ppus = [int(p) for p in args.ppus.split(',')]
    global EMPHASIS
    EMPHASIS = ROOT + f'scripts/nap/{args.tile}-emphasis.json'
    weights = {350: 0.2, 246: 0.45, 123: 0.35}          # the page is drawn at ~246 (2x display) or ~123 (1x); 350 is the artwork's own density
    os.makedirs(TMP, exist_ok=True)
    knots = resample(load_knots(args.tile))
    for it in range(args.iterations + 1):
        json.dump({'note': 'scripts/dev/fit-nap-spectrum.py: gain per radial frequency (cycles per texel) applied to this nap tile by scripts/nap/build.py', 'knots': knots}, open(EMPHASIS, 'w'), indent=1)
        subprocess.run([sys.executable, ROOT + 'scripts/nap/build.py', '--only', args.tile], check=True, cwd=ROOT, stdout=subprocess.DEVNULL)
        subprocess.run(['node', ROOT + 'scripts/sync-public.mjs'], check=True, cwd=ROOT, stdout=subprocess.DEVNULL)
        corr = np.zeros(len(KNOTS)); wsum = np.zeros(len(KNOTS))
        report = []
        for ppu in ppus:
            out = TMP + f'live{ppu}.png'
            render(ppu, out)
            live, _ = lum_display(out)
            ref, ref_rgba = lum_display(REFS + f'ref_{ppu}.png')
            size = ref.shape[0]
            n = max(24, int(round(64 * ppu / 350)))
            wins = plate_windows(ref_rgba, ppu, n) if args.tile == 'face' else body_windows(ref_rgba, ppu, n)
            el, er = band_energy(live, wins, n), band_energy(ref, wins, n)
            lr = np.log(np.maximum(el, 1e-12) / np.maximum(er, 1e-12))                     # log energy ratio per pixel-frequency band
            total = np.log(el.sum() / er.sum())
            rc = np.sqrt(EDGES[:-1] * EDGES[1:])                                             # band centres, cycles per pixel
            use = rc >= args.min_freq
            total = np.log(el[use].sum() / er[use].sum())
            shape = lr - total                                                              # the shape only: the level is uFaceDetail's
            rt = rc * ZOOM.get(ppu, 1.0) * ppu / 350.0                                     # ... in cycles per texel
            for b in range(len(rc)):
                if not use[b]:
                    continue
                k = int(np.argmin(np.abs(np.array(KNOTS) - rt[b])))
                if abs(KNOTS[k] - rt[b]) < 0.04:
                    corr[k] += weights.get(ppu, 0.3) * (-0.5 * shape[b]); wsum[k] += weights.get(ppu, 0.3)
            report.append(f'  {ppu:4d} ppu ({len(wins):3d} windows): energy live/ref by band ' + ' '.join(f'{np.exp(v):4.2f}' for v in lr) + f'   | total {np.exp(total):4.2f}  (std ratio {np.exp(total / 2):4.2f})')
        print(f'iteration {it}')
        print('\n'.join(report))
        if it == args.iterations:
            break
        ok = wsum > 0
        corr[ok] /= wsum[ok]
        corr[~ok] = 0.0
        # smooth across neighbouring knots, damp, and apply
        sm = np.convolve(np.pad(corr, 1, mode='edge'), np.array([0.25, 0.5, 0.25]), mode='valid')
        g = np.array([k[1] for k in knots])
        g = np.clip(g * np.exp(args.damping * sm), 0.3, 4.0)
        g[0] = 1.0
        knots = [[KNOTS[i], float(g[i])] for i in range(len(KNOTS))]
        print('  gains: ' + ' '.join(f'{v:4.2f}' for v in g))


if __name__ == '__main__':
    main()
