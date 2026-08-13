import { MongoClient } from 'mongodb';
import { config } from '../config/config.js';

let client;        // Atlas shared cluster — slab registry + legacy tenant DBs
let slabDb;
let tenantClient;  // Self-hosted GPU-box mongod, optional
let tenantConnecting = false;   // in-flight connect guard
let tenantRetryTimer = null;    // background retry interval (stops once connected)
const TENANT_RETRY_MS = 30000;

// dbName → host map. Only non-atlas tenants are tracked; anything absent
// defaults to 'atlas'. This lets the ~80 existing getTenantDb(tenant.db) call
// sites route to the correct cluster WITHOUT passing a host argument.
const tenantHostMap = new Map();

/**
 * host:port of the tenant cluster, credentials stripped — for error messages.
 * Derived from TENANT_DB_URL rather than hardcoded: an earlier version of the
 * error below named a tunnel on 127.0.0.1:27117 that no longer exists, which
 * sent whoever was on call chasing a phantom. Read it from config so it cannot
 * go stale again.
 */
function tenantTargetLabel() {
  try {
    const u = new URL(config.TENANT_DB_URL);
    return u.host || 'unknown host';
  } catch {
    return 'the host in TENANT_DB_URL';
  }
}

/** Record (or update) which cluster a tenant DB lives on. */
export function registerTenantHost(dbName, host) {
  if (!dbName) return;
  if (host === 'gpu') tenantHostMap.set(dbName, 'gpu');
  else tenantHostMap.delete(dbName); // atlas is the default — no need to store
}

/** Load the dbName → host map from the registry (gpu-hosted tenants only). */
export async function loadTenantHostMap() {
  if (!slabDb) return;
  tenantHostMap.clear();
  const cursor = slabDb.collection('tenants').find(
    { dbHost: 'gpu' },
    { projection: { db: 1, dbHost: 1 } },
  );
  let n = 0;
  for await (const doc of cursor) {
    if (doc.db) { tenantHostMap.set(doc.db, 'gpu'); n++; }
  }
  console.log(`[slab] tenant host map loaded — ${n} on gpu, rest on atlas`);
}

export async function connectDB() {
  client = new MongoClient(config.DB_URL);
  await client.connect();
  slabDb = client.db(config.SLAB_DB);
  console.log(`[slab] MongoDB connected — registry: ${config.SLAB_DB} (atlas)`);

  // Build the dbName → host routing map from the registry.
  await loadTenantHostMap().catch(err =>
    console.warn(`[slab] tenant host map load failed (defaulting all to atlas): ${err.message}`),
  );

  // Self-hosted tenant cluster — non-fatal. The app must boot even if the GPU
  // tunnel is down (e.g. it comes up after us, as in the boot-ordering race that
  // wedged every gpu tenant once). connectTenantCluster() schedules a background
  // retry on failure, so the connection self-heals without a manual restart.
  await connectTenantCluster();
}

/**
 * Connect (or reconnect) the self-hosted gpu tenant cluster. Idempotent and
 * non-throwing: on failure it leaves tenantClient null and schedules a background
 * retry. Returns true once connected.
 */
async function connectTenantCluster() {
  if (!config.TENANT_DB_URL) return false;
  if (tenantClient || tenantConnecting) return !!tenantClient;
  tenantConnecting = true;
  try {
    const c = new MongoClient(config.TENANT_DB_URL, { serverSelectionTimeoutMS: 8000 });
    await c.connect();
    await c.db('admin').command({ ping: 1 });
    tenantClient = c;
    if (tenantRetryTimer) { clearInterval(tenantRetryTimer); tenantRetryTimer = null; }
    console.log('[slab] Tenant MongoDB connected — self-hosted (gpu) via tunnel');
    return true;
  } catch (err) {
    tenantClient = null;
    console.warn(`[slab] Tenant MongoDB (gpu) unavailable — retrying every ${TENANT_RETRY_MS / 1000}s in background: ${err.message}`);
    scheduleTenantRetry();
    return false;
  } finally {
    tenantConnecting = false;
  }
}

/** Start the background retry loop (no-op if already running or already connected). */
function scheduleTenantRetry() {
  if (tenantRetryTimer || tenantClient || !config.TENANT_DB_URL) return;
  tenantRetryTimer = setInterval(() => { connectTenantCluster().catch(() => {}); }, TENANT_RETRY_MS);
  if (tenantRetryTimer.unref) tenantRetryTimer.unref(); // don't keep the process alive
}

/** Slab registry database (tenants collection lives here — always Atlas) */
export function getSlabDb() {
  if (!slabDb) throw new Error('DB not initialized — call connectDB() first');
  return slabDb;
}

/**
 * Get a tenant-specific database by name, on the right physical cluster.
 * @param {string} dbName  e.g. 'slab_acme'
 * @param {'atlas'|'gpu'} [host]  Which cluster the tenant DB lives on. When
 *   omitted, the host is resolved from the registry-backed map (default 'atlas'),
 *   so existing callers route correctly without passing a host.
 */
export function getTenantDb(dbName, host) {
  if (host == null) host = tenantHostMap.get(dbName) || 'atlas';
  if (host === 'gpu') {
    if (!tenantClient) {
      // Kick a non-blocking reconnect so the next request can succeed once the
      // tunnel is back, and ensure the background retry loop is running.
      scheduleTenantRetry();
      connectTenantCluster().catch(() => {});
      throw new Error(
        `Tenant DB "${dbName}" is on the self-hosted (gpu) cluster but its connection is unavailable. ` +
        `Cannot reach the tenant mongod at ${tenantTargetLabel()} (TENANT_DB_URL). ` +
        `Verify that host is up and accepting connections; a background retry runs every 30s.`,
      );
    }
    return tenantClient.db(dbName);
  }
  if (!client) throw new Error('DB not initialized — call connectDB() first');
  return client.db(dbName);
}

/** True if the self-hosted tenant cluster is connected and ready. */
export function tenantClusterReady() {
  return !!tenantClient;
}

/** @deprecated — use req.db (set by tenant middleware) instead */
export function getDb() {
  if (!slabDb) throw new Error('DB not initialized — call connectDB() first');
  return slabDb;
}
