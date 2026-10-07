# scripts

`pipeline.mjs` runs the stages (`list`, `status`, `run`); the table says what each script is for. Paths are relative to the project root; every script resolves the root from its own location.

| Script | Purpose |
|---|---|
| `bake/refmasks.py` | reference silhouettes (front symmetrised, profile) at 209/418/627 px from the registered art and the turnaround |
| `bake/fit.mjs`, `apply-fit.mjs`, `score.mjs`, `preview.mjs` | fit `model.mjs` parameters to the silhouettes (coordinate descent), write them back, score IoU per height band, render previews |
| `bake/model.mjs`, `sdf.mjs`, `folds.mjs`, `seams.mjs` | the signed-distance sculpt, its primitives, carved folds, construction-seam field |
| `bake/extract-seams.py`, `trace-folds.py` | candidate seams and soft folds from the art (pick by id in `seams.mjs`) |
| `bake/mesher.mjs`, `refine.mjs`, `skeleton.mjs`, `bake.mjs`, `check-mesh.mjs` | surface-nets meshing, local refinement along the face-plate edge, 17-joint skeleton and skin weights, the bake (`--quality draft|lite|final`), the watertight check |
| `nap/build.py` | extract and quilt the fabric nap tiles from the art; `nap/*-emphasis.json` are the fitted pre-emphasis curves |
| `dev/eval.mjs`, `turn-check.mjs`, `clearance.mjs`, `motion-check.mjs`, `view-check.mjs`, `validate.mjs`, `contrast.mjs`, `smoke.mjs`, `glb-check.mjs` | the gates (need the dev server; `MASCOT_ORIGIN`) |
| `dev/scaled-ref.py`, `audit.mjs`, `audit.py`, `shoot.mjs`, `poses.mjs`, `variants.mjs` | density-matched references, crops, stills and parameter variants |
| `dev/tune2.mjs`, `apply-tuned.py`, `fit-nap-spectrum.py`, `fit-face.py`, `calibrate-*.py` | tuners and measurements of the fabric, the nap pre-emphasis and the face features |
| `dev/evidence.mjs`, `reel.mjs`, `contact-sheets.py`, `render-icons.mjs`, `build-fonts.py`, `make-page-textures.py` | evidence stills, the 60 fps reel, contact sheets, icons, fonts, page textures |
| `tools/` | `imagegen.py`, `render_prompts.py`, `art_qa.py`, `alpha_extract.py`, `normalize_art.py`, `contact_sheet.py`, `crop_compare.py`, `selftest.py` (the skill's `references/tools-catalog.md` has the details) |

Known assumptions about the art: `refmasks.py`, `nap/build.py`, `extract-seams.py`, `trace-folds.py`, `dev/fit-face.py` and `lab-metrics.js` contain the example's colour rules, chest-mark exclusion and feature seed centres (red body, dark face fabric, a chest mark at a fixed spot); the skill's `references/art-analysis.md` section 9 lists every constant to re-measure for a new character.
