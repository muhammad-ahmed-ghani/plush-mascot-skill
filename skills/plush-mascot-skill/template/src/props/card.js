// The cream decision card with one charcoal check, held up beside the face in the approval state (bottom-left vignette
// of assets/mascot-use-cases.png): thick card stock with a fully rounded edge, a faint paper-fibre grain, a bold felt-like
// check appliqued on the face, and one corner lifting in a soft curl.  It swings in with a small overshoot and then
// floats and wobbles very slightly in the hand.
import * as THREE from 'three';
import { clamp01, easeOutBack, smooth } from './shared.js';

const W = 0.5, H = 0.66, T = 0.028;

/**
 * How the card is held (rig-root units): the artwork's card is about 1.6x the size of a hand's span and sits beside the face, the hand
 * gripping its bottom corner from in front.  `offset` carries the wrist joint to the card's centre; the card never touches the head
 * (the pose keeps the hand out beside it: see 'approval' in mascot-pose.js and scratch/clear checks in tests/VALIDATION.md).
 */
export const CARD = { scale: 1.5, offset: [0.22, 0.6, -0.1], yaw: 0.06, pitch: 0.04 };

/** Tileable paper-fibre normal map (and a matching roughness map) generated from layered value noise. 256 px, made once per card. */
function paperMaps(size = 256, seed = 1234) {
  let a = seed >>> 0;
  const rand = () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const noise = (cells) => {
    const lat = new Float32Array(cells * cells);
    for (let i = 0; i < lat.length; i++) lat[i] = rand();
    return (u, v) => {
      const x = u * cells, y = v * cells, x0 = Math.floor(x), y0 = Math.floor(y), fx = x - x0, fy = y - y0;
      const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
      const at = (i, j) => lat[((j % cells + cells) % cells) * cells + ((i % cells + cells) % cells)];
      const p = at(x0, y0), q = at(x0 + 1, y0), r = at(x0, y0 + 1), s = at(x0 + 1, y0 + 1);
      return p + (q - p) * sx + (r - p) * sy + (p - q - r + s) * sx * sy;
    };
  };
  const n1 = noise(64), n2 = noise(128), n3 = noise(24);
  const height = new Float32Array(size * size);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const u = x / size, v = y / size;
    // short fibres: fine noise stretched along two directions, over a soft blotchy base (paper is never flat)
    height[y * size + x] = 0.55 * n2(u, v) + 0.3 * n1(u * 1.7, v * 0.6) + 0.15 * n3(u, v);
  }
  const normal = new Uint8Array(size * size * 4), rough = new Uint8Array(size * size * 4);
  const h = (x, y) => height[((y + size) % size) * size + ((x + size) % size)];
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const dx = (h(x + 1, y) - h(x - 1, y)) * 2.2, dy = (h(x, y + 1) - h(x, y - 1)) * 2.2;
    const l = Math.hypot(dx, dy, 1);
    const i = (y * size + x) * 4;
    normal[i] = 128 + (-dx / l) * 127; normal[i + 1] = 128 + (-dy / l) * 127; normal[i + 2] = 128 + (1 / l) * 127; normal[i + 3] = 255;
    const r = 200 + (h(x, y) - 0.5) * 70;
    rough[i] = rough[i + 1] = rough[i + 2] = Math.max(0, Math.min(255, r)); rough[i + 3] = 255;
  }
  const tex = (data) => {
    const t = new THREE.DataTexture(data, size, size, THREE.RGBAFormat, THREE.UnsignedByteType);
    t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(2.2, 2.9);
    t.minFilter = THREE.LinearMipmapLinearFilter; t.magFilter = THREE.LinearFilter; t.generateMipmaps = true; t.anisotropy = 4;
    t.colorSpace = THREE.NoColorSpace; t.needsUpdate = true;
    return t;
  };
  return { normalMap: tex(normal), roughnessMap: tex(rough) };
}

/**
 * Card stock: a rounded-rectangle outline swept with a fully round edge, and both faces filled with concentric rings so
 * they have real interior vertices (RoundedBoxGeometry keeps its faces as single quads, which cannot bend).  Indexed,
 * seamless, with UVs for the paper maps; `curl(x, y)` lifts the surface (both faces alike) before normals are computed.
 */
function slabGeometry(w, h, t, corner, curl) {
  const R = t / 2;
  // outline loop (CCW) with outward normals from the neighbouring tangents
  const loop = [];
  const cx = w / 2 - corner, cy = h / 2 - corner, arcN = 10, edgeN = 6;
  const arc = (ax, ay, a0) => { for (let i = 0; i <= arcN; i++) { const a = a0 + (Math.PI / 2) * (i / arcN); loop.push([ax + corner * Math.cos(a), ay + corner * Math.sin(a)]); } };
  const edge = (x0, y0, x1, y1) => { for (let i = 1; i <= edgeN; i++) { const k = i / (edgeN + 1); loop.push([x0 + (x1 - x0) * k, y0 + (y1 - y0) * k]); } };
  arc(cx, -cy, -Math.PI / 2); edge(w / 2, -cy, w / 2, cy); arc(cx, cy, 0); edge(cx, h / 2, -cx, h / 2);
  arc(-cx, cy, Math.PI / 2); edge(-w / 2, cy, -w / 2, -cy); arc(-cx, -cy, Math.PI); edge(-cx, -h / 2, cx, -h / 2);
  const m = loop.length;
  const nrm = loop.map((p, i) => { const a = loop[(i - 1 + m) % m], b = loop[(i + 1) % m]; let tx = b[0] - a[0], ty = b[1] - a[1]; const l = Math.hypot(tx, ty); return [ty / l, -tx / l]; });
  // stations: front face centre -> rim, half-round edge, rim -> back face centre.  {k} scales the last inset loop toward the centre.
  const st = [{ k: 0, z: R }];
  for (const k of [0.15, 0.3, 0.45, 0.6, 0.72, 0.82, 0.9, 0.96]) st.push({ k, z: R });
  st.push({ d: R + 0.012, z: R });
  for (let i = 0; i <= 8; i++) { const phi = Math.PI / 2 - Math.PI * (i / 8); st.push({ d: R * (1 - Math.cos(phi)), z: R * Math.sin(phi) }); }
  st.push({ d: R + 0.012, z: -R });
  for (const k of [0.96, 0.9, 0.82, 0.72, 0.6, 0.45, 0.3, 0.15, 0]) st.push({ k, z: -R });
  const pos = [], uv = [], rings = [];
  let lastD = R + 0.012;
  for (const s of st) {
    if (s.d !== undefined) lastD = s.d;
    if (s.k === 0) { rings.push({ start: pos.length / 3, single: true }); pos.push(0, 0, s.z); uv.push(0.5, 0.5); continue; }
    const k = s.k ?? 1, d = s.d ?? lastD;
    rings.push({ start: pos.length / 3, single: false });
    for (let i = 0; i < m; i++) {
      const x = (loop[i][0] - d * nrm[i][0]) * k, y = (loop[i][1] - d * nrm[i][1]) * k;
      pos.push(x, y, s.z); uv.push(x / w + 0.5, y / h + 0.5);
    }
  }
  const index = [];
  for (let j = 0; j < rings.length - 1; j++) {
    const r0 = rings[j], r1 = rings[j + 1];
    if (r0.single) { for (let i = 0; i < m; i++) index.push(r0.start, r1.start + (i + 1) % m, r1.start + i); continue; }
    if (r1.single) { for (let i = 0; i < m; i++) index.push(r1.start, r0.start + i, r0.start + (i + 1) % m); continue; }
    for (let i = 0; i < m; i++) { const i1 = (i + 1) % m; index.push(r0.start + i, r0.start + i1, r1.start + i, r0.start + i1, r1.start + i1, r1.start + i); }
  }
  for (let i = 0; i < pos.length; i += 3) pos[i + 2] += curl(pos[i], pos[i + 1]);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(index);
  g.computeVertexNormals();
  // the front-face centre must face +z; flip every triangle if the winding came out inward
  if (g.attributes.normal.getZ(0) < 0) { const ix = g.index.array; for (let i = 0; i < ix.length; i += 3) { const tmp = ix[i + 1]; ix[i + 1] = ix[i + 2]; ix[i + 2] = tmp; } g.computeVertexNormals(); }
  return g;
}

/**
 * Outline (THREE.Shape) of a thick two-segment stroke p0 -> p1 -> p2 with round caps and a round outer join: the check
 * mark.  Walked counter-clockwise: right side forward, the join, the front cap, left side back, the back cap.
 */
function checkShape(p0, p1, p2, w) {
  const V = (p) => new THREE.Vector2(p[0], p[1]);
  const d1 = V(p1).sub(V(p0)).normalize(), d2 = V(p2).sub(V(p1)).normalize();
  const n1 = new THREE.Vector2(-d1.y, d1.x), n2 = new THREE.Vector2(-d2.y, d2.x);      // left normals
  const pts = [];
  // arc points around centre c from direction `from` to direction `to`, counter-clockwise, endpoints included
  const arcCCW = (c, from, to) => {
    const a0 = Math.atan2(from.y, from.x); let a1 = Math.atan2(to.y, to.x);
    while (a1 <= a0) a1 += Math.PI * 2;
    for (let i = 0; i <= 10; i++) { const a = a0 + (a1 - a0) * (i / 10); pts.push(new THREE.Vector2(c.x + w * Math.cos(a), c.y + w * Math.sin(a))); }
  };
  // where the two offset lines on one side meet: the inner side of the corner is that single point, no arc
  const meet = (sign) => {
    const a = V(p1).addScaledVector(n1, sign * w), b = V(p1).addScaledVector(n2, sign * w);
    const den = d1.x * d2.y - d1.y * d2.x;
    const t = ((b.x - a.x) * d2.y - (b.y - a.y) * d2.x) / den;
    return a.addScaledVector(d1, t);
  };
  const leftTurn = d1.x * d2.y - d1.y * d2.x > 0;                 // turning left: the outer (round) side of the join is on the right
  const P0 = V(p0), P1 = V(p1), P2 = V(p2);
  // The arcs supply the side endpoints, so the straight sides need no extra points (a redundant point beyond the inner
  // meeting point would fold the outline back on itself and break the triangulation).
  if (leftTurn) arcCCW(P1, n1.clone().negate(), n2.clone().negate()); else pts.push(meet(-1));   // right side: join at the corner
  arcCCW(P2, n2.clone().negate(), n2);                                                          // front cap
  if (leftTurn) pts.push(meet(1)); else arcCCW(P1, n2, n1);                                     // left side: join at the corner
  arcCCW(P0, n1, n1.clone().negate());                                                          // back cap
  return new THREE.Shape(pts);
}

/** @returns {{group: THREE.Group, update: (o: {card: number, time?: number, hand?: THREE.Vector3}) => void}} */
export function buildCard() {
  const group = new THREE.Group();
  group.name = 'DecisionCard';
  group.userData.hold = CARD;                        // (the live grip numbers, for tuning in a console)
  const maps = paperMaps();
  const paper = new THREE.MeshPhysicalMaterial({
    color: '#f3eadb', roughness: 0.92, roughnessMap: maps.roughnessMap, normalMap: maps.normalMap, normalScale: new THREE.Vector2(0.35, 0.35),
    sheen: 0.35, sheenColor: new THREE.Color('#fff7ea'), sheenRoughness: 0.75, specularIntensity: 0.35,
  });
  // slab with a fully round edge; the top-right corner lifts toward the viewer in a soft curl
  const slabGeo = slabGeometry(W, H, T, 0.03, (x, y) => {
    const dx = Math.max(0, (x - 0.02) / (W / 2)), dy = Math.max(0, (y - 0.08) / (H / 2));
    const k = smooth(Math.max(0, dx * dy * 1.6 - 0.02));
    return 0.05 * k * k;
  });
  const slab = new THREE.Mesh(slabGeo, paper);
  slab.castShadow = slab.receiveShadow = true;
  group.add(slab);
  // the check: a felt-like applique standing a little proud of the card, bevelled so its edge catches light
  const ink = new THREE.MeshPhysicalMaterial({ color: '#2b2a2f', roughness: 0.8, sheen: 0.5, sheenColor: new THREE.Color('#77737c'), sheenRoughness: 0.6, specularIntensity: 0.2 });
  const shape = checkShape([-0.115, -0.045], [-0.03, -0.13], [0.125, 0.07], 0.03);
  const checkGeo = new THREE.ExtrudeGeometry(shape, { depth: 0.012, bevelEnabled: true, bevelThickness: 0.004, bevelSize: 0.004, bevelSegments: 3, curveSegments: 10 });
  checkGeo.translate(0, 0.01, T / 2 - 0.003);
  const check = new THREE.Mesh(checkGeo, ink);
  check.castShadow = check.receiveShadow = true;
  group.add(check);
  group.visible = false;

  const offset = new THREE.Vector3();
  return {
    group,
    update({ card = 0, time = 0, hand }) {
      group.visible = card > 0.01 && !!hand;
      if (!group.visible) return;
      const c = clamp01(card);
      // offered: the card swings in from the palm with a small overshoot, then rests with a faint hand-held float
      const pop = easeOutBack(c, 1.2);
      const swing = (1 - smooth(c)) * 0.9;
      const grow = Math.max(0.0001, 0.35 + 0.65 * pop) * c;                // it opens out of the palm: small and in the hand, then up and out to its place
      group.position.copy(hand).add(offset.set(...CARD.offset).multiplyScalar(grow));
      group.position.y += 0.01 * Math.sin(time * 2.1) * c;
      group.rotation.set(CARD.pitch + 0.02 * Math.sin(time * 1.3 + 0.7) * c, CARD.yaw - swing, -0.07 + 0.025 * Math.sin(time * 1.7 + 1.1) * c);
      group.scale.setScalar(grow * CARD.scale);
    },
  };
}
