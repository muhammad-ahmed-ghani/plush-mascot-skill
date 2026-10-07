# Mascot project: operating manual for agents

This project is a real-time 3D plush mascot (three.js, Vite) built from generated artwork and measured against it. It was scaffolded from the `plush-mascot-skill` skill. Read this file before editing anything; it is short on purpose and every rule here prevented a real, expensive mistake.

## What is where

| Path | What |
|---|---|
| `mascot.config.json` | single source of truth: character name, palette, registration frame, art paths, segmentation, nap, page |
| `art/` | `masters/` untouched originals (never edit), `candidates/`, `prompts/`, `work/` derived copies, `brief.json` |
| `assets/` | canonical art (registered on the frame), derived tiles, meshes, fonts, GLB, reel |
| `src/` | controller (`mascot.js`), fabric shader (`mascot-fabric.js`), face (`mascot-face.js`, `face/`), poses (`mascot-pose.js`), rig, props, page (`app.js`, `page/`) |
| `scripts/bake/` | sculpt, fit, seams, mesher, bake |
| `scripts/nap/` | fabric nap extraction |
| `scripts/dev/` | gates, tuners, capture tools |
| `scripts/tools/` | image generation, art QA, cut-out extraction, normalisation, crop comparison |
| `scripts/pipeline.mjs` | runs the stages in order, resumable |
| `tests/` | evidence and `VALIDATION.md` |
| `.pipeline/` | stage state and logs |

## Commands

```bash
node scripts/pipeline.mjs status                    # what is fresh or stale; warns while the example mascot's art is still in use
node scripts/pipeline.mjs run --to bake --quality draft   # seconds; use while iterating
node scripts/pipeline.mjs run --quality final       # release quality
npm run dev -- --port 4173                          # the page (set MASCOT_ORIGIN for the gates)
node scripts/pipeline.mjs run --only verify         # every gate, in order
```

## Rules that prevent expensive mistakes

1. **The art is the specification.** Do not tune around a flaw in the art; fix the art (regenerate or edit one thing) and re-run from the `art` stage. Originals in `art/masters/` are never edited.
2. **Never edit `src/` while a tuner or a gate is running.** Vite reloads the page and the run dies ("Execution context was destroyed").
3. **After regenerating anything in `assets/`, run `node scripts/sync-public.mjs`.** The dev server serves `public/` before the project root; a stale copy hides your change.
4. **Metrics are guards, not goals.** Judge by side-by-side crops of the same window at 5 to 8x, at several yaws, pitches and display densities (1x and 2x). Front-on audits cannot show seam teeth or cracks.
5. **Keep the sculpt's edge profile continuous and the mesh watertight.** A step in the field becomes a staircase; open edges become white specks. `node scripts/bake/check-mesh.mjs` must report 0 open edges.
6. **Shader patches: fetch before branch, mind `#include`, add defines to the cache key.** See `references/felt-shader.md` of the skill, section "Shader traps".
7. **Judge motion in stepped 60 fps filmstrips and with `clearance.mjs`.** Hands must stay at least 0.04 units from the head.
8. **Measure frame rate only on a quiet machine on mains power.** A low battery caps every page at 30 fps.
9. **Do not ship the example mascot.** `status` warns while its art files are in place.
10. **One owner per file, one port per agent, three-way merges with a pristine base** when agents work in parallel.
11. **Never spend on image generation without the user's go-ahead.** `scripts/tools/imagegen.py` does nothing on the network without `--yes`; use `--dry-run` first.
12. **Report honestly.** Residual differences from the art, what was not tested, decisions left to the user.

## Where to read more

The skill that created this project documents every phase, gate and trap: workflow, image generation, art analysis, sculpt, bake, felt shader, face kit, rig, props, runtime, validation, page, exports, troubleshooting. If the skill is not installed, `README.md` and `HANDOFF.md` in this folder describe the behaviour and the pipeline.
