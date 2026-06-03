import fs from 'fs';

// Show EVERY bettor's chips on their seat plate. Prefer the authoritative
// seat.chips (wallet-synced balance, present for real human bettors) and fall
// back to the in-engine bankroll (bots / seeded seats), so no seat is blank.

// ── ROULETTE ──
let r = fs.readFileSync('/srv/tiles/public/js/roulette3d.js', 'utf8');
const oldR = `function updateSeats(s, v) {
  for (let i = 0; i < (s.seats || []).length; i++) {
    const seat = s.seats[i]; if (!seat) continue;
    const br = (v.bankrolls && v.bankrolls[i] != null) ? v.bankrolls[i] : '';
    const bet = v.bets && v.bets[i];
    const name = (seat.displayName || ('Seat ' + i)) + (seat.bot ? ' 🤖' : '');
    let sub;
    if (s.phase === 'lobby') sub = seat.ready ? 'ready' : (seat.platformId ? 'waiting' : 'empty');
    else {
      let betStr = '';
      if (bet) betStr = \` · \${bet.side === 'number' ? ('#' + bet.n) : bet.side} \${bet.amount}\`;
      sub = \`\${br} chips\${betStr}\`;
    }
    const turn = v.phase === 'bets' && v.turn === i;
    T.updateSeat(i, { name, sub, turn, you: i === C.mySeat });
  }
}`;
const newR = `function seatChips(seat, v, i) {
  // authoritative wallet balance first (real bettors), then in-engine bankroll
  if (seat && typeof seat.chips === 'number') return seat.chips;
  if (v.bankrolls && typeof v.bankrolls[i] === 'number') return v.bankrolls[i];
  return null;
}
function updateSeats(s, v) {
  for (let i = 0; i < (s.seats || []).length; i++) {
    const seat = s.seats[i]; if (!seat) continue;
    const chips = seatChips(seat, v, i);
    const bets = v.bets && v.bets[i];     // array of bets this round (roulette is multi-bet)
    const name = (seat.displayName || ('Seat ' + i)) + (seat.bot ? ' 🤖' : '');
    let sub;
    if (s.phase === 'lobby') {
      sub = seat.ready ? 'ready' : (seat.platformId ? 'waiting' : 'empty');
    } else if (!seat.platformId) {
      sub = 'open';
    } else {
      let betStr = '';
      if (Array.isArray(bets) && bets.length) {
        const total = bets.reduce((acc, b) => acc + (b.amount || 0), 0);
        betStr = \` · \${bets.length} bet\${bets.length > 1 ? 's' : ''} (\${total})\`;
      } else if (bets && bets.amount != null) {
        betStr = \` · \${bets.side === 'number' ? ('#' + bets.n) : bets.side} \${bets.amount}\`;
      }
      sub = (chips != null ? \`\${chips} chips\` : '—') + betStr;
    }
    const turn = v.phase === 'bets' && v.turn === i;
    T.updateSeat(i, { name, sub, turn, you: i === C.mySeat });
  }
}`;
if (!r.includes(oldR)) { console.log('ROULETTE updateSeats anchor not found'); }
else { r = r.replace(oldR, newR); fs.writeFileSync('/srv/tiles/public/js/roulette3d.js', r); console.log('roulette: all bettors show chips'); }

// ── CRAPS ──
let c = fs.readFileSync('/srv/tiles/public/js/craps3d.js', 'utf8');
const oldC = `function updateSeats(s, v) {
  for (let i = 0; i < (s.seats || []).length; i++) {
    const seat = s.seats[i]; if (!seat) continue;
    const br = (v.bankrolls && v.bankrolls[i] != null) ? v.bankrolls[i] : '';
    const bet = v.bets && v.bets[i];
    const isShooter = v.shooter === i;
    const name = (seat.displayName || ('Seat ' + i)) + (seat.bot ? ' 🤖' : '') + (isShooter ? ' 🎲' : '');
    let sub;
    if (s.phase === 'lobby') sub = seat.ready ? 'ready' : (seat.platformId ? 'waiting' : 'empty');
    else {
      let betStr = '';
      if (Array.isArray(bet) && bet.length) {
        const total = bet.reduce((acc, x) => acc + (x.amount || 0), 0);
        betStr = \` · \${bet.length} bet\${bet.length > 1 ? 's' : ''} (\${total})\`;
      }
      sub = \`\${br} chips\${betStr}\`;
    }
    const turn = (v.phase === 'bets' && v.turn === i) || (v.phase === 'roll' && v.shooter === i);
    T.updateSeat(i, { name, sub, turn, you: i === C.mySeat });
  }
}`;
const newC = `function seatChips(seat, v, i) {
  if (seat && typeof seat.chips === 'number') return seat.chips;
  if (v.bankrolls && typeof v.bankrolls[i] === 'number') return v.bankrolls[i];
  return null;
}
function updateSeats(s, v) {
  for (let i = 0; i < (s.seats || []).length; i++) {
    const seat = s.seats[i]; if (!seat) continue;
    const chips = seatChips(seat, v, i);
    const bet = v.bets && v.bets[i];
    const isShooter = v.shooter === i;
    const name = (seat.displayName || ('Seat ' + i)) + (seat.bot ? ' 🤖' : '') + (isShooter ? ' 🎲' : '');
    let sub;
    if (s.phase === 'lobby') {
      sub = seat.ready ? 'ready' : (seat.platformId ? 'waiting' : 'empty');
    } else if (!seat.platformId) {
      sub = 'open';
    } else {
      let betStr = '';
      if (Array.isArray(bet) && bet.length) {
        const total = bet.reduce((acc, x) => acc + (x.amount || 0), 0);
        betStr = \` · \${bet.length} bet\${bet.length > 1 ? 's' : ''} (\${total})\`;
      }
      sub = (chips != null ? \`\${chips} chips\` : '—') + betStr;
    }
    const turn = (v.phase === 'bets' && v.turn === i) || (v.phase === 'roll' && v.shooter === i);
    T.updateSeat(i, { name, sub, turn, you: i === C.mySeat });
  }
}`;
if (!c.includes(oldC)) { console.log('CRAPS updateSeats anchor not found'); }
else { c = c.replace(oldC, newC); fs.writeFileSync('/srv/tiles/public/js/craps3d.js', c); console.log('craps: all bettors show chips'); }
