/**
 * Statement format registry — PLATFORM-CURATED (superadmin owns this list).
 *
 * Each profile teaches the statement reader that we recognize a given bank's
 * layout and, when `keyed` is true, that we have a validated column mapping for
 * it (so amounts land on the ledger correctly — e.g. charging the transaction,
 * not the running-balance column). Tenants see this list read-only; when a client
 * uploads a statement we don't recognize (or recognize but haven't keyed yet),
 * the Statements tab flags it and offers to file a ticket to get it keyed.
 *
 * Adding a bank: append a profile with distinctive `signatures` (matched against
 * the extracted PDF text). Flip `keyed` to true once its mapping is validated.
 *
 * NOTE: the current line parser is generic (balance-aware). "keyed" here is the
 * product signal — a promise that we've validated this bank — not yet a per-bank
 * parser. As bank-specific parsing lands, hang it off these keys.
 */

export const STATEMENT_FORMATS = [
  { key: 'wells_fargo',  label: 'Wells Fargo',        signatures: [/wells\s*fargo/i],                         keyed: true },
  { key: 'paypal',       label: 'PayPal',             signatures: [/\bpaypal\b/i],                             keyed: false },
  { key: 'stripe',       label: 'Stripe',             signatures: [/\bstripe\b/i],                             keyed: false },
  { key: 'chase',        label: 'Chase',              signatures: [/\bchase\b/i, /jpmorgan\s*chase/i],        keyed: false },
  { key: 'bofa',         label: 'Bank of America',    signatures: [/bank\s*of\s*america/i, /\bbofa\b/i],      keyed: false },
  { key: 'amex',         label: 'American Express',   signatures: [/american\s*express/i, /\bamex\b/i],       keyed: false },
  { key: 'capital_one',  label: 'Capital One',        signatures: [/capital\s*one/i],                          keyed: false },
  { key: 'us_bank',      label: 'U.S. Bank',          signatures: [/u\.?s\.?\s*bank/i],                        keyed: false },
  { key: 'citi',         label: 'Citibank',           signatures: [/\bciti(bank|group)?\b/i],                  keyed: false },
  { key: 'pnc',          label: 'PNC Bank',           signatures: [/\bpnc\b/i],                                keyed: false },
  { key: 'td_bank',      label: 'TD Bank',            signatures: [/\btd\s*bank\b/i],                          keyed: false },
];

export const findStatementFormat = (key) => STATEMENT_FORMATS.find((f) => f.key === key) || null;

/**
 * Detect the issuer from statement text — from the HEADER (branding), not the
 * transaction lines. This avoids the "PayPal invoice flagged as Wells Fargo" trap:
 * a PayPal doc names its funding bank ("Wells Fargo") in the body, and a Wells
 * Fargo statement is full of "Paypal Purchase" transaction lines. The issuer
 * brands itself at the top, so we score signature hits in the first ~2500 chars
 * and take the strongest; only if the header is silent do we scan the whole doc.
 */
export function detectStatementFormat(text, headerChars = 2500) {
  const t = String(text || '');
  if (!t) return null;
  const header = t.slice(0, headerChars);
  let best = null;
  let bestScore = 0;
  for (const f of STATEMENT_FORMATS) {
    let score = 0;
    for (const re of f.signatures) {
      const g = new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g');
      score += (header.match(g) || []).length;
    }
    if (score > bestScore) { bestScore = score; best = f; }
  }
  if (best) return best;
  // Header had no issuer branding — fall back to a whole-document first match.
  for (const f of STATEMENT_FORMATS) {
    if (f.signatures.some((re) => re.test(t))) return f;
  }
  return null;
}
