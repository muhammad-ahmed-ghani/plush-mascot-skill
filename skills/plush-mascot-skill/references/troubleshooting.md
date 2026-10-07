# Troubleshooting: symptom, cause, fix, verify

Purpose: a symptom-indexed manual of the failures met while taking one character from "fake, plastic" to a validated result. Each row: what you see, the likely cause, the exact fix, how to verify. Depth lives in the linked references; the story is in `references/lessons-log.md`.

## Look
| Symptom | Cause | Fix | Verify |
|---|---|---|---|
| Plastic, smooth, fake | no filament scale; procedural noise; over-smooth art | extract the nap from sharp art; pre-emphasis; `tune2.mjs --only tex` (`references/felt-shader.md`) | fibre-band energy 0.9 to 1.3 in `eval.mjs`; crops at 5 to 8x |
| Cloudy, blotchy fibres | fetch blur (bilinear, mips) softened the finest filaments | `python3 scripts/dev/fit-nap-spectrum.py --tile face` then `--tile body` | per-band ratios 0.7 to 1.25 |
| White or coloured grain along hood-to-face boundary when turned | a step in the field meshed as a staircase; open edges in the mesh | continuous wall `wallW`; watertight mesh; refinement (`references/sculpt-fit.md`, `references/mesh-bake.md`) | `turn-check.mjs` p95 <= 0.8 px; `check-mesh.mjs` 0 open edges |
| Hard straight colour edge instead of a rolled blend | no lip, crevice or tuck | geometry wall + shader edge profile (`references/felt-shader.md` 5.8); `tune2.mjs --only seam` | `eval.mjs` seam profile <= 6 levels; crops on four sides |
| Rounded halo around the chest mark | emblem painted/blended on the surface | wound cord in a trench, no halo | crop at 5x |
| Shimmer or checkerboard on the cord or fine detail when small | sub-pixel repeats alias | fade by screen-space frequency (`felt-shader.md` 10.7) | cord contrast row in `eval.mjs`; filmstrip of a slow turn |
| Pixelated texture | tile sampled too coarsely or tile blur | check tile scale (`NAP_TILE`), `uNapZoom`, mip bias | crops at 1x and 2x |
| White specks at grazing angles | wrapped N.L in specular/sheen; slopes over 55 degrees | wrap diffuse only; clamp slopes | count of near-white pixels at yaw 0.9 |
| Specks along seams | bump from screen derivatives of a thin groove | analytic slope | zero-depth A/B |
| Pale band or double contour at the silhouette | shells shaded unlike the base; glow on rim | shells reuse base shading; `uShellGlow` only | shells 0/2/4 at 5x |
| Pale specks around the figure on the page | alpha-to-coverage into a transparent canvas | `alphaToCoverage: false` | light and dark page |
| Dark or black face parts (lids, cheeks) | missing `ao` attribute reads as 0 | `neutralAttributes(geometry)` | `?dbg=3` |
| Eyes slightly off, sticker look | face data from a wrong window; no pillow or lid | re-run `fit-face.py`; build the eye (`references/face-kit.md`) | feature IoU >= 0.95, centroid <= 0.01 |
| Blink pops, lid shadow steps | lid curve or shadow discontinuity | continuous lid shadow; blink 80/35/190 ms | stepped filmstrip of a blink |

## Motion
| Symptom | Cause | Fix | Verify |
|---|---|---|---|
| Hand merges into head or face | arm too short; wave path | arm stretch, wave out to the side | `clearance.mjs` >= 0.04 |
| Card blends into the face | card small/close | larger, held out on a long arm, head turns | clearance (card) |
| Flat closed laptop slab appears | entrance not staged | tip onto the edge and open on arrival | filmstrip |
| Abrupt stand-up, headphones fly out | no dismount | staged dismount + `lead` | `motion-check.mjs` |
| Fibres comb out on a stretched arm | nap not compensated | `uArmSpan` | crop of the raised arm |
| Arms go dark | AO against swinging arms | occlude by head/torso only | `?dbg=3` |
| State restarts while scrolling | repeat request or page timers | drop repeats; never leave working under 1.6 s | `validate.mjs` scroll wiggle |

## Performance and environment
| Symptom | Cause | Fix | Verify |
|---|---|---|---|
| Stuck at 30 fps everywhere | Energy Saver / Low Power Mode / 30 Hz screen | plug in; measure a blank page | `motion-check.mjs` blank-page line |
| Hitch on first entry into a state | programs compiled on first use | precompile and warm all props at load | first-frame times |
| Governor drops quality needlessly | frame times measured before completion | time to completion with `readPixels` | `quality` events |
| Poster jumps when the model fades in | framing constants drifted from `figureBox()` | derive from the controller | `view-check.mjs` <= 6 px |
| Blank stage after regenerating assets | stale `public/` | `node scripts/sync-public.mjs` | served size equals file |
| Full-page screenshot has an empty stage | fixed WebGL stage draws only the viewport | viewport-sized shots; add scroll offsets to clips | figure visible |
| Colours wrong in a screenshot | taken during a CSS opacity transition | wait or use `snapshot()` | two shots agree |
| Run dies: "Execution context was destroyed" | an edit under `src/` reloaded the page (HMR) | stop editing during tuners/gates | run completes |
| Tuner stuck in a bad optimum | stale start values | `--live`, one group at a time | crops, not only loss |
| Shader edit does nothing | `onBeforeCompile` sees unresolved `#include` lines | replace the include with `THREE.ShaderChunk.<chunk>.replace(...)` | log whether the text landed |
| Variants render identically | program cache ignores a define | add every define to `customProgramCacheKey` | `renderer.info.programs` grows |
| Grains only on some GPUs | texture fetch in a branch or after `discard` | fetch first, branch later | A/B with the branch removed |
| `WEBGL_lose_context` null | extension object is single-use | keep the first object | context-loss checks pass |
| `apply-tuned.py` stops at `threadMaps` | tuner output includes cord keys the script cannot place | drop `cordAmp cordBump cordBright` from the JSON unless tuned; set by hand; re-check the plate gain (it writes `fk` into all channels) | files unchanged after the error |
| Python imports fail (scipy/skimage) | numpy 2 breaks old builds | the tools do not use them; use numpy, Pillow, OpenCV | `scripts/tools/selftest.py` |

## Art and image models
| Symptom | Cause | Fix | Verify |
|---|---|---|---|
| Returned image smaller than requested | relay or tool ignored the size | native API; check metadata; no upscaling | `imagegen.py` size note |
| Transparent background rejected or has a halo | model lacks alpha / hard mask | flat key colour + `alpha_extract.py key` | `alpha_extract.py verify`, `art_qa.py` |
| Identity drift across images | no reference, lock not restated, model switched | attach hero and front, restate the lock, one model per set | contact sheet |
| Text or logos appear | brand context in the prompt | masked edit; text exclusion | `art_qa.py` / look |
| Fit converges wrong | start or bounds from the example | move `P`, widen `SPACE` | `score.mjs` bands |
| Turnaround profile inconsistent | AI sheet is not a projection | use it for depth only; registered profile | side IoU >= 0.95 |
