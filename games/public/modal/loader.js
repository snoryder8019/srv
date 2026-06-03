/* Arcade global-modal loader — injected by every Arcade surface with one line:
 *   <script src="https://games.madladslab.com/modal/loader.js" defer
 *           data-surface="cards" data-game="euchre"></script>
 *
 * Mounts a floating launcher + a games-served iframe overlay (the panel). On
 * cross-origin surfaces it fetches a short-lived "modal ticket" from the host
 * surface's own mint endpoint and relays it into the iframe so the panel can
 * bind the viewer's screen-name identity for chat. The panel handles chat,
 * leaderboards and nav; this loader only mounts + relays + toggles.
 */
(function () {
  if (window.__arcadeModalLoaded) return;
  window.__arcadeModalLoaded = true;

  var GAMES = 'https://games.madladslab.com';
  var cur = document.currentScript || (function () {
    var s = document.getElementsByTagName('script'); return s[s.length - 1];
  })();
  var SURFACE = (cur && cur.getAttribute('data-surface')) || 'arcade';
  var GAME = (cur && cur.getAttribute('data-game')) || '';
  // where THIS surface mints a modal ticket (server-side, shares BRIDGE_SECRET).
  // portal is same-origin to games so it needs no ticket; others default to
  // their own origin + /modal-ticket (added to cards & match).
  var MINT = (cur && cur.getAttribute('data-mint')) || (location.origin + '/modal-ticket');
  var IS_PORTAL = (location.origin === GAMES);

  // ---- launcher button ----
  var btn = document.createElement('button');
  btn.id = 'arcadeModalBtn';
  btn.setAttribute('aria-label', 'Arcade chat & menu');
  btn.innerHTML = '\uD83D\uDCAC';
  btn.style.cssText = [
    'position:fixed', 'left:14px', 'bottom:14px', 'z-index:2147483000',
    'width:48px', 'height:48px', 'border-radius:50%', 'border:1px solid rgba(255,255,255,.18)',
    'background:#11201a', 'color:#e9ecef', 'font-size:22px', 'cursor:pointer',
    'box-shadow:0 8px 24px rgba(0,0,0,.5)', 'line-height:1'
  ].join(';');

  // ---- overlay + iframe ----
  var overlay = document.createElement('div');
  overlay.id = 'arcadeModalOverlay';
  overlay.style.cssText = [
    'position:fixed', 'inset:0', 'z-index:2147483001', 'display:none',
    'background:rgba(0,0,0,.45)', 'backdrop-filter:blur(2px)'
  ].join(';');

  var panel = document.createElement('div');
  panel.style.cssText = [
    'position:fixed', 'left:0', 'bottom:0', 'top:0',
    'width:min(420px,92vw)', 'background:#0c1410',
    'box-shadow:8px 0 40px rgba(0,0,0,.6)', 'transform:translateX(-104%)',
    'transition:transform .22s ease', 'display:flex', 'flex-direction:column'
  ].join(';');

  var bar = document.createElement('div');
  bar.style.cssText = 'display:flex;justify-content:flex-end;padding:6px;background:#0c1410';
  var close = document.createElement('button');
  close.innerHTML = '\u2715';
  close.style.cssText = 'background:transparent;border:none;color:#9fb0a6;font-size:20px;cursor:pointer;padding:6px 10px';
  bar.appendChild(close);

  var iframe = document.createElement('iframe');
  iframe.title = 'Arcade';
  iframe.style.cssText = 'flex:1 1 auto;width:100%;border:0;background:#0c1410';
  iframe.setAttribute('allow', 'clipboard-write');

  panel.appendChild(bar); panel.appendChild(iframe);
  overlay.appendChild(panel);

  var loaded = false, openState = false, ticketRequested = false;
  function panelSrc() {
    return GAMES + '/modal/panel#surface=' + encodeURIComponent(SURFACE) + (GAME ? '&game=' + encodeURIComponent(GAME) : '');
  }

  function open() {
    if (!loaded) { iframe.src = panelSrc(); loaded = true; }
    overlay.style.display = 'block';
    requestAnimationFrame(function () { panel.style.transform = 'translateX(0)'; });
    openState = true;
  }
  function hide() {
    panel.style.transform = 'translateX(-104%)';
    openState = false;
    setTimeout(function () { if (!openState) overlay.style.display = 'none'; }, 220);
  }
  btn.onclick = function () { openState ? hide() : open(); };
  close.onclick = hide;
  overlay.addEventListener('click', function (e) { if (e.target === overlay) hide(); });

  // ---- identity relay: panel asks "ready", we fetch a ticket and post it back ----
  function sendTicketToPanel() {
    if (IS_PORTAL) return; // same-origin: panel uses the session, no ticket needed
    if (ticketRequested) return; ticketRequested = true;
    fetch(MINT, { method: 'POST', credentials: 'include', headers: { 'content-type': 'application/json' },
                  body: JSON.stringify({ surface: SURFACE }) })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (d) {
        if (d && d.ticket && iframe.contentWindow) {
          iframe.contentWindow.postMessage({ type: 'arcade-modal:ticket', ticket: d.ticket }, GAMES);
        }
      })
      .catch(function () { /* panel will fall back to session-only (likely fails cross-origin) */ });
  }

  window.addEventListener('message', function (ev) {
    if (ev.origin !== GAMES || !ev.data) return;
    if (ev.data.type === 'arcade-modal:ready') sendTicketToPanel();
    if (ev.data.type === 'arcade-modal:navigate' && ev.data.url) { window.top.location.href = ev.data.url; }
  });

  function mount() {
    document.body.appendChild(btn);
    document.body.appendChild(overlay);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount);
  else mount();
})();
