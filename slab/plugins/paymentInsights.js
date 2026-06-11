// ─────────────────────────────────────────────────────────────────────────────
// paymentInsights.js — LIVE bookkeeping analytics straight from Stripe & PayPal.
//
// Pulls real transactions over a date window and normalizes them into daily
// revenue series + totals, so the analytics page can chart actual money in/out
// (not just the internal invoices collection).
//
// Both adapters are defensive — a missing/disabled provider degrades to
// { ok:false, error } and never breaks the other.
// ─────────────────────────────────────────────────────────────────────────────
import { getStripe } from './stripe.js';
import { getAccessToken, getBaseUrl } from './paypal.js';

const day = (d) => new Date(d).toISOString().slice(0, 10);

function dateAxis(days) {
  const out = [];
  const today = new Date(); today.setUTCHours(0, 0, 0, 0);
  for (let i = days - 1; i >= 0; i--) out.push(day(today.getTime() - i * 86400000));
  return out;
}
const round2 = (n) => Math.round((n || 0) * 100) / 100;

// ── Stripe ────────────────────────────────────────────────────────────────────
async function stripeInsights(tenant, since, axis) {
  const stripe = getStripe(tenant);
  if (!stripe) return { ok: false, configured: false };

  const map = {};
  let gross = 0, refunded = 0, count = 0, currency = 'usd';
  try {
    const gte = Math.floor(since.getTime() / 1000);
    let params = { created: { gte }, limit: 100 };
    // Cap pagination to keep the call bounded (≤1000 charges / period).
    for (let page = 0; page < 10; page++) {
      const res = await stripe.charges.list(params);
      for (const ch of res.data) {
        if (ch.status !== 'succeeded' || !ch.paid) continue;
        const k = day(ch.created * 1000);
        const amt = (ch.amount || 0) / 100;
        map[k] = (map[k] || 0) + amt;
        gross += amt;
        refunded += (ch.amount_refunded || 0) / 100;
        count++;
        if (ch.currency) currency = ch.currency;
      }
      if (!res.has_more || !res.data.length) break;
      params = { ...params, starting_after: res.data[res.data.length - 1].id };
    }
    const series = axis.map(date => ({ date, value: round2(map[date]) }));
    return { ok: true, configured: true, gross: round2(gross), net: round2(gross - refunded), refunded: round2(refunded), count, currency: currency.toUpperCase(), series };
  } catch (e) {
    return { ok: false, configured: true, error: e.message };
  }
}

// ── PayPal (Transaction Search API — requires the feature enabled on the app) ──
async function paypalInsights(tenant, since, axis) {
  const clientId = tenant?.public?.paypalClientId;
  const secret = tenant?.secrets?.paypalSecret;
  if (!clientId || !secret) return { ok: false, configured: false };

  const map = {};
  let gross = 0, refunded = 0, count = 0;
  try {
    const token = await getAccessToken(tenant);
    const base = getBaseUrl(tenant);
    const startISO = since.toISOString().replace(/\.\d+Z$/, 'Z');
    const endISO = new Date().toISOString().replace(/\.\d+Z$/, 'Z');

    for (let page = 1; page <= 10; page++) {
      const u = `${base}/v1/reporting/transactions?start_date=${encodeURIComponent(startISO)}`
        + `&end_date=${encodeURIComponent(endISO)}&fields=transaction_info&page_size=100&page=${page}`;
      const r = await fetch(u, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(20000) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) {
        const msg = j?.message || j?.error_description || `HTTP ${r.status}`;
        throw new Error(/PERMISSION|not.*grant|TRANSACTION/i.test(msg)
          ? 'Enable "Transaction Search" on your PayPal app to pull live analytics.' : msg);
      }
      for (const t of (j.transaction_details || [])) {
        const ti = t.transaction_info || {};
        if (ti.transaction_status && ti.transaction_status !== 'S') continue;
        const amt = parseFloat(ti.transaction_amount?.value || '0');
        const k = ti.transaction_initiation_date ? day(ti.transaction_initiation_date) : null;
        if (!k) continue;
        if (amt >= 0) { map[k] = (map[k] || 0) + amt; gross += amt; count++; }
        else refunded += -amt;
      }
      if (page >= (j.total_pages || 1)) break;
    }
    const series = axis.map(date => ({ date, value: round2(map[date]) }));
    return { ok: true, configured: true, gross: round2(gross), refunded: round2(refunded), count, series };
  } catch (e) {
    return { ok: false, configured: true, error: e.message };
  }
}

// ── Orchestrator ──────────────────────────────────────────────────────────────
// Returns { days, axis, stripe, paypal, daily:[{date,stripe,paypal,total}],
//           totals:{gross,count,refunded}, providerSplit:[{provider,amount}] }
export async function buildPaymentInsights(tenant, { days = 30 } = {}) {
  const axis = dateAxis(days);
  const since = new Date(Date.now() - days * 86400000);

  const [stripe, paypal] = await Promise.all([
    stripeInsights(tenant, since, axis),
    paypalInsights(tenant, since, axis),
  ]);

  const daily = axis.map((date, i) => {
    const s = stripe.series?.[i]?.value || 0;
    const p = paypal.series?.[i]?.value || 0;
    return { date, stripe: s, paypal: p, total: round2(s + p) };
  });

  const totals = {
    gross: round2((stripe.gross || 0) + (paypal.gross || 0)),
    count: (stripe.count || 0) + (paypal.count || 0),
    refunded: round2((stripe.refunded || 0) + (paypal.refunded || 0)),
  };

  const providerSplit = [
    { provider: 'Stripe', amount: stripe.gross || 0 },
    { provider: 'PayPal', amount: paypal.gross || 0 },
  ].filter(p => p.amount > 0);

  return { days, axis, stripe, paypal, daily, totals, providerSplit };
}
