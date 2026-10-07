---
title: Macro swatch of the face fabric
asset: macro-face
size_hint: 1:1 (openai safe 1920x1920, max 2880x2880; gemini 4K)
required: [name, face_color, material]
---
# Macro swatch: face fabric

## Purpose
Same as the body swatch, for the inset face fabric, which usually has a different pile (shorter, denser, darker) and therefore its own nap tile and pre-emphasis curve. A dark fabric hides detail: check that the fibres are visible at all.

## Settings
As `07a-macro-body.md`. Lift the exposure slightly in the prompt if the fabric is very dark, otherwise the model flattens it into a black plane.

## Accept when
Fibres visible as thin highlights on a dark ground; no pure black clipping; no gradients.

## PROMPT
<!-- model:openai -->
Use case: photorealistic-natural. Asset type: material reference swatch. Image 1 is the identity master for colour and material.
<!-- endmodel -->
<!-- model:gemini -->
Using the attached image as the exact material and colour reference, create a macro material swatch.
<!-- endmodel -->
Extreme macro photograph of the exact face fabric of {{name}}: matte fabric in {{face_color.name}} ({{face_color.hex}}), the same make as the rest of the plush but shorter and denser, {{material}}. The fabric fills the whole frame edge to edge, a field of about {{macro_field_cm|6}} centimetres across, flat and evenly lit from slightly above at a low angle so that the fibre relief shows, sharp focus over the entire field. Individual fibres visible as fine lighter filaments, natural variation in density and tone, not glossy, no pure black clipping, no combed pattern, no repeating tile pattern. Colour accurate. No seams, folds, stitching, shadows, objects, text or vignette.
