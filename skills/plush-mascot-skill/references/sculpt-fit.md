# Sculpt and fit: from silhouettes to a signed-distance model

Purpose: turn the registered art's silhouettes into a parametric signed-distance (SDF) sculpt, with seams and folds, ready to bake. Read it in phases 3 and 4, and whenever a silhouette band scores low or the face-plate edge shows teeth when the head turns.

## Contents
1. Coordinates and units
2. The toolkit and the model
3. Why the edge profile must be continuous
4. The fit
5. Reading the score
6. Folds and seams
7. Recipe for a new sculpt
8. Traps

## 1. Coordinates and units
Y up, feet on y = 0, +z toward the viewer, +x to the viewer's right; the example character is about 3.3 units tall (`(frame.feetY - frame.topY) / frame.ppu`). The registered front maps to this system through the frame in `mascot.config.json` (axis column to x = 0, feet row to y = 0, 350 px per unit). Every parameter below is in units, so a model fitted to one registered image can be compared with another.

## 2. The toolkit and the model
`scripts/bake/sdf.mjs` provides the primitives: `sdEllipsoid`, `sdRoundBox`, `sdRoundCone`, `sdCapsule`, `sdSuperEllipse2`, `sdSuperEllipsoid` (squareness exponent: 2 is an ellipse, larger is squarer), smooth min/max `smin` / `smax` (blend radius in units: bigger merges parts into one soft body), `noise3`. `scripts/bake/model.mjs` composes them from the parameter object `P`:

| Group | Parameters (example values in the file) | Constrained by |
|---|---|---|
| `head` | centre height `cy`, half extents `hw hh hd`, squareness `n` (front view), depth exponents `m mF`, `taperX taperZ`, `jowl`, depth offset `cz` | front width and height, profile depth |
| `face` (the inset face fabric's outline on the head surface) | centre `cx cy`, half axes `a b`, exponents `nTop nBot`, `hem hemW plateW tuck tuckW wallW` | the plate outline in the art; profile apex |
| `ear` (tabs) | position `x y z`, half extents `hx hy hz`, corner radius `r`, `tilt`, `blend` | top corners of the silhouette |
| `torso` | `belly` and `chest` ellipsoids (`c` centre, `r` radii), `blend` | mid-body width profile |
| `leg` | `hip hipR ankle ankleR`, `foot` (`c r yaw`), `arch` (`w h`, the gap between the legs), `blend gap` | lower silhouette |
| `arm` | `shoulder elbow hand` positions and radii | lateral protrusions in the neutral pose |

Structure (which primitives, how they blend) is authored by hand; the numbers are fitted. A different body plan means editing `model.mjs` (`references/adapting-to-a-new-character.md`).

## 3. Why the edge profile must be continuous
Where the padded hood meets the face fabric, the hood rolls over a narrow crevice and the plate tucks under it. If that is modelled as a step in the field, the mesher (grid cell 0.021 units) cuts it as a staircase, and the colour boundary, which crosses the staircase, zig-zags as soon as the head turns: teeth and white specks along the whole seam. A front-on audit cannot show it. The rule: no step, no kink. `face.wallW` is the width of a smooth wall (0.04 units, 0.016 deep in the example) that drops the hood to the plate with a continuous slope, and the bake splits triangles near the outline once more (`references/mesh-bake.md`). Any new sharp feature in the field (a tuck, a lip, a notch) needs the same treatment: make it a smooth ramp wider than two grid cells, then check with `turn-check.mjs`.

## 4. The fit
```bash
python3 scripts/bake/refmasks.py                                   # silhouettes at 209, 418, 627 px (art + turnaround profile)
node scripts/bake/fit.mjs --refs scripts/bake/.refs --size 209     # coarse
node scripts/bake/fit.mjs --refs scripts/bake/.refs --size 418 --iters 12
node scripts/bake/apply-fit.mjs                                    # writes the result into P in model.mjs
node scripts/bake/score.mjs                                        # front/side IoU and per band
```
`fit.mjs` is a parallel coordinate descent (all cores): for each parameter it tries steps up and down inside the bounds of the `SPACE` table at the top of the file and keeps what improves a weighted sum of silhouette IoU and boundary-band agreement (front 1.0, side 1.5, band 0.6, extra weight on the legs). The front target is the art's silhouette made mirror-symmetric by averaging signed distances (an intersection would shrink it by half the asymmetry); the side target is the middle figure of the turnaround. The band term matters: area-only IoU let the first fit round the tab ears into spheres at 0.976.

Starting values come from `P` in `model.mjs`, bounds from `SPACE`; both are the example character's. For different proportions, first move `P` close to the art using the widths and feature positions measured in `references/art-analysis.md` section 8 (`preview.mjs` shows the sculpt without a browser: `node scripts/bake/preview.mjs --view front --size 627 --out /tmp/front.png`), and widen `SPACE` for any parameter that ends pinned at a bound. A pinned parameter means the structure cannot express that part or the start was too far away.

## 5. Reading the score
`score.mjs` prints front and side IoU at 627 px and per height band (ears 2.55 to 3.4, head 1.6 to 2.55, body 0.6 to 1.6, legs 0 to 0.6).

| Metric | Pass | Example mascot |
|---|---|---|
| front IoU (symmetrised target) | >= 0.96 | 0.9785 (about 0.970 against the raw art) |
| side IoU | >= 0.95 | 0.9598 (legs band 0.934) |
| any band | >= 0.93 | worst 0.934 |

A side score plateau around 0.95 to 0.96 with a model that looks right is the turnaround's inconsistency (an AI-drawn sheet is not a projection of one object), not the model's error. Below 0.93, or a profile that is really three-quarter view: generate a registered profile (`prompts/03b-profile-registered.md`).

## 6. Folds and seams
Seams are the thin dark lines where fabric pieces were sewn; folds are broad soft creases. `python3 scripts/bake/extract-seams.py` finds candidate seams in the art by a ridge filter and writes numbered candidates plus preview overlays with a unit grid (`scripts/bake/.seams/seams_<view>.json`, `preview_<view>.png`); open the previews and pick the real seams by id in `scripts/bake/seams.mjs` (example: the head's side seam from the profile view, ids 1 and 3, and the leg fronts from the front, ids 9 and 10). `python3 scripts/bake/trace-folds.py` follows faint folds between waypoints you read off the art (the belly's lower edge in the example) and `folds.mjs` carves them into the field. The bake turns the picked seams into a per-vertex signed-distance field (`SEAM_MAX` 0.16) that the shader draws as a groove with puffy shoulders (`references/felt-shader.md`). Seams painted as uniform stripes, or visible in only some views, cost hand work.

## 7. Recipe for a new sculpt
1. Register the art and build the reference pack (`references/art-analysis.md`).
2. Measure widths at key heights and the feature positions; set `P` near them; render `preview.mjs` and compare with the art by eye.
3. Fit at 209, then 418, then polish at 627; apply; score. Widen bounds where pinned.
4. Fix structure where a band stays low (an extra blend radius, a different ear primitive).
5. Extract and pick seams and folds; set the plate outline (`face.*`) from the art; copy the same numbers into `FABRIC.face` in `src/mascot-fabric.js` (the shader draws the same outline; `apply-fit.mjs` updates only the model).
6. Bake draft, look at yaw 0, +-0.5, +-0.9 (`references/mesh-bake.md`), then run the gates.

## 8. Traps
| Symptom | Cause | Fix | Verify |
|---|---|---|---|
| Teeth or white specks on the face edge when turned | a step or kink in the field at the plate outline | continuous wall (`wallW`), refinement in the bake | `turn-check.mjs` p95 <= 0.8 px, 0 open edges |
| Ears become spheres, high IoU | area-only objective | keep the band term, check the band scores | ears band >= 0.93 |
| Fit stuck at a bound | start or bounds from the example | move `P`, widen `SPACE` | parameter inside its range |
| Side IoU low, front fine | inconsistent turnaround | use it for depth only; regenerate the profile | side >= 0.95 or a registered profile |
| AO or fold missing after a refit | folds carved against old parameters | rerun `trace-folds.py`, rebake | belly fold visible in the preview |
| Plate outline in the shader differs from the model | `apply-fit.mjs` does not update `FABRIC.face` | copy `P.face` numbers by hand | seam profile in `eval.mjs` |
