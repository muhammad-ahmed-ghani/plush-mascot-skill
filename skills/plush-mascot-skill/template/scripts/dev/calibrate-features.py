"""Calibrate the colour of the mouth, cheeks and eye whites against the artwork.

    node scripts/dev/audit.mjs --ppu 350 --out /tmp/live350.png
    python3 scripts/dev/calibrate-features.py /tmp/live350.png [--apply]

Uses identical windows in the artwork (assets/mascot-transparent.png, scaled to 350 ppu) and the live render, keeps the pixels that
belong to the feature (not the charcoal ground, not the body hood, not the eye pupils) and compares their mean linear RGB.
--apply multiplies FEATURE_GAIN in src/mascot-face.js by a damped correction; repeat until the ratios are ~1.00.
"""
import re, sys, os, warnings
warnings.filterwarnings('ignore')
import numpy as np, cv2
from PIL import Image

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..')) + '/'
S, PPU, TY = 1470, 350.0, 1.65


def load(p):
    return np.array(Image.open(p).convert('RGBA')).astype(np.float32)


def lin(c):
    c = c / 255.0
    return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)


def box(x0, x1, y0, y1):
    return int(S / 2 + x0 * PPU), int(S / 2 + x1 * PPU), int(S / 2 - (y1 - TY) * PPU), int(S / 2 - (y0 - TY) * PPU)


def lum(a):
    return 0.2126 * a[..., 0] + 0.7152 * a[..., 1] + 0.0722 * a[..., 2]


def feature_pixels(a, kind):
    rgb = a[..., :3]
    R, G, B, L = rgb[..., 0], rgb[..., 1], rgb[..., 2], lum(a)
    if kind == 'sclera':                                     # cream, bright, low saturation
        return (a[..., 3] > 250) & (L > 165) & (R > 185) & (G > 150) & (B > 120) & (L < 248)
    # salmon: red-dominant, mid luminance, and NOT the deeper body hood (which has G,B < 80)
    if kind == 'cheek':                                       # dimmer than the mouth under some lights, so a looser floor
        return (a[..., 3] > 250) & (R > 120) & (G > 60) & (B > 50) & (R - G > 35) & (L > 70) & (G > 0.42 * R)
    return (a[..., 3] > 250) & (R > 160) & (G > 88) & (G < 155) & (B > 74) & (B < 150) & (R - G > 45) & (L > 105)


WINDOWS = {
    'mouth': ('mouth', (-0.20, 0.26, 1.80, 1.96)),
    'cheek': ('cheek', (-0.66, -0.50, 1.835, 1.925), (0.55, 0.72, 1.835, 1.925)),
    'sclera': ('sclera', (-0.72, -0.22, 1.90, 2.36), (0.30, 0.78, 1.90, 2.36)),
}


def window_mean(a, kind, wins):
    acc, n = np.zeros(3), 0
    for w in wins:
        x0, x1, y0, y1 = box(*w)
        sub = a[y0:y1, x0:x1]
        m = feature_pixels(sub, kind)
        m = cv2.morphologyEx(m.astype(np.uint8), cv2.MORPH_OPEN, np.ones((3, 3), np.uint8)) > 0
        m = cv2.erode(m.astype(np.uint8), np.ones((5, 5), np.uint8)) > 0                 # stay off the anti-aliased edges
        if m.sum() < 20:
            continue
        acc += lin(sub[..., :3][m]).sum(0)
        n += int(m.sum())
    return (acc / n, n) if n else (None, 0)


if __name__ == '__main__':
    ref = load(ROOT + 'scripts/dev/.refs/ref_350.png')
    live = load(sys.argv[1])
    gains = {}
    for name, spec in WINDOWS.items():
        kind, wins = spec[0], spec[1:]
        r, nr = window_mean(ref, kind, wins)
        l, nl = window_mean(live, kind, wins)
        if r is None or l is None:
            print(f'{name:7s} n/a (art {nr}px, live {nl}px)')
            continue
        gains[name] = r / l
        print(f'{name:7s} art lin {np.round(r, 3)} ({nr}px)  live lin {np.round(l, 3)} ({nl}px)  correction x {np.round(r / l, 3)}')
    if '--apply' in sys.argv:
        path = ROOT + 'src/mascot-face.js'
        src = open(path).read()
        m = re.search(r'export const FEATURE_GAIN = \{([^}]*)\};', src)
        cur = {k: [float(x) for x in v.split(',')] for k, v in re.findall(r'(\w+): \[([^\]]*)\]', m.group(1))}
        for k, g in gains.items():
            damp = 1 + 0.8 * (np.clip(g, 0.5, 2.0) - 1)
            cur[k] = [round(float(c * d), 3) for c, d in zip(cur[k], damp)]
        body = ', '.join(f'{k}: [{", ".join(str(x) for x in cur[k])}]' for k in ('mouth', 'cheek', 'sclera'))
        open(path, 'w').write(src.replace(m.group(0), f'export const FEATURE_GAIN = {{ {body} }};'))
        print('applied ->', body)
