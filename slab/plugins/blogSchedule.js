// ─────────────────────────────────────────────────────────────────────────────
// blogSchedule.js — calendar-aware auto-slotting + publishing for written
// content (blog, newsletter, help articles, snippets).
//
// The mirror of socialSchedule.js/socialCron.js, but tuned to how content
// actually publishes: articles go out at a READING hour, roughly ONE PER DAY,
// spaced days apart rather than packed three-to-a-day like social. Packing
// long-form the way you pack social posts buries yesterday's article.
//
// Status model on the `blog` collection:
//   draft      → not public, no date
//   scheduled  → scheduledAt in the future; the publisher flips it to published
//   published  → public, publishedAt set
// A post that already has publishedAt keeps it when rescheduled — the date the
// piece went live is history, not a knob.
// ─────────────────────────────────────────────────────────────────────────────

import { getSlabDb, getTenantDb } from './mongo.js';
import { scheduleIntervalJob } from './cronSafe.js';

// Publishing hours, best first. One article a day is the default cadence; the
// extra hours only come into play when a batch is larger than the day window.
const PUBLISH_HOURS = [9, 14];
const DEFAULT_PER_DAY = 1;

const dayKey = (dt) => `${dt.getFullYear()}-${dt.getMonth()}-${dt.getDate()}`;

/**
 * Suggest `count` future publish slots that don't collide with what's already
 * scheduled or recently published.
 *
 * opts:
 *   hours      [9, 14]  candidate local hours, in preference order
 *   perDay     1        max posts per day
 *   spacingDays 1       minimum days between slots (2 = every other day)
 *   startToday false    allow a slot later today
 *   from       Date     start looking from here instead of now
 */
export async function suggestBlogSlots(db, count = 1, opts = {}) {
  const hours = Array.isArray(opts.hours) && opts.hours.length ? opts.hours : PUBLISH_HOURS;
  const perDay = Math.max(1, opts.perDay || DEFAULT_PER_DAY);
  const spacing = Math.max(1, opts.spacingDays || 1);
  const now = opts.from instanceof Date ? new Date(opts.from) : new Date();

  // Days already spoken for — both scheduled AND recently published, so an
  // auto-slot run doesn't drop an article on top of one that just went out.
  const taken = {};
  try {
    const horizon = new Date(now); horizon.setDate(horizon.getDate() - 3);
    const rows = await db.collection('blog')
      .find({
        $or: [
          { status: 'scheduled', scheduledAt: { $gte: horizon } },
          { status: 'published', publishedAt: { $gte: horizon } },
        ],
      })
      .project({ scheduledAt: 1, publishedAt: 1 }).toArray();
    for (const r of rows) {
      const dt = new Date(r.scheduledAt || r.publishedAt);
      if (Number.isNaN(dt.getTime())) continue;
      (taken[dayKey(dt)] = taken[dayKey(dt)] || []).push(dt.getHours());
    }
  } catch { /* no calendar yet — every slot is free */ }

  const slots = [];
  const cursor = new Date(now);
  cursor.setDate(cursor.getDate() + (opts.startToday ? 0 : 1));
  cursor.setHours(0, 0, 0, 0);

  let guard = 0;
  while (slots.length < count && guard++ < 800) {
    const key = dayKey(cursor);
    const used = taken[key] || [];
    let placedToday = 0;
    for (const h of hours) {
      if (slots.length >= count || used.length + placedToday >= perDay) break;
      if (used.includes(h)) continue;
      const slot = new Date(cursor);
      slot.setHours(h, 0, 0, 0);
      if (slot > now) { slots.push(slot); used.push(h); placedToday++; }
    }
    taken[key] = used;
    // Respect the spacing gap only once something actually landed on this day —
    // otherwise a fully-booked day would still push the cursor a gap forward.
    cursor.setDate(cursor.getDate() + (placedToday ? spacing : 1));
  }
  return slots.slice(0, count);
}

/**
 * Auto-slot drafts onto the calendar. Picks the oldest drafts first (they've
 * waited longest), assigns each the next open slot, and flips them to
 * 'scheduled'. Returns { scheduled: [{_id, title, at}], remaining }.
 *
 * Only touches posts that have a title AND body — auto-publishing an empty
 * shell onto a live site is exactly the kind of thing automation must not do.
 */
export async function autoSlotDrafts(db, { limit = 10, ids = null, ...slotOpts } = {}) {
  const q = {
    status: 'draft',
    title: { $nin: [null, ''] },
    content: { $nin: [null, ''] },
  };
  if (Array.isArray(ids) && ids.length) {
    const { ObjectId } = await import('mongodb');
    const oids = [];
    for (const id of ids) { try { oids.push(new ObjectId(String(id))); } catch { /* skip */ } }
    if (!oids.length) return { scheduled: [], remaining: 0 };
    q._id = { $in: oids };
  }

  let drafts = [];
  try {
    drafts = await db.collection('blog').find(q)
      .sort({ createdAt: 1 }).limit(Math.max(1, Math.min(limit, 50))).toArray();
  } catch { return { scheduled: [], remaining: 0 }; }
  if (!drafts.length) return { scheduled: [], remaining: 0 };

  const slots = await suggestBlogSlots(db, drafts.length, slotOpts);
  const scheduled = [];
  for (let i = 0; i < drafts.length && i < slots.length; i++) {
    const d = drafts[i];
    const at = slots[i];
    const r = await db.collection('blog').updateOne(
      { _id: d._id, status: 'draft' },                 // claim: never re-slot a post someone just published
      { $set: { status: 'scheduled', scheduledAt: at, updatedAt: new Date() } },
    );
    if (r.modifiedCount === 1) scheduled.push({ _id: d._id, title: d.title, at });
  }
  return { scheduled, remaining: Math.max(0, drafts.length - scheduled.length) };
}

/** Put a single post on the calendar (or move it). */
export async function schedulePost(db, id, at) {
  const { ObjectId } = await import('mongodb');
  const when = at instanceof Date ? at : new Date(at);
  if (Number.isNaN(when.getTime())) throw Object.assign(new Error('Invalid publish date'), { status: 400 });
  const _id = new ObjectId(String(id));
  const r = await db.collection('blog').updateOne(
    { _id },
    { $set: { status: 'scheduled', scheduledAt: when, updatedAt: new Date() } },
  );
  if (!r.matchedCount) throw Object.assign(new Error('Post not found'), { status: 404 });
  return when;
}

/** Pull a post off the calendar, back to draft. */
export async function unschedulePost(db, id) {
  const { ObjectId } = await import('mongodb');
  await db.collection('blog').updateOne(
    { _id: new ObjectId(String(id)) },
    { $set: { status: 'draft', scheduledAt: null, updatedAt: new Date() } },
  );
}

// ── Publisher ────────────────────────────────────────────────────────────────
// Flips due scheduled posts to published across every active tenant. Idempotent
// and catch-up safe: it publishes everything with scheduledAt <= now, guarded by
// an atomic claim, so a late run simply catches up. Deliberately an interval
// job, never node-cron — this host's clock jitter makes node-cron skip ticks
// outright (see cronSafe.js).

export async function runDuePosts() {
  const slab = getSlabDb();
  const now = new Date();
  let total = 0;

  const tenants = await slab.collection('tenants')
    .find({ status: { $in: ['active', 'preview'] } })
    .project({ db: 1 }).toArray();
  const dbNames = [...new Set(tenants.map((t) => t.db).filter(Boolean))];

  for (const dbName of dbNames) {
    let db;
    try { db = getTenantDb(dbName); } catch { continue; }

    let due;
    try {
      due = await db.collection('blog')
        .find({ status: 'scheduled', scheduledAt: { $lte: now } })
        .sort({ scheduledAt: 1 }).toArray();
    } catch { continue; }
    if (!due.length) continue;

    for (const post of due) {
      // Atomic claim on the status, so two overlapping runs can't both publish.
      const claim = await db.collection('blog').updateOne(
        { _id: post._id, status: 'scheduled' },
        {
          $set: {
            status: 'published',
            // First publish stamps the date; a re-run of an already-live piece
            // keeps its original publishedAt.
            publishedAt: post.publishedAt || post.scheduledAt || now,
            updatedAt: now,
          },
        },
      );
      if (claim.modifiedCount === 1) {
        total++;
        console.log(`[BlogCron] ${dbName}: published "${post.title}" (${post._id})`);
      }
    }
  }
  return total;
}

export function startBlogScheduler() {
  scheduleIntervalJob('blog-publish', 60 * 1000, runDuePosts, { label: 'Scheduled content publisher' });
}
