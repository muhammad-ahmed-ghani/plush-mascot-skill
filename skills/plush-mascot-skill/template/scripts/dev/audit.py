"""Compare a live render with the artwork rescaled to the SAME on-screen density.

    node scripts/dev/audit.mjs --ppu 246 --out live.png
    python3 scripts/dev/audit.py live.png --ppu 246 --out /tmp/audit

Writes side-by-side crops (artwork | live) of the head, face, eye, chest X, belly, arm, foot and ear, and prints how much
fibre texture each has at that scale (band-pass energy of the belly patch and of the whole body surface).
"""
import argparse, os, warnings
warnings.filterwarnings('ignore')
import numpy as np, cv2
from PIL import Image

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..')) + '/'
ap = argparse.ArgumentParser()
ap.add_argument('live'); ap.add_argument('--ppu', type=float, default=246); ap.add_argument('--out', default='/tmp/audit')
ap.add_argument('--size', type=int, default=0); ap.add_argument('--ty', type=float, default=1.65)
a = ap.parse_args()
os.makedirs(a.out, exist_ok=True)
ppu, ty = a.ppu, a.ty
S = a.size or max(600, int(round(ppu * 4.2 / 2) * 2))
BG = np.array([246, 243, 238], np.float32)

live = np.array(Image.open(a.live).convert('RGBA')).astype(np.float32)
ref0 = Image.open(ROOT + 'assets/mascot-transparent.png').convert('RGBA')
s = ppu / 350.0
ref_s = ref0.resize((round(ref0.width * s), round(ref0.height * s)), Image.LANCZOS)
canvas = Image.new('RGBA', (S, S), (0, 0, 0, 0))
off = (round(S / 2 - 627.5 * s), round(S / 2 + ty * ppu - 1204 * s))
canvas.alpha_composite(ref_s, dest=(max(off[0], 0), max(off[1], 0))) if off[0] >= 0 and off[1] >= 0 else canvas.paste(ref_s, off)
ref = np.array(canvas).astype(np.float32)


def flat(x):
    al = x[..., 3:4] / 255.0
    return (x[..., :3] * al + BG * (1 - al)).astype(np.uint8)


def box(x0, x1, y0, y1):
    """world-unit box -> pixel box"""
    px0, px1 = int(S / 2 + x0 * ppu), int(S / 2 + x1 * ppu)
    py0, py1 = int(S / 2 - (y1 - ty) * ppu), int(S / 2 - (y0 - ty) * ppu)
    return max(px0, 0), min(px1, S), max(py0, 0), min(py1, S)


REGIONS = {
    'head': (-1.3, 1.3, 1.5, 3.4), 'face': (-0.95, 0.95, 1.55, 2.75), 'eye': (-0.85, -0.02, 1.85, 2.42), 'x': (-0.42, 0.42, 0.72, 1.45),
    'belly': (-0.62, 0.62, 0.25, 1.1), 'arm': (0.45, 1.3, 0.55, 1.55), 'foot': (0.05, 0.98, 0.0, 0.72), 'ear': (0.3, 1.45, 2.55, 3.4),
}
fr, fl = flat(ref), flat(live)
for name, (x0, x1, y0, y1) in REGIONS.items():
    bx = box(x0, x1, y0, y1)
    cr, cl = fr[bx[2]:bx[3], bx[0]:bx[1]], fl[bx[2]:bx[3], bx[0]:bx[1]]
    z = max(1, int(round(560 / max(cr.shape[1], 1))))
    z = min(z, 4)
    pair = np.concatenate([cv2.resize(cr, None, fx=z, fy=z, interpolation=cv2.INTER_CUBIC), np.full((cr.shape[0] * z, 6, 3), 255, np.uint8), cv2.resize(cl, None, fx=z, fy=z, interpolation=cv2.INTER_CUBIC)], axis=1)
    Image.fromarray(pair).save(f'{a.out}/{name}.png')
Image.fromarray(np.concatenate([fr, np.full((S, 8, 3), 255, np.uint8), fl], axis=1)).resize((S, S // 2), Image.LANCZOS).save(f'{a.out}/full.png')


def lum(x):
    return 0.2126 * x[..., 0] + 0.7152 * x[..., 1] + 0.0722 * x[..., 2]


def texture_energy(img, mask, sigmas=(1.2, 3.0)):
    L = lum(img)
    out = []
    for sg in sigmas:
        hp = L - cv2.GaussianBlur(L, (0, 0), sg)
        out.append(float(hp[mask].std()))
    return out


def body(x):
    rgb, al = x[..., :3], x[..., 3] > 250
    R, G, B = rgb[..., 0], rgb[..., 1], rgb[..., 2]
    return al & (R > 90) & (R > G * 1.3) & (R > B * 1.3)


# belly patch (world coordinates identical to the patch used at native scale), eroded to stay clear of edges
b0 = box(-0.31, 0.32, 0.58, 0.93)
patch = np.zeros((S, S), bool); patch[b0[2]:b0[3], b0[0]:b0[1]] = True
m_ref, m_live = body(ref) & patch, body(live) & patch
er, el = texture_energy(ref, m_ref), texture_energy(live, m_live)
print(f'ppu {ppu:.0f}  (artwork rescaled x{s:.3f})')
print(f'  belly fibre energy  fine(sigma1.2) ref {er[0]:.2f}  live {el[0]:.2f}  ratio {el[0] / max(er[0], 1e-6):.2f}')
print(f'  belly fibre energy  mid (sigma3.0) ref {er[1]:.2f}  live {el[1]:.2f}  ratio {el[1] / max(er[1], 1e-6):.2f}')
# whole-surface energy, away from silhouettes
def interior(x):
    m = body(x)
    return cv2.erode(m.astype(np.uint8), np.ones((9, 9), np.uint8)) > 0
er2, el2 = texture_energy(ref, interior(ref)), texture_energy(live, interior(live))
print(f'  whole body surface fine ref {er2[0]:.2f} live {el2[0]:.2f} ratio {el2[0] / max(er2[0], 1e-6):.2f} | mid ref {er2[1]:.2f} live {el2[1]:.2f} ratio {el2[1] / max(er2[1], 1e-6):.2f}')
print('  crops ->', a.out)


# ---- chest-X cord: luminance contrast of the wraps along the '/' bar (band-pass of a 1D profile)
def cord_profile(img, center_world):
    L = lum(img)
    cx, cy = S / 2 + center_world[0] * ppu, S / 2 - (center_world[1] - ty) * ppu
    n = np.array([1.0, -1.0]) / np.sqrt(2.0)
    perp = np.array([-n[1], n[0]])
    half = 0.128 * ppu
    ts = np.arange(-half, half + 1e-6, 0.5)
    vals = []
    for t in ts:
        acc = 0.0
        for k in (-2, -1, 0, 1, 2):
            p = np.array([cx, cy]) + n * t + perp * k * (ppu / 350.0)
            acc += cv2.getRectSubPix(L, (1, 1), (float(p[0]), float(p[1])))[0, 0]
        vals.append(acc / 5)
    v = np.array(vals)
    d = (v - cv2.GaussianBlur(v.reshape(1, -1), (0, 0), 9 * ppu / 350).ravel())
    m = int(len(d) * 0.18)
    return float(d[m:-m].std())


print(f'  chest-X wrap contrast (luminance std along the cord): ref {cord_profile(ref, (0.021, 1.164)):.2f}   live {cord_profile(live, (0.0, 1.164)):.2f}')


# ---- signed large-scale shading difference (live vs artwork), after normalising overall brightness
def tone_map(img_a, img_b, sigma):
    ma, mb = body(img_a), body(img_b)
    both = ma & mb
    La, Lb = lum(img_a), lum(img_b)
    scale = Lb[both].mean() / La[both].mean()             # bring live to the artwork's mean brightness
    w = both.astype(np.float32)
    def sm(L):
        num = cv2.GaussianBlur(L * w, (0, 0), sigma)
        den = cv2.GaussianBlur(w, (0, 0), sigma)
        return np.where(den > 0.3, num / np.maximum(den, 1e-3), np.nan)
    d = sm(La * scale) - sm(Lb)
    return d, both, scale


d, both, sc = tone_map(live, ref, 6 * ppu / 246)
valid = both & np.isfinite(d)
print(f'  large-scale shading: live mean brightness x{sc:.3f} of artwork; mean |diff| after normalising {np.abs(d[valid]).mean():.1f} levels (p90 {np.percentile(np.abs(d[valid]), 90):.1f})')
vis = np.full((S, S, 3), 255, np.uint8)
dd = np.clip(d / 40.0, -1, 1)
pos, neg = np.clip(dd, 0, 1), np.clip(-dd, 0, 1)
col = np.stack([255 - 200 * neg, 255 - 150 * (pos + neg), 255 - 200 * pos], axis=-1)      # red: live brighter, blue: live darker
vis[valid] = col[valid].astype(np.uint8)
Image.fromarray(np.concatenate([flat(live), vis], axis=1)).resize((S, S // 2), Image.LANCZOS).save(f'{a.out}/tone_diff.png')

