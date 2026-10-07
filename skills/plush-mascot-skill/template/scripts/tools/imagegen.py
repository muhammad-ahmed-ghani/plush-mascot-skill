#!/usr/bin/env python3
"""Image generation for mascot art: OpenAI GPT Image and Google Nano Banana, at the largest valid size.

Sub-commands
  models                               list image-capable models the key can see
  sizes   --aspect W:H [--tier safe|max] | --validate WxH | --provider gemini
  estimate --size WxH --quality Q [--n N] [--price-per-mtok P]
  generate --provider openai|gemini|manual --prompt-file F --out PREFIX [--size WxH | --aspect A --image-size 4K] ...
  edit     (same as generate, plus --ref FILE (repeatable) [--ref-role "image 1: identity master"] [--mask FILE])

Nothing touches the network unless --yes is given; --dry-run prints the exact request (keys redacted). Keys come only from the
environment: OPENAI_API_KEY, GEMINI_API_KEY or GOOGLE_API_KEY (base URLs: OPENAI_BASE_URL, GEMINI_BASE_URL). Every saved image gets
<file>.json with the prompt, model, endpoint, requested and returned size, elapsed time and usage. Verified against the providers' docs on
2026-10-01 and tested against a local stub (mock_imagegen_server.py), not against the live services: make the first real call a cheap
smoke test (--size 1024x1024 --quality low). Rules (OpenAI GPT Image 2 / 2.5): long edge <= 3840, multiples of 16, ratio <= 3:1, 655,360..
8,294,400 pixels; above 2560x1440 is documented as experimental. Exit codes: 0 ok, 1 failed, 2 usage."""
import argparse, base64, hashlib, json, os, re, sys, time, uuid, urllib.request, urllib.error

PRESETS = {'openai': {'sunburst': 'gpt-image-2.5-sunburst-2026-09-08', 'flare': 'gpt-image-2.5-flare-2026-09-08', 'gpt-image-2': 'gpt-image-2'},
           'gemini': {'nano-banana-pro': 'gemini-3-pro-image', 'nano-banana-2': 'gemini-3.1-flash-image', 'nano-banana-2-lite': 'gemini-3.1-flash-lite-image'}}
DEFAULT_MODEL = {'openai': 'sunburst', 'gemini': 'nano-banana-pro'}
TOKENS_1024 = {'low': 196, 'medium': 439, 'high': 1756, 'xhigh': 3122, 'max': 7024}   # output tokens of a 1024x1024 image (GPT Image 2.5)
GEMINI_RATIOS = ['1:1', '3:2', '2:3', '3:4', '4:3', '4:5', '5:4', '9:16', '16:9', '21:9']
GEMINI_SIZES = {'512px': 512, '1K': 1024, '2K': 2048, '4K': 4096}
MIME_EXT = {'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp'}


class Fail(Exception):
    pass


def size_errors(w, h):
    e = []
    if max(w, h) > 3840: e.append('long edge above 3840')
    if w % 16 or h % 16: e.append('both edges must be multiples of 16')
    if max(w, h) / min(w, h) > 3 + 1e-9: e.append('ratio above 3:1')
    if not 655360 <= w * h <= 8294400: e.append('pixels outside 655,360..8,294,400')
    return e


def best_size(aw, ah, tier):
    cap, edge = (3686400, 2560) if tier == 'safe' else (8294400, 3840)
    r, best = aw / ah, None
    for w in range(16, edge + 1, 16):
        for h in {int(w / r // 16 * 16), int(-(-w / r // 16) * 16)}:
            if h < 16 or h > edge or size_errors(w, h) or w * h > cap: continue
            err = abs(w / h / r - 1)
            key = (0, -w * h) if err <= 0.002 else (1, err)
            if best is None or key < best[0]: best = (key, w, h)
    if not best: raise Fail('no valid size for that aspect')
    return best[1], best[2]


def model_id(provider, name):
    name = name or DEFAULT_MODEL[provider]
    return PRESETS[provider].get(name, name)


def read_prompt(a):
    if a.prompt_file: return open(a.prompt_file, encoding='utf-8').read().strip()
    if a.prompt: return a.prompt
    raise Fail('give --prompt or --prompt-file')


def redact(o):
    if isinstance(o, dict): return {k: redact(v) for k, v in o.items()}
    if isinstance(o, list): return [redact(v) for v in o]
    if isinstance(o, str) and len(o) > 200: return o[:40] + f'...<{len(o)} chars>'
    return o


def multipart(fields, files):
    b = uuid.uuid4().hex
    out = b''
    for k, v in fields.items():
        out += f'--{b}\r\nContent-Disposition: form-data; name="{k}"\r\n\r\n{v}\r\n'.encode()
    for k, path in files:
        ct = 'image/png' if path.lower().endswith('.png') else 'image/webp' if path.lower().endswith('.webp') else 'image/jpeg'
        out += f'--{b}\r\nContent-Disposition: form-data; name="{k}"; filename="{os.path.basename(path)}"\r\nContent-Type: {ct}\r\n\r\n'.encode() + open(path, 'rb').read() + b'\r\n'
    return out + f'--{b}--\r\n'.encode(), f'multipart/form-data; boundary={b}'


def post(url, headers, body, timeout, retries=3):
    for i in range(retries + 1):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, data=body, headers=headers, method='POST'), timeout=timeout) as r:
                return r.status, r.read()
        except urllib.error.HTTPError as e:
            data = e.read()
            if e.code in (429, 500, 502, 503, 504) and i < retries:
                print(f'  HTTP {e.code}, retrying in {2 ** (i + 1)} s', file=sys.stderr); time.sleep(2 ** (i + 1)); continue
            return e.code, data
        except (urllib.error.URLError, TimeoutError) as e:
            if i < retries: time.sleep(2 ** (i + 1)); continue
            raise Fail(f'network error: {e}')


def find_images(o, out):
    """Collect (base64, mime) for every image payload in a response, whatever its shape; skips parts flagged thought."""
    if isinstance(o, dict):
        if o.get('thought'): return out
        if True:
            mime = o.get('mime_type') or o.get('mimeType') or ''
            for k in ('b64_json', 'data'):
                v = o.get(k)
                if isinstance(v, str) and len(v) > 100 and (k == 'b64_json' or mime.startswith('image/') or o.get('type') == 'image'): out.append((v, mime))
        for v in o.values(): find_images(v, out)
    elif isinstance(o, list):
        for v in o: find_images(v, out)
    return out


def build_request(a, provider, mode):
    prompt = read_prompt(a)
    refs = list(a.ref or [])
    if a.ref_role: prompt += '\n\nReference images: ' + '; '.join(a.ref_role) + '.'
    model = model_id(provider, a.model)
    if provider == 'openai':
        base = os.environ.get('OPENAI_BASE_URL', 'https://api.openai.com').rstrip('/')
        f = {'model': model, 'prompt': prompt, 'size': a.size or 'auto', 'quality': a.quality, 'n': a.n}
        if a.background: f['background'] = a.background
        if a.format: f['output_format'] = a.format
        if a.moderation: f['moderation'] = a.moderation
        key = os.environ.get('OPENAI_API_KEY')
        hdr = {'Authorization': f'Bearer {key}'} if key else {}
        if mode == 'edit':
            if not refs: raise Fail('edit needs at least one --ref')
            files = [('image[]', p) for p in refs] + ([('mask', a.mask)] if a.mask else [])
            return {'url': base + '/v1/images/edits', 'headers': hdr, 'multipart': (f, files), 'preview': {**f, 'image[]': refs, 'mask': a.mask}, 'model': model, 'prompt': prompt, 'key': key}
        return {'url': base + '/v1/images/generations', 'headers': {**hdr, 'Content-Type': 'application/json'}, 'json': f, 'preview': f, 'model': model, 'prompt': prompt, 'key': key}
    base = os.environ.get('GEMINI_BASE_URL', 'https://generativelanguage.googleapis.com').rstrip('/')
    key = os.environ.get('GEMINI_API_KEY') or os.environ.get('GOOGLE_API_KEY')
    hdr = {'x-goog-api-key': key, 'Content-Type': 'application/json'} if key else {'Content-Type': 'application/json'}
    imgs = []
    for p in refs:
        mt = 'image/png' if p.lower().endswith('.png') else 'image/webp' if p.lower().endswith('.webp') else 'image/jpeg'
        imgs.append((mt, base64.b64encode(open(p, 'rb').read()).decode()))
    if a.api == 'interactions':
        rf = {'type': 'image', 'mime_type': 'image/png'}
        if a.aspect: rf['aspect_ratio'] = a.aspect
        if a.image_size: rf['image_size'] = a.image_size
        body = {'model': model, 'input': [{'type': 'text', 'text': prompt}] + [{'type': 'image', 'mime_type': m, 'data': d} for m, d in imgs], 'response_format': rf}
        url = base + '/v1beta/interactions'
    else:
        ic = {k: v for k, v in (('aspectRatio', a.aspect), ('imageSize', a.image_size)) if v}
        body = {'contents': [{'parts': [{'text': prompt}] + [{'inlineData': {'mimeType': m, 'data': d}} for m, d in imgs]}],
                'generationConfig': {'responseModalities': ['TEXT', 'IMAGE'], **({'imageConfig': ic} if ic else {})}}
        url = f'{base}/v1beta/models/{model}:generateContent'
    return {'url': url, 'headers': hdr, 'json': body, 'preview': body, 'model': model, 'prompt': prompt, 'key': key}


def run(a, mode):
    provider = a.provider
    if provider == 'manual':
        out = a.out + '.prompt.txt'; os.makedirs(os.path.dirname(os.path.abspath(out)), exist_ok=True)
        open(out, 'w', encoding='utf-8').write(read_prompt(a) + '\n')
        print(f'manual: prompt written to {out}. Generate the image with another tool, save it, then keep its settings in GENERATION-PROMPTS.md.'); return 0
    if provider == 'openai' and a.size and a.size != 'auto':
        w, h = map(int, a.size.lower().split('x')); errs = size_errors(w, h)
        if errs and a.model_is_gpt2(): raise Fail(f'invalid size {a.size}: ' + '; '.join(errs))
        if w * h > 3686400 or max(w, h) > 2560: print('note: above 2560x1440 is documented as experimental; compare with a safe-size render', file=sys.stderr)
    r = build_request(a, provider, mode)
    if a.dry_run:
        print(json.dumps({'method': 'POST', 'url': r['url'], 'headers': {k: ('<redacted>' if 'key' in k.lower() or k == 'Authorization' else v) for k, v in r['headers'].items()}, 'body': redact(r['preview'])}, indent=1)); return 0
    if not a.yes: raise Fail('refusing to call the network without --yes (use --dry-run to inspect the request)')
    if not r['key']: raise Fail('no API key in the environment (OPENAI_API_KEY, GEMINI_API_KEY or GOOGLE_API_KEY)')
    if a.max_usd is not None:
        if a.price_per_mtok is None or provider != 'openai' or not a.size: raise Fail('--max-usd needs --price-per-mtok, --provider openai and --size')
        w, h = map(int, a.size.split('x')); est = TOKENS_1024.get(a.quality, 1756) * w * h / 1048576 * a.n * a.price_per_mtok / 1e6
        if est > a.max_usd: raise Fail(f'estimated ${est:.3f} exceeds --max-usd {a.max_usd}')
    t0 = time.time()
    if 'multipart' in r:
        body, ct = multipart(*r['multipart']); hdr = {**r['headers'], 'Content-Type': ct}
    else:
        body, hdr = json.dumps(r['json']).encode(), r['headers']
    print(f'POST {r["url"]} ... (large images can take minutes)', file=sys.stderr)
    status, data = post(r['url'], hdr, body, a.timeout)
    elapsed = time.time() - t0
    try: resp = json.loads(data)
    except Exception: resp = {}
    if status >= 400:
        msg = json.dumps(resp)[:600] if resp else data[:300].decode('utf-8', 'replace')
        hint = ' Hint: transparent background rejected; use --background opaque (or omit it), request a flat key colour and run alpha_extract.py key.' if 'background' in msg.lower() else ''
        raise Fail(f'HTTP {status}: {msg}{hint}')
    imgs, seen = [], set()
    for b64, mime in find_images(resp, []):
        h = hashlib.sha256(b64.encode()).hexdigest()
        if h not in seen: seen.add(h); imgs.append((base64.b64decode(b64), mime))
    if not imgs: raise Fail('no image in the response; top-level keys: ' + ', '.join(resp) + ' (fix find_images() for the new shape)')
    os.makedirs(os.path.dirname(os.path.abspath(a.out)), exist_ok=True)
    for i, (raw, mime) in enumerate(imgs, 1):
        ext = 'png' if raw[:4] == b'\x89PNG' else 'webp' if raw[8:12] == b'WEBP' else 'jpg' if raw[:2] == b'\xff\xd8' else MIME_EXT.get(mime, 'png')
        path = f'{a.out}.{ext}' if len(imgs) == 1 else f'{a.out}_{i:02d}.{ext}'
        if os.path.exists(path) and not a.force: raise Fail(f'{path} exists (use --force)')
        open(path, 'wb').write(raw)
        try:
            from PIL import Image; got = '%dx%d' % Image.open(path).size
        except Exception: got = '?'
        meta = {'provider': provider, 'model': r['model'], 'endpoint': r['url'], 'mode': mode, 'prompt': r['prompt'], 'requested_size': a.size or f'{a.aspect}/{a.image_size}', 'returned_size': got,
                'quality': a.quality, 'refs': a.ref or [], 'elapsed_s': round(elapsed, 1), 'usage': resp.get('usage') or resp.get('usageMetadata'), 'sha256': hashlib.sha256(raw).hexdigest(), 'time': time.strftime('%Y-%m-%dT%H:%M:%S')}
        json.dump(meta, open(path + '.json', 'w'), indent=1)
        warn = f'  (requested {a.size}, got {got})' if a.size and got != '?' and got != a.size else ''
        print(f'saved {path} {got}{warn}')
    return 0


def cmd_models(a):
    out = []
    for prov, url, hdr in (('openai', os.environ.get('OPENAI_BASE_URL', 'https://api.openai.com').rstrip('/') + '/v1/models', {'Authorization': 'Bearer ' + os.environ.get('OPENAI_API_KEY', '')}),
                           ('gemini', os.environ.get('GEMINI_BASE_URL', 'https://generativelanguage.googleapis.com').rstrip('/') + '/v1beta/models', {'x-goog-api-key': os.environ.get('GEMINI_API_KEY') or os.environ.get('GOOGLE_API_KEY') or ''})):
        if a.provider not in (None, prov): continue
        if not list(hdr.values())[0].replace('Bearer ', ''): print(f'{prov}: no key in the environment'); continue
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers=hdr), timeout=30) as r: d = json.load(r)
        except Exception as e: print(f'{prov}: {e}'); continue
        ids = [m.get('id') or m.get('name', '').replace('models/', '') for m in (d.get('data') or d.get('models') or [])]
        print(f'{prov}: ' + ', '.join(sorted(i for i in ids if 'image' in i.lower() or 'imagen' in i.lower())))
    return 0


def cmd_sizes(a):
    if a.validate:
        w, h = map(int, a.validate.lower().split('x')); e = size_errors(w, h)
        print(f'{w}x{h}: ' + ('valid' + (' (above 2560x1440: experimental)' if w * h > 3686400 or max(w, h) > 2560 else '') if not e else 'INVALID: ' + '; '.join(e))); return 1 if e else 0
    if a.provider == 'gemini':
        print('aspect ratios: ' + ', '.join(GEMINI_RATIOS) + ' (Nano Banana 2 adds 1:4, 4:1, 1:8, 8:1)')
        print('image_size: ' + ', '.join(f'{k} (long edge about {v} px)' for k, v in GEMINI_SIZES.items()) + '; Pro: 1K/2K/4K, 2: 512px..4K, 2 Lite: 1K'); return 0
    aw, ah = map(int, (a.aspect or '1:1').split(':'))
    for tier in ([a.tier] if a.tier else ['safe', 'max']):
        w, h = best_size(aw, ah, tier); print(f'{tier:4} {a.aspect or "1:1"}: {w}x{h}  ({w * h / 1e6:.2f} MP)')
    return 0


def cmd_estimate(a):
    w, h = map(int, a.size.lower().split('x')); t = TOKENS_1024.get(a.quality, 1756) * w * h / 1048576 * a.n
    print(f'{a.quality} {w}x{h} x{a.n}: about {t:,.0f} output tokens (scaled from the published 1024x1024 count; real usage is in the response)')
    if a.price_per_mtok is not None: print(f'  about ${t * a.price_per_mtok / 1e6:.3f} at ${a.price_per_mtok}/1M tokens')
    else: print('  give --price-per-mtok for a dollar figure (check the current price list; none is assumed here)')
    return 0


def parser():
    p = argparse.ArgumentParser(description=__doc__.split('\n\n')[0], formatter_class=argparse.RawDescriptionHelpFormatter)
    sp = p.add_subparsers(dest='cmd', required=True)
    s = sp.add_parser('models'); s.add_argument('--provider', choices=['openai', 'gemini'])
    s = sp.add_parser('sizes'); s.add_argument('--aspect'); s.add_argument('--tier', choices=['safe', 'max']); s.add_argument('--validate'); s.add_argument('--provider', default='openai')
    s = sp.add_parser('estimate'); s.add_argument('--size', required=True); s.add_argument('--quality', default='high'); s.add_argument('--n', type=int, default=1); s.add_argument('--price-per-mtok', type=float)
    for name in ('generate', 'edit'):
        s = sp.add_parser(name)
        s.add_argument('--provider', choices=['openai', 'gemini', 'manual'], default='openai'); s.add_argument('--model'); s.add_argument('--prompt'); s.add_argument('--prompt-file')
        s.add_argument('--out', required=True); s.add_argument('--size'); s.add_argument('--quality', default='high'); s.add_argument('--n', type=int, default=1)
        s.add_argument('--background', choices=['transparent', 'opaque', 'auto']); s.add_argument('--format', choices=['png', 'webp', 'jpeg']); s.add_argument('--moderation', choices=['auto', 'low'])
        s.add_argument('--aspect'); s.add_argument('--image-size'); s.add_argument('--api', choices=['interactions', 'generate-content'], default='interactions')
        s.add_argument('--ref', action='append'); s.add_argument('--ref-role', action='append'); s.add_argument('--mask')
        s.add_argument('--dry-run', action='store_true'); s.add_argument('--yes', action='store_true'); s.add_argument('--force', action='store_true')
        s.add_argument('--max-usd', type=float); s.add_argument('--price-per-mtok', type=float); s.add_argument('--timeout', type=int, default=900)
    return p


def main(argv=None):
    a = parser().parse_args(argv)
    a.model_is_gpt2 = lambda: True
    try:
        return {'models': cmd_models, 'sizes': cmd_sizes, 'estimate': cmd_estimate}.get(a.cmd, lambda x: run(x, a.cmd))(a)
    except Fail as e:
        print(f'imagegen: {e}', file=sys.stderr); return 1


if __name__ == '__main__':
    sys.exit(main())
