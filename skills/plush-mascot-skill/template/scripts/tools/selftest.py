#!/usr/bin/env python3
"""Self-test of the tools: sizes, dry-run, generate/edit against the local stub, art QA on the example art and damaged copies, registration.
   python3 scripts/tools/selftest.py        (exit 1 on any failure; needs assets/mascot-transparent.png for the art tests)"""
import io, json, os, subprocess, sys, tempfile, contextlib
import numpy as np, cv2
from PIL import Image
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
import imagegen, mock_imagegen_server as mock
ROOT = os.path.abspath(os.path.join(HERE, '..', '..')); fails = 0
def check(name, ok, detail=''):
    global fails; fails += (not ok); print(('PASS ' if ok else 'FAIL ') + name + (f'  ({detail})' if detail else ''))
def run(argv, **env):
    old = {k: os.environ.get(k) for k in env}; os.environ.update({k: v for k, v in env.items() if v is not None})
    out, err = io.StringIO(), io.StringIO()
    with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err): rc = imagegen.main(argv)
    for k, v in old.items(): os.environ.pop(k, None) if v is None else os.environ.__setitem__(k, v)
    return rc, out.getvalue(), err.getvalue()
tmp = tempfile.mkdtemp(); open(f'{tmp}/p.txt', 'w').write('a mascot')
# sizes
sz = {(a, t): imagegen.best_size(*a, t) for a in ((1, 1), (3, 2), (5, 2), (3, 1)) for t in ('safe', 'max')}
check('sizes', sz[((1, 1), 'safe')] == (1920, 1920) and sz[((1, 1), 'max')] == (2880, 2880) and sz[((3, 2), 'max')] == (3504, 2336) and sz[((5, 2), 'safe')] == (2560, 1024) and sz[((3, 1), 'max')] == (3840, 1280), str(sz[((3, 2), 'safe')]))
check('size validation', imagegen.size_errors(2880, 2880) == [] and imagegen.size_errors(2881, 2880) != [] and imagegen.size_errors(4000, 1000) != [])
# dry run redacts the key and never calls the network
rc, out, _ = run(['generate', '--provider', 'openai', '--size', '1024x1024', '--prompt-file', f'{tmp}/p.txt', '--out', f'{tmp}/d', '--dry-run'], OPENAI_API_KEY='sk-secret')
check('dry-run prints the request and hides the key', rc == 0 and 'sk-secret' not in out and 'redacted' in out)
rc, _, err = run(['generate', '--provider', 'openai', '--size', '1024x1024', '--prompt-file', f'{tmp}/p.txt', '--out', f'{tmp}/n'], OPENAI_API_KEY='sk-secret')
check('refuses to spend without --yes', rc == 1 and '--yes' in err)
srv = mock.start(); base = f'http://127.0.0.1:{srv.server_address[1]}'
env = dict(OPENAI_BASE_URL=base, GEMINI_BASE_URL=base, OPENAI_API_KEY='k', GEMINI_API_KEY='k')
rc, out, _ = run(['generate', '--provider', 'openai', '--size', '1024x1024', '--prompt-file', f'{tmp}/p.txt', '--out', f'{tmp}/o1', '--yes'], **env)
check('openai generate saves image + metadata', rc == 0 and os.path.exists(f'{tmp}/o1.png') and os.path.exists(f'{tmp}/o1.png.json') and 'requested 1024x1024, got 64x64' in out, out.strip()[:90])
Image.new('RGB', (32, 32), (9, 9, 9)).save(f'{tmp}/r1.png'); Image.new('RGB', (32, 32), (90, 9, 9)).save(f'{tmp}/r2.png')
rc, out, _ = run(['edit', '--provider', 'openai', '--size', '1024x1024', '--prompt-file', f'{tmp}/p.txt', '--ref', f'{tmp}/r1.png', '--ref', f'{tmp}/r2.png', '--ref-role', 'image 1: identity master', '--out', f'{tmp}/o2', '--yes'], **env)
check('openai edit sends two image[] parts', rc == 0 and mock.H.seen['last']['image_parts'] == 2 and 'multipart' in mock.H.seen['last']['ctype'])
for api in ('interactions', 'generate-content'):
    rc, out, _ = run(['generate', '--provider', 'gemini', '--api', api, '--aspect', '1:1', '--image-size', '4K', '--prompt-file', f'{tmp}/p.txt', '--out', f'{tmp}/g_{api}', '--yes'], **env)
    check(f'gemini {api} (thought parts skipped)', rc == 0 and len([f for f in os.listdir(tmp) if f.startswith(f'g_{api}') and f.endswith('.png')]) == 1)
os.environ['MOCK_MODE'] = '400-transparent'
rc, _, err = run(['generate', '--provider', 'openai', '--size', '1024x1024', '--background', 'transparent', '--prompt-file', f'{tmp}/p.txt', '--out', f'{tmp}/t', '--yes'], **env)
check('transparent rejection gives the key-colour hint', rc == 1 and 'alpha_extract' in err)
os.environ['MOCK_MODE'] = ''
rc, _, err = run(['generate', '--provider', 'openai', '--size', '1024x1024', '--prompt-file', f'{tmp}/p.txt', '--out', f'{tmp}/o1', '--yes'], **env)
check('refuses to overwrite without --force', rc == 1 and 'exists' in err)
# art
art = os.path.join(ROOT, 'assets', 'mascot-transparent.png')
if os.path.exists(art):
    im = np.array(Image.open(art).convert('RGBA')); H, W = im.shape[:2]; d = tempfile.mkdtemp()
    def save(a, n): Image.fromarray(a).save(f'{d}/{n}.png')
    save(im, 'good')
    al = im[..., 3] / 255; ring = cv2.dilate((al > .5).astype(np.uint8), cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (9, 9))); soft = cv2.GaussianBlur(ring.astype(np.float32), (0, 0), 1.6) * .85
    h = im.astype(np.float32); na = np.maximum(al, soft); g = (na > al + .02)[..., None]; h[..., :3] = np.where(g, np.array([250, 247, 243], np.float32), h[..., :3]); h[..., 3] = na * 255; save(np.clip(h, 0, 255).astype(np.uint8), 'halo')
    sh = np.zeros_like(im); sh[70:] = im[:-70]; save(sh, 'cropped')
    bl = im.copy(); bl[..., :3] = cv2.GaussianBlur(im[..., :3], (0, 0), 3); save(bl, 'blurred')
    yy, xx = np.mgrid[0:H, 0:W]; bg = (255 - (((yy // 16) + (xx // 16)) % 2) * 51)[..., None] * np.ones((1, 1, 3)); a3 = al[..., None]
    save(np.dstack([np.clip(im[..., :3] * a3 + bg * (1 - a3), 0, 255).astype(np.uint8), np.full((H, W), 255, np.uint8)]), 'checker')
    def qa(n, kind='transparent'):
        r = subprocess.run([sys.executable, f'{HERE}/art_qa.py', f'{d}/{n}.png', '--kind', kind, '--report', f'{d}/{n}.json'], capture_output=True, text=True)
        return r.returncode, [c['check'] for c in json.load(open(f'{d}/{n}.json'))[0]['checks'] if c['status'] == 'fail']
    rc, f = qa('good'); check('art_qa passes the example front', rc == 0, str(f))
    for n, want in (('halo', 'edge_halo'), ('cropped', 'margins'), ('blurred', 'fibre_detail'), ('checker', 'baked_checkerboard')):
        rc, f = qa(n); check(f'art_qa catches {n}', rc == 1 and want in f, str(f))
    for n in ('hero', 'turnaround', 'use-cases'):
        p = os.path.join(ROOT, 'assets', f'mascot-{n}.png')
        if os.path.exists(p):
            r = subprocess.run([sys.executable, f'{HERE}/art_qa.py', p, '--kind', n], capture_output=True, text=True); check(f'art_qa passes the example {n}', r.returncode == 0)
    can = Image.new('RGBA', (3000, 2400), (0, 0, 0, 0)); sm = Image.fromarray(im).resize((878, 878), Image.LANCZOS); can.paste(sm, (1400, 1100), sm); can.save(f'{d}/padded.png')
    r = subprocess.run([sys.executable, f'{HERE}/normalize_art.py', '--in', f'{d}/padded.png', '--out', f'{d}/norm.png', '--config', f'{ROOT}/mascot.config.json'], capture_output=True, text=True)
    a = im[..., 3] > 128; b = np.array(Image.open(f'{d}/norm.png').convert('RGBA'))[..., 3] > 128
    check('normalize_art registers a padded, shrunk, shifted copy onto the frame', r.returncode == 0 and (a & b).sum() / (a | b).sum() > .99, f'IoU {(a & b).sum() / (a | b).sum():.4f}')
else:
    print('skip art tests: assets/mascot-transparent.png not found')
print('\nALL PASS' if not fails else f'\n{fails} FAILED'); sys.exit(1 if fails else 0)
