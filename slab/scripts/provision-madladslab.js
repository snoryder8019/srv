/**
 * One-time script: Provision madladslab.com as a Slab tenant.
 * Run from /srv/slab: node scripts/provision-madladslab.js
 */
import { connectDB } from '../plugins/mongo.js';
import { provisionTenant } from '../plugins/provision.js';

async function main() {
  await connectDB();
  console.log('[provision] Connected to MongoDB');

  try {
    const result = await provisionTenant({
      subdomain: 'madladslab',
      brandName: 'MadLadsLab',
      brandLocation: '',
      ownerEmail: 'snoryder8019@gmail.com',
      customDomain: 'madladslab.com',
      platform: 'madladslab',
    });

    console.log('[provision] Tenant created successfully:');
    console.log(`  Domain: ${result.domain}`);
    console.log(`  Database: ${result.dbName}`);
    console.log(`  Slug: ${result.slug}`);
    console.log('\nNext steps:');
    console.log('  1. Update Apache configs to proxy madladslab.com → port 3602');
    console.log('  2. Activate tenant via superadmin panel');
  } catch (err) {
    console.error('[provision] Failed:', err.message);
  }

  process.exit(0);
}

main();
