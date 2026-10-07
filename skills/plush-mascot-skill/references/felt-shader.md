# Felt shader and fabric nap

Purpose: how the plush fabric is taken out of the artwork (the nap tiles), how the patched three.js material renders it, and how it is tuned and measured against the art at several screen densities.
When to read: phase 6 (fabric), whenever a render looks plastic, blotchy, grainy or wrong at the silhouette or the hood-to-plate edge, and before touching `src/mascot-fabric.js`, `scripts/nap/` or the tuner.

## Contents

1. The idea: the nap comes from the art
2. Files and data flow
3. Nap extraction step by step (`scripts/nap/build.py`)
4. The pre-emphasis fit (`scripts/dev/fit-nap-spectrum.py`)
5. The material (`src/mascot-fabric.js`)
6. Parameter table
7. Studio light and tone curve
8. The tuner (`tune2.mjs`, `apply-tuned.py`)
9. The evaluation (`eval.mjs`, `turn-check.mjs`, crops)
10. Shader traps
11. Performance
12. Recipe for a new character's fabric
13. Other fabrics

Conventions: "units" are character units (the registration frame's `ppu` pixels per unit, 350 for the example art, see `mascot.config.json` `frame`). "ppu" in a render means drawing-buffer pixels per unit: 350 is the art's own density, about 246 is the page stage on a 2x display, about 123 on a 1x display. The main outer fabric is **body**; the inset face fabric is **face** (the "plate"); the head's outer padded fabric around the plate is the **hood**.

## 1. The idea: the nap comes from the art

Seen at 4x, the example art's body fabric is a dense web of thin, curled, pale filaments (about 1 px wide and 4 to 9 px long at 350 px per unit) over a darker, calmer red ground; the face fabric is the same structure in low-contrast grey. The luminance of that texture has positive skew and heavy tails (sparse bright hairs, a few deep gaps), not the symmetric bumps of noise.

A procedural generator was tried first (still in `src/mascot-felt.js`, `generateFeltMaps`: seeded hook-shaped strokes rasterised into a tile). Every setting failed side by side with the art: too dense it merged into a plateau, sparser it read as speckle or blotchy clumps, never as the art's curled filaments. A multiplicative high-pass of a flat region of the art showed the real thing at once. So the nap is extracted from the art itself and quilted into seamless tiles at the art's scale. The procedural maps survive only as the fallback when the tiles fail to load, so the character never renders blank.

Because the art is the source, the tile inherits whatever the art has. Generate a macro fabric sheet or a large, sharp neutral front (`references/image-generation.md`), never AI-upscale it (upscalers invent fibres that then get baked into the product), and check the flat-region fraction and fibre energy with `art_qa.py` (`references/art-analysis.md`).

What the shader must reproduce, read off the example art at 4 to 5x (crop your own the same way before you tune):

| Where | What the art shows |
|---|---|
| Flat body fabric | pale curled filaments over a darker ground; colour, not relief; crisp at 350 ppu |
| Face plate | the same filaments, grey, low contrast, slightly cooler; never sparkly |
| Silhouette | a bright, soft fringe 1 to 2 px wide with partial alpha, no hard outline |
| Hood to plate | a bright rounded lip on the hood, a thin dark crevice, the plate darkening as it tucks in under the lip |
| Seams | a narrow dark groove with soft puffy shoulders; hand-sewn, so it wanders |

## 2. Files and data flow

| Step | File | Output |
|---|---|---|
| Registered art | `assets/mascot-transparent.png` (canonical frame) | input |
| Extract and quilt | `scripts/nap/build.py` | `assets/mascot-nap-body.png`, `assets/mascot-nap-face.png`, cache in `scripts/nap/.cache/` |
| Pre-emphasis curves | `scripts/dev/fit-nap-spectrum.py` | `scripts/nap/body-emphasis.json`, `scripts/nap/face-emphasis.json` (read by `build.py`) |
| Scaled references | `scripts/dev/scaled-ref.py` | `scripts/dev/.refs/ref_<ppu>.png` |
| Loader and fallback | `src/mascot-felt.js` | `NAP_TILE`, `loadNapImages`, `generateFeltMaps` |
| Material | `src/mascot-fabric.js` | `createFabricMaterial`, `FABRIC`, `ensureNapTextures`, `shellThreshold` |
| Light and tone curve | `src/mascot-studio.js` | `STUDIO`, `installToneMapping` |
| Nap zoom, shells, tiers | `src/mascot.js`, `src/mascot-rig.js` | `_updateNapZoom`, `TIERS`, shell meshes |
| Lab harness | `lab.html`, `src/lab-ctrl.js`, `src/lab-metrics.js` | `window.lab` (render at a density, set params, evaluate) |
| Tuning | `scripts/dev/tune2.mjs`, `scripts/dev/apply-tuned.py` | tuned JSON, source defaults |
| Gates | `scripts/dev/eval.mjs`, `scripts/dev/turn-check.mjs` | printed metrics |

The dev server serves `public/` before the project root, so a tile regenerated in `assets/` is stale in the browser until `node scripts/sync-public.mjs` runs (the bake copies only the meshes). `fit-nap-spectrum.py` syncs by itself; after a manual `build.py`, sync.

## 3. Nap extraction step by step

```bash
python3 scripts/nap/build.py                      # both tiles; reuses the quilt cache
python3 scripts/nap/build.py --only face          # one tile (body | face)
python3 scripts/nap/build.py --fresh              # re-quilt (ignore scripts/nap/.cache)
python3 scripts/nap/build.py --no-emphasis        # without the pre-emphasis, to compare
python3 scripts/nap/build.py --preview /tmp/nap   # also writes tile_<tag>.png and tile_<tag>_rolled.png
node scripts/sync-public.mjs
```

Flags: `--out` (default `assets`), `--size` (tile edge, default 1024; must be a multiple of the block step 64), `--seed` (default 1), `--preview DIR`, `--fresh`, `--no-emphasis`, `--only body|face`.

**3.1 Source pools.** Only flat, evenly lit, feature-free fabric may feed the tile, because anything else (shading gradients, seams, the chest mark, feature halos) gets copied into every repeat of the tile.
- Body pool (`body_pool`): opaque (alpha > 250) and body-coloured (`R > 90`, `R > 1.3 G`, `R > 1.3 B`), eroded with a 31 px square (15 px in from the silhouette), minus edge-energy hot spots (Sobel of the green channel after a sigma-3 blur, above 2.6, dilated with a 5 px square, then opened with 7 x 7 so isolated nap ridges are not mistaken for seams), minus exclusion circles `(x, y, radius)` in art pixels (the example excludes its chest mark with `(650, 800, 80)`).
- Face pool (`face_pool`): the largest dark component (luminance < 95), eroded with a 21 px square, minus a 51 px square dilation of everything brighter (the eyes, cheeks, mouth and their halos).
- Only the registered neutral front is used. The example hero is drawn about 30 percent softer, and mixing sources of different sharpness blurs the tile.
- Example mascot: 369,977 clean body pixels and 58,198 face pixels (printed first by `build.py`). A new character's colour rule lives in `body_pool` and `face_pool`; change it there (and the matching `bodyAt` test in `src/lab-metrics.js` and the window tests in `fit-nap-spectrum.py`).

**3.2 Multiplicative high-pass.** `(c - blur_5(c)) / blur_5(c)` with a Gaussian of sigma 5 px. Shading multiplies albedo, so dividing by the local mean removes the light and leaves the fibres' relative contrast, whatever the region's brightness. The body uses the green channel (on red felt it carries the filament contrast; red is near saturation); the face uses `0.5 R + 0.4 G + 0.1 B`.

**3.3 Band limit and contrast levelling** (`band_limit`). Subtract a sigma-7 blur (residual shading blobs), divide by the local standard deviation (sigma 22) floored at 0.6 times its median (so flat areas are never boosted into noise), then scale the clean pixels to unit variance. Every source now has the same contrast, so quilting can mix them.

**3.4 Coherence map** (`coherence_map`, structure tensor, sigma 9). 0 means isotropic curly felt, 1 combed in one direction. Where felt flows along a form it is combed; quilted into a tile it shows as brushed streaks on a flat patch. The window cost adds `0.7 x (known pixels) x (mean coherence)` so isotropic windows win.

**3.5 Toroidal image quilting** (`quilt_torus`, Efros and Freeman). Parameters: tile `N = 1024`, block `B = 80`, overlap `W = 16` (step 64, 16 x 16 blocks), eight dihedral variants of every source, candidate windows entirely on valid pixels. Each block is matched to the already-filled overlap by masked sum of squared differences; every candidate within `0.10 x overlap pixels` of the best is equally acceptable and one of the best 12 (non-maximum suppressed by 10 px) is drawn at random, so the tile is not one long verbatim copy; the exact continuation of a neighbour's source position (within 6 px) is banned. Overlaps are cut along minimum-error seams (dynamic programming) with a hard cut: feathering halves the fibre contrast along every seam, which showed as a faint grid. Positions wrap (`np.roll`), so the tile is seamless by construction. `build.py` prints the wrap-seam to interior neighbour difference ratio; about 1.0 is invisible (example: body 0.95 / 0.89, face 0.95 / 0.97). Look at `tile_<tag>_rolled.png` from `--preview`: rolled by half a tile, any seam sits in the middle.

**3.6 Spectrum matching** (`match_spectrum`). Quilting and levelling push energy toward finer detail than the art's (example: median frequency 0.60 against 0.55 of Nyquist), so the tile first gets a 0.62 px wrap-around blur, then its radial power spectrum (400 Hann-windowed 64 px windows) is reshaped to the pools' own: gain `sqrt(target / have)` per band, clipped to [0.25, 4], smoothed over three bins, applied in the Fourier domain so the tile stays seamless. The printed "spectrum gain by band" is this curve (example body: 0.44 at the lowest band rising to 2.55 at the highest).

**3.7 Pre-emphasis.** The fitted curve from `scripts/nap/<tag>-emphasis.json` (section 4) is applied the same way (log-linear between knots, Fourier domain). Without a JSON the face tile gets `default_emphasis()` (inverse of a bilinear fetch's sinc squared response, capped at 2, tapered back to 1 at the texel pitch because a boost right at Nyquist becomes a visible lattice) and the body tile none.

**3.8 Tile layout** (`to_maps`). Clip to plus or minus 4 sigma; `B = 0.5 + d / 5` is the filament height (0.5 is the mean); normals come from a sigma-0.75 wrap blur and central differences with strength 2.4, stored as `R, G = n.xy * 0.5 + 0.5` (tangent space). One texel is 1/ppu units at the art's scale (`NAP_TILE = 1024 / 350` units per tile in `src/mascot-felt.js`). The PNG is RGB8 without alpha, because browsers may premultiply an RGBA image on decode and destroy data wherever alpha is low.

**3.9 Determinism, cache, runtime.** Seeds are fixed (body `--seed`, face `--seed + 11`); the raw quilt is cached as `scripts/nap/.cache/<tag>-<size>-<seed>.npy`, so a changed tile name, size or seed re-quilts. Verified on the template: a cached rebuild takes 1.3 s and a fresh re-quilt of both tiles about 290 s on an M5 Pro; both produced tiles byte-identical to the shipped ones. A rebuild that changes bytes without an input change is a regression.

## 4. The pre-emphasis fit

Why: the tile carries the art's thin hairs, but a texture fetch at screen density blurs the finest ones (a bilinear tap attenuates a pattern of r cycles per texel by about sinc(r)^2, and the mip chain averages further). The lighting then shows the softened pattern as cloudy blotches instead of crisp hairs. This was half of the owner's complaint about grains and an unclear, pixellated texture along the plate when the head turned (the other half was a cliff in the sculpt), and it only showed at page scale. The fix boosts the tile's fine frequencies in advance, by exactly as much as the renderer loses, measured on the rendered image.

```bash
# needs the dev server (MASCOT_ORIGIN, default http://127.0.0.1:4173) and the scaled references
python3 scripts/dev/scaled-ref.py
python3 scripts/dev/fit-nap-spectrum.py --tile face          # then: --tile body
# options: --iterations 4  --ppus 350,246,123  --damping 0.8  --min-freq 0.06
```

What it does per iteration: writes the knots to `scripts/nap/<tile>-emphasis.json`, rebuilds that tile (`build.py --only`), syncs `public/`, renders the live model at each density (`audit.mjs --ppu N`), takes square windows (64 px at 350, scaled with ppu) lying wholly on feature-free fabric in the art, computes band energy in 10 log-spaced bands from 0.035 to 0.5 cycles per pixel for live and art, and takes the log ratio. It removes the total (only the spectrum's shape is fitted; overall contrast is the job of `uFaceDetail` or the `tex` tuner group), converts pixel frequencies to texel frequencies (`x napZoom x ppu / 350`; the zoom table `{350: 1.0, 246: 1.0845, 123: 1.369}` must match `_updateNapZoom`), weights densities 0.2 / 0.45 / 0.35 (the page is seen at about 246 and 123), smooths across knots (0.25, 0.5, 0.25), damps by 0.8 and clips gains to [0.3, 4]. Bands below `--min-freq` (0.06 cycles per pixel) are ignored: that is shading across the window, not texture.

Reading the output: each line is `ppu (windows): energy live/ref by band ... | total T (std ratio S)`. Bands near 1.00 are matched; the fit converges when they stop moving. `total` is the leftover overall contrast: fix it with the texture uniforms, not with the curve.

| Metric | How measured | Pass (suggested) | Example mascot | If it fails |
|---|---|---|---|---|
| Per-band energy ratio, plate | printed per band at 246 | 0.7 to 1.25 | 0.7 to 1.0 | more iterations; check the windows avoid features and the plate edge |
| Per-band energy ratio, body | same, body windows | 0.7 to 1.25 | 0.73 to 1.23 | same |
| Plate fibre contrast (std ratio) | `std ratio` | 0.85 to 1.15 at each density | 0.87 / 0.93 / 1.05 | tune `uFaceDetail` (`--only tex`) |
| Body fibre contrast | `std ratio`, body | 0.85 to 1.15 | 1.00 / 1.02 / 1.12 | tune `uFibAlbedo`, `uFibGain` |

Example knots (cycles per texel, gain): face peaks at 1.93 at 0.40 and falls to 1.08 at 0.50; body peaks at 2.27 at 0.45. Re-run the fit after changing the nap tile, the lights, the mip bias (`uFeltBias`, `uFaceBias`), the nap zoom rule or the tone curve, then re-run `tune2.mjs --only tex`, because every one of those changes what the fetch loses or how contrast reads.

## 5. The material

`createFabricMaterial()` returns a `MeshPhysicalMaterial` (roughness 1, metalness 0, `specularIntensity` 0.12, sheen) patched in `onBeforeCompile`, so shadows, image-based light and sheen come from three.js and only the felt-specific parts are added. Defines select the variant: `MASCOT_HEAD` (part `head`: plate, crevice, halo, centre seam), `MASCOT_BODY` (back seam), `MASCOT_SHELL` (fuzz layer), `MASCOT_FORCE_FACE` (all face fabric: eyelids, headphone band), `MASCOT_ARM` (stretchable arm). The uniforms live on `material.userData.mascot`; change them there at runtime.

Injection points (chunk replaced or extended, and what goes in):

| Chunk | Added |
|---|---|
| vertex `common`, `skinnormal_vertex`, `begin_vertex` | attributes `ao`, `curv`, `seam`, `seamDir`; rest position `vRest` and rest normal; `vRestToView = normalMatrix * mat3(skinMatrix)`; shell offset; arm stretch |
| `shadowmap_pars_fragment`, `lights_fragment_begin` | 16-tap Poisson soft shadow, faded toward the terminator |
| `lights_physical_pars_fragment` | wrapped diffuse with a warm terminator (diffuse only) |
| `color_fragment` | nap fetches, filament colour, seams, hood-to-plate edge, face halo, shell alpha |
| `normal_fragment_maps` | nap normal, seam and edge slopes |
| `lights_physical_fragment` | sheen colour, broad and tight rim emission |
| `aomap_fragment` | baked AO and the crevice on every light term |
| `opaque_fragment` | body-only shadow toe; `DEBUG.term` outputs |

**5.1 Triplanar sampling in rest space.** Every fetch uses the bind-pose position `vRest` and normal, so the pile sticks to the fabric while bones bend it; world-space triplanar would make the fibres swim across a moving arm. Weights are `|n|^5` normalised, each plane's lookup flips sign with the normal so textures are not mirrored, and the three tangent-space normals are combined with a whiteout blend. The coordinate scale is `(1 / NAP_TILE) / uNapZoom`. The face tile is fetched for every pixel of the head (not only on the plate) and blended by the plate mask, see trap 10.1.

**5.2 Filament colour, relief and sheen.** The art's fibres are albedo, so colour carries most of the texture: `fibN = (height - uFibCenter) * uFibGain`; the crests `max(fibN, 0)^uCrestPow` add tip colour (sparse, thin bright filaments), `uFibAlbedo` modulates the base by `fibN`, and `uCavity` darkens the gaps. Relief (`uNormalStrength`) stays low because stronger relief read as leather or orange peel. On the plate `uFaceDetail`, `uFaceTip` and `uFaceRelief` retune the same terms (its hairs are dull, never sparkling). `uUpFibre` adds amplitude on upward-facing pile, because the lit crown sits on the tone curve's shoulder where contrast is squeezed. A blend guard `1 - 4f(1 - f)` fades the tips inside the few pixels where the two fabrics blend (a body filament boosted by the plate's detail gain flashes white there). Curvature lifts ridges and darkens folds by up to 18 percent; two octaves of value noise (`uMottle`, `uMacro`) add soft mottling. `uFaceVignette` darkens the plate toward its lower rim, as the art does. Grazing light: the three.js sheen (`sheen`, `sheenRoughness`, per-fabric sheen colour), a broad rim `(1 - N.V)^uRimPower` weighted toward the key side (`uRimUp`, `uRimSide`) and broken up by fibre height, and a tight pale fringe `(1 - N.V)^uRimTightPower` that makes the art's bright outline. Rims are suppressed on the plate, in seams and in the crevice. The nap normal is kept right up to the silhouette (fading only below N.V = 0.14) because fibres catch light most at grazing angles.

**5.3 Wrapped diffuse, true N.L for specular.** `wrapNL = saturate((N.L + uWrap) / (1 + uWrap))` feeds only the direct diffuse term; GGX and sheen keep the true N.L. Their visibility terms divide by N.L + N.V, so a wrapped irradiance that no longer cancels the denominator exploded at grazing angles: 1,227 near-white single-pixel spikes on the example head, 6 after the fix. Below N.L = 0.6 the diffuse is tinted toward `uTerminator` (light scattering through felt goes warm, not grey), except on the plate. Shadow maps are faded out toward the terminator (`smoothstep(-0.02, 0.38, N.L)`), because wrapped light keeps shading past N.L = 0 and a hard shadow cut there reads as a crescent.

**5.4 Baked occlusion.** Per-vertex `ao` (Uint8) and `curv` (Int8) from the bake (`references/mesh-bake.md`: baked from the plain block, crevices and folds left to the shader). AO scales indirect diffuse and sheen, indirect specular through `computeSpecularOcclusion`, and the direct terms by `uAODirect`, floored at `uAOFloor` because felt scatters light into its folds. Hand-built meshes (face pieces) must carry neutral `ao = 1`, `curv = 0` attributes (`neutralAttributes` in `src/face/footprint.js`), see trap 10.12.

**5.5 Soft shadows.** `mascotShadow` replaces `getShadow` for directional lights: 16 Poisson taps rotated per pixel by interleaved gradient noise, over `shadow.radius` texels (`STUDIO.shadowSoft` 26 at a 2048 map, scaled with the map size so the softness is the same in world space). PCFSoft is about one texel soft and read as a hard cut-out under the art's big window light.

**5.6 Fuzz shells and the silhouette fringe.** Each tier draws `shells` extra copies of every part (`TIERS` in `src/mascot.js`: high 4, medium 2, low 0), pushed along the normal by `shellT x shellHeight x napZoom` with `shellT = (i + 1) / count` and `shellHeight = 0.0085` units (about 3 px at 350 ppu). A shell pixel is visible only near the silhouette (`N.V < uShellEdge`) and only where the fine nap is tall enough: `shellThreshold(t)` turns a coverage target `0.95 x (1 - 0.62 t)^1.5` into a height threshold through the inverse normal CDF (mean 0.5, sd 0.24), so outer layers keep fewer, taller hairs. Alpha is `uShellAlpha x hair x edge^1.4 x (1 - crevice)`; colour is the surface's own shaded colour lightened toward the tip colour, plus `uShellGlow`. Shells are alpha-blended (`transparent`, `depthWrite: false`, `renderOrder 1 + i`), which gives the canvas the art's partially transparent fringe. (A comment above the material options still says "hard alpha test"; the code blends, and the metric `soft-edge pixels` depends on it.) Four failures were met and fixed, see traps 10.9 and 10.10: shells shaded differently from the base (pale band), first layers too dense (hard edge), shell glow on top of the base's rim (double contour), alpha-to-coverage (pale specks).

**5.7 Seams.** Two sources. Analytic seams in rest space: the head's centre seam (hand-sewn: it wanders by 0.007, its width varies around 0.0028 and its depth varies) and the body's back seam. Baked seams: `seam` (signed distance / `uSeamRange`, presence) and `seamDir` per vertex from `scripts/bake/seams.mjs`, for curves such as the hood's side seam, arm outlines and legs; `SEAM_RANGE = 0.16` in `src/mascot-fabric.js` must equal `SEAM_MAX` in `seams.mjs` (also stored in the mesh header). The profile is a narrow groove (sigma 0.0058) between puffy shoulders (at 0.028, sigma 0.02), and its slope is analytic: screen-space derivatives of a feature this thin alias and flip normals at grazing angles (trap 10.6). Inside the groove the albedo is multiplied by `uSeamTint` (0.56, 0.32, 0.32), a deep red rather than grey, because a neutral darkening of red felt goes brown; along the line the indirect light loses 35 percent and the sheen 90 percent.

**5.8 Hood-to-plate edge.** The plate outline is a super-ellipse, `FABRIC.face` `{cx, cy, a, b, nTop, nBot}` (exponent `nTop` above the centre line, `nBot` below). It must equal `P.face` in `scripts/bake/model.mjs`, which the sculpt uses for the same outline; `apply-fit.mjs` updates only the model, so copy the numbers after a refit. The rolled lip itself is geometry (a continuous wall and a refined mesh, `references/sculpt-fit.md` and `references/mesh-bake.md`); the shader adds what the art shows on top, all anti-aliased to the pixel footprint because the boundary is drawn by the shader and multisampling does not smooth it:
- Colour boundary: `1 - smoothstep(-soft, soft, sd)` with `soft = max(uFaceSoft, 0.75 fwidth(mascotFaceSDBase(p)))`, jittered by the body nap's height (`uFaceJitter`, 0.0015) so the fabrics interlock. The derivative is taken on the smooth outline without the jitter, so it stays smooth.
- Crevice: a Gaussian line whose darkest point sits `uEdgeLineAt` inside the boundary, narrower on the plate side (`uEdgeLineWP`) than on the hood side (`uEdgeLineWH`, times `uEdgeLineChinW` along the chin), fainter along the chin (`uEdgeLineChin`). Its width never drops below 0.9 of the pixel footprint and its strength is scaled by `lw0 / lw`, so a line thinner than a pixel softens and fades instead of crawling.
- Plate tucking under the lip: darkening by `uEdgePlateLR` at the sides and `uEdgePlateTB` at top and bottom over `uEdgePlateW`.
- Lip: brightening `uEdgeHem` peaking `uEdgeHemAt` outside the outline over `uEdgeHemW`, stronger where it faces up.
- Shading slope: the hood tilts toward the crevice (`uEdgeBump` over `uEdgeBumpW`) and the plate rim the other way (`uEdgeRim`), clamped to a slope of 1.4 (about 55 degrees) because steeper shading normals flash in the specular and sheen terms.
- The crevice takes light from every term (AO chunk multiplies by `1 - 0.94 crevice`) and removes the shells' alpha, so no fringe or rim glows inside it.
These parameters were fitted to the art's luminance profile across the seam on four sides (`seam` in `eval.mjs`, section 9).

**5.9 The face fabric's halo.** The art's plate is not evenly lit around the pieces set into it (darker above and beside the eye whites, brighter below them and around cheeks and mouth). `fit-face.py` measures that as a colour ratio map, `assets/mascot-face-halo.png`, sampled here after projecting the rest position into the art's view (`uHaloView`, the `ARTWORK_VIEW` distance and target height); it tints, adds light, and removes light as crevice. It fades around the eyes while they sleep (`uHaloEyes`) and around the mouth when the mouth leaves its resting shape (`uHaloMouth`). The zone split uses example-specific numbers in the shader (`step(1.93, pa.y)`, `abs(pa.x - 0.02)`, `abs(pa.x - 0.0185) <= 0.22`, `pa.y <= 2.0`); change them with the face. Encoding and measurement: `references/face-kit.md`.

**5.10 Body-only shadow toe.** `mascotShadowShape` subtracts a small Khronos-style toe (`uToe`) from the body fabric only: deep red felt keeps its colour in shadow in the art, while the neutral charcoal plate must not turn red-brown (section 7).

**5.11 Arm nap compensation.** Poses can lengthen an arm (`arm{L,R}.s`, `references/rig-and-animation.md`). The nap was laid out on the arm as sculpted, so on a stretched arm the fibres would comb out along it. Arm materials (`MASCOT_ARM`) receive the arm's rest axis `uArmAxis` and `uArmSpan = (shoulder, wrist, stretch)`; the vertex shader advances the nap coordinate along the axis between shoulder and wrist by the stretch (`vRest += axis * s * (clamp(dot(p, axis), from, to) - from)`), and the hand beyond the wrist only shifts. `aimArms` in `src/mascot-rig.js` writes `uArmSpan.z = grow - 1` every frame.

**5.12 Nap scale versus display density.** When the figure is drawn smaller than the art, a fibre falls below a pixel and averages into a smooth, plastic surface. `_updateNapZoom` grows the nap a little: `uNapZoom = clamp(1 + 0.2 x (350 / ppu - 1), 1, 1.9)`, which is 1.0 at 350, 1.08 at 246, 1.37 at 123; shells grow with it. Measured against the art rescaled to each density, this gentle growth matched best; growing the nap to one texel per pixel read as shag. The same function widens the face's contact lines (`setPixelSize`, `references/face-kit.md`).

## 6. Parameter table

Example values are the example mascot's source defaults in `src/mascot-fabric.js` (after tuning); yours come from your tuner run. "Group" is the `tune2.mjs --only` group that fits it; "hand" means set by measurement or by eye and not tuned.

| Uniform (option) | Meaning | Fitted by | Example |
|---|---|---|---|
| `uNormalStrength` (`normalStrength`) | nap relief | tex | 0.273 |
| `uFibAlbedo` (`fibAlbedo`) | filament luminance modulation | tex | 0.150 |
| `uTipAmount` (`tipAmount`) | bright crest colour | tex | 0.201 |
| `uCrestPow` (`crestPow`) | sparsity of bright crests | tex | 1.858 |
| `uCavity` (`cavity`) | darkening of gaps | tex | 0.239 |
| `uFibGain`, `uFibCenter` | height to signed filament | tex (gain) | 3.562, 0.5 |
| `uFeltBias` | mip bias of body fetches | tex | -0.286 |
| `uFaceBias` | mip bias of plate fetches | hand (mip test) | -0.3 |
| `uFaceDetail`, `uFaceTip`, `uFaceRelief` | plate contrast, tips, relief | tex | 2.784, 0.100, 5.498 |
| `uUpFibre` | extra amplitude facing up | tex | 1.758 |
| `uFaceVignette` | plate darkening toward the chin | tex | 0.364 |
| `uMottle`, `uMacro` | soft value-noise mottling | hand | 0.05, 0.03 |
| `uWrap` (`wrap`) | diffuse wrap | light | 0.180 |
| `uTerminator` (`terminator`) | warm terminator tint | hand | `#ff8c88` |
| `uRimAmount`, `uRimPower`, `uRimUp`, `uRimSide` | broad grazing rim | light | 0.993, 2.301, 0.440, 0.037 |
| `uRimColor` (`rimColor`) | rim tint | hand | `#ff9c84` |
| `uAOPower`, `uAODirect`, `uAOFloor` | baked AO shaping | light | 3.500, 0.939, 0.120 |
| `uToe` (`toe`) | body shadow toe | light | 0.873 |
| `sheen`, `sheenRoughness` | three.js sheen | light (`sheen`, `sr`) | 1.000, 0.704 |
| `uBaseGain` (`FABRIC.body.gain`) | unclamped linear albedo gain | light (`gr gg gb`) | 0.985, 0.917, 1.264 |
| `uFaceGain` (`FABRIC.charcoal.gain`) | plate albedo gain | light (`fk`) then hand | 1.06, 1.231, 1.29 |
| `uRimTightAmount`, `uRimTightPower` | tight silhouette fringe | edge | 1.106, 9.224 |
| `uShellAlpha`, `uShellGlow`, `uShellEdge` | fuzz opacity, glow, reach in N.V | edge | 0.750, 1.500, 0.512 |
| `uEdgeLine`, `uEdgeDark` | crevice strength, darkness | seam | 0.319, 1.948 |
| `uEdgeLineWP`, `uEdgeLineWH`, `uEdgeLineAt` | crevice widths, offset (units) | seam | 0.002, 0.00708, 0.002 |
| `uEdgeLineChin`, `uEdgeLineChinW` | chin-side strength, width | seam | 0.874, 0.356 |
| `uEdgePlateLR`, `uEdgePlateTB`, `uEdgePlateW` | plate tuck darkening | seam | 0.7, 0.7, 0.054 |
| `uEdgeHem`, `uEdgeHemAt`, `uEdgeHemW` | lip brightening | seam | 0.248, 0.0618, 0.0384 |
| `uEdgeBump`, `uEdgeBumpW`, `uEdgeRim` | edge shading slopes | seam | 0.0228, 0.015, 0.0039 |
| `uFaceJitter`, `uFaceSoft`, `uFaceEdge` | boundary jitter, softness, shift | hand | 0.0015, 0.005, 0 |
| `uSeamDepth`, `uSeamTint` | seam groove depth, tint | hand | 0.0085, (0.56, 0.32, 0.32) |
| `uHaloAmt` | strength of the measured halo | hand | 1 |
| `uNapZoom` | nap growth at low density | runtime | 1 to 1.9 |
| `uShell`, `uShellT`, `uShellCut` | shell offset, layer, threshold | runtime | per layer |
| `uArmAxis`, `uArmSpan` | arm stretch frame | runtime | per arm |
| colours (`FABRIC.body`, `FABRIC.charcoal`) | base, tip, sheen hex | hand, then gains | `#f36b62 #f2867c #ffa088`; `#2c2527 #4f4b54 #6d6874` |

The tuner's own `SPACE` table in `tune2.mjs` also holds starting values, older than the source defaults; that is why every run starts with `--live`. (`FABRIC.charcoal` is the face fabric's colour set; the name may be tidied in the final template.)

## 7. Studio light and tone curve

`src/mascot-studio.js`: a PMREM softbox environment (warm key window upper left, cool fill right, warm rim back right, top fill, warm floor bounce), a shadow-casting directional key, a shadowless fill, a floor bounce and a hemisphere light. `STUDIO` holds the fitted values (example: `env 0.19, key 1.1 at azimuth 40 / elevation 40.6, fill 0.292 at 48.2 / -12.9, bounce 0.258 at 60, hemi 0.1, shadowSoft 26, shadowInt 0.8, exposure 1.543`); `placeLight` puts azimuth 0 toward the camera and positive to the viewer's right. The tuner moved the directional key to the viewer's right although the environment's key softbox sits upper left: a painted picture's light is not physically consistent, and the fit follows the picture, so treat these as measured numbers.

Tone curve (`installToneMapping`): exposure, then a hue-preserving toe (`color *= luma^(TOE - 1)`, `TOE = 1.05`), linear up to a peak channel of 0.78, then a soft shoulder that rolls the peak toward white and desaturates as it compresses. Why not three's Neutral tone mapping: its shadow toe subtracts from each channel (`x - 6.25 x^2`), which turned the warm near-black charcoal plate into a saturated red-brown. The body's own red shadows get their saturation back from `uToe` (5.10).

## 8. The tuner

```bash
python3 scripts/dev/scaled-ref.py                                   # refs must exist and match sizeFor()
node scripts/dev/tune2.mjs --ppus 350,246,123 --live --only tex --out tuned.json
python3 scripts/dev/apply-tuned.py tuned.json
node scripts/dev/eval.mjs --ppus 350,246,123                        # confirm, then the next group
```

Options: `--only tex|light|seam|edge|cord|all` (comma-separated to combine), `--sweeps N` (default 4), `--ppus`, `--out` (default `tuned2.json`), `--live` (start from the page's current values), `--set '{"keyAz":-40}'` (start from another basin), `--freeze exp,key` (hold named parameters), `--resume` (continue from `--out`). It is coordinate descent: for each parameter, step up or down while the loss improves, then shrink all steps by 0.6 per sweep; it writes the JSON after every sweep and prints the loss components and per-density fibre ratios.

| Group | Parameters |
|---|---|
| `tex` | `uNormalStrength uFibAlbedo uTipAmount uCavity uCrestPow uFeltBias uFibGain uFaceDetail uFaceTip uUpFibre uFaceRelief uFaceVignette` |
| `light` | `env exp gr gg gb fk key keyAz keyEl fill fillAz fillEl shadowSoft shadowInt bounce bounceAz hemi uWrap uRimAmount uRimPower uRimUp uRimSide uAOPower uAODirect uAOFloor uToe sheen sr` |
| `edge` | `uRimTightAmount uRimTightPower uShellAlpha uShellGlow uShellEdge` |
| `seam` | every `uEdge*` uniform in the table above |
| `cord` | `cordAmp cordBump cordBright` (chest cord, `references/face-kit.md`) |

Rules, each learned the hard way:
- Start from `--live`. The SPACE starting values are stale, and the tuner sits in local optima; a run from old values finds a worse basin. If a result looks wrong while the loss improved, restart with `--set` elsewhere and compare crops.
- One group at a time, applying each result before the next (`--live` reads the source defaults). Suggested order: `tex`, `light`, `seam`, `edge`, `cord`, then `tex` once more.
- Never edit anything under `src/` while a tuner runs: Vite reloads the lab page and the run dies with "Execution context was destroyed". Edit docs or work in another copy meanwhile.
- A parameter pinned at its bound is the tuner asking for a missing effect; look at the crop before widening the bound.
- The loss (`src/lab-metrics.js`, `res.loss`) mixes tone, spread, lighting cells, plate cells, seam profile, face shape, rim, soft edge, fibre energy, face tone and fibre, hue (weighted 6 for the body, 3 for the face), cord, skew, kurtosis and evenness. A statistic can be gamed; the crops decide.

`apply-tuned.py` writes `STUDIO` into `src/mascot-studio.js`, the material defaults, `FABRIC` gains, uniform defaults, nap gain and bias into `src/mascot-fabric.js`, and cord values into the face. Two defects were found in the original version of this script (both are fixed in the template: all files are now written at the end, cord values that cannot be placed are skipped with a message, and the plate gain keeps its per-channel ratios; the fixes were not re-run end to end, so check the files after applying): (1) because the tuner's output always contains every parameter, including `cordAmp`, the script stops with `pattern not found: function threadMaps\(amp = ...` (exit 1) after it has already rewritten the studio and fabric files; the cord default lives in `src/face/textures.js`. Until it is fixed, delete `cordAmp`, `cordBump`, `cordBright` from the JSON unless you tuned the cord, and set those by hand (`threadMaps(amp = ...)` in `src/face/textures.js`, `bumpScale` and `color.setScalar` of the thread material in `src/mascot-face.js`). (2) It writes `fk` into all three channels of `FABRIC.charcoal.gain`, flattening a hand-set per-channel plate gain (example `[1.06, 1.231, 1.29]` becomes `[1.06, 1.06, 1.06]`); restore it and re-check the plate hue afterwards.

## 9. The evaluation

`eval.mjs` opens `lab.html`, which runs the real controller; `window.lab.evaluate(ppu)` frames a near-orthographic front view (fov 6 degrees, target height 1.65, canvas `sizeFor(ppu) = max(600, round(ppu x 4.2 / 2) x 2)` px, pixel ratio 1, idle at time 0, no floor shadows, transparent) and compares it with `scripts/dev/.refs/ref_<ppu>.png`, the art Lanczos-rescaled to the same density and placed where that camera puts the model.

```bash
python3 scripts/dev/scaled-ref.py            # defaults: --ppus 350,246,123, size from sizeFor(), out scripts/dev/.refs
node scripts/dev/eval.mjs --ppus 350,246,123 # add --json for machine output
```

Do not pass `--size` to `scaled-ref.py` for the evaluation: a reference of another size is drawn at the canvas corner and every window compares different places.

| Metric (eval line) | How measured | Pass (suggested) | Example mascot (350 / 246 / 123) | If it fails |
|---|---|---|---|---|
| Luminance percentiles 2..99 | shared body pixels, display values | each within 3 levels | within 1 to 3 at 350 | `light` group; check exposure and gains |
| Fibre band energy (finest band) | std of L minus blur (sigma 1.2 px, scaled) per patch | 0.9 to 1.3 at 350 and 246 | belly .92, chest 1.21, leg 1.14, arm 1.15, ear .98, crown 1.06 | pre-emphasis, then `tex`; at 123 the chest is 1.42 (known residual) |
| Skew, kurtosis, evenness per patch | band-pass moments; ridge vs edge energy | evenErr under 0.2 | skewErr .04, evenErr .16 | raise `uCrestPow`, lower `uNormalStrength` |
| `seam` (350 only) | mean luminance by distance from the plate edge, 24 bins of 0.004, four sides | mean diff 6 levels or less | 5.3 | `seam` group; check `FABRIC.face` against the art's crevice |
| Edge ring luminance left, right, top | thin band just inside the outline (2 to 9 px at 350 ppu, scaled) | within 5 levels | 140/143, 146/146, 146/150 | `edge` group |
| Soft-edge pixels | partially transparent outline pixels, live/art | guidance: 0.7 to 1.5 | 1.16 / 1.36 / 1.30 | above: fringe reads as a halo; below: cut-out |
| Cord wrap contrast | std along the chest cord | at 350: live/art 0.75 or more | 10.4/13.1; 1.7/8.8; 1.6/3.6 (faded on purpose below 300) | `cord` group |
| Plate fibre contrast | `fit-nap-spectrum.py` std ratio | 0.85 to 1.15 | .87 / .93 / 1.05 | `uFaceDetail` |

Verified on the template copy (Apple M5 Pro, Chrome, Metal): these commands reproduced the example values above. The bottom edge ring reads 123 against 100 at 350 because the feet's undersides are lighter than the art's, a documented residual; report it, do not gate on it.

`turn-check.mjs` catches what a front view cannot: it loads the real page at dpr 1 and 2, turns the idle figure (root yaw) to each yaw (default `-0.5,0.5,0.9`), finds the plate's outline to a tenth of a pixel on 360 rays (walking in from the hood until its redness ends), and reports the deviation from a smooth 36-harmonic fit of itself plus bright specks on the plate. Only 2x views with yaw magnitude 0.6 or less are scored: FAIL if p95 exceeds `--max-rough` (0.8 px) or specks exceed 12; exit code 1 on any failure. Example: mean 0.07 px, p95 0.16 px, 0 and 7 specks at yaw -0.5 and 0.5; the old stepped mesh gave 1.40 and 1.82 px p95. Treat anything above about 0.3 px p95 as a regression worth a look even though the script passes it.

```bash
node scripts/dev/turn-check.mjs --yaws -0.5,0.5,0.9,1.3
```

Crops decide. Render a density with `node scripts/dev/audit.mjs --ppu 246 --out /tmp/live246.png [--yaw 0.5] [--state idle]`, compare the same window of `scripts/dev/.refs/ref_246.png` at 5 to 8x nearest-neighbour (`crop_compare.py`, `references/tools-catalog.md`), for every edge: silhouette, hood to plate, eyes, mouth, cord. Check yaws 0, plus or minus 0.5, 0.9 and 1.5, pitch and roll, at 1x and 2x density. The lab also takes `?dbg=1..7` to output one light term (direct diffuse, direct specular, indirect diffuse, indirect specular, sheen direct, sheen indirect, emission): the fastest way to find which term makes a speck.

## 10. Shader traps

Each: symptom, cause, fix, how to verify.

**10.1 Grains exactly on a boundary.** Symptom: speckled or wrong-mip pixels along the plate edge or a lid edge, only on some GPUs. Cause: a texture fetch with implicit level of detail inside a branch that some pixels of a 2x2 quad skip, or after a `discard`, has undefined derivatives. Fix: fetch first for every pixel, branch or discard later (the face nap is fetched for the whole head and blended; the lid's `discard` sits after the nap fetch). Verify: A/B the render with the branch removed; the difference must be zero away from the edge and the grains gone.

**10.2 A patch silently does nothing.** Symptom: an edit to the shader has no effect, no error. Cause: `onBeforeCompile` receives `#include <chunk>` lines unresolved, so `.replace('text inside the chunk', ...)` on `shader.fragmentShader` matches nothing (the chest cord's moire fade was dead for this reason). Fix: replace the include line with the chunk's own text, modified: `.replace('#include <normal_fragment_maps>', THREE.ShaderChunk.normal_fragment_maps.replace(a, b))`. Also count every replace: a three.js upgrade or a typo makes the anchor vanish (the plate mask assignment once never landed this way). Verify: once, log whether `shader.fragmentShader` contains the text you inserted (`String.prototype.includes`), or output the term with `?dbg`.

**10.3 A define is ignored.** Symptom: two variants (shell and base, head and body) render identically, or the last compiled wins. Cause: three.js caches programs by source and key; materials whose `onBeforeCompile` differs only in defines share a program. Fix: `customProgramCacheKey` returns every define and variant (`mascot-fabric-<shell|base>-<part>` plus `-face`, `-arm` and `-dbg<N>` suffixes; the eye materials have `mascot-eye-<name>` because their wrappers are identical text). Verify: `renderer.info.programs.length` grows by one per variant.

**10.4 White specks at grazing angles.** Cause: wrapped N.L used in specular or sheen (5.3). Fix: wrap diffuse only. Verify: count pixels above luminance 245 on the head at a turned view before and after (example 1,227 to 6); `?dbg=2` shows the direct specular term.

**10.5 A normal tilted past about 55 degrees flashes.** Cause: an edge or seam shading slope too steep for the specular and sheen lobes. Fix: clamp slopes (the edge uses plus or minus 1.4). Verify: turn-check specks, `?dbg=5`.

**10.6 Specks along seams.** Cause: bump from screen-space derivatives (`dFdx`) of a groove a few pixels wide; at grazing angles the derivatives alias and flip the normal. Fix: analytic slope of the known profile times the tangent-plane direction across the seam (`mascotSeamSlope`). Verify: zero-depth A/B; speck count at yaw 0.9.

**10.7 Moire on tiny repeated detail.** Symptom: the chest cord's wraps shimmer as a checkerboard on a 1x display. Cause: about 2.7 px between wraps at 350 ppu, under a pixel at 123; sampling and bump differencing alias. Fix: fade the detail by its own screen-space frequency (wraps per pixel from `dFdx`/`dFdy` of the uv along the cord; the fade runs from 0.40 to 0.50 wraps per pixel, a period of 2.5 to 2 px) into its mean colour (`textureLod(map, uv, 10.0) x 0.93`) and scale the bump by the same fade. Verify: cord contrast in `eval.mjs` drops to about 1.7 below 300 ppu while it stays near the art at 350; a stepped 60 fps filmstrip of a slow turn shows no crawl.

**10.8 Plastic surface when small, shag when zoomed.** Cause: nap fixed at the art's scale while the figure is drawn at a third of it. Fix: the gentle `uNapZoom` rule (5.12); re-fit the pre-emphasis if you change it. Verify: fibre energy ratios at 123 ppu.

**10.9 Pale band or double contour at the silhouette.** Cause: shells lit differently from the base (smooth normal, no nap), too dense first layers, or shell glow stacked on the base's rim. Fix: shells reuse the base's shading, coverage from `shellThreshold` (sparse, shrinking), glow only through `uShellGlow`. Verify: render shells 0 / 2 / 4 side by side at 5x on the crown.

**10.10 Pale specks around the figure on the page.** Cause: alpha-to-coverage writes partial alpha into a transparent canvas, which then composites with the page colour. Fix: `alphaToCoverage: false`; shells blend. Verify: render over a dark and a light page background; no specks outside the fringe.

**10.11 Wrong texture data.** Symptoms: fibres lit from the wrong side, hazy tiles, colour shift. Causes and fixes: nap tiles are data, so `colorSpace = NoColorSpace` and `flipY = false` (row 0 is v = 0, as `build.py` wrote the normals); colour textures (sclera, iris, cord map) are `SRGBColorSpace`; bump maps are not. RGBA tiles get premultiplied on decode: keep tiles RGB8. The measured ramps (eye rim, sclera shade, lid shadow) multiply the light after `tonemapping_fragment` (linear display values, measured the same way on the art); the metrics compare display (sRGB) values except hue, which compares linear RGB. Verify: `?dbg=1` with a directional light only; a bump in the tile must light on the side facing the light.

**10.12 Black or dark hand-built pieces.** Cause: WebGL feeds 0 to a missing vertex attribute, so `ao` is 0 on lids, cheeks and cords without it. Fix: `neutralAttributes(geometry)` (ao 1, curv 0); missing `seam` means no seam, which is correct. Verify: `?dbg=3` on the face pieces.

**10.13 Mip bias.** Too positive: blotchy, cloudy fabric. Too negative: shimmer and crawling when the figure moves. Example: `uFeltBias -0.286`, `uFaceBias -0.3`, with anisotropy 8 on the tiles. After changing either, re-fit the pre-emphasis (4) and judge a stepped filmstrip of a slow turn for shimmer (the temporal shimmer comparison made in the source project was not recorded; unverified numbers).

**10.14 Stale tile, stale page, dead tuner.** A tile rebuilt in `assets/` is not served until `node scripts/sync-public.mjs`; an edit to `src/` during a tuner run reloads the lab page and kills the run. Verify: compare the served file's size or hash with `assets/`.

Related: a cliff in the signed-distance field shows as teeth along the colour boundary when the head turns; that is geometry, see `references/sculpt-fit.md` and `references/mesh-bake.md`.

## 11. Performance

Example mascot on an Apple M5 Pro, Chrome, 2x display (`tests/VALIDATION.md`; measure GPU time with a one-pixel `gl.readPixels` after `render`, because `gl.finish` does not block in Chrome): a frame costs about 10 ms at 1440 x 900 and 17 ms at 2400 x 1500 with four fuzz layers, 6 and 10 ms with two, 2.5 and 4.5 ms with none. The shells are about three quarters of the cost, because each shell redraws the whole part with the full fabric shader and most of its pixels end with zero alpha. About 0.9 million triangles a frame including four shell layers and the shadow pass. The governor's first steps therefore drop every other shell, then the pixel ratio (`references/runtime-and-performance.md`). Do not trust frame-rate numbers measured while other agents render or on a battery below 20 percent (Chrome's Energy Saver holds pages to 30 fps).

## 12. Recipe for a new character's fabric

1. Art: a registered neutral front at the canonical frame with sharp, evenly lit flat fabric; optionally a macro fabric sheet. `art_qa.py --kind transparent` flat-region fraction and fibre band energy must pass (`references/art-analysis.md`).
2. Colour rules: adapt `body_pool` and `face_pool` in `scripts/nap/build.py` (and `bodyAt` in `src/lab-metrics.js`, the window tests in `scripts/dev/fit-nap-spectrum.py`) to your fabrics; replace the exclusion circle with your chest mark's position in art pixels, or remove it. Acceptance: `--preview` pool coverage shows no seam, feature or mark; at least about 50,000 clean pixels per fabric (the example face had 58,198).
3. `python3 scripts/nap/build.py --fresh --preview /tmp/nap`. Acceptance: wrap-seam ratios 0.85 to 1.15; the rolled previews show no seam, streak or copied chunk at 4x.
4. Patches and cells: redefine `BODY_PATCHES`, `TONE_CELLS`, `PLATE_CELLS`, `FACE_PATCHES`, the plate centre in `edgeProfiles` and the cord position in `src/lab-metrics.js` (and `BODY_PATCHES` in `fit-nap-spectrum.py`) for your figure, each wholly on one fabric in the art.
5. Plate outline: copy `P.face` from your fitted `scripts/bake/model.mjs` into `FABRIC.face`; update the example-specific shader constants listed in 5.9 and `smoothstep(2.28, 1.72, vRest.y)` (plate vignette heights), `smoothstep(0.12, 0.28, z)` (front of the head), the back-seam height band in `mascotSeams`.
6. Dev server, `scaled-ref.py`, `eval.mjs`: record the untuned baseline.
7. `fit-nap-spectrum.py --tile face` then `--tile body`. Acceptance: per-band ratios 0.7 to 1.25 at 246, std ratio 0.85 to 1.15.
8. Tune: `tex`, `light`, `seam`, `edge` (and `cord` if you keep a cord), each from `--live`, applied with `apply-tuned.py` (mind section 8's two defects), then `tex` again. Acceptance: the eval table in section 9.
9. `turn-check.mjs`: PASS at 2x, p95 near 0.2 px, few specks.
10. Crops at 5 to 8x, several yaws, 1x and 2x: fibres read as the art's filaments; no halo, band, blotch or speck. Write the residual differences into `tests/VALIDATION.md`.

## 13. Other fabrics

The pipeline holds for any short pile whose look is mostly colour texture: the art supplies the fibres, the shader supplies light. What changes (starting points, unverified: only felt was built and measured):

| Fabric | What the art shows | Change |
|---|---|---|
| Felt, micro-suede (example) | curled 1 px filaments, colour-dominant | as documented |
| Velvet, velour | smooth, strong grazing-angle brightening, little filament structure | lower `uFibAlbedo` and `uTipAmount`; raise `sheen` and the broad rim; fewer, shorter shells; pre-emphasis matters less |
| Minky, short fleece | soft blobs, visible pile direction | allow some coherence (lower the 0.7 coherence weight), larger `uNormalStrength`, taller shells (`shellHeight`) with more coverage |
| Knit | a periodic stitch lattice | quilting breaks the lattice; use a hand-tiled period-aligned crop or a procedural stitch, keep the art only for colour statistics; check moire (trap 10.7) because a lattice aliases like the cord |
| Long fur, hair | strands longer than the shell reach | out of scope for this shader: it needs strand or card geometry |

For every fabric, the gates stay the same: fibre band energy per patch against the density-matched art, the seam and silhouette profiles, and crops at several yaws and densities.
