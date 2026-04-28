import { MongoClient } from 'mongodb';
import { config } from '../config/config.js';

let client;
let db;

export async function connectDB() {
  if (!config.DB_URL) throw new Error('DB_URL not configured');
  client = new MongoClient(config.DB_URL);
  await client.connect();
  db = client.db(config.DB_NAME);
  console.log(`[media-hasher] MongoDB connected — db: ${config.DB_NAME}`);
  await ensureIndexes();
  return db;
}

export function getDb() {
  if (!db) throw new Error('DB not initialized — call connectDB() first');
  return db;
}

async function ensureIndexes() {
  await db.collection('users').createIndex({ email: 1 }, { unique: true, sparse: true });
  await db.collection('users').createIndex({ providerID: 1 }, { sparse: true });

  await db.collection('licenses').createIndex({ key: 1 }, { unique: true });
  await db.collection('licenses').createIndex({ userId: 1 });
  await db.collection('licenses').createIndex({ email: 1 });

  await db.collection('purchases').createIndex({ stripeSessionId: 1 }, { sparse: true });
  await db.collection('purchases').createIndex({ paypalOrderId: 1 }, { sparse: true });
  await db.collection('purchases').createIndex({ userId: 1 });

  await db.collection('download_tokens').createIndex({ token: 1 }, { unique: true });
  await db.collection('download_tokens').createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 });
}
