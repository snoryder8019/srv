import fs from 'fs';
const F = '/srv/games/arcade/tiles/craps/index.js';
let s = fs.readFileSync(F, 'utf8');
if (s.includes('// LIVE simultaneous betting')) { console.log('already live'); process.exit(0); }

// currentTurn: during BETS there's no single turn (live betting); during ROLL it's
// still the shooter only (rolling is one shooter's job).
s = s.replace(
`  currentTurn(table) {
    const h = table.hand;
    if (!h) return null;
    if (h.phase === 'bets') return this._firstBetter(table);
    if (h.phase === 'roll') return h.shooter;
    return null;
  },
  botSeatsToAct(table) { const s = this.currentTurn(table); return s == null ? [] : [s]; },`,
`  // LIVE simultaneous betting: during BETS every un-locked solvent seat bets at
  // once (no round-robin). During ROLL only the shooter acts.
  currentTurn(table) {
    const h = table.hand;
    if (!h) return null;
    if (h.phase === 'roll') return h.shooter;
    return null;   // bets phase: no single turn
  },
  _unlockedSeats(table) {
    const h = table.hand; const out = [];
    if (!h || h.phase !== 'bets') return out;
    for (let s = 0; s < table.seatCount; s++) if (h.match.bankrolls[s] > 0 && !h.locked[s]) out.push(s);
    return out;
  },
  botSeatsToAct(table) {
    const h = table.hand; if (!h) return [];
    if (h.phase === 'roll') return [h.shooter];
    // all un-locked bots bet simultaneously
    return this._unlockedSeats(table).filter((s) => table.seats[s] && table.seats[s].bot);
  },`
);

// legalActions: any un-locked solvent seat may bet during bets; shooter rolls in roll
s = s.replace(
`  legalActions(table, seat) {
    const h = table.hand;
    if (!h || seat !== this.currentTurn(table)) return [];
    if (h.phase === 'bets') {
      const free = h.match.bankrolls[seat] - this._staked(h, seat);`,
`  legalActions(table, seat) {
    const h = table.hand;
    if (!h) return [];
    if (h.phase === 'roll') return seat === h.shooter ? [{ type: 'roll' }] : [];
    if (h.phase === 'bets') {
      if (h.locked[seat] || h.match.bankrolls[seat] <= 0) return [];
      const free = h.match.bankrolls[seat] - this._staked(h, seat);`
);
// remove the now-duplicate roll-phase legalActions tail
s = s.replace(
`      acts.push({ type: 'done' });                              // finish betting
      return acts;
    }
    if (h.phase === 'roll') return [{ type: 'roll' }];
    return [];
  },`,
`      acts.push({ type: 'done' });                              // finish betting
      return acts;
    }
    return [];
  },`
);

// applyAction: accept bets from any un-locked seat; transition to roll when all locked
s = s.replace(
`    if (seat !== this.currentTurn(table)) return { ok: false, error: 'not your turn' };
    if (!action || !action.type) return { ok: false, error: 'no action' };
    const events = [];

    if (h.phase === 'bets') {
      if (action.type === 'done') {
        h.locked[seat] = true;
        const next = this._firstBetter(table);
        if (next == null) { h.phase = 'roll'; h.turn = h.shooter; events.push({ type: 'comeout', shooter: h.shooter }); }
        else h.turn = next;
        return { ok: true, events, handOver: false, gameOver: false };
      }`,
`    if (!action || !action.type) return { ok: false, error: 'no action' };
    const events = [];

    if (h.phase === 'bets') {
      if (h.locked[seat]) return { ok: false, error: 'already locked in' };
      if (action.type === 'done') {
        h.locked[seat] = true;
        // once every solvent seat is locked, move to the roll (shooter rolls)
        if (this._unlockedSeats(table).length === 0) {
          h.phase = 'roll'; h.turn = h.shooter; events.push({ type: 'comeout', shooter: h.shooter });
        } else {
          events.push({ type: 'locked', seat });
        }
        return { ok: true, events, handOver: false, gameOver: false };
      }`
);

// the roll branch still guards shooter-only
s = s.replace(
`    if (h.phase === 'roll') {
      if (action.type !== 'roll') return { ok: false, error: 'expected roll' };`,
`    if (h.phase === 'roll') {
      if (seat !== h.shooter) return { ok: false, error: 'only the shooter rolls' };
      if (action.type !== 'roll') return { ok: false, error: 'expected roll' };`
);

// botAction: any un-locked bot bets then locks; shooter rolls
s = s.replace(
`  botAction(table, seat) {
    const h = table.hand;
    if (!h) return null;
    if (h.phase === 'bets') {
      // bots place one line/field bet then finish
      const mine = h.bets[seat];`,
`  botAction(table, seat) {
    const h = table.hand;
    if (!h) return null;
    if (h.phase === 'roll') return seat === h.shooter ? { type: 'roll' } : null;
    if (h.phase === 'bets') {
      if (h.locked[seat] || h.match.bankrolls[seat] <= 0) return null;
      // bots place one line/field bet then finish
      const mine = h.bets[seat];`
);
// trim the old roll-phase botAction tail (now handled above)
s = s.replace(
`      return { type: 'done' };
    }
    if (h.phase === 'roll' && seat === h.shooter) return { type: 'roll' };
    return null;
  },`,
`      return { type: 'done' };
    }
    return null;
  },`
);

// privateView: yourTurn = (bets & un-locked & solvent) OR (roll & shooter)
s = s.replace(
`      seat, phase: h.phase, turn: this.currentTurn(table), yourTurn: this.currentTurn(table) === seat,
      bankroll: h.match.bankrolls[seat], myBets: h.bets[seat], shooter: h.shooter,
      comeout: h.comeout, point: h.point,`,
`      seat, phase: h.phase, turn: this.currentTurn(table),
      yourTurn: (h.phase === 'bets' && !h.locked[seat] && h.match.bankrolls[seat] > 0) || (h.phase === 'roll' && seat === h.shooter),
      locked: h.locked[seat],
      bankroll: h.match.bankrolls[seat], myBets: h.bets[seat], shooter: h.shooter,
      comeout: h.comeout, point: h.point,`
);

// publicView: expose locked array
s = s.replace(
`      phase: h.phase, shooter: h.shooter, comeout: h.comeout, point: h.point,`,
`      phase: h.phase, shooter: h.shooter, comeout: h.comeout, point: h.point, locked: h.locked.slice(),`
);

fs.writeFileSync(F, s);
console.log('craps: converted to LIVE simultaneous betting (shooter still rolls)');
