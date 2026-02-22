/**
 * Steven Clawbert — MongoDB Memory Persistence
 * Collection: stevenClawbert_memory
 * 
 * Each memory doc:
 * {
 *   _id, key, category, content, tags[], metadata{},
 *   createdAt, updatedAt, pinned, archived
 * }
 * 
 * Text search index on content + tags + key + category
 */

import { getDb } from '../plugins/mongo/mongo.js';

const COLLECTION = 'stevenClawbert_memory';

function col() {
  return getDb().collection(COLLECTION);
}

/** Ensure indexes exist (call once on startup) */
export async function ensureIndexes() {
  const c = col();
  await c.createIndex({ key: 1 }, { unique: true, sparse: true });
  await c.createIndex({ category: 1 });
  await c.createIndex({ tags: 1 });
  await c.createIndex({ pinned: 1 });
  await c.createIndex({ updatedAt: -1 });
  await c.createIndex(
    { content: 'text', key: 'text', category: 'text', tags: 'text' },
    { name: 'memory_text_search', weights: { key: 10, category: 5, tags: 8, content: 1 } }
  );
  console.log('[SC Memory] Indexes ensured');
}

/** Save or update a memory by key */
export async function upsert(key, category, content, tags = [], metadata = {}) {
  const now = new Date();
  const doc = {
    key,
    category,
    content,
    tags,
    metadata,
    updatedAt: now,
    pinned: false,
    archived: false,
  };
  const result = await col().updateOne(
    { key },
    { $set: doc, $setOnInsert: { createdAt: now } },
    { upsert: true }
  );
  return result;
}

/** Get a memory by key */
export async function get(key) {
  return col().findOne({ key, archived: { $ne: true } });
}

/** Search memories by text query */
export async function search(query, { limit = 20, category = null, includeArchived = false } = {}) {
  const filter = {};
  if (query) filter.$text = { $search: query };
  if (category) filter.category = category;
  if (!includeArchived) filter.archived = { $ne: true };

  const projection = query ? { score: { $meta: 'textScore' } } : {};
  const sort = query ? { score: { $meta: 'textScore' } } : { updatedAt: -1 };

  return col().find(filter).project(projection).sort(sort).limit(limit).toArray();
}

/** List memories by category */
export async function listByCategory(category, { limit = 50 } = {}) {
  return col().find({ category, archived: { $ne: true } })
    .sort({ pinned: -1, updatedAt: -1 }).limit(limit).toArray();
}

/** List all categories with counts */
export async function categories() {
  return col().aggregate([
    { $match: { archived: { $ne: true } } },
    { $group: { _id: '$category', count: { $sum: 1 }, lastUpdated: { $max: '$updatedAt' } } },
    { $sort: { lastUpdated: -1 } }
  ]).toArray();
}

/** Delete a memory by key */
export async function remove(key) {
  return col().deleteOne({ key });
}

/** Archive instead of delete */
export async function archive(key) {
  return col().updateOne({ key }, { $set: { archived: true, updatedAt: new Date() } });
}

/** Pin/unpin */
export async function pin(key, pinned = true) {
  return col().updateOne({ key }, { $set: { pinned, updatedAt: new Date() } });
}

/** Bulk import from flat object { key: content } */
export async function bulkImport(entries, category = 'imported') {
  const ops = Object.entries(entries).map(([key, content]) => ({
    updateOne: {
      filter: { key },
      update: {
        $set: { key, category, content, tags: [], metadata: {}, updatedAt: new Date(), pinned: false, archived: false },
        $setOnInsert: { createdAt: new Date() }
      },
      upsert: true
    }
  }));
  if (ops.length === 0) return { matched: 0, upserted: 0 };
  return col().bulkWrite(ops);
}

/** Get stats */
export async function stats() {
  const c = col();
  const [total, archived, pinned, cats] = await Promise.all([
    c.countDocuments({ archived: { $ne: true } }),
    c.countDocuments({ archived: true }),
    c.countDocuments({ pinned: true, archived: { $ne: true } }),
    categories()
  ]);
  return { total, archived, pinned, categories: cats };
}

export default { ensureIndexes, upsert, get, search, listByCategory, categories, remove, archive, pin, bulkImport, stats };
