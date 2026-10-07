# Generation log

Record every image you keep: date, model id, size, quality, references and their roles, the full prompt as sent, the file kept and why it won. The templates and the edit protocol are in the skill (`prompts/`); `scripts/tools/imagegen.py` writes a metadata JSON next to every file it saves. Originals go untouched in `art/masters/`.

## Entry template

- Asset: hero | front | profile | turnaround | use-cases | poses | expressions | macro-*
- Date / model id / size / quality / references (image 1: ..., image 2: ...):
- Prompt as sent:
- Kept: `art/masters/<file>` (candidates tried: n; why this one):
- QA: `art_qa.py` result, reviewer verdict, residual flaws:

## Example entries (the template's example mascot)

**Hero.** Use case: stylized-concept. Asset type: flagship identity-master portrait of an original mascot character. A compact coral-red creature of very fine short micro-suede plush; oversized softly squared head blending into a small pear-shaped body; two short rounded diagonal tabs at the upper corners and two sturdy splayed feet (a subtle four-way X silhouette, not a literal letter); small rounded mitten hands, one arm lifted in an understated greeting; deep warm charcoal inset oval face of matte fabric, warm ivory oval eyes with dark pupils and tiny catchlights, a small friendly curved mouth, two muted coral cheeks; a tiny tonal stitched X on the chest; coral about #F05C63, charcoal #24252B. Seamless warm off-white studio, soft key from upper left, subtle warm rim. Square, no props, no text, no watermark.

**Registered front (cut-out).** Image 1 is the exact identity master. A single full-body character on a genuinely transparent background, neutral front-facing pose, both mitten arms gently away from the torso, calm expression, clean alpha edges with tiny believable fibres and no halo, entire body inside the frame with generous padding, no text, no props.

**Turnaround.** Three equally sized full-body orthographic-like views in one row on seamless pale ivory: front neutral with arms slightly out, left profile with both feet on the ground, back view revealing the centred construction seam; consistent construction; no labels.

**Use cases.** Four polished vignettes in a clean 2x2 grid, no dividers, no text: working with over-ear headphones at a small open laptop; examining a cream paper card through a rounded magnifying glass; one open palm extended and a cream card with a single charcoal checkmark; a small happy hop with both arms raised and exactly three tiny confetti pieces.
