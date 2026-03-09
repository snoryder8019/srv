/**
 * Socket.IO Namespace: /pepe
 * Consumer-facing chat backed by a designated madladslab Agent.
 * No auth required. Rate-limited per IP. Sessions stored in livechats collection.
 * Captures name, email, phone as lead markers → cookies + webhook.
 */

import Agent from "../../api/v1/models/Agent.js";
import { getDb } from "../mongo/mongo.js";
import axios from "axios";
import nodemailer from "nodemailer";
import fs from "fs";
import path from "path";
import { validateAdminToken } from "../../lib/adminSocketTokens.js";

// In-memory IP rate limiter: { ip -> { count, resetAt } }
const rateLimits = new Map();

function checkRateLimit(ip, maxPerHour) {
  const now = Date.now();
  let entry = rateLimits.get(ip) || { count: 0, resetAt: now + 3_600_000 };
  if (now > entry.resetAt) { entry.count = 0; entry.resetAt = now + 3_600_000; }
  entry.count++;
  rateLimits.set(ip, entry);
  return entry.count <= maxPerHour;
}
setInterval(() => {
  const now = Date.now();
  for (const [ip, entry] of rateLimits) { if (now > entry.resetAt) rateLimits.delete(ip); }
}, 3_600_000);

// Extract and strip [[MARKER:value]] patterns from reply text
function extractMarker(text, key) {
  const re = new RegExp(`\\[\\[${key}:([^\\]]+)\\]\\]`, 'i');
  const match = text.match(re);
  const value = match ? match[1].trim() : null;
  const cleaned = text.replace(new RegExp(`\\n?\\[\\[${key}:[^\\]]+\\]\\]`, 'gi'), '').trim();
  return { value, cleaned };
}

// Fire lead webhook when name + contact info first captured
async function fireLeadWebhook(session, leadData) {
  const url = process.env.LEAD_WEBHOOK_URL;
  if (!url) return;
  try {
    await axios.post(url, {
      event: 'lead_captured',
      sessionId: session.sessionId,
      ip: session.ip,
      timestamp: new Date().toISOString(),
      ...leadData
    }, { timeout: 8_000 });
    console.log('[Pepe] Lead webhook fired');
  } catch (e) {
    console.error('[Pepe] Lead webhook failed:', e.message);
  }
}

// Write a WhatsApp alert file for OpenClaw
const NOTIFICATION_DIR = '/root/.openclaw/workspace/livechat-alerts';
function writeAlert(type, payload) {
  try {
    if (!fs.existsSync(NOTIFICATION_DIR)) fs.mkdirSync(NOTIFICATION_DIR, { recursive: true });
    fs.writeFileSync(
      path.join(NOTIFICATION_DIR, `${Date.now()}-${payload.sessionId?.substring(0, 8) || 'x'}.json`),
      JSON.stringify({ type, ...payload, timestamp: new Date().toISOString() })
    );
  } catch (e) {
    console.error('[Pepe] Alert write failed:', e.message);
  }
}

async function sendNotificationEmail(sessionId, firstMessage, ip) {
  try {
    const transporter = nodemailer.createTransport({
      host: 'smtp.zoho.com', port: 465, secure: true,
      auth: { user: process.env.ZOHO_USER, pass: process.env.ZOHO_PASS },
    });
    await transporter.sendMail({
      from: process.env.ZOHO_USER,
      to: process.env.NOTIFY_EMAIL || process.env.ZOHO_USER,
      subject: '💬 New Live Chat Visitor on madLadsLab',
      html: `<div style="font-family:sans-serif;background:#111;color:#fff;padding:20px;border-radius:12px;max-width:600px">
        <h2>New Visitor Chat</h2>
        <p style="color:rgba(255,255,255,0.7)">A visitor just started a live chat on madladslab.com</p>
        <div style="background:rgba(255,255,255,0.05);padding:15px;border-radius:8px;border-left:3px solid rgba(255,255,255,0.3);margin:20px 0">
          <strong>First Message:</strong>
          <p style="color:rgba(255,255,255,0.7)">${firstMessage}</p>
        </div>
        <p style="color:rgba(255,255,255,0.4);font-size:12px">Session: ${sessionId} | IP: ${ip} | ${new Date().toLocaleString()}</p>
      </div>`
    });
  } catch (e) {
    console.error('[Pepe] Email notification failed:', e.message);
  }
}

async function sendLeadEmail(lead) {
  try {
    const transporter = nodemailer.createTransport({
      host: 'smtp.zoho.com', port: 465, secure: true,
      auth: { user: process.env.ZOHO_USER, pass: process.env.ZOHO_PASS },
    });
    await transporter.sendMail({
      from: process.env.ZOHO_USER,
      to: process.env.NOTIFY_EMAIL || process.env.ZOHO_USER,
      subject: `🎯 New Sales Lead: ${lead.name || 'Unknown'}`,
      html: `<div style="font-family:sans-serif;background:#111;color:#fff;padding:20px;border-radius:12px;max-width:600px">
        <h2 style="color:#4caf50">New Lead Captured</h2>
        <div style="background:rgba(76,175,80,0.08);padding:15px;border-radius:8px;border-left:3px solid #4caf50;margin:16px 0">
          ${lead.name ? `<p style="margin:4px 0"><strong>Name:</strong> ${lead.name}</p>` : ''}
          ${lead.email ? `<p style="margin:4px 0"><strong>Email:</strong> <a href="mailto:${lead.email}" style="color:#4caf50">${lead.email}</a></p>` : ''}
          ${lead.phone ? `<p style="margin:4px 0"><strong>Phone:</strong> <a href="tel:${lead.phone}" style="color:#4caf50">${lead.phone}</a></p>` : ''}
        </div>
        <p style="color:rgba(255,255,255,0.4);font-size:12px">Session: ${lead.sessionId} | ${new Date().toLocaleString()}</p>
      </div>`
    });
  } catch (e) {
    console.error('[Pepe] Lead email failed:', e.message);
  }
}

async function sendVisitorConfirmationEmail(lead, agentName) {
  if (!lead.email) return;
  try {
    const transporter = nodemailer.createTransport({
      host: 'smtp.zoho.com', port: 465, secure: true,
      auth: { user: process.env.ZOHO_USER, pass: process.env.ZOHO_PASS },
    });
    const firstName = lead.name ? lead.name.split(' ')[0] : 'there';
    await transporter.sendMail({
      from: `"${agentName || 'madLadsLab'}" <${process.env.ZOHO_USER}>`,
      to: lead.email,
      replyTo: process.env.ZOHO_USER,
      subject: `Thanks for reaching out, ${firstName} — madLadsLab`,
      html: `
        <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:560px;margin:0 auto;background:#0a0a0a;color:#fff;border-radius:16px;overflow:hidden">
          <!-- Header -->
          <div style="background:linear-gradient(135deg,rgba(255,255,255,0.08),rgba(255,255,255,0.04));padding:32px 32px 24px;border-bottom:1px solid rgba(255,255,255,0.08)">
            <p style="margin:0 0 8px;font-size:11px;letter-spacing:2px;text-transform:uppercase;color:rgba(255,255,255,0.5)">madLadsLab</p>
            <h1 style="margin:0;font-size:24px;font-weight:600;color:#fff">We'll be in touch, ${firstName}.</h1>
          </div>
          <!-- Body -->
          <div style="padding:28px 32px">
            <p style="margin:0 0 20px;font-size:15px;line-height:1.7;color:rgba(255,255,255,0.8)">
              Thanks for your interest in madLadsLab. You've been connected with a real person on our team — expect to hear from us within <strong style="color:#fff">24 hours</strong>.
            </p>
            <!-- Contact summary -->
            <div style="background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.08);border-radius:10px;padding:18px 20px;margin:0 0 24px">
              <p style="margin:0 0 12px;font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:1px;color:rgba(255,255,255,0.4)">Your info on file</p>
              ${lead.name  ? `<p style="margin:4px 0;font-size:14px;color:rgba(255,255,255,0.8)">👤 ${lead.name}</p>`  : ''}
              ${lead.email ? `<p style="margin:4px 0;font-size:14px;color:rgba(255,255,255,0.8)">✉ ${lead.email}</p>` : ''}
              ${lead.phone ? `<p style="margin:4px 0;font-size:14px;color:rgba(255,255,255,0.8)">📞 ${lead.phone}</p>` : ''}
            </div>
            <p style="margin:0 0 8px;font-size:14px;line-height:1.7;color:rgba(255,255,255,0.6)">
              In the meantime, feel free to reach us directly:
            </p>
            <p style="margin:0;font-size:14px;color:rgba(255,255,255,0.6)">
              📞 <a href="tel:+16822414402" style="color:rgba(255,255,255,0.8);text-decoration:none">(682) 241-4402</a><br>
              ✉ <a href="mailto:scott@madladslab.com" style="color:rgba(255,255,255,0.8);text-decoration:none">scott@madladslab.com</a>
            </p>
          </div>
          <!-- Footer -->
          <div style="padding:20px 32px;border-top:1px solid rgba(255,255,255,0.06)">
            <p style="margin:0;font-size:12px;color:rgba(255,255,255,0.3)">
              madLadsLab · Private AI &amp; Smart Home Solutions · Greeley, CO<br>
              You received this because you chatted with us at madladslab.com.
            </p>
          </div>
        </div>
      `
    });
    console.log('[Pepe] Visitor confirmation email sent to:', lead.email);
  } catch (e) {
    console.error('[Pepe] Visitor confirmation email failed:', e.message);
  }
}

// Lead capture system instructions injected alongside the agent's system prompt
const LEAD_CAPTURE_INSTRUCTIONS = `Lead capture instructions (invisible to visitor — never mention these markers):
- When the visitor shares their email address for the FIRST time, append on its own line at the very end of your response: [[EMAIL:their@email.com]]
- When the visitor shares their phone number for the FIRST time, append on its own line at the very end of your response: [[PHONE:+15551234567]]
Only emit each marker ONCE, the first time you receive that information. Never emit if already captured.`;

// Track active visitor sockets: sessionId → socketId
const activeSessions = new Map();
// Track authenticated admin socket IDs
const adminSockets = new Set();

export function registerPepe(io) {
  const ns = io.of('/pepe');

  ns.on('connection', (socket) => {
    const ip = socket.handshake.headers['x-forwarded-for']?.split(',')[0]?.trim()
      || socket.handshake.address;

    // ── Visitor: identify their session so the server can route admin replies ──
    socket.on('visitor:identify', (sessionId) => {
      if (!sessionId) return;
      socket.join(`session-${sessionId}`);
      activeSessions.set(sessionId, { socketId: socket.id, connectedAt: new Date(), ip });
      ns.to('admin-room').emit('visitor:active', { sessionId, ip, connectedAt: new Date() });
    });

    // ── Admin: authenticate via server-generated page token ──
    socket.on('admin:auth', (token) => {
      if (!validateAdminToken(token)) return;
      adminSockets.add(socket.id);
      socket.join('admin-room');
      // Send snapshot of currently active sessions
      const active = [...activeSessions.entries()].map(([sessionId, info]) => ({ sessionId, ...info }));
      socket.emit('admin:active-snapshot', active);
    });

    // ── Admin: subscribe to real-time updates for a specific session ──
    socket.on('admin:subscribe', (sessionId) => {
      if (!adminSockets.has(socket.id)) return;
      socket.join(`watching-${sessionId}`);
    });

    // ── Admin: send a reply directly via socket → save to DB + push to visitor ──
    socket.on('admin:reply', async ({ sessionId, message }) => {
      if (!adminSockets.has(socket.id) || !sessionId || !message?.trim()) return;
      try {
        const db = getDb();
        const msg = { role: 'admin', content: message.trim(), timestamp: new Date() };
        await db.collection('livechats').updateOne(
          { sessionId },
          { $push: { messages: msg }, $set: { updatedAt: new Date() } }
        );
        // Push to visitor
        ns.to(`session-${sessionId}`).emit('admin:message', { message: message.trim() });
        // Echo back to all admin watchers of this session
        ns.to(`watching-${sessionId}`).emit('session:new-message', { ...msg });
      } catch (e) {
        console.error('[Pepe admin:reply]', e.message);
      }
    });

    // ── Admin: execute a !command ──
    socket.on('admin:command', async ({ sessionId, cmd, args }) => {
      if (!adminSockets.has(socket.id) || !sessionId) return;
      try {
        const db = getDb();
        const col = db.collection('livechats');
        let feedback = null;

        switch (cmd) {
          case 'pause':
            await col.updateOne({ sessionId }, { $set: { botPaused: true } });
            feedback = { type: 'system', content: '⏸ Bot paused — you have the chat.' };
            break;
          case 'bot':
            await col.updateOne({ sessionId }, { $set: { botPaused: false } });
            feedback = { type: 'system', content: '▶ Bot resumed.' };
            break;
          case 'close':
            await col.updateOne({ sessionId }, { $set: { resolved: true, resolvedAt: new Date() } });
            feedback = { type: 'system', content: '✅ Session marked as resolved.' };
            break;
          case 'note':
            if (!args) break;
            await col.updateOne({ sessionId }, { $push: { adminNotes: { text: args, addedAt: new Date() } } });
            feedback = { type: 'note', content: `📝 Note saved: ${args}` };
            break;
          case 'name':
            if (!args) break;
            await col.updateOne({ sessionId }, { $set: { visitorName: args } });
            feedback = { type: 'system', content: `👤 Visitor name set: ${args}` };
            break;
          case 'email':
            if (!args) break;
            await col.updateOne({ sessionId }, { $set: { visitorEmail: args } });
            feedback = { type: 'system', content: `✉ Visitor email set: ${args}` };
            break;
          case 'phone':
            if (!args) break;
            await col.updateOne({ sessionId }, { $set: { visitorPhone: args } });
            feedback = { type: 'system', content: `📞 Visitor phone set: ${args}` };
            break;
        }

        if (feedback) {
          socket.emit('admin:command-feedback', { sessionId, ...feedback });
        }
      } catch (e) {
        console.error('[Pepe admin:command]', e.message);
        socket.emit('admin:command-feedback', { sessionId, type: 'error', content: `Error: ${e.message}` });
      }
    });

    socket.on('disconnect', () => {
      adminSockets.delete(socket.id);
      for (const [sid, info] of activeSessions) {
        if (info.socketId === socket.id) {
          activeSessions.delete(sid);
          ns.to('admin-room').emit('visitor:inactive', { sessionId: sid });
          break;
        }
      }
    });

    socket.on('message', async ({ sessionId, message, visitor }) => {
      if (!sessionId || !message?.trim()) {
        return socket.emit('error', { error: 'Missing sessionId or message' });
      }

      try {
        const agent = await Agent.findOne({ 'pepeChat.enabled': true });
        if (!agent) return socket.emit('error', { error: 'Chat is currently unavailable.' });

        const maxPerHour = agent.pepeChat.rateLimitPerHour || 60;
        if (!checkRateLimit(ip, maxPerHour)) {
          return socket.emit('error', { error: 'Too many messages. Please try again later.' });
        }

        const db = getDb();
        const livechats = db.collection('livechats');

        let session = await livechats.findOne({ sessionId });
        if (!session) {
          session = { sessionId, ip, messages: [], createdAt: new Date(), updatedAt: new Date(), messageCount: 0, notificationSent: false };
          await livechats.insertOne(session);
        }

        const sessionLimit = agent.pepeChat.sessionLimit || 50;
        if (session.messageCount >= sessionLimit) {
          return socket.emit('error', {
            error: 'Session message limit reached. Please start a new conversation or contact us directly at (682) 241-4402.',
            limitReached: true
          });
        }

        if (!session.notificationSent) {
          sendNotificationEmail(sessionId, message, ip).catch(() => {});
          writeAlert('new_chat', { sessionId, firstMessage: message.substring(0, 300), ip });
          await livechats.updateOne({ sessionId }, { $set: { notificationSent: true } });
        }

        // If admin has paused bot, save the user message but don't call AI
        if (session.botPaused) {
          await livechats.updateOne({ sessionId }, {
            $push: { messages: { role: 'user', content: message, timestamp: new Date() } },
            $inc: { messageCount: 1 },
            $set: { updatedAt: new Date() }
          });
          ns.to(`watching-${sessionId}`).emit('session:new-message', { role: 'user', content: message, timestamp: new Date() });
          return; // no AI reply
        }

        socket.emit('typing', true);

        const history = (session.messages || []).slice(-10).map(msg => {
          if (msg.role === 'admin') return { role: 'user', content: `[Human Agent]: ${msg.content}` };
          return { role: msg.role === 'assistant' ? 'assistant' : 'user', content: msg.content };
        });

        // Merge known identity: cookie data from client takes precedence over session db
        const knownName  = visitor?.name  || session.visitorName  || null;
        const knownEmail = visitor?.email || session.visitorEmail || null;
        const knownPhone = visitor?.phone || session.visitorPhone || null;

        let visitorCtx = null;
        if (knownName || knownEmail || knownPhone) {
          const parts = [];
          if (knownName)  parts.push(`Visitor name: ${knownName}`);
          if (knownEmail) parts.push(`Visitor email: ${knownEmail}${visitor?.email ? ' (madLadsLab account holder)' : ''}`);
          if (knownPhone) parts.push(`Visitor phone: ${knownPhone}`);
          visitorCtx = `Known visitor info:\n${parts.join('\n')}\nUse their name naturally when appropriate.`;
        }

        // Inject lead capture instructions only for fields not yet collected
        const needsEmail = !knownEmail;
        const needsPhone = !knownPhone;
        const leadInstructions = (needsEmail || needsPhone) ? LEAD_CAPTURE_INSTRUCTIONS : null;

        const messages = [
          { role: 'system', content: agent.config.systemPrompt },
          ...(visitorCtx      ? [{ role: 'system', content: visitorCtx }]       : []),
          ...(leadInstructions ? [{ role: 'system', content: leadInstructions }] : []),
          ...history,
          { role: 'user', content: message }
        ];

        const ollamaBaseUrl = process.env.OLLAMA_BASE_URL || 'https://ollama.madladslab.com';
        const ollamaApiKey  = process.env.OLLAMA_API_KEY;

        const ollamaRes = await axios.post(`${ollamaBaseUrl}/v1/chat/completions`, {
          model: agent.model,
          messages,
          temperature: agent.config.temperature || 0.7,
          max_tokens: 300,
          stream: false
        }, {
          headers: { 'Authorization': `Bearer ${ollamaApiKey}`, 'Content-Type': 'application/json' },
          timeout: 30_000
        });

        let reply = ollamaRes.data.choices?.[0]?.message?.content?.trim() || '';

        // Extract all lead markers
        const nameResult  = extractMarker(reply, 'NAME');
        if (nameResult.value) reply = nameResult.cleaned;

        const emailResult = extractMarker(reply, 'EMAIL');
        if (emailResult.value) reply = emailResult.cleaned;

        const phoneResult = extractMarker(reply, 'PHONE');
        if (phoneResult.value) reply = phoneResult.cleaned;

        // Build captured lead data
        const capturedName  = nameResult.value  || null;
        const capturedEmail = emailResult.value || null;
        const capturedPhone = phoneResult.value || null;

        // Persist to session
        const setOps = { updatedAt: new Date() };
        if (capturedName)  setOps.visitorName  = capturedName;
        if (capturedEmail) setOps.visitorEmail = capturedEmail;
        if (capturedPhone) setOps.visitorPhone = capturedPhone;

        await livechats.updateOne({ sessionId }, {
          $push: {
            messages: {
              $each: [
                { role: 'user',      content: message, timestamp: new Date() },
                { role: 'assistant', content: reply,   timestamp: new Date() }
              ]
            }
          },
          $inc: { messageCount: 1 },
          $set: setOps
        });

        // Fire lead alerts when contact info first captured
        const isNewLead = capturedEmail || capturedPhone;
        if (isNewLead) {
          const freshSession = await livechats.findOne({ sessionId });
          const lead = {
            sessionId,
            name:  capturedName  || freshSession.visitorName  || null,
            email: capturedEmail || freshSession.visitorEmail || null,
            phone: capturedPhone || freshSession.visitorPhone || null,
          };
          sendLeadEmail(lead).catch(() => {});
          sendVisitorConfirmationEmail(lead, agent.name).catch(() => {});
          writeAlert('lead_captured', { sessionId, ...lead, ip });
          fireLeadWebhook(session, lead).catch(() => {});
        }

        socket.emit('typing', false);
        socket.emit('response', { message: reply });

        // Stream new messages to any admin watching this session
        const ts = new Date();
        ns.to(`watching-${sessionId}`).emit('session:new-message', { role: 'user',      content: message, timestamp: ts });
        ns.to(`watching-${sessionId}`).emit('session:new-message', { role: 'assistant', content: reply,   timestamp: ts });

        // Emit captured lead data so client can write cookies
        const captured = {};
        if (capturedName)  captured.name  = capturedName;
        if (capturedEmail) captured.email = capturedEmail;
        if (capturedPhone) captured.phone = capturedPhone;
        if (Object.keys(captured).length > 0) {
          socket.emit('lead:captured', captured);
        }

      } catch (err) {
        console.error('[Pepe socket] error:', err.message);
        socket.emit('typing', false);
        socket.emit('error', { error: 'Something went wrong. Please try again or call us at (682) 241-4402.' });
      }
    });

    socket.on('disconnect', () => {});
  });

  return ns;
}
