# Adapting the template to a new character

Purpose: what is generic, what is regenerated from the art by scripts, and what you author by hand when the design changes. Read it before accepting a brief and again before touching code.

## 1. Three kinds of things
| Kind | Examples | What you do |
|---|---|---|
| Generic | the controller, the fabric shader, blink and gaze models, springs, governor, fallbacks, page machinery, gates | nothing |
| Regenerated from the art | silhouette references, seam candidates, nap tiles and pre-emphasis curves, face outlines and the halo, rim and sclera maps (`src/mascot-face-shapes.js`), mesh binaries | run the stage (table below) |
| Authored | the sculpt structure (`scripts/bake/model.mjs`), the skeleton if the body plan differs, poses, props, face construction, page copy and scenes | edit, then run the gates |

| Derived data | Script | Depends on | Hand decisions |
|---|---|---|---|
| `scripts/bake/.refs/*` | `refmasks.py` | registered front, turnaround | none |
| `P` in `model.mjs` | `fit.mjs`, `apply-fit.mjs` | refs | start values, bounds |
| `.seams/*`, `folds` | `extract-seams.py`, `trace-folds.py` | art | pick ids in `seams.mjs`; fold waypoints |
| `assets/mascot-nap-*.png`, `scripts/nap/*-emphasis.json` | `nap/build.py`, `dev/fit-nap-spectrum.py` | registered front | colour rules, exclusion circle |
| `src/mascot-face-shapes.js`, face maps | `dev/fit-face.py`, `calibrate-*.py` | registered front | seed centres, colour thresholds |
| meshes | `bake.mjs` | model, seams, face shapes | none |
| shader look | `dev/tune2.mjs`, `apply-tuned.py` | art at 350, 246, 123 ppu | order of groups, judging crops |

Example-specific constants in the scripts (colour rules for a red body and a dark face, the chest-mark exclusion, feature seed centres, evaluator patches) are listed with their locations in `references/art-analysis.md` section 9; re-measure them for your art.

## 2. Recipes
**(a) Same body plan, new proportions and colours (the easy case).** Register art; `pipeline.mjs run --to refs`; move `P` near the art, widen `SPACE`, fit (`references/sculpt-fit.md`); update the colour rules in `nap/build.py` and the face rules in `fit-face.py`; rebuild nap, face data, bake; tune colours and light; run all gates. Keep the frame, joint names and attribute layout.

**(b) Different ears or tabs, or none.** Edit the `ear` primitive in `model.mjs` (or delete it and its blend), drop the `ears` band weight in `fit.mjs`, adjust `HEAD` region constants in `lab-metrics.js` patches. Joints are unaffected unless ears move.

**(c) No inset face fabric, or another outline.** Set `face` to the new outline (or remove the wall and tuck), and in `src/mascot-fabric.js` the `FABRIC.face` outline, the plate mask and the example-specific shader constants listed in `references/felt-shader.md` section 5.9. A single-fabric face removes the hood-to-plate edge work entirely.

**(d) Extra parts (tail, horns, antenna, hat).** Add an SDF part in `model.mjs`, a mesh part and skin weights in `bake.mjs` and `skeleton.mjs` (new joints), pose keys in `mascot-pose.js`, secondary spring motion in the controller, seams if sewn, and clearance tests. Budget a day per part; cloth-like parts (scarf, cape) are out of scope for this shader: model them as simply animated rigid props.

**(e) Different hands and feet.** Change the `arm.hand` and `leg.foot` primitives; re-measure `arm{L,R}.s` (how far a raised hand must reach to clear the head) and rerun `clearance.mjs`.

**(f) Different state set.** States live in `src/mascot-states.js` (label, title, status, description, duration) and `computePose` in `src/mascot-pose.js`; the workbench, GLB clips and reel iterate the table. Add the state, a pose case, a copy line, then `clearance.mjs`, `motion-check.mjs` and the random-sequence stress.

**(g) Different props.** `src/props/*` plus choreography keys in the pose; model from the vignettes (`references/props.md`).

**(h) Another short-pile fabric** (velvet, minky, bouclé): the pipeline holds; retune per `references/felt-shader.md` section 13. **Long fur or hair**: out of scope; it needs strand or card geometry.

**(i) A quadruped or other body plan**: a new sculpt, skeleton, skinning and pose set. Honest verdict: weeks of work, not configuration; tell the user before art is generated.

## 3. Do not change
The registration frame (move the art into it), joint names used by poses, the binary magic and attribute layout (unless you change writer, reader and shader together), the `lead` mechanism, and the rule that every stored number is in units on the frame.
