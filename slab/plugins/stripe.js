import Stripe from 'stripe';

// Cache stripe instances per key to avoid re-creating
const stripeCache = new Map();

/** Get a Stripe instance for a tenant (reads from req.tenant.secrets) */
export function getStripe(tenant) {
  const key = tenant?.secrets?.stripeSecret;
  if (!key) return null;
  if (stripeCache.has(key)) return stripeCache.get(key);
  const client = new Stripe(key);
  stripeCache.set(key, client);
  return client;
}

/** Create a Stripe Checkout Session for an invoice */
export async function createCheckoutSession(invoice, clientDoc, successUrl, cancelUrl, tenant) {
  const stripe = getStripe(tenant);
  if (!stripe) throw new Error('Stripe is not configured — add your keys in Settings');

  const lineItems = invoice.lineItems?.length
    ? invoice.lineItems.map(li => ({
        price_data: {
          currency: 'usd',
          product_data: { name: li.description || invoice.title },
          unit_amount: Math.round((parseFloat(li.unitPrice) || 0) * 100),
        },
        quantity: parseInt(li.quantity) || 1,
      }))
    : [{
        price_data: {
          currency: 'usd',
          product_data: { name: invoice.title || `Invoice ${invoice.invoiceNumber}` },
          unit_amount: Math.round(invoice.amount * 100),
        },
        quantity: 1,
      }];

  return stripe.checkout.sessions.create({
    mode: 'payment',
    line_items: lineItems,
    customer_email: clientDoc.email || undefined,
    client_reference_id: invoice.invoiceNumber,
    metadata: {
      invoiceId: invoice._id.toString(),
      paymentToken: invoice.paymentToken,
    },
    success_url: successUrl,
    cancel_url: cancelUrl,
  });
}
