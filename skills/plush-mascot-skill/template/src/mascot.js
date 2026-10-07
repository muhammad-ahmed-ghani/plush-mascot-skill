// The mascot's controller: the public entry point of the live 3D character.
//
//   const mascot = new MascotController(container, { state: 'idle' });
//   await mascot.ready;                 // mesh + textures are loaded
//   mascot.setState('working');         // drive from real application events
//
// The character is a baked signed-distance sculpt (see scripts/bake) skinned to a
// small skeleton, dressed in a felt shader, lit by a procedural photo studio.
// Its files (mesh tiers, nap tiles, face maps, the laptop's emblem) are named in mascot.config.json and fetched from `assetsUrl`.
import * as THREE from 'three';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import config, { FRAME, FIGURE_HEIGHT, assetPath } from './config.js';
import { loadMascotMesh } from './mascot-mesh.js';
import { buildMascotRig, applyBodyPose } from './mascot-rig.js';
import { ensureNapTextures } from './mascot-fabric.js';
import { buildProps } from './mascot-props.js';
import { loadEmblem } from './props/lp-textures.js';
import { createStudioEnvironment, createKeyLight, createFillLight, createBounceLight, createHemiLight, installToneMapping, STUDIO } from './mascot-studio.js';
import { computePose, restPose, KEYS, SEAT, dismountTime, dismountLead } from './mascot-pose.js';
import { STATES } from './mascot-states.js';

export { STATES };

const BASE = import.meta.env?.BASE_URL ?? '/';
const ASSETS = `${BASE}assets/`;

/** Pick a render tier from what the device can plausibly sustain.  Callers can always override with `quality`. */
export function detectQuality() {
  try {
    const coarse = matchMedia('(pointer: coarse)').matches;
    const cores = navigator.hardwareConcurrency ?? 4;
    const memory = navigator.deviceMemory ?? 4;
    if (coarse && (cores <= 4 || memory <= 3)) return 'low';
    if (coarse || cores <= 4 || memory <= 4) return 'medium';
  } catch { /* fall through */ }
  return 'high';
}
// the mesh files are mascot.config.json mesh.final (high) and mesh.lite (medium, low), fetched relative to assetsUrl
const TIERS = {
  high: { mesh: assetPath(config.mesh.final), shells: 4, shadow: 2048, dpr: 2 },
  medium: { mesh: assetPath(config.mesh.lite), shells: 2, shadow: 1024, dpr: 1.75 },
  low: { mesh: assetPath(config.mesh.lite), shells: 0, shadow: 1024, dpr: 1.25 },
};

// ease rate (1/s) per key; unlisted keys use RATE.default
const FRAME_Y = 1.75;           // world height at the centre of the stage
/** The camera's framing, for pages that place things on the stage themselves (see setView): level at `y`, fitting `fitH` units of height or `fitW` of width. */
export const FRAMING = { y: FRAME_Y, fitH: 4.4, fitW: 3.5 };
const RATE = { default: 11, 'f.sleep': 5, 'p.card': 9, 'p.phones': 8, 'f.lt': 24, 'f.lb': 14, 'f.mo': 42, 'f.gx': 18, 'f.gy': 18, 'f.tilt': 10, 'p.laptop': 5, 'root.y': 16, 'root.sy': 20, 'p.sit': 15 };
const RATE_DOWN = { 'p.laptop': 8 };            // (used instead when the key is falling: the laptop packs away faster than it arrives)

/**
 * How closed the blink is, 0..1, `t` seconds after it began: the lids fall quickly (accelerating), stay shut for a moment, then open
 * more slowly with a soft landing - the asymmetry that makes a blink read as alive rather than mechanical.
 */
export const BLINK = { close: 0.08, hold: 0.035, open: 0.19 };
export function blinkAmount(t) {
  if (t <= 0) return 0;
  if (t < BLINK.close) { const u = t / BLINK.close; return u * u * (3 - 2 * u) * (0.6 + 0.4 * u); }
  if (t < BLINK.close + BLINK.hold) return 1;
  const u = (t - BLINK.close - BLINK.hold) / BLINK.open;
  return u >= 1 ? 0 : Math.pow(1 - u, 2.2);
}

/**
 * Body keys follow their targets like a slightly under-damped spring (natural frequency in rad/s, damping ratio) instead of a plain exponential
 * ease, so a gesture overshoots a little and settles: the difference between a puppet moving and a body carrying weight.  Face, prop and
 * lift keys keep the plain ease (RATE).
 */
const SPRINGS = [
  [/^(arm|p\.type)/, 13, 0.74],                       // (the laptop's typing signals move exactly like the hands that make them)
  [/^head\./, 11, 0.70],
  [/^(chest|spine|hips)\./, 8.5, 0.78],
  [/^root\.(yaw|roll|pitch)$/, 9, 0.85],
];
const springOf = (key) => { for (const [re, w, z] of SPRINGS) if (re.test(key)) return { w, z }; return null; };

/** Small seeded PRNG so idle behaviour (blink timing) is reproducible in tests and recordings. */
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class MascotController extends EventTarget {
  /**
   * @param {HTMLElement} container the element the canvas fills
   * @param {object} [o]
   * @param {'container'|'window'} [o.pointer] where the pointer is tracked: over the container (default), or anywhere in the window, for
   *   a stage that sits behind the page's content (the gaze is then measured from where the mascot is drawn, see setView)
   * @param {string} [o.assetsUrl] the folder the runtime files are fetched from (default `${BASE_URL}assets/`); their names are the
   *   mascot.config.json paths inside assets/
   * @param {number} [o.fps] the most frames a second that are drawn (default 60; 0 = every display frame).  On a 120 Hz screen that draws
   *   every other frame, which is steadier than a frame rate that wanders between 60 and 120, and half the work.
   */
  constructor(container, { state = 'idle', reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches, quality = detectQuality(), assetsUrl = ASSETS, seed = 20260930, pointer = 'container', fps = 60 } = {}) {
    super();
    this.container = container;
    this.fps = fps;
    this._tick = { at: 0, refresh: 1000 / 60 };                 // the last animation frame's time and a running estimate of the display's frame interval
    this.view = { x: 0, y: 0, zoom: 1, yaw: 0 };              // the camera's framing of the mascot (eased toward viewTarget), see setView
    this.viewTarget = { ...this.view };
    this.state = state;
    this.reducedMotion = reducedMotion;
    this.quality = TIERS[quality] ? quality : 'high';
    this.tier = TIERS[this.quality];
    this.assetsUrl = assetsUrl;
    this.elapsed = 0;          // seconds since the current state began
    this.lead = 0;             // seconds the current state waits, after it begins, before its own motion does (while the seat is put away)
    this._poke = null;         // { t }: a poke reaction in progress
    this.dismount = null;      // { t, worked, D }: the mascot is putting the laptop and headphones away (see dismountTime in mascot-pose.js)
    this.time = 0;             // continuous clock (breathing, sway)
    this.look = { x: 0, y: 0 };
    this._look = { x: 0, y: 0 };
    this.turntable = false;
    this.voice = undefined;
    this.disposed = false;
    this.loaded = false;
    this.rig = null;

    const renderer = this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, stencil: true, powerPreference: 'high-performance' });
    renderer.setPixelRatio(Math.min(devicePixelRatio, this.tier.dpr));
    renderer.setClearColor(0x000000, 0);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    installToneMapping(renderer);
    renderer.toneMappingExposure = STUDIO.exposure;
    renderer.localClippingEnabled = true;
    renderer.domElement.setAttribute('aria-hidden', 'true');
    container.append(renderer.domElement);
    // GPU context loss (driver reset, backgrounded mobile tab): three.js re-creates its GL state on restore, but the baked
    // studio environment lives in a render target whose contents are gone, so rebuild it and let the page show its poster meanwhile.
    this._ctxLost = () => { this.contextLost = true; this.dispatchEvent(new CustomEvent('contextlost')); };
    this._ctxRestored = () => {
      this.env?.dispose();
      this.env = createStudioEnvironment(renderer);
      this.scene.environment = this.env.texture;
      this.contextLost = false;
      this.dispatchEvent(new CustomEvent('contextrestored'));
    };
    renderer.domElement.addEventListener('webglcontextlost', this._ctxLost);
    renderer.domElement.addEventListener('webglcontextrestored', this._ctxRestored);

    const scene = this.scene = new THREE.Scene();
    this.env = createStudioEnvironment(renderer);
    scene.environment = this.env.texture;
    scene.environmentIntensity = STUDIO.env;
    this.key = createKeyLight(this.tier.shadow);
    this.fill = createFillLight();
    this.bounce = createBounceLight();
    this.hemi = createHemiLight();
    scene.add(this.key, this.key.target, this.fill, this.fill.target, this.bounce, this.bounce.target, this.hemi);

    // Grounding, like the artwork's studio floor: a tight contact shadow under the feet and a much wider, fainter one
    // thrown back and to the right by the window key.  Both are painted gradients (a shadow-map floor would give a
    // long hard streak), and both react to hops.
    const softDisc = (stops) => {
      const c = document.createElement('canvas');
      c.width = c.height = 256;
      const g = c.getContext('2d');
      const grad = g.createRadialGradient(128, 128, 0, 128, 128, 128);
      for (const [o, a] of stops) grad.addColorStop(o, `rgba(74,30,24,${a})`);
      g.fillStyle = grad; g.fillRect(0, 0, 256, 256);
      const t = new THREE.CanvasTexture(c);
      t.colorSpace = THREE.SRGBColorSpace;
      return t;
    };
    const shadowPlane = (w, d, tex, y) => {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(w, d), new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, fog: false }));
      m.rotation.x = -Math.PI / 2;
      m.position.y = y;
      m.renderOrder = -1;
      scene.add(m);
      return m;
    };
    this.blob = shadowPlane(2.7, 1.75, softDisc([[0, 0.5], [0.35, 0.3], [0.7, 0.09], [1, 0]]), 0.004);      // contact
    this.blob.position.x = 0.1;
    this.cast = shadowPlane(4.6, 2.4, softDisc([[0, 0.2], [0.5, 0.11], [1, 0]]), 0.003);                    // soft cast
    this.cast.position.set(-0.65, 0.003, -0.35);                       // the key light is up and to the viewer's right, so the soft shadow falls to the left
    this.ground = this.cast;            // (`ground` is the public name of the floor shadow: snapshot() hides it with the contact shadow)

    this.camera = new THREE.PerspectiveCamera(8, 1, 0.1, 60);           // a long lens: the artwork is close to orthographic, and so was the silhouette fit (the audit views use 6 degrees)
    this._frameCamera();

    this._pointerTarget = pointer === 'window' ? window : container;
    this._pointer = (e) => {
      const r = container.getBoundingClientRect();
      // measured from where the mascot is drawn (the view may have moved it off the middle of the container)
      const cx = r.left + r.width * (0.5 + this.view.x), cy = r.top + r.height * (0.5 - this.view.y);
      this.look.x = THREE.MathUtils.clamp((e.clientX - cx) / (r.width * 0.5), -1, 1);
      this.look.y = THREE.MathUtils.clamp(-(e.clientY - cy) / (r.height * 0.5), -1, 1);
    };
    this._leave = () => { this.look.x = this.look.y = 0; };
    this._pointerTarget.addEventListener('pointermove', this._pointer);
    (pointer === 'window' ? document.documentElement : container).addEventListener('pointerleave', this._leave);
    this._resize = () => {
      const { width, height } = container.getBoundingClientRect();
      if (!width || !height) return;
      renderer.setSize(width, height, false);
      this.camera.aspect = width / height;
      this._frameCamera();
      this.dispatchEvent(new CustomEvent('resize'));
    };
    this.resizeObserver = new ResizeObserver(this._resize);
    this.resizeObserver.observe(container);
    this._resize();
    this.inView = true;
    this.intersectionObserver = new IntersectionObserver((entries) => { this.inView = entries[0].isIntersecting; });
    this.intersectionObserver.observe(container);

    this.cur = restPose();
    this.tgt = restPose();
    this.ears = { L: { x: 0, vx: 0, z: 0, vz: 0 }, R: { x: 0, vx: 0, z: 0, vz: 0 } };
    this.prevHead = { y: 0, z: 0, rootY: 0 };
    this.random = mulberry32(seed);
    this.blink = { next: 2.2, t: -1, double: false };
    this.vel = {};                                   // spring velocities of the body keys
    this.spring = Object.fromEntries(KEYS.map((k) => [k, springOf(k)]));
    this.glance = { x: 0, y: 0, tx: 0, ty: 0, next: 1.2 };       // the eyes' small idle saccades
    this.spin = 0;
    this.perfLevel = 0;
    this.last = performance.now();
    this._frame = this._frame.bind(this);
    this.frame = requestAnimationFrame(this._frame);
    this.ready = this._load();
  }

  async _load() {
    // mesh, fabric-nap tiles and the laptop's emblem load in parallel; the nap loader never rejects (it falls back to procedural felt) and
    // a missing emblem only leaves the lid plain
    const [data, nap, emblem] = await Promise.all([loadMascotMesh(this.assetsUrl + this.tier.mesh), ensureNapTextures(this.assetsUrl), loadEmblem(this.assetsUrl)]);
    if (this.disposed) return this;
    this.data = data;
    this.nap = nap;
    this._shellHeight = 0.0085;                        // total reach of the fuzz at the silhouette (~4 px at the artwork's density, FRAME.ppu px per unit)
    this.rig = buildMascotRig(data, { shells: this.tier.shells, shellHeight: this._shellHeight });
    this.props = buildProps({ emblem });
    this.rig.root.add(this.props.root);
    // the headphones are authored in the head's rest space, so they ride the head bone (nods, tilts, look-arounds)
    const headRest = data.bones.find((b) => b.name === 'head').pos;
    this.props.phones.position.set(-headRest[0], -headRest[1], -headRest[2]);
    this.phonesMount = new THREE.Group();
    this.phonesMount.name = 'HeadphonesMount';
    this.phonesMount.add(this.props.phones);
    this.rig.byName.head.add(this.phonesMount);
    // every felt-shaded material (the character's, and the props' that borrow the fabric), so the nap scale can follow the screen size
    this._fabricMaterials = [];
    this.rig.root.traverse((o) => { if (o.material?.userData?.mascot && !this._fabricMaterials.includes(o.material)) this._fabricMaterials.push(o.material); });
    this._updateNapZoom();
    this._hand = new THREE.Vector3();
    this.scene.add(this.rig.root);
    // compile every program now, the props' included (the laptop, headphones and card are invisible until their state), so entering a
    // state never drops frames to a shader compile (left to compile on first use, the laptop's programs make the first 'working' frame take about 67 ms)
    await this.renderer.compileAsync(this.scene, this.camera);
    if (this.disposed) return this;
    this._warmProps();
    this.loaded = true;
    this._applyPose(0);
    this.dispatchEvent(new CustomEvent('ready'));
    return this;
  }

  /**
   * Bring every prop on stage for a frame or two (the canvas is still hidden under the poster), so the programs, textures and buffers of
   * the ones that appear later are ready: the laptop and headphones in place, then fading in (a transparent material is another program),
   * the card and the confetti.  Without it the first 'working' costs a 50-70 ms frame.  Everything is put back afterwards.
   */
  _warmProps() {
    const base = { time: 0, phones: 0, laptop: 0, card: 0, confettiT: -1, hop: 0, typeL: 0, typeR: 0, hand: this._hand };
    for (const step of [{ phones: 1, laptop: 1, card: 1, confettiT: 0.4 }, { phones: 0.4, laptop: 0.03, card: 0.5, confettiT: 0.9 }, {}]) {
      this.props.update({ ...base, ...step });
      this.renderer.render(this.scene, this.camera);
    }
    this._applyPose(0);                                   // (the laptop's seat changes moved bones: back to the rest pose)
  }

  /**
   * The nap tiles are authored at the artwork's scale (FRAME.ppu texels per unit, 350 for the example).  When the mascot is drawn smaller
   * than the artwork a fibre would fall below a pixel and average away into a smooth, plastic-looking surface - the exact opposite of felt.
   * So grow the nap a little as the mascot gets smaller.  (Measured against the artwork rescaled to each density: the best match is a
   * gentle 1.1x at a 2x display, ~1.35x at a 1x display and ~1.6x on a small phone stage - growing it to one texel per pixel reads as shag.)
   */
  _updateNapZoom() {
    const h = this.renderer.domElement.height;                             // drawing-buffer pixels
    const visibleUnits = 2 * this.camera.position.distanceTo(new THREE.Vector3(0, 1.7, 0)) * Math.tan(THREE.MathUtils.degToRad(this.camera.fov) / 2) / this.camera.zoom;
    const pxPerUnit = h / visibleUnits;
    this.rig?.face.setPixelSize(1 / pxPerUnit);                            // (the thin contact lines round the cheeks and mouth stay a pixel wide)
    if (!this._fabricMaterials || !this.nap?.real) return;
    const zoom = THREE.MathUtils.clamp(1 + 0.2 * (this._napZoomScale ?? 1) * Math.max(0, FRAME.ppu / pxPerUnit - 1), 1, 1.9);
    this.napZoom = zoom;
    for (const m of this._fabricMaterials) {
      const u = m.userData.mascot;
      u.uNapZoom.value = zoom;
      if (u.uShellT.value > 0) u.uShell.value = u.uShellT.value * (this._shellHeight ?? 0.0032) * zoom;     // longer nap = longer fuzz
    }
  }

  /**
   * Where the neutral artwork (mascot.config.json art.transparent: FRAME.size px square at FRAME.ppu px per unit, the body axis on column
   * FRAME.axisX, the feet on row FRAME.feetY) must be drawn on the stage for the live model to sit exactly on top of it, in CSS pixels.
   * The page uses it to place the poster it fades out from.
   */
  figureBox() {
    const el = this.renderer.domElement;
    const w = el.clientWidth || 1, h = el.clientHeight || 1;
    this.camera.updateMatrixWorld();
    const feet = new THREE.Vector3(0, 0, 0).project(this.camera), top = new THREE.Vector3(0, FIGURE_HEIGHT, 0).project(this.camera);
    const feetY = (1 - feet.y) / 2 * h, topY = (1 - top.y) / 2 * h;
    const size = ((feetY - topY) / FIGURE_HEIGHT) * (FRAME.size / FRAME.ppu);
    const axisX = (feet.x + 1) / 2 * w;                                     // (the figure's axis, which setView may have moved off the middle)
    return { left: axisX - size * (FRAME.axisX / FRAME.size), top: feetY - size * (FRAME.feetY / FRAME.size), size };
  }

  _frameCamera() {
    const aspect = this.camera.aspect || 1;
    // fit the character (FIGURE_HEIGHT tall, 3.3 units for the example) with a little room to hop and throw confetti; wider framing on
    // narrow stages.  FRAMING is composed for a figure of about that height: revisit it for a much taller or shorter mascot
    const { fitH, fitW } = FRAMING;
    const vFov = THREE.MathUtils.degToRad(this.camera.fov);
    const dH = fitH / 2 / Math.tan(vFov / 2);
    const dW = fitW / 2 / (Math.tan(vFov / 2) * aspect);
    const d = Math.max(dH, dW);
    this.camera.position.set(0, FRAME_Y, d);
    this.camera.lookAt(0, FRAME_Y, 0);                                 // level, so the frontal pose lines up with the front-on artwork
    // tight depth range: the character is ~4 units deep, and the appliqué decals (pupils, catchlights) sit a few thousandths apart
    this.camera.near = Math.max(0.5, d - 4);
    this.camera.far = d + 8;
    this._applyView();
  }

  /**
   * Where the mascot is drawn in the container and how it is turned, for a stage that changes as the page scrolls.  Every value eases there
   * (instantly under reduced motion, or with `immediate`).
   * @param {object} v
   * @param {number} [v.x]    shift right, as a fraction of the container's width (0 = centred)
   * @param {number} [v.y]    shift up, as a fraction of its height
   * @param {number} [v.zoom] magnification about the centre (1 = the whole figure, about 2 = head and shoulders)
   * @param {number} [v.yaw]  extra turn of the whole body, radians (ignored under reduced motion)
   */
  setView(v = {}, { immediate = false } = {}) {
    for (const k of ['x', 'y', 'zoom', 'yaw']) if (Number.isFinite(v[k])) this.viewTarget[k] = v[k];
    if (immediate) { Object.assign(this.view, this.viewTarget); this._applyView(); }
  }

  /** Put the camera where `view` says: a shifted window of the same projection (so the perspective never changes) and a zoom. */
  _applyView() {
    const { x, y, zoom } = this.view, cam = this.camera, el = this.renderer.domElement;
    const W = el.clientWidth || 1, H = el.clientHeight || 1;
    cam.zoom = zoom;
    if (Math.abs(x) > 1e-4 || Math.abs(y) > 1e-4) cam.setViewOffset(W, H, -x * W, y * H, W, H); else cam.clearViewOffset();
    cam.updateProjectionMatrix();
    this._updateNapZoom?.();
  }

  setState(state) {
    if (!STATES[state]) throw new RangeError(`Unknown Mascot state: ${state}`);
    if (state === 'working' && this.state === 'working') return;            // (already at work: asking again must not stand it up to sit down again)
    if (this.state === 'working' && !this.reducedMotion) this.dismount = { t: 0, worked: this.elapsed, D: dismountTime(state) };
    else if (state === 'working') this.dismount = null;
    // the new state's own motion waits for the seat to be put away (or starts at once from it, for a celebration)
    this.lead = this.dismount ? Math.max(0, dismountLead(state) - this.dismount.t) : 0;
    this.state = state;
    this.elapsed = 0;
    if (this.blink.t < 0 && this.random() < 0.5) this.blink.next = this.time + 0.12 + this.random() * 0.2;         // a change of mind is often marked by a blink
    this.dispatchEvent(new CustomEvent('statechange', { detail: { state } }));
  }
  /**
   * A small reaction to being poked (a click or a tap on the mascot): a startled blink, a little hop and nod, a flick of the ears, a bigger
   * smile.  It adds to whatever state it is in (and does nothing under reduced motion), so it can be repeated freely.
   */
  poke() {
    if (this.reducedMotion || !this.loaded) return;
    this._poke = { t: 0 };
    if (this.blink.t < 0) { this.blink.t = 0; this.blink.double = false; }
    for (const e of Object.values(this.ears)) e.vz += (this.random() < 0.5 ? 1 : -1) * 6;
  }
  setReducedMotion(value) { this.reducedMotion = Boolean(value); }
  setVoiceLevel(value) { this.voice = value === undefined ? undefined : THREE.MathUtils.clamp(value, 0, 1); }

  /** Advance the idle blink clock; returns the current closure. Blinks come every 2.4-6 s, sometimes doubled, and often right after the state changes. */
  _stepBlink(dt) {
    const b = this.blink, total = BLINK.close + BLINK.hold + BLINK.open;
    if (b.t >= 0) {
      b.t += dt;
      if (b.t >= total) {
        b.t = -1;
        if (b.double) { b.double = false; b.next = this.time + 0.12; }
        else b.next = this.time + 2.4 + this.random() * 3.6;
      }
    } else if (this.time >= b.next) {
      b.t = 0;
      b.double = this.random() < 0.16;
    }
    return b.t >= 0 ? blinkAmount(b.t) : 0;
  }

  /** Small, unhurried glances - eyes are never perfectly still.  Seeded, so recordings repeat. */
  _stepGlance(dt) {
    const g = this.glance;
    g.next -= dt;
    if (g.next <= 0) {
      const big = this.random() < 0.3;
      g.tx = (this.random() - 0.5) * (big ? 0.5 : 0.14);
      g.ty = (this.random() - 0.5) * (big ? 0.34 : 0.1);
      if (this.random() < 0.35) { g.tx = 0; g.ty = 0; }                // ... and often back to looking straight ahead
      g.next = 0.7 + this.random() * 2.6;
    }
    const a = 1 - Math.exp(-dt * 26);                                    // saccades are quick
    g.x += (g.tx - g.x) * a; g.y += (g.ty - g.y) * a;
    return g;
  }

  _applyPose(dt) {
    const { rig, cur } = this;
    const reduced = this.reducedMotion;
    // ---- ease current toward target ------------------------------------------
    const steps = Math.max(1, Math.ceil(dt * 120));              // (a spring is integrated in steps of at most 1/120 s so it stays stable)
    for (const k of KEYS) {
      if (k === 'p.confetti') { cur[k] = this.tgt[k]; continue; }
      const sp = this.spring[k];
      if (sp && !reduced && dt > 0) {
        let v = this.vel[k] ?? 0, x = cur[k];
        const h = dt / steps;
        for (let i = 0; i < steps; i++) { v += (sp.w * sp.w * (this.tgt[k] - x) - 2 * sp.z * sp.w * v) * h; x += v * h; }
        cur[k] = x; this.vel[k] = v;
        continue;
      }
      this.vel[k] = 0;
      const rate = (this.tgt[k] < cur[k] ? RATE_DOWN[k] : undefined) ?? RATE[k] ?? RATE.default;
      const a = reduced || dt === 0 ? 1 : 1 - Math.exp(-dt * rate);
      cur[k] += (this.tgt[k] - cur[k]) * a;
    }
    // ---- whole-body motion + bones -------------------------------------------
    applyBodyPose(rig, cur, reduced ? 0 : (this.turntable ? this.spin : 0) + this.view.yaw);
    // ---- ears: springy follow-through on head motion ------------------------
    if (dt > 0 && !reduced) {
      const hv = { y: (cur['head.y'] - this.prevHead.y) / dt, z: (cur['head.z'] - this.prevHead.z) / dt, r: (cur['root.y'] - this.prevHead.rootY) / dt };
      for (const [tag, s] of [['L', 1], ['R', -1]]) {
        const e = this.ears[tag];
        const dz = -hv.y * 0.05 * s - hv.z * 0.06 - hv.r * 0.05 * s;
        const dx = hv.r * 0.03;
        const k = 90, c = 9;
        e.vz += (-k * e.z - c * e.vz + dz * 60) * dt; e.z += e.vz * dt;
        e.vx += (-k * e.x - c * e.vx + dx * 60) * dt; e.x += e.vx * dt;
        e.z = THREE.MathUtils.clamp(e.z, -0.45, 0.45); e.x = THREE.MathUtils.clamp(e.x, -0.35, 0.35);
        const bone = rig.byName['ear' + tag];
        bone.rotation.z += e.z; bone.rotation.x += e.x;
      }
    }
    this.prevHead.y = cur['head.y']; this.prevHead.z = cur['head.z']; this.prevHead.rootY = cur['root.y'];
    // ---- face ----------------------------------------------------------------
    let blink = 0;
    if (this._blinkOverride != null) blink = this._blinkOverride;
    else if (!reduced && this.state !== 'resting') blink = this._stepBlink(dt);
    const face = rig.face;
    const glance = !reduced && this.state !== 'resting' ? this._stepGlance(dt) : this.glance;
    const gx = cur['f.gx'] + glance.x, gy = cur['f.gy'] + glance.y;
    face.setGaze(gx, gy, cur['f.cv']);
    // the upper lid rides the eyeball: it comes down a little when the mascot looks down
    face.setLids(Math.max(cur['f.lt'], 0.16 * Math.max(0, -gy)), cur['f.lb'], cur['f.tilt'], blink);
    face.setSleep(cur['f.sleep']);
    face.setMouth({ smile: cur['f.smile'], width: cur['f.mw'], open: Math.max(0, cur['f.mo']) });
    face.setBlush(cur['f.blush']);
    // ---- props, ground -------------------------------------------------------------
    this.rig.byName.wristL.getWorldPosition(this._hand);
    this.rig.root.worldToLocal(this._hand);                       // props live under the rig root
    this.props.update({ time: this.time, phones: cur['p.phones'], laptop: cur['p.laptop'], card: cur['p.card'], confettiT: cur['p.confetti'], hop: cur['root.y'], typeL: cur['p.typeL'], typeR: cur['p.typeR'], hand: this._hand });
    // seated (working): the body's descent is not a hop, and the mass spreads forward over the legs and the laptop on a floor
    // that sits a little lower (see SEAT in mascot-pose.js), so the contact shadow widens, deepens and moves down with it
    const sit = cur['p.sit'];
    const lift = Math.min(1, (cur['root.y'] - SEAT.y * sit) * 2.4);
    this.blob.scale.set(1 - lift * 0.35 + 0.42 * sit, 1 - lift * 0.35 + 0.75 * sit, 1);
    this.blob.material.opacity = Math.min(1, 1 - lift * 0.5 + 0.12 * sit);
    this.blob.position.set(0.1 + 0.08 * sit, 0.004 + SEAT.ground * sit, 0.22 * sit);
    this.cast.scale.setScalar(1 - lift * 0.22 + 0.15 * sit);
    this.cast.material.opacity = 1 - lift * 0.4;
    this.cast.position.set(-0.65 + 0.12 * sit, 0.003 + SEAT.ground * sit, -0.35 + 0.35 * sit);
  }

  /**
   * Advance the simulation by `dt` seconds and (optionally) render.  The render loop calls this every frame; tests
   * and offline recordings can pause the loop and step it at a fixed rate for perfectly repeatable output.
   */
  advance(dt, { render = true } = {}) {
    if (!this.loaded) return;
    this.elapsed += dt;
    this.time += dt;
    if (this.dismount && (this.dismount.t += dt) >= this.dismount.D) this.dismount = null;
    if (this.turntable) this.spin += dt * 0.4;
    else if (this.spin !== 0) {                    // ease back to facing forward by the shortest way round instead of snapping
      const turn = Math.PI * 2;
      let d = this.spin % turn;
      if (d > Math.PI) d -= turn; else if (d < -Math.PI) d += turn;
      d *= Math.exp(-dt * 5);
      this.spin = Math.abs(d) < 1e-3 ? 0 : d;
    }
    // the camera's framing eases to its target
    const vk = this.reducedMotion ? 1 : 1 - Math.exp(-dt * 4.2);
    let moved = false;
    for (const k of ['x', 'y', 'zoom', 'yaw']) {
      const d = this.viewTarget[k] - this.view[k];
      if (d === 0) continue;
      this.view[k] = Math.abs(d) < 1e-4 ? this.viewTarget[k] : this.view[k] + d * vk;
      moved ||= k !== 'yaw';
    }
    if (moved) this._applyView();
    // smoothed pointer: eyes lead, head follows
    const a = 1 - Math.exp(-dt * 7);
    this._look.x += (this.look.x - this._look.x) * a;
    this._look.y += (this.look.y - this._look.y) * a;
    computePose(this.state, Math.max(0, this.elapsed - this.lead), { time: this.time, lookX: this._look.x, lookY: this._look.y, reduced: this.reducedMotion, voice: this.voice, dismount: this.dismount }, this.tgt);
    if (this._poke) this._pokeTargets(dt);
    this._applyPose(dt);
    if (render) this._render();
  }

  /** Draw a frame; while the governor is probing, also time it to completion (a one-pixel read-back waits for the GPU). */
  _render() {
    const probe = this._gov?.probe;
    if (!probe) { this.renderer.render(this.scene, this.camera); return; }
    const gl = this.renderer.getContext(), t0 = performance.now();
    this.renderer.render(this.scene, this.camera);
    gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, this._px ??= new Uint8Array(4));
    probe.sum += performance.now() - t0; probe.n++;
  }

  /** The poke reaction, added onto this frame's targets (a quick attack and a soft release; seated, it does not hop). */
  _pokeTargets(dt) {
    const p = this._poke, k = this.tgt, t = (p.t += dt);
    if (t > 1.4) { this._poke = null; return; }
    const env = Math.exp(-t * 4.5) * Math.sin(Math.min(1, t / 0.1) * Math.PI / 2), up = 1 - Math.min(1, k['p.sit']);
    k['root.y'] += 0.07 * up * Math.sin(Math.min(1, t / 0.3) * Math.PI);
    k['head.x'] += 0.2 * env; k['head.z'] += 0.06 * Math.sin(t * 20) * env;
    k['f.smile'] = Math.max(k['f.smile'], 0.55 + 0.5 * env);
  }

  _frame(now) {
    if (this.disposed) return;
    this.frame = requestAnimationFrame(this._frame);
    // what the display's frame interval is (an average of plausible intervals), so the pacing below can allow half a frame of slack
    const tick = now - this._tick.at;
    this._tick.at = now;
    if (tick > 2 && tick < 50) this._tick.refresh += (tick - this._tick.refresh) * 0.1;
    const since = now - this.last;
    // pace: draw every k-th display frame, k the whole number that brings the display's rate nearest the limit from above (a
    // 120 Hz screen draws every 2nd frame, 144 Hz every 2nd (72 fps), 240 Hz every 4th; 75 or 90 Hz draw every frame), so the frames
    // are evenly spaced instead of beating against the display
    if (this.fps && since < (Math.max(1, Math.floor(1000 / this._tick.refresh / this.fps + 0.3)) - 0.5) * this._tick.refresh) return;
    this.last = now;
    if (this.contextLost) return;
    if (this.paused && this.loaded) { this.renderer.render(this.scene, this.camera); return; }
    if (document.hidden || !this.inView || !this.loaded) return;
    this._watchPerformance(since, now);
    this.advance(Math.min(since / 1000, 0.05));
  }

  /** Render statistics for the last frame (used by the QA script and handy when profiling on a device). */
  telemetry() {
    const { render, memory } = this.renderer.info;
    return { quality: this.quality, triangles: render.triangles, calls: render.calls, geometries: memory.geometries, textures: memory.textures, pixelRatio: this.renderer.getPixelRatio(), perfLevel: this.perfLevel };
  }

  /** Deterministic still for tests and stills: jump to `state` at `t` seconds with no easing. */
  freeze(state, t = 0, { time = 0, voice, look = [0, 0], override = {}, blink } = {}) {
    this.paused = true;
    this._blinkOverride = blink ?? null;                       // (a still normally has open eyes; pass blink 0..1 to hold a blink at that closure)
    this.state = state;
    this.elapsed = t;
    this.lead = 0; this.dismount = null;
    this.time = time;
    computePose(state, t, { time, lookX: look[0], lookY: look[1], reduced: false, voice }, this.tgt);
    Object.assign(this.tgt, override);
    Object.assign(this.cur, this.tgt);
    this.vel = {};
    this.glance = { x: 0, y: 0, tx: 0, ty: 0, next: 1.2 };
    this._applyPose(0);
    this._applyPose(0);                                        // (twice: the laptop's seat changes the skeleton after the hand was measured for the card, so a still after 'working' needs a second pass)
    this.renderer.render(this.scene, this.camera);
  }
  resume() { this.paused = false; this.last = performance.now(); }

  /**
   * The frame-rate governor.  The frames actually drawn are timed in windows of 0.6 s.  A window that misses the target pace by more
   * than ~12% twice running (or once, by half as much again) may mean a GPU that cannot keep up, but it may just as well mean that the
   * browser or the display is holding the pace down (Energy Saver, Low Power Mode, a 30 Hz screen), where spending quality buys
   * nothing.  So three frames are timed to completion (`_render`): only if a frame really takes more than three quarters of its
   * budget does it take the next step down a ladder of costs, least visible first: half the fuzz layers, a 1.5x pixel ratio, no fuzz
   * layers, 1.25x, 1x (each step is skipped when the tier is already at or below it).  On a 2x screen the fuzz layers are about three
   * quarters of a frame, so one step is usually enough.  It only ever steps down: a frame that is held to the display's rate hides how
   * much time there was to spare, so there is no honest signal to climb back on.
   */
  _watchPerformance(ms, now) {
    const g = this._gov ?? (this._gov = { n: 0, sum: 0, bad: 0, probe: null, avg: 0, from: now + 1500 });        // (the first frames compile shaders)
    if (this.paused || ms > 250) return;                          // (a stall - tab switch, debugger, resize - says nothing about the GPU)
    const budget = 1000 / (this.fps || 60);
    if (g.probe) {
      if (g.probe.n < 3) return;                                  // (still timing frames to completion)
      const gpu = g.probe.sum / g.probe.n;
      g.probe = null; g.n = 0; g.sum = 0; g.bad = 0;
      if (gpu > budget * 0.75) { if (this._degrade(g.avg, gpu)) g.from = now + 800; }
      else g.from = now + 5000;                                   // a frame fits its budget easily: the pace is being held down from outside
      return;
    }
    if (now < g.from) return;                                     // (a fresh setting needs a moment to settle too)
    if (!g.n) g.t0 = now;
    g.n++; g.sum += ms;
    if (now - g.t0 < 600 || g.n < 10) return;
    const avg = g.sum / g.n;
    g.n = 0; g.sum = 0;
    if (avg < budget * 1.12) { g.bad = 0; return; }
    if (++g.bad < 2 && avg < budget * 1.5) return;
    g.avg = avg; g.probe = { sum: 0, n: 0 };
  }

  /** Take the next step down the cost ladder that changes anything; false when there is none left. */
  _degrade(avgMs, gpuMs) {
    const shells = [];
    this.rig?.root.traverse((o) => { if (o.isSkinnedMesh && /Shell\d+$/.test(o.name) && o.visible) shells.push(o); });
    const hide = (list) => { list.forEach((o) => { o.visible = false; }); return list.length > 0; };
    const cap = (ratio) => { if (this.renderer.getPixelRatio() <= ratio + 1e-3) return false; this.renderer.setPixelRatio(ratio); this._resize(); return true; };
    const ladder = [
      () => hide(shells.filter((o) => Number(o.name.match(/(\d+)$/)[1]) % 2 === 1)),      // every other fuzz layer
      () => cap(1.5),
      () => hide(shells),                                                                    // no fuzz layers
      () => cap(1.25),
      () => cap(1),
    ];
    while (this.perfLevel < ladder.length) {
      if (ladder[this.perfLevel++]()) {
        this.dispatchEvent(new CustomEvent('quality', { detail: { level: this.perfLevel, avgMs, gpuMs, pixelRatio: this.renderer.getPixelRatio(), shells: shells.filter((o) => o.visible).length } }));
        return true;
      }
    }
    return false;
  }

  /** Transparent PNG of the current view (no floor). */
  snapshot() {
    const vis = [this.ground.visible, this.blob.visible], view = { ...this.view };
    this.ground.visible = this.blob.visible = false;      // (ground === the cast shadow)
    Object.assign(this.view, { x: 0, y: 0, zoom: 1 }); this._applyView();               // (always the whole figure, however the page has framed it)
    this.renderer.render(this.scene, this.camera);
    const url = this.renderer.domElement.toDataURL('image/png');
    [this.ground.visible, this.blob.visible] = vis;
    Object.assign(this.view, view); this._applyView();
    this.renderer.render(this.scene, this.camera);
    return url;
  }

  /** Lightweight GLB with the skeleton, vertex-coloured felt and ten baked clips. */
  async exportGLB() {
    const { exportMascotGLB } = await import('./mascot-export.js');
    return exportMascotGLB(this.data);
  }

  dispose() {
    this.disposed = true;
    cancelAnimationFrame(this.frame);
    this.resizeObserver.disconnect();
    this.intersectionObserver.disconnect();
    this._pointerTarget.removeEventListener('pointermove', this._pointer);
    (this._pointerTarget === window ? document.documentElement : this.container).removeEventListener('pointerleave', this._leave);
    this.renderer.domElement.removeEventListener('webglcontextlost', this._ctxLost);
    this.renderer.domElement.removeEventListener('webglcontextrestored', this._ctxRestored);
    disposeObject(this.scene);
    this.env.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}

export function disposeObject(root) {
  const geos = new Set(), mats = new Set(), textures = new Set();
  root.traverse((o) => {
    if (o.geometry) geos.add(o.geometry);
    for (const m of [].concat(o.material ?? [])) {
      mats.add(m);
      for (const v of Object.values(m)) if (v?.isTexture) textures.add(v);
      for (const v of Object.values(m.userData?.mascot ?? {})) if (v?.value?.isTexture) textures.add(v.value);
    }
  });
  geos.forEach((g) => g.dispose());
  mats.forEach((m) => m.dispose());
  textures.forEach((t) => t.dispose());
}
