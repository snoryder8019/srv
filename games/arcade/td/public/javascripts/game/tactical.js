/**
 * Tactical pause — public, for every player.
 *
 * A floating PAUSE button shows the remaining pause budget. Tapping it spends a
 * pause and freezes the run; the server ships `run:tactical` with a full enemy
 * analysis (hp, speed, armor, threat, aggro, special ability) and whether a
 * disguised infiltrator is hiding in the crowd.
 *
 * While paused the player can:
 *   • read the enemy analysis board,
 *   • stage tactics updates on towers (re-target / apply buffs — uses the
 *     existing action-card flow, just available during the freeze),
 *   • hunt the disguised unit (Where's-Waldo): tap the enemy you suspect; a
 *     correct tap exposes it for a bounty, a wrong tap is flagged as a miss.
 *
 * Resume re-starts the loop server-side.
 */
import { socket } from './net.js';
import { state } from './state.js';
import { toast } from './dom.js';

let btn, badge, overlay, listEl, huntBtn, resumeBtn, titleEl;
let built = false;
let huntMode = false;
let pausesLeft = 3, pauseBudget = 3;
let lastSnapshot = null;

const THREAT_LABEL = ['', 'low', 'moderate', 'high', 'severe', 'critical'];
const TYPE_ICON = { basic: '●', fast: '▲', tank: '⬛', grunt: '●', runner: '▲', machine: '⬛', flyer: '✦', infiltrator: '◆' };

function build() {
  if (built) return; built = true;
  const style = document.createElement('style');
  style.textContent = `
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

    /* portrait pause clears left rail: pin top-right */
    @media (orientation: portrait) {
      #td-pause-btn { left:auto; right:8px; top:calc(108px + var(--safe-top,0px)); }
    }
    @media (min-width: 720px) {
      #td-pause-btn { left:12px; right:auto; top:auto; bottom:calc(96px + var(--safe-bottom,0px)); font-size:13px; padding:10px 14px; }
      /* on wider screens the sheet is a tidy bottom-left card, not full width */
      #td-tactical { left:auto; right:auto; width:420px; margin-left:12px; }
      #td-tactical .tc-sheet { border-radius:16px; margin-bottom:12px; }
    }
    @media (min-width: 1024px) {
      #td-pause-btn { bottom:calc(20px + var(--safe-bottom,0px)); }
    }
  `;
  document.head.appendChild(style);

  btn = document.createElement('button');
  btn.id = 'td-pause-btn';
  btn.innerHTML = `⏸ PAUSE <span class="pz-badge">3</span>`;
  badge = btn.querySelector('.pz-badge');
  btn.addEventListener('click', requestPause);
  document.body.appendChild(btn);

  overlay = document.createElement('div');
  overlay.id = 'td-tactical';
  overlay.innerHTML = `
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
    </div>`;
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
  handle.addEventListener('click', toggleCollapse);

  huntBtn.addEventListener('click', () => {
    huntMode = !huntMode;
    huntBtn.classList.toggle('on', huntMode);
    overlay.querySelector('.tc-hint').textContent = huntMode
      ? 'HUNT MODE: tap the enemy you think is the disguised infiltrator.'
      : 'Read the board. Stage tower tactics, then resume.';
    renderList();
  });
  resumeBtn.addEventListener('click', closePause);

  // spacebar toggles the tactical pause for everyone
  window.addEventListener('keydown', (e) => {
    if (e.code !== 'Space') return;
    // don't hijack space while typing in an input
    const t = e.target;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
    e.preventDefault();
    if (overlay.classList.contains('show')) closePause();
    else requestPause();
  });
}

function setBudge() {
  if (!badge) return;
  badge.textContent = pausesLeft;
  btn.disabled = pausesLeft <= 0 && !overlay.classList.contains('show');
}

function requestPause() {
  if (!state.runId) return;
  if (pausesLeft <= 0) { toast('No pauses left', 'bad'); return; }
  socket.emit('run:tactical-pause', { runId: state.runId });
}

function closePause() {
  overlay.classList.remove('show');
  huntMode = false; huntBtn.classList.remove('on');
  if (state.runId) socket.emit('run:tactical-resume', { runId: state.runId });
}

function renderList() {
  if (!lastSnapshot) return;
  const es = lastSnapshot.enemies.slice().sort((a, b) => (b.threat - a.threat) || (b.pathIndex - a.pathIndex));
  if (!es.length) { listEl.innerHTML = '<div class="tc-hint">No enemies on the board right now.</div>'; return; }
  listEl.innerHTML = es.map((e) => {
    const pct = Math.max(0, Math.min(1, e.hp / (e.hpMax || 1))) * 100;
    const thr = THREAT_LABEL[e.threat] || 'low';
    const thrCol = ['#66ff99', '#66ff99', '#ffcc33', '#ff9944', '#ff5566', '#ff2244'][e.threat] || '#66ff99';
    return `<div class="tc-enemy ${huntMode ? 'hunting' : ''}" data-id="${e.id}">
      <span class="tc-ico">${TYPE_ICON[e.type] || '●'}</span>
      <div class="tc-info">
        <div class="tc-name">${e.type}${e.ground === false ? ' · flyer' : ''}</div>
        <div class="tc-sub">${e.aggro} · ${e.ability}${e.armor ? ' · armor ' + e.armor : ''}</div>
        <div class="tc-hpwrap"><div class="tc-hp" style="width:${pct}%"></div></div>
      </div>
      <span class="tc-threat" style="background:${thrCol}22;color:${thrCol}">${thr}</span>
    </div>`;
  }).join('');
  if (huntMode) {
    listEl.querySelectorAll('.tc-enemy').forEach((row) => {
      row.addEventListener('click', () => {
        socket.emit('run:expose', { runId: state.runId, enemyId: row.dataset.id });
      });
    });
  }
}

export function initTactical() {
  build();
  setBudge();

  socket.on('run:tactical', (snap) => {
    lastSnapshot = snap;
    pausesLeft = snap.pausesLeft; pauseBudget = snap.pauseBudget;
    setBudge();
    titleEl.textContent = `TACTICAL PAUSE · ${snap.pausesLeft}/${snap.pauseBudget} left`;
    huntBtn.style.display = snap.disguisedOnBoard ? '' : 'none';
    overlay.classList.add('show');
    renderList();
  });

  socket.on('run:tactical-result', (r) => {
    if (!r.ok) toast(r.error || 'Cannot pause', 'bad');
  });

  socket.on('run:pause-budget', ({ pauseBudget: pb, pausesLeft: pl }) => {
    if (pb != null) pauseBudget = pb;
    if (pl != null) pausesLeft = pl;
    setBudge();
  });

  socket.on('run:expose-result', (r) => {
    if (r.ok) { toast('Infiltrator exposed! +' + r.bounty, 'reward'); }
    else if (r.miss) { toast('Not the infiltrator — look closer', 'bad'); }
  });

  socket.on('enemy:exposed', ({ bounty }) => {
    // refresh the board so the now-exposed unit shows its true colors
    if (lastSnapshot) {
      // server will re-send on next pause; for now just close hunt mode
      huntMode = false; huntBtn.classList.remove('on');
    }
  });

  socket.on('run:resumed', () => {
    overlay.classList.remove('show');
    huntMode = false; if (huntBtn) huntBtn.classList.remove('on');
  });
}

// ---- board-tap integration (play.js calls these) ----
// True when a tactical pause is active AND the player is in hunt mode.
export function isHunting() {
  return huntMode && overlay && overlay.classList.contains('show');
}
// True when the tactical pause overlay is currently shown (paused).
export function isPaused() {
  return !!(overlay && overlay.classList.contains('show'));
}
// Expose an enemy by id (from a board tap). Mirrors the list-row tap.
export function exposeEnemy(enemyId) {
  if (!enemyId || !state.runId) return;
  socket.emit('run:expose', { runId: state.runId, enemyId });
}

export default { initTactical, isHunting, isPaused, exposeEnemy };
