#!/usr/bin/env python3
"""Render prompt templates (prompts/*.md) with a character brief (JSON) into a prompt pack.

    python3 scripts/tools/render_prompts.py --brief brief.json --all --dir prompts --out art/prompts
    python3 scripts/tools/render_prompts.py --brief brief.json --template prompts/01-hero.md --model openai

Template file layout
  Front matter (optional; the first line is '---', closed by the next '---' line), parsed without a YAML library:
      title: Hero master
      asset: hero
      size_hint: 1:1 (openai 1920x1920 safe, 2880x2880 max; gemini 4K)
      required: [name, body_color, face_color]        (or one '- item' per line under 'required:')
  Only the text between a line '## PROMPT' and the next '# ' / '## ' heading (or the end of the file) is emitted.
  Every other section is documentation. A file without a '## PROMPT' line is documentation: '--all' skips it
  (it is listed under "skipped" in index.json); naming it with --template is an error.

Syntax inside the prompt (and inside partials)
  {{var}}  {{a.b.c}}       value from the brief; dotted paths walk nested objects (digits index lists).
                           Lists are joined with ', '. An object is an error (reference one of its fields).
  {{var|default text}}     the default (verbatim, spaces kept, may be empty: {{var|}}) is used when var is missing,
                           null, '' or [].
  {{> name}}               partial: <dir of the template>/_partials/name.md, rendered with the same brief and model.
                           Partials are plain text (no front matter, no '## PROMPT'), may use every construct here and
                           include other partials (cycles are reported with the chain). One leading and one trailing
                           blank line of the partial are trimmed so it flows into the sentence around it.
  <!-- if:var --> .. <!-- else --> .. <!-- endif -->   kept when var is truthy: present and not false/null/''/0/[]/{}
  <!-- if:!var --> .. <!-- endif -->                   kept when var is falsy or missing ('else' is optional)
  <!-- model:openai --> .. <!-- endmodel -->           kept only when rendering for that model; a comma list
                                                       (model:openai,gemini) is allowed
  <!-- any other comment -->                          dropped
  A block tag alone on its line removes that whole line, so tags leave no blank lines. After rendering, runs of
  blank lines collapse to one, trailing spaces go, double spaces between words collapse to one.

Checks
  error: a variable named in the front matter's `required` list is missing or empty;
  error: an emitted {{var}} without a default does not resolve (in the template or in any partial it includes);
  error: missing partial (names the template/partial and line), partial cycle, unbalanced if/model blocks,
         bad front matter, more than one '## PROMPT' section;
  warning: brief keys (leaf paths) that no rendered template or partial references in any branch
           (keys starting with '_' are comments and are ignored). --strict turns warnings into errors.

Outputs (with --out DIR)
  DIR/<NN>-<asset>.<model>.txt for each template and model (NN = the file name's prefix before the first '-',
  asset = front matter `asset` or the rest of the file name), and DIR/index.json:
    {"tool": "render_prompts.py", "version": 1, "brief": path, "brief_sha256": hex, "models": [..],
     "entries": [{"template", "title", "asset", "size_hint", "model", "file", "chars", "sha256",
                  "variables": [paths referenced], "partials": [names]}],
     "skipped": [doc files without a PROMPT section], "warnings": [..], "errors": [..]}
  Without --out the prompts are printed to stdout, each under a '===== <template> [<model>] =====' label.

Exit codes: 0 rendered (warnings allowed), 1 render errors (or warnings with --strict), 2 usage error.
Standard library only.
"""
import argparse
import hashlib
import json
import os
import re
import sys

VERSION = 1
MODELS = ('openai', 'gemini')
_MISSING = object()

TAG_RE = re.compile(
    r'\{\{\s*>\s*(?P<partial>[A-Za-z0-9_./-]+)\s*\}\}'
    r'|\{\{\s*(?P<var>[A-Za-z0-9_.-]+)\s*(?:\|(?P<default>(?:(?!\}\}).)*))?\}\}'
    r'|<!--\s*if:\s*(?P<neg>!?)\s*(?P<cond>[A-Za-z0-9_.-]+)\s*-->'
    r'|<!--\s*(?P<else>else)\s*-->'
    r'|<!--\s*(?P<endif>endif)\s*-->'
    r'|<!--\s*model:\s*(?P<model>[A-Za-z0-9_,\s-]+?)\s*-->'
    r'|<!--\s*(?P<endmodel>endmodel)\s*-->'
    r'|(?P<comment><!--(?:(?!-->).)*-->)',
    re.S)
BLOCK_KINDS = {'if', 'else', 'endif', 'model', 'endmodel', 'comment'}
HEADING_RE = re.compile(r'^#{1,2}\s')
PROMPT_RE = re.compile(r'^##\s+PROMPT\s*$')


class TemplateError(Exception):
    pass


# ----------------------------------------------------------------------------------------------------------------
# parsing
# ----------------------------------------------------------------------------------------------------------------
def _unquote(v):
    v = v.strip()
    if len(v) >= 2 and v[0] == v[-1] and v[0] in '"\'':
        return v[1:-1]
    return v


def _split_list(s):
    out, cur, q = [], '', None
    for ch in s:
        if q:
            cur += ch
            if ch == q:
                q = None
        elif ch in '"\'':
            q = ch
            cur += ch
        elif ch == ',':
            out.append(cur)
            cur = ''
        else:
            cur += ch
    out.append(cur)
    return [_unquote(x) for x in out if x.strip()]


def parse_front_matter(lines, fname):
    """Return (meta dict, index of the first body line). Flat `key: value`, `[a, b]` lists, `- item` lists."""
    if not lines or lines[0].strip() != '---':
        return {}, 0
    meta, key, i = {}, None, 1
    while i < len(lines) and lines[i].strip() != '---':
        line = lines[i]
        s = line.strip()
        if not s or s.startswith('#'):
            i += 1
            continue
        m = re.match(r'^\s*-\s+(.*)$', line)
        if m and key is not None:
            if not isinstance(meta[key], list):
                meta[key] = [] if meta[key] == '' else [meta[key]]
            meta[key].append(_unquote(m.group(1)))
        else:
            k, sep, v = line.partition(':')
            if not sep or not k.strip():
                raise TemplateError(f'{fname}:{i + 1}: front matter line is not "key: value": {line!r}')
            key, v = k.strip(), v.strip()
            meta[key] = _split_list(v[1:-1]) if (v.startswith('[') and v.endswith(']')) else _unquote(v)
        i += 1
    if i >= len(lines):
        raise TemplateError(f'{fname}: front matter opened with --- on line 1 is never closed')
    return meta, i + 1


def split_prompt(text, fname):
    """-> (meta, prompt text or None, line number of the prompt's first line)."""
    lines = text.replace('\r\n', '\n').split('\n')
    meta, body0 = parse_front_matter(lines, fname)
    starts = [i for i in range(body0, len(lines)) if PROMPT_RE.match(lines[i])]
    if not starts:
        return meta, None, 0
    if len(starts) > 1:
        raise TemplateError(f'{fname}: more than one "## PROMPT" section (lines {", ".join(str(s + 1) for s in starts)})')
    s = starts[0] + 1
    e = s
    while e < len(lines) and not HEADING_RE.match(lines[e]):
        e += 1
    return meta, '\n'.join(lines[s:e]), s + 1


def tokenize(src, where, line0):
    """Split source text into tokens: ('text', s) and tag tuples with their line numbers."""
    toks, pos = [], 0
    for m in TAG_RE.finditer(src):
        start, end = m.span()
        g = m.groupdict()
        if g['partial'] is not None:
            kind, val = 'partial', g['partial']
        elif g['var'] is not None:
            kind, val = 'var', (g['var'], g['default'])
        elif g['cond'] is not None:
            kind, val = 'if', (g['neg'] == '!', g['cond'])
        elif g['else']:
            kind, val = 'else', None
        elif g['endif']:
            kind, val = 'endif', None
        elif g['model'] is not None:
            kind, val = 'model', tuple(x.strip() for x in g['model'].split(',') if x.strip())
        elif g['endmodel']:
            kind, val = 'endmodel', None
        else:
            kind, val = 'comment', None
        line = line0 + src.count('\n', 0, m.start())
        if kind in BLOCK_KINDS:                       # a block tag alone on its line takes the whole line with it
            ls = src.rfind('\n', 0, start) + 1
            le = src.find('\n', end)
            le = len(src) if le == -1 else le
            if ls >= pos and src[ls:start].strip() == '' and src[end:le].strip() == '':
                start, end = ls, min(len(src), le + 1)
        if start > pos:
            toks.append(('text', src[pos:start], line))
        toks.append((kind, val, line))
        pos = end
    if pos < len(src):
        toks.append(('text', src[pos:], line0 + src.count('\n', 0, pos)))
    return toks


def build_tree(toks, where):
    root = []
    stack = [('root', root, None)]
    for kind, val, line in toks:
        top = stack[-1]
        if kind == 'text':
            top[1].append(('text', val))
        elif kind == 'var':
            top[1].append(('var', val[0], val[1], line))
        elif kind == 'partial':
            top[1].append(('partial', val, line))
        elif kind == 'comment':
            continue
        elif kind == 'if':
            node = {'t': 'if', 'neg': val[0], 'path': val[1], 'then': [], 'else': [], 'line': line}
            top[1].append(('if', node))
            stack.append(('if', node['then'], node))
        elif kind == 'else':
            if top[0] != 'if' or top[1] is top[2]['else']:
                raise TemplateError(f'{where}:{line}: <!-- else --> without an open <!-- if:... -->')
            stack[-1] = ('if', top[2]['else'], top[2])
        elif kind == 'endif':
            if top[0] != 'if':
                raise TemplateError(f'{where}:{line}: <!-- endif --> without an open <!-- if:... -->'
                                    + (f' (a model block opened at line {top[2]["line"]} is still open)' if top[0] == 'model' else ''))
            stack.pop()
        elif kind == 'model':
            node = {'t': 'model', 'models': val, 'body': [], 'line': line}
            top[1].append(('model', node))
            stack.append(('model', node['body'], node))
        elif kind == 'endmodel':
            if top[0] != 'model':
                raise TemplateError(f'{where}:{line}: <!-- endmodel --> without an open <!-- model:... -->'
                                    + (f' (an if block opened at line {top[2]["line"]} is still open)' if top[0] == 'if' else ''))
            stack.pop()
    if len(stack) > 1:
        kind, _, node = stack[-1]
        raise TemplateError(f'{where}:{node["line"]}: <!-- {kind}:... --> is never closed')
    return root


# ----------------------------------------------------------------------------------------------------------------
# rendering
# ----------------------------------------------------------------------------------------------------------------
def lookup(brief, path):
    if isinstance(brief, dict) and path in brief:
        return brief[path]
    cur = brief
    for part in path.split('.'):
        if isinstance(cur, dict) and part in cur:
            cur = cur[part]
        elif isinstance(cur, list) and part.isdigit() and int(part) < len(cur):
            cur = cur[int(part)]
        else:
            return _MISSING
    return cur


def is_empty(v):
    return v is _MISSING or v is None or (isinstance(v, (str, list, dict)) and len(v) == 0)


def truthy(v):
    if v is _MISSING or v is None:
        return False
    if isinstance(v, bool):
        return v
    if isinstance(v, (int, float)):
        return v != 0
    if isinstance(v, (str, list, dict)):
        return len(v) > 0
    return True


def fmt(v, path, where):
    if isinstance(v, bool):
        return 'true' if v else 'false'
    if isinstance(v, int):
        return str(v)
    if isinstance(v, float):
        return str(int(v)) if v.is_integer() else repr(v)
    if isinstance(v, str):
        return v
    if isinstance(v, list):
        return ', '.join(fmt(x, path, where) for x in v)
    if isinstance(v, dict):
        keys = ', '.join(sorted(v)[:6])
        raise TemplateError(f'{where}: {{{{{path}}}}} is an object; reference one of its fields ({keys})')
    return str(v)


def _trim_partial(text):
    text = text.replace('\r\n', '\n')
    if text.endswith('\n'):
        text = text[:-1]               # the file's own final newline
    if text.startswith('\n'):
        text = text[1:]                # one leading blank line
    if text.endswith('\n'):
        text = text[:-1]               # one trailing blank line
    return text


class Renderer:
    """Renders one template for one model. Collects errors instead of stopping at the first one."""

    def __init__(self, brief, template_path, partial_dir):
        self.brief = brief
        self.template = template_path
        self.partial_dir = partial_dir
        self.cache = {}
        self.errors = []

    def rel(self, path):
        base = os.path.dirname(os.path.abspath(self.template))
        return os.path.relpath(path, base)

    def load_partial(self, name, where, line, chain):
        path = os.path.join(self.partial_dir, name + '.md')
        if name in chain:
            raise TemplateError(f'{where}:{line}: partial cycle: ' + ' -> '.join(chain + [name]))
        if len(chain) > 24:
            raise TemplateError(f'{where}:{line}: partials nested more than 24 deep: ' + ' -> '.join(chain + [name]))
        if path not in self.cache:
            if not os.path.isfile(path):
                raise TemplateError(f'{where}:{line}: partial "{name}" not found (looked for {self.rel(path)})')
            with open(path, encoding='utf-8') as f:
                text = _trim_partial(f.read())
            pw = self.rel(path)
            self.cache[path] = (build_tree(tokenize(text, pw, 1), pw), pw)
        return self.cache[path]

    def render(self, nodes, model, where, chain):
        out = []
        for node in nodes:
            kind = node[0]
            if kind == 'text':
                out.append(node[1])
            elif kind == 'var':
                _, path, default, line = node
                v = lookup(self.brief, path)
                if is_empty(v):
                    if default is not None:
                        out.append(default)
                    else:
                        self.errors.append(f'{where}:{line}: unresolved {{{{{path}}}}} (not in the brief and no default)')
                else:
                    try:
                        out.append(fmt(v, path, f'{where}:{line}'))
                    except TemplateError as e:
                        self.errors.append(str(e))
            elif kind == 'partial':
                _, name, line = node
                try:
                    tree, pw = self.load_partial(name, where, line, chain)
                except TemplateError as e:
                    self.errors.append(str(e))
                    continue
                out.append(self.render(tree, model, f'{pw} (included from {where}:{line})', chain + [name]))
            elif kind == 'if':
                n = node[1]
                keep = truthy(lookup(self.brief, n['path']))
                if n['neg']:
                    keep = not keep
                out.append(self.render(n['then'] if keep else n['else'], model, where, chain))
            elif kind == 'model':
                n = node[1]
                if model in n['models']:
                    out.append(self.render(n['body'], model, where, chain))
        return ''.join(out)

    def references(self, nodes, where, chain, refs, partials):
        """Every variable path referenced in any branch (for the unused-key warning), following partials."""
        for node in nodes:
            kind = node[0]
            if kind == 'var':
                refs.add(node[1])
            elif kind == 'partial':
                name, line = node[1], node[2]
                partials.add(name)
                try:
                    tree, pw = self.load_partial(name, where, line, chain)
                except TemplateError:
                    continue                          # reported by render()
                self.references(tree, pw, chain + [name], refs, partials)
            elif kind == 'if':
                n = node[1]
                refs.add(n['path'])
                self.references(n['then'], where, chain, refs, partials)
                self.references(n['else'], where, chain, refs, partials)
            elif kind == 'model':
                self.references(node[1]['body'], where, chain, refs, partials)


def tidy(text):
    lines = [re.sub(r'(?<=\S) {2,}(?=\S)', ' ', ln.rstrip()) for ln in text.split('\n')]
    text = '\n'.join(lines)
    text = re.sub(r'\n{3,}', '\n\n', text).strip('\n')
    return text + '\n'


def leaf_paths(obj, prefix=''):
    if isinstance(obj, dict) and obj:
        out = []
        for k, v in obj.items():
            if str(k).startswith('_'):
                continue
            out += leaf_paths(v, f'{prefix}.{k}' if prefix else str(k))
        return out
    return [prefix] if prefix else []


def path_used(leaf, refs):
    for r in refs:
        if leaf == r or leaf.startswith(r + '.') or r.startswith(leaf + '.'):
            return True
    return False


def render_template(path, brief, models):
    """-> dict(meta, results{model: text}, refs, partials, errors) or None when the file has no PROMPT section."""
    name = os.path.basename(path)
    with open(path, encoding='utf-8') as f:
        text = f.read()
    meta, prompt, line0 = split_prompt(text, name)
    if prompt is None:
        return None
    tree = build_tree(tokenize(prompt, name, line0), name)
    partial_dir = os.path.join(os.path.dirname(os.path.abspath(path)), '_partials')
    r = Renderer(brief, path, partial_dir)
    errors = []
    req = meta.get('required', [])
    if isinstance(req, str):
        req = [x for x in _split_list(req)] if req else []
    for var in req:
        if is_empty(lookup(brief, var)):
            errors.append(f'{name}: required variable "{var}" is missing or empty in the brief')
    results = {}
    for model in models:
        r.errors = []
        results[model] = tidy(r.render(tree, model, name, []))
        for e in r.errors:
            if e not in errors:
                errors.append(e)
    refs, partials = set(), set()
    r.references(tree, name, [], refs, partials)
    refs.update(req)
    return {'meta': meta, 'results': results, 'refs': refs, 'partials': partials, 'errors': errors}


def out_name(path, meta, model, index):
    stem = os.path.splitext(os.path.basename(path))[0]
    nn, sep, rest = stem.partition('-')
    if not (sep and nn[:1].isdigit()):
        nn, rest = f'{index:02d}', stem
    asset = str(meta.get('asset') or rest or stem).strip().replace(' ', '-').replace('/', '-')
    return f'{nn}-{asset}.{model}.txt'


def main(argv=None):
    ap = argparse.ArgumentParser(
        description='Render prompt templates (prompts/*.md) with a brief JSON into a prompt pack: '
                    '{{var}}, {{a.b}}, {{var|default}}, {{> partial}}, <!-- if:var -->..<!-- endif -->, '
                    '<!-- model:openai -->..<!-- endmodel -->. See the module docstring for the full syntax.',
        epilog='examples:\n'
               '  python3 scripts/tools/render_prompts.py --brief brief.json --all --dir prompts --out art/prompts\n'
               '  python3 scripts/tools/render_prompts.py --brief brief.json --template prompts/01-hero.md --model openai',
        formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--brief', required=True, help='character brief JSON (see prompts/brief.example.json)')
    g = ap.add_mutually_exclusive_group(required=True)
    g.add_argument('--template', action='append', help='one template file (repeatable)')
    g.add_argument('--all', action='store_true', help='every *.md in --dir that has a "## PROMPT" section')
    ap.add_argument('--dir', default=None, help='template directory for --all (default: ./prompts)')
    ap.add_argument('--model', default='both', choices=['openai', 'gemini', 'both'],
                    help='which model variant to render (default both: one file per model)')
    ap.add_argument('--out', help='output directory for <NN>-<asset>.<model>.txt and index.json (default: print)')
    ap.add_argument('--strict', action='store_true', help='treat warnings (unused brief keys) as errors')
    ap.add_argument('--quiet', action='store_true', help='no summary on stderr')
    a = ap.parse_args(argv)

    try:
        with open(a.brief, encoding='utf-8') as f:
            raw = f.read()
        brief = json.loads(raw)
    except FileNotFoundError:
        print(f'error: brief not found: {a.brief}', file=sys.stderr)
        return 2
    except json.JSONDecodeError as e:
        print(f'error: {a.brief} is not valid JSON: {e}', file=sys.stderr)
        return 2
    if not isinstance(brief, dict):
        print(f'error: {a.brief} must hold a JSON object', file=sys.stderr)
        return 2

    if a.all:
        d = a.dir or 'prompts'
        if not os.path.isdir(d):
            print(f'error: template directory not found: {d} (give --dir)', file=sys.stderr)
            return 2
        paths = sorted(os.path.join(d, f) for f in os.listdir(d) if f.endswith('.md') and not f.startswith('_'))
    else:
        paths = a.template
        for p in paths:
            if not os.path.isfile(p):
                print(f'error: template not found: {p}', file=sys.stderr)
                return 2
    models = list(MODELS) if a.model == 'both' else [a.model]

    entries, skipped, errors, warnings = [], [], [], []
    all_refs = set()
    rendered = []
    for i, p in enumerate(paths):
        try:
            res = render_template(p, brief, models)
        except TemplateError as e:
            errors.append(str(e))
            continue
        if res is None:
            if a.all:
                skipped.append(os.path.basename(p))
                continue
            errors.append(f'{os.path.basename(p)}: no "## PROMPT" section (documentation file, nothing to render)')
            continue
        errors += res['errors']
        all_refs |= res['refs']
        rendered.append((i, p, res))

    unused = [k for k in leaf_paths(brief) if not path_used(k, all_refs)]
    if unused:
        warnings.append('brief keys not referenced by any rendered template: ' + ', '.join(unused))

    if a.out and not errors:
        os.makedirs(a.out, exist_ok=True)
    for i, p, res in rendered:
        meta = res['meta']
        for model in models:
            text = res['results'][model]
            fname = out_name(p, meta, model, i)
            entry = {'template': os.path.basename(p), 'title': meta.get('title', ''), 'asset': meta.get('asset', ''),
                     'size_hint': meta.get('size_hint', ''), 'model': model, 'file': fname, 'chars': len(text),
                     'sha256': hashlib.sha256(text.encode('utf-8')).hexdigest(),
                     'variables': sorted(res['refs']), 'partials': sorted(res['partials'])}
            entries.append(entry)
            if a.out:
                if not errors:
                    with open(os.path.join(a.out, fname), 'w', encoding='utf-8', newline='\n') as f:
                        f.write(text)
            elif not errors:
                sys.stdout.write(f'===== {entry["template"]} [{model}] =====\n{text}\n')

    failed = bool(errors) or (a.strict and bool(warnings))
    if a.out:
        index = {'tool': 'render_prompts.py', 'version': VERSION, 'brief': os.path.abspath(a.brief),
                 'brief_sha256': hashlib.sha256(raw.encode('utf-8')).hexdigest(), 'models': models,
                 'entries': entries if not errors else [], 'skipped': skipped, 'warnings': warnings, 'errors': errors}
        os.makedirs(a.out, exist_ok=True)
        with open(os.path.join(a.out, 'index.json'), 'w', encoding='utf-8', newline='\n') as f:
            json.dump(index, f, indent=1, ensure_ascii=False)
            f.write('\n')
    for w in warnings:
        print(f'warning: {w}', file=sys.stderr)
    for e in errors:
        print(f'error: {e}', file=sys.stderr)
    if not a.quiet:
        n_t = len(rendered)
        where = f' into {a.out}' if a.out else ''
        state = 'FAILED' if failed else 'ok'
        print(f'render_prompts: {state}: {n_t} template(s) x {len(models)} model(s) = {len(entries) if not errors else 0} '
              f'prompt(s){where}; {len(skipped)} doc file(s) skipped; {len(errors)} error(s), {len(warnings)} warning(s)',
              file=sys.stderr)
    return 1 if failed else 0


if __name__ == '__main__':
    sys.exit(main())
