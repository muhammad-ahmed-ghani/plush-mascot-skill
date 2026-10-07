# Agent operations: running this build with several agents

Purpose: how to split the work across agents without them breaking each other's runs, how to merge their work, how to brief builders and auditors, and how to keep long jobs and measurements honest. Everything here was learned the hard way while a mascot was driven from "fake and plastic" to validated; the failure each rule prevents is named.

Read it before delegating anything, and before the first time you run a dev server, a tuner or a long bake.

## Contents

1. When to use more than one agent
2. Roles
3. Isolation: working copies, a pristine base, ports
4. Ownership rules
5. Merging back (three-way)
6. Briefing a builder
7. Briefing an auditor
8. Deterministic capture harness
9. Long jobs, servers and waiting
10. Measurement hygiene
11. Reporting honestly
12. Anti-patterns
13. Project notes for the next session

## 1. When to use more than one agent

One agent is enough for phases 0 to 5 (a line of dependent steps that take minutes to run once the art exists). Parallelise when work is independent and large: after the draft bake the **fabric**, **face** and **rig and props** lanes do not touch each other's files; the **page**, the **docs** and the **QA audits** are separate again. Image generation calls are also parallel (different assets, several candidates). Do not parallelise two agents onto the same file, the same tuner, or the same asset.

The cost of delegating is briefing and merging; it pays off when a lane is an hour or more of focused work or needs fresh eyes.

## 2. Roles

| Role | Writes | Sees | Notes |
|---|---|---|---|
| Lead | the plan, the merged tree, the final reports | everything | owns decisions, runs final gates, talks to the user |
| Builder | only paths it owns, in its own copy | its copy, the art, the real project read-only | returns a report with what it ran |
| Researcher | notes only | sources, docs, logs | for art-model facts, reference studies, transcript mining |
| Auditor | scratch files only | the art and the running page, nothing else | adversarial, read-only, fresh eyes |
| Doc writer | the documents it owns | the code (read-only) | verifies each cited path and flag |

## 3. Isolation

The failures this prevents: a builder's half-finished edit reloading another agent's page through Vite's hot reload ("Execution context was destroyed" in a running tuner), two agents regenerating the same derived asset, a dev server fighting for a port, a broken `public/` copy serving stale files.

For each builder:

```bash
WS=<scratch root>                      # any directory outside the project
rsync -a --exclude node_modules --exclude dist --exclude .pipeline <project>/ $WS/work-<lane>/
ln -sfn <project>/node_modules $WS/work-<lane>/node_modules      # no second npm install
rsync -a --exclude node_modules --exclude dist <project>/ $WS/base-<lane>/   # pristine snapshot for the merge; nobody edits it
cd $WS/work-<lane> && node scripts/sync-public.mjs && (npx vite --host 127.0.0.1 --port <lane port> --strictPort > $WS/vite-<lane>.log 2>&1 &)
export MASCOT_ORIGIN=http://127.0.0.1:<lane port>     # every dev script reads the origin from here
```

- One port per agent, written in its brief, `--strictPort` so a clash fails loudly. Keep the lead's own servers (conventionally 4173 and 4174) off-limits.
- The builder kills its server when it finishes (`lsof -ti tcp:<port> | xargs kill`).
- Derived files (meshes, nap tiles, `public/assets`) live in the builder's copy; the lead regenerates them after the merge instead of merging binaries.
- A builder that needs the GPU for fidelity numbers can have it; frame-rate numbers measured while others render are void (section 10).

## 4. Ownership rules

List, in every brief, the files the agent owns and the files it must not touch. Shared hot files (the pose module, the controller, the fabric shader) are where merges hurt: give each such file one owner, and when two lanes must edit it, ask both for small, localised hunks and no reformatting. Dev-harness files (lab pages, tuners) belong to whoever maintains the scripts. A lane that discovers it needs a change in someone else's file reports it; it does not make it.

## 5. Merging back

`git merge-file` does a three-way merge of single files without needing a repository: `git merge-file -p <ours> <base> <theirs>` prints the merged text and exits with the number of conflicts (0 means clean).

```bash
cd $WS/work-<lane>
diff -rq $WS/base-<lane> . --exclude node_modules --exclude dist --exclude .pipeline --exclude public | awk '/^Files/ {print $4}' > /tmp/changed.txt   # files the builder changed
while read f; do
  if cmp -s <project>/$f $WS/base-<lane>/$f; then cp $f <project>/$f                 # lead did not touch it: take the builder's
  else git merge-file -p <project>/$f $WS/base-<lane>/$f $f > /tmp/merged; n=$?           # both changed: three-way merge, n = number of conflicts
       cp /tmp/merged <project>/$f; [ $n -eq 0 ] && echo "merged $f" || echo "CONFLICT($n) $f"   # conflict markers are left in the file: resolve by hand
  fi
done < /tmp/changed.txt
```

New files the builder added show up in `diff -rq` as "Only in ..." lines; copy them by hand. After merging: `node --check` every JS file, `python3 -m py_compile` every Python file, regenerate derived assets, rerun the lane's gate in the merged tree. A merge that "applied cleanly" is not evidence that it works.

## 6. Briefing a builder

A builder starts with nothing. The brief that worked had these parts, in this order:

1. **Who and why**: the goal in the user's terms, including the bar ("the client audits by zooming into crops next to the reference art") and, verbatim, what the user complained about.
2. **What you own**: files and functions; what you must not touch; who owns the rest.
3. **Where to work**: the copy, the base, the port, the origin variable, how to start and stop the server, never to write in the real project.
4. **How to run and look**: the exact commands for stills, filmstrips and metrics; to view PNGs with the image-viewing tool; upscaling with nearest neighbour; the reference art paths with crop coordinates of the relevant region.
5. **The reference**: what in the art to study and what to notice (proportions, materials, how a prop attaches).
6. **Acceptance**: the gates and thresholds, and "checked frame by frame", not "looks fine".
7. **Report format**: files changed, commands run and results, deviations, open problems, interface changes. Short; details go in files.

Add the traps relevant to the lane (copy from `references/troubleshooting.md`): for a shader lane, derivatives and `onBeforeCompile`; for a pose lane, clearance and the `lead` mechanism; for a tuner lane, never edit `src/` while it runs and start from live values.

## 7. Briefing an auditor

An auditor's value is that it has not seen the work. Its brief:

- Read-only: write scratch files in one named directory; never start or stop servers, never run anything that modifies the project (bake, nap, tuners, `npm`).
- Others may be editing while it works; if a render differs between two runs, say so and continue.
- Why it exists: the user's words, verbatim, about what they saw; "find what is still wrong before they do".
- How to render deterministically (section 8) at both display densities, several yaws, pitches and rolls; to judge pixels at 4 to 8x nearest-neighbour crops of native size, never a downscaled preview.
- What to look for, by region: seam edges, feature edges, silhouette, cords, teeth or zig-zags when turned, white or coloured specks, blotchy or smeared fibres, flat colour where the art has variation, anything that moves wrongly between frames.
- What to return: a ranked defect list, each with the state and camera that shows it, a crop, the suspected layer (geometry, texture, shader, pose), and severity. No praise, no fixes applied.

Triage the list yourself: blockers and majors go back to builders with the crop attached; minors are listed as known differences.

## 8. Deterministic capture harness

Screenshots of a live loop are unrepeatable. The controller exposes a deterministic clock: `paused`, `advance(dt, { render: false })`, and `freeze(state, seconds, { time, override, look })`.

- Pose exactly: `mascot.freeze('idle', 1, { time: 0, override: { 'root.yaw': 0.5 }, look: [0, 0] })`, wait 300 to 400 ms for texture streaming, then capture.
- Step a transition: `mascot.paused = true; mascot.setState('working'); for (...) mascot.advance(1/60, { render: false })` and render only the frames you keep. This is how the 60 fps reel and the filmstrips are produced; film at 10 to 20 frames a second of animation for review, at 60 for the reel.
- For stills of the figure alone add the capture class to the page (`html.capture` hides everything but the stage) and neutralise the story camera (the scroll page rewrites the view every frame): `mascot.__setView = mascot.setView.bind(mascot); mascot.setView = () => {}; mascot.__setView({ x: 0, y: 0, zoom: 1, yaw: 0 }, { immediate: true })`.
- A full-page screenshot leaves the WebGL stage blank unless the viewport is as tall as the page. `page.screenshot({ clip })` wants document coordinates: add the scroll offset after `scrollIntoView`.
- Do not sample colours while a CSS opacity transition runs; wait for it to finish.
- Compare against the art at the same density: `scripts/dev/scaled-ref.py` makes 350, 246 and 123 px-per-unit references; `scripts/tools/crop_compare.py` makes side-by-side crops and difference maps.
- Contact sheets of filmstrips (`scripts/tools/contact_sheet.py`) are how an agent reviews motion it cannot watch.

## 9. Long jobs, servers and waiting

- Run anything over a minute in the background with a log file, and poll with a bounded loop; a foreground `sleep` is often blocked and a silent wait looks like a hang. The pipeline runner writes `.pipeline/logs/<stage>.log` and `.pipeline/state.json`; it is resumable and skips fresh stages.
- Start dev servers explicitly with a port; stop them when done. Check what is listening (`lsof -i :<port>`) before assuming.
- The reel takes minutes (deterministic stepping of about 1,900 frames); tuners take many minutes and are sensitive to reloads; image calls take up to two minutes. Schedule them so that nothing else needs the GPU at the same time.
- Use timeouts on your own waits; if a job exceeds twice its expected time, look at its log before waiting longer.

## 10. Measurement hygiene

- **Frame rate**: a browser on low battery (Chrome Energy Saver below 20 percent, macOS Low Power Mode) caps every page at 30 fps, `about:blank` included. Measure a blank page first, judge against it, and plug in for real numbers. Do not record fps while other agents render.
- **GPU cost**: read pixels after the render to force completion (`gl.finish` does not block in Chrome).
- **Fidelity**: measure at the art's density and at 2x and 1x display density; front views hide slant-angle defects, so also turn the head (yaw 0.5, 0.9, 1.5), pitch and roll.
- **Stale assets**: after regenerating anything served from `public/`, run `node scripts/sync-public.mjs`; the dev server serves `public/` before the project root.
- **Tuner results**: a tuner optimises a number, not the picture. Always look at the crops before accepting.

## 11. Reporting honestly

State what you ran and what it printed; say "not tested" for what you did not test (other GPUs, other browsers, the host application); list residual differences from the art ordered by visibility; never describe a target as met because a proxy metric improved; if a gate is failing, say which and by how much. Do not claim user approval you were not given; decisions listed in `workflow.md` ("Decisions that belong to the user") wait for the user.

## 12. Anti-patterns

| Anti-pattern | What happened or would happen |
|---|---|
| Editing `src/` while a tuner runs | Vite reloads the lab page, the run dies mid-search |
| Two agents on one tree | hot-reload crashes, interleaved half-edits |
| Merging without a base | silent loss of one side's work |
| Trusting a "done" report | the merged tree fails a gate nobody ran |
| Tuning to the metric | stats pass, crops look wrong |
| Auditing only front-on | seam teeth and specks appear only when the head turns |
| Upscaling art or swatches | invented fibres get baked into the nap |
| Regenerating the hero after the set is derived | every derived image loses identity |
| Leaving the example art in place | the example mascot ships as the user's character |
| Measuring fps on battery or while others render | wrong conclusions about performance |
| Stale `public/` | "my change does nothing" |
| Unbounded loops of edits on an image | softened fibres, colour drift |
| Burning API budget without a cap | no record, no control (`--yes`, `--max-usd`) |

## 13. Project notes for the next session

Keep a short notes file in the project (or the agent's memory) with: where things live, how to rebuild and verify, the traps met in this project, the owner's fidelity bar and their specific complaints, and the open residual differences. The next session starts from that instead of re-deriving it. The traps list in `references/troubleshooting.md` is the generic version; yours adds the project's own.
