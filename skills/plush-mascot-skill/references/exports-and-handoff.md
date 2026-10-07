# Exports and handoff

Purpose: what ships, what each file does and does not contain, how it is verified, and how to hand the project over honestly. Read it in phases 11 and 12.

## 1. Deliverables
| File | What | Verified by |
|---|---|---|
| `assets/mascot-animated.glb` | skinned head, body, arms with vertex-coloured felt and baked occlusion, a soft-edged plate colour, face parts as separate plain meshes, the 17-joint skeleton, ten clips at 30 keys a second (working is 4.8 s); the stretched arms are in the clips (bone rotations plus elbow and wrist position tracks) | `node scripts/dev/evidence.mjs --only glb` (exports from the live page, runs the Khronos validator, writes `tests/gltf-validation.json`), `node scripts/dev/glb-check.mjs` (stock `GLTFLoader` in a bare scene, five frames) |
| `assets/mascot-motion-reel.mp4` / `.webm` | all ten states at 60 fps, recorded frame by frame from the real controller (about 4 minutes) | `node scripts/dev/reel.mjs`, then `python3 scripts/dev/contact-sheets.py` |
| `assets/mascot-runtime-idle.png`, `tests/state-*.png`, contact sheets | stills of the live model | `node scripts/dev/evidence.mjs` |
| `mascot.snapshot()` | transparent PNG at the current canvas resolution | `validate.mjs` (transparent around the figure) |
| `dist/` | the production build (needs an HTTP server) | `npm run build`, gates against `npm run preview` |

The GLB does not carry the studio fabric shader, nap tiles, fuzz layers, eyelids, blended seams, shadows, the torso settling of the seated pose or the props; it looks like a clean soft plush, not like the studio. It has no blendshapes, phoneme audio or native `.riv` / `.blend` project. Sheen support varies by importer. Baked clips can show a seam at the loop; crossfade or use the controller. Pass: validator 0 errors and 0 warnings (informational notices such as the optional sheen/bump extension and unused objects are fine).

## 2. Documents to write for your character
`README.md` (run, rebuild, layout), `HANDOFF.md` (intent, motion contract, integration API, the page, how the model is made, GLB boundaries, validation), `GENERATION-PROMPTS.md` (every kept image: model, size, references, full prompt, why it won), `tests/VALIDATION.md` (from `tests/VALIDATION.template.md`: numbers, dates, machine; residual differences ordered by visibility; what was not tested), `research/` note if a real object inspired the design. State what you did not do: other GPUs and browsers, host-application integration, device profiling.

## 3. Integration guidance for a host application
Import `MascotController`, map application events (not guessed delays) to states, add `lead` to timers tied to a state's animation, never invent progress, priority error/approval over working/thinking, keep a text status and an activity-log button next to the character, one shared renderer for many small views (use the SVG or alpha art for tiny chips), `dispose()` on unmount, handle `quality` and context events. Sizes: alpha art from about 64 px, the animated model from about 120 px and larger (starting points).

## 4. Production boundary
The browser source is the reference preview. For a hero-quality production pipeline, use the art, the turnaround and the baked mesh (`assets/mascot-mesh.bin`: clean, skinned, evenly meshed) as the starting point for retopology and groom in a DCC tool.

## 5. Licences and provenance
Fonts are SIL OFL (`assets/fonts/LICENSES.md`). Generated art is yours under the provider's terms: record the model, the date and the prompts (they are the provenance record), keep the invisible watermark and metadata the providers add, and leave ownership and disclosure questions to the user's counsel. The example mascot's art is an example: replace it.

## 6. Release checklist
Gates 1 to 15 in `references/validation-gates.md` pass in order; gates 10 and 11 also against `npm run preview`; `npm audit` clean; GLB validated; reel at 60 fps; `pipeline.mjs status` shows no example art; documents written; residual differences listed.
