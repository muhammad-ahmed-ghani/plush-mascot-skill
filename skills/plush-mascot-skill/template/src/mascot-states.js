// The public state contract: the ten state names, and for each the words the page shows (label: the workbench button; title and description:
// the workbench's note; status: the status tag and the activity log), the symbol a compact UI may use and the one-shot duration in seconds
// (greeting and success return to the scene's resting state after it; see src/app.js).  The page's other words are in src/page/copy.js.
// The lines speak of the mascot without naming it, so they fit any character; the dev scripts check the status tag against `status`.
export const STATES = {
 idle:{label:'Idle',symbol:'◌',title:'Quietly here.',status:'Ready when you are',description:'A slow breath and an occasional blink. Presence without distraction.',duration:4},
 greeting:{label:'Hello',symbol:'✧',title:'A little hello.',status:'Good to see you',description:'One soft wave and a slight tilt. Welcoming, without stealing the show.',duration:2.4},
 listening:{label:'Listening',symbol:'◖',title:'You have my attention.',status:'Listening to you',description:'Leaning in and looking toward you. This state should follow an actual listening event.',duration:3},
 thinking:{label:'Thinking',symbol:'⋯',title:'Connecting the dots.',status:'Thinking it through',description:'A thoughtful upward glance and a small head tilt. No invented progress percentage.',duration:3.6},
 working:{label:'Working',symbol:'⌘',title:'On it.',status:'Working on your brief',description:'Sitting down with headphones on and a laptop open, typing in a steady, restrained rhythm that signals execution in progress.',duration:4.8},
 approval:{label:'Your turn',symbol:'?',title:'Your call.',status:'Waiting for your decision',description:'An open palm, a patient expression, then stillness. The decision belongs to you.',duration:3},
 success:{label:'Done',symbol:'✓',title:'One more thing, done.',status:'All done. Nice teamwork.',description:'A small hop and a pleased nod. Play once, then return to a quiet idle.',duration:2.4},
 error:{label:'A snag',symbol:'!',title:'Let’s work through it.',status:'A snag needs your attention',description:'A small concerned tilt, never panic. Pair this with a clear explanation and next step.',duration:3},
 speaking:{label:'Speaking',symbol:'≋',title:'Something to share.',status:'Sharing an update',description:'Gentle gestures and mouth movement. The prototype uses a simulated voice envelope.',duration:3},
 resting:{label:'Resting',symbol:'☾',title:'Here when you need me.',status:'Resting. Nothing is running.',description:'Closed eyes and a settled pose. Use only when no task is active.',duration:4}
};
