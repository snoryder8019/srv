import { MongoClient } from 'mongodb';
import { config } from '../config/config.js';

let client;
let slabDb;

export async function connectDB() {
  client = new MongoClient(config.DB_URL);
  await client.connect();
  slabDb = client.db(config.SLAB_DB);
  console.log(`[slab] MongoDB connected — registry: ${config.SLAB_DB}`);
}

/** Slab registry database (tenants collection lives here) */
export function getSlabDb() {
  if (!slabDb) throw new Error('DB not initialized — call connectDB() first');
  return slabDb;
}

/** Get a tenant-specific database by name */
export function getTenantDb(dbName) {
  if (!client) throw new Error('DB not initialized — call connectDB() first');
  return client.db(dbName);
}

/** @deprecated — use req.db (set by tenant middleware) instead */
export function getDb() {
  if (!slabDb) throw new Error('DB not initialized — call connectDB() first');
  return slabDb;
}
