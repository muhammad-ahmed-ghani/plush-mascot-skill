// One of Mascot's eyes: a puffy cream felt sclera cut to the artwork's outline, a dark contact line where it meets the face fabric, a felt
// iris + pupil + catchlight that follow the gaze, and two eyelids of the face fabric that close over it (see setLids).
//
// Everything is in the eye's own frame: origin at the centre of the measured outline, +z along the face-plate normal, +x right, +y up.
import * as THREE from 'three';
import { createFabricMaterial } from '../mascot-fabric.js';
import { outlinePillow, neutralAttributes } from './footprint.js';
import { IRIS_PLANE } from './textures.js';

export const EYE = { rz: 0.034, sink: 0.004, n: 4.6, lidRise: 1.5 };
const Z = new THREE.Vector3(0, 0, 1);

const gained = (hex, g) => new THREE.Color(hex).multiply(new THREE.Color(g[0], g[1], g[2]));

// ---- shared shader pieces ---------------------------------------------------------------------------------------------------------
// The eyelids cast a soft shadow on what they leave uncovered, and hide what they cover.  Every eye material shares one uniform block per
// eye (`lidBlock`) and reads its position in the eye's unit frame (x / rx, y / ry) from a varying.  The iris, pupil and catchlight are also
// clipped to the eye's outline (they may reach its edge, but not past it) - by the stencil buffer, see STENCIL_* below.
const LID_SHADOW_PARS = /* glsl */`
uniform vec4 uLidA;         // top cut, top arch, bottom cut, bottom arch  (the lid's free edge is  cut + arch * (1 - x^2)  in the unit frame)
uniform vec2 uLidAmt;       // shadow strength cast by the top / bottom lid (0 while the lid is fully open)
uniform float uLidTilt;
uniform float uLidShadowW;  // penumbra width (unit frame)
uniform vec2 uEyeScale;     // half extents of the eye (unit frame -> units)
varying vec2 vEyeUV;
float mascotLidShadow( vec2 uv ) {
	float lw = uv.y * cos( uLidTilt ) + uv.x * sin( uLidTilt );
	float x2 = 1.0 - uv.x * uv.x;
	float dT = ( uLidA.x + uLidA.y * x2 ) - lw;      // > 0 below the top lid's edge
	float dB = lw - ( uLidA.z + uLidA.w * x2 );      // > 0 above the bottom lid's edge
	// (at full strength right up to the edge and beyond it, under the lid: the lid's edge is blended over a pixel or so, and a shadow that
	// stopped dead at the edge let the fully lit white show through that fringe as a bright stair-stepped line)
	return max( uLidAmt.x * exp( - max( dT, 0.0 ) / uLidShadowW ), uLidAmt.y * exp( - max( dB, 0.0 ) / uLidShadowW ) );
}
bool mascotLidCovers( vec2 uv ) {
	float lw = uv.y * cos( uLidTilt ) + uv.x * sin( uLidTilt );
	float x2 = 1.0 - uv.x * uv.x;
	// (a little inside the lids' free edges: their edges are soft, and what lies behind them must not be the white)
	return lw > uLidA.x + uLidA.y * x2 + 0.03 || lw < uLidA.z + uLidA.w * x2 - 0.03;
}
`;

// The iris, pupil and catchlight reach the eye's outline and must stop there.  A per-pixel `discard` at the outline staircases and lets
// specks of white through; the stencil buffer is exact: the sclera writes 1 wherever it is drawn (its edge is multisampled like any
// geometry edge), and the pieces set on it draw only where the stencil is 1.  The sclera has to draw first (see buildEye).
const STENCIL_WRITE = { stencilWrite: true, stencilRef: 1, stencilFunc: THREE.AlwaysStencilFunc, stencilZPass: THREE.ReplaceStencilOp };
const STENCIL_TEST = { stencilWrite: true, stencilWriteMask: 0x00, stencilRef: 1, stencilFunc: THREE.EqualStencilFunc };

/**
 * Patch a material so it receives the lid shadow (`toEye` maps the mesh's own position into the eye's unit frame; the caller updates it).
 * `clip` also hides it under the lids and outside the eye's outline (by the stencil test) - for the flat pieces set on the sclera.
 */
function receiveLidShadow(material, lidBlock, toEye, { name, clip = false, basic = false, extra } = {}) {
  const prev = material.onBeforeCompile;
  material.onBeforeCompile = (shader, renderer) => {
    prev?.call(material, shader, renderer);
    Object.assign(shader.uniforms, lidBlock, { uToEye: toEye });
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nuniform mat4 uToEye; varying vec2 vEyeUV;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvEyeUV = ( uToEye * vec4( position, 1.0 ) ).xy;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${LID_SHADOW_PARS}`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        ${clip ? 'if ( mascotLidCovers( vEyeUV ) ) discard;' : ''}
        float mascotLs = mascotLidShadow( vEyeUV );`)
      .replace('#include <tonemapping_fragment>', '#include <tonemapping_fragment>\ngl_FragColor.rgb *= 1.0 - mascotLs;');      // (on the displayed light, so a bright white shades as much as a dark iris)
    extra?.(shader);
  };
  if (clip) Object.assign(material, STENCIL_TEST);
  material.customProgramCacheKey = () => `mascot-eye-${name}`;         // (explicit: the wrappers are identical text, so three's default key would make the programs collide)
  return material;
}

/**
 * The sclera: satin cream felt.  Its edge is measured from the artwork, where the whites do not end in a step: they fall away in a ramp
 * that ends in a dark line (a puffy appliqué sitting in a pocket), and the ramp differs round the eye (wide along the top, narrow at the side,
 * none where the lower edge is lit).  The ramp is looked up per direction and per distance inside the edge from a small image measured on
 * the artwork (kit.rimMap) and multiplies the displayed light.
 */
function scleraMaterial(kit, gain, tint, side, lidBlock, shape) {
  const rim = { uRimLut: { value: kit.rimMap }, uRimDepth: { value: kit.rim.depth }, uRimChannel: { value: side > 0 ? 0 : 1 }, uShadeLut: { value: kit.shadeMap } };
  const m = new THREE.MeshPhysicalMaterial({
    color: gained('#ffffff', kit.gain.sclera).multiply(new THREE.Color(...tint)).multiplyScalar(gain), map: kit.scleraMap,
    roughness: 0.84, sheen: 0.55, sheenColor: new THREE.Color('#f7efe4'), sheenRoughness: 0.6, specularIntensity: 0.18,
    emissive: new THREE.Color('#3a332b'), emissiveIntensity: 0.22,
  });
  const identity = { value: new THREE.Matrix4() };
  receiveLidShadow(m, lidBlock, identity, {
    name: 'sclera',
    extra(shader) {
      Object.assign(shader.uniforms, rim);
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nattribute float aEdge; uniform vec2 uEyeScale; varying float vEdge; varying vec2 vLocal;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvEdge = aEdge; vLocal = position.xy * uEyeScale;');
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying float vEdge; varying vec2 vLocal; uniform sampler2D uRimLut; uniform sampler2D uShadeLut; uniform float uRimDepth; uniform float uRimChannel;')
        .replace('#include <color_fragment>', `#include <color_fragment>
          float mascotAng = atan( vLocal.y, vLocal.x );
          vec2 mascotRuv = vec2( clamp( vEdge / uRimDepth, 0.0, 1.0 ) * ( 63.0 / 64.0 ) + 0.5 / 64.0, mascotAng / 6.2831853 + ( mascotAng < 0.0 ? 1.0 : 0.0 ) + 0.5 / 72.0 );
          vec2 mascotRc = texture2D( uRimLut, mascotRuv ).rg;
          float mascotRv = mix( mascotRc.r, mascotRc.g, uRimChannel );
          float mascotRim = mascotRv * mascotRv;
          vec2 mascotSc = texture2D( uShadeLut, vec2( vEyeUV.x, - vEyeUV.y ) * ( 0.5 / 1.25 ) + 0.5 ).rg;
          mascotRim *= 0.5 + mix( mascotSc.r, mascotSc.g, uRimChannel );`)
        .replace('#include <tonemapping_fragment>', '#include <tonemapping_fragment>\ngl_FragColor.rgb *= mascotRim;');     // (on the displayed light: the ramp was measured on the artwork's pixels, and the whites sit on the tone curve's shoulder)
    },
  });
  Object.assign(m, STENCIL_WRITE);
  m.userData.side = side;
  return m;
}

/** Colour of the contact line: the artwork's is near black with a trace of warmth. */
export function lineMaterial(color = '#1c0f10') {
  return new THREE.MeshBasicMaterial({ color, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 });
}

/**
 * The eyelid: a copy of the eye dome in the face fabric, taller than the sclera so it covers the iris.  It is the plate's own fabric, drawn
 * with the plate's parameters and, through `uLidToRest`, the plate's rest-space coordinates, so its nap carries on from the plate's across the
 * edge of the eye.  Its free edge is cut in the fragment shader (not with a clipping plane) so it can be curved, and is finished with a rolled
 * lip and a dark seam; a soft dark line runs along the eye's outline where the lid meets the plate.
 */
function lidMaterial(isTop, lidBlock) {
  const m = createFabricMaterial({ useFace: true, forceFace: true });
  m.transparent = true;                                   // (only for the soft anti-aliased free edge; it is opaque everywhere else and still writes depth)
  const lid = {
    uLidCut: { value: 0 }, uLidTilt: lidBlock.uLidTilt, uLidArch: { value: isTop ? -0.16 : 0.34 }, uLidTop: { value: isTop ? 1 : 0 },
    uLidSeam: { value: 0.9 }, uLidSeamW: { value: 0.045 }, uLidLip: { value: 0.25 }, uLidLipAt: { value: 0.11 }, uLidLipW: { value: 0.09 },
    uLidRing: { value: 1 }, uLidToRest: { value: new THREE.Matrix4() }, uLidToRestN: { value: new THREE.Matrix3() }, uRestNInv: { value: new THREE.Matrix3() },
  };
  m.userData.lid = lid;
  const prev = m.onBeforeCompile, key = m.customProgramCacheKey;
  m.onBeforeCompile = (shader) => {
    prev(shader);
    Object.assign(shader.uniforms, lid);
    shader.vertexShader = shader.vertexShader
      .replace('vRestN = normal;', 'vRestN = normalize( uLidToRestN * normal );')
      .replace('vRestToView = normalMatrix;', 'vRestToView = normalMatrix * uRestNInv;')
      .replace('vRest = position;', 'vRest = ( uLidToRest * vec4( position, 1.0 ) ).xyz; vLidUV = position.xy; vLidEdge = aEdge;')
      .replace('#include <common>', '#include <common>\nvarying vec2 vLidUV; varying float vLidEdge; attribute float aEdge; uniform mat4 uLidToRest; uniform mat3 uLidToRestN; uniform mat3 uRestNInv;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        varying vec2 vLidUV; varying float vLidEdge;
        uniform float uLidCut; uniform float uLidTilt; uniform float uLidArch; uniform float uLidTop; uniform float uLidRing;
        uniform float uLidSeam; uniform float uLidSeamW; uniform float uLidLip; uniform float uLidLipAt; uniform float uLidLipW;
        float mascotLidD = 0.0; float mascotLidA = 1.0;`)
      .replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>
        {
          // rotated coordinate across the eye, and the (curved) free edge of the lid in the same frame
          float lw = vLidUV.y * cos( uLidTilt ) + vLidUV.x * sin( uLidTilt );
          float edge = uLidCut + uLidArch * ( 1.0 - vLidUV.x * vLidUV.x );
          mascotLidD = uLidTop > 0.5 ? lw - edge : edge - lw;        // distance from the free edge, into the lid (unit frame)
          mascotLidA = smoothstep( 0.0, max( fwidth( mascotLidD ) * 1.25, 1e-5 ), mascotLidD );
        }`)
      // (the cut-off comes after the nap has been fetched: texture derivatives are undefined in pixels that follow a discard, which would pick garbage mips along the lid's edge)
      .replace('#include <alphatest_fragment>', '#include <alphatest_fragment>\nif ( mascotLidA <= 0.001 ) discard;')
      .replace('#include <alphamap_fragment>', `#include <alphamap_fragment>
        diffuseColor.a *= mascotLidA;
        {
          // a rolled lip just inside the free edge, and the dark seam right at it (drawn as a crevice so it takes light from every term)
          float lipX = ( mascotLidD - uLidLipAt ) / uLidLipW;
          diffuseColor.rgb *= 1.0 + uLidLip * exp( - lipX * lipX );
          float seamX = mascotLidD / uLidSeamW;
          float ringX = vLidEdge / 0.007;
          mascotCrevice = max( mascotCrevice, max( uLidSeam * exp( - seamX * seamX ), 0.6 * uLidRing * exp( - ringX * ringX ) ) );
          diffuseColor.rgb *= 1.0 - 0.85 * mascotCrevice;
        }`);
  };
  m.customProgramCacheKey = () => `${key.call(m)}-lid${isTop ? 'T' : 'B'}`;
  return m;
}

/** Keep a lid's rest-space matrices (see lidMaterial) in step with its transform; called by three just before the lid draws. */
function trackRestSpace(lid, group) {
  const u = lid.material.userData.lid;
  lid.onBeforeRender = () => {
    lid.updateMatrix();
    u.uLidToRest.value.multiplyMatrices(group.matrix, lid.matrix);
    u.uLidToRestN.value.getNormalMatrix(u.uLidToRest.value);
    u.uRestNInv.value.copy(u.uLidToRestN.value).invert();
  };
}

/**
 * @param {'L'|'R'} tag         L = the character's left = the viewer's right (+x)
 * @param {object} anchor       { p, n }: a point of the face plate and its outward normal
 * @param {object} shape        outline from mascot-face-shapes.js (cx, cy, rx, ry, rho)
 * @param {object} iris         measured iris / pupil / glint ellipses from mascot-face-shapes.js
 * @param {object} kit          shared materials
 */
export function buildEye(tag, anchor, shape, iris, restGaze, kit) {
  const side = tag === 'L' ? 1 : -1;                   // +1 = the eye on the viewer's right (its outer end is +x)
  const group = new THREE.Group();
  group.name = 'Eye' + tag;
  group.position.set(...anchor.p);
  group.quaternion.setFromUnitVectors(Z, new THREE.Vector3(...anchor.n).normalize());

  const lidBlock = {
    uLidA: { value: new THREE.Vector4(1.16, -0.16, -1.16, 0.34) }, uLidAmt: { value: new THREE.Vector2() },
    uLidTilt: { value: 0 }, uLidShadowW: { value: 0.2 },
    uEyeScale: { value: new THREE.Vector2(shape.rx, shape.ry) },
  };
  const { rx, ry } = shape;

  const sclera = new THREE.Mesh(outlinePillow(shape, { n: EYE.n, rings: 30, segs: 96, neutral: true }), scleraMaterial(kit, ...(tag === 'L' ? [1.06, [1, 1.046, 1.053]] : [0.9, [1, 0.904, 0.841]]), side, lidBlock, shape));
  sclera.scale.set(rx, ry, EYE.rz);
  sclera.position.z = -EYE.sink;                       // the rim sits just below the face fabric
  sclera.castShadow = true;
  sclera.receiveShadow = true;
  sclera.renderOrder = -1;                             // (first: it writes the stencil that clips the iris, pupil and catchlight)
  sclera.name = 'Sclera' + tag;
  group.add(sclera);

  // ---- iris, pupil, catchlight: flat felt appliqués that ride the sclera's dome -------------------------------------------------
  const gaze = new THREE.Group();
  gaze.name = 'Gaze' + tag;
  group.add(gaze);
  const toEye = () => ({ value: new THREE.Matrix4() });
  const toEyes = { iris: toEye(), pupil: toEye(), glint: toEye() };
  const irisMat = receiveLidShadow(new THREE.MeshPhysicalMaterial({ color: '#ffffff', map: kit.irisMap, roughness: 0.92, specularIntensity: 0.12, sheen: 0.5, sheenColor: new THREE.Color('#6a4a38'), sheenRoughness: 0.8 }), lidBlock, toEyes.iris, { name: 'iris', clip: true });
  const pupilMat = receiveLidShadow(new THREE.MeshBasicMaterial({ map: kit.pupilMap, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }), lidBlock, toEyes.pupil, { name: 'pupil', clip: true, basic: true });
  const glintMat = receiveLidShadow(new THREE.MeshBasicMaterial({ map: kit.glintMap, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 }), lidBlock, toEyes.glint, { name: 'glint', clip: true, basic: true });

  const irisMesh = new THREE.Mesh(kit.appliqueGeo, irisMat);
  irisMesh.scale.set(iris.iris.w / 2 * IRIS_PLANE, iris.iris.h / 2 * IRIS_PLANE, 0.011);
  irisMesh.receiveShadow = true;
  gaze.add(irisMesh);
  const dx = (e) => e.cx - iris.iris.cx, dy = (e) => e.cy - iris.iris.cy;                 // offsets of the pupil / glint from the iris centre
  const pupil = new THREE.Mesh(kit.planeGeo, pupilMat);
  pupil.scale.set(iris.pupil.w / 2 * 1.08, iris.pupil.h / 2 * 1.08, 1);
  pupil.position.set(dx(iris.pupil), dy(iris.pupil), 0.0125);
  pupil.renderOrder = 3;
  gaze.add(pupil);
  const glintR = (iris.glint.w + iris.glint.h) / 4 / 0.78;                                   // the disc fills 0.78 of the texture's radius
  const glint = new THREE.Mesh(kit.planeGeo, glintMat);
  glint.scale.set(glintR, glintR, 1);
  glint.position.set(dx(iris.glint), dy(iris.glint), 0.0142);
  glint.renderOrder = 4;
  gaze.add(glint);

  // where the artwork's iris sits when the pose is at rest: the per-eye difference from what the gaze model gives is a fixed bias
  const gazeModel = (gx, gy, cv) => {
    const ex = gx + (tag === 'R' ? cv : -cv);
    return [Math.max(-1, Math.min(1, ex)) * 0.42 * rx, Math.max(-1, Math.min(1, gy)) * 0.36 * ry];
  };
  const [restX, restY] = gazeModel(restGaze.x, restGaze.y, restGaze.toeIn);
  const bias = [iris.iris.cx - shape.cx - restX, iris.iris.cy - shape.cy - restY];

  // ---- eyelids --------------------------------------------------------------------------------------------------------------------
  const lids = [];
  for (const which of ['top', 'bottom']) {
    const lid = new THREE.Mesh(kit.lidGeo[tag], lidMaterial(which === 'top', lidBlock));
    lid.scale.set(rx, ry, EYE.rz * EYE.lidRise);
    lid.position.z = -EYE.sink - 0.004;
    trackRestSpace(lid, group);
    lid.name = `Lid${which}${tag}`;
    lid.userData.which = which;
    lid.castShadow = true;
    lid.visible = false;
    group.add(lid);
    lids.push(lid);
  }
  // a calm closed-eye arc (a shallow smile-curve), used when Mascot sleeps
  const arcCurve = new THREE.QuadraticBezierCurve3(new THREE.Vector3(-0.15, 0.022, 0), new THREE.Vector3(0, -0.07, 0), new THREE.Vector3(0.15, 0.022, 0));
  const closedArc = new THREE.Group();
  const arcMat = kit.closedLid.clone();
  const arcTube = new THREE.Mesh(new THREE.TubeGeometry(arcCurve, 28, 0.0115, 8, false), arcMat);
  const capGeo = new THREE.SphereGeometry(0.0115, 10, 8);
  const capA = new THREE.Mesh(capGeo, arcMat), capB = new THREE.Mesh(capGeo, arcMat);
  capA.position.copy(arcCurve.getPoint(0)); capB.position.copy(arcCurve.getPoint(1));
  closedArc.add(arcTube, capA, capB);
  closedArc.position.z = 0.004;
  closedArc.visible = false;
  group.add(closedArc);

  const eye = { tag, side, group, gaze, lids, sclera, closedArc, arcMat, shape, bias, lidBlock };
  eye.toEye = { iris: [irisMesh, toEyes.iris], pupil: [pupil, toEyes.pupil], glint: [glint, toEyes.glint] };
  return eye;
}

/** Place the iris group for a gaze in [-1, 1] (x right, y up); `cv` > 0 converges the eyes (turns the irises toward the nose). */
export function aimEye(e, x, y, cv) {
  const { rx, ry } = e.shape;
  const ex = x + (e.tag === 'R' ? cv : -cv);
  const gx = THREE.MathUtils.clamp(ex, -1, 1) * 0.42, gy = THREE.MathUtils.clamp(y, -1, 1) * 0.36;
  const r = Math.min(0.97, Math.hypot(gx, gy));
  // pillow height and slope at normalised radius r:  z = (1 - r^n)^(1/n)
  const q = Math.max(1e-4, 1 - Math.pow(r, EYE.n));
  const z = Math.pow(q, 1 / EYE.n);
  const dzdr = -Math.pow(r, EYE.n - 1) * Math.pow(q, 1 / EYE.n - 1);
  const ux = r > 1e-4 ? gx / r : 0, uy = r > 1e-4 ? gy / r : 0;
  e.gaze.position.set(gx * rx + e.bias[0], gy * ry + e.bias[1], -EYE.sink + EYE.rz * z - 0.004);
  // surface normal in eye space: tilt along the radial direction, allowing for the anisotropic scale
  const n = new THREE.Vector3(-dzdr * ux * EYE.rz / rx, -dzdr * uy * EYE.rz / ry, 1).normalize();
  e.gaze.quaternion.setFromUnitVectors(Z, n);
  e.gaze.updateMatrix();
  // each appliqué's position in the eye's unit frame, for the lid shadow
  for (const [mesh, uni] of Object.values(e.toEye)) {
    mesh.updateMatrix();
    uni.value.multiplyMatrices(e.gaze.matrix, mesh.matrix);
    const m = uni.value.elements;                                     // (x, y) -> (x / rx, y / ry)
    for (let c = 0; c < 4; c++) { m[c * 4] /= rx; m[c * 4 + 1] /= ry; }
  }
}
