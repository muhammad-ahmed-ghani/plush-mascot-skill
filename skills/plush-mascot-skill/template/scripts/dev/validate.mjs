// Functional check of the page in a real browser: the page's rules (no arrows, no em dashes, no spaced caps, real icon, self-hosted fonts,
// nothing third-party), the stage, the ten states in the workbench, the scroll story (each scene's state and camera after a jump scroll,
// on a desktop and on a phone), the approval demo, poking Mascot, reduced motion (the switch and the OS setting), the activity dialog, the
// exports, keyboard access, the no-WebGL fallback and the phone layout.
//   MASCOT_ORIGIN=http://127.0.0.1:4174 node scripts/dev/validate.mjs        (default origin: the dev server on :4173)
// The contrast of every word on every colour of the room, and whether any word ever sits on Mascot, is measured by scripts/dev/contrast.mjs.
import { launch, watchErrors, ORIGIN } from './browser.mjs';

const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  (' + detail + ')' : ''}`); };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const PHONE_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';

// the scene ids in order, and the state(s) Mascot may be in once the scene has held for a moment (greeting and success settle back to idle)
const SCENES = [['hello', ['greeting', 'idle']], ['motion', ['listening']], ['thinking', ['thinking']], ['working', ['working']], ['approval', ['approval']], ['done', ['success', 'idle']], ['closer', ['idle']], ['goodnight', ['resting']]];

const browser = await launch({ width: 1300, height: 1000, dpr: 1 });
try {
  // ======================================================================================================== desktop
  const page = await browser.newPage();
  const logs = watchErrors(page);
  const requests = [], failed = [];
  page.on('request', (r) => requests.push(r.url()));
  page.on('requestfailed', (r) => failed.push(`${r.url()} ${r.failure()?.errorText}`));
  page.on('response', (r) => { if (r.status() >= 400 && !/favicon/.test(r.url())) failed.push(`${r.status()} ${r.url()}`); });
  await page.goto(`${ORIGIN}/`, { waitUntil: 'networkidle2', timeout: 120000 });
  await page.waitForFunction('window.mascot && window.mascot.loaded', { timeout: 120000 });
  await wait(1200);

  const STATES = await page.evaluate(() => window.MASCOT_STATES);
  const jump = (id, extra = 0) => page.evaluate((id, extra) => { const el = document.getElementById(id); scrollTo({ top: el.getBoundingClientRect().top + scrollY + extra, behavior: 'instant' }); }, id, extra);
  const stateNow = () => page.evaluate(() => window.mascot.state);
  const fingerprint = () => page.evaluate(() => {
    const r = window.mascot.rig.byName, q = (n) => r[n].quaternion.toArray().map((v) => +v.toFixed(3)).join(',');
    return `${q('head')}|${q('armL' in r ? 'armL' : 'chest')}|${window.mascot.rig.root.position.y.toFixed(3)}`;
  });

  // ---- what the page is -----------------------------------------------------------------------------------------------
  const meta = await page.evaluate(() => ({
    lang: document.documentElement.lang, title: document.title,
    description: document.querySelector('meta[name="description"]')?.content ?? '', ogImage: document.querySelector('meta[property="og:image"]')?.content ?? '', theme: document.querySelector('meta[name="theme-color"]')?.content ?? '',
    icon: document.querySelector('link[rel="icon"]')?.getAttribute('href') + '|' + document.querySelector('link[rel="icon"]')?.type, touch: document.querySelector('link[rel="apple-touch-icon"]')?.getAttribute('href'),
    brandImg: document.querySelector('.brand img')?.getAttribute('src'), landmarks: ['header', 'main', 'footer'].every((t) => document.querySelector(t)), skip: document.querySelector('a.skip')?.getAttribute('href'),
  }));
  check('document has lang, title, description, og:image and theme-color', Boolean(meta.lang && meta.title && meta.description.length > 40 && /mascot-hero\.png$/.test(meta.ogImage) && /^#/.test(meta.theme)), `${meta.lang} | ${meta.title}`);
  check('the favicon is the app icon (SVG) and the brand uses it', meta.icon === '/assets/app-icon.svg|image/svg+xml' && meta.brandImg === '/assets/app-icon.svg', `${meta.icon} / ${meta.brandImg}`);
  const touch = await page.evaluate(async (href) => { const r = await fetch(href); const b = await createImageBitmap(await r.blob()); return { status: r.status, type: r.headers.get('content-type'), w: b.width, h: b.height }; }, meta.touch);
  check('apple-touch-icon is a 180 x 180 PNG', touch.status === 200 && /png/.test(touch.type) && touch.w === 180 && touch.h === 180, `${touch.w}x${touch.h}`);
  check('landmarks and a skip link to the story', meta.landmarks && meta.skip === '#main');
  check('one canvas, on a fixed, pointer-transparent, aria-hidden stage', await page.evaluate(() => { const s = document.querySelector('#stage'), cs = getComputedStyle(s); return s.querySelectorAll('canvas').length === 1 && cs.position === 'fixed' && cs.pointerEvents === 'none' && s.getAttribute('aria-hidden') === 'true'; }));
  check('eight scenes, #motion is the first after the hello', await page.evaluate((ids) => ids.every((id, i) => document.querySelectorAll('main > section')[i]?.id === id) && document.querySelectorAll('main > section').length === 8, SCENES.map((s) => s[0])));

  // ---- the copy and the type -----------------------------------------------------------------------------------------
  const text = await page.evaluate(() => ({
    visible: document.body.innerText, all: [...document.querySelectorAll('main, header, footer, aside, dialog')].map((e) => e.textContent).join(' '),
    attrs: [...document.querySelectorAll('[alt],[title],[aria-label]')].map((e) => [e.alt, e.title, e.getAttribute('aria-label')].join(' ')).join(' ') + document.title + (document.querySelector('meta[name="description"]')?.content ?? ''),
    caps: [...document.querySelectorAll('body *')].filter((e) => { const cs = getComputedStyle(e); return e.childNodes.length && [...e.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim()) && (cs.textTransform === 'uppercase' || parseFloat(cs.letterSpacing) > 0.09 * parseFloat(cs.fontSize)); }).length,
  }));
  const joined = `${text.visible} ${text.all} ${text.attrs}`;
  check('no arrow glyphs anywhere', !/[←-⇿➔➡⬀-⯿▶▸⟶↗↘↻↓]/.test(joined));
  check('no em dashes, double hyphens or numbered eyebrows in the copy', !/—|--|\b0\d\s?[/—]/.test(joined));
  check('no spaced-caps labels', text.caps === 0, `${text.caps} elements`);
  check('no banned words', !/seamless|elevate|unlock|by design|by nature|not just/i.test(joined));
  const fonts = await page.evaluate(async () => { await document.fonts.ready; return ['600 40px Fraunces', 'italic 500 40px Fraunces', '500 20px "Alegreya Sans"', '700 20px "Alegreya Sans"', '30px "Covered By Your Grace"'].map((f) => document.fonts.check(f)); });
  check('the three self-hosted families loaded', fonts.every(Boolean), fonts.join(','));
  check('nothing third-party was requested', requests.every((u) => new URL(u).origin === new URL(ORIGIN).origin || u.startsWith('data:') || u.startsWith('blob:')), requests.filter((u) => new URL(u).origin !== new URL(ORIGIN).origin && !/^(data|blob):/.test(u)).slice(0, 2).join(' '));
  const framing = await page.evaluate(() => { const b = window.mascot.figureBox(), v = window.mascot.view, W = innerWidth, H = innerHeight, ppu = v.zoom * Math.min(H / 4.4, W / 3.5), size = ppu * (1254 / 350), feet = H / 2 + 1.75 * ppu - v.y * H; return { dy: Math.abs(feet - size * (1204 / 1254) - b.top), ds: Math.abs(size - b.size), dx: Math.abs(W / 2 + v.x * W - size * (627.5 / 1254) - b.left), x: v.x }; });
  check('the page\'s own framing maths agrees with mascot.figureBox()', framing.dy < 1.5 && framing.ds < 1.5 && (Math.abs(framing.x) < 1e-3 ? framing.dx < 1.5 : true), `dy ${framing.dy.toFixed(2)} size ${framing.ds.toFixed(2)} dx ${framing.dx.toFixed(1)}`);

  // ---- the workbench: ten states --------------------------------------------------------------------------------------
  check('the workbench starts closed and unreachable', await page.evaluate(() => { const d = document.querySelector('#workbench'); return d.hasAttribute('inert') && getComputedStyle(d).visibility === 'hidden' && document.querySelector('#workbench-toggle').getAttribute('aria-expanded') === 'false'; }));
  await page.click('#workbench-toggle');
  await wait(800);
  check('the workbench opens and takes focus', await page.evaluate(() => document.querySelector('#workbench').classList.contains('is-open') && document.querySelector('#workbench').contains(document.activeElement) && document.querySelector('#workbench-toggle').getAttribute('aria-expanded') === 'true'));
  const states = await page.evaluate(() => [...document.querySelectorAll('#states [data-state]')].map((b) => b.dataset.state));
  check('ten state controls', states.length === 10, states.join(', '));
  const seen = new Set();
  for (const s of states) {
    await page.click(`#states [data-state="${s}"]`);
    await wait(s === 'working' ? 1900 : 900);       // (sitting down and standing up take a moment to read)
    const ok = await page.evaluate((state, status) => window.mascot.state === state && document.querySelector(`#states [data-state="${state}"]`).getAttribute('aria-pressed') === 'true' && document.querySelector('#status-label').textContent === status, s, STATES[s].status);
    seen.add(await fingerprint());
    check(`state ${s}`, ok);
  }
  check('states produce different poses', seen.size >= 8, `${seen.size} distinct pose fingerprints`);
  check('the workbench describes the chosen state', await page.evaluate((t) => document.querySelector('#state-title').textContent === t, STATES.resting.title));
  await page.click('#states [data-state="idle"]');
  await wait(300);

  // ---- switches ----------------------------------------------------------------------------------------------------------
  await page.click('#turntable');
  check('turntable switch', await page.evaluate(() => window.mascot.turntable && document.querySelector('#turntable').getAttribute('aria-pressed') === 'true'));
  await page.click('#turntable');
  await page.click('#reduce');
  await wait(900);
  const calm = await page.evaluate(() => ({ html: document.documentElement.classList.contains('calm'), mascot: window.mascot.reducedMotion, sticky: getComputedStyle(document.querySelector('.scene__frame')).position }));
  check('reduced motion: the page goes calm', calm.html && calm.mascot && calm.sticky === 'static', JSON.stringify(calm));
  const a = await fingerprint(); await wait(700); const b = await fingerprint();
  check('reduced motion holds Mascot still', a === b);
  await page.keyboard.press('Escape');
  await wait(700);
  await jump('approval');
  await wait(1800);
  check('reduced motion: scrolling does not change his state', (await stateNow()) === 'idle');
  await page.click('#workbench-toggle'); await wait(700);
  await page.click('#reduce');
  await wait(900);
  check('reduced motion off: back to the choreography', await page.evaluate(() => !document.documentElement.classList.contains('calm') && !window.mascot.reducedMotion && getComputedStyle(document.querySelector('.scene__frame')).position === 'sticky'));
  await page.keyboard.press('Escape');
  await wait(700);
  check('Escape closes the workbench and gives focus back', await page.evaluate(() => !document.querySelector('#workbench').classList.contains('is-open') && document.activeElement === document.querySelector('#workbench-toggle')));

  // ---- the scroll story: every scene, after a jump ---------------------------------------------------------------------
  await jump('hello');
  await wait(1200);
  for (const [id, allowed] of SCENES) {
    await jump(id);
    await wait(id === 'working' ? 4300 : 2500);
    const r = await page.evaluate((id) => {
      const sec = document.getElementById(id), t = sec.querySelector('.scene__text'), v = window.mascot.view, tv = window.mascot.viewTarget;
      return { scene: document.documentElement.dataset.scene, state: window.mascot.state, status: document.querySelector('#status-label').textContent, x: v.x, zoom: v.zoom, settled: ['x', 'y', 'zoom', 'yaw'].every((k) => Math.abs(v[k] - tv[k]) < 2e-3), alpha: +getComputedStyle(t).opacity, words: [...t.querySelectorAll('.wd__in')].every((w) => getComputedStyle(w).transform === 'none') };
    }, id);
    check(`scene ${id}: Mascot is ${allowed.join(' or ')} after a jump`, r.scene === id && allowed.includes(r.state) && r.status === STATES[r.state].status, `${r.scene}, ${r.state}, "${r.status}"`);
    check(`scene ${id}: camera, words and colours have settled`, r.settled && r.alpha > 0.99 && r.words, `settled ${r.settled}, words ${r.alpha}`);
    if (['hello', 'thinking', 'done'].includes(id)) check(`scene ${id}: Mascot is on the right, the words on the left`, r.x > 0.15, `x ${r.x.toFixed(2)}`);
    if (['motion', 'working', 'approval'].includes(id)) check(`scene ${id}: Mascot is on the left, the words on the right`, r.x < -0.15, `x ${r.x.toFixed(2)}`);
  }
  // a jump that lands inside a transition belongs to the scene it is nearer to
  await jump('working', -Math.round(0.2 * 1000));
  await wait(2600);
  check('a jump landing inside a transition picks the nearer scene', await page.evaluate(() => document.documentElement.dataset.scene === 'working' && window.mascot.state === 'working'), await page.evaluate(() => `${document.documentElement.dataset.scene}/${window.mascot.state}`));
  // the look-closer scene: the camera goes in, then he turns round
  const closerTop = await page.evaluate(() => { const el = document.getElementById('closer'); return { top: el.getBoundingClientRect().top + scrollY, hold: el.offsetHeight - document.querySelector('.scene__frame').offsetHeight }; });
  const view = async (q) => { await page.evaluate((y) => scrollTo({ top: y, behavior: 'instant' }), closerTop.top + closerTop.hold * q); await wait(2300); return page.evaluate(() => ({ zoom: window.mascot.view.zoom, yaw: window.mascot.view.yaw, on: [...document.querySelectorAll('.beat.is-on')].length })); };
  const face = await view(0.05), back = await view(0.5);
  check('look closer: the camera is on his face, then he has turned his back', face.zoom > 1.3 && face.on >= 1 && back.yaw > 2.6, `zoom ${face.zoom.toFixed(2)}, yaw ${back.yaw.toFixed(2)}`);
  // scroll wiggles must not restart a state
  await jump('working');
  await wait(4300);
  const changes = await page.evaluate(() => { window.__n = 0; window.mascot.addEventListener('statechange', () => window.__n++); return 0; });
  for (let i = 0; i < 14; i++) { await page.evaluate((i) => scrollBy(0, i % 2 ? -34 : 34), i); await wait(110); }
  await wait(700);
  check('wiggling the scroll inside a scene does not restart its state', (await page.evaluate(() => window.__n)) === 0 && (await stateNow()) === 'working');

  // ---- the approval demo ---------------------------------------------------------------------------------------------------
  await jump('approval');
  await page.waitForFunction(() => window.mascot.state === 'approval', { timeout: 15000 });
  await wait(3500);
  check('approval waits for a decision', (await stateNow()) === 'approval' && await page.evaluate(() => document.documentElement.dataset.scene === 'approval'), 'still waiting after 3.5 s');
  await page.click('#not-yet');
  await wait(500);
  check('Not yet: back to idle, and he can be asked again', (await stateNow()) === 'idle' && await page.evaluate(() => /desk/.test(document.querySelector('#decision-result').textContent) && Boolean(document.querySelector('#decision-result button'))));
  await page.click('#decision-result button');
  await wait(500);
  check('Ask again: the card comes back', (await stateNow()) === 'approval');
  await page.click('#approve');
  await page.waitForFunction(() => window.mascot.state === 'success', { timeout: 6000 });
  check('Approve: Mascot goes to success', true);
  await page.waitForFunction(() => document.documentElement.dataset.scene === 'done', { timeout: 8000 });
  check('Approve: the story carries on to the next scene', true);
  await page.waitForFunction(() => window.mascot.state === 'idle', { timeout: 9000 });
  check('success settles back to idle by itself', true);
  check('nothing was sent (the result says so)', await page.evaluate(() => /nothing was sent/i.test(document.querySelector('#decision-result').textContent)));

  // ---- poking him ---------------------------------------------------------------------------------------------------------
  await jump('thinking');
  await wait(2500);
  await page.click('#states [data-state="idle"]', { delay: 10 }).catch(() => {});
  await page.evaluate(() => window.mascot.setState('idle'));
  await wait(400);
  const box = await page.evaluate(() => { const b = window.mascot.figureBox(), v = window.mascot.view, W = innerWidth, ppu = v.zoom * Math.min(innerHeight / 4.4, W / 3.5); return { x: W / 2 + v.x * W, y: b.top + b.size * 0.5 }; });
  await page.mouse.click(box.x, box.y);
  await wait(500);
  check('poking Mascot is logged and he reacts', await page.evaluate(() => { document.querySelector('#status-pill').click(); const ok = /poked/i.test(document.querySelector('#activity-list').textContent); document.querySelector('#activity').close(); return ok; }));
  await jump('approval');
  await wait(2600);
  const box2 = await page.evaluate(() => { const b = window.mascot.figureBox(), v = window.mascot.view, W = innerWidth; return { x: W / 2 + v.x * W, y: b.top + b.size * 0.5 }; });
  await page.mouse.click(box2.x, box2.y);
  await wait(500);
  check('poking him never interrupts the card', (await stateNow()) === 'approval');

  // ---- dialog, keyboard ----------------------------------------------------------------------------------------------------
  await page.click('#status-pill');
  check('activity dialog opens from the status tag and lists what happened', await page.evaluate(() => document.querySelector('#activity').open && document.querySelectorAll('#activity-list li').length >= 5));
  await page.keyboard.press('Escape');
  await wait(300);
  check('Escape closes it', await page.evaluate(() => !document.querySelector('#activity').open));
  await jump('hello');
  await wait(400);
  await page.evaluate(() => document.querySelector('a.skip').focus());
  await page.keyboard.press('Enter');
  check('keyboard: the skip link takes you to the story', (await page.evaluate(() => document.activeElement.id)) === 'main');
  await page.evaluate(() => document.querySelector('.brand').focus());
  await page.keyboard.press('Tab'); await page.keyboard.press('Tab');
  const ring = await page.evaluate(() => { const cs = getComputedStyle(document.activeElement); return { id: document.activeElement.id, style: cs.outlineStyle, width: parseFloat(cs.outlineWidth) }; });
  check('keyboard: every stop gets a stitched (dashed) focus ring', ring.style === 'dashed' && ring.width >= 2, JSON.stringify(ring));

  // ---- exports -----------------------------------------------------------------------------------------------------------
  const png = await page.evaluate(async () => {
    const url = window.mascot.snapshot();
    const img = new Image(); img.src = url; await img.decode();
    const c = document.createElement('canvas'); c.width = img.width; c.height = img.height;
    const g = c.getContext('2d'); g.drawImage(img, 0, 0);
    const d = g.getImageData(0, 0, c.width, c.height).data;
    let opaque = 0, clear = 0;
    for (let i = 3; i < d.length; i += 4) { if (d[i] > 250) opaque++; else if (d[i] === 0) clear++; }
    return { w: img.width, h: img.height, opaque: opaque / (d.length / 4), clear: clear / (d.length / 4) };
  });
  check('PNG snapshot is transparent around the character', png.opaque > 0.1 && png.clear > 0.3, `${png.w}x${png.h}, ${(png.opaque * 100).toFixed(0)}% opaque, ${(png.clear * 100).toFixed(0)}% clear`);
  const glb = await page.evaluate(async () => { const buf = await window.mascot.exportGLB(); const v = new DataView(buf); return { size: buf.byteLength, magic: String.fromCharCode(v.getUint8(0), v.getUint8(1), v.getUint8(2), v.getUint8(3)) }; });
  check('GLB export', glb.magic === 'glTF' && glb.size > 1e6, `${(glb.size / 1e6).toFixed(1)} MB`);
  check('no downloads section, no file list', await page.evaluate(() => !document.querySelector('.file-links, .handoff, a[download]')));

  // a lost graphics context: the portrait comes back where Mascot is, and the model draws again when the context returns
  await jump('thinking');
  await wait(2500);
  await page.evaluate(() => { window.__lose = window.mascot.renderer.getContext().getExtension('WEBGL_lose_context'); window.__lose.loseContext(); });
  await wait(600);
  const lost = await page.evaluate(() => { const p = document.querySelector('#poster'), b = window.mascot.figureBox(), r = p.getBoundingClientRect(); return { loading: document.querySelector('#stage').classList.contains('is-loading'), shown: getComputedStyle(p).opacity, size: r.width, want: b.size }; });
  check('a lost graphics context brings the portrait back, at his size', lost.loading && +lost.shown > 0.9 && Math.abs(lost.size - lost.want) < 2, JSON.stringify(lost));
  await page.evaluate(() => window.__lose.restoreContext());
  await wait(1500);
  check('...and the model returns with the context', await page.evaluate(() => !document.querySelector('#stage').classList.contains('is-loading') && window.mascot.loaded));

  check('desktop: no console errors', logs.length === 0, logs.join(' ').slice(0, 300));
  check('no failed requests', failed.length === 0, failed.join(' ').slice(0, 300));
  await page.close();

  // ======================================================================================================== phone
  const phone = await browser.newPage();
  await phone.emulate({ viewport: { width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true }, userAgent: PHONE_UA });
  const phoneLogs = watchErrors(phone);
  await phone.goto(`${ORIGIN}/`, { waitUntil: 'networkidle2', timeout: 120000 });
  await phone.waitForFunction('window.mascot && window.mascot.loaded', { timeout: 120000 });
  await wait(800);
  check('phone: no horizontal overflow', (await phone.evaluate(() => document.documentElement.scrollWidth)) <= 390);
  const targets = await phone.evaluate(() => [...document.querySelectorAll('button, a.brand, a.skip, .foot a')].filter((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(e).visibility !== 'hidden' && !e.closest('[inert]'); }).map((e) => { const r = e.getBoundingClientRect(); return [e.id || e.textContent.trim().slice(0, 14), Math.round(r.width), Math.round(r.height)]; }).filter(([, w, h]) => w < 44 || h < 44));
  check('phone: touch targets are at least 44 px', targets.length === 0, JSON.stringify(targets));
  for (const [id, allowed] of SCENES) {
    await phone.evaluate((id) => document.getElementById(id).scrollIntoView({ behavior: 'instant' }), id);
    await wait(id === 'working' ? 4300 : 2500);
    const r = await phone.evaluate((id) => {
      const W = innerWidth, H = document.getElementById('stage').clientHeight, v = window.mascot.view, ppu = v.zoom * Math.min(H / 4.4, W / 3.5);
      const sy = (Y) => H / 2 - (Y - 1.75) * ppu - v.y * H, frame = document.getElementById(id).querySelector('.scene__frame'), sheet = parseFloat(getComputedStyle(frame).getPropertyValue('--sheet')) || 0;
      const t = document.getElementById(id).querySelector('.scene__text');
      return { state: window.mascot.state, scene: document.documentElement.dataset.scene, chin: sy(1.5), feet: sy(0), ears: sy(3.3), panel: frame.getBoundingClientRect().bottom - sheet, alpha: +getComputedStyle(t).opacity, settled: ['x', 'y', 'zoom', 'yaw'].every((k) => Math.abs(v[k] - window.mascot.viewTarget[k]) < 2e-3), x0: W / 2 + v.x * W - 1.6 * ppu, x1: W / 2 + v.x * W + 1.6 * ppu };
    }, id);
    check(`phone, scene ${id}: state, colours and camera settled after a jump`, r.scene === id && allowed.includes(r.state) && r.settled && r.alpha > 0.99, `${r.scene}/${r.state}`);
    if (['motion', 'thinking', 'working', 'approval', 'done', 'hello'].includes(id)) check(`phone, scene ${id}: his face${['done', 'hello', 'thinking', 'approval'].includes(id) ? ' and feet' : ''} stay above the panel`, r.chin < r.panel - 4 && (!['done', 'hello', 'thinking', 'approval'].includes(id) || r.feet < r.panel + 6) && r.ears > 60, `chin ${Math.round(r.chin)}, feet ${Math.round(r.feet)}, panel ${Math.round(r.panel)}`);
    if (['approval', 'done'].includes(id)) check(`phone, scene ${id}: his raised arms stay on screen`, r.x0 > -6 && r.x1 < 396, `${Math.round(r.x0)}..${Math.round(r.x1)}`);
  }
  check('phone: no console errors', phoneLogs.length === 0, phoneLogs.join(' ').slice(0, 200));
  await phone.close();

  // ======================================================================================================== tablet held upright
  const tablet = await browser.newPage();
  await tablet.setViewport({ width: 820, height: 1180, deviceScaleFactor: 1 });
  const tabletLogs = watchErrors(tablet);
  await tablet.goto(`${ORIGIN}/`, { waitUntil: 'networkidle2', timeout: 120000 });
  await tablet.waitForFunction('window.mascot && window.mascot.loaded', { timeout: 120000 });
  await wait(600);
  await tablet.keyboard.press('Tab');
  const firstStop = await tablet.evaluate(() => document.activeElement.className);
  check('keyboard: the first Tab stop on a fresh page is the skip link', /skip/.test(firstStop), firstStop);
  await tablet.evaluate(() => document.getElementById('approval').scrollIntoView({ behavior: 'instant' }));
  await wait(2500);
  check('tablet: no horizontal overflow, scene and state right', (await tablet.evaluate(() => document.documentElement.scrollWidth)) <= 820 && (await tablet.evaluate(() => window.mascot.state)) === 'approval' && tabletLogs.length === 0);
  await tablet.close();

  // ======================================================================================================== the OS asks for reduced motion
  const still = await browser.newPage();
  await still.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
  const stillLogs = watchErrors(still);
  await still.goto(`${ORIGIN}/`, { waitUntil: 'networkidle2', timeout: 120000 });
  await still.waitForFunction('window.mascot && window.mascot.loaded', { timeout: 120000 });
  await wait(1200);
  await still.evaluate(() => document.getElementById('approval').scrollIntoView({ behavior: 'instant' }));
  await wait(1800);
  const s = await still.evaluate(() => ({ calm: document.documentElement.classList.contains('calm'), switchOn: document.querySelector('#reduce').checked, reduced: window.mascot.reducedMotion, state: window.mascot.state, anim: [...document.querySelectorAll('.thread-x')].every((e) => getComputedStyle(e).animationName === 'none') }));
  check('the OS setting is honoured on load: calm layout, switch on, no scroll-driven state, no marching', s.calm && s.switchOn && s.reduced && s.state === 'idle' && s.anim, JSON.stringify(s));
  check('reduced motion: no console errors', stillLogs.length === 0);
  await still.close();

  // ======================================================================================================== no WebGL
  const plain = await browser.newPage();
  const plainLogs = watchErrors(plain);
  await plain.evaluateOnNewDocument(() => { const g = HTMLCanvasElement.prototype.getContext; HTMLCanvasElement.prototype.getContext = function (t, ...a) { return /webgl/i.test(t) ? null : g.call(this, t, ...a); }; });
  await plain.goto(`${ORIGIN}/`, { waitUntil: 'networkidle2', timeout: 120000 });
  await wait(1500);
  const fb = await plain.evaluate(() => ({ shown: !document.querySelector('#fallback').hidden && getComputedStyle(document.querySelector('#fallback img')).visibility !== 'hidden', note: !document.querySelector('#fallback-note').hidden, exports: document.querySelector('#export-png').disabled && document.querySelector('#export-glb').disabled, canvas: document.querySelectorAll('#stage canvas').length, mascot: typeof window.mascot }));
  check('no WebGL: the portrait and an honest note replace the canvas, exports are off', fb.shown && fb.note && fb.exports && fb.canvas === 0 && fb.mascot === 'undefined', JSON.stringify(fb));
  await plain.evaluate(() => document.getElementById('approval').scrollIntoView({ behavior: 'instant' }));
  await wait(1500);
  check('no WebGL: the story and the status tag still follow the scroll', await plain.evaluate(() => document.documentElement.dataset.scene === 'approval' && /decision/.test(document.querySelector('#status-label').textContent)));
  check('no WebGL: no console errors', plainLogs.length === 0, plainLogs.join(' ').slice(0, 200));
  await plain.close();
} finally {
  await browser.close();
}
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed${failed.length ? ' - FAILED: ' + failed.map((f) => f.name).join('; ') : ''}`);
process.exit(failed.length ? 1 : 0);
