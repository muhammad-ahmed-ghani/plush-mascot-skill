---
title: Macro of the construction seam
asset: macro-seam
size_hint: 3:2 (openai safe 2304x1536; gemini 4K 3:2)
required: [name, body_color, face_color, material]
---
# Macro: where the fabrics meet

## Purpose
Shows exactly how two fabrics are joined on the real object: the roll of the padded fabric over the edge, the thin dark crevice line, the tuck of the second fabric, the thread. The hood-to-face blend is the single most scrutinised detail of this kind of character; this image is what the shader's edge profile (lip, crevice, tuck) is tuned to.

## Settings
Attach the hero (image 1). Describe the join in the brief field `seam_detail` if the design differs from the default. Quality `high`.

## Accept when
A rolled lip that casts a soft shadow, a narrow crevice, the second fabric disappearing under the first, fibres of both fabrics interleaving at the boundary, no hard printed line.

## PROMPT
<!-- model:openai -->
Use case: photorealistic-natural. Asset type: construction detail reference. Image 1 is the identity master.
<!-- endmodel -->
<!-- model:gemini -->
Using the attached image as the exact material and colour reference, create a macro construction detail.
<!-- endmodel -->
Macro photograph, raking light from the upper left, of a section of {{name}} where the two fabrics meet: {{seam_detail|the hand-sewn join where the padded body fabric rolls over the edge of the face fabric}}. {{body_color.name}} ({{body_color.hex}}) fabric on one side and {{face_color.name}} ({{face_color.hex}}) on the other. Show the rolled lip of the padded fabric with its soft shadow, a thin dark crevice line, the second fabric tucking in underneath, fibres of both fabrics interleaving at the boundary, and a few visible stitches where the join is sewn. Sharp focus, {{material}}, real object, no printed lines, no gloss, no text.
