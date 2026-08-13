// Internal machine-to-machine endpoints — NOT tenant-scoped, NOT session-auth.
// Mounted BEFORE resolveTenant in app.js so it answers regardless of Host and
// needs no tenant. Guarded by a shared secret header (X-Provision-Key) matched
// against SLAB_PROVISION_KEY. Consumed by the VPS domain-provisioner micro-app,
// which turns this list into Apache vhosts + Let's Encrypt certs.
import express from 'express';
import { getSlabDb } from '../plugins/mongo.js';

const router = express.Router();

const PROVISION_KEY = process.env.SLAB_PROVISION_KEY || '';

// Timing-safe-ish guard. If the key is unset we fail closed (503) rather than
// leaking the tenant domain list to any caller.
function requireProvisionKey(req, res, next) {
  if (!PROVISION_KEY) return res.status(503).json({ error: 'provisioning_disabled' });
  const got = req.get('X-Provision-Key') || '';
  if (got.length !== PROVISION_KEY.length || got !== PROVISION_KEY) {
    return res.status(401).json({ error: 'unauthorized' });
  }
  next();
}

const PAID_PLANS = new Set(['monthly', 'quarterly', 'annual', 'lifetime']);

function isCustom(domain) {
  if (!domain) return false;
  const d = String(domain).trim().toLowerCase();
  // Ignore blanks and any wildcard-subdomain form — those are covered by the
  // *.madladslab.com cert and the existing slab vhost.
  return !!d && !d.endsWith('.madladslab.com') && d !== 'madladslab.com';
}

/**
 * GET /internal/verified-domains
 * → { generatedAt, domains: [{ apex, aliases, tenant, db, status, plan }] }
 *
 * "Verified" here means: an active tenant on a paid plan has attached this
 * custom domain in settings. Certbot's HTTP-01 challenge is the ownership
 * proof — issuance only succeeds if the domain's A record already points at
 * the VPS, so we don't need a separate DNS-TXT verification step.
 */
router.get('/verified-domains', requireProvisionKey, async (req, res) => {
  try {
    const slab = getSlabDb();
    const docs = await slab.collection('tenants').find(
      { status: 'active' },
      { projection: { db: 1, domain: 1, status: 1, 'meta.customDomain': 1, 'meta.plan': 1, 'public.customDomain': 1, 'brand.name': 1 } },
    ).toArray();

    const seen = new Set();
    const domains = [];
    for (const t of docs) {
      const raw = t.meta?.customDomain || t.public?.customDomain || '';
      if (!isCustom(raw)) continue;
      const plan = t.meta?.plan || 'free';
      if (!PAID_PLANS.has(plan)) continue;              // paid-only, same gate as settings.js
      const apex = String(raw).trim().toLowerCase().replace(/^www\./, '');
      if (seen.has(apex)) continue;
      seen.add(apex);
      domains.push({
        apex,
        aliases: [`www.${apex}`],                       // provisioner DNS-filters these
        tenant: t.brand?.name || t.db,
        db: t.db,
        status: t.status,
        plan,
      });
    }

    res.json({ generatedAt: new Date().toISOString(), count: domains.length, domains });
  } catch (err) {
    console.error('[internal] verified-domains failed:', err);
    res.status(500).json({ error: 'server_error' });
  }
});

// Cheap liveness probe for the provisioner to confirm the tunnel is up before
// it acts on a (possibly empty) domain list.
router.get('/ping', requireProvisionKey, (req, res) => res.json({ ok: true }));

export default router;
