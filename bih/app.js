require('dotenv').config();

// engine.io has an intermittent race that throws ERR_HTTP_HEADERS_SENT as an
// uncaught exception — swallow it so the process doesn't crash.
process.on('uncaughtException', (err) => {
  if (err.code === 'ERR_HTTP_HEADERS_SENT') return;
  console.error('Uncaught exception:', err);
  process.exit(1);
});

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
  res.locals.userTheme = (req.user && req.user.theme) || 'terminal';
  next();
});

// Routes
app.use('/', require('./routes/index'));
app.use('/auth', require('./routes/auth'));
app.use('/profile', require('./routes/profile'));
app.use('/tickets', require('./routes/tickets'));
app.use('/api', require('./routes/api'));
app.use('/api', require('./routes/bots'));
app.use('/servers', require('./routes/servers'));
app.use('/api/internal', require('./routes/internal'));

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
const activeBroadcast = { active: false, broadcasterId: null, broadcasterName: null, broadcasterAvatar: null, broadcasterSocketId: null, viewers: new Map() }; // viewers: viewerUserId -> socketId
const ChatMessage = require('./models/ChatMessage');
const Channel = require('./models/Channel');
const Suggestion = require('./models/Suggestion');
const HISTORY_LIMIT = 20;

// Purge stale channel docs from prior process
Channel.deleteMany({}).catch(() => {});

// === Jules Winfield — chat liaison agent ===
const JULES = { displayName: 'Jules Winfield', avatar: '/img/jules.png', isBot: true };

async function julesSay(text, targetSocket) {
  const now = new Date();
  const msg = {
    displayName: JULES.displayName,
    avatar: JULES.avatar,
    message: text,
    timestamp: now.toISOString(),
    isBot: true
  };
  if (targetSocket) {
    // Private: greetings and command acks — no DB persistence, ephemeral by design
    targetSocket.emit('chat-message', msg);
  } else {
    // Public broadcast: save to DB so it survives reconnects and history reloads
    try {
      const saved = await ChatMessage.create({
        displayName: JULES.displayName,
        avatar: JULES.avatar,
        message: text,
        isBot: true,
        createdAt: now
      });
      msg.timestamp = saved.createdAt.toISOString();
    } catch (e) {
      console.error('[Jules] save error:', e.message);
    }
    chat.emit('chat-message', msg);
  }
}

const botRateLimit = new Map();   // `${botId}-${userId}` -> last response timestamp
const greetedUsers = new Set();   // userIds greeted this process run — survives socket reconnects

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
  const realUsers = Array.from(seen.values()).map(u => {
    const fresh = freshMap[u.userId];
    return {
      userId: u.userId,
      displayName: fresh ? (fresh.displayName || fresh.email) : u.displayName,
      avatar: fresh ? fresh.avatar : u.avatar
    };
  });

  // Append active bots as persistent "online" members
  try {
    const { getActiveBots } = require('./lib/agentBot');
    const bots = await getActiveBots();
    const botUsers = bots.map(b => ({
      userId: `bot:${b._id}`,
      displayName: b.bihBot.displayName || b.name,
      avatar: b.bihBot.avatar || '',
      isBot: true
    }));
    return [...realUsers, ...botUsers];
  } catch (e) {
    return realUsers;
  }
}

// Fire all active bih bots — each decides whether to reply ([SILENT] = skip)
// excludeBotId: skip a bot that just spoke (prevents self-reply loops)
// isBotMessage: true when a bot is speaking — triggers more selective engagement
async function runBots(message, senderName, excludeBotId, isBotMessage = false) {
  try {
    const { getActiveBots, botChat } = require('./lib/agentBot');
    const bots = await getActiveBots();
    if (!bots.length) return;

    // Collect all active bot display names for peer-awareness in prompts
    const activeBotNames = bots.map(b => b.bihBot.displayName || b.name);

    const recentHistory = await ChatMessage.find()
      .sort({ createdAt: -1 }).limit(8).lean();
    recentHistory.reverse();

    for (const bot of bots) {
      if (excludeBotId && bot._id.toString() === excludeBotId.toString()) continue;

      const rateKey = bot._id.toString();
      const lastResp = botRateLimit.get(rateKey);
      const rateMs = bot.bihBot.rateMs || 8000;
      if (lastResp && Date.now() - lastResp < rateMs) continue;

      // Bot-to-bot: each bot only has a 25% chance of engaging with another bot's message
      if (isBotMessage && Math.random() > 0.25) continue;

      botRateLimit.set(rateKey, Date.now());
      const botDisplayName = bot.bihBot.displayName || bot.name;
      const botAvatar = bot.bihBot.avatar || '';

      botChat(bot, recentHistory, message, senderName, activeBotNames)
        .then(async reply => {
          if (!reply) return; // [SILENT]
          const botMsg = {
            displayName: botDisplayName,
            avatar: botAvatar,
            message: reply,
            timestamp: new Date().toISOString(),
            isBot: true
          };
          try {
            const savedBot = await ChatMessage.create({
              displayName: botDisplayName,
              avatar: botAvatar,
              message: reply,
              isBot: true
            });
            botMsg.timestamp = savedBot.createdAt.toISOString();
          } catch (e) { /* non-critical */ }
          chat.emit('chat-message', botMsg);
          // Other bots can react — flagged as bot message so 25% engagement applies
          runBots(reply, botDisplayName, bot._id, true);
        })
        .catch(err => console.error(`[Bot:${botDisplayName}] error:`, err.message));
    }
  } catch (err) {
    console.error('[runBots] error:', err.message);
  }
}

// Internal endpoint for MCP bih-chat tool — broadcasts a bot message to the chat namespace
app.post('/api/bot-alert', async (req, res) => {
  const { message, displayName, secret } = req.body;
  const expected = process.env.BOT_ALERT_SECRET || 'bih-internal';
  if (secret !== expected) return res.status(403).json({ error: 'Forbidden' });
  if (!message || typeof message !== 'string') return res.status(400).json({ error: 'message required' });

  const name = displayName || 'Agent';
  const botMsg = {
    displayName: name,
    avatar: '',
    message,
    timestamp: new Date().toISOString(),
    isBot: true
  };
  try {
    const saved = await ChatMessage.create({ displayName: name, message, isBot: true });
    botMsg.timestamp = saved.createdAt.toISOString();
  } catch (e) { /* non-critical */ }
  chat.emit('chat-message', botMsg);
  res.json({ ok: true });
});

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
  // Only notify join if user wasn't already connected (multi-tab guard)
  if (!wasAlreadyOnline) {
    socket.broadcast.emit('user-joined', { displayName });
  }
  // Jules greets once per user per process run — survives page navigations and reconnects
  if (!greetedUsers.has(userId)) {
    greetedUsers.add(userId);
    setTimeout(() => {
      julesSay(`${displayName}. I'm Jules. You got feedback for the dev team? Type !suggest followed by your idea.`, socket);
    }, 800);
  }

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
    if (typeof msg !== 'string' || !msg.trim()) return;

    // Re-fetch user for fresh avatar/displayName
    const freshUser = await User.findById(user._id).lean();
    const freshName = freshUser.displayName || freshUser.email;
    const freshAvatar = freshUser.avatar;

    // Jules commands
    if (msg.startsWith('!suggest ')) {
      const text = msg.slice(9).trim();
      if (text.length < 5) return julesSay('Say more than that.', socket);
      await Suggestion.create({ userId: user._id, displayName: freshName, text });
      return julesSay('Logged. The team will see it.', socket);
    }
    if (msg.trim() === '!help') {
      const lines = [
        '── Commands ──',
        '!suggest <idea>         — send feedback to the dev team',
        '@<botname> <message>    — talk directly to a bot (e.g. @jules, @marcellus)',
        '!list-agents  (!list-a) — list all madladslab agents',
      ];
      if (freshUser.isAdmin) {
        lines.push(
          '!activate <name>               — enable agent as bih bot        [admin]',
          '!deactivate <name>             — disable agent from bih          [admin]',
          '!spawn <name> [model]          — create a new agent              [admin]',
          '!users                         — list all users + roles          [admin]',
          '!perms <username>              — show user permissions           [admin]',
          '!grant <username> <perm>       — grant user a permission         [admin]',
          '!revoke <username> <perm>      — revoke user permission          [admin]',
          '!agent-grant <agent> <cap>     — grant agent a capability        [admin]',
          '!agent-revoke <agent> <cap>    — revoke agent capability         [admin]',
          '!agent-roles <agent> [roles]   — restrict agent to roles (* = all) [admin]',
        );
      }
      return julesSay(lines.join('\n'), socket);
    }

    // !list-agents / !list-a* shorthand
    if (/^!list-a\S*/i.test(msg.trim())) {
      try {
        const { listAgents } = require('./lib/agentBot');
        const agents = await listAgents();
        if (!agents.length) return julesSay('No agents found in madladslab.', socket);
        const lines = agents.map(a => {
          const bihStatus = a.bihBot?.enabled ? '🟢 bih-active' : '⚫ bih-off';
          const displayName = a.bihBot?.displayName || a.name;
          return `${displayName} (${a.model}) — ${bihStatus}`;
        });
        return julesSay('── Agents ──\n' + lines.join('\n'), socket);
      } catch (e) {
        return julesSay('Failed to fetch agents: ' + e.message, socket);
      }
    }

    // Admin-only agent commands
    if (/^!activate\b/i.test(msg.trim()) || /^!deactivate\b/i.test(msg.trim()) || /^!spawn\b/i.test(msg.trim())) {
      if (!freshUser.isAdmin) return julesSay('That command requires admin.', socket);

      if (/^!activate\s+/i.test(msg)) {
        const name = msg.replace(/^!activate\s+/i, '').trim();
        if (!name) return julesSay('Usage: !activate <agent name>', socket);
        try {
          const { activateAgent } = require('./lib/agentBot');
          const agent = await activateAgent(name);
          if (!agent) return julesSay(`No agent named "${name}" found.`, socket);
          return julesSay(`${agent.bihBot.displayName || agent.name} is now active in bih.`, socket);
        } catch (e) {
          return julesSay('Error: ' + e.message, socket);
        }
      }

      if (/^!deactivate\s+/i.test(msg)) {
        const name = msg.replace(/^!deactivate\s+/i, '').trim();
        if (!name) return julesSay('Usage: !deactivate <agent name>', socket);
        try {
          const { deactivateAgent } = require('./lib/agentBot');
          const agent = await deactivateAgent(name);
          if (!agent) return julesSay(`No agent named "${name}" found.`, socket);
          return julesSay(`${agent.bihBot.displayName || agent.name} has been deactivated.`, socket);
        } catch (e) {
          return julesSay('Error: ' + e.message, socket);
        }
      }

      if (/^!spawn\s+/i.test(msg)) {
        const parts = msg.replace(/^!spawn\s+/i, '').trim().split(/\s+/);
        const name = parts[0];
        const model = parts[1] || 'qwen2.5:7b';
        if (!name) return julesSay('Usage: !spawn <name> [model]', socket);
        try {
          const { createAgent } = require('./lib/agentBot');
          const agent = await createAgent(name, model, null, freshUser._id);
          return julesSay(`Agent "${agent.name}" created with model ${agent.model}. Use !activate ${agent.name} to deploy it here.`, socket);
        } catch (e) {
          return julesSay('Error: ' + e.message, socket);
        }
      }
    }

    // ── User permission commands (admin only) ─────────────────────────────
    if (/^!(grant|revoke|perms|users)\b/i.test(msg.trim())) {
      if (!freshUser.isAdmin) return julesSay('That command requires admin.', socket);

      // !users — list all users with roles
      if (/^!users$/i.test(msg.trim())) {
        const all = await User.find({}, 'displayName email isAdmin isBIH permissions').sort({ displayName: 1 }).lean();
        if (!all.length) return julesSay('No users found.', socket);
        const lines = all.map(u => {
          const roles = [];
          if (u.isAdmin) roles.push('admin');
          if (u.isBIH) roles.push('bih');
          (u.permissions || []).forEach(p => roles.push(p));
          return `${u.displayName || u.email}  [${roles.join(', ') || 'none'}]`;
        });
        return julesSay('── Users ──\n' + lines.join('\n'), socket);
      }

      // !perms <username>
      if (/^!perms\s+/i.test(msg)) {
        const target = msg.replace(/^!perms\s+/i, '').trim();
        const u = await User.findOne({ displayName: new RegExp(`^${target}$`, 'i') }).lean()
          || await User.findOne({ email: new RegExp(`^${target}$`, 'i') }).lean();
        if (!u) return julesSay(`User "${target}" not found.`, socket);
        const roles = [];
        if (u.isAdmin) roles.push('admin');
        if (u.isBIH) roles.push('bih');
        (u.permissions || []).forEach(p => roles.push(p));
        return julesSay(`${u.displayName || u.email}: [${roles.join(', ') || 'none'}]`, socket);
      }

      // !grant <username> <perm>
      if (/^!grant\s+/i.test(msg)) {
        const parts = msg.replace(/^!grant\s+/i, '').trim().split(/\s+/);
        const target = parts[0], perm = parts[1];
        if (!target || !perm) return julesSay('Usage: !grant <username> <perm>', socket);
        const u = await User.findOne({ displayName: new RegExp(`^${target}$`, 'i') })
          || await User.findOne({ email: new RegExp(`^${target}$`, 'i') });
        if (!u) return julesSay(`User "${target}" not found.`, socket);
        if (perm === 'admin') { u.isAdmin = true; }
        else if (perm === 'bih') { u.isBIH = true; }
        else { if (!u.permissions.includes(perm)) u.permissions.push(perm); }
        await u.save();
        return julesSay(`Granted [${perm}] to ${u.displayName || u.email}.`, socket);
      }

      // !revoke <username> <perm>
      if (/^!revoke\s+/i.test(msg)) {
        const parts = msg.replace(/^!revoke\s+/i, '').trim().split(/\s+/);
        const target = parts[0], perm = parts[1];
        if (!target || !perm) return julesSay('Usage: !revoke <username> <perm>', socket);
        const u = await User.findOne({ displayName: new RegExp(`^${target}$`, 'i') })
          || await User.findOne({ email: new RegExp(`^${target}$`, 'i') });
        if (!u) return julesSay(`User "${target}" not found.`, socket);
        if (perm === 'admin') { u.isAdmin = false; }
        else if (perm === 'bih') { u.isBIH = false; }
        else { u.permissions = u.permissions.filter(p => p !== perm); }
        await u.save();
        return julesSay(`Revoked [${perm}] from ${u.displayName || u.email}.`, socket);
      }
    }

    // ── Agent permission commands (admin only) ────────────────────────────
    if (/^!(agent-grant|agent-revoke|agent-roles)\b/i.test(msg.trim())) {
      if (!freshUser.isAdmin) return julesSay('That command requires admin.', socket);

      // !agent-grant <agentname> <capability>
      if (/^!agent-grant\s+/i.test(msg)) {
        const parts = msg.replace(/^!agent-grant\s+/i, '').trim().split(/\s+/);
        const agentName = parts[0], cap = parts[1];
        if (!agentName || !cap) return julesSay('Usage: !agent-grant <agentname> <capability>', socket);
        try {
          const { grantAgentPerm } = require('./lib/agentBot');
          const agent = await grantAgentPerm(agentName, cap);
          if (!agent) return julesSay(`Agent "${agentName}" not found.`, socket);
          return julesSay(`Agent ${agent.name} granted capability [${cap}]. Caps: ${(agent.capabilities || []).join(', ') || 'none'}`, socket);
        } catch (e) { return julesSay('Error: ' + e.message, socket); }
      }

      // !agent-revoke <agentname> <capability>
      if (/^!agent-revoke\s+/i.test(msg)) {
        const parts = msg.replace(/^!agent-revoke\s+/i, '').trim().split(/\s+/);
        const agentName = parts[0], cap = parts[1];
        if (!agentName || !cap) return julesSay('Usage: !agent-revoke <agentname> <capability>', socket);
        try {
          const { revokeAgentPerm } = require('./lib/agentBot');
          const agent = await revokeAgentPerm(agentName, cap);
          if (!agent) return julesSay(`Agent "${agentName}" not found.`, socket);
          return julesSay(`Agent ${agent.name} revoked capability [${cap}]. Caps: ${(agent.capabilities || []).join(', ') || 'none'}`, socket);
        } catch (e) { return julesSay('Error: ' + e.message, socket); }
      }

      // !agent-roles <agentname> [role1,role2,...] — restrict who can trigger this agent
      if (/^!agent-roles\s+/i.test(msg)) {
        const parts = msg.replace(/^!agent-roles\s+/i, '').trim().split(/\s+/);
        const agentName = parts[0], rolesRaw = parts[1];
        if (!agentName) return julesSay('Usage: !agent-roles <agentname> [role1,role2 | *]', socket);
        const roles = !rolesRaw || rolesRaw === '*' ? [] : rolesRaw.split(',').map(r => r.trim()).filter(Boolean);
        try {
          const { setAgentAllowedRoles } = require('./lib/agentBot');
          const agent = await setAgentAllowedRoles(agentName, roles);
          if (!agent) return julesSay(`Agent "${agentName}" not found.`, socket);
          const display = roles.length ? roles.join(', ') : '* (all users)';
          return julesSay(`Agent ${agent.name} restricted to roles: ${display}`, socket);
        } catch (e) { return julesSay('Error: ' + e.message, socket); }
      }
    }

    // Save and broadcast the message
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

    // @botname direct address — find the specific bot and force a reply
    const atMatch = msg.match(/^@([\w-]+)\b/i);
    if (atMatch) {
      const handle = atMatch[1].toLowerCase();
      try {
        const { getActiveBots, botChat } = require('./lib/agentBot');
        const bots = await getActiveBots();
        const target = bots.find(b => {
          const trigger = (b.bihBot.trigger || '').toLowerCase();
          const dName = (b.bihBot.displayName || b.name).toLowerCase().replace(/\s+/g, '-');
          const firstName = (b.bihBot.displayName || b.name).toLowerCase().split(' ')[0];
          return trigger === handle || dName === handle || firstName === handle;
        });
        if (target) {
          const activeBotNames = bots.map(b => b.bihBot.displayName || b.name);
          const recentHistory = await ChatMessage.find().sort({ createdAt: -1 }).limit(8).lean();
          recentHistory.reverse();
          const botDisplayName = target.bihBot.displayName || target.name;
          const botAvatar = target.bihBot.avatar || '';
          botChat(target, recentHistory, msg, freshName, activeBotNames, { directAddress: true })
            .then(async reply => {
              const finalReply = reply || `Yeah, I'm here.`;
              const botMsg = { displayName: botDisplayName, avatar: botAvatar, message: finalReply, timestamp: new Date().toISOString(), isBot: true };
              try {
                const saved2 = await ChatMessage.create({ displayName: botDisplayName, avatar: botAvatar, message: finalReply, isBot: true });
                botMsg.timestamp = saved2.createdAt.toISOString();
              } catch (_) {}
              chat.emit('chat-message', botMsg);
              runBots(finalReply, botDisplayName, target._id, true);
            })
            .catch(err => console.error(`[Bot:${botDisplayName}] direct error:`, err.message));
          return; // only the addressed bot responds
        }
      } catch (e) {
        console.error('[at-address] error:', e.message);
      }
    }

    runBots(msg, freshName, null);
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
    broadcastChannelsList();
  }

  // Helper: broadcast channels list (public channels + active private calls)
  function broadcastChannelsList() {
    const list = [];
    for (const [callId, call] of activeCalls) {
      if (call.status !== 'active') continue;
      if (call.isChannel) {
        list.push({
          callId,
          name: call.channelName,
          creatorName: call.creatorName,
          callType: call.callType,
          participantCount: call.participants.size,
          participants: [...call.participants.values()].map(p => ({
            displayName: p.displayName, avatar: p.avatar
          }))
        });
      } else {
        // Surface private calls too
        const parts = [...call.participants.values()];
        list.push({
          callId,
          name: 'Active Call',
          creatorName: parts[0]?.displayName || 'Unknown',
          callType: call.callType,
          participantCount: call.participants.size,
          participants: parts.map(p => ({ displayName: p.displayName, avatar: p.avatar })),
          isPrivate: true
        });
      }
    }
    chat.emit('channels-list', list);
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

  // === Channels (public joinable rooms) ===

  socket.on('channel-create', async ({ name, callType }) => {
    const creator = onlineUsers.get(socket.id);
    if (!creator) return;
    if (!name || typeof name !== 'string' || name.trim().length === 0 || name.trim().length > 60) {
      return socket.emit('channel-error', { message: 'Invalid channel name' });
    }
    if (findCallForUser(creator.userId)) {
      return socket.emit('channel-error', { message: 'You are already in a call' });
    }

    const callId = 'ch-' + Date.now().toString(36) + Math.random().toString(36).substr(2, 5);
    const channelName = name.trim();
    const participants = new Map();
    participants.set(creator.userId, { socketId: socket.id, displayName: creator.displayName, avatar: creator.avatar });

    activeCalls.set(callId, {
      participants,
      status: 'active',
      callType: callType || 'video',
      isChannel: true,
      channelName,
      creatorId: creator.userId,
      creatorName: creator.displayName,
      startedAt: Date.now()
    });

    try {
      await Channel.create({ callId, name: channelName, creatorId: creator.userId, creatorName: creator.displayName, callType: callType || 'video' });
    } catch (e) { /* non-critical */ }

    socket.emit('channel-created', { callId, name: channelName, callType: callType || 'video' });
    socket.emit('room-joined', { callId, callType: callType || 'video', peers: [] });
    broadcastActiveCalls();
  });

  socket.on('channel-leave', ({ channelId }) => {
    const call = activeCalls.get(channelId);
    if (!call) return;
    const u = onlineUsers.get(socket.id);
    if (!u || !call.participants.has(u.userId)) return;

    call.participants.delete(u.userId);

    for (const [, p] of call.participants) {
      chat.to(p.socketId).emit('room-peer-left', { callId: channelId, peerId: u.userId });
    }

    if (call.participants.size === 0) {
      activeCalls.delete(channelId);
      if (call.isChannel) Channel.findOneAndDelete({ callId: channelId }).catch(() => {});
    } else if (call.participants.size === 1 && !call.isChannel) {
      // Private call — end if only 1 left
      for (const [, p] of call.participants) {
        chat.to(p.socketId).emit('call-ended', { callId: channelId, reason: 'last-peer' });
      }
      activeCalls.delete(channelId);
    }

    broadcastActiveCalls();
  });

  socket.on('channel-message', async ({ channelId, text }) => {
    if (!channelId || !text || typeof text !== 'string') return;
    const call = activeCalls.get(channelId);
    if (!call || !call.isChannel) return;
    const sender = onlineUsers.get(socket.id);
    if (!sender || !call.participants.has(sender.userId)) return;

    const freshUser = await User.findById(sender.userId).lean();
    const msg = {
      channelId,
      displayName: freshUser ? (freshUser.displayName || freshUser.email) : sender.displayName,
      avatar: freshUser ? freshUser.avatar : sender.avatar,
      text,
      timestamp: new Date().toISOString()
    };
    // Relay to all participants in the channel
    for (const [, p] of call.participants) {
      chat.to(p.socketId).emit('channel-message', msg);
    }
  });

  socket.on('channels-request', () => {
    const list = [];
    for (const [callId, call] of activeCalls) {
      if (call.status !== 'active') continue;
      if (call.isChannel) {
        list.push({
          callId,
          name: call.channelName,
          creatorName: call.creatorName,
          callType: call.callType,
          participantCount: call.participants.size,
          participants: [...call.participants.values()].map(p => ({
            displayName: p.displayName, avatar: p.avatar
          }))
        });
      } else {
        const parts = [...call.participants.values()];
        list.push({
          callId,
          name: 'Active Call',
          creatorName: parts[0]?.displayName || 'Unknown',
          callType: call.callType,
          participantCount: call.participants.size,
          participants: parts.map(p => ({ displayName: p.displayName, avatar: p.avatar })),
          isPrivate: true
        });
      }
    }
    socket.emit('channels-list', list);
  });

  // === Broadcast (one-to-many live streaming) ===

  socket.on('broadcast-start', async () => {
    const broadcaster = onlineUsers.get(socket.id);
    if (!broadcaster) return;
    // Check admin/bih permission
    const freshUser = await User.findById(broadcaster.userId).lean();
    if (!freshUser || (!freshUser.isAdmin && !freshUser.isBIH)) {
      return socket.emit('broadcast-error', { message: 'Not authorized to broadcast' });
    }
    if (activeBroadcast.active) {
      return socket.emit('broadcast-error', { message: 'A broadcast is already live' });
    }
    activeBroadcast.active = true;
    activeBroadcast.broadcasterId = broadcaster.userId;
    activeBroadcast.broadcasterName = freshUser.displayName || freshUser.email;
    activeBroadcast.broadcasterAvatar = freshUser.avatar;
    activeBroadcast.broadcasterSocketId = socket.id;
    activeBroadcast.viewers.clear();
    chat.emit('broadcast-live', {
      broadcasterId: activeBroadcast.broadcasterId,
      broadcasterName: activeBroadcast.broadcasterName,
      broadcasterAvatar: activeBroadcast.broadcasterAvatar
    });
  });

  socket.on('broadcast-stop', () => {
    const broadcaster = onlineUsers.get(socket.id);
    if (!broadcaster || activeBroadcast.broadcasterId !== broadcaster.userId) return;
    // Notify all viewers
    for (const [, viewerSid] of activeBroadcast.viewers) {
      chat.to(viewerSid).emit('broadcast-ended');
    }
    activeBroadcast.active = false;
    activeBroadcast.broadcasterId = null;
    activeBroadcast.broadcasterName = null;
    activeBroadcast.broadcasterAvatar = null;
    activeBroadcast.broadcasterSocketId = null;
    activeBroadcast.viewers.clear();
    chat.emit('broadcast-offline');
  });

  // Viewer wants to watch — tell broadcaster to send an offer
  socket.on('broadcast-watch', () => {
    if (!activeBroadcast.active) return socket.emit('broadcast-error', { message: 'No active broadcast' });
    const viewer = onlineUsers.get(socket.id);
    if (!viewer) return;
    if (viewer.userId === activeBroadcast.broadcasterId) return;
    activeBroadcast.viewers.set(viewer.userId, socket.id);
    // Tell broadcaster to create an offer for this viewer
    chat.to(activeBroadcast.broadcasterSocketId).emit('broadcast-viewer-joined', {
      viewerId: viewer.userId,
      viewerSocketId: socket.id
    });
  });

  socket.on('broadcast-leave', () => {
    const viewer = onlineUsers.get(socket.id);
    if (!viewer || !activeBroadcast.active) return;
    activeBroadcast.viewers.delete(viewer.userId);
    chat.to(activeBroadcast.broadcasterSocketId).emit('broadcast-viewer-left', {
      viewerId: viewer.userId
    });
  });

  // WebRTC signaling for broadcast (separate from call signaling)
  socket.on('broadcast-offer', ({ targetSocketId, sdp }) => {
    chat.to(targetSocketId).emit('broadcast-offer', { sdp });
  });

  socket.on('broadcast-answer', ({ sdp }) => {
    if (!activeBroadcast.active) return;
    chat.to(activeBroadcast.broadcasterSocketId).emit('broadcast-answer', {
      fromViewerId: onlineUsers.get(socket.id)?.userId,
      sdp
    });
  });

  socket.on('broadcast-ice', ({ targetSocketId, candidate }) => {
    chat.to(targetSocketId).emit('broadcast-ice', { fromId: socket.id, candidate });
  });

  // Send current broadcast status to newly connected user
  if (activeBroadcast.active) {
    socket.emit('broadcast-live', {
      broadcasterId: activeBroadcast.broadcasterId,
      broadcasterName: activeBroadcast.broadcasterName,
      broadcasterAvatar: activeBroadcast.broadcasterAvatar
    });
  }

  // Send current channels list to newly connected user
  socket.emit('channels-list', (() => {
    const list = [];
    for (const [callId, call] of activeCalls) {
      if (call.status !== 'active') continue;
      if (call.isChannel) {
        list.push({ callId, name: call.channelName, creatorName: call.creatorName, callType: call.callType, participantCount: call.participants.size, participants: [...call.participants.values()].map(p => ({ displayName: p.displayName, avatar: p.avatar })) });
      } else {
        const parts = [...call.participants.values()];
        list.push({ callId, name: 'Active Call', creatorName: parts[0]?.displayName || 'Unknown', callType: call.callType, participantCount: call.participants.size, participants: parts.map(p => ({ displayName: p.displayName, avatar: p.avatar })), isPrivate: true });
      }
    }
    return list;
  })());

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
            if (call.participants.size === 0) {
              if (call.isChannel) Channel.findOneAndDelete({ callId }).catch(() => {});
              activeCalls.delete(callId);
            } else if (call.participants.size <= 1 && !call.isChannel) {
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

    // Clean up broadcast if broadcaster disconnects
    if (user && activeBroadcast.active && activeBroadcast.broadcasterId === user.userId) {
      for (const [, viewerSid] of activeBroadcast.viewers) {
        chat.to(viewerSid).emit('broadcast-ended');
      }
      activeBroadcast.active = false;
      activeBroadcast.broadcasterId = null;
      activeBroadcast.broadcasterName = null;
      activeBroadcast.broadcasterAvatar = null;
      activeBroadcast.broadcasterSocketId = null;
      activeBroadcast.viewers.clear();
      chat.emit('broadcast-offline');
    }
    // Remove viewer if they disconnect
    if (user && activeBroadcast.active && activeBroadcast.viewers.has(user.userId)) {
      activeBroadcast.viewers.delete(user.userId);
      if (activeBroadcast.broadcasterSocketId) {
        chat.to(activeBroadcast.broadcasterSocketId).emit('broadcast-viewer-left', { viewerId: user.userId });
      }
    }

    onlineUsers.delete(socket.id);
    chat.emit('online-users', await getUniqueOnlineUsers());
  });
});

server.listen(PORT, () => {
  console.log(`bih running on port ${PORT}`);
});
