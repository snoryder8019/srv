// PayPal Payouts — platform-level mass commission disbursement.
//
// Uses the *platform* PayPal app credentials (config.PAYPAL_CID/SEC/MODE), the
// same ones that take go-live payments. The Payouts API (/v1/payments/payouts)
// is an inherently COMMERCIAL, business-to-recipient disbursement — it is NOT a
// personal "friends & family" transfer — which satisfies the requirement that
// commission payments be classified as commercial transactions.
//
// Money movement is real. Callers must enforce their own guards (tax-form on
// file, payable balance, idempotency) BEFORE calling send().

import { config } from '../config/config.js';

function ppBase() {
  return config.PAYPAL_MODE === 'live'
    ? 'https://api-m.paypal.com'
    : 'https://api-m.sandbox.paypal.com';
}

let _token = null;
let _tokenExp = 0;
async function accessToken() {
  if (_token && Date.now() < _tokenExp) return _token;
  const res = await fetch(`${ppBase()}/v1/oauth2/token`, {
    method: 'POST',
    headers: {
      Authorization: 'Basic ' + Buffer.from(`${config.PAYPAL_CID}:${config.PAYPAL_SEC}`).toString('base64'),
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials',
  });
  if (!res.ok) throw new Error(`PayPal auth failed: ${res.status}`);
  const data = await res.json();
  _token = data.access_token;
  _tokenExp = Date.now() + (data.expires_in - 60) * 1000;
  return _token;
}

export function payoutsConfigured() {
  return !!(config.PAYPAL_CID && config.PAYPAL_SEC);
}

/**
 * Send one payout batch.
 * @param {Array<{receiver:string, amount:number, note?:string, senderItemId:string}>} items
 * @param {{ batchId:string, subject?:string, message?:string, currency?:string }} opts
 *   batchId — idempotency key. PayPal rejects a duplicate sender_batch_id, so
 *   reusing it (e.g. a double-click) cannot double-pay.
 * @returns {Promise<{ ok:boolean, batchId:string, payoutBatchId?:string, status?:string, error?:string, raw?:any }>}
 */
export async function sendPayoutBatch(items, opts) {
  if (!payoutsConfigured()) return { ok: false, batchId: opts?.batchId, error: 'PayPal not configured' };
  if (!items?.length) return { ok: false, batchId: opts?.batchId, error: 'No items' };
  const currency = opts.currency || 'USD';

  const body = {
    sender_batch_header: {
      sender_batch_id: opts.batchId,
      email_subject: opts.subject || 'Your Slab commission payout',
      email_message: opts.message || 'Thank you for selling Slab. Your commission is on the way.',
    },
    items: items.map((it) => ({
      recipient_type: 'EMAIL',
      receiver: it.receiver,
      amount: { value: Number(it.amount).toFixed(2), currency },
      note: it.note || 'Slab sales commission',
      sender_item_id: it.senderItemId,
    })),
  };

  let res, data;
  try {
    const token = await accessToken();
    res = await fetch(`${ppBase()}/v1/payments/payouts`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    data = await res.json().catch(() => ({}));
  } catch (e) {
    return { ok: false, batchId: opts.batchId, error: e.message };
  }

  if (!res.ok) {
    // 201 = accepted. Anything else (incl. DUPLICATE_SENDER_BATCH_ID) is a no-pay.
    const msg = data?.name || data?.message || `HTTP ${res.status}`;
    return { ok: false, batchId: opts.batchId, error: msg, raw: data };
  }

  return {
    ok: true,
    batchId: opts.batchId,
    payoutBatchId: data?.batch_header?.payout_batch_id,
    status: data?.batch_header?.batch_status, // PENDING → PROCESSING → SUCCESS
    raw: data,
  };
}
