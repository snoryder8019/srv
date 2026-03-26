#!/usr/bin/env node
/**
 * Slab — Manual tenant provisioning
 * Usage: node scripts/provision-tenant.js <subdomain> <brandName> <email> [location]
 *
 * Example:
 *   node scripts/provision-tenant.js acme "Acme Marketing" admin@acme.com "Denver, CO"
 */

import { connectDB } from '../plugins/mongo.js';
import { provisionTenant } from '../plugins/provision.js';
import '../config/config.js';

const [,, subdomain, brandName, email, location] = process.argv;

if (!subdomain || !brandName || !email) {
  console.error('Usage: node scripts/provision-tenant.js <subdomain> <brandName> <email> [location]');
  console.error('Example: node scripts/provision-tenant.js acme "Acme Marketing" admin@acme.com "Denver, CO"');
  process.exit(1);
}

await connectDB();

try {
  const result = await provisionTenant({
    subdomain,
    brandName,
    brandLocation: location || '',
    ownerEmail: email,
  });

  console.log(`\nTenant provisioned successfully!`);
  console.log(`  Domain:   ${result.domain}`);
  console.log(`  Database: ${result.dbName}`);
  console.log(`  Admin:    https://${result.domain}/admin`);
  console.log(`  Site:     https://${result.domain}`);
} catch (err) {
  console.error('Provisioning failed:', err.message);
  process.exit(1);
}

process.exit(0);
