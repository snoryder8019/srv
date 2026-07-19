/**
 * plugins/observe.js — lightweight live observability sinks for the testing phase.
 *
 * Three queryable feeds in the slab registry DB, each self-pruning via a TTL index
 * so they can never grow unbounded:
 *   • error_logs   — backend errors (global handler + process-level traps)
 *   • client_errors— front-end JS crashes posted from the browser
 *   • cron_runs    — one row per scheduled-job run (outcome + duration)
 * plus best-effort health fields written onto the existing `cron_state` doc.
 *
 * Everything here is best-effort: a logging failure must never break a request,
 * a cron, or the process. Read side lives in routes/superadmin/monitoring.js.
 */
import { getSlabDb } from './mongo.js';

const TTL_DAYS = 30;
const clip = (v, n) => (v == null ? '' : String(v).slice(0, n));

let indexesReady = false;
export async function ensureObserveIndexes() {
  if (indexesReady) return;
  indexesReady = true;
  const ttl = { expireAfterSeconds: TTL_DAYS * 86400 };
  try {
    const db = getSlabDb();
    await Promise.all([
      db.collection('error_logs').createIndex({ at: 1 }, ttl),
      db.collection('error_logs').createIndex({ at: -1 }),
      db.collection('client_errors').createIndex({ at: 1 }, ttl),
      db.collection('client_errors').createIndex({ at: -1 }),
      db.collection('cron_runs').createIndex({ at: 1 }, ttl),
      db.collection('cron_runs').createIndex({ name: 1, at: -1 }),
    ]);
  } catch (e) {
    indexesReady = false; // let a later call retry once the DB is up
    console.warn('[observe] index setup deferred:', e.message);
  }
}

/** Record a backend error (from the Express error handler or a process trap). */
export async function recordServerError({ err, req = null, kind = 'server' } = {}) {
  try {
    await getSlabDb().collection('error_logs').insertOne({
      at: new Date(),
      kind,
      message: clip(err?.message || err, 1000),
      stack: clip(err?.stack, 6000),
      status: err?.status || err?.statusCode || null,
      method: req?.method || null,
      route: clip(req?.originalUrl, 500) || null,
      tenantDomain: req?.tenant?.domain || null,
      tenantDb: req?.tenant?.db || null,
      ip: req?.ip || null,
      ua: clip(req?.get?.('user-agent'), 300) || null,
    });
  } catch { /* never let logging throw */ }
}

/** Record a front-end error posted by the browser. `body` is untrusted — clip hard. */
export async function recordClientError(body = {}, req = null) {
  try {
    await getSlabDb().collection('client_errors').insertOne({
      at: new Date(),
      message: clip(body.message, 1000),
      source: clip(body.source, 500),
      line: Number.isFinite(+body.line) ? +body.line : null,
      col: Number.isFinite(+body.col) ? +body.col : null,
      stack: clip(body.stack, 4000),
      kind: clip(body.kind, 40) || 'error',
      url: clip(body.url, 500),
      tenantDomain: req?.tenant?.domain || req?.hostname || null,
      ua: clip(req?.get?.('user-agent'), 300),
      ip: req?.ip || null,
    });
  } catch { /* best-effort */ }
}

/** Record one scheduled-job run and roll up health onto cron_state. */
export async function recordCronRun({ name, label = '', kind = 'interval', ok = true, durationMs = 0, error = '' } = {}) {
  const at = new Date();
  try {
    const db = getSlabDb();
    await db.collection('cron_runs').insertOne({
      at, name, label, kind, ok: !!ok,
      durationMs: Math.round(durationMs) || 0,
      error: clip(error, 1000) || null,
    });
    await db.collection('cron_state').updateOne(
      { _id: name },
      {
        $set: {
          label, kind, lastFinishedAt: at,
          lastStatus: ok ? 'ok' : 'fail',
          lastDurationMs: Math.round(durationMs) || 0,
          lastError: ok ? null : clip(error, 1000),
          ...(ok ? { consecutiveFailures: 0 } : {}),
        },
        $inc: {
          runs: 1,
          fails: ok ? 0 : 1,
          ...(ok ? {} : { consecutiveFailures: 1 }),
        },
      },
      { upsert: true },
    );
  } catch { /* best-effort */ }
}
