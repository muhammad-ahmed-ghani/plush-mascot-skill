"""Shared helpers for the art tools in scripts/tools: image IO, colour maths, config discovery, background models,
figure segmentation and the sub-pixel measurements that normalize_art.py and art_qa.py agree on.

numpy + OpenCV (cv2) + Pillow + stdlib only (scipy / scikit-image are not used: they break under numpy 2 on some
machines). Everything here is deterministic.

Coordinate convention (used by every tool): pixel (x, y) has its centre at integer coordinates (OpenCV's
convention). The registration frame's `axisX`, `topY` and `feetY` are in these index coordinates: `topY` / `feetY`
are the rows of the first / last pixel whose alpha reaches 0.5, so the silhouette's top edge lies at topY - 0.5 and
its bottom edge at feetY + 0.5, and the edge-to-edge figure height is feetY - topY + 1 px.
"""
import hashlib
import json
import math
import os
import struct
import sys

import numpy as np
import cv2
from PIL import Image

DEFAULT_FRAME = {'size': 1254, 'ppu': 350.0, 'axisX': 627.5, 'feetY': 1204, 'topY': 47}
TOOLS_DIR = os.path.dirname(os.path.abspath(__file__))
IMAGE_EXTS = ('.png', '.jpg', '.jpeg', '.webp', '.tif', '.tiff', '.bmp')


class ToolError(Exception):
    """An error with a message meant for the user and an exit code."""

    def __init__(self, message, code=1):
        super().__init__(message)
        self.code = code


def fail(message, code=1):
    raise ToolError(message, code)


def run_main(main):
    """Call main(), turning ToolError into a clean message + exit code (no traceback for user errors)."""
    try:
        rc = main()
    except ToolError as e:
        print(f'error: {e}', file=sys.stderr)
        rc = e.code
    except KeyboardInterrupt:
        print('interrupted', file=sys.stderr)
        rc = 130
    sys.exit(rc or 0)


# ------------------------------------------------------------------------------------------------------------
# config
# ------------------------------------------------------------------------------------------------------------
def find_config(explicit=None):
    """-> (config dict, path or None). Order: explicit path; ./mascot.config.json or a parent's; the project that
    contains this tool (scripts/tools/../../mascot.config.json). Missing config -> ({}, None) (defaults apply)."""
    if explicit:
        if not os.path.isfile(explicit):
            fail(f'config not found: {explicit}', 2)
        with open(explicit, encoding='utf-8') as f:
            return json.load(f), os.path.abspath(explicit)
    cands = []
    d = os.getcwd()
    while True:
        cands.append(os.path.join(d, 'mascot.config.json'))
        nd = os.path.dirname(d)
        if nd == d:
            break
        d = nd
    cands.append(os.path.join(TOOLS_DIR, '..', '..', 'mascot.config.json'))
    for c in cands:
        if os.path.isfile(c):
            with open(c, encoding='utf-8') as f:
                return json.load(f), os.path.abspath(c)
    return {}, None


def frame_from(cfg):
    fr = dict(DEFAULT_FRAME)
    fr.update({k: v for k, v in (cfg or {}).get('frame', {}).items() if k in DEFAULT_FRAME})
    fr['size'] = int(fr['size'])
    fr['ppu'] = float(fr['ppu'])
    return fr


def palette_from(path_or_cfg):
    """Palette dict name -> hex from a mascot.config.json path/dict or a plain {"name": "#hex"} JSON."""
    if path_or_cfg is None:
        return {}
    if isinstance(path_or_cfg, str):
        if not os.path.isfile(path_or_cfg):
            fail(f'palette file not found: {path_or_cfg}', 2)
        with open(path_or_cfg, encoding='utf-8') as f:
            data = json.load(f)
    else:
        data = path_or_cfg
    pal = data.get('palette', data) if isinstance(data, dict) else {}
    out = {}
    for k, v in pal.items():
        if isinstance(v, str) and v.startswith('#') and len(v) in (4, 7):
            out[k] = v
        elif isinstance(v, dict) and isinstance(v.get('hex'), str):
            out[k] = v['hex']
    return out


# ------------------------------------------------------------------------------------------------------------
# files, hashing, JSON
# ------------------------------------------------------------------------------------------------------------
def sha256_file(path):
    h = hashlib.sha256()
    with open(path, 'rb') as f:
        for chunk in iter(lambda: f.read(1 << 20), b''):
            h.update(chunk)
    return h.hexdigest()


def jclean(obj, nd=4):
    """Make an object JSON-stable: numpy -> python, floats rounded to nd decimals, tuples -> lists."""
    if isinstance(obj, dict):
        return {str(k): jclean(v, nd) for k, v in obj.items()}
    if isinstance(obj, (list, tuple)):
        return [jclean(v, nd) for v in obj]
    if isinstance(obj, (np.bool_, bool)):
        return bool(obj)
    if isinstance(obj, (np.integer,)):
        return int(obj)
    if isinstance(obj, (float, np.floating)):
        v = float(obj)
        if math.isnan(v) or math.isinf(v):
            return None
        r = round(v, nd)
        return 0.0 if r == 0 else r
    if isinstance(obj, np.ndarray):
        return jclean(obj.tolist(), nd)
    return obj


def write_json(path, obj, nd=4):
    d = os.path.dirname(os.path.abspath(path))
    os.makedirs(d, exist_ok=True)
    with open(path, 'w', encoding='utf-8', newline='\n') as f:
        json.dump(jclean(obj, nd), f, indent=1, ensure_ascii=False)
        f.write('\n')


def check_out(path, force):
    if path and os.path.exists(path) and not force:
        fail(f'{path} exists (use --force to overwrite)', 5)


# ------------------------------------------------------------------------------------------------------------
# image IO
# ------------------------------------------------------------------------------------------------------------
def _png_bit_depth(path):
    try:
        with open(path, 'rb') as f:
            head = f.read(33)
        if head[:8] == b'\x89PNG\r\n\x1a\n' and head[12:16] == b'IHDR':
            return head[24], head[25]            # bit depth, colour type
    except OSError:
        pass
    return None, None


def sniff_format(path):
    with open(path, 'rb') as f:
        head = f.read(16)
    if head[:8] == b'\x89PNG\r\n\x1a\n':
        return 'png'
    if head[:3] == b'\xff\xd8\xff':
        return 'jpeg'
    if head[:4] == b'RIFF' and head[8:12] == b'WEBP':
        return 'webp'
    if head[:4] in (b'II*\x00', b'MM\x00*'):
        return 'tiff'
    if head[:2] == b'BM':
        return 'bmp'
    return 'unknown'


def read_image(path):
    """-> (rgba float32 HxWx4 in 0..1, info). Colour stays sRGB-encoded; images without alpha get alpha 1.
    info: format, mode, bits, has_alpha, width, height, icc (bool), icc_desc, exif_orientation, frames."""
    if not os.path.isfile(path):
        fail(f'image not found: {path}', 2)
    fmt = sniff_format(path)
    info = {'path': path, 'format': fmt, 'bits': 8, 'frames': 1, 'icc': False, 'icc_desc': None, 'exif_orientation': 1}
    try:
        im = Image.open(path)
    except Exception as e:                                # noqa: BLE001 (report any decoder failure the same way)
        fail(f'cannot decode {path}: {e}', 2)
    info['mode'] = im.mode
    info['frames'] = getattr(im, 'n_frames', 1)
    icc = im.info.get('icc_profile')
    if icc:
        info['icc'] = True
        info['icc_desc'] = _icc_description(icc)
    try:
        info['exif_orientation'] = int(im.getexif().get(0x0112, 1) or 1)
    except Exception:                                    # noqa: BLE001
        info['exif_orientation'] = 1
    bd, ct = _png_bit_depth(path) if fmt == 'png' else (None, None)
    if bd == 16:
        a = cv2.imread(path, cv2.IMREAD_UNCHANGED)
        if a is None:
            fail(f'cannot decode 16-bit PNG {path}', 2)
        info['bits'] = 16
        a = a.astype(np.float32) / 65535.0
        if a.ndim == 2:
            a = np.dstack([a, a, a, np.ones_like(a)])
        elif a.shape[2] == 3:
            a = np.dstack([a[..., ::-1], np.ones(a.shape[:2], np.float32)])
        else:
            a = np.dstack([a[..., 2::-1], a[..., 3]])
        info['has_alpha'] = ct in (4, 6)
    else:
        has_alpha = im.mode in ('RGBA', 'LA', 'PA') or (im.mode == 'P' and 'transparency' in im.info) or \
            (im.mode in ('RGB', 'L') and 'transparency' in im.info)
        info['has_alpha'] = bool(has_alpha)
        a = np.asarray(im.convert('RGBA'), dtype=np.float32) / 255.0
    info['height'], info['width'] = a.shape[:2]
    return np.ascontiguousarray(a, dtype=np.float32), info


def _icc_description(icc):
    try:
        # the 'desc' tag: find it in the tag table
        n = struct.unpack('>I', icc[128:132])[0]
        for i in range(n):
            sig, off, size = struct.unpack('>4sII', icc[132 + 12 * i:144 + 12 * i])
            if sig == b'desc':
                blob = icc[off:off + size]
                if blob[:4] == b'desc':
                    ln = struct.unpack('>I', blob[8:12])[0]
                    return blob[12:12 + ln].rstrip(b'\x00').decode('latin-1', 'replace')
                if blob[:4] == b'mluc':
                    cnt = struct.unpack('>I', blob[8:12])[0]
                    if cnt:
                        ln, o = struct.unpack('>II', blob[20:28])
                        return blob[o:o + ln].decode('utf-16-be', 'replace')
    except Exception:                                    # noqa: BLE001
        return 'unknown'
    return 'unknown'


def to_u8(x):
    return np.clip(np.round(np.asarray(x, np.float32) * 255.0), 0, 255).astype(np.uint8)


def to_u16(x):
    return np.clip(np.round(np.asarray(x, np.float32) * 65535.0), 0, 65535).astype(np.uint16)


def write_png(path, img, bits=8):
    """Write RGB or RGBA float (0..1) or uint8 as PNG (deterministic encoder settings)."""
    d = os.path.dirname(os.path.abspath(path))
    os.makedirs(d, exist_ok=True)
    img = np.asarray(img)
    if img.dtype != np.uint8 and img.dtype != np.uint16:
        img = to_u16(img) if bits == 16 else to_u8(img)
    if img.ndim == 3 and img.shape[2] == 4:
        bgr = img[..., [2, 1, 0, 3]]
    elif img.ndim == 3:
        bgr = img[..., ::-1]
    else:
        bgr = img
    if not cv2.imwrite(path, np.ascontiguousarray(bgr), [cv2.IMWRITE_PNG_COMPRESSION, 6]):
        fail(f'could not write {path}', 1)


# ------------------------------------------------------------------------------------------------------------
# colour
# ------------------------------------------------------------------------------------------------------------
def hex_to_rgb(h):
    """'#rrggbb' or '#rgb' -> float RGB 0..1."""
    s = str(h).strip().lstrip('#')
    if len(s) == 3:
        s = ''.join(c * 2 for c in s)
    if len(s) != 6 or any(c not in '0123456789abcdefABCDEF' for c in s):
        fail(f'not a hex colour: {h!r} (want #rrggbb)', 2)
    return np.array([int(s[i:i + 2], 16) for i in (0, 2, 4)], np.float32) / 255.0


def rgb_to_hex(rgb):
    r, g, b = [int(v) for v in np.clip(np.round(np.asarray(rgb, np.float64) * 255), 0, 255)]
    return f'#{r:02x}{g:02x}{b:02x}'


def srgb_to_lab(rgb):
    """sRGB (0..1 float, any leading shape, last axis 3) -> CIE Lab (L 0..100), D65, via OpenCV (float path)."""
    a = np.ascontiguousarray(np.clip(np.asarray(rgb, np.float32), 0, 1))
    shp = a.shape
    lab = cv2.cvtColor(a.reshape(-1, 1, 3), cv2.COLOR_RGB2Lab)
    return lab.reshape(shp)


def lab_to_srgb(lab):
    a = np.ascontiguousarray(np.asarray(lab, np.float32))
    shp = a.shape
    rgb = cv2.cvtColor(a.reshape(-1, 1, 3), cv2.COLOR_Lab2RGB)
    return np.clip(rgb.reshape(shp), 0, 1)


def delta_e76(l1, l2):
    return np.sqrt(np.sum((np.asarray(l1, np.float32) - np.asarray(l2, np.float32)) ** 2, axis=-1))


def delta_e2000(l1, l2):
    """CIEDE2000 (vectorised, last axis Lab)."""
    L1, a1, b1 = [np.asarray(l1, np.float64)[..., i] for i in range(3)]
    L2, a2, b2 = [np.asarray(l2, np.float64)[..., i] for i in range(3)]
    C1, C2 = np.hypot(a1, b1), np.hypot(a2, b2)
    Cm = (C1 + C2) / 2
    G = 0.5 * (1 - np.sqrt(Cm ** 7 / (Cm ** 7 + 25.0 ** 7)))
    a1p, a2p = (1 + G) * a1, (1 + G) * a2
    C1p, C2p = np.hypot(a1p, b1), np.hypot(a2p, b2)
    h1p = np.degrees(np.arctan2(b1, a1p)) % 360
    h2p = np.degrees(np.arctan2(b2, a2p)) % 360
    dLp = L2 - L1
    dCp = C2p - C1p
    dhp = h2p - h1p
    dhp = np.where(dhp > 180, dhp - 360, np.where(dhp < -180, dhp + 360, dhp))
    dhp = np.where(C1p * C2p == 0, 0, dhp)
    dHp = 2 * np.sqrt(C1p * C2p) * np.sin(np.radians(dhp) / 2)
    Lpm = (L1 + L2) / 2
    Cpm = (C1p + C2p) / 2
    hsum = h1p + h2p
    hpm = np.where(np.abs(h1p - h2p) > 180, np.where(hsum < 360, (hsum + 360) / 2, (hsum - 360) / 2), hsum / 2)
    hpm = np.where(C1p * C2p == 0, hsum, hpm)
    T = (1 - 0.17 * np.cos(np.radians(hpm - 30)) + 0.24 * np.cos(np.radians(2 * hpm))
         + 0.32 * np.cos(np.radians(3 * hpm + 6)) - 0.20 * np.cos(np.radians(4 * hpm - 63)))
    dtheta = 30 * np.exp(-((hpm - 275) / 25) ** 2)
    Rc = 2 * np.sqrt(Cpm ** 7 / (Cpm ** 7 + 25.0 ** 7))
    Sl = 1 + 0.015 * (Lpm - 50) ** 2 / np.sqrt(20 + (Lpm - 50) ** 2)
    Sc = 1 + 0.045 * Cpm
    Sh = 1 + 0.015 * Cpm * T
    Rt = -np.sin(np.radians(2 * dtheta)) * Rc
    return np.sqrt((dLp / Sl) ** 2 + (dCp / Sc) ** 2 + (dHp / Sh) ** 2 + Rt * (dCp / Sc) * (dHp / Sh)).astype(np.float32)


def luminance(rgb):
    """Rec. 709 luma of sRGB-encoded values (what the eye compares on screen), same shape minus the last axis."""
    rgb = np.asarray(rgb, np.float32)
    return rgb[..., 0] * 0.2126 + rgb[..., 1] * 0.7152 + rgb[..., 2] * 0.0722


# ------------------------------------------------------------------------------------------------------------
# alpha helpers
# ------------------------------------------------------------------------------------------------------------
def premultiply(rgba):
    out = rgba.copy()
    out[..., :3] *= rgba[..., 3:4]
    return out


def unpremultiply(pm, extend=None):
    """Straight colour from premultiplied RGBA. Fully transparent pixels get 0 (or `extend` colours HxWx3)."""
    a = pm[..., 3:4]
    rgb = np.where(a > 1e-4, pm[..., :3] / np.maximum(a, 1e-4), 0.0)
    rgb = np.clip(rgb, 0, 1)
    if extend is not None:
        rgb = np.where(a > 1e-4, rgb, extend)
    return np.dstack([rgb, np.clip(pm[..., 3], 0, 1)]).astype(np.float32)


def composite(rgba, bg):
    """Straight-alpha RGBA over a background (RGB triple or HxWx3), in sRGB-encoded space like browsers do."""
    bg = np.asarray(bg, np.float32)
    a = rgba[..., 3:4]
    return (rgba[..., :3] * a + bg * (1 - a)).astype(np.float32)


def checker(h, w, cell=16, c1=0.80, c2=1.0):
    yy, xx = np.mgrid[0:h, 0:w]
    m = ((yy // cell + xx // cell) % 2).astype(np.float32)
    v = c1 + (c2 - c1) * m
    return np.dstack([v, v, v]).astype(np.float32)


def diffuse_colors(rgb, mask, max_sigma=64.0):
    """Fill every pixel with a smooth estimate of the colour of the nearest `mask` pixels (normalised convolution at
    growing scales). Used as the 'local foreground colour' next to an edge and as the colour under alpha 0."""
    m = mask.astype(np.float32)
    num0 = (rgb * m[..., None]).astype(np.float32)
    out = np.zeros_like(rgb, dtype=np.float32)
    have = np.zeros(mask.shape, bool)
    h, w = mask.shape
    s = 1.5
    while True:
        f = 1
        while s / f > 4 and min(h, w) // (2 * f) >= 16:
            f *= 2                                             # large scales: blur a downsampled copy (it is linear)
        if f == 1:
            wb = cv2.GaussianBlur(m, (0, 0), s)
            nb = cv2.GaussianBlur(num0, (0, 0), s)
        else:
            ds = (max(1, w // f), max(1, h // f))
            wb = cv2.resize(cv2.GaussianBlur(cv2.resize(m, ds, interpolation=cv2.INTER_AREA), (0, 0), s / f), (w, h),
                            interpolation=cv2.INTER_LINEAR)
            nb = cv2.resize(cv2.GaussianBlur(cv2.resize(num0, ds, interpolation=cv2.INTER_AREA), (0, 0), s / f), (w, h),
                            interpolation=cv2.INTER_LINEAR)
        ok = (wb > 1e-3) & ~have
        out[ok] = nb[ok] / wb[ok][:, None]
        have |= ok
        if have.all() or s >= max_sigma:
            break
        s *= 2
    if not have.all():
        mean = rgb[mask].mean(0) if mask.any() else np.zeros(3, np.float32)
        out[~have] = mean
    out[mask] = rgb[mask]
    return out


# ------------------------------------------------------------------------------------------------------------
# background model (opaque images)
# ------------------------------------------------------------------------------------------------------------
def border_mask(h, w, frac=0.015, min_px=4):
    b = max(min_px, int(round(min(h, w) * frac)))
    m = np.zeros((h, w), bool)
    m[:b] = m[-b:] = True
    m[:, :b] = m[:, -b:] = True
    return m, b


def _design(xs, ys, w, h, order):
    x = xs / max(1, w - 1) * 2 - 1
    y = ys / max(1, h - 1) * 2 - 1
    cols = [np.ones_like(x)]
    if order >= 1:
        cols += [x, y]
    if order >= 2:
        cols += [x * x, x * y, y * y]
    return np.stack(cols, -1)


def fit_background(rgb, sample_mask=None, model='auto', max_samples=40000):
    """Fit a smooth background colour model to the border (or to `sample_mask`) with outlier rejection.

    model: 'flat' (one colour), 'plane' (linear gradient), 'quadratic', or 'auto' (the lowest order whose robust residual
    is within 25 percent of the quadratic's). Returns (bg HxWx3 float32, info dict: model, color hex at centre, noise_de
    (robust ΔE76 residual std of the samples), resid_flat_de, resid_quad_de, samples)."""
    h, w = rgb.shape[:2]
    if sample_mask is None:
        sample_mask, _ = border_mask(h, w)
    ys, xs = np.nonzero(sample_mask)
    if len(ys) == 0:
        fail('background model: no sample pixels', 1)
    step = max(1, len(ys) // max_samples)
    ys, xs = ys[::step], xs[::step]
    vals = rgb[ys, xs].astype(np.float64)
    lab_vals = srgb_to_lab(vals.astype(np.float32)).astype(np.float64)

    def fit(order):
        A = _design(xs.astype(np.float64), ys.astype(np.float64), w, h, order)
        keep = np.ones(len(ys), bool)
        coef = None
        for _ in range(4):
            coef, *_ = np.linalg.lstsq(A[keep], vals[keep], rcond=None)
            pred = A @ coef
            de = delta_e76(srgb_to_lab(np.clip(pred, 0, 1).astype(np.float32)), lab_vals)
            med = np.median(de[keep])
            mad = np.median(np.abs(de[keep] - med)) + 1e-6
            new = de <= med + 3.5 * 1.4826 * mad + 0.5
            if new.sum() < 16 or (new == keep).all():
                keep = new if new.sum() >= 16 else keep
                break
            keep = new
        pred = A @ coef
        de = delta_e76(srgb_to_lab(np.clip(pred, 0, 1).astype(np.float32)), lab_vals)
        robust = float(np.sqrt(np.mean(de[keep] ** 2))) if keep.any() else float('inf')
        return coef, robust, keep

    fits = {name: fit(o) for name, o in (('flat', 0), ('plane', 1), ('quadratic', 2))}
    if model == 'auto':
        rq = fits['quadratic'][1]
        model = 'quadratic'
        for name in ('flat', 'plane'):
            if fits[name][1] <= rq * 1.25 + 0.3:
                model = name
                break
    coef, robust, keep = fits[model]
    order = {'flat': 0, 'plane': 1, 'quadratic': 2}[model]
    yy, xx = np.mgrid[0:h, 0:w]
    A = _design(xx.ravel().astype(np.float64), yy.ravel().astype(np.float64), w, h, order)
    bg = np.clip((A @ coef).reshape(h, w, 3), 0, 1).astype(np.float32)
    info = {'model': model, 'color': rgb_to_hex(bg[h // 2, w // 2]), 'corner_colors': [rgb_to_hex(bg[0, 0]), rgb_to_hex(bg[0, -1]),
            rgb_to_hex(bg[-1, 0]), rgb_to_hex(bg[-1, -1])], 'noise_de': robust,
            'resid_flat_de': fits['flat'][1], 'resid_plane_de': fits['plane'][1], 'resid_quad_de': fits['quadratic'][1],
            'inlier_fraction': float(keep.mean()), 'samples': int(len(ys))}
    return bg, info


def bg_distance(rgb, bg, l_weight=1.0):
    """Per-pixel ΔE76 from the background model; l_weight < 1 makes lightness-only changes (shadows) count less."""
    la, lb = srgb_to_lab(rgb), srgb_to_lab(bg)
    d = la - lb
    if l_weight != 1.0:
        d[..., 0] *= l_weight
    return np.sqrt(np.sum(d * d, -1)).astype(np.float32), la, lb


def shadow_like(la, lb, max_chroma=7.0, min_l=38.0):
    """Pixels that differ from the background mainly by being darker with the same hue: floor / contact shadows."""
    dl = la[..., 0] - lb[..., 0]
    dc = np.hypot(la[..., 1] - lb[..., 1], la[..., 2] - lb[..., 2])
    return (dl < -1.0) & (dc < max_chroma + 0.12 * np.abs(dl)) & (la[..., 0] > min_l)


# ------------------------------------------------------------------------------------------------------------
# masks
# ------------------------------------------------------------------------------------------------------------
def components(mask, connectivity=8):
    n, lab, st, cen = cv2.connectedComponentsWithStats(mask.astype(np.uint8), connectivity=connectivity)
    return n, lab, st, cen


def fill_holes(mask):
    """-> (filled mask, holes mask). Holes = background regions not connected to the image border."""
    m = mask.astype(np.uint8)
    h, w = m.shape
    pad = np.zeros((h + 2, w + 2), np.uint8)
    pad[1:-1, 1:-1] = m
    ff = pad.copy()
    cv2.floodFill(ff, np.zeros((h + 4, w + 4), np.uint8), (0, 0), 1)
    holes = (ff[1:-1, 1:-1] == 0)
    return mask | holes, holes


def disk(r):
    r = max(1, int(round(r)))
    return cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (2 * r + 1, 2 * r + 1))


def main_figure_mask(alpha, thr=0.5, keep_frac=0.02):
    """Binary figure mask: alpha >= thr, components smaller than keep_frac of the largest dropped."""
    m = alpha >= thr
    n, lab, st, _ = components(m)
    if n <= 1:
        return m
    areas = st[1:, cv2.CC_STAT_AREA]
    big = areas.max()
    keep = np.zeros(n, bool)
    keep[1:] = areas >= keep_frac * big
    return keep[lab]


# ------------------------------------------------------------------------------------------------------------
# sub-pixel measurements shared by normalize_art.py and art_qa.py
# ------------------------------------------------------------------------------------------------------------
def _clean_alpha(alpha):
    """Alpha of the main figure only (specks removed) with 1-2 px fibres opened away, for extent measurements."""
    m = main_figure_mask(alpha, 0.5)
    if not m.any():
        return np.zeros_like(alpha), m
    ys, xs = np.nonzero(m)
    hgt = ys.max() - ys.min() + 1
    region = cv2.dilate(m.astype(np.uint8), disk(max(3, hgt * 0.004))) > 0
    a = np.where(region, alpha, 0).astype(np.float32)
    k = max(3, int(round(3 * hgt / 1158.0)) | 1)
    a = cv2.morphologyEx(a, cv2.MORPH_OPEN, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (k, k)))
    return a, m


def vertical_extent(alpha):
    """Sub-pixel rows of the 0.5 alpha crossings at the top and bottom of the main figure (index coordinates).
    -> (top_cross, bottom_cross); the frame's topY = top_cross + 0.5 and feetY = bottom_cross - 0.5."""
    a, m = _clean_alpha(alpha)
    if not m.any():
        fail('no figure found (alpha never reaches 0.5)', 1)
    p = a.max(axis=1)
    rows = np.nonzero(p >= 0.5)[0]
    y0, y1 = rows[0], rows[-1]
    if y0 == 0:
        top = -0.5
    else:
        pa, pb = p[y0 - 1], p[y0]
        top = (y0 - 1) + (0.5 - pa) / max(1e-6, pb - pa)
    if y1 == len(p) - 1:
        bot = len(p) - 0.5
    else:
        pa, pb = p[y1], p[y1 + 1]
        bot = y1 + (pa - 0.5) / max(1e-6, pa - pb)
    return float(top), float(bot)


def horizontal_extent(alpha):
    a, m = _clean_alpha(alpha)
    p = a.max(axis=0)
    cols = np.nonzero(p >= 0.5)[0]
    if len(cols) == 0:
        fail('no figure found', 1)
    x0, x1 = cols[0], cols[-1]
    left = -0.5 if x0 == 0 else (x0 - 1) + (0.5 - p[x0 - 1]) / max(1e-6, p[x0] - p[x0 - 1])
    right = len(p) - 0.5 if x1 == len(p) - 1 else x1 + (p[x1] - 0.5) / max(1e-6, p[x1] - p[x1 + 1])
    return float(left), float(right)


def mirror_axis(alpha, search_frac=0.15):
    """Symmetry axis (index-coordinate column, sub-pixel) maximising the overlap of the alpha with its mirror image.
    -> (axis, soft IoU at the axis). Coarse: exact integer mirrors (2*axis integer); fine: +-0.75 px in 0.05 px
    steps on a lightly pre-blurred alpha (so interpolation blur does not bias the optimum), then a parabola fit."""
    a, m = _clean_alpha(alpha)
    if not m.any():
        fail('no figure found for the symmetry axis', 1)
    ys, xs = np.nonzero(m)
    y0, y1 = ys.min(), ys.max() + 1
    x0, x1 = xs.min(), xs.max() + 1
    bw = x1 - x0
    pad = int(bw * search_frac) + 8
    X0, X1 = max(0, x0 - pad), min(a.shape[1], x1 + pad)
    sub = np.ascontiguousarray(a[y0:y1, X0:X1])
    W = sub.shape[1]
    cols = np.arange(W)
    cx = (x0 + x1 - 1) / 2.0 - X0

    def iou_int(k, img=sub):
        n = img.shape[1]
        cc = np.arange(n)
        src = k - cc
        ok = (src >= 0) & (src < n)
        f = np.zeros_like(img)
        f[:, cc[ok]] = img[:, src[ok]]
        return float(np.minimum(img, f).sum() / max(1e-6, np.maximum(img, f).sum()))

    d = 4 if W > 480 else 1                                   # coarse pass on a 4x smaller copy, then refine
    small = cv2.resize(sub, (max(1, W // d), max(1, sub.shape[0] // d)), interpolation=cv2.INTER_AREA) if d > 1 else sub
    scx = (cx + 0.5) / d - 0.5
    lo, hi = int(np.floor(2 * scx - 2 * bw * search_frac / d)), int(np.ceil(2 * scx + 2 * bw * search_frac / d))
    ks = max(range(lo, hi + 1), key=lambda k: iou_int(k, small))
    c0 = (ks / 2.0 + 0.5) * d - 0.5
    best_k = max(range(int(round(2 * c0)) - 2 * d - 1, int(round(2 * c0)) + 2 * d + 2), key=iou_int)
    sm = cv2.GaussianBlur(sub, (0, 0), 0.8)
    xx = np.arange(W, dtype=np.float32)[None, :].repeat(sub.shape[0], 0)
    yy = np.arange(sub.shape[0], dtype=np.float32)[:, None].repeat(W, 1)

    def iou_frac(c):
        mapx = (2 * c - xx).astype(np.float32)
        f = cv2.remap(sm, mapx, yy, cv2.INTER_LINEAR, borderMode=cv2.BORDER_CONSTANT, borderValue=0)
        return float(np.minimum(sm, f).sum() / max(1e-6, np.maximum(sm, f).sum()))

    cs = best_k / 2.0 + np.arange(-0.45, 0.4501, 0.05)
    sc = np.array([iou_frac(c) for c in cs])
    i = int(np.argmax(sc))
    c = cs[i]
    if 0 < i < len(sc) - 1:
        d = sc[i - 1] - 2 * sc[i] + sc[i + 1]
        if d < 0:
            c = cs[i] + 0.05 * 0.5 * (sc[i - 1] - sc[i + 1]) / d
    return float(c + X0), iou_int(int(round(2 * c)))


def figure_measurements(alpha):
    """Everything normalize_art.py needs from a straight-alpha figure (index coordinates)."""
    top, bot = vertical_extent(alpha)
    left, right = horizontal_extent(alpha)
    axis, iou = mirror_axis(alpha)
    m = main_figure_mask(alpha, 0.5)
    ys, xs = np.nonzero(m)
    return {'top_cross': top, 'bottom_cross': bot, 'left_cross': left, 'right_cross': right,
            'topY': top + 0.5, 'feetY': bot - 0.5, 'height_px': bot - top, 'width_px': right - left,
            'axis': axis, 'mirror_iou': iou,
            'bbox': [int(xs.min()), int(ys.min()), int(xs.max() - xs.min() + 1), int(ys.max() - ys.min() + 1)]}


# ------------------------------------------------------------------------------------------------------------
# console output
# ------------------------------------------------------------------------------------------------------------
def table(rows, headers):
    cols = list(zip(*([headers] + [[str(c) for c in r] for r in rows]))) if rows else [[h] for h in headers]
    widths = [max(len(str(x)) for x in c) for c in cols]
    out = ['  '.join(str(h).ljust(w) for h, w in zip(headers, widths))]
    for r in rows:
        out.append('  '.join(str(c).ljust(w) for c, w in zip(r, widths)))
    return '\n'.join(out)
