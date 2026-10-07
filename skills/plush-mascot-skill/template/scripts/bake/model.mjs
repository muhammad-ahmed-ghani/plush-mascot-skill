// Mascot sculpt definition. Units: character is ~3.3 tall, feet on y = 0,
// +z faces the viewer, +x is the viewer's right. All numbers below were
// measured from assets/mascot-transparent.png (front) and mascot-turnaround.png
// (profile); see research/ for the method.
import {
  clamp, mix, smoothstep, smin, smax,
  sdEllipsoid, sdRoundBox, sdRoundCone, sdCapsule, sdSuperEllipse2, sdSuperEllipsoid, noise3,
} from './sdf.mjs';

export const P = {
  head: {
    cy: 2.2,                // centre height
    hw: 1.128, hh: 0.831, hd: 0.845,   // half extents
    n: 2.796,                 // squircle exponent of the front view (2 = ellipse, larger = squarer)
    m: 2.107,                 // exponent of the depth profile (2 = elliptical)
    mF: 2.107,                // ... in front of the centre plane (larger = a flatter, squarer face)
    taperX: 0.133,           // the top is narrower than the bottom
    taperZ: 0.085,
    cz: -0.001,                  // head depth offset (+ = forward)
    jowl: 0.011,             // fuller lower cheeks (widens the head below the centre line)
  },
  face: {
    cx: 0.019, cy: 2.1425,    // contour centre (the artwork's plate sits ~0.02 right of the body axis)
    a: 0.7855, b: 0.5155,     // half axes: the plate's outline is the dark crevice line where hood meets plate, measured on the artwork (the earlier fit to the dark mask also took in the hood's shaded roll, 0.017 wide on the top and sides)
    nTop: 2.26, nBot: 3.04,   // squircle exponents above / below the centre line
    // Where the padded hood meets the plate the hood rolls over into a narrow crevice and the plate tucks in under it.  Both are
    // gentle at this scale (the thin dark line itself is drawn by the shader); they give the edge its rounded, three-dimensional form.
    hem: 0.022,               // depth of the crevice below the hood surface
    hemW: 0.07,               // how far the hood's rounded edge reaches (wide enough for the mesh: the thin dark line is the shader's job)
    plateW: 0.06,             // how far the plate's rim reaches into the crevice
    tuck: 0.016,              // how much lower the plate sits than the hood at their edge
    tuckW: 0.3,               // ... falling to nothing this far inside
    wallW: 0.04,              // the hood's edge drops to the plate over this width (its rolled lip; refined locally by the bake, see refine.mjs)
  },
  ear: {
    x: 0.769, y: 2.827, z: -0.297,
    hx: 0.29, hy: 0.488, hz: 0.286, r: 0.22,
    tilt: 0.718,             // radians; positive leans the tip outward
    blend: 0.135,
  },
  torso: {
    belly: { c: [0, 0.83, 0.055], r: [0.6, 0.54, 0.575] },
    chest: { c: [0, 1.45, 0.02], r: [0.532, 0.25, 0.35] },
    blend: 0.36,
  },
  leg: {
    hip: [0.337, 0.52, 0.05], hipR: 0.297,
    ankle: [0.349, 0.281, 0.09], ankleR: 0.253,
    foot: { c: [0.504, 0.2, 0.05], r: [0.296, 0.233, 0.46], yaw: 0.35 },
    blend: 0.13,
    gap: 0,
    arch: { w: 0.12, h: 0.383 },   // the arched gap between the legs
  },
  arm: {
    shoulder: [0.507, 1.184, 0.02], shoulderR: 0.21,
    elbow: [0.818, 0.993, 0.04], elbowR: 0.181,
    hand: [0.896, 0.892, 0.07], handR: 0.216,
  },
};

/** Deep-copy the parameter table, optionally applying { 'head.hw': 1.1, 'torso.belly.r.0': .7 } edits. */
export function cloneParams(edits = {}) {
  const out = JSON.parse(JSON.stringify(P));
  for (const [path, value] of Object.entries(edits)) {
    const keys = path.split('.');
    let o = out;
    for (let i = 0; i < keys.length - 1; i++) o = o[keys[i]];
    o[keys[keys.length - 1]] = value;
  }
  return out;
}
export function getPath(obj, path) {
  return path.split('.').reduce((o, k) => o[k], obj);
}

// ---------------------------------------------------------------- head ----
function makeHead(p = P) {
  const H = p.head, F = p.face, E = p.ear;

  // 2D signed distance to the plate's outline (negative inside): above the centre line it is a rounder squircle, below it is
  // fuller like a soft jowl.
  const outline = (x, y) => {
    const dy = y - F.cy;
    return sdSuperEllipse2(x - F.cx, dy, F.a, F.b, dy >= 0 ? F.nTop : F.nBot);
  };
  const ct = Math.cos(E.tilt), st = Math.sin(E.tilt);

  const block = (x, y, zz) => {
    const z = zz - H.cz;
    const ly = y - H.cy;
    const t = smoothstep(-0.25, 0.8, ly);
    const jowl = H.jowl * smoothstep(0.15, -0.55, ly);
    const sx = 1 - H.taperX * t + jowl, sz = 1 - H.taperZ * t + jowl * 0.6;
    return sdSuperEllipsoid(x / sx, ly, z / sz, H.hw, H.hh, H.hd, H.n, H.m, H.mF ?? H.m) * Math.min(sx, sz);
  };

  const ear = (s) => (x, y, z) => {
    // rotate into the ear frame (tilted outward around z)
    const dx = x - s * E.x, dy = y - E.y;
    const rx = ct * dx - s * st * dy;
    const ry = s * st * dx + ct * dy;
    return sdRoundBox(rx, ry, z - E.z - H.cz, E.hx, E.hy, E.hz, E.r);
  };
  const earL = ear(1), earR = ear(-1);

  // How far the surface sits below the plain dome, by distance c from the plate's outline (negative on the plate).  The plate is lowest at
  // the outline and rises to the dome across `tuckW`; the hood's edge is the wall that steps down to it across `wallW`, and outside the wall
  // its rolled shoulder eases back to the dome over `hemW`.  Continuous, with a continuous slope: a step here would be a cliff the grid
  // can only cut as a staircase.
  const plateH = (c) => F.hem * Math.exp(-((c / F.plateW) ** 2)) + F.tuck * smoothstep(-F.tuckW, 0, c);
  const hoodH = (c) => F.hem * Math.exp(-((c / F.hemW) ** 2));
  const edgeProfile = (c) => (c <= 0 ? plateH(c) : c >= F.wallW ? hoodH(c) : mix(plateH(0), hoodH(c), smoothstep(0, F.wallW, c)));

  return function head(x, y, z) {
    let d = block(x, y, z);
    // ears grow out of the block with a soft fold at the base
    d = smin(d, Math.min(earL(x, y, z), earR(x, y, z)), E.blend);

    // The plate is the block's own surface (a dome, so it stays continuous with the hood and its apex reaches the artwork's profile);
    // along its outline the hood rolls down into a crevice and the plate tucks in under it.  (The outline is extruded through the
    // whole head, so only the front half is touched.)
    if (z > 0.05) {
      const c = outline(x, y);
      if (c > -F.tuckW && c < 0.3) {
        const front = smoothstep(0.05, 0.3, z);
        d += front * edgeProfile(c);
      }
    }
    return d;
  };
}

// ---------------------------------------------------------------- body ----
function makeBody(p = P) {
  const T = p.torso, L = p.leg;
  const cf = Math.cos(L.foot.yaw), sf = Math.sin(L.foot.yaw);
  const side = (s) => (x, y, z) => {
    const hx = s * x;                                      // mirror into +x
    const hip = sdRoundCone(hx, y, z, L.hip[0], L.hip[1], L.hip[2], L.ankle[0], L.ankle[1], L.ankle[2], L.hipR, L.ankleR);
    // foot yaw: toes point outward
    const fx = hx - L.foot.c[0], fz = z - L.foot.c[2];
    const rx = cf * fx - sf * fz, rz = sf * fx + cf * fz;
    const foot = sdEllipsoid(rx, y - L.foot.c[1], rz, L.foot.r[0], L.foot.r[1], L.foot.r[2]);
    return smin(hip, foot, L.blend);
  };
  const legL = side(1), legR = side(-1);
  return function body(x, y, z) {
    const belly = sdEllipsoid(x - T.belly.c[0], y - T.belly.c[1], z - T.belly.c[2], T.belly.r[0], T.belly.r[1], T.belly.r[2]);
    const chest = sdEllipsoid(x - T.chest.c[0], y - T.chest.c[1], z - T.chest.c[2], T.chest.r[0], T.chest.r[1], T.chest.r[2]);
    let d = smin(belly, chest, T.blend);
    d = smin(d, smin(legL(x, y, z), legR(x, y, z), 0.05), 0.2);
    // arched gap between the legs: an extruded slot with a fully rounded top
    const A = L.arch;
    const slot = sdRoundBox(x, y - (A.h / 2 - 0.08), z, A.w, A.h / 2 + 0.08, 1.2, A.w * 0.98);
    d = smax(d, -slot, 0.06);
    // flat soles with a soft edge so Mascot stands rather than balancing
    d = smax(d, -y, 0.06);
    return d;
  };
}

// ---------------------------------------------------------------- arms ----
function makeArm(s, p = P) {
  const A = p.arm;
  return (x, y, z) => {
    const hx = s * x;
    const upper = sdRoundCone(hx, y, z, A.shoulder[0], A.shoulder[1], A.shoulder[2], A.elbow[0], A.elbow[1], A.elbow[2], A.shoulderR, A.elbowR);
    const lower = sdRoundCone(hx, y, z, A.elbow[0], A.elbow[1], A.elbow[2], A.hand[0], A.hand[1], A.hand[2], A.elbowR, A.handR);
    return smin(upper, lower, 0.08);
  };
}

export function buildModel(p = P) {
  const head = makeHead(p);
  const body = makeBody(p);
  const armL = makeArm(1, p);
  const armR = makeArm(-1, p);
  const scene = (x, y, z) => Math.min(head(x, y, z), body(x, y, z), armL(x, y, z), armR(x, y, z));
  return { head, body, armL, armR, scene, P: p };
}

/** Visible dark-face mask helper shared with the shader (2D distance <0 = face). */
export function faceOpening(x, y, p = P) {
  const F = p.face;
  const dy = y - F.cy;
  return sdSuperEllipse2(x - F.cx, dy, F.a, F.b, dy >= 0 ? F.nTop : F.nBot);
}
