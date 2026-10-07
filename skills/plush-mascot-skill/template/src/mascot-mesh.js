// Loader for the baked MSCT sculpt (see scripts/bake/bake.mjs).
import * as THREE from 'three';

export async function loadMascotMesh(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Mascot mesh failed to load (${response.status})`);
  return parseMascotMesh(await response.arrayBuffer());
}

export function parseMascotMesh(buffer) {
  const dv = new DataView(buffer);
  const magic = String.fromCharCode(dv.getUint8(0), dv.getUint8(1), dv.getUint8(2), dv.getUint8(3));
  if (magic !== 'MSCT') throw new Error('Not a MSCT file');
  const jsonLength = dv.getUint32(8, true);
  const meta = JSON.parse(new TextDecoder().decode(new Uint8Array(buffer, 12, jsonLength)));
  const base = 12 + jsonLength;
  const parts = {};
  for (const part of meta.parts) {
    const view = (name, Type) => {
      const b = part.buffers[name];
      return new Type(buffer, base + b.offset, b.byteLength / Type.BYTES_PER_ELEMENT);
    };
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(view('position', Float32Array), 3));
    geometry.setAttribute('normal', new THREE.BufferAttribute(view('normal', Float32Array), 3));
    geometry.setAttribute('ao', new THREE.BufferAttribute(view('ao', Uint8Array), 1, true));
    geometry.setAttribute('curv', new THREE.BufferAttribute(view('curv', Int8Array), 1, true));
    geometry.setAttribute('skinIndex', new THREE.BufferAttribute(view('skinIndex', Uint8Array), 4));
    geometry.setAttribute('skinWeight', new THREE.BufferAttribute(view('skinWeight', Uint8Array), 4, true));
    // construction-seam field (MSCT v2): signed distance + presence, and the unit direction across the seam.  Optional so an
    // older bake still loads; the shader treats a missing attribute as "no seam" (presence 0).
    if (part.buffers.seam) geometry.setAttribute('seam', new THREE.BufferAttribute(view('seam', Int16Array), 2, true));
    if (part.buffers.seamDir) geometry.setAttribute('seamDir', new THREE.BufferAttribute(view('seamDir', Int8Array), 4, true));
    geometry.setIndex(new THREE.BufferAttribute(view('index', Uint32Array), 1));
    geometry.computeBoundingSphere();
    parts[part.name] = geometry;
  }
  return { parts, bones: meta.bones, anchors: meta.anchors, params: meta.params, meta };
}
