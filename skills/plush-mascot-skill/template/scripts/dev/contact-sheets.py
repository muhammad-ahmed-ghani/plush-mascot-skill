#!/usr/bin/env python3
"""The two overview images in tests/: states-contact-sheet.jpg (the ten state stills, tests/state-*.png) and reel-contact-sheet.jpg
(evenly spaced frames of assets/mascot-motion-reel.mp4, pulled out with ffmpeg).  Run after scripts/dev/evidence.mjs and scripts/dev/reel.mjs.
    python3 scripts/dev/contact-sheets.py
"""
import glob, os, subprocess, tempfile
from PIL import Image

ORDER = ['idle', 'greeting', 'listening', 'thinking', 'working', 'approval', 'success', 'error', 'speaking', 'resting']


def grid(images, cols, cell, gap=8, bg=(244, 237, 224)):
    rows = (len(images) + cols - 1) // cols
    sheet = Image.new('RGB', (cols * cell[0] + (cols + 1) * gap, rows * cell[1] + (rows + 1) * gap), bg)
    for i, im in enumerate(images):
        im = im.convert('RGB')
        im.thumbnail(cell, Image.LANCZOS)
        x = gap + (i % cols) * (cell[0] + gap) + (cell[0] - im.width) // 2
        y = gap + (i // cols) * (cell[1] + gap) + (cell[1] - im.height) // 2
        sheet.paste(im, (x, y))
    return sheet


def states():
    files = [f'tests/state-{s}.png' for s in ORDER if os.path.exists(f'tests/state-{s}.png')]
    if not files:
        print('no tests/state-*.png: run node scripts/dev/evidence.mjs first')
        return
    grid([Image.open(f) for f in files], cols=5, cell=(520, 420)).save('tests/states-contact-sheet.jpg', quality=88)
    print('wrote tests/states-contact-sheet.jpg')


def reel(n=24):
    video = 'assets/mascot-motion-reel.mp4'
    duration = float(subprocess.check_output(['ffprobe', '-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', video]))
    frames = []
    with tempfile.TemporaryDirectory() as tmp:
        for i in range(n):
            out = f'{tmp}/f{i:02d}.png'
            subprocess.run(['ffmpeg', '-v', 'error', '-y', '-ss', f'{(i + 0.5) * duration / n:.3f}', '-i', video, '-frames:v', '1', out], check=True)
            frames.append(Image.open(out).copy())
    grid(frames, cols=6, cell=(330, 330)).save('tests/reel-contact-sheet.jpg', quality=86)
    print('wrote tests/reel-contact-sheet.jpg')


if __name__ == '__main__':
    states()
    reel()
