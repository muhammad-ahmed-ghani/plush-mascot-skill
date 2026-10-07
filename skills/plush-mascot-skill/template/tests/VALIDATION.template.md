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
