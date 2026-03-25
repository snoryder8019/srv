import { config } from '../config/config.js';

const BASE_URL = () =>
  config.PAYPAL_MODE === 'live'
    ? 'https://api-m.paypal.com'
    : 'https://api-m.sandbox.paypal.com';

let cachedToken = null;
let tokenExpiry = 0;

/** Get a PayPal OAuth2 access token (cached) */
export async function getAccessToken() {
  if (cachedToken && Date.now() < tokenExpiry) return cachedToken;
  if (!config.PAYPAL_CLIENT_ID || !config.PAYPAL_CLIENT_SECRET) {
    throw new Error('PayPal is not configured');
  }

  const res = await fetch(`${BASE_URL()}/v1/oauth2/token`, {
    method: 'POST',
    headers: {
      'Authorization': 'Basic ' + Buffer.from(`${config.PAYPAL_CLIENT_ID}:${config.PAYPAL_CLIENT_SECRET}`).toString('base64'),
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials',
  });

  if (!res.ok) throw new Error(`PayPal auth failed: ${res.status}`);
  const data = await res.json();
  cachedToken = data.access_token;
  tokenExpiry = Date.now() + (data.expires_in - 60) * 1000; // refresh 60s early
  return cachedToken;
}

/** Create a PayPal order for an invoice */
export async function createOrder(invoice, clientDoc, returnUrl, cancelUrl) {
  const token = await getAccessToken();
  const res = await fetch(`${BASE_URL()}/v2/checkout/orders`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      intent: 'CAPTURE',
      purchase_units: [{
        reference_id: invoice._id.toString(),
        description: invoice.title || `Invoice ${invoice.invoiceNumber}`,
        custom_id: invoice._id.toString(),
        amount: {
          currency_code: 'USD',
          value: invoice.amount.toFixed(2),
        },
      }],
      payment_source: {
        paypal: {
          experience_context: {
            return_url: returnUrl,
            cancel_url: cancelUrl,
            brand_name: 'W2 Marketing',
            user_action: 'PAY_NOW',
          },
        },
      },
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`PayPal create order failed: ${err}`);
  }
  return res.json();
}

/** Refund a PayPal capture (full or partial) */
export async function refundCapture(captureId, amount = null) {
  const token = await getAccessToken();
  const body = amount ? { amount: { currency_code: 'USD', value: amount.toFixed(2) } } : {};
  const res = await fetch(`${BASE_URL()}/v2/payments/captures/${captureId}/refund`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`PayPal refund failed: ${err}`);
  }
  return res.json();
}

/** Capture a PayPal order after approval */
export async function captureOrder(orderId) {
  const token = await getAccessToken();
  const res = await fetch(`${BASE_URL()}/v2/checkout/orders/${orderId}/capture`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`PayPal capture failed: ${err}`);
  }
  return res.json();
}
