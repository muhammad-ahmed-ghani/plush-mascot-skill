#!/usr/bin/env python3
"""Self-host the page's fonts: download the latin files Google Fonts serves, pin the axes the page does not use and subset to
the characters the page can need, then write woff2 files to assets/fonts/.

    python3 scripts/dev/build-fonts.py        (needs network, fonttools and brotli; run from the project root)

  Fraunces (display)            SOFT=100 and WONK=1 pinned; weight 400-800 and optical size 24-144 stay variable.  Italic: pinned at optical size 72.
  Alegreya Sans (text)          static 500 and 700
  Covered By Your Grace (notes) static 400
All three are SIL Open Font License 1.1 families.
"""
import os, re, subprocess, sys, tempfile
from fontTools.ttLib import TTFont
from fontTools.varLib import instancer
from fontTools import subset

UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36'
OUT = os.path.join('assets', 'fonts')
# basic Latin, Latin-1, curly quotes, dashes, bullet, ellipsis and a few maths signs
UNICODES = [*range(0x20, 0x7F), *range(0xA0, 0x100), 0x2013, 0x2014, 0x2018, 0x2019, 0x201C, 0x201D, 0x2022, 0x2026, 0x2122, 0x00D7, 0x2212]

def fetch(url):
    return subprocess.run(['curl', '-sS', '-A', UA, url], check=True, capture_output=True).stdout

def latin_file(css_url, style='normal', weight=None):
    css = fetch(css_url).decode()
    for m in re.finditer(r'/\*\s*([\w-]+)\s*\*/\s*@font-face\s*\{(.*?)\}', css, re.S):
        sub, body = m.groups()
        if sub != 'latin': continue
        if re.search(r'font-style:\s*(\w+)', body).group(1) != style: continue
        if weight and re.search(r'font-weight:\s*(\d+)', body).group(1) != str(weight): continue
        return fetch(re.search(r'url\((https[^)]+)\)', body).group(1))
    raise SystemExit(f'no latin file in {css_url} ({style} {weight})')

def build(data, name, limits=None):
    with tempfile.NamedTemporaryFile(suffix='.woff2') as tmp:
        tmp.write(data); tmp.flush()
        font = TTFont(tmp.name)
    opts = subset.Options()
    opts.layout_features = ['*']; opts.name_IDs = [1, 2, 3, 4, 6]; opts.notdef_outline = True; opts.hinting = False; opts.glyph_names = False
    s = subset.Subsetter(opts); s.populate(unicodes=UNICODES); s.subset(font)       # (subset first: instancing first trips a gvar bug in fonttools 4.5x)
    if limits: font = instancer.instantiateVariableFont(font, limits, inplace=False)
    font.flavor = 'woff2'
    path = os.path.join(OUT, name); font.save(path)
    print(f'{path:48} {os.path.getsize(path) / 1024:6.1f} KB')

os.makedirs(OUT, exist_ok=True)
FR = 'https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght,SOFT,WONK@0,9..144,100..900,0..100,0..1;1,9..144,100..900,0..100,0..1&display=swap'
build(latin_file(FR, 'normal'), 'fraunces.woff2', {'SOFT': 100, 'WONK': 1, 'opsz': (24, 144), 'wght': (400, 800)})
build(latin_file(FR, 'italic'), 'fraunces-italic.woff2', {'SOFT': 100, 'WONK': 1, 'opsz': 72, 'wght': (400, 800)})
AL = 'https://fonts.googleapis.com/css2?family=Alegreya+Sans:wght@500;700&display=swap'
build(latin_file(AL, 'normal', 500), 'alegreya-sans-500.woff2')
build(latin_file(AL, 'normal', 700), 'alegreya-sans-700.woff2')
build(latin_file('https://fonts.googleapis.com/css2?family=Covered+By+Your+Grace&display=swap'), 'covered-by-your-grace.woff2')
