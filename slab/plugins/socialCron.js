// socialCron.js — publishes due scheduled social posts across all tenants.
// Runs every minute; finds social_posts with status 'scheduled' and a past
// scheduledAt in each active tenant db, then publishes them.
import { getSlabDb, getTenantDb } from './mongo.js';
import { scheduleDailyJob, scheduleIntervalJob } from './cronSafe.js';
import { recordCronRun } from './observe.js';
import { publishPost, publishToPlatform } from './socialPublish.js';
import { refreshTenantTokens } from './socialTokens.js';
import { generateForTenant } from './autoSocial.js';
import { suggestSlots } from './socialSchedule.js';
import { scoreLivePosts } from './socialScore.js';
import { reapOrphans } from './socialJobs.js';
import { isGridLocked, postHitsInstagramGrid, GRID_ROW } from './socialGrid.js';

// Claim a post (status → publishing), publish it, and write back the result.
// Shared by the normal due-post loop and the grid-lock triad release. `fromStatus`
// is the status we expect to claim from ('scheduled' or 'held'). Returns true if we
// claimed+attempted it, false if another run got there first.
async function publishOne(db, dbName, post, accountMap, opts = {}) {
  const { fromStatus = 'scheduled', platforms = null, priorResults = [] } = opts;
  const claim = await db.collection('social_posts').updateOne(
    { _id: post._id, status: fromStatus },
    { $set: { status: 'publishing', updatedAt: new Date() } },
  );
  if (claim.modifiedCount !== 1) return false;
  try {
    // `platforms` override publishes only a subset (used to publish just the held IG
    // portion on triad release); priorResults carries the already-published platforms.
    const target = platforms ? { ...post, platforms } : post;
    const results = [...priorResults, ...(await publishPost(target, accountMap))];
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
  return true;
}

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
      }).sort({ scheduledAt: 1 }).toArray();   // oldest-due first → mural tiles keep order
    } catch { continue; }
    if (!due.length) continue;

    // A 9-grid mural is nine tiles scheduled ~90s apart so Instagram's profile grid
    // reassembles them without tripping burst/spam heuristics. If the scheduler ever
    // runs behind (a delayed tick, a restart), several tiles come due at once — and
    // publishing them all in this single pass would fire them seconds apart, undoing
    // the spacing. So publish AT MOST ONE tile per mural per run: the rest wait for
    // the next minute. Non-mural posts (no muralId) are unaffected.
    const muralSeenThisRun = new Set();

    // Load this tenant's connected accounts once
    let accountMap = {};
    try {
      const accounts = await db.collection('social_accounts').find({}).toArray();
      for (const a of accounts) accountMap[a.platform] = a;
    } catch { /* publish will error per-platform */ }

    // Grid-lock: while a mural is protected, non-mural IG feed posts are sandbagged
    // (status → held) instead of published, and released a full row (3) at a time so
    // the mural below stays aligned. Read the lock once per tenant per run.
    const gridLocked = await isGridLocked(db).catch(() => false);

    for (const post of due) {
      // Throttle mural tiles to one per mural per run (see note above).
      if (post.muralId) {
        if (muralSeenThisRun.has(post.muralId)) continue;
        muralSeenThisRun.add(post.muralId);
      }

      // Sandbag: a due IG feed post that would break grid alignment is held until its
      // row of 3 completes (released below). Per-platform split: only the Instagram
      // portion waits — any OTHER platforms (FB/X/…) publish right now, on time. We
      // mutate platforms → ['instagram'] so every later release path (triad or the
      // manual unlock) republishes only IG and can't double-post the others.
      if (gridLocked && postHitsInstagramGrid(post)) {
        const others = (post.platforms || []).filter(p => p !== 'instagram');
        const claim = await db.collection('social_posts').updateOne(
          { _id: post._id, status: 'scheduled' },
          { $set: { status: 'held', heldAt: new Date(), platforms: ['instagram'], origPlatforms: post.platforms || [], updatedAt: new Date() } },
        );
        if (claim.modifiedCount !== 1) continue;
        if (others.length) {
          const splitResults = [];
          for (const p of others) splitResults.push(await publishToPlatform(p, post, accountMap[p]));
          await db.collection('social_posts').updateOne({ _id: post._id },
            { $set: { results: splitResults, updatedAt: new Date() } });
          console.log(`[SocialCron] ${dbName}: post ${post._id} split — published ${others.join(',')} now, IG held for its row`);
        }
        continue;
      }

      await publishOne(db, dbName, post, accountMap);
    }

    // Triad release: whenever ≥3 IG feed posts are sandbagged, publish the oldest 3
    // together as one complete row — this preserves the mural's column alignment.
    // Leftovers (<3) keep waiting for the next post to fill the row.
    if (gridLocked) {
      let held = await db.collection('social_posts').find({
        status: 'held', archived: { $ne: true }, platforms: 'instagram', format: { $ne: 'story' },
      }).sort({ scheduledAt: 1, heldAt: 1 }).toArray().catch(() => []);
      while (held.length >= GRID_ROW) {
        const row = held.splice(0, GRID_ROW);
        // platforms is already ['instagram'] on held docs (the split trimmed it), and
        // p.results holds the already-published non-IG platforms → merge them in.
        for (const p of row) await publishOne(db, dbName, p, accountMap, { fromStatus: 'held', priorResults: p.results || [] });
        console.log(`[SocialCron] ${dbName}: released a grid row of ${GRID_ROW} held posts`);
      }
    }
  }
}

export function startSocialScheduler() {
  // NOTE: use setInterval, NOT cron.schedule('* * * * *'). On this WSL2 host the
  // VM's virtualized clock jitters enough that node-cron flags most minute-ticks as
  // "missed execution" and SKIPS them, so due posts sat unpublished for minutes at a
  // time (the mural tiles were the tell). runDuePosts is idempotent + catch-up-safe
  // (it publishes everything with scheduledAt <= now, guarded by an atomic claim),
  // so a plain interval that merely fires "often enough" — even a little late — is
  // strictly more reliable here than node-cron's skip-on-drift behaviour. A
  // reentrancy guard prevents overlap if a run runs long.
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    const t0 = Date.now();
    try {
      await runDuePosts();
      recordCronRun({ name: 'social-scheduler', label: 'Social post scheduler', kind: 'interval', ok: true, durationMs: Date.now() - t0 });
    } catch (err) {
      console.error('[SocialCron] run failed:', err.message);
      recordCronRun({ name: 'social-scheduler', label: 'Social post scheduler', kind: 'interval', ok: false, durationMs: Date.now() - t0, error: err.message });
    } finally { running = false; }
  };
  setInterval(tick, 60 * 1000);
  setTimeout(tick, 15 * 1000);   // early run to drain backlog after a restart (once DB is connected)
  console.log('[Cron] Social post scheduler started (setInterval 60s — WSL2 timer-jitter tolerant)');
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
  // WSL-skip-tolerant (node-cron drops daily ticks on this host — tokens would expire).
  scheduleDailyJob('social-token-refresh', 4, refreshAllTokens, { label: 'Social token auto-refresh' });
}

// ── Score live posts by real engagement (builds the reliability dataset) ───────
async function runPostScoring() {
  const slab = getSlabDb();
  const tenants = await slab.collection('tenants').find({ status: { $in: ['active', 'preview'] } }).project({ db: 1 }).toArray();
  for (const t of tenants) {
    if (!t.db) continue;
    try {
      const db = getTenantDb(t.db);
      const r = await scoreLivePosts(db, { db: t.db });
      if (r.scored) console.log(`[SocialScore] ${t.db}: scored ${r.scored}/${r.examined} live posts`);
    } catch (e) { console.warn(`[SocialScore] ${t.db} failed:`, e.message); }
  }
}

export function startSocialScoring() {
  // Daily at 5:00 AM — engagement has settled by then; scores yesterday's-and-older live posts.
  scheduleDailyJob('social-scoring', 5, runPostScoring, { label: 'Social post scoring' });
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
        sources: (Array.isArray(cfg.promote) && cfg.promote.length) ? cfg.promote : null,   // blog/portfolio/careers to follow
        leadGen: !!cfg.leadGen,                                                              // drive newsletter signups back to the site
        assetTags: (Array.isArray(cfg.assetTags) && cfg.assetTags.length) ? cfg.assetTags : null,  // use own tagged assets as backgrounds
        createdBy: 'autopilot',
      });
      // Auto-slot: drop the fresh drafts onto the calendar (well-spaced open slots)
      // so the pipeline is visible ahead of time. Only when NOT already auto-publishing.
      let slotted = 0;
      if (cfg.autoSlot && !cfg.autoPublish && Array.isArray(out.items) && out.items.length) {
        try {
          const ids = out.items.map(i => i._id).filter(Boolean);
          const slots = await suggestSlots(db, ids.length);
          for (let i = 0; i < ids.length && i < slots.length; i++) {
            await db.collection('social_posts').updateOne({ _id: ids[i] },
              { $set: { status: 'scheduled', scheduledAt: slots[i], suggestion: false, updatedAt: new Date() } });
            slotted++;
          }
        } catch (e) { console.warn(`[AutoSocial] ${tenant.db} auto-slot failed:`, e.message); }
      }
      console.log(`[AutoSocial] ${tenant.db}: created ${out.created}, published ${out.published || 0}, slotted ${slotted} (cadence ${cfg.cadence}, ${cfg.autoPublish ? 'publish' : cfg.autoSlot ? 'auto-slot' : 'review'})`);
    } catch (err) {
      console.error(`[AutoSocial] ${tenant.db} failed:`, err.message);
    }
  }
}

export function startAutoSocialCron() {
  // Fire any tenant whose cadence is due. runAutoSocial is self-gating (per-tenant
  // lastRunAt claim), so a plain 20-min interval is safe and — unlike node-cron's
  // skip-prone hourly tick — reliably catches every tenant as it comes due.
  scheduleIntervalJob('autopilot', 20 * 60 * 1000, runAutoSocial, { label: 'Auto-social autopilot' });
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
