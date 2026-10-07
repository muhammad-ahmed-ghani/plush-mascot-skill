# Design language: what makes plush read as real

Purpose: the visual language that separates convincing felt from plastic, as rules you can check in a render. The owner of the example rejected early results as "fake, plastic", then found grains, blotchy texture, a hard colour edge where the padded hood met the face fabric and a flat chest mark. Each rule names what the eye reads, why the fake fails and where the fix lives.

## 1. What the eye reads as felt
| Cue | Real | Fake | Fix |
|---|---|---|---|
| Fibres | thin curled filaments about 1 to 2 px wide at 350 px per unit, pale tips over a darker calm ground, uneven density | blobs, noise, stucco, combed streaks | nap extracted from the art (`references/felt-shader.md`) |
| Sheen | only at grazing angles, as a pale fringe | specular highlights, wet gloss | wrapped diffuse only, sheen and rim at grazing; no specular spikes |
| Silhouette | a soft 1 to 2 px fringe of partial alpha with flyaway fibres | a hard outline or a glow | fuzz shells (4 layers high tier) |
| Terminator | warm, light scatters through felt | grey, hard | warm terminator tint, wrapped light |
| Creases | deep colour in creases, baked occlusion of the large form | uniform brightness | baked AO, curvature |
| Colour | warmer lighter tips, deeper pile, slight mottling | flat colour | filament colour modulation, soft value noise |
| Seams | hand-sewn: a narrow groove with puffy shoulders that wanders | ruler-straight lines, stripes | baked seam field, wandering analytic centre seam |

## 2. Construction beats texture
A painted texture of a seam, an eye or a cord is flat at every angle. Construction reads at every angle: the hood rolling over the face fabric with a thin dark crevice and the plate tucking under it; eye whites as satin pillows with a thin dark contact line and lids of the face fabric; cheeks as appliqués with contact lines; the mouth as a raised round-capped cord with a contact shadow; the chest mark as wound cord lying in a trench. Build them (`references/face-kit.md`, `references/sculpt-fit.md`) rather than printing them.

## 3. Colour and light
Work in linear light; correct colours by ratios of means in linear light; use a hue-preserving tone curve (a per-channel toe turns a charcoal face red-brown). The studio is a soft key, fills, a floor bounce and a softbox environment fitted to the art's luminance; the fit follows the picture, even when the picture's light is not physically consistent. Highlights must be sheen, never specular. Never overwrite a brand colour token with a sampled shaded pixel.

## 4. Proportion and silhouette
Readable at 64 px: an oversized head, simple limb masses, one or two shapes that identify the character (the example: two diagonal tabs and splayed feet), negative space between arms and body, mitten hands without fingers, no thin parts. A deliberate omission (no nose) strengthens identity if it is stated in the brief and kept everywhere.

## 5. Anti-patterns
| Anti-pattern | Why it reads fake | Fix |
|---|---|---|
| Over-smooth nap, plastic | no filament scale | extract and pre-emphasise the nap; check fibre-band energy |
| Blotchy, cloudy fibres | fetch blur softened the finest filaments | pre-emphasis fit |
| Grain or teeth along the seam when turned | a step in the field; cracks in the mesh | continuous profile; watertight mesh |
| Hard straight colour edge hood to face | no roll, no crevice, no tuck | geometry plus shader edge profile |
| Shimmering cord or checkerboard when small | sub-pixel repeats alias | fade by screen frequency |
| Sticker eyes | no pillow, no lid, no contact line | build the eye (`references/face-kit.md`) |
| Neon fibres, bloom | highlights overdriven | tone curve, rim limits |
| Flat chest mark with a halo | emblem painted on | cord in a trench, no halo |

## 6. Judge honestly
Side-by-side crops of the same window at 5 to 8x, at several yaws, pitches and display densities, never metrics alone (`references/validation-gates.md`).
