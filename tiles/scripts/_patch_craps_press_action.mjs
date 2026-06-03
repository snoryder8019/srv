import fs from 'fs';
const F = '/srv/tiles/craps/index.js';
let s = fs.readFileSync(F, 'utf8');
if (s.includes("action.type === 'press'")) { console.log('already'); process.exit(0); }

// Add press/pull handling in applyAction's bets phase (before the 'done' branch).
// press: move the just-won profit (from the pressable list) back onto the named
//        riding bet, increasing its amount. Drawn from bankroll (which holds the
//        winnings). pull: explicit no-op (the winnings already sit in bankroll).
s = s.replace(
  `      if (h.locked[seat]) return { ok: false, error: 'already locked in' };
      if (action.type === 'done') {`,
  `      if (action.type === 'press' || action.type === 'pull') {
        const list = (h.pressable || []).filter((p) => p.seat === seat);
        if (!list.length) return { ok: false, error: 'nothing to press' };
        // resolve which pressable win(s) this refers to (by bet id, or all of mine)
        const targets = action.id != null ? list.filter((p) => p.id === action.id) : list;
        if (!targets.length) return { ok: false, error: 'no such pressable bet' };
        if (action.type === 'pull') {
          // pull = keep the winnings (already banked). Just clear the offer for these.
          h.pressable = (h.pressable || []).filter((p) => !(p.seat === seat && targets.some((t) => t.id === p.id)));
          events.push({ type: 'pulled', seat, ids: targets.map((t) => t.id) });
          return { ok: true, events, handOver: false, gameOver: false };
        }
        // press = add the won profit back onto each riding bet (capped by bankroll)
        let pressedTotal = 0;
        for (const t of targets) {
          const bet = h.bets[seat].find((b) => b.id === t.id && PLACE[b.side]);
          if (!bet) continue;
          const free = h.match.bankrolls[seat] - this._staked(h, seat);
          const add = Math.max(0, Math.min(free, t.won));   // press up to the amount just won
          if (add <= 0) continue;
          bet.amount += add; pressedTotal += add;
        }
        h.pressable = (h.pressable || []).filter((p) => !(p.seat === seat && targets.some((t) => t.id === p.id)));
        events.push({ type: 'pressed', seat, amount: pressedTotal });
        return { ok: true, events, handOver: false, gameOver: false };
      }
      if (h.locked[seat]) return { ok: false, error: 'already locked in' };
      if (action.type === 'done') {`
);

// Surface press/pull as legal actions for a seat that has pressable wins this window.
s = s.replace(
  `      // once a POINT is on, the shooter can roll at any time — betting stays open
      if (this._pointOn(table) && seat === h.shooter) acts.push({ type: 'roll' });
      return acts;`,
  `      // press/pull offered when this seat has a riding win to act on
      const myPress = (h.pressable || []).filter((p) => p.seat === seat);
      for (const p of myPress) {
        acts.push({ type: 'press', id: p.id, side: p.side, won: p.won });
        acts.push({ type: 'pull', id: p.id, side: p.side, won: p.won });
      }
      // once a POINT is on, the shooter can roll at any time — betting stays open
      if (this._pointOn(table) && seat === h.shooter) acts.push({ type: 'roll' });
      return acts;`
);

// Include pressable in the private view so the client knows to prompt.
s = s.replace(
  `      comeout: h.comeout, point: h.point,
      legal: this.legalActions(table, seat),`,
  `      comeout: h.comeout, point: h.point,
      pressable: (h.pressable || []).filter((p) => p.seat === seat),
      legal: this.legalActions(table, seat),`
);

// Bots: just pull (bank the winnings) — keep bot behaviour simple/safe.
s = s.replace(
  `      if (h.locked[seat] || h.match.bankrolls[seat] <= 0) return null;
      const mine = h.bets[seat];
      if (!mine.length) {`,
  `      // if the bot has a pressable win, it pulls (banks it) by default
      const botPress = (h.pressable || []).find((p) => p.seat === seat);
      if (botPress) return { type: 'pull', id: botPress.id };
      if (h.locked[seat] || h.match.bankrolls[seat] <= 0) return null;
      const mine = h.bets[seat];
      if (!mine.length) {`
);

fs.writeFileSync(F, s);
console.log('craps engine: press/pull actions wired (legal + apply + privateView + bot pull)');
