import fs from 'fs';
const F = '/srv/td/public/javascripts/game/tactical.js';
let s = fs.readFileSync(F, 'utf8');
if (s.includes('/* mobile-first tactical */')) { console.log('already'); process.exit(0); }

// Replace the whole injected <style> with a mobile-first version.
const startMarker = "  const style = document.createElement('style');\n  style.textContent = `";
const endMarker = "  `;\n  // fix one stray non-ascii char from a typo guard (border color)\n  style.textContent = style.textContent.replace('#1d3ب52', '#1d3b52');\n  document.head.appendChild(style);";
const startIdx = s.indexOf(startMarker);
const endIdx = s.indexOf(endMarker);
if (startIdx === -1 || endIdx === -1) { console.log('style block markers not found'); process.exit(1); }

const newStyle = `  const style = document.createElement('style');
  style.textContent = \`
    /* mobile-first tactical */
    /* Pause button lives at the TOP-LEFT of the canvas area (under the forecast),
       so it never collides with the card hand (bottom) or the HUD bottom-sheet. */
    #td-pause-btn { position:fixed; left:8px; top:calc(56px + var(--safe-top,0px)); z-index:60;
      background:rgba(13,22,34,.92); border:1px solid #2a4a63; color:#bfe6ff; border-radius:11px;
      padding:8px 11px; font-weight:800; font-size:12px; letter-spacing:.03em; cursor:pointer;
      display:flex; align-items:center; gap:6px; box-shadow:0 6px 18px rgba(0,0,0,.5);
      -webkit-tap-highlight-color:transparent; touch-action:manipulation; min-height:40px; }
    #td-pause-btn:disabled { opacity:.4; cursor:not-allowed; }
    #td-pause-btn .pz-badge { background:#33ddff; color:#04121b; border-radius:20px; padding:1px 7px; font-size:12px; min-width:18px; text-align:center; }

    #td-tactical { position:fixed; inset:0; z-index:190; display:none; background:rgba(3,6,11,.78);
      backdrop-filter:blur(3px); flex-direction:column;
      padding-top:var(--safe-top,0px); padding-bottom:var(--safe-bottom,0px); }
    #td-tactical.show { display:flex; animation:tcF .16s ease-out; }
    @keyframes tcF { from{opacity:0} to{opacity:1} }

    /* bar wraps on narrow screens: title full-width, then the two buttons */
    #td-tactical .tc-bar { display:flex; flex-wrap:wrap; align-items:center; gap:8px;
      padding:12px 14px; border-bottom:1px solid #1d3b52; }
    #td-tactical .tc-title { font-weight:800; letter-spacing:.06em; color:#33ddff; font-size:14px;
      flex:1 1 100%; }
    #td-tactical .tc-bar button { border:none; border-radius:10px; padding:11px 14px; font-weight:800;
      cursor:pointer; font-size:13px; min-height:44px; touch-action:manipulation; flex:1; }
    #td-tactical .tc-hunt { background:#3a2a12; color:#ffcc33; border:1px solid #6b5320 !important; }
    #td-tactical .tc-hunt.on { background:#ffcc33; color:#241d05; }
    #td-tactical .tc-resume { background:#33ddff; color:#04121b; }
    #td-tactical .tc-hint { color:#9fb6c8; font-size:12px; padding:8px 14px; line-height:1.4; }
    #td-tactical .tc-list { flex:1; overflow-y:auto; -webkit-overflow-scrolling:touch;
      padding:6px 14px 16px; display:flex; flex-direction:column; gap:8px; }

    .tc-enemy { background:#0d1622; border:1px solid #21384c; border-radius:10px; padding:10px 12px;
      display:flex; gap:10px; align-items:center; }
    .tc-enemy .tc-ico { font-size:20px; width:24px; min-width:24px; text-align:center; }
    .tc-enemy .tc-info { flex:1; min-width:0; }
    .tc-enemy .tc-name { font-weight:800; color:#e8f1f7; font-size:13px; text-transform:capitalize; }
    .tc-enemy .tc-sub { color:#8fa6b8; font-size:11px; margin-top:2px; line-height:1.35;
      overflow:hidden; text-overflow:ellipsis; }
    .tc-enemy .tc-hpwrap { height:7px; background:#06121c; border-radius:5px; overflow:hidden; margin-top:6px; }
    .tc-enemy .tc-hp { height:100%; background:linear-gradient(90deg,#66ff99,#33ddff); }
    .tc-enemy .tc-threat { font-size:10px; font-weight:800; letter-spacing:.06em; text-transform:uppercase;
      padding:3px 8px; border-radius:20px; white-space:nowrap; min-width:54px; text-align:center; }
    .tc-enemy.hunting { cursor:crosshair; border-color:#ffcc33; }
    .tc-enemy.hunting:active, .tc-enemy.hunting:hover { background:#13202c; }

    /* desktop: title shares the row with the buttons; buttons size to content */
    @media (min-width: 720px) {
      #td-pause-btn { left:12px; top:auto; bottom:calc(96px + var(--safe-bottom,0px)); font-size:13px; padding:10px 14px; }
      #td-tactical .tc-title { flex:1 1 auto; font-size:15px; }
      #td-tactical .tc-bar button { flex:0 0 auto; }
    }
    @media (min-width: 1024px) {
      /* desktop HUD is a right rail, the canvas owns the left — anchor bottom-left */
      #td-pause-btn { bottom:calc(20px + var(--safe-bottom,0px)); }
    }
  \`;
  document.head.appendChild(style);`;

s = s.slice(0, startIdx) + newStyle + s.slice(endIdx + endMarker.length);
fs.writeFileSync(F, s);
console.log('tactical.js: mobile-first styles + pause button repositioned (no card-hand/HUD collision)');
