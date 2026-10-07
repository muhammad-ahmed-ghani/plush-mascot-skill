// Mascot's face: sculpted eyes (satin sclera cut to the artwork's outline, felt iris + pupil + catchlight, eyelids), appliqué felt cheeks, a
// parametric raised mouth and the stitched X.  Shapes and positions come from the artwork itself (mascot-face-shapes.js, made by
// scripts/dev/fit-face.py) and the baked anchors (points on the actual head surface); the features live under the head bone so they
// move with it.
import * as THREE from 'three';
import { createFabricMaterial, getNap } from './mascot-fabric.js';
import { FACE_SHAPES, ARTWORK_VIEW } from './mascot-face-shapes.js';
import { REST_GAZE } from './mascot-pose.js';
import { outlinePillow, fitToArtworkView } from './face/footprint.js';
import { scleraTexture, irisTexture, pupilTexture, glintTexture, threadMaps, THREAD_WRAPS } from './face/textures.js';
import { buildEye, aimEye, lineMaterial, EYE } from './face/eye.js';
import { buildCheek, CHEEK_RIM } from './face/cheek.js';
import { buildMouth, MOUTH_RIM } from './face/mouth.js';

/**
 * Linear-light colour gain per facial feature, on top of each material's hex.  Calibrated against the artwork by
 * scripts/dev/calibrate-features.py (feature colour under this studio's light vs the same window in the artwork).
 */
export const FEATURE_GAIN = { mouth: [1.703, 2.989, 3.757], cheek: [1.183, 1.483, 1.695], sclera: [1.186, 1.305, 1.504] };
const gained = (hex, g) => new THREE.Color(hex).multiply(new THREE.Color(g[0], g[1], g[2]));

const Z = new THREE.Vector3(0, 0, 1);
function orient(object, normal) {
  object.quaternion.setFromUnitVectors(Z, new THREE.Vector3(...normal).normalize());
}

/**
 * Eyelid geometry, in the eye's unit frame (the eye's outline is the unit disc; +y is up).  A lid's free edge is the curve
 * `cut + arch * (1 - x^2)`.  The top lid's cut runs from +1.16 (clear of the eye) to -1.16 (covering all of it) as its closure goes 0 -> 1,
 * the bottom lid's the other way.  In a blink both lids reach the same seam - a shallow smile-curve below the middle of the eye, the way a
 * real closed eye looks - and the top lid travels further than the bottom one.
 */
const LID = {
  reach: 1.16, archTop: -0.16, archSeam: -0.16, archBottomRest: -0.1, archSquint: 0.34,
  seam: -0.30,                                                       // where the closed eye's seam lies at the middle (unit frame)
  get topAtSeam() { return (this.reach - (this.seam - this.archSeam)) / (2 * this.reach); },
  get bottomAtSeam() { return 1 - this.topAtSeam; },
};

export function buildFace(anchors, { head, chestBone, plate = [] }) {
  const root = new THREE.Group();
  root.name = 'Face';
  head.bone.add(root);
  // children can use rest-world coordinates directly
  root.position.set(-head.rest[0], -head.rest[1], -head.rest[2]);
  const torsoRoot = new THREE.Group();
  torsoRoot.name = 'TorsoDecor';
  chestBone.bone.add(torsoRoot);
  torsoRoot.position.set(-chestBone.rest[0], -chestBone.rest[1], -chestBone.rest[2]);

  const mats = {
    line: lineMaterial(),
    mouth: createFabricMaterial({
      body: { base: '#e07b6d', tip: '#f7a596', sheen: '#ffb4a4', gain: FEATURE_GAIN.mouth },
      normalStrength: 0.12, tipAmount: 0.05, mottle: 0.03, macro: 0.02, cavity: 0.03, aoStrength: 1.0, aoDirect: 0.4, aoPower: 1.4, aoFloor: 0.3, fibAlbedo: 0.04, rimAmount: 0.3,
    }),
    mouthInside: new THREE.MeshStandardMaterial({ color: '#1b0d0c', roughness: 0.9 }),
    closedLid: new THREE.MeshStandardMaterial({ color: '#efe3d0', roughness: 0.85, transparent: true, opacity: 0 }),
    cheek: createFabricMaterial({
      body: { base: '#ee8574', tip: '#f9aa9a', sheen: '#ffc4b4', gain: FEATURE_GAIN.cheek },
      normalStrength: 0.35, tipAmount: 0.15, mottle: 0.04, macro: 0.02, cavity: 0.05, aoStrength: 0.15, aoDirect: 0.1, fibAlbedo: 0.08,
    }),
    thread: (() => {
      const t = threadMaps();
      const m = new THREE.MeshPhysicalMaterial({ color: '#ffffff', map: t.map, roughness: 0.7, sheen: 0.3, sheenColor: new THREE.Color('#ff9a90'), sheenRoughness: 0.5, specularIntensity: 0.18, bumpMap: t.bump, bumpScale: 13.08 });
      m.color.setScalar(1.064); m.userData.cord = t;
      // The wraps are about 3 px apart at the artwork's density, 2 px on a 2x display and under 1 px on a 1x one, where sampling them (and
      // differencing the bump map between neighbouring pixels) aliases into a checkerboard that shimmers as the figure moves.  Fade them
      // out as their spatial frequency (wraps per pixel, from the screen-space gradient of the uv along the cord) nears the pixel pitch.
      m.onBeforeCompile = (shader) => {
        shader.fragmentShader = shader.fragmentShader
          .replace('#include <common>', '#include <common>\nfloat mascotCordFade = 1.0;')
          .replace('#include <map_fragment>', `
            mascotCordFade = 1.0 - smoothstep( 0.40, 0.50, ${THREAD_WRAPS}.0 * length( vec2( dFdx( vMapUv.y ), dFdy( vMapUv.y ) ) ) );
            diffuseColor *= mix( textureLod( map, vMapUv, 10.0 ) * 0.93, texture2D( map, vMapUv ), mascotCordFade );       // (the wraps' average, a little deeper: the grooves are shaded too)`)
          .replace('#include <normal_fragment_maps>', THREE.ShaderChunk.normal_fragment_maps.replace('dHdxy_fwd()', 'dHdxy_fwd() * mascotCordFade'));      // (the chunk's own text, not the include line)
      };
      m.customProgramCacheKey = () => 'mascot-cord';
      return m;
    })(),
    groove: new THREE.MeshBasicMaterial({ color: '#5e1219', transparent: true, opacity: 0.9, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 }),
  };

  // --------------------------------------------------------------- eyes ---
  const kit = {
    gain: FEATURE_GAIN, scleraMap: scleraTexture(), irisMap: irisTexture(), pupilMap: pupilTexture(), glintMap: glintTexture(),
    rimMap: getNap().eyeRim, shadeMap: getNap().eyeShade, rim: FACE_SHAPES.rim, closedLid: mats.closedLid,
    appliqueGeo: outlinePillow({ rho: new Array(48).fill(1), rx: 1, ry: 1 }, { n: 6, rings: 8, segs: 48 }),      // a unit disc: flat top, tiny rounded edge
    planeGeo: new THREE.PlaneGeometry(2, 2),
    lidGeo: {},
  };
  for (const tag of ['L', 'R']) kit.lidGeo[tag] = outlinePillow(FACE_SHAPES.eye[tag], { n: 4.6, rings: 20, segs: 96, neutral: true });
  const eyes = ['L', 'R'].map((tag) => {
    const eye = buildEye(tag, anchors['eye' + tag], FACE_SHAPES.eye[tag], FACE_SHAPES.iris[tag], REST_GAZE, kit);
    root.add(fitToArtworkView(eye.group, ARTWORK_VIEW.distance));
    return eye;
  });
  Object.assign(mats, { sclera: eyes.map((e) => e.sclera.material) });

  // -------------------------------------------------------------- cheeks ---
  const cheeks = ['L', 'R'].map((tag) => {
    const cheek = buildCheek(tag, anchors['cheek' + tag], FACE_SHAPES.cheek[tag], mats);
    root.add(fitToArtworkView(cheek.group, ARTWORK_VIEW.distance));
    return cheek;
  });

  // --------------------------------------------------------------- mouth ---
  const mouth = buildMouth(anchors.mouth, FACE_SHAPES.mouth, mats);
  root.add(fitToArtworkView(mouth.group, ARTWORK_VIEW.distance));

  // ------------------------------------------------------------- chest X ---
  const chest = new THREE.Group();
  chest.name = 'ChestStitch';
  chest.position.set(...anchors.chestX.p);
  orient(chest, anchors.chestX.n);
  torsoRoot.add(chest);
  // measured from the artwork: each cord is ~0.043 wide and ~0.27 long overall (the cross is 0.19 x 0.19)
  const bar = new THREE.CapsuleGeometry(0.024, 0.1936, 10, 28);
  const channel = new THREE.CapsuleGeometry(0.030, 0.1936, 10, 28);         // wider than the cord: the trench it sits in (0.197 across the whole X, as measured)
  for (const ang of [Math.PI / 4, -Math.PI / 4]) {
    const groove = new THREE.Mesh(channel, mats.groove);
    groove.scale.set(1, 1, 0.05);
    groove.position.set(-0.003, 0.003, 0.0012);                       // the key light is up and to the viewer's left, so the trench shows its shadowed wall on that side
    groove.rotation.z = ang;
    groove.renderOrder = 3;
    chest.add(groove);
    const b = new THREE.Mesh(bar, mats.thread);
    b.scale.set(1, 1, 0.8);
    b.position.z = ang > 0 ? 0.0045 : 0.0065;                 // one bar passes over the other
    b.rotation.z = ang;
    b.receiveShadow = true;
    chest.add(b);
  }

  const clamp01 = (x) => Math.min(1, Math.max(0, x));
  return {
    root, eyes, cheeks, mouth: mouth.group, chest, mats,
    /** gaze in [-1, 1] (x right, y up); cv > 0 turns both irises toward the nose (the viewer's-left eye looks right, the other left) */
    setGaze(x, y, cv = 0) {
      for (const e of eyes) aimEye(e, x, y, cv);
    },
    /**
     * Eyelids.  top / bottom: how far each lid has closed, 0..1 (1 = it covers the whole eye); tilt -1..1 (positive = outer end raised);
     * blink 0..1 drives both lids to the closed-eye seam (see LID) - the lids never close less than the state asks for.
     */
    setLids(top, bottom, tilt = 0, blink = 0) {
      const t = clamp01(Math.max(top, LID.topAtSeam * blink));
      const b = clamp01(Math.max(bottom, LID.bottomAtSeam * blink));
      const squint = THREE.MathUtils.smoothstep(bottom, 0.05, 0.3);                         // a lower lid pushed up by a smile arches
      const archB = THREE.MathUtils.lerp(THREE.MathUtils.lerp(LID.archBottomRest, LID.archSquint, squint), LID.archSeam, blink);
      // as the eye shuts the two lids overlap a little, so no sliver of the white shows in the seam between their soft edges
      const lap = 0.04 * THREE.MathUtils.smoothstep(blink, 0.8, 1.0);
      const cutT = LID.reach - 2 * LID.reach * t - lap, cutB = -LID.reach + 2 * LID.reach * b + lap;
      for (const e of eyes) {
        const lb = e.lidBlock;
        lb.uLidTilt.value = tilt * 0.5 * e.side;
        lb.uLidA.value.set(t > 0.002 ? cutT : 3, LID.archTop, b > 0.002 ? cutB : -3, archB);           // (a lid that is not down covers nothing)
        lb.uLidAmt.value.set(0.82 * THREE.MathUtils.smoothstep(t, 0.02, 0.16), 0.6 * THREE.MathUtils.smoothstep(b, 0.02, 0.16));
        for (const lid of e.lids) {
          const isTop = lid.userData.which === 'top';
          lid.visible = (isTop ? t : b) > 0.002;
          if (!lid.visible) continue;
          const u = lid.material.userData.lid;
          u.uLidCut.value = isTop ? cutT : cutB;
          u.uLidArch.value = isTop ? LID.archTop : archB;
        }
      }
    },
    /** Tune the chest cord: wrap amplitude (albedo + bump range), bump strength and brightness. */
    setCord({ amp, bump: bumpScale, brightness } = {}) {
      const t = mats.thread;
      if (amp !== undefined) t.userData.cord.setAmp(amp);
      if (bumpScale !== undefined) t.bumpScale = bumpScale;
      if (brightness !== undefined) t.color.setScalar(brightness);
    },
    /** 0 = awake ... 1 = asleep: the eye pillows sink flat into the face and a calm arc appears where they were. */
    setSleep(v) {
      const k = THREE.MathUtils.clamp(v, 0, 1);
      for (const e of eyes) {
        const flat = 1 - 0.9 * k;
        e.sclera.scale.z = EYE.rz * flat;
        for (const lid of e.lids) { lid.scale.z = EYE.rz * EYE.lidRise * flat; lid.position.z = -EYE.sink - 0.004 * flat; lid.material.userData.lid.uLidRing.value = 1 - 0.85 * k; }
        e.gaze.visible = k < 0.5;
        const a = THREE.MathUtils.smoothstep(k, 0.55, 0.95);
        e.closedArc.visible = a > 0.01;
        e.arcMat.opacity = a;
      }
      for (const m of plate) m.userData.mascot.uHaloEyes.value = 1 - THREE.MathUtils.smoothstep(k, 0.1, 0.5);
    },
    /** smile -1..1 (0.55 = neutral), width (units between the ends of the cord), open 0..1 */
    setMouth(o) {
      mouth.set(o);
      // the halo around the mouth is measured with the mouth in its resting shape, so it fades as the mouth leaves it
      const r = mouth.rest, dev = Math.abs((o.smile ?? r.smile) - r.smile) * 1.2 + Math.abs((o.width ?? r.width) - r.width) * 2.5 + (o.open ?? 0) * 0.8;
      const fade = 1 - THREE.MathUtils.smoothstep(dev, 0.06, 0.25);
      for (const m of plate) m.userData.mascot.uHaloMouth.value = fade;
    },
    /**
     * The dark contact lines round the cheeks and the mouth are a few thousandths of a unit wide - under a pixel on a small display, where
     * multisampling breaks them into dots that crawl as the head turns.  Given the size of a pixel (units), keep them a little over one.
     */
    setPixelSize(unitsPerPixel) {
      const px = 1.1 * unitsPerPixel;
      for (const c of cheeks) c.setRim(Math.max(CHEEK_RIM, px));
      mouth.setRim(Math.max(MOUTH_RIM, px));
    },
    setBlush(v) {
      const s = 0.85 + 0.15 * v;                          // (1 = the artwork's size, at the neutral blush)
      for (const c of cheeks) c.scaler.scale.set(s, s, 1);
    },
  };
}
