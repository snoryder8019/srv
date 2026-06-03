/**
 * Socket layer for live tables. Transport + broadcasting only; all game logic is
 * in the TableRuntime + variant.
 *
 * Client -> server:
 *   table:join    { ticket }            // matchmaking handoff (or dev ticket)
 *   seat:ready    { ready }
 *   seat:addBot   { seat }              // bot fill on request
 *   game:action   { action }            // variant-specific (play/bid/...)
 *   table:vote    { choice }            // 'wait' | 'kick' during a timeout vote
 *   table:rematch {}                    // at game over: ready up for a new game
 *   table:reseat  { perm }              // rearrange occupants (lobby/gameOver)
 *   table:exit    {}                    // leave the table (frees the seat)
 *
 * Server -> client:
 *   table:state   <public snapshot>     // includes turn clock + vote tally
 *   seat:hand     <private>             // that seat's cards + legal
 *   table:event   <event>              // play/trickWon/handWon/gameOver/turn+vote events
 *   table:over    <final standings>    // end-game screen payload
 *   table:error   { message }
 */
import { createTable, getTable } from '../lib/tables.js';
import { verifyTicket } from '../lib/tickets.js';
import { reportGameResult } from '../lib/stats.js';
import { TIMING } from '../lib/table.js';

const room = (id) => `table:${id}`;
const rand = (a, b) => a + Math.floor(Math.random() * (b - a));

// Once per finished game: export stats (best-effort, async) + emit the end screen.
async function finishIfOver(io, table) {
  if (table.phase !== 'gameOver' || table._finished) return;
  table._finished = true;
  io.to(room(table.tableId)).emit('table:over', {
    tableId: table.tableId,
    game: table.game,
    scores: table.scores.slice(),
    winnerTeam: table.winnerTeam,
    standings: table.standings(),
    tally: table.tally,
    gamesPlayed: table.gamesPlayed + 1,
  });
  reportGameResult(table)
    .then((r) => console.log(`[cards] stats exported for ${table.tableId}:`, JSON.stringify(r)))
    .catch((e) => console.warn('[cards] stats export error:', e.message));
}

async function broadcast(io, table, events = []) {
  const r = room(table.tableId);
  for (const ev of events) io.to(r).emit('table:event', ev);
  table.armTurnClock();
  io.to(r).emit('table:state', table.publicState());
  const sockets = await io.in(r).fetchSockets();
  for (const s of sockets) {
    if (s.data.seat != null) s.emit('seat:hand', table.privateState(s.data.seat));
  }
  await finishIfOver(io, table);
}

// Run pending bot turns with a natural delay between each, broadcasting as they go.
// (Bots used to resolve instantly; the delay makes play readable + paces takeovers.)
// Which bot seats can act RIGHT NOW. Normally just the seat on turn, but some
// phases are simultaneous (e.g. hearts passing) where every un-acted bot should
// move regardless of seat order. A variant may expose botSeatsToAct(table); else
// we fall back to the single current-turn seat.
function botSeatsPending(table) {
  if (typeof table.variant.botSeatsToAct === 'function') {
    return table.variant.botSeatsToAct(table).filter((seat) => table.seats[seat] && table.seats[seat].bot);
  }
  const seat = table.variant.currentTurn(table);
  return (seat != null && table.seats[seat] && table.seats[seat].bot) ? [seat] : [];
}

async function runBotsPaced(io, table) {
  let guard = 0;
  while (table.phase === 'playing' && guard < 400) {
    guard += 1;
    const pending = botSeatsPending(table);
    if (!pending.length) break;
    const seat = pending[0];
    await new Promise((res) => setTimeout(res, rand(TIMING.botMinMs, TIMING.botMaxMs)));
    if (table.phase !== 'playing') break;
    // re-confirm this seat still needs to act after the delay
    if (!botSeatsPending(table).includes(seat)) continue;
    const action = table.variant.botAction(table, seat);
    if (!action) { // nothing to do for this seat; avoid spinning
      if (botSeatsPending(table).length === 1) break;
      continue;
    }
    const r = table.submit(seat, action);
    if (!r.ok) break;
    await broadcast(io, table, r.events);
    if (r.gameOver) break;
  }
}

async function advance(io, table) {
  let events = [];
  if (table.maybeStart()) events.push({ type: 'gameStart', handNo: table.handNo, dealer: table.dealer });
  await broadcast(io, table, events);
  await runBotsPaced(io, table);
}

// After a reseat, each connected socket's seat index changes — resync by identity.
async function resyncSeats(io, table, map) {
  if (!map) return;
  const sockets = await io.in(room(table.tableId)).fetchSockets();
  for (const s of sockets) {
    const pid = s.data.platformId;
    if (pid != null && map[pid] != null) s.data.seat = map[pid];
  }
}

// ---- per-table clock: fires turn timeouts + resolves votes ----
const clocks = new Map(); // tableId -> intervalId
function startClock(io, table) {
  if (clocks.has(table.tableId)) return;
  const id = setInterval(() => tick(io, table).catch(() => {}), 1000);
  clocks.set(table.tableId, id);
}
function stopClock(tableId) {
  const id = clocks.get(tableId);
  if (id) { clearInterval(id); clocks.delete(tableId); }
}

async function tick(io, table) {
  const r = room(table.tableId);
  if (table.turnExpired()) {
    const seat = table.turnSeat;
    const seatObj = table.seats[seat];
    const present = table.seatPresent(seat);
    // Other connected humans who could vote (excludes the seat itself + bots).
    const otherHumans = table.seats.filter((x) => x.platformId && !x.bot && x.connected && x.seat !== seat).length;

    if (present && otherHumans === 0) {
      // Solo, still here, just slow -> nudge with a fresh clock. NEVER auto-replace.
      table.turnDeadline = Date.now() + TIMING.turnMs;
      io.to(r).emit('table:event', { type: 'turn:nudge', seat, displayName: seatObj.displayName });
      io.to(r).emit('table:state', table.publicState());
      return;
    }
    if (!present && otherHumans === 0) {
      // Genuinely gone and no one to vote -> take over with a bot.
      table.openVote();
      const seatName = seatObj.displayName;
      const outcome = table.resolveVote(); // resolves to 'kick' because the seat is absent
      io.to(r).emit('table:event', { type: 'turn:timeout', seat, displayName: seatName });
      if (outcome) await applyVoteOutcome(io, table, seat, outcome);
      else io.to(r).emit('table:state', table.publicState());
      return;
    }
    // Multiple humans -> open a wait/kick vote.
    table.openVote();
    const tally = table.voteTally();
    io.to(r).emit('table:event', { type: 'turn:timeout', seat, displayName: seatObj.displayName });
    io.to(r).emit('table:event', { type: 'vote:open', ...tally });
    io.to(r).emit('table:state', table.publicState());
    const outcome = table.resolveVote();
    if (outcome) await applyVoteOutcome(io, table, seat, outcome);
    return;
  }
  // an open vote may resolve on its own deadline
  if (table.vote) {
    const seat = table.vote.seat;
    const outcome = table.resolveVote();
    if (outcome) await applyVoteOutcome(io, table, seat, outcome);
    else io.to(r).emit('table:state', table.publicState());
  }
}

async function applyVoteOutcome(io, table, seat, outcome) {
  const r = room(table.tableId);
  io.to(r).emit('table:event', { type: 'vote:result', seat, outcome });
  if (outcome === 'kick') {
    io.to(r).emit('table:event', { type: 'seat:kicked', seat, displayName: table.seats[seat].displayName });
  }
  await broadcast(io, table);
  if (outcome === 'kick') await runBotsPaced(io, table); // bot takes over immediately
}

export function attachTableSockets(io) {
  io.on('connection', (socket) => {
    socket.data.user = socket.request.session?.user || null;

    socket.on('table:join', async (payload = {}) => {
      try {
        let table; let seat; let identity;
        if (payload.ticket) {
          const t = verifyTicket(payload.ticket);
          if (!t) return socket.emit('table:error', { message: 'invalid or expired ticket' });
          table = getTable(t.tableId) || createTable({
            tableId: t.tableId, game: t.game, config: t.params || {}, players: t.players || [],
          });
          seat = t.seat;
          identity = { platformId: t.platformId, displayName: t.displayName };
        } else if (payload.tableId != null && payload.seat != null && socket.data.user) {
          table = getTable(payload.tableId);
          if (!table) return socket.emit('table:error', { message: 'no such table' });
          seat = payload.seat;
          identity = { platformId: socket.data.user.platformId, displayName: socket.data.user.displayName };
        } else {
          return socket.emit('table:error', { message: 'ticket required' });
        }

        if (!table.seats[seat]?.platformId) table.seatPlayer(seat, { ...identity });
        socket.data.tableId = table.tableId;
        socket.data.seat = seat;
        socket.data.platformId = identity.platformId != null ? String(identity.platformId) : null;
        socket.join(room(table.tableId));
        table.setConnected(seat, true);
        startClock(io, table);

        socket.emit('table:state', table.publicState());
        socket.emit('seat:hand', table.privateState(seat));
        await advance(io, table);
      } catch (e) {
        socket.emit('table:error', { message: e.message });
      }
    });

    socket.on('seat:ready', async ({ ready = true } = {}) => {
      const table = getTable(socket.data.tableId);
      if (!table || socket.data.seat == null) return;
      table.setReady(socket.data.seat, ready);
      await advance(io, table);
    });

    socket.on('seat:addBot', async ({ seat } = {}) => {
      const table = getTable(socket.data.tableId);
      if (!table) return;
      if (seat == null || table.seats[seat]?.platformId) return;
      table.seatPlayer(seat, { bot: true });
      await advance(io, table);
    });

    socket.on('game:action', async ({ action } = {}) => {
      const table = getTable(socket.data.tableId);
      if (!table || socket.data.seat == null) return;
      // acting cancels any pending vote against this very seat (they showed up)
      if (table.vote && table.vote.seat === socket.data.seat) table.vote = null;
      const r = table.submit(socket.data.seat, action);
      if (!r.ok) return socket.emit('table:error', { message: r.error });
      await broadcast(io, table, r.events);
      await runBotsPaced(io, table);
    });

    // wait / kick vote during a turn timeout
    socket.on('table:vote', async ({ choice } = {}) => {
      const table = getTable(socket.data.tableId);
      if (!table || !table.vote || socket.data.platformId == null) return;
      const seatBefore = table.vote.seat;
      const tally = table.castVote(socket.data.platformId, choice === 'kick' ? 'kick' : 'wait');
      if (tally) io.to(room(table.tableId)).emit('table:event', { type: 'vote:update', ...tally });
      const outcome = table.resolveVote();
      if (outcome) await applyVoteOutcome(io, table, seatBefore, outcome);
      else io.to(room(table.tableId)).emit('table:state', table.publicState());
    });

    // End-game: rematch = "ready up for a new game". The first requester after a
    // game ends resets the table to a fresh lobby; everyone re-readies to start.
    socket.on('table:rematch', async () => {
      const table = getTable(socket.data.tableId);
      if (!table || socket.data.seat == null) return;
      if (table.phase === 'gameOver') { table.rematch(); table._finished = false; }
      if (table.phase !== 'lobby') return;
      table.setReady(socket.data.seat, true);
      io.to(room(table.tableId)).emit('table:event', { type: 'rematch', by: socket.data.seat });
      await advance(io, table);
    });

    socket.on('table:reseat', async ({ perm } = {}) => {
      const table = getTable(socket.data.tableId);
      if (!table) return;
      const map = table.reseat(perm);
      if (!map) return socket.emit('table:error', { message: 'cannot reseat now' });
      await resyncSeats(io, table, map);
      io.to(room(table.tableId)).emit('table:event', { type: 'reseat' });
      await broadcast(io, table);
    });

    socket.on('table:exit', async () => {
      const table = getTable(socket.data.tableId);
      if (!table || socket.data.seat == null) return;
      const seat = socket.data.seat;
      socket.leave(room(table.tableId));
      socket.data.seat = null;
      table.vacate(seat);
      io.to(room(table.tableId)).emit('table:event', { type: 'left', seat });
      io.to(room(table.tableId)).emit('table:state', table.publicState());
    });

    socket.on('disconnect', () => {
      const table = getTable(socket.data.tableId);
      if (table && socket.data.seat != null) {
        table.setConnected(socket.data.seat, false);
        io.to(room(table.tableId)).emit('table:state', table.publicState());
      }
    });
  });
}
