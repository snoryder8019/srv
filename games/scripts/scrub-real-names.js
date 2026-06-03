#!/usr/bin/env node
/**
 * One-off privacy scrub: replace any stored displayName that looks like a real
 * name ("First Last") or email with the anonymized platform handle.
 * Mirrors safeDisplayName() in routes/internal.js.
 *
 * Usage:  node scripts/scrub-real-names.js          (dry run, default)
 *         node scripts/scrub-real-names.js --apply   (write changes)
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const crypto = require('crypto');
const { MongoClient } = require('mongodb');

const APPLY = process.argv.includes('--apply');

function anonHandle(platformId) {
  return 'user_' + crypto.createHash('sha256').update(String(platformId)).digest('hex').slice(0, 8);
}
function isUnsafe(name) {
  const n = (typeof name === 'string' ? name : '').trim();
  if (!n) return false;            // empty -> handled by 'Player' fallback at read time
  return /\s/.test(n) || /@/.test(n);
}

// collection -> field holding the player identity to key the handle on
const TARGETS = [
  { coll: 'wallets',         idField: 'platformId' },
  { coll: 'webgame_results', idField: 'platformId' },
];

(async () => {
  const client = new MongoClient(process.env.DB_URL);
  await client.connect();
  const db = client.db();
  let grandTotal = 0;

  for (const { coll, idField } of TARGETS) {
    const cur = db.collection(coll).find({ displayName: { $exists: true, $ne: null } });
    let n = 0;
    while (await cur.hasNext()) {
      const doc = await cur.next();
      if (!isUnsafe(doc.displayName)) continue;
      const pid = doc[idField];
      if (pid == null) { console.warn(`[${coll}] ${doc._id} unsafe name but no ${idField}; skipping`); continue; }
      const safe = anonHandle(pid);
      n++;
      console.log(`[${coll}] "${doc.displayName}" -> "${safe}"`);
      if (APPLY) await db.collection(coll).updateOne({ _id: doc._id }, { $set: { displayName: safe } });
    }
    console.log(`[${coll}] ${n} document(s) ${APPLY ? 'updated' : 'would be updated'}`);
    grandTotal += n;
  }

  console.log(`\n${APPLY ? 'APPLIED' : 'DRY RUN'} — ${grandTotal} total document(s) ${APPLY ? 'scrubbed' : 'flagged'}.`);
  if (!APPLY && grandTotal) console.log('Re-run with --apply to write changes.');
  await client.close();
})().catch((e) => { console.error(e); process.exit(1); });
