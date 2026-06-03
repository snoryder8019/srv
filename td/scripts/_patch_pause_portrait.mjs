import fs from 'fs';
const F = '/srv/td/public/javascripts/game/tactical.js';
let s = fs.readFileSync(F, 'utf8');
if (s.includes('portrait pause clears left rail')) { console.log('already'); process.exit(0); }

// In portrait the controls now live in a LEFT rail, so move the pause button to
// the top-RIGHT to avoid overlapping it. (Landscape/desktop rules already set
// left/bottom positions further down in the stylesheet, after this rule.)
s = s.replace(
  `    @media (min-width: 720px) {
      #td-pause-btn { left:12px; top:auto; bottom:calc(96px + var(--safe-bottom,0px)); font-size:13px; padding:10px 14px; }`,
  `    /* portrait pause clears left rail: pin top-right */
    @media (orientation: portrait) {
      #td-pause-btn { left:auto; right:8px; top:calc(108px + var(--safe-top,0px)); }
    }
    @media (min-width: 720px) {
      #td-pause-btn { left:12px; right:auto; top:auto; bottom:calc(96px + var(--safe-bottom,0px)); font-size:13px; padding:10px 14px; }`
);

fs.writeFileSync(F, s);
console.log('tactical.js: pause button moved top-right in portrait (clears left control rail)');
