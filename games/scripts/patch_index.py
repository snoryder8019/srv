with open('/srv/games/public/index.html', 'r') as f:
    html = f.read()

nav_css = """
    .nav-menu-wrap { position: relative; }
    .nav-menu-btn { background: transparent; border: 1px solid var(--border); padding: 7px 10px; border-radius: 4px; cursor: pointer; display: flex; flex-direction: column; gap: 4px; align-items: center; justify-content: center; width: 36px; height: 36px; }
    .nav-menu-btn span { display: block; width: 16px; height: 2px; background: var(--muted); border-radius: 2px; transition: all 0.2s; }
    .nav-menu-btn:hover span, .nav-menu-btn.open span { background: var(--accent); }
    .nav-menu-btn.open { border-color: var(--accent); }
    .nav-dropdown { display: none; position: absolute; right: 0; top: calc(100% + 8px); background: #111; border: 1px solid var(--border); border-radius: 6px; min-width: 220px; z-index: 200; overflow: hidden; box-shadow: 0 8px 32px rgba(0,0,0,0.6); }
    .nav-dropdown.open { display: block; }
    .nav-dd-item { display: flex; align-items: center; gap: 10px; padding: 11px 16px; font-size: 0.78rem; color: var(--muted); text-decoration: none; cursor: pointer; font-family: inherit; background: transparent; border: none; width: 100%; text-align: left; transition: all 0.15s; letter-spacing: 0.03em; }
    .nav-dd-item:hover { background: #1a1a1a; color: var(--text); }
    .nav-dd-highlight { color: #22c55e !important; }
    .nav-dd-highlight:hover { background: #0a1f0a !important; }
    .nav-dd-badge { margin-left: auto; font-size: 0.6rem; background: #22c55e20; color: #22c55e; border: 1px solid #22c55e40; padding: 1px 6px; border-radius: 10px; }
    .nav-dd-admin { color: var(--yellow) !important; }
    .nav-dd-admin:hover { background: #1a1500 !important; }
    .nav-dd-logout:hover { background: #1a0a0a !important; color: var(--accent) !important; }
    .nav-dd-divider { border-top: 1px solid var(--border); margin: 4px 0; }
    .server-card { transition: border-color 0.3s; }
    .server-card.state-online  { border-color: #22373a; }
    .server-card.state-booting { border-color: #37350a; }
    .server-card.state-offline { border-color: var(--border); }
    .server-card.state-warning { border-color: #5a1a0a; animation: warn-pulse 2s infinite; }
    @keyframes warn-pulse { 0%,100%{border-color:#5a1a0a}50%{border-color:#cd412b} }
    .shutdown-warning { position: fixed; bottom: 24px; left: 50%; transform: translateX(-50%); background: #1a0500; border: 1px solid var(--accent); border-radius: 6px; padding: 12px 20px; font-size: 0.8rem; color: var(--accent); z-index: 1000; display: none; text-align: center; max-width: 400px; }
    .shutdown-warning.show { display: block; }
"""

if '.nav-menu-wrap' not in html:
    html = html.replace('  </style>', nav_css + '  </style>', 1)

socket_js = """
function connectServerState() {
  const sock = io('/stats', { transports: ['websocket', 'polling'] });
  sock.on('connect', () => sock.emit('stats:subscribe', null));
  sock.on('stats:snapshot', (d) => { if (d && d.game) applyServerState(d.game, d); });
  sock.on('server:status',  (d) => { if (d && d.game) applyServerState(d.game, d); });
  sock.on('server:starting', ({ game }) => {
    setCardState(game, 'booting');
    const dot = document.getElementById(game + '_dot');
    if (dot) dot.className = 'status-dot booting';
    const se = document.getElementById(game + '_status');
    if (se) { se.textContent = 'STARTING'; se.style.color = 'var(--yellow)'; }
    toast(game.toUpperCase() + ' starting up...', true);
  });
  sock.on('server:stopped', ({ game, reason }) => {
    applyServerState(game, { running: false, players: 0, booting: false });
    toast(reason === 'inactivity' ? game.toUpperCase() + ' shut down (idle 1hr)' : game.toUpperCase() + ' stopped', true);
    hideShutdownWarning(game);
  });
  sock.on('server:shutdown-warning', ({ game, idleMinutes }) => {
    setCardState(game, 'warning'); showShutdownWarning(game, idleMinutes);
  });
  sock.on('server:provisioning', ({ game }) => toast(game.toUpperCase() + ' provisioning on Linode (~10 min)', true));
  sock.on('stats:event', (ev) => {
    if (!ev || !ev.game) return;
    feedEvents.push(ev);
    if (feedEvents.length > 100) feedEvents = feedEvents.slice(-100);
    const list = document.getElementById('eventList');
    if (list) { list.insertAdjacentHTML('beforeend', renderEventItem(ev)); list.scrollTop = list.scrollHeight; }
    const fc = document.getElementById('feedCount');
    if (fc) fc.textContent = feedEvents.length + ' events';
  });
}

function applyServerState(game, status) {
  const dot = document.getElementById(game + '_dot');
  if (!dot) return;
  const statusEl = document.getElementById(game + '_status');
  const playersEl = document.getElementById(game + '_players');
  const joinEl = document.getElementById(game + '_join');
  const reqEl  = document.getElementById(game + '_request');
  const isOnline  = status.running && !status.booting;
  const isBooting = status.running &&  status.booting;
  dot.className = 'status-dot ' + (isOnline ? 'online' : isBooting ? 'booting' : 'offline');
  if (statusEl) { statusEl.textContent = isOnline ? 'ONLINE' : isBooting ? 'BOOTING' : 'OFFLINE'; statusEl.style.color = isOnline ? 'var(--green)' : isBooting ? 'var(--yellow)' : 'var(--muted)'; }
  if (playersEl) { playersEl.textContent = isOnline ? (status.players||0)+' / '+(status.maxPlayers||0) : '--'; playersEl.className = 'stat-value'+(status.players>0?' green':''); }
  setEl(game+'_map', status.map);
  setEl(game+'_worldSize', status.worldSize ? status.worldSize.toLocaleString() : null);
  setEl(game+'_seed', status.seed);
  setEl(game+'_fps', status.fps!=null ? status.fps.toFixed(0) : null);
  setEl(game+'_maxPlayers', status.maxPlayers);
  if (joinEl) joinEl.style.display = isOnline ? '' : 'none';
  if (reqEl)  reqEl.style.display  = !status.running ? '' : 'none';
  if (isAdmin) { setDisabled(game+'_btnStart',status.running); setDisabled(game+'_btnStop',!status.running); setDisabled(game+'_btnRestart',!status.running); }
  setCardState(game, isOnline ? 'online' : isBooting ? 'booting' : 'offline');
}

function setCardState(game, state) {
  const card = document.getElementById('card_' + game);
  if (!card) return;
  card.classList.remove('state-online','state-booting','state-offline','state-warning');
  card.classList.add('state-' + state);
}

const _warnTimers = {};
function showShutdownWarning(game, idleMin) {
  let el = document.getElementById('warn_' + game);
  if (!el) { el = document.createElement('div'); el.id = 'warn_'+game; el.className = 'shutdown-warning'; document.body.appendChild(el); }
  el.innerHTML = '<strong>' + game.toUpperCase() + '</strong> shutting down in 30s (idle '+idleMin+' min) — join now to keep it alive';
  el.classList.add('show');
  clearTimeout(_warnTimers[game]);
  _warnTimers[game] = setTimeout(() => hideShutdownWarning(game), 35000);
}
function hideShutdownWarning(game) { const el = document.getElementById('warn_'+game); if (el) el.classList.remove('show'); }

function toggleNavMenu() {
  document.getElementById('navMenuBtn').classList.toggle('open');
  document.getElementById('navDropdown').classList.toggle('open');
}
document.addEventListener('click', (e) => {
  const wrap = document.querySelector('.nav-menu-wrap');
  if (wrap && !wrap.contains(e.target)) {
    const btn = document.getElementById('navMenuBtn');
    const dd  = document.getElementById('navDropdown');
    if (btn) btn.classList.remove('open');
    if (dd)  dd.classList.remove('open');
  }
});
"""

if 'connectServerState' not in html:
    html = html.replace('function connectStatsFeed() {', socket_js + '\nfunction connectStatsFeed() {', 1)

html = html.replace('onload="connectStatsFeed()"', 'onload="connectServerState();connectStatsFeed();loadRecentEvents();"')
html = html.replace('\nloadRecentEvents();\nsetInterval(loadDashboard, 60000);\n', '\nsetInterval(loadDashboard, 60000);\n')
html = html.replace(
    "document.getElementById('adminLink').style.display = '';",
    "var al=document.getElementById('adminLink'); if(al) al.style.display='';",
    1
)

with open('/srv/games/public/index.html', 'w') as f:
    f.write(html)
print("saved", len(html), "chars")
