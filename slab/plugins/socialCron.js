// socialCron.js — publishes due scheduled social posts across all tenants.
// Runs every minute; finds social_posts with status 'scheduled' and a past
// scheduledAt in each active tenant db, then publishes them.
import cron from 'node-cron';
import { getSlabDb, getTenantDb } from './mongo.js';
import { publishPost } from './socialPublish.js';
import { refreshTenantTokens } from './socialTokens.js';
import { generateForTenant } from './autoSocial.js';
import { reapOrphans } from './socialJobs.js';

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
        archived: { $ne: true },   // archived = soft-deleted; never auto-publish
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

// ── Opt-in autopilot: generate (and optionally publish) on a per-tenant cadence ─
// Consumes tenant.autoSocial { enabled, cadence, channels, standingPrompt,
// count, autoPublish, useTrends, lastRunAt }. Review-first by default — only
// posts live when autoPublish is explicitly true. Runs hourly; each tenant fires
// when enough time has elapsed for its cadence.
const CADENCE_HOURS = { daily: 23, '3x_week': 56, weekly: 167 };

async function runAutoSocial() {
  const slab = getSlabDb();
  const now = Date.now();
  const tenants = await slab.collection('tenants')
    .find({ status: { $in: ['active', 'preview'] }, 'autoSocial.enabled': true }).toArray();

  for (const tenant of tenants) {
    const cfg = tenant.autoSocial || {};
    const minHours = CADENCE_HOURS[cfg.cadence];
    if (!minHours) continue;                                   // 'off' / unset → skip
    const last = cfg.lastRunAt ? new Date(cfg.lastRunAt).getTime() : 0;
    if (now - last < minHours * 3600000) continue;             // not due yet
    if (!tenant.db) continue;

    let db;
    try { db = getTenantDb(tenant.db); } catch { continue; }
    // Claim immediately so an overlapping tick can't double-fire this tenant.
    await slab.collection('tenants').updateOne({ _id: tenant._id }, { $set: { 'autoSocial.lastRunAt': new Date() } });

    try {
      const out = await generateForTenant(tenant, db, {
        count: Math.max(1, Math.min(10, cfg.count || 3)),
        mode: cfg.autoPublish ? 'publish' : 'suggest',
        platforms: (Array.isArray(cfg.channels) && cfg.channels.length) ? cfg.channels : null,
        direction: cfg.standingPrompt || '',
        useTrends: cfg.useTrends !== false,
        critic: cfg.critic !== false,
        createdBy: 'autopilot',
      });
      console.log(`[AutoSocial] ${tenant.db}: created ${out.created}, published ${out.published || 0} (cadence ${cfg.cadence}, ${cfg.autoPublish ? 'publish' : 'review'})`);
    } catch (err) {
      console.error(`[AutoSocial] ${tenant.db} failed:`, err.message);
    }
  }
}

export function startAutoSocialCron() {
  // Top of every hour — fire any tenant whose cadence is due.
  cron.schedule('0 * * * *', () => {
    runAutoSocial().catch(err => console.error('[AutoSocial] run failed:', err.message));
  });
  console.log('[Cron] Auto-social autopilot scheduled (hourly, cadence-gated)');
}

// Boot-time: any post left at 'publishing' was interrupted mid-publish by a
// restart (publishing now runs in the background, detached from the request).
// Mark them failed so they don't appear to hang forever; the admin can re-publish.
export async function reapStuckSocialPosts() {
  try {
    const slab = getSlabDb();
    const tenants = await slab.collection('tenants')
      .find({ status: { $in: ['active', 'preview'] } }).project({ db: 1 }).toArray();
    const dbNames = [...new Set(tenants.map(t => t.db).filter(Boolean))];
    let total = 0;
    for (const dbName of dbNames) {
      let db; try { db = getTenantDb(dbName); } catch { continue; }
      const r = await db.collection('social_posts').updateMany(
        { status: 'publishing' },
        { $set: { status: 'failed', updatedAt: new Date() }, $push: { results: { ok: false, error: 'Interrupted by a server restart — re-publish to retry', at: new Date() } } },
      ).catch(() => ({ modifiedCount: 0 }));
      total += r.modifiedCount || 0;
    }
    if (total) console.log(`[SocialCron] reaped ${total} post(s) stuck in 'publishing' on boot`);
  } catch (err) { console.error('[SocialCron] post reap failed:', err.message); }
}

// Boot-time: fail any Agent Studio jobs orphaned mid-run by a restart.
export async function reapAllSocialJobs() {
  try {
    const slab = getSlabDb();
    const tenants = await slab.collection('tenants')
      .find({ status: { $in: ['active', 'preview'] } }).project({ db: 1 }).toArray();
    const dbNames = [...new Set(tenants.map(t => t.db).filter(Boolean))];
    let total = 0;
    for (const dbName of dbNames) {
      let db; try { db = getTenantDb(dbName); } catch { continue; }
      total += await reapOrphans(db);
    }
    if (total) console.log(`[AutoSocial] reaped ${total} orphaned job(s) on boot`);
  } catch (err) { console.error('[AutoSocial] reap failed:', err.message); }
}
