import fs from 'fs';
const F = '/srv/tiles/public/js/craps3d.js';
let s = fs.readFileSync(F, 'utf8');

// ── 1) renderActions: full bet set + a DONE/ROLL control so betting can finish ──
const oldRA = `  renderActions(box, { priv, myTurn }) {
    if (!priv) return;
    const legal = priv.legal || [];
    const roll = legal.find((a) => a.type === 'roll');
    if (roll) {
      const b = document.createElement('button'); b.className = 'act gold'; b.textContent = '🎲 Roll the dice';
      b.onclick = () => C.emitAction(roll); box.appendChild(b); return;
    }
    const pass = legal.find((a) => a.type === 'bet' && a.side === 'pass');
    const dont = legal.find((a) => a.type === 'bet' && a.side === 'dontpass');
    if (pass) { const b = document.createElement('button'); b.className = 'act'; b.textContent = \`Pass line (\${pass.amount})\`; b.onclick = () => C.emitAction(pass); box.appendChild(b); }
    if (dont) { const b = document.createElement('button'); b.className = 'act ghost'; b.textContent = \`Don't pass (\${dont.amount})\`; b.onclick = () => C.emitAction(dont); box.appendChild(b); }
  },`;

const newRA = `  renderActions(box, { priv, myTurn }) {
    if (!priv) return;
    const legal = priv.legal || [];
    // ROLL phase: the shooter rolls.
    const roll = legal.find((a) => a.type === 'roll');
    if (roll) {
      const b = document.createElement('button'); b.className = 'act gold'; b.textContent = '🎲 Roll the dice';
      b.onclick = () => C.emitAction(roll); box.appendChild(b); return;
    }
    // BETS phase: only the seat whose turn it is bets; everyone else waits.
    if (!myTurn) return;
    const label = {
      pass: 'Pass', dontpass: "Don't", field: 'Field',
      any7: 'Any 7', anycraps: 'Any craps', ce: 'C & E',
      hard4: 'Hard 4', hard6: 'Hard 6', hard8: 'Hard 8', hard10: 'Hard 10',
    };
    const cls = { pass: 'act', dontpass: 'act ghost' };
    const placed = (priv.myBets && priv.myBets.length) || 0;
    let any = false;
    for (const a of legal) {
      if (a.type !== 'bet') continue;
      any = true;
      const b = document.createElement('button');
      b.className = cls[a.side] || 'act ghost';
      b.textContent = (label[a.side] || a.side) + ' (' + a.amount + ')';
      b.onclick = () => C.emitAction(a);
      box.appendChild(b);
    }
    // DONE control — finishes betting for this seat so the round can roll.
    if (legal.some((a) => a.type === 'done')) {
      const d = document.createElement('button'); d.className = 'act gold';
      d.textContent = placed ? \`Done — roll ▸ (\${placed})\` : 'Skip / no bet ▸';
      d.onclick = () => C.emitAction({ type: 'done' });
      box.appendChild(d);
    }
    if (any || placed) {
      const hint = document.createElement('div');
      hint.style.cssText = 'color:#bfe0cd;font-size:12px;align-self:center';
      hint.textContent = 'tap felt or buttons · stack bets · then Done';
      box.appendChild(hint);
    }
  },`;
if (!s.includes(oldRA)) { console.log('renderActions anchor not found'); process.exit(1); }
s = s.replace(oldRA, newRA);

// ── 2) updateSeats: bets[i] is now an ARRAY of bets ──
const oldUS = `    else sub = \`\${br} chips\` + (bet ? \` · \${bet.side === 'pass' ? 'PASS' : "DON'T"} \${bet.amount}\` : '');`;
const newUS = `    else {
      let betStr = '';
      if (Array.isArray(bet) && bet.length) {
        const total = bet.reduce((acc, x) => acc + (x.amount || 0), 0);
        betStr = \` · \${bet.length} bet\${bet.length > 1 ? 's' : ''} (\${total})\`;
      }
      sub = \`\${br} chips\${betStr}\`;
    }`;
if (!s.includes(oldUS)) { console.log('updateSeats anchor not found'); process.exit(1); }
s = s.replace(oldUS, newUS);

// ── 3) felt zones: PASS / DON'T / FIELD bands tappable (engine supports more, but
//     the painted felt has these clear bands). Keep simple + correct.
const oldZone = `function zoneAt(px, py) {
  // from felt3d: DON'T PASS at y=H-360..H-250, PASS LINE at y=H-240..H-90 (H=1024)
  if (py >= 1024 - 360 && py < 1024 - 250) return { side: 'dontpass' };
  if (py >= 1024 - 240 && py < 1024 - 90) return { side: 'pass' };
  return null;
}`;
const newZone = `function zoneAt(px, py) {
  // mirror felt3d.buildCrapsFelt bands (H=1024):
  //   FIELD strip ~ y 322..432, DON'T PASS ~ y 664..774, PASS LINE ~ y 784..934
  if (py >= 322 && py < 432) return { side: 'field' };
  if (py >= 664 && py < 774) return { side: 'dontpass' };
  if (py >= 784 && py < 934) return { side: 'pass' };
  return null;
}`;
if (!s.includes(oldZone)) { console.log('zoneAt anchor not found'); process.exit(1); }
s = s.replace(oldZone, newZone);

// ── 4) felt bet must respect comeout for line bets (engine rejects pass off comeout) ──
const oldPlace = `function placeFeltBet(zone, worldPoint) {
  if (!zone) return;
  const priv = C.priv;
  if (!priv || !priv.yourTurn || priv.phase !== 'bets') return;
  C.emitAction({ type: 'bet', side: zone.side, amount: stake });
  dropStack(CHIPS, worldPoint.x, worldPoint.z, stake);
  if (T.Sound) T.Sound.click && T.Sound.click();
}`;
const newPlace = `function placeFeltBet(zone, worldPoint) {
  if (!zone) return;
  const priv = C.priv;
  if (!priv || !priv.yourTurn || priv.phase !== 'bets') return;
  // line bets are only legal on the come-out; ignore a stale tap otherwise
  if ((zone.side === 'pass' || zone.side === 'dontpass') && priv.comeout === false) return;
  C.emitAction({ type: 'bet', side: zone.side, amount: stake });
  dropStack(CHIPS, worldPoint.x, worldPoint.z, stake);
  if (T.Sound) T.Sound.click && T.Sound.click();
}`;
if (!s.includes(oldPlace)) { console.log('placeFeltBet anchor not found'); process.exit(1); }
s = s.replace(oldPlace, newPlace);

// ── 5) refresh stale info copy (continuous + full bets) ──
s = s.replace(
  `        <li><b>Don't pass</b> is the mirror bet.</li>
        <li>Build the biggest bankroll before the rounds run out.</li>`,
  `        <li><b>Don't pass</b> is the mirror bet.</li>
        <li><b>Field / Any 7 / Any craps / C&E</b> resolve every roll; <b>Hard 4/6/8/10</b> ride until they hit or seven-out.</li>
        <li>Stack bets, then <b>Done</b> to roll. The table runs until you leave.</li>`
);

fs.writeFileSync(F, s);
console.log('craps client: full bet buttons + Done control + array bets + felt zones fixed');
