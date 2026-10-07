#!/usr/bin/env python3
"""Automatic QA of mascot art before it enters the pipeline.

  art_qa.py <file-or-dir> [--kind auto|transparent|hero|turnaround|use-cases|macro] [--palette mascot.config.json] [--report out.json] [--strict]

Every check reports status (pass/warn/fail), value, threshold, message and a suggested fix. Exit 1 on any fail (any warn with --strict).
Thresholds are calibrated on the example art (must pass) and on damaged copies: halo, cropped feet, blur, JPEG, baked checkerboard (see
selftest.py). Kinds are guessed from the file name when --kind auto (front/transparent, hero, turnaround, use-case, macro)."""
import argparse, json, os, sys
import numpy as np, cv2
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _toolkit import read_image, find_config, frame_from, palette_from, srgb_to_lab, delta_e76, hex_to_rgb, rgb_to_hex, main_figure_mask, mirror_axis, vertical_extent, horizontal_extent, components, table

def chk(name, status, value, threshold, message, fix=''):
    return {'check': name, 'status': status, 'value': value, 'threshold': threshold, 'message': message, 'fix': fix}

def lum(rgb): return 0.2126 * rgb[..., 0] + 0.7152 * rgb[..., 1] + 0.0722 * rgb[..., 2]

def guess_kind(path):
    n = os.path.basename(path).lower()
    for k, keys in (('turnaround', ('turnaround', 'sheet')), ('use-cases', ('use-case', 'usecase', 'vignette')), ('macro', ('macro', 'swatch')), ('transparent', ('front', 'transparent', 'profile', 'cutout', 'good', 'halo', 'blurred', 'cropped', 'checker')), ('hero', ('hero',))):
        if any(x in n for x in keys): return k
    return 'hero'

def common(rgba, info, pal):
    out, (h, w) = [], rgba.shape[:2]
    long = max(h, w)
    out.append(chk('format', 'pass' if info.get('bits', 8) == 8 and info.get('format') in ('png', 'webp', 'jpeg', 'jpg') else 'warn', f"{info.get('format')} {info.get('bits')}-bit {w}x{h}", '8-bit png/webp', 'format and bit depth', 're-export as 8-bit PNG'))
    out.append(chk('resolution', 'pass' if long >= 1200 else 'warn' if long >= 900 else 'fail', long, '>=1200 (canonical frame is 1254; masters of 2400+ are better)', f'long edge {long}px', 'regenerate at the max tier (references/image-generation.md); never upscale'))
    g = (lum(rgba[..., :3]) * 255).astype(np.float32)
    blk = np.abs(np.diff(g, axis=1))[:, 7:-8:8].mean() / max(1e-6, np.abs(np.diff(g, axis=1)).mean())   # 8x8 block seams vs. the average gradient
    out.append(chk('jpeg_blockiness', 'pass' if blk < 1.2 else 'fail', round(float(blk), 2), '<1.2', 'ratio of 8-px block-edge gradient to mean gradient (1.0 = none)', 'regenerate as PNG; never extract nap from a JPEG'))
    if pal:
        a = rgba[..., 3] > 0.98
        px = (rgba[..., :3][a][::max(1, a.sum() // 40000)] * 255).astype(np.float32)
        if len(px) > 100:
            lab = srgb_to_lab(px / 255).astype(np.float32); _, _, cen = cv2.kmeans(lab, 5, None, (cv2.TERM_CRITERIA_EPS | cv2.TERM_CRITERIA_MAX_ITER, 20, 1.0), 2, cv2.KMEANS_PP_CENTERS)
            rows = []
            for name, hx in pal.items():
                d = min(float(delta_e76(srgb_to_lab(np.array(hex_to_rgb(hx), np.float32) / 255 if max(hex_to_rgb(hx)) > 1 else np.array(hex_to_rgb(hx), np.float32)), c)) for c in cen)
                rows.append(f'{name} dE {d:.0f}')
            out.append(chk('palette', 'pass', ', '.join(rows[:6]), 'informational', 'nearest image colour to each palette token (lit fabric differs from the token; compare across the set)', ''))
    return out

def fibre_energy(rgba):
    a = rgba[..., 3]; m = main_figure_mask(a, 0.98)
    if m.sum() < 2000: return None
    ys, xs = np.nonzero(m); hgt = ys.max() - ys.min() + 1; s = hgt / 1158.0
    L = (lum(rgba[..., :3]) * 255).astype(np.float32)
    inner = cv2.erode(m.astype(np.uint8), np.ones((max(3, int(31 * s)),) * 2, np.uint8)) > 0
    hp = L - cv2.GaussianBlur(L, (0, 0), 1.2 * s)
    lo = L - cv2.GaussianBlur(L, (0, 0), 5 * s)
    flat = inner & (cv2.GaussianBlur(np.abs(lo), (0, 0), 6 * s) < np.percentile(cv2.GaussianBlur(np.abs(lo), (0, 0), 6 * s)[inner], 60))
    return float(hp[flat].std()) if flat.sum() > 1000 else None

def check_transparent(rgba, info, cfg):
    out = []; a = rgba[..., 3]; h, w = a.shape
    solid = a > 0.98
    clear = (a < 0.02).mean()
    real = clear > 0.05 and (a < 0.99).mean() > 0.05
    out.append(chk('real_alpha', 'pass' if real else 'fail', f'{100 * clear:.0f}% clear', '>5% fully transparent', 'a real alpha channel with a cut-out background' if real else 'no real alpha: the background is painted into the pixels', 'ask for background=transparent, or a flat key colour and run alpha_extract.py key'))
    # baked fake checkerboard: two-level periodic background in the corner of an image without real alpha
    L = lum(rgba[..., :3]) * 255; c = L[:min(160, h), :min(160, w)]
    hi, lo2 = c > 230, c < 225
    trans = (np.abs(np.diff((c > 227).astype(np.int8), axis=1)) > 0).sum(1).mean()
    checker = (not real) and 0.2 < hi.mean() < 0.8 and lo2.mean() > 0.2 and trans >= 3 and np.std(c[hi]) < 6 and np.std(c[lo2 & (c > 150)]) < 10
    out.append(chk('baked_checkerboard', 'fail' if checker else 'pass', bool(checker), 'none', 'a transparency checkerboard drawn into the pixels' if checker else 'no baked checkerboard', 'request real alpha or a flat key colour'))
    if not real: return out
    m = main_figure_mask(a, 0.5)
    ys, xs = np.nonzero(m)
    if len(ys) == 0: return out + [chk('figure', 'fail', 0, '', 'no figure found', 'regenerate')]
    top, bot = vertical_extent(a); left, right = horizontal_extent(a)
    mt, mb, ml, mr = top / h, (h - bot) / h, left / w, (w - right) / w
    mm = min(mt, mb, ml, mr)
    out.append(chk('margins', 'pass' if mm >= 0.035 else 'warn' if mm >= 0.02 else 'fail', f'top {100 * mt:.1f}% bottom {100 * mb:.1f}% left {100 * ml:.1f}% right {100 * mr:.1f}%', '>=3.5% each side (canonical frame: 3.7%)', 'empty margin around the figure (feet and tips must be inside the frame)', 'regenerate: "about 8 percent empty margin on every side"'))
    # halo: colour of semi-transparent edge pixels versus the nearest opaque interior colour
    edge = (a > 0.05) & (a < 0.95)
    inner = (a > 0.98).astype(np.float32)
    rgb = rgba[..., :3]
    num = cv2.GaussianBlur(rgb * inner[..., None], (0, 0), 4); den = cv2.GaussianBlur(inner, (0, 0), 4)[..., None]
    near = num / np.maximum(den, 1e-4)
    ok = edge & (den[..., 0] > 0.02)
    dl = float(np.abs(lum(rgb)[ok] - lum(near)[ok]).mean() * 255) if ok.sum() > 100 else 0.0
    out.append(chk('edge_halo', 'pass' if dl < 30 else 'warn' if dl < 45 else 'fail', round(dl, 1), '<30 mean luminance difference (example 22; a white halo 97)', 'edge pixels are pulled toward the old background' if dl >= 30 else 'edge colour matches the interior', 'alpha_extract.py key (unmix, despill) or refine; regenerate on a flat key colour'))
    n, lab, st, _ = components(a > 0.5)
    big = st[1:, 4].max() if n > 1 else 0
    small = int((st[1:, 4] < 0.02 * big).sum()) if n > 1 else 0
    out.append(chk('islands', 'pass' if small <= 3 else 'warn', small, '<=3 stray components', 'stray fragments away from the figure', 'alpha_extract.py refine, or clean a copy'))
    floor = ((a > 0.04) & (a < 0.9))[int(bot) + 1:, :].sum()
    out.append(chk('floor_shadow', 'pass' if floor < 0.0004 * h * w else 'warn', int(floor), '<0.04% of the frame below the feet', 'a semi-transparent shadow below the soles', 'regenerate with "no cast or contact shadow"'))
    ax, iou = mirror_axis(a)
    out.append(chk('symmetry', 'pass' if iou >= 0.95 else 'warn' if iou >= 0.9 else 'fail', round(iou, 3), '>=0.95 mirror IoU', f'axis at column {ax:.1f} of {w}', 'regenerate the registered front in a strict symmetric pose'))
    fe = fibre_energy(rgba)
    if fe is not None:
        out.append(chk('fibre_detail', 'pass' if fe >= 5 else 'warn' if fe >= 3.5 else 'fail', round(fe, 1), '>=5 (example art 6.7; blurred or plastic < 1)', 'fibre-band luminance std on flat fabric, scaled to the canonical density', 'regenerate with the fabric partial at quality high; never upscale or smooth'))
    return out

def check_turnaround(rgba, info, cfg):
    h, w = rgba.shape[:2]
    rgb = rgba[..., :3]
    ring = np.concatenate([rgb[:8].reshape(-1, 3), rgb[-8:].reshape(-1, 3), rgb[:, :8].reshape(-1, 3), rgb[:, -8:].reshape(-1, 3)])
    bg = np.median(ring, 0)
    d = np.linalg.norm(rgb - bg, axis=2) * 255
    m = cv2.morphologyEx((d > 28).astype(np.uint8), cv2.MORPH_CLOSE, np.ones((5, 5), np.uint8))
    n, lab, st, _ = cv2.connectedComponentsWithStats(m, connectivity=8)
    areas = st[1:, 4]; keep = [i + 1 for i in np.argsort(-areas)[:5] if areas[i] > 0.01 * h * w]
    figs = sorted([st[i] for i in keep], key=lambda s: s[0])
    out = [chk('figure_count', 'pass' if len(figs) in (3, 4) else 'fail', len(figs), '3 or 4 separate figures left to right', 'figures found by difference from the background', 'regenerate with spacing, or render the views separately')]
    if len(figs) >= 3:
        hs = [int(s[3]) for s in figs]
        out.append(chk('height_consistency', 'pass' if max(hs) / min(hs) < 1.06 else 'warn', round(max(hs) / min(hs), 3), '<1.06', f'figure heights {hs}', 'regenerate; views must share one scale'))
        cropped = any(s[0] <= 1 or s[1] <= 1 or s[0] + s[2] >= w - 1 or s[1] + s[3] >= h - 1 for s in figs)
        out.append(chk('cropped', 'fail' if cropped else 'pass', bool(cropped), 'no figure touches the border', 'a figure touches the image border' if cropped else 'all figures inside', 'regenerate with margins'))
        gaps = [figs[i + 1][0] - (figs[i][0] + figs[i][2]) for i in range(len(figs) - 1)]
        out.append(chk('separation', 'pass' if min(gaps) > 0.01 * w else 'fail', gaps, 'clear gaps between views', 'gap in px between neighbouring figures', 'regenerate with clear spacing'))
    return out

def check_plain(rgba, info, cfg, kind):
    h, w = rgba.shape[:2]; rgb = rgba[..., :3]
    ring = np.concatenate([rgb[:12].reshape(-1, 3), rgb[-12:].reshape(-1, 3), rgb[:, :12].reshape(-1, 3), rgb[:, -12:].reshape(-1, 3)])
    sd = float(ring.std(0).mean() * 255)
    out = [chk('background_plain', 'pass' if sd < 14 else 'warn', round(sd, 1), '<14 std at the border (0-255)', 'border colour spread', 'regenerate on a flat field')]
    g = (lum(rgb) * 255).astype(np.float32)
    lap = float(cv2.Laplacian(g, cv2.CV_32F).var())
    out.append(chk('sharpness', 'pass' if lap >= 60 else 'warn' if lap >= 25 else 'fail', round(lap, 1), '>=60 Laplacian variance', 'overall sharpness', 'regenerate at quality high / larger size; never upscale'))
    if kind == 'use-cases':
        q = [(g[:h // 2, :w // 2], 'tl'), (g[:h // 2, w // 2:], 'tr'), (g[h // 2:, :w // 2], 'bl'), (g[h // 2:, w // 2:], 'br')]
        occ = [float((np.abs(x - np.median(x)) > 25).mean()) for x, _ in q]
        out.append(chk('quadrants', 'pass' if min(occ) > 0.02 else 'warn', [round(o, 3) for o in occ], 'each quadrant has content', 'content fraction per quadrant', 'regenerate with the 2x2 layout instruction'))
    return out

def qa_file(path, kind, cfg, pal):
    rgba, info = read_image(path)
    k = guess_kind(path) if kind == 'auto' else kind
    checks = common(rgba, info, pal)
    if k == 'transparent': checks += check_transparent(rgba, info, cfg)
    elif k == 'turnaround': checks += check_turnaround(rgba, info, cfg)
    else: checks += check_plain(rgba, info, cfg, k)
    worst = 'fail' if any(c['status'] == 'fail' for c in checks) else 'warn' if any(c['status'] == 'warn' for c in checks) else 'pass'
    return {'file': path, 'kind': k, 'status': worst, 'checks': checks}

def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('path'); ap.add_argument('--kind', default='auto', choices=['auto', 'transparent', 'hero', 'turnaround', 'use-cases', 'macro'])
    ap.add_argument('--palette'); ap.add_argument('--config'); ap.add_argument('--report'); ap.add_argument('--strict', action='store_true')
    a = ap.parse_args()
    cfg, _ = find_config(a.config); pal = palette_from(a.palette) if a.palette else {}
    files = [os.path.join(a.path, f) for f in sorted(os.listdir(a.path)) if f.lower().endswith(('.png', '.webp', '.jpg', '.jpeg'))] if os.path.isdir(a.path) else [a.path]
    reports = [qa_file(f, a.kind, cfg, pal) for f in files]
    bad = 0
    for r in reports:
        print(f"\n{r['file']}  [{r['kind']}]  {r['status'].upper()}")
        print(table([(c['status'].upper(), c['check'], c['value'], c['threshold']) for c in r['checks']], ['', 'check', 'value', 'threshold']))
        for c in r['checks']:
            if c['status'] != 'pass' and c['fix']: print(f"  - {c['check']}: {c['message']}. Fix: {c['fix']}")
        bad += r['status'] == 'fail' or (a.strict and r['status'] == 'warn')
    if a.report: json.dump(reports, open(a.report, 'w'), indent=1, default=str)
    sys.exit(1 if bad else 0)

if __name__ == '__main__':
    main()
