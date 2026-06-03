/**
 * Mongo connection (mongoose). DB is OPTIONAL for the bones: if the cluster is
 * unreachable, Madlands still boots and the hex map still renders — you just
 * get a guest identity and no persisted profile. Builder/admin work later needs it.
 */
import mongoose from 'mongoose';
import config from '../config/index.js';

let connected = false;
export const dbReady = () => connected;

export async function connectDb() {
  if (!config.db.url) {
    console.warn('[db] no DB_URL set — running without persistence');
    return false;
  }
  try {
    mongoose.set('strictQuery', true);
    await mongoose.connect(config.db.url, { dbName: config.db.name, serverSelectionTimeoutMS: 8000 });
    connected = true;
    console.log(`[db] connected → ${config.db.name}`);
  } catch (e) {
    console.warn('[db] connection failed (continuing without persistence):', e.message);
  }
  return connected;
}
