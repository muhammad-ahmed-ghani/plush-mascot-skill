// Do the hands and the decision card keep clear of the head?  Steps the real controller through every state at 60 fps, for several pointer
// positions (the head turns with the pointer), and measures the closest approach of each hand's vertices and of the card's vertices to the
// head's vertices (units: the character is 3.3 tall; the fuzz layers reach ~0.01, a hand ball is ~0.22 across).  A pose that pushes a hand
// or the card into the hood or the face plate reads as them merging, so anything under --min fails.
//   node scripts/dev/clearance.mjs [--states greeting,approval,success] [--looks 7|3] [--fps 60] [--min 0.04]     (dev server on :4173 by default)
import { launch, watchErrors, ORIGIN } from './browser.mjs';

const args = Object.fromEntries(process.argv.slice(2).reduce((a, v, i, all) => (v.startsWith('--') ? [...a, [v.slice(2), all[i + 1] ?? true]] : a), []));
const DURATION = { idle: 2, greeting: 2.4, listening: 3, thinking: 3.6, working: 7, approval: 3.5, success: 3.6, error: 3, speaking: 3, resting: 3 };
const states = args.states ? String(args.states).split(',') : Object.keys(DURATION);
const fps = +(args.fps ?? 60), min = +(args.min ?? 0.04);
const looks = String(args.looks ?? '7') === '3' ? [[0, 0], [1, 0], [-1, 0]] : [[0, 0], [1, 0], [-1, 0], [1, 1], [-1, 1], [1, -1], [0, 1]];

const browser = await launch({ width: 1300, height: 900, dpr: 1 });
let failed = 0;
try {
  const page = await browser.newPage();
  const logs = watchErrors(page);
  await page.goto(`${ORIGIN}/`, { waitUntil: 'networkidle2', timeout: 120000 });
  await page.waitForFunction('window.mascot && window.mascot.loaded', { timeout: 120000 });
  const rows = await page.evaluate((states, DURATION, looks, fps) => {
    const w = window.mascot; w.paused = true;
    const V3 = w.rig.root.position.constructor, head = w.rig.meshes.head;
    const handOf = (arm) => {
      const limb = w.rig.meshes[arm], wrist = w.rig.byName[arm === 'armL' ? 'wristL' : 'wristR'], wi = w.rig.skeleton.bones.indexOf(wrist);
      const si = limb.geometry.attributes.skinIndex, sw = limb.geometry.attributes.skinWeight, idx = [];
      for (let i = 0; i < si.count; i++) { let t = 0; for (let k = 0; k < 4; k++) if (si.getComponent(i, k) === wi) t += sw.getComponent(i, k); if (t > 0.6) idx.push(i); }
      return { limb, idx, pts: idx.map(() => new V3()) };
    };
    const hands = { armL: handOf('armL'), armR: handOf('armR') };
    const headIdx = []; for (let i = 0; i < head.geometry.attributes.position.count; i += 3) headIdx.push(i);
    const hp = headIdx.map(() => new V3());
    const cardMeshes = []; w.props.card.traverse((o) => { if (o.isMesh) cardMeshes.push(o); });
    const cardSrc = [], cp = [];
    for (const m of cardMeshes) for (let i = 0; i < m.geometry.attributes.position.count; i += 2) { cardSrc.push([m, i]); cp.push(new V3()); }
    // only head points inside the box around A (grown by `pad`) can be nearer than `pad`
    const dist = (A, B, pad = 0.5) => {
      let x0 = 1e9, y0 = 1e9, z0 = 1e9, x1 = -1e9, y1 = -1e9, z1 = -1e9;
      for (const a of A) { x0 = Math.min(x0, a.x); y0 = Math.min(y0, a.y); z0 = Math.min(z0, a.z); x1 = Math.max(x1, a.x); y1 = Math.max(y1, a.y); z1 = Math.max(z1, a.z); }
      const near = B.filter((b) => b.x > x0 - pad && b.x < x1 + pad && b.y > y0 - pad && b.y < y1 + pad && b.z > z0 - pad && b.z < z1 + pad);
      let m = 1e9; for (const a of A) for (const b of near) { const d = a.distanceToSquared(b); if (d < m) m = d; }
      return Math.sqrt(m);
    };
    const out = [];
    for (const state of states) {
      const worst = { armL: { d: 9 }, armR: { d: 9 }, card: { d: 9 } };
      for (const [lx, ly] of looks) {
        w.look.x = lx; w.look.y = ly; w._look.x = lx; w._look.y = ly;
        w.setState('idle'); for (let i = 0; i < 120; i++) w.advance(1 / 60, { render: false });
        w.setState(state);
        for (let f = 0, N = Math.round(DURATION[state] * fps); f < N; f++) {
          w.advance(1 / fps);
          if (f % 2) continue;
          w.rig.root.updateMatrixWorld(true);
          headIdx.forEach((i, k) => { head.getVertexPosition(i, hp[k]).applyMatrix4(head.matrixWorld); });
          for (const arm of ['armL', 'armR']) {
            const H = hands[arm];
            H.idx.forEach((i, k) => { H.limb.getVertexPosition(i, H.pts[k]).applyMatrix4(H.limb.matrixWorld); });
            const d = dist(H.pts, hp); if (d < worst[arm].d) worst[arm] = { d, t: f / fps, look: [lx, ly] };
          }
          if (w.props.card.visible) {
            cardSrc.forEach(([m, i], k) => { cp[k].fromBufferAttribute(m.geometry.attributes.position, i).applyMatrix4(m.matrixWorld); });
            const d = dist(cp, hp); if (d < worst.card.d) worst.card = { d, t: f / fps, look: [lx, ly] };
          }
        }
      }
      out.push({ state, worst });
    }
    return out;
  }, states, DURATION, looks, fps);
  for (const { state, worst } of rows) {
    const cells = ['armL', 'armR', 'card'].filter((k) => worst[k].d < 9);
    const bad = cells.filter((k) => worst[k].d < min);
    if (bad.length) failed++;
    console.log(`${bad.length ? 'FAIL' : 'PASS'}  ${state.padEnd(10)}` + cells.map((k) => `${k} ${worst[k].d.toFixed(3)} (t ${worst[k].t.toFixed(2)} s, look ${worst[k].look})`).join('   '));
  }
  if (logs.length) console.log(logs.join('\n'));
} finally {
  await browser.close();
}
process.exit(failed ? 1 : 0);
