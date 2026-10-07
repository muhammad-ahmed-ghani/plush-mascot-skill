# Prompt pack

Templates that turn a character brief into ready-to-send image prompts for the two families of top image models (OpenAI GPT Image, Google Nano Banana). They are written for the art this pipeline needs, not for generic pretty pictures: a registered neutral front view with a clean cut-out, a turnaround, prop vignettes, pose and face sheets, and macro fabric swatches.

## Use

```bash
# 1. write the brief (start from brief.example.json; field guidance in references/character-brief.md)
cp prompts/brief.example.json art/brief.json
# 2. render every template for both model families
python3 template/scripts/tools/render_prompts.py --brief art/brief.json --all --model both --out art/prompts
# 3. generate (see references/image-generation.md for models, sizes and tool discovery)
python3 template/scripts/tools/imagegen.py generate --provider openai --model gpt-image-2.5-sunburst-2026-09-08 \
  --size 2880x2880 --quality high --prompt-file art/prompts/01-hero.openai.txt --out art/candidates/hero --dry-run
```

`--dry-run` prints the exact request and calls nothing; add `--yes` to spend. In a project created by `scripts/scaffold.mjs` the same tools live in `scripts/tools/`.

## Files

| File | Asset | Model input |
|---|---|---|
| `00-explore.md` | six design directions on one sheet | text only |
| `01-hero.md` | identity master, three-quarter full body | text only |
| `02-front-registered.md` | strict neutral front, cut out: the pipeline's key image | hero as reference |
| `03-turnaround.md` | front, profile, back in one row | hero (+ front) |
| `03b-profile-registered.md` | single high-resolution left profile | hero + front |
| `04-use-cases.md` | four prop and performance vignettes | hero |
| `05-pose-sheet.md` | ten state poses (optional) | hero (+ front) |
| `06-expressions.md` | 3 by 3 face and expression sheet | hero |
| `07a`..`07d` | macro swatches: body fabric, face fabric, seam join, eye build | hero |
| `edits.md` | ready edit prompts and the edit protocol | the image to fix |
| `qa-critique.md` | hostile art-director prompt with a scoring JSON | candidate + master |
| `_partials/*.md` | shared blocks: fabric language, identity lock, exclusions, lighting, registered pose, cut-out background | included by the templates |
| `brief.example.json`, `brief.owl.example.json` | two complete briefs of very different designs | |

Every template has a front-matter block, documentation sections (purpose, settings, acceptance) and one `## PROMPT` section, the only part that is emitted.

## Template syntax (what `render_prompts.py` understands)

- `{{var}}`, dotted `{{body_color.name}}`, default `{{var|fallback text}}`.
- `<!-- if:var -->...<!-- endif -->` and `<!-- if:!var -->...<!-- endif -->` (empty string, false, null and missing are false).
- `<!-- model:openai -->...<!-- endmodel -->` and `<!-- model:gemini -->...<!-- endmodel -->` for model-specific wording: OpenAI prompts lead with labelled lines ("Use case:", "Asset type:", "Image 1 is ...") which the model uses to pick a mode; Gemini prompts read as natural language instructions about the attached images.
- `{{> name}}` includes `_partials/name.md` rendered with the same brief.

## Brief fields used by the templates

`name`, `one_liner`, `personality`, `product`, `form`, `silhouette`, `body_color`, `face_color`, `eye_color`, `accent_color` (each `{name, hex}`), `material`, `face`, `eye_note`, `chest_mark` (may be empty), `hands_feet`, `forbidden`, `originality_note`, `scene_bg` `{name, hex}`, `chroma` (true when the model has no alpha output or rejects it), `key_color` `{name, hex}` (far from every design colour), `props` `{work, research, decision, celebrate}`, optional `back_note`, `seam_detail`, `macro_field_cm`, `pose_overrides`. The craft behind each field is in `references/character-brief.md`.

## Why the prompts are built this way

- **Order**: scene, subject, key details, composition, light, constraints. Models follow early, concrete statements best and treat a long tail of "don'ts" as weak hints, so every exclusion also appears as a positive description (matte, dense short fibres, hand-sewn seams).
- **Identity is restated in every call.** The models keep no memory between calls; the identity lock partial is the memory.
- **The look is "photograph of a real handmade object".** The runtime is a real renderer under real lights; art that is a physically plausible object can be matched, while painted glow and impossible shading cannot.
- **Registered views are strict.** Symmetry, level camera, arm gap and visible soles are what make the silhouette fit and the nap extraction possible; creative poses belong to the hero and the pose sheet.
- **Hard numbers are in the prompts only where the model can honour them** (margins, counts such as "exactly three confetti pieces", hex colours). Camera specifications are interpreted loosely.

## Record keeping

Every generated file gets its metadata JSON from `imagegen.py`. Append a section per chosen image to the project's `GENERATION-PROMPTS.md` (date, model id, size, quality, references and their roles, the full prompt as sent, the file kept, why it won). The masters go untouched into `art/masters/`; the pipeline works on copies.
