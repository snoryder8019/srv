require('dotenv').config();
const express = require('express');
const session = require('express-session');
const MongoStore = require('connect-mongo');
const passport = require('passport');
const LocalStrategy = require('passport-local').Strategy;
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const bcrypt = require('bcryptjs');
const { MongoClient, ObjectId } = require('mongodb');

const http = require('http');
const { Server: SocketIO } = require('socket.io');
const broadcasts = require('./lib/broadcasts');
const statsCollector = require('./lib/stats-collector');
const sfu = require('./lib/sfu');
const provisioner = require('./lib/linode-provisioner');
const playtime = require('./lib/playtime');
const worldBackup = require('./lib/world-backup');
const serverCam = require('./lib/server-cam');

const app = express();
const server = http.createServer(app);
const ALLOWED_ORIGINS = [
  'https://games.madladslab.com',
  'https://madladslab.com',
  'https://www.madladslab.com',
  'https://bih.madladslab.com',
];
const io = new SocketIO(server, { cors: { origin: ALLOWED_ORIGINS, methods: ['GET', 'POST'], credentials: true } });
app.set('io', io);
const PORT = process.env.GAMES_PORT || 3500;
const DB_URL = process.env.DB_URL;
const SESSION_SECRET = process.env.SESHSEC;
if (!SESSION_SECRET) {
  console.error('[games] FATAL: SESHSEC environment variable is required');
  process.exit(1);
}

// --- MongoDB ---
let db;
const client = new MongoClient(DB_URL);
client.connect().then(() => {
  db = client.db();
  app.locals.db = db;
  statsCollector.init(db);
  provisioner.init(db);
  playtime.init(db);
  worldBackup.init(db);
  serverCam.init();
  sfu.init().catch(e => console.error('[sfu] Init failed:', e.message));
  // Check for inactive provisioned servers every 10 minutes
  setInterval(() => provisioner.checkInactivity().catch(() => {}), 10 * 60 * 1000);
  console.log('[games] MongoDB connected');
}).catch(err => {
  console.error('[games] MongoDB connection failed:', err.message);
  process.exit(1);
});

// --- Passport ---
passport.use(new LocalStrategy(
  { usernameField: 'email' },
  async (email, password, done) => {
    try {
      const user = await db.collection('users').findOne({ email });
      if (!user) return done(null, false, { message: 'Email not found' });
      const match = await bcrypt.compare(password, user.password || '');
      if (!match) return done(null, false, { message: 'Incorrect password' });
      return done(null, user);
    } catch (e) {
      done(e);
    }
  }
));

passport.use(new GoogleStrategy(
  {
    clientID: process.env.GGLCID,
    clientSecret: process.env.GGLSEC,
    callbackURL: 'https://games.madladslab.com/auth/google/callback',
    proxy: true,
  },
  async (accessToken, refreshToken, profile, done) => {
    try {
      const users = db.collection('users');
      const email = profile.emails[0].value;
      let user = await users.findOne({ email });
      if (!user) {
        const result = await users.insertOne({
          providerID: profile.id,
          provider: 'google',
          email,
          displayName: profile.displayName,
          firstName: profile.name.givenName,
          lastName: profile.name.familyName,
          password: '',
          isAdmin: false,
          contest: 'player',
          notifications: [],
          images: [],
          subscription: 'free',
        });
        user = await users.findOne({ _id: result.insertedId });
      }
      done(null, user);
    } catch (e) {
      done(e);
    }
  }
));

passport.serializeUser((user, done) => done(null, user._id.toString()));
passport.deserializeUser(async (id, done) => {
  try {
    const user = await db.collection('users').findOne({ _id: new ObjectId(id) });
    done(null, user || false);
  } catch (e) {
    done(e);
  }
});

// --- Middleware ---
app.set('trust proxy', 1); // Trust Apache reverse proxy for secure cookies
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const sessionMiddleware = session({
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  store: MongoStore.create({
    mongoUrl: DB_URL,
    collectionName: 'sessions',
  }),
  cookie: { secure: true, httpOnly: true, sameSite: 'lax', maxAge: 7 * 24 * 60 * 60 * 1000 },
});
app.use(sessionMiddleware);

app.use(passport.initialize());
app.use(passport.session());

// Static assets
app.use('/static', express.static(__dirname + '/public'));

// --- Routes ---
app.use('/', require('./routes/index'));
app.use('/api', require('./routes/api'));
app.use('/internal', require('./routes/internal'));
app.use('/admin', require('./routes/admin'));
app.use('/broadcasts', require('./routes/broadcasts'));
app.use('/stats', require('./routes/stats'));
app.use('/suggest', require('./routes/suggest'));
app.use('/plugins', require('./routes/plugins'));
app.use('/servers', require('./routes/servers'));

// --- Server Camera (2D map overlay) ---
app.get('/server-cam', (req, res) => res.sendFile('server-cam.html', { root: __dirname + '/public' }));
app.get('/server-cam/status', (req, res) => res.json(serverCam.getCamStatus()));
app.get('/server-cam/rust', (req, res) => res.json(serverCam.getRustMapState()));

// --- Socket.IO (shared session for optional auth) ---
io.engine.use(sessionMiddleware);
io.engine.use(passport.initialize());
io.engine.use(passport.session());

// --- Admin Socket.IO namespace (superadmin only, log streaming) ---
const logStreamer = require('./lib/log-streamer');
const adminNs = io.of('/admin');

adminNs.use((socket, next) => {
  const req = socket.request;
  if (req.user && req.user.isAdmin === true) return next();
  const sess = req.session;
  if (sess && sess.passport && sess.passport.user) {
    db.collection('users').findOne({ _id: new ObjectId(sess.passport.user) })
      .then(user => {
        if (!user || !user.isAdmin) return next(new Error('superadmin_required'));
        req.user = user;
        next();
      })
      .catch(() => next(new Error('superadmin_required')));
  } else {
    next(new Error('superadmin_required'));
  }
});

adminNs.on('connection', (socket) => {
  // Subscribe to game log stream
  socket.on('logs:subscribe', (game) => {
    const validGames = ['rust', 'valheim', 'l4d2', '7dtd'];
    if (!validGames.includes(game)) return socket.emit('logs:error', 'Invalid game');

    // Stop any existing stream for this socket
    logStreamer.stopStream(socket.id + ':' + game);

    const streamId = logStreamer.startStream(
      socket.id + ':' + game,
      game,
      (lines) => { socket.emit('logs:lines', { game, lines }); },
      { tail: 100, interval: 1000 }
    );

    if (streamId) socket.emit('logs:subscribed', { game });
  });

  socket.on('logs:unsubscribe', (game) => {
    logStreamer.stopStream(socket.id + ':' + game);
  });

  socket.on('disconnect', () => {
    ['rust', 'valheim', 'l4d2', '7dtd'].forEach(g => {
      logStreamer.stopStream(socket.id + ':' + g);
    });
  });
});

// --- Stats Socket.IO namespace (public, no auth) ---
const statsNs = io.of('/stats');

statsNs.on('connection', (socket) => {
  // Client can subscribe to a specific game or all
  socket.on('stats:subscribe', (game) => {
    if (game) {
      socket.join('game:' + game);
    } else {
      socket.join('game:all');
    }
  });
});

// Pipe stats collector events to Socket.IO
statsCollector.emitter.on('event', (event) => {
  serverCam.addEvent(event);
  const safeEvent = {
    game: event.game,
    type: event.type,
    ts: event.ts,
    name: event.name || null,
    steamId: event.steamId || null,
    message: event.message || null,
    attacker: event.attacker || null,
    victim: event.victim || null,
    map: event.map || null,
  };
  statsNs.to('game:' + event.game).emit('stats:event', safeEvent);
  statsNs.to('game:all').emit('stats:event', safeEvent);
});

statsCollector.emitter.on('snapshot', (snapshot) => {
  statsNs.to('game:' + snapshot.game).emit('stats:snapshot', snapshot);
  statsNs.to('game:all').emit('stats:snapshot', snapshot);
});

statsCollector.emitter.on('playerlist', (data) => {
  statsNs.to('game:' + data.game).emit('stats:playerlist', data);
  statsNs.to('game:all').emit('stats:playerlist', data);
});

const broadcastNs = io.of('/broadcasts');

// Auth is OPTIONAL for broadcasts — viewers can be anonymous
broadcastNs.use((socket, next) => {
  const req = socket.request;
  if (req.user) return next();
  const sess = req.session;
  if (sess && sess.passport && sess.passport.user) {
    db.collection('users').findOne({ _id: new ObjectId(sess.passport.user) })
      .then(user => {
        if (user) req.user = user;
        next(); // allow even if no user (anonymous viewer)
      })
      .catch(() => next());
  } else {
    next(); // anonymous is OK
  }
});

broadcastNs.on('connection', (socket) => {
  const user = socket.request.user || null;
  const uid = user ? user._id.toString() : null;
  const uname = user ? (user.displayName || user.firstName || user.email) : 'Viewer';
  const urole = broadcasts.getUserRole(user);

  socket.on('broadcast:join', (code) => {
    const b = broadcasts.getBroadcast(code);
    if (!b) return socket.emit('broadcast:error', 'Broadcast not found');

    const result = broadcasts.addViewer(code, user);
    if (result.error) return socket.emit('broadcast:error', result.error);

    socket.join(code);
    socket.broadcastCode = code;

    // Send state to joining viewer
    socket.emit('broadcast:state', broadcasts.serializeBroadcast(b, true));

    // Notify broadcaster of new viewer (for WebRTC offer)
    if (b.host.socketId && b.live) {
      broadcastNs.to(b.host.socketId).emit('broadcast:viewer-joined', {
        socketId: socket.id,
        name: uname,
      });
    }

    // Update viewer count for everyone
    broadcastNs.to(code).emit('broadcast:viewer-count', broadcasts.getViewerCount(code));
    broadcastNs.to(code).emit('broadcast:system', uname + ' joined');
  });

  // Broadcaster goes live (screen share started)
  socket.on('broadcast:go-live', (code) => {
    if (!uid) return;
    const b = broadcasts.getBroadcast(code);
    if (!b || b.host.id !== uid) return socket.emit('broadcast:error', 'Not authorized');

    broadcasts.setLive(code, socket.id);
    broadcastNs.to(code).emit('broadcast:live');
    console.log('[broadcast] LIVE:', code, '(' + b.game + ') by', uname);
  });

  // Broadcaster stops
  socket.on('broadcast:stop', (code) => {
    if (!uid) return;
    const b = broadcasts.getBroadcast(code);
    if (!b || b.host.id !== uid) return;

    broadcastNs.to(code).emit('broadcast:ended');
    broadcasts.endBroadcast(code);
    sfu.closeRoom(code);
    console.log('[broadcast] ENDED:', code);
  });

  // WebRTC signaling: offer (broadcaster → viewer)
  socket.on('broadcast:offer', (data) => {
    broadcastNs.to(data.targetSocketId).emit('broadcast:offer', {
      sdp: data.sdp,
      fromSocketId: socket.id,
    });
  });

  // WebRTC signaling: answer (viewer → broadcaster)
  socket.on('broadcast:answer', (data) => {
    broadcastNs.to(data.targetSocketId).emit('broadcast:answer', {
      sdp: data.sdp,
      fromSocketId: socket.id,
    });
  });

  // WebRTC signaling: ICE candidates (both directions)
  socket.on('broadcast:ice', (data) => {
    if (data.targetSocketId) {
      broadcastNs.to(data.targetSocketId).emit('broadcast:ice', {
        candidate: data.candidate,
        fromSocketId: socket.id,
      });
    } else {
      // Viewer sending ICE to broadcaster
      const b = broadcasts.getBroadcast(data.code);
      if (b && b.host.socketId) {
        broadcastNs.to(b.host.socketId).emit('broadcast:ice', {
          candidate: data.candidate,
          fromSocketId: socket.id,
        });
      }
    }
  });

  // Chat
  socket.on('broadcast:chat', (text) => {
    if (!socket.broadcastCode || !uid) return;
    const cleaned = String(text || '').trim().slice(0, 500);
    if (!cleaned) return;
    const msg = broadcasts.addMessage(socket.broadcastCode, uid, uname, urole, cleaned);
    if (!msg) return;
    if (msg.error) return socket.emit('broadcast:error', msg.error);
    broadcastNs.to(socket.broadcastCode).emit('broadcast:chat', msg);
  });

  // Emoji reactions
  socket.on('broadcast:emoji-react', (emoji) => {
    if (!socket.broadcastCode) return;
    broadcastNs.to(socket.broadcastCode).emit('broadcast:emoji-react', {
      name: uname, emoji: String(emoji).slice(0, 4),
    });
  });

  // Mod: kick
  socket.on('broadcast:kick', (targetId) => {
    if (!socket.broadcastCode || !uid) return;
    const result = broadcasts.kickViewer(socket.broadcastCode, uid, targetId);
    if (result.error) return socket.emit('broadcast:error', result.error);
    for (const [, s] of broadcastNs.sockets) {
      if (s.request.user && s.request.user._id.toString() === targetId) {
        s.emit('broadcast:kicked', 'You were kicked');
        s.leave(socket.broadcastCode);
        s.broadcastCode = null;
      }
    }
    broadcastNs.to(socket.broadcastCode).emit('broadcast:viewer-count',
      broadcasts.getViewerCount(socket.broadcastCode));
  });

  // Mod: mute
  socket.on('broadcast:mute', (targetId) => {
    if (!socket.broadcastCode || !uid) return;
    const result = broadcasts.muteViewer(socket.broadcastCode, uid, targetId);
    if (result.error) return socket.emit('broadcast:error', result.error);
    broadcastNs.to(socket.broadcastCode).emit('broadcast:system',
      'A user was ' + (result.muted ? 'muted' : 'unmuted'));
  });

  // Mod: ban
  socket.on('broadcast:ban', (targetId) => {
    if (!socket.broadcastCode || !uid) return;
    const result = broadcasts.banViewer(socket.broadcastCode, uid, targetId);
    if (result.error) return socket.emit('broadcast:error', result.error);
    for (const [, s] of broadcastNs.sockets) {
      if (s.request.user && s.request.user._id.toString() === targetId) {
        s.emit('broadcast:kicked', 'You were banned');
        s.leave(socket.broadcastCode);
        s.broadcastCode = null;
      }
    }
    broadcastNs.to(socket.broadcastCode).emit('broadcast:viewer-count',
      broadcasts.getViewerCount(socket.broadcastCode));
  });

  // ── Mediasoup SFU signaling ──
  // Broadcaster: get router capabilities → create send transport → produce
  // Viewer: get router capabilities → create recv transport → consume
  // All SFU events require authentication to prevent anonymous resource abuse

  socket.on('sfu:getCapabilities', async (code, cb) => {
    if (!uid) return typeof cb === 'function' && cb({ error: 'Login required' });
    try {
      await sfu.createRoom(code);
      const caps = sfu.getRouterCapabilities(code);
      if (typeof cb === 'function') cb({ ok: true, rtpCapabilities: caps });
    } catch (e) {
      if (typeof cb === 'function') cb({ error: e.message });
    }
  });

  socket.on('sfu:createSendTransport', async (code, cb) => {
    if (!uid) return typeof cb === 'function' && cb({ error: 'Login required' });
    // Only the broadcast host can create a send transport
    const b = broadcasts.getBroadcast(code);
    if (!b || b.host.id !== uid) return typeof cb === 'function' && cb({ error: 'Not authorized' });
    try {
      const tData = await sfu.setupBroadcaster(code);
      if (typeof cb === 'function') cb({ ok: true, transport: tData });
    } catch (e) {
      if (typeof cb === 'function') cb({ error: e.message });
    }
  });

  socket.on('sfu:connectTransport', async (data, cb) => {
    if (!uid) return typeof cb === 'function' && cb({ error: 'Login required' });
    try {
      await sfu.connectTransport(data.code, data.transportId, data.dtlsParameters, data.role);
      if (typeof cb === 'function') cb({ ok: true });
    } catch (e) {
      if (typeof cb === 'function') cb({ error: e.message });
    }
  });

  socket.on('sfu:produce', async (data, cb) => {
    if (!uid) return typeof cb === 'function' && cb({ error: 'Login required' });
    // Only broadcast host can produce
    const b = broadcasts.getBroadcast(data.code);
    if (!b || b.host.id !== uid) return typeof cb === 'function' && cb({ error: 'Not authorized' });
    try {
      const result = await sfu.produce(data.code, data.transportId, data.kind, data.rtpParameters);
      if (typeof cb === 'function') cb({ ok: true, id: result.id });
      // Notify viewers that a new producer is available
      broadcastNs.to(data.code).emit('sfu:newProducer', { kind: data.kind });
    } catch (e) {
      if (typeof cb === 'function') cb({ error: e.message });
    }
  });

  socket.on('sfu:createRecvTransport', async (code, cb) => {
    if (!uid) return typeof cb === 'function' && cb({ error: 'Login required' });
    try {
      const tData = await sfu.setupViewer(code, socket.id);
      if (typeof cb === 'function') cb({ ok: true, transport: tData });
    } catch (e) {
      if (typeof cb === 'function') cb({ error: e.message });
    }
  });

  socket.on('sfu:consume', async (data, cb) => {
    if (!uid) return typeof cb === 'function' && cb({ error: 'Login required' });
    try {
      const consumers = await sfu.consume(data.code, socket.id, data.rtpCapabilities);
      if (typeof cb === 'function') cb({ ok: true, consumers: consumers });
    } catch (e) {
      if (typeof cb === 'function') cb({ error: e.message });
    }
  });

  socket.on('sfu:resume', async (data, cb) => {
    try {
      await sfu.resumeConsumer(data.code, socket.id, data.consumerId);
      if (typeof cb === 'function') cb({ ok: true });
    } catch (e) {
      if (typeof cb === 'function') cb({ error: e.message });
    }
  });

  // ── Voice Chat (audio mesh between participants) ──
  socket.on('voice:join', () => {
    if (!socket.broadcastCode || !uid) return;
    const code = socket.broadcastCode;
    const voiceRoom = 'voice:' + code;
    socket.join(voiceRoom);
    socket.inVoice = true;

    // Tell everyone in voice about this new peer
    socket.to(voiceRoom).emit('voice:peer-joined', {
      socketId: socket.id, name: uname, userId: uid,
    });

    // Tell the joiner about existing voice peers
    const peers = [];
    for (const [, s] of broadcastNs.sockets) {
      if (s.inVoice && s.broadcastCode === code && s.id !== socket.id) {
        const su = s.request.user;
        peers.push({
          socketId: s.id,
          name: su ? (su.displayName || su.firstName || su.email) : 'Viewer',
          userId: su ? su._id.toString() : null,
        });
      }
    }
    socket.emit('voice:peers', peers);
    broadcastNs.to(code).emit('broadcast:system', uname + ' joined voice');
  });

  socket.on('voice:leave', () => {
    if (!socket.broadcastCode) return;
    const voiceRoom = 'voice:' + socket.broadcastCode;
    socket.leave(voiceRoom);
    socket.inVoice = false;
    broadcastNs.to(voiceRoom).emit('voice:peer-left', { socketId: socket.id });
    broadcastNs.to(socket.broadcastCode).emit('broadcast:system', uname + ' left voice');
  });

  // Voice WebRTC signaling (peer-to-peer mesh)
  socket.on('voice:offer', (data) => {
    broadcastNs.to(data.targetSocketId).emit('voice:offer', {
      sdp: data.sdp, fromSocketId: socket.id, name: uname,
    });
  });

  socket.on('voice:answer', (data) => {
    broadcastNs.to(data.targetSocketId).emit('voice:answer', {
      sdp: data.sdp, fromSocketId: socket.id,
    });
  });

  socket.on('voice:ice', (data) => {
    broadcastNs.to(data.targetSocketId).emit('voice:ice', {
      candidate: data.candidate, fromSocketId: socket.id,
    });
  });

  // Voice speaking indicator
  socket.on('voice:speaking', (speaking) => {
    if (!socket.broadcastCode || !socket.inVoice) return;
    broadcastNs.to('voice:' + socket.broadcastCode).emit('voice:speaking', {
      socketId: socket.id, speaking: !!speaking,
    });
  });

  // Disconnect
  socket.on('disconnect', () => {
    if (!socket.broadcastCode) return;
    const code = socket.broadcastCode;
    const b = broadcasts.getBroadcast(code);

    // Clean up voice
    if (socket.inVoice) {
      broadcastNs.to('voice:' + code).emit('voice:peer-left', { socketId: socket.id });
    }

    if (b && uid === b.host.id) {
      broadcastNs.to(code).emit('broadcast:ended');
      broadcasts.endBroadcast(code);
      sfu.closeRoom(code);
      console.log('[broadcast] ENDED (disconnect):', code);
    } else {
      broadcasts.removeViewer(code, uid);
      sfu.removeViewer(code, socket.id);
      if (b && b.host.socketId) {
        broadcastNs.to(b.host.socketId).emit('broadcast:viewer-left', {
          socketId: socket.id,
        });
      }
      broadcastNs.to(code).emit('broadcast:viewer-count', broadcasts.getViewerCount(code));
      broadcastNs.to(code).emit('broadcast:system', uname + ' left');
    }
  });
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`[games] Portal running on port ${PORT}`);
});
