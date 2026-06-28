// ─────────────────────────────────────────────────────────────────────────────
// socialJobs.js — async runner for Agent Studio batches.
//
// Generation (LLM + SD + multi-platform compositing) takes minutes, so it can't
// block the HTTP request. enqueueJob() persists a `social_jobs` doc and returns
// immediately; an in-process queue runs jobs ONE AT A TIME (SD is the shared
// bottleneck) and streams progress into the job doc, which the Agent Studio tab
// polls. State is persisted so the UI survives reloads; the in-memory queue is
// not, so reapOrphans() fails any 'queued'/'running' doc orphaned by a restart.
// ─────────────────────────────────────────────────────────────────────────────
import { ObjectId } from 'mongodb';
import { generateForTenant } from './autoSocial.js';
import { trendSummary } from './socialListen.js';

const queue = [];        // [{ db, tenant, jobId }]
let running = false;

async function setJob(db, jobId, patch) {
  try { await db.collection('social_jobs').updateOne({ _id: jobId }, { $set: patch }); } catch { /* best effort */ }
}

async function processJob(db, tenant, jobId) {
  const job = await db.collection('social_jobs').findOne({ _id: jobId });
  if (!job || job.status !== 'queued') return;
  await setJob(db, jobId, { status: 'running', startedAt: new Date(), progress: { done: 0, total: job.count || 0, stage: 'starting' } });
  try {
    let trends = '';
    if (job.useTrends) { try { trends = await trendSummary(db, { days: 10, limit: 20 }); } catch { /* optional */ } }
    const out = await generateForTenant(tenant, db, {
      count: job.count, mode: job.mode === 'publish' ? 'publish' : 'suggest',
      platforms: (job.platforms && job.platforms.length) ? job.platforms : null,
      direction: job.direction, trends, critic: !!job.critic, style: job.style || 'solid', createdBy: job.createdBy || 'agent-studio',
      onProgress: (done, total, stage) => setJob(db, jobId, { progress: { done, total, stage } }),
    });
    await setJob(db, jobId, {
      status: 'done', finishedAt: new Date(),
      progress: { done: out.created || 0, total: out.created || 0, stage: 'done' },
      postIds: (out.items || []).map(i => i._id).filter(Boolean),
      summary: { created: out.created || 0, published: out.published || 0, failed: out.failed || 0, note: out.note || null },
    });
  } catch (err) {
    await setJob(db, jobId, { status: 'failed', finishedAt: new Date(), error: err.message || 'Generation failed' });
  }
}

async function pump() {
  if (running) return;
  running = true;
  try {
    while (queue.length) {
      const { db, tenant, jobId } = queue.shift();
      try { await processJob(db, tenant, jobId); } catch { /* keep draining */ }
    }
  } finally { running = false; }
}

// Create a queued job and kick off processing. Returns the job _id string.
export async function enqueueJob(db, tenant, opts = {}) {
  const doc = {
    type: opts.type === 'autopilot' ? 'autopilot' : 'studio',
    direction: (opts.direction || '').toString().slice(0, 600),
    count: Math.max(1, Math.min(20, parseInt(opts.count, 10) || 5)),
    platforms: Array.isArray(opts.platforms) ? opts.platforms.filter(Boolean) : [],
    useTrends: !!opts.useTrends,
    critic: !!opts.critic,
    style: ['solid', 'photo', 'auto'].includes(opts.style) ? opts.style : 'solid',
    mode: opts.mode === 'publish' ? 'publish' : 'suggest',
    status: 'queued',
    progress: { done: 0, total: 0, stage: 'queued' },
    postIds: [],
    createdBy: opts.createdBy || 'admin',
    createdAt: new Date(), startedAt: null, finishedAt: null, error: null,
  };
  const ins = await db.collection('social_jobs').insertOne(doc);
  queue.push({ db, tenant, jobId: ins.insertedId });
  setImmediate(pump);
  return ins.insertedId.toString();
}

// One job's status (for polling). Returns the doc or null.
export async function getJob(db, id) {
  try { return await db.collection('social_jobs').findOne({ _id: new ObjectId(id) }); }
  catch { return null; }
}

// Recent jobs (history list).
export async function listJobs(db, limit = 15) {
  return db.collection('social_jobs').find({}).sort({ createdAt: -1 }).limit(limit).toArray();
}

// Fail any job left queued/running by a process restart (in-memory queue is gone).
export async function reapOrphans(db) {
  try {
    const r = await db.collection('social_jobs').updateMany(
      { status: { $in: ['queued', 'running'] } },
      { $set: { status: 'failed', error: 'Interrupted by server restart', finishedAt: new Date() } },
    );
    return r.modifiedCount || 0;
  } catch { return 0; }
}
