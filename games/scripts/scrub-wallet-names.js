'use strict';

/**
 * scrub-wallet-names.js — one-time privacy remediation for the wallets collection.
 *
 * Background: GET /api/wallet/me used to write `req.user.displayName` (the Google
 * real name) into wallets.displayName, which then surfaced on the public chip
 * leaderboard. The read endpoint is now fixed to use username.displayFor(), but
 * rows written before the fix still hold real names. This rewrites every wallet's
 * displayName to the privacy-safe generated handle, looked up by platformId.
 *
 * Usage:
 *   node scripts/scrub-wallet-names.js          # DRY RUN (default) — reports only
 *   DRY_RUN=0 node scripts/scrub-wallet-names.js  # APPLY changes
 *
 * Output masks the current (leaked) value so PII is not echoed in full.
 */

const fs = require('fs');
const path = require('path');
const { MongoClient, ObjectId } = require('mongodb');
const username = require('../lib/username');

const DRY_RUN = process.env.DRY_RUN !== '0';

function loadDbUrl() {
  if (process.env.DB_URL) return process.env.DB_URL;
  const envPath = path.join(__dirname, '..', '.env');
  const line = fs.readFileSync(envPath, 'utf8').split(/\r?\n/).find(l => l.startsWith('DB_URL='));
  if (!line) throw new Error('DB_URL not found in env or .env');
  return line.slice('DB_URL='.length).trim().replace(/^["']|["']$/g, '');
}

function mask(s) {
  if (!s) return '(empty)';
  const str = String(s);
  if (str.length <= 2) return str[0] + '*';
  return str[0] + '*'.repeat(Math.min(str.length - 2, 6)) + str[str.length - 1];
}

(async () => {
  const client = new MongoClient(loadDbUrl());
  await client.connect();
  const db = client.db();

  const wallets = await db.collection('wallets').find({}).toArray();
  let toChange = 0, changed = 0, missingUser = 0, alreadyOk = 0;

  console.log(`[scrub] ${DRY_RUN ? 'DRY RUN' : 'APPLY'} — ${wallets.length} wallet row(s)\n`);

  for (const w of wallets) {
    let user = null;
    try { user = await db.collection('users').findOne({ _id: new ObjectId(w.platformId) }); } catch {}
    if (!user) {
      // No matching user (bot/dev/legacy id). Fall back to an anon handle on the id.
      missingUser++;
      const anon = 'user_' + require('crypto').createHash('sha256').update(String(w.platformId)).digest('hex').slice(0, 8);
      if (w.displayName !== anon) {
        toChange++;
        console.log(`  ${w.platformId}  ${mask(w.displayName)} -> ${anon}  (no user doc)`);
        if (!DRY_RUN) { await db.collection('wallets').updateOne({ _id: w._id }, { $set: { displayName: anon } }); changed++; }
      } else alreadyOk++;
      continue;
    }
    const safe = username.displayFor(user);
    if (w.displayName === safe) { alreadyOk++; continue; }
    toChange++;
    console.log(`  ${w.platformId}  ${mask(w.displayName)} -> ${safe}`);
    if (!DRY_RUN) { await db.collection('wallets').updateOne({ _id: w._id }, { $set: { displayName: safe } }); changed++; }
  }

  console.log(`\n[scrub] ${DRY_RUN ? 'would change' : 'changed'}: ${DRY_RUN ? toChange : changed} | already-safe: ${alreadyOk} | no-user-doc: ${missingUser}`);
  if (DRY_RUN) console.log('[scrub] DRY RUN only — re-run with DRY_RUN=0 to apply.');

  await client.close();
})().catch(e => { console.error('[scrub] error:', e.message); process.exit(1); });
