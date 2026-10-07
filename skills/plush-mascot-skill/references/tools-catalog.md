# Tools catalog

All Python tools live in `template/scripts/tools/` (in a project: `scripts/tools/`), need only numpy, Pillow and OpenCV, and have `--help`. `python3 scripts/tools/selftest.py` tests them (sizes, dry runs, the image tool against a local stub, art QA on the example and damaged copies, registration). Pipeline and gate scripts are described in the template's `scripts/README.md`.

| Tool | Purpose and examples |
|---|---|
| `imagegen.py` | `sizes --aspect 1:1 [--tier safe\|max]`, `sizes --validate 2880x2880`, `estimate --size 2880x2880 --quality high --n 2`, `models`, `generate` / `edit` with `--provider openai\|gemini\|manual`, `--model sunburst\|flare\|gpt-image-2\|nano-banana-pro\|nano-banana-2`, `--prompt-file`, `--out PREFIX`, `--size WxH` (openai) or `--aspect A --image-size 4K` (gemini, `--api interactions\|generate-content`), `--ref FILE --ref-role "image 1: identity master"`, `--background transparent --format png`, `--dry-run`, `--yes`, `--max-usd X --price-per-mtok P`, `--force`. Writes `<file>.json` with prompt, model, sizes, usage. Keys only from `OPENAI_API_KEY`, `GEMINI_API_KEY`, `GOOGLE_API_KEY`. Tested against a local stub only |
| `render_prompts.py` | `--brief art/brief.json --all --model both --out art/prompts` renders the skill's `prompts/*.md` (partials, per-model blocks, defaults); `--template FILE` for one; errors on unresolved variables |
| `art_qa.py` | `art_qa.py FILE_OR_DIR [--kind auto\|transparent\|hero\|turnaround\|use-cases\|macro] [--palette mascot.config.json] [--report out.json] [--strict]`; checks and thresholds in `references/art-analysis.md` section 6; exit 1 on fail |
| `alpha_extract.py` | `key IN --out OUT [--bg #hex]` (background modelled from the border, unmixing and despill, preview sheet), `flood`, `difference` (two aligned renders), `refine` (halo removal), `verify FILE` (halo score on light and dark) |
| `normalize_art.py` | `--in master.png --out assets/mascot-transparent.png [--hires-out F] [--write-config]` registers a cut-out on the frame; `--turnaround --in sheet.png --out DIR` splits and registers the views and writes `measurements.json` |
| `contact_sheet.py` | `a.png b.png ... --out sheet.jpg [--cols 4 --cell 400 --labels]` or `--video reel.mp4 --n 24` |
| `crop_compare.py` | `art.png live.png --box x,y,w,h` or `--box-units x0,x1,y0,y1` `--zoom 6 --diff --out cmp.png`; prints mean error, luminance and SSIM and writes JSON; the fidelity-audit tool |
| `mock_imagegen_server.py` | local stub of the OpenAI and Gemini image endpoints, for tests |

Skill-level scripts (`scripts/` of the skill): `doctor.mjs` (environment check, key names only), `scaffold.mjs` (create a project: `node scripts/scaffold.mjs ./pip --name Pip --slug pip --product "Acme" --install --bootstrap`; `--strip-example` removes the example art), `smoke.sh` (scaffold, bootstrap, build, headless load), `lint-skill.mjs` (checks this skill's links and paths).

Project scripts you will use most: `node scripts/pipeline.mjs list|status|run`, `node scripts/dev/smoke.mjs`, and the gates in `references/validation-gates.md`.
