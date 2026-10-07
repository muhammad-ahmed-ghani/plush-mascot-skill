# Lessons log: from plastic to art-faithful

Purpose: the story of how the example mascot went from a glossy, plastic-looking model to a validated, art-faithful plush, phase by phase: what was tried, what the measurements showed, what failed and what finally worked.
Read it to skip the dead ends; the actionable fixes are indexed by symptom in `references/troubleshooting.md`.

When to read: before planning a build (skim section 2 and the tables in sections 13 to 16), when a fix is not working (find the phase where the same symptom appeared), and before delegating work to other agents (section 12).

## Contents

1. How to read this log
2. Timeline at a glance
3. Phase 1: rebuild from measurements
4. Phase 2: fabric from the art itself
5. Phase 3: props, page and a hidden shading bug
6. Phase 4: first owner audit (border, texture, realism)
7. Phase 5: the hood-to-face edge
8. Phase 6: face blend, blink and props in parallel
9. Phase 7: grains and pixellation when the head turns
10. Phase 8: motion from screen recordings, 60 fps
11. Phase 9: the page
12. Process lessons
13. Metrics that passed while the image was wrong
14. Tuner local optima
15. Dead ends and why they failed
16. Where the hours went
17. Residual differences at hand-off
18. Keeping your own log

## 1. How to read this log

- Units are character units. Example mascot: 3.306 units tall, 350 px per unit in the registered neutral art. "ppu" means pixels per unit; the audits use 350 (the art's own density), 246 (a 590 px stage on a 2x display) and 123 (the same stage on a 1x display).
- "The owner" is the person who commissioned the mascot; their words are paraphrased.
- Times are elapsed hours from the first request. The whole build took about 24 hours of wall time, including an overnight gap and a two-hour stop at a spend limit.
- Each phase gives: the state at the start, the objection, what was tried, what the measurement showed, the fix, and the gate that now guards it. File names are the template's (`src/mascot-fabric.js`, `scripts/dev/eval.mjs`, ...).

## 2. Timeline at a glance

| Elapsed | The owner said (paraphrased) | Root causes found | Gate that now guards it |
|---|---|---|---|
| 0 h | Make it look exactly like the images, with that texture; now it is fake, plastic and bad. | primitive rig, glossy face, pastel colour, procedural fuzz | `scripts/bake/score.mjs`, `scripts/dev/eval.mjs` |
| 11.4 h | It does not look the same: the chest mark has a rounded border, the fabric texture is missing, it does not feel real. Audit carefully. | round shade decal under the mark; nap zoom inverted, so fibres fell below a pixel on the page; fibre energy 71 to 84 percent of the art | `eval.mjs` fibre band energy at 350, 246, 123 ppu |
| 14.2 h | Where the red hood meets the dark face the art rolls and blends in 3D; zoomed in, the model's edge is a straight line. | planar cavity floor on a curved head (no wall at the sides); mesh cracks; AO staircase | edge profile (`seam` in `eval.mjs`), `scripts/bake/check-mesh.mjs` |
| 15.2 h | Hood to face is solved; now the eyes, lips and the rest must blend perfectly. Blink, laptop, headphones and all motion must be real 3D. No stale code. | feature outlines and the light around them not measured; clip-plane lids; primitive props | feature IoU and blink timing (`tests/VALIDATION.md`), filmstrips |
| 18.8 h | White and other grains along the mask-to-face blend; not smooth; it looks pixellated. | a step (cliff) in the SDF cut as a staircase; a texture fetch inside a branch; fetch blur on the plate nap | `scripts/dev/turn-check.mjs`, `scripts/dev/fit-nap-spectrum.py` |
| 21.2 h | (two screen recordings) Working shows a bad box and a bad transition; in Hello the hand merges with the face; make it 60 fps. The decision card also blends into the face. | arms too short to clear the hood; closed laptop sliding in; instant stand-up; no frame cap; shader compile on first entry | `scripts/dev/clearance.mjs`, `scripts/dev/motion-check.mjs` |
| 21.8 h | Make the page less AI-looking and more immersive (arrows, fonts, the downloads section); use the real app icon. | template page patterns; an invented mark | `scripts/dev/validate.mjs`, `scripts/dev/contrast.mjs` |

## 3. Phase 1: rebuild from measurements (0 to 2 h)

**State.** A hierarchy of primitives with sparse hair, a glossy face "screen", bean feet and a pastel colour. Measured on the art first: the body's median was a deep red (example mascot `#DA4744`) with saturated red shadows and peach highlights, fibres about 1.5 px wide, about 11 percent micro-contrast. The old render was too pastel before texture even mattered.

**Decision.** Minor edits could not reach the target, so everything was rebuilt: a signed-distance sculpt with a software sphere-tracing previewer (`scripts/bake/preview.mjs`, half a second per image, no browser), fitted to the front and profile silhouettes by a parallel coordinate descent over about 40 parameters (`scripts/bake/fit.mjs`). IoU went 0.891 to 0.976 (front) and 0.948 (side) within 20 minutes.

**What was learned.**
- IoU alone turned the ear tabs into spheres while scoring 0.976. A boundary-band term and a tab-shaped ear family fixed it. Parameters sitting at their bounds meant the shape family could not express the art, not that the bounds were too tight.
- An ear tilt with the wrong sign was compensated by the optimiser moving the ears outward: a plausible-looking wrong optimum. Sweep single parameters and look before trusting a fit.
- The art was 1.3 percent asymmetric; the model was made symmetric about the measured axis (not the image centre).
- The body pink "terminator" tint was bleeding into the charcoal face; then three.js' neutral tone mapping turned the warm near-black into saturated red-brown (its shadow toe subtracts per channel). A hue-preserving curve (linear through shadows and mids, luminance toe, soft highlight shoulder, `src/mascot-studio.js`) fixed the hue.
- Wrapped diffuse lights past N·L = 0 while the shadow map stops there: a hard crescent on the head. Shadows are faded toward the terminator.
- A look tuner ran in an isolated copy on its own port while geometry work continued: tonal distribution error 15.7 to 0.7. When it pinned detail parameters at their bounds, the reason was that its metric (blurred at sigma 12 px) could not see detail; parameters a metric cannot perceive must be frozen.
- Arms posed with Euler angles swung through the head; world-space aim vectors for upper arm, forearm and hand fixed posing (the arms were still too short, see phase 8).
- Two small traps: padding a binary header's JSON with NUL bytes breaks `JSON.parse` (pad with spaces); alpha-to-coverage on fuzz shells wrote partial alpha into the transparent canvas, so shell pixels blended with the page as pale specks.

**Guard now.** `node scripts/bake/score.mjs` (front and side IoU); the tone curve.

## 4. Phase 2: fabric from the art itself (2 to 11 h)

**State.** Procedural hooked strokes, tuned for an hour: first too dense (4,400 strokes merged into a plateau), then too sparse. Side by side, the art's nap is dense, short, hooked filaments about one pixel wide with full coverage. No parameter set of the generator produced that character.

**Fix: extract the nap from the art.** A multiplicative high-pass of the flat, evenly lit regions (masks exclude seams and the chest mark), quilted toroidally with min-error seams into 1024 px tiles at 1 texel = 1/350 unit (`scripts/nap/build.py`). The first quilts failed three ways, each with its own fix: a verbatim copied chunk and blobs (ban verbatim continuation, accept candidates within an error margin, drop the soft hero pool, clean residual blobs); faint low-contrast grid lines every 64 px (feathering two uncorrelated patterns halves their variance: cut hard along the min-error path); combed patches (45 percent of the pool was anisotropic: a structure-tensor coherence penalty added to the matching error, softer than excluding windows).

**Other lessons of this phase.**
- The application was quit overnight and the scratch directory, holding the capture harness, the reference masks and the tuned values, was wiped. From then on every useful tool lived in the project (`scripts/dev/`) and caches in `scripts/nap/.cache`.
- Data textures are RGB PNGs without alpha: browsers premultiply alpha at decode and quantise the data.
- The tuner ran in two groups (texture with light frozen, then light with texture frozen) and matched fibre contrast almost exactly (12.33 against 12.32). That match was a metric loophole (section 13).
- The tuner found a thin, 1 to 2 px bright rim line: it satisfied the tonal statistics with very few pixels. Rim power and amplitude were capped.
- A pale band and a double contour on the crown came from the emissive rim being applied to both the base surface and the outward-offset shells. Removing shell glow raised the loss (12.62 to 13.12) but fixed the picture; the trade was taken.
- A design error: fibre normals were faded at grazing angles, but real felt catches the most light there. The fade was narrowed and the rim modulated by fibre height.
- The crown still looked like a flat lid after IoU rose. A clay render (no texture, no rim) showed a crease where a tapered box met a dome. The head became a superellipsoid with an analytic gradient: head-region IoU 0.961 to 0.994 with fewer parameters. The jowl parameter had been bounded at zero; small regions (crown, ears) needed their own objective terms because they are a few pixels of the global IoU.
- The first fuzz shells were 90 and 70 percent opaque in their first layers with a hard alpha cut, which read as a solid band. Coverage now falls as (1 - t)^2.2 with per-layer thresholds from the Gaussian quantile of the fibre height.
- Colour: three of the four artworks agreed (a* 46 to 48); the transparent cut-out was the outlier (a* 53), its background removal had raised saturation. The body colour was calibrated to the consensus with linear-light channel ratios (1.005, 0.991, 1.012 after convergence).
- The key light is fixed relative to the camera, so beyond about 24 degrees of yaw the face fell out of it; a soft, shadowless camera-side fill fixed the 3/4 view.
- AO baked with the arms at rest left a black patch on the torso when an arm rose; arms are now occluded only by the rigid head and torso, and AO has a floor. The tuner later drove that floor to its bound and the black came back: the floor is bounded to [0.28, 0.6].
- A text patch whose target line had been changed by an earlier tune never applied; the new fill light was undefined and the light intensity became NaN. Text patches fail silently.

**Guard now.** Nap tiles regenerate with `python3 scripts/nap/build.py`; `eval.mjs` compares fibre statistics.

## 5. Phase 3: props, page and a hidden shading bug (10 to 11.5 h)

- A shadow-map floor threw a long hard streak; two painted radial blobs (a tight contact shadow and a soft cast shadow) replaced it.
- The laptop read as a black slab strapped to the body; the decision card rendered edge-on because the hand sat under the head's overhang and the head hid the card. The card is now placed from the hand's world position with its own upright orientation, clear of the head.
- A check mark was drawn as a caret (stroke rotations swapped): glyphs need a crop check too.
- Every image in `tests/` still showed the old plastic model. Evidence must be regenerated after any look change, or it misleads the reader.
- White specks along a new seam. Counting pixels of luminance 245 or more first gave nonsense (the render had an opaque page background); on a transparent canvas the count held. A dev flag that outputs one lighting term (`lab.html?dbg=2`, direct specular) showed a p99 of 252 against a median of 2: the wrapped-diffuse patch had also replaced the irradiance used by GGX and sheen, whose visibility terms divide by the true N·L + N·V. Keeping the wrap for diffuse only took the outliers from 1,227 to 6. Everything tuned while the spikes existed was retuned.
- WebGL context loss: three.js recreates its state, but the PMREM environment render target stays empty; the controller rebuilds the environment on `webglcontextrestored`.

**Guard now.** The specular terms keep the true N·L (comment in `src/mascot-fabric.js`); `node scripts/dev/validate.mjs` covers the context-loss and no-WebGL paths; `node scripts/dev/evidence.mjs` regenerates every still in `tests/`.

## 6. Phase 4: first owner audit (11.4 to 14 h)

**Objection.** The chest mark had a rounded border, the fabric texture was missing, the realistic feel was missing.

**Border.** A round shade decal under the mark; removed. The mark became a wound cord in a trench. Its wrap count was measured with a 1-D luminance profile and an FFT along the bar (about 31 wraps at 2.9 px pitch at 350 ppu); counts read by eye had drifted from 9 to 40 across the session.

**Texture.** Three causes, found in this order:
1. `_updateNapZoom` multiplied the tile scale by the zoom instead of dividing, so at a 1x display fibres were 0.4 px wide and averaged into a smooth, plastic surface. The lab rendered at the art's density, where the bug was invisible. The zoom is now computed from the camera's actual pixels per unit and follows a law fitted by sweeps at 90, 123, 180, 246 and 350 ppu: `zoom = 1 + 0.2 * (350 / ppu - 1)`, clamped to [1, 1.9] (example mascot; 350 is the art's density).
2. A page-scale audit (near-orthographic camera at a chosen density, art Lanczos-rescaled to the same density: `scripts/dev/scaled-ref.py`, `scripts/dev/audit.mjs`, `scripts/dev/audit.py`) showed 71 to 84 percent of the art's fibre energy at page scale and only 70 percent even at native density. The earlier "match" had used a wide box high-pass that counted shading undulation and specular spikes as fibre.
3. The render read as embossed leather: its detail came from the normal map (bumps), while the art's comes from albedo, sparse thin bright filaments with positive skew and kurtosis 3.2 to 4.3. The nap became albedo-dominant with a crest power curve and no upper clamp; skew and kurtosis joined the loss. The tuner kept drifting back to bump because the loss could not tell the two apart, so normal strength was capped and variants were judged side by side (`scripts/dev/variants.mjs`). The tile itself had less than half the art's high-frequency energy; a spectral match in the Fourier domain (seamless by construction) restored it, and a face-scale factor of 1.6 that the tuner had chosen, which only shrank strokes into mip blur, was set back to 1.

**Realism.** Lighting got more freedom (key and fill azimuth and elevation, floor bounce, hemisphere): large-scale tone error 18.4 to 10.5. The red channel of the body colour was clipped at 255 in the palette hex, so the lighting dimmed red and hue drifted; unclamped per-channel gains and a hue term fixed it. A regional cell term later showed the art is lit from the viewer's right while the tuner sat in a left-key basin; `tune2.mjs --set` started it in the other basin, and physical evidence (sclera brightness asymmetry, crease directions) decided between two similar losses. Soft 16-tap rotated Poisson shadows replaced the hard default.

**Construction.** A ridge filter on the art found a sewn pattern (`scripts/bake/extract-seams.py`). Stitches are baked per vertex as a signed distance plus a presence value; unsigned distance cannot interpolate to zero across a seam thinner than a triangle, and a missing vertex attribute reads (0, 0, 0, 1), so presence sits in a channel whose default is zero. Soft folds (belly) are carved into the SDF geometry (`scripts/bake/folds.mjs`).

**Face.** The eyes converge in the hero and the turnaround alike, so the convergence is a trait, modelled as pose key `f.cv`. Eye centres were 0.05 units off because the cream-only mask used to measure them was biased by the iris touching the eye's edge; measuring the full span fixed it. Lids moved from clip planes to a shader discard with a curved edge. The lids and cheeks were far too dark because procedural geometry had no `ao` attribute: WebGL reads a missing attribute as 0, fully occluded. Default attributes are now stamped on every procedural mesh that uses the fabric material.

**Silhouette.** The art's edge is mostly a lighter rim (un-premultiplied edge colour about 253, 183, 159 in the example art), not an alpha halo; blended fuzz layers and a tight high-power rim reproduce it. Alpha-to-coverage multiplies coverage by the fragment's alpha, a double attenuation.

**Integration.** The live figure was 81 percent of the poster's height, so the fade from poster to model jumped; the poster is now placed from `figureBox()` and the camera became a long lens (field of view 14, later 8 degrees). The GLB validator reported 10 errors and 184 warnings (colours above 1, zero-weight joints with indices, skinned meshes under a transformed parent); after fixing them, the check loaded the old GLB because the dev server served a stale `public/` copy. A 28-check functional validation, a production build, the no-WebGL fallback and a context-loss test closed the phase.

**Guard now.** `eval.mjs` at 350, 246 and 123 ppu (fibre band energy, skew and kurtosis, tone, cells, cord); `node scripts/dev/view-check.mjs` for the poster; `node scripts/dev/glb-check.mjs` plus the validator report written by `evidence.mjs`.

## 7. Phase 5: the hood-to-face edge (14.2 to 15.2 h)

**Objection.** The art rolls the red hood over the dark plate with shadow and softness; the model had a straight, hard colour cut.

- A comparison capture looked pale in both builds: it was taken 200 ms into a 0.6 s CSS opacity transition of the canvas. Captures now wait for transitions to end.
- A profile through the plate's side showed a smooth monotone slope with no wall: the planar cavity floor intersected the curved head, so at the sides the recess vanished and the colour boundary was a mask painted on smooth geometry.
- The first fix (a bowl-shaped recess following the head) dented the back of the head, because the 2-D outline was extruded through the whole head with no depth limit and its sign was inverted; side IoU fell from 0.953 to 0.905.
- Reading the art's profile properly: the plate is a dome level with the head block at its apex, and the hood's hem rolls over its edge. The rebuild keeps the plate on the block surface, adds an asymmetric groove and a tuck toward the edge; side IoU rose to 0.959 (head 0.970).
- Grooves narrower than about 2.5 mesh cells aliased into teeth spaced exactly one cell apart. The thin dark crevice line (0.01 unit) is drawn analytically in the shader from the signed distance to the outline; the geometry carries only the broad roll (0.04 unit and wider).
- An edge-profile metric (luminance binned by signed distance from the plate's edge, per side) showed the art's hood bright right up to the crevice, the plate darkening toward the edge, and ours with a broad dark band from the groove, AO and the recess combined.
- A staircase along the plate edge disappeared when AO was disabled: AO rays had been oriented by the carved surface's tilted normal and dipped under the plain surface. AO and curvature now come from the plain field (`face.hem = face.tuck = 0`), oriented by its own normal.
- White specks remained: 416 plate pixels had alpha exactly 0.75, only the fuzz layers drawn. The mesher had dropped sliver triangles and left 338 open edges on the head. Keeping slivers closed them; the remaining holes were fold-over triangles back-face culled because their winding came from a vertex-normal test (a `DoubleSide` experiment proved it). Winding now comes from the grid topology.

**Result.** The owner confirmed the edge was solved. **Guard now.** `node scripts/bake/check-mesh.mjs` (0 open edges); the `seam` edge-profile term in `eval.mjs`.

## 8. Phase 6: face blend, blink and props in parallel (15.2 to 16.7 h)

- Work split: a pristine merge-base snapshot and two builder copies with their own ports (headphones, card and confetti; laptop and seated pose), the lead on the face in the main tree.
- `scripts/dev/fit-face.py` measures every feature outline as a polar table, plus iris, pupil and catchlight ellipses and the mouth's centre line, so geometry lands on the art's outlines within a fraction of a pixel.
- The art is close to orthographic; the page camera moved to an 8 degree field of view and the features were compensated for the art's view distance.
- Light around each feature: modelling a felt-lined pocket by tilting the plate's normal failed because the face shading in the art implies a light from the upper left while the body says upper right. A measured RGB halo map (the art's light divided by the render's, around each feature) replaced it.
- Eye rims: the art's eye white ends in a ramp and a dark line slightly outside the cream outline, with a width that changes with angle, so the rim is a per-angle lookup image.
- Rim darkening appeared on one side of each eye: the feature domes followed the plate's tilted normal, so their heights shifted sideways relative to the front-fitted outlines (parallax). Heights now run along the view axis.
- Blink: asymmetric 80 ms close, 35 ms hold, 190 ms open, seeded, often right after a state change; the lids overlap a little at full closure so no sliver of white shows; the upper lid rides the eye when looking down; lids are made of the plate fabric and cast a soft shadow. Springs, idle glances and a crouch before the success hop were added.
- At 16.7 h a spend limit stopped everything for two hours and the laptop builder died mid-task. Its partial work was three-way merged into the main tree and it was relaunched from a fresh snapshot.

**Guard now.** Feature IoU and centroid offsets against the art (example mascot: eyes 0.989 and 0.977, cheeks 0.963 and 0.956, mouth 0.913, centroids within 0.005 units, recorded in `tests/VALIDATION.md`); `python3 scripts/dev/calibrate-features.py` and `python3 scripts/dev/calibrate-sclera.py` after any lighting change; blink filmstrips stepped at 60 fps.

## 9. Phase 7: grains and pixellation when the head turns (18.8 to 21 h)

**Objection.** White and other grains and a pixellated look all along the mask-to-face blend.

- Front-on audits showed nothing. The real page at 1x and 2x, turned to yaw +-0.5 and 0.9, showed teeth; a geometry-only render still had them, so the cause was in the sculpt.
- The plate's tuck was a step of 0.028 units in the field at the outline, and the 0.021-unit grid cut it as a staircase; when the head turned, the colour boundary zig-zagged over it. The edge profile became C1 (a wall 0.04 wide and 0.016 deep) and `scripts/bake/refine.mjs` splits head triangles within 0.1 of the outline once (red-green, re-projected onto the field). Outline roughness at 2x fell from 0.37 and 0.44 px mean to 0.07 px.
- The face nap was fetched inside `if (face > ...)`. Pixels of a 2x2 quad that skip the fetch make its derivatives undefined, the mip level is garbage along the boundary, and grains sit exactly on the seam. The fetch is unconditional now, and the lid's `discard` moved after its fetches.
- The plate's fibres arrived as cloudy blotches: bilinear taps and mip levels blur the finest filaments. `scripts/dev/fit-nap-spectrum.py` fits a radial pre-emphasis per tile until the rendered spectrum matches the art at 350, 246 and 123 ppu.
- The plate boundary and crevice line are anti-aliased to the pixel footprint using `fwidth` of the jitter-free distance.
- `scripts/dev/turn-check.mjs` was written to measure the outline's deviation from its own smooth curve and the bright specks; it was run on the old cliff mesh to prove it separates good from bad, and its outline locator was changed when two dark bands made it jump.
- The iris, pupil and catchlight were clipped by a per-pixel `discard` that staircased and let white through; the stencil buffer (the sclera writes, the pieces test) gives a multisampled edge.
- A read-only QA auditor agent found seven defects: a bright stair-stepped line along partly closed lids (a hard step in the lid's shadow against a 1.25 px blended lid edge), the far eye poking past the head's outline at yaw 0.9, a dotted outline on the far cheek, iris, cheek and mouth outlines crawling during turns, an extra arc seam on the crown, a ruled centre seam, a broken ring round the closed eyes. Its second pass found a checkerboard moire on the chest cord in every state and stretched felt on the seated arms. Fixed: the lid line, the crown arc, the centre seam (now hand-sewn: it wanders and varies), the cord (its wraps fade by their own screen-space frequency) and the arm felt. Still present and listed as residual differences: the far eye, the far cheek dots, the outline crawl.
- The cord fade did nothing at first: `.replace()` targeted text that sits inside an `#include` line `onBeforeCompile` had not resolved. Replacing the include line with the chunk's own text (`THREE.ShaderChunk.normal_fragment_maps.replace(...)`) made it work.

**Guard now.** `node scripts/dev/turn-check.mjs` (example mascot: mean 0.07 px, p95 0.17 px at 2x, yaw +-0.5).

## 10. Phase 8: motion from screen recordings, 60 fps (21.2 to 23 h)

- The two recordings could not be opened from the agent's sandbox. The problems were reproduced by stepping the real controller at 60 fps and reviewing contact sheets.
- `scripts/dev/clearance.mjs` measured hands and card against the head over every state at seven pointer positions: Hello, Your turn and Done put a hand through the hood (0.001 units). The sculpt's arm reach (0.49) cannot lift a hand ball (0.22) past a hood 1.13 from the axis, and the art's raised arms are about twice as long, so raised arms stretch (`arm{L,R}.s`). The arm's nap is compressed along the arm by the same amount (`uArmSpan.z`) so fibres keep their size; that needed the arm define in the program cache key, and the compensation direction was wrong on the first try.
- Your turn: the head turns toward a larger card held at arm's length, gripped at its bottom-left because the bottom-right grip in the art would push the card into the hood. Clearances after the pass: Hello 0.11, card 0.072, lowest 0.067 (speaking); the gate fails under 0.04.
- Working: a flat closed laptop slid in (the "box"); it now tips up and opens as it arrives. Headphones fell from above the frame; they now pop on just above the head as he lands. Standing up took 0.2 s; a staged dismount of about 1.1 s runs first and `mascot.lead` tells the page how long the next state's own motion waits. Asking for 'working' while working does nothing.
- Frame rate: the loop had no cap, and the old watcher shed quality only below about 32 fps and then hid every fuzz layer at once. The controller now paces to a whole-number divisor of the display rate with half a frame of slack, and a time-based governor steps down a ladder only after timing frames to completion with a one-pixel `readPixels` (`gl.finish` does not block in Chrome). Every program is compiled at load (`compileAsync`) and the props are warmed through their real updates, because a fading prop is a different program: the first 'working' frame used to cost 67 ms.
- Below 20 percent battery Chrome's Energy Saver held every page, `about:blank` included, to 30 fps. A launch flag that lifts the cap uncaps requestAnimationFrame entirely (22,713 fps was measured), which is useless; the motion check judges against a blank page's rate instead, and real numbers need mains power.
- GLB clips are baked at 30 keys a second; the reel is recorded at 60 fps.

**Guard now.** `node scripts/dev/clearance.mjs` (fails under 0.04 units); `node scripts/dev/motion-check.mjs` (pacing from each state's first frame against a blank page's rate, the graceful exit from working, `lead`, `poke()`); filmstrips of every transition at 10 to 20 frames per animated second.

## 11. Phase 9: the page (21.8 to 24.3 h)

- The page redesign went to an agent in an isolated copy with its own port while the lead finished motion, and was merged three-way (one README conflict).
- The page had copied the controller's framing numbers; the controller now exports `FRAMING` and `validate.mjs` checks the page's maths against `figureBox()`.
- A props texture still drew an invented emblem on the laptop lid; it now uses the owner-supplied mark (`assets/emblem.svg` in the template).
- The page agent's "locked to 30 fps" scroll measurements were Energy Saver, not the page.
- State stills taken right after 'working' kept stale seat offsets; `freeze()` applies the pose twice.
- Final state: 106 of 106 page checks on the dev server and the production preview, 10 of 10 motion checks, clearance and turn checks passing, GLB with 0 errors and 0 warnings, `npm audit` clean, and a written list of residual differences.

**Guard now.** `node scripts/dev/validate.mjs` (copy rules, the real icon, self-hosted fonts, no third-party requests, every scene after a jump scroll, reduced motion, fallbacks) and `node scripts/dev/contrast.mjs` (every word at every scroll stop, and no word on the character).

## 12. Process lessons

- **Parallelise after a draft bake**, one owner per file, each builder in its own copy with its own port, a pristine base snapshot, and a three-way merge with `git merge-file`. When an agent dies mid-task, merge its partial work and relaunch it from a fresh snapshot. Details: `references/agent-operations.md`.
- **Never edit `src/` while a tuner runs.** Vite's hot reload reloads the lab page and the run dies with "Execution context was destroyed". Offline Python, bake scripts and documents are safe to edit meanwhile.
- **Tuner hygiene.** Start from `--live` values; apply one result to the source before the next run (a second fit once restarted from stale parameters); `--live` overrides `--resume`; the apply script must know every new parameter (it missed two face uniforms once and applied a gain twice another time).
- **Use a fresh auditor.** The QA auditor found the lid line and the cord moire that the builder had looked past; brief it with the owner's words and keep it read-only.
- **Deterministic capture.** `freeze()`, `advance(dt, { render: false })`, two nested animation frames before a capture, canvas readback in the same task as the render, `html.capture`, the story camera neutralised, the viewport as tall as the page for full-page shots, waiting out CSS transitions, transparent canvases for pixel counts, integer-pixel alignment (a 1467 px canvas at 350 ppu for the example) and cropping instead of warping.
- **Keep tools in the project.** Scratch space can vanish; the tools became the regression suite.
- **Measure regionally.** Global means hid left/right lighting asymmetry, the crown's low fibre contrast and the chin's bright lip.

## 13. Metrics that passed while the image was wrong

| Metric and value | What the crops showed | What caught it |
|---|---|---|
| Front silhouette IoU 0.976 | ear tabs turned into spheres | shaded side-by-side of the forms |
| Front IoU 0.9695 after a crown term | a flat lid with a crease on the crown | clay render of the sculpt alone |
| Fibre contrast 12.29 against 12.32 | 70 percent of the art's fine fibre energy | narrow Gaussian high-pass at page density |
| Fibre skew and kurtosis errors 0.09 and 0.52 | orange-peel bumps instead of filaments | variant panel at 350 ppu |
| Face fibre energy matched (face scale 1.6) | pebbled leather blobs | 4x crop and the tile's spectrum |
| Luminance percentiles within 1 to 3 levels | lighting symmetric where the art is right-lit | regional cell means |
| Cord contrast chased to the art's 13.1 | barber-pole stripes | native crop; about 9 accepted |
| Every front-on audit clean | teeth and specks along the plate when turned | renders at yaw +-0.5, 0.9 |
| Functional page checks all passing | hand through the hood in Hello | `clearance.mjs` |
| 60 fps in steady states | a 67 ms frame on first entering 'working' | pacing measured from each state's first frame |

## 14. Tuner local optima

| What the tuner did | Why it was wrong | Remedy |
|---|---|---|
| a 1 to 2 px bright rim line | satisfied tonal statistics with few pixels | cap rim power and amplitude |
| rim "up" weight at its maximum | brightened the top to fix a mean | broader softbox light, rim bounded |
| AO floor at its lower bound | black patches under the chin and on the shoulder | bound the floor |
| key light on the left, fill compensating | the art is lit from the right | `--set` into the other basin, regional term |
| bump route instead of albedo route | loss blind to the difference | cap normal strength, judge variants |
| face nap scale 1.6 | shrank strokes into mip blur | fix the tile, scale back to 1 |
| positive mip bias | blurred the fine filaments | spectral match and pre-emphasis |
| shadow softness at its minimum | exploited a sharper shadow map | freeze it |
| plate vignette at zero | the mean face tone dominated | plate top/mid/low cells |
| fibre energy 1.3x to lower the tone term | traded texture for tone | normalise tone by mean luminance |
| edge-profile parameters at their bounds | model too simple for the profile | structured fit per side |
| coordinate descent stalls | cannot find joint moves (normal down while albedo up) | manual grid, then refine |
| fitter: ears shifted out, jowl at 0, crown flattened | sign error, bound too tight, region too small | fix the sign, widen bounds, region terms |

## 15. Dead ends and why they failed

| Tried | Why it failed | Do instead |
|---|---|---|
| procedural fibre strokes | never had the art's density and curl | extract and quilt the art's nap |
| feathered quilt seams | halve fibre contrast along the seam | hard min-error cut |
| hard exclusion of combed windows | too few windows left | soft coherence penalty |
| a global tone curve that saturates shadows | also tints the charcoal | body-only saturation in the shader |
| rim glow to fake fuzz | reads as a glowing outline | tight rim plus blended fuzz layers |
| box intersected with a dome for the head | a ridge where they meet | superellipsoid |
| a front exponent to fit the profile | side IoU got worse | the AI profile is inconsistent; stop |
| a planar, then bowl-shaped cavity | no wall at the sides, then a dented back | plate on the block surface, groove and tuck |
| a thin geometric crevice | narrower than the mesh can carry | analytic line in the shader |
| light-based "pocket" shading round the features | the art's face light disagrees with its body light | measured halo map |
| an evenness (ridge/edge) metric | tracked the spectrum, not the character | side-by-side variants |
| clip-plane lids | straight bars | shader lid with a curved edge |
| per-pixel discard clipping of the iris | staircase and white leaks | stencil buffer |
| a standing laptop at belly height | arms too short, laptop hides the body | seated pose with proportion changes |
| Chrome flags to lift the battery cap | uncaps the frame loop entirely | measure a blank page; plug in |
| SH or basis-light fits of the art's lighting | considered, not needed | more light parameters in the tuner |

## 16. Where the hours went

- **Tuning against a flawed fibre metric** (roughly two hours before the page-scale audit exposed it). Validate a metric on a case you know is wrong before optimising it.
- **The hood-to-face edge built on a wrong 3-D reading** (about an hour of recess variants). Read the art's profile and cross-sections first.
- **Grains that only exist off-axis** (the owner found them after the front-on audits passed). Turned views at both densities found the cause in about a quarter of an hour.
- **Silent patch misses** (at least four: a stale replace target, an unresolved `#include`, whitespace that did not match, an insertion marker in another comment style). Check that a patch changed the text before trusting a render.
- **Stale `public/` copies** (a GLB check and a nap tile served from old files). Sync after every regeneration.
- **A wiped scratch directory and a spend limit** (tooling rebuilt; two hours stopped). Keep tools and caches in the project and the tree mergeable at all times.

## 17. Residual differences at hand-off

What the example mascot still did differently from its art when it shipped, in order of visibility. Expect a similar list for any character and write yours down; the owner accepted this one because it was stated plainly.

- The ears are rounder than the art's tabs and one lacks the art's thin inner seam.
- The underside of the feet is about 25 levels lighter than in the art.
- The hood's roll around the plate is a smooth step in the sculpt plus shading, not a padded tube with an undercut; the two fabrics' fibres do not interlock the way the painted ones do.
- The art's pale filaments on the hood are brighter and sparser; fibre contrast on the chest, leg and arm patches is 15 to 40 percent above the art's while the belly and ears match.
- At yaw 0.9 the far eye white pokes past the head's outline (about 315 background pixels at 2x) with a grey dotted rim; the far cheek's outline breaks into dots at yaw +-0.9; iris, cheek and mouth outlines crawl slightly during turns (sub-pixel dark lines that multisampling cannot smooth).
- Raised arms are about twice the standing length, as in the art's poses; the decision card is gripped at its bottom-left instead of the art's bottom-right, because that grip would push the card into the hood.
- Eyelids, blinks and the open mouth are rendering devices the art never shows; the design has no nose, so none was added.
- The GLB is a lighter vertex-coloured version without the fabric shader, fuzz layers, eyelids or seams.

## 18. Keeping your own log

Write one entry per objection or discovery while the work happens, not afterwards, because the reasons are gone by the end of the day. Record: elapsed time; the owner's words (verbatim in the project, paraphrased when shared); the symptom with the view that shows it (state, yaw, density, zoom); each hypothesis and the measurement that killed or confirmed it; the change; and the gate or check that now guards it. A line in `tests/VALIDATION.md` or a new check in `scripts/dev/` is the durable form of a lesson: a lesson with no gate tends to be relearned.
