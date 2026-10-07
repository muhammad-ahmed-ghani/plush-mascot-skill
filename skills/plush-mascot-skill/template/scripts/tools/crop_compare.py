#!/usr/bin/env python3
"""Side-by-side crops of the same window of two images (art vs render), magnified with nearest-neighbour, plus numbers: the fidelity-audit tool.

  crop_compare.py art.png live.png --box x,y,w,h --zoom 6 --out cmp.png [--diff]
  crop_compare.py art.png live.png --box-units x0,x1,y0,y1 --out cmp.png          (character units: feet at y 0, axis at x 0; frame from mascot.config.json)
Both images must share the geometry (same size, same registration), e.g. assets/mascot-transparent.png and scripts/dev/audit.mjs output at the same ppu
(use --art-ppu / --live-ppu when they differ: the units box is mapped through each image's own ppu, with the axis column and feet row of the frame scaled)."""
import argparse, json, os, sys
import numpy as np, cv2
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _toolkit import find_config, frame_from

def load(p):
    im = cv2.imread(p, cv2.IMREAD_UNCHANGED)
    if im is None: sys.exit(f'cannot read {p}')
    if im.ndim == 3 and im.shape[2] == 4:
        al = im[..., 3:4] / 255.0; im = (im[..., :3] * al + 255 * (1 - al)).astype(np.uint8)
    return im

def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('art'); ap.add_argument('live'); ap.add_argument('--box'); ap.add_argument('--box-units'); ap.add_argument('--zoom', type=int, default=6)
    ap.add_argument('--diff', action='store_true'); ap.add_argument('--out', required=True); ap.add_argument('--config'); ap.add_argument('--art-ppu', type=float); ap.add_argument('--live-ppu', type=float)
    a = ap.parse_args(); fr = frame_from(find_config(a.config)[0])
    A, B = load(a.art), load(a.live)
    def box_for(img, ppu):
        if a.box: x, y, w, h = map(float, a.box.split(',')); return int(x), int(y), int(w), int(h)
        x0, x1, y0, y1 = map(float, a.box_units.split(',')); ppu = ppu or fr['ppu']; k = img.shape[0] / fr['size'] if not ppu else ppu / fr['ppu']
        ax = (fr['axisX'] + .5) * (img.shape[1] / fr['size'] if not a.live_ppu and not a.art_ppu else k) - .5; fy = (fr['feetY'] + .5) * (img.shape[0] / fr['size'] if not a.live_ppu and not a.art_ppu else k) - .5
        return int(round(ax + x0 * ppu)), int(round(fy - y1 * ppu)), int(round((x1 - x0) * ppu)), int(round((y1 - y0) * ppu))
    bx = box_for(A, a.art_ppu); by = box_for(B, a.live_ppu)
    ca = A[bx[1]:bx[1] + bx[3], bx[0]:bx[0] + bx[2]]; cb = B[by[1]:by[1] + by[3], by[0]:by[0] + by[2]]
    h, w = min(ca.shape[0], cb.shape[0]), min(ca.shape[1], cb.shape[1]); ca, cb = ca[:h, :w], cb[:h, :w]
    d = np.abs(ca.astype(np.float32) - cb.astype(np.float32)); la = cv2.cvtColor(ca, cv2.COLOR_BGR2GRAY).astype(np.float32); lb = cv2.cvtColor(cb, cv2.COLOR_BGR2GRAY).astype(np.float32)
    mu = lambda x: cv2.GaussianBlur(x, (0, 0), 1.5); ma, mb = mu(la), mu(lb); sa, sb, sab = mu(la * la) - ma * ma, mu(lb * lb) - mb * mb, mu(la * lb) - ma * mb
    ssim = float(np.mean(((2 * ma * mb + 6.5) * (2 * sab + 58.5)) / ((ma * ma + mb * mb + 6.5) * (sa + sb + 58.5))))
    stats = {'mae_per_channel_bgr': [round(float(x), 2) for x in d.mean((0, 1))], 'mean_luminance_art': round(float(la.mean()), 1), 'mean_luminance_live': round(float(lb.mean()), 1), 'ssim_lum': round(ssim, 4), 'window_px': [w, h]}
    z = lambda x: cv2.resize(x, None, fx=a.zoom, fy=a.zoom, interpolation=cv2.INTER_NEAREST)
    panels = [z(ca), z(cb)] + ([z(np.clip(d * 3, 0, 255).astype(np.uint8))] if a.diff else [])
    gap = np.full((panels[0].shape[0], 6, 3), 255, np.uint8); row = panels[0]
    for p in panels[1:]: row = np.hstack([row, gap, p])
    cv2.imwrite(a.out, row); json.dump(stats, open(os.path.splitext(a.out)[0] + '.json', 'w'), indent=1); print(a.out, json.dumps(stats))

if __name__ == '__main__':
    main()
