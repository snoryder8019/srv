import express from 'express';
import { ObjectId } from 'mongodb';
import { getDb } from '../plugins/mongo.js';
import { getStripe } from '../plugins/stripe.js';
import { recordPaymentAndReceipt } from '../plugins/paymentReceipts.js';
import { config } from '../config/config.js';
// ── DISABLED FOR RELEASE: Social Activity (Meta webhook ingestion) ───────────
// import { META_VERIFY_TOKEN, verifyMetaSignature, handleMetaEvent } from '../plugins/socialActivity.js';

const router = express.Router();

// ── Stripe Webhook ──
// NOTE: This route receives raw body (express.raw applied in app.js before express.json)
router.post('/stripe', async (req, res) => {
  const stripe = getStripe(req.tenant);
  if (!stripe) return res.status(400).send('Stripe not configured');

  const sig = req.headers['stripe-signature'];
  const webhookSecret = req.tenant?.secrets?.stripeWebhookSecret;
  let event;

  try {
    event = stripe.webhooks.constructEvent(req.body, sig, webhookSecret);
  } catch (err) {
    console.error('Stripe webhook signature failed:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    const invoiceId = session.metadata?.invoiceId;
    if (invoiceId) {
      try {
        const db = req.db;
        const invoice = await db.collection('invoices').findOne({ _id: new ObjectId(invoiceId) });
        if (invoice) {
          const recorded = await recordPaymentAndReceipt(db, invoice, {
            provider: 'stripe',
            transactionId: session.id,
            amount: (session.amount_total || 0) / 100,
            paidAt: new Date(),
            raw: { paymentIntent: session.payment_intent, customerEmail: session.customer_email },
          }, req.tenant);
          if (recorded) console.log(`[Stripe] Invoice ${invoice.invoiceNumber} marked paid + receipt sent via webhook`);
        }
      } catch (dbErr) {
        console.error('Stripe webhook DB error:', dbErr);
      }
    }
  }

  res.json({ received: true });
});

// ── PayPal Webhook ──
router.post('/paypal', async (req, res) => {
  const event = req.body;
  const eventType = event?.event_type;

  if (eventType === 'CHECKOUT.ORDER.APPROVED' || eventType === 'PAYMENT.CAPTURE.COMPLETED') {
    try {
      const db = req.db;
      const resource = event.resource || {};
      // Extract invoice ID from custom_id in purchase units
      const customId = resource.purchase_units?.[0]?.custom_id
        || resource.supplementary_data?.related_ids?.order_id;

      if (customId) {
        const invoice = await db.collection('invoices').findOne({ _id: new ObjectId(customId) });
        if (invoice) {
          const txnId = resource.id || event.id;
          const recorded = await recordPaymentAndReceipt(db, invoice, {
            provider: 'paypal',
            transactionId: txnId,
            amount: parseFloat(resource.amount?.value || invoice.amount),
            paidAt: new Date(),
          }, req.tenant);
          if (recorded) console.log(`[PayPal] Invoice ${invoice.invoiceNumber} marked paid + receipt sent via webhook`);
        }
      }
    } catch (err) {
      console.error('PayPal webhook error:', err);
    }
  }

  res.status(200).send('OK');
});


/* ── DISABLED FOR RELEASE: Meta (Facebook/Instagram) Activity Webhooks ─────────
// ── Meta (Facebook/Instagram) Webhooks — comments, mentions, messages, leadgen ──
// GET verifies the subscription; POST receives events (raw body for signature).
router.get('/meta', (req, res) => {
  if (req.query['hub.mode'] === 'subscribe' && req.query['hub.verify_token'] === META_VERIFY_TOKEN) {
    return res.status(200).send(req.query['hub.challenge']);
  }
  return res.sendStatus(403);
});

router.post('/meta', async (req, res) => {
  try {
    const raw = Buffer.isBuffer(req.body) ? req.body : Buffer.from(JSON.stringify(req.body || {}));
    if (!verifyMetaSignature(raw, req.headers['x-hub-signature-256'])) return res.sendStatus(403);
        res.sendStatus(200); // ack fast, then process
    const body = JSON.parse(raw.toString('utf8') || '{}');
    handleMetaEvent(body).catch(e => console.error('[meta webhook] process:', e.message));
  } catch (e) {
    console.error('[meta webhook]', e.message);
    try { res.sendStatus(200); } catch {}
  }
});
──────────────────────────────────────────────────────────────────────────── */

export default router;
