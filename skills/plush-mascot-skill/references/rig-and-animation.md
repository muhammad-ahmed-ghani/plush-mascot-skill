# Rig, poses and states

Purpose: how the mascot is driven: pose keys, easing and springs, the ten states as a motion contract, arm stretch, staged exits, determinism, and how to add a state or retune poses for new proportions. Read it in phase 8 and when a hand merges into the head, a prop pops, or a state restarts.

## 1. Pose keys and how they are eased
`computePose(state, t, ...)` in `src/mascot-pose.js` returns target values for the skeleton (`root.*`, `head.*`, `torso`, `arm{L,R}.*`, legs), the face (`f.*`: lids, mouth, gaze, tilt, sleep) and the props (`p.*`: phones, laptop, card, sit). The controller (`src/mascot.js`) eases each key toward its target each frame: face, prop and lift keys use exponential interpolation (`RATE`, default 11 per second, with per-key rates such as `f.lt` 24, `f.mo` 42, `p.laptop` 5 up and 8 down), while body keys (arms, head, torso, root rotations) follow slightly under-damped springs (`SPRINGS`, about omega 13 and zeta 0.74): a gesture overshoots a little and settles the way a body with weight does. Blinks are seeded and asymmetric: lids fall in 80 ms (accelerating), stay shut 35 ms, open over 190 ms with a soft landing; blinks come every 2.4 to 6 s, sometimes doubled, often right after a state change; glances (small and large saccades) every 0.7 to 3.3 s while awake. Success is anticipated by a small crouch before the hop. Why springs and per-key rates: a plush body should lag its target and overshoot slightly, the face should react faster than the body, props should arrive on their own schedule.

## 2. Arms: aim vectors and stretch
Arms are authored by aiming the upper arm, forearm and hand at target points (`aimArms` in `src/mascot-rig.js`), not by Euler angles: for short mitten limbs, a target position is what the animator thinks in and it keeps the hand clear of the head across proportions. The sculpt's arms are too short to lift a hand clear of a wide hood (example: hood half-width 1.13, hand ball 0.22, reach 0.49) and the art's raised arms are about twice as long, so poses carry `arm{L,R}.s` (0 as sculpted, 1 twice as long): the elbow and wrist bones are lengthened and the arm fabric squeezes its nap coordinate along the arm by the same amount (`uArmSpan`, `references/felt-shader.md` 5.11) so fibres keep their size.

## 3. The ten states (motion contract)
| State | Trigger in a real application | Performance | Exit |
|---|---|---|---|
| idle | nothing active | slow breath, occasional blink | loop |
| greeting | first arrival | one wave: arm out to the side, stretched, forearm swing | 2.4 s, then idle |
| listening | input capture is actually active | lean in, attentive tilt | hold while active |
| thinking | planning event | upward glance, hand near chin | 3.6 s variation |
| working | a tool or job is running | sits down (squash, kick, fall back), headphones pop on, laptop slides in and opens, seeded typing bursts | about 2.5 s to settle; leaving takes 1.1 s |
| approval | a decision is requested | head turns toward a card held out on one long arm, other hand open | hold until decided |
| success | completion confirmed | one hop, both arms up in a V, three confetti pieces | 2.4 s, then idle |
| error | recoverable failure | concerned tilt, small downward mouth | hold with an explanation |
| speaking | audio is actually playing | gentle gesture, mouth driven by `setVoiceLevel(0..1)` | stop with playback |
| resting | intentionally dormant | closed eyes, settled pose, 4 s breath | until woken |

The controller never decides whether work succeeded: drive states from application events, error and approval over working and thinking. Never auto-approve on a timer; keep a text status and a button next to the character; do not encode status by colour alone.

## 4. Staged exits and `lead`
Leaving `working` is a staged dismount (about 1.1 s: typing stops, lid closes, headphones lift off, he stands with a lean; a celebration springs up from the seat almost at once). `setState` returns immediately but the new state's own motion starts `mascot.lead` seconds later; read `lead` right after `setState` and add it to any timer tied to that state's animation (the page's auto-return of greeting and success does). `setState('working')` while working does nothing (a repeat must not restart the sit-down). Pages should not leave `working` sooner than 1.6 s after it began.

## 5. Determinism, reduced motion, poke
`mascot.paused = true; mascot.advance(1/60, { render: false })` steps the clock; `freeze(state, seconds, { time, override, look, blink })` poses exactly (applies the pose twice, because the seat changes the skeleton after the card's hand is measured). Reduced motion (`setReducedMotion(true)`) removes autonomous pose motion; pointer response stays. `poke()` plays a small reaction on top of any state (startled blink, hop and nod, ear flick, bigger smile; nothing under reduced motion).

## 6. Motion principles from the complaints
| Complaint | Cause | Fix | Guard |
|---|---|---|---|
| Hand merged into the head or face in the wave | arm too short for a wide hood | stretch + wave as a forearm swing out to the side | `clearance.mjs` >= 0.04 |
| The decision card blended into the face | card too small and too close | larger card on one long arm, head turned toward it | clearance, card included |
| A flat closed laptop slid in | closed slab on the floor | it tips onto its edge and opens as it arrives | filmstrip of the entrance |
| Abrupt stand-up, headphones flew out of frame | no staging | dismount stages and `lead`; headphones lift a hand's breadth | `motion-check.mjs` |
| Pops after random transitions | keys snapping | easing for every key; random-sequence stress | no jump over limits |

## 7. Recipes
**New state.** Add it to `STATES` in `src/mascot-states.js` (label, title, status, description, duration), a case in `computePose`, any new keys with a rate, a copy line, then `clearance.mjs`, `motion-check.mjs`, the stress script and a stepped filmstrip. **New proportions.** Keep joint names; retune targets (look at the art's pose sheet if you have one), then re-measure the stretch each raised hand needs and run `clearance.mjs`.

## 8. Checks
`node scripts/dev/clearance.mjs` (hands and card against the head, every state, 7 pointer positions, 60 fps; fail under 0.04 units), `node scripts/dev/motion-check.mjs`, the stress script in `references/validation-gates.md` 4.13, and filmstrips of every transition.
