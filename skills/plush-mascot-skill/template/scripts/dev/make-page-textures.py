#!/usr/bin/env python3
"""Generate assets/felt.png: a small seamless overlay of felt nap (fine grain plus short curled fibres, light and dark) that the page lays
over its paper and cut-felt shapes.  Deterministic.

    python3 scripts/dev/make-page-textures.py        (from the project root; needs numpy and Pillow)
"""
import numpy as np
from PIL import Image, ImageDraw

N = 256
rng = np.random.default_rng(20261001)

def periodic_blur(a, sigma):
    f = np.fft.fftfreq(a.shape[0])[:, None] ** 2 + np.fft.fftfreq(a.shape[1])[None, :] ** 2
    return np.real(np.fft.ifft2(np.fft.fft2(a) * np.exp(-2 * (np.pi * sigma) ** 2 * f)))

# fine grain: band-limited noise
grain = periodic_blur(rng.standard_normal((N, N)), 0.8)
grain = (grain - grain.mean()) / grain.std()

# fibres: short curled strokes, drawn wrapped so the tile repeats
def fibres(count, sign, length, width):
    img = Image.new('L', (N, N), 0)
    d = ImageDraw.Draw(img)
    for _ in range(count):
        x, y = rng.uniform(0, N, 2)
        a = rng.uniform(0, 2 * np.pi)
        turn = rng.normal(0, 0.35)
        pts = []
        for _ in range(7):
            pts.append((x, y))
            a += turn + rng.normal(0, 0.12)
            x += np.cos(a) * length / 6
            y += np.sin(a) * length / 6
        v = int(rng.uniform(120, 255))
        for dx in (-N, 0, N):
            for dy in (-N, 0, N):
                d.line([(px + dx, py + dy) for px, py in pts], fill=v, width=width)
    return np.asarray(img, dtype=np.float32) / 255.0 * sign

light = fibres(1500, +1, 9, 1)
dark = fibres(1300, -1, 9, 1)
v = 0.16 * grain + 0.9 * light + 0.9 * dark          # signed: > 0 lifts the colour underneath, < 0 darkens it
v = periodic_blur(v, 0.45)
v = v / np.abs(v).max()
alpha = np.clip(np.abs(v) ** 0.9 * 0.85, 0, 1)
lum = np.where(v > 0, 255, 0).astype(np.uint8)
img = Image.fromarray(np.dstack([lum, lum, lum, (alpha * 255).astype(np.uint8)]), 'RGBA')
img = img.quantize(colors=64, method=Image.Quantize.FASTOCTREE, dither=Image.Dither.NONE).convert('RGBA') if False else img
img.save('assets/felt.png', optimize=True)
print('assets/felt.png', img.size)
