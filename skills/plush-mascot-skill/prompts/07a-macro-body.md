---
title: Macro swatch of the body fabric
asset: macro-body
size_hint: 1:1 (openai safe 1920x1920, max 2880x2880; gemini 4K)
required: [name, material, body_color]
---
# Macro swatch: body fabric

## Purpose
A flat, seam-free, evenly lit close-up of the body fabric. It is the material reference for the fabric shader (fibre width, curl, density, pale flyaways, colour variation) and the judge of whether the rendered nap looks like the art. It is NOT consumed by the nap extractor automatically: the extractor reads the flat regions of the registered front view at the pipeline's scale. Use a swatch as an extra nap source only after registering its scale (measure the fibre width in pixels in the swatch and in the front view, resample so they match; see `references/felt-shader.md`).

## Settings
Attach the hero (image 1) for colour and material identity. Generate natively at the largest size; never upscale a swatch (an upscaler invents fibres). Quality `high`.

## Accept when
No seams, folds, shadows or objects; fibres are crisp and about one to three pixels wide; density and direction vary; colour matches the brief within a small shift.

## PROMPT
<!-- model:openai -->
Use case: photorealistic-natural. Asset type: material reference swatch. Image 1 is the identity master for colour and material.
<!-- endmodel -->
<!-- model:gemini -->
Using the attached image as the exact material and colour reference, create a macro material swatch.
<!-- endmodel -->
Extreme macro photograph of the exact body fabric of {{name}}: {{material}}, {{body_color.name}} ({{body_color.hex}}). The fabric fills the whole frame edge to edge, a field of about {{macro_field_cm|6}} centimetres across, flat and evenly lit from slightly above at a low angle so that the fibre relief shows, sharp focus over the entire field (deep depth of field). Individual fibres are visible, thin and crisp, curled and overlapping, with natural variation in density, direction and tone, a few paler flyaway fibres, no combed pattern, no repeating tile pattern. Colour accurate. No seams, folds, stitching, shadows, objects, hands, text or vignette.
