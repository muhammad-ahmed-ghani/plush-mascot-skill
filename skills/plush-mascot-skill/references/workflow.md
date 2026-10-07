# Workflow: phases 0 to 12

Purpose: the master procedure from a vague request to a validated, handed-off mascot. SKILL.md has the short version; this file has the entry and exit criteria, commands, artifacts and decisions of every phase. Read the phase you are in; skim the rest once so you know what the early phases must leave behind.

## Contents

- How the phases fit together (dependencies, lanes, invalidation)
- Phase 0 Intake and brief
- Phase 1 Master art
- Phase 2 Project, registration, reference pack
- Phase 3 Sculpt
- Phase 4 Construction detail
- Phase 5 Bake
- Phase 6 Fabric
- Phase 7 Face
- Phase 8 Rig, states, props
- Phase 9 Runtime hardening
- Phase 10 Showcase page
- Phase 11 Exports and evidence
- Phase 12 Independent audit and handoff
- Decisions that belong to the user
- Stopping rules

## How the phases fit together

```
0 brief -> 1 art -> 2 project+registration -> 3 sculpt -> 4 construction -> 5 bake -+-> 6 fabric ---+
                                                                                   +-> 7 face  ----+-> 9 runtime -> 10 page -> 11 exports -> 12 audit
                                                                                   +-> 8 rig/props +
```

- Phases 0 to 5 are a line. After a draft bake exists (phase 5, seconds to run) the fabric (6), face (7) and rig/props (8) lanes are independent of each other and can be given to separate agents working in isolated copies (`references/agent-operations.md`).
- The art is the root of everything. Changing a master after phase 2 invalidates what was derived from it:

  | If this changes | Re-run |
  |---|---|
  | registered front (silhouette) | `art` -> `refs` -> `fit` -> `bake`, then fabric and face checks |
  | registered front (fabric or colour only) | `nap` -> `face` colour calibration -> tuner |
  | profile or turnaround | `refs` -> `fit` -> `bake` |
  | face features (eyes, mouth, cheeks) | `face` stage, face-shape file, halo/rim/sclera maps |
  | vignettes | props only |
  | hero | nothing in code; re-run identity checks of every derived image |

- Every phase ends with a **gate**: commands whose output you paste into the project's validation notes. A phase is not done because the code runs, but because the gate shows the number and you have looked at the picture.
- `node scripts/pipeline.mjs status` tells you which derived files are fresh or stale and warns when the project still contains the example mascot's art.

## Phase 0 Intake and brief

Goal: a written brief that every later phase obeys.

1. Ask the user only what you cannot decide: the character idea (or permission to invent it), the product it serves, three adjectives of personality, colours if fixed, must-have and must-avoid features, where it will be seen (web hero, app chip, both), deliverables wanted (live 3D, page, GLB, reel), image-model access and budget, and any brand or legal constraints. If the user supplied art, skip to phase 2 with that art and run the art QA honestly (it may fail).
2. Write `art/brief.json` (fields and craft in `references/character-brief.md`; starter in `prompts/brief.example.json`) and a short `art/brief.md` with the reasoning.
3. Run the fit check in `references/character-brief.md`: does this body plan fit the pipeline? If it needs code changes, list them now (`references/adapting-to-a-new-character.md`) and tell the user the cost before art is generated.
4. Agree the deliverables and the performance targets (tiers, minimum device) in writing.

Exit: brief approved by the user; budget agreed; deliverables list.

## Phase 1 Master art

Goal: the masters of `references/image-generation.md`: hero, registered front (clean cut-out), turnaround, vignettes, optional sheets and macros, at the highest stable resolution, locked and recorded.

1. Tool discovery and consent (image-generation.md section 4). `python3 scripts/tools/doctor` equivalents: `node scripts/doctor.mjs` from the skill.
2. Render prompts: `python3 template/scripts/tools/render_prompts.py --brief art/brief.json --all --model both --out art/prompts`.
3. Explore (optional), hero tournament, registered front, turnaround, vignettes, extras. Keep candidates in `art/candidates/`, winners untouched in `art/masters/` with metadata JSON.
4. Gate: `python3 template/scripts/tools/art_qa.py art/masters --kind auto --report art/qa.json --strict` passes for the registered front and turnaround; fresh-reviewer critique (`prompts/qa-critique.md`) has no blocker; the user has approved the hero.

Exit: `art/masters/*` + `art/qa.json` + `GENERATION-PROMPTS.md` entries.

## Phase 2 Project, registration, reference pack

Goal: a runnable project whose canonical art is the new character's.

1. Scaffold: `node scripts/scaffold.mjs <dir> --name "<Name>" --slug <slug> --product "<Product>" --link-node-modules <path or omit for npm ci>`. The scaffold copies the template with the example mascot still in place so the page runs from minute one. Do not ship that: `pipeline.mjs status` warns while example art remains.
2. Register the art: `python3 scripts/tools/normalize_art.py --in art/masters/front.png --out assets/<slug>-transparent.png --hires-out art/work/front@2x.png --write-config` and, for the sheet, `--turnaround`. Files and names follow `mascot.config.json` (`art.*`); update it if you rename. Full procedure and edge cases: `references/art-analysis.md`.
3. Put the hero, turnaround and vignettes at their `art.*` paths; produce the 768 and 1536 px WebP copies the page uses (`cwebp` or Pillow).
4. Reference pack: `node scripts/pipeline.mjs run --only refs` (silhouettes at three scales; scaled references at 350, 246 and 123 px per unit for the audits).
5. Measure the art before building (proportions, feature positions in units, palette, luminance percentiles): the list is in `references/art-analysis.md`.
6. Decide what must be hand-authored (sculpt structure if the body plan differs, poses, props) using `references/adapting-to-a-new-character.md`.

Gate: `node scripts/pipeline.mjs status` shows `art` and `refs` fresh; the figure sits on the canonical frame (`normalize_art.py` prints axis, feet and top rows; the config `frame.topY` is written).

## Phase 3 Sculpt

Goal: a signed-distance model whose front and side silhouettes match the art. Details: `references/sculpt-fit.md`.

1. Author or adjust `scripts/bake/model.mjs` (parameters and, if needed, structure) so that its starting values are near the art (use `preview.mjs` to look at it).
2. Fit: `node scripts/bake/fit.mjs --refs scripts/bake/.refs --size 418` then `node scripts/bake/apply-fit.mjs`; re-run at 627 to polish.
3. Score: `node scripts/bake/score.mjs`.

Gate (example mascot values in brackets; yours should be similar when the art is clean): front IoU >= 0.96 (0.970 to 0.979), side IoU >= 0.95 (0.960), no band below 0.93 (example worst: legs side 0.934). A band below threshold means the structure cannot express that part; fix the model, not the optimiser.

## Phase 4 Construction detail

Goal: the seams, folds and the rolled edge between fabrics that make it read as sewn. Details: `references/sculpt-fit.md` (folds, seams) and `references/mesh-bake.md` (refinement).

1. `python3 scripts/bake/extract-seams.py` and `trace-folds.py`; open the `.seams/preview_*.png` overlays and pick seams by id in `scripts/bake/seams.mjs`.
2. Check the hood/face-fabric wall is continuous (no step in the field) and that refinement is enabled for the `final` tier.
3. Bake draft and look (`preview.mjs`, or the page).

Gate: visual check at yaw 0, +-0.5, +-0.9 against the art; seams are where the art has them.

## Phase 5 Bake

1. `node scripts/pipeline.mjs run --only bake --quality draft` while iterating (seconds); `final` and `lite` for release.
2. `node scripts/bake/check-mesh.mjs`; then `node scripts/sync-public.mjs` (the dev server serves `public/` before the project root, so a stale copy there hides your change).

Gate: 0 open edges on every part, 0 degenerate triangles; non-manifold edges are tolerated (example: 2 on the head); triangle counts in the expected range for the tier (`references/mesh-bake.md`).

## Phase 6 Fabric

Goal: fibres, sheen, light and seams that match the art at 350, 246 and 123 px per unit. Details: `references/felt-shader.md`.

1. Nap tiles: `python3 scripts/nap/build.py` (deterministic), then the pre-emphasis fit: `python3 scripts/dev/fit-nap-spectrum.py --tile body` and `--tile face`.
2. Start the dev server, generate scaled references (`python3 scripts/dev/scaled-ref.py --ppus 350,246,123 --size 1000 --out scripts/dev/.refs`), run `node scripts/dev/eval.mjs --ppus 350,246,123`.
3. Tune in groups, starting from live values: `node scripts/dev/tune2.mjs --ppus 350,246,123 --live --only tex --out tuned.json`, then `python3 scripts/dev/apply-tuned.py tuned.json`; one group at a time (`tex`, `seam`, `light`, `edge`, `cord`). Never edit `src/` while a tuner runs.
4. Turn the head and look (phase 12 protocol), not only at metrics.

Gate: `eval.mjs` within the tolerances in `references/validation-gates.md`; `node scripts/dev/turn-check.mjs` passes; side-by-side crops at 5 to 8x of every edge and feature show the same character of fibre as the art.

## Phase 7 Face

Goal: eyes, lids, blinks, cheeks, mouth and chest mark measured from the art. Details: `references/face-kit.md`.

1. `python3 scripts/dev/fit-face.py` (feature outlines and the halo, rim and shade maps), then `calibrate-features.py` and `calibrate-sclera.py` for colours.
2. Verify features in `eval.mjs` (IoU and centroid), then judge blink frames in a stepped filmstrip.

Gate: feature IoU >= 0.95 (eyes 0.989 and 0.977, cheeks 0.963 and 0.956, mouth 0.913 in the example; below 0.9 is a defect), centroids within 0.01 units; blink timing 80/35/190 ms; no lid shadow discontinuity.

## Phase 8 Rig, states, props

Goal: ten states that read at a glance, hands that never merge into the head, props modelled from the vignettes. Details: `references/rig-and-animation.md`, `references/props.md`.

1. Keep joint names; retune pose targets to the new proportions; set arm stretch where hands must clear the head.
2. Props from the vignettes (headphones, laptop, card, confetti or your own).
3. Gates: `node scripts/dev/clearance.mjs` (>= 0.04 everywhere), `node scripts/dev/motion-check.mjs`, filmstrips at 60 fps of every transition (enter and leave working, hello, approval, success), random-sequence stress (no non-finite values, no jumps).

## Phase 9 Runtime hardening

Details: `references/runtime-and-performance.md`. Confirm tiers (high, medium, low) load, the governor ladder works, programs are precompiled, fallback and context loss behave, pacing is 60 fps on a healthy GPU. Gate: `motion-check.mjs` (judge against a blank page's rate if the browser is throttled), `view-check.mjs` (poster alignment within 6 px).

## Phase 10 Showcase page

Details: `references/showcase-page.md`. Rewrite `src/page/copy.js` and the palette in the character's voice; keep hooks. Gates: `node scripts/dev/validate.mjs`, `node scripts/dev/contrast.mjs`, phone and desktop inspection, reduced motion, no-WebGL.

## Phase 11 Exports and evidence

Details: `references/exports-and-handoff.md`. `node scripts/pipeline.mjs run --only evidence` (state stills, runtime snapshot, GLB + validator, 60 fps reel, contact sheets). Gate: glTF validator 0 errors, 0 warnings; reel is 60 fps; contact sheets inspected.

## Phase 12 Independent audit and handoff

1. Fresh-eyes audit: give a new agent only the art, the running page and the rubric (`references/validation-gates.md`, "independent auditor"). It returns a defect list with crops. Fix blockers and majors; re-audit once.
2. Fill in `tests/VALIDATION.md` from the template with your numbers, the residual differences (honest, ordered by visibility) and what was not tested (other GPUs, host integration).
3. Write `HANDOFF.md`, `README.md`, `GENERATION-PROMPTS.md`; `npm run build`; `npm audit`.
4. Report to the user: what exists, where, the numbers, the residual differences, the decisions that were theirs.

Exit: definition of done in SKILL.md is ticked.

## Decisions that belong to the user

The design (which hero), the budget, the name, the colours, whether residual differences are acceptable, licensing and disclosure of generated art, and any claim about production readiness. Everything else is yours to decide and record.

## Stopping rules

- Stop tuning a group when its metric is within tolerance AND the crops look right; a tuner can keep improving a number while making the image worse.
- Cap audit rounds at three; after that, list what remains as known differences.
- If a target cannot be reached with this pipeline (long fur, cloth physics), say so early with evidence instead of spending days; `references/adapting-to-a-new-character.md` lists what is out of scope.
