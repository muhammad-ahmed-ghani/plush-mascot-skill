---
name: plush-mascot-skill
description: Create a world-class, art-faithful 3D plush, needle-felt or soft-toy mascot that runs live in the browser (three.js) and ships as a demo website (scroll page), animated GLB 3D files and a motion reel. Generates the master artwork with the best image models (GPT Image 2.5, Nano Banana Pro) at maximum resolution, then fits a signed-distance sculpt to it, bakes a skinned mesh, renders real felt from nap fibres extracted out of the art, builds a measured face (eyes, blinks, mouth), rigs ten states and props, and validates against the art with numeric gates. Use whenever the user wants a mascot, brand character, app companion, avatar, plush or felt character, a 3D character for a site or app, character art or turnarounds, an audit or redo of a mascot that looks fake or plastic, or wants mascot artwork turned into a real-time 3D model, even if they never say plush, three.js or SDF.
---

# Plush Mascot Skill

A complete, validated pipeline and a runnable template project for building a plush mascot that looks like the artwork it came from: generated art at the highest resolution the image models offer, a fitted sculpt, a fabric shader built from the art's own fibres, a face made of construction instead of texture, a rig with states and props, and gates that measure the result against the art. Everything below was earned by taking one character from "fake, plastic" to a validated, art-faithful result; the traps are documented so you do not repeat them.

## What you deliver

1. Master art (hero, registered neutral front, turnaround, vignettes, optional pose, expression and macro sheets), full resolution, locked, with prompts and metadata.
2. A project (`template/`, scaffolded) with the fitted sculpt, baked meshes (final and lite), fabric tiles, face kit, poses, props, runtime controller (60 fps pacing, quality governor, fallbacks).
3. Validation evidence: gate outputs, side-by-side audits at several yaws and densities, an honest list of residual differences.
4. Showcase page, GLB (validated), 60 fps motion reel, contact sheets, PNG snapshot, handoff documents.

## Is this the right tool?

Good fit: a head-dominant, limb-as-tube character made of short-pile fabric (felt, micro-suede, velour, minky), optionally with an inset face fabric, ears or tabs, mitten hands, a small chest mark. Needs code changes (list them first, see `references/adapting-to-a-new-character.md`): tails, horns, hats, extra limbs, non-biped bodies. Out of scope for the shader: long fur, cloth physics, hair, glossy or translucent materials. Say so to the user before art is generated.

## Choose your entry point

| Situation | Start at | Read |
|---|---|---|
| Idea only, nothing exists | Phase 0 | `references/character-brief.md`, then `references/workflow.md` |
| Only the art is needed | Phase 1 | `references/image-generation.md`, `prompts/README.md` |
| Art exists (any source) | Art QA, then Phase 2 | `references/art-analysis.md` |
| An existing mascot "looks fake / plastic / grainy" | Audit first | `references/validation-gates.md` (fidelity audit), `references/troubleshooting.md`, `references/design-language-plush.md` |
| Changing the design of the template character | Adapt | `references/adapting-to-a-new-character.md` |
| Only a page, GLB or reel for an existing controller | Phases 10 and 11 | `references/showcase-page.md`, `references/exports-and-handoff.md` |
| A specific failure | Symptom index | `references/troubleshooting.md`, `references/edge-cases.md` |

## The pipeline

| # | Phase | Output | Gate (example-mascot values) | Reference |
|---|---|---|---|---|
| 0 | Brief | `art/brief.json`, deliverables, budget | user approves | `references/character-brief.md` |
| 1 | Master art | `art/masters/*` + metadata | `art_qa.py` passes; fresh reviewer has no blocker | `references/image-generation.md` |
| 2 | Project, registration, reference pack | scaffolded project, canonical art, `.refs` | figure on the frame; `pipeline status` fresh | `references/art-analysis.md` |
| 3 | Sculpt | fitted `model.mjs` | front IoU >= 0.96, side >= 0.95 | `references/sculpt-fit.md` |
| 4 | Construction | seams, folds, rolled edge | seams where the art has them | `references/sculpt-fit.md` |
| 5 | Bake | `mesh.bin` final and lite | 0 open edges; byte-identical rebake | `references/mesh-bake.md` |
| 6 | Fabric | nap tiles, pre-emphasis, tuned shader | `eval.mjs` within tolerance; `turn-check.mjs` | `references/felt-shader.md` |
| 7 | Face | eyes, lids, blink, cheeks, mouth, mark | feature IoU >= 0.95; blink 80/35/190 ms | `references/face-kit.md` |
| 8 | Rig, states, props | poses, props, `lead` | `clearance.mjs` >= 0.04; motion checks | `references/rig-and-animation.md`, `references/props.md` |
| 9 | Runtime | tiers, governor, fallbacks | 60 fps on a healthy GPU | `references/runtime-and-performance.md` |
| 10 | Page | scroll story | `validate.mjs`, `contrast.mjs` pass | `references/showcase-page.md` |
| 11 | Exports | GLB, reel, sheets, snapshot | validator 0 errors, 0 warnings | `references/exports-and-handoff.md` |
| 12 | Audit and handoff | VALIDATION, HANDOFF, report | independent auditor finds no blocker | `references/validation-gates.md` |

Phases 6, 7 and 8 are independent once a draft bake exists: give them to separate agents in isolated copies (`references/agent-operations.md`). Full procedure per phase: `references/workflow.md`.

## Quick start

```bash
SK=~/.claude/skills/plush-mascot-skill
node $SK/scripts/doctor.mjs                                   # environment: node, python deps, ffmpeg, Chrome/WebGL, API key names
python3 $SK/template/scripts/tools/imagegen.py sizes --provider openai --aspect 1:1 --tier max     # 2880x2880
node $SK/scripts/scaffold.mjs ./my-mascot --name "Pip" --slug pip --product "Acme" --install       # runnable project (example art inside)
cd my-mascot && node scripts/pipeline.mjs status              # which stages are fresh; warns while example art remains
node scripts/pipeline.mjs run --to bake --quality draft       # seconds: proves the toolchain
npm run dev -- --port 4173                                    # see it
```

Art first (phase 1): copy `prompts/brief.example.json`, fill it in, render the prompt pack with `render_prompts.py`, generate with `imagegen.py` (dry-run first), check with `art_qa.py`.

## Ground rules and why

1. **The art is the specification.** The sculpt, the fibres, the face, the light and every gate are fitted to and compared with the art. Fix art problems in the art; a tuner cannot close a gap the picture created.
2. **Generate at the largest stable size and keep the originals untouched.** Extra pixels give the fit a clean silhouette and the nap extractor crisp filaments. Never AI-upscale fabric: it invents fibres that get baked into the product. Models silently return smaller images; check the size you received.
3. **The registered neutral front is the geometric truth; the hero is the beauty shot.** Strict symmetry, level camera, arm gap, visible soles, even light, clean cut-out. Everything else is generated with it attached.
4. **Measure, then look.** Metrics are guards, not goals: a tuner can raise a number while the image gets worse. The owner's real complaints were only visible in side-by-side crops at 5 to 8x. Judge every edge and feature at several yaws, pitches, rolls and at 1x and 2x display density.
5. **Audit off-axis.** Stepped edges (a cliff in the field), cracks in the mesh and aliasing in fine cords appear only when the head turns or the figure is small. A front-on audit cannot find them.
6. **Keep the field continuous and the mesh watertight.** A step in the signed-distance field is meshed as a staircase and the colour boundary zig-zags when the head turns; dropped triangles leave white specks. Edge profiles are C1; winding comes from grid topology.
7. **The nap comes from the art.** Procedural noise never matched thin curled filaments. Extract from flat regions at the art's scale, quilt to a tile, then fit a pre-emphasis because texture fetches blur the finest filaments into clouds.
8. **Shader traps are silent.** Fetch textures before any branch or `discard`; `onBeforeCompile` sees unresolved `#include` lines; put every define into `customProgramCacheKey`; fade sub-pixel detail by its own screen-space frequency.
9. **Judge motion in stepped 60 fps filmstrips and with the clearance gate**, not by watching one playback. Hands merging into the head, a flat closed laptop slab and an abrupt stand-up all passed "it looks fine" until frame-stepped.
10. **Determinism is a feature.** Seeded nap quilting, blinks and bakes give byte-identical outputs; a rebake that changes bytes is a regression signal.
11. **Never ship the example mascot.** The template contains one; `pipeline.mjs status` warns while its art is still present.
12. **Isolate parallel work.** One copy, one port, one owner per file; pristine base and three-way merge. Never edit `src/` while a tuner runs.
13. **Ask before spending; dry-run first.** Image calls cost money and minutes. `imagegen.py` does nothing on the network without `--yes` and supports `--max-usd`.
14. **Report honestly.** Residual differences from the art, what was not tested (other GPUs, host integration), and decisions left to the user.

## Phase instructions in brief

**0 Brief.** Interview only for what you cannot decide. Write `art/brief.json` (fields: `references/character-brief.md`); fit-check the body plan; agree deliverables and budget.

**1 Art.** Find a model (`references/image-generation.md` section 4: built-in tool, connected runner, API keys, installed skill, the user). Render prompts; explore at the safe size; hero tournament across models; registered front, turnaround, profile, vignettes; optional pose, expression, macro sheets. Cut-outs: native alpha if the model supports it, otherwise flat key colour + `alpha_extract.py`. Lock the hero.

**2 Project.** Scaffold, register the front on the canonical frame (`normalize_art.py`), build the reference pack (`pipeline.mjs run --only refs`), measure the art (proportions, feature positions, palette, luminance percentiles).

**3 to 5 Geometry.** Author or adjust `scripts/bake/model.mjs`, fit to the front and profile silhouettes, pick seams and folds, bake draft while iterating and final and lite to release, `check-mesh.mjs`, `sync-public.mjs`.

**6 Fabric.** `nap/build.py`, `fit-nap-spectrum.py`, scaled references, `eval.mjs`, tuner groups one at a time from live values, turn the head and compare crops.

**7 Face.** `fit-face.py`, calibrations, eyes with stencil clip and lids, blink model, cheeks, cord mouth and chest mark, expressions per state.

**8 Motion.** Retune poses to the new proportions, arm stretch where hands must clear the head, the seated work pose, props from the vignettes, `lead` for graceful exits, clearance and motion gates, filmstrips.

**9 to 11 Shipping.** Tiers, governor, precompile; page copy in the character's voice; GLB with validator; reel; contact sheets.

**12 Audit.** A fresh agent with only the art, the page and the rubric; fix blockers; write VALIDATION with your numbers and the residual differences.

## Key gates (details and failure remedies in `references/validation-gates.md`)

| Gate | Command | Pass | Example mascot |
|---|---|---|---|
| Art | `art_qa.py <file> --kind transparent --strict` | no fail | calibrated on example art |
| Sculpt | `node scripts/bake/score.mjs` | front IoU >= 0.96, side >= 0.95 | 0.979, 0.960 |
| Mesh | `node scripts/bake/check-mesh.mjs` | 0 open edges, 0 degenerate | head 0 / 2 non-manifold |
| Fidelity | `node scripts/dev/eval.mjs --ppus 350,246,123` | luminance percentiles within ~3 levels; fibre band energy 0.9 to 1.3; seam profile mean diff <= ~6 levels | 5.3 levels |
| Turn seam | `node scripts/dev/turn-check.mjs` | at 2x, yaw +-0.5: p95 <= 0.8 px and specks <= 12 (aim for p95 <= 0.2 px) | mean 0.07, p95 0.16 px, 0 and 7 specks |
| Clearance | `node scripts/dev/clearance.mjs` | hands and card >= 0.04 from head, all states | min 0.067 |
| Motion | `node scripts/dev/motion-check.mjs` | 11 checks: paced at the display rate, no long frames, graceful exit from working, `lead`, poke | 11 of 11, 60.0 fps |
| Poster | `node scripts/dev/view-check.mjs` | within 6 px | 5 px |
| Page | `node scripts/dev/validate.mjs`, `contrast.mjs` | all pass; 4.5:1 text | 106 checks |
| GLB | `node scripts/dev/glb-check.mjs` + validator | 0 errors, 0 warnings | pass |

## Definition of done

- [ ] Brief approved; budget respected; every master has metadata; the hero is locked.
- [ ] `art_qa.py --strict` passes on the registered art; a fresh reviewer found no blocker.
- [ ] Sculpt, mesh, fabric, face, motion, runtime and page gates pass; numbers recorded in `tests/VALIDATION.md`.
- [ ] Side-by-side crops at 5 to 8x of every edge and feature at yaw 0, +-0.5, +-0.9, +-1.5 and at 1x and 2x density were looked at by a person or a fresh agent.
- [ ] Stepped 60 fps filmstrips of every transition were reviewed.
- [ ] `pipeline.mjs status` reports no example art; `npm run build` and `npm audit` are clean.
- [ ] GLB validated; reel at 60 fps; README, HANDOFF, GENERATION-PROMPTS written for this character.
- [ ] The report lists residual differences, untested conditions and the user's decisions.

## Files in this skill

| Path | What |
|---|---|
| `references/` | workflow, character brief, image generation, art analysis, design language, sculpt, mesh, adapting, fabric, face, rig, props, runtime, validation, page, exports, troubleshooting, edge cases, lessons, agent operations, tools catalog |
| `prompts/` | brief schema examples, partials, templates for every asset, edit prompts, critique prompt |
| `scripts/` | `scaffold.mjs` (create a project), `doctor.mjs` (environment), `smoke.sh` (scaffold, bootstrap, build, headless load), `lint-skill.mjs` |
| `template/` | the runnable project: `src/` (controller, fabric, face, rig, props, page), `scripts/` (bake, nap, dev, tools, pipeline), example art |
| `assets/examples/` | reference results of the example mascot: contact sheet, art-QA report, validation report, rendered prompt packs |
| `assets/references/muse/` | inspiration screenshots and status clips of a plush agent companion in a product (see its README) |
| `evals/` | test prompts used to check this skill |

Read `references/tools-catalog.md` for every script's purpose and flags; `references/lessons-log.md` if you want the story of how the problems were found.

## Known limits (state them to the user)

- `imagegen.py` was tested against a local stub of both APIs, never against the live services (no keys were available): make the first real call a cheap smoke test (`--size 1024x1024 --quality low`).
- The sculpt structure, the seam picks and the example's colour rules (red body, dark face, chest mark, feature seed centres) live in the scripts; `references/art-analysis.md` section 9 and `references/adapting-to-a-new-character.md` list every constant to re-measure. A very different body plan is weeks of work, not configuration.
- Fidelity numbers were measured on one machine (Apple silicon, Chrome, Metal); other GPUs and browsers were not benchmarked.
- The template was verified end to end by `scripts/smoke.sh` (scaffold, bootstrap, build, headless load, no console errors) and `template/scripts/tools/selftest.py`; the full fit-to-new-art workflow was exercised on the example character, not on a second character.
