#!/usr/bin/env python3
"""Grid of images (or evenly spaced frames of a video via ffmpeg) with optional file-name labels.
  contact_sheet.py a.png b.png ... --out sheet.jpg [--cols 4] [--cell 400] [--labels]
  contact_sheet.py --video reel.mp4 --n 24 --out reel-sheet.jpg"""
import argparse, os, subprocess, tempfile
import numpy as np, cv2

def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('images', nargs='*'); ap.add_argument('--out', required=True); ap.add_argument('--cols', type=int, default=4); ap.add_argument('--cell', type=int, default=400)
    ap.add_argument('--labels', action='store_true'); ap.add_argument('--video'); ap.add_argument('--n', type=int, default=24); ap.add_argument('--bg', default='f4ede0')
    a = ap.parse_args(); tmp = tempfile.TemporaryDirectory(); files = list(a.images)
    if a.video:
        dur = float(subprocess.check_output(['ffprobe', '-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', a.video]))
        for i in range(a.n):
            f = f'{tmp.name}/f{i:03d}.png'; subprocess.run(['ffmpeg', '-v', 'error', '-y', '-ss', f'{(i + .5) * dur / a.n:.3f}', '-i', a.video, '-frames:v', '1', f], check=True); files.append(f)
    if not files: ap.error('no inputs')
    bg = tuple(int(a.bg[i:i + 2], 16) for i in (0, 2, 4))[::-1]; g = 8; c = a.cell; rows = -(-len(files) // a.cols)
    sheet = np.full((rows * (c + g) + g, a.cols * (c + g) + g, 3), bg, np.uint8)
    for i, f in enumerate(files):
        im = cv2.imread(f, cv2.IMREAD_UNCHANGED)
        if im is None: continue
        if im.ndim == 3 and im.shape[2] == 4:
            al = im[..., 3:4] / 255.0; im = (im[..., :3] * al + np.array(bg) * (1 - al)).astype(np.uint8)
        s = min(c / im.shape[1], c / im.shape[0]); im = cv2.resize(im, (max(1, int(im.shape[1] * s)), max(1, int(im.shape[0] * s))), interpolation=cv2.INTER_AREA)
        y = g + (i // a.cols) * (c + g) + (c - im.shape[0]) // 2; x = g + (i % a.cols) * (c + g) + (c - im.shape[1]) // 2
        sheet[y:y + im.shape[0], x:x + im.shape[1]] = im
        if a.labels: cv2.putText(sheet, os.path.basename(f)[:34], (x + 4, y + 16), cv2.FONT_HERSHEY_SIMPLEX, 0.5, (30, 30, 30), 1, cv2.LINE_AA)
    cv2.imwrite(a.out, sheet, [cv2.IMWRITE_JPEG_QUALITY, 90]); print('wrote', a.out, sheet.shape[1], 'x', sheet.shape[0])

if __name__ == '__main__':
    main()
