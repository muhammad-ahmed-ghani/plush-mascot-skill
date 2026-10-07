---
title: State pose sheet (ten application states)
asset: poses
size_hint: 5:2 (openai safe 2560x1024, max 3840x1536; gemini 21:9, or two 5x1 strips on Nano Banana 2 at 4:1)
required: [name, form, silhouette, body_color, face_color, eye_color, material, face, hands_feet, forbidden, scene_bg, props]
---
# State pose sheet

## Purpose
Art targets for the ten application states (idle, greeting, listening, thinking, working, approval, success, error, speaking, resting). The rig is authored from the brief's motion contract; this sheet shows how the plush body actually bends and where hands, head and props sit, so pose authoring starts from a picture. It is also the reference for the silhouette and clearance review. It is optional; skip it if the art budget is tight.

## Settings
Attach the hero (image 1, identity master) and optionally the registered front (image 2). OpenAI edit endpoint, quality `high`. If ten cells look crowded or drift in identity, render two strips of five (states 1 to 5, then 6 to 10) by deleting the other five lines from the prompt.

## Accept when
Ten separate figures, equal scale, same character in all, no overlaps; each pose readable as its state at a glance; hands and props do not merge into the head; no text.

## PROMPT
<!-- model:openai -->
Use case: stylized-concept. Asset type: pose sheet for animation reference. Image 1 is the identity master: preserve {{name}} exactly.
<!-- endmodel -->
<!-- model:gemini -->
Using the attached image as the exact identity reference, create a pose sheet for animation with the same character, {{name}}.
<!-- endmodel -->
A clean grid of ten full-body poses of {{name}}, five columns by two rows, on one seamless {{scene_bg.name}} ({{scene_bg.hex}}) background, equal scale, every figure fully visible with generous spacing, no dividers, no labels, no text. Reading order, top row then bottom row:
1. idle: standing relaxed, arms by the sides, a calm look slightly off camera.
2. greeting: one arm lifted out to the side in a friendly wave, the hand clear of the head, a small smile.
3. listening: leaning slightly forward with an attentive head tilt, eyes on the viewer.
4. thinking: eyes glancing upward, one mitten raised near the chin.
5. working: sitting on the floor and concentrating on the work: {{props.work}}.
6. waiting for a decision: head turned toward a cream card held out to one side on a long arm, the other hand offering an open palm: {{props.decision}}.
7. success: mid-hop with both arms raised in a V: {{props.celebrate}}.
8. error: a concerned head tilt, small downward mouth, hands held together in front.
9. speaking: a gentle gesture with one hand, the mouth slightly open.
10. resting: eyes closed, settled into a peaceful sleeping posture.
{{pose_overrides|}}

{{> identity-lock}} Same proportions, scale, material and lighting in every cell. Raised arms may be longer than the resting arms, as a real plush's arms stretch, but hands never touch or overlap the head.

{{> fabric}}

{{> lighting-studio}}

{{> negatives}}
