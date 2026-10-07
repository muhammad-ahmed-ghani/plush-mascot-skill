// Copies assets/ and the documentation into public/ (the dev server serves public/ before the project root; the build copies it to dist/).
import { cp, mkdir, copyFile, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
await rm('public/assets', { recursive: true, force: true });      // (cp only adds files: one deleted from assets/ would otherwise stay in public/ and keep being served)
await mkdir('public/assets', { recursive: true });
await cp('assets', 'public/assets', { recursive: true });
for (const file of ['README.md', 'HANDOFF.md', 'GENERATION-PROMPTS.md']) if (existsSync(file)) await copyFile(file, `public/${file}`);
