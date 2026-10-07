---
title: Design exploration sheet
asset: explore
size_hint: 3:2 (openai safe 2304x1536; gemini 2K)
required: [name, one_liner, form, silhouette, body_color, face_color, eye_color, material, face, forbidden, scene_bg]
---
# Design exploration sheet

## Purpose
Find the design before spending on masters. One call returns six different takes on the brief so you can choose the silhouette and face that read best, or combine two. Exploration is cheap: use the safe size, quality `medium`, and run it twice (once per model) for twelve directions.

## Settings
- OpenAI: `gpt-image-2.5-flare-2026-09-08` is enough here (speed over polish), 2304x1536, quality medium. Gemini: Nano Banana 2, 2K, aspect 3:2.
- No references. If the user gave a sketch or mood image, attach it and add the line "Image 1 is loose inspiration for mood and proportions only, do not copy it".

## How to choose
Squint at each figure at about 64 px tall. Keep the one whose silhouette is still recognisable, whose face reads as a friendly fabric face (not a screen or a sticker) and whose proportions a real pattern maker could sew. Reject anything glossy, anything that copies a known mascot, anything whose limbs you cannot imagine as tubes of felt. Write down why you chose it in GENERATION-PROMPTS.md.

## PROMPT
<!-- model:openai -->
Use case: stylized-concept. Asset type: design exploration sheet for an original mascot character.
<!-- endmodel -->
<!-- model:gemini -->
A character design exploration sheet for an original mascot character.
<!-- endmodel -->
A clean 3 by 2 grid of six clearly different full-body design directions for {{name}}, {{one_liner}}, all on the same seamless {{scene_bg.name}} ({{scene_bg.hex}}) background, equal scale, each figure fully visible with generous spacing, no dividers, no labels, no text.

Shared brief: {{form}}. Signature silhouette idea: {{silhouette}}. Face: {{face}}. Palette family: {{body_color.name}} body, {{face_color.name}} face fabric, {{eye_color.name}} eyes. Personality: {{personality|warm and capable}}.

Vary between the six: the head-to-body ratio, the exact shape of the silhouette feature, the shape of the face area and the size and spacing of the eyes, the stance, and the amount of visible seam detail. Keep the same material and the same palette family in all six so that the choice is about design, not rendering style.

{{> fabric}}

{{> lighting-studio}}

{{> negatives}}
