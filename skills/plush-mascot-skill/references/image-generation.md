# Image generation playbook: master art at the highest resolution

Purpose: produce the master artwork that every later phase is fitted to and judged against, using the best available image model at the largest size it supports. Read this before Phase 1 and whenever a generated image fails QA.

Facts about models, sizes and prices were verified on 2026-10-01 and change quickly. Treat every model id, limit and price below as "last verified"; `scripts/tools/imagegen.py models` and `sizes --validate` check the live account, and the provider docs win over this file.

## Contents

1. Why the art comes first
2. Models and how to choose
3. Resolution strategy (safe and max tiers)
4. Finding a way to call a model (tool discovery and consent)
5. Prompt anatomy
6. The asset ladder: what to generate, in what order, with which references
7. Transparent output and cut-outs
8. Selection, QA and locking the masters
9. Edit protocol
10. Failure modes
11. Cost, time, parallelism
12. API quick reference
13. Originality, provenance and licensing
14. Hand-off to Phase 2

## 1. Why the art comes first

The 3D model is not designed in 3D. It is fitted to the art: the sculpt to the silhouettes, the fabric to the fibres in the flat regions, the face to the measured features, the lighting to the luminance, and every gate compares the live render to the art at the same crop. Anything wrong in the art (plastic look, muddy fibres, a halo, eyes of different size) is either copied into the product or shows up as a gap the tuner cannot close. Spending generously here is the cheapest quality available. The plan:

- one **identity master** (hero) chosen from a tournament;
- one **registered neutral front view**, cleanly cut out, symmetrical and evenly lit: the geometric and material truth;
- a **turnaround** (and, if needed, a separate profile) for depth and construction;
- **use-case vignettes** for the props; optional **pose** and **expression** sheets and **macro swatches** for motion, face and fabric references.

What "highest resolution" buys: a cleaner silhouette for the fit, nap filaments that are several pixels wide before they are downsampled to the pipeline's canonical frame (so the tile is crisp instead of interpolated), and more headroom for crops in the fidelity audit. It does not change the canonical frame (1254 px square at 350 px per unit): masters are normalised into it with `normalize_art.py`, and the full-resolution originals are kept untouched.

## 2. Models and how to choose

| Model | API id (verify) | Good for | Limits that matter |
|---|---|---|---|
| OpenAI GPT Image 2.5 **Sunburst** | `gpt-image-2.5-sunburst-2026-09-08` (an undated alias may exist) | masters, identity-locked sets, edits, precise preservation of reference subjects across turns, transparent PNG/WebP | edge <= 3840, multiples of 16, ratio <= 3:1, 0.66 to 8.3 MP; quality low/medium/high/xhigh/max; up to 16 references in edits; slower |
| OpenAI GPT Image 2.5 **Flare** | `gpt-image-2.5-flare-2026-09-08` (alias may exist) | exploration, drafts, batches; about half the latency of GPT Image 2 at equal or better quality | same limits |
| OpenAI GPT Image 2 | `gpt-image-2` | fallback when 2.5 is not on the account; led the Artificial Analysis image arena in September 2026 | same sizes; transparent background was a preview on the API (from 2026-08-21) |
| OpenAI GPT Image 1.5 / 1 / mini | `gpt-image-1.5`, `gpt-image-1`, `gpt-image-1-mini` | last resort | fixed sizes 1024x1024, 1024x1536, 1536x1024; `input_fidelity` low/high |
| Google Nano Banana **Pro** | `gemini-3-pro-image` | native 4K single images, dense detail, strong realism; second opinion on every hero | `image_size` 1K/2K/4K (long edge about 1024/2048/4096); refs: 6 objects, 5 characters, 3 style; no alpha; SynthID watermark |
| Google Nano Banana **2** | `gemini-3.1-flash-image` (released 2026-05-28) | fast exploration at 512/1K/2K/4K, extra tall/wide ratios (1:4, 4:1, 1:8, 8:1) | refs: 10 objects, 4 characters, 3 style; no alpha |
| Nano Banana 2 Lite | `gemini-3.1-flash-lite-image` | cheap thumbnails only | 1K only |
| Others (xAI, Flux, Seedream, Midjourney, open weights) | varies | only when the above are unavailable | check the leaderboard; most lack multi-reference identity locking or alpha |

**Default decision**

1. Have OpenAI access: Sunburst for masters and every identity-locked step, Flare for exploration.
2. Have Gemini access: run the hero on Nano Banana Pro at 4K as well. Keep whichever looks more like a real handmade object at 100 percent crops. Continue the whole set with the winner (identity drift between models is worse than any single model's flaws); use the other model as a second opinion and for the macro swatches.
3. Only one model available: use it; the pipeline is model-agnostic.
4. Only a built-in image tool with small outputs (1024 to 1536 px): it works. The example mascot's masters were 1254 px. Expect a lower ceiling on nap cleanliness; say so in the handoff.

Check the leaderboard before committing budget to a model you have not used: artificialanalysis.ai/text-to-image/arena/leaderboard-text. In September 2026 the top five were GPT Image 2 (high), GPT Image 1.5 (high), Nano Banana 2, Nano Banana Pro and an xAI model; GPT Image 2.5 shipped afterwards.

## 3. Resolution strategy

OpenAI rules (GPT Image 2 and 2.5), all at once: long edge <= 3840 px; both edges multiples of 16; long:short ratio <= 3:1; total pixels 655,360 to 8,294,400. Sizes above 2560x1440 are documented as **experimental**: results are more variable, not necessarily worse. The tool computes exact sizes:

```bash
python3 scripts/tools/imagegen.py sizes --provider openai --aspect 1:1 --tier safe   # 1920x1920
python3 scripts/tools/imagegen.py sizes --provider openai --aspect 1:1 --tier max    # 2880x2880
python3 scripts/tools/imagegen.py sizes --validate 2880x2880
```

| Aspect | safe (<= 3.69 MP, edge <= 2560) | max (<= 8.29 MP) | Use for |
|---|---|---|---|
| 1:1 | 1920x1920 | 2880x2880 | hero, registered front, profile, macro swatches, expressions |
| 3:2 | 2304x1536 | 3504x2336 | turnaround, use-cases, seam and eye macros |
| 5:2 | 2560x1024 | 3840x1536 | ten-state pose sheet |
| 16:9 | 2560x1440 | 3840x2160 | wide scene plates (rarely needed) |
| 3:1 | 2544x848 | 3840x1280 | single-row strips (five-pose strips) |

Gemini: pass `aspect_ratio` (1:1, 3:2, 2:3, 3:4, 4:3, 4:5, 5:4, 9:16, 16:9, 21:9; Nano Banana 2 adds 1:4, 4:1, 1:8, 8:1) and `image_size` (`512px`, `1K`, `2K`, `4K`, capital K). Always read the pixel size of what came back.

**The two-tier rule.** Explore and select at the safe size (cheap, stable, fast, four candidates per call). Render the chosen direction again at the max size, compare the two at 100 percent crops of the fabric, the eyes and the edge, and keep the better one. Bigger is not automatically better: at max size models sometimes smooth the fibres or drift the design; in that case keep the safe-size render, or use max size only for the registered front and macro swatches where pixel count matters most.

**Never AI-upscale fabric.** An upscaler invents fibres that were never there, and the nap extractor would copy the invention into the product. If more pixels are needed, generate a new image natively (a macro swatch, a crop-and-refine edit of the region at higher detail), not an upscale. Plain Lanczos resizing for posters and previews is fine.

**Verify what you received.** Some relays and some tools silently return smaller images than requested. `imagegen.py` prints requested versus returned size and records both in the metadata JSON; do the same in any other tool (`python3 -c "from PIL import Image; print(Image.open('x.png').size)"`).

## 4. Finding a way to call a model

Work down the list; stop at the first that works. Ask the user before spending on anything metered.

1. **A built-in image tool** in your own tool list (names containing `image`, `imagegen`, `generate_image`). Check what sizes and references it accepts; write the prompt to `art/prompts/` first so the run is reproducible.
2. **A connected model runner** (an MCP server exposing image models: search its tool list for "image", "model", "run"). Use its model finder to see whether GPT Image 2.x or Nano Banana is offered and what it costs per run. Some connectors need the user to authorise an account first; if one says so, tell the user and move on.
3. **API keys in the environment**: check names only, never print values.
   ```bash
   env | sed 's/=.*//' | grep -E '^(OPENAI_API_KEY|GEMINI_API_KEY|GOOGLE_API_KEY|FAL_KEY|REPLICATE_API_TOKEN)$'
   python3 scripts/tools/imagegen.py models --provider openai      # what this key can see
   python3 scripts/tools/imagegen.py models --provider gemini
   ```
4. **An installed skill that wraps an image model.** Read its `SKILL.md` for its model id and limits, but keep this playbook's prompts and QA.
5. **The user.** Hand over the rendered prompt pack (`render_prompts.py --all`), the exact settings per asset (model, size, quality, references), and a drop folder (`art/masters/`); continue other work (toolchain check on the example art) while they generate. Do not stall silently and do not invent art.

**Consent.** A full pack is roughly 25 to 60 calls. At high quality and large sizes that is single-digit to low-double-digit dollars on the public price lists (2.5 at high quality was about 4 cents at 1080p and about 10 cents at 4K per image in fal's price table; xhigh and max cost about 1.8 and 4 times high). Give the user the estimate (`imagegen.py estimate`), get a budget, and stop at it. `imagegen.py` refuses to call the network without `--yes` and supports `--max-usd`.

**Keys.** Only from environment variables; never written to files, metadata or logs; `--dry-run` redacts.

## 5. Prompt anatomy

The templates in `prompts/` encode all of this; read it so you can repair a prompt that misbehaves.

1. **Use case and asset type first** (OpenAI responds to labelled lines: `Use case:`, `Asset type:`). It sets the model's mode and polish level. For Gemini, open with one natural sentence saying what the image is for.
2. **Scene and subject**, then **key details**, **composition** (camera height, view, margins), **light**, **constraints**. Early concrete statements are followed best; a long tail of negatives is treated as a weak hint, so every exclusion also appears as a positive description ("matte", "dense short fibres", "hand-sewn seams").
3. **Identity lock** restated in every call (form, silhouette feature, face design, colours with hex, hands and feet, forbidden features). Models keep no memory between calls; the lock is the memory. Attach the identity master and say what each attached image is for ("Image 1 is the identity master; image 2 supplies proportions").
4. **Material language.** Say what the fabric is and what it is not. The wording that works: needle-felted micro-suede; dense short fine fibres with individual filaments visible, slightly curled, varying in density and direction; pale flyaways catching the rim light; matte; hand-sewn seams that wander; soft self-occlusion. What the models over-deliver without it: airbrushed velvet, silicone, vinyl sheen, a glowing rim. Phrase bank and pipeline suitability:

   | Fabric words | Reads as | Pipeline verdict |
   |---|---|---|
   | needle-felt, micro-suede, short velour, minky, terry | short dense pile | supported (pile length below roughly 1.5 percent of the character height) |
   | boucle, fleece, knit | loops and ribs | supported with a re-fitted nap; check the fibre-band metrics |
   | mohair, shag, long fur, faux-fur | long hair | out of scope for this shader; see `references/adapting-to-a-new-character.md` |
   | satin, felt appliqué | smooth or matte patches | used for eyes, cheeks, patches |
5. **Light** for the hero: one large soft key from the upper left, gentle fill, subtle warm rim, floor bounce. For cut-outs: soft, even, nearly shadowless, so fabric colour and fibre detail read the same everywhere (strong baked shadows contaminate the extracted nap).
6. **"A photograph of a real handmade object."** The runtime is a real renderer under real lights. Art that is a physically plausible object can be matched; painted glow, impossible shading and fantasy bloom cannot.
7. **Text and marks suppressed, counts explicit.** "No text, lettering, logos or watermark"; "exactly three confetti pieces". Counts and hex values are honoured; camera specifications and "8 mm lens" are interpreted loosely.
8. **Originality line** in every prompt, and never a real character's name in the prompt.
9. **Quality setting**: `medium` or Flare for exploration; `high` for masters; `xhigh`/`max` only if `high` fibres are still soft at 100 percent (they cost 1.8 to 4 times more and take longer).
10. **Model differences**: OpenAI takes structured labelled paragraphs and quoted literal text well; Gemini takes narrative and "using the attached image..." phrasing, and its thinking step helps with multi-constraint layouts (turnarounds). Both benefit from one constraint per sentence.

## 6. The asset ladder

Generate in this order; each step locks something the next needs. Template file, size, references, and what it feeds:

| Step | Template | Size (tier) | References | Feeds |
|---|---|---|---|---|
| 0 Explore | `prompts/00-explore.md` | 3:2 safe, medium | none | design choice |
| 1 Hero | `01-hero.md` | 1:1 safe then max | none | identity master, material reference |
| 2 Registered front | `02-front-registered.md` | 1:1 max | hero | silhouette fit, nap, face features, every gate |
| 3 Turnaround | `03-turnaround.md` | 3:2 safe then max | hero, front | profile depth, back construction |
| 3b Profile | `03b-profile-registered.md` | 1:1 max | hero, front | cleaner profile if the sheet's is weak |
| 4 Use-cases | `04-use-cases.md` | 3:2 | hero | props, hand-prop contact |
| 5 Pose sheet (optional) | `05-pose-sheet.md` | 5:2 | hero, front | state pose targets |
| 6 Expressions (optional) | `06-expressions.md` | 1:1 max | hero | face kit, blink and mouth shapes |
| 7 Macros (optional) | `07a`..`07d` | 1:1 / 3:2 max | hero | fabric look-matching, seam and eye construction |

The **registered front is the geometric truth.** The hero is the beauty shot and may differ slightly (three-quarter view, a raised arm). If the front's proportions or features differ from the hero's, fix the front with an edit (not the hero) and note it; every later image (turnaround, profile, vignettes) is generated with the front attached so the whole set converges on it.

Commands (dry-run first, then `--yes`):

```bash
python3 scripts/tools/render_prompts.py --brief art/brief.json --all --model both --out art/prompts
python3 scripts/tools/imagegen.py generate --provider openai --model gpt-image-2.5-sunburst-2026-09-08 --size 1920x1920 --quality high --n 4 \
   --prompt-file art/prompts/01-hero.openai.txt --out art/candidates/hero-openai --dry-run
python3 scripts/tools/imagegen.py edit --provider openai --model gpt-image-2.5-sunburst-2026-09-08 --size 2880x2880 --quality high \
   --ref art/masters/hero.png --ref-role "image 1: identity master" --background transparent --format png \
   --prompt-file art/prompts/02-front.openai.txt --out art/candidates/front --dry-run
python3 scripts/tools/imagegen.py generate --provider gemini --model gemini-3-pro-image --aspect 1:1 --image-size 4K \
   --prompt-file art/prompts/01-hero.gemini.txt --out art/candidates/hero-gemini --dry-run
```

## 7. Transparent output and cut-outs

The registered front (and the profile) must end up as a straight-alpha PNG with clean edges. Three routes:

1. **Native alpha.** OpenAI GPT Image 2 (preview from 2026-08-21) and 2.5: `background: "transparent"` with `output_format: "png"` (or `webp`). JPEG has no alpha. Older advice said the models could not do this; some relays still reject it. Verify the result, do not assume it: `python3 scripts/tools/alpha_extract.py verify front.png` reports halo metrics, and `art_qa.py --kind transparent` looks for baked checkerboards and stray islands. Native alpha on fibrous silhouettes is often a hard mask with a fringe; judge it on a light and a dark backdrop.
2. **Key colour.** Ask for a perfectly flat key background and remove it locally. Choose a key colour far from every colour in the design (chroma green for red/orange/blue characters, magenta for green ones; never a colour that appears in the eyes, cheeks or props). Set `"chroma": true` in the brief so the prompts describe it. Then:
   ```bash
   python3 scripts/tools/alpha_extract.py key art/masters/front-keyed.png --out art/work/front.png
   ```
   The tool estimates the background from the border, builds a soft matte in Lab, unmixes the background from partially transparent pixels (C = aF + (1-a)B) so no key-coloured fringe is baked into the fibres, despills, removes islands and fills pin-holes. Gemini has no alpha output, so it always uses this route.
3. **Two renders on different backgrounds** (difference matting, `alpha_extract.py difference`) is exact but only works for pixel-aligned pairs such as renders of the 3D model; AI outputs will not align. Do not use it for generated art.

After any route: look at the result on white, black and a mid-grey with the preview sheet; halos only show on one of them. Keep the keyed original.

## 8. Selection, QA and locking the masters

1. **Candidates**: four per model at the safe size for the hero; two to four for the registered front; two for the rest.
2. **Automated gate**: `python3 scripts/tools/art_qa.py art/candidates --kind auto --report art/qa.json`. It checks resolution, alpha, margins, halo, fake checkerboards, symmetry, nap visibility, turnaround separation and the palette (see `references/art-analysis.md` for thresholds and fixes).
3. **Hostile review**: give candidates and the brief to a fresh reviewer with `prompts/qa-critique.md`. Take the stricter of the two verdicts.
4. **Human gate**: show the user the top two (contact sheet: `scripts/tools/contact_sheet.py`) when the choice is about taste; identity and silhouette are their call.
5. **Tournament for the hero**: generate per model, review, take the top two overall to the max size, compare at 100 percent, choose one. **Lock it**: copy the file to `art/masters/hero.png` with its metadata JSON, and do not edit it again. A changed hero invalidates every image derived from it.
6. **Per asset**, accept only if the automated gate passes, the critique has no blocker, and you have looked at it at 100 percent yourself (fabric, eyes, edge, hands).
7. **Consistency check across the set**: the front, profile and turnaround heights agree within 3 to 6 percent, palettes agree (delta-E), eye size and spacing agree, the chest mark and face match. A script cannot judge identity; look at the contact sheet of all masters together.
8. **Record**: metadata JSON next to every file (written by `imagegen.py`), plus an entry in `GENERATION-PROMPTS.md`: date, model id, size, quality, references and roles, full prompt as sent, file kept, why.

## 9. Edit protocol

Short version (full text and ready prompts in `prompts/edits.md`): one change per call; restate the locks; say what to keep as well as what to change; edit from the original rather than from a chain of edits (each pass softens fibres); use masks for local fixes; keep every intermediate; verify after each edit with `art_qa.py` and a 100 percent crop comparison (`crop_compare.py`); after three edits that soften the nap or drift the colours, regenerate with a corrected base prompt instead.

## 10. Failure modes

| Symptom | Likely cause | Fix |
|---|---|---|
| Fibres look airbrushed or like velvet paint | prompt lacks material language; quality too low; max-size smoothing | add the fabric partial; quality `high`; compare safe-size render; try the other model |
| Plastic or wet sheen | "glossy" lighting words, rim light, subsurface look | flat lighting partial; edit "remove highlights"; negative already present is not enough, describe matte |
| Fibres too long and hairy | "fur", "fluffy" in the prompt | say short dense micro-suede; edit "shorten the pile" |
| Eyes larger or wilder than the brief | model loves big eyes | `eye_note`; "without enlarging them" plus the master as reference; fix by edit with the master as image 2 |
| Identity drift between images | no reference attached; lock not restated; different model | attach hero and front; restate the lock; stay on one model |
| Halo or coloured fringe after cut-out | key colour leaked into fibres; native alpha is a hard mask | `alpha_extract.py key` (unmix and despill); pick a key far from the palette; regenerate on a flat field |
| A baked fake checkerboard in the pixels | model drew "transparency" | ask for real alpha or a flat key colour; `art_qa.py` detects it |
| Floor shadow or contact shadow in the cut-out | not forbidden | add the exclusion; edit "remove every cast and contact shadow" |
| Cropped feet or tips | no margin instruction | "about 8 percent empty margin"; edit framing |
| Arms touching the body | silhouette ambiguity | "clear gap between each arm and the body"; edit |
| Turnaround views touching or different in scale | dense layout | three views, clear spacing; safe size with `n` 4 and choose; or render front, side and back separately and normalise each |
| Profile is not a true profile | models cheat with 3/4 | 03b single profile; edit "true 90 degree left profile" |
| Text or a logo appears (chest, props, background) | model adds "brand" details | text exclusion; edit that region; mask redo |
| Wrong number of props or confetti | counts ignored when not explicit | "exactly three"; edit |
| Smaller image than requested | relay or tool ignored the size | use the native API; check the metadata; do not upscale |
| Colours drift from the brief | lighting and model bias | hex values in the prompt; edit "change only the colours"; accept a small shift and tune the fabric colour in the shader later |
| Slightly different design every call | no seed control in these APIs | use references, lower variability by locking the hero, keep the best candidate |
| Safety or policy refusal on an innocuous character | over-broad filter | rephrase the description literally, use `moderation: low` if the account allows it, try the other model |

## 11. Cost, time, parallelism

- One call can take up to about two minutes at large sizes and high quality. Run independent calls in parallel (different assets, or `n` candidates in one call) within the account's rate limits; retries back off on 429 and 5xx.
- Batch plan for a whole pack: exploration 2 calls; hero 2 models x 4 candidates at the safe size, then 2 at max; front 2 to 3 attempts; turnaround 2 to 3; profile 1 to 2; vignettes 2; optional sheets 2 to 4; macros 4; edits 6 to 12. Keep a running total in the log.
- Cache: never regenerate something you already have; `imagegen.py` will not overwrite without `--force`.

## 12. API quick reference

Verified against provider docs on 2026-10-01. Always run the tool with `--dry-run` first and compare with the current docs.

`imagegen.py` was exercised against a local stub of both APIs (`mock_imagegen_server.py`), not against the live services, because no keys were available when it was written. Make the first real call a cheap smoke test (`--size 1024x1024 --quality low --n 1`, a one-line prompt) to confirm the account, the model id, the response shape and the returned size before any real spending; if the shape differs, the tool prints the response keys and you fix the one parser function it names.

**OpenAI** (`POST https://api.openai.com/v1/images/generations`, JSON; `/v1/images/edits`, multipart). Generation body fields: `model`, `prompt`, `size` (`WxH` or `auto`), `quality` (`low|medium|high`, plus `xhigh|max` on 2.5), `n`, `background` (`transparent|opaque|auto`), `output_format` (`png|webp|jpeg`), `output_compression`, `moderation` (`auto|low`). Edits add repeated `image[]` files (up to 16) and an optional `mask` (alpha marks the editable area). Response: `data[].b64_json` and `usage`. `input_fidelity` exists only for gpt-image-1.x.

```bash
curl -s https://api.openai.com/v1/images/generations -H "Authorization: Bearer $OPENAI_API_KEY" -H "Content-Type: application/json" \
  -d '{"model":"gpt-image-2.5-sunburst-2026-09-08","prompt":"...","size":"2880x2880","quality":"high","n":1,"background":"transparent","output_format":"png"}' \
  | python3 -c "import sys,json,base64; d=json.load(sys.stdin); open('out.png','wb').write(base64.b64decode(d['data'][0]['b64_json']))"
curl -s https://api.openai.com/v1/images/edits -H "Authorization: Bearer $OPENAI_API_KEY" \
  -F model=gpt-image-2.5-sunburst-2026-09-08 -F "prompt=..." -F size=2880x2880 -F quality=high -F "image[]=@hero.png" -F "image[]=@front.png"
```

**Google, Interactions API** (`POST https://generativelanguage.googleapis.com/v1beta/interactions`, header `x-goog-api-key`):

```json
{"model": "gemini-3-pro-image",
 "input": [{"type": "text", "text": "..."}, {"type": "image", "mime_type": "image/png", "data": "<base64>"}],
 "response_format": {"type": "image", "mime_type": "image/png", "aspect_ratio": "1:1", "image_size": "4K"}}
```
The SDK exposes the picture as `interaction.output_image.data` (base64).

**Google, generateContent** (older, still common): `POST .../v1beta/models/gemini-3-pro-image:generateContent` with `contents[].parts[]` (`text`, `inlineData {mimeType, data}`) and `generationConfig {responseModalities: ["TEXT","IMAGE"], imageConfig {aspectRatio, imageSize}}`; the image comes back in `candidates[0].content.parts[].inlineData.data`; parts flagged `thought: true` are interim thinking images and are skipped. `imagegen.py --api interactions|generate-content` speaks both and finds the image by searching the response, so a changed shape does not break it.

Gemini responses carry an invisible SynthID watermark; OpenAI images may carry C2PA provenance metadata (check the files you receive). Re-encoding can drop metadata; do not try to strip either.

## 13. Originality, provenance and licensing

- Describe the design in your own terms. Do not put a real mascot's, toy's or brand character's name in a prompt, and do not attach one as a reference. If a real object inspired the design, note what was taken (for example "short plush, felt appliqué face") and what was not (shape, face, palette).
- Inspiration material (screenshots of a plush agent companion in a product) is in `assets/references/muse/`: study what the character does in the interface, never attach it to a generation call.
- Review every master for accidental resemblance (the critique prompt's originality criterion, plus a reverse image search on the hero if the project is commercial). A near copy is a blocker.
- Keep the provider's terms in the project notes (who owns generated images, commercial use, required disclosures); this is the user's counsel's decision, not the agent's. State it in the handoff.
- Keep the metadata JSON and the prompts: they are the provenance record.
- Fonts used by the showcase page are SIL OFL; art is yours under the provider terms.

## 14. Hand-off to Phase 2

Done when `art/masters/` holds the untouched hero, registered front (and profile if used), turnaround, vignettes and any optional sheets, each with its metadata JSON; `art/qa.json` shows the automated gates passing for the chosen files; `GENERATION-PROMPTS.md` lists the chain for each; and the contact sheet of all masters has been looked at by a human or a fresh reviewer. Next: `references/art-analysis.md` (normalise, reference pack, measurements).
