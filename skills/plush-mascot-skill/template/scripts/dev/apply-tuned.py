"""Write a scripts/dev/tune2.mjs result into the source defaults.

    python3 scripts/dev/apply-tuned.py tuned.json

Touches: STUDIO in src/mascot-studio.js; palette and material defaults in src/mascot-fabric.js; the charcoal copy in
src/mascot-face.js.  Palette multipliers (bk, fk) are applied in linear light and folded into the base colours, so the
tuner can always start from 1.0.
"""
import json, re, sys

ROOT = __file__.rsplit('scripts/dev/', 1)[0]
d = json.load(open(sys.argv[1]))['params']


def srgb2lin(c):
    c /= 255.0
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def lin2srgb(c):
    c = max(0, min(1, c))
    return 12.92 * c if c <= 0.0031308 else 1.055 * c ** (1 / 2.4) - 0.055


def scale_hex(h, k):
    h = h.lstrip('#')
    rgb = [srgb2lin(int(h[i:i + 2], 16)) for i in (0, 2, 4)]
    return '#%02x%02x%02x' % tuple(int(round(255 * lin2srgb(x * k))) for x in rgb)


WRITES = {}


def sub(pattern, repl, text, count=1, flags=0):
    new, n = re.subn(pattern, repl, text, count=count, flags=flags)
    if n == 0:
        raise SystemExit(f'pattern not found: {pattern}')
    return new


st = open(ROOT + 'src/mascot-studio.js').read()
cur = dict(re.findall(r'(\w+): (-?[0-9.]+)', re.search(r'export const STUDIO = \{([^}]*)\};', st).group(1)))
cur = {k: float(v) for k, v in cur.items()}
new = dict(cur)
for src, dst in (('env', 'env'), ('key', 'key'), ('keyAz', 'keyAz'), ('keyEl', 'keyEl'), ('fill', 'fill'), ('fillAz', 'fillAz'), ('fillEl', 'fillEl'),
                 ('bounce', 'bounce'), ('bounceAz', 'bounceAz'), ('hemi', 'hemi'), ('shadowSoft', 'shadowSoft'), ('shadowInt', 'shadowInt'), ('exp', 'exposure')):
    if src in d:
        new[dst] = d[src]
order = ['env', 'key', 'keyAz', 'keyEl', 'fill', 'fillAz', 'fillEl', 'bounce', 'bounceAz', 'hemi', 'shadowSoft', 'shadowInt', 'exposure']
body = ', '.join(f'{k}: {new[k]:.3f}' for k in order if k in new)
st = sub(r'export const STUDIO = \{[^}]*\};', 'export const STUDIO = { ' + body + ' };', st)
WRITES['src/mascot-studio.js'] = st

f = open(ROOT + 'src/mascot-fabric.js').read()
cb = re.search(r"body: \{ (?:gain: \[[^\]]*\], )?base: '(#[0-9a-f]{6})'", f).group(1)
fb = re.search(r"charcoal: \{ (?:gain: \[[^\]]*\], )?base: '(#[0-9a-f]{6})'", f).group(1)
legacy = 'gr' not in d          # newer tuner runs carry unclamped per-channel gains instead of palette multipliers
ncb, nfb = (scale_hex(cb, d.get('bk', 1.0)), scale_hex(fb, d.get('fk', 1.0))) if legacy else (cb, fb)
f = f.replace("base: '%s', tip: '#f2867c'" % cb, "base: '%s', tip: '#f2867c'" % ncb).replace("base: '%s', tip: '#4f4b54'" % fb, "base: '%s', tip: '#4f4b54'" % nfb)
f = sub(r'normalStrength = [0-9.]+, tipAmount = [0-9.]+, mottle = ([0-9.]+), macro = ([0-9.]+), cavity = [0-9.]+, fibAlbedo = [0-9.]+, crestPow = [0-9.]+,',
        lambda m: 'normalStrength = %.3f, tipAmount = %.3f, mottle = %s, macro = %s, cavity = %.3f, fibAlbedo = %.3f, crestPow = %.3f,' % (d['u.uNormalStrength'], d['u.uTipAmount'], m.group(1), m.group(2), d['u.uCavity'], d['u.uFibAlbedo'], d.get('u.uCrestPow', 1.0)), f)
def set_gain(text, group, vals):
    pat = r"(%s: \{ gain: )\[[^\]]*\]" % group
    return sub(pat, lambda m: m.group(1) + '[%.3f, %.3f, %.3f]' % tuple(vals), text)


f = set_gain(f, 'body', [d.get('gr', 1.0), d.get('gg', d.get('gr', 1.0)), d.get('gb', d.get('gr', 1.0))])
cur_g = [float(x) for x in re.search(r"charcoal: \{ gain: \[([^\]]*)\]", f).group(1).split(',')]
f = set_gain(f, 'charcoal', [d.get('fk', 1.0) * g / cur_g[0] for g in cur_g])      # (keeps a hand-set per-channel plate gain instead of flattening it)
f = sub(r'shellEdge = [0-9.]+,', 'shellEdge = %.3f,' % d.get('u.uShellEdge', 0.3), f)
f = sub(r'aoFloor = [0-9.]+,', 'aoFloor = %.3f,' % d.get('u.uAOFloor', 0.34), f)
f = sub(r'aoDirect = [0-9.]+, aoPower = [0-9.]+, shellEdge = ([0-9.]+), wrap = [0-9.]+,',
        lambda m: 'aoDirect = %.3f, aoPower = %.3f, shellEdge = %s, wrap = %.3f,' % (d['u.uAODirect'], d['u.uAOPower'], m.group(1), d['u.uWrap']), f)
f = sub(r"toe = [0-9.]+, rimColor = '(#[0-9a-f]{6})', rimAmount = [0-9.]+, rimPower = [0-9.]+, rimUp = [0-9.]+, rimSide = -?[0-9.]+,",
        lambda m: "toe = %.3f, rimColor = '%s', rimAmount = %.3f, rimPower = %.3f, rimUp = %.3f, rimSide = %.3f," % (d['u.uToe'], m.group(1), d['u.uRimAmount'], d['u.uRimPower'], d['u.uRimUp'], d['u.uRimSide']), f)
f = sub(r'uFaceDetail: \{ value: [0-9.]+ \}', 'uFaceDetail: { value: %.3f }' % d.get('u.uFaceDetail', 2.0), f)
f = sub(r'uFaceRelief: \{ value: [0-9.]+ \}', 'uFaceRelief: { value: %.3f }' % d.get('u.uFaceRelief', 1.2), f)
f = sub(r'uRimTightAmount: \{ value: [0-9.]+ \}', 'uRimTightAmount: { value: %.3f }' % d.get('u.uRimTightAmount', 0.9), f)
f = sub(r'uRimTightPower: \{ value: [0-9.]+ \}', 'uRimTightPower: { value: %.3f }' % d.get('u.uRimTightPower', 8), f)
f = sub(r'uShellAlpha: \{ value: [0-9.]+ \}', 'uShellAlpha: { value: %.3f }' % d.get('u.uShellAlpha', 0.8), f)
f = sub(r'uShellGlow: \{ value: [0-9.]+ \}', 'uShellGlow: { value: %.3f }' % d.get('u.uShellGlow', 0.22), f)
f = sub(r'uShellEdge: \{ value: shellEdge \}', 'uShellEdge: { value: shellEdge }', f)
# every seam / edge uniform the tuner knows about
for key, val in d.items():
    if key.startswith('u.uEdge') or key in ('u.uFaceJitter', 'u.uFaceSoft'):
        name = key[2:]
        f = sub(r'(    %s: \{ value: )-?[0-9.]+( \})' % name, lambda m: m.group(1) + ('%.5g' % val) + m.group(2), f)
f = sub(r'uUpFibre: \{ value: [0-9.]+ \}', 'uUpFibre: { value: %.3f }' % d.get('u.uUpFibre', 0.6), f)
f = sub(r'uFaceTip: \{ value: [0-9.]+ \}', 'uFaceTip: { value: %.3f }' % d.get('u.uFaceTip', 0.35), f)
f = sub(r'uFaceVignette: \{ value: [0-9.]+ \}', 'uFaceVignette: { value: %.3f }' % d.get('u.uFaceVignette', 0.24), f)
f = sub(r'sheen = [0-9.]+, sheenRoughness = [0-9.]+,', 'sheen = %.3f, sheenRoughness = %.3f,' % (d.get('sheen', 1.0), d.get('sr', 0.55)), f)
f = sub(r'scale: 1 / NAP_TILE, center: 0\.5, gain: [0-9.]+ \}', 'scale: 1 / NAP_TILE, center: 0.5, gain: %.3f }' % d['u.uFibGain'], f)
f = sub(r'uFeltBias: \{ value: napSet\.real \? -?[0-9.]+ : -0\.7 \}', 'uFeltBias: { value: napSet.real ? %.3f : -0.7 }' % d['u.uFeltBias'], f)
WRITES['src/mascot-fabric.js'] = f

fa = open(ROOT + 'src/mascot-face.js').read()
tx = open(ROOT + 'src/face/textures.js').read()
if 'cordAmp' in d:
    try:
        tx = sub(r'function threadMaps\(amp = [0-9.]+\)', 'function threadMaps(amp = %.3f)' % d['cordAmp'], tx)
        fa = sub(r'bumpScale: [0-9.]+ \}\); m\.color\.setScalar\([0-9.]+\)', 'bumpScale: %.2f }); m.color.setScalar(%.3f)' % (d['cordBump'], d['cordBright']), fa)
    except SystemExit as e:
        print('cord values not applied (%s); set them by hand' % e)
fa = fa.replace("base: '%s', tip: '#4f4b54'" % fb, "base: '%s', tip: '#4f4b54'" % nfb)
WRITES['src/mascot-face.js'] = fa
WRITES['src/face/textures.js'] = tx
for rel, text in WRITES.items():            # every pattern matched: write all files at once (nothing is half applied)
    open(ROOT + rel, 'w').write(text)
print('applied: body %s -> %s, charcoal %s -> %s' % (cb, ncb, fb, nfb))
