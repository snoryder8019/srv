/**
 * MongoDB connection bootstrap.
 */
import mongoose from 'mongoose';
import config from '../config/index.js';

export async function connectDb() {
  try {
    await mongoose.connect(config.db.url, { dbName: config.db.name });
    console.log(`[db] connected: ${config.db.name}`);
    return mongoose.connection;
  } catch (err) {
    console.error('[db] connection failed:', err.message);
    throw err;
  }
}

export function dbStatus() {
  const states = ['disconnected', 'connected', 'connecting', 'disconnecting'];
  return states[mongoose.connection.readyState] || 'unknown';
}
