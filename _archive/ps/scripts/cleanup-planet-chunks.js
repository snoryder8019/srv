#!/usr/bin/env node
/**
 * Clean up planetChunks collection to free up database space
 *
 * WARNING: This will delete ALL planet chunks.
 * They will be regenerated on-demand as needed.
 */

import { MongoClient } from 'mongodb';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import readline from 'readline';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

dotenv.config({ path: join(__dirname, '..', '.env') });

const DB_URL = process.env.DB_URL;
const DB_NAME = process.env.DB_NAME;

async function cleanup() {
  const client = new MongoClient(DB_URL);

  try {
    await client.connect();
    console.log('✓ Connected to MongoDB');

    const db = client.db(DB_NAME);
    const collection = db.collection('planetChunks');

    // Get current count
    const count = await collection.countDocuments();
    console.log(`\nCurrent planetChunks: ${count} documents`);
    console.log(`Estimated size: ~462 MB`);

    // Ask for confirmation
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });

    const answer = await new Promise(resolve => {
      rl.question('\nDelete all planet chunks? (yes/no): ', resolve);
    });
    rl.close();

    if (answer.toLowerCase() !== 'yes') {
      console.log('Cancelled.');
      return;
    }

    console.log('\nDeleting planet chunks...');
    const result = await collection.deleteMany({});

    console.log(`✓ Deleted ${result.deletedCount} documents`);
    console.log(`✓ Freed up ~462 MB of space`);
    console.log('\nNote: Planet chunks will regenerate automatically when players visit planets.');

  } catch (error) {
    console.error('Error:', error);
  } finally {
    await client.close();
  }
}

cleanup();
