// Dev-only: loads the exported GLB with three's stock GLTFLoader and renders chosen frames of its clips, to prove the file is
// self-contained (skin, clips, materials) outside the studio.  Driven by scripts/dev/glb-check.mjs.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const size = 700;
const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
renderer.setSize(size, size);
renderer.setClearColor(0xf6f3ee, 1);
document.body.append(renderer.domElement);
const scene = new THREE.Scene();
scene.add(new THREE.HemisphereLight(0xfff6ee, 0xe9a898, 1.6));
const key = new THREE.DirectionalLight(0xfff3e6, 2.2); key.position.set(3, 6, 6); scene.add(key);
const camera = new THREE.PerspectiveCamera(24, 1, 0.1, 100);
camera.position.set(0, 1.9, 13); camera.lookAt(0, 1.75, 0);

const gltf = await new GLTFLoader().loadAsync('/assets/mascot-animated.glb');
scene.add(gltf.scene);
const mixer = new THREE.AnimationMixer(gltf.scene);
const skinned = [];
gltf.scene.traverse((o) => { if (o.isSkinnedMesh) skinned.push(o); });

const tree = [];
gltf.scene.traverse((o) => { if (o.parent === gltf.scene || o.isMesh) tree.push(`${o.type}:${o.name || '-'}:${o.isSkinnedMesh ? 'skinned' : ''}`); });
window.glbCheck = {
  tree,
  clips: gltf.animations.map((a) => ({ name: a.name, duration: a.duration, tracks: a.tracks.length })),
  skinned: skinned.map((m) => ({ name: m.name, verts: m.geometry.attributes.position.count, parent: m.parent.type })),
  frame(name, t) {
    const clip = gltf.animations.find((c) => c.name === name);
    mixer.stopAllAction();
    mixer.clipAction(clip).play();
    mixer.setTime(t);
    gltf.scene.updateMatrixWorld(true);
    renderer.render(scene, camera);
    const box = new THREE.Box3(), v = new THREE.Vector3();
    for (const m of skinned) { m.skeleton.update(); for (let i = 0; i < m.geometry.attributes.position.count; i += 9) { m.getVertexPosition(i, v); v.applyMatrix4(m.matrixWorld); box.expandByPoint(v); } }
    return { png: renderer.domElement.toDataURL('image/png'), min: box.min.toArray(), max: box.max.toArray() };
  },
};
window.__glbReady = true;
