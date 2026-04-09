/**
 * Slab — Tenant Provisioning
 * Creates everything a new tenant needs: DB, collections, DNS, Apache, SSL.
 */

import { execSync } from 'child_process';
import { writeFileSync, existsSync } from 'fs';
import { getSlabDb, getTenantDb } from './mongo.js';
import { encrypt } from './crypto.js';
import { config } from '../config/config.js';

const LINODE_API = 'https://api.linode.com/v4';

// ── Default collections to seed in a new tenant DB ─────────────────────────

const SEED_COLLECTIONS = {
  design: [
    { key: 'color_primary', value: '#1C2B4A' },
    { key: 'color_accent', value: '#C9A848' },
    { key: 'color_bg', value: '#F5F3EF' },
    { key: 'font_heading', value: 'Cormorant Garamond' },
    { key: 'font_body', value: 'Jost' },
    { key: 'vis_hero', value: 'true' },
    { key: 'vis_services', value: 'true' },
    { key: 'vis_portfolio', value: 'true' },
    { key: 'vis_about', value: 'true' },
    { key: 'vis_process', value: 'true' },
    { key: 'vis_reviews', value: 'false' },
    { key: 'vis_contact', value: 'true' },
    { key: 'vis_blog', value: 'false' },
    { key: 'agent_name', value: 'Assistant' },
    { key: 'agent_greeting', value: 'How can I help you today?' },
  ],
  copy: [],
  blog: [],
  portfolio: [],
  clients: [],
  pages: [],
  custom_sections: [],
  section_media: [],
  invoices: [],
  themes: [],
  brand_images: [],
  brand_models: [],
  assets: [],
  contacts: [],
  onboarding_forms: [],
  onboarding_responses: [],
};

// ── Main provisioning function ──────────────────────────────────────────────

export async function provisionTenant({
  subdomain,       // e.g. 'acme' → acme.madladslab.com
  brandName,       // e.g. 'Acme Marketing'
  brandLocation,   // e.g. 'Denver, CO'
  ownerEmail,      // admin email
  customDomain,    // optional: 'acmemarketing.com'
  stripeCustomerId,// Stripe customer ID for billing
  platform,        // optional: 'slab' | 'games' | 'opstrain' | 'madladslab' (defaults to 'slab')
}) {
  const slug = subdomain.toLowerCase().replace(/[^a-z0-9-]/g, '');
  if (!slug || slug.length < 2) throw new Error('Invalid subdomain');

  const slab = getSlabDb();
  const domain = `${slug}.madladslab.com`;

  // Check if already exists
  const existing = await slab.collection('tenants').findOne({
    $or: [{ domain }, { 'meta.subdomain': slug }],
  });
  if (existing) throw new Error(`Tenant "${slug}" already exists`);

  const dbName = `slab_${slug}`;
  const now = new Date();

  // 1. Create tenant document (starts as preview — goes active on payment)
  const tenantDoc = {
    domain,
    db: dbName,
    status: 'preview',   // preview | active | suspended | cancelled
    platform: platform || 'slab', // slab | games | opstrain | madladslab
    brand: {
      name: brandName,
      location: brandLocation || '',
      tagline: '',
      businessType: '',
      industry: '',
      description: '',
      serviceArea: '',
      phone: '',
      email: ownerEmail || '',
      ownerName: '',
      services: [],
      pricingNotes: '',
      targetAudience: '',
      brandVoice: '',
      socialLinks: {},
    },
    s3Prefix: slug,
    public: {},
    secrets: {},
    meta: {
      subdomain: slug,
      customDomain: customDomain || null,
      ownerEmail,
      stripeCustomerId: stripeCustomerId || null,
      plan: 'free',       // free | monthly | annual | lifetime
      provisionedAt: now,
      previewExpiresAt: new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000), // 7-day preview
    },
    createdAt: now,
  };

  await slab.collection('tenants').insertOne(tenantDoc);
  console.log(`[provision] Tenant doc created: ${domain}`);

  // 2. Seed tenant database
  const tenantDb = getTenantDb(dbName);
  for (const [colName, seedDocs] of Object.entries(SEED_COLLECTIONS)) {
    await tenantDb.createCollection(colName).catch(() => {});
    if (seedDocs.length) {
      await tenantDb.collection(colName).insertMany(seedDocs);
    }
  }

  // Create admin user (tenant owner = superadmin of this tenant)
  await tenantDb.collection('users').insertOne({
    email: ownerEmail,
    displayName: brandName,
    isAdmin: true,
    isOwner: true,
    provider: 'provisioned',
    createdAt: now,
  });
  console.log(`[provision] Database seeded: ${dbName}`);

  // 3. Add DNS record via Linode API
  if (config.LINODE_API_TOKEN && config.LINODE_DOMAIN_ID) {
    await addLinodeDnsRecord(slug);
  } else {
    console.log(`[provision] Skipping DNS — LINODE_API_TOKEN or LINODE_DOMAIN_ID not set`);
  }

  // 4. Generate Apache conf for custom domain (subdomains use wildcard)
  if (customDomain) {
    generateApacheConf(customDomain);
  }

  return { domain, dbName, slug };
}

// ── Linode DNS ──────────────────────────────────────────────────────────────

async function addLinodeDnsRecord(subdomain) {
  try {
    const res = await fetch(
      `${LINODE_API}/domains/${config.LINODE_DOMAIN_ID}/records`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${config.LINODE_API_TOKEN}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          type: 'A',
          name: subdomain,
          target: config.LINODE_IP,
          ttl_sec: 300,
        }),
      }
    );
    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Linode DNS API error: ${res.status} — ${err}`);
    }
    const data = await res.json();
    console.log(`[provision] DNS record created: ${subdomain}.madladslab.com → ${config.LINODE_IP} (id: ${data.id})`);
    return data;
  } catch (err) {
    console.error(`[provision] DNS failed:`, err.message);
    // Non-fatal — tenant still works, DNS can be added manually
  }
}

// ── Apache Conf Generator ───────────────────────────────────────────────────

export function generateApacheConf(domain, { port = config.PORT, enableSsl = false } = {}) {
  const safe = domain.replace(/[^a-zA-Z0-9.-]/g, '');
  const confPath = `/etc/apache2/sites-available/${safe}.conf`;
  const sslConfPath = `/etc/apache2/sites-available/${safe}-le-ssl.conf`;

  // HTTP conf (always created — handles redirect to HTTPS after certbot)
  const httpConf = `<VirtualHost *:80>
    ServerName ${safe}
    ServerAlias www.${safe}

    ProxyPreserveHost On
    RequestHeader set X-Forwarded-Proto "https"
    RequestHeader set X-Forwarded-Port "443"

    ProxyPass / http://127.0.0.1:${port}/
    ProxyPassReverse / http://127.0.0.1:${port}/

    # WebSocket support
    RewriteEngine On
    RewriteCond %{HTTP:Upgrade} websocket [NC]
    RewriteCond %{HTTP:Connection} upgrade [NC]
    RewriteRule ^/?(.*) ws://127.0.0.1:${port}/$1 [P,L]

    ErrorLog \${APACHE_LOG_DIR}/${safe}-error.log
    CustomLog \${APACHE_LOG_DIR}/${safe}-access.log combined
</VirtualHost>
`;

  writeFileSync(confPath, httpConf);
  console.log(`[provision] Apache conf written: ${confPath}`);

  // SSL conf (if cert already exists)
  if (enableSsl) {
    const sslConf = `<IfModule mod_ssl.c>
<VirtualHost *:443>
    ServerName ${safe}
    ServerAlias www.${safe}

    ProxyPreserveHost On
    RequestHeader set X-Forwarded-Proto "https"
    RequestHeader set X-Forwarded-Port "443"

    # www redirect
    RewriteEngine On
    RewriteCond %{HTTP_HOST} ^www\\.${safe.replace(/\./g, '\\.')}$ [NC]
    RewriteRule ^(.*)$ https://${safe}$1 [R=301,L]

    ProxyPass / http://127.0.0.1:${port}/
    ProxyPassReverse / http://127.0.0.1:${port}/

    # WebSocket support
    RewriteCond %{HTTP:Upgrade} websocket [NC]
    RewriteCond %{HTTP:Connection} upgrade [NC]
    RewriteRule ^/?(.*) ws://127.0.0.1:${port}/$1 [P,L]

    ErrorLog \${APACHE_LOG_DIR}/${safe}-error.log
    CustomLog \${APACHE_LOG_DIR}/${safe}-access.log combined

    SSLEngine on
    Include /etc/letsencrypt/options-ssl-apache.conf
    SSLCertificateFile /etc/letsencrypt/live/${safe}/fullchain.pem
    SSLCertificateKeyFile /etc/letsencrypt/live/${safe}/privkey.pem
</VirtualHost>
</IfModule>
`;
    writeFileSync(sslConfPath, sslConf);
    console.log(`[provision] SSL conf written: ${sslConfPath}`);
  }

  return { confPath, sslConfPath };
}

// ── Enable site + SSL ───────────────────────────────────────────────────────

export function enableSite(domain) {
  const safe = domain.replace(/[^a-zA-Z0-9.-]/g, '');
  try {
    execSync(`a2ensite ${safe}.conf`, { stdio: 'pipe' });
    console.log(`[provision] Site enabled: ${safe}`);
  } catch (err) {
    console.error(`[provision] a2ensite failed:`, err.message);
  }
}

export function reloadApache() {
  try {
    execSync('systemctl reload apache2', { stdio: 'pipe' });
    console.log('[provision] Apache reloaded');
  } catch (err) {
    console.error('[provision] Apache reload failed:', err.message);
  }
}

export async function provisionSsl(domain) {
  const safe = domain.replace(/[^a-zA-Z0-9.-]/g, '');
  try {
    // Run certbot — will modify Apache conf to add SSL redirect
    execSync(
      `certbot --apache -d ${safe} -d www.${safe} --non-interactive --agree-tos --redirect`,
      { stdio: 'pipe', timeout: 120000 }
    );
    console.log(`[provision] SSL certificate issued for ${safe}`);
    return true;
  } catch (err) {
    console.error(`[provision] Certbot failed for ${safe}:`, err.message);
    return false;
  }
}

// ── Full custom domain setup ────────────────────────────────────────────────

export async function setupCustomDomain(tenantDomain, customDomain) {
  const slab = getSlabDb();

  // Verify DNS points to us
  const { resolve4 } = await import('dns/promises');
  try {
    const addresses = await resolve4(customDomain);
    if (!addresses.includes(config.LINODE_IP)) {
      return { ok: false, error: `DNS for ${customDomain} does not point to ${config.LINODE_IP}. Found: ${addresses.join(', ')}` };
    }
  } catch {
    return { ok: false, error: `Cannot resolve ${customDomain}. Add an A record pointing to ${config.LINODE_IP}` };
  }

  // Generate conf, enable, SSL, reload
  generateApacheConf(customDomain);
  enableSite(customDomain);
  reloadApache();

  const sslOk = await provisionSsl(customDomain);

  // Update tenant doc to add custom domain
  await slab.collection('tenants').updateOne(
    { domain: tenantDomain },
    { $set: { 'meta.customDomain': customDomain, updatedAt: new Date() } }
  );

  // Also create a second tenant entry for the custom domain
  const tenant = await slab.collection('tenants').findOne({ domain: tenantDomain });
  if (tenant) {
    await slab.collection('tenants').updateOne(
      { domain: customDomain },
      {
        $setOnInsert: { createdAt: new Date() },
        $set: {
          db: tenant.db,
          status: tenant.status || 'active',
          brand: tenant.brand,
          s3Prefix: tenant.s3Prefix,
          public: tenant.public,
          secrets: tenant.secrets,
          meta: { ...tenant.meta, customDomain, isPrimaryAlias: false },
          updatedAt: new Date(),
        },
      },
      { upsert: true }
    );
  }

  if (sslOk) reloadApache();

  return { ok: true, ssl: sslOk };
}

// ── Wildcard conf generator (run once) ──────────────────────────────────────

export function generateWildcardConf({ port = config.PORT } = {}) {
  const confPath = '/etc/apache2/sites-available/slab-wildcard.conf';
  const sslConfPath = '/etc/apache2/sites-available/slab-wildcard-le-ssl.conf';

  const httpConf = `# Slab wildcard — catches all *.madladslab.com subdomains
<VirtualHost *:80>
    ServerName slab.madladslab.com
    ServerAlias *.madladslab.com

    ProxyPreserveHost On
    RequestHeader set X-Forwarded-Proto "https"
    RequestHeader set X-Forwarded-Port "443"

    ProxyPass / http://127.0.0.1:${port}/
    ProxyPassReverse / http://127.0.0.1:${port}/

    RewriteEngine On
    RewriteCond %{HTTP:Upgrade} websocket [NC]
    RewriteCond %{HTTP:Connection} upgrade [NC]
    RewriteRule ^/?(.*) ws://127.0.0.1:${port}/$1 [P,L]

    # Redirect to HTTPS
    RewriteCond %{HTTPS} !=on
    RewriteRule ^ https://%{HTTP_HOST}%{REQUEST_URI} [R=301,L]

    ErrorLog \${APACHE_LOG_DIR}/slab-wildcard-error.log
    CustomLog \${APACHE_LOG_DIR}/slab-wildcard-access.log combined
</VirtualHost>
`;

  const sslConf = `<IfModule mod_ssl.c>
# Slab wildcard SSL — catches all *.madladslab.com subdomains
<VirtualHost *:443>
    ServerName slab.madladslab.com
    ServerAlias *.madladslab.com

    ProxyPreserveHost On
    RequestHeader set X-Forwarded-Proto "https"
    RequestHeader set X-Forwarded-Port "443"

    ProxyPass / http://127.0.0.1:${port}/
    ProxyPassReverse / http://127.0.0.1:${port}/

    # WebSocket support
    RewriteEngine On
    RewriteCond %{HTTP:Upgrade} websocket [NC]
    RewriteCond %{HTTP:Connection} upgrade [NC]
    RewriteRule ^/?(.*) ws://127.0.0.1:${port}/$1 [P,L]

    ErrorLog \${APACHE_LOG_DIR}/slab-wildcard-error.log
    CustomLog \${APACHE_LOG_DIR}/slab-wildcard-access.log combined

    SSLEngine on
    Include /etc/letsencrypt/options-ssl-apache.conf
    SSLCertificateFile /etc/letsencrypt/live/madladslab.com/fullchain.pem
    SSLCertificateKeyFile /etc/letsencrypt/live/madladslab.com/privkey.pem
</VirtualHost>
</IfModule>
`;

  writeFileSync(confPath, httpConf);
  writeFileSync(sslConfPath, sslConf);
  console.log(`[provision] Wildcard confs written: ${confPath}, ${sslConfPath}`);
  return { confPath, sslConfPath };
}
