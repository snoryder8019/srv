import fs from 'fs';
const F = '/srv/tiles/roulette/index.js';
let s = fs.readFileSync(F, 'utf8');
if (s.includes('// SPREAD BOT BETS')) { console.log('already'); process.exit(0); }

// ── 1) Track cumulative wins/losses per seat on the match (for the scoreboard). ──
s = s.replace(
  `      table._roul = { bankrolls: new Array(table.seatCount).fill(table.config.startChips), handNo: 0 };
      table.scores = table._roul.bankrolls.slice();
    }
    return table._roul;`,
  `      table._roul = {
        bankrolls: new Array(table.seatCount).fill(table.config.startChips),
        handNo: 0,
        wins: new Array(table.seatCount).fill(0),     // rounds won (net positive)
        losses: new Array(table.seatCount).fill(0),   // rounds lost (net negative)
        net: new Array(table.seatCount).fill(0),      // cumulative chip net since sitting
      };
      table.scores = table._roul.bankrolls.slice();
    }
    // keep the stat arrays sized to the table (seat count is stable, but be safe)
    const _m = table._roul;
    for (const k of ['wins', 'losses', 'net']) {
      if (!_m[k]) _m[k] = new Array(table.seatCount).fill(0);
    }
    return table._roul;`
);

// ── 2) _spin: compute per-seat deltas + winning bet indices, update stats, and
//        emit a richer settle event the client can use to delay the rake. ──
s = s.replace(
  `  _spin(table, h, events) {
    const m = h.match;
    const pocket = Math.floor(h._rng() * cfg.pockets);   // 0..36
    h.lastPocket = pocket;
    m.lastPocket = pocket; m.lastColor = colorOf(pocket);   // persist across hands (continuous)
    events.push({ type: 'spin', pocket, color: colorOf(pocket) });
    for (let s = 0; s < table.seatCount; s++) {
      for (const bet of h.bets[s]) {
        if (betWins(bet, pocket)) m.bankrolls[s] += bet.amount * payoutMult(bet);
        else m.bankrolls[s] -= bet.amount;
      }
    }
    table.scores = m.bankrolls.slice();
    events.push({ type: 'settle', pocket, color: colorOf(pocket), bankrolls: m.bankrolls.slice() });
    return { ok: true, events, handOver: true, gameOver: false };   // continuous
  },`,
  `  _spin(table, h, events) {
    const m = h.match;
    const pocket = Math.floor(h._rng() * cfg.pockets);   // 0..36
    h.lastPocket = pocket;
    m.lastPocket = pocket; m.lastColor = colorOf(pocket);   // persist across hands (continuous)
    events.push({ type: 'spin', pocket, color: colorOf(pocket) });
    const before = m.bankrolls.slice();
    const wonBets = [];   // {seat, idx} of bets that WON — client keeps these up before raking
    for (let s = 0; s < table.seatCount; s++) {
      h.bets[s].forEach((bet, idx) => {
        if (betWins(bet, pocket)) { m.bankrolls[s] += bet.amount * payoutMult(bet); wonBets.push({ seat: s, idx }); }
        else m.bankrolls[s] -= bet.amount;
      });
    }
    const deltas = m.bankrolls.map((v, i) => v - before[i]);
    // update cumulative stats per seat (only seats that had action this round)
    for (let s = 0; s < table.seatCount; s++) {
      if (!h.bets[s].length) continue;
      m.net[s] += deltas[s];
      if (deltas[s] > 0) m.wins[s] += 1; else if (deltas[s] < 0) m.losses[s] += 1;
    }
    table.scores = m.bankrolls.slice();
    events.push({
      type: 'settle', pocket, color: colorOf(pocket),
      bankrolls: m.bankrolls.slice(), deltas, wonBets,
      stats: { wins: m.wins.slice(), losses: m.losses.slice(), net: m.net.slice() },
    });
    return { ok: true, events, handOver: true, gameOver: false };   // continuous
  },`
);

// ── 3) SPREAD BOT BETS: bots place 1–3 varied bets (outsides, dozens/cols, and
//        sometimes a straight number or a valid split), not just red/black. ──
s = s.replace(
  `  botAction(table, seat) {
    const h = table.hand;
    if (!h || h.phase !== 'bets' || h.locked[seat] || h.match.bankrolls[seat] <= 0) return null;
    const mine = h.bets[seat];
    if (!mine.length) {
      const amount = Math.min(h.match.bankrolls[seat], table.config.betSize);
      if (amount <= 0) return { type: 'done' };
      return { type: 'bet', side: seat % 2 ? 'black' : 'red', amount };
    }
    return { type: 'done' };
  },`,
  `  // SPREAD BOT BETS — bots build a small varied portfolio then lock.
  _botBetTarget(seat) {
    // deterministic-ish per seat so each bot has a "style", with some randomness
    const styles = [
      ['red', 'black', 'even', 'odd', 'low', 'high'],          // outside-lover
      ['dozen1', 'dozen2', 'dozen3', 'col1', 'col2', 'col3'],  // dozens/columns
      ['number', 'number', 'split', 'red', 'dozen2'],          // inside-leaning
      ['red', 'dozen1', 'number', 'high', 'col3'],             // mixed
    ];
    const style = styles[seat % styles.length];
    return style[Math.floor(Math.random() * style.length)];
  },
  _randomInside(side) {
    if (side === 'number') return { n: Math.floor(Math.random() * 37) };          // 0..36
    if (side === 'split') {
      // pick a random horizontal split (n, n+1) in the same row
      const row = Math.floor(Math.random() * 12); const col = Math.floor(Math.random() * 2);
      const a = row * 3 + col + 1; return { nums: [a, a + 1] };
    }
    return {};
  },
  botAction(table, seat) {
    const h = table.hand;
    if (!h || h.phase !== 'bets' || h.locked[seat] || h.match.bankrolls[seat] <= 0) return null;
    const mine = h.bets[seat];
    // how many bets this bot wants this round (1..3), decided once and stored
    if (h._botPlan == null) h._botPlan = {};
    if (h._botPlan[seat] == null) h._botPlan[seat] = 1 + Math.floor(Math.random() * 3);
    const want = h._botPlan[seat];
    if (mine.length >= want) return { type: 'done' };
    const free = h.match.bankrolls[seat] - this._staked(h, seat);
    if (free <= 0) return { type: 'done' };
    const amount = Math.min(free, table.config.betSize);
    if (amount <= 0) return { type: 'done' };
    const side = this._botBetTarget(seat);
    if (side === 'number' || side === 'split') {
      return { type: 'bet', side, amount, ...this._randomInside(side) };
    }
    return { type: 'bet', side, amount };
  },`
);

// ── 4) expose stats in publicView (for the scoreboard) ──
s = s.replace(
  `      bankrolls: h.match.bankrolls.slice(), round: h.match.handNo, continuous: true,
    };
  },`,
  `      bankrolls: h.match.bankrolls.slice(), round: h.match.handNo, continuous: true,
      stats: {
        wins: (h.match.wins || []).slice(),
        losses: (h.match.losses || []).slice(),
        net: (h.match.net || []).slice(),
      },
    };
  },`
);

// reset stats too
s = s.replace(
  `  resetMatch(table) {
    table._roul = { bankrolls: new Array(table.seatCount).fill(table.config.startChips), handNo: 0 };
    table.scores = table._roul.bankrolls.slice();
  },`,
  `  resetMatch(table) {
    table._roul = {
      bankrolls: new Array(table.seatCount).fill(table.config.startChips), handNo: 0,
      wins: new Array(table.seatCount).fill(0), losses: new Array(table.seatCount).fill(0),
      net: new Array(table.seatCount).fill(0),
    };
    table.scores = table._roul.bankrolls.slice();
  },`
);

fs.writeFileSync(F, s);
console.log('roulette engine: bot bet spread + per-seat stats + settle deltas/wonBets');
