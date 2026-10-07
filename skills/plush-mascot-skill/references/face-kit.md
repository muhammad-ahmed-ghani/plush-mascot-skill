# Face kit

Purpose: how the eyes, lids, blinks, cheeks, mouth and chest mark are measured from the artwork and built as small pieces of construction that land on the art's outlines, move, and blend into the face fabric.
When to read: phase 7 (face), when a feature sits in the wrong place, looks like a sticker, blinks mechanically or shows specks at its edge, and before changing the eye design.

## Contents

1. The face is construction, not a texture
2. Files and data flow
3. Measuring the features from the art
4. Eyes
5. Blink model
6. Cheeks
7. Mouth
8. Chest mark
9. The missing nose, and adding a feature
10. Edge blending
11. State to expression table
12. Traps
13. Other eye designs
14. Acceptance gates and commands

Conventions: units are character units (the registration frame's `ppu` pixels per unit; 350 for the example art). "L" is the character's left, which is the viewer's right (+x); "R" is the viewer's left. All example numbers are the example mascot's; section 14 says how to measure your own.

## 1. The face is construction, not a texture

Zoom into the example art at 4x and the face is a set of felt pieces with thickness: egg-shaped cream eye whites that sit in pockets of the dark face fabric (their edge falls away in a ramp that ends in a thin dark line), flat felt irises with a cut edge and a small grey button catchlight, cut-felt cheeks with a thin dark contact line, a raised pink cord for the mouth with round ends, and a wound cord on the chest lying in a trench. The face fabric around them is lit unevenly by them: darker above and beside the whites, brighter below.

A texture painted onto the head cannot do that under moving light and a turning head: no parallax, no contact shadows that shift, no lids that close over a dome, no mouth that changes shape. Every early attempt that used flat decals or uniform outlines read as a sticker in side-by-side crops. So each feature is a piece: a fabric plate (the head's face fabric, `references/felt-shader.md`), sculpted eye pillows with lids, appliqué pieces (iris, pupil, catchlight, cheeks) and cords (mouth, chest mark). Shapes and positions come from the art (`scripts/dev/fit-face.py`), anchors are points on the baked head surface, and all pieces live under the head bone (the chest mark under the chest bone) so they move with it.

## 2. Files and data flow

| Step | File | Output or role |
|---|---|---|
| Measure outlines and maps | `scripts/dev/fit-face.py` | `src/mascot-face-shapes.js` (`FACE_SHAPES`, `ARTWORK_VIEW`), `assets/mascot-eye-rim.png`, `assets/mascot-face-halo.png` |
| Anchor on the head | `scripts/bake/bake.mjs` (`anchors`, `artworkPoint`) | `anchors` in the mesh header (`eyeL eyeR cheekL cheekR mouth chestX`) |
| Feature colours | `scripts/dev/calibrate-features.py` | `FEATURE_GAIN` in `src/mascot-face.js` |
| Eye-white shading | `scripts/dev/calibrate-sclera.py` | `assets/mascot-sclera-shade.png` |
| Assemble the face | `src/mascot-face.js` (`buildFace`) | eyes, cheeks, mouth, chest mark; `setGaze setLids setSleep setMouth setBlush setPixelSize setCord` |
| Pieces | `src/face/eye.js`, `src/face/cheek.js`, `src/face/mouth.js`, `src/face/footprint.js`, `src/face/textures.js` | geometry, materials, canvas textures |
| Drive | `src/mascot.js` (blink, glances, lid follow), `src/mascot-pose.js` (`f.*` keys per state, `REST_GAZE`) | per frame |
| Plate response | `src/mascot-fabric.js` (halo uniforms) | the face fabric around the features |

`FACE_SHAPES` and the maps are generated; do not edit them by hand. After `fit-face.py`, rebake (anchors are baked from the shapes) and run `node scripts/sync-public.mjs` (the dev server serves `public/` first).

## 3. Measuring the features from the art

```bash
python3 scripts/dev/fit-face.py        # about 10 s; deterministic (re-running reproduces the shipped files byte for byte)
node scripts/bake/bake.mjs --quality final && node scripts/bake/bake.mjs --quality lite && node scripts/sync-public.mjs
```

It prints, per feature, the centre, the half extents and the polar IoU (how well the smooth polar outline matches the colour mask). Example: eyes 0.988 and 0.986, cheeks 0.965 and 0.962.

**3.1 Segmentation** (colour rules inside an elliptical search window around a seed position; the seeds are in `main()`, so a new character changes them):

| Feature | Rule | Window (units) | Clean-up |
|---|---|---|---|
| Eye white | `R > 135, G > 110, B > 90, R >= G, L > 120` | 0.24 x 0.28 | close 5 px, largest component, convex hull (iris and lids never poke out of the outline) |
| Cheek | `R > 150, G > 70, R - G > 40, G > 0.35 R, L > 90` | 0.16 x 0.12 | close, largest, holes filled |
| Mouth | `R > 140, G > 70, R - G > 40, G > 0.3 R, L > 85` | 0.2 x 0.12 | close, largest |
| Iris | `L < 110` inside the eye | eye | close 9 px, largest, filled |
| Pupil | `L < 19.5` inside the iris | iris | open 3 px, largest, filled |
| Catchlight | `L > 150` inside the iris | iris | largest |

**3.2 Polar outlines.** Each eye white and cheek is stored as `rho[k]`, the distance from its centre to the boundary on 72 rays, found by bisection on the mask's signed distance (sub-pixel), then low-passed to 12 harmonics because the outlines are smooth eggs, not ellipses. The centre is re-estimated once from the polar outline instead of the pixel centroid. `rx`, `ry` are the half extents. Geometry is built on these tables (`outlinePillow` in `src/face/footprint.js`), so the pieces land on the art's outlines exactly.

**3.3 The eye edge and its rim ramp** (`refine_eye_edge`). A colour threshold puts the edge in the wrong place, because the art's whites fall away in a ramp that ends in a dark line, and the ramp differs round the eye (wide along the top, narrow at the side, absent where the lower edge is lit). Per ray, the luminance profile across the edge (in linear light, since the shader multiplies light) is searched for a dark line (then the piece ends 0.0012 outside its darkest point) or, where there is none, for where the ramp meets the fabric's level. Rays where the iris touches the edge are skipped; the corrections are clamped, median-filtered (a fibre gap must not make a bump) and smoothed to 14 harmonics. Then, inside the final outline, 64 samples over the first 0.03 units per ray give the ramp relative to the white's interior; missing rays borrow their neighbours. The result is `assets/mascot-eye-rim.png`: 64 columns (distance inside the edge) by 72 rows (angle), R = the viewer's-right eye, G = the viewer's-left eye, values sqrt-encoded (the shader squares them).

**3.4 Iris, pupil, catchlight, mouth.** Iris, pupil and catchlight are fitted ellipses (`cv2.fitEllipse`) with their mean colours. The mouth is a centre line `y = y0 + k (x - xc)^2` fitted to the mask's column midpoints, a band `thickness` measured across the band (not vertically), and its extent `x0 .. x1`.

**3.5 The halo map** (`build_halo_map`). The ratio of the face fabric near the features (blurred over 0.010 units to remove fibres, excluding a 0.004 line zone at each outline) to the fabric's own smooth base further away (blurred over 0.09 units, more than 0.115 from any feature and 0.05 in from the hood seam), per RGB channel in linear light. It is clipped to 0.12 to 2.4, inpainted across the line zone and under the features, faded to 1 within 0.05 to 0.09 of the plate edge (the hood seam's own shading rules there) and between 0.075 and 0.115 from the features. It is stored on an atlas (example: x from -0.75, top at y 2.42, 1.5 x 0.78 units, 0.0035 units per texel, 429 x 223 px) as `value = ratio / 2.5 x 255`, so 102 means 1.0. (Two comments, in `fit-face.py` and `makeHaloMap`, say 128 = 1.0; the code writes and the neutral fallback uses 102.)

**3.6 The art's view and the anchors.** The art is matched as seen by a near-orthographic camera (fov 6 degrees at 350 ppu, looking at y 1.65) from `ARTWORK_VIEW.distance` (39.99 units: the audit camera's distance at 350 ppu and a 1467 px canvas). A piece standing z in front of the body's axis plane appears `D / (D - z)` larger in that view, and the plate tilts away below the eyes (about 36 degrees at the cheeks), which foreshortens anything laid on it. Two things undo that: `artworkPoint` in `bake.mjs` iterates a surface march with the magnification, so each anchor is the point of the head surface that the art shows at the feature's measured centre; and `fitToArtworkView(group, D)` gives each face group an oblique frame whose x and y read as image coordinates and whose z points at the viewer, so a dome, an iris or a cord standing h above its footprint appears exactly h above it in the neutral view. From every other view the pieces parallax as real objects do. The chest mark is anchored directly (`chestX: marchZ(body, 0.021, 1.164)` in `bake.mjs`, example-specific).

**3.7 Colour calibration.** Feature colours are fitted in linear light, not picked, because the studio light changes apparent colour and the art's colours are what must come out.

```bash
node scripts/dev/audit.mjs --ppu 350 --out /tmp/live350.png
python3 scripts/dev/calibrate-features.py /tmp/live350.png            # prints art vs live linear RGB and the correction
python3 scripts/dev/calibrate-features.py /tmp/live350.png --apply    # multiplies FEATURE_GAIN by a damped (0.8) correction; repeat to ~1.00
node scripts/dev/audit.mjs --ppu 350 --size 1467 --out /tmp/live350-1467.png
python3 scripts/dev/calibrate-sclera.py /tmp/live350-1467.png         # folds a damped correction into the shade map; repeat until the error stops shrinking
```

`calibrate-features.py` compares the same windows of the art (`scripts/dev/.refs/ref_350.png`) and the render for the mouth, cheeks and eye whites, keeping only pixels of that feature (colour rules, opened 3 px, eroded 5 px off anti-aliased edges). `calibrate-sclera.py` needs the 1467 px render (it asserts the size) because an odd canvas puts the art's half-pixel axis (627.5) exactly on the render's centre; it measures the art-to-render luminance ratio over each white (more than 0.02 inside the outline, away from the iris, pupil and catchlight), smooths it, samples it on a 64 x 64 grid over plus or minus 1.25 of the eye's unit frame, and folds it into `assets/mascot-sclera-shade.png` (R viewer's-right eye, G viewer's-left, ratio = 0.5 + value / 255). Why a measured map: lighting a dome gives the trend of the art's whites (warm shade at the top and outer edge, lit toward the lower inside) but not the painting. Example after convergence: corrections 1.000 to 1.007; sclera error (mean absolute log ratio) 0.022 and 0.040.

**3.8 Accuracy achieved.** Measured on the render at 350 ppu with the same segmentation as `fit-face.py` (the check in section 14): IoU eyes 0.989 and 0.977, cheeks 0.962 and 0.956, mouth 0.913; centroids within 0.005 units (the mouth's x is the worst at -0.005). The mouth's IoU is lower because it is a band about 11 px thick at 350 ppu, where one pixel of width moves IoU by several percent.

## 4. Eyes

`src/face/eye.js`, `buildEye(tag, anchor, shape, iris, REST_GAZE, kit)`. Everything is in the eye's frame: origin at the measured outline's centre, x and y scaled so the outline is the unit disc (the "unit frame"), z toward the viewer.

**4.1 The white (sclera).** A pillow over the measured outline (`outlinePillow`, `n = 4.6`, 30 rings, 96 segments): height `z = (1 - t^n)^(1/n)`, flat on top, rolling over only in the last few percent of the radius, scaled to `(rx, ry, 0.034)` and sunk 0.004 so its rim sits just below the face fabric (the pocket). Satin cream felt: `MeshPhysicalMaterial` roughness 0.84, sheen 0.55, `specularIntensity` 0.18, a faint emissive lift, a canvas-painted brushed hatch (`scleraTexture`), colour white times `FEATURE_GAIN.sclera` times a per-eye tint and gain (the art's two whites differ; example L 1.06 with (1, 1.046, 1.053), R 0.9 with (1, 0.904, 0.841)). The per-vertex `aEdge` (distance inside the measured outline) indexes the rim ramp; the ramp and the shade map multiply the displayed light after tone mapping, because both were measured on the art's pixels and the whites sit on the tone curve's shoulder. The ramp's darkest values are the dark contact line: no separate outline mesh is drawn around the eye (uniform ribbons read as a sticker and were removed). The white draws first (`renderOrder -1`) because it writes the stencil.

**4.2 Iris, pupil, catchlight.** Flat felt appliqués in a `gaze` group that rides the white's dome. The iris is a unit-disc pillow (flat top, tiny rounded edge, 0.011 thick) scaled to the measured ellipse, with a canvas texture (dark chocolate felt warming half way out, fine radial streaks, a black outline, a copper hairline cut edge on the side facing the window, the top darkened as if by the upper lid). The pupil is a plane 0.0125 above the iris with a slightly soft edge (the art's has no razor edge), scaled 1.08 times the measured ellipse. The catchlight is a light-grey felt disc with a fine near-black outline and a soft shadow ring, 0.0142 above: a raised button, not a glowing highlight (a pure white glint read as CG). Polygon offsets (-2, -4) and render orders (3, 4) keep the stack in order at the camera's tight depth range.

**4.3 Stencil clip.** The iris, pupil and catchlight must stop at the white's outline, including when the gaze pushes them to its edge. A per-pixel `discard` at the outline staircased and let specks of white through. The stencil is exact: the white writes 1 wherever it is drawn (`stencilFunc Always, stencilZPass Replace`), and the pieces draw only where the stencil equals 1 (`stencilWriteMask 0`). The clip edge is then the white's geometry edge, which is multisampled like any other. Requirements: the renderer is created with `stencil: true`; the white draws before the pieces; nothing else writes stencil value 1.

**4.4 Lids.** Two copies of the eye dome in the face fabric (`createFabricMaterial({ useFace: true, forceFace: true })`), 1.5 times as tall as the white so they cover the iris, sunk slightly, visible only when their closure exceeds 0.002. Each lid's rest-space matrices (`uLidToRest`, updated in `onBeforeRender`) map it into the plate's rest space, so its nap continues from the plate's across the eye's edge instead of starting fresh. The free edge is cut in the fragment shader, so it can be curved: in the unit frame it is `cut + arch (1 - x^2)`, rotated by the tilt; its anti-aliased alpha uses `fwidth` of the distance from the edge (the material is transparent only for that soft edge; it is opaque elsewhere and writes depth), and the `discard` of the uncovered part comes after the nap fetch (trap 12.8). Along the free edge a rolled lip brightens (`uLidLip 0.25` at 0.11 over 0.09, unit frame) and a dark seam sits right at it (`uLidSeam 0.9`, width 0.045); a soft dark contact ring runs along the eye's outline where the lid meets the plate (0.6 times `uLidRing`, 0.007 units wide). Seam and ring are drawn as crevice, so they take light from every term.

Lid geometry (`LID` in `src/mascot-face.js`): the top lid's cut runs from +1.16 (clear) to -1.16 (covering everything) as its closure goes 0 to 1, the bottom lid the other way; the top lid's arch is -0.16; the bottom lid's arch goes from -0.1 at rest to +0.34 when a smile pushes it up (a happy squint arches). In a blink both lids reach the same seam, a shallow smile-curve at -0.30 below the middle, the way a closed eye looks; the top lid therefore travels 56 percent of the way and the bottom 44. Near full closure the lids overlap by 0.04 so no sliver of white shows between their soft edges. `setLids(top, bottom, tilt, blink)` never closes a lid less than the state asks for.

**4.5 Lid shadow.** Every eye material receives the lids' soft shadow (`receiveLidShadow`): `max(uLidAmt.x exp(-dT / uLidShadowW), uLidAmt.y exp(-dB / uLidShadowW))`, dT and dB the distances below the top lid's and above the bottom lid's free edge in the unit frame, penumbra `uLidShadowW = 0.2`, strengths 0.82 (top) and 0.6 (bottom) fading in as each lid starts to close (closure 0.02 to 0.16). It applies at full strength up to the edge and beyond it under the lid: a shadow that stopped at the edge let the lit white show through the lid's anti-aliased fringe as a bright stair-stepped line. It multiplies the displayed light, so a bright white shades as much as a dark iris. The pieces are also discarded where a lid covers them, 0.03 inside the lid's free edge, so the lid's soft edge always blends over iris, never over a gap.

**4.6 Gaze.** `setGaze(x, y, cv)` with x, y in -1..1. Each eye adds or subtracts the convergence `cv` (positive turns both irises toward the nose), then the iris group moves `0.42 rx` horizontally and `0.36 ry` vertically at full gaze (radius capped at 0.97), sits on the dome at that point and tilts with its slope. A fixed per-eye bias makes the neutral pose reproduce the art: at the rest gaze (example: x -0.375, y 0.24, toe-in 0.575, `REST_GAZE` in `src/mascot-pose.js`) the iris lands exactly on its measured centre. The example art's eyes are slightly toed in and glance up; the rest gaze keeps that.

**4.7 Eyes and head, eyes and lids.** The pointer target is smoothed (rate 7 per second); the gaze keys ease fast (18 per second) and the head rides slower springs, so the eyes lead and the head follows. Idle glances (`_stepGlance`, seeded): every 0.7 to 3.3 s a new target, 30 percent of them large (up to plus or minus 0.25 across, 0.17 up and down) and the rest small (0.07, 0.05), 35 percent back to straight ahead, reached at saccade speed (rate 26 per second). When the eyes look down the upper lid rides the eyeball: its closure is at least `0.16 x max(0, -gy)`, as in a real eye.

**4.8 Sleep.** `setSleep(k)`, k from 0 (awake) to 1: the pillows sink flat (height times `1 - 0.9 k`), the lids' contact ring fades, the iris group hides past 0.5, a calm closed-eye arc (a cream tube along a shallow curve) fades in between 0.55 and 0.95, and the plate's halo around the eyes fades out (a closed eye has none). The `f.sleep` key eases slowly (rate 5), so falling asleep reads as settling.

## 5. Blink model

`BLINK = { close: 0.08, hold: 0.035, open: 0.19 }` seconds and `blinkAmount(t)` in `src/mascot.js`:
- close, 80 ms: `u^2 (3 - 2u) (0.6 + 0.4 u)`, a smoothstep that accelerates into the closure;
- hold, 35 ms, fully closed;
- open, 190 ms: `(1 - u)^2.2`, quick at first, then a soft landing.
The asymmetry (fast fall, slower soft rise) is what reads as alive; a symmetric blink looks mechanical.

Scheduling (`_stepBlink`): the first blink at 2.2 s, then every 2.4 to 6 s (`2.4 + random x 3.6`), 16 percent of them doubled (the second 0.12 s after the first ends); on a state change, half the time a blink 0.12 to 0.32 s later (a change of mind is often marked by one); `poke()` blinks at once. The random numbers come from a seeded generator (`seed` option, default 20260930; the lab uses 1), so recordings and tests repeat exactly. No blinks in `resting` or under reduced motion; `freeze()` holds the eyes open unless given `blink` (0..1), which is how stills of a closure are made (`lab.html?blink=0.5`).

Expressive lids use the same machinery: heavy upper lids while thinking (`f.lt 0.16`), a raised lower lid and arch for a smile (`f.lb 0.12` in greeting, 0.2 in success), a concerned tilt with the outer ends raised (`f.tilt 0.9`, `f.lt 0.14` in error), fully closed and sunk while resting.

## 6. Cheeks

`src/face/cheek.js`. A flat pink felt appliqué: a pillow over the measured outline (`n = 5`, 0.013 high, sunk 0.003), the cheek fabric material (the body shader with pink colours times `FEATURE_GAIN.cheek`, low relief), and a dark contact line: a flat disc of the same outline grown by `CHEEK_RIM = 0.0038` units, drawn just above the plate in `lineMaterial` (`#1c0f10`, near black with a trace of warmth, polygon offset). `setBlush(v)` swells the cheek about its centre (`0.85 + 0.15 v`; 1 is the art's size at the neutral blush).

Contact lines a few thousandths of a unit wide fall under a pixel on a small display, where multisampling breaks them into dots that crawl as the head turns. `setPixelSize(unitsPerPixel)` (called by `_updateNapZoom` with the current pixel size) widens both the cheek and mouth lines to at least 1.1 pixels. Example: at 350 ppu the measured 0.0038 holds; at 246 ppu the line becomes 0.0045, at 123 ppu 0.0089.

## 7. Mouth

`src/face/mouth.js`. A felt-wrapped cord bent into the measured smile, rebuilt on the CPU (64 x 16 vertices per tube) whenever the expression changes, so it can smile, frown, narrow and open smoothly.
- Cross-section: an ellipse (`SQUARE 2`) whose height is 0.75 of its radius (`FLAT`), a flat-topped ribbon with rounded edges; radius `thickness / 2 x 1.07` (the measured band plus what the rolled edge hides).
- Shape: `smile` scales the sag of the art's parabola (0.55 is the neutral face, where the lowest point is the anchor; the mid-height stays put as the ends rise and fall); `width` is the cord's overall length (rest `x1 - x0`); `open` 0..1 drops a second, 0.9-radius cord below and fills the gap with a dark inside (`#1b0d0c`).
- Round-capped ends: the radius follows a quarter circle over the last radius of arc length, a cord end, not a brush stroke.
- Contact shadow: a near-black flat tube `MOUTH_RIM = 0.0056` wider than the cord, shifted up by 0.0014 (the art's line is heavier above the cord), widened by `setPixelSize` like the cheeks'.
- Underside: per-vertex AO darkens the downward-facing half by up to 30 percent (`AO_DOWN`), because the light is overhead and the art's cord falls off by about a third.
- Speech: `speaking` drives `f.mo` from `setVoiceLevel(0..1)` or, without a voice, a synthetic envelope; `f.mo` eases at 42 per second so it follows syllables.
- The plate's halo around the mouth was measured with the mouth at rest, so it fades as the mouth leaves that shape (`uHaloMouth`, from the deviation in smile, width and opening).

## 8. Chest mark

The example's mark is an X of two wound cords lying in a trench (`buildFace`, block "chest X", in `src/mascot-face.js`; textures in `src/face/textures.js`).
- Bars: capsules of radius 0.024 (straight part 0.1936), flattened to 0.8 in depth, at plus and minus 45 degrees, one bar passing over the other (z 0.0045 and 0.0065).
- Wraps: `THREAD_WRAPS = 31` fine ridges across each bar (measured on the art: about 2.9 px pitch over a cord about 90 px long). The pitch wanders a little and the wrap-to-wrap contrast varies from 0.3 to 1.8, as a hand-wound cord does. The wraps read through albedo (a shade deeper in the groove, lighter on the crest, in the body's own red: the mark is tone on tone) as well as bump (`bumpScale 13.08`), because bump alone averages to a faint hatch at display size.
- Trench: a slightly wider capsule (radius 0.030) in a deep red basic material, almost flat, offset a few thousandths up and to the viewer's left, the side where the art (painted as lit from the upper left) shows the trench's shadowed wall.
- The nap extraction excludes the mark's region from its source pool (`references/felt-shader.md`, section 3.1).

What went wrong on the way: a flat pale sticker; zebra stripes too contrasty; ridges running diagonally instead of across the bar; a contact shadow as a dark blob; and a round shading disc under the X, which the owner saw as a rounded halo around the mark (removed: only the per-bar trench remains).

Moire and aliasing: the wraps are about 2.7 px apart at 350 ppu and under a pixel at 123, where sampling them and differencing the bump aliased into a shimmering checkerboard. The thread material fades them by their own screen-space frequency (wraps per pixel from the uv's derivatives along the cord, fading between 0.40 and 0.50 wraps per pixel) into the cord's mean colour, and scales the bump by the same fade (patched through `THREE.ShaderChunk.normal_fragment_maps`, see `references/felt-shader.md` trap 10.2). That is why the eval's cord contrast reads 1.7 against the art's 8.8 at 246 ppu: the rescaled art keeps faint aliased stripes; a plain cord of the right mean colour is the correct answer. The cord's amplitude, bump and brightness are the tuner's `cord` group, measured along the "/" bar.

To replace the mark (a patch, a button, an embroidered sign): build it as construction too, an appliqué over a measured polar outline (like the cheeks) or a cord along a measured curve (like the mouth's `writeTube`); anchor it in `anchors()` of `scripts/bake/bake.mjs`; move the exclusion circle in `scripts/nap/build.py`; move or remove the cord metric (`cordContrast` positions in `src/lab-metrics.js`, `cord_profile` in `scripts/dev/audit.py`). To remove it: delete the block in `buildFace` and `mats.thread`, then also the thread reads in `src/lab-ctrl.js` (`getParams` reads `rig.face.mats.thread`, `setParams` calls `setCord`), the `cord` group in `tune2.mjs` and its keys in `apply-tuned.py`, the cord term of the loss, and the exclusion circle.

## 9. The missing nose, and adding a feature

The example design has no nose, so the model has none. When the owner asked for "lips, nose etc." to blend perfectly, the answer was to perfect the features the art has, because adding a feature the art does not show breaks fidelity to the art. If your brief requires a feature (a nose, freckles, brows, a tooth):
1. Put it in the art first (regenerate or edit the registered front), since everything is measured from it.
2. Segment it in `fit-face.py` (a mask function, a seed, a colour rule) and store its outline in `FACE_SHAPES`; add it to the halo map's feature list.
3. Anchor it in `anchors()` (`scripts/bake/bake.mjs`), build it as construction in `buildFace` (a pillow, an appliqué or a cord) inside a `fitToArtworkView` group, give hand-built geometry neutral `ao` and `curv` attributes (`neutralAttributes`).
4. Add a colour window to `calibrate-features.py`, a pose key if it moves, and it to the IoU check in section 14.
A nose that must stand out of the head (a snout) is sculpt, not face kit: `references/sculpt-fit.md`.

## 10. Edge blending

- Face to eye: the white sinks into a pocket (0.004 below the fabric), its rim ramp and dark line come from the art per angle, the lids' contact ring covers the join when a lid is down, and the plate's measured halo darkens above and beside the white and brightens below it.
- Face to cheek and mouth: thin contact lines of the measured width (never under a pixel), the pieces' own low relief, and the halo's brightening around them. Without the halo the pieces looked pasted on (the eye-edge error fell from 0.27 to 0.08 when the measured map replaced a lighting-based guess).
- Hood to plate: the rolled lip, crevice and tuck are in `references/felt-shader.md`, section 5.8.

## 11. State to expression table

Keys (`src/mascot-pose.js`): `f.gx f.gy` gaze, `f.cv` convergence, `f.lt f.lb` upper and lower lid closure, `f.tilt` lid tilt, `f.smile` (0.55 neutral), `f.mw` mouth width, `f.mo` mouth open, `f.blush`, `f.sleep`. Rest values: smile 0.55, width 0.2857, blush 1, convergence 0.575, gaze = pointer plus the rest gaze. Ease rates per second (`RATE` in `src/mascot.js`): `f.lt 24, f.lb 14, f.mo 42, f.gx f.gy 18, f.tilt 10, f.sleep 5`, others 11. Example values (t = seconds into the state, s = its ease-in):

| State | Eyes and lids | Mouth |
|---|---|---|
| idle | rest gaze, blinks, glances | smile 0.55 |
| greeting | lower lid 0.12 (smiling squint) | smile 0.95 |
| listening | gaze 0.4 times the pointer | smile 0.5 |
| thinking | glance up and aside (-0.55, 0.62), upper lid 0.16 | smile 0.15, width 0.229 |
| working | eyes down to the screen, upper lid follows the gaze | smile 0.55 easing to 0.43, slightly narrower |
| approval | gaze toward the card (0.45) | smile 0.5 |
| success | lower lid 0.2 | smile 1.25, width 0.333, open 0.35 with the hop |
| error | upper lid 0.14, tilt 0.9, gaze down a little | smile -0.75, width 0.208, blush 0.75 |
| speaking | gaze 0.5 times the pointer | open = voice level, smile and width shrink as it opens |
| resting | upper lid 1, sleep 1, no blinks or glances | smile 0.35 |

## 12. Traps

Each: symptom, cause, fix, how to verify.

**12.1 Features a few hundredths of a unit out of place.** Symptom: side by side with the art the eyes sit high, wide or off to one side (the example was 0.06 units off at one point); crops look "almost" right. Causes: positions read off a downscaled preview; a white's centroid biased by where the iris sits in it; a wide page lens (fov 24 magnified the head about 10 percent relative to the feet); the art-view magnification `D / (D - z)` of pieces proud of the axis plane; domes that follow the tilted plate normal and shift sideways against the flat art (parallax). Fix: measure with `fit-face.py`, anchor through `artworkPoint`, build in `fitToArtworkView` groups, keep a long lens (page fov 8, audit fov 6). Verify: the IoU and centroid check in section 14 (centroids within 0.005).

**12.2 Sticker look.** Symptom: a grey ring around the whites, a pure white catchlight, flat whites, cheeks as a small disc inside a wide dark ring. Cause: uniform outlines and highlights instead of the art's measured ramp, pocket and halo. Fix: the rim ramp per angle, the pocket sink, the halo map, the grey button catchlight, contact lines only as wide as measured. Verify: luminance along rays across the eye edge, art against render (the ray sampler in `refine_eye_edge` works on either image), and 5x crops.

**12.3 The mark reads flat or mechanical.** Cause: stripes instead of wraps, bump only, a neutral dark colour. Fix: section 8 (wraps across the bar, albedo and bump, tone on tone, trench). Verify: `eval.mjs` cord line at 350 ppu (example 10.4 against the art's 13.1) and an 8x crop.

**12.4 A rounded halo around the mark.** Cause: a round contact-shadow disc under the X. Fix: remove it; shadow only in the per-bar trench. Verify: 5x crop of the chest against the art.

**12.5 Lids popping or leaking.** Symptoms: black bars or broken resting eyes with flat lid cuts; a sliver of white in the seam of a closing eye; a bright stair-stepped line along a lid's edge; a dotted line where the iris meets the lid; a lid visible at rest. Causes and fixes: curved free edges cut in the fragment shader (not clipping planes); a 0.04 overlap near full closure; the lid shadow continuing under the lid; the pieces cut 0.03 inside the lid's soft edge; lids hidden below 0.002 closure. Verify: a stepped 60 fps blink filmstrip, and held closures (`lab.html?blink=0.3`, 0.6, 0.9) at dpr 2, zoomed 5 to 8x.

**12.6 Stencil leaks.** Symptoms: iris, pupil or catchlight drawn outside the white, or not at all. Causes: the white drawn after the pieces (render order), a renderer created without `stencil: true`, another object writing stencil 1. Fix: `renderOrder -1` on the whites, `stencil: true`, keep the stencil value 1 reserved for the eyes (or give each eye its own reference value if something else needs the stencil). Verify: push the gaze to the rim (`setGaze(1, 0)`) and check at 8x that the iris ends on the white's multisampled edge with no white specks.

**12.7 Hand-built pieces render black.** Cause: WebGL gives 0 for a missing vertex attribute, so the felt shader sees `ao = 0` on lids, cheeks and cords. Fix: `neutralAttributes(geometry)` (ao 1, curv 0). Verify: `lab.html?dbg=3` (indirect diffuse) shows the pieces lit.

**12.8 Grains along a lid edge.** Cause: a texture fetch after a `discard` or inside a branch has undefined derivatives. Fix: the lid discards after the nap fetch (after `alphatest_fragment`); the pieces discard after their map fetch. Verify: A/B with the discard removed; the edge must not change except where the lid ends.

**12.9 Eye materials sharing one program.** Cause: the wrappers are identical text, so three.js's default cache key makes the programs collide. Fix: explicit keys (`mascot-eye-<name>`; lids append `-lidT`/`-lidB`). Verify: each piece renders with its own shading; `renderer.info.programs` grows accordingly.

**12.10 Contact lines crawl on small displays.** Cause: lines under a pixel. Fix: `setPixelSize` (section 6). Verify: turn the head slowly at dpr 1 in a stepped filmstrip.

**12.11 Measured versus perceived size.** Symptom: the mouth looks thin next to the art, so you thicken it. Cause: perception at small size, and the rolled edge hiding part of the band. Fix: keep the measured thickness (the example tried a thicker cord and returned to the measurement); compare masks, not impressions. Verify: IoU and a column-by-column band thickness comparison.

**12.12 Pieces on a tilted plate come out too big or off centre.** Cause: the plate tilts (about 36 degrees at the example's cheeks), so a piece built in the plate's own frame is foreshortened differently from the flat art, and an outline ribbon slides off one side. Fix: `fitToArtworkView` with the tilt; the mouth's line is shifted to stay even around the cord. Verify: IoU per feature.

## 13. Other eye designs

The kit handles any eye whose white is a star-shaped outline (every ray from the centre crosses the edge once): round, egg, bean. Change the colour rule and seed in `fit-face.py`, rerun, rebake. Other designs honestly need code:

| Design | What changes | Files |
|---|---|---|
| Round or egg (as example) | seeds, colour rules | `scripts/dev/fit-face.py` |
| Button eyes (one glossy or felt disc, no white) | drop the white, stencil and lids; one appliqué pillow plus the catchlight; no gaze (the head carries attention) and either no blink or a face-fabric lid over a dome | `src/face/eye.js`, `src/mascot-face.js`, `src/mascot.js` (blink, glance), `src/mascot-pose.js` |
| Slit or happy-arc eyes (closed curves) | build each as a cord along the measured curve (the mouth's tube, or the sleep arc); a blink becomes a small squash of the arc or nothing | `src/face/mouth.js` pattern, `src/mascot-face.js`, `fit-face.py` (curve fit like the mouth) |
| Eyes with visible lashes or brows | cords or appliqués above the lid, riding the head, not the gaze | `src/mascot-face.js`, `fit-face.py` |
| No eyes | remove the eye blocks and their anchors; blink and glance code stays inert; remove the eye zone from the halo map and the shader's zone split (`references/felt-shader.md` 5.9) | `src/mascot-face.js`, `scripts/bake/bake.mjs`, `fit-face.py`, `src/mascot-fabric.js` |

For every design also update `calibrate-features.py` (windows and colour rules), `calibrate-sclera.py` (or drop it), the rest gaze in `src/mascot-pose.js`, and the GLB export's face parts (`references/exports-and-handoff.md`).

## 14. Acceptance gates and commands

```bash
python3 scripts/dev/fit-face.py
node scripts/bake/bake.mjs --quality final && node scripts/bake/bake.mjs --quality lite && node scripts/sync-public.mjs
node scripts/dev/audit.mjs --ppu 350 --size 1467 --out /tmp/live350-1467.png
python3 - /tmp/live350-1467.png <<'EOF'
# feature IoU and centroid error, render vs art, with fit-face.py's own segmentation (seeds as in its main())
import importlib.util, sys
import numpy as np
from PIL import Image
spec = importlib.util.spec_from_file_location('ff', 'scripts/dev/fit-face.py')
ff = importlib.util.module_from_spec(spec); spec.loader.exec_module(ff)
seeds = {'eyeR': (ff.eye_mask, -0.436, 2.136), 'eyeL': (ff.eye_mask, 0.523, 2.129),
         'cheekR': (ff.cheek_mask, -0.567, 1.865), 'cheekL': (ff.cheek_mask, 0.63, 1.861), 'mouth': (ff.mouth_mask, 0.039, 1.875)}
art = {k: f(x, y) for k, (f, x, y) in seeds.items()}
size, ppu, ty = 1467, 350.0, 1.65
r = np.array(Image.open(sys.argv[1]).convert('RGBA')).astype(np.float32)
dx, dy = int(round(size / 2 - ff.AX)), int(round(size / 2 + ty * ppu - ff.AY))
live = r[dy:dy + ff.H, dx:dx + ff.W]
ff.A, ff.R, ff.G, ff.B = live, live[..., 0], live[..., 1], live[..., 2]
ff.L = live[..., :3] @ np.array([0.2126, 0.7152, 0.0722])
for k, (f, x, y) in seeds.items():
    m, a = f(x, y), art[k]
    (lx, ly), (ax, ay) = ff.centroid(m), ff.centroid(a)
    print(f'{k:7s} IoU {(m & a).sum() / (m | a).sum():.3f}   centroid live-art ({lx - ax:+.4f}, {ly - ay:+.4f}) units')
EOF
python3 scripts/dev/calibrate-features.py /tmp/live350.png         # after: node scripts/dev/audit.mjs --ppu 350 --out /tmp/live350.png
python3 scripts/dev/calibrate-sclera.py /tmp/live350-1467.png
node scripts/dev/shoot.mjs "size=700&state=idle&blink=0.6&fov=6&cx=0&cy=2.05&cz=14&tx=0&ty=2.05&time=0&near=1&transparent=1" /tmp/blink.png
```

The IoU check is not a shipped script (the numbers in the example's validation record came from an equivalent scratch helper; the block above reproduced them exactly on the template). Run it from the project root with the dev server up. `shoot.mjs` needs `near=1` for a close camera, because the controller's near plane is set for its own framing.

| Gate | How measured | Pass | Example mascot | If it fails |
|---|---|---|---|---|
| Outline fit | `fit-face.py` polar IoU | eyes 0.98, cheeks 0.95 or more | 0.988 / 0.986, 0.965 / 0.962 | adjust colour rules or seeds; check the mask overlay |
| Feature IoU on the render | block above | eyes 0.97, cheeks 0.95, mouth 0.90 or more | 0.989 / 0.977, 0.962 / 0.956, 0.913 | anchors, `fitToArtworkView`, rebake; trap 12.1 |
| Centroid error | block above | 0.005 units or less | worst 0.005 (mouth x) | trap 12.1 |
| Feature colour | `calibrate-features.py` correction | 0.97 to 1.03 per channel | 1.000 to 1.007 | `--apply`, repeat |
| Eye-white shading | `calibrate-sclera.py` mean abs log ratio | 0.05 or less, not shrinking | 0.022, 0.040 | repeat; check the rim map first |
| Blink timing | `BLINK` and `blinkAmount` | 80 / 35 / 190 ms, interval 2.4 to 6 s | as listed | restore the constants |
| Cord at 350 ppu | `eval.mjs` cord line | live / art 0.75 or more | 10.4 / 13.1 | `tune2.mjs --only cord` |
| Crops | 5 to 8x, art and render side by side | a person or fresh agent finds no difference in stroke, colour or edge character | residuals listed in `tests/VALIDATION.md` | trap list above |

Crops to look at after any face change: both eyes at gaze 0 and at the rim, held closures 0.3 / 0.6 / 0.9 at dpr 2, cheeks and mouth contact lines at dpr 1, the mark at 350, 246 and 123 ppu, the whole face at yaw plus or minus 0.5 and 0.9, and a stepped 60 fps filmstrip of a blink and of every state change (`references/rig-and-animation.md` for the stepping method). Metrics are guards: the example's worst misses were visible in crops while every number looked fine.
