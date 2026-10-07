# Plush Mascot Forge

An agent skill that builds a plush, needle-felt or soft-toy 3D mascot that looks like its artwork and runs live in the browser with three.js.

You describe a character (or bring artwork). The skill generates the master art, fits a 3D sculpt to it, renders real felt from fibres taken out of the art, builds a measured face, rigs ten animation states, and checks the result against the art with numeric gates. It ships a scroll page, a validated GLB and a 60 fps motion reel.

Works with Claude Code, Claude skills, and Codex.

## What you get

- **Master art**: hero, registered neutral front, turnaround, vignettes, plus optional pose, expression and macro sheets, at the largest size the image models allow.
- **A runnable project**: fitted sculpt, baked meshes (final and lite), fabric tiles, face kit, poses, props, and a runtime controller with 60 fps pacing and a quality governor.
- **Validation evidence**: gate outputs, side-by-side audits at several yaws and densities, and an honest list of what still differs from the art.
- **Deliverables**: a showcase scroll page, a validated GLB, a 60 fps motion reel, contact sheets, a PNG snapshot and handoff documents.

## Install

Download `plush-mascot-forge.skill` from this repo. It is a zip archive with a `plush-mascot-forge/` folder inside, so unpacking it into your skills folder is all it takes.

**Claude Code**

```bash
mkdir -p ~/.claude/skills
unzip plush-mascot-forge.skill -d ~/.claude/skills
```

**Codex**

```bash
mkdir -p ~/.codex/skills
unzip plush-mascot-forge.skill -d ~/.codex/skills
```

**Claude desktop and web**: upload `plush-mascot-forge.skill` from the Skills section in Settings.

Check the install and your machine:

```bash
node ~/.claude/skills/plush-mascot-forge/scripts/doctor.mjs
```

## Use it

Ask in plain language. The skill triggers on mascot, brand character, app companion, avatar, plush or felt character, or a request to turn character art into a real-time 3D model.

> Make me a plush mascot for my note-taking app. Warm, a little sleepy, wears headphones.

> My mascot looks fake and plastic. Audit it and fix the fabric.

> I already have the art. Turn it into a GLB and a scroll page.

You can also drive the toolchain by hand:

```bash
SK=~/.claude/skills/plush-mascot-forge
node $SK/scripts/scaffold.mjs ./my-mascot --name "Pip" --slug pip --product "Acme" --install
cd my-mascot
node scripts/pipeline.mjs status                      # which stages are fresh
node scripts/pipeline.mjs run --to bake --quality draft   # seconds, proves the toolchain
npm run dev -- --port 4173                            # see it
```

## How it works

| # | Phase | Output |
|---|---|---|
| 0 | Brief | `art/brief.json`, deliverables, budget |
| 1 | Master art | hero, registered front, turnaround, vignettes |
| 2 | Project and reference pack | scaffolded project, canonical art |
| 3 to 5 | Sculpt, construction, bake | fitted signed-distance sculpt, skinned meshes |
| 6 | Fabric | nap tiles extracted from the art, tuned felt shader |
| 7 | Face | eyes, lids, blink, cheeks, mouth, chest mark |
| 8 | Rig, states, props | ten states, props, clearance checks |
| 9 | Runtime | quality tiers, 60 fps governor, fallbacks |
| 10 and 11 | Page and exports | scroll page, GLB, reel, contact sheets |
| 12 | Audit and handoff | validation report, residual differences |

The principles behind it: the art is the specification, the nap comes from the art's own fibres (never procedural noise, never AI upscaling), metrics are guards and not goals, and every edge is audited off-axis because stepped edges and mesh cracks only show when the head turns.

Gates measured on the bundled example: sculpt IoU 0.979 front and 0.960 side, 0 open mesh edges, turn-seam p95 0.16 px, hands and card clear of the head in every state, 11 of 11 motion checks at 60.0 fps, GLB validator with 0 errors and 0 warnings.

## Requirements

- Node 20 or newer, and npm
- Python 3.9 or newer with `numpy`, `pillow` and `opencv-python`
- `ffmpeg` and `ffprobe` for the reel and contact sheets
- Chrome or Chromium (the gates drive it with puppeteer-core). Set `CHROME_PATH` if it is not in a standard location.
- Optional, for image generation: `OPENAI_API_KEY`, `GEMINI_API_KEY` or `GOOGLE_API_KEY`, or `FAL_KEY`. Without a key the skill hands you the prompt pack to run elsewhere. Image calls cost money, so the generator does nothing on the network without `--yes` and supports `--max-usd`.

## Good fit and limits

**Good fit**: a head-dominant character with tube limbs, made of short-pile fabric (felt, micro-suede, velour, minky), optionally with an inset face fabric, ears or tabs, mitten hands and a small chest mark.

**Needs code changes first**: tails, horns, hats, extra limbs and non-biped bodies.

**Out of scope**: long fur, cloth physics, hair, glossy or translucent materials.

Known limits:

- The image generator was tested against a local stub of both APIs and not against the live services. Make the first real call a cheap smoke test (`--size 1024x1024 --quality low`).
- A very different body plan is weeks of work, not configuration.
- Fidelity numbers were measured on one machine (Apple silicon, Chrome, Metal). Other GPUs and browsers were not benchmarked.
- The full fit-to-new-art workflow was exercised on the example character, not on a second one.

## What is inside the skill

| Path | What |
|---|---|
| `SKILL.md` | entry point, pipeline, ground rules, gates |
| `references/` | one guide per phase, plus troubleshooting, edge cases and a lessons log |
| `prompts/` | brief examples and prompt templates for every asset |
| `scripts/` | `scaffold.mjs`, `doctor.mjs`, `smoke.sh`, `lint-skill.mjs` |
| `template/` | the runnable three.js project: controller, fabric, face, rig, props, page, bake and validation scripts |
| `assets/examples/` | reference results of the example mascot |
