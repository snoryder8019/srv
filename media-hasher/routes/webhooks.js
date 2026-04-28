// Stripe webhook — only mounted/used if stripe is configured.
// Note: app.js mounts express.raw() for /webhooks/stripe so signature verification works.
import express from 'express';
import { ObjectId } from 'mongodb';
import { getDb } from '../plugins/mongo.js';
import { getStripe } from '../plugins/stripe.js';
import { issueLifetimeLicense } from '../plugins/licenseService.js';
import { sendLicenseEmail } from '../plugins/mailer.js';
import { config } from '../config/config.js';

const router = express.Router();

router.post('/stripe', async (req, res) => {
  if (!config.stripeEnabled()) return res.status(503).json({ error: 'stripe_disabled' });
  const stripe = await getStripe();
  const sig = req.headers['stripe-signature'];

  let event;
  try {
    event = stripe.webhooks.constructEvent(req.body, sig, config.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error('[stripe] signature verification failed:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  try {
    if (event.type === 'checkout.session.completed') {
      const session = event.data.object;
      const purchaseId = session.metadata?.purchaseId || session.client_reference_id;
      if (!purchaseId) return res.json({ received: true, note: 'no purchaseId' });

      const purchases = getDb().collection('purchases');
      const purchase = await purchases.findOne({ _id: new ObjectId(purchaseId) });
      if (!purchase || purchase.status === 'paid') return res.json({ received: true });

      await purchases.updateOne(
        { _id: purchase._id },
        { $set: {
            status: 'paid',
            stripePaymentIntent: session.payment_intent,
            capturedAt: new Date(),
          },
        }
      );

      const license = await issueLifetimeLicense({
        userId: purchase.userId,
        email: purchase.email,
        purchaseId: purchase._id,
      });

      try {
        await sendLicenseEmail({
          to: purchase.email,
          licenseKey: license.key,
          type: 'lifetime',
        });
      } catch (e) {
        console.error('[stripe-webhook] license email failed:', e.message);
      }
    }
  } catch (err) {
    console.error('[stripe-webhook] handler error:', err);
    return res.status(500).json({ error: err.message });
  }

  res.json({ received: true });
});

export default router;
