require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const session = require('express-session');
const MongoStore = require('connect-mongo');
const passport = require('./config/passport');
const path = require('path');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);
const PORT = process.env.PORT || 3055;

// MongoDB Atlas
const MONGO_URI = `${process.env.DB_URL}/${process.env.DB_NAME}?retryWrites=true&w=majority`;
mongoose.connect(MONGO_URI)
  .then(() => console.log('MongoDB Atlas connected'))
  .catch(err => console.error('MongoDB error:', err));

// View engine
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// Sessions
const sessionMiddleware = session({
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  store: MongoStore.create({ mongoUrl: MONGO_URI }),
  cookie: { maxAge: 1000 * 60 * 60 * 24 } // 1 day
});
app.use(sessionMiddleware);

// Passport
app.use(passport.initialize());
app.use(passport.session());

// Make user available to all views
app.use((req, res, next) => {
  res.locals.user = req.user || null;
  next();
});

// Routes
app.use('/', require('./routes/index'));
app.use('/auth', require('./routes/auth'));
app.use('/profile', require('./routes/profile'));

// Socket.IO — share session with express
io.engine.use(sessionMiddleware);

// Socket.IO — chat namespace for authenticated users
const chat = io.of('/chat');
chat.use((socket, next) => {
  const req = socket.request;
  if (req.session && req.session.passport && req.session.passport.user) {
    next();
  } else {
    next(new Error('Unauthorized'));
  }
});

const onlineUsers = new Map(); // keyed by socket.id
const activeCalls = new Map(); // keyed by callId
const ChatMessage = require('./models/ChatMessage');
const HISTORY_LIMIT = 20;

function getSocketIdsForUser(targetUserId) {
  const ids = [];
  for (const [socketId, userData] of onlineUsers.entries()) {
    if (userData.userId === targetUserId) ids.push(socketId);
  }
  return ids;
}

async function getUniqueOnlineUsers() {
  const seen = new Map();
  for (const u of onlineUsers.values()) {
    if (!seen.has(u.userId)) seen.set(u.userId, u);
  }
  // Fetch fresh user data for avatars/display names
  const User = require('./models/User');
  const userIds = Array.from(seen.keys());
  const freshUsers = await User.find({ _id: { $in: userIds } }).lean();
  const freshMap = {};
  freshUsers.forEach(u => { freshMap[u._id.toString()] = u; });
  return Array.from(seen.values()).map(u => {
    const fresh = freshMap[u.userId];
    return {
      userId: u.userId,
      displayName: fresh ? (fresh.displayName || fresh.email) : u.displayName,
      avatar: fresh ? fresh.avatar : u.avatar
    };
  });
}

chat.on('connection', async (socket) => {
  const userId = socket.request.session.passport.user;
  const User = require('./models/User');
  const user = await User.findById(userId).lean();
  if (!user) return socket.disconnect();

  const displayName = user.displayName || user.email;
  const wasAlreadyOnline = [...onlineUsers.values()].some(u => u.userId === userId);
  onlineUsers.set(socket.id, { userId, displayName, avatar: user.avatar });

  // Send last 20 messages on connect
  const history = await ChatMessage.find()
    .sort({ createdAt: -1 })
    .limit(HISTORY_LIMIT)
    .lean();
  socket.emit('chat-history', {
    messages: history.reverse(),
    hasMore: history.length === HISTORY_LIMIT
  });

  // Broadcast deduplicated user list
  chat.emit('online-users', await getUniqueOnlineUsers());
  // Only notify join if user wasn't already connected
  if (!wasAlreadyOnline) socket.broadcast.emit('user-joined', { displayName });

  // Load more history
  socket.on('load-more', async (beforeTimestamp) => {
    const older = await ChatMessage.find({ createdAt: { $lt: new Date(beforeTimestamp) } })
      .sort({ createdAt: -1 })
      .limit(HISTORY_LIMIT)
      .lean();
    socket.emit('chat-history-older', {
      messages: older.reverse(),
      hasMore: older.length === HISTORY_LIMIT
    });
  });

  socket.on('chat-message', async (msg) => {
    // Re-fetch user for fresh avatar/displayName
    const freshUser = await User.findById(user._id).lean();
    const freshName = freshUser.displayName || freshUser.email;
    const freshAvatar = freshUser.avatar;
    const timestamp = new Date();
    const saved = await ChatMessage.create({
      userId: user._id,
      displayName: freshName,
      avatar: freshAvatar,
      message: msg,
      createdAt: timestamp
    });
    chat.emit('chat-message', {
      displayName: freshName,
      avatar: freshAvatar,
      message: msg,
      timestamp: saved.createdAt.toISOString()
    });
  });

  // Link preview fetcher
  socket.on('link-preview', async (url) => {
    try {
      if (typeof url !== 'string' || !url.match(/^https?:\/\//)) return;
      const { scrapeOG } = require('./lib/ogScraper');
      const meta = await scrapeOG(url);
      socket.emit('link-preview-result', meta);
    } catch (e) {
      // silently fail — no preview
    }
  });

  // === WebRTC Signaling (Multi-Party Mesh) ===

  // Helper: broadcast active calls list to all connected users
  function broadcastActiveCalls() {
    const list = [];
    for (const [callId, call] of activeCalls) {
      if (call.status === 'active') {
        const parts = [];
        for (const [uid, p] of call.participants) {
          parts.push({ userId: uid, displayName: p.displayName });
        }
        list.push({ callId, participants: parts, callType: call.callType });
      }
    }
    chat.emit('active-calls', list);
  }

  // Helper: find which call a user is in
  function findCallForUser(uid) {
    for (const [callId, call] of activeCalls) {
      if (call.participants.has(uid)) return { callId, call };
    }
    return null;
  }

  socket.on('call-request', ({ targetUserId, callType }) => {
    const caller = onlineUsers.get(socket.id);
    if (!caller) return;
    if (caller.userId === targetUserId) return;

    const targetSockets = getSocketIdsForUser(targetUserId);
    if (targetSockets.length === 0) {
      return socket.emit('call-error', { message: 'User is offline' });
    }

    // Check if caller is already in a call
    if (findCallForUser(caller.userId)) {
      return socket.emit('call-error', { message: 'You are already in a call' });
    }

    const callId = Date.now().toString(36) + Math.random().toString(36).substr(2, 5);
    const participants = new Map();
    participants.set(caller.userId, { socketId: socket.id, displayName: caller.displayName, avatar: caller.avatar });

    activeCalls.set(callId, {
      participants,
      pendingCalleeId: targetUserId,
      status: 'ringing',
      callType: callType || 'voice',
      startedAt: Date.now()
    });

    socket.emit('call-ringing', { callId, targetUserId });

    targetSockets.forEach(sid => {
      chat.to(sid).emit('call-incoming', {
        callId,
        callType: callType || 'voice',
        callerId: caller.userId,
        callerName: caller.displayName,
        callerAvatar: caller.avatar
      });
    });

    // Auto-timeout after 30s
    setTimeout(() => {
      const call = activeCalls.get(callId);
      if (call && call.status === 'ringing') {
        activeCalls.delete(callId);
        // Notify caller
        const callerP = call.participants.values().next().value;
        if (callerP) chat.to(callerP.socketId).emit('call-timeout', { callId });
        // Notify callee
        const calleeSockets = getSocketIdsForUser(call.pendingCalleeId);
        calleeSockets.forEach(sid => chat.to(sid).emit('call-timeout', { callId }));
      }
    }, 30000);
  });

  socket.on('call-accept', ({ callId }) => {
    const call = activeCalls.get(callId);
    if (!call || call.status !== 'ringing') return;
    const callee = onlineUsers.get(socket.id);
    if (!callee || callee.userId !== call.pendingCalleeId) return;

    call.status = 'active';
    delete call.pendingCalleeId;
    call.participants.set(callee.userId, { socketId: socket.id, displayName: callee.displayName, avatar: callee.avatar });

    // Tell the caller to create an offer for the callee
    const callerEntry = call.participants.entries().next().value;
    const callerId = callerEntry[0];
    const callerData = callerEntry[1];

    chat.to(callerData.socketId).emit('call-accepted', {
      callId,
      peerId: callee.userId,
      peerName: callee.displayName,
      peerAvatar: callee.avatar
    });

    // Tell the callee who is already in the call (just the caller)
    socket.emit('room-joined', {
      callId,
      callType: call.callType,
      peers: [{ userId: callerId, displayName: callerData.displayName, avatar: callerData.avatar }]
    });

    // Dismiss on callee's other tabs
    const calleeSockets = getSocketIdsForUser(callee.userId);
    calleeSockets.forEach(sid => {
      if (sid !== socket.id) chat.to(sid).emit('call-dismissed', { callId });
    });

    broadcastActiveCalls();
  });

  socket.on('call-reject', ({ callId }) => {
    const call = activeCalls.get(callId);
    if (!call || call.status !== 'ringing') return;
    const callee = onlineUsers.get(socket.id);
    if (!callee || callee.userId !== call.pendingCalleeId) return;

    // Notify caller
    const callerEntry = call.participants.entries().next().value;
    if (callerEntry) chat.to(callerEntry[1].socketId).emit('call-rejected', { callId });

    activeCalls.delete(callId);

    const calleeSockets = getSocketIdsForUser(callee.userId);
    calleeSockets.forEach(sid => chat.to(sid).emit('call-dismissed', { callId }));

    broadcastActiveCalls();
  });

  // 3rd+ user joins an active call
  socket.on('call-join', ({ callId }) => {
    const call = activeCalls.get(callId);
    if (!call || call.status !== 'active') {
      return socket.emit('call-error', { message: 'Call not found' });
    }
    const joiner = onlineUsers.get(socket.id);
    if (!joiner) return;

    if (call.participants.has(joiner.userId)) {
      return socket.emit('call-error', { message: 'Already in this call' });
    }
    if (findCallForUser(joiner.userId)) {
      return socket.emit('call-error', { message: 'You are already in a call' });
    }

    // Build list of existing peers for the joiner
    const existingPeers = [];
    for (const [uid, p] of call.participants) {
      existingPeers.push({ userId: uid, displayName: p.displayName, avatar: p.avatar });
      // Tell each existing participant about the new peer
      chat.to(p.socketId).emit('room-peer-joined', {
        callId,
        peerId: joiner.userId,
        peerName: joiner.displayName,
        peerAvatar: joiner.avatar
      });
    }

    // Add joiner to participants
    call.participants.set(joiner.userId, { socketId: socket.id, displayName: joiner.displayName, avatar: joiner.avatar });

    // Tell joiner who is in the call
    socket.emit('room-joined', {
      callId,
      callType: call.callType,
      peers: existingPeers
    });

    broadcastActiveCalls();
  });

  socket.on('call-hangup', ({ callId }) => {
    const call = activeCalls.get(callId);
    if (!call) return;
    const user = onlineUsers.get(socket.id);
    if (!user) return;

    // If still ringing, cancel the call
    if (call.status === 'ringing') {
      activeCalls.delete(callId);
      if (call.pendingCalleeId) {
        getSocketIdsForUser(call.pendingCalleeId).forEach(sid => {
          chat.to(sid).emit('call-dismissed', { callId });
        });
      }
      broadcastActiveCalls();
      return;
    }

    if (!call.participants.has(user.userId)) return;

    // Remove this user from the room
    call.participants.delete(user.userId);

    // Notify remaining participants
    for (const [, p] of call.participants) {
      chat.to(p.socketId).emit('room-peer-left', { callId, peerId: user.userId });
    }

    // If 1 or 0 left, end the call
    if (call.participants.size <= 1) {
      for (const [, p] of call.participants) {
        chat.to(p.socketId).emit('call-ended', { callId, reason: 'last-peer' });
      }
      activeCalls.delete(callId);
    }

    broadcastActiveCalls();
  });

  socket.on('webrtc-offer', ({ callId, targetUserId, sdp }) => {
    const call = activeCalls.get(callId);
    if (!call || call.status !== 'active') return;
    const user = onlineUsers.get(socket.id);
    if (!user || !call.participants.has(user.userId)) return;
    const target = call.participants.get(targetUserId);
    if (!target) return;
    chat.to(target.socketId).emit('webrtc-offer', { callId, fromUserId: user.userId, sdp });
  });

  socket.on('webrtc-answer', ({ callId, targetUserId, sdp }) => {
    const call = activeCalls.get(callId);
    if (!call || call.status !== 'active') return;
    const user = onlineUsers.get(socket.id);
    if (!user || !call.participants.has(user.userId)) return;
    const target = call.participants.get(targetUserId);
    if (!target) return;
    chat.to(target.socketId).emit('webrtc-answer', { callId, fromUserId: user.userId, sdp });
  });

  socket.on('webrtc-ice', ({ callId, targetUserId, candidate }) => {
    const call = activeCalls.get(callId);
    if (!call || call.status !== 'active') return;
    const user = onlineUsers.get(socket.id);
    if (!user || !call.participants.has(user.userId)) return;
    const target = call.participants.get(targetUserId);
    if (!target) return;
    chat.to(target.socketId).emit('webrtc-ice', { callId, fromUserId: user.userId, candidate });
  });

  socket.on('call-toggle-media', ({ callId, kind, enabled }) => {
    const call = activeCalls.get(callId);
    if (!call || call.status !== 'active') return;
    const user = onlineUsers.get(socket.id);
    if (!user || !call.participants.has(user.userId)) return;
    // Broadcast to ALL other participants
    for (const [uid, p] of call.participants) {
      if (uid !== user.userId) {
        chat.to(p.socketId).emit('call-media-toggled', { callId, kind, enabled, userId: user.userId });
      }
    }
  });

  // === Disconnect ===

  socket.on('disconnect', async () => {
    const user = onlineUsers.get(socket.id);
    if (user) {
      // Clean up any active calls for this user
      for (const [callId, call] of activeCalls) {
        if (call.status === 'ringing') {
          // If the ringing caller disconnects
          const callerEntry = call.participants.entries().next().value;
          if (callerEntry && callerEntry[1].socketId === socket.id) {
            activeCalls.delete(callId);
            if (call.pendingCalleeId) {
              getSocketIdsForUser(call.pendingCalleeId).forEach(sid => {
                chat.to(sid).emit('call-dismissed', { callId });
              });
            }
          }
        } else if (call.participants.has(user.userId)) {
          const p = call.participants.get(user.userId);
          if (p && p.socketId === socket.id) {
            call.participants.delete(user.userId);
            for (const [, remainingP] of call.participants) {
              chat.to(remainingP.socketId).emit('room-peer-left', { callId, peerId: user.userId });
            }
            if (call.participants.size <= 1) {
              for (const [, lastP] of call.participants) {
                chat.to(lastP.socketId).emit('call-ended', { callId, reason: 'disconnect' });
              }
              activeCalls.delete(callId);
            }
          }
        }
      }
      broadcastActiveCalls();
    }
    onlineUsers.delete(socket.id);
    chat.emit('online-users', await getUniqueOnlineUsers());
  });
});

server.listen(PORT, () => {
  console.log(`bih running on port ${PORT}`);
});
