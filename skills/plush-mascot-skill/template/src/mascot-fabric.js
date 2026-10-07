// Felt / plush fabric material for the mascot.
//
// A MeshPhysicalMaterial (so shadows, image-based light and sheen all come for
// free) patched to add what makes it read as needle-felt instead of plastic:
//   * triplanar curly-fibre normals + albedo, sampled in REST space so the
//     pile sticks to the fabric while the skeleton bends it
//   * wrapped diffuse with a warm, saturated terminator (light scatters
//     through felt instead of going grey)
//   * baked SDF ambient occlusion, applied to both indirect and direct light
//   * the charcoal face fabric blended in analytically from the face outline
//   * optional fuzz "shells": thin alpha-tested copies pushed along the normal
//     that give the silhouette its soft micro-fibre halo
import * as THREE from 'three';
import config, { FRAME, assetPath } from './config.js';
import { generateFeltMaps, FELT_TILE, napTileSize, loadNapImages } from './mascot-felt.js';
import { FACE_SHAPES, ARTWORK_VIEW } from './mascot-face-shapes.js';

let proceduralTexture = null;
/** Fallback fibre maps, generated procedurally if the extracted nap tiles cannot be loaded. */
export function getFeltTexture() {
  if (proceduralTexture) return proceduralTexture;
  const { size, data } = generateFeltMaps({ strokes: 2300, width: 2.5, lengthMin: 20, lengthMax: 56, curl: 3.0, heightScale: 1.0 });
  const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat, THREE.UnsignedByteType);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.anisotropy = 8;
  tex.colorSpace = THREE.NoColorSpace;
  tex.needsUpdate = true;
  proceduralTexture = tex;
  return tex;
}

/**
 * The halo map (mascot.config.json face.maps.halo, made by scripts/dev/fit-face.py): how much brighter or darker the face fabric is around each facial
 * feature than further away, per colour channel (128 = 1.0, 255 = 2.5).  Without the image a neutral 1 x 1 map stands in.
 */
function makeHaloMap(image) {
  const t = image ? new THREE.Texture(image) : new THREE.DataTexture(new Uint8Array([102, 102, 102, 255]), 1, 1, THREE.RGBAFormat);
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  t.magFilter = t.minFilter = THREE.LinearFilter;
  t.generateMipmaps = false;
  t.colorSpace = THREE.NoColorSpace;
  t.flipY = false;                                     // row 0 is the top of the face
  t.needsUpdate = true;
  return t;
}

/**
 * The eye whites' rim (face.maps.eyeRim, made by scripts/dev/fit-face.py): for each direction round the eye (rows) and each distance
 * inside its edge (columns), how bright the white is relative to its interior; R is the viewer's-right eye, G the left; values are sqrt-encoded.
 * Without the image a plain ramp stands in.
 */
function makeRimMap(image) {
  const t = image ? new THREE.Texture(image) : new THREE.DataTexture(new Uint8Array([0, 0, 0, 255, 255, 255, 255, 255]), 2, 1, THREE.RGBAFormat);
  t.wrapS = THREE.ClampToEdgeWrapping;
  t.wrapT = THREE.RepeatWrapping;                        // rows are angles: they wrap
  t.magFilter = t.minFilter = THREE.LinearFilter;
  t.generateMipmaps = false;
  t.colorSpace = THREE.NoColorSpace;
  t.flipY = false;
  t.needsUpdate = true;
  return t;
}

/**
 * The eye whites' shading map (face.maps.scleraShade, made by scripts/dev/calibrate-sclera.py): what the artwork's whites are brighter or
 * darker than the live render by, in the eye's unit frame; R is the viewer's-right eye, G the left; ratio = 0.5 + value.  Without the image: 1.
 */
function makeShadeMap(image) {
  const t = image ? new THREE.Texture(image) : new THREE.DataTexture(new Uint8Array([128, 128, 128, 255]), 1, 1, THREE.RGBAFormat);
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  t.magFilter = t.minFilter = THREE.LinearFilter;
  t.generateMipmaps = false;
  t.colorSpace = THREE.NoColorSpace;
  t.flipY = false;
  t.needsUpdate = true;
  return t;
}

let nap = null;
/**
 * Load the fabric-nap tiles extracted from the artwork (scripts/nap/build.py) and the face maps measured from it (scripts/dev/fit-face.py),
 * from `baseUrl` (the controller's assetsUrl) under the names mascot.config.json gives them (nap.tiles, face.maps).  Safe to call
 * repeatedly; falls back to the procedural fibres if the tiles are missing so the character never renders blank.
 */
export async function ensureNapTextures(baseUrl = '/assets/') {
  if (nap) return nap;
  try {
    const url = (path) => (path ? baseUrl + assetPath(path) : null), maps = config.face?.maps ?? {};
    const { body, face, halo, eyeRim, eyeShade } = await loadNapImages({
      body: url(config.nap.tiles.body), face: url(config.nap.tiles.face), halo: url(maps.halo), eyeRim: url(maps.eyeRim), eyeShade: url(maps.scleraShade),
    });
    const NAP_TILE = napTileSize(body.naturalWidth || config.nap.tileSize, FRAME.ppu);
    const make = (image) => {
      const t = new THREE.Texture(image);
      t.wrapS = t.wrapT = THREE.RepeatWrapping;
      t.magFilter = THREE.LinearFilter;
      t.minFilter = THREE.LinearMipmapLinearFilter;
      t.generateMipmaps = true;
      t.anisotropy = 8;
      t.colorSpace = THREE.NoColorSpace;
      t.flipY = false;                 // row 0 is v = 0, matching the procedural DataTexture and build.py's normals
      t.needsUpdate = true;
      return t;
    };
    nap = { body: make(body), face: make(face), halo: makeHaloMap(halo), eyeRim: makeRimMap(eyeRim), eyeShade: makeShadeMap(eyeShade), real: true, scale: 1 / NAP_TILE, center: 0.5, gain: 3.562 };
  } catch (error) {
    console.warn('Mascot: extracted nap tiles unavailable, using procedural felt.', error);
    const t = getFeltTexture();
    nap = { body: t, face: t, halo: makeHaloMap(null), eyeRim: makeRimMap(null), eyeShade: makeShadeMap(null), real: false, scale: 1 / FELT_TILE, center: 0.15, gain: 2.0 };
  }
  return nap;
}
export function getNap() {
  if (!nap) {
    const t = getFeltTexture();
    nap = { body: t, face: t, halo: makeHaloMap(null), eyeRim: makeRimMap(null), eyeShade: makeShadeMap(null), real: false, scale: 1 / FELT_TILE, center: 0.15, gain: 2.0 };
  }
  return nap;
}

/** Inverse of the standard normal CDF (Acklam's rational approximation, |error| < 1.2e-9). */
function invNormalCDF(p) {
  const a = [-3.969683028665376e1, 2.209460984245205e2, -2.759285104469687e2, 1.38357751867269e2, -3.066479806614716e1, 2.506628277459239],
    b = [-5.447609879822406e1, 1.615858368580409e2, -1.556989798598866e2, 6.680131188771972e1, -1.328068155288572e1],
    c = [-7.784894002430293e-3, -3.223964580411365e-1, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783],
    d = [7.784695709041462e-3, 3.224671290700398e-1, 2.445134137142996, 3.754408661907416];
  const lo = 0.02425, hi = 1 - lo;
  if (p < lo) { const q = Math.sqrt(-2 * Math.log(p)); return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1); }
  if (p > hi) { const q = Math.sqrt(-2 * Math.log(1 - p)); return -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1); }
  const q = p - 0.5, r = q * q;
  return (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q / (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
}
/**
 * Felt fuzz is sparse and very short: the layer at relative height t (0 = surface, 1 = fibre tips) should cover only a
 * small, rapidly shrinking fraction of the surface.  Returns the normalised-height threshold that yields that coverage
 * when the (roughly normal) filament-height distribution is thresholded.
 */
export function shellThreshold(t, { base = 0.95, fall = 0.62, power = 1.5, mean = 0.5, sd = 0.24 } = {}) {
  const coverage = Math.min(0.98, Math.max(0.002, base * Math.pow(1 - fall * t, power)));
  return mean + sd * invNormalCDF(1 - coverage);
}

/**
 * Wide, soft shadows: 16 rotated Poisson taps over a `radius`-texel disc (the rotation comes from interleaved gradient noise, so
 * the grain is fine and stable).  three's PCFSoftShadowMap is only ~1 texel soft, which reads as a hard cut-out under a big
 * window light; the artwork's shadows are broad and faint.
 */
const SOFT_SHADOW = /* glsl */`
#ifdef USE_SHADOWMAP
float mascotShadow( sampler2D shadowMap, vec2 shadowMapSize, float shadowIntensity, float shadowBias, float shadowRadius, vec4 shadowCoord ) {
	shadowCoord.xyz /= shadowCoord.w;
	shadowCoord.z += shadowBias;
	bool inFrustum = shadowCoord.x >= 0.0 && shadowCoord.x <= 1.0 && shadowCoord.y >= 0.0 && shadowCoord.y <= 1.0;
	if ( ! ( inFrustum && shadowCoord.z <= 1.0 ) ) return 1.0;
	const vec2 P[16] = vec2[16](
		vec2( -0.94201624, -0.39906216 ), vec2( 0.94558609, -0.76890725 ), vec2( -0.094184101, -0.92938870 ), vec2( 0.34495938, 0.29387760 ),
		vec2( -0.91588581, 0.45771432 ), vec2( -0.81544232, -0.87912464 ), vec2( -0.38277543, 0.27676845 ), vec2( 0.97484398, 0.75648379 ),
		vec2( 0.44323325, -0.97511554 ), vec2( 0.53742981, -0.47373420 ), vec2( -0.26496911, -0.41893023 ), vec2( 0.79197514, 0.19090188 ),
		vec2( -0.24188840, 0.99706507 ), vec2( -0.81409955, 0.91437590 ), vec2( 0.19984126, 0.78641367 ), vec2( 0.14383161, -0.14100790 ) );
	float a = 6.2831853 * fract( 52.9829189 * fract( dot( gl_FragCoord.xy, vec2( 0.06711056, 0.00583715 ) ) ) );
	mat2 R = mat2( cos( a ), sin( a ), -sin( a ), cos( a ) );
	vec2 texel = shadowRadius / shadowMapSize;
	float sum = 0.0;
	for ( int i = 0; i < 16; i ++ ) sum += texture2DCompare( shadowMap, shadowCoord.xy + R * P[ i ] * texel, shadowCoord.z );
	return mix( 1.0, sum / 16.0, shadowIntensity );
}
#endif
`;

/** Distance that a full-scale baked seam value stands for; must equal SEAM_MAX in scripts/bake/seams.mjs (also stored in the MSCT header). */
export const SEAM_RANGE = 0.16;

/** Dev-only: set DEBUG.term before creating materials to output one lighting term as the final colour (see lab-ctrl.js ?dbg=). */
export const DEBUG = { term: 0 };

/** Shared numbers that describe the look; tweak here, not in the shader. */
export const FABRIC = {
  body: { gain: [0.985, 0.917, 1.264], base: '#f36b62', tip: '#f2867c', sheen: '#ffa088' },
  charcoal: { gain: [1.06, 1.231, 1.29], base: '#2c2527', tip: '#4f4b54', sheen: '#6d6874' },
  face: { cx: 0.019, cy: 2.1425, a: 0.7855, b: 0.5155, nTop: 2.26, nBot: 3.04 },
};

const VERT_PARS = /* glsl */`
attribute float ao;
attribute float curv;
attribute vec2 seam;       // baked construction seams: signed distance / uSeamRange, and presence (0 where there is none)
attribute vec4 seamDir;    // unit vector across the seam (gradient of the signed distance)
varying vec3 vRest;
varying vec3 vRestN;
varying float vAO;
varying float vCurv;
varying vec2 vSeam;
varying vec3 vSeamDir;
varying mat3 vRestToView;
uniform float uShell;
uniform vec3 uArmAxis;     // arms only (MASCOT_ARM): the arm's rest direction, shoulder -> hand ...
uniform vec3 uArmSpan;     // ... where the shoulder and wrist joints sit along it (x, y), and how much longer the arm is than sculpted (z)
`;

const FRAG_PARS = /* glsl */`
uniform sampler2D uFelt;
uniform sampler2D uFeltFace;
uniform float uFeltScale;
uniform float uNapZoom;      // >= 1: enlarge the nap so fibres stay legible when Mascot is drawn smaller than the artwork
uniform float uFibCenter;
uniform float uFibGain;
uniform float uFibAlbedo;
uniform float uCrestPow;     // >1 makes the bright filaments sparser and thinner
uniform float uFeltBias;
uniform float uNormalStrength;
uniform vec3 uBase;
uniform vec3 uTip;
uniform vec3 uBaseFace;
uniform vec3 uBaseGain;    // unclamped linear albedo gain (the hex palette is limited to 1.0 per channel)
uniform vec3 uFaceGain;
uniform vec3 uTipFace;
uniform vec3 uSheenFace;
uniform vec3 uSheenBase;
uniform float uTipAmount;
uniform float uMottle;
uniform float uMacro;
uniform float uCavity;
uniform float uAOStrength;
uniform float uAODirect;
uniform float uAOPower;
uniform float uAOFloor;     // darkest that baked occlusion may make a surface (felt scatters light into its folds)
uniform vec3 uRimColor;
uniform float uRimAmount;
uniform float uRimPower;
uniform float uRimUp;
uniform float uRimSide;
uniform float uShellEdge;
uniform float uRimTightAmount;   // tight pale fringe right at the silhouette
uniform float uRimTightPower;
uniform float uShellAlpha;   // opacity of the fuzz layers at the silhouette
uniform float uShellGlow;    // light scattered out of the fuzz (added on top of its shading)
uniform vec4 uFaceA;      // cx, cy, a, b
uniform vec2 uFaceN;      // exponent above / below centre line
uniform float uFaceEdge;  // shift of the fabric boundary (units)
uniform float uFaceJitter; // how far the nap pushes the boundary about (units, peak to peak)
uniform float uEdgeLine;   // how far the thin crevice line where the hood meets the plate pulls toward its dark colour
uniform float uEdgeDark;   // brightness of the crevice's dark colour (1 = a deep red-brown)
uniform float uEdgeLineWP; // its shoulder on the plate side (units): the plate darkens gradually into it
uniform float uEdgeLineWH; // ... and on the hood side, where the rolled edge drops off almost at once
uniform float uEdgeLineAt; // where the line's darkest point sits, inside the colour boundary (units)
uniform float uEdgeLineChin; // how much of the line's strength remains along the bottom of the plate (the artwork's chin-side line is fainter)
uniform float uEdgeLineChinW; // ... and how much of its hood-side width (the chin-side lip rises to full brightness almost at once)
uniform float uEdgePlateLR;// how much the plate darkens toward its edge at the sides (it tucks under the hood)
uniform float uEdgePlateTB;// ... at the top and bottom
uniform float uEdgePlateW; // how far in from the edge that darkening reaches
uniform float uEdgeBump;   // depth of the rolled edge the shading sees (units): it tilts the hood's normal toward the plate
uniform float uEdgeBumpW;  // ... over this width
uniform float uEdgeRim;    // the plate's own rim tilts the other way, by this much
uniform float uEdgeHem;    // brightening of the hood's rolled edge
uniform float uEdgeHemAt;  // ... where it peaks (units outside the plate edge)
uniform float uEdgeHemW;   // ... and how wide it is
uniform float uFaceSoft;  // softness of the boundary (units)
uniform float uUseFace;
uniform float uShellT;    // 0 = base layer, (0..1] = fuzz shell layer
uniform float uShellCut;
varying vec3 vRest;
varying vec3 vRestN;
varying float vAO;
varying float vCurv;
varying vec2 vSeam;
varying vec3 vSeamDir;
varying mat3 vRestToView;
uniform float uSeamRange;  // the distance that a full-scale baked seam value stands for
uniform float uFaceScale;  // finer pile on the face fabric
uniform float uFaceDetail; // extra fibre contrast on the face fabric
uniform float uFaceRelief; // relief (normal-map strength) multiplier on the charcoal fabric; its hairs are mostly colour, hardly relief
uniform float uFaceBias;   // mip bias of the charcoal fabric's nap (lower = crisper, higher = softer)
uniform float uUpFibre;    // extra fibre amplitude on upward-facing surfaces
uniform float uFaceTip;    // how much of the body's bright-filament boost the charcoal fabric gets (its hairs are dull, not sparkling)
uniform float uFaceVignette; // the artwork's face plate falls off toward its lower rim
uniform float uToe;        // body shadow saturation (Khronos-neutral toe), 0 = off
uniform sampler2D uFaceHalo; // colour ratio of the face fabric near the facial features to the fabric further away (see mascot-face-shapes.js)
uniform vec4 uHaloRect;      // x of the left edge, y of the top edge, width, height of that map (artwork units)
uniform vec2 uHaloView;      // the artwork is matched from this far away, looking at this height (see ARTWORK_VIEW)
uniform float uHaloAmt;      // 0..1, how much of the halo is applied
uniform float uHaloEyes;     // 0..1, fades the halo around the eyes (a closed eye has none)
uniform float uHaloMouth;    // 0..1, fades the mouth's halo when the mouth is not in its resting shape
uniform float uSeamDepth;  // groove depth for the bump
uniform vec3 uSeamTint;    // albedo multiplier inside the groove (a deep red, not a neutral darkening, so it does not go brown)

float mascotSuperEllipse( vec2 p, vec2 ab, float n ) {
	vec2 q = abs( p ) / ab;
	vec2 qn = pow( max( q, vec2( 1e-5 ) ), vec2( n ) );
	float s = qn.x + qn.y;
	float f = pow( s, 1.0 / n );
	float k = pow( s, 1.0 / n - 1.0 );
	vec2 g = vec2( k * pow( max( q.x, 1e-5 ), n - 1.0 ) / ab.x, k * pow( max( q.y, 1e-5 ), n - 1.0 ) / ab.y );
	return ( f - 1.0 ) / max( length( g ), 1e-4 );
}
// signed distance to the plate's outline (units, negative on the plate), without the nap's jitter: smooth, so its screen-space derivative is too
float mascotFaceSDBase( vec3 p ) {
	vec2 d = p.xy - uFaceA.xy;
	return mascotSuperEllipse( d, uFaceA.zw, d.y >= 0.0 ? uFaceN.x : uFaceN.y ) - uFaceEdge;
}
float mascotFaceSD( vec3 p ) {
	// the two fabrics interlock with hairy edges rather than meeting on a ruled line: jitter the boundary with the nap itself
	return mascotFaceSDBase( p ) + uFaceJitter * ( texture2D( uFelt, p.xy * ( uFeltScale / uNapZoom ) * 1.3, 0.5 ).b - 0.5 );
}
// unit vector pointing outward (away from the plate) across the plate's outline
vec2 mascotFaceGrad( vec3 p ) {
	vec2 d = p.xy - uFaceA.xy;
	float n = d.y >= 0.0 ? uFaceN.x : uFaceN.y;
	vec2 q = max( abs( d ) / uFaceA.zw, vec2( 1e-4 ) );
	float sm = pow( q.x, n ) + pow( q.y, n );
	float k = pow( sm, 1.0 / n - 1.0 );
	vec2 g = vec2( k * pow( q.x, n - 1.0 ) / uFaceA.z, k * pow( q.y, n - 1.0 ) / uFaceA.w ) * sign( d + vec2( 1e-6 ) );
	return g / max( length( g ), 1e-4 );
}
float mascotFaceMask( vec3 p ) {
	#ifdef MASCOT_FORCE_FACE
		return 1.0;
	#endif
	float sd = mascotFaceSD( p );
	float front = smoothstep( 0.12, 0.28, p.z );
	float soft = max( uFaceSoft, 0.75 * fwidth( mascotFaceSDBase( p ) ) );          // (never narrower than a pixel: the boundary is drawn by the shader, so MSAA does not smooth it)
	return ( 1.0 - smoothstep( -soft, soft, sd ) ) * front * uUseFace;
}

// soft blotchy mottling: two octaves of value noise in rest space
float mascotHash( vec3 p ) { p = fract( p * 0.3183099 + 0.1 ); p *= 17.0; return fract( p.x * p.y * p.z * ( p.x + p.y + p.z ) ); }
float mascotVNoise( vec3 x ) {
	vec3 i = floor( x ), f = fract( x ); f = f * f * ( 3.0 - 2.0 * f );
	return mix( mix( mix( mascotHash( i ), mascotHash( i + vec3( 1, 0, 0 ) ), f.x ), mix( mascotHash( i + vec3( 0, 1, 0 ) ), mascotHash( i + vec3( 1, 1, 0 ) ), f.x ), f.y ),
	            mix( mix( mascotHash( i + vec3( 0, 0, 1 ) ), mascotHash( i + vec3( 1, 0, 1 ) ), f.x ), mix( mascotHash( i + vec3( 0, 1, 1 ) ), mascotHash( i + vec3( 1, 1, 1 ) ), f.x ), f.y ), f.z );
}
float mascotMottle( vec3 p ) { return 0.6 * mascotVNoise( p * 7.0 ) + 0.4 * mascotVNoise( p * 19.0 + 3.7 ); }

float mascotSeamLine( float d, float w ) {
	float aa = fwidth( d ) * 1.15;
	return 1.0 - smoothstep( w - aa, w + aa + 1e-5, abs( d ) );
}
// Seam profile: a narrow groove with soft puffy shoulders (the quilted look), and its analytic slope d(height)/d(distance).
// Slopes are analytic on purpose - screen-space derivatives of a feature this thin alias and flip normals at grazing angles.
float mascotSeamSlope( float d ) {
	const float s1 = 0.0058, s2 = 0.02;
	float g = exp( -( d / s1 ) * ( d / s1 ) );
	float e = ( abs( d ) - 0.028 ) / s2;
	return 2.0 * d / ( s1 * s1 ) * g + 0.5 * exp( - e * e ) * ( -2.0 * e / s2 ) * sign( d );
}
// x = seam mask (0..1);  yzw = rest-space surface gradient of the seam height (already scaled by uSeamDepth)
vec4 mascotSeams( vec3 p, vec3 n ) {
	float mask = 0.0;
	vec3 grad = vec3( 0.0 );
	#ifdef MASCOT_HEAD
	{
		// centre seam: down the back and over the crown to the top of the face opening (the hood's side seams are baked, see below)
		vec3 gx = vec3( 1.0, 0.0, 0.0 ) - n * n.x;
		float above = smoothstep( uFaceA.y + uFaceA.w * 0.9, uFaceA.y + uFaceA.w * 1.05, p.y );
		float cen = max( above, 1.0 - smoothstep( -0.1, 0.25, p.z ) );
		float cx = p.x - uFaceA.x;                                   // the artwork's seam sits with the face, a hair to the viewer's right of the body axis
		// hand-sewn, not ruled: the line wanders a little, pinches and relaxes, and is softer at its edges than at its core
		cx += ( mascotVNoise( vec3( p.y * 9.0, p.z * 6.0, 7.3 ) ) - 0.5 ) * 0.007;
		float sw = 0.0028 * ( 0.7 + 0.8 * mascotVNoise( vec3( p.y * 13.0, p.z * 8.0, 2.1 ) ) );
		float sd = 0.65 + 0.6 * mascotVNoise( vec3( p.y * 7.0, p.z * 5.0, 11.7 ) );
		mask = max( mask, max( mascotSeamLine( cx, sw ), 0.3 * mascotSeamLine( cx, sw * 2.6 ) ) * min( sd, 1.0 ) * cen );
		grad += mascotSeamSlope( cx ) * cen * ( gx / max( length( gx ), 1e-3 ) );
	}
	#endif
	#ifdef MASCOT_BODY
	{
		// the back seam runs down the middle of the torso
		vec3 gx = vec3( 1.0, 0.0, 0.0 ) - n * n.x;
		float backMask = smoothstep( 0.0, -0.25, p.z ) * smoothstep( 0.35, 0.55, p.y );
		mask = max( mask, mascotSeamLine( p.x, 0.0028 ) * backMask );
		grad += mascotSeamSlope( p.x ) * backMask * ( gx / max( length( gx ), 1e-3 ) );
	}
	#endif
	{
		// Baked seams (scripts/bake/seams.mjs): the seams that are curves rather than planes - the head's side seam, the outline
		// of each arm, the legs.  The signed distance is a straight ramp across the line, so a coarse mesh still resolves it.
		float bd = vSeam.x * uSeamRange;
		float bp = vSeam.y;
		vec3 bdir = vSeamDir - n * dot( vSeamDir, n );
		bdir /= max( length( bdir ), 1e-3 );
		mask = max( mask, mascotSeamLine( bd, 0.0028 ) * bp );
		grad += mascotSeamSlope( bd ) * bp * bdir;
	}
	return vec4( mask, grad * uSeamDepth );
}

// Deep red felt keeps its colour in shadow (the artwork's darks stay saturated); the neutral charcoal must not.
vec3 mascotShadowShape( vec3 c, float face ) {
	float x = min( c.r, min( c.g, c.b ) );
	float toe = x < 0.08 ? x - 6.25 * x * x : 0.04;
	return max( c - toe * uToe * ( 1.0 - face ), vec3( 0.0 ) );
}

struct FeltSample { vec3 objNormal; float height; float mottle; };

FeltSample mascotFeltTex( sampler2D tex, vec3 p, vec3 nr, float scale, float strength, float bias ) {
	vec3 w = pow( abs( nr ), vec3( 5.0 ) );
	w /= ( w.x + w.y + w.z );
	vec3 s = vec3( nr.x >= 0.0 ? 1.0 : -1.0, nr.y >= 0.0 ? 1.0 : -1.0, nr.z >= 0.0 ? 1.0 : -1.0 );
	vec4 tx = texture2D( tex, vec2( s.x * p.z, p.y ) * scale, bias );
	vec4 ty = texture2D( tex, vec2( p.x, s.y * p.z ) * scale, bias );
	vec4 tz = texture2D( tex, vec2( s.z * p.x, p.y ) * scale, bias );
	vec3 nx = vec3( ( tx.rg * 2.0 - 1.0 ) * strength, 1.0 );
	vec3 ny = vec3( ( ty.rg * 2.0 - 1.0 ) * strength, 1.0 );
	vec3 nz = vec3( ( tz.rg * 2.0 - 1.0 ) * strength, 1.0 );
	nx = normalize( nx ); ny = normalize( ny ); nz = normalize( nz );
	// whiteout blend against the surface normal, per projection plane
	vec3 bx = vec3( nx.xy + vec2( s.x * nr.z, nr.y ), nx.z * abs( nr.x ) );
	vec3 by = vec3( ny.xy + vec2( nr.x, s.y * nr.z ), ny.z * abs( nr.y ) );
	vec3 bz = vec3( nz.xy + vec2( s.z * nr.x, nr.y ), nz.z * abs( nr.z ) );
	vec3 ox = vec3( s.x * bx.z, bx.y, s.x * bx.x );
	vec3 oy = vec3( by.x, s.y * by.z, s.y * by.y );
	vec3 oz = vec3( s.z * bz.x, bz.y, s.z * bz.z );
	FeltSample r;
	r.objNormal = normalize( ox * w.x + oy * w.y + oz * w.z );
	r.height = tx.b * w.x + ty.b * w.y + tz.b * w.z;
	r.mottle = 0.5;
	return r;
}

FeltSample mascotFelt( vec3 p, vec3 nr, float scale, float strength, float bias ) {
	return mascotFeltTex( uFelt, p, nr, scale, strength, bias );
}
FeltSample mascotFeltFace( vec3 p, vec3 nr, float scale, float strength, float bias ) {
	return mascotFeltTex( uFeltFace, p, nr, scale, strength, bias );
}

`;

const LIGHT_PARS_HEAD = /* glsl */`
uniform float uWrap;
uniform vec3 uTerminator;
float mascotFaceG = 0.0;
`;

const ALBEDO_CHUNK = /* glsl */`
vec3 mascotRestN = normalize( vRestN );
vec3 mascotNs = normalize( vRestToView * mascotRestN );
float mascotFace = mascotFaceMask( vRest );
mascotFaceG = mascotFace;
float mascotScaleC = uFeltScale / uNapZoom;      // zoom > 1 GROWS the fibres (fewer tile repeats per unit)
FeltSample mascotF = mascotFelt( vRest, mascotRestN, mascotScaleC, uNormalStrength, uFeltBias );
#if defined( MASCOT_HEAD )
	{
		// (fetched for every pixel of the head, not only on the plate: a texture fetch inside a branch that some pixels of a 2 x 2 quad skip has
		// undefined derivatives, so the mip level it picks along the plate's edge is garbage - grains that sit exactly on the seam)
		FeltSample mascotFF = mascotFeltFace( vRest, mascotRestN, mascotScaleC * uFaceScale, uNormalStrength * uFaceRelief, mix( uFeltBias, uFaceBias, mascotFace ) );
		mascotF.objNormal = normalize( mix( mascotF.objNormal, mascotFF.objNormal, mascotFace ) );
		mascotF.height = mix( mascotF.height, mascotFF.height, mascotFace );
	}
#endif
vec4 mascotSeam = vec4( 0.0 );
float mascotCrevice = 0.0;
vec3 mascotEdgeGrad = vec3( 0.0 );
{
	float mascotMot = mascotMottle( vRest );
	float mascotMac = mascotVNoise( vRest * 1.6 + 11.0 );
	vec3 baseC = mix( uBase * uBaseGain, uBaseFace * uFaceGain, mascotFace );
	vec3 tipC = mix( uTip * uBaseGain, uTipFace * uFaceGain, mascotFace );
	float tone = 1.0 + uMottle * ( mascotMot - 0.5 ) * 2.0 + uMacro * ( mascotMac - 0.5 ) * 2.0;
	vec3 col = baseC * tone;
	// signed filament height: > 0 on a fibre crest, < 0 in the gaps between fibres
	float fibN = ( mascotF.height - uFibCenter ) * uFibGain;
	// Surfaces that face the key light sit high on the tone curve, where the shoulder squeezes contrast; the artwork's fibres stay
	// crisp there, so give upward-facing pile a little extra amplitude (measured on the crown of the head and the top of the ears)
	float fibDetail = mix( 1.0, uFaceDetail, mascotFace ) * ( 1.0 + uUpFibre * smoothstep( 0.3, 0.95, mascotRestN.y ) );
	// The artwork's nap is a sparse web of thin BRIGHT filaments over a darker, calmer ground (fibre-scale luminance has
	// positive skew and heavy tails), not a symmetric bumpy noise.  So brighten only the tallest crests, and darken the gaps.
	// (no upper clamp: the artwork's tails are heavy - a few very bright hairs and a few very deep crevices)
	float crest = pow( max( fibN, 0.0 ), uCrestPow );
	// (in the few pixels where the two fabrics blend, a body filament boosted by the plate's detail gain would flash white: fade the tips out there)
	float mascotBlendGuard = 1.0 - 4.0 * mascotFace * ( 1.0 - mascotFace );
	col += tipC * ( uTipAmount * mix( 1.0, uFaceTip, mascotFace ) * fibDetail * min( crest, 3.0 ) * mascotBlendGuard );
	col *= 1.0 + uFibAlbedo * fibDetail * clamp( fibN, -1.0, 1.4 );          // the filaments are albedo: luminance modulation, as in the artwork
	col *= 1.0 - uCavity * min( max( - fibN, 0.0 ), 1.4 );
	// concave folds go a little darker and richer, convex ridges lift slightly
	col *= 1.0 + 0.18 * clamp( vCurv, -1.0, 1.0 );
	col *= 1.0 - uFaceVignette * mascotFace * smoothstep( 2.28, 1.72, vRest.y );
	#if defined( MASCOT_HEAD )
	{
		// The hood rolls over the plate's edge: a bright rounded lip, then a thin dark crevice, then the plate tucking in under it.
		float sd = mascotFaceSD( vRest );
		float sdFw = fwidth( mascotFaceSDBase( vRest ) );                   // how far one pixel reaches across the outline
		float fr = smoothstep( 0.12, 0.28, vRest.z ) * uUseFace;
		vec2 rd = normalize( vRest.xy - uFaceA.xy + vec2( 1e-4 ) );
		float x = sd + uEdgeLineAt;                                      // the darkest point sits a hair inside the colour boundary
		float chin = smoothstep( 0.3, 0.95, - rd.y );                    // 1 along the bottom of the plate
		float lw0 = x < 0.0 ? uEdgeLineWP : uEdgeLineWH * mix( 1.0, uEdgeLineChinW, chin );
		float lw = max( lw0, sdFw * 0.9 );
		float line = exp( - ( x / lw ) * ( x / lw ) ) * ( lw0 / lw );    // (a line thinner than a pixel softens and fades instead of crawling: the same amount of dark, spread over the pixel)
		float onPlate = 1.0 - smoothstep( - sdFw, sdFw, sd );            // the plate side of the outline, with a pixel-wide transition
		float plate = ( 1.0 - smoothstep( 0.0, uEdgePlateW, - sd ) ) * onPlate;
		float hem = exp( - ( ( sd - uEdgeHemAt ) / uEdgeHemW ) * ( ( sd - uEdgeHemAt ) / uEdgeHemW ) ) * ( 1.0 - onPlate );
		col *= 1.0 - fr * mix( uEdgePlateTB, uEdgePlateLR, abs( rd.x ) ) * plate;
		col *= 1.0 + fr * uEdgeHem * hem * mix( 1.0, 1.0 - 1.2 * rd.y, 0.7 );      // (the lip catches more light where it faces up: the chin side)
		float chinK = mix( 1.0, uEdgeLineChin, chin );
		col = mix( col, vec3( 0.011, 0.0035, 0.0035 ) * uEdgeDark, fr * uEdgeLine * line * chinK );
		mascotCrevice = fr * line * chinK;
		// the rolled edge, as the shading sees it: the hood's surface drops toward the crevice and the plate's rim rises out of it
		float bw2 = uEdgeBumpW * uEdgeBumpW;
		float slope = sd > 0.0 ? 2.0 * uEdgeBump * sd / bw2 * exp( - sd * sd / bw2 )
		                       : - 2.0 * uEdgeRim * ( - sd ) / 0.0009 * exp( - sd * sd / 0.0009 );
		slope = clamp( slope, - 1.4, 1.4 );                                   // (a shading normal tilted much past ~55 degrees flashes in the specular / sheen terms)
		vec3 eg = vec3( mascotFaceGrad( vRest ), 0.0 ) * ( fr * slope );
		mascotEdgeGrad = eg - mascotRestN * dot( mascotRestN, eg );
	}
	{
		// The face fabric is not evenly lit around the felt pieces set into it: dark above and beside the eye whites, bright underneath them and
		// around the cheeks and mouth.  Measured from the artwork (uFaceHalo); a colour ratio, so it also carries the cream / pink bounce.
		float kv = uHaloView.x / ( uHaloView.x - vRest.z );
		vec2 pa = vec2( vRest.x * kv, uHaloView.y + ( vRest.y - uHaloView.y ) * kv );
		vec2 huv = vec2( ( pa.x - uHaloRect.x ) / uHaloRect.z, ( uHaloRect.y - pa.y ) / uHaloRect.w );
		if ( mascotFace > 0.01 && huv.x > 0.0 && huv.x < 1.0 && huv.y > 0.0 && huv.y < 1.0 ) {
			vec3 halo = texture2D( uFaceHalo, huv ).rgb * 2.5;
			float zoneEyes = step( 1.93, pa.y ) * step( 0.22, abs( pa.x - 0.02 ) );
			float zoneMouth = step( abs( pa.x - 0.0185 ), 0.22 ) * step( pa.y, 2.0 ) * ( 1.0 - zoneEyes );
			float amt = uHaloAmt * mix( 1.0, uHaloEyes, zoneEyes ) * mix( 1.0, uHaloMouth, zoneMouth ) * mascotFace;
			float hl = dot( halo, vec3( 0.2126, 0.7152, 0.0722 ) );
			col *= mix( vec3( 1.0 ), halo / max( hl, 1e-3 ), amt );                 // the tint (cream / pink bounce) ...
			col *= mix( 1.0, max( hl, 1.0 ), amt );                                  // ... light that was added ...
			mascotCrevice = max( mascotCrevice, max( 1.0 - hl, 0.0 ) / 0.94 * amt );      // ... and light that was taken away, from every term
		}
	}
	#endif
	mascotSeam = mascotSeams( vRest, mascotRestN );
	col *= mix( vec3( 1.0 ), uSeamTint, mascotSeam.x );
	diffuseColor.rgb = col;
	#ifdef MASCOT_SHELL
		// fuzz: the surface's own shading, lightened (light scatters through the hairs), present only near the silhouette
		FeltSample fineF = mascotFelt( vRest, mascotRestN, mascotScaleC * 1.7, 0.0, 0.0 );
		float ndvShell = abs( dot( mascotNs, normalize( vViewPosition ) ) );
		float edgeShell = 1.0 - smoothstep( 0.0, uShellEdge, ndvShell );
		// normalised filament height (mean ~0.5); outer layers keep only the tallest hairs, and fewer of them
		float shellH = ( fineF.height - uFibCenter ) * uFibGain * 0.5 + 0.5;
		float hair = smoothstep( uShellCut - 0.16, uShellCut + 0.16, shellH );
		diffuseColor.a = uShellAlpha * hair * pow( edgeShell, 1.4 ) * ( 1.0 - mascotCrevice );
		diffuseColor.rgb = mix( col, tipC * 1.1, 0.4 ) * mix( 0.9, 1.0, uShellT );
	#endif
}
`;

const NORMAL_CHUNK = /* glsl */`
{
	// fibres catch the light most at grazing angles, so keep the perturbation right up to the silhouette
	// (only the last few degrees fade toward the smooth normal, to avoid shimmer)
	float mascotNdv = saturate( dot( mascotNs, normalize( vViewPosition ) ) );
	normal = normalize( mix( mascotNs, normalize( vRestToView * mascotF.objNormal ), smoothstep( 0.0, 0.14, mascotNdv ) ) );
	normal = normalize( normal - vRestToView * ( mascotSeam.yzw + mascotEdgeGrad ) );
}
`;

const SHEEN_CHUNK = /* glsl */`
#ifdef USE_SHEEN
	material.sheenColor = mix( uSheenBase, uSheenFace, mascotFace ) * ( 1.0 - 0.9 * mascotSeam.x );
#endif
{
	// Felt fuzz scatters light at grazing angles: a broad, tinted edge glow that
	// is stronger toward the top/left where the studio light lives.
	float mascotNV = saturate( dot( mascotNs, normalize( vViewPosition ) ) );
	float mascotRim = pow( 1.0 - mascotNV, uRimPower );
	float mascotDir = clamp( 0.55 + uRimUp * mascotNs.y - uRimSide * mascotNs.x, 0.15, 1.6 );
	float mascotAOr = mix( 1.0, vAO, 0.85 );
	vec3 mascotRimTint = mix( uRimColor, uRimColor * 0.55 + diffuseColor.rgb * 0.5, mascotFace );
	#ifndef MASCOT_SHELL
		// a tight, pale rim on top of the broad one: felt fuzz lights up right at the silhouette (the artwork's outline is a bright fringe)
		float mascotRimT = pow( 1.0 - mascotNV, uRimTightPower );
		totalEmissiveRadiance += uRimColor * ( mascotRimT * uRimTightAmount * mix( 0.3, 1.0, smoothstep( -0.7, 0.3, mascotNs.y ) ) * mascotAOr * ( 1.0 - 0.96 * mascotFace ) * ( 1.0 - 0.9 * mascotSeam.x ) * ( 1.0 - mascotCrevice ) );
		float mascotRimFibre = 0.55 + 0.95 * saturate( ( mascotF.height - uFibCenter ) * uFibGain + 0.35 );
		totalEmissiveRadiance += mascotRimTint * ( mascotRim * mascotDir * uRimAmount * mascotAOr * mascotRimFibre * ( 1.0 - 0.96 * mascotFace ) * ( 1.0 - 0.9 * mascotSeam.x ) * ( 1.0 - mascotCrevice ) );
	#else
		// the fuzz scatters light: a soft pale glow that fades with the layer's own opacity (see uShellGlow)
		totalEmissiveRadiance += mascotRimTint * ( uShellGlow * mascotDir * ( 1.0 - 0.96 * mascotFace ) );
	#endif
}
`;

const AO_CHUNK = /* glsl */`
{
	float aoK = mix( 1.0, mix( uAOFloor, 1.0, pow( vAO, uAOPower ) ), uAOStrength );
	float mascotCrev = 1.0 - 0.94 * mascotCrevice;                       // the crevice takes light from every term, not just the diffuse albedo
	aoK *= ( 1.0 - 0.35 * mascotSeam.x ) * mascotCrev;
	reflectedLight.indirectDiffuse *= aoK;
	#ifdef USE_SHEEN
		sheenSpecularIndirect *= aoK;
	#endif
	float dotNVao = saturate( dot( geometryNormal, geometryViewDir ) );
	reflectedLight.indirectSpecular *= computeSpecularOcclusion( dotNVao, aoK, material.roughness );
	float aoD = mix( 1.0, mix( uAOFloor, 1.0, pow( vAO, uAOPower ) ), uAODirect );
	aoD *= mascotCrev;
	reflectedLight.directDiffuse *= aoD;
	reflectedLight.directSpecular *= aoD;
	#ifdef USE_SHEEN
		sheenSpecularDirect *= aoD;
	#endif
}
`;

/**
 * @param {object} o
 * @param {'body'|'shell'} o.layer
 * @param {{axis: number[], from: number, to: number}} [o.arm] an arm that can be stretched (arm{L,R}.s in mascot-pose.js): its rest axis and
 *   where its shoulder and wrist joints are along it.  The nap is laid out on the arm as sculpted and then compressed along the axis
 *   by the stretch, so when the arm lengthens the fibres keep their size instead of combing out along it (set uArmSpan.z each frame).
 */
export function createFabricMaterial({
  body = FABRIC.body, charcoal = FABRIC.charcoal, useFace = false, forceFace = false, part = 'other',
  shellT = 0, shellHeight = 0.006, arm = null,
  normalStrength = 0.273, tipAmount = 0.201, mottle = 0.05, macro = 0.03, cavity = 0.239, fibAlbedo = 0.150, crestPow = 1.858,
  aoStrength = 1.0, aoFloor = 0.120, aoDirect = 0.939, aoPower = 3.500, shellEdge = 0.512, wrap = 0.180,
  toe = 0.873, rimColor = '#ff9c84', rimAmount = 0.993, rimPower = 2.301, rimUp = 0.440, rimSide = 0.037,
  terminator = '#ff8c88',
  sheen = 1.000, sheenRoughness = 0.704,
} = {}) {
  const shell = shellT > 0;
  const napSet = getNap();
  const mat = new THREE.MeshPhysicalMaterial({
    color: 0xffffff, roughness: 1, metalness: 0,
    sheen, sheenRoughness, sheenColor: new THREE.Color(body.sheen),
    specularIntensity: 0.12,
    // hard alpha test (discard): alpha-to-coverage would write partial alpha into the canvas and composite pale
    alphaToCoverage: false, alphaTest: 0,
    transparent: shell, depthWrite: !shell,
  });
  const u = {
    uFelt: { value: napSet.body },
    uFeltFace: { value: napSet.face },
    uFeltScale: { value: napSet.scale },
    uNapZoom: { value: 1 },
    uFibCenter: { value: napSet.center },
    uFibGain: { value: napSet.gain },
    uFibAlbedo: { value: fibAlbedo },
    uCrestPow: { value: crestPow },
    uFeltBias: { value: napSet.real ? -0.286 : -0.7 },
    uNormalStrength: { value: normalStrength },
    uBase: { value: new THREE.Color(body.base) },
    uTip: { value: new THREE.Color(body.tip) },
    uBaseFace: { value: new THREE.Color(charcoal.base) },
    uBaseGain: { value: new THREE.Vector3(...(body.gain ?? [1, 1, 1])) },
    uFaceGain: { value: new THREE.Vector3(...(charcoal.gain ?? [1, 1, 1])) },
    uTipFace: { value: new THREE.Color(charcoal.tip) },
    uSheenBase: { value: new THREE.Color(body.sheen) },
    uSheenFace: { value: new THREE.Color(charcoal.sheen) },
    uTipAmount: { value: tipAmount },
    uMottle: { value: mottle },
    uMacro: { value: macro },
    uCavity: { value: cavity },
    uAOStrength: { value: aoStrength },
    uAODirect: { value: aoDirect },
    uAOPower: { value: aoPower },
    uAOFloor: { value: aoFloor },
    uRimColor: { value: new THREE.Color(rimColor) },
    uRimAmount: { value: rimAmount },
    uRimPower: { value: rimPower },
    uRimUp: { value: rimUp },
    uRimSide: { value: rimSide },
    uShellEdge: { value: shellEdge },
    uRimTightAmount: { value: 1.106 },
    uRimTightPower: { value: 9.224 },
    uShellAlpha: { value: 0.750 },
    uShellGlow: { value: 1.500 },
    uFaceA: { value: new THREE.Vector4(FABRIC.face.cx, FABRIC.face.cy, FABRIC.face.a, FABRIC.face.b) },
    uFaceN: { value: new THREE.Vector2(FABRIC.face.nTop, FABRIC.face.nBot) },
    uFaceScale: { value: 1.0 },
    uFaceDetail: { value: 2.784 },
    uFaceTip: { value: 0.100 },
    uUpFibre: { value: 1.758 },
    uFaceRelief: { value: 5.498 },
    uFaceBias: { value: -0.3 },
    uFaceVignette: { value: 0.364 },
    uToe: { value: toe },
    uSeamRange: { value: SEAM_RANGE },
    uSeamDepth: { value: 0.0085 },
    uSeamTint: { value: new THREE.Vector3(0.56, 0.32, 0.32) },
    uFaceHalo: { value: napSet.halo },
    uHaloRect: { value: new THREE.Vector4(FACE_SHAPES.halo.x0, FACE_SHAPES.halo.yTop, FACE_SHAPES.halo.w, FACE_SHAPES.halo.h) },
    uHaloView: { value: new THREE.Vector2(ARTWORK_VIEW.distance, ARTWORK_VIEW.targetY) },
    uHaloAmt: { value: 1 },
    uHaloEyes: { value: 1 },
    uHaloMouth: { value: 1 },
    uFaceEdge: { value: 0.0 },
    uFaceJitter: { value: 0.0015 },
    uEdgeLine: { value: 0.319123 },
    uEdgeDark: { value: 1.94816 },
    uEdgeLineWP: { value: 0.002 },
    uEdgeLineWH: { value: 0.00708 },
    uEdgeLineAt: { value: 0.002 },
    uEdgeLineChin: { value: 0.87408 },
    uEdgeLineChinW: { value: 0.35648 },
    uEdgePlateLR: { value: 0.7 },
    uEdgePlateTB: { value: 0.7 },
    uEdgePlateW: { value: 0.053979 },
    uEdgeBump: { value: 0.02276 },
    uEdgeBumpW: { value: 0.015 },
    uEdgeRim: { value: 0.003901 },
    uEdgeHem: { value: 0.24841 },
    uEdgeHemAt: { value: 0.061831 },
    uEdgeHemW: { value: 0.038435 },
    uFaceSoft: { value: 0.005 },
    uUseFace: { value: useFace ? 1 : 0 },
    uShell: { value: shell ? shellT * shellHeight : 0 },
    uArmAxis: { value: new THREE.Vector3(...(arm?.axis ?? [0, 0, 0])) },
    uArmSpan: { value: new THREE.Vector3(arm?.from ?? 0, arm?.to ?? 0, 0) },
    uShellT: { value: shellT },
    uShellCut: { value: shell ? shellThreshold(shellT) : 0.5 },
    uWrap: { value: wrap },
    uTerminator: { value: new THREE.Color(terminator) },
  };
  mat.userData.mascot = u;
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, u);
    shader.defines = { ...(shader.defines ?? {}), ...(shell ? { MASCOT_SHELL: '' } : {}), ...(part === 'head' ? { MASCOT_HEAD: '' } : part === 'body' ? { MASCOT_BODY: '' } : {}), ...(forceFace ? { MASCOT_FORCE_FACE: '' } : {}), ...(arm ? { MASCOT_ARM: '' } : {}) };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${VERT_PARS}`)
      .replace('#include <skinnormal_vertex>', `#include <skinnormal_vertex>
        vRestN = normal;
        #ifdef USE_SKINNING
          vRestToView = normalMatrix * mat3( skinMatrix );
        #else
          vRestToView = normalMatrix;
        #endif`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        #ifdef MASCOT_SHELL
          transformed += normalize( normal ) * uShell;
        #endif
        vRest = position; vAO = ao; vCurv = curv; vSeam = seam; vSeamDir = seamDir.xyz;
        #ifdef MASCOT_ARM
          // a stretched arm is longer than the sculpt the nap was laid out on, so the nap's coordinate must advance that much faster
          // along it (the tube between shoulder and wrist lengthens; the hand beyond it only moves, so its offset is constant)
          vRest += uArmAxis * uArmSpan.z * ( clamp( dot( position, uArmAxis ), uArmSpan.x, uArmSpan.y ) - uArmSpan.x );
        #endif`);
    // Felt scatters light: diffuse is wrapped past N.L = 0 and tinted warm toward the terminator.  ONLY diffuse - the GGX and
    // sheen visibility terms divide by the true N.L + N.V, so they must keep the true irradiance or they blow up at
    // grazing angles (bright single-pixel spikes).
    const patchedLights = THREE.ShaderChunk.lights_physical_pars_fragment
      .replace('reflectedLight.directDiffuse += irradiance * BRDF_Lambert( material.diffuseColor );', `float rawNL = dot( geometryNormal, directLight.direction );
	float wrapNL = saturate( ( rawNL + uWrap ) / ( 1.0 + uWrap ) );
	vec3 mascotTerminator = mix( mix( uTerminator, vec3( 1.0 ), mascotFaceG ), vec3( 1.0 ), smoothstep( 0.0, 0.6, rawNL ) );
	reflectedLight.directDiffuse += wrapNL * directLight.color * mascotTerminator * BRDF_Lambert( material.diffuseColor );`);
    // Wrapped light keeps shading smoothly past N.L = 0, so a hard shadow-map
    // cut there reads as an ugly crescent.  Fade shadows out toward the terminator.
    const patchedBegin = THREE.ShaderChunk.lights_fragment_begin
      .replace(/getShadow\(\s*directionalShadowMap\[ i \],([^;]*?)vDirectionalShadowCoord\[ i \]\s*\)\s*:\s*1\.0;/,
        (m) => m.replace(/getShadow\((.*)\)\s*:\s*1\.0;/s, (mm, inner) => `mix( 1.0, mascotShadow(${inner}), smoothstep( -0.02, 0.38, dot( geometryNormal, directLight.direction ) ) ) : 1.0;`));
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <shadowmap_pars_fragment>', `#include <shadowmap_pars_fragment>\n${SOFT_SHADOW}`)
      .replace('#include <lights_fragment_begin>', patchedBegin)
      .replace('#include <common>', `#include <common>\n${FRAG_PARS}`)
      .replace('#include <lights_physical_pars_fragment>', `${LIGHT_PARS_HEAD}\n${patchedLights}`)
      .replace('#include <color_fragment>', `#include <color_fragment>\n${ALBEDO_CHUNK}`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>\n${NORMAL_CHUNK}`)
      .replace('#include <lights_physical_fragment>', `#include <lights_physical_fragment>\n${SHEEN_CHUNK}`)
      .replace('#include <aomap_fragment>', AO_CHUNK)
      .replace('#include <opaque_fragment>', `outgoingLight = mascotShadowShape( outgoingLight, mascotFaceG );
        ${DEBUG.term ? `
        #if ${DEBUG.term} == 1
          outgoingLight = reflectedLight.directDiffuse;
        #elif ${DEBUG.term} == 2
          outgoingLight = reflectedLight.directSpecular;
        #elif ${DEBUG.term} == 3
          outgoingLight = reflectedLight.indirectDiffuse;
        #elif ${DEBUG.term} == 4
          outgoingLight = reflectedLight.indirectSpecular;
        #elif ${DEBUG.term} == 5 && defined( USE_SHEEN )
          outgoingLight = sheenSpecularDirect;
        #elif ${DEBUG.term} == 6 && defined( USE_SHEEN )
          outgoingLight = sheenSpecularIndirect;
        #elif ${DEBUG.term} == 7
          outgoingLight = totalEmissiveRadiance;
        #endif` : ''}
#include <opaque_fragment>`);
  };
  mat.customProgramCacheKey = () => `mascot-fabric-${shell ? 'shell' : 'base'}-${part}${forceFace ? '-face' : ''}${arm ? '-arm' : ''}${DEBUG.term ? `-dbg${DEBUG.term}` : ''}`;
  return mat;
}
