# mascot.config.json

| Key | Meaning | Read by |
|---|---|---|
| `character.name`, `slug`, `product`, `tagline` | page copy tokens (`{name}`, `{product}`, `{tagline}`), docs | `vite.config.js`, `src/page/copy.js` |
| `palette.*` | page colours (CSS variables) and the art-QA palette report. The 3D material colours are fitted from the art by the tuner, not read from here | page, `art_qa.py --palette` |
| `frame` | registration frame of the canonical neutral art: `size` 1254 px, `ppu` 350 px per unit, `axisX` 627.5, `feetY` 1204, `topY` 47 (written by `normalize_art.py --write-config`) | `src/`, `scripts/lib`, tools |
| `art.*` | paths of hero, registered front, turnaround, use-case sheet, masters folder | pipeline, tools |
| `nap.*`, `mesh.*`, `face.maps.*` | paths of the derived tiles, meshes and face maps | `src/`, `scripts/nap`, `scripts/bake` |
| `page.*` | title, description, icon, touch icon, emblem (laptop lid), poster, prints, accent colours, fonts | `index.html` tokens, `src/props` |
| `segmentation.*` | reserved for colour rules of the nap pools and silhouette extraction; the scripts still contain the example's rules (see the skill's `references/art-analysis.md`, section 9) | documentation |

The registration frame is a contract: every stored number (silhouette targets, feature outlines, seams, nap texel density, evaluator patches, poster placement) is in units on this frame. Keep the frame and move the art into it with `scripts/tools/normalize_art.py`.
