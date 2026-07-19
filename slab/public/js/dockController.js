/* dockController.js — collapse the bottom-right floating buttons into ONE dock.
 *
 * The admin portal piles up to five fixed elements up the right edge (agent ✦,
 * notification bell, bug/debug, tour/help, plus the superadmin badge) — each
 * injected by a different script at a different time. This controller adopts
 * whichever of those buttons exist into a single expandable cluster: at rest a
 * neutral toggle; tap to fan the tools out above it.
 *
 * Re-parenting a live DOM node keeps its own event listeners intact, so we only
 * neutralise each button's fixed positioning while it lives inside the dock. If
 * this script never loads, every button simply falls back to its old corner
 * position — graceful degradation.
 */
(function () {
  'use strict';

  // Trigger elements to adopt (NOT their overlays/modals, which stay on <body>).
  var ITEM_IDS = ['saFab', 'notifBell', 'slab-bug-btn', 'tour-help-btn'];
  // Expanded stacking order, top → bottom. Agent sits nearest the toggle.
  var ORDER = ['tour-help-btn', 'slab-bug-btn', 'notifBell', 'saFab'];

  // ── styles ────────────────────────────────────────────────────────────────
  var css = [
    // z-index below the overlays/modals (99997–100000) so opening the agent or
    // bug modal covers the dock, but well above ordinary page content.
    '#slabDock{position:fixed;right:24px;bottom:24px;z-index:99996;display:flex;',
      'flex-direction:column;align-items:center;gap:10px;}',
    '#slabDockItems{display:none;flex-direction:column;align-items:center;gap:10px;margin:0;padding:0;}',
    '#slabDock.open #slabDockItems{display:flex;}',
    // adopted buttons: strip their fixed positioning, let them flow in the dock
    '#slabDockItems > #saFab,#slabDockItems > #notifBell,',
      '#slabDockItems > #slab-bug-btn,#slabDockItems > #tour-help-btn{',
      'position:relative!important;top:auto!important;right:auto!important;',
      'bottom:auto!important;left:auto!important;margin:0!important;}',
    // entrance animation for each fanned item
    '#slabDockItems > *{opacity:0;transform:translateY(10px) scale(.94);',
      'transition:opacity .18s ease,transform .2s cubic-bezier(.2,.8,.3,1.1);}',
    '#slabDock.open #slabDockItems > *{opacity:1;transform:none;}',
    // toggle button — neutral 2×2 dot grid (deliberately NOT a sparkle)
    '#slabDockToggle{width:44px;height:44px;border-radius:50%;padding:0;cursor:pointer;',
      'border:1.5px solid rgba(201,168,72,.35);background:#1C2B4A;color:#C9A848;',
      'display:none;align-items:center;justify-content:center;position:relative;',
      'box-shadow:0 4px 16px rgba(15,27,48,.35);',
      'transition:transform .2s ease,box-shadow .15s;}',
    '#slabDockToggle:hover{transform:scale(1.08);box-shadow:0 6px 24px rgba(0,0,0,.3);}',
    '#slabDock.open #slabDockToggle{transform:rotate(45deg);}',
    '#slabDock.has-items #slabDockToggle{display:flex;}',
    '#slabDockToggle .dg{position:absolute;width:5px;height:5px;border-radius:50%;background:currentColor;}',
    '#slabDockToggle .dg-tl{top:13px;left:13px;}#slabDockToggle .dg-tr{top:13px;right:13px;}',
    '#slabDockToggle .dg-bl{bottom:13px;left:13px;}#slabDockToggle .dg-br{bottom:13px;right:13px;}',
    // unread marker on the collapsed toggle (mirrors the notif badge)
    '#slabDockAlert{position:absolute;top:-2px;right:-2px;width:12px;height:12px;',
      'border-radius:50%;background:#B91C1C;border:2px solid #1C2B4A;display:none;}',
    '#slabDock.has-alert:not(.open) #slabDockAlert{display:block;}',
    '@media (max-width:820px){#slabDock{right:16px;bottom:16px;}}'
  ].join('');
  var st = document.createElement('style');
  st.id = 'slabDockStyles';
  st.textContent = css;
  document.head.appendChild(st);

  // ── build dock ────────────────────────────────────────────────────────────
  var dock = document.createElement('div');
  dock.id = 'slabDock';
  var items = document.createElement('div');
  items.id = 'slabDockItems';
  var toggle = document.createElement('button');
  toggle.id = 'slabDockToggle';
  toggle.type = 'button';
  toggle.setAttribute('aria-label', 'Tools & alerts');
  toggle.setAttribute('aria-expanded', 'false');
  toggle.innerHTML =
    '<span class="dg dg-tl"></span><span class="dg dg-tr"></span>' +
    '<span class="dg dg-bl"></span><span class="dg dg-br"></span>' +
    '<span id="slabDockAlert"></span>';
  dock.appendChild(items);
  dock.appendChild(toggle);

  function mount() { if (document.body && !dock.parentNode) document.body.appendChild(dock); }
  if (document.body) mount();
  else document.addEventListener('DOMContentLoaded', mount);

  function orderIndex(id) { var i = ORDER.indexOf(id); return i < 0 ? 99 : i; }

  function adopt(el) {
    if (!el || el.parentNode === items) return;
    var ref = null, kids = items.children;
    for (var i = 0; i < kids.length; i++) {
      if (orderIndex(kids[i].id) > orderIndex(el.id)) { ref = kids[i]; break; }
    }
    items.insertBefore(el, ref);
    dock.classList.add('has-items');
    refreshAlert();
  }

  function sweep() {
    for (var i = 0; i < ITEM_IDS.length; i++) {
      var el = document.getElementById(ITEM_IDS[i]);
      if (el) adopt(el);
    }
  }

  function refreshAlert() {
    dock.classList.toggle('has-alert', !!document.querySelector('#notifBell .notif-badge'));
  }

  function setOpen(open) {
    dock.classList.toggle('open', open);
    toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
    if (open) void items.offsetHeight; // force reflow so the entrance animates
  }

  toggle.addEventListener('click', function (e) {
    e.stopPropagation();
    setOpen(!dock.classList.contains('open'));
  });
  document.addEventListener('click', function (e) {
    if (dock.classList.contains('open') && !dock.contains(e.target)) setOpen(false);
  });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && dock.classList.contains('open')) setOpen(false);
  });

  // Late-injected buttons (defer scripts, the dynamically-created tour button).
  var mo = new MutationObserver(function (muts) {
    for (var m = 0; m < muts.length; m++) {
      var added = muts[m].addedNodes;
      for (var n = 0; n < added.length; n++) {
        var node = added[n];
        if (node.nodeType !== 1) continue;
        if (ITEM_IDS.indexOf(node.id) >= 0) { adopt(node); continue; }
        if (node.querySelector) {
          for (var k = 0; k < ITEM_IDS.length; k++) {
            var found = document.getElementById(ITEM_IDS[k]);
            if (found && found.parentNode !== items) adopt(found);
          }
        }
      }
    }
    refreshAlert();
  });
  function observe() { if (document.body) mo.observe(document.body, { childList: true, subtree: true }); }
  if (document.body) observe();
  else document.addEventListener('DOMContentLoaded', observe);

  // Initial + a few delayed sweeps to catch buttons created by other defer scripts.
  sweep();
  document.addEventListener('DOMContentLoaded', sweep);
  var tries = 0;
  var iv = setInterval(function () { sweep(); refreshAlert(); if (++tries >= 12) clearInterval(iv); }, 300);
})();
