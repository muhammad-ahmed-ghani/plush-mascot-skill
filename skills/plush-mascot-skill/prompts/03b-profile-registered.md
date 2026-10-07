---
title: Registered left profile (single view)
asset: profile
size_hint: 1:1 (openai safe 1920x1920, max 2880x2880; gemini 4K)
required: [name, form, silhouette, body_color, face_color, eye_color, material, face, hands_feet, forbidden, chroma]
---
# Registered left profile

## Purpose
A higher-resolution, cleanly cut profile for the sculpt fit when the turnaround sheet's profile is too small or distorted. Same pose rules as the registered front, turned 90 degrees to the character's left.

## Settings
Same as `02-front-registered.md`; attach the hero (image 1) and the registered front (image 2). Keep the camera level and orthographic-like. Normalise with `scripts/tools/normalize_art.py` using the same scale as the front (same figure height).

## Accept when
A true profile (the far eye and the far arm are hidden the way they would be on a real plush), both feet visible on one baseline, head level, silhouette clean, same height as the front within 3 percent.

## PROMPT
<!-- model:openai -->
Use case: background-extraction and identity-preserve. Asset type: production cut-out, pure profile view.
Image 1 is the identity master; image 2 is the neutral front view (same scale and proportions).
<!-- endmodel -->
<!-- model:gemini -->
Using the attached images as the exact identity and proportion references, produce a pure left-profile view of the same character, {{name}}.
<!-- endmodel -->
Produce a single full-body {{name}} seen in a pure left profile (90 degrees), standing in the same neutral reference pose as the front view: camera level at mid-height, orthographic-like, head upright and level, arms hanging slightly away from the torso, both feet flat on the ground and visible, the whole figure inside the frame with about 8 percent margin on every side. {{> identity-lock}}

{{> fabric}}

{{> lighting-flat}}

{{> background-cutout}}

{{> negatives}}
