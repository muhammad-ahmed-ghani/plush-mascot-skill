// The scroll story: eight scenes on one page, the mascot's stage behind them.
//
// Each scene is a tall section with a sticky frame (css).  While a frame is stuck the scene "holds"; between two holds the page scrolls
// one viewport, and that stretch is the transition: the palette, the camera (mascot.setView) and the felt all blend continuously with the
// scroll position.  A scene's state is only handed to the mascot once it has been the active scene for a moment, so flicking past does not
// restart anything.  The look-closer scene is long and scrubbed by its own progress: the camera goes in on the face, down to the chest, out
// to the whole figure, the mascot turns round, and the prints and swatches come out.
//
// Nothing here touches layout while scrolling: it writes CSS variables (colours), transforms and opacity, from one rAF loop.

import { FRAMING } from '../mascot.js';
import { FRAME, FIGURE_HEIGHT } from '../config.js';
import { mixLab, toOklab, fromOklab, contrast, smoothstep, clamp01, lerp } from './color.js';
import { buildPieces, buildDisc, buildStars, buildSwatches } from './felt.js';
import { PALETTE, PAGE_COLORS, rgb } from './palette.js';

const INK = PALETTE.ink, CREAM = PAGE_COLORS.lightInk;          // the dark and the light ink (mascot.config.json palette.ink, page.colors.lightInk)
const HOLD_MS = 380;                       // a scene must stay active this long before its state starts

// ---- scenes: the state the mascot performs, what it returns to, and the colours of the room --------------------------------------------
// The first and the look-closer rooms are the page's paper and the working room is its ink (mascot.config.json palette); the other rooms
// and the discs are page tints chosen for the example palette: check them with scripts/dev/contrast.mjs when the palette changes.
// glow: the accent's light behind the mascot (--accent-base); stars: the stitched sky of the last scene.
export const SCENES = [
  { id: 'hello', state: 'greeting', base: 'idle', bg: PALETTE.paper, disc: '#fbf3e3' },
  { id: 'motion', state: 'listening', base: 'listening', bg: '#f6d8cb', disc: '#fdece3' },
  { id: 'thinking', state: 'thinking', base: 'thinking', bg: '#eadfc6', disc: '#f7eedb' },
  { id: 'working', state: 'working', base: 'working', bg: PALETTE.ink, disc: '#21222a', glow: 0.95 },
  { id: 'approval', state: 'approval', base: 'approval', bg: '#fff1dd', disc: '#fffaf0' },
  { id: 'done', state: 'success', base: 'idle', bg: '#f6dc9c', disc: '#fbe9b4' },
  { id: 'closer', state: 'idle', base: 'idle', bg: PALETTE.paper, disc: '#fbf3e3' },
  { id: 'goodnight', state: 'resting', base: 'resting', bg: '#1b1620', disc: '#282030', glow: 0.4, stars: 1 },
];

// ---- framing ---------------------------------------------------------------------------------------------------------------------------
// Two framings of every shot.  `wide` (text beside the mascot) says where a world point of it (fy: 0 at the feet, TOP at the ear tips) sits
// on the stage (at: fractions of it) and how big the world is (unit: stage heights per world unit; a whole figure is TOP).  `tall` (the
// words under the mascot, phones and tablets held upright) asks for the world between topY and topY - span to fit the band above the
// words, `w` world units wide, and works the scale out from the measured height of the words.
// `hw` is how far out from the middle the mascot reaches (world units: arms, ears, the card), so the wide shot can be shrunk until it fits
// the side of the screen the words are not on; `free` (closer only) is that side as fractions of the stage width.
// TOP is the figure's height (FIGURE_HEIGHT, from mascot.config.json frame) rounded to the tenth the shots are composed in: 3.3 for the
// example.  The whole-figure shots follow it; the others look at the example's own anatomy (the head at about 2.0 to 2.2, the chest at
// 1.7, the seated figure at 1.2) and the reaches `hw` and widths `w` fit its arms and hood: revisit them for a mascot of another build.
const TOP = Math.round(FIGURE_HEIGHT * 10) / 10, MID = TOP / 2;
const fig = (cx, cy, unit, extra) => ({ fy: MID, at: [cx, cy], unit, hw: 1.3, ...extra });
const FULL = { topY: TOP, span: TOP, w: 2.7 };
const SHOTS = {
  hello: { wide: fig(0.735, 0.535, 0.255, { hw: 1.4 }), tall: { ...FULL, w: 3.2 } },
  motion: { wide: { fy: 2.0, at: [0.3, 0.52], unit: 0.305, hw: 1.35 }, tall: { topY: TOP, span: 2.5, w: 3.0 } },
  thinking: { wide: fig(0.73, 0.54, 0.265), tall: FULL },
  working: { wide: { fy: 1.2, at: [0.28, 0.56], unit: 0.215, hw: 1.5 }, tall: { topY: 3.0, span: 3.0, w: 3.5, x: 0.46 } },
  approval: { wide: fig(0.225, 0.54, 0.24, { hw: 1.8 }), tall: { ...FULL, w: 3.6 } },
  done: { wide: fig(0.705, 0.575, 0.24, { hw: 1.7 }), tall: { topY: TOP + 0.45, span: TOP + 0.45, w: 3.6 } },          // (room above for the hop)
  goodnight: { wide: fig(0.23, 0.5, 0.215), tall: { ...FULL, w: 3.0, x: 0.34 } },
  face: { wide: { fy: 2.2, at: [0.7, 0.52], unit: 0.36, hw: 1.2, free: [0.36, 1] }, tall: { topY: TOP, span: 2.3, w: 2.5 } },
  chest: { wide: { fy: 1.7, at: [0.69, 0.63], unit: 0.33, hw: 1.3, free: [0.3, 1] }, tall: { topY: TOP, span: 2.5, w: 2.5 } },
  full: { wide: fig(0.69, 0.54, 0.26, { free: [0.3, 1] }), tall: FULL },
  back: { wide: fig(0.69, 0.54, 0.26, { yaw: Math.PI, free: [0.3, 1] }), tall: FULL, yaw: Math.PI },
  side: { wide: fig(0.235, 0.545, 0.228, { free: [0, 0.43] }), tall: FULL },
};
// [scroll progress through the scene's hold, shot, the beats whose words it must leave room for]; between two keys the camera glides
const CLOSER_KEYS = [[0, 'face', [0]], [0.12, 'face', [0]], [0.19, 'chest', [1]], [0.27, 'chest', [1]], [0.34, 'full', [2]], [0.41, 'full', [2]], [0.47, 'back', [3]], [0.54, 'back', [3]], [0.6, 'side', [4, 5, 6]], [1, 'side', [4, 5, 6]]];
// which notes and prints are out (data-beat in index.html): [from, to) of the scene's scroll progress.  The gap before the prints is where the
// mascot crosses the screen, so nothing is on show for it to cross.
const BEATS = [[0, 0.15], [0.15, 0.3], [0.3, 0.44], [0.44, 0.535], [0.63, 0.76], [0.76, 0.88], [0.88, 1.01]];
const beatAt = (p) => BEATS.findIndex(([a, b]) => p >= a && p < b);

export function toView(f, W, H) {
  const ppu0 = Math.min(H / FIT_H, W / FIT_W);                   // pixels per world unit at zoom 1
  const ppu = f.unit * H;
  return { x: f.at[0] - 0.5, y: (H / 2 - (f.fy - FRAME_Y) * ppu - f.at[1] * H) / H, zoom: ppu / ppu0, yaw: f.yaw ?? 0, fy: f.fy };
}
/** How much of a tall screen the sheet under the mascot takes: the words, the room left under them and a margin above. */
const sheetPx = (H, textPx, extra = 0) => textPx + Math.max(0.055 * H, 24, extra) + 28;
/** The tall shot for a screen of this size, given how many pixels the words under the mascot take. */
function tallFrame(t, W, H, textPx, extra = 0) {
  const topPx = Math.max(124, 0.14 * H), bottomPx = H - sheetPx(H, textPx, extra) - 10;
  const side = t.x === undefined ? 1 : 2 * Math.min(t.x, 1 - t.x), avail = Math.max(150, bottomPx - topPx), unitPx = Math.min((0.97 * W * side) / t.w, avail / t.span, 0.3 * H);
  const fy = t.topY - t.span / 2, slack = Math.max(0, avail - t.span * unitPx);      // (spare room above the words: the mascot settles a little above the middle of it)
  return { fy, at: [t.x ?? 0.5, (topPx + slack * 0.4 + (t.span / 2) * unitPx) / H], unit: unitPx / H, yaw: t.yaw ?? 0 };
}
/** Shrink a wide shot (and slide the mascot sideways) until its reach fits between a and b (pixels on the stage). */
function fitWide(f, a, b, W, H) {
  if (f.hw === undefined) return f;
  const unit = Math.min(f.unit, (b - a) / 2 / (f.hw * H)), half = f.hw * unit * H;
  const cx = Math.min(b - half, Math.max(a + half, f.at[0] * W));
  return { ...f, unit, at: [cx / W, f.at[1]] };
}
const mixView = (a, b, t) => ({ x: lerp(a.x, b.x, t), y: lerp(a.y, b.y, t), zoom: Math.exp(lerp(Math.log(a.zoom), Math.log(b.zoom), t)), yaw: lerp(a.yaw, b.yaw, t), fy: lerp(a.fy, b.fy, t) });

// The controller's framing (src/mascot.js _frameCamera): the camera looks level at FRAME_Y and fits FIT_H units of height or FIT_W of width.
// scripts/dev/validate.mjs compares the maths below with mascot.figureBox(), so a change in how the controller frames the mascot is noticed.
const { y: FRAME_Y, fitH: FIT_H, fitW: FIT_W } = FRAMING;
const unitPx = (view, W, H) => view.zoom * Math.min(H / FIT_H, W / FIT_W);
/** World point -> stage pixels for a view (the same projection the controller uses, to within its 8 degree lens). */
export function project(view, X, Y, W, H) {
  const ppu = unitPx(view, W, H);
  return [W / 2 + X * ppu + view.x * W, H / 2 - (Y - FRAME_Y) * ppu - view.y * H];
}
/**
 * Where the neutral portrait (the canonical art, FRAME.size px square) must be drawn for a view: what the controller's figureBox() says,
 * worked out here so it is right for any shift.
 */
export function posterBox(view, W, H) {
  const ppu = unitPx(view, W, H), size = ppu * (FRAME.size / FRAME.ppu), feetY = H / 2 + FRAME_Y * ppu - view.y * H;
  return { left: W / 2 + view.x * W - size * (FRAME.axisX / FRAME.size), top: feetY - size * (FRAME.feetY / FRAME.size), size };
}

export function createStory({ mascot, stage, stackedQuery, requestState }) {
  const root = document.documentElement;
  const $ = (s, r = document) => r.querySelector(s);
  const scenes = SCENES.map((s) => ({ ...s, el: document.getElementById(s.id), lab: { bg: toOklab(s.bg), disc: toOklab(s.disc) } }));
  scenes.forEach((s) => { s.frame = $('.scene__frame', s.el); s.text = $('.scene__text', s.el); });
  const closer = scenes.find((s) => s.id === 'closer'), closerIndex = scenes.indexOf(closer);
  const discEl = $('.backdrop__disc'), glowEl = $('.backdrop__glow'), starsEl = $('.backdrop__stars'), piecesEl = $('.pieces');
  const leaders = $('.leaders'), beats = [...closer.el.querySelectorAll('.beat')];
  const themeMeta = $('meta[name="theme-color"]');
  const fallbackImg = $('#fallback img');

  const S = { W: 1, H: 1, Hf: 1, ppu0: 1, stacked: false, calm: false, pieces: [], views: new Map(), keys: [], calmView: null, discD: 1, fbView: null, fbTarget: null };
  let active = -1, pendingTimer = 0, raf = 0, dirty = true, lastT = 0, beat = -1, notes = [], lastVars = {}, targetView = null, currentView = null;

  // ---- measuring -----------------------------------------------------------------------------------------------------------------------
  function measure() {
    S.stacked = stackedQuery.matches;
    S.W = stage.clientWidth || innerWidth;
    S.H = stage.clientHeight || innerHeight;
    S.ppu0 = Math.min(S.H / FIT_H, S.W / FIT_W);
    S.Hf = scenes[0].frame.getBoundingClientRect().height || innerHeight;
    const y0 = scrollY;
    for (const s of scenes) {
      const r = s.el.getBoundingClientRect();
      s.top = r.top + y0; s.height = r.height;
      s.hold = Math.max(1, s.height - S.Hf);
      s.stick = s.top; s.enter = s.top - S.Hf; s.leave = s.top + s.hold;
    }
    const beatPx = beats.map((b) => $('.beat__in', b).offsetHeight);
    S.beatPx = beatPx;
    for (const s of scenes) {
      if (s === closer) continue;
      if (S.stacked && !S.calm && s.text) s.frame.style.setProperty('--sheet', `${sheetPx(S.H, s.text.offsetHeight, s.id === 'goodnight' ? Math.max(0.1 * S.H, 86) : 0)}px`);
      else s.frame.style.removeProperty('--sheet');
    }
    const gap = Math.max(24, 0.03 * S.W);
    // the side of the screen the words are not on (wide layout)
    const freeOf = (s) => { const r = s.text.getBoundingClientRect(); return s.el.dataset.side === 'right' ? [r.right + gap, S.W] : [0, r.left - gap]; };
    const frameOf = (shot, textPx, free, extra = 0) => (S.stacked ? tallFrame({ ...shot.tall, yaw: shot.yaw }, S.W, S.H, textPx, extra) : fitWide(shot.wide, ...(shot.wide.free ? [shot.wide.free[0] * S.W + gap * (shot.wide.free[0] > 0), shot.wide.free[1] * S.W - gap * (shot.wide.free[1] < 1)] : free), S.W, S.H));
    S.views = new Map(scenes.filter((s) => s !== closer).map((s) => [s.id, toView(frameOf(SHOTS[s.id], s.text ? s.text.offsetHeight : 0, S.stacked ? null : freeOf(s), s.id === 'goodnight' ? Math.max(0.1 * S.H, 86) : 0), S.W, S.H)]));
    S.keys = CLOSER_KEYS.map(([, name, bs]) => toView(frameOf(SHOTS[name], Math.max(...bs.map((b) => beatPx[b] ?? 0)), [0, S.W]), S.W, S.H));
    S.calmView = toView(S.stacked ? frameOf(SHOTS.hello, scenes[0].text.offsetHeight) : fitWide(fig(0.735, 0.55, 0.24, { hw: 1.4 }), ...freeOf(scenes[0]), S.W, S.H), S.W, S.H);
    // the disc and the glow are built once per layout; the zoom scales them
    S.discD = Math.round(S.stacked ? 1.25 * S.W : 1.3 * S.H);
    buildDisc(discEl, S.discD);
    S.pieces = buildPieces(piecesEl, S.W, S.H, S.stacked, S.pieces);
    buildStars(starsEl);
    buildSwatches(closer.el);
    measureNotes();
    dirty = true;
    requestTick();
  }

  function measureNotes() {
    leaders.textContent = '';
    notes = [];
    if (S.stacked || S.calm) return;
    const NS = 'http://www.w3.org/2000/svg';
    for (const el of closer.el.querySelectorAll('.note[data-pin]')) {
      const [X, Y] = el.dataset.pin.split(',').map(Number), host = el.closest('.beat');
      const path = document.createElementNS(NS, 'path'), dot = document.createElementNS(NS, 'circle');
      dot.setAttribute('r', '7');
      leaders.append(path, dot);
      notes.push({ el, host, X, Y, path, dot, sx: el.offsetLeft + el.offsetWidth + 14, sy: el.offsetTop + el.offsetHeight * 0.55 });
    }
  }

  // ---- where the scroll position is ----------------------------------------------------------------------------------------------------
  function locate(y) {
    let k = 0;
    for (let i = scenes.length - 1; i > 0; i--) if (y >= scenes[i].enter) { k = i; break; }
    if (k > 0 && y < scenes[k].stick) return { from: k - 1, to: k, t: (y - scenes[k].enter) / S.Hf };
    return { from: k, to: k, t: 0 };
  }
  const progress = (s, y) => clamp01((y - s.stick) / s.hold);
  /** Which scene is on stage at this scroll position (half way through a transition, with a little hysteresis). Cheap, so it runs on every scroll event, not only in a frame. */
  function pickActive(y) {
    const loc = locate(y), { from, to, t } = loc;
    let now = active < 0 ? from : active;
    if (from === to) now = from;
    else if (now !== from && now !== to) now = t < 0.5 ? from : to;       // (a jump landed inside a transition)
    else if (t >= 0.56 && now === from) now = to;
    else if (t <= 0.44 && now === to) now = from;
    if (now !== active) activate(now);
    return loc;
  }
  function viewOf(s, p) {
    if (s !== closer) return S.views.get(s.id);
    const k = S.keys;
    if (p <= CLOSER_KEYS[0][0]) return k[0];
    for (let i = 1; i < CLOSER_KEYS.length; i++) {
      if (p <= CLOSER_KEYS[i][0]) return CLOSER_KEYS[i][0] === CLOSER_KEYS[i - 1][0] ? k[i] : mixView(k[i - 1], k[i], smoothstep(CLOSER_KEYS[i - 1][0], CLOSER_KEYS[i][0], p));
    }
    return k[k.length - 1];
  }

  // ---- the colours ---------------------------------------------------------------------------------------------------------------------
  function setVar(name, value) {
    if (lastVars[name] === value) return;
    lastVars[name] = value;
    root.style.setProperty(name, value);
  }
  function paint(a, b, w) {
    // between a dark room and a light one the middle would be plain grey: lift it towards a warm rose instead
    const mid = mixLab(a.lab.bg, b.lab.bg, w), lift = 4 * w * (1 - w) * clamp01((Math.abs(a.lab.bg[0] - b.lab.bg[0]) - 0.25) * 2.5);
    mid[1] += 0.07 * lift; mid[2] += 0.028 * lift;
    const bg = fromOklab(mid), disc = fromOklab(mixLab(a.lab.disc, b.lab.disc, w));
    const onInk = contrast(bg, INK), onCream = contrast(bg, CREAM), darkRoom = onCream > onInk;
    // words fade out while the room is mid-grey (no colour of ink reads well there) and come back as soon as it settles
    const legible = smoothstep(4.8, 6.4, Math.max(onInk, onCream));
    setVar('--bg', bg);
    setVar('--disc', disc);
    setVar('--fg', darkRoom ? CREAM : INK);
    setVar('--fg-soft', darkRoom ? '#d8ccb9' : '#3b3633');
    const fg = darkRoom ? CREAM : INK, { accentOnLight: onLight, accentOnDark: onDark } = PAGE_COLORS, accent = [contrast(bg, onLight), contrast(bg, onDark)];
    setVar('--accent', Math.max(...accent) < 4.5 ? fg : accent[0] >= accent[1] ? onLight : onDark);        // (handwriting takes the shade of the accent that reads best, or plain ink when neither does)
    setVar('--disc-stitch', rgb(darkRoom ? CREAM : INK, 0.14));
    setVar('--legible', legible.toFixed(3));
    glowEl.style.opacity = lerp(a.glow ?? 0, b.glow ?? 0, w).toFixed(3);
    starsEl.style.opacity = lerp(a.stars ?? 0, b.stars ?? 0, w).toFixed(3);
  }

  // ---- the frame of a scroll position --------------------------------------------------------------------------------------------------
  function update() {
    dirty = false;
    if (S.calm) return;
    const y = scrollY, { from, to, t } = pickActive(y), A = scenes[from], B = scenes[to];
    // The order of a transition: the old words go (before the mascot reaches their side), the mascot and the room move while nothing is written,
    // the new words arrive (once it has left their side).  It follows the target a beat late, so the target leads.
    const w = from === to ? 0 : smoothstep(0.04, 0.5, t);
    paint(A, B, w);
    // the words of the scene that is leaving fade out before the middle of the transition, the next scene's fade in after it: between them, only the mascot and the room
    for (let i = 0; i < scenes.length; i++) {
      const v = from === to ? (i === from ? 1 : 0) : i === from ? 1 - smoothstep(0.02, 0.24, t) : i === to ? smoothstep(0.52, 0.76, t) : 0, key = v.toFixed(2);
      if (scenes[i].fade !== key) { scenes[i].fade = key; scenes[i].el.style.setProperty('--fade', key); }
    }

    // the camera: hold a scene's frame, glide to the next one across the transition
    const view = from === to ? viewOf(A, progress(A, y)) : mixView(viewOf(A, 1), viewOf(B, 0), w);
    targetView = view;
    if (mascot) mascot.setView({ x: view.x, y: view.y, zoom: view.zoom, yaw: view.yaw });
    else S.fbTarget = view;

    // the look-closer beats
    setBeat(active === closerIndex ? beatAt(progress(closer, y)) : -1);

    // parallax: each piece drifts at its own speed while its scene is near, and fades as the scene leaves
    for (const p of S.pieces) {
      const s = scenes[p.cfg.s], anchor = s.stick + (p.cfg.at ?? 0.5) * s.hold, off = (anchor - y) * p.cfg.k;
      const alpha = 1 - smoothstep(0.42, 0.95, Math.abs(anchor - y) / S.Hf), show = alpha > 0.01;
      if (show !== p.shown) { p.el.style.display = show ? '' : 'none'; p.shown = show; }
      if (!show) continue;
      if (alpha !== p.alpha) { p.alpha = alpha; p.el.style.opacity = alpha.toFixed(3); }
      p.el.style.transform = `translate3d(${p.x - p.w / 2}px, ${p.y - p.h / 2 + off}px, 0) rotate(${p.cfg.r + ((y - anchor) / S.Hf) * 4}deg)`;
    }
  }

  function activate(i) {
    const prev = active;
    active = i;
    const s = scenes[i];
    root.dataset.scene = s.id;
    if (themeMeta) themeMeta.setAttribute('content', s.bg);
    clearTimeout(pendingTimer);
    pendingTimer = setTimeout(() => { if (active === i && !S.calm) requestState(s.state, s); }, prev < 0 ? 0 : HOLD_MS);
  }

  function setBeat(b) {
    if (b === beat) return;
    beat = b;
    closer.frame.dataset.now = String(b);
    if (S.stacked && !S.calm) closer.frame.style.setProperty('--sheet', `${sheetPx(S.H, S.beatPx[b] ?? 0)}px`);
    else closer.frame.style.removeProperty('--sheet');
    for (const el of beats) {
      const list = el.dataset.beat.split(' ').map(Number);
      const on = b >= 0 && (S.stacked ? list[0] === b : list.includes(b));
      el.classList.toggle('is-on', on);
      el.classList.toggle('is-in', on);
    }
    for (const n of notes) {
      const on = n.host.classList.contains('is-on');
      n.path.classList.toggle('is-on', on); n.dot.classList.toggle('is-on', on);
    }
  }

  // ---- things that follow the camera as it eases ---------------------------------------------------------------------------------------
  function follow(dt) {
    let v = mascot?.view;
    if (!mascot) {                                                   // no 3D: the portrait is eased here
      if (!S.fbView) S.fbView = { ...(S.fbTarget ?? S.views.get('hello')) };
      const a = 1 - Math.exp(-dt * 4.2), T = S.fbTarget ?? S.fbView;
      for (const k of ['x', 'y', 'zoom', 'yaw']) S.fbView[k] += (T[k] - S.fbView[k]) * a;
      v = S.fbView;
      if (fallbackImg) {
        const b = posterBox(v, S.W, S.H);
        fallbackImg.style.transform = `translate(${b.left}px, ${b.top}px) scale(${b.size / FRAME.size})`;
      }
    }
    if (!v) return;
    currentView = v;
    const fy = targetView?.fy ?? MID, ppu = v.zoom * S.ppu0, [cx, cy] = project(v, 0, fy, S.W, S.H);
    const sc = Math.min(ppu * 4.4, S.discD) / S.discD;
    discEl.style.transform = `translate3d(${cx}px, ${cy}px, 0) scale(${sc.toFixed(4)})`;
    const gs = Math.min(ppu * 6.4, S.W * 1.6) / (Math.min(S.W, S.H) * 1.2);
    glowEl.style.transform = `translate3d(${cx}px, ${cy}px, 0) scale(${gs.toFixed(4)})`;
    if (beat >= 0) for (const n of notes) {
      if (!n.host.classList.contains('is-on')) continue;
      const [px, py] = project(v, n.X, n.Y, S.W, S.H), dx = px - n.sx;
      n.path.setAttribute('d', `M${n.sx.toFixed(1)} ${n.sy.toFixed(1)}C${(n.sx + dx * 0.55).toFixed(1)} ${n.sy.toFixed(1)} ${(px - dx * 0.35).toFixed(1)} ${py.toFixed(1)} ${px.toFixed(1)} ${py.toFixed(1)}`);
      n.dot.setAttribute('cx', px.toFixed(1)); n.dot.setAttribute('cy', py.toFixed(1));
    }
  }

  function moving() {
    if (!mascot) { const T = S.fbTarget, V = S.fbView; return !T || !V || ['x', 'y', 'zoom', 'yaw'].some((k) => Math.abs(T[k] - V[k]) > 1e-3); }
    const v = mascot.view, t = mascot.viewTarget;
    return ['x', 'y', 'zoom', 'yaw'].some((k) => Math.abs(t[k] - v[k]) > 2e-4);
  }

  // ---- the loop ------------------------------------------------------------------------------------------------------------------------
  function tick(now) {
    raf = 0;
    if (S.calm) return;
    const dt = Math.min(0.1, (now - lastT) / 1000 || 0.016);
    lastT = now;
    if (dirty) update();
    follow(dt);
    if (dirty || moving()) requestTick();
  }
  function requestTick() { if (!raf && !S.calm) raf = requestAnimationFrame(tick); }
  function markDirty() { dirty = true; requestTick(); }

  // ---- words that slide in when their scene comes up -----------------------------------------------------------------------------------
  const io = new IntersectionObserver((entries) => {
    for (const e of entries) {
      const host = e.target.closest('.scene');
      if (host.classList.contains('scene--closer')) continue;       // the closer's beats are lit by the scroll position instead
      if (e.intersectionRatio > 0.2) host.classList.add('is-in');
      else if (e.intersectionRatio === 0) host.classList.remove('is-in');
    }
  }, { threshold: [0, 0.2, 0.5] });
  scenes.forEach((s) => { if (s.text && s !== closer) io.observe(s.text); });

  // ---- reduced motion: no scrolling choreography, one calm pose --------------------------------------------------------------------------
  function applyCalm() {
    const v = S.calmView;
    targetView = v;
    if (mascot) mascot.setView({ x: v.x, y: v.y, zoom: v.zoom, yaw: 0 }, { immediate: true });
    else { S.fbTarget = v; S.fbView = { ...v }; }
    follow(0.016);
    const hello = scenes[0];
    lastVars = {};
    paint(hello, hello, 0);
    for (const s of scenes) { s.fade = null; s.el.style.removeProperty('--fade'); }
    setVar('--legible', '1');
    glowEl.style.opacity = '0'; starsEl.style.opacity = '0';
    for (const p of S.pieces) {
      p.shown = Boolean(p.cfg.calm);                                  // (only the piece that sits behind the mascot's ear: the rest would end up under the words)
      p.el.style.display = p.shown ? '' : 'none';
      p.el.style.opacity = '1';
      p.el.style.transform = `translate3d(${p.x - p.w / 2}px, ${p.y - p.h / 2}px, 0) rotate(${p.cfg.r}deg)`;
    }
  }
  function setCalm(on) {
    if (on === S.calm) return;
    const keep = scenes[Math.max(0, active)];
    S.calm = on;
    root.classList.toggle('calm', on);
    clearTimeout(pendingTimer);
    active = -1; beat = -1;
    cancelAnimationFrame(raf); raf = 0;
    for (const el of beats) el.classList.remove('is-on', 'is-in');
    measure();                                                     // (the layout just changed: sticky frames become plain sections, or back)
    if (on) { root.removeAttribute('data-scene'); applyCalm(); }
    else { lastVars = {}; dirty = true; requestTick(); }
    scrollTo({ top: on ? keep.el.getBoundingClientRect().top + scrollY : keep.stick, behavior: 'instant' });
    if (!on) { dirty = true; requestTick(); }
  }

  function goTo(id, { smooth = true } = {}) {
    const s = scenes.find((x) => x.id === id);
    if (!s) return;
    scrollTo({ top: S.calm ? s.el.getBoundingClientRect().top + scrollY : s.stick, behavior: smooth && !S.calm ? 'smooth' : 'instant' });
  }

  // ---- public ---------------------------------------------------------------------------------------------------------------------------
  function firstView() {
    measure();
    if (S.calm) applyCalm();
    else {
      update();
      const v = targetView;
      if (mascot) mascot.setView({ x: v.x, y: v.y, zoom: v.zoom, yaw: v.yaw }, { immediate: true });
      else { S.fbTarget = v; S.fbView = { ...v }; }
      follow(0.016);
    }
    return targetView;
  }

  addEventListener('scroll', () => { if (!S.calm) pickActive(scrollY); markDirty(); }, { passive: true });
  setInterval(() => { if (!S.calm && !document.hidden) pickActive(scrollY); }, 600);      // (a safety net: the scene is also re-read twice a second)
  let resizeRaf = 0;
  addEventListener('resize', () => {
    cancelAnimationFrame(resizeRaf);
    resizeRaf = requestAnimationFrame(() => {
      measure();
      if (S.calm) applyCalm();
      else { update(); const v = targetView; if (mascot && v) mascot.setView({ x: v.x, y: v.y, zoom: v.zoom, yaw: v.yaw }, { immediate: true }); }
    });
  });
  stackedQuery.addEventListener('change', () => measure());
  document.fonts?.ready.then(() => { measure(); if (S.calm) applyCalm(); });

  return {
    scenes,
    firstView,
    measure,
    setCalm,
    goTo,
    markDirty,
    get active() { return scenes[Math.max(0, active)]; },
    get calm() { return S.calm; },
    get stacked() { return S.stacked; },
    get view() { return currentView ?? targetView; },
    /** The box the neutral portrait would fill for the mascot's current view (stage pixels): poster placement and hit-testing. */
    figure() { const v = mascot?.view ?? this.view; return v ? posterBox(v, stage.clientWidth || S.W, stage.clientHeight || S.H) : null; },
    /** Start the state of the scene that is on stage (once the mascot is ready). */
    begin() { if (!S.calm) requestState(this.active.state, this.active); },
  };
}
