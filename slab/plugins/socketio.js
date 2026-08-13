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

const activeRooms = new Map(); // token -> Map<socketId, { displayName, isHost, sessionId }>
const roomTranscripts = new Map(); // token -> { lines: [], timer: null, tenantDb: '' }
const MAX_PARTICIPANTS = 5;

// Sockets that dropped but may still come back. A mobile client's transport
// closes the instant it loses signal, seconds before its rejoin lands, so the
// live room map is already empty by then — without this window every 5G blip
// looks like a brand-new participant and burns a link use.
const REJOIN_GRACE_MS = 90 * 1000;
const recentSessions = new Map(); // token -> Map<sessionId, { displayName, expiresAt }>

function rememberSession(token, sessionId, displayName) {
  if (!token || !sessionId) return;
  if (!recentSessions.has(token)) recentSessions.set(token, new Map());
  recentSessions.get(token).set(sessionId, { displayName, expiresAt: Date.now() + REJOIN_GRACE_MS });
}

// Returns the remembered entry if this session left recently, else null.
// Prunes expired entries as it goes so the map can't grow unbounded.
function takeRecentSession(token, sessionId) {
  const bucket = recentSessions.get(token);
  if (!bucket) return null;
  const now = Date.now();
  for (const [sid, rec] of bucket) {
    if (rec.expiresAt <= now) bucket.delete(sid);
  }
  const hit = sessionId ? bucket.get(sessionId) : null;
  if (hit) bucket.delete(sessionId);
  if (!bucket.size) recentSessions.delete(token);
  return hit || null;
}

// True if this session is already a meeting participant — either live in the
// room right now, or dropped within the rejoin grace window. Read-only (does
// NOT consume the grace entry) so the socket join can still claim it. Lets the
// page-load route tell "returning participant" from "brand-new visitor" without
// duplicating the socket layer's session bookkeeping.
export function peekKnownSession(token, sessionId) {
  if (!token || !sessionId) return false;
  const room = activeRooms.get(token);
  if (room) {
    for (const info of room.values()) {
      if (info.sessionId === sessionId) return true;
    }
  }
  const bucket = recentSessions.get(token);
  const rec = bucket && bucket.get(sessionId);
  return !!(rec && rec.expiresAt > Date.now());
}

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
      const { token, displayName, db: dbName, consentAgreedAt, sessionId } = data || {};
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
        if (!activeRooms.has(token)) activeRooms.set(token, new Map());
        const room = activeRooms.get(token);

        // Mobile clients reconnect constantly (5G handoff, backgrounding), and
        // each reconnect arrives as a new socket id. Match on the browser's
        // stable sessionId so a rejoin replaces the stale entry instead of
        // counting as a second participant — otherwise flaky phones burn
        // through maxUses and spam the participant list.
        const staleSids = [];
        if (sessionId) {
          for (const [sid, info] of room) {
            if (info.sessionId === sessionId && sid !== socket.id) staleSids.push(sid);
          }
        }
        // Either the old socket is still in the room (fast reconnect) or it
        // dropped moments ago and is inside the grace window (the common case).
        const departed = takeRecentSession(token, sessionId);
        const isRejoin = staleSids.length > 0 || !!departed;

        // Resolved AFTER the rejoin check on purpose: someone already in the
        // meeting must be able to come back even when the link is maxed out,
        // otherwise the last seat locks its own occupant out on a dropped bar
        // of signal.
        if (!isRejoin && meeting.maxUses && meeting.useCount >= meeting.maxUses) {
          return socket.emit('room-error', { message: 'This meeting link has reached its maximum uses.' });
        }

        // Check room capacity (the seats we're about to reclaim don't count)
        if (room.size - staleSids.length >= MAX_PARTICIPANTS) {
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

        // A rejoin keeps the name it already had — re-deriving it could hand
        // the same person a different "Guest N" mid-meeting.
        if (isRejoin) {
          const prior = staleSids.length ? room.get(staleSids[0]) : departed;
          if (prior && prior.displayName) finalName = prior.displayName;
        }

        // Only a genuinely new participant consumes a use and gets a record.
        if (!isRejoin) {
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
        }

        room.set(socket.id, { displayName: finalName, isHost, sessionId: sessionId || null });
        socket.join(token);
        socket.meetingToken = token;
        socket.meetingName = finalName;
        socket.tenantDb = dbName || '';

        // Evict the superseded sockets — after room.set, so the room never
        // momentarily empties (that would flush and drop the transcript buffer).
        for (const sid of staleSids) {
          room.delete(sid);
          socket.to(token).emit('room-peer-left', { peerId: sid });
          const stale = meetings.sockets.get(sid);
          if (stale) {
            stale.meetingToken = null;   // its disconnect handler is now a no-op
            stale.disconnect(true);
          }
        }

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
        const info = room.get(socket.id);
        // Hold the seat briefly — a mobile client that just lost signal will
        // rejoin with this same sessionId and should resume, not re-register.
        if (info && info.sessionId) rememberSession(token, info.sessionId, info.displayName);
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

  // ── Field ops: live GPS location for on-site jobs ──────────────────────────
  // A field tech (admin/staff) broadcasts their device location for a job; anyone
  // watching that job's detail page receives it live. Room = 'job:<jobId>'.
  // DB writes are scoped to the JWT's own tenant (never a client-supplied name)
  // so a tech can only ping into their own workspace's field_jobs.
  const field = io.of('/field');
  field.on('connection', (socket) => {
    let adminUser = null;
    try {
      const match = (socket.handshake.headers.cookie || '').match(/slab_token=([^;]+)/);
      if (match) {
        const decoded = jwt.verify(match[1], config.JWT_SECRET);
        if (decoded.isAdmin) adminUser = decoded;
      }
    } catch {}
    // Field ops is staff-only.
    if (!adminUser) { socket.disconnect(true); return; }
    const tenantDb = adminUser.tenantDb || null;

    socket.on('field:join', async (data) => {
      const { jobId, role } = data || {};
      if (!jobId) return;
      let jid; try { jid = new ObjectId(jobId); } catch { return; }
      socket.jobId = jobId;
      socket.role = role === 'tech' ? 'tech' : 'viewer';
      socket.join('job:' + jobId);
      // Replay the last known location to a freshly-joined viewer.
      try {
        const db = tenantDb ? getTenantDb(tenantDb) : getDb();
        const job = await db.collection('field_jobs').findOne({ _id: jid }, { projection: { location: 1 } });
        if (job?.location) socket.emit('field:loc', { jobId, ...job.location });
      } catch {}
    });

    socket.on('field:loc', async (data) => {
      if (socket.role !== 'tech' || !socket.jobId) return;
      const { lat, lng, accuracy } = data || {};
      if (typeof lat !== 'number' || typeof lng !== 'number' || Math.abs(lat) > 90 || Math.abs(lng) > 180) return;
      let jid; try { jid = new ObjectId(socket.jobId); } catch { return; }
      const at = new Date();
      const loc = { lat, lng, accuracy: typeof accuracy === 'number' ? accuracy : null, at, by: adminUser.email || '' };
      try {
        const db = tenantDb ? getTenantDb(tenantDb) : getDb();
        await db.collection('field_jobs').updateOne({ _id: jid }, { $set: { location: loc, updatedAt: at } });
      } catch (err) { console.error('[field-socket] persist error:', err.message); }
      field.to('job:' + socket.jobId).emit('field:loc', { jobId: socket.jobId, ...loc });
    });
  });

  initChatNamespace(io);
  return io;
}
