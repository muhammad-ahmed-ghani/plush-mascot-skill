// The mouth: a felt-wrapped cord bent into a smile, with round ends, a dark contact line around it, and a dark inside when it opens.
// It is rebuilt every time the expression changes, so it can smile, frown, narrow and open smoothly.
import * as THREE from 'three';
import { neutralAttributes } from './footprint.js';

export const MOUTH_RIM = 0.0056;   // width of the dark contact line around the cord at the artwork's density (it sits a little high: the artwork's is heavier above the cord)
const SEG = 64, RAD = 16;
const FLAT = 0.75;         // height of the cord over the face, as a fraction of its radius: a flat-topped felt ribbon with rounded edges
const SQUARE = 2.0;        // exponent of its cross-section (2 = elliptical, larger = squarer)
const AO_DOWN = 0.3;       // how much darker the underside of the cord is than its top (the light is overhead; the artwork's cord falls off by a third)
const AO_CONTACT = 0.0;    // ... and the flanks, where it meets the face plate
const Z = new THREE.Vector3(0, 0, 1);

/**
 * @param {object} anchor  { p, n }: the point of the face plate at the lowest point of the artwork's smile, and its normal
 * @param {object} spec    FACE_SHAPES.mouth: { thickness, k, x0, x1, xc }
 * @param {object} mats    { mouth, mouthInside, line }
 */
export function buildMouth(anchor, spec, mats) {
  const group = new THREE.Group();
  group.name = 'Mouth';
  group.position.set(...anchor.p);
  group.quaternion.setFromUnitVectors(Z, new THREE.Vector3(...anchor.n).normalize());

  const R0 = spec.thickness / 2 * 1.07;                // radius of the pink cord at rest (the measured band, plus what the rolled edge hides)
  const REST = { smile: 0.55, width: spec.x1 - spec.x0 };            // overall extent at rest (the round caps end on the centre line's ends)
  // sag (ends above the lowest point) in the artwork: k * (half span)^2; `smile` scales it, 0.55 being the neutral face
  const SAG_PER_SMILE = spec.k * (REST.width / 2) ** 2 / REST.smile;

  const makeTube = (material, order = 0, receive = false) => {
    const geo = new THREE.BufferGeometry();
    const pos = new Float32Array((SEG + 1) * RAD * 3), nor = new Float32Array((SEG + 1) * RAD * 3);
    const idx = [];
    for (let i = 0; i < SEG; i++) for (let j = 0; j < RAD; j++) {
      const a = i * RAD + j, b = i * RAD + (j + 1) % RAD, c = (i + 1) * RAD + j, d = (i + 1) * RAD + (j + 1) % RAD;
      idx.push(a, b, c, b, d, c);
    }
    geo.setIndex(idx);
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    neutralAttributes(geo, (SEG + 1) * RAD);
    const mesh = new THREE.Mesh(geo, material);
    mesh.receiveShadow = receive; mesh.frustumCulled = false; mesh.renderOrder = order;
    group.add(mesh);
    return { mesh, geo, pos, nor, ao: geo.attributes.ao.array };
  };
  const lineUpper = makeTube(mats.line, 1), lineLower = makeTube(mats.line, 1);       // (after the face plate, under the cord)
  const upper = makeTube(mats.mouth, 2, true), lower = makeTube(mats.mouth, 2, true);
  // dark interior: a strip between the two lip curves
  const inGeo = new THREE.BufferGeometry();
  const inPos = new Float32Array((SEG + 1) * 2 * 3);
  const inIdx = [];
  for (let i = 0; i < SEG; i++) { const a = i * 2, b = a + 1, c = a + 2, d = a + 3; inIdx.push(a, c, b, b, c, d); }
  inGeo.setIndex(inIdx);
  inGeo.setAttribute('position', new THREE.BufferAttribute(inPos, 3));
  const inside = new THREE.Mesh(inGeo, mats.mouthInside);
  inside.frustumCulled = false;
  group.add(inside);

  // cross-section of the cord: a superellipse, and its outward normal (in the section's own frame, height already squashed)
  const prof = [];
  for (let j = 0; j < RAD; j++) {
    const ph = (j / RAD) * Math.PI * 2, c = Math.cos(ph), sn = Math.sin(ph);
    const X = Math.sign(c) * Math.pow(Math.abs(c), 2 / SQUARE), Z = Math.sign(sn) * Math.pow(Math.abs(sn), 2 / SQUARE);
    const nx = Math.sign(X) * Math.pow(Math.abs(X), SQUARE - 1);
    let nz = Math.sign(Z) * Math.pow(Math.abs(Z), SQUARE - 1);
    nz /= FLAT;                                               // (the height is squashed by FLAT, so the normal tilts toward z)
    const l = Math.hypot(nx, nz) || 1;
    prof.push({ X, Z, nx: nx / l, nz: nz / l });
  }
  const state = { width: REST.width, smile: REST.smile, open: 0, radius: R0, rim: MOUTH_RIM };

  /**
   * Write a tube of radius R along the 2D curve `pts`.  The ends are round caps (a felt-covered cord, not a brush stroke): the radius
   * follows a quarter circle over the last R of arc length.  `flat` squashes it into the face (z), `off` shifts it.
   */
  const writeTube = (tube, pts, R, { flat = FLAT, off = [0, 0, 0] } = {}) => {
    const cum = [0];
    for (let i = 1; i <= SEG; i++) cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
    const L = cum[SEG] || 1e-6;
    for (let i = 0; i <= SEG; i++) {
      const p = pts[i], q0 = pts[Math.max(0, i - 1)], q1 = pts[Math.min(SEG, i + 1)];
      let tx = q1[0] - q0[0], ty = q1[1] - q0[1];
      const tl = Math.hypot(tx, ty) || 1; tx /= tl; ty /= tl;
      const nx = -ty, ny = tx;
      const e = Math.min(cum[i], L - cum[i]);
      const k = e >= R ? 1 : Math.sqrt(Math.max(0, 1 - ((R - e) / R) ** 2));
      const r = R * k;
      for (let j = 0; j < RAD; j++) {
        const { X, Z, nx: sx, nz: sz } = prof[j];
        const o = (i * RAD + j) * 3;
        tube.pos[o] = p[0] + nx * X * r + off[0]; tube.pos[o + 1] = p[1] + ny * X * r + off[1]; tube.pos[o + 2] = Z * r * flat + off[2];
        tube.nor[o] = nx * sx; tube.nor[o + 1] = ny * sx; tube.nor[o + 2] = sz;
        if (tube.ao) tube.ao[i * RAD + j] = 1 - AO_DOWN * Math.max(0, -ny * sx) - AO_CONTACT * (1 - Math.min(1, Math.abs(sz) / 0.6));
      }
    }
    tube.geo.attributes.position.needsUpdate = true;
    tube.geo.attributes.normal.needsUpdate = true;
    if (tube.ao) tube.geo.attributes.ao.needsUpdate = true;
  };

  function update() {
    const { width, smile, open, radius, rim: RIM } = state;
    const half = width / 2;
    const sag = smile * SAG_PER_SMILE;
    const top = [], bottom = [];
    const drop = open * 0.12;
    for (let i = 0; i <= SEG; i++) {
      const t = i / SEG, x = (t * 2 - 1) * half, u = (x * x) / (half * half);
      // the mid-height of the smile stays put as the ends rise and fall; at the neutral smile the lowest point is the anchor
      const y = sag * (u - 0.5) + 0.5 * REST.smile * SAG_PER_SMILE - open * 0.03;
      top.push([x, y]);
      bottom.push([x, y - drop * Math.pow(Math.max(0, 1 - u), 0.65)]);
    }
    writeTube(upper, top, radius);
    writeTube(lineUpper, top, radius + RIM, { flat: 0.02, off: [0, 0.0014, 0.0009] });
    const isOpen = open > 0.05;
    lower.mesh.visible = lineLower.mesh.visible = inside.visible = isOpen;
    if (isOpen) {
      writeTube(lower, bottom, radius * 0.9);
      writeTube(lineLower, bottom, radius * 0.9 + RIM, { flat: 0.02, off: [0, 0.0014, 0.0009] });
      for (let i = 0; i <= SEG; i++) {
        inPos[i * 6] = top[i][0]; inPos[i * 6 + 1] = top[i][1]; inPos[i * 6 + 2] = 0.004;
        inPos[i * 6 + 3] = bottom[i][0]; inPos[i * 6 + 4] = bottom[i][1]; inPos[i * 6 + 5] = 0.004;
      }
      inGeo.attributes.position.needsUpdate = true;
    }
  }
  update();

  return {
    group, rest: REST,
    /** Width of the dark contact line (units); the face widens it on a small display so it never drops below a pixel. */
    setRim(w) { if (Math.abs(w - state.rim) < 1e-6) return; state.rim = w; update(); },
    /** smile -1..1 (0.55 = the neutral face), width = overall length of the cord (units), open 0..1 */
    set({ smile = REST.smile, width = REST.width, open = 0 } = {}) {
      if (Math.abs(smile - state.smile) + Math.abs(width - state.width) + Math.abs(open - state.open) < 1e-4) return;
      state.smile = smile; state.width = width; state.open = open;
      update();
    },
  };
}
