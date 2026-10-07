// A cheek: a flat pink felt appliqué cut to the artwork's outline, with a dark contact line around it.
import * as THREE from 'three';
import { outlinePillow, polarRadius } from './footprint.js';

const Z = new THREE.Vector3(0, 0, 1);
export const CHEEK_RIM = 0.0038;           // width of the dark contact line at the artwork's density

export const CHEEK = { rz: 0.013, sink: 0.003, n: 5 };

function flatShape(shape, grow, segs = 96) {
  const pos = [0, 0, 0], index = [];
  for (let j = 0; j < segs; j++) pos.push(0, 0, 0);
  for (let j = 0; j < segs; j++) index.push(0, 1 + j, 1 + ((j + 1) % segs));
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(index);
  /** Put the outline `grow` units outside the measured one (it is rewritten when the display density changes). */
  g.userData.setGrow = (w) => {
    const a = g.attributes.position;
    for (let j = 0; j < segs; j++) {
      const ang = (j / segs) * Math.PI * 2, r = polarRadius(shape.rho, ang) + w;
      a.setXYZ(1 + j, r * Math.cos(ang), r * Math.sin(ang), 0);
    }
    a.needsUpdate = true;
  };
  g.userData.setGrow(grow);
  return g;
}

export function buildCheek(tag, anchor, shape, mats) {
  const group = new THREE.Group();
  group.name = 'Cheek' + tag;
  group.position.set(...anchor.p);
  group.quaternion.setFromUnitVectors(Z, new THREE.Vector3(...anchor.n).normalize());
  const scaler = new THREE.Group();                        // uniform "blush" swell about the centre
  group.add(scaler);
  const line = new THREE.Mesh(flatShape(shape, CHEEK_RIM), mats.line);
  line.position.z = 0.0006;
  line.renderOrder = 1;
  scaler.add(line);
  const mesh = new THREE.Mesh(outlinePillow(shape, { n: CHEEK.n, rings: 12, segs: 96, neutral: true }), mats.cheek);
  mesh.scale.set(shape.rx, shape.ry, CHEEK.rz);
  mesh.position.z = -CHEEK.sink;
  mesh.receiveShadow = true;
  scaler.add(mesh);
  return {
    tag, group, mesh, scaler,
    /** Width of the dark contact line (units); the face widens it on a small display so it never drops below a pixel. */
    setRim(w) { line.geometry.userData.setGrow(w); },
  };
}
