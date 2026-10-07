#!/usr/bin/env node
// Lint the skill: frontmatter, size, links, every cited path and command exists, no brand words, no em dashes, no TODOs.  node lint-skill.mjs
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..'), tpl = join(root, 'template');
// the banned names are assembled from fragments so that this file does not itself contain them
const BANNED = new RegExp(['work' + 'erx', '\\bw' + 'ex\\b', 'agent' + 'ara', 'cod' + 'ex'].join('|'), 'i');
const problems = []; const bad = (f, m) => problems.push(`${f}: ${m}`);
const walk = (d) => readdirSync(d).flatMap((f) => (statSync(join(d, f)).isDirectory() ? walk(join(d, f)) : [join(d, f)]));
const skill = readFileSync(join(root, 'SKILL.md'), 'utf8'), fm = skill.match(/^---\nname: (.+)\ndescription: (.+)\n---/);
if (!fm) bad('SKILL.md', 'frontmatter must be name + description'); else { if (fm[2].length > 1024) bad('SKILL.md', `description is ${fm[2].length} chars (max 1024)`); if (/[<>]/.test(fm[2])) bad('SKILL.md', 'angle brackets in description'); }
if (skill.split('\n').length > 500) bad('SKILL.md', 'over 500 lines');
for (const d of ['references', 'prompts']) for (const f of readdirSync(join(root, d)).filter((x) => x.endsWith('.md'))) if (d === 'references' && !skill.includes(`references/${f}`)) bad('SKILL.md', `does not link references/${f}`);
const GENERATED = /^(assets\/mascot-(mesh|mesh-lite|animated|motion-reel|runtime-idle|nap-|face-halo|eye-rim|sclera)|assets\/.*\.(glb|mp4|webm)|tests\/|dist\/|public\/|\.pipeline|art\/|scripts\/(bake\/\.|dev\/\.|nap\/\.)|assets\/apple-touch)/;
const exists = (p) => { p = p.replace(/[.,;:)]+$/, ''); return GENERATED.test(p) || existsSync(join(root, p)) || existsSync(join(tpl, p)) || existsSync(join(root, p.replace(/^template\//, 'template/'))) || existsSync(join(tpl, 'scripts', p.replace(/^scripts\//, ''))); };
const files = [join(root, 'SKILL.md'), ...walk(join(root, 'references')), ...walk(join(root, 'prompts')).filter((f) => f.endsWith('.md'))];
for (const f of files) {
  const t = readFileSync(f, 'utf8'), rel = f.slice(root.length + 1);
  if (BANNED.test(t)) bad(rel, 'brand word');
  if (t.includes('\u2014')) bad(rel, 'em dash');
  if (/\bTODO\b|\bTBD\b|draft in progress/i.test(t)) bad(rel, 'unfinished marker');
  for (const m of t.matchAll(/`((?:references|prompts|scripts|src|assets|template)\/[A-Za-z0-9_.\/-]+)`/g)) if (!/[*<>{}$]/.test(m[1]) && !exists(m[1])) bad(rel, `missing path ${m[1]}`);
  for (const m of t.matchAll(/(?:node|python3) (scripts\/[A-Za-z0-9_.\/-]+\.(?:mjs|py))/g)) if (!exists(m[1])) bad(rel, `missing command target ${m[1]}`);
}
if (problems.length) { console.log(problems.join('\n')); console.log(`\n${problems.length} problem(s)`); process.exit(1); } console.log(`skill lint: ${files.length} files, no problems`);
