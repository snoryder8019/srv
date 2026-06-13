import fs from 'fs';
const F = '/srv/games/arcade/tiles/roulette/index.js';
let s = fs.readFileSync(F, 'utf8');
if (s.includes('// LIVE simultaneous betting')) { console.log('already live'); process.exit(0); }

// currentTurn: no single "turn" during bets — everyone bets live. Return null so the
// runtime/turn-clock doesn't gate on one seat.
s = s.replace(
`  currentTurn(table) {
    const h = table.hand;
    if (!h || h.phase !== 'bets') return null;
    return this._firstBetter(table);
  },
  botSeatsToAct(table) { const s = this.currentTurn(table); return s == null ? [] : [s]; },`,
`  // LIVE simultaneous betting: no round-robin. There is no single "current turn"
  // during bets — every un-locked solvent seat may bet at any time.
  currentTurn(table) { return null; },
  _unlockedSeats(table) {
    const h = table.hand; const out = [];
    if (!h || h.phase !== 'bets') return out;
    for (let s = 0; s < table.seatCount; s++) if (h.match.bankrolls[s] > 0 && !h.locked[s]) out.push(s);
    return out;
  },
  // every un-locked BOT seat acts (they place a bet then lock) — all at once.
  botSeatsToAct(table) {
    const h = table.hand; if (!h || h.phase !== 'bets') return [];
    return this._unlockedSeats(table).filter((s) => table.seats[s] && table.seats[s].bot);
  },`
);

// legalActions: any un-locked solvent seat may bet (not gated to one turn)
s = s.replace(
`  legalActions(table, seat) {
    const h = table.hand;
    if (!h || seat !== this.currentTurn(table)) return [];
    const free = h.match.bankrolls[seat] - this._staked(h, seat);`,
`  legalActions(table, seat) {
    const h = table.hand;
    if (!h || h.phase !== 'bets') return [];
    if (h.locked[seat] || h.match.bankrolls[seat] <= 0) return [];   // already done / broke
    const free = h.match.bankrolls[seat] - this._staked(h, seat);`
);

// applyAction: accept from any un-locked seat; spin only when ALL seats locked
s = s.replace(
`    if (seat !== this.currentTurn(table)) return { ok: false, error: 'not your turn' };
    if (!action) return { ok: false, error: 'no action' };

    if (action.type === 'done') {
      h.locked[seat] = true;
      const next = this._firstBetter(table);
      if (next != null) { h.turn = next; return { ok: true, events: [], handOver: false, gameOver: false }; }
      return this._spin(table, h, []);
    }`,
`    if (h.phase !== 'bets') return { ok: false, error: 'not betting' };
    if (h.locked[seat]) return { ok: false, error: 'already locked in' };
    if (!action) return { ok: false, error: 'no action' };

    if (action.type === 'done') {
      h.locked[seat] = true;
      // spin once EVERY solvent seat has locked in (live betting — order doesn't matter)
      if (this._unlockedSeats(table).length === 0) return this._spin(table, h, []);
      return { ok: true, events: [{ type: 'locked', seat }], handOver: false, gameOver: false };
    }`
);

// botAction: any un-locked bot places a bet then locks (callable for all of them)
s = s.replace(
`  botAction(table, seat) {
    const h = table.hand;
    if (!h || seat !== this.currentTurn(table)) return null;
    const mine = h.bets[seat];`,
`  botAction(table, seat) {
    const h = table.hand;
    if (!h || h.phase !== 'bets' || h.locked[seat] || h.match.bankrolls[seat] <= 0) return null;
    const mine = h.bets[seat];`
);

// privateView yourTurn => "you can still bet" (un-locked + betting)
s = s.replace(
`      seat, phase: h.phase, turn: this.currentTurn(table), yourTurn: this.currentTurn(table) === seat,
      bankroll: h.match.bankrolls[seat], myBets: h.bets[seat],`,
`      seat, phase: h.phase, turn: null,
      yourTurn: h.phase === 'bets' && !h.locked[seat] && h.match.bankrolls[seat] > 0,
      locked: h.locked[seat],
      bankroll: h.match.bankrolls[seat], myBets: h.bets[seat],`
);

// publicView: turn no longer meaningful; expose locked array so clients can show it
s = s.replace(
`      phase: h.phase, turn: this.currentTurn(table),
      lastPocket:`,
`      phase: h.phase, turn: null, locked: h.locked.slice(),
      lastPocket:`
);

fs.writeFileSync(F, s);
console.log('roulette: converted to LIVE simultaneous betting (no round-robin)');
