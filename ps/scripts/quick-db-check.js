#!/usr/bin/env node
/**
 * Quick database check - just count documents per collection
 */

import { MongoClient } from 'mongodb';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

dotenv.config({ path: join(__dirname, '..', '.env') });

const DB_URL = process.env.DB_URL;
const DB_NAME = process.env.DB_NAME;

async function quickCheck() {
  const client = new MongoClient(DB_URL);

  try {
    await client.connect();
    console.log('✓ Connected');

    const db = client.db(DB_NAME);
    const collections = await db.listCollections().toArray();

    console.log('\nCollection               | Document Count');
    console.log('-------------------------|---------------');

    for (const coll of collections) {
      const count = await db.collection(coll.name).countDocuments();
      console.log(`${coll.name.padEnd(24)} | ${count.toLocaleString().padStart(14)}`);
    }

  } catch (error) {
    console.error('Error:', error.message);
  } finally {
    await client.close();
  }
}

quickCheck();
