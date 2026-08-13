/**
 * book.js — the parlor's sports book + keno, wagered against the platform wallet.
 *
 *   • SPORTS: real live scores proxied from ESPN's public scoreboard API (cached
 *     server-side; the browser can't call ESPN cross-origin). Moneyline bets debit
 *     the wallet up front and settle when the game goes final.
 *   • KENO: a server-authoritative 45s betting + draw cycle. Players pick up to 10
 *     spots and wager; each draw pulls 20 of 80 and pays the catch table. Bets
 *     debit on placement and settle the instant the draw resolves.
 *
 * Wallet ordering mirrors reels: debit(wager) on placement, then on a win
 * settle({wager, payout}) which only CREDITS the payout (the debit already took
 * the stake). Bets are in-memory (keno resolves in <30s; sports finals are polled)
 * — a restart drops in-flight bets, same pragmatic v0 stance as reels free-spins.
 */
import wallet from './wallet.js';

// ───────────────────────── SPORTS (real scores) ─────────────────────────
const LEAGUES = [
  { sport: 'basketball', league: 'nba', label: 'NBA' },
  { sport: 'hockey', league: 'nhl', label: 'NHL' },
  { sport: 'football', league: 'nfl', label: 'NFL' },
  { sport: 'baseball', league: 'mlb', label: 'MLB' },
];
let _scores = { at: 0, games: [] };
let _scoresInflight = null;

function americanToDecimal(ml) {
  if (!ml || isNaN(ml)) return null;
  return ml > 0 ? 1 + ml / 100 : 1 + 100 / -ml;
}
function pickOdds(comp) {
  // ESPN sometimes carries odds on comp.odds[0]; fall back to even-ish (-110).
  try {
    const o = comp.odds && comp.odds[0];
    const h = o && o.homeTeamOdds && americanToDecimal(Number(o.homeTeamOdds.moneyLine));
    const a = o && o.awayTeamOdds && americanToDecimal(Number(o.awayTeamOdds.moneyLine));
    if (h && a) return { home: round2(h), away: round2(a) };
  } catch (e) {}
  return { home: 1.91, away: 1.91 };
}
const round2 = (n) => Math.round(n * 100) / 100;
const half = (n) => Math.round(n * 2) / 2;   // snap to .5

// HOME-perspective spread line. Use the book's posted spread if ESPN has one;
// otherwise (live, no odds) set a live line off the current margin so the favorite
// must KEEP extending the lead to cover. Always hooked to .5 so there's no push.
function deriveSpread(comp, hs, as, state) {
  try {
    const o = comp.odds && comp.odds[0];
    if (o && typeof o.spread === 'number') return half(o.spread) + 0.5 * (o.spread % 1 === 0 ? -1 : 0) || half(o.spread);
  } catch (e) {}
  const margin = hs - as;
  if (state === 'pre' || margin === 0) return -0.5;        // pick'em-ish
  return -(Math.abs(margin) + 0.5) * Math.sign(margin);    // home favored if leading
}

export async function getScores() {
  if (Date.now() - _scores.at < 10000 && _scores.games.length) return _scores.games;
  if (_scoresInflight) return _scoresInflight;
  _scoresInflight = (async () => {
    const out = [];
    for (const L of LEAGUES) {
      try {
        const r = await fetch(`https://site.api.espn.com/apis/site/v2/sports/${L.sport}/${L.league}/scoreboard`, { signal: AbortSignal.timeout(6000) });
        if (!r.ok) continue;
        const j = await r.json();
        for (const ev of (j.events || []).slice(0, 10)) {
          const comp = ev.competitions && ev.competitions[0]; if (!comp) continue;
          const home = (comp.competitors || []).find((c) => c.homeAway === 'home');
          const away = (comp.competitors || []).find((c) => c.homeAway === 'away');
          if (!home || !away) continue;
          const status = ev.status || {};
          const st = status.type || {};
          const ls = (t) => (t.linescores || []).map((l) => Number(l.value != null ? l.value : l.displayValue) || 0);
          const hs = Number(home.score) || 0, as = Number(away.score) || 0;
          const state = st.state || 'pre';
          out.push({
            id: String(ev.id), league: L.label,
            home: home.team.abbreviation, away: away.team.abbreviation,
            homeName: home.team.shortDisplayName, awayName: away.team.shortDisplayName,
            hs, as, state, detail: st.shortDetail || '',
            completed: !!st.completed,
            period: Number(status.period) || 0, clock: status.displayClock || '',
            homeLs: ls(home), awayLs: ls(away),
            winner: home.winner ? 'home' : away.winner ? 'away' : null,
            odds: pickOdds(comp),
            spread: deriveSpread(comp, hs, as, state),   // HOME-perspective line (neg = home favored)
          });
        }
      } catch (e) { /* league unavailable — skip */ }
    }
    if (out.length) _scores = { at: Date.now(), games: out };
    _scoresInflight = null;
    return _scores.games;
  })();
  return _scoresInflight;
}
function gameById(id) { return _scores.games.find((g) => g.id === String(id)) || null; }

// ───────────────────────── SPORTS bets ─────────────────────────
const sportsBets = [];   // { id, pid, name, gameId, side, wager, odds, status, payout, label }
let _betSeq = 0;
const betId = () => 'b' + (Date.now().toString(36)) + '_' + (++_betSeq);

// type: 'ml' | 'spread' | 'quarter'. Pre-game AND live (in-progress) wagering.
export async function placeSportsBet(pid, name, { gameId, type = 'ml', side, wager }) {
  wager = Math.floor(Number(wager) || 0);
  if (wager < 1) return { ok: false, error: 'bet must be at least 1' };
  if (side !== 'home' && side !== 'away') return { ok: false, error: 'pick a side' };
  if (!['ml', 'spread', 'quarter'].includes(type)) return { ok: false, error: 'bad bet type' };
  await getScores();
  const g = gameById(gameId);
  if (!g) return { ok: false, error: 'unknown game' };
  if (g.completed || g.state === 'post') return { ok: false, error: 'game is over' };
  if (type === 'quarter' && g.state !== 'in') return { ok: false, error: 'quarter bets are live only' };

  const odds = 1.91;
  const team = side === 'home' ? g.home : g.away;
  let label, line = null, period = null;
  if (type === 'ml') label = `${team} ML${g.state === 'in' ? ' LIVE' : ''} @ ${odds}`;
  else if (type === 'spread') {
    line = g.spread;                                  // home perspective (captured now)
    const shown = side === 'home' ? line : -line;
    label = `${team} ${shown > 0 ? '+' : ''}${shown}${g.state === 'in' ? ' LIVE' : ''} @ ${odds}`;
  } else { period = g.period || 1; label = `${team} Q${period} @ ${odds}`; }

  const d = await wallet.debitChips(pid, wager, 'sportsbook', { gameId, type, side, line, period });
  if (!d || !d.ok) return { ok: false, error: (d && d.error) || 'not enough chips' };
  const bet = { id: betId(), pid: String(pid), name, gameId, type, side, line, period, wager, odds, status: 'open', label, placedAt: Date.now() };
  sportsBets.push(bet);
  return { ok: true, bet, chips: d.chips };
}

async function settleSportsBets() {
  const open = sportsBets.filter((b) => b.status === 'open');
  if (!open.length) return;
  await getScores();
  for (const b of open) {
    const g = gameById(b.gameId);
    if (!g) continue;
    let outcome = null;   // won | lost | push
    if (b.type === 'quarter') {
      const i = b.period - 1;
      const done = (g.period > b.period || g.completed) && g.homeLs.length > i && g.awayLs.length > i;
      if (!done) continue;
      const hq = g.homeLs[i] || 0, aq = g.awayLs[i] || 0;
      outcome = hq === aq ? 'push' : ((b.side === 'home' ? hq > aq : aq > hq) ? 'won' : 'lost');
    } else {
      if (!g.completed) continue;
      const margin = g.hs - g.as;   // home perspective
      if (b.type === 'spread') {
        const homeCovers = (margin + b.line) > 0;
        outcome = (b.side === 'home' ? homeCovers : !homeCovers) ? 'won' : 'lost';
      } else {
        if (!g.winner) continue;
        outcome = g.winner === b.side ? 'won' : 'lost';
      }
    }
    b.status = outcome;
    b.payout = outcome === 'won' ? Math.round(b.wager * b.odds) : outcome === 'push' ? b.wager : 0;
    b.settledAt = Date.now();
    try { await wallet.settleChips(b.pid, { wager: b.wager, payout: b.payout, game: 'sportsbook', meta: { type: b.type, gameId: b.gameId } }); } catch (e) {}
  }
}

export function mySportsBets(pid) {
  return sportsBets.filter((b) => b.pid === String(pid)).slice(-20).reverse()
    .map((b) => ({ id: b.id, label: b.label, type: b.type, wager: b.wager, status: b.status, payout: b.payout || 0 }));
}

// ───────────────────────── KENO (25s server draw) ─────────────────────────
const KENO_PAYS = {
  1: { 1: 3 }, 2: { 2: 12 }, 3: { 2: 1, 3: 42 }, 4: { 2: 1, 3: 4, 4: 120 },
  5: { 3: 2, 4: 15, 5: 500 }, 6: { 3: 1, 4: 7, 5: 50, 6: 1500 },
  7: { 4: 3, 5: 20, 6: 100, 7: 5000 }, 8: { 5: 10, 6: 50, 7: 1000, 8: 10000 },
  9: { 5: 5, 6: 25, 7: 200, 8: 3000, 9: 20000 },
  10: { 5: 2, 6: 15, 7: 40, 8: 500, 9: 5000, 10: 50000 },
};
const OPEN_MS = 45000, DRAW_MS = 6000, HOLD_MS = 12000;   // slower pace: 45s to bet, 12s to read results
const keno = { drawId: 1, phase: 'open', drawn: [], endsAt: nowPlus(OPEN_MS), last: { drawId: 0, drawn: [] } };
const kenoBets = [];     // { id, pid, name, drawId, spots:[], wager, status, matches, payout }
let _kenoResults = {};   // pid -> latest result summary
const _kenoHistory = {}; // pid -> [ last N settled { drawId, matches, wager, payout } ] for session W/L

function nowPlus(ms) { return Date.now() + ms; }
function drawNumbers() { const s = new Set(); while (s.size < 20) s.add(1 + Math.floor(Math.random() * 80)); return [...s].sort((a, b) => a - b); }

export function kenoState() {
  return {
    drawId: keno.drawId, phase: keno.phase,
    secsLeft: Math.max(0, Math.ceil((keno.endsAt - Date.now()) / 1000)),
    drawn: keno.phase === 'open' ? [] : keno.drawn,
    last: keno.last,
    paytable: KENO_PAYS,
  };
}
export function myKeno(pid) {
  const open = kenoBets.filter((b) => b.pid === String(pid) && b.status === 'open')
    .map((b) => ({ id: b.id, spots: b.spots, wager: b.wager, drawId: b.drawId }));
  return { open, result: _kenoResults[String(pid)] || null };
}

export async function placeKenoBet(pid, name, { spots, wager }) {
  wager = Math.floor(Number(wager) || 0);
  if (wager < 1) return { ok: false, error: 'bet must be at least 1' };
  spots = [...new Set((spots || []).map(Number).filter((n) => n >= 1 && n <= 80))];
  if (spots.length < 1 || spots.length > 10) return { ok: false, error: 'pick 1–10 numbers' };
  if (keno.phase !== 'open') return { ok: false, error: 'draw closed — wait for the next game' };
  const d = await wallet.debitChips(pid, wager, 'keno', { spots, drawId: keno.drawId });
  if (!d || !d.ok) return { ok: false, error: (d && d.error) || 'not enough chips' };
  const bet = { id: betId(), pid: String(pid), name, drawId: keno.drawId, spots, wager, status: 'open' };
  kenoBets.push(bet);
  return { ok: true, bet, chips: d.chips, drawId: keno.drawId };
}

async function resolveKeno() {
  const drawn = keno.drawn, drawId = keno.drawId;
  const bets = kenoBets.filter((b) => b.status === 'open' && b.drawId === drawId);
  for (const b of bets) {
    const matches = b.spots.filter((n) => drawn.includes(n)).length;
    const mult = (KENO_PAYS[b.spots.length] && KENO_PAYS[b.spots.length][matches]) || 0;
    b.status = 'settled'; b.matches = matches; b.payout = Math.round(b.wager * mult);
    try { await wallet.settleChips(b.pid, { wager: b.wager, payout: b.payout, game: 'keno', meta: { drawId, matches } }); } catch (e) {}
    _kenoResults[b.pid] = { drawId, spots: b.spots, drawn, matches, payout: b.payout, wager: b.wager };
    (_kenoHistory[b.pid] || (_kenoHistory[b.pid] = [])).push({ drawId, matches, wager: b.wager, payout: b.payout });
    if (_kenoHistory[b.pid].length > 40) _kenoHistory[b.pid].shift();
  }
}

// ───────────────────────── session W/L record ─────────────────────────
// Combined book record (sports + keno) from in-memory bets. net = chips credited
// back (winnings) minus chips wagered, i.e. session profit/loss.
export function myRecord(pid) {
  pid = String(pid);
  let wins = 0, losses = 0, pushes = 0, wagered = 0, returned = 0;
  for (const b of sportsBets) {
    if (b.pid !== pid || b.status === 'open') continue;
    wagered += b.wager; returned += b.payout || 0;
    if (b.status === 'won') wins++; else if (b.status === 'push') pushes++; else losses++;
  }
  for (const h of (_kenoHistory[pid] || [])) {
    wagered += h.wager; returned += h.payout || 0;
    if (h.payout > 0) wins++; else losses++;
  }
  return { wins, losses, pushes, wagered, returned, net: returned - wagered };
}

// ───────────────────────── loops ─────────────────────────
let _io = null;
export function startBook(io) {
  _io = io || null;
  getScores().catch(() => {});
  // keno cycle
  setInterval(() => {
    if (Date.now() < keno.endsAt) return;
    if (keno.phase === 'open') { keno.phase = 'draw'; keno.drawn = drawNumbers(); keno.endsAt = nowPlus(DRAW_MS); resolveKeno().catch(() => {}); }
    else if (keno.phase === 'draw') { keno.phase = 'hold'; keno.last = { drawId: keno.drawId, drawn: keno.drawn }; keno.endsAt = nowPlus(HOLD_MS); }
    else { keno.drawId += 1; keno.phase = 'open'; keno.drawn = []; keno.endsAt = nowPlus(OPEN_MS); }
    if (_io) { try { _io.emit('book:keno', kenoState()); } catch (e) {} }
  }, 1000);
  // sports refresh + settlement (12s so scores stay live + quarter/spread bets resolve fast)
  setInterval(() => { getScores().then(() => settleSportsBets()).catch(() => {}); }, 12000);
  console.log('[book] sportsbook + keno started (ESPN scores 10s cache, 45s keno betting window)');
}

export default { getScores, placeSportsBet, mySportsBets, kenoState, myKeno, placeKenoBet, myRecord, startBook };
