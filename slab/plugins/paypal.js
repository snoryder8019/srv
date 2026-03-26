// Cache tokens per client ID
const tokenCache = new Map();

function getBaseUrl(tenant) {
  const mode = tenant?.public?.paypalMode || 'sandbox';
  return mode === 'live' ? 'https://api-m.paypal.com' : 'https://api-m.sandbox.paypal.com';
}

/** Get a PayPal OAuth2 access token (cached per tenant) */
export async function getAccessToken(tenant) {
  const clientId = tenant?.public?.paypalClientId;
  const clientSecret = tenant?.secrets?.paypalSecret;
  if (!clientId || !clientSecret) throw new Error('PayPal is not configured — add your keys in Settings');

  const cached = tokenCache.get(clientId);
  if (cached && Date.now() < cached.expiry) return cached.token;

  const res = await fetch(`${getBaseUrl(tenant)}/v1/oauth2/token`, {
    method: 'POST',
    headers: {
      'Authorization': 'Basic ' + Buffer.from(`${clientId}:${clientSecret}`).toString('base64'),
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials',
  });

  if (!res.ok) throw new Error(`PayPal auth failed: ${res.status}`);
  const data = await res.json();
  tokenCache.set(clientId, { token: data.access_token, expiry: Date.now() + (data.expires_in - 60) * 1000 });
  return data.access_token;
}

/** Create a PayPal order for an invoice */
export async function createOrder(invoice, clientDoc, returnUrl, cancelUrl, brandName = null, tenant = null) {
  const token = await getAccessToken(tenant);
  const res = await fetch(`${getBaseUrl(tenant)}/v2/checkout/orders`, {
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
            brand_name: brandName || tenant?.brand?.name || 'Our Business',
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
export async function refundCapture(captureId, amount = null, tenant = null) {
  const token = await getAccessToken(tenant);
  const body = amount ? { amount: { currency_code: 'USD', value: amount.toFixed(2) } } : {};
  const res = await fetch(`${getBaseUrl(tenant)}/v2/payments/captures/${captureId}/refund`, {
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
export async function captureOrder(orderId, tenant = null) {
  const token = await getAccessToken(tenant);
  const res = await fetch(`${getBaseUrl(tenant)}/v2/checkout/orders/${orderId}/capture`, {
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
