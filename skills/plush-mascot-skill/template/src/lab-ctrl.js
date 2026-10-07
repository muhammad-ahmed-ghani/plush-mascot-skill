// Dev-only: the real MascotController in a fixed-size square, for comparing against the artwork.
//   /lab.html?size=1254&state=greeting&t=1.2&yaw=0.5&fov=24&cx=0&cy=1.8&cz=10&tx=0&ty=1.6
// Other query options: time (continuous clock), lx / ly (look target), blink (hold a blink 0..1), o.<pose key>=v (pose overrides), quality, napzoom,
// dbg (output one lighting term), transparent=1 (no floor shadows), near.
// window.lab (used by scripts/dev/*.mjs):
//   renderAt(ppu)      near-orthographic front render at `ppu` drawing-buffer pixels per character unit
//   setParams({...})   env / key / fill / exp and fabric uniforms (p.u), applied to every fabric material
//   evaluate(ppu)      page-scale metrics against the density-matched artwork (see lab-metrics.js)
import * as THREE from 'three';
import { MascotController } from './mascot.js';
import { evaluateAt, sizeFor, TY } from './lab-metrics.js';
import { DEBUG } from './mascot-fabric.js';
import { applyStudio, STUDIO } from './mascot-studio.js';

const q = new URLSearchParams(location.search);
DEBUG.term = +(q.get('dbg') ?? 0);
const size = +(q.get('size') ?? 1254);
const holder = document.createElement('div');
holder.style.cssText = `width:${size}px;height:${size}px;position:relative;`;
document.body.style.margin = '0';
document.body.append(holder);
const mascot = new MascotController(holder, { state: q.get('state') ?? 'idle', quality: q.get('quality') ?? 'high', seed: 1 });
await mascot.ready;
const num = (k, d) => (q.has(k) ? +q.get(k) : d);
mascot.camera.far = 60;
if (q.has('near')) mascot.camera.near = num('near');
if (q.has('fov')) { mascot.camera.fov = num('fov'); }
mascot.camera.updateProjectionMatrix();
const pos = mascot.camera.position;
mascot.camera.position.set(num('cx', pos.x), num('cy', pos.y), num('cz', pos.z));
mascot.camera.lookAt(num('tx', 0), num('ty', 1.6), num('tz', 0));
mascot._frameCamera = () => {};                          // we own the camera from here on
mascot._updateNapZoom();
if (q.has('napzoom')) setNapZoom(num('napzoom'));

const override = {};
for (const [k, v] of q.entries()) if (k.startsWith('o.')) override[k.slice(2)] = +v;
if (q.has('yaw')) override['root.yaw'] = num('yaw');
const stateName = q.get('state') ?? 'idle';
const freezeArgs = { time: num('time', 1), override, look: [num('lx', 0), num('ly', 0)], blink: q.has('blink') ? num('blink') : undefined };
mascot.freeze(stateName, num('t', 1), freezeArgs);
if (q.has('transparent')) { mascot.ground.visible = false; mascot.blob.visible = false; }

function setNapZoom(z) { mascot.napZoom = z; for (const m of mascot._fabricMaterials) m.userData.mascot.uNapZoom.value = z; }

/** Frame a near-orthographic front view so one character unit spans `ppu` drawing-buffer pixels. */
function frameAt(ppu, sz = sizeFor(ppu)) {
  holder.style.width = holder.style.height = `${sz}px`;
  mascot.renderer.setPixelRatio(1);
  mascot._resize();                                      // reads the holder's size
  const fov = 6, visible = sz / ppu, dist = visible / (2 * Math.tan((fov * Math.PI) / 360));
  mascot.camera.fov = fov; mascot.camera.aspect = 1;
  mascot.camera.near = Math.max(0.5, dist - 5); mascot.camera.far = dist + 8;
  mascot.camera.position.set(0, TY, dist);
  mascot.camera.lookAt(0, TY, 0);
  mascot.camera.updateProjectionMatrix();
  mascot._updateNapZoom();
  mascot.freeze('idle', 1, { time: 0, override: { 'root.yaw': 0 }, look: [0, 0] });          // time 0: no breathing or sway, so the figure sits exactly where the artwork does
  mascot.ground.visible = false; mascot.blob.visible = false;
  mascot.renderer.setClearColor(0x000000, 0);
  return sz;
}

function setParams(p = {}) {
  if (p.env !== undefined) mascot.scene.environmentIntensity = p.env;
  if (p.exp !== undefined) mascot.renderer.toneMappingExposure = p.exp;
  const lightKeys = ['key', 'keyAz', 'keyEl', 'fill', 'fillAz', 'fillEl', 'bounce', 'bounceAz', 'hemi', 'shadowSoft', 'shadowInt'];
  if (lightKeys.some((k) => p[k] !== undefined)) {
    mascot._studioV = { ...(mascot._studioV ?? {}), ...Object.fromEntries(lightKeys.filter((k) => p[k] !== undefined).map((k) => [k, p[k]])) };
    applyStudio({ key: mascot.key, fill: mascot.fill, bounce: mascot.bounce, hemi: mascot.hemi }, mascot._studioV);
  }
  if (p.napZoomScale !== undefined) mascot._napZoomScale = p.napZoomScale;
  if (p.cordAmp !== undefined || p.cordBump !== undefined || p.cordBright !== undefined) mascot.rig.face.setCord({ amp: p.cordAmp, bump: p.cordBump, brightness: p.cordBright });
  for (const m of mascot._fabricMaterials) {
    for (const [k, v] of Object.entries(p.u ?? {})) if (m.userData.mascot[k]) m.userData.mascot[k].value = v;
    if (p.gr !== undefined) m.userData.mascot.uBaseGain.value.set(p.gr, p.gg ?? p.gr, p.gb ?? p.gr);
    if (p.fk !== undefined) m.userData.mascot.uFaceGain.value.set(p.fk, p.fk, p.fk);
    if (p.sheen !== undefined) m.sheen = p.sheen;
    if (p.sr !== undefined) m.sheenRoughness = p.sr;
  }
}

/** The live values of every tunable that setParams() understands (same key names), so a tuner can start from what the page really uses. */
function getParams() {
  const m = mascot._fabricMaterials.find((x) => x.customProgramCacheKey().endsWith('base-body')) ?? mascot._fabricMaterials[0];      // the main body fabric
  const u = m.userData.mascot;
  const L = { ...STUDIO, ...(mascot._studioV ?? {}) };
  const out = {
    env: mascot.scene.environmentIntensity, exp: mascot.renderer.toneMappingExposure,
    gr: u.uBaseGain.value.x, gg: u.uBaseGain.value.y, gb: u.uBaseGain.value.z, fk: u.uFaceGain.value.x,
    key: L.key, keyAz: L.keyAz, keyEl: L.keyEl, fill: L.fill, fillAz: L.fillAz, fillEl: L.fillEl,
    bounce: L.bounce, bounceAz: L.bounceAz, hemi: L.hemi, shadowSoft: L.shadowSoft, shadowInt: L.shadowInt,
    sheen: m.sheen, sr: m.sheenRoughness,
  };
  for (const [k, v] of Object.entries(u)) if (typeof v.value === 'number') out[`u.${k}`] = v.value;
  const thread = mascot.rig.face.mats.thread;
  out.cordAmp = thread.userData.cord.getAmp(); out.cordBump = thread.bumpScale; out.cordBright = thread.color.r;
  return out;
}

window.lab = {
  mascot, setParams, getParams, frameAt,
  napZoom: () => mascot.napZoom,
  toDataURL() { mascot.renderer.render(mascot.scene, mascot.camera); return mascot.renderer.domElement.toDataURL('image/png'); },
  renderAt(ppu) { frameAt(ppu); mascot.renderer.render(mascot.scene, mascot.camera); },
  async evaluate(ppu) { frameAt(ppu); mascot.renderer.render(mascot.scene, mascot.camera); return evaluateAt(mascot.renderer.domElement, ppu); },
};
window.__labReady = true;
