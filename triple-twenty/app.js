require('dotenv').config();
const express  = require('express');
const http     = require('http');
const { Server } = require('socket.io');
const session  = require('express-session');
const MongoStore = require('connect-mongo');
const mongoose = require('mongoose');
const path     = require('path');

const passport = require('./config/passport');

const app    = express();
const server = http.createServer(app);
const io     = new Server(server, { cors: { origin: '*' } });

const PORT = process.env.PORT || 3710;

// ── Trust proxy (Caddy/nginx in front) ──
app.set('trust proxy', 1);

// ── Global error handlers ──
process.on('unhandledRejection', (reason) => {
  console.error('[unhandledRejection]', reason);
});
process.on('uncaughtException', (err) => {
  console.error('[uncaughtException]', err.message, err.stack);
});

// ── Mongoose ──
mongoose.connect(process.env.MONGO_URI)
  .then(() => console.log('✔ MongoDB connected'))
  .catch(err => console.error('✘ MongoDB error:', err));

// ── Middleware ──
app.use(express.json({ limit: '20mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));
// Training frames — sha256-named, unguessable paths; immutable.
app.use('/frames', express.static(path.join(__dirname, 'data', 'frames'), {
  immutable: true, maxAge: '30d', fallthrough: false
}));

const sessionMiddleware = session({
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  store: MongoStore.create({ mongoUrl: process.env.MONGO_URI }),
  cookie: {
    maxAge: 1000 * 60 * 60 * 24 * 7,
    secure: process.env.NODE_ENV === 'production', // https only in prod
    sameSite: 'lax'
  }
});

app.use(sessionMiddleware);
app.use(passport.initialize());
app.use(passport.session());
io.use((socket, next) => sessionMiddleware(socket.request, {}, next));

app.use((req, res, next) => {
  res.locals.user = req.user || null;
  req.io = io;
  next();
});

// ── View engine ──
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// ── Routes ──
app.use('/auth', require('./routes/auth'));
app.use('/',     require('./routes/game'));
app.use('/api',  require('./routes/api'));

// ── 404 handler ──
app.use((req, res) => {
  res.status(404).render('pages/404', { title: 'Not Found' });
});

// ── Express error handler ──
app.use((err, req, res, next) => {
  console.error('[Express error]', err.message);
  if (res.headersSent) return next(err);
  res.status(500).json({ error: 'Internal server error' });
});

// ══════════════════════════════════════════════════
// Socket.IO
// ══════════════════════════════════════════════════
const gameRooms = {};
const userRooms = {};
// Per-game registry of WebRTC peers (sockets that opted into PvP video).
// Keyed by gameId → Map<socketId, { displayName, hasCam, hasMic }>.
// Mesh model — 2-4 players is the platform max, so direct N×N is fine.
const rtcPeers = {};

io.on('connection', (socket) => {

  socket.on('register-user', ({ userId, displayName }) => {
    if (!userId) return;
    socket.userId      = userId;
    socket.displayName = displayName;
    socket.join(`user:${userId}`);
    if (!userRooms[userId]) userRooms[userId] = new Set();
    userRooms[userId].add(socket.id);
  });

  socket.on('join-game', ({ gameId, role, playerName, hasCam }) => {
    socket.join(`game:${gameId}`);
    if (!gameRooms[gameId]) gameRooms[gameId] = { players: new Map(), host: null };
    socket.gameId     = gameId;
    socket.role       = role;
    socket.playerName = playerName;
    if (role === 'host') {
      gameRooms[gameId].host = socket.id;
    } else if (role === 'remote') {
      gameRooms[gameId].players.set(socket.id, { name: playerName, hasCam: hasCam || false });
    }
    io.to(`game:${gameId}`).emit('player-connected', {
      socketId: socket.id, role, playerName, hasCam,
      remoteCount: gameRooms[gameId].players.size
    });
    socket.emit('room-state', {
      remoteCount: gameRooms[gameId].players.size,
      players: Array.from(gameRooms[gameId].players.values())
    });
  });

  socket.on('player-analysis', ({ gameId, playerIndex, playerName, analysis, frame }) => {
    socket.to(`game:${gameId}`).emit('player-analysis', { playerIndex, playerName, analysis, frame });
    io.emit('lobby-frame', { gameId, playerIndex: playerIndex || 0, frame, analysis });
  });

  socket.on('analysis-result', ({ gameId, analysis, frame }) => {
    socket.to(`game:${gameId}`).emit('analysis-result', { analysis, frame });
  });

  socket.on('game-update', ({ gameId, game }) => {
    socket.to(`game:${gameId}`).emit('game-update', { game });
  });

  socket.on('game-chat', ({ gameId, message, playerName }) => {
    io.to(`game:${gameId}`).emit('game-chat', {
      message, playerName, time: new Date().toISOString()
    });
  });

  // ── WebRTC PvP video signaling (mesh) ──
  // Client joins by sending rtc-join with the gameId they want video for.
  // We respond with the existing peer list, then broadcast their arrival.
  // Each pair negotiates with offer/answer/ice; sender of the offer is the
  // peer that joined LATER (newcomer offers, existing peers answer).
  socket.on('rtc-join', ({ gameId, displayName, hasCam, hasMic, playerIndex, role }) => {
    if (!gameId) return;
    socket.join(`rtc:${gameId}`);
    socket.rtcGameId = gameId;
    if (!rtcPeers[gameId]) rtcPeers[gameId] = new Map();
    const me = {
      displayName: displayName || socket.displayName || socket.playerName || 'Player',
      hasCam: !!hasCam,
      hasMic: !!hasMic,
      // playerIndex maps a peer to a slot in the TV/audience views.
      // Pass -1 (or omit) for non-player observers (TV, scoreboard, audience).
      playerIndex: (typeof playerIndex === 'number') ? playerIndex : -1,
      role: role || 'player'   // 'player' | 'viewer' | 'host'
    };
    const existing = Array.from(rtcPeers[gameId].entries())
      .map(([sid, info]) => ({ peerId: sid, ...info }));
    rtcPeers[gameId].set(socket.id, me);
    socket.emit('rtc-peers', { peers: existing });
    socket.to(`rtc:${gameId}`).emit('rtc-peer-joined', { peerId: socket.id, ...me });
  });

  // Viewer-mode clients (TV scoreboard, audience) call this when they need
  // to observe a game's video stream without publishing. Same as rtc-join
  // but role is forced to 'viewer' and they are explicitly NOT offered to
  // by other peers (they pull, not push). Implementation reuses rtc-join
  // logic — viewers count as peers in the room and receive offers from
  // newly-joining publishers.
  // (Single signaling path — keeps the contract simple; viewers just don't
  //  add tracks to their RTCPeerConnection.)

  socket.on('rtc-leave', () => {
    const gid = socket.rtcGameId;
    if (gid && rtcPeers[gid]) {
      rtcPeers[gid].delete(socket.id);
      if (!rtcPeers[gid].size) delete rtcPeers[gid];
      socket.to(`rtc:${gid}`).emit('rtc-peer-left', { peerId: socket.id });
    }
    socket.leave(`rtc:${gid}`);
    socket.rtcGameId = null;
  });

  socket.on('rtc-offer', ({ targetPeerId, sdp }) => {
    if (!targetPeerId) return;
    io.to(targetPeerId).emit('rtc-offer', { fromPeerId: socket.id, sdp });
  });
  socket.on('rtc-answer', ({ targetPeerId, sdp }) => {
    if (!targetPeerId) return;
    io.to(targetPeerId).emit('rtc-answer', { fromPeerId: socket.id, sdp });
  });
  socket.on('rtc-ice', ({ targetPeerId, candidate }) => {
    if (!targetPeerId) return;
    io.to(targetPeerId).emit('rtc-ice', { fromPeerId: socket.id, candidate });
  });
  socket.on('rtc-media-toggle', ({ kind, enabled }) => {
    const gid = socket.rtcGameId;
    if (!gid) return;
    socket.to(`rtc:${gid}`).emit('rtc-media-toggle', { peerId: socket.id, kind, enabled });
  });

  socket.on('disconnect', () => {
    if (socket.gameId && gameRooms[socket.gameId]) {
      gameRooms[socket.gameId].players.delete(socket.id);
      io.to(`game:${socket.gameId}`).emit('player-disconnected', {
        playerName: socket.playerName, role: socket.role
      });
    }
    if (socket.userId && userRooms[socket.userId]) {
      userRooms[socket.userId].delete(socket.id);
      if (!userRooms[socket.userId].size) delete userRooms[socket.userId];
    }
    const gid = socket.rtcGameId;
    if (gid && rtcPeers[gid]) {
      rtcPeers[gid].delete(socket.id);
      if (!rtcPeers[gid].size) delete rtcPeers[gid];
      io.to(`rtc:${gid}`).emit('rtc-peer-left', { peerId: socket.id });
    }
  });
});

io.notifyUser = function(userId, event, payload) {
  if (!userId) return;
  io.to(`user:${userId.toString()}`).emit(event, payload);
};

io.lobbyUpdate = function() {
  io.emit('lobby-update', {});
};

// ══════════════════════════════════════════════════
// IDLE GAME SWEEPER
// Marks active/waiting games as 'idle' after N minutes with no round activity.
// Idle games are preserved (not archived) and can be resumed from the dashboard.
// ══════════════════════════════════════════════════
const IDLE_MINUTES = parseInt(process.env.IDLE_MINUTES || '120', 10);
const SWEEP_INTERVAL_MS = parseInt(process.env.IDLE_SWEEP_MS || '60000', 10); // check every minute
const Game = require('./models/Game');

async function sweepIdleGames() {
  try {
    const cutoff = new Date(Date.now() - IDLE_MINUTES * 60 * 1000);
    // Consider either lastActivityAt (explicit) or updatedAt (implicit for older games).
    const candidates = await Game.find({
      status: { $in: ['active', 'waiting'] },
      $or: [
        { lastActivityAt: { $lt: cutoff } },
        { lastActivityAt: { $exists: false }, updatedAt: { $lt: cutoff } }
      ]
    });
    for (const g of candidates) {
      g.pausedFromStatus = g.status;
      g.status = 'idle';
      await g.save();
      io.to(`game:${g._id}`).emit('game-idle', { gameId: g._id.toString(), idleMinutes: IDLE_MINUTES });
      io.lobbyUpdate();
      // Notify linked players on all their devices
      g.players.forEach(p => {
        if (p.userId) io.notifyUser(p.userId, 'game-notification', {
          type:    'game-idle',
          gameId:  g._id.toString(),
          gameName: g.name || `${g.mode.toUpperCase()} · ${g.players.map(x=>x.name).join(' vs ')}`,
          message: `⏸ Game paused — idle for ${IDLE_MINUTES} min. Resume from dashboard.`,
          link:    '/dashboard'
        });
      });
      console.log(`[idle-sweeper] paused game ${g._id} (${g.name || g.mode})`);
    }
  } catch (err) {
    console.error('[idle-sweeper] error:', err.message);
  }
}
setInterval(sweepIdleGames, SWEEP_INTERVAL_MS);
// Run once at startup after a short delay so Mongo is connected
setTimeout(sweepIdleGames, 10000);

server.listen(PORT, () => console.log(`Triple-Twenty running on port ${PORT} (idle after ${IDLE_MINUTES} min)`));
