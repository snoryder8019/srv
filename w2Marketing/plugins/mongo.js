import { MongoClient } from 'mongodb';
import { config } from '../config/config.js';

let db;

export async function connectDB() {
  const client = new MongoClient(config.DB_URL);
  await client.connect();
  db = client.db(config.DB_NAME);
  console.log(`[w2Marketing] MongoDB connected — ${config.DB_NAME}`);
}

export function getDb() {
  if (!db) throw new Error('DB not initialized — call connectDB() first');
  return db;
}
