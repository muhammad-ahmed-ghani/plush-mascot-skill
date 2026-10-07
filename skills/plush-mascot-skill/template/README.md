# Mascot project

A real-time 3D plush mascot (three.js + Vite): a signed-distance sculpt baked to a skinned mesh, a felt shader whose fibres are extracted from the artwork, a measured face, ten application states, props, a scroll-story showcase page, a validated GLB and a 60 fps motion reel. The artwork in `assets/` is the visual master; the live model is built to match it and measured against it. This template ships an **example mascot** (a coral felt creature with a charcoal face): replace its art before you ship anything (`node scripts/pipeline.mjs status` warns while the example art is in place).

## Run it

```sh
npm ci                                              # or link an existing node_modules
node scripts/pipeline.mjs run --to bake --quality draft   # derived files (silhouette refs, seams, nap tiles, meshes), minutes the first time
npm run dev -- --port 4173                          # http://127.0.0.1:4173 (set MASCOT_ORIGIN for the scripts/dev gates)
npm run build && npm run preview -- --port 4174     # production build (needs an HTTP server)
```

`mascot.config.json` is the single source of truth for the character's name, palette, registration frame, art and asset paths and page settings (`CONFIG.md` documents the keys). Every word the page says lives in `src/page/copy.js`.

## Layout

| Path | What |
|---|---|
| `assets/` | the example art (inputs), derived tiles and meshes, fonts, `app-icon.svg`, `emblem.svg` |
| `art/` | your masters (`masters/`, never edited), `candidates/`, `prompts/`, `work/` |
| `src/` | controller `mascot.js`, fabric `mascot-fabric.js`, face `mascot-face.js` + `face/`, poses `mascot-pose.js`, rig, props `props/`, page `app.js` + `page/` |
| `scripts/bake/` | sculpt (`model.mjs`), fit, seams, mesher, bake |
| `scripts/nap/` | fabric nap extraction |
| `scripts/dev/` | gates, tuners, capture tools |
| `scripts/tools/` | image generation, art QA, cut-out extraction, normalisation, crop comparison |
| `scripts/pipeline.mjs` | the stage runner |
| `HANDOFF.md` | behaviour, API, motion contract, integration notes |
| `tests/` | `VALIDATION.template.md` (fill in), `VALIDATION.example.md` (the example's numbers) |

## Rebuilding the model (what `pipeline.mjs` runs)

```sh
python3 scripts/bake/refmasks.py                       # reference silhouettes from the art
node scripts/bake/fit.mjs --refs scripts/bake/.refs --size 418 && node scripts/bake/apply-fit.mjs   # fit the sculpt
python3 scripts/bake/extract-seams.py && python3 scripts/bake/trace-folds.py   # candidate seams and folds (picked by id in scripts/bake/seams.mjs)
python3 scripts/nap/build.py                           # fabric nap tiles (about 5 minutes cold, seconds cached)
node scripts/bake/bake.mjs --quality final && node scripts/bake/bake.mjs --quality lite && node scripts/bake/check-mesh.mjs
node scripts/sync-public.mjs                           # the dev server serves public/ before the project root
```

Gates (dev server on :4173): `node scripts/dev/eval.mjs --ppus 350,246,123`, `turn-check.mjs`, `clearance.mjs`, `motion-check.mjs`, `view-check.mjs`, `validate.mjs`, `contrast.mjs`, `glb-check.mjs`; evidence: `evidence.mjs`, `reel.mjs`, `python3 scripts/dev/contact-sheets.py`. Do not edit `src/` while a tuner or gate runs.
