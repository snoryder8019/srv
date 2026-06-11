import { ObjectId } from 'mongodb';
import { sendPaymentReceiptEmail } from './mailer.js';
import { config } from '../config/config.js';

/**
 * Atomically record a payment against an invoice and email the client a receipt
 * — exactly once.
 *
 * Stripe and PayPal each confirm a payment twice (the webhook AND the buyer's
 * return to /pay/:token/success), so the write has to be idempotent. The
 * `payments.transactionId: { $ne }` guard means only the first writer flips the
 * invoice to paid; `modifiedCount === 1` tells us this call is that writer, so
 * the receipt fires exactly once regardless of which path arrives first.
 *
 * The receipt is best-effort: a mail failure (e.g. tenant has no SMTP set up)
 * is logged but never rolls back the recorded payment.
 *
 * @returns {Promise<boolean>} true when THIS call recorded the payment.
 */
export async function recordPaymentAndReceipt(db, invoice, payment, tenant) {
  const txnId = payment.transactionId;
  const res = await db.collection('invoices').updateOne(
    { _id: invoice._id, 'payments.transactionId': { $ne: txnId } },
    {
      $set: { status: 'paid', updatedAt: new Date() },
      $push: {
        payments: {
          provider: payment.provider,
          transactionId: txnId,
          amount: payment.amount,
          paidAt: payment.paidAt || new Date(),
          ...(payment.raw ? { raw: payment.raw } : {}),
        },
      },
    }
  );
  // Lost the race (the other path already recorded it) — don't double-email.
  if (res.modifiedCount !== 1) return false;

  try {
    const clientDoc = invoice.clientId
      ? await db.collection('clients').findOne({ _id: new ObjectId(invoice.clientId) })
      : null;
    if (clientDoc?.email) {
      const domain = tenant?.domain ? `https://${tenant.domain}` : config.DOMAIN;
      await sendPaymentReceiptEmail({
        payment: {
          invoiceNumber: invoice.invoiceNumber,
          description: invoice.title || 'Professional services',
          method: payment.provider === 'paypal' ? 'PayPal' : 'Card',
          amount: payment.amount,
          paidOn: payment.paidAt || new Date(),
        },
        clientDoc,
        viewUrl: `${domain}/pay/${invoice.paymentToken}`,
        tenant,
      });
    }
  } catch (err) {
    console.error(`[receipt] could not email receipt for ${invoice.invoiceNumber}:`, err.message);
  }
  return true;
}
