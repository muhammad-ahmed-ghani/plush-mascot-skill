// Lightweight GLB export: skinned felt mesh (vertex-coloured, KHR sheen), the
// face parts, and ten baked animation clips on the skeleton.
import * as THREE from 'three';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { buildMascotRig, applyBodyPose } from './mascot-rig.js';
import { computePose, restPose, BONES } from './mascot-pose.js';
import { STATES } from './mascot-states.js';
import { FABRIC } from './mascot-fabric.js';

/** Keyframes a second in the baked clips (players interpolate between them; the live studio itself runs at 60). */
export const CLIP_FPS = 30;

// JS mirror of the shader's face outline (superellipse), used to colour the charcoal face
function superEllipse(x, y, a, b, n) {
  const ax = Math.abs(x) / a, ay = Math.abs(y) / b;
  const px = Math.pow(ax, n), py = Math.pow(ay, n), s = px + py;
  const f = Math.pow(s, 1 / n), k = Math.pow(s, 1 / n - 1);
  const gx = (k * Math.pow(Math.max(ax, 1e-5), n - 1)) / a, gy = (k * Math.pow(Math.max(ay, 1e-5), n - 1)) / b;
  return (f - 1) / Math.max(Math.hypot(gx, gy), 1e-4);
}

function colouredGeometry(geometry, isHead) {
  const g = geometry.clone();
  const pos = g.attributes.position, ao = g.attributes.ao;
  const body = new THREE.Color(FABRIC.body.base), char = new THREE.Color(FABRIC.charcoal.base);
  const F = FABRIC.face;
  const colors = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    const occ = Math.pow(ao.getX(i), 1.2);
    let k = 0;                                      // 0 = body, 1 = charcoal; blended across the outline so the edge is not stair-stepped
    if (isHead && z > 0.45) {
      const d = superEllipse(x - F.cx, y - F.cy, F.a, F.b, y >= F.cy ? F.nTop : F.nBot);
      k = THREE.MathUtils.smoothstep(-d, -0.018, 0.018);
    }
    colors[i * 3] = (body.r + (char.r - body.r) * k) * occ; colors[i * 3 + 1] = (body.g + (char.g - body.g) * k) * occ; colors[i * 3 + 2] = (body.b + (char.b - body.b) * k) * occ;
  }
  g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  // glTF asks that a joint with zero weight has index 0 (the bake packs four influences per vertex, some of them empty)
  const si = g.attributes.skinIndex, sw = g.attributes.skinWeight;
  for (let i = 0; i < sw.count; i++) for (let k = 0; k < 4; k++) if (sw.array[i * 4 + k] === 0) si.array[i * 4 + k] = 0;
  g.deleteAttribute('ao'); g.deleteAttribute('curv'); g.deleteAttribute('seam'); g.deleteAttribute('seamDir');
  return g;
}

export async function exportMascotGLB(data) {
  const rig = buildMascotRig(data, { shells: 0 });
  const feltMat = new THREE.MeshPhysicalMaterial({
    vertexColors: true, roughness: 1, metalness: 0, sheen: 1,
    sheenColor: new THREE.Color(FABRIC.body.sheen), sheenRoughness: 0.55, name: 'MascotFelt',
  });
  for (const [name, mesh] of Object.entries(rig.meshes)) {
    mesh.geometry = colouredGeometry(mesh.geometry, name === 'head');
    mesh.material = feltMat;
    mesh.castShadow = mesh.receiveShadow = false;
  }
  // the felt-shader cheeks become plain materials; lids stay hidden (clipping is runtime only)
  rig.root.traverse((o) => {
    if (o.isMesh && o.material?.userData?.mascot) {
      o.material = new THREE.MeshPhysicalMaterial({ color: o.material.userData.mascot.uBase.value.clone(), roughness: 1, sheen: 1, sheenColor: new THREE.Color(FABRIC.body.sheen), sheenRoughness: 0.55, name: 'MascotFeltAccent' });
    }
    if (o.name.startsWith('Lid')) o.visible = false;
  });
  // glTF colour factors live in [0, 1]; the studio lights the face parts with gains above 1 to match the artwork under its own
  // light, which another viewer's lighting will not need.  Fold them back into range (keeping hue).
  const tame = (c) => { const m = Math.max(c.r, c.g, c.b); if (m > 1) c.multiplyScalar(1 / m); };
  rig.root.traverse((o) => {
    if (!o.isMesh) return;
    for (const m of [].concat(o.material)) { if (m.color) tame(m.color); if (m.emissive) tame(m.emissive); if (m.sheenColor) tame(m.sheenColor); }
  });
  // The face pieces sit in oblique frames (see fitToArtworkView) that glTF's translate / rotate / scale nodes cannot hold; keep their nearest TRS.
  rig.root.traverse((o) => { if (!o.matrixAutoUpdate) { o.matrix.decompose(o.position, o.quaternion, o.scale); o.quaternion.normalize(); o.matrixAutoUpdate = true; } });
  rig.root.name = 'Mascot';
  rig.root.updateMatrixWorld(true);

  const clips = [];
  const pose = restPose();
  const eyes = rig.face.eyes;
  for (const [state, { duration }] of Object.entries(STATES)) {
    const frames = Math.round(duration * CLIP_FPS);
    const times = [];
    const tracks = new Map();
    const track = (key, size) => { if (!tracks.has(key)) tracks.set(key, []); return tracks.get(key); };
    for (let f = 0; f <= frames; f++) {
      const t = (f / frames) * duration;
      times.push(t);
      computePose(state, t, { time: t, reduced: false }, pose);
      applyBodyPose(rig, pose);
      rig.face.setGaze(pose['f.gx'], pose['f.gy'], pose['f.cv']);
      rig.root.updateMatrixWorld(true);
      for (const b of rig.bones) track(`${b.name}.quaternion`).push(...b.quaternion.toArray());
      for (const n of ['elbowL', 'wristL', 'elbowR', 'wristR']) track(`${n}.position`).push(...rig.byName[n].position.toArray());   // (raised arms stretch)
      track('Mascot.position').push(...rig.root.position.toArray());
      track('Mascot.quaternion').push(...rig.root.quaternion.toArray());
      track('Mascot.scale').push(...rig.root.scale.toArray());
      track('chest.scale').push(...rig.byName.chest.scale.toArray());
      for (const e of eyes) {
        track(`Gaze${e.tag}.position`).push(...e.gaze.position.toArray());
        track(`Gaze${e.tag}.quaternion`).push(...e.gaze.quaternion.toArray());
      }
    }
    const list = [];
    for (const [key, values] of tracks) {
      const Type = key.endsWith('.quaternion') ? THREE.QuaternionKeyframeTrack : THREE.VectorKeyframeTrack;
      list.push(new Type(key, times, values));
    }
    clips.push(new THREE.AnimationClip(state, duration, list));
  }
  applyBodyPose(rig, restPose());
  rig.face.setGaze(0, 0);
  rig.root.updateMatrixWorld(true);
  const scene = new THREE.Scene();
  scene.add(rig.root);
  // A skinned mesh ignores its own node's parents in glTF, so the meshes sit at the top of the scene; the joints (whose ancestors
  // do include the animated Mascot node) carry all the motion.
  for (const mesh of Object.values(rig.meshes)) { rig.root.remove(mesh); scene.add(mesh); }
  return new GLTFExporter().parseAsync(scene, { binary: true, animations: clips, trs: true, onlyVisible: true });
}
