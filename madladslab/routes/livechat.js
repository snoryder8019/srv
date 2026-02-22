import express from 'express';
import Anthropic from '@anthropic-ai/sdk';
import { getDb } from '../plugins/mongo/mongo.js';
import nodemailer from 'nodemailer';
import rateLimit from 'express-rate-limit';

const router = express.Router();

// Rate limiter: 60 requests per hour per IP
const limiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 60,
  message: { error: 'Too many messages. Please try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
});

// Initialize Anthropic client
const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

// Pepe's system prompt
const PEPE_PROMPT = `You are Pepe, a friendly and professional chat representative for madLadsLab. You help visitors learn about our luxury AI assistant and smart home integration services. Be warm, conversational, and helpful. You do NOT have access to any tools, files, or systems. You can only chat. Tone: sophisticated but approachable, NOT techy jargon. Keep responses to 1-3 sentences MAX. Be direct. No filler. No long lists unless specifically asked. If they want details, give them one at a time — don't dump everything.

SERVICE PACKAGES YOU CAN DISCUSS:

1. AI MESSAGING ASSISTANT — $1,000 one-time setup
   WhatsApp and/or Telegram AI assistant. Custom personality, persistent memory, calendar integration. 30 days post-setup support.

2. FULL SMART HOME INTEGRATION — Starting at $6,000
   Complete deployment: consultation, hardware, wiring, outlet service, AI voice control, device orchestration, custom automations, monitoring dashboard. Equipment and wiring costs additional based on home size. NATIONWIDE SERVICE — we come to you. 60 days support.

3. GENERAL TECHNOLOGY ASSISTANCE — $75/hour
   On-site (Northern Colorado) or remote. Network setup, device config, troubleshooting, training. No minimum hours.

4. REMOTE AI ASSISTANT DEPLOYMENT — Starting at $2,500
   Full AI assistant configured remotely. Multi-channel (WhatsApp, Telegram, voice, web), email/calendar integration, smart home control, persistent memory. Managed or self-hosted.

5. CUSTOM WEB APPLICATION & DASHBOARD — Starting at $4,000
   Custom-built web app or admin dashboard. Real-time analytics, role-based access, API integrations, AI-powered insights, mobile-responsive. 60 days support.

6. BUSINESS PROCESS AUTOMATION — Starting at $3,000
   Workflow automation: data entry, reporting, client communication, scheduling, invoicing. Process audit, custom workflows, staff training. 30 days support.

7. ONGOING SUPPORT & MANAGEMENT — Starting at $500/month
   24/7 monitoring, priority support, monthly health reports, updates, AI tuning, up to 5 hours custom work/month, quarterly strategy review.

POLICIES:
- Free initial consultation — no commitment
- All project pricing is custom-quoted after consultation. Listed prices are starting points.
- 50% deposit to begin, balance on completion. Monthly retainers billed monthly.
- Guarantee: If it doesn't work as promised, we fix it — no additional charge.

RULES:
- You CAN share the prices listed above — they are approved public pricing.
- For anything outside these packages, say "that would be custom-quoted after a consultation."
- If someone wants to schedule a consultation or sign up, collect their name, email or phone, and what they're interested in. Tell them the team will reach out within 24 hours.
- Never invent services or pricing not listed above.
- Be enthusiastic but not pushy. Let the services sell themselves.
- If asked about competitors, stay positive — focus on what makes madLadsLab different (privacy, customization, white-glove service).`;

// Helper: Get or create chat session
async function getChatSession(sessionId, ip) {
  const db = getDb();
  const collection = db.collection('livechats');
  
  let session = await collection.findOne({ sessionId });
  
  if (!session) {
    session = {
      sessionId,
      ip,
      messages: [],
      createdAt: new Date(),
      updatedAt: new Date(),
      messageCount: 0,
      notificationSent: false,
    };
    await collection.insertOne(session);
  }
  
  return session;
}

// Helper: Send notification email
async function sendNotificationEmail(sessionId, firstMessage, ip) {
  try {
    const transporter = nodemailer.createTransport({
      host: 'smtp.zoho.com',
      port: 465,
      secure: true,
      auth: {
        user: process.env.ZOHO_USER,
        pass: process.env.ZOHO_PASS,
      },
    });

    const mailOptions = {
      from: process.env.ZOHO_USER,
      to: process.env.GMAIL_USER || 'scott@madladslab.com',
      subject: '💬 New Live Chat Visitor on madLadsLab',
      html: `
        <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; background: #111; color: #fff; border-radius: 12px;">
          <h2 style="color: #fff; margin-top: 0;">New Visitor Chat</h2>
          <p style="color: rgba(255,255,255,0.7); font-size: 14px;">A visitor just started a live chat on madladslab.com</p>
          
          <div style="background: rgba(255,255,255,0.05); padding: 15px; border-radius: 8px; margin: 20px 0; border-left: 3px solid rgba(255,255,255,0.3);">
            <p style="margin: 0; color: rgba(255,255,255,0.9); font-size: 15px;"><strong>First Message:</strong></p>
            <p style="margin: 10px 0 0; color: rgba(255,255,255,0.7); font-size: 14px; line-height: 1.5;">${firstMessage}</p>
          </div>
          
          <div style="background: rgba(255,255,255,0.03); padding: 12px; border-radius: 6px; margin: 15px 0;">
            <p style="margin: 5px 0; color: rgba(255,255,255,0.5); font-size: 13px;"><strong>Session ID:</strong> ${sessionId}</p>
            <p style="margin: 5px 0; color: rgba(255,255,255,0.5); font-size: 13px;"><strong>IP:</strong> ${ip}</p>
            <p style="margin: 5px 0; color: rgba(255,255,255,0.5); font-size: 13px;"><strong>Time:</strong> ${new Date().toLocaleString()}</p>
          </div>
          
          <p style="color: rgba(255,255,255,0.4); font-size: 12px; margin-top: 20px;">Pepe is currently handling the conversation. You can view the full chat history in the database.</p>
        </div>
      `,
    };

    await transporter.sendMail(mailOptions);
    console.log('✅ Notification email sent to scott@madladslab.com');
  } catch (error) {
    console.error('❌ Error sending notification email:', error);
  }
}

// Helper: Send WhatsApp notification via file signal for OpenClaw
import fs from 'fs';
import path from 'path';
const NOTIFICATION_DIR = '/root/.openclaw/workspace/livechat-alerts';

async function sendWhatsAppNotification(sessionId, firstMessage, ip) {
  try {
    if (!fs.existsSync(NOTIFICATION_DIR)) fs.mkdirSync(NOTIFICATION_DIR, { recursive: true });
    const alertFile = path.join(NOTIFICATION_DIR, `${Date.now()}-${sessionId.substring(0,8)}.json`);
    fs.writeFileSync(alertFile, JSON.stringify({
      type: 'new_chat',
      sessionId,
      firstMessage: firstMessage.substring(0, 300),
      ip,
      timestamp: new Date().toISOString()
    }));
    console.log('✅ WhatsApp alert file written');
  } catch (error) {
    console.error('❌ WhatsApp alert file failed:', error.message);
  }
}

// POST /livechat/message
router.post('/message', limiter, async (req, res) => {
  try {
    const { message, sessionId } = req.body;

    if (!message || !sessionId) {
      return res.status(400).json({ error: 'Missing message or sessionId' });
    }

    // Get IP address
    const ip = req.ip || req.connection.remoteAddress;

    // Get or create session
    const session = await getChatSession(sessionId, ip);

    // Check per-session message limit (20 messages per session)
    if (session.messageCount >= 20) {
      return res.status(429).json({ 
        error: 'Session message limit reached. Please start a new conversation or contact us directly at (682) 241-4402.',
        limitReached: true 
      });
    }

    // Add user message to session
    const userMessage = { role: 'user', content: message, timestamp: new Date() };
    session.messages.push(userMessage);
    session.messageCount++;
    session.updatedAt = new Date();

    // Send notification email on first message
    if (!session.notificationSent) {
      sendNotificationEmail(sessionId, message, ip); // Fire and forget
      sendWhatsAppNotification(sessionId, message, ip); // Fire and forget
      session.notificationSent = true;
    }

    // Build conversation history for Anthropic
    // Admin messages are treated as user messages (human takeover) in the context
    const conversationHistory = session.messages.map(msg => {
      if (msg.role === 'assistant') {
        return { role: 'assistant', content: msg.content };
      } else if (msg.role === 'admin') {
        // Admin messages are prefixed so Pepe knows a human agent responded
        return { 
          role: 'user', 
          content: `[Human Agent Response]: ${msg.content}` 
        };
      } else {
        return { role: 'user', content: msg.content };
      }
    });

    // Call Anthropic API
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 200,
      system: PEPE_PROMPT,
      messages: conversationHistory,
    });

    const assistantMessage = response.content[0].text;

    // Add assistant response to session
    session.messages.push({ 
      role: 'assistant', 
      content: assistantMessage, 
      timestamp: new Date() 
    });
    session.updatedAt = new Date();

    // Update session in database
    const db = getDb();
    await db.collection('livechats').updateOne(
      { sessionId },
      { $set: session }
    );

    // Return response
    res.json({
      success: true,
      message: assistantMessage,
      messageCount: session.messageCount,
    });

  } catch (error) {
    console.error('❌ Error in /livechat/message:', error);
    res.status(500).json({ 
      error: 'Something went wrong. Please try again or call us at (682) 241-4402.' 
    });
  }
});

// GET /livechat/history (optional - for admin viewing)
router.get('/history/:sessionId', async (req, res) => {
  try {
    const { sessionId } = req.params;
    const db = getDb();
    const session = await db.collection('livechats').findOne({ sessionId });
    
    if (!session) {
      return res.status(404).json({ error: 'Session not found' });
    }
    
    res.json(session);
  } catch (error) {
    console.error('❌ Error fetching chat history:', error);
    res.status(500).json({ error: 'Failed to fetch chat history' });
  }
});

export default router;
