import { getSlabDb, getTenantDb } from '../plugins/mongo.js';
import { decrypt } from '../plugins/crypto.js';

// In-memory tenant cache — keyed by domain, TTL 5 minutes
const cache = new Map();
const CACHE_TTL = 5 * 60 * 1000;

function getCached(domain) {
  const entry = cache.get(domain);
  if (!entry) return null;
  if (Date.now() - entry.ts > CACHE_TTL) { cache.delete(domain); return null; }
  return entry.tenant;
}

/** Decrypt all values in a secrets object */
function decryptSecrets(secrets) {
  if (!secrets) return {};
  const out = {};
  for (const [k, v] of Object.entries(secrets)) {
    try { out[k] = decrypt(v); } catch { out[k] = null; }
  }
  return out;
}

// Routes that work without a tenant (platform-level pages)
const TENANT_OPTIONAL_PATHS = ['/start', '/start/'];

/**
 * Tenant resolution middleware.
 * Sets req.tenant, req.db, and res.locals.brand on every request.
 */
export function resolveTenant(req, res, next) {
  const host = req.hostname;
  const isSlab = host === 'slab.madladslab.com' || host === 'localhost';
  const tenantOptional = isSlab || req.path.startsWith('/start') || req.path.startsWith('/superadmin');

  const cached = getCached(host);
  if (cached) {
    applyTenant(req, res, cached);
    return next();
  }

  // Async lookup
  lookupTenant(host)
    .then(tenant => {
      if (!tenant) {
        if (tenantOptional) {
          // Allow platform routes without a tenant
          res.locals.brand = {};
          return next();
        }
        return res.status(404).send('Unknown site');
      }
      cache.set(host, { tenant, ts: Date.now() });
      applyTenant(req, res, tenant);
      next();
    })
    .catch(err => {
      console.error('[slab] tenant lookup failed:', err);
      if (tenantOptional) {
        res.locals.brand = {};
        return next();
      }
      res.status(500).send('Server error');
    });
}

async function lookupTenant(domain) {
  const slab = getSlabDb();
  // Match by primary domain OR custom domain
  const doc = await slab.collection('tenants').findOne({
    $or: [
      { domain },
      { 'meta.customDomain': domain },
      { 'public.customDomain': domain },
    ],
    status: { $in: ['active', 'preview'] },
  });
  if (!doc) return null;

  // Decrypt secrets once, store decrypted in cache (memory only)
  return {
    _id: doc._id,
    domain: doc.domain,
    db: doc.db,
    status: doc.status || 'active',
    isPreview: doc.status === 'preview',
    brand: doc.brand || {},
    s3Prefix: doc.s3Prefix || doc.db,
    public: doc.public || {},
    secrets: decryptSecrets(doc.secrets),
    meta: doc.meta || {},
    oauth: {
      ...(doc.public?.oauth || {}),
      ...decryptSecrets(doc.secrets?.oauth || {}),
    },
  };
}

function applyTenant(req, res, tenant) {
  req.tenant = tenant;
  req.db = getTenantDb(tenant.db);
  res.locals.brand = tenant.brand;
  res.locals.tenant = {
    domain: tenant.domain,
    s3Prefix: tenant.s3Prefix,
    isPreview: tenant.isPreview,
    status: tenant.status,
  };
}

/** Bust cache for a domain (call after tenant doc update) */
export function bustTenantCache(domain) {
  cache.delete(domain);
}
