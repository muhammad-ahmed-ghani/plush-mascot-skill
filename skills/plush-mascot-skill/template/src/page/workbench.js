// The workbench: a drawer for people who want to poke at the mascot (all ten states, reduced motion, the turntable, exports), the activity
// log that records every state change, and the small toast the exports use.  Its words are in src/page/copy.js (the states' own labels
// and lines in src/mascot-states.js); exported files are named after mascot.config.json character.slug.

import config from '../config.js';
import { addStitches } from './fx.js';
import { COPY, say } from './words.js';

const SLUG = config.character.slug;

const $ = (s, r = document) => r.querySelector(s);

export function createWorkbench({ STATES, getMascot, getState, getMascotSide, onPick, onCalm }) {
  const drawer = $('#workbench'), toggle = $('#workbench-toggle'), list = $('#states');
  const history = [];
  let toastTimer = 0;

  // ---- activity log ----------------------------------------------------------------------------------------------------------------
  function renderHistory() {
    $('#activity-list').replaceChildren(...history.map((h) => {
      const li = document.createElement('li'), time = document.createElement('time'), text = document.createElement('span');
      time.textContent = h.time; text.textContent = h.text;
      li.append(time, text);
      return li;
    }));
  }
  function log(text) {
    history.unshift({ time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }), text });
    history.splice(60);
    if ($('#activity').open) renderHistory();
  }
  function openActivity() { renderHistory(); $('#activity').showModal(); }
  $('#status-pill').addEventListener('click', openActivity);
  $('#open-activity').addEventListener('click', () => { closeDrawer(false); openActivity(); });
  $('#close-activity').addEventListener('click', () => $('#activity').close());
  $('#activity').addEventListener('click', (e) => {
    if (e.target !== $('#activity')) return;
    const r = e.target.getBoundingClientRect();
    if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) e.target.close();
  });

  // ---- toast -----------------------------------------------------------------------------------------------------------------------
  function toast(message) {
    const el = $('#toast');
    el.textContent = message;
    el.classList.add('visible');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('visible'), 3500);
  }

  // ---- the ten states --------------------------------------------------------------------------------------------------------------
  for (const [state, s] of Object.entries(STATES)) {
    const b = document.createElement('button');
    b.type = 'button';
    b.dataset.state = state;
    b.setAttribute('aria-pressed', state === 'idle' ? 'true' : 'false');
    b.innerHTML = '<svg class="sx" aria-hidden="true"><use href="#x-stitch"/></svg>';
    const label = document.createElement('span');
    label.textContent = s.label;
    b.append(label);
    b.addEventListener('click', () => onPick(state));
    list.append(b);
  }
  addStitches(drawer);

  function syncState(state) {
    const s = STATES[state];
    document.querySelectorAll('#states [data-state]').forEach((b) => b.setAttribute('aria-pressed', b.dataset.state === state ? 'true' : 'false'));
    $('#state-title').textContent = s.title;
    $('#state-description').textContent = s.description;
    $('#status-label').textContent = s.status;
    $('#status-pill').setAttribute('aria-label', `${s.status}. ${say(COPY.bar.openLog)}`);
  }

  // ---- the drawer ------------------------------------------------------------------------------------------------------------------
  function openDrawer() {
    drawer.removeAttribute('inert');
    drawer.classList.toggle('is-left', getMascotSide() > 0.05);            // (the mascot on the right: the drawer takes the left)
    drawer.classList.add('is-open');
    toggle.setAttribute('aria-expanded', 'true');
    requestAnimationFrame(() => $('#wb-title').closest('.drawer__head').querySelector('button').focus({ preventScroll: true }));
  }
  function closeDrawer(returnFocus = true) {
    if (!drawer.classList.contains('is-open')) return;
    drawer.classList.remove('is-open');
    drawer.setAttribute('inert', '');
    toggle.setAttribute('aria-expanded', 'false');
    if (returnFocus) toggle.focus({ preventScroll: true });
  }
  toggle.addEventListener('click', () => (drawer.classList.contains('is-open') ? closeDrawer() : openDrawer()));
  $('#wb-close').addEventListener('click', () => closeDrawer());
  addEventListener('keydown', (e) => { if (e.key === 'Escape' && drawer.classList.contains('is-open') && !$('#activity').open) { e.preventDefault(); closeDrawer(); } });

  // ---- switches ----------------------------------------------------------------------------------------------------------------------
  $('#reduce').addEventListener('change', (e) => onCalm(e.target.checked));
  $('#turntable').addEventListener('click', () => {
    const mascot = getMascot();
    if (!mascot) return;
    mascot.turntable = !mascot.turntable;
    $('#turntable').setAttribute('aria-pressed', String(mascot.turntable));
    if (mascot.reducedMotion && mascot.turntable) toast(say(COPY.toast.turntableCalm));
  });

  // ---- exports -----------------------------------------------------------------------------------------------------------------------
  function download(url, name) { const a = document.createElement('a'); a.href = url; a.download = name; a.click(); }
  $('#export-png').addEventListener('click', () => {
    const mascot = getMascot();
    if (!mascot) return;
    download(mascot.snapshot(), `${SLUG}-${getState()}.png`);
    toast(say(COPY.toast.snapshot));
  });
  $('#export-glb').addEventListener('click', async () => {
    const mascot = getMascot(), b = $('#export-glb');
    if (!mascot) return;
    b.disabled = true; b.textContent = say(COPY.workbench.glbBusy);
    try {
      const binary = await mascot.exportGLB(), url = URL.createObjectURL(new Blob([binary], { type: 'model/gltf-binary' }));
      download(url, `${SLUG}-animated.glb`);
      setTimeout(() => URL.revokeObjectURL(url), 10000);
      toast(say(COPY.toast.glb));
    } catch (err) {
      console.error(err);
      toast(say(COPY.toast.glbFailed));
    } finally {
      b.disabled = false; b.textContent = say(COPY.workbench.glb);
    }
  });

  return { log, toast, syncState, openDrawer, closeDrawer, setReduce: (on) => { $('#reduce').checked = on; }, disableExports: () => { $('#export-glb').disabled = $('#export-png').disabled = true; $('#turntable').disabled = true; } };
}
