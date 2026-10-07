// The page: boots the mascot on the fixed stage, hands the scroll to the story (src/page/story.js) and keeps the state rules in one place.
//
//   * The story asks for a state when a scene has been on stage a moment; asking for the state the mascot is already in does nothing (a
//     repeat would restart it), and leaving 'working' is never rushed (it needs ~1.5 s to sit and ~1.1 s to stand, see mascot.lead).
//   * People's own choices (the workbench, the two decision buttons, poking the mascot) apply at once.
//   * greeting and success play once and return to the scene's resting state, timed from mascot.lead + the state's duration.
//
// Every word it prints comes from src/page/copy.js (say() fills in the name and product from mascot.config.json).

import { MascotController, STATES } from './mascot.js';
import { createStory } from './page/story.js';
import { createWorkbench } from './page/workbench.js';
import { splitWords, addStitches } from './page/fx.js';
import { applyPalette } from './page/palette.js';
import { COPY, say } from './page/words.js';

const $ = (s, r = document) => r.querySelector(s);
const root = document.documentElement;
const stage = $('#stage');
const reducedQuery = matchMedia('(prefers-reduced-motion: reduce)');
const stackedQuery = matchMedia('(max-aspect-ratio: 23/20), (max-width: 719px)');
const WORKING_MIN_MS = 1600;                // do not leave 'working' sooner than this after it began: sitting down takes that long to read

applyPalette();
document.querySelectorAll('.display').forEach(splitWords);
addStitches();

let mascot = null, story = null, workbench = null;
let lastSource = 'story', current = 'idle', currentSince = performance.now(), holdUntil = 0, pending = null, pendingTimer = 0, returnTimer = 0, oneShot = 0, skipNext = null;

// ---- state rules -------------------------------------------------------------------------------------------------------------------
function applyState(state, source = 'story') {
  clearTimeout(returnTimer);
  lastSource = source;
  if (source !== 'story') { pending = null; clearTimeout(pendingTimer); }
  const from = current;
  if (mascot) mascot.setState(state); else stateChanged(state);
  lastSource = 'external';                                          // (whoever calls mascot.setState directly, a dev script say, is not the workbench)
  const lead = mascot?.lead ?? 0;                                    // seconds before the new state's own motion starts (the dismount from 'working')
  if (from === 'working' && state !== 'working') holdUntil = performance.now() + lead * 1000;
  if (state === 'greeting' || state === 'success') {
    const id = ++oneShot;
    returnTimer = setTimeout(() => { if (id === oneShot && current === state) applyState(story?.active.base ?? 'idle', 'settle'); }, (lead + STATES[state].duration) * 1000 + 500);
  }
}
function stateChanged(state) {
  current = state;
  currentSince = performance.now();
  workbench?.syncState(state);
  workbench?.log(lastSource === 'workbench' ? say(COPY.log.fromWorkbench, { status: STATES[state].status }) : STATES[state].status);
}
function requestState(state) {
  pending = state;
  clearTimeout(pendingTimer);
  const now = performance.now();
  let wait = Math.max(0, holdUntil - now);
  if (current === 'working') wait = Math.max(wait, currentSince + WORKING_MIN_MS - now);
  pendingTimer = setTimeout(flush, wait);
}
function flush() {
  const state = pending;
  pending = null;
  if (!state || story?.calm) return;
  if (mascot && !mascot.loaded) return;                                 // (nothing to perform yet: story.begin() asks again when the model is ready)
  if (skipNext === state) { skipNext = null; return; }            // (the person already made this happen with a button)
  if (state === current) return;
  applyState(state, 'story');
}

// ---- the mascot -----------------------------------------------------------------------------------------------------------------------
const hasWebGL = () => { try { const c = document.createElement('canvas'); return !!(c.getContext('webgl2') || c.getContext('webgl')); } catch { return false; } };
const poster = $('#poster');
function syncPoster() {
  if (!poster || !mascot) return;
  const b = story.figure();
  Object.assign(poster.style, { left: `${b.left}px`, top: `${b.top}px`, width: `${b.size}px`, height: `${b.size}px`, maxWidth: 'none', transform: 'none' });
}
function showFallback(error) {
  console.warn('Mascot 3D fallback:', error?.message ?? error);
  mascot = null;
  root.classList.add('no3d');
  $('#fallback').hidden = false;
  $('#fallback-note').hidden = false;
  poster?.remove();
  $('#stage canvas')?.remove();
  stage.classList.remove('is-loading');
  root.classList.remove('loading');
  workbench?.disableExports();
  story?.markDirty();
}

workbench = createWorkbench({
  STATES,
  getMascot: () => mascot,
  getState: () => current,
  getMascotSide: () => story?.view?.x ?? 0,
  onPick: (state) => { applyState(state, 'workbench'); },
  onCalm: (on) => setCalm(on, true),
});
const { log, toast } = workbench;

try {
  if (!hasWebGL()) throw new Error('WebGL is not available');
  mascot = new MascotController(stage, { pointer: 'window' });
  window.mascot = mascot;                                              // (the dev scripts in scripts/dev drive and inspect the page through these two)
  window.MASCOT_STATES = STATES;
} catch (error) {
  mascot = null;
  queueMicrotask(() => showFallback(error));
}

story = createStory({
  mascot,
  stage,
  stackedQuery,
  requestState,
});

if (mascot) {
  mascot.addEventListener('statechange', (e) => stateChanged(e.detail.state));
  mascot.addEventListener('resize', syncPoster);
  mascot.addEventListener('quality', () => log(say(COPY.log.slow)));
  mascot.addEventListener('contextlost', () => { syncPoster(); stage.classList.add('is-loading'); log(say(COPY.log.contextLost)); });
  mascot.addEventListener('contextrestored', () => { stage.classList.remove('is-loading'); log(say(COPY.log.contextBack)); });
}
story.firstView();
syncPoster();

// reduced motion: the OS setting sets it up front, the workbench switch changes it any time
function setCalm(on, fromUser = false) {
  story.setCalm(on);
  mascot?.setReducedMotion(on);
  workbench.setReduce(on);
  if (fromUser) log(say(on ? COPY.log.calmOn : COPY.log.calmOff));
  if (on) { if (current !== 'idle') applyState('idle', 'calm'); }
  else { story.markDirty(); story.begin(); }
  if (mascot) syncPoster();
}
if (reducedQuery.matches) setCalm(true);
reducedQuery.addEventListener('change', (e) => setCalm(e.matches));

if (mascot) {
  mascot.ready.then(() => {
    syncPoster();
    stage.classList.remove('is-loading');
    root.classList.remove('loading');
    log(say(COPY.log.ready, { quality: mascot.quality }));
    if (!story.calm) story.begin();
    else { const v = story.view; mascot.setView({ x: v.x, y: v.y, zoom: v.zoom, yaw: 0 }, { immediate: true }); }
  }).catch(showFallback);
} else {
  stage.classList.remove('is-loading');
  root.classList.remove('loading');
}

// ---- the decision (pretend): Approve carries the story on to Done, Not yet puts the card back on the desk ------------------------------
const result = $('#decision-result');
$('#approve').addEventListener('click', () => {
  result.textContent = say(COPY.decision.approved);
  log(say(COPY.decision.approvedLog));
  skipNext = 'success';
  setTimeout(() => { skipNext = null; }, 7000);
  applyState('success', 'user');
  story.goTo('done', { smooth: true });
  setTimeout(() => $('#done').focus({ preventScroll: true }), story.calm ? 0 : 900);
});
$('#not-yet').addEventListener('click', () => {
  applyState('idle', 'user');
  result.textContent = `${say(COPY.decision.notYet)} `;
  const again = document.createElement('button');
  again.type = 'button'; again.className = 'btn btn--text'; again.textContent = say(COPY.decision.askAgain);
  again.addEventListener('click', () => { result.textContent = ''; log(say(COPY.decision.askAgainLog)); applyState('approval', 'user'); $('#approve').focus({ preventScroll: true }); });
  result.append(again);
  log(say(COPY.decision.notYetLog));
});

// ---- poking the mascot: a click or tap on it gets a little reaction (and never interrupts the card or the laptop) ----------------------------
const poke = $('#poke');
let pokeTimer = 0, pokeN = 0;
function overMascot(x, y) {
  const b = mascot?.loaded ? story.figure() : null;
  if (!b) return false;
  return x > b.left + b.size * 0.22 && x < b.left + b.size * 0.78 && y > b.top + b.size * 0.04 && y < b.top + b.size * 0.97;
}
function bubble(text, x, y) {
  poke.textContent = text;
  poke.style.left = `${x}px`; poke.style.top = `${y}px`;
  poke.classList.remove('is-show'); void poke.offsetWidth; poke.classList.add('is-show');
  clearTimeout(pokeTimer);
  pokeTimer = setTimeout(() => poke.classList.remove('is-show'), 1800);
}
addEventListener('click', (e) => {
  if (e.button !== 0 || !mascot?.loaded || e.target.closest('a, button, input, label, dialog, .drawer, .scene__text, .print')) return;
  if (!overMascot(e.clientX, e.clientY)) return;
  const scene = story.active.id, canPoke = typeof mascot.poke === 'function';           // (mascot.poke: a short reaction on top of whatever it is doing)
  if (current === 'working' || scene === 'working') { bubble(say(COPY.poke.working), e.clientX, e.clientY); if (canPoke) mascot.poke(); return; }
  if (current === 'approval' || scene === 'approval') { bubble(say(COPY.poke.approval), e.clientX, e.clientY); if (canPoke) mascot.poke(); return; }
  if (current === 'greeting' || current === 'success') return;
  const resting = current === 'resting';
  bubble(say(resting ? COPY.poke.resting : COPY.poke.hi[pokeN++ % COPY.poke.hi.length]), e.clientX, e.clientY);
  log(say(COPY.poke.log));
  if (canPoke && !resting) mascot.poke(); else applyState('greeting', 'poke');           // (waking a napper, or an older controller, gets the wave)
});
let hoverRaf = 0;
addEventListener('pointermove', (e) => {
  lastMove = performance.now();
  if (hoverRaf) return;
  hoverRaf = requestAnimationFrame(() => { hoverRaf = 0; root.classList.toggle('over-mascot', overMascot(e.clientX, e.clientY) && !e.target.closest?.('a, button, input, label, .drawer, .scene__text, .print')); });
}, { passive: true });

// the hint: if nobody touches the pointer at the top of the page, the mascot glances down the page (a nudge to scroll, no arrow needed)
let lastMove = performance.now(), glancing = false;
setInterval(() => {
  if (!mascot?.loaded || story.calm) return;
  const idle = performance.now() - lastMove > 6500 && scrollY < 40 && (current === 'idle' || current === 'greeting');
  if (idle && !glancing) { glancing = true; mascot.look.x = 0; mascot.look.y = -0.9; }
  else if (!idle && glancing && (scrollY >= 40 || performance.now() - lastMove < 500)) { glancing = false; if (scrollY >= 40) mascot.look.x = mascot.look.y = 0; }
}, 400);

// ---- the rest ------------------------------------------------------------------------------------------------------------------------
addEventListener('pagehide', (e) => { if (!e.persisted) { clearTimeout(returnTimer); clearTimeout(pendingTimer); mascot?.dispose(); } });
log(say(COPY.log.opened));
