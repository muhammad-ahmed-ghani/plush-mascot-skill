// Checks of the controller's timing behaviour on the real studio page:
//   - pacing: the live loop draws 55-62 fps (60 at a 60 or 120 Hz display) from the moment working, approval, success and idle are first
//     entered, with no frame over 30 ms (props are compiled and uploaded at load), and the governor leaves the quality alone on a healthy GPU;
//   - leaving 'working' is graceful: the next state waits (mascot.lead), the laptop is packed away, he is on his feet after ~1.2 s, and the
//     headphones have gone; asking for 'working' while working changes nothing; success springs up at once;
//   - poke() moves the head and ears and then lets go.
//   node scripts/dev/motion-check.mjs            (dev server on :4173 by default; exits 1 when a check fails)
import { launch, watchErrors, ORIGIN } from './browser.mjs';

const browser = await launch({ width: 1300, height: 1000, dpr: 2 });
let failed = 0;
const check = (name, ok, detail = '') => { if (!ok) failed++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`); };
try {
  const page = await browser.newPage();
  const logs = watchErrors(page);
  await page.goto(`${ORIGIN}/`, { waitUntil: 'networkidle2', timeout: 120000 });
  await page.waitForFunction('window.mascot && window.mascot.loaded', { timeout: 120000 });
  await page.evaluate(() => window.mascot.renderer.domElement.scrollIntoView({ block: 'center' }));
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));

  // The browser may itself be holding the page to 30 fps (Chrome's Energy Saver below 20% battery, macOS Low Power Mode, a 30 Hz screen):
  // a blank page's rate is the ceiling, so the checks below are against that, and the governor may have taken a step (a GPU on battery
  // clocks down), which is noted.
  const base = await (async () => {
    const blank = await browser.newPage();
    await blank.goto('about:blank');
    const fps = await blank.evaluate(() => new Promise((resolve) => { let n = 0, t0 = 0; const f = (t) => { if (!t0) t0 = t; else n++; if (t - t0 < 2000) requestAnimationFrame(f); else resolve(n / ((t - t0) / 1000)); }; requestAnimationFrame(f); }));
    await blank.close();
    return fps;
  })();
  const throttled = base < 50;
  console.log(`      (a blank page runs at ${base.toFixed(1)} fps here${throttled ? ': the browser is throttled, so the pace is judged against that' : ''})`);
  // pacing, on the live loop, from the moment each state is first entered (so a shader compile or a texture upload on first use would show)
  await wait(2500);
  for (const state of ['working', 'approval', 'success', 'idle']) {
    const r = await page.evaluate((s) => new Promise((resolve) => {
      window.mascot.paused = false; window.mascot.setState(s);
      let n = 0, t0 = 0, worst = 0, last = 0;
      const f = (t) => { if (!t0) { t0 = last = t; } else { n++; worst = Math.max(worst, t - last); last = t; } if (t - t0 < 3000) requestAnimationFrame(f); else resolve({ fps: n / ((t - t0) / 1000), worst, level: window.mascot.perfLevel }); };
      requestAnimationFrame(f);
    }), state);
    const ceiling = Math.min(base, 62), longest = 1000 / ceiling * 1.8;
    check(`${state}: drawn at the display's pace (${ceiling.toFixed(0)} fps), no long frame on entering`, r.fps >= ceiling * 0.92 && r.fps <= ceiling * 1.04 && r.level <= (throttled ? 1 : 0) && r.worst < longest, `${r.fps.toFixed(1)} fps, worst frame ${r.worst.toFixed(1)} ms, quality level ${r.level}`);
  }

  // leaving 'working', stepped deterministically
  const t = await page.evaluate(() => {
    const w = window.mascot, step = (s) => { for (let i = 0; i < Math.round(s * 60); i++) w.advance(1 / 60, { render: false }); };
    w.paused = true;
    w.setState('idle'); step(2);
    w.setState('working'); step(5);
    const seated = { y: w.cur['root.y'], laptop: w.cur['p.laptop'], phones: w.cur['p.phones'] };
    const elapsed = w.elapsed; w.setState('working');                       // asking again must not restart it
    const again = { same: w.elapsed === elapsed, dismount: w.dismount === null };
    w.setState('idle');
    const lead = w.lead; step(0.4);
    const early = { y: w.cur['root.y'], laptop: w.cur['p.laptop'] };
    step(1.0);
    const late = { y: w.cur['root.y'], laptop: w.cur['p.laptop'], phones: w.cur['p.phones'], sit: w.cur['p.sit'] };
    w.setState('working'); step(4);
    w.setState('success'); const leadSuccess = w.lead; step(0.6);
    const hop = w.cur['root.y'];
    return { seated, again, lead, early, late, leadSuccess, hop };
  });
  check('seated: body low, laptop out, headphones on', t.seated.y < -0.15 && t.seated.laptop > 0.95 && t.seated.phones > 0.95, `root ${t.seated.y.toFixed(2)}, laptop ${t.seated.laptop.toFixed(2)}, phones ${t.seated.phones.toFixed(2)}`);
  check('asking for working while working changes nothing', t.again.same && t.again.dismount);
  check('leaving working: the next state waits for the seat to be put away', Math.abs(t.lead - 1.1) < 0.01, `mascot.lead ${t.lead.toFixed(2)} s`);
  check('0.4 s in: still getting up, laptop closing', t.early.y < -0.1 && t.early.laptop < 0.7, `root ${t.early.y.toFixed(2)}, laptop ${t.early.laptop.toFixed(2)}`);
  check('1.4 s in: on his feet, laptop and headphones gone', t.late.y > -0.04 && t.late.laptop < 0.01 && t.late.phones < 0.01 && t.late.sit < 0.05, `root ${t.late.y.toFixed(2)}, laptop ${t.late.laptop.toFixed(3)}, phones ${t.late.phones.toFixed(3)}`);
  check('success springs up from the seat at once', t.leadSuccess < 0.2 && t.hop > 0.05, `lead ${t.leadSuccess.toFixed(2)} s, root ${t.hop.toFixed(2)} 0.6 s in`);

  // poke
  const p = await page.evaluate(() => {
    const w = window.mascot, step = (s) => { for (let i = 0; i < Math.round(s * 60); i++) w.advance(1 / 60, { render: false }); };
    w.setState('idle'); step(2.5);
    const before = w.cur['head.x'];
    w.poke(); step(0.15);
    const during = w.cur['head.x']; const blink = w.blink.t >= 0;
    step(2.5);
    return { before, during, after: w.cur['head.x'], blink };
  });
  check('poke: a nod and a blink, then he settles', p.during - p.before > 0.04 && p.blink && Math.abs(p.after - p.before) < 0.02, `head.x ${p.before.toFixed(3)} -> ${p.during.toFixed(3)} -> ${p.after.toFixed(3)}`);
  if (logs.length) console.log(logs.join('\n'));
} finally {
  await browser.close();
}
process.exit(failed ? 1 : 0);
