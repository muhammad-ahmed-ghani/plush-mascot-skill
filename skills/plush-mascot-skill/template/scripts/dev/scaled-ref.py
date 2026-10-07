"""Rescale the neutral artwork to given on-screen densities, aligned to the audit/tuner camera.

    python3 scripts/dev/scaled-ref.py --ppus 350,246,123 --size 1000 --out scripts/dev/.refs

Each ref_<ppu>.png is a size x size RGBA canvas in which the artwork (assets/mascot-transparent.png) is Lanczos-rescaled so that
one character unit = <ppu> pixels, positioned exactly where a near-orthographic front render (camera target y = 1.65)
places the live model.  audit.py and tune2.mjs compare against these.
"""
import argparse, os, warnings
warnings.filterwarnings('ignore')
from PIL import Image

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..')) + '/'
ap = argparse.ArgumentParser()
ap.add_argument('--ppus', default='350,246,123'); ap.add_argument('--size', type=int, default=0)
ap.add_argument('--ty', type=float, default=1.65); ap.add_argument('--out', default=ROOT + 'scripts/dev/.refs')
a = ap.parse_args()
os.makedirs(a.out, exist_ok=True)
src = Image.open(ROOT + 'assets/mascot-transparent.png').convert('RGBA')
for p in [float(x) for x in a.ppus.split(',')]:
    s = p / 350.0
    r = src.resize((round(src.width * s), round(src.height * s)), Image.LANCZOS)
    size = a.size or max(600, int(round(p * 4.2 / 2) * 2))          # must match sizeFor() in src/lab-metrics.js
    canvas = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    canvas.paste(r, (round(size / 2 - 627.5 * s), round(size / 2 + a.ty * p - 1204 * s)))
    name = f'{a.out}/ref_{int(p)}.png'
    canvas.save(name)
    print('wrote', name)
