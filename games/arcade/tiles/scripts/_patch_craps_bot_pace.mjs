import fs from 'fs';
const F = '/srv/games/arcade/tiles/craps/index.js';
let s = fs.readFileSync(F, 'utf8');
if (s.includes('_humansStillBetting')) { console.log('already'); process.exit(0); }

// Add a helper: are there connected HUMAN seats that haven't locked yet (still
// deciding their bets this window)? The bot shooter must wait for them before
// rolling, so humans get a real betting window between rolls (no rapid-fire).
s = s.replace(
  `  _pointOn(table) { const h = table.hand; return !!(h && !h.comeout && h.point != null); },`,
  `  _pointOn(table) { const h = table.hand; return !!(h && !h.comeout && h.point != null); },
  // connected humans who are solvent and have NOT locked in this betting window
  _humansStillBetting(table) {
    const h = table.hand; if (!h || h.phase !== 'bets') return false;
    for (let s = 0; s < table.seatCount; s++) {
      const seat = table.seats[s];
      if (seat && seat.platformId && !seat.bot && seat.connected && h.match.bankrolls[s] > 0 && !h.locked[s]) return true;
    }
    return false;
  },`
);

// botSeatsToAct: the bot shooter only becomes eligible to roll (in the point
// cycle) once NO human is still betting. While humans are deciding, the bot
// shooter is not pending — leaving the betting window open.
s = s.replace(
  `  botSeatsToAct(table) {
    const h = table.hand; if (!h) return [];
    if (h.phase === 'roll') return [h.shooter];
    // bets phase: un-locked bots act; plus, if a point is on, the shooter bot acts
    // (it will roll) even though it may already be locked.
    const set = new Set(this._unlockedSeats(table).filter((s) => table.seats[s] && table.seats[s].bot));
    if (this._pointOn(table) && table.seats[h.shooter] && table.seats[h.shooter].bot) set.add(h.shooter);
    return [...set];
  },`,
  `  botSeatsToAct(table) {
    const h = table.hand; if (!h) return [];
    if (h.phase === 'roll') return [h.shooter];
    // bets phase: un-locked bots place their bets + lock.
    const set = new Set(this._unlockedSeats(table).filter((s) => table.seats[s] && table.seats[s].bot));
    // point cycle: the bot shooter may roll — but ONLY once no human is still
    // betting, so humans always get a window between rolls (prevents rapid-fire).
    if (this._pointOn(table) && table.seats[h.shooter] && table.seats[h.shooter].bot
        && !this._humansStillBetting(table)) {
      set.add(h.shooter);
    }
    return [...set];
  },`
);

// botAction: mirror the same gate — the bot shooter holds its roll while humans
// are still betting.
s = s.replace(
  `    if (h.phase === 'bets') {
      // point on: the shooter bot rolls (after possibly having bet already)
      if (this._pointOn(table) && seat === h.shooter) return { type: 'roll' };`,
  `    if (h.phase === 'bets') {
      // point on: the shooter bot rolls — but waits while humans are still betting
      if (this._pointOn(table) && seat === h.shooter) {
        if (this._humansStillBetting(table)) {
          // not the shooter's moment yet; if the shooter also has an un-placed bet
          // it can still bet, otherwise it just holds (returns null -> no action).
          if (h.locked[seat] || h.match.bankrolls[seat] <= 0) return null;
          // fall through to normal betting below
        } else {
          return { type: 'roll' };
        }
      }`
);

fs.writeFileSync(F, s);
console.log('craps engine: bot shooter waits for humans to finish betting before rolling');
