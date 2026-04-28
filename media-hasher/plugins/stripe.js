// Optional Stripe integration — disabled if STRIPE_SECRET is missing.
// Lazy-loads the SDK so the dependency stays optional.
import { config } from '../config/config.js';

let stripe = null;

export async function getStripe() {
  if (!config.stripeEnabled()) return null;
  if (stripe) return stripe;
  const Stripe = (await import('stripe')).default;
  stripe = new Stripe(config.STRIPE_SECRET);
  return stripe;
}

export async function createCheckoutSession({ purchaseId, amountCents, customerEmail, successUrl, cancelUrl }) {
  const s = await getStripe();
  if (!s) throw new Error('Stripe is not configured');
  return s.checkout.sessions.create({
    mode: 'payment',
    line_items: [{
      price_data: {
        currency: 'usd',
        product_data: { name: `${config.PRODUCT_NAME} — lifetime license` },
        unit_amount: amountCents,
      },
      quantity: 1,
    }],
    customer_email: customerEmail || undefined,
    client_reference_id: purchaseId.toString(),
    metadata: { purchaseId: purchaseId.toString() },
    success_url: successUrl,
    cancel_url: cancelUrl,
  });
}
