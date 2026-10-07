# art/

`masters/` the untouched originals returned by the image models, each with its `.json` metadata (never edit; every step works on copies). `candidates/` everything you tried. `prompts/` the rendered prompt pack (`python3 scripts/tools/render_prompts.py --brief art/brief.json --all --model both --out art/prompts`). `work/` derived copies (cut-outs, 2x registered copies, QA reports). Start from the skill's `prompts/brief.example.json`.
