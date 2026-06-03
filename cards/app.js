/**
 * cards.madladslab.com — the cards platform.
 *
 *   - trusts games.madladslab.com identity via the SSO bridge (routes/auth)
 *   - Socket.IO live tables (services/socket.js) on top of @mll/cards-engine
 *   - variant registry (lib/variants) — euchre plugs in next
 *
 * Live tables are created by matchmaking via a signed ticket. Until matchmaking
 * exists, /dev/table (loopback- or admin-gated) creates tables + mints tickets.
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
import * as engine from './engine/index.js';
import authRouter from './routes/auth.js';
import { attachTableSockets } from './services/socket.js';
import { createTable, listTables, nextTableId, findSeatByPlatformId, listLiveTables } from './lib/tables.js';
import { listVariants, getVariant } from './lib/variants/index.js';
import { mintTicket, verifyTicket } from './lib/tickets.js';
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
  name: 'cards.sid', // distinct name; host-only so it never shadows games.sid
  secret: config.session.secret,
  resave: false,
  saveUninitialized: false,
  cookie: {
    sameSite: 'lax',
    secure: config.env === 'production', maxAge: 8 * 60 * 60 * 1000,
  },
});
app.use(sessionMiddleware);

// --- routes ---
app.use('/auth', authRouter);

// Mint a short-lived modal ticket for the global-modal iframe (screen name only).
// The loader (loader.js) POSTs here with the session cookie; the games panel
// verifies the returned JWT with the shared BRIDGE_SECRET.
app.post('/modal-ticket', (req, res) => {
  const u = req.session.user;
  if (!u) return res.status(401).json({ error: 'not signed in' });
  const ticket = jwt.sign(
    { platformId: String(u.platformId), displayName: u.displayName, surface: (req.body && req.body.surface) || 'cards', isAdmin: !!u.isAdmin },
    config.platform.bridgeSecret, { expiresIn: '10m' }
  );
  res.json({ ok: true, ticket });
});

app.get('/health', (req, res) => {
  res.json({
    ok: true, service: 'cards-platform',
    engine: engine.ENGINE_VERSION, protocol: engine.PROTOCOL,
    variants: listVariants(), tables: listTables().length, uptime: process.uptime(),
  });
});

app.get('/table', (req, res) => res.sendFile(path.join(__dirname, 'public', 'table.html')));

// Catalog — the universal arcade-intake source: matchmaking reads this to learn
// which card games exist and how to seat them (players, partnerships, lobby).
app.get('/catalog', (req, res) => {
  const games = listVariants()
    .map((v) => getVariant(v.id))
    .filter((variant) => variant && variant.catalog)
    .map((variant) => ({ id: variant.id, name: variant.name, ...variant.catalog }));
  res.json({ ok: true, games });
});

// Lobby/table client per game. Matchmaking hands off here with a table ticket:
//   /lobby/euchre?ticket=<jwt>  -> the euchre lobby + live table client.
app.get('/lobby/:game', (req, res) => {
  const clients = { euchre: 'euchre.html', hearts: 'hearts.html' };
  const file = clients[req.params.game] || 'table.html';
  res.sendFile(path.join(__dirname, 'public', file));
});

app.get('/', (req, res) => {
  const u = req.session.user;
  res.type('html').send(
    `<!doctype html><meta charset="utf-8"><title>cards.madladslab</title>` +
      `<body style="font-family:system-ui;background:#0a0a0a;color:#e5e5e5;display:flex;` +
      `align-items:center;justify-content:center;min-height:100vh;margin:0">` +
      `<div style="text-align:center"><h1 style="letter-spacing:.1em">CARDS</h1>` +
      `<p style="color:#737373">cards platform · engine ${engine.ENGINE_VERSION} · ${engine.PROTOCOL}</p>` +
      `<p style="color:#737373">${u ? 'signed in as ' + u.displayName : '<a style="color:#60a5fa" href="/auth/platform">sign in via platform</a>'}</p>` +
      `</div></body>`
  );
});

// --- arcade launch: deep-link from games.madladslab.com into a live table ---
// The arcade tile bounces the player through the platform bridge to
// /play/:game?token=<jwt>. We verify the token (same BRIDGE_SECRET), seat the
// player vs 3 bots, mint a seat ticket, and drop them into the table client.
app.get('/play/:game', (req, res) => {
  // accept a fresh platform bridge token (same secret as table tickets)
  if (req.query.token) {
    const p = verifyTicket(req.query.token);
    if (p && p.id) {
      const perms = p.permissions || {};
      req.session.user = {
        platformId: String(p.id),
        email: p.email,
        displayName: p.displayName || (p.email || 'Player').split('@')[0],
        isAdmin: p.isAdmin === true || perms.games === 'admin' || perms.cards === 'admin',
        permissions: perms,
      };
    }
  }
  const user = req.session.user;
  if (!user) return res.redirect('/auth/platform');
  const game = req.params.game;
  if (!getVariant(game)) return res.redirect('/?error=unknown_game');

  const tableId = nextTableId('arc');
  const players = [
    { seat: 1, bot: true, displayName: 'Bot West' },
    { seat: 2, bot: true, displayName: 'Bot North' },
    { seat: 3, bot: true, displayName: 'Bot East' },
  ];
  try { createTable({ tableId, game, config: {}, players }); }
  catch (e) { return res.redirect('/?error=' + encodeURIComponent(e.message)); }

  const ticket = mintTicket({
    tableId, game, params: {}, seat: 0,
    platformId: user.platformId, displayName: user.displayName, players,
  });
  res.redirect('/table?ticket=' + encodeURIComponent(ticket));
});

// --- dev: create a table + mint seat tickets (loopback or platform admin only) ---
function devAllowed(req) {
  const ip = req.ip || '';
  const local = ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1';
  return local || req.session?.user?.isAdmin === true;
}

app.post('/dev/table', (req, res) => {
  if (!devAllowed(req)) return res.status(403).json({ error: 'forbidden' });
  const { game = 'trial', config: cfg = {}, seats = [] } = req.body || {};
  const tableId = nextTableId();
  const players = [];
  for (let i = 0; i < 4; i++) {
    if (seats[i] && seats[i].bot) players.push({ seat: i, bot: true, displayName: seats[i].name || `Bot ${i + 1}` });
  }
  let table;
  try { table = createTable({ tableId, game, config: cfg, players }); }
  catch (e) { return res.status(400).json({ error: e.message }); }
  const tickets = [];
  for (let i = 0; i < 4; i++) {
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

// --- internal: which live seat does a platform user hold? (reconnect / resume) ---
// Cards is the source of truth for live tables; matchmaking calls this with the
// shared bridge secret to re-issue a ticket into an existing seat after a drop.
app.get('/internal/seat', (req, res) => {
  if (req.headers['x-bridge-secret'] !== config.platform.bridgeSecret) return res.status(401).json({ error: 'unauthorized' });
  const pid = req.query.platformId;
  if (!pid) return res.status(400).json({ error: 'platformId required' });
  res.json({ ok: true, seat: findSeatByPlatformId(pid) });
});

// All live tables for the cross-game match dashboard (bridge-authed).
app.get('/internal/tables', (req, res) => {
  if (req.headers['x-bridge-secret'] !== config.platform.bridgeSecret) return res.status(401).json({ error: 'unauthorized' });
  res.json({ ok: true, platform: 'cards', tables: listLiveTables() });
});

// --- sockets ---
const io = new SocketServer(server, {
  cors: { origin: config.allowedOrigins, methods: ['GET', 'POST'], credentials: true },
});
io.engine.use(sessionMiddleware);
app.set('io', io);
attachTableSockets(io);

server.listen(config.port, () => {
  console.log(`[cards] listening on :${config.port} (${config.publicUrl})`);
  console.log(`[cards] engine ${engine.ENGINE_VERSION} · variants: ${listVariants().map((v) => v.id).join(', ')}`);
  for (const line of reportConfigStatus()) console.log('[cards]', line);
});
