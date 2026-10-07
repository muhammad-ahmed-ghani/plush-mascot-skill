# Edge cases that need a decision

Purpose: situations that are not failures but need a choice. Art edge cases (alpha, JPEG, colour grade, props in the front, asymmetric pose, touching sheet views) are in `references/art-analysis.md` section 10.

## Environment
| Case | Decision |
|---|---|
| No GPU / Linux CI | headless Chrome uses software GL: fidelity gates run (slowly), frame-rate gates are meaningless; say so in the report |
| Battery, Low Power Mode, a sleeping laptop | frame rate caps at 30 fps; a sleep during long agent jobs kills their streams: keep the machine awake and plugged in |
| Ports in use, several agents | one port per agent, `--strictPort`; the gates read `MASCOT_ORIGIN` |
| Offline | the page makes no third-party requests; image generation needs the network |
| Python without OpenCV | install `opencv-python`; the tools never import scipy or scikit-image |

## Design
| Case | Decision |
|---|---|
| No face plate / single fabric | remove the wall and tuck, keep the face kit (`references/adapting-to-a-new-character.md` c) |
| Very long limbs, tails, horns, hats | code changes, see recipe (d); cloth and hair are out of scope |
| Asymmetric design | the fit symmetrises its target; asymmetry must be authored in the model and the pipeline's symmetric assumptions checked |
| Transparent or glossy parts | out of scope for the fabric shader; model as separate props |

## Project management
Several agents on one tree: isolated copies, a pristine base and `git merge-file` (`references/agent-operations.md`). Never edit `src/` while a tuner or gate runs. Long jobs run in the background with logs; the pipeline is resumable. When a target cannot be met (an exact pixel match of painted lighting), say so with evidence and list the residual difference; never relabel a miss as a pass. Keep `art/masters` untouched.

## Delivery
Asset size: meshes about 8 MB, nap tiles about 5.7 MB, GLB about 8 MB, reel about 15 MB; serve compressed and cache. Generated-image licensing and watermarks: leave to the user's counsel and record the provenance. Fonts: SIL OFL, shipped with their licences. Privacy: no third-party requests, no analytics in the template.

## Accessibility and browsers
Reduced motion gives a calm layout and no autonomous motion; status is never colour-only; touch targets are 44 px. Safari and iOS: WebGL2 and stencil are used, memory is tighter (use the lite tier); Firefox is untested here: test before promising support.
