#!/usr/bin/env node
// Environment check for the mascot pipeline: node, python packages, ffmpeg, Chrome, disk, image-API key names (never values).  node doctor.mjs [--json]
import { spawnSync } from 'node:child_process';
import { existsSync, statfsSync } from 'node:fs';
import os from 'node:os';
const rows = []; const add = (area, name, status, detail, fix = '') => rows.push({ area, name, status, detail, fix });
const out = (c, a) => { const r = spawnSync(c, a, { encoding: 'utf8' }); return r.error || r.status ? null : (r.stdout || r.stderr).trim(); };
const major = +process.versions.node.split('.')[0];
add('runtime', 'node', major >= 20 ? 'PASS' : 'FAIL', process.version, 'install node 20 or newer');
add('runtime', 'npm', out('npm', ['-v']) ? 'PASS' : 'FAIL', out('npm', ['-v']) ?? 'not found', 'install npm');
const py = out('python3', ['--version']); add('runtime', 'python3', py ? 'PASS' : 'FAIL', py ?? 'not found', 'install python 3.9+');
for (const m of ['numpy', 'PIL', 'cv2']) { const v = out('python3', ['-c', `import ${m}; print(getattr(${m}, "__version__", "ok"))`]); add('python', m, v ? 'PASS' : 'FAIL', v ?? 'import failed', `pip install ${m === 'PIL' ? 'pillow' : m === 'cv2' ? 'opencv-python' : m}`); }
const sc = out('python3', ['-c', 'import scipy, skimage; print("ok")']); add('python', 'scipy/skimage', 'INFO', sc ? 'import ok' : 'not usable (the tools never import them; numpy 2 breaks old builds)');
for (const [t, req] of [['ffmpeg', true], ['ffprobe', true], ['cwebp', false], ['magick', false]]) { const v = out(t, ['-version']) ?? out(t, ['-h']); add('tools', t, v ? 'PASS' : req ? 'WARN' : 'INFO', v ? v.split('\n')[0].slice(0, 60) : 'not found', req ? `install ${t} (needed for the reel and contact sheets)` : 'optional'); }
const chromes = [process.env.CHROME_PATH, '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser', 'C:/Program Files/Google/Chrome/Application/chrome.exe'].filter(Boolean);
const chrome = chromes.find(existsSync); add('browser', 'Chrome/Chromium', chrome ? 'PASS' : 'FAIL', chrome ?? 'not found', 'install Chrome or set CHROME_PATH (the gates drive it with puppeteer-core)');
add('browser', 'GPU note', 'INFO', process.platform === 'darwin' ? 'macOS: Metal WebGL; plug in for frame-rate gates (Energy Saver caps pages at 30 fps)' : 'non-macOS: headless uses software GL unless a GPU is configured; frame-rate gates are not meaningful');
try { const s = statfsSync('.'); const gb = (s.bavail * s.bsize) / 1e9; add('resources', 'disk free', gb > 5 ? 'PASS' : 'WARN', `${gb.toFixed(0)} GB`, 'free some space (reel and meshes are tens of MB, node_modules 150 MB)'); } catch {}
add('resources', 'cpu / memory', 'INFO', `${os.cpus().length} cores, ${(os.totalmem() / 1e9).toFixed(0)} GB`);
for (const k of ['OPENAI_API_KEY', 'GEMINI_API_KEY', 'GOOGLE_API_KEY', 'FAL_KEY']) add('image generation', k, process.env[k] ? 'PASS' : 'INFO', process.env[k] ? 'set (value not shown)' : 'not set', 'without a key, hand the prompt pack to the user or use a built-in image tool (references/image-generation.md section 4)');
if (process.argv.includes('--json')) console.log(JSON.stringify(rows, null, 1));
else { for (const r of rows) console.log(`${r.status.padEnd(5)} ${r.area.padEnd(16)} ${r.name.padEnd(16)} ${r.detail}${r.status === 'FAIL' || r.status === 'WARN' ? `   -> ${r.fix}` : ''}`); }
process.exit(rows.some((r) => r.status === 'FAIL') ? 1 : 0);
