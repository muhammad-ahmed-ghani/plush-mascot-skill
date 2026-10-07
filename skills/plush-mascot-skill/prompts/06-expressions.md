---
title: Face and expression sheet
asset: expressions
size_hint: 1:1 (openai safe 1920x1920, max 2880x2880; gemini 4K)
required: [name, face, eye_color, face_color, body_color, material, forbidden, scene_bg]
---
# Face and expression sheet

## Purpose
Reference for the face kit: how the eyes are built (size, spacing, satin sclera, pupil, catchlights), how the lids sit and close, how the mouth cord bends, how the cheeks and face fabric meet the padded head. The blink curve, the mouth shapes per state and the lid shadow are tuned against these close-ups. Nine head-and-shoulders crops in a 3 by 3 grid, all the same framing.

## Settings
Attach the hero (image 1, identity master). Quality `high`; the larger the better here (each cell is a third of the image). Keep cells identical in framing so eye positions are comparable.

## Accept when
The eyes keep the same size and spacing in all nine; the face fabric looks like fabric with visible fibre; eye construction is legible at 100 percent; the mid-blink and closed eyes show lids of the same fabric as the face; no nose or teeth appear if forbidden.

## PROMPT
<!-- model:openai -->
Use case: stylized-concept. Asset type: face and expression reference sheet. Image 1 is the identity master: preserve {{name}}'s face exactly.
<!-- endmodel -->
<!-- model:gemini -->
Using the attached image as the exact identity reference, create a face and expression reference sheet for the same character, {{name}}.
<!-- endmodel -->
A clean 3 by 3 grid of nine head-and-shoulders close-ups of {{name}}, all identical in framing, scale and lighting, frontal view, on one seamless {{scene_bg.name}} ({{scene_bg.hex}}) background, no dividers, no text. Face design to preserve exactly: {{face}}. {{eye_note|Eyes kind and attentive, never wide or manic.}}
Expressions, reading order: neutral and calm; gentle closed-mouth smile; blink caught halfway, lids half closed; eyes fully closed, asleep; glancing to the viewer's left; glancing up, thinking; concerned, small downward mouth; speaking, mouth slightly open; pleased squint.
Show the fabric lids as the same fabric as the face, the eye satin, the pupil with its catchlight, the thin dark line where the eyes and cheeks meet the face fabric, and the soft roll where the face fabric meets the padded head.

{{> fabric}}

{{> lighting-studio}}

{{> negatives}}
