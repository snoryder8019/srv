/**
 * roomShell.js — the persistent "My Tables" room shell (up to 3 games per player).
 *
 * The vision: stay in the room, hold up to 3 games at once, SEE when it's your
 * turn on any of them, and switch (manually or automatically) to the one that
 * needs you. This module is the nervous system for that:
 *
 *   • As you enter each table, its ticket is remembered (localStorage, cap 3,
 *     deduped by tableId) — so your games persist across navigations.
 *   • It opens ONE lightweight awareness socket and registers those tickets via
 *     `room:hello`. The server joins their rooms; we receive each table's public
 *     `table:state` and compute whose-turn from turn.seat — no server game changes.
 *   • A compact, mobile-first rail shows each game with a live "YOUR TURN" badge.
 *     Tap one to switch; toggle ⚡ to auto-switch to whichever table needs you.
 *
 * Mounted by table3d (every shared game) and dominoes — same pattern as camDebug.
 * NOTE: switching currently navigates to that table's lobby (reuses the existing
 * per-game client). The single-canvas "fly between tables" upgrade rides on the
 * multi-table action socket, a later phase.
 */

const PORTAL = 'https://games.madladslab.com';
const LS_TICKETS = 'room.tickets';
const LS_AUTO = 'room.autoswitch';
const CAP = 3;

function decodeJwt(tok) {
  try {
    const p = tok.split('.')[1];
    return JSON.parse(atob(p.replace(/-/g, '+').replace(/_/g, '/')));
  } catch (e) { return null; }
}
function loadTickets() { try { return JSON.parse(localStorage.getItem(LS_TICKETS)) || []; } catch (e) { return []; } }
function saveTickets(list) { localStorage.setItem(LS_TICKETS, JSON.stringify(list.slice(0, CAP))); }
const cap = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s);

export function mountRoomShell(opts = {}) {
  if (document.getElementById('roomRail')) return null;
  if (typeof window.io !== 'function') return null;   // socket.io global not present

  // 1) remember the table we're on (front of the list, deduped by tableId)
  const url = new URLSearchParams(location.search);
  const ticket = opts.ticket || url.get('ticket');
  let tickets = loadTickets();
  const here = ticket ? decodeJwt(ticket) : null;
  const curId = here && here.tableId;
  if (ticket && here && here.tableId) {
    tickets = tickets.filter((t) => t.tableId !== here.tableId);
    tickets.unshift({ tableId: here.tableId, game: here.game, seat: here.seat, ticket });
    tickets = tickets.slice(0, CAP);
    saveTickets(tickets);
  }
  if (!tickets.length) return null;   // nothing to track yet

  // The always-on right-side rail was removed (it covered the volume control).
  // Instead we hang two controls in the scene's existing top bar: 🚪 Leave and a
  // ☰ Tables menu (switch among your open tables · auto-switch · per-table leave).
  // The menu is a left-anchored dropdown so it never covers the right-side volume.
  let auto = localStorage.getItem(LS_AUTO) !== '0';
  const slots = new Map();   // tableId -> { game, seat, phase, yourTurn }
  tickets.forEach((t) => slots.set(t.tableId, { game: t.game, seat: t.seat, phase: '…', yourTurn: false }));
  const autoSwitched = new Set();   // tableIds we've already auto-jumped for (per turn)

  // ---- scene controls: inject Leave + Tables into the topbar (or float, as a fallback) ----
  const topbar = document.getElementById('topbar');
  const host = topbar || (() => {
    const f = document.createElement('div');
    f.style.cssText = 'position:fixed;left:8px;top:8px;z-index:60;display:flex;gap:8px;pointer-events:auto';
    document.body.appendChild(f); return f;
  })();

  const tablesBtn = document.createElement('button');
  tablesBtn.id = 'roomTablesBtn';
  tablesBtn.className = topbar ? 'iconbtn' : '';
  tablesBtn.title = 'My tables';
  if (!topbar) tablesBtn.style.cssText = 'border:none;border-radius:9px;padding:6px 9px;cursor:pointer;background:rgba(8,18,13,.92);color:#8fd6ad;font:800 13px system-ui';

  const leaveBtn = document.createElement('button');
  leaveBtn.id = 'roomLeaveBtn';
  leaveBtn.className = topbar ? 'iconbtn' : '';
  leaveBtn.title = 'Leave this table';
  leaveBtn.textContent = '🚪';
  if (!topbar) leaveBtn.style.cssText = 'border:none;border-radius:9px;padding:6px 9px;cursor:pointer;background:rgba(40,12,12,.92);color:#f0c9c9;font:800 13px system-ui';
  leaveBtn.onclick = () => { if (curId) leave(curId); };

  // dropdown menu (hidden until ☰ tapped), anchored under the buttons on the LEFT
  const menu = document.createElement('div');
  menu.id = 'roomTablesMenu';
  menu.style.cssText = 'position:fixed;left:8px;top:52px;z-index:160;display:none;flex-direction:column;gap:7px;' +
    'width:208px;max-width:70vw;pointer-events:auto;background:rgba(8,18,13,.96);border:1px solid rgba(120,200,160,.3);' +
    'border-radius:12px;padding:9px;box-shadow:0 14px 40px rgba(0,0,0,.55)';
  document.body.appendChild(menu);
  let menuOpen = false;
  function toggleMenu(on) { menuOpen = on != null ? on : !menuOpen; menu.style.display = menuOpen ? 'flex' : 'none'; if (menuOpen) render(); }
  tablesBtn.onclick = (e) => { e.stopPropagation(); toggleMenu(); };
  document.addEventListener('pointerdown', (e) => { if (menuOpen && !menu.contains(e.target) && e.target !== tablesBtn) toggleMenu(false); });

  // place the buttons: in the topbar they ride the existing icon row; floating, the host box
  host.appendChild(tablesBtn);
  host.appendChild(leaveBtn);

  function render() {
    tablesBtn.textContent = topbar ? `☰ ${tickets.length}` : `☰ Tables ${tickets.length}`;
    if (!menuOpen) return;
    menu.innerHTML = '';
    // header: count + auto toggle
    const head = document.createElement('div');
    head.style.cssText = 'display:flex;align-items:center;gap:6px;font:700 11px system-ui;color:#8fd6ad';
    head.innerHTML = `<span>MY TABLES ${tickets.length}/${CAP}</span><div style="flex:1"></div>`;
    const autoBtn = document.createElement('button');
    autoBtn.textContent = auto ? '⚡ auto' : '⚡ off';
    autoBtn.title = 'Auto-switch to the table where it is your turn';
    autoBtn.style.cssText = 'border:none;border-radius:7px;cursor:pointer;font:800 10px system-ui;padding:4px 7px;' +
      (auto ? 'background:#43e08a;color:#05230f' : 'background:#243a30;color:#cfe7d8');
    autoBtn.onclick = () => { auto = !auto; localStorage.setItem(LS_AUTO, auto ? '1' : '0'); render(); };
    head.appendChild(autoBtn);
    menu.appendChild(head);

    for (const [tableId, s] of slots) {
      const isCur = tableId === curId;
      const card = document.createElement('div');
      card.style.cssText = 'position:relative;border:1px solid ' +
        (s.yourTurn ? 'rgba(227,197,103,.9)' : isCur ? 'rgba(120,200,160,.5)' : 'rgba(255,255,255,.12)') + ';' +
        'border-radius:10px;padding:7px 9px;color:#e9ecef;font:700 13px system-ui;' +
        'background:' + (isCur ? 'rgba(20,48,34,.95)' : 'rgba(8,18,13,.6)') + ';' +
        (s.yourTurn ? 'animation:roomPulse 1.3s ease-in-out infinite;' : '');
      const turn = s.yourTurn ? '<span style="color:#e3c567">● YOUR TURN</span>'
        : `<span style="color:#7e9388;font-weight:500">${s.phase === 'playing' ? 'in play' : s.phase}</span>`;
      const main = document.createElement('div');
      main.style.cssText = 'cursor:pointer;padding-right:18px';
      main.innerHTML = `<div style="display:flex;justify-content:space-between;align-items:center">` +
        `<span>${cap(s.game)}</span>${isCur ? '<span style="color:#43e08a;font-size:10px">▶ here</span>' : ''}</div>` +
        `<div style="font-size:11px;margin-top:3px">${turn}</div>`;
      main.onclick = () => { if (!isCur) switchTo(tableId); };
      card.appendChild(main);
      const x = document.createElement('button');
      x.textContent = '✕'; x.title = 'Leave this game';
      x.style.cssText = 'position:absolute;top:5px;right:6px;width:18px;height:18px;line-height:1;padding:0;' +
        'border:none;border-radius:6px;background:rgba(90,30,30,.7);color:#f0c9c9;font-size:11px;cursor:pointer';
      x.onclick = (e) => { e.stopPropagation(); leave(tableId); };
      card.appendChild(x);
      menu.appendChild(card);
    }

    // add a table → arcade launcher (parity with tapping another game's satellite)
    if (tickets.length < CAP) {
      const add = document.createElement('button');
      add.textContent = '＋ add table';
      add.style.cssText = 'border:1px dashed rgba(120,200,160,.4);border-radius:10px;padding:7px;' +
        'cursor:pointer;background:transparent;color:#8fd6ad;font:700 12px system-ui';
      add.onclick = () => { location.href = `${PORTAL}/#arcade`; };
      menu.appendChild(add);
    }
  }

  function switchTo(tableId) {
    const t = tickets.find((x) => x.tableId === tableId);
    if (!t) return;
    location.href = `/lobby/${encodeURIComponent(t.game)}?ticket=${encodeURIComponent(t.ticket)}`;
  }

  // Leave a game: vacate the seat server-side (via the ticket) and forget it
  // locally. Leaving the table you're ON sends you to another of your games, or
  // the arcade if none remain.
  function leave(tableId) {
    const t = tickets.find((x) => x.tableId === tableId);
    if (t && sock && sock.connected) sock.emit('room:leave', { ticket: t.ticket });
    drop(tableId);
    if (tableId === curId) {
      const next = tickets[0];
      location.href = next ? `/lobby/${encodeURIComponent(next.game)}?ticket=${encodeURIComponent(next.ticket)}` : `${PORTAL}/#arcade`;
    }
  }
  // Remove a table from My Tables (used by leave + auto-prune of dead instances).
  function drop(tableId) {
    tickets = tickets.filter((x) => x.tableId !== tableId);
    saveTickets(tickets);
    slots.delete(tableId);
    render();
  }

  // bridge for the 3D parlor: satellites ask "is this my table?" + "fly me there"
  window.__mllRoom = {
    isMine: (id) => tickets.some((t) => t.tableId === id),
    switchTo,
  };

  // 3) awareness socket
  const sock = window.io({ transports: ['websocket', 'polling'], withCredentials: true });
  const sayHello = () => sock.emit('room:hello', { tickets: tickets.map((t) => t.ticket) });
  sock.on('connect', sayHello);
  // parlor-wide big wins → pop the from-afar animation on that satellite
  sock.on('parlor:win', (w) => { if (w && w.tableId && window.__mllParlor && window.__mllParlor.bigWin) window.__mllParlor.bigWin(w.tableId, w.amount, w.name); });
  // live floor feed → keep the 3D scene's satellite tables fresh (no stale poll)
  sock.on('parlor:tables', ({ tables = [] } = {}) => { if (window.__mllParlor && window.__mllParlor.setTables) window.__mllParlor.setTables(tables); });

  function ingest(tableId, phase, turnSeat) {
    const s = slots.get(tableId); if (!s) return;
    const wasTurn = s.yourTurn;
    s.phase = phase;
    s.yourTurn = phase === 'playing' && turnSeat === s.seat;
    if (!s.yourTurn) autoSwitched.delete(tableId);   // reset once the turn passes
    // auto-switch: a NON-current table just became your turn
    if (auto && s.yourTurn && !wasTurn && tableId !== curId && !autoSwitched.has(tableId)) {
      autoSwitched.add(tableId);
      flashAndSwitch(tableId);
    }
    render();
  }
  sock.on('room:slots', ({ slots: arr = [] } = {}) => {
    arr.forEach((s) => {
      // 'gone' = the server has no live instance for this ticket (reaped or
      // wiped on restart). Drop it so we never show phantom games — EXCEPT the
      // table we're currently on, which the game page will (re)create on join.
      if (s.phase === 'gone' && s.tableId !== curId) { drop(s.tableId); return; }
      const cur = slots.get(s.tableId) || {};
      slots.set(s.tableId, { game: s.game || cur.game, seat: s.seat, phase: s.phase, yourTurn: s.yourTurn });
    });
    render();
  });
  sock.on('room:left', ({ tableId } = {}) => { if (tableId) drop(tableId); });
  sock.on('table:state', (st) => { if (st && st.tableId) ingest(st.tableId, st.phase, st.turn && st.turn.seat); });

  function flashAndSwitch(tableId) {
    const t = tickets.find((x) => x.tableId === tableId);
    const toast = document.createElement('div');
    toast.style.cssText = 'position:fixed;left:50%;top:18px;transform:translateX(-50%);z-index:300;background:#1a1206;' +
      'border:1px solid #e3c567;color:#ffe9a8;border-radius:12px;padding:10px 16px;font:800 14px system-ui;' +
      'box-shadow:0 12px 40px rgba(0,0,0,.55)';
    toast.textContent = `⚡ Your turn at ${cap(t ? t.game : 'another table')} — switching…`;
    document.body.appendChild(toast);
    setTimeout(() => switchTo(tableId), 1100);
  }

  // pulse keyframes + small-screen retouch (once)
  if (!document.getElementById('roomShellCss')) {
    const st = document.createElement('style'); st.id = 'roomShellCss';
    st.textContent =
      '@keyframes roomPulse{0%,100%{box-shadow:0 4px 14px rgba(0,0,0,.4)}50%{box-shadow:0 0 18px rgba(227,197,103,.7)}}' +
      // let the top control bar wrap instead of overflowing once we add ☰/🚪,
      // and give every icon button a finger-sized tap target on phones.
      '@media (max-width:560px){' +
        '#topbar{flex-wrap:wrap;row-gap:6px;padding:6px 8px}' +
        '#topbar .iconbtn{min-width:38px;min-height:34px;font-size:16px}' +
        '#roomTablesMenu{top:auto;bottom:8px;left:8px;max-width:84vw}' +
        '#controls{bottom:14px;gap:6px}' +
      '}';
    document.head.appendChild(st);
  }

  render();   // set the ☰ button label now (menu stays closed until tapped)
  return { refresh: sayHello };
}

export default { mountRoomShell };
