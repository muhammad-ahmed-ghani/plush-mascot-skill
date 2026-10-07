// Skeleton + skin-weight definitions.  Bone positions are world-space rest
// positions; every bone has an identity rest rotation, so a bone's local axes
// are the world axes and poses can be authored as plain rotations about the joint.
import { clamp, smoothstep } from './sdf.mjs';
import { P } from './model.mjs';

const lerp3 = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

export function armJoints(s, p = P) {
  const A = p.arm;
  // elbow sits mid-arm so the forearm is long enough to bend convincingly
  const elbow = lerp3(A.shoulder, A.hand, 0.5);
  const wrist = lerp3(elbow, A.hand, 0.62);
  return {
    shoulder: [s * A.shoulder[0], A.shoulder[1], A.shoulder[2]],
    elbow: [s * elbow[0], elbow[1], elbow[2]],
    wrist: [s * wrist[0], wrist[1], wrist[2]],
    hand: [s * A.hand[0], A.hand[1], A.hand[2]],
  };
}

export function earAxis(s, p = P) {
  const E = p.ear;
  return [s * Math.sin(E.tilt), Math.cos(E.tilt)];
}

export function makeSkeleton(p = P) {
  const E = p.ear, L = p.leg;
  const bones = [];
  const add = (name, parent, pos) => { bones.push({ name, parent, pos }); return bones.length - 1; };
  const root = add('root', -1, [0, 0, 0]);
  const hips = add('hips', root, [0, 0.62, 0.05]);
  const spine = add('spine', hips, [0, 0.98, 0.05]);
  const chest = add('chest', spine, [0, 1.32, 0.03]);
  const head = add('head', chest, [0, 1.62, 0]);
  for (const [tag, s] of [['L', 1], ['R', -1]]) {
    const ax = earAxis(s, p);
    const back = 0.6 * E.hy;
    add('ear' + tag, head, [s * E.x - ax[0] * back, E.y - ax[1] * back, E.z]);
  }
  for (const [tag, s] of [['L', 1], ['R', -1]]) {
    const j = armJoints(s, p);
    const sh = add('shoulder' + tag, chest, j.shoulder);
    const el = add('elbow' + tag, sh, j.elbow);
    add('wrist' + tag, el, j.wrist);
  }
  for (const [tag, s] of [['L', 1], ['R', -1]]) {
    const hp = add('hip' + tag, hips, [s * L.hip[0], L.hip[1], L.hip[2]]);
    add('ankle' + tag, hp, [s * L.ankle[0], L.ankle[1], L.ankle[2]]);
  }
  const index = Object.fromEntries(bones.map((b, i) => [b.name, i]));
  return { bones, index };
}

// ---- weights: each returns a sparse list [[boneIndex, weight], ...] ---------

function normalise(list) {
  const merged = new Map();
  for (const [i, w] of list) if (w > 1e-5) merged.set(i, (merged.get(i) ?? 0) + w);
  let arr = [...merged.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4);
  const sum = arr.reduce((t, [, w]) => t + w, 0) || 1;
  arr = arr.map(([i, w]) => [i, w / sum]);
  while (arr.length < 4) arr.push([0, 0]);
  return arr;
}

export function makeSkinners(sk, p = P) {
  const ix = sk.index;
  const E = p.ear;
  const ct = Math.cos(E.tilt), st = Math.sin(E.tilt);

  /** Head mesh: rigid head bone + two bendy ears. */
  const head = (x, y, z) => {
    const list = [];
    let earSum = 0;
    for (const [tag, s] of [['L', 1], ['R', -1]]) {
      const dx = x - s * E.x, dy = y - E.y;
      const ry = s * st * dx + ct * dy;                  // position along the ear axis
      const rx = ct * dx - s * st * dy;
      // only points that belong to the ear: close to the ear slab, above its base
      const nearX = 1 - smoothstep(E.hx * 0.9, E.hx * 1.5, Math.abs(rx));
      const nearZ = 1 - smoothstep(E.hz * 0.9, E.hz * 1.5, Math.abs(z - E.z));
      const w = smoothstep(-E.hy * 0.45, E.hy * 0.85, ry) * nearX * nearZ;
      earSum += w;
      list.push([ix['ear' + tag], w]);
    }
    list.push([ix.head, Math.max(0, 1 - earSum)]);
    return normalise(list);
  };

  /** Torso + legs mesh. */
  const body = (x, y, z) => {
    const legW = smoothstep(0.82, 0.46, y);
    const sL = smoothstep(-0.11, 0.11, x);
    const ank = smoothstep(0.37, 0.15, y);
    const list = [
      [ix.hipL, legW * sL * (1 - ank)], [ix.ankleL, legW * sL * ank],
      [ix.hipR, legW * (1 - sL) * (1 - ank)], [ix.ankleR, legW * (1 - sL) * ank],
    ];
    const t = 1 - legW;
    const u = smoothstep(0.62, 0.98, y), v = smoothstep(0.98, 1.32, y);
    const wHips = t * (1 - u), wSpine = t * u * (1 - v), wChest = t * v;
    list.push([ix.hips, wHips], [ix.spine, wSpine], [ix.chest, wChest]);
    return normalise(list);
  };

  /** Arm mesh (per side): shoulder -> elbow -> wrist chain. */
  const arm = (s) => (x, y, z) => {
    const j = armJoints(s, p);
    const seg = (a, b) => {
      const abx = b[0] - a[0], aby = b[1] - a[1], abz = b[2] - a[2];
      const len = Math.hypot(abx, aby, abz);
      return { len, u: ((x - a[0]) * abx + (y - a[1]) * aby + (z - a[2]) * abz) / len };
    };
    const up = seg(j.shoulder, j.elbow), lo = seg(j.elbow, j.wrist);
    // arc-length parameter along the chain, clamped
    const u = up.u < up.len ? up.u : up.len + Math.max(lo.u, 0);
    const uE = up.len, uW = up.len + lo.len;
    const bE = smoothstep(uE - 0.11, uE + 0.11, u);
    const bW = smoothstep(uW - 0.09, uW + 0.09, u);
    const tag = s > 0 ? 'L' : 'R';
    return normalise([
      [ix['shoulder' + tag], 1 - bE],
      [ix['elbow' + tag], bE * (1 - bW)],
      [ix['wrist' + tag], bW],
    ]);
  };

  return { head, body, armL: arm(1), armR: arm(-1) };
}
