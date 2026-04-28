// Checkout — creates a `purchases` doc and kicks off PayPal (or Stripe) flow.
import express from 'express';
import { ObjectId } from 'mongodb';
import { getDb } from '../plugins/mongo.js';
import { createOrder as paypalCreateOrder, captureOrder as paypalCaptureOrder } from '../plugins/paypal.js';
import { createCheckoutSession as stripeCreate } from '../plugins/stripe.js';
import { issueLifetimeLicense } from '../plugins/licenseService.js';
import { sendLicenseEmail } from '../plugins/mailer.js';
import { config } from '../config/config.js';

const router = express.Router();

// ── PayPal ──────────────────────────────────────────────────────────────────
router.post('/paypal/create', async (req, res, next) => {
  try {
    if (!config.paypalEnabled()) return res.status(503).json({ error: 'paypal_disabled' });
    const email = req.user?.email || (req.body.email || '').trim().toLowerCase();
    if (!email) return res.status(400).json({ error: 'email_required' });

    const purchases = getDb().collection('purchases');
    const purchaseDoc = {
      product: 'mediahasher',
      userId: req.user?._id || null,
      email,
      processor: 'paypal',
      amount: config.PRODUCT_PRICE_CENTS,
      currency: 'usd',
      status: 'pending',
      createdAt: new Date(),
    };
    const r = await purchases.insertOne(purchaseDoc);
    const purchaseId = r.insertedId.toString();

    const order = await paypalCreateOrder({
      referenceId: purchaseId,
      amountCents: config.PRODUCT_PRICE_CENTS,
      returnUrl: `${config.DOMAIN}/checkout/paypal/return?purchaseId=${purchaseId}`,
      cancelUrl: `${config.DOMAIN}/pricing?cancelled=1`,
    });

    await purchases.updateOne(
      { _id: r.insertedId },
      { $set: { paypalOrderId: order.id } }
    );

    const approve = (order.links || []).find(l => l.rel === 'approve' || l.rel === 'payer-action');
    res.json({ ok: true, orderId: order.id, approveUrl: approve?.href, purchaseId });
  } catch (err) {
    next(err);
  }
});

router.get('/paypal/return', async (req, res, next) => {
  try {
    const { purchaseId, token } = req.query; // token = order id from PayPal redirect
    const orderId = token;
    if (!purchaseId || !orderId) return res.redirect('/pricing?error=paypal');

    const purchases = getDb().collection('purchases');
    const purchase = await purchases.findOne({ _id: new ObjectId(purchaseId) });
    if (!purchase) return res.redirect('/pricing?error=notfound');
    if (purchase.status === 'paid') return res.redirect('/account?welcome=1');

    const captured = await paypalCaptureOrder(orderId);
    const captureId = captured?.purchase_units?.[0]?.payments?.captures?.[0]?.id || null;
    const status = captured?.status === 'COMPLETED' ? 'paid' : 'failed';

    await purchases.updateOne(
      { _id: purchase._id },
      { $set: { status, paypalCaptureId: captureId, capturedAt: new Date(), raw: captured } }
    );

    if (status !== 'paid') return res.redirect('/pricing?error=capture');

    const license = await issueLifetimeLicense({
      userId: purchase.userId,
      email: purchase.email,
      purchaseId: purchase._id,
    });

    try {
      await sendLicenseEmail({
        to: purchase.email,
        displayName: req.user?.displayName,
        licenseKey: license.key,
        type: 'lifetime',
      });
    } catch (e) {
      console.error('[checkout] license email failed:', e.message);
    }

    res.redirect('/account?welcome=1');
  } catch (err) {
    next(err);
  }
});

// ── Stripe (optional) ───────────────────────────────────────────────────────
router.post('/stripe/create', async (req, res, next) => {
  try {
    if (!config.stripeEnabled()) return res.status(503).json({ error: 'stripe_disabled' });
    const email = req.user?.email || (req.body.email || '').trim().toLowerCase();
    if (!email) return res.status(400).json({ error: 'email_required' });

    const purchases = getDb().collection('purchases');
    const r = await purchases.insertOne({
      product: 'mediahasher',
      userId: req.user?._id || null,
      email,
      processor: 'stripe',
      amount: config.PRODUCT_PRICE_CENTS,
      currency: 'usd',
      status: 'pending',
      createdAt: new Date(),
    });

    const session = await stripeCreate({
      purchaseId: r.insertedId,
      amountCents: config.PRODUCT_PRICE_CENTS,
      customerEmail: email,
      successUrl: `${config.DOMAIN}/account?welcome=1`,
      cancelUrl: `${config.DOMAIN}/pricing?cancelled=1`,
    });

    await purchases.updateOne(
      { _id: r.insertedId },
      { $set: { stripeSessionId: session.id } }
    );

    res.json({ ok: true, url: session.url });
  } catch (err) {
    next(err);
  }
});

export default router;
