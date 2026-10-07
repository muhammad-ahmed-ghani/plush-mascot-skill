// Every word the showcase page says, in one place: rewrite this file to give a new mascot its voice.
//
// Where the words go
//   * index.html shows most of them through tokens such as {{copy.hello.lede}}, filled in by vite.config.js in dev and in the build.
//   * the scripts (src/app.js, src/page/workbench.js) take the rest from here: the decision demo, the poke bubbles, the activity log and the
//     toasts, through say() in src/page/words.js.
//   * Two kinds of words live elsewhere, on purpose.  The document title and description are page settings (mascot.config.json
//     page.title and page.description).  The ten states' labels, titles, status lines and descriptions are the controller's public state
//     contract (src/mascot-states.js), shared with the workbench, the reel and the dev scripts: edit them there.
//
// Placeholders
//   {name} {product} {tagline}   filled from mascot.config.json `character` everywhere.
//   {status} {quality}           filled by the script that uses the line (named next to it below).
//
// Markup (only in strings that index.html shows as text; the scripts print their lines as plain text)
//   *words*    the italic, accent-coloured words of a headline (<em>)
//   ==words==  words set in the mascot's own colour (<span class="mascot-colour">); the first headline uses it for the name
// Everything else is HTML-escaped, so an ampersand or a quote is just that.
//
// Rules the validator enforces (scripts/dev/validate.mjs), because they are what keeps the page from reading like a template: sentence
// case; no arrows, numbered eyebrows ("01 /"), spaced capitals, em dashes or double hyphens; none of the words seamless, elevate, unlock,
// "by design", "by nature", "not just".  Stay inside the self-hosted fonts' character set (basic Latin, Latin-1, curly quotes and
// apostrophes, the ellipsis; see scripts/dev/build-fonts.py) or those characters fall back to another face.
//
// Voice: the mascot speaks for itself, in the first person, warmly and plainly, about what it does for the person, never about how
// clever it is.  Short sentences; one small joke at most per scene.  Say what is true: the page is a prototype and nothing is sent.

export const COPY = {
  skip: 'Skip to the story',
  bar: {
    home: '{product}, back to the top',                          // the header's link (the wordmark itself is character.product)
    openLog: 'Open the activity log',                            // the status tag reads "<status>. Open the activity log"
    workbench: 'Workbench',
  },

  // ---- the eight scenes, in order (ids and states: src/page/story.js SCENES) ---------------------------------------------------------
  hello: {
    title: 'Hi, I’m =={name}.==',
    lede: 'I live inside {product}. You hand over a job, an agent does the work, and I show you what’s going on while it gets done.',
    loading: 'stitching {name} together',
    hint: 'psst, keep scrolling',
    noWebgl: 'Your browser can’t draw me in 3D, so this is my portrait instead. Everything else still works.',
  },
  motion: {
    title: 'I listen *first.*',
    lede: 'Tell {product} what you need, in your own words, and I lean in. Move your pointer around (or drag a finger) and watch my eyes. Go on, give me a poke.',
  },
  thinking: {
    title: 'Then I *think* it over.',
    lede: 'Before anything gets touched, there’s a plan. This is my thinking face. You won’t get a made-up progress bar from me, because when I look like this I really am just thinking.',
  },
  working: {
    title: 'Then I get *to work.*',
    lede: 'Headphones on, laptop open. When I sit down like this, {product} is busy on your job, so go and make that coffee. I’ll tap you on the shoulder if something needs you.',
  },
  approval: {
    title: 'Some things are *your call.*',
    lede: 'Sending, deleting, paying: if you can’t take it back, I stop and hold up this card. I won’t decide for you, and I’ll wait as long as it takes.',
    aside: 'Try it. It’s pretend, so nothing gets sent.',
    group: 'Your decision (pretend)',
    approve: 'Approve',
    notYet: 'Not yet',
  },
  done: {
    title: '*Done.*',
    lede: 'That’s the whole loop, and you had the last word. One small hop, because it’s earned, and then back to waiting for the next thing.',
  },
  closer: {
    title: 'Come a bit *closer.*',
    lede: 'Everything you see here is live 3D, built to match my original artwork. Take a good look. I don’t mind.',
    // margin notes on the example mascot's own features; each note's data-pin in index.html is the world point its leader line ends on
    notes: {
      felt: 'felt, not plastic',
      eyes: 'cream eyes. no nose, never needed one',
      chest: 'the X on my chest is stitched',
      ears: 'ears like little tabs',
      seam: 'a seam down the back, like any proper plush',
    },
    turnaroundAlt: '{name}’s reference sheet: the plush seen from the front, the side and the back.',
    turnaroundNote: 'where I come from',
    useCasesAlt: 'Four small scenes of {name}: typing with headphones on, studying a page through a magnifying glass, holding up a card with a check mark, and celebrating with confetti.',
    useCasesNote: 'what I get up to',
    swatchesLabel: '{name}’s four colours',
    swatchesTitle: 'my four colours',
    // what a person would call each palette colour (the hex codes under them come from mascot.config.json palette)
    colours: { body: 'coral', face: 'charcoal', eye: 'cream', paper: 'oat' },
  },
  goodnight: {
    iconAlt: 'The {product} app icon.',
    iconNote: 'this is the app',
    title: 'That’s where I *live.*',
    lede: 'The face of the agent inside {product}. When there’s nothing to do I nap, and I’m up again the moment you hand me a job.',
  },
  footer: {
    text: '{name} was made for {product}. This page is a prototype: no agent is connected and nothing you do here is sent anywhere.',
    handoff: 'Read the handoff notes',
  },

  // ---- the workbench drawer and the activity dialog ---------------------------------------------------------------------------------------
  workbench: {
    title: 'The workbench',
    close: 'Close',
    lede: 'For poking at {name}. This page is a prototype: no agent is connected, and nothing you do here is sent anywhere.',
    statesHeading: 'Try a state',
    statesLabel: '{name}’s ten states',
    switchesHeading: 'Switches',
    reduce: 'Reduced motion',
    turntable: 'Turn {name} around (turntable)',
    exportsHeading: 'Take {name} with you',
    png: 'Save a PNG snapshot',
    glb: 'Export the 3D model (GLB)',
    glbBusy: 'Exporting…',
    openLog: 'Open the activity log',
    fine: 'Live 3D, fitted to the plush artwork: its silhouette, needle-felt nap and studio light. Ten states, each one meant to follow a real event in {product}.',
  },
  activity: {
    title: 'Here’s what’s happening',
    close: 'Close',
    lede: 'A transparent record of this prototype’s state changes.',
    fine: 'Demonstration only. No agent or external account is connected.',
  },
  toast: {
    snapshot: 'Transparent snapshot saved.',
    glb: '3D model and ten motion clips saved.',
    glbFailed: 'The export failed. The editable source is still in the project.',
    turntableCalm: 'Turn off reduced motion to turn {name} around.',
  },

  // ---- the decision demo (src/app.js); validate.mjs looks for "desk" and "nothing was sent" in the two results ----------------------------
  decision: {
    approved: 'Approved. (Pretend, so nothing was sent.)',
    approvedLog: 'You approved the pretend request. Nothing was sent.',
    notYet: 'No problem. It stays on the desk until you’re ready.',
    notYetLog: 'You said not yet. The pretend request stays open.',
    askAgain: 'Ask again',
    askAgainLog: 'You asked again.',
  },

  // ---- poking the mascot (src/app.js): the bubble by the pointer, and the log line (validate.mjs looks for "poked") ------------------------
  poke: {
    hi: ['hi!', 'hey, you', 'hello again', 'oh, hi'],
    resting: 'mm? five more minutes',
    working: 'busy, one sec',
    approval: 'your call, not mine',
    log: 'You poked {name}.',
  },

  // ---- the activity log (src/app.js) ---------------------------------------------------------------------------------------------------------
  log: {
    opened: 'Page opened. No agent or external service is connected.',
    ready: 'The live model is ready ({quality} quality).',                      // {quality}: high, medium or low
    slow: 'Frames were slow, so some fine detail was dropped to keep the motion smooth.',
    contextLost: 'The graphics context was lost. Showing the portrait until it returns.',
    contextBack: 'The graphics context is back.',
    calmOn: 'Reduced motion on: the page holds still.',
    calmOff: 'Full motion on: the page follows your scrolling.',
    fromWorkbench: '{status} (from the workbench)',                             // {status}: the state's status line
  },
};

/** `text` with its {placeholders} filled from `vars`; a placeholder without a value is left as it is. */
export function fill(text, vars = {}) {
  return String(text).replace(/\{(\w+)\}/g, (m, key) => (vars[key] === undefined ? m : String(vars[key])));
}
