# Mascot design and implementation handoff

## Character intent

Fill in for your character (see `references/character-brief.md` of the skill): role and personality in three adjectives, the identity features that must never change, the no-go list, colour tokens, where each asset form is used. The example mascot: a warm, capable companion; a broad softly squared coral head with two short diagonal tabs, a pear-shaped torso, mitten hands, a matte charcoal face with cream eyes, a tiny tonal stitched X on the chest; no tail, nose, teeth, fingers or mechanical joints. Keep the app icon (`assets/app-icon.svg`) and the character distinct: the mascot lives inside the product and is never its icon.

Use the high-detail artwork for onboarding, campaigns, empty states and illustrations; the app icon wherever the app itself is meant; the neutral alpha artwork from roughly 64 px; the full-body animated model around 120 px and larger (starting points, not measured device limits).

## Motion contract

| State | Trigger in a real application | Performance | Exit / looping |
|---|---|---|---|
| idle | No active task, available | Slow breath, occasional blink | Loop; subtle |
| greeting | First arrival or explicit greeting | One wave: the arm lifts out to the side, stretched so the hand stays clear of the hood, and the forearm swings | 2.4 s; play once, return idle |
| listening | Input capture is actually active | Lean in, attentive tilt | Hold while input is active |
| thinking | Planning/reasoning event | Upward glance, hand near chin | 3.6 s variation; subtle |
| working | A tool or job is running | Sits down, the headphones pop on as he lands, a laptop slides in and opens as it arrives, then steady typing with the odd nod and weight shift | About 2.5 s to settle, then a typing rhythm until the state ends. Leaving it takes about 1.1 s: the typing stops, the lid closes, the headphones lift off and he stands up with a little lean (a celebration springs up from the seat almost at once) |
| approval | Backend requests a decision | The head turns toward the decision card, which one long arm holds out to the side; the other hand offers an open palm | Hold indefinitely until a decision |
| success | Backend confirms completion | One hop, both arms up in a V, small confetti | 2.4 s; play once, then idle |
| error | Recoverable failure or blockage | Concerned tilt, small downward mouth | Hold with explanation and retry |
| speaking | Audio output is actually playing | Gentle gesture, mouth amplitude | Stop when playback ends |
| resting | No active work and intentionally dormant | Closed eyes, settled pose | Slow 4 s breath |

The library does not decide whether work has succeeded and must not invent progress. Drive states from application events. The studio's task flow is explicitly simulated. In production, priority should be error/approval over working/thinking, then idle. Acknowledging a user is not evidence that a tool finished.

Never auto-approve because a timer expires. Keep explicit labels and deterministic buttons next to the character. Expose an activity log on selection. Do not encode status only by color or expression.

Motion is eased per key: face, prop and lift keys use exponential interpolation (about 11/s by default, per-key rates in `RATE` in `src/mascot.js`), while body keys (arms, head, torso, the root's rotations) follow slightly under-damped springs, so a gesture overshoots a little and settles the way a body with weight does. Blinks are asymmetric and seeded: the lids fall in about 80 ms (accelerating), stay shut for 35 ms and open over 190 ms with a soft landing; blinks come every 2.4 to 6 s, sometimes doubled, and often right after the state changes, and the upper lid rides the eyeball when Mascot looks down. Glances (small and large saccades, often back to centre) happen every 0.7 to 3.3 s while awake. Success is anticipated with a small crouch before the hop. Raised arms stretch: the sculpt's arms (reach 0.49) cannot lift a hand clear of the wide hood (half-width 1.13, hand ball 0.22), and the artwork's raised arms are about twice as long, so the pose keys `armL.s` / `armR.s` (0 = as sculpted, 1 = twice as long) lengthen the arm through its elbow and wrist bones, and the arm's fabric squeezes the nap's coordinates along the arm by the same amount so the fibres keep their size. `node scripts/dev/clearance.mjs` steps every state at 60 fps for seven pointer positions and fails if a hand or the decision card comes within 0.04 of the head. One-shot return-to-idle behavior is implemented by the studio (`src/app.js`); library consumers must implement their own completion policy, and must add `mascot.lead` (see below) to any timer tied to a state's own animation. Baked GLB loops are reference clips and can show a reset at the seam; crossfade loop boundaries or use the procedural controller. Greeting and success should never loop indefinitely.

## Browser integration

Install the pinned dependencies from `package-lock.json`, then import the reusable controller:

```js
import { MascotController } from './src/mascot.js';

const mascot = new MascotController(document.querySelector('#mascot'), {
  state: 'idle',
  reducedMotion: window.matchMedia('(prefers-reduced-motion: reduce)').matches
});

// Map these to events from your application, not guessed delays.
mascot.setState('working');
mascot.setState('approval');
mascot.setState('success');

// Speaking demo defaults to a synthetic mouth envelope.
// For actual speech, supply a normalized audio amplitude from 0 to 1.
mascot.setState('speaking');
mascot.setVoiceLevel(0.45);
mascot.setVoiceLevel(0);

mascot.setReducedMotion(true);
// When unmounting:
mascot.dispose();
```

Give the container a measurable width and height. Add a text status outside the canvas, and an accessible button for the activity log. The renderer caps device pixel ratio at 2, sizes through ResizeObserver, skips frames offscreen or when the page is hidden, and frees resources on disposal.

Frame rate: the controller draws at most 60 frames a second (`fps: 60` by default; `0` draws every display frame) on evenly spaced display frames: a 120 Hz screen draws every second frame, a 144 Hz one every second (72 fps), 240 Hz every fourth, and 75 or 90 Hz screens draw every frame. A governor times the frames it draws in windows of 0.6 s and, when they miss the pace by more than about 12% twice running (or by half again once), takes the next step down a ladder, least visible first: half the fuzz layers, a 1.5× pixel ratio, no fuzz layers, 1.25×, 1× (each step is skipped if the tier is already there) and emits `quality` with `{ level, avgMs, pixelRatio, shells }`. It only steps down. Measured on an Apple M5 Pro: 60.1 fps in every state at 2× density; a render costs about 10 ms at 1440 × 900 and 17 ms at 2400 × 1500 with all four fuzz layers (about three quarters of it), 6 ms and 10 ms with two.

Stage control for a page that scrolls: `new MascotController(el, { pointer: 'window' })` tracks the pointer anywhere in the window and measures the gaze from where Mascot is drawn; `setView({ x, y, zoom, yaw })` eases the camera's framing (shift as a fraction of the container, magnification about its centre, an extra turn of the body; instantly under reduced motion) and `figureBox()` follows it. `setState` returns at once but the new state's own motion may start later: leaving `working` puts the seat away first (and asking for `working` while working does nothing), so read `mascot.lead` (seconds) right after `setState` and add it to any timer tied to that state's animation. The studio includes a static-image WebGL fallback. Reduced motion removes autonomous pose motion; pointer response remains user initiated.

Quality tiers: `quality: 'high' | 'medium' | 'low'` (chosen automatically from the device if omitted). High uses the 171k-triangle mesh, four fuzz layers and a 2048 shadow map (about 0.9 million triangles a frame with the fuzz layers); medium the 83k-triangle mesh and two fuzz layers; low the lite mesh without fuzz. If frames stay slow the governor described above steps the cost down on its own. The nap texture is grown slightly as Mascot is drawn smaller, which measured closest to the artwork rescaled to each density.

Framing: the camera is level, on a long lens (8° field of view) and frames the stage so the character at rest sits exactly where `assets/mascot-transparent.png` would if drawn on the stage. `figureBox()` returns that rectangle (CSS pixels) and the studio uses it to place its poster, so the fade from artwork to live model does not jump in size or position.

Deterministic capture: `freeze(state, seconds, { time, override, look })` poses the model exactly (blinks are seeded), `advance(dt)` steps the clock, and `telemetry()` reports frame timing. `scripts/dev/*.mjs` use these to compare the live model with the artwork, to record the reel frame by frame and to produce `tests/`.

`poke()` plays a small reaction on top of whatever state he is in (a startled blink, a hop and nod, the ears flick, a bigger smile; nothing under reduced motion), for a click or a tap on him. `setState` rejects unknown state names. `statechange` emits `detail.state`. `snapshot()` returns a transparent PNG data URL at the current canvas resolution. `exportGLB()` returns a binary ArrayBuffer with ten baked animation clips. The controller supports `turntable` for design inspection; do not enable it in normal app use.

## The page

The showcase page is a short scroll story on Mascot's stage. It is built from `index.html`, `src/style.css`, `src/app.js` and `src/page/` (`story.js` the scenes, camera, palette and scroll rules; `felt.js` the cut-felt pieces, swatches and stars; `workbench.js` the drawer, activity log and exports; `fx.js` headline words and stitched frames; `color.js` OKLab blending and contrast).

- **Stage contract.** `#stage` is a fixed, full-window, pointer-transparent, `aria-hidden` container with the only canvas (`new MascotController(stage, { pointer: 'window' })`, `window.mascot` stays). The content scrolls over it. The camera is written with `mascot.setView({ x, y, zoom, yaw })` only; nothing else of the controller is touched. Framings are worked out from the window size (`toView`, `tallFrame` in `story.js`) and the page takes the controller's `FRAMING` (level at y 1.75, fitting 4.4 units of height or 3.5 of width) and its own projection maths is checked against `mascot.figureBox()` by `validate.mjs`.
- **Scenes.** Hello (greeting), I listen first (listening, pushed in), Then I think it over (thinking), Then I get to work (working, dark room with the app icon's rose glow, camera pulled back for the laptop), Some things are your call (approval, with Approve and Not yet), Done (success), Come a bit closer (face, chest, whole figure, he turns round, the two prints and the four felt swatches), That's where I live (resting, the big app icon). Sections are tall with a sticky frame; between two holds the palette, camera and felt blend with the scroll position.
- **States.** The scene's state is requested after it has been active for 380 ms; a repeat request is dropped; `working` is never left sooner than 1.6 s after it began; `greeting` and `success` return to the scene's resting state `mascot.lead + duration` seconds later. People's own choices apply at once. Approve never happens by a timer.
- **Workbench.** The ten states (`#states [data-state]`), the reduced-motion and turntable switches, PNG snapshot, GLB export and the activity log. It opens on the side Mascot is not on, or as a sheet from the bottom on a tall screen.
- **Reduced motion.** The OS setting or the `#reduce` switch gives a calm static layout: no scroll-driven state or camera changes, no parallax, no marching stitches, Mascot in a fixed idle pose.
- **Copy and type.** Mascot's own voice, sentence case, no arrows, numbering, spaced-caps labels or em dashes. Fraunces (headlines), Alegreya Sans (text), Covered By Your Grace (margin notes), self-hosted; `scripts/dev/build-fonts.py` rebuilds the subsets. The felt nap texture is generated by `scripts/dev/make-page-textures.py`.

## How the model is made

- **Sculpt.** `scripts/bake/model.mjs` defines Mascot as a signed-distance field (super-ellipsoid head, tilted rounded-box ears, ellipsoid torso, round-cone legs and arms). The face plate is the head's own domed surface, so its apex reaches the artwork's profile; along the plate's outline the hood's edge steps down to the plate across a smooth wall (`face.wallW`, continuous with a continuous slope: a step in the field is cut as a staircase by the grid and shows as teeth when the head turns) and the plate tucks in under it. `fit.mjs` fits the parameters to the artwork's front and profile silhouettes (parallel coordinate descent on IoU and boundary-band agreement). `folds.mjs` carves the belly fold and the hood's seam loop into the field.
- **Bake.** `bake.mjs` meshes each part with surface nets (vertices projected onto the exact surface, analytic normals; triangles are wound from the grid topology and none are dropped, so the surface is watertight - `scripts/bake/check-mesh.mjs` verifies it), splits the head's triangles within 0.1 units of the plate's outline once more (`refine.mjs`: red-green refinement, new vertices projected back onto the field, so the roll and the wall stay smooth at any viewing angle), computes skin weights for a 17-joint skeleton, ambient occlusion and curvature of the LARGE form (the crevice and folds are left out and drawn by the shader; arms are occluded only by the rigid head and torso, so they do not go dark when they swing away), and a per-vertex signed distance to the construction seams lifted from the artwork (`seams.mjs`). Everything is packed into the small `MSCT` binary.
- **Fabric.** `scripts/nap/build.py` extracts the nap from the artwork (multiplicative high-pass, contrast levelling, toroidal image quilting, spectrum matching, and a fitted pre-emphasis that cancels the blur of fetching the tile at screen density; `scripts/dev/fit-nap-spectrum.py`) into two 1024 px tiles. `src/mascot-fabric.js` patches `MeshPhysicalMaterial`: triplanar sampling in rest space, filament colour plus relief plus sheen, wrapped diffuse only (the specular terms keep the true N·L so they cannot spike), warm terminator, baked occlusion, soft Poisson shadows, a tight fringe and blended fuzz layers at the silhouette, analytic and baked seams, the hood-to-plate edge (the colour boundary, a thin dark crevice line, the plate tucking under the lip, all anti-aliased to the pixel footprint and measured against the artwork's luminance profile across that seam), the face fabric's measured light around each feature, and a hue-preserving tone curve. Texture fetches are made before any branch or discard that depends on the pixel (derivatives are undefined after one).
- **Face.** `src/mascot-face.js` and `src/face/` build the egg-shaped eye pillows (satin sclera cut to the measured outline with its measured rim ramp and shade map; iris, pupil and catchlight appliqués that follow the gaze and are clipped to the eye by the stencil buffer, so the clip edge is a multisampled geometry edge; two eyelids of the plate fabric with a curved free edge, rolled lip, contact ring and a soft shadow on the white), appliqué cheeks, a parametric raised mouth (two cords and a dark inside when it opens; its underside is shaded) and the wound-cord X in its trench. The thin dark contact lines round the cheeks and the mouth are widened on small displays so they never drop below a pixel (`setPixelSize`).
- **Props.** `src/mascot-props.js` and `src/props/` hold the headphones (a padded felt band over the crown and deep rounded cups with a graphite trim ring, modelled on the artwork's vignette; they pop on a hand's breadth above the head as he lands and lift off when he gets up, never leaving the frame), the laptop (a slim charcoal unibody on rubber feet with chamfered edges and the app icon's woven X embossed on the back of the lid, a recessed keyboard of individual keycaps with legends, a trackpad, speaker grilles, ports, a hinge barrel and a thin lid with a screen that wakes and shows a small UI; it slides in a short way, tips onto its edge and opens as it arrives (the lid starts to rise after the first few percent, so it is never a flat closed slab on the floor), the key under each real hand ball goes down when that hand strikes, and each keystroke adds a character on the screen), the decision card and exactly three confetti pieces. The seated pose needs the artwork's proportions (a shorter torso, longer arms, legs that flatten onto the floor), which `src/props/lp-seat.js` applies to the skeleton (the settling torso, the flattened legs, the shoulders) while the laptop is out and restores on standing; the longer arms are the pose's `arm{L,R}.s`, like every other raised arm. The exported GLB carries the bone rotations and the elbow and wrist positions (so the stretched arms are in its clips) but none of the torso settling or the props.
- **Tuning.** Every look parameter that has a counterpart in the artwork (light, fabric, colour gains, fibre statistics, rim, cord, plate) is set by `scripts/dev/tune2.mjs` against the artwork rescaled to the same on-screen density, not by eye. Re-run it after changing the sculpt, the nap or the lights.

## GLB and production boundaries

The saved GLB (about 7.8 MB) contains the skinned head, body and arms with vertex-coloured felt (baked occlusion, a soft-edged charcoal plate), the face parts as separate meshes with plain materials, the 17-joint skeleton and ten baked clips with 30 keyframes a second (players interpolate between them; the working clip is 4.8 s long, sit-down and typing). It loads with the stock `GLTFLoader` (`scripts/dev/glb-check.mjs` does exactly that in a bare three.js scene, and renders frames of its clips) and the Khronos validator reports zero errors and zero warnings; the six informational notices are the optional sheen extension and unused objects. It does **not** carry the studio's fabric shader, nap tiles, fuzz layers, eyelids, blended seams or shadows, so it looks like a clean soft plush rather than like the studio; it has no face blendshapes, phoneme audio or native `.riv`/`.blend` project. Sheen support varies by importer.

The browser source is the reference preview. For a hero-quality production pipeline, use the artwork, turnaround and `assets/mascot-mesh.bin` (a clean, skinned, evenly meshed sculpt) as the starting point for retopology and groom in a DCC tool.

Do not load the mesh, nap tiles and GLB repeatedly for a tiny status chip. Prefer the SVG or alpha artwork there. For larger interactive views, share one renderer or cache the model; profile on your actual supported devices before shipping. Device profiling and integration into a host application's backend are not part of this prototype.

## Validation

Browser checks (`scripts/dev/validate.mjs`) cover the page's copy and type rules, the real icon and self-hosted fonts, all ten states in the workbench (with real joint rotation changes), every scene's state and camera after a jump scroll on a desktop and on a phone, scroll wiggles, the approval demo (waiting, Approve carrying on to Done, Not yet and Ask again), poking Mascot, the activity dialog, reduced motion (the switch and the OS setting), keyboard access, both exports, the no-WebGL fallback and the tall layouts; `scripts/dev/contrast.mjs` measures contrast and overlap with Mascot at every scroll stop. The character's motion has its own checks: `clearance.mjs` (hands and the decision card against the head, every state, 60 fps), `motion-check.mjs` (frame pacing, leaving Working, `mascot.lead`, `poke()`) and `view-check.mjs` (the poster against the live model after `setView`). Desktop inspected at 1440 x 900, 1920 x 1080 and 1024 x 768, tall screens at 820 x 1180 and 390 x 844. Model fidelity is measured, not judged by eye: see `tests/VALIDATION.md` for the comparison against the artwork and the numbers it produced. Validation artifacts are in `tests/`.

See `research/REFERENCE-ANALYSIS.md` for observations versus confirmed implementation details. See `GENERATION-PROMPTS.md` for all final artwork prompts and generation method.
