import express from 'express';
import { ObjectId } from 'mongodb';
import { getDb } from '../plugins/mongo.js';
import { getStripe } from '../plugins/stripe.js';
import { config } from '../config/config.js';

const router = express.Router();

// ── Stripe Webhook ──
// NOTE: This route receives raw body (express.raw applied in app.js before express.json)
router.post('/stripe', async (req, res) => {
  const stripe = getStripe();
  if (!stripe) return res.status(400).send('Stripe not configured');

  const sig = req.headers['stripe-signature'];
  let event;

  try {
    event = stripe.webhooks.constructEvent(req.body, sig, config.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error('Stripe webhook signature failed:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    const invoiceId = session.metadata?.invoiceId;
    if (invoiceId) {
      try {
        const db = getDb();
        const invoice = await db.collection('w2_invoices').findOne({ _id: new ObjectId(invoiceId) });
        if (invoice) {
          const alreadyRecorded = invoice.payments?.some(p => p.transactionId === session.id);
          if (!alreadyRecorded) {
            await db.collection('w2_invoices').updateOne(
              { _id: invoice._id },
              {
                $set: { status: 'paid', updatedAt: new Date() },
                $push: {
                  payments: {
                    provider: 'stripe',
                    transactionId: session.id,
                    amount: (session.amount_total || 0) / 100,
                    paidAt: new Date(),
                    raw: { paymentIntent: session.payment_intent, customerEmail: session.customer_email },
                  },
                },
              }
            );
            console.log(`[Stripe] Invoice ${invoice.invoiceNumber} marked paid via webhook`);
          }
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
      const db = getDb();
      const resource = event.resource || {};
      // Extract invoice ID from custom_id in purchase units
      const customId = resource.purchase_units?.[0]?.custom_id
        || resource.supplementary_data?.related_ids?.order_id;

      if (customId) {
        const invoice = await db.collection('w2_invoices').findOne({ _id: new ObjectId(customId) });
        if (invoice) {
          const txnId = resource.id || event.id;
          const alreadyRecorded = invoice.payments?.some(p => p.transactionId === txnId);
          if (!alreadyRecorded) {
            await db.collection('w2_invoices').updateOne(
              { _id: invoice._id },
              {
                $set: { status: 'paid', updatedAt: new Date() },
                $push: {
                  payments: {
                    provider: 'paypal',
                    transactionId: txnId,
                    amount: parseFloat(resource.amount?.value || invoice.amount),
                    paidAt: new Date(),
                  },
                },
              }
            );
            console.log(`[PayPal] Invoice ${invoice.invoiceNumber} marked paid via webhook`);
          }
        }
      }
    } catch (err) {
      console.error('PayPal webhook error:', err);
    }
  }

  res.status(200).send('OK');
});

export default router;
