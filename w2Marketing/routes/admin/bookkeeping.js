import express from 'express';
import { ObjectId } from 'mongodb';
import { getDb } from '../../plugins/mongo.js';
import { refundCapture } from '../../plugins/paypal.js';
import { getStripe } from '../../plugins/stripe.js';
import { config } from '../../config/config.js';
import { sendInvoiceEmail } from '../../plugins/mailer.js';

const router = express.Router();

// ── Bookkeeping dashboard ──
router.get('/', async (req, res) => {
  const db = getDb();
  const filter = {};

  // Status filter
  if (req.query.status && req.query.status !== 'all') filter.status = req.query.status;
  // Provider filter — match invoices that have a payment from this provider
  if (req.query.provider && req.query.provider !== 'all') {
    filter['payments.provider'] = req.query.provider;
  }
  // Client filter
  if (req.query.client && req.query.client !== 'all') {
    filter.clientId = req.query.client;
  }

  const [invoices, clients] = await Promise.all([
    db.collection('w2_invoices').find(filter).sort({ createdAt: -1 }).toArray(),
    db.collection('w2_clients').find({}).project({ name: 1 }).toArray(),
  ]);

  // Build client lookup
  const clientMap = {};
  for (const c of clients) clientMap[c._id.toString()] = c.name;

  // Compute stats
  let totalRevenue = 0, totalOutstanding = 0, totalRefunded = 0, paidCount = 0, unpaidCount = 0;
  for (const inv of invoices) {
    if (inv.status === 'paid') {
      totalRevenue += inv.amount || 0;
      paidCount++;
    }
    if (['unpaid', 'sent', 'overdue'].includes(inv.status)) {
      totalOutstanding += inv.amount || 0;
      unpaidCount++;
    }
    if (inv.refunds?.length) {
      for (const r of inv.refunds) totalRefunded += r.amount || 0;
    }
  }

  res.render('admin/bookkeeping/index', {
    user: req.adminUser,
    invoices,
    clients,
    clientMap,
    stats: { totalRevenue, totalOutstanding, totalRefunded, paidCount, unpaidCount },
    filters: { status: req.query.status || 'all', provider: req.query.provider || 'all', client: req.query.client || 'all' },
    paypalConfigured: !!(config.PAYPAL_CLIENT_ID && config.PAYPAL_CLIENT_SECRET),
    stripeConfigured: !!config.STRIPE_SECRET_KEY,
  });
});

// ── Send invoice email ──
router.post('/:id/send', async (req, res) => {
  try {
    const db = getDb();
    const invoice = await db.collection('w2_invoices').findOne({ _id: new ObjectId(req.params.id) });
    if (!invoice) return res.redirect('/admin/bookkeeping?error=Invoice+not+found');
    const clientDoc = await db.collection('w2_clients').findOne({ _id: new ObjectId(invoice.clientId) });
    if (!clientDoc?.email) return res.redirect('/admin/bookkeeping?error=Client+has+no+email');

    const paymentUrl = `${config.DOMAIN}/pay/${invoice.paymentToken}`;
    await sendInvoiceEmail(invoice, clientDoc, paymentUrl);
    await db.collection('w2_invoices').updateOne(
      { _id: invoice._id },
      { $set: { emailSentAt: new Date(), emailSentTo: clientDoc.email, status: invoice.status === 'draft' ? 'sent' : invoice.status, updatedAt: new Date() } }
    );

    console.log(`[Bookkeeping] Invoice ${invoice.invoiceNumber} emailed to ${clientDoc.email}`);
    res.redirect('/admin/bookkeeping?success=Invoice+emailed');
  } catch (err) {
    console.error('Bookkeeping send error:', err);
    res.redirect(`/admin/bookkeeping?error=${encodeURIComponent(err.message || 'Email failed')}`);
  }
});

// ── Apply discount to an invoice ──
router.post('/:id/discount', async (req, res) => {
  try {
    const db = getDb();
    const invoiceId = new ObjectId(req.params.id);
    const discountAmount = parseFloat(req.body.amount);
    const reason = req.body.reason || '';

    if (!discountAmount || discountAmount <= 0) {
      return res.redirect('/admin/bookkeeping?error=Invalid+discount+amount');
    }

    const invoice = await db.collection('w2_invoices').findOne({ _id: invoiceId });
    if (!invoice) return res.redirect('/admin/bookkeeping?error=Invoice+not+found');

    const newAmount = Math.max(0, invoice.amount - discountAmount);

    await db.collection('w2_invoices').updateOne(
      { _id: invoiceId },
      {
        $set: { amount: newAmount, updatedAt: new Date() },
        $push: {
          discounts: {
            amount: discountAmount,
            reason,
            appliedAt: new Date(),
            appliedBy: req.adminUser?.displayName || 'admin',
          },
        },
      }
    );

    console.log(`[Bookkeeping] Discount $${discountAmount.toFixed(2)} applied to ${invoice.invoiceNumber} — new total: $${newAmount.toFixed(2)}`);
    res.redirect('/admin/bookkeeping?success=Discount+applied');
  } catch (err) {
    console.error('Discount error:', err);
    res.redirect('/admin/bookkeeping?error=Discount+failed');
  }
});

// ── Refund a payment ──
router.post('/:id/refund', async (req, res) => {
  try {
    const db = getDb();
    const invoiceId = new ObjectId(req.params.id);
    const provider = req.body.provider;
    const transactionId = req.body.transactionId;
    const refundAmount = req.body.amount ? parseFloat(req.body.amount) : null; // null = full refund

    const invoice = await db.collection('w2_invoices').findOne({ _id: invoiceId });
    if (!invoice) return res.redirect('/admin/bookkeeping?error=Invoice+not+found');

    const payment = invoice.payments?.find(p => p.transactionId === transactionId);
    if (!payment) return res.redirect('/admin/bookkeeping?error=Payment+not+found');

    let refundResult;
    const amount = refundAmount || payment.amount;

    if (provider === 'paypal') {
      refundResult = await refundCapture(transactionId, refundAmount);
    } else if (provider === 'stripe') {
      const stripe = getStripe();
      if (!stripe) return res.redirect('/admin/bookkeeping?error=Stripe+not+configured');
      // Stripe sessions need payment_intent for refund
      const refundOpts = { payment_intent: payment.raw?.paymentIntent };
      if (refundAmount) refundOpts.amount = Math.round(refundAmount * 100);
      refundResult = await stripe.refunds.create(refundOpts);
    } else {
      return res.redirect('/admin/bookkeeping?error=Unknown+provider');
    }

    // Record the refund on the invoice
    await db.collection('w2_invoices').updateOne(
      { _id: invoiceId },
      {
        $set: { status: 'void', updatedAt: new Date() },
        $push: {
          refunds: {
            provider,
            transactionId: refundResult.id || transactionId,
            originalTransactionId: transactionId,
            amount,
            refundedAt: new Date(),
            refundedBy: req.adminUser?.displayName || 'admin',
          },
        },
      }
    );

    console.log(`[Bookkeeping] Refund $${amount.toFixed(2)} on ${invoice.invoiceNumber} via ${provider}`);
    res.redirect('/admin/bookkeeping?success=Refund+processed');
  } catch (err) {
    console.error('Refund error:', err);
    res.redirect(`/admin/bookkeeping?error=${encodeURIComponent(err.message || 'Refund failed')}`);
  }
});

export default router;
