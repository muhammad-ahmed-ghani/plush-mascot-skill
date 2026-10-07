// Props that clarify what Mascot is doing, drawn from the use-case artwork (assets/mascot-use-cases.png):
//   working  -> charcoal over-ear headphones + a small open charcoal laptop
//   approval -> a cream decision card with one charcoal check
//   success  -> exactly three confetti pieces: two body streamers and a gold disc
// Each prop is its own module under ./props/; this file assembles them and fans the per-frame state out.
import * as THREE from 'three';
import { buildHeadphones } from './props/headphones.js';
import { buildLaptop } from './props/laptop.js';
import { buildCard } from './props/card.js';
import { buildConfetti } from './props/confetti.js';

export function buildProps({ emblem = null } = {}) {
  const root = new THREE.Group();
  root.name = 'Props';
  const headphones = buildHeadphones();       // authored in the head's rest space; the controller parents it to the head bone
  const laptop = buildLaptop(emblem);
  const card = buildCard();
  const confetti = buildConfetti();
  root.add(laptop.group, card.group, confetti.group);
  const parts = [headphones, laptop, card, confetti];

  return {
    root, phones: headphones.group, laptop: laptop.group, card: card.group, confetti: confetti.group,
    /**
     * Per-frame state from the pose.  Every part reads what it needs and ignores the rest.
     * @param {object} o
     * @param {number} o.time        continuous clock (s)
     * @param {number} o.phones      0..1 headphones on
     * @param {number} o.laptop      0..1 laptop present / open
     * @param {number} o.card        0..1 decision card raised
     * @param {number} o.confettiT   seconds since success began, or < 0 for none
     * @param {number} o.hop         root height (confetti drifts with it)
     * @param {number} o.typeL       left-hand typing signal (-1..1, same phase as the arm)
     * @param {number} o.typeR       right-hand typing signal
     * @param {THREE.Vector3} [o.hand] world (rig-root) position of the raised hand that holds the card
     */
    update(o) { for (const p of parts) p.update(o); },
  };
}
