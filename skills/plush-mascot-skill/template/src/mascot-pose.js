// Deterministic pose library.  Every state is a set of TARGET values for the
// skeleton, face and props; the controller eases toward them, so transitions
// blend and reduced motion can simply snap.
//
// Conventions (rest pose is all zeros for Euler bones):
//   +x is the viewer's right (Mascot's left).  Bone suffix L = +x, R = -x.
//   head.y turns toward +x, head.x nods down (positive), *.z tilts toward +x.
//   ARMS are authored by aiming.  For both arms +x is OUTWARD, +y up, +z toward
//   the viewer; u / f / h are the directions of the upper arm, forearm and hand
//   in the chest frame.  The rig converts them to bone rotations.  `arm{L,R}.s` is
//   how much longer the arm is than the sculpt's (0 = as sculpted, 1 = twice as
//   long): the standing sculpt's arms are too short to lift a hand clear of its
//   wide hood, but the artwork's raised arms are about twice as long, so a raised
//   arm stretches (like a cartoon's) instead of pushing its hand through the head.

export const BONES = ['hips', 'spine', 'chest', 'head', 'earL', 'earR', 'hipL', 'ankleL', 'hipR', 'ankleR'];
export const ARM_KEYS = ['L', 'R'].flatMap((t) => [...['u', 'f', 'h'].flatMap((p) => ['x', 'y', 'z'].map((a) => `arm${t}.${p}${a}`)), `arm${t}.s`]);
export const KEYS = [
  ...BONES.flatMap((b) => [`${b}.x`, `${b}.y`, `${b}.z`]),
  ...ARM_KEYS,
  'root.y', 'root.yaw', 'root.roll', 'root.pitch', 'root.sy', 'chest.sy',
  'f.gx', 'f.gy', 'f.cv', 'f.lt', 'f.lb', 'f.tilt', 'f.smile', 'f.mw', 'f.mo', 'f.blush',
  'p.laptop', 'p.phones', 'p.typeL', 'p.typeR', 'p.card', 'f.sleep', 'p.confetti',
  'p.sit',                                        // 0..1 seated on the floor (working): widens and lowers the ground shadows
];

/** Write the three arm aim vectors (normalised when applied). */
export function aim(p, tag, u, f, h = f) {
  for (const [part, v] of [['u', u], ['f', f], ['h', h]]) {
    p[`arm${tag}.${part}x`] = v[0]; p[`arm${tag}.${part}y`] = v[1]; p[`arm${tag}.${part}z`] = v[2];
  }
}
/** `v` turned by `a` radians about the viewing axis (toward +y for a vector pointing along +x): the swing of a forearm in a wave. */
const rotZ = (v, a) => [v[0] * Math.cos(a) - v[1] * Math.sin(a), v[0] * Math.sin(a) + v[1] * Math.cos(a), v[2]];
const lerp3 = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

// Mascot's eyes are slightly toed-in: in every view of the artwork the viewer's-left iris sits a touch right of centre and the
// viewer's-right iris hugs the inner (left) end of its eye.  That is a shared gaze of about -0.375 plus this convergence.
const EYE_TOE_IN = 0.575;
const REST_GAZE_X = -0.375;
const REST_GAZE_Y = 0.24;
/** The neutral artwork's gaze (x, y in the -1..1 gaze range, and the convergence added to each eye); the face builds its iris offsets from it. */
export const REST_GAZE = { x: REST_GAZE_X, y: REST_GAZE_Y, toeIn: EYE_TOE_IN };

const REST_ARM = { u: [0.80, -0.58, 0.10], f: [0.64, -0.68, 0.30], h: [0.58, -0.70, 0.36] };

export function restPose() {
  const p = Object.fromEntries(KEYS.map((k) => [k, 0]));
  p['root.sy'] = 1; p['chest.sy'] = 1; p['f.smile'] = 0.55; p['f.mw'] = 0.2857; p['f.blush'] = 1; p['p.confetti'] = -1;
  p['f.cv'] = EYE_TOE_IN;
  for (const t of ['L', 'R']) aim(p, t, REST_ARM.u, REST_ARM.f, REST_ARM.h);
  return p;
}
const REST = Object.freeze(restPose());              // (the pose every frame starts from; copied into the output, not rebuilt 60 times a second)

const sm = (x) => x * x * (3 - 2 * x);
const clamp01 = (x) => Math.min(1, Math.max(0, x));

/**
 * The seated 'working' pose, like the artwork's top-left vignette: Mascot sits on the floor, legs forward in a V, an open laptop on
 * the floor in front of him, both hands on its keys.  The artwork cheats the proportions, and so must we: its seated torso is
 * much shorter than the standing one (chin ~0.9 above the floor against 1.15 for the sculpt) and its arms are about a third
 * longer.  So while seated the lower torso `settle`s (the spine joint drops, a plush slumping onto its bottom: applied to the
 * skeleton by src/props/lp-seat.js, fading with `seatAmount`) and the arms `stretch` (through the pose's arm{L,R}.s, like every
 * other raised arm, see the header).  The hands are placed by IK
 * (seatArm) on the keys of the laptop, which sits at `laptop` in body space.  Shared with src/props/laptop.js and the ground
 * shadows in src/mascot.js.
 */
export const SEAT = {
  y: -0.215, sy: 0.955, ground: 0, yaw: 0.7,     // seated root height / squash (the thighs rest on the floor at `ground`), body turn
  lean: { hips: -0.10, spine: 0.12, chest: 0.08 },
  settle: 0.24, stretch: 0.85, flatten: 0.32, reach: [0, -0.06, 0.12],   // seated proportions, applied to the skeleton by src/props/lp-seat.js
  // legs (world pitch, splay, ankle): a V around the laptop; his right leg (viewer's left) points at the viewer like the artwork's
  // near foot, his left leg goes out behind the lid, where the artwork's far foot peeks out
  legR: { splay: -0.52, pitch: -1.47, ankle: 0.34 }, legL: { splay: 0.78, pitch: -1.43, ankle: 0.30 },
  // the laptop: body-space position of its base centre and yaw, and the height of its key tops above the floor
  laptop: { x: 0.08, z: 0.8, yaw: 0.05, keyTop: 0.059 },
  // where each hand rests on the keyboard (laptop frame: x the user's right, z toward the user), and how far the plush dents
  hands: { L: [-0.22, 0.09], R: [0.4, 0.09] }, dent: 0.006,
  arm: { pole: [0.35, -0.75, -0.55], droop: 0.55 },   // IK: which way the elbows bend (chest frame, +x outward), how far the hands droop
};

/** 0..1, how far the body has settled into the seat, from the root height (other states never go below -0.04). */
export const seatAmount = (rootY) => sm(clamp01((-rootY - 0.05) / (-SEAT.y - 0.05)));
/** 0..1, how far the arms have lengthened and the hands travelled to the keys, from the laptop's presence (they reach as it opens). */
export const reachAmount = (laptop) => sm(clamp01((laptop - 0.12) / 0.75));

// ---- seated arm IK -----------------------------------------------------------------------------------------------------------
// Rest skeleton of the sculpt (scripts/bake/model.mjs + skeleton.mjs, body space): the elbow sits halfway from shoulder to hand
// centre, the wrist at 0.62 of the rest; every bone's rest rotation is the identity.
const SK = { hips: [0, 0.62, 0.05], spine: [0, 0.98, 0.05], chest: [0, 1.32, 0.03], shoulder: [0.507, 1.184, 0.02], hand: [0.896, 0.892, 0.07] };
const ARM_LEN = Math.hypot(SK.hand[0] - SK.shoulder[0], SK.hand[1] - SK.shoulder[1], SK.hand[2] - SK.shoulder[2]);
export const HAND_R = 0.216;                                   // hand-ball radius
const sub3 = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add3 = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const mul3 = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
const dot3 = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const unit3 = (a) => mul3(a, 1 / (Math.hypot(a[0], a[1], a[2]) || 1));
/** Inverse of three.js Euler 'XYZ' (R = Rx Ry Rz) applied to v. */
function unrot(v, x, y, z) {
  let [a, b, c] = v;
  let s = Math.sin(-x), k = Math.cos(-x); [b, c] = [b * k - c * s, b * s + c * k];
  s = Math.sin(-y); k = Math.cos(-y); [a, c] = [a * k + c * s, -a * s + c * k];
  s = Math.sin(-z); k = Math.cos(-z); [a, b] = [a * k - b * s, a * s + b * k];
  return [a, b, c];
}
/** Three.js Euler 'XYZ' (R = Rx Ry Rz) applied to v. */
function rot(v, x, y, z) {
  let [a, b, c] = v;
  let s = Math.sin(z), k = Math.cos(z); [a, b] = [a * k - b * s, a * s + b * k];
  s = Math.sin(y); k = Math.cos(y); [a, c] = [a * k + c * s, -a * s + c * k];
  s = Math.sin(x); k = Math.cos(x); [b, c] = [b * k - c * s, b * s + c * k];
  return [a, b, c];
}
/** The chest bone's frame (relative to its rest position, before its breathing scale) -> body space; inverse of toChest. */
function fromChest(q, P, settle) {
  let p = rot([q[0], q[1] * P['chest.sy'], q[2]], P['chest.x'], P['chest.y'], P['chest.z']);
  p = rot(add3(p, sub3(SK.chest, SK.spine)), P['spine.x'], P['spine.y'], P['spine.z']);
  p = rot(add3(p, [SK.spine[0] - SK.hips[0], SK.spine[1] - SK.hips[1] - settle, SK.spine[2] - SK.hips[2]]), P['hips.x'], P['hips.y'], P['hips.z']);
  return add3(p, SK.hips);
}
/** Where the hand-ball centre of arm `tag` is for the given aim vectors (pose convention) at rest length, in body space. */
function armHand(tag, P, aims, settle) {
  const s = tag === 'L' ? 1 : -1, n = (v) => { const u = unit3(v); return [s * u[0], u[1], u[2]]; };
  const q = add3(add3(add3([s * SK.shoulder[0] - SK.chest[0], SK.shoulder[1] - SK.chest[1], SK.shoulder[2] - SK.chest[2]],
    mul3(n(aims.u), ARM_LEN * 0.5)), mul3(n(aims.f), ARM_LEN * 0.31)), mul3(n(aims.h), ARM_LEN * 0.19));
  return fromChest(q, P, settle);
}
/** Body-space point -> the chest bone's frame (relative to its rest position, before its breathing scale). */
function toChest(p, P, settle) {
  let q = unrot(sub3(p, SK.hips), P['hips.x'], P['hips.y'], P['hips.z']);
  q = unrot(sub3(q, [SK.spine[0] - SK.hips[0], SK.spine[1] - SK.hips[1] - settle, SK.spine[2] - SK.hips[2]]), P['spine.x'], P['spine.y'], P['spine.z']);
  q = unrot(sub3(q, sub3(SK.chest, SK.spine)), P['chest.x'], P['chest.y'], P['chest.z']);
  return [q[0], q[1] / P['chest.sy'], q[2]];
}
/**
 * Two-bone IK with a drooping hand: aim vectors (pose convention, +x outward) that put the hand-ball centre of arm `tag` at the
 * body-space point `target`, given the torso already written to `P`, the arm stretch and the torso settle in effect.
 */
function seatArm(tag, target, P, stretch, settle, reach = [0, 0, 0], { pole = [0.7, -0.25, -0.65], droop = 0.55 } = {}) {
  const s = tag === 'L' ? 1 : -1;
  const v = sub3(toChest(target, P, settle), [s * (SK.shoulder[0] + reach[0]) - SK.chest[0], SK.shoulder[1] + reach[1] - SK.chest[1], SK.shoulder[2] + reach[2] - SK.chest[2]]);
  const L1 = ARM_LEN * 0.5 * (1 + stretch), L2 = ARM_LEN * 0.31 * (1 + stretch), L3 = ARM_LEN * 0.19;
  const pl = [s * pole[0], pole[1], pole[2]];
  // the hand points along the reach, drooping onto the keys; then shoulder + elbow solve exactly for the wrist
  const h = unit3(add3(unit3(v), [0, -droop, 0]));
  const w = sub3(v, mul3(h, L3)), d = Math.hypot(w[0], w[1], w[2]), wn = mul3(w, 1 / d);
  const dc = Math.min(L1 + L2 - 1e-4, Math.max(Math.abs(L1 - L2) + 1e-4, d));
  const ca = (L1 * L1 + dc * dc - L2 * L2) / (2 * L1 * dc), sa = Math.sqrt(Math.max(0, 1 - ca * ca));
  const n = unit3(sub3(pl, mul3(wn, dot3(pl, wn))));
  const u = add3(mul3(wn, ca), mul3(n, sa));
  const f = unit3(sub3(w, mul3(u, L1)));
  return { u: [s * u[0], u[1], u[2]], f: [s * f[0], f[1], f[2]], h: [s * h[0], h[1], h[2]] };
}
/** Laptop-frame point -> body space, for a laptop at SEAT.laptop on the floor, with the body's root at height rootY / squash sy. */
function laptopToBody([x, y, z], rootY, sy) {
  const L = SEAT.laptop, sxz = 1 / Math.sqrt(sy), a = Math.PI + L.yaw, c = Math.cos(a), s = Math.sin(a);
  const lx = x / sxz, lz = z / sxz;
  return [L.x + lx * c + lz * s, (SEAT.ground - rootY + y) / sy, L.z - lx * s + lz * c];
}

// Typing rhythm: short bursts ("words") of mostly alternating keystrokes, a space-bar tap by the right hand after each word and a
// pause, repeating every TYPE_LOOP seconds.  Deterministic (seeded), so stills and recordings repeat.
const TYPE_LOOP = 9.6;
const TAPS = (() => {
  let seed = 20260930;
  const rnd = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
  const taps = [];
  let at = 0.15, hand = 0;
  while (at < TYPE_LOOP - 0.7) {
    const n = 3 + Math.floor(rnd() * 4);
    for (let i = 0; i < n; i++) { if (rnd() < 0.75) hand = 1 - hand; taps.push([at, hand, 0.75 + 0.3 * rnd()]); at += 0.13 + 0.08 * rnd(); }
    taps.push([at + 0.03, 1, 1.2]);
    at += 0.4 + 0.55 * rnd();
  }
  return taps;
})();
/**
 * Target vertical motion of a hand for the keystrokes (0 = resting on the keys): a mitten types by lifting off the keys a little
 * (> 0) and striking back down onto them, the strike carrying just past the rest (< 0) so the keys under it bottom out.  The arms'
 * springs round this into a soft tap; p.typeL / p.typeR carry the same signal through the same spring (mascot.js).
 */
function typing(t, hand) {
  let v = 0;
  const u0 = ((t % TYPE_LOOP) + TYPE_LOOP) % TYPE_LOOP;
  for (const [at, hd, k] of TAPS) {
    if (hd !== hand) continue;
    for (const u of [u0 - at, u0 - at - TYPE_LOOP, u0 - at + TYPE_LOOP]) {
      if (u < -0.3 || u > 0.2) continue;
      const lift = (u + 0.11) / 0.05, strike = (u - 0.02) / 0.04;
      v += k * (Math.exp(-lift * lift) - 0.85 * Math.exp(-strike * strike));
    }
  }
  return v;
}
/** Blend arm `tag` from its rest pose by `s` toward `target` ({ u, f, h?, s? }: aim vectors and stretch). */
const armTo = (out, tag, s, target) => {
  aim(out, tag, lerp3(REST_ARM.u, target.u, s), lerp3(REST_ARM.f, target.f, s), lerp3(REST_ARM.h, target.h ?? target.f, s));
  out[`arm${tag}.s`] = (target.s ?? 0) * s;
};

/**
 * The pose of one state.
 * @param {string} state
 * @param {number} t   seconds since the state began
 * @param {object} o   { time, lookX, lookY, reduced, voice }
 * @param {object} out pose object to fill (reset to rest first)
 */
function statePose(state, t, { time = 0, lookX = 0, lookY = 0, reduced = false, voice } = {}, out) {
  Object.assign(out, REST);
  const m = reduced ? 0 : 1;                       // motion multiplier for oscillations
  const w = time;
  const breathe = Math.sin(w * 1.75) * m;
  const sway = Math.sin(w * 0.62) * m;

  // ---- always-on base: breathing, weight shift, attention -------------------
  out['root.y'] = breathe * 0.010;
  out['chest.sy'] = 1 + breathe * 0.012;
  out['spine.x'] = breathe * 0.008;
  out['hips.z'] = sway * 0.018;
  out['chest.z'] = -sway * 0.014;
  out['head.z'] = sway * 0.012;
  out['head.y'] = lookX * 0.20;
  out['head.x'] = -lookY * 0.10;
  // The neutral artwork glances slightly up (and its eyes toe in, see EYE_TOE_IN); keep that as the resting gaze.
  out['f.gx'] = Math.max(-1, Math.min(1, lookX + REST_GAZE_X)); out['f.gy'] = Math.min(1, lookY + REST_GAZE_Y);
  const armSway = breathe * 0.02;
  for (const tag of ['L', 'R']) aim(out, tag, [REST_ARM.u[0] + armSway, REST_ARM.u[1], REST_ARM.u[2]], REST_ARM.f, REST_ARM.h);
  out['root.yaw'] = 0.12;

  switch (state) {
    case 'greeting': {
      const env = reduced ? 0.85 : Math.pow(Math.sin(Math.min(1, t / 2.4) * Math.PI), 0.35);
      // the wave starts once the arm is up and settles before it lowers: the forearm swings about the elbow, the hand flops a little more
      const swing = reduced ? 0 : Math.sin(t * 11) * sm(clamp01((t - 0.3) / 0.4)) * sm(clamp01((2.4 - t) / 0.35)) * 0.48;
      // the arm goes up and out to the side, stretching (the sculpt's arm cannot lift its hand clear of the wide hood), hand well beside the head
      armTo(out, 'L', env, { u: [0.94, 0.0, 0.30], f: rotZ([0.78, 0.52, 0.35], swing), h: rotZ([0.55, 0.70, 0.40], 1.5 * swing), s: 1.2 });
      out['head.z'] = 0.06 * env;
      out['chest.z'] = 0.03 * env;
      out['f.smile'] = 0.95; out['f.lb'] = 0.12 * env;
      out['earR.z'] = -0.12 * env;
      break;
    }
    case 'listening': {
      out['chest.x'] = 0.07; out['head.x'] += 0.05; out['head.z'] = 0.105; out['head.y'] *= 0.5;
      out['earL.z'] = -0.16; out['earR.z'] = 0.20; out['earL.x'] = -0.08;
      out['root.yaw'] = 0.02;
      out['f.gx'] = lookX * 0.4; out['f.gy'] = lookY * 0.4;
      out['f.smile'] = 0.5;
      armTo(out, 'L', 1, { u: [0.80, -0.55, 0.22], f: [0.55, -0.68, 0.50] });
      armTo(out, 'R', 1, { u: [0.80, -0.55, 0.22], f: [0.55, -0.68, 0.50] });
      break;
    }
    case 'thinking': {
      const s = sm(clamp01(t / 0.7));
      out['head.z'] = -0.12 * s; out['head.x'] = -0.10 * s; out['head.y'] = -0.16 * s + Math.sin(w * 1.1) * 0.035 * m;
      // right hand comes up in front of the chest, under the chin
      armTo(out, 'R', s, { u: [0.10, -0.40, 0.91], f: [-0.50, 0.55, 0.66], h: [-0.55, 0.62, 0.56] });
      out['f.gx'] = -0.55 * s; out['f.gy'] = 0.62 * s;
      out['f.lt'] = 0.16 * s; out['f.smile'] = 0.15; out['f.mw'] = 0.229;
      out['earL.z'] = 0.10 * s; out['earR.z'] = 0.18 * s;
      break;
    }
    case 'working': {
      if (reduced) t = 99;                                              // (reduced motion: the settled, seated pose at once)
      // Mascot sits down on the floor like the artwork, the laptop arrives and opens in front of him, and he types.  Seconds since
      // the state began: 0-0.3 an anticipation squash and lean; 0.16-0.56 the legs kick up and forward while the body falls back
      // onto its bottom (0.24-0.8, the arms fling forward for balance), the legs overshoot and come down onto the heels, landing with
      // a squash at ~0.84; the hands settle onto the floor beside him; 0.85-1.85 the laptop slides in closed and opens
      // (src/props/laptop.js maps p.laptop); 1.3-1.95 the hands go to the keys and the head bows to the screen as it wakes; from
      // ~2 s a typing rhythm (bursts of keystrokes and pauses) with the odd nod, weight shift and shoulder settle.  Everything is a
      // function of t / time, so reduced motion (m = 0) still yields the full static seated pose.
      const win = (a, b) => sm(clamp01((t - a) / (b - a)));
      const bump = (c, half) => { const x = (t - c) / half; return x > -1 && x < 1 ? (1 - x * x) * (1 - x * x) : 0; };
      const pulse = (period, phase, width) => { const f = ((w + phase) % period) / period - 0.5; return Math.exp(-(f * f) / (width * width)); };
      const dip = t < 0.3 ? Math.sin(Math.PI * t / 0.3) * m : 0;
      const kick = win(0.16, 0.56), sit = win(0.24, 0.8), turn = win(0.2, 0.95), lean = win(0.55, 1.2);
      const fall = bump(0.52, 0.3) * m, over = bump(0.64, 0.2) * m, land = bump(0.84, 0.18) * m, swing = bump(0.4, 0.2);
      const rest = win(0.72, 1.15), lap = win(0.85, 1.85), bow = win(1.4, 2.0), typeAmp = win(2.0, 2.5) * m;
      const nod = pulse(4.7, 1.3, 0.05) * typeAmp, shrug = pulse(7.3, 3.1, 0.06) * typeAmp, shift = Math.sin(w * 0.86) * typeAmp;
      const tapL = typing(t, 0) * typeAmp, tapR = typing(t, 1) * typeAmp;
      out['p.sit'] = sit; out['p.laptop'] = lap; out['p.phones'] = t >= 0.55 ? 1 : 0;      // (the headphones pop on as he lands, see props/headphones.js)
      out['p.typeL'] = tapL; out['p.typeR'] = tapR;                    // (sprung like the arms, see SPRINGS in mascot.js)
      out['root.yaw'] = 0.12 + (SEAT.yaw - 0.12) * turn;
      // (the crouch squashes about the floor, so the standing feet stay on it)
      out['root.y'] = breathe * 0.01 * (1 - sit) + SEAT.y * sit + 0.035 * swing + shift * 0.003;
      out['root.sy'] = 1 + (SEAT.sy - 1) * sit - 0.035 * dip - 0.04 * land;
      // torso: leans into the crouch, tips back as the bottom drops, rocks forward on landing and leans in to the keyboard
      out['hips.x'] = SEAT.lean.hips * lean + 0.1 * dip - 0.12 * fall + 0.04 * land + 0.01 * nod;
      out['hips.z'] = sway * 0.018 * (1 - sit) + shift * 0.02;
      out['spine.x'] = breathe * 0.008 + SEAT.lean.spine * lean + 0.04 * dip - 0.04 * fall;
      out['chest.x'] = SEAT.lean.chest * lean + 0.03 * dip + 0.02 * shrug;
      out['chest.z'] = -sway * 0.014 * (1 - sit) - shift * 0.015;
      out['chest.sy'] = 1 + breathe * 0.012 + 0.025 * shrug;
      // legs: kick up and forward in a V ahead of the drop (the feet leave the floor), overshoot, come down onto the heels
      for (const [tag, leg] of [['L', SEAT.legL], ['R', SEAT.legR]]) {
        out[`hip${tag}.x`] = (leg.pitch - out['hips.x']) * kick - 0.22 * over;
        out[`hip${tag}.z`] = leg.splay * kick;
        out[`ankle${tag}.x`] = leg.ankle * kick + 0.12 * over + 0.55 * swing;          // toes pointed through the swing: heels clear
      }
      // head: follows through on the landing, bows to the screen as it lights up, a touch toward the laptop; nods now and then
      out['head.x'] = 0.05 * dip - 0.05 * fall + 0.07 * land + 0.12 * bow + 0.05 * nod - lookY * 0.03 * (1 - bow);
      out['head.y'] = lookX * 0.12 * (1 - bow) - 0.4 * bow;
      out['head.z'] = Math.sin(w * 2) * 0.01 * m + shift * 0.015 - 0.03 * bow;
      // arms: back in the crouch, flung forward for balance in the fall, then the (seated, longer) arms put the hands down on the
      // floor beside him, and IK takes them onto the keys, tapping
      // (the skeleton's seated proportions: the torso settles with the seat, the arms lengthen as the laptop opens - see lp-seat.js;
      // the laptop's presence trails its target here by the ease in mascot.js, ~0.2 s)
      const settle = SEAT.settle * seatAmount(out['root.y']), armA = reachAmount(win(1.05, 2.05));
      const stretch = SEAT.stretch * armA, reachOff = SEAT.reach.map((r) => r * armA);
      const back = { u: [0.78, -0.62, -0.1], f: [0.62, -0.72, 0.06], h: [0.56, -0.76, 0.14] };
      const fling = { u: [0.62, -0.28, 0.73], f: [0.45, -0.12, 0.88], h: [0.40, -0.10, 0.91] };
      const relax = { u: [0.74, -0.64, 0.2], f: [0.55, -0.7, 0.46], h: [0.5, -0.72, 0.48] };        // seated, hands down by the thighs
      for (const [tag, tap, lat] of [['L', tapL, Math.sin(w * 0.7 + 1)], ['R', tapR, Math.sin(w * 0.55)]]) {
        const [hx, hz] = SEAT.hands[tag];
        const key = laptopToBody([hx + 0.018 * lat * typeAmp, SEAT.laptop.keyTop, hz - 0.003 * tap], out['root.y'], out['root.sy']);
        key[1] += HAND_R - SEAT.dent + 0.03 * tap;
        const swing = ['u', 'f', 'h'].map((p) => lerp3(lerp3(REST_ARM[p], back[p], dip * 0.8), fling[p], fall));
        // the hands travel in target space: from where the relaxed arm rests (pinned, however long the arm has grown), over the
        // deck in a low arc, down onto the keys, so they come to the keys from above and never pass through the laptop
        const from = armHand(tag, out, relax, settle), e = armA;
        const path = add3(lerp3(from, key, e), [0, 0.16 * Math.sin(Math.PI * Math.min(1, e * 1.15)) * (1 - e * 0.35), 0]);
        const ik = seatArm(tag, e >= 1 ? key : path, out, stretch, settle, reachOff, SEAT.arm);
        const a = ['u', 'f', 'h'].map((p, i) => lerp3(swing[i], ik[p], rest));
        aim(out, tag, a[0], a[1], a[2]);
        out[`arm${tag}.s`] = stretch;
      }
      // eyes on the screen; the upper lids follow the gaze down (mascot.js)
      out['f.gx'] = 0.6 * bow + (lookX * 0.2 + REST_GAZE_X) * (1 - bow); out['f.gy'] = out['f.gy'] * (1 - bow) - 0.55 * bow;
      out['f.smile'] = 0.55 - 0.12 * bow; out['f.mw'] = 0.2857 - 0.014 * bow;
      out['earL.z'] = -0.05 * sit - 0.14 * land + 0.08 * fall; out['earR.z'] = 0.05 * sit + 0.14 * land - 0.08 * fall;
      break;
    }
    case 'approval': {
      const s = sm(clamp01(t / 0.6));
      // like the artwork: the head turns toward the card and leans a little away from it, the card arm (viewer's right) reaches out to the
      // side with the forearm up and the hand under the card's bottom edge, the other arm offers an open palm
      out['head.z'] = -0.05 * s; out['head.y'] = lookX * 0.08 + 0.38 * s;
      out['root.yaw'] = 0.12 - 0.10 * s;
      armTo(out, 'L', s, { u: [0.95, -0.05, 0.28], f: [0.78, 0.55, 0.28], h: [0.50, 0.78, 0.35], s: 1.3 });
      armTo(out, 'R', s, { u: [0.93, -0.30, 0.22], f: [0.90, -0.05, 0.40], h: [0.65, 0.45, 0.60], s: 1.0 });
      out['p.card'] = sm(clamp01((t - 0.35) / 0.5));              // (it opens out of the palm once the arm is nearly out)
      out['chest.x'] = 0.02 * s; out['chest.z'] = -0.03 * s;
      out['f.smile'] = 0.5; out['f.gx'] = 0.45 * s + lookX * 0.3; out['f.gy'] = lookY * 0.3 + 0.03;
      out['earL.z'] = -0.05; out['earR.z'] = 0.12;
      out['root.y'] = 0;
      break;
    }
    case 'success': {
      // crouch first (anticipation), then the hop from t = 0.2 s
      const lead = 0.2, th = t - lead;
      const crouch = reduced || t >= lead ? 0 : Math.sin((t / lead) * Math.PI);
      const hopT = clamp01(th / 1.3);
      const e = reduced ? 0 : Math.max(0, Math.sin(hopT * Math.PI));
      const land = reduced ? 0 : Math.max(0, 1 - Math.abs(th - 1.35) * 5) * 0.5;
      out['root.y'] = e * 0.36 - crouch * 0.02;
      out['root.sy'] = 1 + e * 0.05 - land * 0.10 - crouch * 0.07;
      const raise = reduced ? 1 : 0.3 + 0.7 * e;                          // (the arms go up with the hop and come back down after it)
      // both arms up in a V, stretched, hands well outside the hood (the artwork's cheer)
      armTo(out, 'L', raise, { u: [0.89, 0.40, 0.12], f: [0.82, 0.55, 0.10], h: [0.52, 0.84, 0.10], s: 1.65 });
      armTo(out, 'R', raise, { u: [0.87, 0.44, 0.12], f: [0.78, 0.60, 0.10], h: [0.48, 0.86, 0.10], s: 1.65 });
      out['hipL.x'] = -e * 0.45; out['hipR.x'] = e * 0.25; out['ankleL.x'] = e * 0.35; out['ankleR.x'] = -e * 0.2;
      out['head.z'] = -0.06; out['head.x'] = -0.05 * e + 0.05 * crouch;
      out['f.lb'] = 0.2; out['f.smile'] = 1.25; out['f.mw'] = 0.333; out['f.mo'] = 0.35 * e;
      out['earL.z'] = 0.2 * e; out['earR.z'] = -0.2 * e;
      out['p.confetti'] = reduced || th < 0 ? -1 : th;
      break;
    }
    case 'error': {
      const s = sm(clamp01(t / 0.5));
      out['head.z'] = -0.12 * s; out['head.x'] = 0.055 * s;
      out['chest.x'] = 0.05 * s;
      out['earL.z'] = 0.30 * s; out['earR.z'] = -0.30 * s; out['earL.x'] = 0.15 * s; out['earR.x'] = 0.15 * s;
      armTo(out, 'L', s, { u: [0.62, -0.74, 0.26], f: [0.30, -0.78, 0.55] });
      armTo(out, 'R', s, { u: [0.70, -0.68, 0.20], f: [0.45, -0.75, 0.48] });
      out['f.smile'] = -0.75; out['f.mw'] = 0.208; out['f.lt'] = 0.14 * s; out['f.tilt'] = 0.9 * s; out['f.blush'] = 0.75;
      out['f.gx'] = lookX * 0.4; out['f.gy'] = lookY * 0.4 - 0.15 * s;
      break;
    }
    case 'speaking': {
      const amp = voice ?? (reduced ? 0 : (Math.sin(t * 14) + Math.sin(t * 8.3 + 1) * 0.7 + 1.7) / 3.4);
      out['f.mo'] = amp; out['f.smile'] = 0.35 * (1 - amp); out['f.mw'] = 0.301 - 0.083 * amp;
      out['head.z'] = Math.sin(w * 2.4) * 0.035 * m; out['head.y'] += Math.sin(w * 1.3) * 0.05 * m;
      armTo(out, 'L', 1, { u: [0.78, -0.22, 0.58], f: [0.40, 0.10 + Math.sin(t * 2.6) * 0.22 * m, 0.90], h: [0.36 + Math.sin(t * 3) * 0.22 * m, 0.20, 0.90] });
      out['f.gx'] = lookX * 0.5; out['f.gy'] = lookY * 0.5;
      break;
    }
    case 'resting': {
      out['head.x'] = 0.15; out['head.z'] = 0.05; out['head.y'] = 0;
      out['chest.x'] = 0.05; out['root.y'] = -0.03 + breathe * 0.006;
      out['f.lt'] = 1; out['f.sleep'] = 1; out['f.smile'] = 0.35; out['f.gx'] = 0; out['f.gy'] = 0;
      armTo(out, 'L', 1, { u: [0.72, -0.66, 0.18], f: [0.50, -0.74, 0.44] });
      armTo(out, 'R', 1, { u: [0.72, -0.66, 0.18], f: [0.50, -0.74, 0.44] });
      out['earL.z'] = 0.10; out['earR.z'] = -0.10; out['earL.x'] = 0.08; out['earR.x'] = 0.08;
      out['root.yaw'] = 0.10;
      break;
    }
    default: break; // idle
  }
  return out;
}

// ---- putting the seat away -------------------------------------------------------------------------------------------------------
// When a state replaces 'working' he does not snap up: the typing stops, the lid closes, the headphones lift off, and then he
// gets to his feet (with a little lean forward to push up).  The seated pose is held (typing on) and released key by key on the
// schedule below, each fraction of the dismount, into the pose of the state that follows; that state's own motion starts after
// `dismountLead` (success springs up at once, straight from the seat).  The controller (src/mascot.js) runs the clock.
/** Seconds the seated pose takes to come apart when `to` replaces 'working'. */
export const dismountTime = (to) => (to === 'success' ? 0.5 : 1.1);
/** Seconds the incoming state waits before its own motion begins. */
export const dismountLead = (to) => (to === 'success' ? 0.12 : dismountTime(to));
const STAGES = [                                 // [which keys, start, length] as fractions of the dismount; unlisted keys are the body
  [(k) => k.startsWith('p.type'), 0, 0.11],
  [(k) => k === 'p.phones', 0.23, 0.0001],       // (a step: the lift-off plays as authored)
  [(k) => k === 'p.laptop', 0.04, 0.26],
  [(k) => k === 'p.card' || k === 'p.confetti', 0, 0.01],
  [(k) => k.startsWith('f.'), 0.05, 0.4],
  [(k) => k.startsWith('head.'), 0.05, 0.55],
  [(k) => k.startsWith('arm'), 0.09, 0.64],
];
const KEY_STAGE = KEYS.map((k) => { const s = STAGES.find(([test]) => test(k)); return s ? [s[1], s[2]] : [0.41, 0.59]; });
const SEATED = {};

/**
 * @param {string} state the state being entered (or held)
 * @param {number} t     seconds since that state's own motion began (0 while it is still waiting)
 * @param {object} o     as statePose, plus `dismount: { t, worked, D }` while a seat is being put away: seconds since it began, how long
 *                       Mascot had been working, and the dismount's length
 */
export function computePose(state, t, o = {}, out) {
  const d = o.dismount;
  if (!d || o.reduced || state === 'working') return statePose(state, t, o, out);
  statePose('working', d.worked + d.t, o, SEATED);
  statePose(state, t, o, out);
  const tau = clamp01(d.t / d.D);
  for (let i = 0; i < KEYS.length; i++) {
    const k = KEYS[i], [a, len] = KEY_STAGE[i], w = sm(clamp01((tau - a) / len));
    out[k] = SEATED[k] + (out[k] - SEATED[k]) * w;
  }
  const push = Math.sin(Math.PI * clamp01((tau - 0.35) / 0.5));       // leans forward over his feet to get up
  out['hips.x'] += 0.2 * push; out['spine.x'] += 0.08 * push; out['head.x'] -= 0.06 * push;
  return out;
}
