---
title: Hero master (identity master)
asset: hero
size_hint: 1:1 (openai safe 1920x1920, max 2880x2880; gemini 4K)
required: [name, one_liner, form, silhouette, body_color, face_color, eye_color, material, face, hands_feet, forbidden, scene_bg]
---
# Hero master (identity master)

## Purpose
The flagship portrait and the identity reference for every other image. Every later prompt attaches this image and restates its locks. It also gives the material reference (nap scale, sheen, seams) the runtime is tuned against. Generate several, pick one, and keep the untouched original under `art/masters/`.

## Settings
- OpenAI: `gpt-image-2.5-sunburst-2026-09-08` (or the alias `gpt-image-2.5-sunburst` if the account lists it), quality `high` (try `xhigh`), `n` 4 at the safe size 1920x1920 to choose; render the chosen direction again at 2880x2880 and compare the two at 100 percent (above 2560x1440 is documented as experimental, so the larger one is not automatically better).
- Gemini: Nano Banana Pro `gemini-3-pro-image`, aspect 1:1, `image_size` 4K. Run the same prompt and keep the better hero of the two models.
- References: none for the first hero; for a second pass attach the chosen candidate and use an edit prompt from `references/image-generation.md` (one change at a time).

## Accept when
Identity features match the brief; fibres are visible as thin individual filaments at 100 percent; no gloss; seams look hand-sewn; the silhouette is clean; eyes are the intended size; no text or logo; the figure is fully inside the frame with air around it.

## PROMPT
<!-- model:openai -->
Use case: stylized-concept. Asset type: flagship identity-master portrait of an original mascot character<!-- if:product --> for {{product}}<!-- endif -->.
<!-- endmodel -->
<!-- model:gemini -->
A square, photographic-quality studio portrait of an original mascot character.
<!-- endmodel -->
Create {{name}}, {{one_liner}}: a world-class original character, photographed as a real handmade collectible object with premium character design and believable weight. Full body, centred, front three-quarter view with a very slight turn (about ten degrees), camera level at the character's mid-height, feet grounded on the floor, the whole figure inside the frame with about 12 percent empty margin on every side.

Character design: {{form}}. Signature silhouette: {{silhouette}}. Face: {{face}}. {{eye_note|Eyes kind, intelligent and attentive, never wide or manic.}} {{hands_feet}}. <!-- if:chest_mark -->Chest: {{chest_mark}}. <!-- endif -->Personality in the pose: {{personality|warm and capable}}; one arm lifted in an understated friendly greeting, the other relaxed.

{{> fabric}}

Scene: a seamless {{scene_bg.name}} ({{scene_bg.hex}}) studio background and a soft grounding shadow under the feet, quiet and sophisticated composition, exceptionally polished materials and modelled forms.

{{> lighting-studio}}

Square high-resolution image, sharp at full resolution so that individual fibres and stitches can be inspected.

{{> negatives}}
