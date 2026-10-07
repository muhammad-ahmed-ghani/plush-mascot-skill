#!/usr/bin/env python3
"""Register art on the canonical frame of mascot.config.json (default 1254 px square, 350 px per unit, axis column 627.5, feet row 1204, head top row 47).

  normalize_art.py --in master.png --out assets/mascot-transparent.png [--hires-out art/work/front@2x.png] [--write-config] [--config mascot.config.json]
  normalize_art.py --turnaround --in sheet.png --out art/work/turnaround     (splits 3-4 figures left to right, registers each, writes measurements.json)

The input must be straight-alpha RGBA (cut a flat-background image out with alpha_extract.py first). The figure's height (sub-pixel 0.5-alpha
crossings) is scaled to the frame's figure height with INTER_AREA when shrinking, its mirror axis (sub-pixel) moved to axisX and its soles to feetY.
A figure too wide for the frame is scaled down further and frame.topY is raised (--write-config stores it). Masters are never modified."""
import argparse, json, os, sys
import numpy as np, cv2
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _toolkit import read_image, write_png, find_config, frame_from, premultiply, unpremultiply, figure_measurements, fail

def register(rgba, fr, k=1, margin_frac=0.9):
    a = rgba[..., 3]; m = figure_measurements(a)
    size, axisX, feetY, topY = fr['size'], fr['axisX'], fr['feetY'], fr['topY']
    s = ((feetY - topY) + 1) / m['height_px']
    note = ''
    if m['width_px'] * s > margin_frac * size:
        s *= margin_frac * size / (m['width_px'] * s); topY = feetY - (m['height_px'] * s - 1); note = 'figure too wide for the frame: scaled down, topY raised'
    pm = premultiply(rgba)
    if abs(s - 1) > 1e-4:
        pm = cv2.resize(pm, None, fx=s * k, fy=s * k, interpolation=cv2.INTER_AREA if s * k < 1 else cv2.INTER_CUBIC)
    elif k != 1:
        pm = cv2.resize(pm, None, fx=k, fy=k, interpolation=cv2.INTER_CUBIC)
    sk = s * k
    axis2 = (m['axis'] + 0.5) * sk - 0.5; feet2 = m['feetY'] * sk + (sk - 1) * 0.5 if False else (m['bottom_cross'] * sk - 0.5)
    tx = (axisX + 0.5) * k - 0.5 - axis2; ty = (feetY + 0.5) * k - 0.5 - feet2
    S = size * k
    if abs(tx) < 0.02 and abs(ty) < 0.02 and pm.shape[0] == S and pm.shape[1] == S: out = pm
    else: out = cv2.warpAffine(pm, np.float32([[1, 0, tx], [0, 1, ty]]), (S, S), flags=cv2.INTER_CUBIC, borderMode=cv2.BORDER_CONSTANT, borderValue=0)
    out = np.clip(out, 0, 1)
    return unpremultiply(out), {'scale': round(float(s), 5), 'shift_px': [round(float(tx), 3), round(float(ty), 3)], 'measured': {k2: (round(v, 3) if isinstance(v, float) else v) for k2, v in m.items()}, 'topY': round(float(topY), 2), 'note': note}

def turnaround(path, outdir, fr):
    rgba, _ = read_image(path); rgb = rgba[..., :3]; h, w = rgb.shape[:2]
    ring = np.concatenate([rgb[:8].reshape(-1, 3), rgb[-8:].reshape(-1, 3), rgb[:, :8].reshape(-1, 3), rgb[:, -8:].reshape(-1, 3)])
    bg = np.median(ring, 0); d = np.linalg.norm(rgb - bg, axis=2) * 255
    m = cv2.morphologyEx((d > 28).astype(np.uint8), cv2.MORPH_CLOSE, np.ones((5, 5), np.uint8))
    n, lab, st, _ = cv2.connectedComponentsWithStats(m, connectivity=8)
    areas = st[1:, 4]; keep = [i + 1 for i in np.argsort(-areas)[:4] if areas[i] > 0.01 * h * w]
    keep.sort(key=lambda i: st[i][0])
    if len(keep) < 3: fail(f'found {len(keep)} figures, expected 3 or 4; regenerate with clear spacing', 1)
    names = ['front', 'side', 'back'] if len(keep) == 3 else [f'view{i + 1}' for i in range(len(keep))]
    os.makedirs(outdir, exist_ok=True); rep = []
    for nm, i in zip(names, keep):
        x, y, bw, bh, _a = st[i]; pad = 24
        x0, y0, x1, y1 = max(0, x - pad), max(0, y - pad), min(w, x + bw + pad), min(h, y + bh + pad)
        crop = rgba[y0:y1, x0:x1].copy(); dd = d[y0:y1, x0:x1]
        al = np.clip((dd - 14) / 26, 0, 1); al = np.where(lab[y0:y1, x0:x1] == i, al, np.minimum(al, 0)) if False else al
        crop[..., 3] = al
        reg, info = register(np.dstack([crop[..., :3], crop[..., 3]]), fr)
        write_png(os.path.join(outdir, f'{nm}.png'), reg)
        info.update({'view': nm, 'box': [int(x), int(y), int(bw), int(bh)]}); rep.append(info)
    hs = [r['measured']['height_px'] for r in rep]
    out = {'views': rep, 'height_ratio_max_min': round(max(hs) / min(hs), 3), 'warning': 'views differ in height by more than 6 percent' if max(hs) / min(hs) > 1.06 else ''}
    json.dump(out, open(os.path.join(outdir, 'measurements.json'), 'w'), indent=1)
    return out

def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--in', dest='inp', required=True); ap.add_argument('--out', required=True); ap.add_argument('--hires-out'); ap.add_argument('--config')
    ap.add_argument('--write-config', action='store_true'); ap.add_argument('--turnaround', action='store_true'); ap.add_argument('--force', action='store_true')
    a = ap.parse_args()
    cfg, cpath = find_config(a.config); fr = frame_from(cfg)
    if a.turnaround:
        print(json.dumps(turnaround(a.inp, a.out, fr), indent=1)); return
    rgba, info = read_image(a.inp)
    if info.get('has_alpha') is False or (rgba[..., 3] > 0.99).all(): fail('the input has no real alpha; cut it out first (alpha_extract.py key|flood|refine)', 1)
    out, rep = register(rgba, fr); write_png(a.out, out)
    if a.hires_out: write_png(a.hires_out, register(rgba, fr, 2)[0])
    print(json.dumps(rep, indent=1))
    if a.write_config:
        if not cpath: fail('no mascot.config.json found for --write-config', 2)
        c = json.load(open(cpath)); c.setdefault('frame', {})['topY'] = round(rep['topY']); json.dump(c, open(cpath, 'w'), indent=2); print('wrote frame.topY =', round(rep['topY']), 'to', cpath)

if __name__ == '__main__':
    main()
