import express from 'express';
import { ObjectId } from 'mongodb';
import { getDb } from '../plugins/mongo.js';

const router = express.Router();

// 1x1 transparent GIF (43 bytes)
const PIXEL = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64');

/** Encode tracking data to a URL-safe token */
export function encodeTrackingToken(obj) {
  return Buffer.from(JSON.stringify(obj)).toString('base64url');
}

/** Decode a tracking token back to an object */
export function decodeTrackingToken(str) {
  return JSON.parse(Buffer.from(str, 'base64url').toString());
}

// ── Open tracking pixel ──
router.get('/o/:token', async (req, res) => {
  // Respond immediately with pixel
  res.set({ 'Content-Type': 'image/gif', 'Cache-Control': 'no-store, no-cache', 'Pragma': 'no-cache' });
  res.end(PIXEL);

  // Record event in background
  try {
    const data = decodeTrackingToken(req.params.token);
    const db = getDb();
    db.collection('w2_campaign_events').insertOne({
      campaignId: new ObjectId(data.c),
      contactId: new ObjectId(data.r),
      type: 'open',
      ip: req.ip,
      userAgent: req.get('user-agent') || null,
      createdAt: new Date(),
    }).catch(() => {});
  } catch {}
});

// ── Click redirect ──
router.get('/c/:token', async (req, res) => {
  try {
    const data = decodeTrackingToken(req.params.token);
    const url = data.u;

    // Record click in background
    const db = getDb();
    db.collection('w2_campaign_events').insertOne({
      campaignId: new ObjectId(data.c),
      contactId: new ObjectId(data.r),
      type: 'click',
      url,
      ip: req.ip,
      userAgent: req.get('user-agent') || null,
      createdAt: new Date(),
    }).catch(() => {});

    res.redirect(302, url || 'https://w2marketing.biz');
  } catch {
    res.redirect(302, 'https://w2marketing.biz');
  }
});

// ── Unsubscribe page ──
router.get('/unsubscribe', async (req, res) => {
  const email = req.query.email;
  const done = req.query.done === '1';
  res.send(`<!DOCTYPE html>
<html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>Unsubscribe — W2 Marketing</title>
<link href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:wght@300;400;600&family=Jost:wght@300;400;500&display=swap" rel="stylesheet">
<style>*{margin:0;padding:0;box-sizing:border-box}body{font-family:'Jost',sans-serif;background:#F5F3EF;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:24px}.card{background:#FDFCFA;max-width:460px;width:100%;border-radius:6px;overflow:hidden;box-shadow:0 2px 20px rgba(0,0,0,.07)}.header{background:#1C2B4A;padding:24px 28px;text-align:center}.brand{font-family:'Cormorant Garamond',serif;font-size:20px;color:#FDFCFA}.bar{height:3px;background:#C9A848}.body{padding:32px;text-align:center}h1{font-family:'Cormorant Garamond',serif;font-size:24px;font-weight:300;margin-bottom:12px}p{font-size:14px;color:#6B7380;line-height:1.6;margin-bottom:20px}input[type=email]{width:100%;padding:10px 14px;border:1px solid #E6E1D6;border-radius:2px;font-family:'Jost',sans-serif;font-size:14px;margin-bottom:12px}.btn{display:inline-block;padding:12px 28px;background:#1C2B4A;color:#FDFCFA;border:none;font-family:'Jost',sans-serif;font-size:14px;font-weight:500;border-radius:3px;cursor:pointer;letter-spacing:.5px}.btn:hover{background:#2E4270}.footer{background:#F5F3EF;padding:16px;text-align:center;font-size:12px;color:#6B7380}.ok{color:#15803D;font-size:18px;margin-bottom:8px}</style></head>
<body><div class="card"><div class="header"><div class="brand">W2 Marketing</div></div><div class="bar"></div>
<div class="body">
${done ? `<div class="ok">Unsubscribed</div><h1>You've been removed</h1><p>You will no longer receive marketing emails from W2 Marketing. If this was a mistake, contact us anytime.</p>` :
`<h1>Unsubscribe</h1><p>We're sorry to see you go. Enter your email below to unsubscribe from our marketing emails.</p>
<form method="POST" action="/t/unsubscribe"><input type="email" name="email" value="${email || ''}" required placeholder="your@email.com"><br><button type="submit" class="btn">Unsubscribe</button></form>`}
</div><div class="footer">W2 Marketing &middot; Greeley, CO</div></div></body></html>`);
});

// ── Unsubscribe POST handler ──
router.post('/unsubscribe', async (req, res) => {
  try {
    const email = (req.body.email || '').toLowerCase().trim();
    if (!email) return res.redirect('/t/unsubscribe');

    const db = getDb();
    const result = await db.collection('w2_contacts').updateOne(
      { email },
      { $set: { status: 'unsubscribed', updatedAt: new Date() } }
    );

    // Also log as event if we can find the contact
    if (result.matchedCount) {
      const contact = await db.collection('w2_contacts').findOne({ email });
      if (contact) {
        await db.collection('w2_campaign_events').insertOne({
          contactId: contact._id,
          type: 'unsubscribe',
          email,
          ip: req.ip,
          createdAt: new Date(),
        }).catch(() => {});
      }
    }

    console.log(`[Email Marketing] Unsubscribe: ${email} (${result.matchedCount ? 'found' : 'not found'})`);
    res.redirect('/t/unsubscribe?done=1&email=' + encodeURIComponent(email));
  } catch (err) {
    console.error('Unsubscribe error:', err);
    res.redirect('/t/unsubscribe?done=1');
  }
});

// ── Bounce webhook (generic — works with Zoho or any ESP that can POST) ──
router.post('/webhook/bounce', async (req, res) => {
  try {
    const db = getDb();
    const email = (req.body.email || req.body.recipient || '').toLowerCase().trim();
    const bounceType = req.body.type || req.body.bounce_type || 'hard';

    if (email) {
      await db.collection('w2_contacts').updateOne(
        { email },
        { $set: { status: 'bounced', bounceType, bouncedAt: new Date(), updatedAt: new Date() } }
      );

      const contact = await db.collection('w2_contacts').findOne({ email });
      if (contact) {
        await db.collection('w2_campaign_events').insertOne({
          contactId: contact._id,
          type: 'bounce',
          email,
          bounceType,
          raw: req.body,
          createdAt: new Date(),
        }).catch(() => {});
      }

      console.log(`[Email Marketing] Bounce: ${email} (${bounceType})`);
    }

    res.status(200).json({ received: true });
  } catch (err) {
    console.error('Bounce webhook error:', err);
    res.status(200).json({ received: true });
  }
});

// ── Complaint/spam webhook ──
router.post('/webhook/complaint', async (req, res) => {
  try {
    const db = getDb();
    const email = (req.body.email || req.body.recipient || '').toLowerCase().trim();

    if (email) {
      await db.collection('w2_contacts').updateOne(
        { email },
        { $set: { status: 'unsubscribed', unsubReason: 'complaint', updatedAt: new Date() } }
      );

      const contact = await db.collection('w2_contacts').findOne({ email });
      if (contact) {
        await db.collection('w2_campaign_events').insertOne({
          contactId: contact._id,
          type: 'complaint',
          email,
          raw: req.body,
          createdAt: new Date(),
        }).catch(() => {});
      }

      console.log(`[Email Marketing] Spam complaint: ${email}`);
    }

    res.status(200).json({ received: true });
  } catch (err) {
    console.error('Complaint webhook error:', err);
    res.status(200).json({ received: true });
  }
});

// ── Inbound email webhook (captures client replies) ──
// Zoho / any ESP can POST here when a reply comes in
router.post('/webhook/inbound', async (req, res) => {
  try {
    const db = getDb();
    const from = (req.body.from || req.body.sender || req.body.from_email || '').toLowerCase().trim();
    const to = req.body.to || req.body.recipient || '';
    const subject = req.body.subject || '(no subject)';
    const body = req.body.body || req.body.text || req.body.html || req.body['body-html'] || req.body['body-plain'] || '';

    if (!from) return res.status(200).json({ received: true, note: 'no from address' });

    // Match to a client by email
    const client = await db.collection('w2_clients').findOne({ email: from });
    const clientId = client ? client._id.toString() : null;

    await db.collection('w2_client_emails').insertOne({
      clientId,
      direction: 'inbound',
      from,
      to,
      cc: req.body.cc ? (typeof req.body.cc === 'string' ? req.body.cc.split(',').map(e => e.trim()) : req.body.cc) : [],
      subject,
      body,
      receivedAt: new Date(),
      sentAt: new Date(),
      raw: req.body,
    });

    console.log(`[Email] Inbound from ${from}${client ? ' (client: ' + client.name + ')' : ' (unmatched)'}`);
    res.status(200).json({ received: true, matched: !!client });
  } catch (err) {
    console.error('Inbound email webhook error:', err);
    res.status(200).json({ received: true });
  }
});

export default router;
