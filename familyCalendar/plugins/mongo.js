import { MongoClient } from 'mongodb';
import { config } from '../config/config.js';

let client;
let db;

export async function connectDB() {
  client = new MongoClient(config.DB_URL);
  await client.connect();
  db = client.db(config.DB_NAME);
  await ensureIndexes(db);
  console.log(`[familyCalendar] MongoDB connected — db: ${config.DB_NAME}`);
}

export function getDb() {
  if (!db) throw new Error('DB not initialized — call connectDB() first');
  return db;
}

async function ensureIndexes(db) {
  const attempts = [
    ['users', { email: 1 }, { unique: true }],
    ['events', { familyId: 1, start: 1 }, {}],
    ['events', { source: 1, externalId: 1 }, {}],
    ['feedItems', { familyId: 1, displayDate: 1, type: 1 }, {}],
    ['integrations', { familyId: 1, provider: 1 }, { unique: true }],
    ['slabSubscriptions', { apiKeyHash: 1 }, { unique: true }],
  ];
  for (const [coll, keys, opts] of attempts) {
    try {
      await db.collection(coll).createIndex(keys, opts);
    } catch (err) {
      console.warn(`[familyCalendar] index ${coll}(${JSON.stringify(keys)}) failed: ${err.message}`);
    }
  }
}
