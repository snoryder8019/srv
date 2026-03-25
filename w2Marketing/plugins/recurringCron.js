import cron from 'node-cron';
import { ObjectId } from 'mongodb';
import { getDb } from './mongo.js';
import { generateInvoiceNumber, generatePaymentToken, getNextGenerateDate, getRecurringDueDate } from './invoiceHelpers.js';
import { sendInvoiceEmail } from './mailer.js';
import { config } from '../config/config.js';

export function startRecurringInvoiceCron() {
  // Run daily at 6:00 AM
  cron.schedule('0 6 * * *', async () => {
    try {
      const db = getDb();
      const now = new Date();

      const due = await db.collection('w2_invoices').find({
        'recurring.enabled': true,
        'recurring.nextGenerateDate': { $lte: now },
        status: { $nin: ['void', 'draft'] },
      }).toArray();

      for (const template of due) {
        try {
          const invoiceNumber = await generateInvoiceNumber(db);
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

          await db.collection('w2_invoices').insertOne(newInvoice);

          // Advance the template's next generate date
          await db.collection('w2_invoices').updateOne(
            { _id: template._id },
            { $set: { 'recurring.nextGenerateDate': getNextGenerateDate(template.recurring.frequency, now) } }
          );

          // Auto-send email if configured
          if (template.recurring.autoSend) {
            const clientDoc = await db.collection('w2_clients').findOne({ _id: new ObjectId(template.clientId) });
            if (clientDoc?.email) {
              const paymentUrl = `${config.DOMAIN}/pay/${paymentToken}`;
              await sendInvoiceEmail(newInvoice, clientDoc, paymentUrl);
              await db.collection('w2_invoices').updateOne(
                { _id: newInvoice._id },
                { $set: { emailSentAt: new Date(), emailSentTo: clientDoc.email } }
              );
            }
          }

          console.log(`[Cron] Generated recurring invoice ${invoiceNumber} from template ${template.invoiceNumber}`);
        } catch (err) {
          console.error(`[Cron] Failed to generate recurring invoice from ${template._id}:`, err);
        }
      }

      // Also mark overdue invoices
      await db.collection('w2_invoices').updateMany(
        { status: { $in: ['unpaid', 'sent'] }, dueDate: { $lt: now.toISOString().split('T')[0] } },
        { $set: { status: 'overdue' } }
      );
    } catch (err) {
      console.error('[Cron] Recurring invoice job failed:', err);
    }
  });

  console.log('[Cron] Recurring invoice job scheduled (daily 6:00 AM)');
}
