# Runtime and performance

Purpose: how the controller keeps 60 fps and stays robust, and how to measure honestly. Read it in phase 9 and when frame rate, first-use hitches or the poster alignment are in question.

## 1. The controller
```js
import { MascotController } from './src/mascot.js';
const mascot = new MascotController(container, { state: 'idle', pointer: 'window', quality: 'high' /* optional */ });
mascot.setState('working');           // then read mascot.lead (seconds before the new state's own motion starts)
mascot.setView({ x: 0.2, y: 0, zoom: 1.2, yaw: 0 }, { immediate: false });   // framing for scroll pages
```
Events: `statechange` (`detail.state`), `quality` (`{level, avgMs, pixelRatio, shells}`), `resize`, `contextlost`, `contextrestored`. Methods: `setState`, `poke`, `setReducedMotion`, `setVoiceLevel`, `figureBox()`, `snapshot()` (transparent PNG data URL), `exportGLB()`, `freeze`, `advance`, `telemetry`, `dispose`. The container needs a measurable size; the renderer caps the pixel ratio at 2, sizes with a ResizeObserver, skips frames offscreen or when the page is hidden and frees everything on `dispose`.

## 2. Tiers and the governor
| Tier | Mesh | Fuzz layers | Shadow map | Pixel ratio cap |
|---|---|---|---|---|
| high | final (171k triangles) | 4 | 2048 | 2 |
| medium | lite (83k) | 2 | 1024 | 1.75 |
| low | lite | 0 | 1024 | 1.25 |
The tier is chosen from the device when not given. A governor times the frames it draws in windows of 0.6 s; when they miss the pace by more than about 12 percent twice running (or by half again once) it steps down, least visible first: half the fuzz layers, pixel ratio 1.5, no fuzz layers, 1.25, 1. It only steps down and emits `quality`. It times frames to completion (a one-pixel `readPixels` after the render, because `gl.finish` does not block in Chrome) so it does not give up quality for a browser-imposed cap. Example cost on an Apple silicon GPU: about 10 ms at 1440 x 900 at 2x with four fuzz layers (about three quarters of it), 6 ms with two, 2.5 ms with none.

## 3. 60 fps pacing
The controller draws at most `fps` frames a second (default 60; 0 = every display frame) on evenly spaced display frames: a whole-number divisor of the refresh rate, so a 120 Hz screen draws every second frame, 144 Hz every second (72 fps), 240 Hz every fourth, 75 and 90 Hz every frame; half a frame of slack keeps 60 Hz from skipping. Why a divisor: uneven frame spacing reads as judder even at a high average.

## 4. First-use hitches
Every shader program, texture and buffer, props included, is prepared at load; entering a state for the first time must not compile anything. Test it: `motion-check.mjs` measures the rate from the first frame of working, approval, success and idle and fails on a long frame.

## 5. Browser throttling (measure first)
Chrome's Energy Saver (battery below 20 percent) and macOS Low Power Mode hold every page, `about:blank` included, to 30 fps; no flag lifts it without removing the display's pacing. `motion-check.mjs` measures a blank page first and judges the page against it. Do not record frame rates while other processes render; plug in.

## 6. Robustness
Context loss: keep the extension object from the first `getExtension('WEBGL_lose_context')` call (the second returns null) for both `loseContext()` and `restoreContext()`; the page shows the poster at the figure's size and the model returns on restore. No WebGL: the page shows the poster (moving with the story), an honest note and disables exports. Reduced motion: no autonomous motion.

## 7. Camera and stage contract
Level camera on a long lens (8 degree field of view); `FRAMING` y 1.75 (world height at the stage centre), fitting 4.4 units of height or 3.5 of width. `figureBox()` returns the rectangle where the neutral art would sit on the stage; the page places its poster from it so the fade from art to live model does not jump. `setView` eases framing (shift as a fraction of the container, zoom about its centre, extra body yaw). `node scripts/dev/view-check.mjs` verifies the poster against the live figure within 6 px for four views.

## 8. Budget and bundle
About 0.9 million triangles a frame at the high tier including shells and the shadow pass. Example bundle: main chunk 725 kB (209 kB gzip: three.js, controller, page), GLB exporter a lazy 38 kB chunk, fonts about 148 kB, CSS 28 kB. Do not load mesh, tiles and GLB repeatedly for a tiny status chip: use the SVG or alpha art there (alpha art from about 64 px, the animated model from about 120 px and larger; starting points, not measured limits). Profile on your supported devices before shipping; only one machine was measured.
