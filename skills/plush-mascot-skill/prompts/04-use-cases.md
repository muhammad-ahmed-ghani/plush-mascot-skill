---
title: Use-case vignettes (props and performance)
asset: use-cases
size_hint: 3:2 (openai safe 2304x1536, max 3504x2336; gemini 4K 3:2)
required: [name, form, silhouette, body_color, face_color, eye_color, material, face, hands_feet, forbidden, scene_bg, props]
---
# Use-case vignettes

## Purpose
Four small scenes that show the character doing the things the product needs: working, researching, waiting for a decision, celebrating. The 3D props (headphones, laptop, decision card, confetti) are modelled from these vignettes, and they show how the plush body bends when it holds things. Use them as the reference for prop shape, scale and material, not as pose truth.

## Settings
Attach the hero (image 1, identity master). OpenAI edit endpoint, quality `high`, safe size first. Gemini: character reference plus aspect 3:2. Re-roll until each prop is simple and buildable; discard props with brand marks or illegible clutter.

## Accept when
Four vignettes in a clean 2x2 grid with no dividers; identical character in all four; props are simple, plain-coloured and readable; exactly the requested number of confetti pieces; nothing crosses into another quadrant.

## PROMPT
<!-- model:openai -->
Use case: stylized-concept. Asset type: editorial use-case sheet. Image 1 is the identity master: preserve {{name}} exactly.
<!-- endmodel -->
<!-- model:gemini -->
Using the attached image as the exact identity reference, create an editorial sheet of four scenes with the same character, {{name}}.
<!-- endmodel -->
Create four separate polished vignettes arranged as a clean, spacious 2 by 2 grid on one seamless {{scene_bg.name}} ({{scene_bg.hex}}) background, no visible dividers, no text. Top left: {{name}} working: {{props.work}}; confident slight smile. Top right: {{name}} researching: {{props.research}}. Bottom left: {{name}} waiting for a decision: {{props.decision}}. Bottom right: {{name}} celebrating a completed task: {{props.celebrate}}.

{{> identity-lock}} Same proportions, scale, material and studio lighting in all four. Each scene fully contained in its quadrant with plentiful negative space.

{{> fabric}}

{{> lighting-studio}}

High-end brand campaign photography of real handmade objects. No written words, no brand marks on props. Do not alter the character design.

{{> negatives}}
