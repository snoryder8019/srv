// PayPal REST integration — single-tenant version (server-wide credentials).
// Modeled after /srv/slab/plugins/paypal.js but simplified for one merchant.
import { config } from '../config/config.js';

let cachedToken = null;

function baseUrl() {
  return config.PAYPAL_MODE === 'live'
    ? 'https://api-m.paypal.com'
    : 'https://api-m.sandbox.paypal.com';
}

export async function getAccessToken() {
  if (!config.paypalEnabled()) throw new Error('PayPal is not configured');
  if (cachedToken && Date.now() < cachedToken.expiry) return cachedToken.token;

  const res = await fetch(`${baseUrl()}/v1/oauth2/token`, {
    method: 'POST',
    headers: {
      'Authorization':
        'Basic ' + Buffer.from(`${config.PAYPAL_CID}:${config.PAYPAL_SEC}`).toString('base64'),
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials',
  });
  if (!res.ok) throw new Error(`PayPal auth failed: ${res.status}`);
  const data = await res.json();
  cachedToken = { token: data.access_token, expiry: Date.now() + (data.expires_in - 60) * 1000 };
  return cachedToken.token;
}

/**
 * Create a PayPal order for the MediaHasher one-time purchase.
 * `referenceId` should be a purchase doc _id; we get it back via the webhook / capture step.
 */
export async function createOrder({ referenceId, amountCents, returnUrl, cancelUrl }) {
  const token = await getAccessToken();
  const value = (amountCents / 100).toFixed(2);

  const res = await fetch(`${baseUrl()}/v2/checkout/orders`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      intent: 'CAPTURE',
      purchase_units: [{
        reference_id: referenceId,
        custom_id: referenceId,
        description: `${config.PRODUCT_NAME} — lifetime license`,
        amount: { currency_code: 'USD', value },
      }],
      payment_source: {
        paypal: {
          experience_context: {
            return_url: returnUrl,
            cancel_url: cancelUrl,
            brand_name: config.PRODUCT_NAME,
            user_action: 'PAY_NOW',
          },
        },
      },
    }),
  });

  if (!res.ok) throw new Error(`PayPal create order failed: ${await res.text()}`);
  return res.json();
}

export async function captureOrder(orderId) {
  const token = await getAccessToken();
  const res = await fetch(`${baseUrl()}/v2/checkout/orders/${orderId}/capture`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
  });
  if (!res.ok) throw new Error(`PayPal capture failed: ${await res.text()}`);
  return res.json();
}

export async function getOrder(orderId) {
  const token = await getAccessToken();
  const res = await fetch(`${baseUrl()}/v2/checkout/orders/${orderId}`, {
    headers: { 'Authorization': `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`PayPal get order failed: ${await res.text()}`);
  return res.json();
}
