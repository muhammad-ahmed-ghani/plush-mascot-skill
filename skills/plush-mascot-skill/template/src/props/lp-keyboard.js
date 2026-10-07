// The laptop keyboard: one InstancedMesh of low-profile, slightly tapered keycaps.  Wide keys (shift, space...) stretch the flat middle
// of the shared keycap in the vertex shader (per-instance extra half-width), so the corner rounding stays crisp at every width;
// legends come from one atlas via a per-instance cell.  Keys go down where something actually presses on them: press(ball) takes a
// hand ball in keyboard space and pushes down every key whose top would otherwise poke into it.
import * as THREE from 'three';
import { keycapGeometry } from './lp-geometry.js';
import { legendAtlas, LEGEND_COLS, LEGEND_ROWS } from './lp-textures.js';

// rows from the back (function row) to the front; [label, width in key units]
const ROWS = [
  [['esc', 1.5], ...Array.from({ length: 12 }, (_, i) => [`F${i + 1}`, 1]), ['', 1]],
  [['`', 1], ...'1234567890-='.split('').map((c) => [c, 1]), ['delete', 1.5]],
  [['tab', 1.5], ...'QWERTYUIOP[]'.split('').map((c) => [c, 1]), ['\\', 1]],
  [['caps lock', 1.75], ...'ASDFGHJKL;\''.split('').map((c) => [c, 1]), ['return', 1.75]],
  [['shift', 2.25], ...'ZXCVBNM,./'.split('').map((c) => [c, 1]), ['shift', 2.25]],
  [['fn', 1], ['control', 1], ['option', 1], ['command', 1.25], ['', 5], ['command', 1.25], ['option', 1], ['◀', 1], ['▲▼', 1], ['▶', 1]],
];

/**
 * @param {object} o
 * @param {number} o.width   keyboard width (laptop units)
 * @param {number} o.capH    keycap height
 * @param {number} o.travel  how far a key can go down
 * @returns the keyboard: its mesh sits with the key bottoms on y = 0, centred on x / z = 0
 */
export function buildKeyboard({ width = 1.06, capH = 0.006, travel = 0.0035 } = {}) {
  const units = 14.5, pitch = width / units, gap = pitch * 0.14;
  const kw = pitch - gap, rowPitch = pitch * 0.94, kd = rowPitch - gap, halfD = kd * 0.5;
  const labels = [...new Set(ROWS.flat().map(([l]) => l).filter(Boolean).flatMap((l) => (l === '▲▼' ? ['▲', '▼'] : [l])))];
  const atlas = legendAtlas(labels);
  // ---- layout -----------------------------------------------------------------------------------------------------------------
  const keys = [];
  const depthTotal = rowPitch * 5 + halfD + gap;
  let z = -depthTotal / 2 + halfD / 2;                                  // centre of the (half-height) function row
  ROWS.forEach((row, r) => {
    const depth = r === 0 ? halfD : kd;
    let x = -width / 2;
    for (const [label, u] of row) {
      const w = u * pitch - gap;
      const cx = x + (u * pitch) / 2;
      if (label === '▲▼') {                                           // stacked half-height arrow keys
        const hd = (kd - gap) / 2;
        keys.push({ label: '▲', x: cx, z: z - (hd + gap) / 2, w, d: hd, row: r });
        keys.push({ label: '▼', x: cx, z: z + (hd + gap) / 2, w, d: hd, row: r });
      } else keys.push({ label, x: cx, z, w, d: depth, row: r });
      x += u * pitch;
    }
    z += r === 0 ? (halfD + kd) / 2 + gap : rowPitch;
  });
  // ---- geometry + instancing --------------------------------------------------------------------------------------------------
  const geo = keycapGeometry(kw, capH, kd, Math.min(kw, kd) * 0.09, 0.05);
  const n = keys.length;
  const stretch = new Float32Array(n * 2), cell = new Float32Array(n * 4);
  keys.forEach((k, i) => {
    stretch[i * 2] = (k.w - kw) / 2; stretch[i * 2 + 1] = (k.d - kd) / 2;
    const ci = atlas.index.get(k.label) ?? 0;
    cell[i * 4] = (ci % LEGEND_COLS) / LEGEND_COLS; cell[i * 4 + 1] = 1 - (Math.floor(ci / LEGEND_COLS) + 1) / LEGEND_ROWS;
    cell[i * 4 + 2] = 1 / LEGEND_COLS; cell[i * 4 + 3] = 1 / LEGEND_ROWS;
  });
  geo.setAttribute('aStretch', new THREE.InstancedBufferAttribute(stretch, 2));
  geo.setAttribute('aCell', new THREE.InstancedBufferAttribute(cell, 4));

  const stretchVertex = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec2 aStretch; attribute vec4 aCell; varying vec2 vLeg; varying float vTop;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        transformed.x += sign(position.x) * aStretch.x;
        transformed.z += sign(position.z) * aStretch.y;
        vLeg = aCell.xy + aCell.zw * clamp(vec2(0.5 + position.x / ${kw.toFixed(5)}, 0.5 - position.z / ${kd.toFixed(5)}), 0.0, 1.0);
        vTop = smoothstep(0.92, 0.995, normal.y);`);
  };
  const material = new THREE.MeshPhysicalMaterial({ color: '#2b2c31', roughness: 0.58, metalness: 0, sheen: 0.3, sheenColor: new THREE.Color('#8e8d95'), sheenRoughness: 0.55, specularIntensity: 0.5 });
  material.onBeforeCompile = (shader) => {
    stretchVertex(shader);
    shader.uniforms.uLegend = { value: atlas.texture };
    shader.uniforms.uLegendColor = { value: new THREE.Color('#aeaba6') };
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform sampler2D uLegend; uniform vec3 uLegendColor; varying vec2 vLeg; varying float vTop;')
      .replace('#include <color_fragment>', `#include <color_fragment>
        float legend = texture2D(uLegend, vLeg).a * vTop;
        diffuseColor.rgb = mix(diffuseColor.rgb, uLegendColor, legend * 0.8);`);
  };
  material.customProgramCacheKey = () => 'lp-keys';
  const depthMaterial = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });
  depthMaterial.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec2 aStretch;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\n transformed.x += sign(position.x) * aStretch.x; transformed.z += sign(position.z) * aStretch.y;');
  };
  depthMaterial.customProgramCacheKey = () => 'lp-keys-depth';

  const mesh = new THREE.InstancedMesh(geo, material, n);
  mesh.name = 'Keys';
  mesh.customDepthMaterial = depthMaterial;
  mesh.castShadow = mesh.receiveShadow = true;
  mesh.frustumCulled = false;
  const m = new THREE.Matrix4();
  const press = new Float32Array(n), want = new Float32Array(n);
  const place = (i) => { const k = keys[i]; m.makeTranslation(k.x, -press[i] * travel, k.z); mesh.setMatrixAt(i, m); };
  for (let i = 0; i < n; i++) place(i);
  mesh.instanceMatrix.needsUpdate = true;
  const downs = [];                                                     // keys that went fully down this frame (for the screen)

  return {
    mesh, keys, size: { width, depth: depthTotal, capH, travel },
    dispose() { geo.dispose(); material.dispose(); depthMaterial.dispose(); atlas.texture.dispose(); },
    /** start a frame: forget last frame's contacts */
    begin() { want.fill(0); downs.length = 0; },
    /**
     * A ball (keyboard space: key bottoms at y = 0) resting on the keys: every key under it whose top would poke more than `soft` into
     * the ball is pushed down (up to its travel), so the key that goes down is the key under the hand that goes down.
     */
    press(cx, cy, cz, r, soft = 0) {
      const top = capH;
      for (let i = 0; i < n; i++) {
        const k = keys[i];
        const dx = Math.max(0, Math.abs(cx - k.x) - k.w / 2 * 0.6), dz = Math.max(0, Math.abs(cz - k.z) - k.d / 2 * 0.6);
        const d2 = dx * dx + dz * dz;
        if (d2 >= r * r) continue;
        const surf = cy - Math.sqrt(r * r - d2) + soft;                 // underside of the (softly squashed) ball above this key
        const depth = (top - surf) / travel;
        if (depth > want[i]) want[i] = Math.min(1, depth);
      }
    },
    /** finish the frame: keys follow their presses, springing back up quickly when released */
    end(dt = 0) {
      let changed = false;
      const up = dt > 0 && dt <= 0.051 ? 1 - Math.exp(-dt * 38) : 1;          // (a still, or a jump in time, snaps)
      for (let i = 0; i < n; i++) {
        const target = Math.max(0, want[i]);
        const next = target >= press[i] ? target : press[i] + (target - press[i]) * up;
        if (Math.abs(next - press[i]) > 1e-4) {
          if (press[i] < 0.9 && next >= 0.9) downs.push(i);
          press[i] = next; place(i); changed = true;
        }
      }
      if (changed) mesh.instanceMatrix.needsUpdate = true;
      return downs;
    },
    /** release everything at once (no hands) */
    reset() { let changed = false; for (let i = 0; i < n; i++) if (press[i] !== 0) { press[i] = 0; place(i); changed = true; } if (changed) mesh.instanceMatrix.needsUpdate = true; },
  };
}
