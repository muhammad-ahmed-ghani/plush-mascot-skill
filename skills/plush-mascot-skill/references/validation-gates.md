# Validation gates and the fidelity audit

Purpose: the complete, ordered set of checks a mascot build must pass (commands, thresholds, reasons, what to do on failure) and the honest method for judging whether the live model looks like the art. The gates catch known failures cheaply; only side-by-side crops decide fidelity.

When to read: before the first bake (so you know what will be measured), after any change to the sculpt, nap, light, face, poses, props or page, and before telling anyone the mascot "matches the art".

## Contents

1. Metrics are guards, not goals
2. Before you run anything
3. The master gate table
4. Gate details
5. The fidelity audit protocol
6. The independent auditor
7. Failure triage map
8. Definition of done
9. Recording results in `tests/VALIDATION.md`
10. Traps in the measuring itself

## 1. Metrics are guards, not goals

A tuner or a patient agent can raise any single number while the picture gets worse, so no metric here is the objective. On the example mascot, several iterations passed every metric of the day and still looked wrong at 4 to 8x: blobby nap instead of thin curled filaments, a dark mechanical chest mark, eyes 0.06 units out of place, a flat masked colour edge where the art has a rolled seam. The owner found each of these by looking, never by reading a number.

What the owner saw, and what you must therefore look at:

- **Side-by-side crops of the same window**, art and render at the same density, magnified 5 to 8x with nearest-neighbour scaling. Stroke character, the colour of small parts and edge quality only show there.
- **Several yaws, pitches and rolls.** The worst defect of the project (white grains and a zig-zag along the hood-to-plate seam) existed only when the head turned: a step in the signed-distance field was meshed as a staircase by the 0.021-unit grid, and the colour boundary crossed it. A front-on audit cannot show a slant-angle artefact.
- **Several display densities.** Detail that is fine at the art's 350 px per unit aliases at 1x page scale (the chest cord's wraps became a shimmering checkerboard below about 300 px per unit).
- **Stepped 60 fps filmstrips for motion.** A hand passing through the hood, a flat closed laptop sliding in and an abrupt stand-up all looked acceptable in single stills and in one live playback.

So each gate below guards against a class of failure that already happened once. A result is done only when the gates pass and the audit protocol (section 5) finds nothing the art does not have. When a metric and the crops disagree, believe the crops and find out why the metric missed it (wrong window, wrong density, or a number the tuner learned to game).

Numbers marked "example mascot" were measured on the template's example character; get your own by running the same gate on your build and recording it in `tests/VALIDATION.md`.

## 2. Before you run anything

| Prerequisite | Why | How |
|---|---|---|
| Dev server on a known port | every browser gate loads the page; the scripts default to `http://127.0.0.1:4173` | `npm run dev -- --port 4173`; for another port or the production preview set `MASCOT_ORIGIN=http://127.0.0.1:<port>` |
| Fresh `public/` | Vite serves `public/` before the project root, so a regenerated file in `assets/` is invisible until copied | `node scripts/sync-public.mjs` (`npm run dev` and `npm run build` run it first) |
| Density-matched art | the fidelity gates compare against `scripts/dev/.refs/ref_<ppu>.png`, drawn unscaled into a canvas of `sizeFor(ppu)` pixels (1470, 1034 and 600 for 350, 246, 123) | `python3 scripts/dev/scaled-ref.py --ppus 350,246,123` with no `--size`, so each canvas has the size the metrics expect |
| Silhouette masks | `score.mjs` reads them | `python3 scripts/bake/refmasks.py` |
| Chrome with a working GPU | the launcher (`scripts/dev/browser.mjs`) runs headless Chrome with Metal-backed WebGL | `CHROME_PATH` for another binary; `MASCOT_CHROME_ARGS` adds flags; off macOS the ANGLE flag may need changing (unverified) |
| A quiet machine for frame-rate gates only | another agent's render or a low battery halves the rate and the pacing check fails for reasons outside the page | plug in; run `motion-check.mjs` alone; fidelity gates do not care |
| No edits under `src/` during a run | Vite reloads the page and the run dies with "Execution context was destroyed" | finish or stop the gate first |

When the pipeline runner is present, `node scripts/pipeline.mjs run --only verify` starts Vite if needed and runs the verify gates in order, logging to `.pipeline/logs/verify.log`; `node scripts/pipeline.mjs list` shows the stages. The individual commands below work without it.

## 3. The master gate table

Run in this order: each gate assumes the ones above it pass, so a failure higher up makes the later numbers meaningless. Times were measured on the development machine (an Apple silicon laptop) with other work running; yours will differ.

| # | Gate | Command | Measures (how) | Pass | Example mascot | Time | Needs | If it fails |
|---|---|---|---|---|---|---|---|---|
| 1 | Art QA | `python3 scripts/tools/art_qa.py art/masters --kind auto --palette mascot.config.json --report art/qa.json --strict` | resolution, alpha, halo, crop, symmetry, fibre energy per image (per-check value, threshold, fix) | no FAIL; with `--strict` warnings count too | example art passes (the tool is calibrated on it) | seconds per image (unverified) | Python with numpy, Pillow, OpenCV | fix the art, not the pipeline: `references/art-analysis.md` |
| 2 | Sculpt fit | `node scripts/bake/score.mjs` | IoU of the SDF's front and side masks against the art's (627 px), plus per height band | front >= 0.96, side >= 0.95 | 0.9785 (symmetrised target), 0.9598 | 3 s | `refmasks.py` | `references/sculpt-fit.md` |
| 3 | Mesh | `node scripts/bake/check-mesh.mjs assets/mascot-mesh.bin` and `assets/mascot-mesh-lite.bin` | edge-use count per part: open (1 use), non-manifold (3+), degenerate triangles | 0 open, 0 degenerate on every part; a handful of non-manifold edges tolerated | 0 open, 2 non-manifold on the head, 0 elsewhere, both tiers | under 1 s | a bake | `references/mesh-bake.md` |
| 4 | Fidelity | `node scripts/dev/eval.mjs --ppus 350,246,123` | live front render vs density-matched art: luminance percentiles, fibre band energy, outline brightness, seam profile, cord contrast | guard bands in 4.4 | 4.4 | 2 s after load | dev server, scaled refs | `references/felt-shader.md` |
| 5 | Features | outlines: `python3 scripts/dev/fit-face.py`; live side: crops (4.5) | IoU of eyes, cheeks, mouth between the live 350 ppu render and the art | eyes and cheeks >= 0.95, mouth >= 0.9, centroids within 0.005 units | 0.989 / 0.977, 0.963 / 0.956, 0.913 | minutes | dev server | `references/face-kit.md` |
| 6 | Turn seam | `node scripts/dev/turn-check.mjs` | plate outline found on 360 rays vs its own smooth Fourier fit; bright specks on the plate | scored views (2x, yaw -0.5 and 0.5): p95 <= 0.8 px and specks <= 12; quality target p95 <= 0.2 px | mean 0.07 px, p95 0.16 px, specks 0 and 7 | 6 s | dev server | `references/mesh-bake.md`, `references/troubleshooting.md` |
| 7 | Clearance | `node scripts/dev/clearance.mjs` | closest approach of hand and card vertices to head vertices, every state, 7 pointer positions, stepped at 60 fps | >= 0.04 units | lowest 0.067 (speaking hand), card 0.072 | 2 min | dev server | `references/rig-and-animation.md` |
| 8 | Motion | `node scripts/dev/motion-check.mjs` | pacing from the first frame of four states, leaving working, `lead`, `poke()` | 11 of 11 | 11 of 11; 60.0 fps, worst frame 16.8 ms, `lead` 1.10 s | 20 s | dev server, mains power, idle GPU | `references/runtime-and-performance.md` |
| 9 | Poster view | `node scripts/dev/view-check.mjs` | poster placed from `figureBox()` vs the drawn figure's opaque extent, four views | <= 6 px (head, feet, axis) | head 3.5 to 4.9 px, feet <= 0.7 px, axis 0.5 px | 3 s | dev server | `references/runtime-and-performance.md` |
| 10 | Page | `node scripts/dev/validate.mjs` | the page's behaviour in real Chrome: desktop, phone, tablet, reduced motion, no WebGL (4.10) | every check passes | 106 of 106 | 2 min | dev server or preview | `references/showcase-page.md` |
| 11 | Contrast | `node scripts/dev/contrast.mjs --width 1440 --height 900` (five sizes) | WCAG ratio of every visible word against the room colour at every scroll stop; words over the mascot | 4.5:1 (3:1 large) once 85 percent visible; 2.2:1 while half faded; no overlap | pass at all five sizes; lowest settled 7.05:1 (desktop), 7.46:1 (phone), normalised to 4.5 | 15 s per size | dev server | `references/showcase-page.md` |
| 12 | GLB | `node scripts/dev/glb-check.mjs` plus the Khronos validator (4.12) | loads in a bare three.js scene with the stock loader; clips, skins; validator report | 0 errors, 0 warnings; 10 clips; skinned meshes present | 0 errors, 0 warnings, 5 infos; 10 clips of 29 tracks; 4 skinned meshes | 1 s | exported GLB, dev server | `references/exports-and-handoff.md` |
| 13 | Stress | the script in 4.13 | 40 random state sequences stepped at 60 fps | no non-finite or out-of-range pose value; no jump over the limits | 19,917 frames, 0 bad values | 3 s | dev server | `references/rig-and-animation.md` |
| 14 | Build | `npm run build` | the production bundle (after `sync-public.mjs`) | builds; one chunk-size advisory is expected | 725 kB main chunk (209 kB gzip), 38.5 kB lazy export chunk, 28 kB CSS | 1 s | | `references/exports-and-handoff.md` |
| 15 | Dependencies | `npm audit` | known advisories in the lock file | 0 vulnerabilities | 0 | seconds | network | update the pinned package, re-run 10 to 14 |

Gates 6 to 11 read the page through `window.mascot`, so they fail loudly (a timeout waiting for `window.mascot.loaded`) when the model does not load; read the browser console output they print before chasing the gate itself.

## 4. Gate details

### 4.1 Art QA

`art_qa.py` checks each master for what the pipeline needs: size (warn under 1600 px on the long edge, good from 2400), JPEG blockiness, background uniformity, sharpness, palette against `mascot.config.json`, and per kind: a real alpha with clean fringes and no baked checkerboard, 4 percent margins, feet inside the frame, symmetry and its axis, figure height, turnaround figure count and height consistency, macro fibre scale. Each check prints PASS, WARN or FAIL with its value, threshold and a suggested fix, and `--report` writes the same as JSON. Why first: every later gate is fitted to the art, so a halo, a cropped foot or a plastic-smooth render becomes a defect of the model that no tuner can remove. Flags and thresholds: `references/art-analysis.md`, `references/tools-catalog.md`.

### 4.2 Sculpt fit

`score.mjs` rasterises the sculpt's front and side silhouettes at 627 px and prints IoU against `scripts/bake/.refs/ref_front_sym_627.bin` (the art's front, made symmetric) and `ref_side_627.bin` (the profile from the turnaround), then per height band: ears 2.55 to 3.4, head 1.6 to 2.55, body 0.6 to 1.6, legs 0 to 0.6 (character units, feet at 0). Example mascot: front 0.9785 (ears 0.962, head 0.994, body 0.979, legs 0.964), side 0.9598 (legs 0.934). Against the unsymmetrised art the front is about 0.970. The side threshold is lower because a generated turnaround is not geometrically consistent with its front view; use it for depth and the face apex, not as truth. The script prints and exits 0; judge the numbers. A band well below the others points at the part to refit (`references/sculpt-fit.md`).

### 4.3 Mesh

`check-mesh.mjs` counts how many triangles use each edge in every part of a baked `.bin`. Open edges are cracks: on the example they showed as white specks along the plate edge when the head turned, and came from a mesher that dropped sliver triangles. Pass: 0 open and 0 degenerate on every part of both tiers. Non-manifold edges are a known trait of surface-nets meshing; the example has 2 on the head of each tier and none is visible. The script exits 1 whenever any count is non-zero, including non-manifold, so read its output rather than its exit code. Example triangle counts: final 170,740 (head 110,648), lite 83,120 (head 51,100).

### 4.4 Fidelity (`eval.mjs`)

The lab page renders the real controller near-orthographically (6 degree lens) at a chosen density and compares it with the art rescaled to the same density: 350 px per unit is the art's own, 246 is about the page stage on a 2x display and 123 on a 1x display. To find the densities your page really uses, take a shot's `unit` (stage heights per character unit, `src/page/story.js`) times the stage height in CSS pixels times the device pixel ratio; the example's wide shots span about 190 to 480 device px per unit on common screens, so 350, 246 and 123 bracket it.

`eval.mjs` prints and never fails; the bands below are the guard bands used for the example (they agree with the summary in SKILL.md). Any row outside its band means: open the crops for that region (section 5) before changing anything.

| Metric | How it is measured | Pass (guard band) | Example mascot at 350 / 246 / 123 | If it fails |
|---|---|---|---|---|
| Body luminance percentiles | 2, 5, 10, 25, 50, 75, 90, 95, 99 percent of luminance over pixels that are body fabric in both images | every percentile within 3 levels of the art | max 3 / 3 / 3 levels | light and tone curve: `tune2.mjs --only light` from live values (`references/felt-shader.md`) |
| Fibre band energy, finest band | std of luminance minus its Gaussian blur (sigma 1.2 px, scaled with density) in six feature-free body patches | live/art 0.9 to 1.3 per patch at 350 and 246 | belly 0.92 / 0.98, chest 1.21 / 1.23, leg 1.14 / 1.23, arm 1.15 / 1.20, ear 0.98 / 0.99, crown 1.06 / 1.00; at 123 chest 1.42 and leg 1.31 are recorded misses | nap pre-emphasis (`fit-nap-spectrum.py`) then `tune2.mjs --only tex` |
| Outline brightness | mean luminance of a thin band just inside the silhouette, by side | left, right, top within 5 levels | 140/143, 146/146, 146/150 at 350; bottom 123/100 is a recorded miss (feet undersides lighter) | rim and fuzz: `tune2.mjs --only edge` |
| Seam profile (`seam`) | mean luminance across the hood-to-plate edge in 0.004-unit bins on four sides; weighted mean absolute difference (computed at >= 300 ppu only, prints 0.0 below) | <= 6 levels at 350 | 5.3 | edge shading: `tune2.mjs --only seam`; geometry: `references/sculpt-fit.md` |
| Cord contrast | std of luminance along one bar of the chest mark minus its own low-pass, and its mean | at 350: live/art std >= 0.7 and mean within 5 levels; at 246 and 123 only the mean is judged | 10.4/13.1 (mean 102/104); 1.7/8.8 and 1.6/3.6 (mean 109/104) | `tune2.mjs --only cord`; `references/face-kit.md` |
| Tuner terms (`tone`, `cells`, `plate`, `faceShape`, `skewErr`, `kurtErr`, `evenErr`, `loss`) | the tuner's objectives | no band; record yours and compare after each change | loss 7.01 / 8.40 / 8.41, tone 8.1 to 8.3 | a clear rise after a change: look at the crops of that region before accepting |

Why the cord is judged only by its mean below 300 px per unit: its wraps are about 2.7 px apart at 350, so at page scale they are finer than two pixels and alias into a checkerboard that shimmers when the figure moves. The shader fades them by their own screen-space frequency into a plain cord of the same mean colour, which is correct even though the rescaled art still shows faint aliased stripes.

### 4.5 Features

`fit-face.py` measures the eye whites, cheeks, mouth and irises in the registered art and writes their outlines (it prints each feature's centre, half extents and the polar IoU of the fitted outline, which checks the input side). The live side has no shipped script: render the front at 350 ppu (`node scripts/dev/audit.mjs --ppu 350 --out $A/live-350.png`), segment each feature in the same window of the render and of the art (colour thresholds as in `fit-face.py`), and compute IoU and centroid offset. Example mascot: eyes 0.989 and 0.977, cheeks 0.963 and 0.956, mouth 0.913, centroids within 0.005 units. The mouth passes at 0.9 because a thin cord's IoU is dominated by its boundary pixels; below 0.9 the shape is visibly different.

### 4.6 Turn seam (`turn-check.mjs`)

Opens the real page in a 1300 x 590 window (the stage height the numbers were calibrated on) at 1x and 2x, freezes idle at each yaw (default `--yaws -0.5,0.5,0.9`), and on a snapshot finds the plate (the largest dark, non-red component), casts 360 rays from its centre and, on each, walks in from the hood until its redness ends, to a tenth of a pixel. Roughness is the deviation of that outline from itself with everything above 36 harmonics removed; specks are plate pixels 50 levels above their 7 x 7 median, at least 8 px inside the plate. Rays that end at the silhouette are skipped.

Only 2x views with |yaw| <= 0.6 are scored (PASS or FAIL, exit 1); the rest print as `info`, because at 1x the crevice is narrower than a pixel and at larger yaws the shadowed hood wall takes over from the seam, so the locator would measure shadow, not geometry. Pass: p95 <= 0.8 px (`--max-rough`) and specks <= 12. The example reached mean 0.07 px and p95 0.16 px, so treat anything above 0.3 px as worth a look even though it passes; for scale, the stepped mesh that produced the owner's complaint measured 0.37 and 0.44 px mean and 1.40 and 1.82 px p95. Example info rows: 1x p95 0.16 and 0.17 px; yaw 0.9 at 2x p95 0.82 px (unscored).

### 4.7 Clearance (`clearance.mjs`)

Pauses the controller and, for each state and each of seven pointer positions (centre, left, right, up-left, up-right, down-right, up; `--looks 3` for three), settles idle for 2 s, enters the state and steps it at 60 fps for its duration (idle 2 s, greeting 2.4, listening 3, thinking 3.6, working 7, approval 3.5, success 3.6, error 3, speaking 3, resting 3). On every other frame it measures the closest distance between hand vertices (skinned more than 60 percent to a wrist bone), card vertices and every third head vertex. Pass: 0.04 units, because the fuzz reaches about 0.01 and anything closer reads as the hand merging into the hood or face. Units: the character is about 3.3 tall and a hand ball 0.22 across.

Example mascot: greeting 0.110, thinking 0.074, working 0.215, approval hand 0.242 and card 0.072, success 0.084, speaking 0.067, everything else above 0.3. Before the fix, greeting, approval and success sat at 0.001. The script measures the decision card only: add any prop you create that comes near the head to the measured set (`references/props.md`).

### 4.8 Motion (`motion-check.mjs`)

Eleven checks at 1300 x 1000, 2x:

| Check | Pass |
|---|---|
| Pacing on first entry into working, approval, success, idle (4) | 0.92 to 1.04 of the ceiling, the ceiling being the lower of a blank page's rate and 62 fps; no frame longer than 1.8 frame intervals; governor at level 0 (level 1 allowed when the browser is throttled) |
| Seated | root below -0.15, laptop and headphones above 0.95 |
| Asking for working while working | changes nothing (same elapsed time, no dismount) |
| Leaving working | `lead` = 1.1 s within 0.01 |
| 0.4 s into leaving | still low (root below -0.1), laptop closing (below 0.7) |
| 1.4 s into leaving | standing (root above -0.04), laptop, headphones and seat below 0.01, 0.01, 0.05 |
| Success from the seat | `lead` below 0.2 s and root above 0.05 after 0.6 s |
| Poke | head nods by more than 0.04, a blink starts, and the head returns within 0.02 after 2.5 s |

It first measures `about:blank` for 2 s and prints that rate: Chrome's Energy Saver (battery under 20 percent) and macOS Low Power Mode hold every page, a blank one included, to 30 fps, and no flag lifts that without also removing the display's pacing. If the blank page runs under 50 fps the pacing is judged against it. Other agents rendering on the same GPU also lower the rate; run this gate alone. Example mascot: 11 of 11, 60.0 fps in all four states, worst frame 16.8 ms.

### 4.9 Poster view (`view-check.mjs`)

The page fades from the portrait (`assets/mascot-transparent.webp`) to the live canvas, placing the portrait from `figureBox()`. For four views (`{x 0, y 0, zoom 1}`, `{0.22, 0.05, 1.2}`, `{-0.3, -0.1, 0.85}`, `{0.1, 0.02, 0.7}`) the script sets the view, freezes idle, reads the drawing buffer and compares the opaque extent (alpha above 200) with where the art's head row, feet row and axis column (`frame.topY`, `feetY`, `axisX` in `mascot.config.json`) land. Pass: all within `--tol 6` px. Feet and axis are the tight numbers (example under 1 px); the head row reads a few pixels low (example 3.5 to 4.9 px), which is why the tolerance is 6 px and not 2. A failure means the controller's framing and the page's copy of it drifted: see `references/runtime-and-performance.md`.

### 4.10 Page behaviour (`validate.mjs`)

Runs in real Chrome against the running page and prints one PASS or FAIL line per check, then `N/M checks passed`; exits 1 on any failure. Example mascot: 106 of 106 on the dev server and on the production build (`MASCOT_ORIGIN=http://127.0.0.1:4174` after `npm run preview -- --port 4174`).

| Group | Checks (example count) |
|---|---|
| Page and stage (7) | lang, title, description over 40 characters, og:image, theme-color; the favicon and header use the app icon SVG; a 180 x 180 apple-touch-icon; a retired asset is gone (project specific, replace or delete); header, main, footer and a skip link to `#main`; exactly one canvas in a fixed, pointer-transparent, `aria-hidden` stage; eight scenes in order with `#motion` first after the hello |
| Copy and type (7) | no arrow glyphs; no em dashes, double hyphens or numbered eyebrows; no spaced caps (uppercase transform or letter spacing above 0.09 em); no banned words (seamless, elevate, unlock, by design, by nature, not just); the five font faces loaded; nothing requested from another origin; the page's framing maths agrees with `figureBox()` within 1.5 px |
| Workbench (15) | starts closed, `inert`, hidden; opens and takes focus; ten state controls; each state selects the state, `aria-pressed` and the status text (10); at least 8 distinct pose fingerprints; the state title updates |
| Switches (6) | turntable; reduced motion goes calm (frames no longer sticky), holds the pose still over 700 ms, scrolling does not change state, switching off restores the choreography; Escape closes the drawer and returns focus |
| Scroll story (25) | after a jump to each scene (2.5 s, 4.3 s for working): scene, state and status right; camera, words and colours settled; the mascot on the correct side (6); a jump into a transition picks the nearer scene; look closer zooms in (zoom above 1.3) then turns him round (yaw above 2.6); a scroll wiggle of 34 px for 1.5 s inside working causes no state change |
| Approval demo (7) | still waiting after 3.5 s; Not yet goes idle and offers Ask again; Ask again brings the card back; Approve reaches success, the story moves on to Done, success settles to idle, the result says nothing was sent |
| Poke (2) | a click on the figure is logged; it never interrupts the card |
| Dialog and keyboard (4) | the activity dialog opens from the status tag with at least 5 entries and closes on Escape; the skip link moves focus to `#main`; focus rings are dashed and at least 2 px |
| Exports (3) | the PNG snapshot is transparent around the figure (over 10 percent opaque, over 30 percent clear; example 25 and 74); the GLB export starts with `glTF` and is over 1 MB (example 7.8 MB); no downloads section or file list |
| Context loss and console (4) | a lost WebGL context brings the portrait back at the figure's size (within 2 px); the model returns with the context; no console errors; no failed requests |
| Phone 390 x 844 at 2x (19) | no horizontal overflow; every button and link at least 44 x 44 px; per scene: settled state and camera (8), face and feet above the words' sheet (6), raised arms on screen (2); no console errors |
| Tablet 820 x 1180 (2) | the first Tab stop is the skip link; the approval scene is right, with no overflow and no console errors |
| OS reduced motion (2) | calm layout, switch on, no scroll-driven state, no marching stitches; no console errors |
| No WebGL (3) | portrait and an honest note, exports disabled, no canvas, no controller; the story and status still follow the scroll; no console errors |

The waits are fixed (2.5 s per scene, 4.3 s for working), so a much slower machine can fail the scroll-story checks for timing alone; re-run a failing scene with `node scripts/dev/page.mjs out.png --scroll #working --wait 6000` and look. If you add, remove or rename scenes or fonts, update `SCENES` and the font list at the top of `validate.mjs` in the same change, because the gate encodes the page's contract. Details of the page: `references/showcase-page.md`.

### 4.11 Contrast (`contrast.mjs`)

Scrolls the whole page in steps (`--step 140` px by default; the example's release run used 120) and at every stop measures every piece of text that is on screen: its effective opacity (the product of its ancestors' opacity), its colour composited over the room colour at that instant (`--bg`, and the lighter `--disc` behind the figure, taking the worse), or over its own fill for the bar, tags, patch button and swatches. Rules and their reasons:

| Text state | Must reach | Why |
|---|---|---|
| Effective opacity 0.85 or more | 4.5:1, or 3:1 for large text (24 px, or 18.66 px bold) | someone may be reading it (WCAG AA) |
| Opacity 0.5 to 0.85 | 2.2:1 | it is on its way in or out; the page fades words out while the room passes through mid-grey, where no ink reads well |
| Opacity under 0.5 | not judged | a ghost, not text |
| Any word over 0.5 opacity | must not overlap the figure's box (0.22 to 0.78 of the portrait's width, 0.04 to 0.97 of its height; on tall screens only the part above the words' sheet) | words on the character are unreadable and hide him |

Run it at the five sizes the example was inspected at, because each layout has its own framings and colours:

```bash
for s in 1440x900 1024x768 1920x1080 820x1180 390x844; do node scripts/dev/contrast.mjs --width ${s%x*} --height ${s#*x} --step 120 || echo "FAIL at $s"; done
```

Widths under 600 emulate a phone at 2x. Each failure line gives the scroll position, scene, text, ratio and room colour. Example mascot: all pass; lowest settled ratio 7.05:1 at 1440 x 900 and 7.46:1 at 390 x 844 (normalised to the 4.5 rule).

### 4.12 GLB

`glb-check.mjs` loads `/assets/mascot-animated.glb` with the stock `GLTFLoader` in a bare three.js scene (a hemisphere light and one directional light, nothing from the studio), prints each clip's name, track count and duration and each skinned mesh with its vertex count, and renders five frames (idle 0 s, greeting 1.2, working 1.0, success 0.9, resting 1.0) to `tests/glb-check_<clip>.png` (or `node scripts/dev/glb-check.mjs <prefix>`). It exits 0 unless loading throws, so judge by the printout and the frames. Example mascot: 10 clips of 29 tracks each (idle 4 s, greeting 2.4, listening 3, thinking 3.6, working 4.8, approval 3, success 2.4, error 3, speaking 3, resting 4); skinned head, body, armL, armR; the stretched arms reach 1.47 (greeting) and 1.65 (success) units from the axis.

The Khronos validator runs inside `node scripts/dev/evidence.mjs --only glb` (it exports from the live page and writes `tests/gltf-validation.json`). To validate any GLB on its own:

```bash
node -e "const fs=require('node:fs'),v=require('gltf-validator'),f=process.argv[1];v.validateBytes(new Uint8Array(fs.readFileSync(f)),{uri:f,maxIssues:200}).then(r=>{const i=r.issues;console.log(f,i.numErrors,'errors',i.numWarnings,'warnings',i.numInfos,'infos');i.messages.forEach(m=>console.log(' ',m.code,m.pointer||''));process.exit(i.numErrors||i.numWarnings?1:0)})" assets/mascot-animated.glb
```

Pass: 0 errors and 0 warnings. Informational notices are acceptable: the example has 5, one `UNSUPPORTED_EXTENSION` (`EXT_materials_bump`, which the validator cannot check) and four `UNUSED_OBJECT` (three unused `TEXCOORD_0` sets and one texture). Because the dev server serves `public/` first, run `node scripts/sync-public.mjs` after exporting and before `glb-check.mjs`, or it loads the previous file. What the file contains: `references/exports-and-handoff.md`.

### 4.13 Random-sequence stress

Not shipped as a script in the example; save this as `$TMPDIR/fuzz-states.mjs` and run it from the project root. It plays 40 runs of 2 to 6 random states lasting 0.2 to 4 s each (about 20,000 frames), stepped at 60 fps without rendering, and checks every pose value on every frame.

```js
// Random state sequences at 60 fps: every pose value finite and in range, no frame-to-frame jump above LIMIT (per key group).
import { pathToFileURL } from 'node:url';
const { launch, ORIGIN } = await import(pathToFileURL(`${process.cwd()}/scripts/dev/browser.mjs`).href);
const LIMIT = { arm: 0.2, hip: 0.12, ankle: 0.12, root: 0.12, head: 0.05 };
const browser = await launch({ width: 1300, height: 900, dpr: 1 });
try {
  const page = await browser.newPage();
  await page.goto(`${ORIGIN}/`, { waitUntil: 'networkidle2', timeout: 120000 });
  await page.waitForFunction('window.mascot && window.mascot.loaded', { timeout: 120000 });
  const r = await page.evaluate(() => {
    const w = window.mascot, states = Object.keys(window.MASCOT_STATES); w.paused = true;
    let seed = 12345; const rnd = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296);
    const bad = [], jump = {}; let frames = 0, prev = { ...w.cur };
    for (let run = 0; run < 40; run++) for (let i = 0, n = 2 + Math.floor(rnd() * 5); i < n; i++) {
      w.setState(states[Math.floor(rnd() * states.length)]);
      for (let f = 0, N = Math.round((0.2 + rnd() * 4) * 60); f < N; f++, frames++) {
        w.advance(1 / 60, { render: false });
        for (const [k, v] of Object.entries(w.cur)) {
          if (!Number.isFinite(v) || Math.abs(v) > 20) bad.push(`${k}=${v} (${w.state})`);
          const g = k.replace(/[LR]?\.[a-z0-9]+$/i, ''); jump[g] = Math.max(jump[g] ?? 0, Math.abs(v - prev[k]));
        }
        prev = { ...w.cur };
      }
    }
    return { frames, bad: bad.slice(0, 5), jump };
  });
  const over = Object.entries(LIMIT).filter(([g, m]) => (r.jump[g] ?? 0) > m);
  console.log(`${r.frames} frames; bad: ${r.bad.join(' ') || 'none'}; jumps: ${Object.entries(r.jump).map(([g, v]) => `${g} ${v.toFixed(3)}`).join(' ')}`);
  console.log(r.bad.length || over.length ? `FAIL ${over.map(([g]) => g).join(' ')}` : 'PASS');
  process.exitCode = r.bad.length || over.length ? 1 : 0;
} finally { await browser.close(); }
```

Example mascot: 19,917 frames, no bad value; largest jumps per frame arm 0.157, hip 0.097, ankle 0.061, root 0.090, head 0.032. The limits sit about 25 percent above those maxima: a pop (a key that snaps instead of easing, a state that starts from the wrong pose) shows as a jump several times larger, while a new character's slightly different poses should not trip it. Face (`f.`) and prop (`p.`) keys are not limited, because blinks, the headphones' pop-on and the typing signals are deliberately step-like. Record your own maxima in `tests/VALIDATION.md`; a later run that exceeds them by a lot is a regression to explain.

### 4.14 Build and dependencies

`npm run build` runs `scripts/sync-public.mjs` first and writes `dist/`. Vite warns once that a chunk is over 500 kB: three.js, the controller and the page in one chunk (example 725 kB, 209 kB gzip). That is expected; the GLB exporter is already split into a lazy chunk (38.5 kB) because `exportGLB()` imports it dynamically. Validate the build itself, not only the dev server: `npm run preview -- --port 4174`, then gates 10 and 11 with `MASCOT_ORIGIN=http://127.0.0.1:4174`. `npm audit` must report 0 vulnerabilities; the example reached 0 by moving `puppeteer-core` to `^25.12.0`, which dropped a transitive advisory in a download helper that the project never uses (it drives the system Chrome).

## 5. The fidelity audit protocol

Do this after any change that alters what the model looks like, and in full before handoff. Write everything into one audit folder outside the project, for example `A=${TMPDIR:-/tmp}/mascot-audit; mkdir -p $A`.

1. **Freeze the build.** Nobody edits `src/` during the audit; `node scripts/sync-public.mjs`; dev server up; scaled references present (section 2). Why: a reload mid-audit mixes two builds in one comparison.
2. **List every edge and feature to crop.** Silhouette (left, right, crown, ears, arms, feet and soles), the hood-to-face seam on all four sides, face fabric interior (forehead, between the eyes, chin), each eye (white edge, iris and pupil clip, catchlight, lids at blink 0.3, 0.6, 0.85 and 1), cheeks and their outlines, mouth (cords, corners, inside when open), chest mark (wraps, trench), every construction seam (centre seam, ear seams, leg seams, belly fold), and each prop in the state that shows it. Why: defects hide in the part nobody looked at; the example's worst late defects were on eyelids and the far cheek, not on the seam everyone was watching.
3. **Take windows in character units, the same for art and render.** Example windows (x0, x1, y0, y1; feet at y 0, axis at x 0): head -1.3, 1.3, 1.5, 3.4; face -0.95, 0.95, 1.55, 2.75; eye -0.85, -0.02, 1.85, 2.42; chest mark -0.42, 0.42, 0.72, 1.45; belly -0.62, 0.62, 0.25, 1.1; arm 0.45, 1.3, 0.55, 1.55; foot 0.05, 0.98, 0, 0.72; ear 0.3, 1.45, 2.55, 3.4. Derive yours from the feature centres and half extents that `fit-face.py` prints, padded by about 30 percent.
4. **Front-on at three densities.** For each of 350, 246 and 123 ppu:

   ```bash
   node scripts/dev/audit.mjs --ppu 350 --out $A/live-350.png
   python3 scripts/dev/audit.py $A/live-350.png --ppu 350 --out $A/350     # art | live crops of the example windows, tone_diff.png, fibre and cord numbers
   ```

   `audit.py` scales its crops with bicubic filtering up to 4x, which is fine for form and tone but not for pixels; step 6 is for pixels. `node scripts/dev/variants.mjs --ppu 350 --crop belly --out $A/v.png '{"u":{...}}'` tiles one window of the art and of parameter variants side by side when you are choosing between settings.
5. **Off-axis and at page scale.** Render the idle pose at yaw 0, +-0.3, +-0.5, 0.9, +-1.2 and +-1.5, the head pitched (`head.x`) +-0.35 and rolled (`head.z`) +-0.3, each at device pixel ratio 1 and 2:

   ```bash
   for y in 0 0.3 -0.3 0.5 -0.5 0.9 1.2 -1.2 1.5 -1.5; do for d in 1 2; do
     DPR=$d node scripts/dev/shoot.mjs "size=600&state=idle&t=1&time=0&yaw=$y&transparent=1" $A/yaw$y-dpr$d.png
   done; done
   DPR=2 node scripts/dev/shoot.mjs "size=600&state=idle&t=1&time=0&yaw=0.5&o.head.x=0.35" $A/pitch.png
   DPR=2 node scripts/dev/shoot.mjs "size=600&state=idle&t=1&time=0&yaw=-0.5&o.head.z=0.3" $A/roll.png
   DPR=2 node scripts/dev/shoot.mjs "size=600&state=idle&t=1&time=0&blink=0.6" $A/blink.png
   node scripts/dev/poses.mjs $A/state "greeting:1.2" "working:4" "approval:2" "success:0.65" "resting:4"
   ```

   `shoot.mjs` renders the lab page (query options at the top of `src/lab-ctrl.js`: `o.<pose key>` overrides, `blink`, `lx`/`ly` gaze, `quality`); `poses.mjs` renders the real page in capture mode at 1000 x 760, 2x. For crops against the art at an angle there is no art: compare the two sides of the head with each other and with the front, and look for teeth, specks, cracks, halos and features crossing the silhouette.
6. **Look at pixels.** Crop each window from art and render at the same scale and magnify 3 to 10x with nearest-neighbour scaling (`scripts/tools/crop_compare.py`, flags in `references/tools-catalog.md`; it also writes an absolute-difference heat map). Without it: `python3 -c "from PIL import Image as I; im=I.open('in.png').crop((x0,y0,x1,y1)); im.resize((im.width*8,im.height*8),I.NEAREST).save('out.png')"`. Always also view the native size. Why: bilinear upscaling hides exactly the single-pixel grains and stair-steps you are looking for, and a downscaled preview hides everything.
7. **Check stability.** Render the same frozen pose twice (must be pixel-identical; if not, something is unseeded). Difference yaw 0.50 against 0.51 (a sparkly difference image means shimmer). For outlines, sweep yaw around 0.5 in 0.001 steps and, per edge pixel, compare the largest single-step change with the total change over the sweep (0 gradual, 1 all at once): the example's geometry edges scored 0.17 to 0.19 and its sub-pixel dark outlines (iris ring, cheek and mouth outlines) 0.42 to 0.48, which is the crawl a viewer sees in motion.
8. **Film motion.** Step each transition at 60 fps with the deterministic clock (`paused`, `advance(1/60, { render: false })`, `freeze`; `references/agent-operations.md`), keep 10 to 20 frames per second of animation for review, and lay them out as contact sheets (`scripts/tools/contact_sheet.py`). Always film: entering and leaving working, hello at the top and bottom of the wave, the approval card from its first frame, success and its landing, a poke. Then run gates 7 and 13.
9. **Write it down.** In `tests/VALIDATION.md`: the residual differences, ordered by how visible they are at 1:1 on a 2x display, each with the crop that shows it; and a "checked and clean" list, so the next audit does not repeat work. Be honest: a difference you decided to accept is still listed. The example's list, most visible first: ears rounder than the art and missing its inner seam; the feet undersides about 25 levels lighter; the hood's roll is a smooth step plus shading, not a padded tube with an undercut, and its fibres do not interlock with the face fabric's; the art's pale hood filaments are brighter and sparser; fibre contrast on chest, leg and arm 15 to 40 percent above the art's.

## 6. The independent auditor

The builder cannot see their own defects after hours of looking; a fresh agent that has never seen the work finds them in half an hour. Use one at every major milestone and before handoff (`references/agent-operations.md` covers the mechanics).

Give it:
- the art (`assets/mascot-transparent.png`, the hero, the turnaround), the running page URL, and nothing about how the model was built;
- the owner's words about what they saw, verbatim, and the instruction to find what is still wrong before the owner does, adversarially;
- read-only rules: scratch files in one named folder, no servers started or stopped, nothing run that writes to the project (bakes, nap builds, tuners, `npm`), and "others may be editing; if two renders of the same pose differ, say so and continue";
- the render recipe: `window.mascot.freeze(state, t, { time: 0, override: { 'root.yaw': y }, look: [0, 0] })`, device pixel ratio 1 and 2, the yaw, pitch, roll and blink set of step 5, 4 to 8x nearest-neighbour crops, the scaled references for front-on comparison;
- the rubric: section 5, and "only pixel-level rendering defects and clear mismatches with the art; no taste judgements about the design; no fixes";
- a time box (about 30 minutes).

It must return a ranked list (worst first, at most about 15) where each item has: where (state, yaw, pitch or roll, density, region), what it looks like in one sentence, how visible it is at 1:1 (obvious, noticeable, or only at 4x and above), the suspected cause or layer (geometry, texture, shader, pose), and the path of an upscaled evidence crop. Then a "checked and clean" paragraph and a "not verified" list.

Triage it yourself. Obvious or noticeable at 1:1 is a blocker or major: send it back to the builder with the crop attached. Visible only at 4x and above is minor: fix it if cheap, otherwise list it as a known difference. Re-audit once with the same agent, asking for a table per earlier item (fixed, improved, unchanged) plus anything new; cap the rounds at three.

Example mascot: the first pass found seven items; the most visible was not on the seam everyone had been fixing but a bright stair-stepped line along the eyelid edges (a hard shadow step under a soft lid fringe). Others: the far eye poking past the head outline at yaw 0.9 with a grey dotted rim, a dotted outline on the far cheek, crawling iris, cheek and mouth outlines, an extra arc seam at the crown, a ruled-looking centre seam, a broken ring round closed eyes. It confirmed the seam itself clean at every yaw and density. The second pass confirmed the lid line and crown seam fixed and the centre seam improved, and found two new defects that no gate measured: a checkerboard moire on the chest cord at 246 and 350 ppu, and stretched fibres on the seated forearm.

## 7. Failure triage map

| Symptom | Run first | Likely layer | Read |
|---|---|---|---|
| Looks plastic, smooth or blotchy; fibres like clouds | gate 4 fibre bands, step 6 crops of belly and face | nap tiles, pre-emphasis, fetch blur | `references/felt-shader.md` |
| Teeth, zig-zag or white grains along the face edge when the head turns | gate 6, then gate 3 | a step in the field, or mesh cracks | `references/sculpt-fit.md`, `references/mesh-bake.md` |
| Silhouette shape wrong in one region | gate 2 bands | sculpt parameters | `references/sculpt-fit.md` |
| Features in the wrong place or size | gate 5, crops of the face window | face measurements | `references/face-kit.md` |
| Stair-stepped or crawling thin outlines, a shimmering chest mark | step 7 stability, gate 4 cord | sub-pixel detail not faded by screen frequency | `references/felt-shader.md`, `references/face-kit.md` |
| A hand or card merging with the head | gate 7 | poses, arm stretch | `references/rig-and-animation.md` |
| Pops or non-finite values in motion | gate 13, filmstrip of the transition | pose easing, state entry | `references/rig-and-animation.md` |
| 30 fps, stutter when a state first appears | gate 8 blank-page line | browser throttling, or programs compiled on first use | `references/runtime-and-performance.md` |
| Portrait and model jump when the model appears | gate 9, gate 10 framing check | framing constants | `references/runtime-and-performance.md`, `references/showcase-page.md` |
| Words hard to read or over the character | gate 11 | page palette, framings | `references/showcase-page.md` |
| State restarts while scrolling | gate 10 wiggle check | page state rules | `references/showcase-page.md` |
| GLB fails or looks wrong elsewhere | gate 12 | export | `references/exports-and-handoff.md` |
| A regenerated asset does not change anything | `node scripts/sync-public.mjs` | stale `public/` | `references/troubleshooting.md` |

## 8. Definition of done

- [ ] Gates 1 to 15 pass on the final build, run in order, with the numbers recorded; any tolerated exception (non-manifold edges, recorded fidelity misses) is named.
- [ ] Gates 10 and 11 also pass against the production build (`npm run preview`).
- [ ] The audit protocol ran in full: every edge and feature, yaw 0, +-0.3, +-0.5, 0.9, +-1.2, +-1.5, pitch +-0.35, roll +-0.3, blink frames, at 1x and 2x, magnified nearest-neighbour, with stability checks.
- [ ] Filmstrips of every transition were reviewed frame by frame.
- [ ] An independent auditor ran at least once on the final build; no blocker or major remains open.
- [ ] `tests/VALIDATION.md` lists the residual differences by visibility and what was not tested (other GPUs, other browsers, the host application).
- [ ] Nothing was run while `src/` changed, and frame-rate numbers came from a quiet machine on mains power.

## 9. Recording results in `tests/VALIDATION.md`

Write numbers, not adjectives, and date them; a reader must be able to rerun each line and compare. Template:

```markdown
# <Name> validation, <date>

Run against the dev server and the production build (`npm run build`, `vite preview` on port 4174), on <machine, GPU, browser version>.

## Page behaviour
`validate.mjs`: <n>/<n> checks pass (dev and build). `contrast.mjs` passes at 1440 x 900, 1024 x 768, 1920 x 1080, 820 x 1180, 390 x 844 (lowest settled ratio <r>:1). Console errors: <0>. `npm audit`: <0> vulnerabilities.

## Motion
Clearance (`clearance.mjs`): lowest <value> (<state>), card <value>; fails under 0.04.
Timing (`motion-check.mjs`): <n>/<n>; <fps> fps in working, approval, success, idle; worst frame <ms>; `lead` <s> s. Blank-page rate <fps>.
Random sequences: <frames> frames, <0> bad values, largest jumps arm <..>, legs <..>, root <..>, head <..>.
Poster (`view-check.mjs`): head <px>, feet <px>, axis <px>.
Filmstrips reviewed: <list of transitions>.

## Mesh (`check-mesh.mjs`)
Final: <tris> triangles, open 0, non-manifold <n>, degenerate 0. Lite: <...>.

## Seam when the head turns (`turn-check.mjs`)
2x yaw -0.5 / 0.5: mean <px>, p95 <px>, specks <n>. Info rows: <...>. Looked at by eye at 3 to 10x at <yaws, pitch, roll, dpr>: <result>.

## Fidelity to the art (`eval.mjs`, crops)
| | 350 | 246 | 123 |
|---|---|---|---|
| Body luminance percentiles live / art | ... | ... | ... |
| Finest fibre band live / art per patch | ... | ... | ... |
| Outline brightness left, right, top | ... | ... | ... |
| Seam profile mean difference | <levels> | n/a | n/a |
| Cord contrast live / art (mean) | ... | ... | ... |
Silhouette IoU front <..>, side <..>. Features: eyes <..>, cheeks <..>, mouth <..>, centroids within <units>.
Known differences, most visible first: <1>, <2>, ... (crop paths).
Independent audit: <date>, <n> items, <n> fixed, remaining: <...>.

## Files
GLB: <MB>, validator <0> errors, <0> warnings, <n> infos; <n> clips of <n> tracks. Reel: <s> s, <w x h>, 60 fps, <frames> frames, mp4 <MB>, webm <MB>. Bundle: <kB> (<kB> gzip).

These are prototype and browser checks on one machine; not tested: <other GPUs, browsers, the host application's backend, device profiling>.
```

## 10. Traps in the measuring itself

**Fidelity numbers are nonsense in every window.** Cause: the scaled references were made with `--size` (for example 1000), so the art sits in the wrong place inside the canvas `eval.mjs` builds. Fix: `python3 scripts/dev/scaled-ref.py --ppus 350,246,123` without `--size`. Verify: `ref_350.png` is 1470 px square and the luminance percentiles land within a few levels of the art.

**A gate shows the old model, GLB or tile.** Cause: the dev server served the stale copy in `public/`. Fix: `node scripts/sync-public.mjs` (it empties `public/assets` first, so deleted files go too). Verify: the served file's size matches `assets/`, for example `curl -sI http://127.0.0.1:4173/assets/mascot-animated.glb`.

**A run dies with "Execution context was destroyed".** Cause: something under `src/` changed and Vite reloaded the page. Fix: stop editing, rerun; run tuners and long gates in a tree nobody else edits. Verify: the run completes.

**Every page runs at 30 fps.** Cause: Energy Saver, Low Power Mode, a 30 Hz display, or another process rendering. Fix: plug in, stop other renders. Verify: `motion-check.mjs` prints a blank-page rate near the display rate.

**Colours in a screenshot are wrong.** Cause: the capture ran during a CSS opacity transition (the poster fade, a word fade). Fix: wait for the transition, or read the canvas with `snapshot()`. Verify: two captures a second apart agree.

**A full-page screenshot shows an empty stage, or a clipped one is offset.** Cause: the fixed WebGL stage only draws the viewport, and `page.screenshot({ clip })` takes document coordinates. Fix: capture viewport-sized shots at scroll positions (as `evidence.mjs` does) and add `scrollX`/`scrollY` to clip rectangles. Verify: the figure is where the page shows it.

**The story moves the camera in your still.** Cause: the scroll page writes `setView` whenever it ticks. Fix: add `html.capture` and neutralise the story's writes (`references/agent-operations.md`, deterministic capture). Verify: two stills of the same freeze are identical.

**A still taken right after working has a misplaced hand or card.** Cause: the seat changes the skeleton after the card's hand was measured. Fix: `freeze()` applies the pose twice; do the same in any capture code of your own. Verify: the still matches one taken on a fresh load.

**`WEBGL_lose_context` returns null the second time.** Cause: the extension object is single-use per context. Fix: keep the object from the first `getExtension` call for both `loseContext()` and `restoreContext()`. Verify: the context-loss checks in gate 10 pass.

**`check-mesh.mjs` fails a mesh that is fine.** Cause: it exits 1 for non-manifold edges too. Fix: read the counts; open and degenerate must be 0. Verify: the counts match the previous bake.
