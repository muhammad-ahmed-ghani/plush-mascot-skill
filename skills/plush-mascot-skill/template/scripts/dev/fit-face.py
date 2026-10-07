"""Measure the facial features in the neutral artwork and write src/mascot-face-shapes.js.

    python3 scripts/dev/fit-face.py

The eye whites, cheeks, mouth and irises of assets/mascot-transparent.png are segmented, and each outline is written out as a
smooth polar table (radius from the feature's centre, 72 angles) in character units (for the eye whites also how wide the darkening ramp inside the edge is and how dark the edge gets), together with the iris / pupil / catchlight
ellipses and the mouth's centre line.  src/mascot-face.js builds its geometry from these numbers, so the live model's features
land on the artwork's outlines to within a fraction of a pixel at the artwork's own scale (350 px per unit).

Conventions: units, +x is the viewer's right, feet on y = 0.  "L" is the character's left = the viewer's RIGHT (+x), as everywhere in src/.
"""
import json, os, sys, warnings
import numpy as np
import cv2
from PIL import Image
warnings.filterwarnings('ignore')

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..')) + '/'
S = 350.0                      # artwork pixels per unit
AX, AY = 627.5, 1204.0         # artwork pixel of the body axis / the feet
N_ANG = 72

A = np.array(Image.open(ROOT + 'assets/mascot-transparent.png').convert('RGBA')).astype(np.float32)
H, W = A.shape[:2]
ys, xs = np.mgrid[0:H, 0:W]
wx = (xs - AX) / S
wy = (AY - ys) / S
R, G, B = A[..., 0], A[..., 1], A[..., 2]
L = A[..., :3] @ np.array([0.2126, 0.7152, 0.0722])


def largest(m):
    n, lab, st, _ = cv2.connectedComponentsWithStats(m.astype(np.uint8), connectivity=8)
    return lab == 1 + np.argmax(st[1:, cv2.CC_STAT_AREA])


def fill(m):
    m = m.astype(np.uint8)
    ff = m.copy()
    cv2.floodFill(ff, np.zeros((H + 2, W + 2), np.uint8), (0, 0), 1)
    return (m | (1 - ff)).astype(bool)


def close(m, k=5):
    return cv2.morphologyEx(m.astype(np.uint8), cv2.MORPH_CLOSE, np.ones((k, k), np.uint8)) > 0


def window(cx, cy, a, b):
    return (((wx - cx) / a) ** 2 + ((wy - cy) / b) ** 2) < 1


def eye_mask(cx, cy):
    """The cream sclera (its convex hull: the iris and lids never poke out of the outline)."""
    win = window(cx, cy, 0.24, 0.28)
    cream = (R > 135) & (G > 110) & (B > 90) & (R >= G) & (L > 120) & win
    m = largest(close(cream))
    cs, _ = cv2.findContours(m.astype(np.uint8), cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_NONE)
    hull = cv2.convexHull(max(cs, key=cv2.contourArea))
    out = np.zeros(m.shape, np.uint8)
    cv2.fillPoly(out, [hull], 1)
    return out > 0


def cheek_mask(cx, cy):
    win = window(cx, cy, 0.16, 0.12)
    m = (R > 150) & (G > 70) & (R - G > 40) & (G > 0.35 * R) & (L > 90) & win
    return fill(largest(close(m)))


def mouth_mask(cx, cy):
    win = window(cx, cy, 0.2, 0.12)
    m = (R > 140) & (G > 70) & (R - G > 40) & (G > 0.3 * R) & (L > 85) & win
    return largest(close(m))


def signed_distance(m):
    m8 = m.astype(np.uint8)
    return (cv2.distanceTransform(1 - m8, cv2.DIST_L2, 5) - cv2.distanceTransform(m8, cv2.DIST_L2, 5)) / S


def centroid(m):
    yy, xx = np.nonzero(m)
    return (xx.mean() + 0.5 - AX) / S, (AY - yy.mean() - 0.5) / S


def polar_table(m, cx, cy):
    """Distance from (cx, cy) to the mask boundary along N_ANG rays, subpixel via the signed-distance field, then low-passed."""
    sd = signed_distance(m)
    rho = np.zeros(N_ANG)
    for k in range(N_ANG):
        a = 2 * np.pi * k / N_ANG
        lo, hi = 0.0, 0.5
        f = lambda r: cv2.getRectSubPix(sd.astype(np.float32), (1, 1), (AX + (cx + r * np.cos(a)) * S - 0.5, AY - (cy + r * np.sin(a)) * S - 0.5))[0, 0]
        for _ in range(40):                                  # bisection on the signed distance (inside < 0)
            mid = (lo + hi) / 2
            if f(mid) < 0: lo = mid
            else: hi = mid
        rho[k] = (lo + hi) / 2
    spec = np.fft.rfft(rho)
    spec[13:] = 0                                            # keep 12 harmonics: the outlines are smooth eggs
    return np.fft.irfft(spec, N_ANG)


def polar_iou(rho, m, cx, cy):
    ang = np.arctan2(wy - cy, wx - cx) % (2 * np.pi)
    r = np.hypot(wx - cx, wy - cy)
    k = ang / (2 * np.pi) * N_ANG
    k0 = np.floor(k).astype(int) % N_ANG
    k1 = (k0 + 1) % N_ANG
    t = k - np.floor(k)
    edge = rho[k0] * (1 - t) + rho[k1] * t
    pred = r <= edge
    return (pred & m).sum() / (pred | m).sum()


def feature(name, m):
    cx, cy = centroid(m)
    rho = polar_table(m, cx, cy)
    # centre on the middle of the polar outline rather than on the pixel centroid: iterate once
    px = cx + np.mean(rho * np.cos(2 * np.pi * np.arange(N_ANG) / N_ANG)) * 2
    py = cy + np.mean(rho * np.sin(2 * np.pi * np.arange(N_ANG) / N_ANG)) * 2
    rho = polar_table(m, px, py)
    a = 2 * np.pi * np.arange(N_ANG) / N_ANG
    rx, ry = float(np.max(np.abs(rho * np.cos(a)))), float(np.max(np.abs(rho * np.sin(a))))
    iou = polar_iou(rho, m, px, py)
    print(f'{name:8s} centre ({px:+.4f}, {py:.4f})  half extents {rx:.4f} x {ry:.4f}  polar IoU {iou:.4f}')
    return dict(cx=round(float(px), 4), cy=round(float(py), 4), rx=round(rx, 4), ry=round(ry, 4), rho=[round(float(v), 5) for v in rho])


RIM_SAMPLES, RIM_DEPTH = 64, 0.03          # the rim lookup: 64 samples across the first 0.03 units inside an eye white's edge, per angle


def refine_eye_edge(f):
    """The eye whites do not end where a colour threshold says: they fall away in a ramp that ends in a dark line, and the ramp is wide
    at the top and narrow at the side.  From the artwork's luminance along rays this finds, per angle, where the piece ends and how
    bright it is at each distance inside that edge (relative to its interior, in linear light since the shader multiplies light).
    The outline replaces f['rho']; the ramps are returned separately as rows of a lookup image (see build_rim_image)."""
    L32 = ((L / 255.0) ** 2.2).astype(np.float32)
    n = len(f['rho'])
    rho = np.array(f['rho'])

    def lum(x, y):
        return cv2.getRectSubPix(L32, (1, 1), (AX + x * S - 0.5, AY - y * S - 0.5))[0, 0]

    r_out = rho.copy()
    valid = np.zeros(n, bool)
    steps = np.arange(-0.030, 0.0301, 0.0005)
    for k in range(n):
        a = 2 * np.pi * k / n
        prof = np.array([lum(f['cx'] + (rho[k] + o) * np.cos(a), f['cy'] + (rho[k] + o) * np.sin(a)) for o in steps])
        inner = prof[(steps >= -0.030) & (steps <= -0.006)]
        interior = np.percentile(inner, 80)
        if interior < 0.10:                                  # the iris touches this part of the edge: keep the colour mask's outline
            continue
        sm = np.convolve(np.pad(prof, 1, mode='edge'), np.ones(3) / 3, mode='valid')          # (smoothed a little: a fibre gap must not look like a line)
        win = (steps >= -0.002) & (steps <= 0.016)
        j = int(np.argmin(np.where(win, sm, 1e9)))
        beyond = np.median(sm[(steps >= steps[j] + 0.004) & (steps <= steps[j] + 0.012)])
        if sm[j] < 0.7 * beyond and sm[j] < 0.10 * interior:      # a dark line: the piece ends just outside its darkest point
            edge = steps[j] + 0.0012
        else:                                                    # no line (the lit lower edge): the piece ends where the ramp meets the fabric's level
            plate = np.median(sm[(steps >= 0.014) & (steps <= 0.024)])
            hit = np.nonzero((steps >= -0.010) & (sm <= 1.25 * plate))[0]
            if not len(hit):
                continue
            edge = steps[hit[0]]
        r_out[k] = rho[k] + edge
        valid[k] = True
    smooth = lambda v, h: np.fft.irfft(np.where(np.arange(n // 2 + 1) <= h, np.fft.rfft(v), 0), n)
    delta = np.clip(r_out - rho, -0.002, 0.014)
    med = np.median(np.stack([np.roll(delta, i) for i in range(-4, 5)]), axis=0)
    delta = np.where(np.abs(delta - med) > 0.003, med, delta)                                    # (a fibre gap must not make a bump in the outline)
    delta = np.median(np.stack([np.roll(delta, i) for i in (-1, 0, 1)]), axis=0)
    r_out = rho + delta
    f['rho'] = [round(float(v), 5) for v in smooth(r_out, 14)]
    # the ramp inside the final outline, per angle
    rho_final = np.array(f['rho'])
    depth = np.arange(RIM_SAMPLES) * RIM_DEPTH / (RIM_SAMPLES - 1)
    rows = np.zeros((n, RIM_SAMPLES), np.float32)
    for k in range(n):
        a = 2 * np.pi * k / n
        prof = np.array([lum(f['cx'] + (rho_final[k] - d) * np.cos(a), f['cy'] + (rho_final[k] - d) * np.sin(a)) for d in depth])
        ref = np.percentile(prof[depth >= 0.012], 80)
        rows[k] = np.clip(prof / max(ref, 1e-4), 0, 1.0)
    bad = ~valid | (rows[:, -1] < 0.5)                       # (iris in the way: no measurement here)
    good = np.nonzero(~bad)[0]
    for k in np.nonzero(bad)[0]:                              # borrow the nearest good angles' ramps
        d = np.minimum((good - k) % n, (k - good) % n)
        near = good[np.argsort(d)[:2]]
        rows[k] = rows[near].mean(axis=0)
    rows = np.stack([np.roll(rows, i, axis=0) for i in (-2, -1, 0, 1, 2)]).mean(axis=0)         # a little smoothing between neighbouring angles
    for r_ in range(n):
        rows[r_] = np.convolve(np.pad(rows[r_], 1, mode='edge'), np.ones(3) / 3, mode='valid')
    f['_rim'] = rows
    return f


def polygon_mask(f):
    """Fill a feature's polar outline into an artwork-sized mask."""
    n = len(f['rho'])
    pts = np.array([[AX + (f['cx'] + f['rho'][k] * np.cos(2 * np.pi * k / n)) * S, AY - (f['cy'] + f['rho'][k] * np.sin(2 * np.pi * k / n)) * S] for k in range(n)])
    m = np.zeros((H, W), np.uint8)
    cv2.fillPoly(m, [np.round(pts * 16).astype(np.int32)], 1, lineType=cv2.LINE_AA, shift=4)
    return m > 0


def ellipse(m):
    cs, _ = cv2.findContours(m.astype(np.uint8), cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_NONE)
    (ex, ey), (MA, ma), ang = cv2.fitEllipse(max(cs, key=cv2.contourArea))
    return dict(cx=round((ex - AX) / S, 4), cy=round((AY - ey) / S, 4), w=round(MA / S, 4), h=round(ma / S, 4))


def iris_parts(eye):
    """Iris (dark disc inside the sclera), pupil (its darker core) and catchlight (its bright dot)."""
    dark = close((L < 110) & eye, 9)
    iris = fill(largest(dark))
    pupil = fill(largest(cv2.morphologyEx(((L < 19.5) & iris).astype(np.uint8), cv2.MORPH_OPEN, np.ones((3, 3), np.uint8)) > 0))
    glint = largest((L > 150) & iris)
    mean = lambda mk, er: [round(float(v), 1) for v in A[..., :3][cv2.erode(mk.astype(np.uint8), np.ones((er * 2 + 1, er * 2 + 1), np.uint8)) > 0].mean(axis=0)]
    return dict(iris=ellipse(iris), pupil=ellipse(pupil), glint=ellipse(glint),
                colour=dict(iris=mean(iris & ~pupil & ~glint, 4), pupil=mean(pupil, 3), glint=mean(glint, 2)))


def mouth_curve(m):
    """Centre line y = y0 + k (x - xc)^2 and the thickness of the pink band, from the mask's columns."""
    yy, xx = np.nonzero(m)
    rows = []
    for x in range(xx.min(), xx.max() + 1):
        col = np.nonzero(m[:, x])[0]
        if len(col): rows.append(((x + 0.5 - AX) / S, (AY - (col.min() + col.max() + 1) / 2) / S, (col.max() + 1 - col.min()) / S))
    rows = np.array(rows)
    c2, c1, c0 = np.polyfit(rows[:, 0], rows[:, 1], 2)
    xc = -c1 / (2 * c2)
    y0 = c0 - c1 * c1 / (4 * c2)
    inner = rows[(rows[:, 0] > rows[0, 0] + 0.05) & (rows[:, 0] < rows[-1, 0] - 0.05)]
    slope = 2 * c2 * (inner[:, 0] - xc)
    thick = float(np.median(inner[:, 2] / np.sqrt(1 + slope ** 2)))           # thickness measured across the band, not vertically
    x0, x1 = (xx.min() - AX) / S, (xx.max() + 1 - AX) / S
    return dict(xc=round(float(xc), 4), y0=round(float(y0), 4), k=round(float(c2), 4), thickness=round(thick, 4),
                x0=round(float(x0), 4), x1=round(float(x1), 4))


# ---- the atlas the halo map lives on ---------------------------------------------------------------------------------------------------
ATLAS = dict(x0=-0.75, yTop=2.42, w=1.5, h=0.78, texel=0.0035)


def signed_distance_field(m):
    return signed_distance(m).astype(np.float32)


def sample(field, xs, ys):
    mx = (AX + xs * S - 0.5).astype(np.float32)
    my = (AY - ys * S - 0.5).astype(np.float32)
    return cv2.remap(field, mx, my, cv2.INTER_LINEAR, borderMode=cv2.BORDER_REPLICATE)


# ---- the halo around the features ----------------------------------------------------------------------------------------------------
# The face fabric is not evenly lit around the felt pieces set into it: in the artwork it is dark above and beside the eye whites and
# bright underneath them, brighter around the cheeks and below the mouth (light bounced off the pieces, and their shadows).  That is measured
# here as a colour ratio map: the artwork's fabric near the features, smoothed to remove the fibres, divided by the fabric's own smooth
# base further away.  The shader multiplies the face fabric by it.  The crisp dark line at the very edge is drawn by the features themselves.
LINE_ZONE = 0.004          # the dark contact line of a cheek / the mouth lives inside this distance from an outline; the map is extrapolated across it
HALO_REACH = (0.075, 0.115)  # the map fades to 1 between these distances


def lin_rgb(img):
    c = img[..., :3] / 255.0
    return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4).astype(np.float32)


def normalized_blur(values, weight, sigma):
    """Gaussian smoothing that only counts pixels with weight (so the holes at features do not drag the result to black)."""
    num = cv2.GaussianBlur(values * weight[..., None], (0, 0), sigma)
    den = cv2.GaussianBlur(weight, (0, 0), sigma)[..., None]
    return num / np.maximum(den, 1e-6), den[..., 0]


def build_halo_map(features):
    """features: list of masks.  Returns an RGB uint8 image on the atlas grid; value 128 = ratio 1, 255 = 2.5."""
    lin = lin_rgb(A)
    lum_s = L
    plate_all = (lum_s < 100) & ((R - B) < 45) & (A[..., 3] > 250)
    plate = largest(plate_all)
    plate = cv2.morphologyEx(plate.astype(np.uint8), cv2.MORPH_CLOSE, np.ones((9, 9), np.uint8)) > 0
    plate_solid = fill(plate)                                    # the plate with the features filled in: distances to ITS edge, not to the features
    d_feat = np.full((H, W), 9.0, np.float32)
    inside = np.zeros((H, W), bool)
    for m in features:
        d_feat = np.minimum(d_feat, signed_distance_field(m))
        inside |= m
    inner_plate = cv2.erode(plate_solid.astype(np.uint8), np.ones((int(0.05 * S) * 2 + 1,) * 2, np.uint8)) > 0     # away from the hood seam
    far_ok = (plate & inner_plate & ~inside & (d_feat > HALO_REACH[1])).astype(np.float32)
    edge_zone = cv2.erode(plate_solid.astype(np.uint8), np.ones((int(0.075 * S) * 2 + 1,) * 2, np.uint8)) > 0     # the shader draws the hood seam's own darkening
    near_ok = (plate & edge_zone & ~inside & (d_feat > LINE_ZONE)).astype(np.float32)
    base, _ = normalized_blur(lin, far_ok, 0.09 * S)
    near, den = normalized_blur(lin, near_ok, 0.010 * S)
    ratio = near / np.maximum(base, 1e-4)
    ratio = np.clip(ratio, 0.12, 2.4).astype(np.float32)
    # across the line zone and under the features there is nothing to measure: carry the nearest measured value outward
    hole = ((den < 0.25) | (d_feat <= LINE_ZONE) | inside | ~edge_zone)
    band = (d_feat < HALO_REACH[1] + 0.02)
    for c in range(3):
        img = ratio[..., c].copy()
        img[~band] = 1.0
        mask = (hole & band).astype(np.uint8) * 255
        ratio[..., c] = cv2.inpaint(img, mask, 4, cv2.INPAINT_TELEA)
    # near the hood seam the shader's own edge darkening rules: fade to 1 there
    edge_dist = cv2.distanceTransform(plate_solid.astype(np.uint8), cv2.DIST_L2, 5) / S
    t = np.clip((edge_dist - 0.05) / 0.04, 0, 1)
    ratio = 1 + (ratio - 1) * (t * t * (3 - 2 * t))[..., None]
    # fade to 1 with distance
    t = np.clip((d_feat - HALO_REACH[0]) / (HALO_REACH[1] - HALO_REACH[0]), 0, 1)
    fade = 1 - t * t * (3 - 2 * t)
    ratio = 1 + (ratio - 1) * fade[..., None]
    a = ATLAS
    nx, ny = int(round(a['w'] / a['texel'])), int(round(a['h'] / a['texel']))
    xs = a['x0'] + (np.arange(nx) + 0.5) * a['texel']
    ys = a['yTop'] - (np.arange(ny) + 0.5) * a['texel']
    gx_, gy_ = np.meshgrid(xs, ys)
    out = np.stack([sample(np.ascontiguousarray(ratio[..., c]), gx_, gy_) for c in range(3)], -1)
    return (np.clip(out / 2.5, 0, 1) * 255 + 0.5).astype(np.uint8)


def main():
    eyes = {'R': eye_mask(-0.436, 2.136), 'L': eye_mask(0.523, 2.129)}            # R = viewer's left (-x), L = viewer's right (+x)
    cheeks = {'R': cheek_mask(-0.567, 1.865), 'L': cheek_mask(0.63, 1.861)}
    mouth = mouth_mask(0.039, 1.875)
    shapes = {'eye': {k: refine_eye_edge(feature('eye' + k, v)) for k, v in eyes.items()},
              'cheek': {k: feature('cheek' + k, v) for k, v in cheeks.items()},
              'mouth': mouth_curve(mouth),
              'iris': {k: iris_parts(v) for k, v in eyes.items()}}
    rim = np.zeros((72, RIM_SAMPLES, 3), np.uint8)                        # R = the viewer's-right eye (L), G = the viewer's-left eye (R); sqrt-encoded ratios
    for ch, tag in enumerate(('L', 'R')):
        rim[..., ch] = np.clip(np.sqrt(shapes['eye'][tag].pop('_rim')) * 255 + 0.5, 0, 255)
    Image.fromarray(rim, 'RGB').save(ROOT + 'assets/mascot-eye-rim.png', optimize=True)
    print('wrote assets/mascot-eye-rim.png')
    shapes['rim'] = dict(file='mascot-eye-rim.png', depth=RIM_DEPTH, samples=RIM_SAMPLES)
    eye_outlines = [polygon_mask(f) for f in shapes['eye'].values()]         # the pieces' true outlines (dark line included)
    halo = build_halo_map(eye_outlines + list(cheeks.values()) + [mouth])
    Image.fromarray(halo, 'RGB').save(ROOT + 'assets/mascot-face-halo.png', optimize=True)
    print('wrote assets/mascot-face-halo.png')
    shapes['halo'] = dict(file='mascot-face-halo.png', x0=ATLAS['x0'], yTop=ATLAS['yTop'], w=ATLAS['w'], h=ATLAS['h'], scale=2.5)
    print('mouth', shapes['mouth'])
    for k, v in shapes['iris'].items(): print('iris', k, json.dumps(v))
    text = ('// Facial feature outlines measured from assets/mascot-transparent.png.\n'
            '// GENERATED by scripts/dev/fit-face.py - do not edit by hand; rerun the script if the artwork changes.\n'
            '// Units are character units (350 px per unit in the artwork), +x is the viewer\'s right, y is up.  "L" is the character\'s left,\n'
            '// i.e. the viewer\'s right (+x).  Each eye / cheek is a polar outline: rho[k] is the distance from (cx, cy) to the boundary at\n'
            '// angle 2 pi k / rho.length; rx / ry are the half extents.  The mouth is the parabola y = y0 + k (x - xc)^2 with a pink band\n'
            '// `thickness` wide and round ends, spanning x0 .. x1.  Iris / pupil / glint are fitted ellipses (w, h are full axes).  `halo` describes\n'
            '// assets/mascot-face-halo.png (see build_halo_map in scripts/dev/fit-face.py).\n'
            '// ARTWORK_VIEW: the artwork is matched as seen from a near-orthographic camera (fov 6 degrees, 350 px per unit, looking at height\n'
            '// `targetY`) `distance` units from the character.  A feature standing proud of the body axis plane by z is magnified by\n'
            '// distance / (distance - z) in that view, so the features are built (x, y, size) scaled by the inverse to land on the artwork.\n'
            'export const ARTWORK_VIEW = { distance: 39.99, targetY: 1.65 };\n'
            'export const FACE_SHAPES = ' + json.dumps(shapes, indent=1).replace('\n  ', '\n ') + ';\n')
    # keep the polar tables on one line each so the file stays readable
    import re
    text = re.sub(r'"rho": \[([^\]]*)\]', lambda mo: '"rho": [' + ' '.join(mo.group(1).split()) + ']', text)
    out = ROOT + 'src/mascot-face-shapes.js'
    open(out, 'w').write(text)
    print('wrote', out)


if __name__ == '__main__':
    main()
