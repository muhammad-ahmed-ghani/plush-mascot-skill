#!/usr/bin/env node
// Create a mascot project from the skill's template.
//   node scaffold.mjs <target-dir> --name "Pip" --slug pip --product "Acme" [--tagline "..."] [--palette-body "#hex" --palette-face .. --palette-eye .. --palette-accent ..]
//        [--install | --link-node-modules <dir>] [--bootstrap [--quality draft|final]] [--strip-example] [--force] [--template <dir>]
// The project starts with the EXAMPLE mascot's art so that it runs at once; `node scripts/pipeline.mjs status` warns until you replace it.
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync, rmSync, symlinkSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, resolve, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url)), argv = process.argv.slice(2);
const flag = (n) => argv.includes(`--${n}`), val = (n, d) => { const i = argv.indexOf(`--${n}`); return i < 0 ? d : argv[i + 1]; };
const target = argv.find((a, i) => !a.startsWith('--') && !argv[i - 1]?.startsWith('--') || (i === 0 && !a.startsWith('--')));
const die = (m) => { console.error(`scaffold: ${m}`); process.exit(1); };
if (!target) die('usage: node scaffold.mjs <target-dir> --name Pip --slug pip --product "Acme" [--install] [--bootstrap]');
const tpl = resolve(val('template', resolve(here, '..', 'template')));
if (!existsSync(`${tpl}/mascot.config.json`)) die(`template not found at ${tpl}`);
const dest = resolve(target);
if (existsSync(dest) && readdirSync(dest).length && !flag('force')) die(`${dest} is not empty (use --force)`);
const name = val('name', 'Mascot'), slug = val('slug', name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')), product = val('product', 'Your Product');
if (!/^[a-z0-9][a-z0-9-]*$/.test(slug)) die('slug must be lowercase letters, digits and hyphens');
const hex = (k) => { const v = val(`palette-${k}`); if (v && !/^#[0-9a-fA-F]{6}$/.test(v)) die(`--palette-${k} must be #rrggbb`); return v; };
const SKIP = new Set(['node_modules', 'dist', 'public', '.pipeline', '__pycache__', '.DS_Store', '.cache', '.refs', '.seams', '.fit-tmp']);
mkdirSync(dest, { recursive: true });
cpSync(tpl, dest, { recursive: true, preserveTimestamps: true, filter: (s) => !SKIP.has(s.split(sep).pop()) && !/assets[\\/]mascot-mesh.*\.bin$/.test(s) });

const cfgPath = `${dest}/mascot.config.json`, cfg = JSON.parse(readFileSync(cfgPath, 'utf8'));
Object.assign(cfg.character, { name, slug, product }); if (val('tagline')) cfg.character.tagline = val('tagline');
for (const [k, key] of [['body', 'body'], ['face', 'face'], ['eye', 'eye'], ['accent', 'accent']]) if (hex(k)) cfg.palette[key] = hex(k);
writeFileSync(cfgPath, JSON.stringify(cfg, null, 2) + '\n');
const pkgPath = `${dest}/package.json`, pkg = JSON.parse(readFileSync(pkgPath, 'utf8')); pkg.name = `${slug}-studio`; writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n');

if (flag('strip-example')) {
  for (const f of readdirSync(`${dest}/assets`)) if (/^mascot-(hero|transparent|turnaround|use-cases)/.test(f) || /^mascot-(nap|face-halo|eye-rim|sclera)/.test(f)) rmSync(`${dest}/assets/${f}`);
  writeFileSync(`${dest}/art/TODO.md`, `The example mascot's art and derived maps were removed.\n1. Generate the masters (skill: references/image-generation.md) into art/masters/.\n2. Register: python3 scripts/tools/normalize_art.py --in art/masters/front.png --out assets/mascot-transparent.png --write-config\n3. Put the hero, turnaround and use-case sheet at the paths in mascot.config.json (art.*), then node scripts/pipeline.mjs run.\n4. Re-measure the face (scripts/dev/fit-face.py) and the other example-specific constants (skill: references/art-analysis.md section 9).\n`);
}
if (val('link-node-modules')) symlinkSync(resolve(val('link-node-modules')), `${dest}/node_modules`, 'dir');
else if (flag('install')) { console.log('npm ci ...'); if (spawnSync('npm', ['ci'], { cwd: dest, stdio: 'inherit' }).status) die('npm ci failed'); }
if (flag('bootstrap')) {
  const q = val('quality', 'draft'); console.log(`bootstrap: pipeline run --to bake --quality ${q}`);
  if (spawnSync('node', ['scripts/pipeline.mjs', 'run', '--to', 'bake', '--quality', q], { cwd: dest, stdio: 'inherit' }).status) die('bootstrap failed (see .pipeline/logs)');
}
console.log(`\ncreated ${relative(process.cwd(), dest) || '.'} for ${name} (${slug}), ${product}
next:
  cd ${relative(process.cwd(), dest) || '.'}${existsSync(`${dest}/node_modules`) ? '' : ' && npm ci'}
  node scripts/pipeline.mjs status                 # which stages are fresh; warns while the example art is in place
  ${flag('bootstrap') ? '' : 'node scripts/pipeline.mjs run --to bake --quality draft   # derived files (silhouette refs, seams, meshes)\n  '}npm run dev -- --port 4173
then replace the example art (skill: references/workflow.md, phases 0 to 2).`);
