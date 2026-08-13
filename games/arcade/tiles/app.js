/**
 * tiles.madladslab.com — the tiles platform (dominoes, mahjong next).
 *
 *   - trusts games.madladslab.com identity via the SSO bridge (routes/auth)
 *   - Socket.IO live tables (services/socket.js) on top of @mll/tiles-engine
 *   - variant registry (lib/variants) — dominoes first
 *
 * Mirrors the cards platform exactly; only the engine differs. Live tables are
 * created by matchmaking via a signed ticket (shared BRIDGE_SECRET).
 */
import express from 'express';
import http from 'http';
import helmet from 'helmet';
import cors from 'cors';
import session from 'express-session';
import path from 'path';
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { createHash } from 'crypto';
import { fileURLToPath } from 'url';
import { Server as SocketServer } from 'socket.io';

import config, { reportConfigStatus } from './config/index.js';
import * as engine from './engine/index.js';
import authRouter from './routes/auth.js';
import { attachTableSockets } from './services/socket.js';
import { createTable, listTables, nextTableId, findSeatByPlatformId, findSeatsByPlatformId, findOpenSeatAtTable, listCasinoTables, placeAtCasinoTable, listLiveTables } from './lib/tables.js';
import { listVariants, getVariant } from './lib/variants/index.js';
import { mintTicket, verifyTicket } from './lib/tickets.js';
import { aiHealth } from './services/ai/client.js';
import { listScenes, sceneUrlFor, generateScene } from './services/art/scene-backgrounds.js';
import { getRecentWin } from './services/wallet-sync.js';
import * as book from './lib/book.js';
import wallet from './lib/wallet.js';
import jwt from 'jsonwebtoken';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const server = http.createServer(app);

app.set('trust proxy', 1);
app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors({ origin: config.allowedOrigins, credentials: true }));
app.use(express.json());
app.use('/static', express.static(path.join(__dirname, 'public')));

const sessionMiddleware = session({
  name: 'tiles.sid', // distinct host-only name so it never shadows games.sid / cards.sid
  secret: config.session.secret,
  resave: false,
  saveUninitialized: false,
  cookie: { sameSite: 'lax', secure: config.env === 'production', maxAge: 8 * 60 * 60 * 1000 },
});
app.use(sessionMiddleware);

app.use('/auth', authRouter);

// Mint a short-lived modal ticket for the global-modal iframe (screen name only).
app.post('/modal-ticket', (req, res) => {
  const u = req.session.user;
  if (!u) return res.status(401).json({ error: 'not signed in' });
  const ticket = jwt.sign(
    { platformId: String(u.platformId), displayName: u.displayName, surface: (req.body && req.body.surface) || 'tiles', isAdmin: !!u.isAdmin },
    config.platform.bridgeSecret, { expiresIn: '10m' }
  );
  res.json({ ok: true, ticket });
});

// Dev: save a camera framing posted from the 3D client's SAVE ANGLE button. Phone
// has no dev tools, so the client POSTs pos/target here and we append to a file
// the operator can read. No auth needed — harmless dev data, loopback+site only.
app.post('/dev/cam', (req, res) => {
  try {
    const line = JSON.stringify({ at: new Date().toISOString(), ...(req.body || {}) }) + '\n';
    appendFileSync(path.join(__dirname, 'camlog.txt'), line);
  } catch (e) { console.log('[tiles] camlog err', e.message); }
  res.json({ ok: true });
});

// --- per-game opening camera (persisted; applied at table entry) ---
// The 3D debug cog's SAVE ANGLE posts here; createTable3D() reads it on entry and
// snaps to the saved framing so every player opens on the locked-in angle. One
// JSON file keyed by lowercase game slug, mirroring the scene-backgrounds pattern.
const CAM_FILE = path.join(__dirname, 'config', 'cameras.json');
function readCameras() {
  try { return JSON.parse(readFileSync(CAM_FILE, 'utf8')); } catch (e) { return {}; }
}

// Public read: the 3D table fetches this at entry. Returns null camera if unset.
app.get('/scene/camera/:game', (req, res) => {
  const cams = readCameras();
  const cam = cams[String(req.params.game).toLowerCase()] || null;
  res.json({ ok: true, game: String(req.params.game).toLowerCase(), camera: cam });
});

// Admin/loopback save (same gate as /dev/table): upsert this game's opening framing.
app.post('/dev/camera/:game', (req, res) => {
  if (!devAllowed(req)) return res.status(403).json({ error: 'forbidden' });
  const { start, target, fov } = req.body || {};
  if (!start || !target) return res.status(400).json({ error: 'start and target required' });
  const key = String(req.params.game).toLowerCase();
  const cams = readCameras();
  cams[key] = { start, target, ...(fov ? { fov: Number(fov) } : {}), at: new Date().toISOString() };
  try {
    writeFileSync(CAM_FILE, JSON.stringify(cams, null, 2));
    appendFileSync(path.join(__dirname, 'camlog.txt'),
      JSON.stringify({ at: cams[key].at, game: key, start, target }) + '\n');
  } catch (e) { return res.status(500).json({ error: e.message }); }
  res.json({ ok: true, game: key, camera: cams[key] });
});

app.get('/health', (req, res) => {
  res.json({
    ok: true, service: 'tiles-platform',
    engine: engine.ENGINE_VERSION, protocol: engine.PROTOCOL,
    variants: listVariants(), tables: listTables().length, uptime: process.uptime(),
  });
});

// --- dealer voice: cached proxy to the local Piper TTS service (:8091) ---
// The browser can't reach Piper (loopback + http on an https site), so tiles
// proxies it and disk-caches each short phrase so repeats are instant.
//   GET /tts?text=Yo-leven!&voice=ryan  -> audio/wav
const TTS_CACHE = path.join(__dirname, '.ttscache');
try { mkdirSync(TTS_CACHE, { recursive: true }); } catch (e) {}
const TTS_VOICES = new Set(['lessac', 'ryan', 'cori', 'awb', 'rms', 'slt']);
app.get('/tts', async (req, res) => {
  const text = String(req.query.text || '').slice(0, 240).trim();
  const voice = TTS_VOICES.has(String(req.query.voice)) ? String(req.query.voice) : 'ryan';
  if (!text) return res.status(400).end();
  const key = createHash('sha1').update(voice + '|' + text).digest('hex');
  const file = path.join(TTS_CACHE, key + '.wav');
  res.setHeader('Content-Type', 'audio/wav');
  res.setHeader('Cache-Control', 'public, max-age=604800');
  try {
    if (existsSync(file)) { res.end(readFileSync(file)); return; }
    const r = await fetch('http://127.0.0.1:8091/v1/audio/speech', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ input: text, voice }),
    });
    if (!r.ok) return res.status(502).end();
    const buf = Buffer.from(await r.arrayBuffer());
    try { writeFileSync(file, buf); } catch (e) {}
    res.end(buf);
  } catch (e) { if (!res.writableEnded) res.status(502).end(); }
});

// AI gateway liveness (SD tunnel) — diagnostics only.
app.get('/health/ai', async (req, res) => {
  res.json(await aiHealth());
});

// Catalog — matchmaking reads this to learn which tile games exist + how to seat.
app.get('/catalog', (req, res) => {
  const games = listVariants()
    .map((v) => getVariant(v.id))
    .filter((variant) => variant && variant.catalog)
    .map((variant) => ({ id: variant.id, name: variant.name, ...variant.catalog }));
  res.json({ ok: true, games });
});

// --- SD scene backgrounds for the 3D table ---
// The client asks "is there a backdrop for this variant?" and, if so, hands the
// URL to createTable3D({ bgImage }). Images are pre-generated (dev endpoint/cron),
// so these reads are just disk lookups — never trigger SD inline.
app.get('/scene/catalog', (req, res) => {
  res.json({ ok: true, scenes: listScenes() });
});
app.get('/scene/url/:slug', (req, res) => {
  res.json({ ok: true, slug: req.params.slug, url: sceneUrlFor(req.params.slug) });
});

// Lobby/table client per game. Matchmaking hands off here with a table ticket:
//   /lobby/dominoes?ticket=<jwt>
// Dominoes defaults to the three.js (3D) client; ?r=2d serves the canvas fallback.
app.get('/lobby/:game', (req, res) => {
  // Establish an HTTP cookie-session identity from the table ticket so same-origin
  // endpoints (the parlor sports book + keno betting) know who the player is.
  // Matchmaking entry sets the SOCKET identity but not the cookie session — without
  // this, /book/* sees no session and bets fail with "sign in to bet".
  if (!req.session.user && req.query.ticket) {
    try {
      const t = verifyTicket(req.query.ticket);
      if (t && t.platformId) req.session.user = { platformId: String(t.platformId), displayName: t.displayName || 'Player', isAdmin: false };
    } catch (e) { /* bad ticket — stay anonymous */ }
  }
  // dominoes defaults to the 3D client (?r=2d for the canvas fallback). Card games
  // ported from the cards platform use their 2D client during the migration until
  // card rendering lands on the 3D table.
  const clients3d = {
    dominoes: 'dominoes3d.html', hearts: 'hearts3d.html',
    euchre: 'euchre3d.html', mahjong: 'mahjong3d.html',
    craps: 'craps3d.html', roulette: 'roulette3d.html',
    blackjack: 'blackjack3d.html',
    baccarat: 'baccarat3d.html',
  };
  const clients2d = { dominoes: 'dominoes.html', hearts: 'hearts.html' };
  const want2d = req.query.r === '2d';
  const pick = (want2d ? clients2d : clients3d)[req.params.game];
  // engine-backed games without a bespoke client use the shared interactive client;
  // anything truly unprovisioned still falls back to the read-only scaffold.
  const file = pick || 'scaffold3d.html';
  res.sendFile(path.join(__dirname, 'public', file));
});

app.get('/', (req, res) => {
  const u = req.session.user;
  res.type('html').send(
    `<!doctype html><meta charset="utf-8"><title>tiles.madladslab</title>` +
      `<body style="font-family:system-ui;background:#0a0a0a;color:#e5e5e5;display:flex;` +
      `align-items:center;justify-content:center;min-height:100vh;margin:0">` +
      `<div style="text-align:center"><h1 style="letter-spacing:.1em">TILES</h1>` +
      `<p style="color:#737373">tiles platform · engine ${engine.ENGINE_VERSION} · ${engine.PROTOCOL}</p>` +
      `<p style="color:#737373">${u ? 'signed in as ' + u.displayName : '<a style="color:#60a5fa" href="/auth/platform">sign in via platform</a>'}</p>` +
      `</div></body>`
  );
});

// --- arcade launch: deep-link from games into a live table (vs bots) ---
app.get('/play/:game', (req, res) => {
  if (req.query.token) {
    const p = verifyTicket(req.query.token);
    if (p && p.id) {
      const perms = p.permissions || {};
      req.session.user = {
        platformId: String(p.id), email: p.email,
        displayName: p.displayName || (p.email || 'Player').split('@')[0],
        isAdmin: p.isAdmin === true || perms.games === 'admin' || perms.tiles === 'admin',
        permissions: perms,
      };
    }
  }
  const user = req.session.user;
  if (!user) return res.redirect('/auth/platform');
  const game = req.params.game;
  const variant = getVariant(game);
  if (!variant) return res.redirect('/?error=unknown_game');

  const seats = (variant.meta && variant.meta.seating && variant.meta.seating.seats) || (variant.catalog && variant.catalog.players) || 4;
  const tableId = nextTableId('arc');
  const players = [];
  const fillBots = !(variant.meta && variant.meta.seating && variant.meta.seating.fillWithBots === false);
  if (fillBots) for (let s = 1; s < seats; s++) players.push({ seat: s, bot: true, displayName: `Bot ${s + 1}` });
  try { createTable({ tableId, game, config: {}, players }); }
  catch (e) { return res.redirect('/?error=' + encodeURIComponent(e.message)); }

  const ticket = mintTicket({
    tableId, game, params: {}, seat: 0,
    platformId: user.platformId, displayName: user.displayName, players,
  });
  res.redirect(`/lobby/${encodeURIComponent(game)}?ticket=` + encodeURIComponent(ticket));
});

// --- dev: create a table + mint seat tickets (loopback or platform admin only) ---
function devAllowed(req) {
  const ip = req.ip || '';
  const local = ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1';
  return local || req.session?.user?.isAdmin === true;
}

app.post('/dev/table', (req, res) => {
  if (!devAllowed(req)) return res.status(403).json({ error: 'forbidden' });
  const { game = 'dominoes', config: cfg = {}, seats = [] } = req.body || {};
  const variant = getVariant(game);
  if (!variant) return res.status(400).json({ error: 'unknown game' });
  const seatCount = (variant.meta && variant.meta.seating && variant.meta.seating.seats) || 4;
  const tableId = nextTableId();
  const players = [];
  for (let i = 0; i < seatCount; i++) {
    if (seats[i] && seats[i].bot) players.push({ seat: i, bot: true, displayName: seats[i].name || `Bot ${i + 1}` });
  }
  let table;
  try { table = createTable({ tableId, game, config: cfg, players }); }
  catch (e) { return res.status(400).json({ error: e.message }); }
  const tickets = [];
  for (let i = 0; i < seatCount; i++) {
    if (table.seats[i].bot) continue;
    tickets.push({
      seat: i,
      ticket: mintTicket({
        tableId, game, params: cfg, seat: i,
        platformId: `dev:${tableId}:${i}`,
        displayName: (seats[i] && seats[i].name) || `Player ${i + 1}`,
        players,
      }),
    });
  }
  res.json({ ok: true, tableId, game, tickets, state: table.publicState() });
});

app.get('/dev/tables', (req, res) => {
  if (!devAllowed(req)) return res.status(403).json({ error: 'forbidden' });
  res.json({ tables: listTables() });
});

// Dev: generate an SD scene background now (loopback or platform admin only).
//   POST /dev/scene { slug, prompt?, size?, steps? }
// Slow (SD inference) — generous timeout; intended for operator/seed use.
app.post('/dev/scene', async (req, res) => {
  if (!devAllowed(req)) return res.status(403).json({ error: 'forbidden' });
  const { slug, prompt, size, steps } = req.body || {};
  if (!slug) return res.status(400).json({ error: 'slug required' });
  const r = await generateScene(slug, { prompt, size, steps });
  res.status(r.ok ? 200 : 502).json(r);
});

// --- internal: which live seat does a platform user hold? (reconnect / resume) ---
app.get('/internal/seat', (req, res) => {
  if (req.headers['x-bridge-secret'] !== config.platform.bridgeSecret) return res.status(401).json({ error: 'unauthorized' });
  const pid = req.query.platformId;
  if (!pid) return res.status(400).json({ error: 'platformId required' });
  res.json({ ok: true, seat: findSeatByPlatformId(pid) });
});

// --- internal: ALL live seats a platform user holds (match board "my games") ---
app.get('/internal/seats', (req, res) => {
  if (req.headers['x-bridge-secret'] !== config.platform.bridgeSecret) return res.status(401).json({ error: 'unauthorized' });
  const pid = req.query.platformId;
  if (!pid) return res.status(400).json({ error: 'platformId required' });
  res.json({ ok: true, seats: findSeatsByPlatformId(pid) });
});

// --- internal: resolve a seat a walk-up can take at a specific live table ---
// (open seat, else a bot seat to displace). Powers "tap any table → sit down".
app.get('/internal/table/:id/seat', (req, res) => {
  if (req.headers['x-bridge-secret'] !== config.platform.bridgeSecret) return res.status(401).json({ error: 'unauthorized' });
  res.json({ ok: true, seat: findOpenSeatAtTable(req.params.id) });
});

// ── Parlor BOOK: real sports scores + keno, wagered from the wallet ──
app.get('/book/sports', async (req, res) => {
  try { res.json({ ok: true, games: await book.getScores() }); }
  catch (e) { res.json({ ok: true, games: [] }); }
});
app.get('/book/keno', (req, res) => res.json({ ok: true, ...book.kenoState() }));
app.get('/book/mybets', async (req, res) => {
  const u = req.session.user;
  if (!u) return res.json({ ok: true, signedIn: false, sports: [], keno: { open: [], result: null }, record: null });
  let chips = null;
  try { const w = await wallet.getChips(u.platformId, u.displayName); chips = w && w.chips; } catch (e) {}
  res.json({ ok: true, signedIn: true, chips, sports: book.mySportsBets(u.platformId), keno: book.myKeno(u.platformId), record: book.myRecord(u.platformId) });
});
app.post('/book/sports/bet', async (req, res) => {
  const u = req.session.user;
  if (!u) return res.status(401).json({ ok: false, error: 'sign in to bet' });
  res.json(await book.placeSportsBet(u.platformId, u.displayName, req.body || {}));
});
app.post('/book/keno/bet', async (req, res) => {
  const u = req.session.user;
  if (!u) return res.status(401).json({ ok: false, error: 'sign in to bet' });
  res.json(await book.placeKenoBet(u.platformId, u.displayName, req.body || {}));
});

// --- public: other open tables, for the 3D room's background "satellite" tables ---
// Privacy-safe + trimmed: just enough to render a distant table you can tap to go
// play. Excludes ?exclude=<tableId> (your own table). No seats/names leaked.
app.get('/scene/tables', (req, res) => {
  const exclude = req.query.exclude || null;
  const tables = listLiveTables()
    // only advertise LIVE tables — at least one connected human, not finished.
    // abandoned / all-bot / gameOver tables linger up to the reap grace; don't
    // surface them as satellites "no one is associated with".
    .filter((t) => t.tableId !== exclude && t.connectedHumans > 0 && t.phase !== 'gameOver')
    .map((t) => ({
      tableId: t.tableId, game: t.game, phase: t.phase,
      seatCount: t.seatCount, humans: t.humans,
      names: (t.humanNames || []).slice(0, 4),     // privacy-safe screen names only
      lastWin: getRecentWin(t.tableId),            // { name, amount, ts } | null — drives from-afar win pops
      // progress for the back-wall scoreboard
      handNo: t.handNo, gamesPlayed: t.gamesPlayed, scores: t.scores,
      topScore: t.topScore, casino: t.casino,
    }));
  res.json({ ok: true, tables });
});

// --- all live tables, for the cross-game match dashboard (bridge-authed) ---
app.get('/internal/tables', (req, res) => {
  if (req.headers['x-bridge-secret'] !== config.platform.bridgeSecret) return res.status(401).json({ error: 'unauthorized' });
  res.json({ ok: true, platform: 'tiles', tables: listLiveTables() });
});

// --- casino table listing + placement (matchmaking calls these, bridge-authed) ---
// List open continuous casino tables (with min bet + occupancy) so matchmaking
// can show a lobby of tables across a few minimums.
app.get('/internal/casino/tables', (req, res) => {
  if (req.headers['x-bridge-secret'] !== config.platform.bridgeSecret) return res.status(401).json({ error: 'unauthorized' });
  res.json({ ok: true, tables: listCasinoTables(req.query.game || null) });
});

// Resolve placement: find an open seat at the requested minimum, or create a new
// table there. Returns { tableId, seat } ready for matchmaking to mint a ticket.
// body: { game, min, seats?, startChips?, displayName?, platformId? }
app.post('/internal/casino/place', (req, res) => {
  if (req.headers['x-bridge-secret'] !== config.platform.bridgeSecret) return res.status(401).json({ error: 'unauthorized' });
  const { game, min, seats = 6, startChips = 500, platformId = null, displayName = null } = req.body || {};
  if (!game || !min) return res.status(400).json({ error: 'game and min required' });
  const placed = placeAtCasinoTable(game, Number(min));
  if (!placed.needCreate) {
    return res.json({ ok: true, tableId: placed.tableId, seat: placed.seat, created: false, min: Number(min) });
  }
  // create a fresh continuous table at this minimum, seat the requester at 0, fill bots
  const tableId = nextTableId('cas');
  // Seat the requester only; leave the rest OPEN so other humans can fill them.
  // Empty seats are bot-filled at start time (see advance() for continuous tables).
  const players = [{ seat: 0, platformId, displayName, bot: false }];
  try {
    createTable({ tableId, game, config: { betSize: Number(min), startChips: Number(startChips) }, players });
  } catch (e) {
    return res.status(400).json({ error: e.message });
  }
  res.json({ ok: true, tableId, seat: 0, created: true, min: Number(min) });
});

// --- sockets ---
const io = new SocketServer(server, {
  cors: { origin: config.allowedOrigins, methods: ['GET', 'POST'], credentials: true },
});
io.engine.use(sessionMiddleware);
app.set('io', io);
attachTableSockets(io);
book.startBook(io);

server.listen(config.port, () => {
  console.log(`[tiles] listening on :${config.port} (${config.publicUrl})`);
  console.log(`[tiles] engine ${engine.ENGINE_VERSION} · variants: ${listVariants().map((v) => v.id).join(', ')}`);
  for (const line of reportConfigStatus()) console.log('[tiles]', line);
});
