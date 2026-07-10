import { Server } from 'socket.io';
import jwt from 'jsonwebtoken';
import { getDb, getTenantDb } from './mongo.js';
import { config } from '../config/config.js';
import crypto from 'crypto';
import { ObjectId } from 'mongodb';
import { summarizeChunk } from './meetingNotetaker.js';
import { unpackCredentials } from './socialPublish.js';
import { decrypt } from './crypto.js';
import { startSession, writeChunk, stopSession, createYouTubeBroadcast, transitionYouTube, createFacebookLive, endFacebookLive } from './liveStream.js';
import { startLiveChat, startViewerCounts } from './liveChat.js';
import { initChatNamespace } from './chatSocket.js';

const activeRooms = new Map(); // token -> Map<socketId, { displayName, isHost }>
const roomTranscripts = new Map(); // token -> { lines: [], timer: null, tenantDb: '' }
const MAX_PARTICIPANTS = 5;
const TRANSCRIPT_FLUSH_INTERVAL = 120000; // 2 minutes

// Server-side transcript flush — summarizes accumulated lines from ALL participants
async function flushRoomTranscript(token, nsp) {
  const rt = roomTranscripts.get(token);
  if (!rt || !rt.lines.length) return;

  const lines = rt.lines.splice(0); // take all, clear buffer
  const transcript = lines.join('\n');
  if (transcript.length < 30) return;

  let meetingTitle = 'Meeting';
  try {
    const db = rt.tenantDb ? getTenantDb(rt.tenantDb) : getDb();
    const meeting = await db.collection('meetings').findOne({ token }, { projection: { title: 1 } });
    if (meeting) meetingTitle = meeting.title || meetingTitle;

    nsp.to(token).emit('notetaker-status', { status: 'summarizing' });

    const summary = await summarizeChunk(transcript, 'Meeting participants', meetingTitle);

    if (summary) {
      const noteId = 'ai-' + Date.now() + '-' + crypto.randomBytes(4).toString('hex');
      const note = {
        _noteId: noteId,
        author: 'AI Notetaker',
        text: summary,
        createdAt: new Date(),
        isAI: true,
      };
      await db.collection('meetings').updateOne({ token }, { $push: { notes: note } });
      nsp.to(token).emit('meeting-note-added', note);
    }

    nsp.to(token).emit('notetaker-status', { status: 'listening' });
  } catch (err) {
    console.error('[notetaker] server flush error:', err);
    nsp.to(token).emit('notetaker-status', { status: 'listening' });
  }
}

export function initSocketIO(server) {
  const io = new Server(server, {
    cors: { origin: '*' },
    path: '/socket.io',
  });

  const meetings = io.of('/meetings');

  meetings.on('connection', (socket) => {
    // Try to identify admin from JWT cookie
    let adminUser = null;
    try {
      const cookies = socket.handshake.headers.cookie || '';
      const match = cookies.match(/slab_token=([^;]+)/);
      if (match) {
        const decoded = jwt.verify(match[1], config.JWT_SECRET);
        if (decoded.isAdmin) {
          adminUser = decoded;
        }
      }
    } catch {}

    socket.on('join-room', async (data) => {
      const { token, displayName, db: dbName, consentAgreedAt } = data || {};
      if (!token || !displayName) {
        return socket.emit('room-error', { message: 'Name and meeting link required.' });
      }

      try {
        const db = dbName ? getTenantDb(dbName) : getDb();
        const meeting = await db.collection('meetings').findOne({ token, status: 'active' });

        if (!meeting) {
          return socket.emit('room-error', { message: 'This meeting link is invalid or has been closed.' });
        }
        if (meeting.expiresAt && new Date(meeting.expiresAt) < new Date()) {
          await db.collection('meetings').updateOne({ _id: meeting._id }, { $set: { status: 'expired' } });
          return socket.emit('room-error', { message: 'This meeting link has expired.' });
        }
        if (meeting.maxUses && meeting.useCount >= meeting.maxUses) {
          return socket.emit('room-error', { message: 'This meeting link has reached its maximum uses.' });
        }

        // Check room capacity
        if (!activeRooms.has(token)) activeRooms.set(token, new Map());
        const room = activeRooms.get(token);
        if (room.size >= MAX_PARTICIPANTS) {
          return socket.emit('room-error', { message: 'This meeting is full (max 5 participants).' });
        }

        // Consent gate — require acknowledgment if meeting has consent settings (hosts skip)
        const consent = meeting.consent || {};
        const consentRequired = consent.recordingNotice || consent.transcriptionDisclaimer || consent.customText;
        const isHost = !!adminUser;
        if (consentRequired && !isHost && !consentAgreedAt) {
          return socket.emit('room-error', { message: 'You must accept the meeting terms before joining.' });
        }

        // Resolve participant identity for auto-tagging
        let finalName = displayName.trim();
        const autoTag = { $addToSet: {} };

        if (adminUser && adminUser.id) {
          // Logged-in admin/user — auto-tag by user ID
          try { autoTag.$addToSet['tags.users'] = new ObjectId(adminUser.id); } catch {}
          if (!finalName || finalName.toLowerCase() === 'guest') {
            finalName = adminUser.displayName || adminUser.email || displayName;
          }
        }

        if (!finalName || finalName.toLowerCase() === 'guest') {
          // Assign Guest N
          const existingGuests = (meeting.participants || []).filter(p => /^Guest \d+$/i.test(p.name));
          finalName = 'Guest ' + (existingGuests.length + 1);
        }

        // Try to match displayName to a client record (name or email, case-insensitive)
        if (!adminUser) {
          const nameRegex = new RegExp('^' + finalName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$', 'i');
          const matchedClient = await db.collection('clients').findOne({
            $or: [{ name: nameRegex }, { email: nameRegex }]
          }, { projection: { _id: 1 } });
          if (matchedClient) {
            autoTag.$addToSet['tags.clients'] = matchedClient._id;
          }

          // Also try matching against platform users by displayName or email
          const matchedUser = await db.collection('users').findOne({
            $or: [{ displayName: nameRegex }, { name: nameRegex }, { email: nameRegex }]
          }, { projection: { _id: 1 } });
          if (matchedUser) {
            if (!autoTag.$addToSet['tags.users']) {
              autoTag.$addToSet['tags.users'] = matchedUser._id;
            }
          }
        }

        // Build the update — always inc useCount + push participant
        const updateOps = {
          $inc: { useCount: 1 },
          $push: { participants: {
            name: finalName,
            joinedAt: new Date(),
            consentAgreedAt: consentAgreedAt ? new Date(consentAgreedAt) : null,
          } },
        };

        // Merge $addToSet if we have any auto-tags
        if (Object.keys(autoTag.$addToSet).length) {
          updateOps.$addToSet = autoTag.$addToSet;
        }

        await db.collection('meetings').updateOne(
          { _id: meeting._id },
          updateOps
        );

        room.set(socket.id, { displayName: finalName, isHost });
        socket.join(token);
        socket.meetingToken = token;
        socket.meetingName = finalName;
        socket.tenantDb = dbName || '';

        // Send existing peers to the joiner
        const existingPeers = [];
        for (const [sid, info] of room) {
          if (sid !== socket.id) {
            existingPeers.push({ peerId: sid, displayName: info.displayName, isHost: info.isHost });
          }
        }
        socket.emit('room-joined', { peers: existingPeers, title: meeting.title });

        // Notify existing peers
        socket.to(token).emit('room-peer-joined', {
          peerId: socket.id,
          displayName: finalName,
          isHost,
        });
      } catch (err) {
        console.error('[meetings] join-room error:', err);
        socket.emit('room-error', { message: 'Server error joining meeting.' });
      }
    });

    // WebRTC signaling relay
    socket.on('webrtc-offer', (data) => {
      if (data.targetPeerId) {
        meetings.to(data.targetPeerId).emit('webrtc-offer', {
          fromPeerId: socket.id,
          sdp: data.sdp,
        });
      }
    });

    socket.on('webrtc-answer', (data) => {
      if (data.targetPeerId) {
        meetings.to(data.targetPeerId).emit('webrtc-answer', {
          fromPeerId: socket.id,
          sdp: data.sdp,
        });
      }
    });

    socket.on('webrtc-ice', (data) => {
      if (data.targetPeerId) {
        meetings.to(data.targetPeerId).emit('webrtc-ice', {
          fromPeerId: socket.id,
          candidate: data.candidate,
        });
      }
    });

    socket.on('media-toggle', (data) => {
      const token = socket.meetingToken;
      if (token) {
        socket.to(token).emit('media-toggled', {
          peerId: socket.id,
          kind: data.kind,
          enabled: data.enabled,
        });
      }
    });

    // --- Notes ---
    socket.on('meeting-note', async (data) => {
      const token = socket.meetingToken;
      if (!token || !data.text) return;
      const noteId = 'note-' + Date.now() + '-' + crypto.randomBytes(4).toString('hex');
      const note = {
        _noteId: noteId,
        author: socket.meetingName || 'Unknown',
        text: data.text.slice(0, 5000),
        createdAt: new Date(),
      };
      try {
        const db = socket.tenantDb ? getTenantDb(socket.tenantDb) : getDb();
        await db.collection('meetings').updateOne(
          { token },
          { $push: { notes: note } }
        );
        meetings.to(token).emit('meeting-note-added', note);
      } catch (err) {
        console.error('[meetings] note save error:', err);
      }
    });

    // --- Note edit ---
    socket.on('meeting-note-edit', async (data) => {
      const token = socket.meetingToken;
      if (!token || !data.text || !data.noteId) return;
      try {
        const db = socket.tenantDb ? getTenantDb(socket.tenantDb) : getDb();
        const newText = data.text.slice(0, 5000);
        // Try matching by _noteId first, fall back to createdAt
        let result = await db.collection('meetings').updateOne(
          { token, 'notes._noteId': data.noteId },
          { $set: { 'notes.$.text': newText } }
        );
        if (!result.modifiedCount && data.createdAt) {
          await db.collection('meetings').updateOne(
            { token, 'notes.createdAt': new Date(data.createdAt) },
            { $set: { 'notes.$.text': newText } }
          );
        }
        // Broadcast to all peers
        meetings.to(token).emit('meeting-note-edited', {
          noteId: data.noteId,
          text: newText,
          editedBy: socket.meetingName || 'Unknown',
        });
      } catch (err) {
        console.error('[meetings] note edit error:', err);
      }
    });

    // --- Note reply ---
    socket.on('meeting-note-reply', async (data) => {
      const token = socket.meetingToken;
      if (!token || !data.text || !data.noteId) return;
      try {
        const db = socket.tenantDb ? getTenantDb(socket.tenantDb) : getDb();
        const reply = {
          author: socket.meetingName || 'Unknown',
          text: data.text.slice(0, 2000),
          createdAt: new Date(),
        };
        // Push reply into the note's replies array
        await db.collection('meetings').updateOne(
          { token, 'notes._noteId': data.noteId },
          { $push: { 'notes.$.replies': reply } }
        );
        meetings.to(token).emit('meeting-note-reply-added', {
          noteId: data.noteId,
          reply: reply,
        });
      } catch (err) {
        console.error('[meetings] note reply error:', err);
      }
    });

    // --- Asset uploaded notification ---
    socket.on('meeting-asset-uploaded', (data) => {
      const token = socket.meetingToken;
      if (!token || !data.asset) return;
      // Broadcast to all peers
      meetings.to(token).emit('meeting-asset-added', data.asset);
    });

    // --- Live transcript line (broadcast to OTHER peers only — sender shows locally) ---
    socket.on('transcript-line', (data) => {
      const token = socket.meetingToken;
      if (!token || !data.text) return;
      socket.to(token).emit('transcript-line', {
        speaker: socket.meetingName || 'Unknown',
        text: data.text.slice(0, 2000),
        isFinal: !!data.isFinal,
      });

      // Accumulate final lines server-side for TLDR (captures ALL participants)
      if (data.isFinal && roomTranscripts.has(token)) {
        roomTranscripts.get(token).lines.push(
          (socket.meetingName || 'Unknown') + ': ' + data.text.slice(0, 2000)
        );
      }
    });

    // --- Notetaker activation: start server-side accumulation + tell peers to start speech recognition ---
    socket.on('notetaker-activate', () => {
      const token = socket.meetingToken;
      if (!token) return;

      if (!roomTranscripts.has(token)) {
        roomTranscripts.set(token, { lines: [], timer: null, tenantDb: socket.tenantDb || '' });
      }
      const rt = roomTranscripts.get(token);

      // Start server-side flush timer if not already running
      if (!rt.timer) {
        rt.timer = setInterval(() => flushRoomTranscript(token, meetings), TRANSCRIPT_FLUSH_INTERVAL);
      }

      // Tell all other peers to auto-start their speech recognition
      socket.to(token).emit('notetaker-activate', { activatedBy: socket.meetingName });
      meetings.to(token).emit('notetaker-status', { status: 'listening' });
    });

    // --- Notetaker deactivation: flush remaining + stop timer ---
    socket.on('notetaker-deactivate', () => {
      const token = socket.meetingToken;
      if (!token) return;

      flushRoomTranscript(token, meetings);

      const rt = roomTranscripts.get(token);
      if (rt && rt.timer) {
        clearInterval(rt.timer);
        rt.timer = null;
      }

      socket.to(token).emit('notetaker-deactivate');
    });

    // --- Manual TLDR flush (from "TLDR Now" button) ---
    socket.on('notetaker-flush', () => {
      const token = socket.meetingToken;
      if (!token) return;
      flushRoomTranscript(token, meetings);
    });

    // --- Legacy: client-side transcription chunk (fallback) ---
    socket.on('transcription-chunk', async (data) => {
      const token = socket.meetingToken;
      if (!token || !data.transcript) return;

      let meetingTitle = 'Meeting';
      try {
        const db = socket.tenantDb ? getTenantDb(socket.tenantDb) : getDb();
        const meeting = await db.collection('meetings').findOne({ token }, { projection: { title: 1 } });
        if (meeting) meetingTitle = meeting.title || meetingTitle;

        meetings.to(token).emit('notetaker-status', { status: 'summarizing' });

        const summary = await summarizeChunk(
          data.transcript,
          socket.meetingName || 'Unknown',
          meetingTitle
        );

        if (summary) {
          const noteId = 'ai-' + Date.now() + '-' + crypto.randomBytes(4).toString('hex');
          const note = {
            _noteId: noteId,
            author: 'AI Notetaker',
            text: summary,
            createdAt: new Date(),
            isAI: true,
          };

          await db.collection('meetings').updateOne(
            { token },
            { $push: { notes: note } }
          );

          meetings.to(token).emit('meeting-note-added', note);
        }

        meetings.to(token).emit('notetaker-status', { status: 'listening' });
      } catch (err) {
        console.error('[notetaker] chunk processing error:', err);
        meetings.to(token).emit('notetaker-status', { status: 'listening' });
      }
    });

    socket.on('disconnect', () => {
      const token = socket.meetingToken;
      if (!token) return;
      const room = activeRooms.get(token);
      if (room) {
        room.delete(socket.id);
        if (room.size === 0) {
          activeRooms.delete(token);
          // Final flush + cleanup of transcript buffer when room empties
          const rt = roomTranscripts.get(token);
          if (rt) {
            if (rt.timer) clearInterval(rt.timer);
            flushRoomTranscript(token, meetings);
            roomTranscripts.delete(token);
          }
        }
      }
      socket.to(token).emit('room-peer-left', { peerId: socket.id });
    });
  });

  // ── /live — browser-sourced simulcast relay (admin only) ───────────────────
  // The studio streams MediaRecorder chunks here; we create the platform
  // broadcasts, spawn one ffmpeg relay per session, and fan out to every RTMP
  // target. Session id = socket id (one live session per studio connection).
  const live = io.of('/live');
  live.on('connection', (socket) => {
    let isAdmin = false;
    try {
      const m = (socket.handshake.headers.cookie || '').match(/slab_token=([^;]+)/);
      if (m) isAdmin = !!jwt.verify(m[1], config.JWT_SECRET)?.isAdmin;
    } catch {}
    if (!isAdmin) { socket.emit('live:error', { message: 'Admin login required.' }); return socket.disconnect(true); }

    const state = {}; // { youtube:{creds,broadcastId}, facebook:{creds,liveVideoId} }

    async function cleanup() {
      try { stopSession(socket.id); } catch {}
      socket.data.live = false;
      if (state.chat) { try { state.chat.stop(); } catch {} state.chat = null; }
      if (state.viewers) { try { state.viewers.stop(); } catch {} state.viewers = null; }
      if (state.youtube) { try { await transitionYouTube(state.youtube.creds, state.youtube.broadcastId, 'complete'); } catch {} state.youtube = null; }
      if (state.facebook) { try { await endFacebookLive({ pageAccessToken: state.facebook.creds.pageAccessToken }, state.facebook.liveVideoId); } catch {} state.facebook = null; }
    }

    socket.on('live:start', async (data) => {
      if (socket.data.starting || socket.data.live) return;
      socket.data.starting = true;
      try {
        const { db: dbName, destinations, title, description } = data || {};
        const db = dbName ? getTenantDb(dbName) : getDb();
        const dests = Array.isArray(destinations) ? destinations : [];
        if (!dests.length) throw new Error('Pick at least one destination');

        const targets = [], links = [];
        let discordWebhook = null;   // Discord can't ingest video — it gets a "live now" announcement instead.
        let twitchChannel = null;    // captured from a Twitch RTMP target → enables Twitch chat read.
        for (const dest of dests) {
          const platform = typeof dest === 'string' ? dest : dest?.platform;
          if (platform === 'discord') {
            const acct = await db.collection('social_accounts').findOne({ platform: 'discord' });
            const creds = acct ? unpackCredentials(acct) : {};
            if (creds.webhookUrl) discordWebhook = creds.webhookUrl;
            continue;
          }
          if (platform === 'youtube') {
            const acct = await db.collection('social_accounts').findOne({ platform: 'youtube' });
            if (!acct) throw new Error('YouTube not connected');
            const creds = unpackCredentials(acct);
            const yt = await createYouTubeBroadcast(creds, { title, description });
            targets.push({ platform: 'youtube', label: 'YouTube', rtmpUrl: yt.rtmpUrl });
            state.youtube = { creds, broadcastId: yt.broadcastId };
            links.push({ platform: 'youtube', label: 'YouTube', watchUrl: yt.watchUrl, studioUrl: yt.studioUrl });
          } else if (platform === 'facebook') {
            const acct = await db.collection('social_accounts').findOne({ platform: 'facebook' });
            if (!acct) throw new Error('Facebook not connected');
            const creds = unpackCredentials(acct);
            const fb = await createFacebookLive({ pageId: creds.pageId, pageAccessToken: creds.pageAccessToken }, { title, description });
            targets.push({ platform: 'facebook', label: 'Facebook', rtmpUrl: fb.rtmpUrl });
            state.facebook = { creds, liveVideoId: fb.liveVideoId };
            links.push({ platform: 'facebook', label: 'Facebook', watchUrl: fb.watchUrl });
          } else if (platform === 'rtmp' && dest?.id) {
            // Saved RTMP destination — look it up and decrypt the key server-side.
            const t = await db.collection('live_rtmp_targets').findOne({ _id: new ObjectId(dest.id) });
            if (!t || !t.url) throw new Error('Saved RTMP destination not found');
            const key = t.key ? decrypt(t.key) : '';
            const rtmpUrl = key ? t.url.replace(/\/+$/, '') + '/' + key : t.url;
            targets.push({ platform: 'custom', label: t.label || 'RTMP', rtmpUrl });
            links.push({ platform: 'custom', label: t.label || 'RTMP', watchUrl: null });
            if (t.channel) twitchChannel = t.channel;
          } else if (platform === 'custom' && dest?.url) {
            const rtmpUrl = dest.key ? dest.url.replace(/\/+$/, '') + '/' + dest.key : dest.url;
            targets.push({ platform: 'custom', label: dest.label || 'Custom RTMP', rtmpUrl });
            links.push({ platform: 'custom', label: dest.label || 'Custom RTMP', watchUrl: null });
            if (dest.channel) twitchChannel = dest.channel;
          }
        }
        if (!targets.length) throw new Error('Pick at least one video destination (YouTube, Facebook, or an RTMP target)');

        startSession(socket.id, targets, {
          onLog: (line) => { if (/error|fail|unable/i.test(line)) socket.emit('live:log', { line: line.trim().slice(0, 300) }); },
          onExit: ({ code }) => { socket.data.live = false; socket.emit('live:ended', { code }); },
        });
        socket.data.live = true;
        socket.emit('live:started', { links });

        // Unified live chat — merge every readable platform into the studio panel.
        // A chatter's FIRST message this session also fires live:joiner so the host
        // can shout out new arrivals.
        const chatSources = {
          youtube: state.youtube ? { creds: state.youtube.creds, broadcastId: state.youtube.broadcastId } : null,
          facebook: state.facebook ? { pageAccessToken: state.facebook.creds.pageAccessToken, liveVideoId: state.facebook.liveVideoId } : null,
          twitch: twitchChannel ? { channel: twitchChannel } : null,
        };
        try {
          const joinerSeen = new Set();
          state.chat = startLiveChat(chatSources, (msg) => {
            try {
              socket.emit('chat:msg', msg);
              const key = msg.platform + ':' + String(msg.author || '').toLowerCase();
              if (msg.author && !joinerSeen.has(key)) { joinerSeen.add(key); socket.emit('live:joiner', { platform: msg.platform, author: msg.author, ts: msg.ts || Date.now() }); }
            } catch {}
          });
        } catch (e) { console.warn('[live] chat start failed:', e.message); }

        // Concurrent viewer counts (YouTube + Facebook) → studio stats.
        try {
          state.viewers = startViewerCounts(chatSources, (v) => { try { socket.emit('live:viewers', v); } catch {} });
        } catch (e) { console.warn('[live] viewer counts failed:', e.message); }

        // Discord go-live announcement (best-effort — never blocks the stream).
        if (discordWebhook) {
          const watchLinks = links.filter(l => l.watchUrl);
          const content = [
            `🔴 **We're live${title ? ': ' + title : ''}!**`,
            ...watchLinks.map(l => `▶️ ${l.label}: ${l.watchUrl}`),
          ].join('\n').slice(0, 2000);
          fetch(discordWebhook, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ content }), signal: AbortSignal.timeout(15000),
          }).catch(() => {});
        }
      } catch (e) {
        socket.emit('live:error', { message: e.message });
        await cleanup();
      } finally {
        socket.data.starting = false;
      }
    });

    socket.on('live:chunk', (chunk) => {
      if (socket.data.live && chunk) writeChunk(socket.id, Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    });
    socket.on('live:stop', async () => { await cleanup(); socket.emit('live:ended', { code: 0 }); });

    // ── Control-deck relay ─────────────────────────────────────────────────────
    // Pair a remote controller (a phone / second device on the same tenant) with
    // the encoder tab via a shared code room, and forward overlay/sound cues
    // between them. Same-browser pop-outs use BroadcastChannel instead and never
    // hit the server. Cues are small JSON control messages — never media.
    socket.on('ctrl:join', ({ code, role } = {}) => {
      const c = String(code || '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 40);
      if (!c) return;
      socket.data.ctrlRoom = 'ctrl:' + c;
      socket.data.ctrlRole = role === 'encoder' ? 'encoder' : 'controller';
      socket.join(socket.data.ctrlRoom);
      socket.to(socket.data.ctrlRoom).emit('ctrl:peer', { role: socket.data.ctrlRole });
    });
    socket.on('ctrl:cue', (cue) => {
      if (socket.data.ctrlRoom && cue && typeof cue === 'object') socket.to(socket.data.ctrlRoom).emit('ctrl:cue', cue);
    });

    socket.on('disconnect', () => { cleanup(); });
  });

  // ── Huginn REMOVED ─────────────────────────────────────────────────────────

  // Create index after DB is ready (deferred)
  setTimeout(() => {
    try {
      const db = getDb();
      db.collection('meetings').createIndex({ token: 1 }, { unique: true }).catch(() => {});
    } catch {}
  }, 5000);

  initChatNamespace(io);
  return io;
}
