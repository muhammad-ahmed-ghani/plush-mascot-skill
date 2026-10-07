// Exactly three pieces of confetti, as in the artwork's bottom-right vignette: two body paper streamers and one gold
// disc.  The streamers are ribbons that flutter and twist as they fly; the disc is a bevelled coin that spins with a
// wobble so its metal edge throws glints.  Launch / fall / fade timing is unchanged from the original.
import * as THREE from 'three';

const RIBBON_W = 0.28, RIBBON_H = 0.13, SEG_X = 16, SEG_Y = 4;

function ribbon() {
  const geo = new THREE.PlaneGeometry(RIBBON_W, RIBBON_H, SEG_X, SEG_Y);
  const mat = new THREE.MeshPhysicalMaterial({ color: '#e0474a', roughness: 0.55, metalness: 0, sheen: 0.4, sheenColor: new THREE.Color('#ff9a8c'), sheenRoughness: 0.6, side: THREE.DoubleSide });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.userData.base = Float32Array.from(geo.attributes.position.array);
  return mesh;
}
function coin() {
  const r = 0.085, t = 0.007, b = 0.012;   // radius, half thickness, bevel width
  const pts = [new THREE.Vector2(0, t), new THREE.Vector2(r - b, t), new THREE.Vector2(r - b * 0.3, t * 0.6), new THREE.Vector2(r, 0), new THREE.Vector2(r - b * 0.3, -t * 0.6), new THREE.Vector2(r - b, -t), new THREE.Vector2(0, -t)];
  const geo = new THREE.LatheGeometry(pts, 40);
  geo.rotateX(Math.PI / 2);
  return new THREE.Mesh(geo, new THREE.MeshPhysicalMaterial({ color: '#dcaa42', roughness: 0.22, metalness: 0.9, envMapIntensity: 2.4 }));
}

/** Flutter + twist a ribbon in place: a travelling wave across its length and a slow twist about its long axis. */
function flutter(mesh, t, phase) {
  const pos = mesh.geometry.attributes.position, base = mesh.userData.base;
  for (let i = 0; i < pos.count; i++) {
    const x = base[i * 3], y = base[i * 3 + 1];
    const u = x / RIBBON_W;                                  // -0.5 .. 0.5 along the ribbon
    const twist = 0.55 * Math.sin(u * 3.5 + t * 4.2 + phase);  // radians of roll about the long axis, varying along it
    const wave = 0.028 * Math.sin(u * 5 + t * 6 + phase * 1.7) + 0.045 * Math.sin(u * 2.4 - t * 3.1);   // the paper curls
    pos.setXYZ(i, x, y * Math.cos(twist), y * Math.sin(twist) + wave);
  }
  pos.needsUpdate = true;
  mesh.geometry.computeVertexNormals();
}

/** @returns {{group: THREE.Group, update: (o: {confettiT: number, hop: number}) => void}} `confettiT` = seconds since success began, or < 0 for none. */
export function buildConfetti() {
  const group = new THREE.Group();
  group.name = 'Confetti';
  const pieces = [
    { mesh: ribbon(), kind: 'ribbon', from: [-0.7, 3.0, 0.1], to: [-1.75, 3.35, 0.35], spin: [2.4, 1.7, 3.1], delay: 0.00, phase: 0.0 },
    { mesh: coin(), kind: 'coin', from: [0.6, 3.1, 0.0], to: [1.05, 3.85, 0.2], spin: [1.9, 2.6, 0.0], delay: 0.06, phase: 1.3 },
    { mesh: ribbon(), kind: 'ribbon', from: [0.9, 2.8, 0.1], to: [1.85, 2.75, 0.4], spin: [2.9, 2.2, 2.4], delay: 0.11, phase: 2.6 },
  ];
  for (const p of pieces) { p.mesh.castShadow = true; group.add(p.mesh); }
  group.visible = false;
  const q = new THREE.Quaternion(), e = new THREE.Euler(), zAxis = new THREE.Vector3(0, 0, 1);

  return {
    group,
    update({ confettiT = -1, hop = 0 }) {
      if (confettiT < 0) { group.visible = false; return; }
      group.visible = true;
      for (const p of pieces) {
        const t = Math.max(0, confettiT - p.delay);
        const out = 1 - Math.exp(-t * 4.2);                // launch, easing out
        const fall = Math.max(0, t - 0.7);
        const alpha = t < 0.02 ? 0 : Math.min(1, (2.4 - t) * 2.5);
        p.mesh.visible = alpha > 0.02;
        p.mesh.position.set(
          p.from[0] + (p.to[0] - p.from[0]) * out,
          p.from[1] + (p.to[1] - p.from[1]) * out - fall * fall * 0.38 + hop * 0.35,
          p.from[2] + (p.to[2] - p.from[2]) * out,
        );
        if (p.kind === 'coin') {
          // spin about the disc's own axis while that axis wobbles (precession): the edge sweeps past the lights and glints
          const wob = 0.45;
          e.set(wob * Math.sin(t * 3.1 + p.phase), t * p.spin[1] * 1.6, wob * Math.cos(t * 3.1 + p.phase));
          p.mesh.quaternion.setFromEuler(e).multiply(q.setFromAxisAngle(zAxis, t * 9));
        } else {
          // tumbling slows as the ribbon drifts; the ribbon itself flutters and twists
          const s = 0.55 + 0.45 * Math.exp(-t * 1.5);
          p.mesh.rotation.set(t * p.spin[0] * s, t * p.spin[1] * s, t * p.spin[2] * s + p.phase);
          flutter(p.mesh, t, p.phase);
        }
        p.mesh.scale.setScalar(Math.max(0.001, alpha));
      }
    },
  };
}
