# Props: headphones, laptop, decision card, confetti

Purpose: how the props are modelled, choreographed and validated, and how to add one. Read it in phase 8.

## 1. Principles
Props are modelled from the art's vignettes (`assets/mascot-use-cases.png`), at the mascot's scale, in plain materials without brand marks (the laptop lid carries the configurable emblem `assets/emblem.svg`, `mascot.config.json` `page.emblem`). Soft things (headphone band, cups) use the face fabric; hard things (laptop) use matte anodised-looking materials. Each prop is a module in `src/props/`; `src/mascot-props.js` assembles them and fans the per-frame pose state out.

## 2. The four props
| Prop | Construction | Choreography |
|---|---|---|
| Headphones (`headphones.js`, `hp-geometry.js`) | padded felt band over the crown, deep rounded cups with a graphite trim ring, authored in the head's rest space | pop on a hand's breadth above the head as he lands, lift off when he stands, never leave the frame |
| Laptop (`laptop.js`, `lp-geometry.js`, `lp-keyboard.js`, `lp-textures.js`, `lp-seat.js`) | slim unibody on rubber feet, chamfered edges, recessed keyboard of individual keycaps with legends, trackpad, grilles, ports, hinge barrel, thin lid with an embossed emblem and a screen that wakes to a small UI | slides in a short way, tips onto its edge and opens as it arrives (never a flat slab); the key under each hand ball goes down on a strike; each keystroke adds a character on the screen |
| Decision card (`card.js`) | cream card with one check mark | held out beside the face by one long arm while the head turns toward it |
| Confetti (`confetti.js`) | exactly three pieces (two streamers, one disc) | drift with the hop |

The seated pose needs different proportions (shorter torso, longer arms, flattened legs): `lp-seat.js` applies them to the skeleton while the laptop is out and restores them on standing. The exported GLB carries the bone rotations and the elbow and wrist positions but none of the seat settling or the props.

## 3. Performance
All props' programs, textures and buffers are compiled and uploaded at load (`warm` in the controller), so the first entry into `working` never drops a frame (the first Working once cost a 67 ms frame). Procedural textures (legends, screen UI, emblem, blasted grain) are generated once.

## 4. Add a prop
1. Model it from the art (crop and upscale the vignette 3 to 4x; match proportions, how it attaches to a hand).
2. A module with `buildX()` returning `{ group, update(o) }`; read what you need from the per-frame object (`phones laptop card confettiT hop typeL typeR hand`), add keys to the pose with rates.
3. Materials: reuse the studio lights; no hollow shells, no z-fighting, correct thickness from every side (the page lets people turn the mascot round).
4. Add to `buildProps`, to the warm-up, and to `clearance.mjs`'s measured set if it can come near the head.
5. Filmstrip its entrance and exit at 60 fps.
