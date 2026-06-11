// socialCron.js — publishes due scheduled social posts across all tenants.
// Runs every minute; finds social_posts with status 'scheduled' and a past
// scheduledAt in each active tenant db, then publishes them.
import cron from 'node-cron';
import { getSlabDb, getTenantDb } from './mongo.js';
import { publishPost } from './socialPublish.js';
import { refreshTenantTokens } from './socialTokens.js';

async function runDuePosts() {
  const slab = getSlabDb();
  const now = new Date();

  // Unique tenant dbs across active/preview registry docs
  const tenants = await slab.collection('tenants')
    .find({ status: { $in: ['active', 'preview'] } })
    .project({ db: 1 }).toArray();
  const dbNames = [...new Set(tenants.map(t => t.db).filter(Boolean))];

  for (const dbName of dbNames) {
    let db;
    try { db = getTenantDb(dbName); } catch { continue; }

    let due;
    try {
      due = await db.collection('social_posts').find({
        status: 'scheduled',
        scheduledAt: { $lte: now },
      }).toArray();
    } catch { continue; }
    if (!due.length) continue;

    // Load this tenant's connected accounts once
    let accountMap = {};
    try {
      const accounts = await db.collection('social_accounts').find({}).toArray();
      for (const a of accounts) accountMap[a.platform] = a;
    } catch { /* publish will error per-platform */ }

    for (const post of due) {
      // Claim the post first to avoid a double-publish if a run overlaps
      const claim = await db.collection('social_posts').updateOne(
        { _id: post._id, status: 'scheduled' },
        { $set: { status: 'publishing', updatedAt: new Date() } },
      );
      if (claim.modifiedCount !== 1) continue;

      try {
        const results = await publishPost(post, accountMap);
        const okCount = results.filter(r => r.ok).length;
        const finalStatus = okCount === 0 ? 'failed' : okCount === results.length ? 'published' : 'partial';
        await db.collection('social_posts').updateOne(
          { _id: post._id },
          { $set: { status: finalStatus, results, publishedAt: new Date(), updatedAt: new Date() } },
        );
        console.log(`[SocialCron] ${dbName}: post ${post._id} → ${finalStatus} (${okCount}/${results.length})`);
      } catch (err) {
        await db.collection('social_posts').updateOne(
          { _id: post._id },
          { $set: { status: 'failed', updatedAt: new Date() }, $push: { results: { ok: false, error: err.message, at: new Date() } } },
        );
        console.error(`[SocialCron] ${dbName}: post ${post._id} failed:`, err.message);
      }
    }
  }
}

export function startSocialScheduler() {
  cron.schedule('* * * * *', () => {
    runDuePosts().catch(err => console.error('[SocialCron] run failed:', err.message));
  });
  console.log('[Cron] Social post scheduler started (every minute)');
}

// Daily: keep Meta (FB/IG/Threads) tokens long-lived / permanent across tenants.
async function refreshAllTokens() {
  const slab = getSlabDb();
  const tenants = await slab.collection('tenants')
    .find({ status: { $in: ['active', 'preview'] } }).project({ db: 1 }).toArray();
  const dbNames = [...new Set(tenants.map(t => t.db).filter(Boolean))];

  for (const dbName of dbNames) {
    let db;
    try { db = getTenantDb(dbName); } catch { continue; }
    try {
      const has = await db.collection('social_accounts')
        .countDocuments({ platform: { $in: ['facebook', 'instagram', 'threads'] } });
      if (!has) continue;
      const res = await refreshTenantTokens(db);
      const acted = res.filter(r => r.refreshed || r.error);
      if (acted.length) console.log(`[SocialTokens] ${dbName}:`, JSON.stringify(acted));
    } catch (err) {
      console.error(`[SocialTokens] ${dbName} failed:`, err.message);
    }
  }
}

export function startSocialTokenRefresh() {
  // Daily at 4:00 AM — refresh any token within 10 days of expiry / not yet permanent.
  cron.schedule('0 4 * * *', () => {
    refreshAllTokens().catch(err => console.error('[SocialTokens] job failed:', err.message));
  });
  console.log('[Cron] Social token auto-refresh scheduled (daily 4:00 AM)');
}
