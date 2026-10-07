// Over-ear headphones worn on the hood (working state), modelled on the top-left vignette of assets/mascot-use-cases.png:
// a thick, softly padded charcoal band arching over the crown between the bear-ears, deep rounded-oval cups with a
// fuzzy felt outer face inside a thin graphite trim ring, soft ear cushions moulded to the hood, and a short slider
// block on top of each cup that the band runs into.  Everything except the trim is the same charcoal felt family
// as the face plate (the studio's fabric shader, forced to its charcoal branch).
//
// Authored in the head's REST space (head centre (0, 2.2, 0)); the controller parents the group to the head bone, so
// the worn headphones ride every nod and tilt for free.  Numbers marked (SDF) were sampled from the sculpt in
// scripts/bake/model.mjs and are hard-coded here because browser code must not import from scripts/.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeGeometries, mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { createFabricMaterial } from '../mascot-fabric.js';
import { ovalSweep, arcStations, roundedRectLoop, tubeSweep, plainAttributes, hermite, resample2, smoothstep } from './hp-geometry.js';

// ----------------------------------------------------------------------------------------------- measurements ----
const HEAD_CY = 2.2;                      // head centre height; the band's route is polar around (0, HEAD_CY)
const ZC = 0.14;                          // band plane (just in front of the bear-ears' front faces, which reach z ~ 0)
const HW_CROWN = 0.12, HW_END = 0.08;     // band half width (z) at the crown / at the slider
const HT_CROWN = 0.0525, HT_END = 0.065;  // band half thickness (radial): the artwork's band thickens toward the cups
const GAP = 0.012;                        // the band shell floats this far above the hood; the cushion strip fills it
const TH_HUG = 40;                        // degrees from horizontal where the band peels off the hood toward the cups
// (SDF) hood radius from (0, HEAD_CY) at angle th = 0..180 step 5 deg, fitted across the band's width as
// r(u) = r0 + a u + b u^2 with u = z - ZC (the crown is higher toward z = 0, so the band's inner face has to lean).
const BAND_HOOD = [[1.0955,-0.1916,-0.753],[1.0811,-0.19,-0.747],[1.0696,-0.1889,-0.743],[1.059,-0.1883,-0.741],[1.0484,-0.1886,-0.742],[1.037,-0.2009,-0.615],[1.024,-0.256,-0.053],[1.0093,-0.3194,0.566],[0.9925,-0.3293,0.65],[0.9729,-0.3295,0.655],[0.9512,-0.2589,-0.037],[0.9283,-0.2011,-0.629],[0.9045,-0.1868,-0.736],[0.8816,-0.1825,-0.719],[0.8612,-0.1783,-0.704],[0.8441,-0.1748,-0.69],[0.8312,-0.1722,-0.68],[0.8229,-0.1705,-0.673],[0.82,-0.1698,-0.67],[0.8229,-0.1705,-0.673],[0.8312,-0.1722,-0.68],[0.8441,-0.1748,-0.69],[0.8612,-0.1783,-0.704],[0.8816,-0.1825,-0.719],[0.9045,-0.1868,-0.736],[0.9283,-0.2011,-0.629],[0.9512,-0.2589,-0.037],[0.9729,-0.3295,0.655],[0.9925,-0.3293,0.65],[1.0093,-0.3194,0.566],[1.024,-0.256,-0.053],[1.037,-0.2009,-0.615],[1.0484,-0.1886,-0.742],[1.059,-0.1883,-0.741],[1.0696,-0.1889,-0.743],[1.0811,-0.19,-0.747],[1.0955,-0.1916,-0.753]];
function hoodAt(deg) {
  const f = Math.min(180, Math.max(0, deg)) / 5, i = Math.min(35, Math.floor(f)), t = f - i;
  const A = BAND_HOOD[i], B = BAND_HOOD[i + 1];
  return [A[0] + (B[0] - A[0]) * t, A[1] + (B[1] - A[1]) * t, A[2] + (B[2] - A[2]) * t];
}

// Cups.  (SDF) the hood's side surface at eye level, and a frame whose X axis leans 7 deg forward and 6 deg up so the
// cushion sits square on the locally sloping hood; the recession of the hood around the cushion ring is then even.
const CUP_Y = 2.14, CUP_Z = ZC, CUP_X = 1.105;
const FRAME_X = [0.98711, 0.10375, 0.12187], FRAME_Y = [-0.10453, 0.99452, 0];
// (SDF) hood surface in that frame: depth t(y, z) <= 0 along the cup axis relative to the contact point, so the cushion's
// inner face can be moulded onto the fur (basis 1, y, y2, z2, y z2, y3, z4, y2 z2, y4, z, y z, y3 z2, y z4; max error 0.005)
const FIT = [0.00001, -0.0163, -0.42228, -0.68464, 0.0322, 0.47436, -0.34019, -0.59351, -0.75176, -0.07674, 0.02777, 0.89884, 0.19441];
const hoodDepth = (y, z) => {
  const y2 = y * y, z2 = z * z;
  return FIT[0] + FIT[1] * y + FIT[2] * y2 + FIT[3] * z2 + FIT[4] * y * z2 + FIT[5] * y2 * y + FIT[6] * z2 * z2 + FIT[7] * y2 * z2 + FIT[8] * y2 * y2 + FIT[9] * z + FIT[10] * y * z + FIT[11] * y2 * y * z2 + FIT[12] * y * z2 * z2;
};
const CUP_A = 0.345, CUP_B = 0.28;        // shell half height / half width (an upright oval, as in the artwork)
const D_CUSH = 0.085;                     // cushion depth: contact plane (x = 0) to the shell's inner face
const X_OUT = D_CUSH + 0.19;              // shell outer face
const DENT = 0.012;                       // how far the cushions press into the fuzz
const PAD_INSET = 0.075, PAD_H = 0.04, PAD_DOME = 0.02;
const YOKE = { w: 0.15, h: 0.14, d: 0.18, r: 0.04, lift: 0.02 };
const PIVOT = new THREE.Vector3(0, 2.55, ZC);

// the controller eases p.phones as 1 - exp(-RATE t) (RATE['p.phones'] in mascot.js); inverting it recovers the time since the
// change, which makes the choreography below a pure, deterministic function of the eased amount (freeze() gets the same frame)
const RATE = 8;

// ------------------------------------------------------------------------------------------------- materials ----
const CHARCOAL = { base: '#342e2f', tip: '#59535c', sheen: '#858089', gain: [1.231, 1.231, 1.231] };   // a hair lighter and greyer than the plate's
const CUSHION = { base: '#3c3638', tip: '#635d65', sheen: '#8a848c', gain: [1.231, 1.231, 1.231] };
function fabric(charcoal, { scale = 1, detail = 1.6, upFibre = 0.5 } = {}) {
  const m = createFabricMaterial({ useFace: true, forceFace: true, part: 'other', charcoal, aoStrength: 1, aoDirect: 0.7 });
  const u = m.userData.mascot;
  u.uFaceVignette.value = 0;             // (the plate's fall-off toward its lower rim does not belong on a prop)
  u.uFaceScale.value = scale;
  u.uFaceDetail.value = detail;
  u.uUpFibre.value = upFibre;
  return m;
}

// ------------------------------------------------------------------------------------------------- geometry ----
function shellGeometry() {
  const ri = 0.03, ro = 0.075;
  const st = [
    { k: 0, x: D_CUSH, ao: 0.85 }, { k: 0.5, x: D_CUSH, ao: 0.85 }, { d: ri, x: D_CUSH, ao: 0.85 },
    ...arcStations([ri, D_CUSH + ri], ri, -Math.PI / 2, -Math.PI, 5).map((s) => ({ ...s, ao: 0.9 })),
    { d: 0, x: X_OUT - ro },
    ...arcStations([ro, X_OUT - ro], ro, Math.PI, Math.PI / 2, 9),
    { d: 0.1, x: X_OUT }, { k: 0.5, x: X_OUT }, { k: 0, x: X_OUT },
  ];
  return ovalSweep(CUP_A, CUP_B, st, 64, { ao: (s) => s.ao ?? 1 });
}
function padGeometry() {
  const x0 = X_OUT - 0.002, r = PAD_H;
  const st = [{ d: 0, x: x0 }, ...arcStations([r, x0], r, Math.PI, Math.PI / 2, 6)];
  for (const k of [0.85, 0.7, 0.5, 0.3]) st.push({ k, x: x0 + r + PAD_DOME * (1 - k * k) });
  st.push({ k: 0, x: x0 + r + PAD_DOME });
  return ovalSweep(CUP_A - PAD_INSET, CUP_B - PAD_INSET, st, 64);
}
function ringGeometry() {
  const dc = PAD_INSET - 0.018, xc = X_OUT + 0.002, rr = 0.02, st = [];
  for (let i = 0; i < 14; i++) { const phi = Math.PI / 2 - (i / 14) * Math.PI * 2; st.push({ d: dc + rr * Math.cos(phi), x: xc + rr * Math.sin(phi) }); }
  return ovalSweep(CUP_A, CUP_B, st, 64, { closed: true });
}
function cushionGeometry(zSign) {
  const dc = 0.072, xc = D_CUSH / 2, rd = 0.062, rx = D_CUSH / 2, p = 2.6, n = 28, st = [];
  for (let i = 0; i < n; i++) {
    const phi = Math.PI / 2 - (i / n) * Math.PI * 2, c = Math.cos(phi), s = Math.sin(phi);
    st.push({ d: dc + rd * Math.sign(c) * Math.abs(c) ** (2 / p), x: xc + rx * Math.sign(s) * Math.abs(s) ** (2 / p), ao: c < -0.2 ? 0.92 : s < 0 ? 0.78 : 0.82 });
  }
  const mould = (v) => {
    // the inner half of the pillow stretches onto the hood: the fur recedes from the flat contact plane toward the rim
    const w = smoothstep(D_CUSH, 0, v[0]);
    v[0] += w * (hoodDepth(v[1], zSign * v[2]) - DENT);
    v[0] -= D_CUSH;                                       // local origin on the shell's inner face, so squash scales from there
  };
  const ring = ovalSweep(CUP_A, CUP_B, st, 64, { closed: true, ao: (s) => s.ao, transform: mould });
  const disc = ovalSweep(0.2, 0.135, [{ k: 0, x: 0.058 - D_CUSH }, { k: 0.5, x: 0.061 - D_CUSH }, { d: 0, x: 0.065 - D_CUSH }], 48, { ao: () => 0.6 });
  const g = mergeGeometries([ring, disc], false);
  ring.dispose(); disc.dispose();
  return g;
}
function pinGeometry() {
  const g = new THREE.CylinderGeometry(0.02, 0.02, 0.17, 20);
  g.rotateX(Math.PI / 2);
  g.translate(D_CUSH + 0.095, CUP_A - 0.02, 0);
  return plainAttributes(g);
}

/** Frame of one cup: basis matrix and the rest-space point where the slider block sits on the shell. */
function cupFrame(side) {
  const X = new THREE.Vector3(side * FRAME_X[0], FRAME_X[1], FRAME_X[2]);
  const Y = new THREE.Vector3(side * FRAME_Y[0], FRAME_Y[1], FRAME_Y[2]);
  const Z = new THREE.Vector3().crossVectors(X, Y).normalize();
  const basis = new THREE.Matrix4().makeBasis(X, Y, Z);
  const origin = new THREE.Vector3(side * CUP_X, CUP_Y, CUP_Z);
  const shellTop = origin.clone().addScaledVector(X, D_CUSH + 0.095).addScaledVector(Y, CUP_A);
  return { basis, origin, shellTop, zSign: side > 0 ? 1 : -1 };
}

/**
 * The band: a rounded strip hugging the hood over the crown, peeling off tangentially toward each slider and running
 * straight down into it.  Returns the shell and cushion-strip geometries plus per-vertex flex directions (how each
 * vertex moves when the band is spread open: nothing at the crown, the full outward normal at the ends).
 */
function bandGeometries(endTop, endIn) {
  const pts = [];
  const hugPt = (deg) => { const th = (deg * Math.PI) / 180, R = hoodAt(deg)[0] + GAP + HT_CROWN; return [R * Math.cos(th), HEAD_CY + R * Math.sin(th)]; };
  const halfRoute = (side) => {
    const out = [];
    const ph = hugPt(TH_HUG), pa = hugPt(TH_HUG + 1), pb = hugPt(TH_HUG - 1);
    let tx = pb[0] - pa[0], ty = pb[1] - pa[1]; const tl = Math.hypot(tx, ty); tx /= tl; ty /= tl;
    const E = [side * endTop.x, endTop.y], P = [side * ph[0], ph[1]];
    const L = Math.hypot(E[0] - P[0], E[1] - P[1]);
    for (let i = 1; i <= 48; i++) out.push(hermite(P, [side * tx * L, ty * L], E, [0, -L * 0.9], i / 48));
    for (let i = 1; i <= 6; i++) out.push([E[0], endTop.y + (endIn.y - endTop.y) * (i / 6)]);
    return out;
  };
  const left = halfRoute(-1).reverse();
  for (const p of left) pts.push(p);
  for (let deg = 180 - TH_HUG; deg >= TH_HUG; deg -= 1) pts.push(hugPt(deg));
  for (const p of halfRoute(1)) pts.push(p);
  const NS = 108;
  const line = resample2(pts, NS);
  const stations = [], strip = [];
  for (let j = 0; j < NS; j++) {
    const [x, y, f] = line[j];
    const pm = line[Math.max(0, j - 1)], pn = line[Math.min(NS - 1, j + 1)];
    let tx = pn[0] - pm[0], ty = pn[1] - pm[1]; const tl = Math.hypot(tx, ty) || 1; tx /= tl; ty /= tl;
    let nx = ty, ny = -tx;                                   // outward normal in the band plane
    if (nx * x + ny * (y - HEAD_CY) < 0) { nx = -nx; ny = -ny; }
    const s = f * 2 - 1;                                     // -1 at the left slider, 0 at the crown, +1 at the right slider
    const deg = (Math.atan2(y - HEAD_CY, x) * 180) / Math.PI;
    const hug = smoothstep(TH_HUG - 12, TH_HUG, Math.min(deg, 180 - deg));
    const [, a, b] = hoodAt(deg);
    const as = Math.abs(s);
    const ht = HT_CROWN + (HT_END - HT_CROWN) * smoothstep(0.3, 1, as), hw = HW_CROWN + (HW_END - HW_CROWN) * smoothstep(0.35, 1, as);
    const loop = roundedRectLoop(hw, ht, ht * 0.8).map(([u, v]) => [u, v + hug * (a * u + b * u * u * smoothstep(ht, -ht, v))]);
    const base = { p: [x, y, ZC], T: [tx, ty, 0], N: [nx, ny, 0], B: [0, 0, 1], flex: [nx * s * s, ny * s * s, 0], ht };
    stations.push({ ...base, loop });
    const sc = Math.max(0.03, smoothstep(TH_HUG - 4, TH_HUG + 6, Math.min(deg, 180 - deg)));
    if (sc > 0.03 || (j > 0 && strip.length && strip[strip.length - 1].sc > 0.03)) {
      const vc = -ht - 0.002;
      strip.push({ ...base, sc, loop: roundedRectLoop(0.075 * sc, 0.017 * sc, 0.014 * sc).map(([u, v]) => [u, vc + v + hug * (a * u + b * u * u)]) });
    }
  }
  const shell = tubeSweep(stations, { ao: (j, i, v) => 0.85 + 0.15 * smoothstep(-stations[j].ht, stations[j].ht, v), extra: (j) => stations[j].flex });
  const cushion = tubeSweep(strip, { ao: () => 0.8, extra: (j) => strip[j].flex });
  return { shell, cushion };
}

/**
 * @returns {{group: THREE.Group, update: (o: {phones: number, time?: number}) => void}}
 *   `phones` 0..1 is how far the headphones are on (eased by the controller); the group is invisible at 0.
 */
export function buildHeadphones() {
  const group = new THREE.Group();          // positioned by the controller (head rest space -> head bone)
  group.name = 'Headphones';
  const inner = new THREE.Group();          // animated: drop / lift / roll about the band's centre
  inner.name = 'HeadphonesRig';
  inner.position.copy(PIVOT);
  const parts = new THREE.Group();
  parts.position.copy(PIVOT).negate();
  inner.add(parts);
  group.add(inner);

  const matShell = fabric(CHARCOAL);
  const matBand = fabric(CHARCOAL, { scale: 1.5, detail: 1.3, upFibre: 0.3 });
  const matCushion = fabric(CUSHION, { scale: 1.7, detail: 1.2, upFibre: 0.3 });
  const matGraphite = new THREE.MeshPhysicalMaterial({ color: '#98979c', metalness: 0.45, roughness: 0.42, envMapIntensity: 1.8 });   // satin gunmetal trim

  const mesh = (geo, mat, order = 0) => { const m = new THREE.Mesh(geo, mat); m.castShadow = m.receiveShadow = true; m.renderOrder = order; return m; };
  const frames = { 1: cupFrame(1), [-1]: cupFrame(-1) };

  // ---- cups ----
  const shellGeo = shellGeometry(), padGeo = padGeometry();
  const rigidGeo = mergeGeometries([shellGeo, padGeo], false);
  shellGeo.dispose(); padGeo.dispose();
  const ringGeo = ringGeometry(), pinGeo = pinGeometry();
  const trimGeo = mergeGeometries([ringGeo, pinGeo], false);
  ringGeo.dispose(); pinGeo.dispose();
  const cups = [];
  for (const side of [1, -1]) {
    const fr = frames[side];
    const cup = new THREE.Group();
    cup.name = side > 0 ? 'CupL' : 'CupR';
    cup.position.copy(fr.origin);
    cup.quaternion.setFromRotationMatrix(fr.basis);
    cup.add(mesh(rigidGeo, matShell), mesh(trimGeo, matGraphite));
    const cushion = mesh(cushionGeometry(fr.zSign), matCushion);
    cushion.position.x = D_CUSH;
    cup.add(cushion);
    parts.add(cup);
    cups.push({ side, cup, cushion, baseQ: cup.quaternion.clone(), origin: fr.origin.clone() });
  }

  // ---- band + slider blocks (one fabric mesh) and the cushion strip under it ----
  const top = frames[1].shellTop;
  const blockC = new THREE.Vector3(top.x, top.y + YOKE.lift, ZC);
  const endTop = { x: blockC.x, y: blockC.y + YOKE.h / 2 }, endIn = { x: blockC.x, y: blockC.y - 0.01 };
  const { shell, cushion } = bandGeometries(endTop, endIn);
  // (RoundedBoxGeometry is non-indexed; mergeVertices indexes it so it can merge with the swept band)
  const blocks = [1, -1].map((side) => plainAttributes(mergeVertices(new RoundedBoxGeometry(YOKE.w, YOKE.h, YOKE.d, 3, YOKE.r))).translate(side * blockC.x, blockC.y, blockC.z));
  const bandGeo = mergeGeometries([shell.geometry, ...blocks], false);
  const bandFlex = new Float32Array(bandGeo.attributes.position.count * 3);
  bandFlex.set(shell.extra, 0);
  let off = shell.extra.length;
  for (const [i, side] of [1, -1].entries()) { const n = blocks[i].attributes.position.count; for (let k = 0; k < n; k++) { bandFlex[off + k * 3] = side; } off += n * 3; }
  shell.geometry.dispose(); blocks.forEach((b) => b.dispose());
  const band = mesh(bandGeo, matBand);
  const strip = mesh(cushion.geometry, matCushion);
  band.frustumCulled = strip.frustumCulled = false;
  parts.add(band, strip);
  const flexers = [
    { attr: bandGeo.attributes.position, base: Float32Array.from(bandGeo.attributes.position.array), dir: bandFlex },
    { attr: cushion.geometry.attributes.position, base: Float32Array.from(cushion.geometry.attributes.position.array), dir: cushion.extra },
  ];
  let appliedOpen = 0;
  const applyFlex = (open) => {
    if (open === appliedOpen) return;
    appliedOpen = open;
    for (const f of flexers) {
      const p = f.attr.array;
      for (let i = 0; i < p.length; i++) p[i] = f.base[i] + open * f.dir[i];
      f.attr.needsUpdate = true;
    }
  };
  group.visible = false;

  // ------------------------------------------------------------------------------------------- choreography ----
  // Put-on: pop into being a hand's breadth above the head (small, growing as it comes), fall with a slight roll and pitch, cups
  // spread; on landing the cups close onto the head with the band flexing, the cushions squash, and one damped bounce settles
  // everything to exact rest.  Take-off: cups spread, then an accelerating lift with a roll while it shrinks away (it never leaves
  // the frame, so there is nothing to cut off).  Both stay within a head's height so they read as a gesture, not a delivery.
  const putOn = (tau) => {
    const T_ANT = 0.06, T_FALL = 0.3, T_LAND = T_ANT + T_FALL, H0 = 0.8, OPEN0 = 0.09, ROLL0 = 0.13, PITCH0 = 0.05, S0 = 0.55;
    if (tau < T_ANT) { const k = smoothstep(0, 1, tau / T_ANT); return { h: H0 + 0.02 * Math.sin(Math.PI * k), roll: ROLL0, pitch: PITCH0, open: OPEN0, scale: S0 + 0.3 * k }; }
    if (tau < T_LAND) {
      const q = (tau - T_ANT) / T_FALL;
      return { h: H0 * (1 - q * q), roll: ROLL0 * (1 - q * q), pitch: PITCH0 * (1 - q), open: OPEN0 * (1 - smoothstep(0.55, 1, q)), scale: 0.85 + 0.15 * smoothstep(0, 1, q) };
    }
    const t = tau - T_LAND;
    if (t > 0.85) return { h: 0, roll: 0, pitch: 0, open: 0, scale: 1 };
    const osc = Math.exp(-6 * t) * (1 - smoothstep(0.55, 0.85, t)) * Math.sin(2 * Math.PI * 2.7 * t);
    return { h: -0.043 * osc, roll: -0.02 * osc, pitch: 0, open: -0.05 * osc, scale: 1 };
  };
  const takeOff = (tau) => {
    const q = Math.max(0, (tau - 0.06) / 0.4), k = smoothstep(0.05, 0.5, tau);
    return { h: 1.0 * q * q, roll: -0.28 * k, pitch: -0.06 * k, open: 0.08 * smoothstep(0, 0.14, tau), scale: 1 - 0.5 * smoothstep(0.35, 1, q) };
  };

  let prev = 0, dir = 1;
  const q = new THREE.Quaternion(), zAxis = new THREE.Vector3(0, 0, 1);
  return {
    group,
    update({ phones = 0 }) {
      const u = Math.min(1, Math.max(0, phones));
      group.visible = u > 0.01;
      if (u > prev + 1e-7) dir = 1; else if (u < prev - 1e-7) dir = -1;
      prev = u;
      if (!group.visible) return;
      const pose = dir > 0 ? putOn(-Math.log(Math.max(1e-9, 1 - u)) / RATE) : takeOff(-Math.log(Math.max(1e-9, u)) / RATE);
      inner.position.set(PIVOT.x, PIVOT.y + pose.h, PIVOT.z);
      inner.rotation.set(pose.pitch, 0, pose.roll);
      inner.scale.setScalar(pose.scale);
      const open = Math.abs(pose.open) < 1e-5 ? 0 : pose.open;
      for (const c of cups) {
        c.cup.position.set(c.origin.x + c.side * open, c.origin.y, c.origin.z);
        c.cup.quaternion.copy(c.baseQ).premultiply(q.setFromAxisAngle(zAxis, -c.side * open * 0.9));   // spread cups flare at the bottom
        c.cushion.scale.x = open < 0 ? Math.max(0.6, 1 + open / D_CUSH) : 1;                             // the cushions take the landing
      }
      applyFlex(open);
    },
  };
}
