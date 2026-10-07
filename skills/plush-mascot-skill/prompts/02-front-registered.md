---
title: Registered neutral front view (transparent)
asset: front
size_hint: 1:1 (openai safe 1920x1920, max 2880x2880; gemini 4K)
required: [name, form, silhouette, body_color, face_color, eye_color, material, face, hands_feet, forbidden, chroma]
---
# Registered neutral front view

## Purpose
The most important image for the 3D pipeline. The sculpt is fitted to its silhouette, the nap texture is lifted from its flat regions, the face features are measured from it and the live render is compared against it at 350, 246 and 123 px per unit. It must be neutral, symmetrical, evenly lit, cleanly cut out and sharp. Expect to generate several and to run `scripts/tools/art_qa.py --kind transparent` and `normalize_art.py` on the chosen one.

## Settings
- References: attach the hero as image 1 (identity master). OpenAI: use the edit endpoint (`imagegen.py edit --ref hero.png`), quality `high`, size 1920x1920 or 2880x2880. Gemini: attach the hero as a character reference, aspect 1:1, `image_size` 4K.
- Transparency: set `"chroma": false` in the brief and request `background=transparent` with PNG output if the model supports it (GPT Image 2 and 2.5 do; always verify the alpha on light and dark). If the endpoint rejects it, or for Gemini (no alpha), set `"chroma": true`, pick a key colour far from every colour of the design (green for a red body, magenta for a green body) and cut it out with `scripts/tools/alpha_extract.py`.
- Keep the returned original untouched in `art/masters/`; all cleanup happens on copies.

## Accept when
`art_qa.py --kind transparent` passes; the gap between arms and body is clear; both soles are visible; no floor shadow; edges are clean with tiny natural fibres and no halo on a light and a dark backdrop; the face is symmetrical and level; eyes look straight ahead; the nap is visible in flat regions (belly, cheeks of the hood, face fabric).

## PROMPT
<!-- model:openai -->
Use case: background-extraction and identity-preserve. Asset type: production transparent cut-out of the mascot for a real-time 3D pipeline.
Image 1 is the exact identity master: preserve {{name}} exactly.
<!-- endmodel -->
<!-- model:gemini -->
Using the attached image as the exact identity reference, produce a neutral front view of the same character, {{name}}.
<!-- endmodel -->
Produce a single full-body {{name}} in a neutral reference pose. {{> identity-lock}}

{{> registered-front}}

{{> fabric}}

{{> lighting-flat}}

{{> background-cutout}}

Premium short plush with finely groomed, visible fibres. Head and torso merge softly with no mechanical separation. Square high-resolution image, sharp at full resolution.

{{> negatives}}
