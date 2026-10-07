# The showcase page

Purpose: the scroll-story page that presents the mascot and doubles as the runtime's proving ground. Read it in phase 10 and when re-theming the page.

## 1. Stage contract
`#stage` is a fixed, full-window, pointer-transparent, `aria-hidden` container holding the only canvas and the poster that fades out when the model is ready. The page writes the camera only with `mascot.setView({ x, y, zoom, yaw })` from the scroll position (`src/page/story.js`); framings are worked out from the window size (one for wide screens with the words beside the mascot, one for tall screens with the mascot on top and the words on a sheet under it).

## 2. Scenes and states
Eight scenes with fixed ids (the gates depend on them): `#hello` (greeting), `#motion` (listening, pushed in), `#thinking`, `#working` (dark room, camera pulled back for the laptop), `#approval` (the card, two real buttons: Approve and Not yet), `#done` (success), `#closer` (face, chest, whole figure, the mascot turns round, prints and swatches), `#goodnight` (resting, the big app icon). Rules in `src/app.js`: a scene's state is requested after it has been active for 380 ms; a repeat request is dropped; `working` is never left sooner than 1.6 s; greeting and success return to the scene's resting state `lead + duration` seconds later; people's own choices (workbench, buttons, poking) apply at once; approval never happens by a timer.

## 3. Copy and look
Every word is in `src/page/copy.js` (tokens `{name}`, `{product}`, `{tagline}`); `index.html` shows most of it through `{{copy...}}` tokens filled by `vite.config.js`. Voice: the mascot speaks in the first person, warmly and plainly. The owner rejected a template look: no arrows, no spaced-caps eyebrows, no numbered sections, no dark downloads panel, no stock fonts. What replaced it: cut-felt pieces, running stitches, stitched frames, a self-hosted serif / sans / handwriting pairing (OFL, `assets/fonts`, rebuilt by `scripts/dev/build-fonts.py`), margin notes, a generated felt texture (`make-page-textures.py`). `validate.mjs` enforces: sentence case; no arrows, em dashes, double hyphens, numbered eyebrows or spaced capitals; none of the words seamless, elevate, unlock, "by design", "by nature", "not just".

## 4. Workbench, accessibility, fallbacks
The workbench drawer has the ten states (`#states [data-state]`), reduced-motion and turntable switches, PNG snapshot, GLB export and an activity log. It starts closed and `inert`, opens with focus inside, closes with Escape. Skip link first; dashed focus rings; 44 px touch targets; contrast checked at every scroll stop by `contrast.mjs` (4.5:1, 3:1 large, 2.2:1 while half faded); reduced motion (OS setting or switch) gives a calm static layout; no WebGL shows the poster and a note; a lost context shows the poster until restored. The page's own JavaScript only writes CSS variables, transforms and opacity (one rAF loop).

## 5. Re-theme for a new mascot
Rewrite `src/page/copy.js` and the palette (`mascot.config.json` `palette`, `page.colors`), swap the app icon, emblem and poster, adjust the swatches in `src/page/felt.js`, keep ids, hooks (`#stage`, `#states`, `#status-label`, `#reduce`, `#turntable`, `#export-png`, `#export-glb`, `#activity`), the stage contract and the state rules. Then `node scripts/dev/validate.mjs`, `contrast.mjs` at 1440x900, 1024x768, 1920x1080, 820x1180 and 390x844, and look at it on a phone.
