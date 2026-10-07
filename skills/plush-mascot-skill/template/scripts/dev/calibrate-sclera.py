"""Calibrate the shading of the eye whites against the artwork.

    node scripts/dev/audit.mjs --ppu 350 --size 1467 --out /tmp/live350.png
    python3 scripts/dev/calibrate-sclera.py /tmp/live350.png          # repeat until the reported error stops shrinking

The eye whites are small, always seen face on and shaded softly and unevenly in the artwork (warm in the shade of the top and outer edge, lit
toward the lower inside).  Lighting a dome reproduces the trend but not the painting, so this measures what is left: the ratio of the
artwork's light to the live render's, over the white of each eye (away from its rim, which has its own measured ramp, and from the iris),
smoothed and stored as a small image in the eye's own unit frame (x / rx, y / ry).  The shader multiplies the displayed light by it.
Each run folds its correction into the existing map, so repeating it converges; run it after anything that changes the whites' lighting.

Writes assets/mascot-sclera-shade.png (R = the viewer's-right eye, G = the viewer's-left eye; 128 = 1.0, ratio = 0.5 + v / 255) - 64 x 64 texels
covering the unit frame from -1.25 to 1.25.
"""
import json, os, re, sys, warnings
warnings.filterwarnings('ignore')
import numpy as np
import cv2
from PIL import Image

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..')) + '/'
S, AX, AY = 350.0, 627.5, 1204.0
SIZE, EXTENT = 64, 1.25
OUT = ROOT + 'assets/mascot-sclera-shade.png'


def load_shapes():
    src = open(ROOT + 'src/mascot-face-shapes.js').read()
    return json.loads(src[src.index('export const FACE_SHAPES = ') + len('export const FACE_SHAPES = '):].rstrip().rstrip(';'))


def lin(a):
    c = a[..., :3] / 255.0
    return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4).astype(np.float32)


def aligned(path, size=1467, ppu=350.0, ty=1.65):
    """The audit render (audit.mjs --ppu 350 --size 1467) cut to the artwork's 1254 px frame."""
    r = np.array(Image.open(path).convert('RGBA')).astype(np.float32)
    assert r.shape[0] == size, r.shape
    dx = int(round(size / 2 - AX)); dy = int(round(size / 2 + ty * ppu - AY))
    return r[dy:dy + 1254, dx:dx + 1254].copy()


def normalized_blur(values, weight, sigma):
    num = cv2.GaussianBlur(values * weight, (0, 0), sigma)
    den = cv2.GaussianBlur(weight, (0, 0), sigma)
    return num / np.maximum(den, 1e-6), den


def main():
    art = np.array(Image.open(ROOT + 'assets/mascot-transparent.png').convert('RGBA')).astype(np.float32)
    live = aligned(sys.argv[1])
    shapes = load_shapes()
    # reuse the fit script's masks and helpers
    import importlib.util
    spec = importlib.util.spec_from_file_location('fitface', ROOT + 'scripts/dev/fit-face.py')
    ff = importlib.util.module_from_spec(spec); spec.loader.exec_module(ff)
    H, W = art.shape[:2]
    la, ll = lin(art).mean(axis=2), lin(live).mean(axis=2)
    lum_a = lin(art) @ np.array([0.2126, 0.7152, 0.0722], np.float32)
    lum_l = lin(live) @ np.array([0.2126, 0.7152, 0.0722], np.float32)
    old = np.array(Image.open(OUT)) if os.path.exists(OUT) else None
    maps = np.full((SIZE, SIZE, 3), 128, np.uint8) if old is None else old.copy()
    report = []
    for ch, (tag, cream_at) in enumerate((('L', (0.523, 2.129)), ('R', (-0.436, 2.136)))):
        f = shapes['eye'][tag]
        outline = ff.polygon_mask(f)
        cream = ff.eye_mask(*cream_at)
        parts = ff.iris_parts(cream)
        # everything that is not the white: the iris (with its outline), the pupil, the catchlight
        iris = np.zeros((H, W), np.uint8)
        for k in ('iris', 'pupil', 'glint'):
            e = parts[k]
            cv2.ellipse(iris, (int(round(AX + e['cx'] * S)), int(round(AY - e['cy'] * S))), (int(e['w'] / 2 * S) + 4, int(e['h'] / 2 * S) + 4), 0, 0, 360, 1, -1)
        inside = cv2.distanceTransform(outline.astype(np.uint8), cv2.DIST_L2, 5) / S
        ok = (outline & (inside > 0.02) & (iris == 0)).astype(np.float32)
        ratio = np.clip((lum_a + 1e-4) / (lum_l + 1e-4), 0.4, 2.5).astype(np.float32)
        smooth, den = normalized_blur(ratio, ok, 0.02 * S)
        wide, _ = normalized_blur(ratio, ok, 0.07 * S)
        fill = np.where(den > 0.08, smooth, wide)
        # sample on the unit-frame grid
        g = (np.arange(SIZE) + 0.5) / SIZE * 2 * EXTENT - EXTENT
        gx, gy = np.meshgrid(g, -g)                         # rows run downward
        mx = (AX + (f['cx'] + gx * f['rx']) * S - 0.5).astype(np.float32)
        my = (AY - (f['cy'] + gy * f['ry']) * S - 0.5).astype(np.float32)
        grid = cv2.remap(np.ascontiguousarray(fill), mx, my, cv2.INTER_LINEAR, borderMode=cv2.BORDER_REPLICATE)
        # the error being removed: mean |log ratio| over the white
        err = float(np.mean(np.abs(np.log(ratio[ok > 0]))))
        report.append(f'eye {tag}: mean |log(art / live)| over the white = {err:.3f}   correction range {grid.min():.2f} .. {grid.max():.2f}')
        prev = (maps[..., ch].astype(np.float32) / 255.0 + 0.5) if old is not None else np.ones((SIZE, SIZE), np.float32)
        new = np.clip(prev * np.clip(grid, 0.6, 1.6) ** 0.9, 0.5, 1.5)                 # (a damped step: the correction is measured through the tone curve)
        maps[..., ch] = np.clip((new - 0.5) * 255 + 0.5, 0, 255).astype(np.uint8)
    Image.fromarray(maps, 'RGB').save(OUT, optimize=True)
    print('\n'.join(report)); print('wrote', OUT)


if __name__ == '__main__':
    main()
