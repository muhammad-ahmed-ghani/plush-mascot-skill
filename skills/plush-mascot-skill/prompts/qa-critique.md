# Art critique prompt (hostile art director)

Documentation file, not rendered by `render_prompts.py`. Use it to have a vision-capable model (or a fresh agent who can view images) judge candidate art before it enters the pipeline. A fresh reviewer who has not seen the prompt history is better than the agent that generated the image: authors forgive what they intended.

Attach: the candidate, the identity master (for any non-hero), and the brief. Ask for the JSON below and nothing else. Then run `python3 scripts/tools/art_qa.py` for the measurable checks; the critique is for what a script cannot see.

## Prompt to give the reviewer

> You are a hostile art director reviewing reference art for a real-time 3D plush mascot. The 3D model will be fitted to this image and judged against it pixel by pixel, so every defect here becomes a defect in the product. Be specific and unforgiving; do not praise. You are given: the candidate image (image 1), the identity master (image 2, if any) and the brief (below).
>
> Score each criterion 0 (fail), 1 (weak), 2 (pass) and give evidence: where in the image (x and y as fractions of width and height) and what you see.
>
> 1. identity: same character as the identity master (proportions, colours, face, silhouette feature, chest mark); list every difference.
> 2. silhouette: clean, readable at 64 px tall, limbs separable, arm gap, feet visible, no merged shapes, no cropped parts.
> 3. construction: could a pattern maker sew this? Seams plausible, fabrics join sensibly, no impossible geometry.
> 4. fabric realism: thin crisp individual fibres at 100 percent, uneven density, matte, no plastic, vinyl, rubber or airbrushed look, no blur; say the estimated fibre width in pixels.
> 5. light: soft, physically plausible, neutral colour, no baked rim glow or strong cast shadow that would contaminate the texture.
> 6. face: eyes the right size and identical, symmetrical, satin pillow reads as fabric, pupils and catchlights plausible, mouth and cheeks as briefed, no forbidden feature (nose, teeth...).
> 7. edges: alpha or key-colour edges clean, no halo, no fringe, no fake checkerboard, no floor shadow.
> 8. colour: matches the brief's hex values within a small shift; list measured or estimated colours.
> 9. artefacts: text, logos, extra limbs, duplicated parts, melted details, repeated patterns, upscaler noise, JPEG blocks.
> 10. originality: does it resemble an existing mascot, toy or brand character? Name the closest resemblance if any.
>
> Return only this JSON:
> `{"scores": {"identity": 0, "silhouette": 0, "construction": 0, "fabric": 0, "light": 0, "face": 0, "edges": 0, "colour": 0, "artefacts": 0, "originality": 0}, "defects": [{"criterion": "", "where": [x, y], "what": "", "severity": "blocker|major|minor", "fix": "an edit prompt from prompts/edits.md or a regeneration note"}], "verdict": "accept|edit|regenerate", "summary": ""}`
>
> Brief: <paste the brief JSON>

## Reading the verdict

- Any blocker, or any score of 0 in identity, silhouette, fabric or edges: do not enter the pipeline; edit or regenerate.
- A total of 17 or more out of 20 with no 0 and no blocker: accept.
- Anything between: fix the highest-severity defect with one edit prompt, then review again with a fresh reviewer.
- Always follow with the automated gates; when the two disagree, believe the stricter one.
