// The laptop for the working state, after the artwork's top-left vignette: a slim charcoal aluminium unibody on four rubber feet,
// softly rounded edges and a tapered underside, a black keyboard well of individual keycaps flanked by speaker grilles, a glass
// trackpad, ports on both sides, a hinge barrel along the back of the deck, and a thin lid, plain and matte on the back apart from a
// faint embossed emblem, with a glowing screen that shows a small procedural UI.
//
// Authored in its own frame (origin on the floor under the base centre, +z toward the user, +x the user's right) and placed in the
// rig root's space in front of the seated Mascot at SEAT.laptop (src/mascot-pose.js), so the default view sees the back of the lid rising
// on the right and the deck with the keys and his right hand beside it, like the artwork.
//
// update({ laptop, time, hop }): `laptop` 0..1 is the eased presence (p.laptop, eased at RATE 5 in mascot.js).  0-0.22 it slides in
// a short way along the floor, fading in, and tips onto its leading edge; the lid starts to rise at 0.07 (so it is never a flat
// closed slab on the floor for more than a beat) and swings open to ~107 degrees with an ease-out and a slight overshoot, and the
// screen wakes.  Leaving, the same curve runs backwards on the exponential ease: the lid gives a tiny lift, closes and the screen
// goes dark, then the laptop slides away and fades.  Every frame the
// keys under Mascot's actual hand balls are pushed down by the hands (so the key that goes down is the one under the hand that goes
// down), and each full keystroke adds a character on the screen.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { sweepGeometry, slabProfile, roundedPlane, plate } from './lp-geometry.js';
import { beadBlastMaps, lidBackMaps, deckMaps, ScreenUI } from './lp-textures.js';
import { buildKeyboard } from './lp-keyboard.js';
import { createSeat } from './lp-seat.js';
import { clamp01, smooth, easeOutCubic, window01 } from './shared.js';
import { SEAT, HAND_R } from '../mascot-pose.js';

// dimensions (character units; Mascot is ~3.3 tall and one unit is ~22 cm of plush, so this is a ~14-inch machine)
export const LAPTOP = {
  W: 1.34, D: 0.86, HB: 0.052, FEET: 0.006, RC: 0.05,            // base: width, depth, body height, rubber feet, plan corner radius
  TL: 0.017, HL: 0.83,                                             // lid thickness and height
  PALM: 0.3,                                                       // depth of the palm rest in front of the keyboard well
  OPEN: THREE.MathUtils.degToRad(107),
  KB: { width: 1.06, capH: 0.0055, travel: 0.0035, well: 0.0045 },
};
/** Height of the key tops above the floor (the working pose rests the hands on it: SEAT.laptop.keyTop). */

const ALU = '#56565b';            // charcoal anodised aluminium: under the studio's warm light it renders as the artwork's warm grey (~#544a49)
const TIP = THREE.MathUtils.degToRad(2.2);
const SLIDE = 0.22;               // share of the presence spent sliding in
const OPEN_FROM = 0.07;           // the lid starts rising here, while the laptop is still arriving
const _v = new THREE.Vector3(), _c = new THREE.Vector3(), _e = new THREE.Vector3(), _m = new THREE.Matrix4();
// hand-ball centre relative to the wrist joint, rest pose (the sculpt's hand centre minus the skeleton's wrist)
const REST_HAND = { L: new THREE.Vector3(0.896 - 0.82209, 0.892 - 0.94748, 0.07 - 0.0605), R: new THREE.Vector3(-(0.896 - 0.82209), 0.892 - 0.94748, 0.07 - 0.0605) };

export function buildLaptop(emblem = null) {
  const { W, D, HB, FEET, RC, TL, HL, KB, PALM } = LAPTOP;
  const group = new THREE.Group();
  group.name = 'Laptop';
  const inner = new THREE.Group();                                   // everything that slides, tips and fades
  group.add(inner);
  const disposables = [];

  // ---- materials ----------------------------------------------------------------------------------------------------------------
  const grain = beadBlastMaps(256);
  // anodised, bead-blasted faces (matte: they read as the artwork's dark warm grey) and polished chamfers along the top edges of the
  // base and the lid, which catch the studio's windows the way the artwork's lid rim does
  const aluParams = { color: ALU, metalness: 0.3, roughness: 0.6, specularIntensity: 1 };
  const alu = new THREE.MeshPhysicalMaterial({ ...aluParams, normalMap: grain.normal, normalScale: new THREE.Vector2(1.1, 1.1), roughnessMap: grain.rough });
  const chamfer = new THREE.MeshPhysicalMaterial({ color: '#6c6c72', metalness: 0.75, roughness: 0.3, clearcoat: 0.4, clearcoatRoughness: 0.25, specularIntensity: 1 });
  const lidMaps = lidBackMaps(1024, W / HL, 0.12, emblem);
  const lidAlu = new THREE.MeshPhysicalMaterial({ ...aluParams, normalMap: lidMaps.normal, normalScale: new THREE.Vector2(2.2, 2.2), roughnessMap: lidMaps.rough });
  // the deck: aluminium around the black well, grilles and glass trackpad (uv 0..1 over the footprint), with the same tiling grain
  const kb = buildKeyboard({ width: KB.width, capH: KB.capH, travel: KB.travel });
  // the keyboard sits well forward (a short palm rest, so Mascot's short arms reach it) with a speaker bar behind it, like a
  // front-keyboard ultraportable; a wide glass trackpad in the palm rest
  const wellM = 0.009;
  const well = { x: 0, w: kb.size.width + 2 * wellM, d: kb.size.depth + 2 * wellM, r: 0.012, depth: KB.well };
  well.z = D / 2 - PALM - well.d / 2;
  const pad = { x: 0, z: D / 2 - PALM / 2 + 0.004, w: 0.44, d: PALM - 0.085, r: 0.018 };
  const grilles = [{ x: 0, z: (well.z - well.d / 2 - D / 2 + 0.03) / 2, w: well.w - 0.02, d: 0.075 }];
  const deckTex = deckMaps({ W, D, well, pad, grilles });
  const deckGrain = grain.normal.clone(); deckGrain.repeat.set(W / 0.22, D / 0.22);
  const deck = new THREE.MeshPhysicalMaterial({ ...aluParams, roughness: 0.62, map: deckTex.map, roughnessMap: deckTex.rm, metalnessMap: deckTex.rm, normalMap: deckGrain, normalScale: new THREE.Vector2(0.9, 0.9) });
  const dark = new THREE.MeshStandardMaterial({ color: '#1f1f23', roughness: 0.55, metalness: 0.35 });
  const glassSize = { w: W - 0.012, h: HL - 0.012 };
  const bezel = { l: 0.02, r: 0.02, t: 0.024, b: 0.048 };
  const ui = new ScreenUI(glassSize, bezel);
  // the display: black anti-reflective glass (a soft, dim reflection of the studio) over the glowing UI
  const glass = new THREE.MeshPhysicalMaterial({ color: '#060608', roughness: 0.16, metalness: 0, clearcoat: 0.5, clearcoatRoughness: 0.08, emissive: '#ffffff', emissiveMap: ui.texture, emissiveIntensity: 0, specularIntensity: 0.5 });
  disposables.push(alu, chamfer, lidAlu, deck, dark, glass, grain.normal, grain.rough, lidMaps.normal, lidMaps.rough, deckTex.map, deckTex.rm, deckGrain, ui, kb);

  // ---- base: unibody on four rubber feet, deck with the recessed keyboard well ---------------------------------------------------
  const baseGeo = sweepGeometry({ hx: W / 2, hz: D / 2, rc: RC, profile: slabProfile({ height: HB, rb: 0.02, rt: 0.0085, taper: 0.011, roundSegs: 6, topSegs: 5 }), cornerSegs: 12, wallUvScale: 1 / 0.22, well, rimRows: 5 });
  const base = new THREE.Mesh(baseGeo, [alu, deck, chamfer]);
  base.name = 'Base';
  base.position.y = FEET;
  base.castShadow = base.receiveShadow = true;
  inner.add(base);
  disposables.push(baseGeo);
  kb.mesh.position.set(well.x, FEET + HB - KB.well, well.z);
  inner.add(kb.mesh);

  // ---- small dark parts, merged: hinge barrel, rubber feet, port openings ---------------------------------------------------------
  const yDeck = FEET + HB;
  const pivotY = yDeck + 0.0015 + TL / 2, pivotZ = -D / 2 + 0.011;
  const parts = [];
  const add = (g, x, y, z, rz = 0) => { if (rz) g.rotateZ(rz); g.translate(x, y, z); parts.push(g.index ? g.toNonIndexed() : g); if (g.index) g.dispose(); };
  add(new THREE.CylinderGeometry(0.0098, 0.0098, W - 0.17, 32, 1), 0, pivotY, pivotZ, Math.PI / 2);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) add(new THREE.CylinderGeometry(0.03, 0.032, FEET + 0.002, 24), sx * (W / 2 - 0.1), (FEET + 0.002) / 2 - 0.001, sz * (D / 2 - 0.09));
  // ports sit in the straight part of the side walls, at mid-height: user's left MagSafe + 2 USB-C + headphone jack, right SD + USB-C + HDMI
  const yPort = FEET + 0.027, wallX = W / 2 - 0.0009;
  const port = (side, z, len, h) => add(plate(0.004, len, h, h / 2), side * wallX, yPort, z, Math.PI / 2);
  port(-1, -0.26, 0.034, 0.0105); port(-1, -0.19, 0.028, 0.0095); port(-1, -0.135, 0.028, 0.0095);
  add(new THREE.CylinderGeometry(0.0055, 0.0055, 0.004, 16), -wallX, yPort, 0.23, Math.PI / 2);
  port(1, -0.24, 0.07, 0.005); port(1, -0.15, 0.028, 0.0095); port(1, -0.07, 0.046, 0.012);
  const darkGeo = mergeGeometries(parts, false);
  parts.forEach((g) => g.dispose());
  const details = new THREE.Mesh(darkGeo, dark);
  details.name = 'Details';
  details.castShadow = details.receiveShadow = true;
  inner.add(details);
  disposables.push(darkGeo);

  // ---- lid on its hinge ---------------------------------------------------------------------------------------------------------
  const pivot = new THREE.Group();
  pivot.name = 'Hinge';
  pivot.position.set(0, pivotY, pivotZ);
  inner.add(pivot);
  const lidGeo = sweepGeometry({ hx: W / 2, hz: HL / 2, rc: RC, profile: slabProfile({ height: TL, rb: 0.0045, rt: 0.0078, taper: 0, roundSegs: 4, topSegs: 6 }), cornerSegs: 12, wallUvScale: 1 / 0.22, rimRows: 6 });
  const lid = new THREE.Mesh(lidGeo, [alu, lidAlu, chamfer]);
  lid.name = 'Lid';
  const lidZ = HL / 2 - (pivotZ + D / 2) + 0.003;                   // closed, the lid's hinge end sits over the barrel's axis
  lid.position.set(0, -TL / 2, lidZ);
  lid.castShadow = lid.receiveShadow = true;
  pivot.add(lid);
  const glassGeo = roundedPlane(glassSize.w, glassSize.h, RC - 0.006, 10);
  const screen = new THREE.Mesh(glassGeo, glass);
  screen.name = 'Screen';
  screen.rotation.x = Math.PI;                                       // faces the keys when closed, the user when open
  screen.position.set(0, -TL / 2 - 0.0004, lidZ);
  screen.receiveShadow = true;
  pivot.add(screen);
  disposables.push(lidGeo, glassGeo);

  // ---- soft contact shadow ------------------------------------------------------------------------------------------------------
  const sc = document.createElement('canvas');
  sc.width = 256; sc.height = 192;
  const sg = sc.getContext('2d');
  const kx = 256 / (W * 1.3), kz = 192 / (D * 1.42);
  const blob = (inset, blur, a) => { sg.filter = `blur(${blur}px)`; sg.fillStyle = `rgba(52,26,22,${a})`; sg.beginPath(); sg.roundRect(128 - (W / 2 - inset) * kx, 96 - (D / 2 - inset) * kz, (W - 2 * inset) * kx, (D - 2 * inset) * kz, RC * kx); sg.fill(); };
  blob(-0.02, 14, 0.42); blob(0.02, 6, 0.4); blob(0.05, 2.5, 0.35);
  const shadowTex = new THREE.CanvasTexture(sc);
  shadowTex.colorSpace = THREE.SRGBColorSpace;
  const shadowMat = new THREE.MeshBasicMaterial({ map: shadowTex, transparent: true, depthWrite: false, fog: false });
  const shadow = new THREE.Mesh(new THREE.PlaneGeometry(W * 1.3, D * 1.42), shadowMat);
  shadow.name = 'ContactShadow';
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.set(0, 0.0012, 0.01);
  shadow.renderOrder = -1;
  inner.add(shadow);
  disposables.push(shadow.geometry, shadowMat, shadowTex);

  group.visible = false;

  // ---- fading ---------------------------------------------------------------------------------------------------------------------
  const fadeMats = [alu, chamfer, lidAlu, deck, dark, glass, kb.mesh.material];
  let fading = null;
  const setFade = (f) => {
    const on = f < 0.999;
    if (on === fading && !on) return;
    for (const m of fadeMats) { if (m.transparent !== on) { m.transparent = on; m.needsUpdate = true; } m.opacity = on ? f : 1; }
    fading = on;
  };

  // ---- reflections: metal and glass need the studio's windows at their own strength ---------------------------------------------
  // (three.js only honours envMapIntensity when a material has its own envMap, so bind the scene's environment explicitly; the
  // controller swaps that texture after a GPU context restore, which is picked up here)
  const envMats = [[alu, 0.2], [lidAlu, 0.2], [deck, 0.22], [chamfer, 0.9], [dark, 0.35], [glass, 0.3], [kb.mesh.material, 0.3]];
  let env = null;
  const syncEnv = () => {
    let n = group;
    while (n.parent) n = n.parent;
    const e = n.environment ?? null;
    if (e === env) return;
    for (const [m, k] of envMats) { m.envMap = e; m.envMapIntensity = k; if (env) m.needsUpdate = true; }
    env = e;
  };

  // ---- the screen redraws (at most ui.fps a second) only while it is drawn facing the camera ------------------------------------
  let clock = 0;
  screen.onBeforeRender = (renderer, scene, camera) => {
    if (glass.emissiveIntensity < 0.01) return;
    screen.getWorldPosition(_c);
    _v.set(0, 1, 0).transformDirection(screen.matrixWorld);                 // the plane's face normal, in world space
    if (_v.dot(camera.getWorldPosition(_e).sub(_c)) > 0) ui.update(clock);
  };

  // ---- hands on the keys ------------------------------------------------------------------------------------------------------------
  const seat = createSeat();
  let wrists = null, lastTime = null;
  /** the hand-ball centre of arm `tag`, in keyboard space (key bottoms at y = 0) */
  const handInKeys = (tag) => { wrists[tag].updateWorldMatrix(true, false); return _v.copy(REST_HAND[tag]).applyMatrix4(wrists[tag].matrixWorld).applyMatrix4(_m.copy(kb.mesh.matrixWorld).invert()); };

  return {
    group, keyboard: kb, ui,
    update({ laptop = 0, time = 0, hop = 0 }) {
      // a live frame is at most 0.05 s (the controller clamps it); anything else (a still, a time jump) snaps the springy parts
      const raw = lastTime === null ? 0 : time - lastTime, dt = raw > 0 && raw <= 0.051 ? raw : 0;
      lastTime = time; clock = time;
      seat.update(group, hop, laptop, dt);
      syncEnv();
      const p = clamp01(laptop);
      group.visible = p > 0.02;
      if (!group.visible) { kb.reset(); return; }
      const rigRoot = seat.root;
      // the props ride the rig root (its yaw is wanted), but a laptop on the floor must not follow the body's height or squash
      const sy = rigRoot ? rigRoot.scale.y : 1, sxz = rigRoot ? rigRoot.scale.x : 1;
      group.scale.set(1 / sxz, 1 / sy, 1 / sxz);
      group.position.set(SEAT.laptop.x, (SEAT.ground - hop) / sy, SEAT.laptop.z);
      group.rotation.set(0, Math.PI + SEAT.laptop.yaw, 0);
      // phase 1: slide in along the floor from the viewer's right-front, fading in; tip onto the leading edge as it stops
      const s1 = window01(p, 0, SLIDE), e1 = easeOutCubic(s1);
      const tip = s1 < 1 ? TIP * Math.sin(Math.PI * window01(s1, 0.74, 1)) : 0;
      const lead = D / 2;                                                        // the tip pivots on the leading (user-side) bottom edge
      inner.rotation.x = tip;
      inner.position.set(-0.2 * (1 - e1), lead * Math.sin(tip), -0.45 * (1 - e1) + lead * (1 - Math.cos(tip)));
      // (opaque once the lid has begun to rise, gone by the time it is shut: a closed slab on the floor is never more than a flicker)
      const vis = smooth(window01(p, 0.025, 0.14));
      setFade(vis);
      shadowMat.opacity = vis * smooth(window01(s1, 0.1, 0.95)) * (1 - 0.3 * tip / TIP);
      // phase 2 (overlapping the arrival): the lid swings open with an ease-out and a slight overshoot; the screen wakes as it passes ~50 degrees
      const s2 = window01(p, OPEN_FROM, 1);
      const open = s2 <= 0 ? 0 : 1 - Math.pow(1 - s2, 3) + 0.045 * Math.sin(Math.PI * Math.pow(s2, 0.8)) * s2;
      pivot.rotation.x = -LAPTOP.OPEN * open;
      glass.emissiveIntensity = smooth(window01(s2, 0.4, 0.95)) * 1.25;
      // hands: push down the keys under Mascot's hand balls (they rest on the keys with a soft dent; a keystroke goes deeper)
      kb.begin();
      if (rigRoot && s2 > 0.6) {
        if (!wrists) wrists = { L: rigRoot.getObjectByName('wristL'), R: rigRoot.getObjectByName('wristR') };
        if (wrists.L && wrists.R) {
          group.updateWorldMatrix(true, true);                                    // (this frame's rig transform, not last frame's)
          const r = HAND_R * sy;
          for (const tag of ['L', 'R']) { const h = handInKeys(tag); kb.press(h.x, h.y, h.z, r, SEAT.dent * 1.25); }
        }
      }
      const downs = kb.end(dt);
      for (let i = 0; i < downs.length; i++) ui.keystroke();
    },
    dispose() { for (const d of disposables) d.dispose?.(); },
  };
}
