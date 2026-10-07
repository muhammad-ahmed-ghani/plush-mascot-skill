#!/usr/bin/env python3
"""Cut a figure out of its background into a clean straight-alpha RGBA PNG, without a halo; or measure the halo.

    python3 scripts/tools/alpha_extract.py key   art/masters/front.png --out art/work/front-rgba.png
    python3 scripts/tools/alpha_extract.py key   front-green.png --bg '#00ff00' --out front-rgba.png
    python3 scripts/tools/alpha_extract.py flood front.png --out front-rgba.png --seed 620,980
    python3 scripts/tools/alpha_extract.py difference on-white.png on-black.png --out cut.png
    python3 scripts/tools/alpha_extract.py refine model-cutout.png --out cleaned.png [--bg '#ffffff']
    python3 scripts/tools/alpha_extract.py verify any-rgba.png            (same as: alpha_extract.py --verify any-rgba.png)

Modes
  key         Background colour keying. The background is modelled from the image border (flat colour, plane or
              quadratic gradient, chosen automatically; or --bg #hex), every pixel gets its ΔE76 distance d in Lab.
              d < t0 is background; the rest is the figure (islands below --min-island px removed, enclosed pin-holes
              filled). Inside a band --band px wide along the silhouette alpha is solved from the compositing equation
              C = aF + (1-a)B, with B the background model and F the local foreground colour propagated from the
              figure interior (projection of C-B on F-B, in the sRGB-encoded space browsers composite in). Colour at
              partial alpha is decontaminated by unmixing F = (C - (1-a)B)/a (blended towards the local interior colour
              at very low alpha, where unmixing only amplifies noise), then despilled: any remaining pull of the edge
              colour towards the background is removed. --solve ramp uses the plain Lab ramp a = (d-t0)/(t1-t0) instead.
  flood       As key, but the background is only what is connected to the border (or to --seed x,y points) through
              pixels with d < t0, so interior regions that match the key colour stay opaque. Use it when the figure
              contains the key colour (a white catchlight on a white key); add seeds inside see-through gaps.
  difference  Two pixel-aligned renders of the same figure on two different flat backgrounds (difference matting):
              a = 1 - ((A-B)·(B1-B2)) / |B1-B2|^2, F unmixed from both. Warns when the pair is not aligned.
  refine      Improve an existing RGBA (an image model's transparent output, a hard-edged mask): guided-filter the
              alpha in a band along the edge, then remove the halo: the old background colour is estimated from the
              edge pixels (or --bg) and unmixed, then the edge colour is despilled towards the interior.
  verify      Halo metrics of any RGBA file (see below); nothing is written unless --report is given.

Every extraction writes OUT (straight alpha, 8-bit unless the input is 16-bit; colour under alpha 0 is the propagated
edge colour so filtering without premultiplication cannot darken edges; --matte-color black writes 0 instead), and
OUT with '.preview.png' (the cut-out over light, dark and checker panels) unless --no-preview.

Halo metrics (--verify, verify mode, and the "verify" block of --report)
  edge pixels: 0.05 < alpha < 0.95. For each, the straight colour F_e is compared with the colour of the nearest
  opaque interior (alpha >= 0.95, propagated outwards, F_i):
    on_light_de / on_dark_de   mean ΔE76 between the edge composited over white / black and the same edge with
                               the interior colour (what a halo looks like on a light / dark page)
    straight_de                mean ΔE76(F_e, F_i), alpha-weighted
    lightness_bias             alpha-weighted mean L*(F_e) - L*(F_i): > 0 light fringe (old light background),
                               < 0 dark fringe (old dark background or premultiplied colour saved as straight)
    halo_score                 max(on_light_de, on_dark_de); verdict "clean" below 6, "halo" above 10
  (thresholds from the self-test: the example art scores about 2.6, the same art with an un-decontaminated white
  key edge about 15; see selftest.py)

Report JSON (--report FILE), stable keys:
  {"tool": "alpha_extract.py", "version": 1, "mode", "input", "output", "size": [w, h],
   "background": {"model", "color", "noise_de", ...}, "t0", "t1", "band_px", "coverage" (mean alpha),
   "figure_px", "islands_removed", "holes_filled", "holes_kept": [areas], "low_contrast_fraction",
   "warnings": [..], "verify": {halo metrics}}

Exit codes: 0 ok (verify: clean or halo, it only measures), 1 processing failure, 2 usage / input error,
5 output exists (use --force).
"""
import argparse
import os
import sys

import numpy as np
import cv2

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import _toolkit as tk  # noqa: E402

VERSION = 1
LIGHT_PANEL = (0.957, 0.945, 0.918)
DARK_PANEL = (0.118, 0.118, 0.133)


# ------------------------------------------------------------------------------------------------------------
# halo metrics
# ------------------------------------------------------------------------------------------------------------
def halo_metrics(rgba):
    """Measure edge-colour contamination of a straight-alpha RGBA image (see the module docstring)."""
    a = rgba[..., 3]
    rgb = rgba[..., :3]
    edge = (a > 0.05) & (a < 0.95)
    interior = cv2.erode((a >= 0.95).astype(np.uint8), np.ones((3, 3), np.uint8)) > 0
    n_edge = int(edge.sum())
    fig = int((a >= 0.5).sum())
    if n_edge == 0 or not interior.any():
        return {'edge_pixels': n_edge, 'figure_px': fig, 'on_light_de': 0.0, 'on_dark_de': 0.0, 'straight_de': 0.0,
                'lightness_bias': 0.0, 'halo_score': 0.0, 'verdict': 'no soft edge' if n_edge == 0 else 'no interior'}
    fi = tk.diffuse_colors(rgb, interior, max_sigma=32.0)
    ae = a[edge][:, None]
    fe_rgb, fi_rgb = rgb[edge], fi[edge]
    out = {}
    for name, bg in (('on_light_de', 1.0), ('on_dark_de', 0.0)):
        act = fe_rgb * ae + bg * (1 - ae)
        exp = fi_rgb * ae + bg * (1 - ae)
        out[name] = float(tk.delta_e76(tk.srgb_to_lab(act), tk.srgb_to_lab(exp)).mean())
    le, li = tk.srgb_to_lab(fe_rgb), tk.srgb_to_lab(fi_rgb)
    w = ae[:, 0]
    out['straight_de'] = float((tk.delta_e76(le, li) * w).sum() / w.sum())
    out['lightness_bias'] = float(((le[:, 0] - li[:, 0]) * w).sum() / w.sum())
    score = max(out['on_light_de'], out['on_dark_de'])
    verdict = 'clean' if score < 6 else ('halo' if score > 10 else 'borderline')
    if verdict != 'clean':
        verdict += ' (light fringe)' if out['lightness_bias'] > 0 else ' (dark fringe)'
    return {'edge_pixels': n_edge, 'figure_px': fig, 'edge_ratio': n_edge / max(1, fig), **out,
            'halo_score': score, 'verdict': verdict}


# ------------------------------------------------------------------------------------------------------------
# helpers
# ------------------------------------------------------------------------------------------------------------
def guided_filter(I, p, r, eps):
    k = (2 * r + 1, 2 * r + 1)

    def box(x):
        return cv2.boxFilter(x, -1, k, normalize=True, borderType=cv2.BORDER_REFLECT)
    mI, mp = box(I), box(p)
    cov = box(I * p) - mI * mp
    var = box(I * I) - mI * mI
    A = cov / (var + eps)
    B = mp - A * mI
    return box(A) * I + box(B)


def auto_band(h, w):
    return max(4, int(round(6 * min(h, w) / 1254.0)))


def clean_regions(fig, min_island, pinhole, fill_mode, max_hole_frac, d=None, bg_level=None):
    """Remove islands smaller than min_island, fill enclosed holes. -> (mask, islands_removed, holes_filled, holes_kept).
    With --fill-holes auto a hole is filled when it is a pin-hole (<= pinhole px) or, up to max_hole_frac of the figure
    area, when its mean distance from the background (d) is clearly above the background's own noise (bg_level):
    such a region is a feature close to the key colour (cream eyes on a light key), not a see-through gap."""
    n, lab, st, _ = tk.components(fig)
    removed = 0
    if n > 1:
        areas = st[1:, cv2.CC_STAT_AREA]
        keep = np.zeros(n, bool)
        keep[1:] = areas >= min_island
        keep[1 + int(np.argmax(areas))] = True                  # never drop the figure itself
        removed = int((~keep[1:]).sum())
        fig = keep[lab]
    area = int(fig.sum())
    _, holes = tk.fill_holes(fig)
    hn, hlab, hst, _ = tk.components(holes, 4)
    if hn <= 1:
        return fig, removed, 0, []
    ha = hst[1:, cv2.CC_STAT_AREA]
    if fill_mode == 'all':
        fill = np.ones(hn - 1, bool)
    elif fill_mode == 'none':
        fill = np.zeros(hn - 1, bool)
    else:
        fill = ha <= pinhole
        if max_hole_frac > 0:
            fill |= ha <= max_hole_frac * area if d is None else np.zeros_like(fill)
            if d is not None:
                sums = np.bincount(hlab.ravel(), weights=d.ravel(), minlength=hn)[1:]
                mean_d = sums / np.maximum(ha, 1)
                fill |= (ha <= max_hole_frac * area) & (mean_d > bg_level)
    lut = np.zeros(hn, bool)
    lut[1:] = fill
    kept = sorted((int(x) for x in ha[~fill]), reverse=True)
    return fig | lut[hlab], removed, int(fill.sum()), kept


def solve_band(rgb, bg, fig, band, d, t0, t1, solve, despill, matte_color, w_in):
    """Alpha + decontaminated colour for a binary figure region `fig` (see the module docstring).

    Pass 1 solves alpha in a `band` px wide strip along the region's edge with the foreground colour propagated from
    beyond the strip; that locates the 0.5 contour. Pass 2 treats everything deeper than `w_in` px inside that contour
    as opaque and re-solves the outer strip with the foreground colour sampled just `w_in` px inside the contour: real
    plush edges go from transparent to opaque within about 3 px (example art: 95 percent of the partial pixels lie
    between 1 px outside and 3 px inside the contour), and rim-lit fibre tips are lighter than the fabric 6 px in, so
    a deeper colour sample would underestimate alpha and darken the edge."""
    h, w = fig.shape
    ramp = np.clip((d - t0) / max(1e-3, (t1 - t0)), 0, 1)

    def inner_of(mask, r):
        inner = cv2.erode(mask.astype(np.uint8), tk.disk(r)) > 0
        if inner.sum() < 50:
            inner = cv2.erode(mask.astype(np.uint8), tk.disk(1)) > 0
            if inner.sum() < 10:
                inner = mask.copy()
        return inner

    def project(inner, region):
        f_est = tk.diffuse_colors(rgb, inner, max_sigma=64.0)
        C, B, F = rgb[region], bg[region], f_est[region]
        fb = F - B
        a = np.sum((C - B) * fb, -1) / np.maximum(np.sum(fb * fb, -1), 1e-6)
        weak = tk.delta_e76(tk.srgb_to_lab(F), tk.srgb_to_lab(B)) < max(t1, 2.5 * t0)
        return np.clip(np.where(weak, ramp[region], a), 0, 1), f_est, weak

    inner = inner_of(fig, band)
    bandm = fig & ~inner
    alpha = np.zeros((h, w), np.float32)
    alpha[inner] = 1.0
    low_contrast = np.zeros((h, w), bool)
    if solve == 'ramp':
        alpha[bandm] = ramp[bandm]
        f_est = tk.diffuse_colors(rgb, inner, max_sigma=64.0)
    else:
        a1, _, _ = project(inner, bandm)
        alpha[bandm] = a1
        core = ((alpha >= 0.5) & fig).astype(np.uint8)
        din = cv2.distanceTransform(core, cv2.DIST_L2, 5)
        inner2 = din > w_in
        if inner2.sum() >= 50:
            inner = inner2
            bandm = fig & ~inner
        a2, f_est, weak = project(inner, bandm)
        alpha = np.zeros((h, w), np.float32)
        alpha[inner] = 1.0
        alpha[bandm] = a2
        low_contrast[bandm] = weak
    # decontaminate the band
    out_rgb = rgb.copy()
    am = alpha[bandm][:, None]
    C, B, F = rgb[bandm], bg[bandm], f_est[bandm]
    unmix = np.clip((C - (1 - am) * B) / np.maximum(am, 1e-3), 0, 1)
    wgt = np.clip((am - 0.02) / 0.33, 0, 1)
    wgt = wgt * wgt * (3 - 2 * wgt)
    col = wgt * unmix + (1 - wgt) * F
    if despill > 0:
        u = B - F
        un = np.linalg.norm(u, axis=-1, keepdims=True)
        u = u / np.maximum(un, 1e-6)
        s = np.sum((col - F) * u, -1, keepdims=True)
        col = col - despill * np.maximum(s, 0) * u
    out_rgb[bandm] = np.clip(col, 0, 1)
    zero = alpha <= 0
    if matte_color == 'extend':
        out_rgb[zero] = f_est[zero]
    else:
        out_rgb[zero] = 0
    return np.dstack([out_rgb, alpha]).astype(np.float32), bandm, low_contrast


def preview_panels(rgba, path, max_side=900):
    h, w = rgba.shape[:2]
    s = min(1.0, max_side / max(h, w))
    if s < 1:
        pm = cv2.resize(tk.premultiply(rgba), (int(round(w * s)), int(round(h * s))), interpolation=cv2.INTER_AREA)
        small = tk.unpremultiply(pm)
    else:
        small = rgba
    sh, sw = small.shape[:2]
    panels = [tk.composite(small, LIGHT_PANEL), tk.composite(small, DARK_PANEL),
              tk.composite(small, tk.checker(sh, sw, 12, 0.72, 0.92))]
    gap = np.full((sh, 6, 3), 0.5, np.float32)
    tk.write_png(path, np.concatenate([panels[0], gap, panels[1], gap, panels[2]], axis=1))


def load_rgb(path):
    rgba, info = tk.read_image(path)
    return rgba, info


def finish(args, rgba_out, info, report):
    bits = 16 if info.get('bits') == 16 else 8
    tk.write_png(args.out, rgba_out, bits=bits)
    if not args.no_preview:
        preview_panels(rgba_out, os.path.splitext(args.out)[0] + '.preview.png')
    ver = halo_metrics(rgba_out)
    report['verify'] = ver
    report['coverage'] = float(rgba_out[..., 3].mean())
    if args.report:
        tk.write_json(args.report, report)
    warn = report.get('warnings', [])
    print(f'alpha_extract {report["mode"]}: wrote {args.out} ({rgba_out.shape[1]}x{rgba_out.shape[0]}, '
          f'figure {report.get("figure_px", int((rgba_out[..., 3] >= 0.5).sum()))} px); halo score {ver["halo_score"]:.2f} '
          f'({ver["verdict"]}, lightness bias {ver["lightness_bias"]:+.2f})' + ('' if args.no_preview else '; preview .preview.png'))
    for w_ in warn:
        print(f'  warning: {w_}')
    return 0


# ------------------------------------------------------------------------------------------------------------
# modes
# ------------------------------------------------------------------------------------------------------------
def run_key(args, flood=False):
    rgba, info = load_rgb(args.input)
    tk.check_out(args.out, args.force)
    warnings = []
    if info['has_alpha'] and rgba[..., 3].min() < 0.99:
        warnings.append('the input already has an alpha channel; key mode uses only its colour '
                        '(use `refine` to improve an existing alpha)')
    rgb = rgba[..., :3].copy()
    h, w = rgb.shape[:2]
    if args.bg and args.bg != 'auto':
        col = tk.hex_to_rgb(args.bg)
        bg = np.broadcast_to(col, rgb.shape).astype(np.float32).copy()
        bmask, _ = tk.border_mask(h, w)
        de = tk.delta_e76(tk.srgb_to_lab(rgb[bmask]), tk.srgb_to_lab(col[None, :]))
        binfo = {'model': 'given', 'color': tk.rgb_to_hex(col), 'noise_de': float(np.median(de) * 1.4826),
                 'border_median_de': float(np.median(de))}
        if np.median(de) > 12:
            warnings.append(f'the border is {np.median(de):.1f} ΔE away from --bg {args.bg} on average; is it the right key colour?')
    else:
        bg, binfo = tk.fit_background(rgb, model=args.bg_model)
    d, _, _ = tk.bg_distance(rgb, bg)
    noise = binfo.get('noise_de', 0.0)
    t0 = args.t0 if args.t0 is not None else max(4.0, 3.0 * noise)
    t1 = args.t1 if args.t1 is not None else t0 + 20.0
    if t1 <= t0:
        tk.fail('--t1 must be larger than --t0', 2)
    fig = d >= t0
    if flood:
        bgcand = (d < t0).astype(np.uint8)
        n, lab, st, _ = tk.components(bgcand, 4)
        seeds = set()
        if args.seed:
            for s in args.seed:
                try:
                    x, y = [int(round(float(v))) for v in s.split(',')]
                except ValueError:
                    tk.fail(f'--seed wants x,y (got {s!r})', 2)
                if not (0 <= x < w and 0 <= y < h):
                    tk.fail(f'--seed {s} is outside the image', 2)
                if lab[y, x] == 0:
                    warnings.append(f'--seed {s} is not on a background-coloured pixel (d={d[y, x]:.1f} >= t0)')
                seeds.add(int(lab[y, x]))
        border_labels = set(np.unique(np.concatenate([lab[0], lab[-1], lab[:, 0], lab[:, -1]])).tolist())
        seeds |= border_labels
        seeds.discard(0)
        is_bg = np.isin(lab, list(seeds))
        fig = ~is_bg
    fig_area_est = max(1, int(fig.sum()))
    min_island = args.min_island if args.min_island is not None else max(16, int(2e-5 * h * w))
    pinhole = max(16, int(0.0004 * fig_area_est))
    fig, removed, filled, kept = clean_regions(fig, min_island, pinhole, args.fill_holes, args.max_hole, d,
                                               max(2.0, 2.0 * noise))
    if not fig.any():
        tk.fail('nothing left after keying: the whole image matches the background (check --bg / --t0)', 1)
    ys, xs = np.nonzero(fig)
    if ys.min() == 0 or xs.min() == 0 or ys.max() == h - 1 or xs.max() == w - 1:
        warnings.append('the figure touches the image border (cropped, or the background model is wrong)')
    small_kept = [k for k in kept if k < 0.02 * fig.sum()]
    if small_kept:
        warnings.append(f'{len(small_kept)} enclosed background-coloured region(s) kept as holes (largest {small_kept[0]} px): '
                        'if they are features (a white catchlight on a white key) rerun with --fill-holes all or use flood, '
                        'or regenerate on a contrasting key colour')
    band = args.band if args.band else auto_band(h, w)
    w_in = args.edge_width if args.edge_width else max(2.0, 2.5 * min(h, w) / 1254.0)
    out, bandm, low = solve_band(rgb, bg, fig, band, d, t0, t1, args.solve, args.despill, args.matte_color, w_in)
    lc = float(low[bandm].mean()) if bandm.any() else 0.0
    if lc > 0.15:
        warnings.append(f'{lc * 100:.0f} percent of the edge has little contrast with the background (ΔE < {max(t1, 2.5 * t0):.0f}); '
                        'the matte falls back to the ramp there: regenerate on a key colour further from the figure colours')
    report = {'tool': 'alpha_extract.py', 'version': VERSION, 'mode': 'flood' if flood else 'key', 'input': args.input,
              'output': args.out, 'size': [w, h], 'background': binfo, 't0': t0, 't1': t1, 'band_px': band, 'edge_width_px': w_in,
              'solve': args.solve, 'figure_px': int(fig.sum()), 'islands_removed': removed, 'holes_filled': filled,
              'holes_kept': kept[:20], 'low_contrast_fraction': lc, 'warnings': warnings}
    return finish(args, out, info, report)


def run_difference(args):
    A, ia = load_rgb(args.input)
    Bimg, ib = load_rgb(args.input2)
    tk.check_out(args.out, args.force)
    if A.shape != Bimg.shape:
        tk.fail(f'the two images differ in size ({A.shape[1]}x{A.shape[0]} vs {Bimg.shape[1]}x{Bimg.shape[0]})', 2)
    a_rgb, b_rgb = A[..., :3], Bimg[..., :3]
    h, w = a_rgb.shape[:2]
    bm, _ = tk.border_mask(h, w)
    b1 = tk.hex_to_rgb(args.bg_a) if args.bg_a else np.median(a_rgb[bm], 0)
    b2 = tk.hex_to_rgb(args.bg_b) if args.bg_b else np.median(b_rgb[bm], 0)
    db = b1 - b2
    nd = float(np.dot(db, db))
    warnings = []
    if nd < 0.09:
        tk.fail(f'the two backgrounds are too similar ({tk.rgb_to_hex(b1)} vs {tk.rgb_to_hex(b2)}); use e.g. white and black', 2)
    alpha = 1 - np.sum((a_rgb - b_rgb) * db, -1) / nd
    alpha = np.clip(alpha, 0, 1).astype(np.float32)
    alpha[alpha < 0.01] = 0
    am = alpha[..., None]
    f1 = (a_rgb - (1 - am) * b1) / np.maximum(am, 1e-3)
    f2 = (b_rgb - (1 - am) * b2) / np.maximum(am, 1e-3)
    col = np.clip((f1 + f2) / 2, 0, 1)
    resid = np.linalg.norm((a_rgb - b_rgb) - (1 - am) * db, axis=-1)
    fg = alpha > 0.5
    med = float(np.median(resid[fg])) if fg.any() else 0.0
    if med > 0.03:
        warnings.append(f'median residual {med:.3f}: the two images are not pixel-aligned or the figure changed between them; '
                        'difference matting needs two identical renders (use key mode for image-model output)')
    interior = cv2.erode((alpha >= 0.95).astype(np.uint8), np.ones((3, 3), np.uint8)) > 0
    ext = tk.diffuse_colors(col.astype(np.float32), interior if interior.any() else fg)
    col = np.where(am > 0, col, ext if args.matte_color == 'extend' else 0)
    out = np.dstack([col, alpha]).astype(np.float32)
    report = {'tool': 'alpha_extract.py', 'version': VERSION, 'mode': 'difference', 'input': [args.input, args.input2],
              'output': args.out, 'size': [w, h], 'background': {'a': tk.rgb_to_hex(b1), 'b': tk.rgb_to_hex(b2)},
              'figure_px': int(fg.sum()), 'median_residual': med, 'warnings': warnings}
    return finish(args, out, ia, report)


def run_refine(args):
    rgba, info = load_rgb(args.input)
    tk.check_out(args.out, args.force)
    if not info['has_alpha'] or rgba[..., 3].min() > 0.99:
        tk.fail('refine needs an RGBA input with a real alpha channel (use key or flood for opaque images)', 2)
    warnings = []
    a0 = rgba[..., 3].copy()
    rgb = rgba[..., :3].copy()
    h, w = a0.shape
    r = args.radius if args.radius else max(2, int(round(3 * min(h, w) / 1254.0)))
    I = tk.luminance(rgb * a0[..., None] + 0.5 * (1 - a0[..., None]))
    ar = np.clip(guided_filter(I.astype(np.float32), a0.astype(np.float32), r, args.eps), 0, 1)
    hard = (a0 >= 0.5).astype(np.uint8)
    bandm = (cv2.dilate(hard, tk.disk(r)) - cv2.erode(hard, tk.disk(r))) > 0
    alpha = np.where(bandm, ar, a0).astype(np.float32)
    # islands / pin-holes
    fig = alpha >= 0.5
    min_island = args.min_island if args.min_island is not None else max(16, int(2e-5 * h * w))
    pinhole = max(16, int(0.0004 * max(1, fig.sum())))
    clean, removed, filled, kept = clean_regions(fig, min_island, pinhole, args.fill_holes, args.max_hole)
    alpha = np.where(clean & ~fig, 1.0, alpha)                                     # filled holes
    gone = fig & ~clean
    alpha[(cv2.dilate(gone.astype(np.uint8), tk.disk(2)) > 0) & ~clean] = 0        # removed islands and their soft rims
    interior = cv2.erode((alpha >= 0.95).astype(np.uint8), np.ones((3, 3), np.uint8)) > 0
    f_i = tk.diffuse_colors(rgb, interior if interior.any() else clean, max_sigma=32.0)
    edge = (alpha > 0.02) & (alpha < 0.98)
    old_bg = None
    if args.bg:
        old_bg = tk.hex_to_rgb(args.bg)
    else:
        sel = edge & (alpha > 0.15) & (alpha < 0.85)
        if sel.sum() > 50:
            am = alpha[sel][:, None]
            est = (rgb[sel] - am * f_i[sel]) / np.maximum(1 - am, 1e-3)
            med = np.median(est, 0)
            spread = np.median(np.linalg.norm(est - med, axis=-1))
            ver0 = halo_metrics(np.dstack([rgb, alpha]))
            if ver0['halo_score'] > 6 and spread < 0.25:
                old_bg = np.clip(med, 0, 1)
                warnings.append(f'edge colours are pulled towards {tk.rgb_to_hex(old_bg)} (halo score {ver0["halo_score"]:.1f}); unmixed')
    col = rgb.copy()
    if old_bg is not None:
        am = alpha[edge][:, None]
        col[edge] = np.clip((rgb[edge] - (1 - am) * old_bg) / np.maximum(am, 1e-3), 0, 1)
        wgt = np.clip((am - 0.02) / 0.33, 0, 1)
        col[edge] = wgt * col[edge] + (1 - wgt) * f_i[edge]
        u = old_bg[None, :] - f_i[edge]
    else:
        u = None
    if args.despill > 0 and u is not None:
        un = np.linalg.norm(u, axis=-1, keepdims=True)
        u = u / np.maximum(un, 1e-6)
        s = np.sum((col[edge] - f_i[edge]) * u, -1, keepdims=True)
        col[edge] = col[edge] - args.despill * np.maximum(s, 0) * u
    zero = alpha <= 0
    col[zero] = f_i[zero] if args.matte_color == 'extend' else 0
    out = np.dstack([np.clip(col, 0, 1), alpha]).astype(np.float32)
    report = {'tool': 'alpha_extract.py', 'version': VERSION, 'mode': 'refine', 'input': args.input, 'output': args.out,
              'size': [w, h], 'radius': r, 'eps': args.eps, 'old_background': tk.rgb_to_hex(old_bg) if old_bg is not None else None,
              'figure_px': int((alpha >= 0.5).sum()), 'islands_removed': removed, 'holes_filled': filled, 'holes_kept': kept[:20],
              'input_verify': halo_metrics(rgba), 'warnings': warnings}
    return finish(args, out, info, report)


def run_verify(args):
    rgba, info = tk.read_image(args.input)
    if not info['has_alpha'] or rgba[..., 3].min() > 0.999:
        tk.fail(f'{args.input} has no real alpha channel (every pixel is opaque)', 2)
    m = halo_metrics(rgba)
    rep = {'tool': 'alpha_extract.py', 'version': VERSION, 'mode': 'verify', 'input': args.input,
           'size': [info['width'], info['height']], 'verify': m}
    if args.report:
        tk.write_json(args.report, rep)
    print(f'alpha_extract verify: {args.input}: halo score {m["halo_score"]:.2f} ({m["verdict"]}); on light {m["on_light_de"]:.2f}, '
          f'on dark {m["on_dark_de"]:.2f}, straight {m["straight_de"]:.2f} ΔE, lightness bias {m["lightness_bias"]:+.2f} L*, '
          f'{m["edge_pixels"]} edge px')
    return 0


def build_parser():
    ap = argparse.ArgumentParser(
        description='Cut a figure out of its background into straight-alpha RGBA without a halo (key, flood, difference, '
                    'refine), or measure halo metrics of an RGBA file (verify). See the module docstring for the method.',
        epilog='examples:\n'
               "  python3 scripts/tools/alpha_extract.py key art/masters/front-green.png --bg '#00ff00' --out art/work/front-rgba.png\n"
               '  python3 scripts/tools/alpha_extract.py flood art/masters/front-white.png --out art/work/front-rgba.png\n'
               '  python3 scripts/tools/alpha_extract.py refine art/masters/front-transparent.png --out art/work/front-rgba.png\n'
               '  python3 scripts/tools/alpha_extract.py --verify assets/mascot-transparent.png',
        formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest='mode', required=True)

    def common(p, needs_out=True):
        if needs_out:
            p.add_argument('--out', required=True, help='output RGBA PNG')
            p.add_argument('--force', action='store_true', help='overwrite an existing output')
            p.add_argument('--no-preview', action='store_true', help='do not write OUT.preview.png')
            p.add_argument('--matte-color', choices=['extend', 'black'], default='extend',
                           help='colour stored under alpha 0 (default: the propagated edge colour)')
        p.add_argument('--report', help='write the JSON report here')

    def keyopts(p):
        p.add_argument('input', help='opaque image with a flat or smoothly varying background')
        p.add_argument('--bg', help="background colour '#rrggbb' (default: modelled from the image border)")
        p.add_argument('--bg-model', choices=['auto', 'flat', 'plane', 'quadratic'], default='auto',
                       help='background model fitted to the border when --bg is not given (default auto)')
        p.add_argument('--t0', type=float, help='ΔE below which a pixel is background (default max(4, 3.5 x border noise))')
        p.add_argument('--t1', type=float, help='ΔE at which the ramp reaches alpha 1 (default t0 + 20)')
        p.add_argument('--solve', choices=['project', 'ramp'], default='project',
                       help='edge alpha: compositing-equation projection (default) or the plain Lab ramp')
        p.add_argument('--band', type=int, help='first-pass edge band in px (default 6 px per 1254 px of image)')
        p.add_argument('--edge-width', type=float,
                       help='how far inside the 0.5 contour alpha may stay below 1, in px (default 2.5 per 1254 px)')
        p.add_argument('--despill', type=float, default=1.0, help='0..1, remove edge colour pulled towards the key (default 1)')
        p.add_argument('--min-island', type=int, help='drop separate specks smaller than this many px (default 2e-5 x image area, >= 16)')
        p.add_argument('--fill-holes', choices=['auto', 'all', 'none'], default='auto',
                       help='enclosed background-coloured regions: auto fills pin-holes (<= 0.04 percent of the figure) and '
                            'regions up to --max-hole whose colour is measurably off the key (features such as cream eyes on a '
                            'light key), and keeps the rest as see-through gaps; all fills every one; none keeps all')
        p.add_argument('--max-hole', type=float, default=0.05,
                       help='largest enclosed region (fraction of the figure area) --fill-holes auto may fill (default 0.05)')

    p = sub.add_parser('key', help='background colour keying with soft matte, unmixing and despill')
    keyopts(p)
    common(p)
    p = sub.add_parser('flood', help='as key, but background = what is connected to the border / seeds')
    keyopts(p)
    p.add_argument('--seed', action='append', help='x,y of an extra background pixel (e.g. inside a see-through gap); repeatable')
    common(p)
    p = sub.add_parser('difference', help='difference matting from two aligned renders on two backgrounds')
    p.add_argument('input', help='render on background A')
    p.add_argument('input2', help='the same render on background B')
    p.add_argument('--bg-a', help='background A colour (default: border median)')
    p.add_argument('--bg-b', help='background B colour (default: border median)')
    common(p)
    p = sub.add_parser('refine', help='guided-filter edge refinement and halo removal of an existing RGBA')
    p.add_argument('input', help='RGBA image with a real alpha channel')
    p.add_argument('--bg', help="the background the edge colours are contaminated with (default: estimated from the edge)")
    p.add_argument('--radius', type=int, help='guided filter radius in px (default 3 per 1254 px)')
    p.add_argument('--eps', type=float, default=1e-3, help='guided filter regularisation (default 1e-3)')
    p.add_argument('--despill', type=float, default=1.0, help='0..1 (default 1)')
    p.add_argument('--min-island', type=int, help='drop separate specks smaller than this many px')
    p.add_argument('--fill-holes', choices=['auto', 'all', 'none'], default='auto')
    p.add_argument('--max-hole', type=float, default=0.0)
    common(p)
    p = sub.add_parser('verify', help='halo metrics of an RGBA image')
    p.add_argument('input')
    common(p, needs_out=False)
    for sp in sub.choices.values():
        if sp.prog.endswith(('key', 'flood', 'difference', 'refine')):
            sp.add_argument('--verify', action='store_true', help='(the metrics of the output are always printed and reported)')
    return ap


def main(argv=None):
    argv = list(sys.argv[1:] if argv is None else argv)
    if argv and argv[0] == '--verify':
        argv[0] = 'verify'
    args = build_parser().parse_args(argv)
    if args.mode == 'key':
        return run_key(args)
    if args.mode == 'flood':
        return run_key(args, flood=True)
    if args.mode == 'difference':
        return run_difference(args)
    if args.mode == 'refine':
        return run_refine(args)
    return run_verify(args)


if __name__ == '__main__':
    tk.run_main(main)
