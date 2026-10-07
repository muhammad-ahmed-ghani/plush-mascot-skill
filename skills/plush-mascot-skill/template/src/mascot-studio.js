// Photo-studio lighting for Mascot: a procedural softbox environment (for soft,
// wrap-around image-based light) plus one soft-shadow key.  Modelled on the
// hero artwork: big window key from upper left, warm rim, bright bounce.
import * as THREE from 'three';

/**
 * Tone curve: exactly linear up to `start`, then a soft shoulder that keeps hue (the highlight half of
 * Khronos PBR Neutral, without its shadow "toe" - that toe subtracts a constant from every channel, which
 * turns dark warm-lit neutrals such as the charcoal face into saturated red-brown).
 */
export const TOE = 1.05;
export function installToneMapping(renderer) {
  const marker = 'vec3 CustomToneMapping( vec3 color ) { return color; }';
  if (THREE.ShaderChunk.tonemapping_pars_fragment.includes(marker)) {
    THREE.ShaderChunk.tonemapping_pars_fragment = THREE.ShaderChunk.tonemapping_pars_fragment.replace(marker, `
      vec3 CustomToneMapping( vec3 color ) {
        color *= toneMappingExposure;
        // hue-preserving toe: darken shadows by scaling all channels with luminance^(toe-1)
        float luma = dot( color, vec3( 0.2126, 0.7152, 0.0722 ) );
        color *= pow( max( luma, 1e-4 ), ${TOE.toFixed(3)} - 1.0 );
        const float start = 0.78;
        const float d = 1.0 - start;
        float peak = max( color.r, max( color.g, color.b ) );
        if ( peak < start ) return color;
        float newPeak = 1.0 - d * d / ( peak + d - start );
        color *= newPeak / peak;
        float g = 1.0 - 1.0 / ( 0.12 * ( peak - newPeak ) + 1.0 );
        return mix( color, vec3( newPeak ), g );
      }`);
  }
  renderer.toneMapping = THREE.CustomToneMapping;
}

/** Calibrated against the artwork (see scripts/… tuner notes in HANDOFF.md). */
export const STUDIO = { env: 0.190, key: 1.100, keyAz: 40.000, keyEl: 40.630, fill: 0.292, fillAz: 48.246, fillEl: -12.866, bounce: 0.258, bounceAz: 60.000, hemi: 0.100, shadowSoft: 26.000, shadowInt: 0.800, exposure: 1.543 };

function softbox(color, intensity, width, height, position, target = new THREE.Vector3(0, 1.6, 0)) {
  const mat = new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(intensity), side: THREE.DoubleSide });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(width, height), mat);
  mesh.position.copy(position);
  mesh.lookAt(target);
  return mesh;
}

export function createStudioEnvironment(renderer, { warmth = 1 } = {}) {
  const env = new THREE.Scene();

  // studio cyclorama: bright warm-white dome with a slightly darker floor
  const dome = new THREE.Mesh(
    new THREE.SphereGeometry(40, 48, 24),
    new THREE.ShaderMaterial({
      side: THREE.BackSide,
      uniforms: { top: { value: new THREE.Color('#fff7f0') }, mid: { value: new THREE.Color('#f3e6db') }, bottom: { value: new THREE.Color('#e9d3c6') } },
      vertexShader: 'varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader: `varying vec3 vP; uniform vec3 top; uniform vec3 mid; uniform vec3 bottom;
        void main(){ float y = vP.y; vec3 c = y > 0.0 ? mix(mid, top, smoothstep(0.0, 0.9, y)) : mix(mid, bottom, smoothstep(0.0, -0.7, y)); gl_FragColor = vec4(c * 0.9, 1.0); }`,
    }),
  );
  env.add(dome);

  env.add(softbox('#fff1e2', 9.0, 9, 8, new THREE.Vector3(-8, 9, 8)));           // key window, upper-left front
  env.add(softbox('#e9f0ff', 1.6, 7, 6, new THREE.Vector3(9, 3.5, 7)));            // cool fill, right
  env.add(softbox('#ffc9bf', 6.0 * warmth, 4, 9, new THREE.Vector3(7, 5, -8)));    // warm rim, back right
  env.add(softbox('#ffdcd6', 2.4 * warmth, 4, 8, new THREE.Vector3(-8, 4, -7)));   // faint back-left kicker
  env.add(softbox('#ffffff', 2.2, 12, 10, new THREE.Vector3(0, 12, 1)));           // top fill
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(40, 40), new THREE.MeshBasicMaterial({ color: new THREE.Color('#ffe6e0').multiplyScalar(1.5) }));
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = -0.4;
  env.add(floor);                                                                  // warm floor bounce

  const pmrem = new THREE.PMREMGenerator(renderer);
  const target = pmrem.fromScene(env, 0.03);
  pmrem.dispose();
  env.traverse((o) => { o.geometry?.dispose(); o.material?.dispose(); });
  return target;
}

/** Place a directional light on the sphere of radius `dist` around `target`; azimuth 0 = toward the camera, positive = the viewer's right. */
export function placeLight(light, azDeg, elDeg, dist = 8, target = new THREE.Vector3(0, 1.5, 0)) {
  const az = THREE.MathUtils.degToRad(azDeg), el = THREE.MathUtils.degToRad(elDeg);
  light.position.set(target.x + dist * Math.sin(az) * Math.cos(el), target.y + dist * Math.sin(el), target.z + dist * Math.cos(az) * Math.cos(el));
  light.target.position.copy(target);
  light.target.updateMatrixWorld();
  return light;
}

/** The soft, wide window light from the upper left.  Shadow-casting; everything else is fill. */
export function createKeyLight(shadowSize = 2048) {
  const key = new THREE.DirectionalLight('#fff3e6', STUDIO.key);
  placeLight(key, STUDIO.keyAz, STUDIO.keyEl);
  key.castShadow = true;
  key.shadow.mapSize.set(shadowSize, shadowSize);
  const c = key.shadow.camera;
  c.left = c.bottom = -2.6; c.right = c.top = 2.6; c.near = 2; c.far = 16;
  key.shadow.bias = -0.0004;
  key.shadow.normalBias = 0.02;
  key.shadow.radius = STUDIO.shadowSoft * (shadowSize / 2048);          // texels of blur: the same world-space softness at any map size
  key.shadow.intensity = STUDIO.shadowInt;
  return key;
}

/** A broad, shadowless fill from the camera side (a photographer's fill card): keeps the face open as Mascot turns. */
export function createFillLight() {
  const fill = new THREE.DirectionalLight('#fff1e8', STUDIO.fill);
  placeLight(fill, STUDIO.fillAz, STUDIO.fillEl, 8, new THREE.Vector3(0, 1.7, 0));
  return fill;
}

/** Warm light bounced up from the studio floor onto chin, belly and the undersides of arms. */
export function createBounceLight() {
  const bounce = new THREE.DirectionalLight('#ffb9a3', STUDIO.bounce);
  placeLight(bounce, STUDIO.bounceAz, -48, 8, new THREE.Vector3(0, 1.4, 0));
  return bounce;
}

/** Sky-to-floor ambient: cream from above, warm body bounce from below. */
export function createHemiLight() {
  return new THREE.HemisphereLight('#fff6ee', '#e9a898', STUDIO.hemi);
}

/** Apply a parameter set (the same names the tuner uses) to a lights bundle { key, fill, bounce, hemi }. */
export function applyStudio(lights, p = {}) {
  const v = { ...STUDIO, ...p };
  lights.key.intensity = v.key; placeLight(lights.key, v.keyAz, v.keyEl);
  lights.key.shadow.radius = v.shadowSoft * (lights.key.shadow.mapSize.x / 2048); lights.key.shadow.intensity = v.shadowInt;
  lights.fill.intensity = v.fill; placeLight(lights.fill, v.fillAz, v.fillEl, 8, new THREE.Vector3(0, 1.7, 0));
  lights.bounce.intensity = v.bounce; placeLight(lights.bounce, v.bounceAz, -48, 8, new THREE.Vector3(0, 1.4, 0));
  lights.hemi.intensity = v.hemi;
}
