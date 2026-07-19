import { ObjectId } from 'mongodb';
import { getSlabDb, getTenantDb } from './mongo.js';
import { scheduleDailyJob } from './cronSafe.js';
import { generateInvoiceNumber, generatePaymentToken, getNextGenerateDate, getRecurringDueDate } from './invoiceHelpers.js';
import { sendInvoiceEmail } from './mailer.js';
import { config } from '../config/config.js';

/**
 * Generate any due recurring invoices for a single tenant and mark overdue ones.
 * Invoices live in the *tenant* database (req.db), never the slab registry — so
 * we must resolve the tenant DB per tenant. Returns the count generated.
 */
async function processTenantRecurring(tenant, now) {
  const db = getTenantDb(tenant.db);
  let generated = 0;

  const due = await db.collection('invoices').find({
    'recurring.enabled': true,
    'recurring.nextGenerateDate': { $lte: now },
    status: { $nin: ['void', 'draft'] },
  }).toArray();

  for (const template of due) {
    try {
      const invoiceNumber = await generateInvoiceNumber(db, tenant);
      const paymentToken = generatePaymentToken();
      const newDueDate = getRecurringDueDate(template.recurring.frequency, now);

      const newInvoice = {
        clientId: template.clientId,
        invoiceNumber,
        title: template.title,
        lineItems: template.lineItems || [],
        amount: template.amount,
        status: template.recurring.autoSend ? 'sent' : 'unpaid',
        dueDate: newDueDate,
        notes: template.notes || '',
        paymentToken,
        recurring: { enabled: false, parentInvoiceId: template._id.toString() },
        payments: [],
        emailSentAt: null,
        emailSentTo: null,
        createdAt: now,
      };

      const { insertedId } = await db.collection('invoices').insertOne(newInvoice);

      // Advance the template's next generate date
      await db.collection('invoices').updateOne(
        { _id: template._id },
        { $set: { 'recurring.nextGenerateDate': getNextGenerateDate(template.recurring.frequency, now) } }
      );

      // Auto-send email if configured. A mail failure must not roll back the
      // generated invoice — the invoice still exists and can be sent manually.
      if (template.recurring.autoSend) {
        try {
          const clientDoc = await db.collection('clients').findOne({ _id: new ObjectId(template.clientId) });
          if (clientDoc?.email) {
            const base = tenant.domain ? `https://${tenant.domain}` : config.DOMAIN;
            const paymentUrl = `${base}/pay/${paymentToken}`;
            await sendInvoiceEmail(newInvoice, clientDoc, paymentUrl, tenant);
            await db.collection('invoices').updateOne(
              { _id: insertedId },
              { $set: { emailSentAt: new Date(), emailSentTo: clientDoc.email } }
            );
          }
        } catch (mailErr) {
          console.error(`[Cron] ${tenant.db}: invoice ${invoiceNumber} generated but auto-send failed:`, mailErr.message);
        }
      }

      generated++;
      console.log(`[Cron] ${tenant.db}: generated recurring invoice ${invoiceNumber} from template ${template.invoiceNumber}`);
    } catch (err) {
      console.error(`[Cron] ${tenant.db}: failed to generate recurring invoice from ${template._id}:`, err);
    }
  }

  // Mark overdue invoices for this tenant
  await db.collection('invoices').updateMany(
    { status: { $in: ['unpaid', 'sent'] }, dueDate: { $lt: now.toISOString().split('T')[0] } },
    { $set: { status: 'overdue' } }
  );

  return generated;
}

/**
 * Sweep every tenant's database for due recurring invoices. Exported so it can be
 * triggered manually for a catch-up run (e.g. after a deploy). One tenant failing
 * never aborts the rest of the sweep.
 */
export async function runRecurringInvoices() {
  const now = new Date();
  const slab = getSlabDb();
  const tenants = await slab.collection('tenants')
    .find({ db: { $exists: true, $nin: [null, ''] } })
    .toArray();

  let total = 0;
  for (const tenant of tenants) {
    try {
      total += await processTenantRecurring(tenant, now);
    } catch (err) {
      console.error(`[Cron] Recurring invoice sweep failed for tenant ${tenant.db}:`, err);
    }
  }
  if (total) {
    console.log(`[Cron] Recurring invoice sweep complete — ${total} invoice(s) generated across ${tenants.length} tenant(s)`);
  }
  return total;
}

export function startRecurringInvoiceCron() {
  // Daily at 6:00 AM. WSL-skip-tolerant + claims before running so billing NEVER
  // double-invoices and never silently skips a day (node-cron dropped the tick).
  scheduleDailyJob('recurring-invoices', 6, runRecurringInvoices, { label: 'Recurring invoice job' });
}
