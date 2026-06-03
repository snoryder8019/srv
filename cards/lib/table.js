/**
 * TableRuntime — a single live table. Game-agnostic: owns seats, connections,
 * phase, dealer rotation, team scores, and advancing to the next hand. All card
 * logic is delegated to the variant (lib/variants/*). One TableRuntime per table;
 * the socket layer (services/socket.js) handles transport + broadcasting.
 *
 * Phases: lobby -> playing -> gameOver. (Hand boundaries happen inside `playing`;
 * a `handWon`/`handStart` event pair marks them.)
 */
import { Table as EngineTable } from '../engine/index.js';
import { rngFromSeed } from '../engine/index.js';

// Turn timing (ms). A human on turn must act before turnMs elapses; if not, the
// table opens a wait/kick vote. Bots act after a short, natural-feeling delay.
export const TIMING = {
  turnMs: 30000,      // human turn clock
  voteMs: 20000,      // how long a wait/kick vote stays open
  botMinMs: 600,      // bot "thinking" delay (min)
  botMaxMs: 1200,     // bot "thinking" delay (max)
};

export class TableRuntime {
  constructor({ tableId, variant, config = {}, players = [] }) {
    this.tableId = tableId;
    this.variant = variant;
    this.game = variant.id;
    this.config = { ...variant.defaults, ...config };
    this.engine = new EngineTable({ seats: 4, dealer: config.dealer ?? 0 });
    this.phase = 'lobby';
    this.scores = [0, 0]; // team 0 = seats {0,2}, team 1 = {1,3}
    this.handNo = 0;
    this.hand = null; // variant-owned state for the current hand

    // end-game bookkeeping (stats export + standings)
    this.startedAt = null;
    this.endedAt = null;
    this.winnerTeam = null;
    this.tally = { hands: 0, euchres: 0, marches: 0, lones: 0 };
    this.gamesPlayed = 0; // rematch counter

    // turn clock + kick vote (driven by the socket layer's per-table interval)
    this.turnSeat = null;       // seat currently on the clock (human only)
    this.turnDeadline = null;   // epoch ms when the current human turn expires
    this.vote = null;           // { seat, deadline, waits:Set, kicks:Set } when open

    this.seats = Array.from({ length: 4 }, (_, i) => ({
      seat: i, team: i % 2, platformId: null, displayName: null,
      bot: false, connected: false, ready: false,
    }));
    for (const p of players) this.seatPlayer(p.seat, p);
  }

  // --- helpers the variant uses ---
  get dealer() { return this.engine.dealer; }
  next(seat) { return this.engine.next(seat); }
  team(seat) { return seat % 2; }

  // --- seating ---
  seatPlayer(seat, { platformId = null, displayName = 'Player', bot = false } = {}) {
    const s = this.seats[seat];
    if (!s) return false;
    s.platformId = platformId ? String(platformId) : (bot ? `bot:${seat}` : null);
    s.displayName = displayName || (bot ? `Bot ${seat + 1}` : 'Player');
    s.bot = !!bot;
    s.ready = !!bot; // bots are always ready
    return true;
  }

  seatByPlatformId(pid) {
    return this.seats.find((s) => s.platformId === String(pid)) || null;
  }

  setConnected(seat, on) { if (this.seats[seat]) this.seats[seat].connected = on; }
  setReady(seat, on) { if (this.seats[seat] && !this.seats[seat].bot) this.seats[seat].ready = !!on; }
  emptySeats() { return this.seats.filter((s) => !s.platformId).map((s) => s.seat); }

  allSeated() { return this.seats.every((s) => s.platformId); }
  allReady() { return this.seats.every((s) => s.ready); }

  humanCount() { return this.seats.filter((s) => s.platformId && !s.bot).length; }

  // A seat that is a connected human (present at the table, just possibly slow).
  seatPresent(seat) {
    const s = this.seats[seat];
    return !!(s && s.platformId && !s.bot && s.connected);
  }

  // --- lifecycle ---
  maybeStart() {
    if (this.phase === 'lobby' && this.allSeated() && this.allReady()) {
      this.start();
      return true;
    }
    return false;
  }

  start() {
    if (this.phase !== 'lobby') return;
    this.handNo = 1;
    this.startedAt = Date.now();
    this.endedAt = null;
    this.winnerTeam = null;
    this.tally = { hands: 0, euchres: 0, marches: 0, lones: 0 };
    this.variant.startHand(this, rngFromSeed(`${this.tableId}:g${this.gamesPlayed}:h${this.handNo}`));
    this.phase = 'playing';
  }

  // Single entry point for every action (human or bot). Handles hand/game end
  // and auto-advances to the next hand. Returns { ok, error?, events, gameOver }.
  submit(seat, action) {
    if (this.phase !== 'playing') return { ok: false, error: 'table not in play' };
    const r = this.variant.applyAction(this, seat, action);
    if (!r.ok) return r;
    const events = [...(r.events || [])];

    for (const ev of events) {
      if (ev.type === 'handWon') {
        this.tally.hands += 1;
        if (ev.euchred) this.tally.euchres += 1;
        else if (ev.makerTricks === 5) { this.tally.marches += 1; if (ev.alone) this.tally.lones += 1; }
      }
    }

    if (r.gameOver) {
      this.phase = 'gameOver';
      this.endedAt = Date.now();
      this.clearTurnClock();
      if (typeof this.variant.gameResult === 'function') {
        const gr = this.variant.gameResult(this);            // individual-scoring variants (hearts)
        this.winnerSeat = gr.winnerSeat != null ? gr.winnerSeat : null;
        this.winnerTeam = this.winnerSeat;                    // team == seat for free-for-all
        this.finalTotals = gr.totals || null;
        events.push({ type: 'gameOver', mode: gr.mode || 'individual', winnerSeat: this.winnerSeat, totals: this.finalTotals });
      } else {
        this.winnerTeam = this.scores[0] >= this.scores[1] ? 0 : 1;  // 2-team variants (euchre)
        events.push({ type: 'gameOver', scores: this.scores.slice(), winnerTeam: this.winnerTeam });
      }
    } else if (r.handOver) {
      this.engine.rotateDealer();
      this.handNo += 1;
      this.variant.startHand(this, rngFromSeed(`${this.tableId}:g${this.gamesPlayed}:h${this.handNo}`));
      events.push({ type: 'handStart', handNo: this.handNo, dealer: this.dealer });
    }
    return { ok: true, events, gameOver: this.phase === 'gameOver' };
  }

  // Drive consecutive bot turns until a human must act (or the game ends).
  runBots() {
    const events = [];
    let guard = 0;
    while (this.phase === 'playing' && guard < 200) {
      guard += 1;
      const seat = this.variant.currentTurn(this);
      if (seat == null || !this.seats[seat].bot) break;
      const action = this.variant.botAction(this, seat);
      if (!action) break;
      const r = this.submit(seat, action);
      if (!r.ok) break;
      events.push(...r.events);
      if (r.gameOver) break;
    }
    return events;
  }

  // --- turn clock ---
  // Arm/refresh the clock to reflect whose turn it is. Called after every
  // broadcast. Returns true if a *human* is now on the clock.
  armTurnClock(now = Date.now()) {
    if (this.phase !== 'playing') { this.clearTurnClock(); return false; }
    const seat = this.variant.currentTurn(this);
    if (seat == null || this.seats[seat].bot) { this.clearTurnClock(); return false; }
    if (this.turnSeat !== seat) {           // new human turn -> fresh deadline
      this.turnSeat = seat;
      this.turnDeadline = now + TIMING.turnMs;
      this.vote = null;                      // any prior vote is moot
    }
    return true;
  }

  clearTurnClock() { this.turnSeat = null; this.turnDeadline = null; }

  turnRemainingMs(now = Date.now()) {
    return this.turnDeadline ? Math.max(0, this.turnDeadline - now) : null;
  }

  // Has the current human turn expired (and no vote yet open)?
  turnExpired(now = Date.now()) {
    return this.turnSeat != null && this.turnDeadline != null && now >= this.turnDeadline && !this.vote;
  }

  // --- wait / kick vote ---
  openVote(now = Date.now()) {
    if (this.turnSeat == null || this.vote) return null;
    this.vote = { seat: this.turnSeat, deadline: now + TIMING.voteMs, waits: new Set(), kicks: new Set() };
    return this.vote;
  }

  // A voter (by platformId) chooses to wait or kick. The seat under vote can't vote.
  castVote(platformId, choice) {
    if (!this.vote) return null;
    const voter = this.seatByPlatformId(platformId);
    if (!voter || voter.seat === this.vote.seat || voter.bot) return this.voteTally();
    this.vote.waits.delete(platformId); this.vote.kicks.delete(platformId);
    if (choice === 'kick') this.vote.kicks.add(platformId);
    else this.vote.waits.add(platformId);
    return this.voteTally();
  }

  // Eligible voters = connected humans other than the seat under vote.
  voteEligible() {
    if (!this.vote) return 0;
    return this.seats.filter((s) => s.platformId && !s.bot && s.seat !== this.vote.seat).length;
  }

  voteTally() {
    if (!this.vote) return null;
    return { seat: this.vote.seat, waits: this.vote.waits.size, kicks: this.vote.kicks.size,
      eligible: this.voteEligible(), deadline: this.vote.deadline };
  }

  // Resolve the vote if decided or expired. Returns 'kick' | 'wait' | null(pending).
  resolveVote(now = Date.now()) {
    if (!this.vote) return null;
    const eligible = this.voteEligible();
    const kicks = this.vote.kicks.size;
    const waits = this.vote.waits.size;
    const majority = Math.floor(eligible / 2) + 1;
    const present = this.seatPresent(this.vote.seat);
    let outcome = null;
    if (eligible === 0) {
      // No one else can vote. Only auto-take-over if the player is actually GONE.
      // A present-but-slow solo player should never be silently replaced.
      outcome = present ? null : 'kick';
    } else if (kicks >= majority) outcome = 'kick';
    else if (waits >= majority) outcome = 'wait';
    else if (now >= this.vote.deadline) {
      // On expiry: kick only if kicks lead AND (the player is gone OR a kick was cast).
      // Otherwise grant a wait — never replace a present player on a tie/no-votes.
      if (kicks > waits && (!present || kicks > 0)) outcome = 'kick';
      else outcome = 'wait';
    }
    if (!outcome) {
      // pending: if the solo player is present and the vote can't resolve, fold the
      // vote and just nudge them with a fresh clock (no lingering kick state).
      if (eligible === 0 && present) {
        this.vote = null;
        this.turnDeadline = now + TIMING.turnMs;
        return 'wait';
      }
      return null;
    }

    const seat = this.vote.seat;
    this.vote = null;
    if (outcome === 'wait') {
      this.turnDeadline = now + TIMING.turnMs;            // grant another full turn
    } else {
      this.convertToBot(seat);                            // takeover
    }
    return outcome;
  }

  // Convert a human seat to a bot (kick / takeover). Bot logic plays from here.
  convertToBot(seat) {
    const s = this.seats[seat];
    if (!s) return;
    s.bot = true;
    s.ready = true;
    s.connected = false;
    s.displayName = (s.displayName || `Seat ${seat}`) + ' (bot)';
    s.platformId = `bot:${seat}`;
    if (this.turnSeat === seat) this.clearTurnClock();
  }

  // --- views ---
  publicState() {
    const now = Date.now();
    return {
      tableId: this.tableId,
      game: this.game,
      phase: this.phase,
      dealer: this.dealer,
      scores: this.scores.slice(),
      handNo: this.handNo,
      turn: { seat: this.turnSeat, remainingMs: this.turnRemainingMs(now), totalMs: TIMING.turnMs },
      vote: this.voteTally(),
      seats: this.seats.map((s) => ({
        seat: s.seat, team: s.team, displayName: s.displayName,
        bot: s.bot, connected: s.connected, ready: s.ready, occupied: !!s.platformId,
      })),
      view: this.phase === 'lobby' ? null : this.variant.publicView(this),
    };
  }

  privateState(seat) {
    if (this.phase === 'lobby' || seat == null) return { seat, hand: [], legal: [] };
    return this.variant.privateView(this, seat);
  }

  summary() {
    return {
      tableId: this.tableId, game: this.game, phase: this.phase,
      seated: this.seats.filter((s) => s.platformId).length, scores: this.scores.slice(),
    };
  }

  // Final standings for the end-game screen / stats. Individual-scoring variants
  // (hearts) supply their own; partnership variants use the 2-team default.
  standings() {
    if (typeof this.variant.standings === 'function') return this.variant.standings(this);
    return this.seats.map((s) => ({
      seat: s.seat, team: s.seat % 2, displayName: s.displayName,
      bot: s.bot, won: (s.seat % 2) === this.winnerTeam,
    }));
  }

  // Reset to a fresh game with the same occupants (optionally reseated first).
  // Allowed only when a game has ended (or while still in the lobby).
  rematch() {
    if (this.phase !== 'gameOver' && this.phase !== 'lobby') return false;
    this.gamesPlayed += 1;
    this.scores = [0, 0];
    this.handNo = 0;
    this.hand = null;
    this.startedAt = null;
    this.endedAt = null;
    this.winnerTeam = null;
    this.tally = { hands: 0, euchres: 0, marches: 0, lones: 0 };
    this.winnerSeat = null;
    this.finalTotals = null;
    if (typeof this.variant.resetMatch === 'function') this.variant.resetMatch(this);
    this.clearTurnClock();
    this.vote = null;
    this.engine.rotateDealer(); // fresh game, new dealer
    this.phase = 'lobby';
    for (const s of this.seats) s.ready = !!s.bot; // humans must re-ready
    return true;
  }

  // Rearrange occupants among seats. `perm[i]` = the CURRENT seat index whose
  // occupant should move to seat i (a permutation of 0..3). Lobby/gameOver only.
  // Returns the platformId->newSeat map so the socket layer can resync sockets.
  reseat(perm) {
    if (this.phase !== 'gameOver' && this.phase !== 'lobby') return null;
    if (!Array.isArray(perm) || perm.length !== 4) return null;
    const seen = new Set(perm);
    if (seen.size !== 4 || perm.some((x) => x < 0 || x > 3)) return null;
    const snapshot = this.seats.map((s) => ({
      platformId: s.platformId, displayName: s.displayName, bot: s.bot, connected: s.connected,
    }));
    const map = {};
    for (let i = 0; i < 4; i++) {
      const src = snapshot[perm[i]];
      const s = this.seats[i];
      s.platformId = src.platformId;
      s.displayName = src.displayName;
      s.bot = src.bot;
      s.connected = src.connected;
      s.ready = !!src.bot;
      if (src.platformId) map[src.platformId] = i;
    }
    return map;
  }

  // A human leaves the table — free their seat.
  vacate(seat) {
    const s = this.seats[seat];
    if (!s) return;
    s.platformId = null; s.displayName = null; s.bot = false;
    s.connected = false; s.ready = false;
  }
}
