// Dev-only: steps the real MascotController at a fixed rate so a motion reel can be recorded frame by frame
// (see scripts/dev/reel.mjs).  Nothing here ships in the studio build.
import { MascotController, STATES } from './mascot.js';

const stage = document.querySelector('#stage');
const mascot = new MascotController(stage, { quality: 'high', reducedMotion: false });
await mascot.ready;
mascot.paused = true;                       // we drive the clock
const names = Object.keys(STATES);
const steps = document.querySelector('#steps');
names.forEach(() => steps.insertAdjacentHTML('beforeend', '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 5l14 14M19 5L5 19" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"/></svg>'));

// how long each state is shown: the ones with a story (sitting down and typing; waiting for a decision after the seat is put
// away) get longer than a wave or a blink
const SECONDS = { idle: 2.4, greeting: 2.8, listening: 2.4, thinking: 2.8, working: 5.6, approval: 4.4, success: 3.0, error: 2.8, speaking: 2.8, resting: 2.8 };
window.reel = {
  states: names,
  /** Seconds shown for state `index`. */
  seconds: (index) => SECONDS[names[index]] ?? 2.4,
  /** Start a state (labels update immediately). */
  begin(index) {
    const name = names[index], s = STATES[name];
    mascot.setState(name);
    document.querySelector('#title').textContent = s.title;
    document.querySelector('#status').textContent = s.status;
    [...steps.children].forEach((d, i) => d.classList.toggle('on', i === index));
  },
  /** Advance the simulation by dt and render; resolves after the frame has been presented. */
  async step(dt) {
    mascot.advance(dt);
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  },
};
await Promise.all([document.fonts.load('600 34px Fraunces'), document.fonts.load('500 20px "Alegreya Sans"')]);       // (the frames must not be recorded in a fallback face)
window.__reelReady = true;
