// Seated proportions for the working state (see SEAT in src/mascot-pose.js).  The artwork's seated Mascot has a much shorter torso and
// longer arms than the standing sculpt, which is what lets its hands reach a laptop on the floor, and a plush sitting on the floor
// squashes its bottom and legs against it.  While Mascot is seated this
//   * drops the spine joint (SEAT.settle): the lower torso slumps onto its bottom (linear-blend skinning compresses the belly
//     band between the hip and spine joints);
//   * flattens the leg bones along their rest front-back axis (SEAT.flatten), which the forward leg swing turns vertical: the
//     bottom, which is weighted to the legs and swings under the hip joints with them, and the tall soles come up to the floor
//     instead of through it.  This follows how far forward the legs actually are (so standing up, the feet regain their length
//     only as they come back under him, and never dig through the floor), while seated or while the laptop is still out;
//   * as the laptop opens (reachAmount), brings the shoulder joints forward and a little down (SEAT.reach, chest frame; the arm
//     tubes' roots stay buried in the chest).  (The arms themselves lengthen through the pose, `arm{L,R}.s`: see SEAT.stretch.)
// The torso follows seatAmount(root height), which the working pose also uses for its IK, through a light spring: the torso squashes
// a touch more as the bottom lands and stretches up a touch as he springs back to his feet.  (A still, or any jump in time, snaps
// it, so frozen frames are exact.)  Everything is restored as Mascot stands up; other states never reach the thresholds (their roots
// stay above -0.05 and they have no laptop), so they are untouched.
import { SEAT, seatAmount, reachAmount } from '../mascot-pose.js';

const LEG_BONES = ['hipL', 'hipR'], SHOULDERS = ['shoulderL', 'shoulderR'];
const smooth01 = (x) => { const t = Math.min(1, Math.max(0, x)); return t * t * (3 - 2 * t); };

export function createSeat() {
  let root = null, bones = null, amt = null, vel = 0;
  const last = { a: -1, arm: -1, settle: 0, ry: 0, rz: 0 };
  const find = (from) => {
    let n = from.parent;
    while (n && n.name !== 'Mascot') n = n.parent;
    if (!n) return false;
    const pick = (name) => { const b = n.getObjectByName(name); if (b && !b.userData.restPos) b.userData.restPos = b.position.clone(); return b; };
    bones = { spine: pick('spine'), hips: pick('hips'), legs: LEG_BONES.map(pick).filter(Boolean), shoulders: SHOULDERS.map(pick).filter(Boolean) };
    root = n;
    return true;
  };
  return {
    get root() { return root; },
    /**
     * @param {THREE.Object3D} owner any object under the rig  @param {number} rootY the root height this frame
     * @param {number} laptop the laptop's presence (0..1)  @param {number} dt seconds since the last frame (0 = a still)
     */
    update(owner, rootY, laptop = 0, dt = 0) {
      if (!root && !find(owner)) return 0;
      const target = seatAmount(rootY);
      if (amt === null || !(dt > 0) || dt > 0.051) { amt = target; vel = 0; }
      else {
        const n = Math.ceil(dt * 120), h = dt / n, w = 15, z = 0.5;
        for (let i = 0; i < n; i++) { vel += (w * w * (target - amt) - 2 * z * w * vel) * h; amt += vel * h; }
        if (Math.abs(amt - target) < 1e-4 && Math.abs(vel) < 1e-3) { amt = target; vel = 0; }
      }
      const a = Math.min(1, Math.max(0, amt)), torso = Math.min(1.1, Math.max(-0.12, amt));
      const { spine, hips, legs, shoulders } = bones;
      // how far forward the legs are (0 hanging, 1 at the seated pitch), and whether flattening them is in play at all
      const gate = Math.max(target, Math.min(1, laptop * 4));
      for (const b of legs) b.scale.set(1, 1, 1 - SEAT.flatten * gate * smooth01(-(b.rotation.x + (hips ? hips.rotation.x : 0)) / 1.25));
      const [rx, ry, rz] = SEAT.reach;
      const arm = reachAmount(laptop);
      if (torso === last.a && arm === last.arm && SEAT.settle === last.settle && ry === last.ry && rz === last.rz) return a;
      last.a = torso; last.arm = arm; last.settle = SEAT.settle; last.ry = ry; last.rz = rz;
      shoulders.forEach((b, i) => { b.position.copy(b.userData.restPos); b.position.x += (i ? -rx : rx) * arm; b.position.y += ry * arm; b.position.z += rz * arm; });
      if (spine) { spine.position.copy(spine.userData.restPos); spine.position.y -= SEAT.settle * torso; }
      return a;
    },
  };
}
