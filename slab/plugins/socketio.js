import { Server } from 'socket.io';
import jwt from 'jsonwebtoken';
import { getDb, getTenantDb } from './mongo.js';
import { config } from '../config/config.js';
import crypto from 'crypto';
import { ObjectId } from 'mongodb';
import { summarizeChunk } from './meetingNotetaker.js';

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

  // ── Huginn ↔ Control Center namespace ─────────────────────────────────────
  const huginn = io.of('/huginn');
  const huginnDisplays = new Map(); // displayId -> Set<socketId>

  huginn.on('connection', (socket) => {
    // Auth: superadmin only (JWT cookie)
    let saUser = null;
    try {
      const cookies = socket.handshake.headers.cookie || '';
      const match = cookies.match(/slab_token=([^;]+)/);
      if (match) {
        const decoded = jwt.verify(match[1], config.JWT_SECRET);
        if (decoded.isAdmin) saUser = decoded;
      }
    } catch {}

    if (!saUser) {
      socket.emit('huginn-error', { message: 'Unauthorized' });
      return socket.disconnect(true);
    }

    socket.saUser = saUser;

    // Join as huginn chat operator
    socket.on('join-huginn', () => {
      socket.join('huginn-chat');
      socket.huginnRole = 'chat';
      // Notify control centers that operator is online
      huginn.to('control-center').emit('operator-status', { online: true, email: saUser.email });
    });

    // Join as control center display
    socket.on('join-control-center', (data) => {
      const displayId = (data && data.displayId) || 'default';
      socket.join('control-center');
      socket.join('display-' + displayId);
      socket.huginnRole = 'display';
      socket.displayId = displayId;

      if (!huginnDisplays.has(displayId)) huginnDisplays.set(displayId, new Set());
      huginnDisplays.get(displayId).add(socket.id);

      // Send current display list to chat operators
      huginn.to('huginn-chat').emit('displays-updated', getDisplayList());
    });

    // Huginn state broadcasts (thinking/speaking/idle) → orb animations
    socket.on('huginn-state', (data) => {
      if (socket.huginnRole !== 'chat') return;
      huginn.to('control-center').emit('huginn-state', {
        state: data.state || 'idle',  // idle | thinking | speaking | listening | dreaming | alert
        detail: data.detail || '',
        intensity: data.intensity || 1.0,
      });
    });

    // Deploy content from Huginn chat → control center display(s)
    socket.on('deploy', (data) => {
      if (socket.huginnRole !== 'chat') return;
      const { content, type, displayId, style } = data || {};
      if (!content) return;

      const payload = {
        id: Date.now().toString(36) + '-' + crypto.randomBytes(3).toString('hex'),
        content,
        type: type || 'text',       // text, code, markdown, alert, metric
        style: style || {},          // optional styling hints
        deployedBy: saUser.email,
        deployedAt: new Date().toISOString(),
      };

      // Target specific display or broadcast to all
      if (displayId && displayId !== 'all') {
        huginn.to('display-' + displayId).emit('deploy', payload);
      } else {
        huginn.to('control-center').emit('deploy', payload);
      }

      // Echo back to chat so operator sees confirmation
      socket.emit('deploy-ack', payload);
    });

    // Clear display
    socket.on('clear-display', (data) => {
      if (socket.huginnRole !== 'chat') return;
      const displayId = (data && data.displayId) || 'all';
      if (displayId === 'all') {
        huginn.to('control-center').emit('clear');
      } else {
        huginn.to('display-' + displayId).emit('clear');
      }
    });

    // Ping from display (heartbeat)
    socket.on('display-ping', () => {
      socket.emit('display-pong', { time: Date.now() });
    });

    socket.on('disconnect', () => {
      if (socket.huginnRole === 'display' && socket.displayId) {
        const set = huginnDisplays.get(socket.displayId);
        if (set) {
          set.delete(socket.id);
          if (set.size === 0) huginnDisplays.delete(socket.displayId);
        }
        huginn.to('huginn-chat').emit('displays-updated', getDisplayList());
      }
      if (socket.huginnRole === 'chat') {
        huginn.to('control-center').emit('operator-status', { online: false });
      }
    });
  });

  function getDisplayList() {
    const list = [];
    for (const [displayId, sockets] of huginnDisplays) {
      list.push({ displayId, connections: sockets.size });
    }
    return list;
  }

  // Create index after DB is ready (deferred)
  setTimeout(() => {
    try {
      const db = getDb();
      db.collection('meetings').createIndex({ token: 1 }, { unique: true }).catch(() => {});
    } catch {}
  }, 5000);

  // Store io globally for webhook access
  global.huginnIO = io;

  return io;
}

// Export accessor for other modules
export function getHuginnIO() {
  return global.huginnIO || null;
}
