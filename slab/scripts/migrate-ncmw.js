#!/usr/bin/env node
/**
 * Update nocometalworkz tenant — shift domain + load credentials
 *
 * What this does:
 *   1. Updates existing tenant doc: sets customDomain, owner email, Google OAuth creds
 *   2. Creates custom domain alias for nocometalworkz.com
 *   3. Ensures admin user exists in tenant DB
 *
 * Usage:
 *   node scripts/migrate-ncmw.js              # dry run (preview only)
 *   node scripts/migrate-ncmw.js --execute    # actually migrate
 */

import { MongoClient } from 'mongodb';
import dotenv from 'dotenv';
import { encrypt } from '../plugins/crypto.js';
dotenv.config();

const DRY_RUN = !process.argv.includes('--execute');

const SLAB_DB       = process.env.SLAB_DB || 'slab';
const TARGET_DB     = 'slab_nocometalworkz';
const SUBDOMAIN     = 'nocometalworkz';
const CUSTOM_DOMAIN = 'nocometalworkz.com';
const PRIMARY_DOMAIN = `${SUBDOMAIN}.madladslab.com`;
const OWNER_EMAIL   = 'w2marketing.scott@gmail.com';

// Google OAuth credentials from environment
const GOOGLE_OAUTH = {
  clientId: process.env.GGL_CID,
  clientSecret: process.env.GGL_SEC,
};

async function main() {
  console.log(DRY_RUN
    ? '\n=== DRY RUN — no changes will be made ===\n'
    : '\n=== EXECUTING UPDATE ===\n');

  const client = new MongoClient(process.env.DB_URL);
  await client.connect();

  const slabDb   = client.db(SLAB_DB);
  const tenantDb = client.db(TARGET_DB);

  // ── Find existing tenant ───────────────────────────────────────────────

  const tenant = await slabDb.collection('tenants').findOne({
    $or: [{ domain: PRIMARY_DOMAIN }, { 'meta.subdomain': SUBDOMAIN }],
  });

  if (!tenant) {
    console.error(`Tenant "${SUBDOMAIN}" not found in slab.tenants. Run provisioning first.`);
    process.exit(1);
  }

  console.log(`Found tenant: ${tenant.domain} (db: ${tenant.db}, status: ${tenant.status})`);
  console.log(`  Current customDomain: ${tenant.meta?.customDomain || '(none)'}`);
  console.log(`  Current ownerEmail:   ${tenant.meta?.ownerEmail}`);
  console.log(`  Current OAuth:        ${tenant.public?.googleOAuthClientId ? 'configured' : 'not set'}`);

  // ── Step 1: Update tenant doc ──────────────────────────────────────────

  const encryptedSecret = encrypt(GOOGLE_OAUTH.clientSecret);
  const now = new Date();

  const updates = {
    'meta.customDomain': CUSTOM_DOMAIN,
    'meta.ownerEmail': OWNER_EMAIL,
    'public.googleOAuthClientId': GOOGLE_OAUTH.clientId,
    'secrets.googleOAuthSecret': encryptedSecret,
    'brandSetupComplete': true,
    'updatedAt': now,
  };

  console.log(`\nUpdating tenant doc:`);
  console.log(`  customDomain → ${CUSTOM_DOMAIN}`);
  console.log(`  ownerEmail   → ${OWNER_EMAIL}`);
  console.log(`  Google OAuth → pre-loaded (client ID + encrypted secret)`);

  if (!DRY_RUN) {
    await slabDb.collection('tenants').updateOne(
      { _id: tenant._id },
      { $set: updates },
    );
    console.log('[OK] Tenant document updated');
  }

  // ── Step 2: Create/update custom domain alias ──────────────────────────

  const existingAlias = await slabDb.collection('tenants').findOne({ domain: CUSTOM_DOMAIN });

  if (existingAlias) {
    console.log(`\nCustom domain alias already exists (${CUSTOM_DOMAIN}) — updating`);
    if (!DRY_RUN) {
      await slabDb.collection('tenants').updateOne(
        { domain: CUSTOM_DOMAIN },
        {
          $set: {
            db: tenant.db,
            status: tenant.status,
            brand: tenant.brand,
            s3Prefix: tenant.s3Prefix,
            platform: tenant.platform || 'slab',
            'public.googleOAuthClientId': GOOGLE_OAUTH.clientId,
            'secrets.googleOAuthSecret': encryptedSecret,
            'meta.customDomain': CUSTOM_DOMAIN,
            'meta.ownerEmail': OWNER_EMAIL,
            'meta.isPrimaryAlias': false,
            'brandSetupComplete': true,
            updatedAt: now,
          },
        },
      );
      console.log('[OK] Alias updated');
    }
  } else {
    console.log(`\nCreating custom domain alias: ${CUSTOM_DOMAIN} → ${tenant.db}`);
    if (!DRY_RUN) {
      await slabDb.collection('tenants').insertOne({
        domain: CUSTOM_DOMAIN,
        db: tenant.db,
        status: tenant.status,
        platform: tenant.platform || 'slab',
        brand: tenant.brand,
        brandSetupComplete: true,
        s3Prefix: tenant.s3Prefix,
        public: {
          ...tenant.public,
          googleOAuthClientId: GOOGLE_OAUTH.clientId,
        },
        secrets: {
          ...tenant.secrets,
          googleOAuthSecret: encryptedSecret,
        },
        meta: {
          ...tenant.meta,
          customDomain: CUSTOM_DOMAIN,
          ownerEmail: OWNER_EMAIL,
          isPrimaryAlias: false,
        },
        createdAt: now,
        updatedAt: now,
      });
      console.log('[OK] Alias created');
    }
  }

  // ── Step 3: Ensure admin user in tenant DB ─────────────────────────────

  const adminUser = await tenantDb.collection('users').findOne({ email: OWNER_EMAIL });
  if (adminUser) {
    console.log(`\nAdmin user exists: ${OWNER_EMAIL} (isAdmin: ${adminUser.isAdmin}, isOwner: ${adminUser.isOwner})`);
    if (!adminUser.isAdmin || !adminUser.isOwner) {
      if (!DRY_RUN) {
        await tenantDb.collection('users').updateOne(
          { email: OWNER_EMAIL },
          { $set: { isAdmin: true, isOwner: true } },
        );
        console.log('[OK] Elevated to admin + owner');
      }
    }
  } else {
    console.log(`\nCreating admin user: ${OWNER_EMAIL}`);
    if (!DRY_RUN) {
      await tenantDb.collection('users').insertOne({
        email: OWNER_EMAIL,
        displayName: 'Scott',
        isAdmin: true,
        isOwner: true,
        provider: 'provisioned',
        createdAt: now,
      });
      console.log('[OK] Admin user created');
    }
  }

  // ── Summary ─────────────────────────────────────────────────────────────

  console.log(`\n${'='.repeat(55)}`);
  console.log(`Update ${DRY_RUN ? 'preview' : 'complete'}!`);
  console.log(`  Primary:  ${PRIMARY_DOMAIN}`);
  console.log(`  Custom:   ${CUSTOM_DOMAIN}`);
  console.log(`  Database: ${tenant.db}`);
  console.log(`  OAuth:    pre-loaded`);

  if (DRY_RUN) {
    console.log(`\nRun with --execute to apply changes:`);
    console.log(`  node scripts/migrate-ncmw.js --execute`);
  } else {
    console.log(`\nNext steps:`);
    console.log(`  1. Apache: point nocometalworkz.com → port 3602 (slab)`);
    console.log(`     Run: node -e "import {generateApacheConf,enableSite,reloadApache} from './plugins/provision.js'; generateApacheConf('nocometalworkz.com'); enableSite('nocometalworkz.com'); reloadApache();"`);
    console.log(`  2. SSL:  certbot --apache -d nocometalworkz.com -d www.nocometalworkz.com`);
    console.log(`  3. Update Google OAuth redirect URI in Google Console:`);
    console.log(`     https://nocometalworkz.com/auth/google/callback`);
    console.log(`  4. Test: https://nocometalworkz.com/admin`);
    console.log(`  5. Optional: stop standalone nocometalworkz (port 3002)`);
  }

  await client.close();
}

main().catch(err => {
  console.error('Update failed:', err);
  process.exit(1);
});
