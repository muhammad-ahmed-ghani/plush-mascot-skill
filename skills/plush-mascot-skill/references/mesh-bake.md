# Mesh bake: from the field to a mesh the browser loads in milliseconds

Purpose: how the SDF becomes a watertight, skinned, pre-lit mesh with the data the shader needs, how to check it and how the binary is laid out. Read it in phase 5 and whenever a render shows cracks, dark arms or missing seams.

## Contents
1. Pipeline and timings
2. Meshing
3. Local refinement along the face-plate edge
4. Skeleton and skin weights
5. Baked attributes
6. Binary format
7. Quality tiers
8. The mesh check
9. Traps

## 1. Pipeline and timings
`node scripts/bake/bake.mjs --quality draft|lite|final [--out assets/mascot-mesh.bin]`. Per part (head, body, armL, armR) it meshes the field, refines, skins, computes occlusion and curvature and the seam field, and packs everything into one binary. On an Apple silicon laptop the draft takes under a second, lite and final a few seconds. The bake is deterministic: two runs give byte-identical files, which makes a rebake that changes bytes without an input change a regression signal. After baking run `node scripts/bake/check-mesh.mjs` and `node scripts/sync-public.mjs` (the dev server serves `public/` before the project root).

## 2. Meshing
Surface nets on a grid (cell sizes in section 7). Each vertex is projected onto the exact surface and gets the analytic normal of the field. Triangle winding comes from the grid topology (the sign change of the edge crossing), never from a test against the vertex normal, and no triangle is dropped except index-degenerate ones: an earlier mesher dropped sliver triangles and tested winding with vertex normals, which left hundreds of cracks that showed as white specks along the plate edge when the head turned.

## 3. Local refinement along the face-plate edge
`scripts/bake/refine.mjs` splits every head triangle within a distance of the plate outline once more (red-green refinement) and projects the new vertices back onto the field, so the rolled edge stays smooth at any yaw (distance 0.1 units for final, 0.07 for lite, none for draft).

## 4. Skeleton and skin weights
`skeleton.mjs` defines 17 joints and the skinners; the pose code drives them by name (`references/rig-and-animation.md`), so keep the names when you change proportions. Weights are distance-based with smooth falloff; the arm has elbow and wrist bones so a pose can stretch the arm (`arm.s`) without distorting the hand.

## 5. Baked attributes
| Attribute | What | Why baked |
|---|---|---|
| `ao` (Uint8) | ambient occlusion of the LARGE form: hemisphere rays (24/40/56 by tier, radius 0.5, cosine weighted) using the plain field's normals, without hood tuck or folds; arms occluded only by the rigid head and torso | creases and folds are drawn by the shader; occluding against swinging arms made them dark |
| `curv` (Int8) | curvature of the large form | lifts ridges, darkens folds |
| `seam`, `seamDir` | signed distance to the picked construction seams and the direction across them | the shader draws the groove from them |

Compute AO from the plain block (`face.hem` and `tuck` set to 0) so the occlusion does not follow the stepped edge.

## 6. Binary format
Bytes 0 to 3 magic `MSCT`; 4 to 7 version (u32 little-endian, 2); 8 to 11 header length (u32); then a JSON header (format, version, quality, `seamR`, and per part the vertex and index counts and the offset and type of every array: positions, normals, skin indices and weights, `ao`, `curv`, `seam`, `seamDir`, indices); then the packed arrays. `src/mascot-mesh.js` reads it; to add an attribute add it to the bake's writer, to the header, to the reader and to the shader's attribute list. The format string is checked on load.

## 7. Quality tiers
| Tier | Grid (head / body / arm) | AO rays | Refine | Triangles (example) | Size | Use |
|---|---|---|---|---|---|---|
| draft | 0.034 / 0.034 / 0.030 | 24 | none | 59k | 1.9 MB | iteration |
| lite | 0.030 / 0.031 / 0.027 | 40 | 0.07 | 83k | 2.7 MB | phones, medium and low tiers |
| final | 0.021 / 0.023 / 0.019 | 56 | 0.1 | 171k (head 111k) | 5.6 MB | high tier |

## 8. The mesh check
`check-mesh.mjs` counts how many triangles use each edge of every part. Pass: 0 open edges (a crack) and 0 degenerate triangles on every part of both tiers. A few non-manifold edges are a known trait of surface nets (example: 2 on the head) and invisible; the script exits 1 for them too, so read the counts, not the exit code.

## 9. Traps
| Symptom | Cause | Fix | Verify |
|---|---|---|---|
| White specks along the plate edge when turned | open edges | winding from topology, keep slivers | open edges 0 |
| Arms go dark when they swing out | AO against the arms | occlude arms only by head and torso | arms keep their colour in `?dbg=3` |
| Seams missing in the render | no pick in `seams.mjs`, or `SEAM_RANGE` in the shader differs from `SEAM_MAX` | pick seams; keep both 0.16 | seam groove visible |
| Page still shows the old mesh | stale `public/` | `node scripts/sync-public.mjs` | served size equals the file |
| Loader rejects the file | magic or version mismatch | rebake with the matching scripts | header reads `MSCT` 2 |
| Gap between head and body | parts meshed separately and the neck blend too small | raise the blend or overlap in `model.mjs` | no light leak at yaw 0.9 |
