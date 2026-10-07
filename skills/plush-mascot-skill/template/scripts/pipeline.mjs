// The stage runner: node scripts/pipeline.mjs list | status | run [--from S] [--to S] [--only a,b] [--quality draft|final] [--port 4173] [--with-fit]
//   stages: art refs fit seams nap bake sync verify evidence.  Stages are skipped when their outputs are newer than their inputs (mtime), logs go to
//   .pipeline/logs/<stage>.log.  `fit` and `face` need human decisions and are not run by default (--with-fit runs the sculpt fit).
import { existsSync, statSync, mkdirSync, readFileSync, writeFileSync, createWriteStream } from 'node:fs';
import { spawnSync, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createConnection } from 'node:net';
import { ROOT, config } from './lib/config.mjs';

const args = process.argv.slice(2), cmd = args[0] ?? 'status';
const opt = (n, d) => { const i = args.indexOf(`--${n}`); return i < 0 ? d : (args[i + 1]?.startsWith('--') || args[i + 1] === undefined ? true : args[i + 1]); };
const quality = opt('quality', 'final'), port = +opt('port', 4173), py = process.env.PYTHON ?? 'python3';
const a = config.art, tiles = Object.values(config.nap.tiles), meshes = [config.mesh.final, config.mesh.lite];
const sh = (c) => ({ cmd: c });
const STAGES = {
  art: { desc: 'art QA of the registered front and turnaround', ins: [a.transparent, a.turnaround], outs: ['.pipeline/art-qa.json'], steps: [[py, 'scripts/tools/art_qa.py', a.transparent, '--kind', 'transparent', '--report', '.pipeline/art-qa.json'], [py, 'scripts/tools/art_qa.py', a.turnaround, '--kind', 'turnaround']] },
  refs: { desc: 'reference silhouettes (fit grids)', ins: [a.transparent, a.turnaround], outs: ['scripts/bake/.refs/ref_front_sym_627.bin'], steps: [[py, 'scripts/bake/refmasks.py']] },
  fit: { desc: 'fit the sculpt to the silhouettes (human review of the score; only with --with-fit)', manual: true, ins: ['scripts/bake/.refs/ref_front_sym_418.bin'], outs: ['scripts/bake/fit.result.json'], steps: [['node', 'scripts/bake/fit.mjs', '--refs', 'scripts/bake/.refs', '--size', '418'], ['node', 'scripts/bake/apply-fit.mjs'], ['node', 'scripts/bake/score.mjs']] },
  seams: { desc: 'candidate seams and folds (pick by id in scripts/bake/seams.mjs)', ins: [a.transparent, a.turnaround], outs: ['scripts/bake/.seams/seams_neutral.json', 'scripts/bake/.seams/folds.json'], steps: [[py, 'scripts/bake/extract-seams.py'], [py, 'scripts/bake/trace-folds.py']] },
  nap: { desc: 'fabric nap tiles (about 5 minutes cold)', ins: [a.transparent], outs: tiles, steps: [[py, 'scripts/nap/build.py']] },
  bake: { desc: 'bake the meshes and check them', ins: ['scripts/bake/model.mjs', 'scripts/bake/.seams/seams_neutral.json', 'src/mascot-face-shapes.js'], outs: meshes, steps: quality === 'draft' ? [['node', 'scripts/bake/bake.mjs', '--quality', 'draft'], ['node', 'scripts/bake/bake.mjs', '--quality', 'lite']] : [['node', 'scripts/bake/bake.mjs', '--quality', 'final'], ['node', 'scripts/bake/bake.mjs', '--quality', 'lite'], ['node', 'scripts/bake/check-mesh.mjs']] },
  sync: { desc: 'copy assets to public/', always: true, steps: [['node', 'scripts/sync-public.mjs']] },
  verify: { desc: 'the gates (starts the dev server if needed)', always: true, gates: true },
  evidence: { desc: 'stills, GLB + validator, reel, contact sheets (minutes)', always: true, gates: true, evidence: true },
};
const ORDER = Object.keys(STAGES);
const mtime = (p) => (existsSync(`${ROOT}/${p}`) ? statSync(`${ROOT}/${p}`).mtimeMs : 0);
const state = (s) => { const st = STAGES[s]; if (st.always) return 'always'; if (st.outs.some((o) => !mtime(o))) return 'missing'; return Math.max(...st.ins.map(mtime)) > Math.min(...st.outs.map(mtime)) + 1000 ? 'stale' : 'fresh'; };
const exampleWarning = () => {
  const ex = JSON.parse(readFileSync(`${ROOT}/scripts/lib/example-art.json`, 'utf8')), same = Object.keys(ex).filter((p) => existsSync(`${ROOT}/${p}`) && createHash('sha256').update(readFileSync(`${ROOT}/${p}`)).digest('hex') === ex[p]);
  return same.length ? `WARNING: ${same.length} art file(s) are still the example mascot's (${same.join(', ')}). Replace them before shipping.` : '';
};
const run = (step, log) => { const r = spawnSync(step[0], step.slice(1), { cwd: ROOT, encoding: 'utf8', env: { ...process.env, MASCOT_ORIGIN: `http://127.0.0.1:${port}` }, maxBuffer: 1 << 28 }); log.write(`$ ${step.join(' ')}\n${r.stdout ?? ''}${r.stderr ?? ''}\n`); return r.status === 0; };
const listening = (p) => new Promise((res) => { const s = createConnection({ port: p, host: '127.0.0.1' }, () => { s.end(); res(true); }); s.on('error', () => res(false)); });

async function gates(log, evidence) {
  let server = null;
  if (!(await listening(port))) { server = spawn('node_modules/.bin/vite', ['--host', '127.0.0.1', '--port', String(port), '--strictPort'], { cwd: ROOT, stdio: 'ignore' }); for (let i = 0; i < 60 && !(await listening(port)); i++) await new Promise((r) => setTimeout(r, 500)); }
  const list = evidence ? [['node', 'scripts/dev/evidence.mjs'], ['node', 'scripts/dev/glb-check.mjs'], [py, 'scripts/dev/contact-sheets.py']] : [['node', 'scripts/dev/smoke.mjs'], [py, 'scripts/dev/scaled-ref.py'], ['node', 'scripts/dev/eval.mjs', '--ppus', '350,246,123'], ['node', 'scripts/dev/turn-check.mjs'], ['node', 'scripts/dev/clearance.mjs'], ['node', 'scripts/dev/motion-check.mjs'], ['node', 'scripts/dev/view-check.mjs'], ['node', 'scripts/dev/validate.mjs'], ['node', 'scripts/dev/contrast.mjs', '--width', '1440', '--height', '900']];
  const rows = []; for (const g of list) rows.push([g.slice(1, 2).join(' '), run(g, log) ? 'ok' : 'FAILED']);
  if (server) server.kill();
  console.log(rows.map(([n, r]) => `    ${r === 'ok' ? 'ok    ' : 'FAILED'} ${n}`).join('\n')); return rows.every(([, r]) => r === 'ok');
}

if (cmd === 'list') for (const s of ORDER) console.log(`${s.padEnd(9)} ${STAGES[s].desc}${STAGES[s].manual ? '  [manual]' : ''}`);
else if (cmd === 'status') { for (const s of ORDER) console.log(`${s.padEnd(9)} ${state(s).padEnd(8)} ${STAGES[s].desc}`); const w = exampleWarning(); if (w) console.log(`\n${w}`); }
else if (cmd === 'run') {
  const only = opt('only', null), from = opt('from', ORDER[0]), to = opt('to', 'sync');
  const todo = only ? only.split(',') : ORDER.slice(ORDER.indexOf(from), ORDER.indexOf(to) + 1).filter((s) => !STAGES[s].manual || opt('with-fit', false));
  mkdirSync(`${ROOT}/.pipeline/logs`, { recursive: true }); let bad = 0;
  for (const s of todo) {
    const st = STAGES[s]; if (!st) { console.error(`unknown stage ${s}`); process.exit(2); }
    const cur = state(s); if (!only && cur === 'fresh') { console.log(`${s}: fresh, skipped`); continue; }
    const log = createWriteStream(`${ROOT}/.pipeline/logs/${s}.log`); const t0 = Date.now(); process.stdout.write(`${s}: ${st.desc}\n`);
    let ok = true; if (st.gates) ok = await gates(log, st.evidence); else for (const step of st.steps) if (!(ok = run(step, log))) break;
    log.end(); console.log(`${s}: ${ok ? 'done' : 'FAILED (see .pipeline/logs/' + s + '.log)'} in ${((Date.now() - t0) / 1000).toFixed(1)} s`); if (!ok) { bad++; if (!st.gates) break; }
  }
  const w = exampleWarning(); if (w) console.log(`\n${w}`); process.exit(bad ? 1 : 0);
} else { console.log('usage: node scripts/pipeline.mjs list | status | run [--from S] [--to S] [--only a,b] [--quality draft|final] [--port N] [--with-fit]'); process.exit(2); }
