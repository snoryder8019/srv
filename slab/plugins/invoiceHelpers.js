import crypto from 'crypto';

/** Derive a 2–4 char invoice prefix from tenant config. */
export function getInvoicePrefix(tenant) {
  const explicit = tenant?.public?.invoicePrefix;
  if (explicit && /^[A-Za-z0-9]{1,6}$/.test(explicit)) return explicit.toUpperCase();
  const brandName = tenant?.brand?.name;
  if (brandName) {
    const initials = brandName
      .replace(/[^A-Za-z0-9 ]/g, ' ')
      .split(/\s+/)
      .filter(Boolean)
      .map(w => w[0])
      .join('')
      .toUpperCase()
      .slice(0, 4);
    if (initials.length >= 2) return initials;
    const compact = brandName.replace(/[^A-Za-z0-9]/g, '').toUpperCase().slice(0, 4);
    if (compact) return compact;
  }
  const slug = tenant?.s3Prefix || tenant?.db;
  if (slug) return String(slug).replace(/[^A-Za-z0-9]/g, '').toUpperCase().slice(0, 4) || 'INV';
  return 'INV';
}

/** Atomically generate next invoice number: <PREFIX>-YYYY-0001 */
export async function generateInvoiceNumber(db, tenant = null) {
  const year = new Date().getFullYear();
  const counter = await db.collection('invoice_counter').findOneAndUpdate(
    { _id: `invoice_${year}` },
    { $inc: { seq: 1 } },
    { upsert: true, returnDocument: 'after' }
  );
  const prefix = getInvoicePrefix(tenant);
  return `${prefix}-${year}-${String(counter.seq).padStart(4, '0')}`;
}

/** Generate a secure payment token for public invoice URLs */
export function generatePaymentToken() {
  return crypto.randomBytes(24).toString('hex');
}

/** Sum line items into a total */
export function calculateTotal(lineItems) {
  if (!lineItems?.length) return 0;
  return lineItems.reduce((sum, li) => sum + (parseFloat(li.quantity) || 0) * (parseFloat(li.unitPrice) || 0), 0);
}

/** Compute the next recurrence date from a frequency */
export function getNextGenerateDate(frequency, from = new Date()) {
  const d = new Date(from);
  switch (frequency) {
    case 'weekly':    d.setDate(d.getDate() + 7); break;
    case 'biweekly':  d.setDate(d.getDate() + 14); break;
    case 'monthly':   d.setMonth(d.getMonth() + 1); break;
    case 'quarterly': d.setMonth(d.getMonth() + 3); break;
    case 'yearly':    d.setFullYear(d.getFullYear() + 1); break;
    default: return null;
  }
  return d;
}

/** Compute a due date for a newly generated recurring invoice */
export function getRecurringDueDate(frequency, from = new Date()) {
  // Due 14 days after generation for weekly/biweekly, 30 for monthly+
  const d = new Date(from);
  const days = ['weekly', 'biweekly'].includes(frequency) ? 14 : 30;
  d.setDate(d.getDate() + days);
  return d;
}
