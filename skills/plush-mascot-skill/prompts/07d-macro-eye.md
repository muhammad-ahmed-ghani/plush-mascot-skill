---
title: Macro of the eye construction
asset: macro-eye
size_hint: 3:2 (openai safe 2304x1536; gemini 4K 3:2)
required: [name, face, eye_color, face_color, material]
---
# Macro: how the eye is made

## Purpose
Reference for the eye build: the satin pillow, the pupil and catchlight, the thin dark contact line, the lids, and how the face fabric surrounds the eye. The face kit's eye construction, rim ramp and sclera shading are measured from close-ups like this one.

## Settings
Attach the hero (image 1) and, if available, the expression sheet. Quality `high`.

## Accept when
The eye reads as a sculpted satin shape sitting in a fabric face, with a thin dark contact line and a soft shadow, not as a sticker or a glass bead; the pupil is a round appliqué; one small catchlight; fabric fibres visible around it.

## PROMPT
<!-- model:openai -->
Use case: photorealistic-natural. Asset type: construction detail reference. Image 1 is the identity master.
<!-- endmodel -->
<!-- model:gemini -->
Using the attached image as the exact material and colour reference, create a macro construction detail.
<!-- endmodel -->
Macro photograph, soft light from the upper left, of one of {{name}}'s eyes and the face fabric around it. Face design: {{face}}. The eye is a sculpted satin shape in {{eye_color.name}} ({{eye_color.hex}}) sewn onto {{face_color.name}} ({{face_color.hex}}) {{material}} fabric, with a thin dark contact line where it meets the fabric, a soft shadow, a round dark pupil with one small catchlight, and the lower edge of an upper lid made of the same fabric as the face. Fibres of the face fabric are visible and crisp; the satin has a gentle sheen but no glass or plastic look. Sharp focus, real object, no text.
