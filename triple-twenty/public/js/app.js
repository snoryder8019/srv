// ══════════════════════════════════════════════════
// Triple-Twenty — Global Client Script (app.js)
// Loaded on EVERY page via foot.ejs.
// Handles:
//   - Backend health dot
//   - Single shared socket (window._ttSocket)
//   - User room registration on every tab
//   - Cross-tab/cross-device turn & game notifications
//   - User dropdown menu
// ══════════════════════════════════════════════════

// ── Health dot ──
(async function checkHealth() {
  const dot = document.getElementById('healthDot');
  if (!dot) return;
  try {
    const d   = await fetch('/api/health').then(r => r.json());
    const up  = d.backend?.dartboard?.status === 'up';
    dot.style.background = up ? 'var(--green)' : 'var(--red)';
    dot.style.boxShadow  = up ? '0 0 6px var(--green)' : 'none';
    dot.title = up ? 'Dartboard API: online' : 'Dartboard API: offline';
  } catch {
    dot.style.background = 'var(--red)';
    dot.title = 'Backend unreachable';
  }
})();

// ── User dropdown ──
const _menuBtn  = document.getElementById('userMenuBtn');
const _dropdown = document.getElementById('userDropdown');
if (_menuBtn && _dropdown) {
  _menuBtn.addEventListener('click', e => {
    e.stopPropagation();
    _dropdown.classList.toggle('open');
  });
  document.addEventListener('click', () => _dropdown.classList.remove('open'));
}

// ══════════════════════════════════════════════════
// Shared Socket + User Room Registration
// ══════════════════════════════════════════════════
(function initGlobalSocket() {
  // Read the logged-in user's ID from the meta tags injected by head.ejs
  const metaId   = document.querySelector('meta[name="tt-user-id"]');
  const metaName = document.querySelector('meta[name="tt-user-name"]');
  const userId      = metaId   ? metaId.getAttribute('content')   : null;
  const displayName = metaName ? metaName.getAttribute('content') : null;

  // Create the single shared socket for this tab.
  // Other page scripts (camera.js, inline scoreboard script, etc.)
  // reuse this via: window._ttSocket || (window._ttSocket = io())
  const socket = window._ttSocket = io();

  // Once connected (or immediately if already connected) register the user room.
  function registerUser() {
    if (userId) socket.emit('register-user', { userId, displayName });
  }
  if (socket.connected) registerUser();
  socket.on('connect', registerUser);

  // ── YOUR TURN — fires on ALL open tabs/devices (multiplayer only) ──
  socket.on('your-turn', data => {
    showTurnToast(data);
    if (window.ttAudio) {
      window.ttAudio.play(data.soloMode ? 'yourTurnSolo' : 'yourTurnMulti');
    }
    _queueNotification({ ...data, type: 'your-turn' });
  });

  // ── GAME-OVER / other game notifications ──
  socket.on('game-notification', data => {
    showToast({
      type:    'info',
      icon:    '🏆',
      title:   data.message || 'Game update',
      sub:     data.gameName || '',
      link:    data.link,
      duration: 9000
    });
    _queueNotification(data);
  });

  // room-state: server confirms we're in the game room; no UI action needed globally
  socket.on('room-state', () => {});

  // Expose socket for page scripts
  window._ttSocket = socket;
})();

// ══════════════════════════════════════════════════
// Toast system
// ══════════════════════════════════════════════════
const _toastContainer = document.getElementById('turnToastContainer');

function showTurnToast({ gameId, gameName, mode, score, link, remoteLink }) {
  showToast({
    type:       'turn',
    icon:       '🎯',
    title:      'Your turn!',
    sub:        `${gameName || 'Game'} · ${score || ''}`,
    link:       link || (gameId ? `/camera/${gameId}` : '/'),
    remoteLink: remoteLink,
    duration:   14000
  });
}

function showToast({ type = 'info', icon = '', title, sub, link, remoteLink, duration = 8000 }) {
  if (!_toastContainer) return;

  const toast = document.createElement('div');
  toast.className = `tt-toast tt-toast-${type}`;
  toast.innerHTML = `
    <div class="tt-toast-icon">${icon}</div>
    <div class="tt-toast-body">
      <div class="tt-toast-msg">${title}</div>
      ${sub  ? `<div class="tt-toast-sub">${sub}</div>` : ''}
      <div class="tt-toast-actions">
        ${link       ? `<a href="${link}"       class="tt-toast-btn tt-toast-btn-primary">Open Game</a>` : ''}
        ${remoteLink ? `<a href="${remoteLink}" class="tt-toast-btn">Remote View</a>`                     : ''}
      </div>
    </div>
    <button class="tt-toast-close" aria-label="Dismiss">✕</button>
  `;

  _toastContainer.appendChild(toast);
  requestAnimationFrame(() => toast.classList.add('tt-toast-visible'));

  const timer = setTimeout(() => _dismissToast(toast), duration);
  toast.querySelector('.tt-toast-close').addEventListener('click', () => {
    clearTimeout(timer);
    _dismissToast(toast);
  });
}

function _dismissToast(toast) {
  toast.classList.remove('tt-toast-visible');
  setTimeout(() => toast.remove(), 400);
}

// ══════════════════════════════════════════════════
// Notification queue (for badge + dashboard use)
// ══════════════════════════════════════════════════
window._ttNotifications = window._ttNotifications || [];

function _queueNotification(data) {
  window._ttNotifications.unshift({ ...data, time: Date.now(), seen: false });
  if (window._ttNotifications.length > 30) window._ttNotifications.pop();
  // Update any notification badge on the page
  const badge = document.getElementById('notifBadge');
  if (badge) {
    const unseen = window._ttNotifications.filter(n => !n.seen).length;
    badge.textContent   = unseen || '';
    badge.style.display = unseen ? 'flex' : 'none';
  }
}

// ══════════════════════════════════════════════════
// Mini-toast (inline feedback, e.g. "Copied!")
// ══════════════════════════════════════════════════
window.showMiniToast = function(msg) {
  const t = document.createElement('div');
  t.className   = 'mini-toast';
  t.textContent = msg;
  document.body.appendChild(t);
  requestAnimationFrame(() => t.classList.add('mini-toast-visible'));
  setTimeout(() => {
    t.classList.remove('mini-toast-visible');
    setTimeout(() => t.remove(), 400);
  }, 2500);
};
