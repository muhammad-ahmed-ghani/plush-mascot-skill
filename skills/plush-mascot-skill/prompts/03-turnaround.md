---
title: Turnaround sheet (front, profile, back)
asset: turnaround
size_hint: 3:2 (openai safe 2304x1536, max 3504x2336; gemini 4K 3:2)
required: [name, form, silhouette, body_color, face_color, eye_color, material, face, hands_feet, forbidden, scene_bg]
---
# Turnaround sheet

## Purpose
Gives the pipeline the profile silhouette (head depth, plate apex) and shows how the back and sides are constructed (seams). AI sheets are not geometrically consistent with the front view, so the fit uses the profile only for depth; do not expect the three views to agree to the pixel. Consistency of construction matters more than resolution here.

## Settings
- References: hero (image 1, identity master) and the registered front (image 2, for proportions), if both exist. OpenAI edit endpoint, quality `high`. Gemini: both as character references.
- Generate 4 candidates at the safe size first; render the chosen one at the max size only if the views are well separated (touching figures will merge in `normalize_art.py --turnaround`).
- If the profile comes out weak, render it alone with `03b-profile-registered.md`, which gives a higher-resolution side view.

## Accept when
Exactly three separate figures, same scale, same baseline, not touching and not cropped; the side view is a true left profile with both feet on the ground; the back view shows the construction seams and no tail (unless the brief has one); the colours and proportions match the hero in all three; no labels.

## PROMPT
<!-- model:openai -->
Use case: stylized-concept. Asset type: character model sheet (turnaround) for a 3D build.
Image 1 is the identity master; image 2 (if provided) is the neutral front view for proportions. Preserve exactly.
<!-- endmodel -->
<!-- model:gemini -->
Using the attached images as the exact identity and proportion references, create a polished character model sheet of the same character, {{name}}.
<!-- endmodel -->
Create a beautifully polished character model sheet of {{name}}: three equally sized full-body, orthographic-like views in a single horizontal row on a seamless {{scene_bg.name}} ({{scene_bg.hex}}) background, landscape 3:2 composition. Left: front view, neutral, arms slightly away from the body. Centre: pure left profile with both feet on the ground, head level. Right: back view revealing the construction seams{{back_note| and the centred back seam}}. All three stand on one common baseline, at exactly the same scale, with clear spacing so the figures do not touch each other or the edges of the image.

{{> identity-lock}}

Keep the head, torso, limbs and face proportions physically coherent and identical across the three views. The side view must show the true depth of the head and the body, with the face area seen edge-on.

{{> fabric}}

Soft, even studio light with small contact shadows; {{> negatives}} No labels, no annotations, no colour swatches.
