// Assembles Mascot from the baked sculpt: skeleton, skinned felt meshes, fuzz shells.
import * as THREE from 'three';
import { createFabricMaterial } from './mascot-fabric.js';
import { buildFace } from './mascot-face.js';
import { BONES } from './mascot-pose.js';

export function buildBones(data) {
  const bones = data.bones.map((b) => {
    const bone = new THREE.Bone();
    bone.name = b.name;
    return bone;
  });
  data.bones.forEach((b, i) => {
    if (b.parent >= 0) {
      const p = data.bones[b.parent];
      bones[i].position.set(b.pos[0] - p.pos[0], b.pos[1] - p.pos[1], b.pos[2] - p.pos[2]);
      bones[b.parent].add(bones[i]);
    } else {
      bones[i].position.set(b.pos[0], b.pos[1], b.pos[2]);
    }
  });
  return bones;
}

export function buildMascotRig(data, { shells = 5, shellHeight = 0.008, quality = 'high' } = {}) {
  const root = new THREE.Group();
  root.name = 'Mascot';
  const bones = buildBones(data);
  const byName = Object.fromEntries(bones.map((b) => [b.name, b]));
  for (const t of ['L', 'R']) for (const n of ['elbow', 'wrist']) byName[n + t].userData.restPos = byName[n + t].position.clone();   // (aimArms stretches them)
  root.add(bones[0]);
  root.updateMatrixWorld(true);
  const skeleton = new THREE.Skeleton(bones);

  const bodyMat = createFabricMaterial({ useFace: false, part: 'body' });
  const headMat = createFabricMaterial({ useFace: true, part: 'head' });
  const shellCount = quality === 'low' ? 0 : shells;
  const shellMats = (useFace, part, arm = null) => Array.from({ length: shellCount }, (_, i) =>
    createFabricMaterial({ useFace, part, arm, shellT: (i + 1) / shellCount, shellHeight }));
  const headShells = shellMats(true, 'head'), bodyShells = shellMats(false, 'body');
  // each arm has its own fabric materials: they are told how far the arm is stretched (aimArms), which the nap follows
  const restOf = (n) => data.bones.find((b) => b.name === n).pos;
  const A = data.params.arm;
  const d0 = new THREE.Vector3(A.hand[0] - A.shoulder[0], A.hand[1] - A.shoulder[1], A.hand[2] - A.shoulder[2]).normalize();
  const armRest = { L: d0.clone(), R: new THREE.Vector3(-d0.x, d0.y, d0.z) };
  const armMats = {};
  const armFrame = (tag) => {
    const axis = armRest[tag], along = (n) => { const p = restOf(n + tag); return p[0] * axis.x + p[1] * axis.y + p[2] * axis.z; };
    return { axis: axis.toArray(), from: along('shoulder'), to: along('wrist') };
  };

  const meshes = {};
  const skinned = (name, geometry, material, { cast = false, order = 0 } = {}) => {
    const m = new THREE.SkinnedMesh(geometry, material);
    m.name = name;
    m.frustumCulled = false;
    m.castShadow = cast;
    m.receiveShadow = true;
    m.renderOrder = order;
    m.bind(skeleton, new THREE.Matrix4());
    root.add(m);
    return m;
  };
  for (const [name, geometry] of Object.entries(data.parts)) {
    const isHead = name === 'head', tag = name === 'armL' ? 'L' : name === 'armR' ? 'R' : null;
    const frame = tag ? armFrame(tag) : null;
    const base = isHead ? headMat : frame ? createFabricMaterial({ useFace: false, part: 'body', arm: frame }) : bodyMat;
    const shells = isHead ? headShells : frame ? shellMats(false, 'body', frame) : bodyShells;
    if (tag) armMats[tag] = [base, ...shells];
    meshes[name] = skinned(name, geometry, base, { cast: true });
    shells.forEach((mat, i) => skinned(`${name}Shell${i}`, geometry, mat, { order: 1 + i }));
  }
  const face = buildFace(data.anchors, {
    head: { bone: byName.head, rest: restOf('head') },
    chestBone: { bone: byName.chest, rest: restOf('chest') },
    plate: [headMat, ...headShells],            // the face fabric layers, whose pockets around the features the face fades when they change
  });
  return { root, bones, byName, skeleton, meshes, face, armRest, armMats, anchors: data.anchors, materials: { bodyMat, headMat } };
}

const _u = new THREE.Vector3(), _f = new THREE.Vector3(), _h = new THREE.Vector3();
const _qU = new THREE.Quaternion(), _qF = new THREE.Quaternion(), _qH = new THREE.Quaternion(), _q = new THREE.Quaternion();

/** Aim shoulder/elbow/wrist so the upper arm, forearm and hand point along the pose's directions, and lengthen the arm by `arm{L,R}.s`. */
function aimArms(rig, pose) {
  for (const tag of ['L', 'R']) {
    const s = tag === 'L' ? 1 : -1, d0 = rig.armRest[tag], grow = 1 + pose[`arm${tag}.s`];
    for (const n of ['elbow', 'wrist']) { const b = rig.byName[n + tag]; b.position.copy(b.userData.restPos).multiplyScalar(grow); }
    _u.set(s * pose[`arm${tag}.ux`], pose[`arm${tag}.uy`], pose[`arm${tag}.uz`]).normalize();
    _f.set(s * pose[`arm${tag}.fx`], pose[`arm${tag}.fy`], pose[`arm${tag}.fz`]).normalize();
    _h.set(s * pose[`arm${tag}.hx`], pose[`arm${tag}.hy`], pose[`arm${tag}.hz`]).normalize();
    _qU.setFromUnitVectors(d0, _u);
    _qF.setFromUnitVectors(d0, _f);
    _qH.setFromUnitVectors(d0, _h);
    rig.byName['shoulder' + tag].quaternion.copy(_qU);
    rig.byName['elbow' + tag].quaternion.copy(_q.copy(_qU).invert().multiply(_qF));
    rig.byName['wrist' + tag].quaternion.copy(_q.copy(_qF).invert().multiply(_qH));
    for (const m of rig.armMats[tag]) m.userData.mascot.uArmSpan.value.z = grow - 1;           // (the nap follows the stretch)
  }
}

/** Write the skeleton part of a pose (bone rotations, chest breath, whole-body motion) onto the rig. */
export function applyBodyPose(rig, pose, spin = 0) {
  const g = rig.root;
  g.position.y = pose['root.y'];
  const sy = pose['root.sy'], sxz = 1 / Math.sqrt(sy);
  g.scale.set(sxz, sy, sxz);
  g.rotation.set(pose['root.pitch'], pose['root.yaw'] + spin, pose['root.roll']);
  for (const b of BONES) rig.byName[b].rotation.set(pose[`${b}.x`], pose[`${b}.y`], pose[`${b}.z`]);
  rig.byName.chest.scale.y = pose['chest.sy'];
  aimArms(rig, pose);
}
