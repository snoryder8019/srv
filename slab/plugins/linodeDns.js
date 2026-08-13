// ─────────────────────────────────────────────────────────────────────────────
// linodeDns.js — thin wrapper around the Linode DNS (Domains) API v4.
//
// Slab is the intake/control surface; Linode is the invisible DNS backend. When
// a tenant onboards a custom domain, Slab calls here to create a per-tenant zone
// and write the record set (web A + Zoho mail) into it — instead of the single
// hardcoded LINODE_DOMAIN_ID. The tenant never touches Linode; you still can, in
// the Linode UI, because these are real Linode domains.
//
// Auth: config.LINODE_API_TOKEN (a Personal Access Token with Domains R/W).
// Everything no-ops gracefully when the token is absent so nothing throws in
// environments where DNS automation isn't configured.
// ─────────────────────────────────────────────────────────────────────────────
import { config } from '../config/config.js';

const LINODE_API = 'https://api.linode.com/v4';

// Linode's authoritative nameservers — what a tenant sets at their registrar,
// once, to hand DNS control to Slab. Static across all Linode zones.
export const LINODE_NAMESERVERS = [
  'ns1.linode.com', 'ns2.linode.com', 'ns3.linode.com', 'ns4.linode.com', 'ns5.linode.com',
];

// Which Zoho SPF include we WRITE (matches the verify path in settings.js).
const ZOHO_SPF_INCLUDE = 'zohomail.com';
// Zoho receiving MX set.
const ZOHO_MX = [
  { target: 'mx.zoho.com',  priority: 10 },
  { target: 'mx2.zoho.com', priority: 20 },
  { target: 'mx3.zoho.com', priority: 50 },
];

export function linodeConfigured() {
  return !!config.LINODE_API_TOKEN;
}

function headers() {
  return {
    'Authorization': `Bearer ${config.LINODE_API_TOKEN}`,
    'Content-Type': 'application/json',
  };
}

async function api(method, path, body) {
  if (!config.LINODE_API_TOKEN) throw new Error('LINODE_API_TOKEN not configured');
  const res = await fetch(`${LINODE_API}${path}`, {
    method,
    headers: headers(),
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = { raw: text }; }
  if (!res.ok) {
    const msg = data?.errors?.map((e) => e.reason).join('; ') || data?.raw || res.statusText;
    const err = new Error(`Linode ${method} ${path} → ${res.status}: ${msg}`);
    err.status = res.status;
    err.body = data;
    throw err;
  }
  return data;
}

// ── Zones ────────────────────────────────────────────────────────────────────

/** Find a Linode domain (zone) by exact name. Returns the zone object or null. */
export async function findZone(domain) {
  const d = String(domain).trim().toLowerCase();
  // Linode supports a filter header; fall back to scanning pages if needed.
  const res = await fetch(`${LINODE_API}/domains`, {
    headers: { ...headers(), 'X-Filter': JSON.stringify({ domain: d }) },
  });
  if (!res.ok) throw new Error(`Linode list domains → ${res.status}`);
  const data = await res.json();
  return (data.data || []).find((z) => z.domain === d) || null;
}

/**
 * Ensure a master zone exists for `domain`. Idempotent: returns the existing
 * zone if present, else creates one. Returns { id, domain, created }.
 */
export async function ensureZone(domain, { soaEmail } = {}) {
  const d = String(domain).trim().toLowerCase();
  const existing = await findZone(d);
  if (existing) return { id: existing.id, domain: d, created: false, zone: existing };

  const soa = soaEmail || config.PROVISION_SOA_EMAIL || `admin@${d}`;
  const zone = await api('POST', '/domains', {
    domain: d,
    type: 'master',
    soa_email: soa,
    ttl_sec: 300,
    description: 'Managed by Slab',
  });
  return { id: zone.id, domain: d, created: true, zone };
}

// ── Records ──────────────────────────────────────────────────────────────────

export async function listRecords(domainId) {
  const data = await api('GET', `/domains/${domainId}/records`);
  return data?.data || [];
}

// Match key for idempotency. TXT/A/CNAME are unique per (type,name) for our
// purposes; MX/NS can repeat per name so we also key on target.
function sameRecord(a, b) {
  if (a.type !== b.type) return false;
  if ((a.name || '') !== (b.name || '')) return false;
  if (a.type === 'MX' || a.type === 'NS') return (a.target || '') === (b.target || '');
  return true;
}

/**
 * Upsert one record into a zone. `rec` = { type, name, target, ttl_sec?, priority? }.
 * `name` is relative to the zone ('' = apex). Returns the record object.
 */
export async function putRecord(domainId, rec, existing = null) {
  const records = existing || await listRecords(domainId);
  const desired = { ttl_sec: 300, ...rec, name: rec.name || '' };
  const match = records.find((r) => sameRecord(r, desired));
  const body = {
    type: desired.type,
    name: desired.name,
    target: desired.target,
    ttl_sec: desired.ttl_sec,
    ...(desired.priority != null ? { priority: desired.priority } : {}),
  };
  if (match) {
    // Skip the round-trip if nothing changed.
    const unchanged = match.target === body.target && match.ttl_sec === body.ttl_sec
      && (body.priority == null || match.priority === body.priority);
    if (unchanged) return match;
    return api('PUT', `/domains/${domainId}/records/${match.id}`, body);
  }
  return api('POST', `/domains/${domainId}/records`, body);
}

export async function deleteRecord(domainId, recordId) {
  return api('DELETE', `/domains/${domainId}/records/${recordId}`);
}

/**
 * Normalize whatever the admin pasted from Zoho Mail Admin into the exact apex
 * TXT value Zoho expects: `zoho-verification=zbXXXXXXXX.zmverify.zoho.com`.
 * Accepts the full string, the bare `zb….zmverify.zoho.com` host, or just the
 * `zbXXXXXXXX` code; anything else is trusted as-is (covers format changes).
 */
export function normalizeZohoVerification(raw) {
  const v = String(raw || '').trim().replace(/^["']|["']$/g, '');
  if (!v) return '';
  if (/^zoho-verification=/i.test(v)) return v;
  if (/\.zmverify\.zoho\.com$/i.test(v)) return `zoho-verification=${v}`;
  if (/^zb[a-z0-9]+$/i.test(v)) return `zoho-verification=${v}.zmverify.zoho.com`;
  return v;
}

/**
 * Publish the Zoho domain-ownership TXT on the apex, idempotently. Deliberately
 * does NOT use putRecord(): its idempotency keys TXT on (type,name) alone, so an
 * apex-TXT upsert would clobber the SPF record that also lives at the apex. We
 * match only on the existing `zoho-verification=` TXT, so SPF/DMARC are safe.
 */
export async function publishZohoVerification(domainId, rawValue) {
  const target = normalizeZohoVerification(rawValue);
  if (!target) throw new Error('Empty verification value');
  const records = await listRecords(domainId);
  const existing = records.find((r) =>
    r.type === 'TXT' && (r.name || '') === '' && /^zoho-verification=/i.test(r.target || ''));
  const body = { type: 'TXT', name: '', target, ttl_sec: 300 };
  if (existing) {
    if ((existing.target || '') === target) return { record: existing, changed: false };
    const rec = await api('PUT', `/domains/${domainId}/records/${existing.id}`, body);
    return { record: rec, changed: true };
  }
  const rec = await api('POST', `/domains/${domainId}/records`, body);
  return { record: rec, changed: true };
}

// ── Record sets ──────────────────────────────────────────────────────────────

/**
 * Point the domain's website at the VPS: apex A + www CNAME. Needed so the
 * domain resolves to Apache and the domain-provisioner can issue its cert.
 */
export async function publishWebRecords(domainId, { ip = config.LINODE_IP } = {}) {
  const existing = await listRecords(domainId);
  const out = [];
  out.push(await putRecord(domainId, { type: 'A', name: '', target: ip }, existing));
  out.push(await putRecord(domainId, { type: 'A', name: 'www', target: ip }, existing));
  return out;
}

/**
 * Publish the Zoho mail record set on the zone apex: MX + SPF + DMARC + the
 * Zoho return-path DKIM CNAME. The domain-specific DKIM TXT key still has to be
 * copied from Zoho Mail Admin (we can't know it), so callers should surface that.
 */
export async function publishMailRecords(domainId, domain, { dmarcRua } = {}) {
  const d = String(domain).trim().toLowerCase();
  const existing = await listRecords(domainId);
  const created = [];

  for (const mx of ZOHO_MX) {
    created.push(await putRecord(domainId, { type: 'MX', name: '', target: mx.target, priority: mx.priority }, existing));
  }
  created.push(await putRecord(domainId, { type: 'TXT', name: '', target: `v=spf1 include:${ZOHO_SPF_INCLUDE} ~all` }, existing));
  created.push(await putRecord(domainId, {
    type: 'TXT', name: '_dmarc',
    target: `v=DMARC1; p=none; rua=mailto:${dmarcRua || `dmarc@${d}`}`,
  }, existing));
  // Zoho return-path / one common DKIM selector as a CNAME to Zoho.
  created.push(await putRecord(domainId, { type: 'CNAME', name: 'zb._domainkey', target: 'zb._domainkey.zoho.com' }, existing));

  return created;
}
