import fs from 'fs';
const F = '/srv/games/arcade/tiles/public/js/roulette3d.js';
let s = fs.readFileSync(F, 'utf8');
if (s.includes('function renderScoreboard')) { console.log('already'); process.exit(0); }

// Build + update a compact table scoreboard (who's seated, their W/L + net).
// Driven from state each update (so it's live during betting) and refreshed with
// the authoritative stats on settle.
const block = `
// ───────────────────────── table scoreboard (W/L/net) ─────────────────────────
function ensureScoreboard() {
  let el = document.getElementById('rouletteScores');
  if (el) return el;
  el = document.createElement('div');
  el.id = 'rouletteScores';
  el.style.cssText = [
    'position:fixed', 'left:10px', 'top:60px', 'z-index:60', 'pointer-events:none',
    'background:rgba(6,14,9,.82)', 'border:1px solid rgba(255,255,255,.12)',
    'border-radius:12px', 'padding:8px 10px', 'min-width:172px',
    'font-family:system-ui', 'box-shadow:0 8px 28px rgba(0,0,0,.5)',
  ].join(';');
  document.body.appendChild(el);
  return el;
}
let _scoreKey = '';
function renderScoreboard(stats) {
  const s = C.state; if (!s || !s.seats) return;
  stats = stats || (s.view && s.view.stats);
  if (!stats || !stats.net) return;
  const rows = [];
  for (let i = 0; i < s.seats.length; i++) {
    const seat = s.seats[i]; if (!seat) continue;
    const occupied = !!(seat.platformId || seat.bot);
    if (!occupied) continue;
    rows.push({
      i, you: i === C.mySeat,
      name: (seat.displayName || ('Seat ' + i)) + (seat.bot ? ' 🤖' : ''),
      color: seatColor(i),
      wins: (stats.wins && stats.wins[i]) || 0,
      losses: (stats.losses && stats.losses[i]) || 0,
      net: (stats.net && stats.net[i]) || 0,
    });
  }
  // sort by net desc so the leader is on top
  rows.sort((a, b) => b.net - a.net);
  const key = JSON.stringify(rows.map((r) => [r.i, r.wins, r.losses, r.net]));
  if (key === _scoreKey) return;
  _scoreKey = key;
  const el = ensureScoreboard();
  const hex = (c) => '#' + (c >>> 0).toString(16).padStart(6, '0');
  el.innerHTML =
    '<div style="color:#e3c567;font-weight:800;font-size:12px;letter-spacing:.08em;margin-bottom:6px">TABLE · W / L / NET</div>' +
    rows.map((r) => {
      const netCol = r.net > 0 ? '#3fd07f' : (r.net < 0 ? '#ff6f52' : '#9fb0a6');
      const netStr = (r.net > 0 ? '+' : '') + r.net;
      return '<div style="display:flex;align-items:center;gap:6px;font-size:12.5px;margin:2px 0;' +
        (r.you ? 'font-weight:800' : '') + '">' +
        '<span style="width:9px;height:9px;border-radius:50%;background:' + hex(r.color) + ';flex:none;border:1px solid rgba(255,255,255,.5)"></span>' +
        '<span style="flex:1;color:' + (r.you ? '#ffe9a8' : '#dfeae2') + ';white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:96px">' + r.name + '</span>' +
        '<span style="color:#9fb0a6">' + r.wins + '/' + r.losses + '</span>' +
        '<span style="color:' + netCol + ';font-weight:800;min-width:38px;text-align:right">' + netStr + '</span>' +
        '</div>';
    }).join('');
}
`;
// inject before the betting-board section
s = s.replace(
  `// ───────────────────────── full betting board (DOM overlay) ─────────────────────────`,
  block + `\n// ───────────────────────── full betting board (DOM overlay) ─────────────────────────`
);

// drive it from onState too (live during betting)
s = s.replace(
  `  HUD.render();
  HUD.renderVote(s.vote);
  if (s.phase === 'lobby') HUD.hideOver();`,
  `  HUD.render();
  HUD.renderVote(s.vote);
  renderScoreboard();
  if (s.phase === 'lobby') HUD.hideOver();`
);

fs.writeFileSync(F, s);
console.log('roulette client: table scoreboard (W/L/net) wired');
