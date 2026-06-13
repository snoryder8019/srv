/**
 * tableclient3d.js — SHARED socket lifecycle + state plumbing for every game on
 * the tiles 3D table. One place to own the live-table protocol so camera/physics
 * aren't the only thing shared — the networking is too.
 *
 * It owns: connect/join via ?ticket, the table:state / seat:hand / table:event /
 * table:over stream, reconnect signalling, and the authoritative-private-view
 * gating discipline (the lesson from hearts: act off the private view ALONE).
 *
 * A game supplies hooks; the client calls them with parsed state. The game never
 * touches socket.io directly — it calls client.emitAction(...) / emitReady() etc.
 *
 *   import { createTableClient } from './tableclient3d.js';
 *   const C = createTableClient({
 *     onState(state) {...},      // full public state (state.view is the game view)
 *     onPriv(priv) {...},        // this seat's authoritative private view
 *     onEvent(ev) {...},         // table:event stream (plays, scoring, vote, …)
 *     onOver(over) {...},        // end-game payload (standings)
 *     onReconnect(on,msg,rejoin){...},
 *     onError(msg) {...},
 *   });
 *   C.ready();  C.addBot(seat);  C.emitAction({type:'play',card:'QS'});
 *   C.myTurn(); C.mySeat; C.state; C.priv;
 *
 * Authoritative-priv gating: emitPlayChecked() validates the chosen action is in
 * the current priv.legal + (for cards) priv.hand AND that it's our turn, before
 * sending — exactly the discipline that killed the stale-state illegal-play bug.
 */
export function createTableClient(hooks = {}) {
  const qs = new URLSearchParams(location.search);
  const ticket = qs.get('ticket');

  const client = {
    mySeat: null,
    state: null,
    priv: null,
    everConnected: false,
    socket: null,
    ticket,
  };

  const socket = io({ transports: ['websocket', 'polling'], withCredentials: true });
  client.socket = socket;

  socket.on('connect', () => {
    hooks.onReconnect && hooks.onReconnect(false);
    client.everConnected = true;
    if (ticket) socket.emit('table:join', { ticket });
    else hooks.onError && hooks.onError('no ?ticket= in URL');
  });
  socket.on('disconnect', () => hooks.onReconnect && hooks.onReconnect(true, 'Reconnecting…'));
  socket.on('table:error', (e) => {
    hooks.onError && hooks.onError(e.message);
    if (/ticket|expired|no such table/i.test(e.message || '')) hooks.onReconnect && hooks.onReconnect(true, 'Session expired —', true);
  });
  socket.on('seat:hand', (h) => { client.mySeat = h.seat; client.priv = h; hooks.onPriv && hooks.onPriv(h); });
  socket.on('table:state', (s) => { client.state = s; hooks.onState && hooks.onState(s); });
  socket.on('table:event', (ev) => hooks.onEvent && hooks.onEvent(ev));
  socket.on('table:over', (o) => hooks.onOver && hooks.onOver(o));

  // --- helpers ---
  client.myTurn = () => !!(client.priv && client.priv.yourTurn);

  // --- emitters ---
  client.ready = () => socket.emit('seat:ready', { ready: true });
  client.addBot = (seat) => socket.emit('seat:addBot', { seat });
  client.rematch = () => socket.emit('table:rematch');
  client.vote = (choice) => socket.emit('table:vote', { choice });
  client.emitAction = (action) => socket.emit('game:action', { action });

  // Authoritative-priv-gated play: the action must be in the current legal set and
  // (for card games) the card must be in hand, and it must be our turn. Matches the
  // discipline that prevents stale-state illegal plays. `match` decides equality.
  client.emitPlayChecked = (action, opts = {}) => {
    const priv = client.priv;
    if (!priv || !client.myTurn()) return false;
    const legal = priv.legal || [];
    const ok = legal.some((a) => {
      if (a.type !== action.type) return false;
      if (action.card != null) return a.card === action.card && (action.end == null || a.end === action.end);
      if (action.code != null) return a.code === action.code && (action.end == null || a.end === action.end);
      return true;
    });
    if (!ok) return false;
    if (action.card != null && opts.requireInHand !== false) {
      const inHand = (priv.hand || []).some((c) => (typeof c === 'string' ? c : c.code) === action.card);
      if (!inHand) return false;
    }
    socket.emit('game:action', { action });
    return true;
  };

  return client;
}
