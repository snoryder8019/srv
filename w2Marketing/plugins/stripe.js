import Stripe from 'stripe';
import { config } from '../config/config.js';

let stripeClient = null;

export function getStripe() {
  if (!stripeClient && config.STRIPE_SECRET_KEY) {
    stripeClient = new Stripe(config.STRIPE_SECRET_KEY);
  }
  return stripeClient;
}

/** Create a Stripe Checkout Session for an invoice */
export async function createCheckoutSession(invoice, clientDoc, successUrl, cancelUrl) {
  const stripe = getStripe();
  if (!stripe) throw new Error('Stripe is not configured');

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
