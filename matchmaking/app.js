/**
 * match.madladslab.com — matchmaking: the universal arcade-intake loader.
 *
 * Navigation: games (portal) -> matchmaking (here) -> game lobby (cards).
 * Matchmaking owns ONLY intake + grouping. It authenticates the player via the
 * platform bridge, reads the game loader's catalog to learn how to seat them,
 * forms a group (bots on request; quick-match falls back to bots; private invite
 * pulls a chosen online user in), mints signed table tickets, redirects into the
 * game's lobby, and steps out. It never holds the lobby or runs gameplay.
 *
 *   GET /intake/:game?token=<jwt>     bridge lands here; establishes identity
 *   GET /intake/:game/info            JSON: who am I + what is this game
 *   GET /intake/:game/go?mode=...      form group -> mint ticket -> 302 to lobby
 *   GET /intake/:game/online          online portal users to invite (screen names)
 *   GET /intake/:game/invite?to=&name= private table -> push invite -> host to lobby
 */
import express from 'express';
import http from 'http';
import helmet from 'helmet';
import cors from 'cors';
import session from 'express-session';
import path from 'path';
import { fileURLToPath } from 'url';

import { Server as SocketServer } from 'socket.io';
import config, { reportConfigStatus } from './config/index.js';
import { verifyBridgeToken, mintTableTicket } from './lib/tickets.js';
import { startDashboard, getState, setNameResolver } from './lib/dashboard.js';
import jwt from 'jsonwebtoken';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const server = http.createServer(app);

app.set('trust proxy', 1);
app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors({ origin: config.allowedOrigins, credentials: true }));
app.use(express.json());
app.use('/static', express.static(path.join(__dirname, 'public')));

app.use(session({
  name: 'mm.sid',
  secret: config.session.secret,
  resave: false,
  saveUninitialized: false,
  cookie: { sameSite: 'lax', secure: config.env === 'production', maxAge: 8 * 60 * 60 * 1000 },
}));

// Arcade art lives on the platform (games); resolve relative image paths there.
function absImage(image) {
  if (!image) return null;
  return image.startsWith('http') ? image : config.platform.url + image;
}

// Authenticated calls to the platform's internal API (online users / invites).
async function gamesInternal(pathname, { method = 'GET', body = null } = {}) {
  const r = await fetch(`${config.platform.url}/internal${pathname}`, {
    method,
    headers: { 'content-type': 'application/json', 'x-bridge-secret': config.platform.bridgeSecret },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(4500),
  });
  return r.json();
}

// Authenticated call to a game platform's internal API (live-seat lookup, etc).
async function platformInternal(platformKey, pathname) {
  const plat = config.platforms[platformKey];
  if (!plat) throw new Error('unknown platform ' + platformKey);
  const r = await fetch(`${plat.internal}${pathname}`, {
    headers: { 'x-bridge-secret': config.platform.bridgeSecret },
    signal: AbortSignal.timeout(4000),
  });
  return r.json();
}

// Casino tables: a few minimum-bet tiers players can pick. The minimum becomes the
// table's betSize (engine reads config.betSize). Continuous tables persist until
// everyone leaves; matchmaking lists open ones and fills seats or spins up new.
const CASINO_GAMES = new Set(['craps', 'roulette', 'blackjack', 'baccarat']);
const CASINO_MINS = [5, 25, 100];
const CASINO_START = 500;   // bankroll seed (wallet sync overrides for real users)

async function tilesCasino(pathname, { method = 'GET', body = null } = {}) {
  const base = config.platforms.tiles.internal;
  const r = await fetch(`${base}${pathname}`, {
    method,
    headers: { 'content-type': 'application/json', 'x-bridge-secret': config.platform.bridgeSecret },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(4500),
  });
  return r.json();
}

// Find a player's live seat across ALL platforms (for /active + /resume). Returns
// { ...seat, platform } or null. Prefers an in-progress table over a finished one.
async function findActiveSeat(platformId) {
  let best = null;
  for (const key of Object.keys(config.platforms)) {
    try {
      const j = await platformInternal(key, `/internal/seat?platformId=${encodeURIComponent(platformId)}`);
      const seat = j && j.seat;
      if (seat) {
        const cand = { ...seat, platform: key };
        if (!best || (best.phase === 'gameOver' && cand.phase !== 'gameOver')) best = cand;
      }
    } catch (e) { /* platform down — skip */ }
  }
  return best;
}

// --- catalog lookup across ALL game platforms, cached briefly ---
// Each game is tagged with its platform key so handoff routes to the right host.
let catalogCache = { at: 0, games: [] };
async function getCatalog() {
  if (Date.now() - catalogCache.at < 30000 && catalogCache.games.length) return catalogCache.games;
  const all = [];
  for (const key of Object.keys(config.platforms)) {
    try {
      const r = await fetch(`${config.platforms[key].internal}/catalog`, { signal: AbortSignal.timeout(4000) });
      const j = await r.json();
      for (const g of (j.games || [])) all.push({ ...g, platform: key });
    } catch (e) { /* platform down — skip its games */ }
  }
  if (all.length) catalogCache = { at: Date.now(), games: all };
  return catalogCache.games;
}
// Explicit platform overrides win over catalog order when a game exists on more
// than one platform (e.g. during the cards->tiles migration, hearts lives on both
// but should route to tiles). Add/remove entries here to flip a game's host.
const GAME_PLATFORM = {
  hearts: 'tiles',
  dominoes: 'tiles',
  euchre: 'tiles',     // ported to tiles (overrides the legacy cards euchre)
  mahjong: 'tiles',
  craps: 'tiles',
  roulette: 'tiles',
  blackjack: 'tiles',
  baccarat: 'tiles',
};
async function findGame(id) {
  try {
    const all = await getCatalog();
    const pref = GAME_PLATFORM[id];
    if (pref) {
      const onPref = all.find((g) => g.id === id && g.platform === pref);
      if (onPref) return onPref;
    }
    return all.find((g) => g.id === id) || null;
  } catch (e) { return null; }
}
// Public lobby base for a game (its own platform).
function publicFor(game) {
  const plat = config.platforms[(game && game.platform) || 'cards'];
  return (plat || config.platforms.cards).public;
}

// --- routes ---
// Mint a short-lived modal ticket for the global-modal iframe (screen name only).
app.post('/modal-ticket', (req, res) => {
  const u = req.session.user;
  if (!u) return res.status(401).json({ error: 'not signed in' });
  const ticket = jwt.sign(
    { platformId: String(u.platformId), displayName: u.displayName, surface: (req.body && req.body.surface) || 'match', isAdmin: !!u.isAdmin },
    config.platform.bridgeSecret, { expiresIn: '10m' }
  );
  res.json({ ok: true, ticket });
});

app.get('/health', (req, res) => {
  res.json({ ok: true, service: 'matchmaking', protocol: 'arcade-intake/v1', uptime: process.uptime() });
});

app.get('/intake/:game', async (req, res) => {
  if (req.query.token) {
    const p = verifyBridgeToken(req.query.token);
    if (p && p.id) {
      const perms = p.permissions || {};
      req.session.user = {
        platformId: String(p.id),
        // displayName from the bridge is the public SCREEN NAME (never real name/email)
        displayName: p.displayName || 'Player',
        isAdmin: p.isAdmin === true || perms.games === 'admin' || perms.cards === 'admin',
      };
    }
  }
  if (!req.session.user) {
    return res.redirect(`${config.platform.url}/arcade/${encodeURIComponent(req.params.game)}/play`);
  }
  const game = await findGame(req.params.game);
  if (!game) return res.status(404).send('Unknown game');
  res.sendFile(path.join(__dirname, 'public', 'intake.html'));
});

app.get('/intake/:game/info', async (req, res) => {
  if (!req.session.user) return res.status(401).json({ error: 'not signed in' });
  const game = await findGame(req.params.game);
  if (!game) return res.status(404).json({ error: 'unknown game' });
  // mark the player active so they're invitable while sitting in matchmaking
  gamesInternal('/presence/heartbeat', { method: 'POST',
    body: { platformId: req.session.user.platformId, name: req.session.user.displayName } }).catch(() => {});
  res.json({
    ok: true,
    game: { id: game.id, name: game.name, blurb: game.blurb, players: game.players, image: absImage(game.image) },
    user: { displayName: req.session.user.displayName },
  });
});

// Lightweight heartbeat ping (intake page calls this on a timer to stay invitable).
app.get('/intake/:game/heartbeat', async (req, res) => {
  if (!req.session.user) return res.status(401).json({ error: 'not signed in' });
  gamesInternal('/presence/heartbeat', { method: 'POST',
    body: { platformId: req.session.user.platformId, name: req.session.user.displayName } }).catch(() => {});
  res.json({ ok: true });
});

// Poll for an incoming invite (covers players in matchmaking with no portal socket).
app.get('/intake/:game/poll-invite', async (req, res) => {
  if (!req.session.user) return res.status(401).json({ error: 'not signed in' });
  try {
    const j = await gamesInternal(`/invites/pending?platformId=${encodeURIComponent(req.session.user.platformId)}&consume=1`);
    res.json({ ok: true, invite: (j && j.invite) || null });
  } catch (e) { res.json({ ok: true, invite: null }); }
});

// Online portal users available to invite (screen names only, minus self).
app.get('/intake/:game/online', async (req, res) => {
  if (!req.session.user) return res.status(401).json({ error: 'not signed in' });
  try {
    const j = await gamesInternal(`/online-users?exclude=${encodeURIComponent(req.session.user.platformId)}`);
    res.json({ ok: true, users: j.users || [] });
  } catch (e) {
    res.json({ ok: true, users: [] });
  }
});

// Quick group: player seat 0, the rest bots. (quick-match == bots until a pool.)
// Whitelist + coerce per-game settings from the intake query into ticket params.
function buildParams(gameId, q) {
  const p = {};
  if ((gameId === 'craps' || gameId === 'roulette')) {
    const m = parseInt(q.min, 10);
    if ([5, 25, 100].includes(m)) p.betSize = m;
  }
  if (gameId === 'dominoes') {
    if (q.spinnerRule && ['first', 'all', 'none'].includes(q.spinnerRule)) p.spinnerRule = q.spinnerRule;
    if (q.target) { const t = parseInt(q.target, 10); if (t >= 25 && t <= 250) p.target = t; }
    if (q.drawGame === 'false') p.drawGame = false;
    if (q.drawGame === 'true') p.drawGame = true;
  }
  return p;
}

app.get('/intake/:game/go', async (req, res) => {
  if (!req.session.user) {
    return res.redirect(`${config.platform.url}/arcade/${encodeURIComponent(req.params.game)}/play`);
  }
  const game = await findGame(req.params.game);
  if (!game) return res.status(404).send('Unknown game');

  const mode = req.query.mode === 'quick' ? 'quick' : 'bots';
  const seats = game.players || 4;
  const user = req.session.user;
  const players = [];
  for (let s = 1; s < seats; s++) players.push({ seat: s, bot: true, displayName: `Bot ${s + 1}` });

  // Per-game settings chosen on the intake page travel into the ticket params and
  // are honored by the engine (e.g. dominoes spinnerRule + target). We whitelist
  // known keys + coerce types so the query can't inject arbitrary config.
  const params = buildParams(game.id, req.query);

  const tableId = `mm_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
  const ticket = mintTableTicket({
    tableId, game: game.id, params, seat: 0,
    platformId: user.platformId, displayName: user.displayName, players, via: 'matchmaking', mode,
  }, '8h');
  res.redirect(`${publicFor(game)}${game.lobbyPath || `/lobby/${game.id}`}?ticket=${encodeURIComponent(ticket)}`);
});

// Private invite: host seat 0, invitee seat 1, bots fill the rest. Push an
// invite to the invitee's portal presence; send the host straight into the lobby.
app.get('/intake/:game/invite', async (req, res) => {
  if (!req.session.user) {
    return res.redirect(`${config.platform.url}/arcade/${encodeURIComponent(req.params.game)}/play`);
  }
  const game = await findGame(req.params.game);
  if (!game) return res.status(404).send('Unknown game');
  const to = String(req.query.to || '');
  const toName = String(req.query.name || 'Player').slice(0, 32);
  if (!to) return res.status(400).send('invite target required');

  const host = req.session.user;
  const seats = game.players || 4;
  const lobbyPath = game.lobbyPath || `/lobby/${game.id}`;
  const tableId = `mm_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;

  const players = [];
  for (let s = 2; s < seats; s++) players.push({ seat: s, bot: true, displayName: `Bot ${s + 1}` });
  const base = { tableId, game: game.id, params: {}, players, via: 'matchmaking', mode: 'invite' };

  const hostTicket = mintTableTicket({ ...base, seat: 0, platformId: host.platformId, displayName: host.displayName }, '8h');
  const inviteeTicket = mintTableTicket({ ...base, seat: 1, platformId: to, displayName: toName }, '8h');
  const joinUrl = `${publicFor(game)}${lobbyPath}?ticket=${encodeURIComponent(inviteeTicket)}`;

  try {
    await gamesInternal('/invite', {
      method: 'POST',
      body: { toPlatformId: to, fromName: host.displayName, game: game.name, joinUrl, inviteId: tableId },
    });
  } catch (e) { /* best-effort: host still enters and can wait or add a bot */ }

  res.redirect(`${publicFor(game)}${lobbyPath}?ticket=${encodeURIComponent(hostTicket)}`);
});

// Shareable invite link/QR: create a table, seat the host, and return a join URL
// the host can copy or show as a QR. The first friend to open it takes seat 1.
// (Returns JSON; the intake page renders copy + QR. Host enters via the returned
// hostUrl when ready, or immediately.)
app.get('/intake/:game/share', async (req, res) => {
  if (!req.session.user) return res.status(401).json({ error: 'not signed in' });
  const game = await findGame(req.params.game);
  if (!game) return res.status(404).json({ error: 'unknown game' });

  const host = req.session.user;
  const seats = game.players || 4;
  const lobbyPath = game.lobbyPath || `/lobby/${game.id}`;
  const tableId = `mm_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;

  const players = [];
  for (let s = 2; s < seats; s++) players.push({ seat: s, bot: true, displayName: `Bot ${s + 1}` });
  const base = { tableId, game: game.id, params: {}, players, via: 'matchmaking', mode: 'invite' };

  const hostTicket = mintTableTicket({ ...base, seat: 0, platformId: host.platformId, displayName: host.displayName }, '8h');
  // open seat-1 ticket — bound to a one-off guest id; whoever opens the link fills it
  const guestId = `guest:${tableId}`;
  const guestTicket = mintTableTicket({ ...base, seat: 1, platformId: guestId, displayName: 'Guest' }, '8h');

  const joinUrl = `${publicFor(game)}${lobbyPath}?ticket=${encodeURIComponent(guestTicket)}`;
  const hostUrl = `${publicFor(game)}${lobbyPath}?ticket=${encodeURIComponent(hostTicket)}`;
  res.json({ ok: true, tableId, joinUrl, hostUrl, game: game.name });
});

// --- user game management: rejoin an in-progress table after a drop/reload ---
// Cards holds the live tables, so it answers "what seat is this user in"; match
// re-mints a fresh ticket into that exact seat. Survives match restarts.
app.get('/active', async (req, res) => {
  if (!req.session.user) return res.status(401).json({ error: 'not signed in' });
  try {
    const seat = await findActiveSeat(req.session.user.platformId);
    res.json({ ok: true, active: seat || null });
  } catch (e) { res.json({ ok: true, active: null }); }
});

app.get('/resume', async (req, res) => {
  if (!req.session.user) return res.redirect(`${config.platform.url}/`);
  const user = req.session.user;
  let seat = null;
  try { seat = await findActiveSeat(user.platformId); }
  catch (e) { seat = null; }
  if (!seat) return res.redirect(`${config.platform.url}/`);
  const ticket = mintTableTicket({
    tableId: seat.tableId, game: seat.game, params: {}, seat: seat.seat,
    platformId: user.platformId, displayName: user.displayName, players: [], via: 'matchmaking', mode: 'resume',
  }, '8h');
  const plat = config.platforms[seat.platform] || config.platforms.cards;
  res.redirect(`${plat.public}/lobby/${encodeURIComponent(seat.game)}?ticket=${encodeURIComponent(ticket)}`);
});

// --- CASINO: list open tables across minimums, and join/fill one ---------------
// JSON listing for the casino lobby UI: for each minimum tier, the open tables
// (with occupancy) plus how many seats are free. Players pick a tier/table.
app.get('/casino/:game/tables', async (req, res) => {
  if (!req.session.user) return res.status(401).json({ error: 'not signed in' });
  const game = req.params.game;
  if (!CASINO_GAMES.has(game)) return res.status(404).json({ error: 'not a casino game' });
  let live = [];
  try { const j = await tilesCasino(`/internal/casino/tables?game=${encodeURIComponent(game)}`); live = (j && j.tables) || []; }
  catch (e) { live = []; }
  // group by minimum tier; always show every tier even if it has no live table yet
  const tiers = CASINO_MINS.map((min) => {
    const tables = live.filter((t) => t.min === min).map((t) => ({
      tableId: t.tableId, humans: t.humans, seats: t.seats, openSeats: t.openSeats.length,
    }));
    const openSeats = tables.reduce((a, t) => a + t.openSeats, 0);
    return { min, tables, openSeats, anyOpen: openSeats > 0 };
  });
  res.json({ ok: true, game, tiers, mins: CASINO_MINS });
});

// Join a casino table at a chosen minimum (or a specific tableId). Resolves an
// open seat (or creates a fresh table), mints a ticket, and 302s into the lobby.
app.get('/casino/:game/join', async (req, res) => {
  if (!req.session.user) {
    return res.redirect(`${config.platform.url}/arcade/${encodeURIComponent(req.params.game)}/play`);
  }
  const game = await findGame(req.params.game);
  if (!game || !CASINO_GAMES.has(game.id)) return res.status(404).send('not a casino game');
  const user = req.session.user;
  const min = CASINO_MINS.includes(parseInt(req.query.min, 10)) ? parseInt(req.query.min, 10) : CASINO_MINS[0];

  let placed;
  try {
    placed = await tilesCasino('/internal/casino/place', {
      method: 'POST',
      body: { game: game.id, min, seats: game.players || 6, startChips: CASINO_START,
        platformId: user.platformId, displayName: user.displayName },
    });
  } catch (e) { return res.status(502).send('casino unavailable'); }
  if (!placed || !placed.ok) return res.status(502).send('could not place at a table');

  // bots fill the remaining seats for a fresh table; an existing table already has its lineup.
  // box-model games (blackjack: 7 betting circles) keep empty seats OPEN so a player can
  // claim multiple boxes solo and other humans can sit in — so they get no bot fill.
  const BOX_GAMES = new Set(['blackjack', 'baccarat']);   // no bot-fill; personas + humans take seats
  const seats = game.players || 6;
  const players = [];
  if (placed.created && !BOX_GAMES.has(game.id)) for (let sn = 1; sn < seats; sn++) players.push({ seat: sn, bot: true, displayName: 'Bot ' + (sn + 1) });

  const ticket = mintTableTicket({
    tableId: placed.tableId, game: game.id, params: { betSize: min, startChips: CASINO_START },
    seat: placed.seat, platformId: user.platformId, displayName: user.displayName,
    players, via: 'matchmaking', mode: 'casino',
  }, '8h');
  res.redirect(`${publicFor(game)}${game.lobbyPath || `/lobby/${game.id}`}?ticket=${encodeURIComponent(ticket)}`);
});

// --- live cross-game dashboard ---------------------------------------------
// The board itself (full live view of every open room/table across games).
app.get('/dashboard', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'dashboard.html'));
});
// REST snapshot — initial paint + no-socket fallback (screen-name-safe).
app.get('/dashboard/state', (req, res) => res.json(getState()));

app.get('/', (req, res) => res.redirect(`${config.platform.url}/`));

// --- Socket.IO: broadcast the live dashboard snapshot to subscribers ---------
const io = new SocketServer(server, {
  cors: { origin: config.allowedOrigins, methods: ['GET', 'POST'], credentials: true },
});
io.on('connection', (socket) => {
  socket.join('dashboard');
  socket.emit('dash:snapshot', getState());
});
// Resolve game ids to display names from match's merged catalog cache.
setNameResolver((id) => {
  const g = catalogCache.games.find((x) => x.id === id);
  return (g && g.name) || id;
});

server.listen(config.port, () => {
  console.log(`[match] listening on :${config.port} (${config.publicUrl})`);
  console.log(`[match] platforms = ${Object.keys(config.platforms).join(', ')}`);
  for (const line of reportConfigStatus()) console.log('[match]', line);
  getCatalog().catch(() => {});   // warm catalog so dashboard names resolve at once
  startDashboard(io);             // begin the cross-game aggregation loop
  console.log('[match] live dashboard aggregator started → room "dashboard"');
});
