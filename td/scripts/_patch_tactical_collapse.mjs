import fs from 'fs';
const F = '/srv/td/public/javascripts/game/tactical.js';
let s = fs.readFileSync(F, 'utf8');
if (s.includes('collapsible bottom sheet')) { console.log('already'); process.exit(0); }

// ── 1) Replace the full-screen overlay styles with a COLLAPSIBLE BOTTOM SHEET ──
const styleStart = "  const style = document.createElement('style');\n  style.textContent = `";
const styleEnd = "  `;\n  document.head.appendChild(style);";
const sIdx = s.indexOf(styleStart);
const eIdx = s.indexOf(styleEnd);
if (sIdx === -1 || eIdx === -1) { console.log('style markers missing'); process.exit(1); }

const newStyle = `  const style = document.createElement('style');
  style.textContent = \`
    /* tactical pause — collapsible bottom sheet so the FIELD stays visible
       (bezier aggro lines + tapping units on the board). It never covers the
       whole screen; collapsed = just a slim bar, expanded = analysis list. */
    #td-pause-btn { position:fixed; left:8px; top:calc(108px + var(--safe-top,0px)); z-index:60;
      background:rgba(13,22,34,.92); border:1px solid #2a4a63; color:#bfe6ff; border-radius:11px;
      padding:8px 11px; font-weight:800; font-size:12px; letter-spacing:.03em; cursor:pointer;
      display:flex; align-items:center; gap:6px; box-shadow:0 6px 18px rgba(0,0,0,.5);
      -webkit-tap-highlight-color:transparent; touch-action:manipulation; min-height:40px; }
    #td-pause-btn:disabled { opacity:.4; cursor:not-allowed; }
    #td-pause-btn .pz-badge { background:#33ddff; color:#04121b; border-radius:20px; padding:1px 7px; font-size:12px; min-width:18px; text-align:center; }

    /* NO full-screen scrim — only the sheet itself catches taps, so the board
       behind it stays interactive (tap units, see aggro lines). */
    #td-tactical { position:fixed; left:0; right:0; bottom:0; z-index:120; display:none;
      flex-direction:column; pointer-events:none;
      padding-bottom:var(--safe-bottom,0px); }
    #td-tactical.show { display:flex; animation:tcF .16s ease-out; }
    @keyframes tcF { from{transform:translateY(20px);opacity:0} to{transform:translateY(0);opacity:1} }

    /* the sheet panel sits at the bottom; its children catch taps */
    #td-tactical .tc-sheet { pointer-events:auto; background:rgba(7,12,20,.95);
      border-top:1px solid #1d3b52; border-radius:16px 16px 0 0; box-shadow:0 -8px 30px rgba(0,0,0,.55);
      backdrop-filter:blur(6px); display:flex; flex-direction:column; max-height:62vh; }

    /* grab handle + bar (always visible) */
    #td-tactical .tc-handle { align-self:center; width:40px; height:4px; border-radius:3px;
      background:#2f4a63; margin:7px 0 3px; }
    #td-tactical .tc-bar { display:flex; flex-wrap:wrap; align-items:center; gap:8px; padding:4px 12px 10px; }
    #td-tactical .tc-title { font-weight:800; letter-spacing:.05em; color:#33ddff; font-size:13px; flex:1 1 auto; }
    #td-tactical .tc-bar button { border:none; border-radius:10px; padding:10px 12px; font-weight:800;
      cursor:pointer; font-size:12.5px; min-height:42px; touch-action:manipulation; }
    #td-tactical .tc-collapse { background:#13202c; color:#9fd6ff; border:1px solid #2a4a63 !important; flex:0 0 auto; }
    #td-tactical .tc-hunt { background:#3a2a12; color:#ffcc33; border:1px solid #6b5320 !important; flex:0 0 auto; }
    #td-tactical .tc-hunt.on { background:#ffcc33; color:#241d05; }
    #td-tactical .tc-resume { background:#33ddff; color:#04121b; flex:0 0 auto; }

    #td-tactical .tc-hint { color:#9fb6c8; font-size:11.5px; padding:0 12px 8px; line-height:1.35; }
    #td-tactical .tc-list { overflow-y:auto; -webkit-overflow-scrolling:touch;
      padding:2px 12px 14px; display:flex; flex-direction:column; gap:7px; }

    /* COLLAPSED: hide the list + hint, keep just the bar so the board is open */
    #td-tactical.collapsed .tc-list,
    #td-tactical.collapsed .tc-hint { display:none; }
    #td-tactical.collapsed .tc-sheet { max-height:none; }

    .tc-enemy { background:#0d1622; border:1px solid #21384c; border-radius:10px; padding:9px 11px;
      display:flex; gap:10px; align-items:center; }
    .tc-enemy .tc-ico { font-size:19px; width:22px; min-width:22px; text-align:center; }
    .tc-enemy .tc-info { flex:1; min-width:0; }
    .tc-enemy .tc-name { font-weight:800; color:#e8f1f7; font-size:13px; text-transform:capitalize; }
    .tc-enemy .tc-sub { color:#8fa6b8; font-size:11px; margin-top:2px; line-height:1.35; overflow:hidden; text-overflow:ellipsis; }
    .tc-enemy .tc-hpwrap { height:6px; background:#06121c; border-radius:5px; overflow:hidden; margin-top:5px; }
    .tc-enemy .tc-hp { height:100%; background:linear-gradient(90deg,#66ff99,#33ddff); }
    .tc-enemy .tc-threat { font-size:10px; font-weight:800; letter-spacing:.06em; text-transform:uppercase;
      padding:3px 8px; border-radius:20px; white-space:nowrap; min-width:52px; text-align:center; }
    .tc-enemy.hunting { cursor:crosshair; border-color:#ffcc33; }
    .tc-enemy.hunting:active, .tc-enemy.hunting:hover { background:#13202c; }

    @media (min-width: 720px) {
      #td-pause-btn { left:12px; top:auto; bottom:calc(96px + var(--safe-bottom,0px)); font-size:13px; padding:10px 14px; }
      /* on wider screens the sheet is a tidy bottom-left card, not full width */
      #td-tactical { left:auto; right:auto; width:420px; margin-left:12px; }
      #td-tactical .tc-sheet { border-radius:16px; margin-bottom:12px; }
    }
    @media (min-width: 1024px) {
      #td-pause-btn { bottom:calc(20px + var(--safe-bottom,0px)); }
    }
  \`;
  document.head.appendChild(style);`;

s = s.slice(0, sIdx) + newStyle + s.slice(eIdx + styleEnd.length);

// ── 2) New markup: sheet wrapper + grab handle + collapse toggle ──
s = s.replace(
  `  overlay.innerHTML = \`
    <div class="tc-bar">
      <span class="tc-title">TACTICAL PAUSE</span>
      <button class="tc-hunt">🔍 Hunt infiltrator</button>
      <button class="tc-resume">Resume ▸</button>
    </div>
    <div class="tc-hint">Read the board. Stage tower tactics, then resume. A disguised infiltrator may be hiding…</div>
    <div class="tc-list"></div>\`;
  document.body.appendChild(overlay);
  titleEl = overlay.querySelector('.tc-title');
  listEl = overlay.querySelector('.tc-list');
  huntBtn = overlay.querySelector('.tc-hunt');
  resumeBtn = overlay.querySelector('.tc-resume');`,
  `  overlay.innerHTML = \`
    <div class="tc-sheet">
      <div class="tc-handle"></div>
      <div class="tc-bar">
        <span class="tc-title">TACTICAL PAUSE</span>
        <button class="tc-collapse" title="Show/hide the field">▾ Field</button>
        <button class="tc-hunt">🔍 Hunt</button>
        <button class="tc-resume">Resume ▸</button>
      </div>
      <div class="tc-hint">Tap units on the board to inspect; the arcs show each attacker's line to the core. A disguised infiltrator may be hiding…</div>
      <div class="tc-list"></div>
    </div>\`;
  document.body.appendChild(overlay);
  titleEl = overlay.querySelector('.tc-title');
  listEl = overlay.querySelector('.tc-list');
  huntBtn = overlay.querySelector('.tc-hunt');
  resumeBtn = overlay.querySelector('.tc-resume');
  const collapseBtn = overlay.querySelector('.tc-collapse');
  const handle = overlay.querySelector('.tc-handle');
  const toggleCollapse = () => {
    const collapsed = overlay.classList.toggle('collapsed');
    collapseBtn.textContent = collapsed ? '▴ List' : '▾ Field';
  };
  collapseBtn.addEventListener('click', toggleCollapse);
  handle.addEventListener('click', toggleCollapse);`
);

fs.writeFileSync(F, s);
console.log('tactical.js: collapsible bottom sheet (field stays visible + tappable)');
