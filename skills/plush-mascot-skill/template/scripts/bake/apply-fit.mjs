// Rewrite the P table in model.mjs from a fit.result.json (dev helper).
//   node scripts/bake/apply-fit.mjs [scripts/bake/fit.result.json]
import { readFileSync, writeFileSync } from 'node:fs';
import { cloneParams } from './model.mjs';

const fitPath = process.argv[2] ?? new URL('./fit.result.json', import.meta.url).pathname;
const p = cloneParams(JSON.parse(readFileSync(fitPath, 'utf8')));
const n = (v) => +(+v).toFixed(3);
const arr = (a) => `[${a.map(n).join(', ')}]`;
const block = `export const P = {
  head: {
    cy: ${n(p.head.cy)},                // centre height
    hw: ${n(p.head.hw)}, hh: ${n(p.head.hh)}, hd: ${n(p.head.hd)},   // half extents
    n: ${n(p.head.n)},                 // squircle exponent of the front view (2 = ellipse, larger = squarer)
    m: ${n(p.head.m)},                 // exponent of the depth profile (2 = elliptical)
    mF: ${n(p.head.mF ?? p.head.m)},                // ... in front of the centre plane (larger = a flatter, squarer face)
    taperX: ${n(p.head.taperX)},           // the top is narrower than the bottom
    taperZ: ${n(p.head.taperZ)},
    cz: ${n(p.head.cz)},                  // head depth offset (+ = forward)
    jowl: ${n(p.head.jowl)},             // fuller lower cheeks (widens the head below the centre line)
  },
  face: {
    cx: ${n(p.face.cx)}, cy: ${n(p.face.cy)},     // contour centre
    a: ${n(p.face.a)}, b: ${n(p.face.b)},     // half axes of the visible dark plate
    nTop: ${n(p.face.nTop)}, nBot: ${n(p.face.nBot)},   // squircle exponents above / below the centre line
    hem: ${n(p.face.hem)},                // depth of the crevice below the hood surface
    hemW: ${n(p.face.hemW)},              // how far the hood's rounded edge reaches
    plateW: ${n(p.face.plateW)},            // how far the plate's rim reaches into the crevice
    tuck: ${n(p.face.tuck)},              // how much lower the plate sits than the hood at their edge
    tuckW: ${n(p.face.tuckW)},               // ... falling to nothing this far inside
  },
  ear: {
    x: ${n(p.ear.x)}, y: ${n(p.ear.y)}, z: ${n(p.ear.z)},
    hx: ${n(p.ear.hx)}, hy: ${n(p.ear.hy)}, hz: ${n(p.ear.hz)}, r: ${n(p.ear.r)},
    tilt: ${n(p.ear.tilt)},             // radians; positive leans the tip outward
    blend: ${n(p.ear.blend)},
  },
  torso: {
    belly: { c: ${arr(p.torso.belly.c)}, r: ${arr(p.torso.belly.r)} },
    chest: { c: ${arr(p.torso.chest.c)}, r: ${arr(p.torso.chest.r)} },
    blend: ${n(p.torso.blend)},
  },
  leg: {
    hip: ${arr(p.leg.hip)}, hipR: ${n(p.leg.hipR)},
    ankle: ${arr(p.leg.ankle)}, ankleR: ${n(p.leg.ankleR)},
    foot: { c: ${arr(p.leg.foot.c)}, r: ${arr(p.leg.foot.r)}, yaw: ${n(p.leg.foot.yaw)} },
    blend: ${n(p.leg.blend)},
    gap: ${n(p.leg.gap)},
    arch: { w: ${n(p.leg.arch.w)}, h: ${n(p.leg.arch.h)} },   // the arched gap between the legs
  },
  arm: {
    shoulder: ${arr(p.arm.shoulder)}, shoulderR: ${n(p.arm.shoulderR)},
    elbow: ${arr(p.arm.elbow)}, elbowR: ${n(p.arm.elbowR)},
    hand: ${arr(p.arm.hand)}, handR: ${n(p.arm.handR)},
  },
};`;
const modelPath = new URL('./model.mjs', import.meta.url);
const src = readFileSync(modelPath, 'utf8');
const start = src.indexOf('export const P = {');
const end = src.indexOf('\n};', start) + 3;
writeFileSync(modelPath, src.slice(0, start) + block + src.slice(end));
console.log('P updated from', fitPath);
