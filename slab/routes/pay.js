import express from 'express';
import { ObjectId } from 'mongodb';
import { getDb } from '../plugins/mongo.js';
import { createCheckoutSession } from '../plugins/stripe.js';
import { createOrder, captureOrder } from '../plugins/paypal.js';
import { config } from '../config/config.js';

const router = express.Router();

/** Lookup invoice by payment token — shared helper */
async function findPayableInvoice(req, token) {
  const db = req.db;
  const invoice = await db.collection('invoices').findOne({ paymentToken: token });
  if (!invoice) return { invoice: null, clientDoc: null, error: 'not_found' };
  const clientDoc = await db.collection('clients').findOne({ _id: new ObjectId(invoice.clientId) });
  if (['paid', 'void'].includes(invoice.status)) return { invoice, clientDoc, error: 'already_paid' };
  return { invoice, clientDoc, error: null };
}

// ── Public invoice payment page ──
router.get('/:token', async (req, res) => {
  try {
    const { invoice, clientDoc, error } = await findPayableInvoice(req, req.params.token);
    if (error === 'not_found') return res.status(404).render('pay-error', { message: 'Invoice not found or link has expired.' });
    res.render('pay', {
      inv: invoice,
      cl: clientDoc,
      paid: error === 'already_paid',
      stripeKey: req.tenant?.public?.stripePublishable || null,
      paypalId: req.tenant?.public?.paypalClientId || null,
      domain: req.tenant?.domain ? 'https://' + req.tenant.domain : config.DOMAIN,
    });
  } catch (err) {
    console.error('Pay page error:', err);
    res.status(500).render('pay-error', { message: 'Something went wrong. Please try again.' });
  }
});

// ── Stripe Checkout ──
router.post('/:token/stripe', async (req, res) => {
  try {
    const { invoice, clientDoc, error } = await findPayableInvoice(req, req.params.token);
    if (error) return res.status(400).render('pay-error', { message: 'This invoice cannot be paid.' });
    const domain = req.tenant?.domain ? `https://${req.tenant.domain}` : config.DOMAIN;
    const session = await createCheckoutSession(
      invoice,
      clientDoc,
      `${domain}/pay/${req.params.token}/success?provider=stripe&session_id={CHECKOUT_SESSION_ID}`,
      `${domain}/pay/${req.params.token}?cancelled=1`,
      req.tenant
    );
    res.redirect(303, session.url);
  } catch (err) {
    console.error('Stripe checkout error:', err);
    res.status(500).render('pay-error', { message: 'Payment setup failed. Please try again.' });
  }
});

// ── PayPal Checkout ──
router.post('/:token/paypal', async (req, res) => {
  try {
    const { invoice, clientDoc, error } = await findPayableInvoice(req, req.params.token);
    if (error) return res.status(400).render('pay-error', { message: 'This invoice cannot be paid.' });
    const domain = req.tenant?.domain ? `https://${req.tenant.domain}` : config.DOMAIN;
    const order = await createOrder(
      invoice,
      clientDoc,
      `${domain}/pay/${req.params.token}/success?provider=paypal`,
      `${domain}/pay/${req.params.token}?cancelled=1`,
      req.tenant?.brand?.name,
      req.tenant
    );
    // Find the approval link
    const approveLink = order.links?.find(l => l.rel === 'payer-action' || l.rel === 'approve');
    if (!approveLink) throw new Error('No PayPal approval link returned');
    res.redirect(303, approveLink.href);
  } catch (err) {
    console.error('PayPal checkout error:', err);
    res.status(500).render('pay-error', { message: 'Payment setup failed. Please try again.' });
  }
});

// ── Success page ──
router.get('/:token/success', async (req, res) => {
  try {
    const db = req.db;
    const invoice = await db.collection('invoices').findOne({ paymentToken: req.params.token });
    if (!invoice) return res.status(404).render('pay-error', { message: 'Invoice not found.' });
    const clientDoc = await db.collection('clients').findOne({ _id: new ObjectId(invoice.clientId) });

    // If PayPal — capture the order now
    if (req.query.provider === 'paypal' && req.query.token) {
      try {
        const capture = await captureOrder(req.query.token, req.tenant);
        const captureId = capture.purchase_units?.[0]?.payments?.captures?.[0]?.id || req.query.token;
        // Record payment (idempotent)
        const alreadyRecorded = invoice.payments?.some(p => p.transactionId === captureId);
        if (!alreadyRecorded) {
          await db.collection('invoices').updateOne(
            { _id: invoice._id },
            {
              $set: { status: 'paid', updatedAt: new Date() },
              $push: { payments: { provider: 'paypal', transactionId: captureId, amount: invoice.amount, paidAt: new Date() } },
            }
          );
        }
      } catch (captureErr) {
        console.error('PayPal capture error:', captureErr);
      }
    }

    // For Stripe — the webhook handles marking paid, but we can verify here too
    if (req.query.provider === 'stripe' && req.query.session_id) {
      try {
        const { getStripe } = await import('../plugins/stripe.js');
        const stripe = getStripe(req.tenant);
        if (stripe) {
          const session = await stripe.checkout.sessions.retrieve(req.query.session_id);
          if (session.payment_status === 'paid') {
            const alreadyRecorded = invoice.payments?.some(p => p.transactionId === session.id);
            if (!alreadyRecorded) {
              await db.collection('invoices').updateOne(
                { _id: invoice._id },
                {
                  $set: { status: 'paid', updatedAt: new Date() },
                  $push: { payments: { provider: 'stripe', transactionId: session.id, amount: invoice.amount, paidAt: new Date() } },
                }
              );
            }
          }
        }
      } catch (stripeErr) {
        console.error('Stripe verify error:', stripeErr);
      }
    }

    res.render('pay-success', { inv: invoice, cl: clientDoc });
  } catch (err) {
    console.error('Success page error:', err);
    res.status(500).render('pay-error', { message: 'Something went wrong.' });
  }
});

export default router;
