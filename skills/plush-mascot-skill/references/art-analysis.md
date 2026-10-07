# Art analysis: what the pipeline needs from the art

Purpose: say exactly what each piece of art must show for the stage that consumes it, how to bring any master into the one registration frame every script measures in, how to build the reference pack, and how to accept or reject art with numbers and with eyes.
Everything downstream (the fit, the nap, the face, every gate) is fitted to this art, so a defect accepted here is either copied into the product or becomes a gap no tuner can close.

When to read: at the end of Phase 1 (to accept the masters), throughout Phase 2 (registration, reference pack, measurements), and whenever a later gate fails for a reason that might be in the art.

## Contents

1. The asset set and who consumes it
2. The registration frame
3. From master to canonical: the normalisation workflow
4. The reference pack
5. What the turnaround can and cannot tell you
6. Art QA, layer 1: automatic checks
7. Art QA, layer 2: the human rubric
8. Measurements to take before building
9. Example-specific constants in the scripts
10. Edge cases

Paths are relative to the project root; art paths are the `art.*` keys of `mascot.config.json` (template defaults shown). Tools under `scripts/tools/` follow the contracts in the skill's plan; confirm flags with `--help` in your copy.

## 1. The asset set and who consumes it

| Asset | Consumed by | What it must show | Minimum resolution | Common defects |
|---|---|---|---|---|
| Registered neutral front, cut out (`art.transparent`, `assets/mascot-transparent.png`) | nearly everything: `scripts/bake/refmasks.py` (front silhouette), the sculpt fit through the refs, `scripts/bake/extract-seams.py` (views `neutral`, `neutral_fold`), `scripts/bake/trace-folds.py`, `scripts/nap/build.py` (both nap pools), `scripts/dev/fit-face.py` (eye, cheek and mouth outlines, halo and rim maps), `calibrate-features.py`, `calibrate-sclera.py`, `scripts/dev/scaled-ref.py` (every evaluation, tuner run and audit), the page poster (WebP copy), `view-check.mjs` | strict front view, level camera, symmetric pose, a clear gap between each arm and the body, both soles, soft even light, fibres visible in flat regions, clean straight alpha, no floor shadow, no props | the figure at least 1157 px tall in the master (the canonical figure height), so the canonical copy is a downsample; long edge 2400 px or more is good | halo or fringe, baked checkerboard, floor shadow, cropped feet or ear tips, head tilt, eyes of different size, airbrushed fabric |
| Hero (`art.hero`) | the identity reference attached to every other generation; the human rubric; page and marketing | the character at its best: three-quarter view, one gesture, the brief's features | long edge 2400 px or more (the example's was 1254) | drift from the brief, fingers or thumbs on a mitten, softer fibres (so it is not a nap source) |
| Turnaround (`art.turnaround`) | `refmasks.py` (the profile silhouette is the middle figure), `extract-seams.py` (views `t_front`, `t_side`, `t_back`), the page's print | three separate full figures on one baseline at one scale: front, true left profile, back; clear spacing and margins | each figure about 700 px tall or more (example: 694 to 706 px, about 210 px per unit) | views touching, a three-quarter view passed off as a profile, views at different scales, feet not on one line |
| Registered profile, optional (`prompts/03b-profile-registered.md`) | replaces the sheet's profile in `refmasks.py` when that one is weak | a true 90 degree left profile, level, same scale and light as the front | as the front | the model cheats with a three-quarter view |
| Use-case vignettes (`art.useCases`) | prop modelling (headphones, laptop, card, confetti), pose targets for working, approval and success, the page | four separate vignettes in a 2x2 grid, hands in contact with the props, props countable and text-free | long edge 1536 px or more (the example's was 1536 x 1024) | text on props, extra props, vignettes spilling into each other, identity drift |
| Pose sheet, optional | pose targets per state (`references/rig-and-animation.md`) | ten poses at one scale, hands clear of the head | as the vignettes | hands overlapping the head, extra limbs |
| Expression sheet, optional | face kit expressions, lid and mouth shapes (`references/face-kit.md`) | nine frontal close-ups at one scale | long edge 2400 px or more | eyes growing between cells, forbidden features appearing |
| Macro swatches, optional (body, face, seam join, eye build) | human look-matching of the fabric shader (`references/felt-shader.md`), `art_qa.py --kind macro` (fibre width and band energy); an extra nap source only after registering its scale | flat, evenly lit, seam-free fabric; for the seam and eye swatches the construction | native maximum size, never upscaled | combed or repeating patterns, depth-of-field blur, gloss |

The hero is the beauty shot and the identity master; the registered front is the geometric and material truth. When they disagree, the front is corrected (by an edit), never the model: the whole pipeline measures the front.

## 2. The registration frame

The `frame` block of `mascot.config.json` is the contract of the canonical front image. `normalize_art.py` writes the art into it; every script reads it (JavaScript `src/frame.js`, node `scripts/lib/config.mjs`, python `scripts/lib/config.py`; some scripts still hold the default numbers, see section 9).

| Key | Example mascot | Meaning |
|---|---|---|
| `size` | 1254 | the canonical image is 1254 x 1254 px |
| `ppu` | 350 | pixels per character unit |
| `axisX` | 627.5 | column of the mirror axis in pixel-index coordinates (between columns 627 and 628; the mirror maps column c to 1255 minus c) |
| `feetY` | 1204 | the lowest row of the soles |
| `topY` | 47 | the highest row of the figure (in the example the ear tips; the crown between the ears is near row 130) |
| height | (1204 - 47) / 350 = 3.306 units | the character's height in units, derived, never stored |

Why these numbers: they are the example art's native geometry, the first image the whole pipeline was fitted to, and keeping them means every default in the code and every example value in these references stays reproducible. The derived grids follow from them: the sculpt fit works on 209, 418 and 627 px grids (a sixth, a third and a half of 1254), the final bake meshes the head on a 0.021-unit grid (about 7 px at 350 px per unit), one nap texel is 1/350 unit (`NAP_TILE = 1024 / 350` in `src/mascot-felt.js`).

Why one frame at all: every stored number is in units on this frame. Silhouette targets, feature outlines (`src/mascot-face-shapes.js`), seam and fold polylines, nap texel density, the evaluator's world-unit patches (`BODY_PATCHES`, `TONE_CELLS`, `PLATE_CELLS`, `FACE_PATCHES` in `src/lab-metrics.js`), the audit camera (world height 1.65 at the canvas centre) and the poster placement all assume it. Two images in different frames make every comparison silently offset; a frame changed after the fact invalidates every stored table. Keep the frame and move the art into it. If a new character does not fit (a very wide body at this height), let `normalize_art.py` choose a larger `topY` (a smaller figure at the same `ppu`) and write it to the config; do not change `ppu`, which ties the nap scale and the evaluation densities.

## 3. From master to canonical: the normalisation workflow

Rules, each with its reason:

- **Masters are never edited.** Keep the returned files untouched in `art/masters/` with their metadata JSON; every step below writes a copy. An edit chain softens fibres, and you will want to go back.
- **The canonical copy is always a downsample.** If the master's figure is shorter than 1157 px, normalising means upscaling, which blurs the fibres, and a blurred source gives a mushy nap tile: the plastic look starts here. Regenerate larger instead.
- **The nap wants pixels the model drew.** Never AI-upscale a fabric source: an upscaler invents fibres and the extractor bakes the invention into the product. At the canonical density the filaments should be about 1 to 2 px wide (example mascot: about 1 to 2 px wide and 5 to 20 px long, curled). If a very large master's filaments shrink below about 1 px in the canonical copy, the tile will be too smooth; regenerate the registered front at a size where they land at 1 to 2 px. Extracting from the 2x copy instead would need the tile's world size changed (`NAP_TILE` in `src/mascot-felt.js`, `PX_PER_UNIT` in `scripts/nap/build.py`, both 350-based); the example never did this, so that path is unverified.
- **Check the size you received**, not the size you asked for; some tools return smaller images silently.

The commands, in order (flags per the tool contracts; the pipeline's `art` stage runs steps 3 and 4 for you):

```bash
# 1. cut-out, only if the model returned a flat key background instead of alpha
python3 scripts/tools/alpha_extract.py key art/masters/front-keyed.png --out art/work/front.png      # background modelled from the border; --bg '#00ff00' to give it
python3 scripts/tools/alpha_extract.py verify art/work/front.png            # halo metrics on light and dark
# 2. automatic QA of the cut-out, before it is registered
python3 scripts/tools/art_qa.py art/work/front.png --kind transparent --palette mascot.config.json --report art/qa-front.json
# 3. register onto the canonical frame, keep a 2x copy for crops and audits, write frame.topY
python3 scripts/tools/normalize_art.py --in art/work/front.png --out assets/mascot-transparent.png --hires-out art/work/front@2x.png --write-config
# 4. the turnaround: split and register each view, print each view's box, axis, feet row and px per unit;
#    refmasks.py and extract-seams.py read the whole sheet at art.turnaround, so the sheet itself goes there too
python3 scripts/tools/normalize_art.py --turnaround --in art/masters/turnaround.png --out art/work/turnaround
cp art/masters/turnaround.png assets/mascot-turnaround.png
# 5. QA the registered files strictly (name them: assets/ also holds nap tiles, maps and fonts)
python3 scripts/tools/art_qa.py assets/mascot-transparent.png --kind transparent --palette mascot.config.json --report art/qa-front.json --strict
python3 scripts/tools/art_qa.py assets/mascot-turnaround.png --kind turnaround --report art/qa-turnaround.json --strict
# the pipeline's art stage re-runs the QA on the registered files
node scripts/pipeline.mjs run --only art
```

Then put the hero and vignettes at their `art.*` paths and make the page's WebP copies (768 and 1536 px wide for the sheets, a web-sized copy of the cut-out as the poster). Plain Lanczos resizing is fine for these; they are for display only.

Verify: `normalize_art.py` prints the axis, feet and top rows it found; the config's `frame.topY` matches; `node scripts/pipeline.mjs status` shows `art` fresh.

## 4. The reference pack

```bash
node scripts/pipeline.mjs run --only refs                        # or the two commands below
python3 scripts/bake/refmasks.py                                 # silhouettes for the sculpt fit
python3 scripts/dev/scaled-ref.py --ppus 350,246,123             # density-matched art for eval, tuners and audits
```

**Silhouettes (`refmasks.py`).** For the front it thresholds the alpha at 128, finds the mirror axis by testing every doubled axis column from 1180 to 1339 and keeping the best mirror IoU (example mascot: 627.5), measures the figure height (1158 px, which with the script's height constant of 3.31 units gives 349.8 px per unit). For the profile it segments the turnaround (red saturation above 45 or luminance below 95, closed, holes filled), takes the second of the four largest figures from the left, and places the body axis 0.83 units behind the profile's front-most point. Both are resampled onto the fit grid (350 px per unit at 1254, feet at y = 0, axis at column 625 of 1254) at N = 209, 418 and 627, and written to `scripts/bake/.refs/ref_{front_sym,side}[_band]_{N}.bin`. It runs in about half a second.

**Why the front is symmetrised by averaging signed distance.** The sculpt is mirror-symmetric, so its target must be too, and the art is never perfectly symmetric (example mascot: mirror IoU 0.977). Averaging the signed distance to the boundary with its mirror puts every row's edges at the mean of its left and right edges, so the target keeps the art's average width. An intersection keeps the narrower side on both sides and shrinks the target by half the asymmetry; a union inflates it. Either biases every width the fit produces. Known detail: the mirror is taken about the array centre, which sits 0.0057 units (about 2 px at 350 px per unit) right of the grid's x = 0; harmless at these IoUs, and not something to compensate in the art.

**Why bands.** Each target also gets a boundary band (dilation minus erosion with a radius of max(2, round(0.024 N)) px) that the fit scores separately. IoU is dominated by area: the example's first fit reached front IoU 0.976 while rounding its tab ears into spheres. The band term makes the contour count, which is where identity lives.

**Scaled references (`scaled-ref.py`).** The front is Lanczos-rescaled to each density and pasted so that world height 1.65 sits at the canvas centre, where the audit camera looks: `scripts/dev/.refs/ref_350.png` (1470 px), `ref_246.png` (1034 px), `ref_123.png` (600 px).

| Density (px per unit) | Stands for | Weight in the nap spectrum fit |
|---|---|---|
| 350 | the art's own density: close-ups and the fidelity reference | 0.2 |
| 246 | the showcase stage on a 2x display (a stage about 590 px tall) | 0.45 |
| 123 | the same stage on a 1x display | 0.35 |

Trap: evaluation numbers are nonsense (huge tone and fibre errors, patches landing on the background) -> the references were made with `--size`: `src/lab-metrics.js` draws each reference unscaled into a canvas of `sizeFor(ppu)` = max(600, round(ppu x 4.2 / 2) x 2) px, so any other size misaligns every window -> regenerate without `--size` -> verify the three files are 1470, 1034 and 600 px square. (The script's own usage line shows `--size 1000`; ignore it.)

**Seam and fold candidates.** `python3 scripts/bake/extract-seams.py --preview` finds thin dark creases on the body fabric with a scale-selected ridge filter, away from silhouettes and features, and writes numbered candidates per view (`scripts/bake/.seams/seams_<view>.json`) plus overlays with a unit grid (`preview_<view>.png`); you pick the real seams by id in `scripts/bake/seams.mjs`. Example mascot: 11 candidates on the front, 8 soft-fold candidates, 17, 6 and 13 on the turnaround's front, side and back; kept: the head's side seam from the side view (ids 1 and 3) and the leg fronts from the front (ids 9 and 10). `python3 scripts/bake/trace-folds.py --preview` follows broad faint folds between waypoints read off the art (the belly's lower edge in the example). What the art must show: seams as thin dark lines 1 to 3 px wide at the view's scale, with shoulders, on plain body fabric; folds as broad soft creases. Seams painted as uniform stripes, or visible only in some views, cost hand work (`references/sculpt-fit.md`).

**Face measurement.** `python3 scripts/dev/fit-face.py` segments the eye whites, cheeks, mouth and irises of the front, writes their outlines as polar tables in units to `src/mascot-face-shapes.js` and the halo and rim maps to `assets/mascot-face-halo.png` and `assets/mascot-eye-rim.png`. It needs eye whites clearly lighter than the face fabric, cheeks and mouth in a distinct warm range, an iris darker than luminance 110 with a darker pupil and a bright catchlight. Details: `references/face-kit.md`.

## 5. What the turnaround can and cannot tell you

An image model draws each view of a sheet as a picture, not as a projection of one object, so the views disagree with each other and with the registered front. Measured on the example sheet:

| Test | How | Example mascot | Reading |
|---|---|---|---|
| Height consistency | tallest / shortest view | 706 / 694 px = 1.017 | within the 3 to 6 percent the set should agree to |
| Common baseline | feet rows of the three views | 842, 845, 840 | a few px apart: register each view on its own feet |
| Front against mirrored back | IoU after aligning feet and centres | 0.954 | a rigid object would give about 1; this is drawing, not geometry |
| Sheet front against registered front | IoU after matching height, feet and axis | 0.894 | a different drawing: the arms, the head and the chest mark differ |
| Profile depth / front width | bounding boxes | 355 / 509 px = 0.70 | plausible for this body; check it against the design |
| Per-view scale | figure height / 3.31 | 210.3, 213.3, 210.0 px per unit | the profile is 1.4 percent larger |

Use it for: the profile silhouette of the side fit, the head's depth and the plate's apex (how far the face surface stands forward), the back and side construction seams, and a visual check of the back. Do not use it for: front proportions (the registered front is the truth), exact 3D positions of features (the example's front-view seams, profile and plate wrap did not agree to the pixel), colour (the sheet is graded differently, section 10), or fibre scale (210 px per unit, finer than the canonical 350).

Consequence for the fit: a side IoU plateau around 0.95 to 0.96 with a model that looks right is the sheet's inconsistency, not the model's error (example mascot: side 0.960); stop there. If the side IoU stays below about 0.93, or the profile is really a three-quarter view, generate a registered profile (`prompts/03b-profile-registered.md`) and point `refmasks.py` at it.

## 6. Art QA, layer 1: automatic checks

`scripts/tools/art_qa.py` implements these; every check reports `status` (pass, warn, fail), `value`, `threshold`, `message` and `fix`, and the report JSON is stable so the pipeline and these references can rely on it. Thresholds are calibrated so that the example art passes and deliberately damaged copies (halo added, feet cropped, blurred, JPEG-compressed, checkerboard baked in) fail. Run it on candidates, on the chosen masters and on the registered set.

```bash
python3 scripts/tools/art_qa.py art/candidates --kind auto --report art/qa.json
python3 scripts/tools/art_qa.py assets/mascot-transparent.png --kind transparent --palette mascot.config.json --report art/qa-front.json --strict
```

| Check | Kind | Why it matters | Example mascot | Fix when it fails |
|---|---|---|---|---|
| dimensions, megapixels, aspect, mode, bit depth, format | all | a wrong mode (palette PNG, 16-bit, CMYK) breaks the scripts quietly | 1254 x 1254 RGBA 8-bit PNG | re-export as 8-bit RGB or RGBA PNG |
| long edge against the recommended minimum | all | pixels are what the fit and the nap are made of | 1254 (warn: below 1600; good: 2400 or more) | regenerate at the max tier (`references/image-generation.md`) |
| JPEG origin (8 x 8 block periodicity) | all | blocks become a lattice in the nap tile | ratio 1.00 to 1.01 (a quality-60 JPEG copy of the hero: 1.49 to 1.54) | regenerate as PNG; never extract nap from a JPEG |
| background uniformity | opaque kinds | gradients break keying and the turnaround segmentation | flat warm off-white | regenerate on a flat field |
| sharpness (Laplacian variance) | all | soft art gives a soft nap | fabric pool: front 791, hero 609 | quality `high` or the other model |
| dominant palette (k-means in Lab, hex and share; delta-E against `palette`) | all | colour drift across the set | body sRGB about (214, 77, 72) against the token `#F05C63` | expect a shift from the token (lit fabric); reject only drift between images |
| real alpha present, not all 255 | transparent | a painted "transparent" background is opaque | interior alpha is mostly 253, only 383 px are 255 | ask for real alpha or a key colour |
| alpha coverage | transparent | too small or too large a figure | 46 percent of the frame | normalise; regenerate if cropped |
| bounding box margins, 4 percent or more per side | transparent | a model that crops tips cannot be repaired | the master had room; the canonical frame itself sits 47 px (3.7 percent) from the top and 50 px from the bottom by design | judge margins on the master; after normalisation the frame fixes them |
| feet inside the frame | transparent | the frame anchors on the soles | soles on row 1204 | regenerate with the margin instruction |
| fringe or halo (mean delta-E of alpha 0.05 to 0.95 pixels against the nearest opaque interior colour, on light and dark) | transparent | a halo turns into a pale or dark rim around the model and the poster | passes | `alpha_extract.py key` (unmix, despill) or `refine` |
| baked fake checkerboard (8, 16 or 32 px grey and white grid under alpha 255) | transparent | the model drew "transparency" | none | real alpha or a key colour |
| stray islands and pin-holes | transparent | islands become debris, holes become specks | one figure component above alpha 128, no holes; 152 dust specks of 1 to 17 px at alpha below 128 | `alpha_extract.py refine`, or clean in a copy |
| floor-shadow blob | transparent | the fit sculpts a slab under the feet | none | regenerate with the exclusion, or erase in a copy (section 10) |
| left/right symmetry and best axis | transparent | the fit target is symmetrised; a tilted pose distorts it | mirror IoU 0.977 at 627.5 | regenerate the registered front |
| figure height; head width / height ratio | transparent | registration and a proportion sanity check | 1158 px; head 2.23 units wide at eye height | compare with the brief's form |
| flat-region fraction for the nap and its fibre-band energy against the built-in calibration | transparent | detects "too smooth, plastic" renders before they reach the nap | 68 percent of body pixels usable (369,977 of 542,295) | regenerate with the fabric partial at quality `high` |
| number of figures (3 or 4, left to right); touching or merged; cropped at the border | turnaround | `refmasks.py` picks the profile by position among the largest shapes | 3 separate figures | regenerate with spacing, or generate views separately |
| height consistency (max/min), front against mirrored back IoU, profile depth / front width, each view's box | turnaround | section 5 | 1.017, 0.954, 0.70 | accept small drift; regenerate large drift |
| plain background, figure occupancy, stray text (small high-contrast glyph-like shapes) | hero, use-cases, macro | text and logos are forbidden and the page shows these images | none | masked edit of the region |
| quadrant occupancy | use-cases (2x2) | a vignette spilling into another cannot be cropped or modelled | four separate vignettes | regenerate with the layout instruction |
| fibre-band energy and filament width in px | macro | the swatch is only useful if its fibres are real | not generated for the example | regenerate natively; never upscale |

## 7. Art QA, layer 2: the human rubric

A script cannot judge identity, construction or whether fabric reads as real. Look at every master at 100 percent and at 3 to 8x nearest-neighbour crops, on light and dark backgrounds, beside the hero. The last column maps each item to the critique prompt (`prompts/qa-critique.md`), so a fresh reviewer's JSON and this table agree. Descriptions come from the example art.

| Item | Accept (seen in the example) | Reject | Critique criterion |
|---|---|---|---|
| Identity lock | the same head shape, tab angle, plate outline, egg-shaped eyes, cheek placement and chest mark in hero, front, sheet and vignettes | any identity carrier changed between images (a rounder head, a different tab angle, eyes that grew) | identity |
| Silhouette cleanliness | a 2 to 3 px alpha ramp, one connected figure, arm gaps of 0.03 to 0.04 units, an arch between the legs, a notch between each ear and the head | arms fused to the torso, a soft fuzzy halo wider than a few px, cropped tips | silhouette, edges |
| Material realism | matte short pile everywhere, no gloss, deep colour in creases, lighter warm fibre tips | airbrushed velvet, vinyl or silicone sheen, a glowing rim, wet highlights | fabric |
| Nap at the pixel level | at 5x on the belly, ears and face fabric: a sparse web of thin pale filaments, 1 to 2 px wide and 5 to 20 px long, curled into hooks, over a darker calmer ground, direction varying | blobby cells, embossed stucco, a combed direction over large areas, noise with no filaments; example: the hero's fibres are visibly softer (about 20 percent less fibre-band energy than the front), so it is not a nap source | fabric |
| Seam legibility | thin dark seams with a slight hand-sewn wander: the crown's centre seam, the loop sewn around the face opening, the ear's inner seam, the leg fronts, the belly's lower fold | seams painted as uniform stripes, seams that change position between views | construction |
| Eyes and face | eye whites as satin pillows that fall away in a ramp ending in a thin near-black contact line; dark brown irises with a darker pupil and one warm off-white catchlight (example: about sRGB 221, 208, 198, not pure white); a round-capped mouth cord with a contact shadow; flat appliqué cheeks with a thin dark line; the face fabric's own fibres visible | flat sticker eyes with a grey ring, pure white catchlights, glossy eyes, a painted mouth, any forbidden feature (a nose) | face |
| Neutral lighting | soft, broad, no hard cast shadows on the body, no coloured light, no rim glow; one direction you can measure (example front: body luminance viewer-left 100, viewer-right 112) | strong directional shadows that bake into the nap, hot spots, a coloured rim | light |
| Symmetry | mirror IoU about 0.97 or better, face level, eyes level | a head tilt, weight on one leg, an arm raised | silhouette |
| Hands and feet | round mittens without fingers or thumbs; feet splayed a little with soles visible | finger splits, claws, hidden or cropped soles; example: the hero's raised mitten has a thumb-like lobe, tolerable only because the registered front's mittens are plain | construction |
| Resolution and sharpness | crisp at 100 percent, the filaments resolvable, no upscaler texture | smeared fibres, JPEG blocks, oversharpening halos | artefacts |
| Originality | nothing resembles an existing character; the closest resemblance is generic | a near copy of a known mascot | originality |

Accept a master only when the automatic gate passes, the critique has no blocker, and you have looked yourself. When the script and the eye disagree, believe the stricter one.

## 8. Measurements to take before building

Measure the art once, before any fitting, and write the numbers into the project's notes: they are what the evaluator and tuners will compare against later, and they catch a wrong registration before it costs a fit.

| Measure | How | Example mascot | Compared later by |
|---|---|---|---|
| figure height, axis, feet and top rows | `normalize_art.py`, `refmasks.py` printouts | 1158 px, axis 627.5, feet 1204, top 47 | every stage |
| widths at key heights (units) | snippet below | head [-1.127, +1.104] at y 1.9, neck [-0.536, +0.547] at y 1.4, belly [-0.633, +0.650] at y 0.6, legs 0.24 apart at y 0.2 | `score.mjs`, the audit crops |
| mirror IoU and axis | `refmasks.py`, `art_qa.py` | 0.977 at 627.5 | the symmetrised target |
| feature centres and sizes (units) | `fit-face.py` printout | eye whites at x -0.433 and +0.481, y 2.13, half extents 0.175 x 0.215; cheeks at x -0.585 and +0.629, y 1.87; mouth centre x 0.017, y 1.858, cord 0.031 thick | `eval.mjs` feature IoU and centroids |
| eye size difference | same | half extents differ by 1.3 and 0.6 percent | the face kit |
| face opening outline | fitted into `FABRIC.face` of `src/mascot-fabric.js` | centre (0.019, 2.1425), half axes 0.786 x 0.516 | `turn-check.mjs`, the seam profile |
| body luminance percentiles (2 to 99) at 350, 246, 123 | `node scripts/dev/eval.mjs --ppus 350,246,123` (the reference rows) | at 350: 60 68 74 86 102 122 143 156 177 | `eval.mjs`, `tune2.mjs` |
| palette in linear light | snippet below | body mean sRGB (214, 77, 72), linear (0.691, 0.088, 0.075); face fabric sRGB (49, 41, 42) | `calibrate-features.py`, the tuner's colour gains |
| light direction | snippet below (left/right balance) and the tone cells of `src/lab-metrics.js` | viewer-right brighter (112 against 100) | the tuner's light group |
| fibre statistics | snippet below | std 8.6 and 11.5 levels at sigma 1.2 and 3; skew 0.23 and 0.24; kurtosis 3.5 and 3.9 | `eval.mjs` fibre energy, skew and kurtosis |
| nap source pools | `python3 scripts/nap/build.py` prints clean source pixels | body 369,977 px (68 percent of body pixels), face 58,198 px | tile quality |
| edge ring and seam profile | `eval.mjs` reference rows | edge ring left 143, right 146, top 150 at 350 | `eval.mjs` rim and seam |

The colour, width, balance and fibre measurements (run from the project root; the two colour rules are the template's for a saturated warm body and a dark neutral face, so edit them for your palette):

```bash
python3 - <<'EOF'
import numpy as np, cv2
from PIL import Image
PPU, AX, FEET = 350.0, 627.5, 1204.0                        # frame.ppu, frame.axisX, frame.feetY in mascot.config.json
a = np.array(Image.open('assets/mascot-transparent.png').convert('RGBA')).astype(np.float32)
R, G, B, A = a[..., 0], a[..., 1], a[..., 2], a[..., 3]
L = 0.2126 * R + 0.7152 * G + 0.0722 * B
body = (A > 250) & (R > 90) & (R > 1.3 * G) & (R > 1.3 * B)      # body rule: edit for your palette
dark = ((A > 250) & (L < 100) & (R - B < 45)).astype(np.uint8)  # face rule: dark and neutral; edit for your palette
n, lab, st, _ = cv2.connectedComponentsWithStats(dark, connectivity=8)
face = lab == 1 + np.argmax(st[1:, cv2.CC_STAT_AREA])
lin = lambda c: np.where(c <= 10.31475, c / 3294.6, ((c / 255 + 0.055) / 1.055) ** 2.4)
for name, m in (('body', body), ('face', face)):
    print(f'{name}: {m.sum()} px  mean sRGB {a[..., :3][m].mean(0).round(0)}  mean linear {lin(a[..., :3][m]).mean(0).round(3)}')
print('body luminance p2 p5 p10 p25 p50 p75 p90 p95 p99:', np.percentile(L[body], [2, 5, 10, 25, 50, 75, 90, 95, 99]).round(0))
solid = A > 128
for y in (2.2, 1.9, 1.4, 0.6, 0.2):                               # widths in units at chosen heights (y up, feet at 0)
    xs = np.where(solid[int(round(FEET - y * PPU))])[0]
    runs = np.split(xs, np.where(np.diff(xs) > 1)[0] + 1)
    print(f'y {y}: ' + '  '.join(f'[{(r[0] - AX) / PPU:+.3f}, {(r[-1] + 1 - AX) / PPU:+.3f}]' for r in runs))
cols = np.arange(a.shape[1])[None, :]
print(f'light balance, body luminance: viewer-left {L[body & (cols < AX)].mean():.1f}  viewer-right {L[body & (cols > AX)].mean():.1f}')
inner = cv2.erode(body.astype(np.uint8), np.ones((31, 31), np.uint8)) > 0
for s in (1.2, 3.0):
    hp = (L - cv2.GaussianBlur(L, (0, 0), s))[inner]; hp = hp - hp.mean()
    print(f'fibre band sigma {s}: std {hp.std():.2f}  skew {(hp ** 3).mean() / hp.std() ** 3:.2f}  kurtosis {(hp ** 4).mean() / hp.std() ** 4:.2f}')
EOF
```

Why linear light: the shader multiplies light, so colour corrections are ratios of means in linear light (the calibration scripts work this way); an average of sRGB values is biased toward the dark end. Why the brand token differs from the measurement: the token is the designer's colour, the measurement is lit, shaded fabric; never overwrite a token with a sampled pixel.

## 9. Example-specific constants in the scripts

These scripts contain numbers measured on the example art. A new character's art needs them re-measured (the template is moving some of them into `mascot.config.json`; check what your copy reads). The full change list is in `references/adapting-to-a-new-character.md`.

| Where | Constant | Example value | Re-derive from |
|---|---|---|---|
| `scripts/bake/refmasks.py` | `HEIGHT_UNITS` | 3.31 | should equal (feetY - topY) / ppu of your frame |
| `scripts/bake/refmasks.py` | profile axis offset | 0.83 units behind the front-most point | the head's half-depth at eye height, measured on your profile |
| `scripts/bake/refmasks.py`, `extract-seams.py`, `nap/build.py`, `fit-nap-spectrum.py`, `audit.py`, `src/lab-metrics.js` | colour rules | body: alpha > 250, R > 90, R > 1.3 G, R > 1.3 B (1.2 in `extract-seams.py`); face: luminance < 95; turnaround: red saturation > 45 or luminance < 95 | your palette (the config's `segmentation`) |
| `scripts/bake/extract-seams.py` | `VIEWS`: crop box, axis, feet row, px per unit per view; the chest-mark exclusion disc at 1.164 units height, radius 0.17 | front 627.5 / 1204 / 349.8; sheet views 210.3, 213.3, 210.0 px per unit | `normalize_art.py --turnaround` printout; your chest mark |
| `scripts/bake/trace-folds.py` | registration and the fold waypoints | 627.5, 1204, 349.8; the belly fold's seven points | your art's fold, read off the ridge preview |
| `scripts/nap/build.py` | chest-mark exclusion circle | (650, 800) px, radius 80 | your chest mark's position and size |
| `scripts/dev/fit-face.py` | seed centres of eyes, cheeks, mouth; colour thresholds | eyes (-0.436, 2.136) and (0.523, 2.129); cheeks (-0.567, 1.865) and (0.63, 1.861); mouth (0.039, 1.875) | rough centres of your features in units |
| `src/lab-metrics.js` | patches and tone cells in world units | `BODY_PATCHES` belly, chest, leg, arm, ear, crown | plain body-fabric windows of your art |

## 10. Edge cases

Each as symptom -> cause -> fix -> how to verify.

- **Semi-transparent fibres and garbage colour under low alpha.** A dark or coloured fringe after compositing, or speckled yellow and green dots around the figure in a preview -> colour stored under near-zero alpha is meaningless (example: 17,556 pixels with alpha 1 to 9 carrying pure primaries such as (255, 0, 0)), and converting RGBA to RGB without compositing (Pillow's `convert('RGB')`) reveals it; premultiplying twice darkens real fibres -> treat colour below about alpha 0.05 as undefined, always composite straight alpha over a background, let `alpha_extract.py refine` decontaminate edges -> the preview sheet on white, black and grey shows no rim, and the halo check passes.
- **Interior alpha below 255.** A threshold of 255 finds almost no "opaque" pixels -> image models write near-opaque interiors (example: 641,835 of 727,610 figure pixels have alpha 253, only 383 have 255) -> use the scripts' convention, alpha above 250 is opaque and above 128 is silhouette; do not snap alpha in the master -> the nap pools and the silhouette have the expected pixel counts.
- **Floor shadow baked into alpha.** A semi-transparent blob under the feet; the feet row lands below the soles; the fit grows a slab -> the model painted a contact shadow -> regenerate with the exclusion (the cut-out partial forbids it), or in a copy erase low-alpha pixels below the soles that connect to the figure's bottom, then normalise again -> the floor-shadow check passes and `feetY` is the soles' row.
- **JPEG origin.** A faint grid in the nap tile, block periodicity above about 1.2 -> the model or a relay returned JPEG, or someone re-saved it -> regenerate as PNG or lossless WebP -> ratio about 1.0.
- **sRGB against wide gamut.** Colours shift between viewers or after conversion -> the file carries a Display P3 (or other) ICC profile, while every script treats 8-bit values as sRGB -> convert the derived copy to sRGB with its profile (Pillow `ImageCms`) before normalising; keep the master as delivered -> no profile or an sRGB profile in derived files; the palette check agrees across the set. The example files carry no profile.
- **Colour grade differs between the images of one set.** The tuner fights a colour you calibrated to another image -> each generation is graded differently (example body means: front sRGB 214, 77, 72; hero 205, 88, 78; sheet 208, 88, 75; vignettes 212, 86, 76) -> decide that the registered front is the colour truth (the evaluator and tuners compare against it) and record the decision; do not average images -> one colour target in the notes.
- **The prompted light direction was not honoured.** The fitted rig lights the wrong side -> models do not reliably follow "key from the upper left" (example: both hero and front are brighter on the viewer's right) -> measure the registered front's balance and tone cells and fit the rig to that (`references/felt-shader.md`) -> the tuner's tone cells agree on both sides.
- **Props in the registered front.** The fit tries to sculpt a laptop -> the front was generated with a prop -> regenerate the front without props; props belong to the vignettes -> the silhouette has no foreign shapes.
- **Asymmetric pose.** Mirror IoU below about 0.95, a lopsided symmetrised target -> head tilt, weight shift, a raised arm -> regenerate the registered front (strict symmetric pose) or edit -> symmetry check passes.
- **A sheet whose views touch.** `art_qa.py` counts 2 figures; `refmasks.py` takes the wrong shape as the profile (it picks the second of the four largest from the left) -> dense layout -> regenerate with spacing, or generate front, profile and back separately and normalise each -> three separate components with margins.
- **Background with a gradient or a floor plane.** A halo on one side after keying, background included in the sheet segmentation -> vignette, gradient, floor -> regenerate on a flat field; `alpha_extract.py` estimates the background from the border and cannot model a gradient -> the background uniformity check passes.
- **Tiny text or logos.** Glyph-like marks on the chest, a prop or the background -> brand context in the prompt -> masked edit of that region, or regenerate; never leave text in the registered front, where the nap and seam extractors would pick it up -> the stray-text check passes and a 100 percent look finds nothing.
- **Eyes of different sizes.** The face kit reproduces the asymmetry, and it reads as a wink -> model asymmetry -> edit the smaller or larger eye to match the hero; tolerance a few percent (example: 1.3 and 0.6 percent) -> `fit-face.py` printout.
- **Two fabrics too similar in colour.** Nap pools bleed across the face opening; the plate's edge shows up as a seam candidate; the face mask fails -> body and face colours (or luminances) are close, and the scripts segment by colour -> choose a strong value step in the brief; otherwise edit the colour rules (section 9) or supply masks -> overlay the masks on the art and look.
- **A master smaller than the canonical figure.** Normalising would upscale -> the tool returned less than requested, or a small built-in size was used -> regenerate larger; if impossible, accept the lower nap ceiling and say so in the handoff -> the figure is at least 1157 px tall in the master.
