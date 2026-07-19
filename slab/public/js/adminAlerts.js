/**
 * Slab — In-panel Admin Alerts
 * ─────────────────────────────────────────────────────────────────────────────
 * Loaded on every admin page (admin head). Connects to the /chat socket, which
 * auto-joins the admin to their tenant-wide `admin:<db>` room, and pops a
 * SlabFlash toast when a support event fires — a visitor starting a chat or a
 * captured lead/CTA — regardless of which page the admin is on. Click the toast
 * to jump to Chat Control.
 *
 * Self-contained: pulls in socket.io only if the page didn't already (the Chat
 * Control page loads its own), so there's no double-load.
 */
(function () {
  'use strict';
  if (window.__slabAdminAlerts) return;
  window.__slabAdminAlerts = true;

  function ensureIo(cb) {
    if (typeof io !== 'undefined') return cb();
    var existing = document.querySelector('script[data-slab-io]');
    if (existing) { existing.addEventListener('load', cb); return; }
    var s = document.createElement('script');
    s.src = '/socket.io/socket.io.js'; s.setAttribute('data-slab-io', '1');
    s.onload = cb; s.onerror = function () { /* socket unavailable — non-fatal */ };
    document.head.appendChild(s);
  }

  function onAlert(a) {
    if (!a) return;
    if (!(window.SlabFlash && SlabFlash.show)) return; // flash not ready → drop it
    var msg = (a.title || 'Notice') + (a.body ? ' — ' + a.body : '');
    var type = a.kind === 'lead' ? 'success' : 'info';
    var h = SlabFlash.show(msg, type, { timeout: 9000 });
    if (h && h.el) {
      h.el.style.cursor = 'pointer';
      h.el.title = 'Open Chat Control';
      h.el.addEventListener('click', function (e) {
        if (e.target && e.target.classList && e.target.classList.contains('slab-flash-x')) return;
        window.location.href = '/admin/chat';
      });
    }
  }

  function connect() {
    ensureIo(function () {
      if (typeof io === 'undefined') return;
      try {
        var s = io('/chat', { path: '/socket.io', withCredentials: true });
        s.on('admin:alert', onAlert);
      } catch (e) { /* non-fatal */ }
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', connect);
  else connect();
})();
