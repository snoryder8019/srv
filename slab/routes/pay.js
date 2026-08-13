import express from 'express';
import { ObjectId } from 'mongodb';
import { getDb } from '../plugins/mongo.js';
import { createCheckoutSession } from '../plugins/stripe.js';
import { createOrder, captureOrder } from '../plugins/paypal.js';
import { recordPaymentAndReceipt } from '../plugins/paymentReceipts.js';
import { config } from '../config/config.js';
import { DESIGN_DEFAULTS } from './admin/design.js';
import { enrichDesignContrast } from '../plugins/colorContrast.js';

const router = express.Router();

/** Load tenant design settings with defaults + contrast vars */
async function loadDesign(db) {
  const design = { ...DESIGN_DEFAULTS };
  try {
    const rows = await db.collection('design').find({}).toArray();
    for (const r of rows) design[r.key] = r.value;
  } catch { /* use defaults */ }
  return enrichDesignContrast(design);
}

// Redirect wildcard-subdomain hits to the tenant's canonical custom domain.
// Lets already-sent invoice emails (which baked in the wildcard URL) land on
// the right host.
router.use((req, res, next) => {
  const canonical = req.tenant?.customDomain;
  if (canonical && req.hostname !== canonical) {
    return res.redirect(301, `https://${canonical}${req.originalUrl}`);
  }
  next();
});

// Inject design settings into all pay views
router.use(async (req, res, next) => {
  res.locals.design = await loadDesign(req.db);
  next();
});

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
    if (error === 'not_found') return res.status(404).render('pay-error', { message: res.locals.t('pay.err_not_found') });
    // Tenant-wide preference: which payment method(s) to offer. 'both' (default), 'stripe', or 'paypal'.
    const pref = req.tenant?.public?.paymentProvider || 'both';
    res.render('pay', {
      inv: invoice,
      cl: clientDoc,
      paid: error === 'already_paid',
      stripeKey: pref === 'paypal' ? null : (req.tenant?.public?.stripePublishable || null),
      paypalId: pref === 'stripe' ? null : (req.tenant?.public?.paypalClientId || null),
      domain: req.tenant?.domain ? 'https://' + req.tenant.domain : config.DOMAIN,
    });
  } catch (err) {
    console.error('Pay page error:', err);
    res.status(500).render('pay-error', { message: res.locals.t('booking.error_generic') });
  }
});

// ── Stripe Checkout ──
router.post('/:token/stripe', async (req, res) => {
  try {
    const { invoice, clientDoc, error } = await findPayableInvoice(req, req.params.token);
    if (error) return res.status(400).render('pay-error', { message: res.locals.t('pay.err_cannot_pay') });
    if ((req.tenant?.public?.paymentProvider || 'both') === 'paypal') {
      return res.status(400).render('pay-error', { message: res.locals.t('pay.err_card_disabled') });
    }
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
    res.status(500).render('pay-error', { message: res.locals.t('pay.err_setup_failed') });
  }
});

// ── PayPal Checkout ──
router.post('/:token/paypal', async (req, res) => {
  try {
    const { invoice, clientDoc, error } = await findPayableInvoice(req, req.params.token);
    if (error) return res.status(400).render('pay-error', { message: res.locals.t('pay.err_cannot_pay') });
    if ((req.tenant?.public?.paymentProvider || 'both') === 'stripe') {
      return res.status(400).render('pay-error', { message: res.locals.t('pay.err_paypal_disabled') });
    }
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
    res.status(500).render('pay-error', { message: res.locals.t('pay.err_setup_failed') });
  }
});

// ── Success page ──
router.get('/:token/success', async (req, res) => {
  try {
    const db = req.db;
    const invoice = await db.collection('invoices').findOne({ paymentToken: req.params.token });
    if (!invoice) return res.status(404).render('pay-error', { message: res.locals.t('pay.err_invoice_not_found') });
    const clientDoc = await db.collection('clients').findOne({ _id: new ObjectId(invoice.clientId) });

    // If PayPal — capture the order now
    if (req.query.provider === 'paypal' && req.query.token) {
      try {
        const capture = await captureOrder(req.query.token, req.tenant);
        const captureId = capture.purchase_units?.[0]?.payments?.captures?.[0]?.id || req.query.token;
        // Record payment + email receipt (idempotent — webhook may also fire)
        await recordPaymentAndReceipt(db, invoice, {
          provider: 'paypal', transactionId: captureId, amount: invoice.amount, paidAt: new Date(),
        }, req.tenant);
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
            // Record payment + email receipt (idempotent — webhook may also fire)
            await recordPaymentAndReceipt(db, invoice, {
              provider: 'stripe', transactionId: session.id, amount: invoice.amount, paidAt: new Date(),
            }, req.tenant);
          }
        }
      } catch (stripeErr) {
        console.error('Stripe verify error:', stripeErr);
      }
    }

    res.render('pay-success', { inv: invoice, cl: clientDoc });
  } catch (err) {
    console.error('Success page error:', err);
    res.status(500).render('pay-error', { message: res.locals.t('booking.error_generic') });
  }
});

// ── Payee-facing printable receipt ──
// Available only once the invoice is paid. Linked from the paid-invoice page and
// the success page so the client can print or save a PDF of their receipt.
router.get('/:token/receipt', async (req, res) => {
  try {
    const db = req.db;
    const invoice = await db.collection('invoices').findOne({ paymentToken: req.params.token });
    if (!invoice) return res.status(404).render('pay-error', { message: res.locals.t('pay.err_receipt_not_found') });
    if (invoice.status !== 'paid') {
      return res.status(400).render('pay-error', { message: res.locals.t('pay.err_no_receipt') });
    }
    const clientDoc = await db.collection('clients').findOne({ _id: new ObjectId(invoice.clientId) });
    const payment = (invoice.payments || [])[invoice.payments.length - 1] || null;
    const paidDate = payment?.paidAt ? new Date(payment.paidAt) : (invoice.updatedAt ? new Date(invoice.updatedAt) : new Date());
    const txnId = payment?.transactionId || null;
    // Stable, human receipt number derived from the invoice + transaction tail.
    const tail = txnId ? txnId.slice(-6).toUpperCase() : invoice._id.toString().slice(-6).toUpperCase();
    const methodLabel = payment?.provider === 'paypal' ? 'PayPal'
      : payment?.provider === 'stripe' ? res.locals.t('pay.method_card')
      : (payment?.method || res.locals.t('pay.method_card_default'));
    res.render('receipt', {
      inv: invoice,
      cl: clientDoc,
      receiptNumber: `RCT-${invoice.invoiceNumber || tail}`,
      amountPaid: Number(payment?.amount ?? invoice.amount),
      paidOn: paidDate.toLocaleString('en-US', { month: 'long', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' }),
      methodLabel,
      transactionId: txnId,
    });
  } catch (err) {
    console.error('Receipt page error:', err);
    res.status(500).render('pay-error', { message: res.locals.t('booking.error_generic') });
  }
});

export default router;
