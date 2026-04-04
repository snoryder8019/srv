/**
 * Storage quota & usage tracking.
 *
 * Cost basis: ~$100/TB from Linode Object Storage
 * Markup: 40% → $140/TB → $0.14/GB to clients
 *
 * Default caps per plan (GB):
 *   free       →  1 GB
 *   monthly    →  5 GB
 *   quarterly  → 10 GB
 *   annual     → 25 GB
 *   lifetime   → 50 GB
 *
 * Extra storage: purchasable in 5 GB blocks at $0.70/mo ($0.14/GB)
 */

const PLAN_STORAGE_GB = {
  free:      1,
  monthly:   5,
  quarterly: 10,
  annual:    25,
  lifetime:  50,
};

const EXTRA_BLOCK_GB   = 5;
const EXTRA_BLOCK_PRICE = 0.70; // $/mo per 5 GB block
const COST_PER_GB       = 0.14;

/**
 * Get the storage quota for a tenant (in bytes).
 * Checks tenant.meta.plan + tenant.meta.extraStorageGb (purchased blocks).
 */
export function getQuotaBytes(tenant) {
  const plan = tenant?.meta?.plan || 'free';
  const baseGb = PLAN_STORAGE_GB[plan] ?? PLAN_STORAGE_GB.free;
  const extraGb = tenant?.meta?.extraStorageGb || 0;
  return (baseGb + extraGb) * 1024 * 1024 * 1024;
}

/** Human-readable quota string */
export function getQuotaLabel(tenant) {
  const plan = tenant?.meta?.plan || 'free';
  const baseGb = PLAN_STORAGE_GB[plan] ?? PLAN_STORAGE_GB.free;
  const extraGb = tenant?.meta?.extraStorageGb || 0;
  return `${baseGb + extraGb} GB`;
}

/**
 * Calculate total storage used by a tenant (in bytes).
 * Aggregates across all collections that store files with a `size` field.
 */
export async function getUsageBytes(db) {
  const collections = [
    { name: 'assets',       field: 'size' },
    { name: 'files',        field: 'size' },
    { name: 'brand_images', field: 'size' },
    { name: 'brand_models', field: 'size' },
  ];

  let total = 0;
  for (const c of collections) {
    try {
      const result = await db.collection(c.name).aggregate([
        { $group: { _id: null, total: { $sum: `$${c.field}` } } },
      ]).toArray();
      total += result[0]?.total || 0;
    } catch { /* collection may not exist */ }
  }

  // Tickets with attachments
  try {
    const result = await db.collection('tickets').aggregate([
      { $unwind: { path: '$attachments', preserveNullAndEmptyArrays: false } },
      { $group: { _id: null, total: { $sum: '$attachments.size' } } },
    ]).toArray();
    total += result[0]?.total || 0;
  } catch {}

  // Meeting assets
  try {
    const result = await db.collection('meetings').aggregate([
      { $unwind: { path: '$assets', preserveNullAndEmptyArrays: false } },
      { $group: { _id: null, total: { $sum: '$assets.size' } } },
    ]).toArray();
    total += result[0]?.total || 0;
  } catch {}

  return total;
}

/** Format bytes to human string */
export function formatBytes(bytes) {
  if (!bytes || bytes <= 0) return '0 B';
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  if (bytes < 1024 * 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  return (bytes / (1024 * 1024 * 1024)).toFixed(2) + ' GB';
}

/** Usage percentage (0–100) */
export function usagePercent(usedBytes, tenant) {
  const quota = getQuotaBytes(tenant);
  if (!quota) return 100;
  return Math.min(100, Math.round((usedBytes / quota) * 100));
}

/** Check if upload of given size would exceed quota */
export async function wouldExceedQuota(db, tenant, additionalBytes) {
  const used = await getUsageBytes(db);
  const quota = getQuotaBytes(tenant);
  return (used + additionalBytes) > quota;
}

export { PLAN_STORAGE_GB, EXTRA_BLOCK_GB, EXTRA_BLOCK_PRICE, COST_PER_GB };
