# Edit prompts: fixing one flaw without losing the character

Documentation file, not rendered by `render_prompts.py`. Copy a block, fill the `<...>` parts and send it with the image to fix attached as image 1 (and the identity master as image 2 when the flaw is identity drift).

## The edit protocol

1. **One change per call.** Models apply "change X" well and "change X, Y and Z" badly; each extra change risks drift in the rest. If two things are wrong, fix the one that affects the pipeline most first (silhouette, then pose, then background, then material, then details).
2. **Restate the locks every time.** Calls have no memory. Every edit prompt ends with the preserve list: identity, pose, framing, colours, fabric, lighting. Copy it from `_partials/identity-lock.md` rendered with the brief.
3. **Say what to keep, not only what to change.** "Change only the background. Keep the character, its pose, the framing, the lighting, the fabric texture and the colours exactly the same."
4. **Edit from the original, not from the last edit, when you can.** Every pass through the model can soften fibres and shift colours; chains of four or more edits visibly degrade texture. After two passes, compare against the original at 100 percent crops of the fabric; if the nap has softened, go back and re-generate with a corrected prompt instead.
5. **Use masks for local fixes** (OpenAI edit endpoint `mask` = alpha where the change is allowed): eyes, hands, a stray shadow. Keep the mask generous; a tight mask leaves seams.
6. **Keep every intermediate** in `art/candidates/` with its metadata JSON (`imagegen.py` writes it). Record the winning chain in `GENERATION-PROMPTS.md`.
7. **Verify after every edit**: `python3 scripts/tools/art_qa.py <file> --kind <kind>` and a side-by-side crop at 100 percent against the previous version (`crop_compare.py`).

## Ready prompts

Each block starts with the situation, then the prompt.

### Remove the floor shadow or cast shadow (cut-outs)
> Change only the ground: remove every cast shadow, contact shadow and floor reflection so that nothing except the character remains on the background. Keep the character, its pose, its framing, its lighting, its colours and its fabric texture exactly the same.

### Flat key-colour background for extraction (model has no alpha)
> Change only the background: replace it with a perfectly flat, uniform, pure <chroma magenta #FF00FF> field, edge to edge, no gradient, no vignette, no floor and no shadow. Nothing on the character may be <magenta> and there must be no <magenta> spill on its edges. Keep the character, its pose, its framing, its lighting, its colours and its fabric texture exactly the same.

### Turn a three-quarter view into the strict neutral front
> Change only the pose and camera: show the character strictly from the front, orthographic-like, perfectly symmetrical, head level, eyes looking at the camera, arms held slightly away from the torso with a clear gap to the body, both feet flat and fully visible. Keep the same character identity, proportions, colours, fabric and lighting.

### Open a gap between the arms and the body
> Change only the arm pose: move both arms outward by about fifteen degrees so that a clear strip of background shows between each arm and the torso along its whole length. Keep the character, the face, the framing, the lighting, the colours and the fabric exactly the same.

### Fibres too smooth or plastic
> Change only the fabric finish: make the plush look like real needle-felted micro-suede with thin, crisp, individual curled fibres (about one pixel wide at full resolution), uneven density, a few pale flyaway fibres catching the rim light, and a completely matte surface with no sheen. Keep the shape, pose, framing, colours and lighting exactly the same.

### Gloss or specular highlights
> Change only the highlights: remove every glossy or specular highlight and any wet or plastic look; light should only lighten the tips of the fibres softly. Keep everything else exactly the same.

### Fibres too long or hairy
> Change only the pile length: shorten the fibres to a dense, short, velvety micro-suede pile that follows the forms; the silhouette must be clean with only a few tiny flyaway fibres. Keep the shape, pose, framing, colours and lighting exactly the same.

### Eyes different sizes, off-centre or drifting from the identity master
> Change only the eyes: make both eyes identical in size and shape, symmetrically placed, matching image 2 (the identity master) exactly in size, spacing, colour and pupil size. Keep the rest of the face, the head, the body, the pose, the framing, the lighting and the fabric exactly the same.

### Face plate edge looks printed instead of sewn
> Change only the edge where the face fabric meets the padded head: make it a hand-sewn join with a rolled lip of the padded fabric casting a soft shadow, a thin dark crevice and the face fabric tucking underneath; fibres of both fabrics should interleave at the boundary. Keep everything else exactly the same.

### Hallucinated text, logo or pattern
> Change only <the chest / the prop / the background>: remove all text, letters, logos and symbols and leave plain <fabric / surface>. Keep everything else exactly the same.

### Colour drift from the brief
> Change only the colours: the body fabric must be <coral red #F05C63>, the face fabric <deep warm charcoal #24252B>, the eyes <warm cream #FFF1DD>. Keep the shape, pose, framing, lighting and fabric texture exactly the same.

### A feature that must not exist (nose, teeth, tail, clothing)
> Change only <the nose>: remove it completely and leave the smooth face fabric that would be there without it. Keep everything else exactly the same.

### Too much baked-in directional light or rim glow (hurts nap extraction)
> Change only the lighting: make it soft, even and nearly shadowless from the front with only gentle self-occlusion in creases; no rim glow, no coloured light, no strong shadows. Keep the character, pose, framing and colours exactly the same.

### Figure cropped or too close to the edge
> Change only the framing: pull the camera back so that the whole figure, from the top of the head to the soles, sits inside the frame with about 8 percent empty margin on every side. Keep the character, pose, lighting, colours and fabric exactly the same.

### Turnaround: views touch or differ in scale
> Change only the layout: separate the three views with clear empty space so that they do not touch each other or the image edges, and draw all three at exactly the same scale on one common baseline. Keep each view, the character, the colours and the lighting exactly the same.

### Turnaround: profile is not a true profile
> Change only the middle view: make it a true 90 degree left profile, with the far eye and far arm hidden the way they would be on a real plush, both feet on the baseline, head level. Keep the other two views, the character and the lighting exactly the same.

### Local detail pass (masked)
Attach the region to redo as a mask.
> Redraw only the masked area at higher detail: <crisp individual fibres and a clean rolled seam>. Match the surrounding colours, lighting and fibre scale exactly; do not change anything outside the mask.

## When to stop editing and regenerate

- The third edit in a chain and the fibres look softer than the original.
- The colours have drifted more than a hex or two from the brief.
- The character's proportions no longer match the identity master.
- A fix in one place reintroduces the flaw you removed elsewhere.

Regenerate from the hero with a corrected prompt (add the missing instruction to the base prompt, not another edit), keep the better of the two, and note the lesson in `GENERATION-PROMPTS.md`.
