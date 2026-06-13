#!/usr/bin/env node
/**
 * Analyze MongoDB database size and collection stats (v2)
 */

import { MongoClient } from 'mongodb';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load environment variables
dotenv.config({ path: join(__dirname, '..', '.env') });

const DB_URL = process.env.DB_URL;
const DB_NAME = process.env.DB_NAME;

async function analyzeDatabase() {
  const client = new MongoClient(DB_URL);

  try {
    await client.connect();
    console.log('✓ Connected to MongoDB');

    const db = client.db(DB_NAME);

    // Get all collections
    const collections = await db.listCollections().toArray();

    console.log('\n=== COLLECTION ANALYSIS ===');
    const collectionStats = [];

    for (const collectionInfo of collections) {
      const collectionName = collectionInfo.name;
      const collection = db.collection(collectionName);

      try {
        const count = await collection.countDocuments();

        // Get a sample document to estimate size
        const sampleDocs = await collection.find().limit(100).toArray();
        const avgSize = sampleDocs.length > 0
          ? sampleDocs.reduce((sum, doc) => sum + JSON.stringify(doc).length, 0) / sampleDocs.length
          : 0;

        const estimatedSize = count * avgSize;

        collectionStats.push({
          name: collectionName,
          count,
          avgSize,
          estimatedSize
        });
      } catch (err) {
        console.log(`⚠ Could not analyze ${collectionName}: ${err.message}`);
      }
    }

    // Sort by estimated size descending
    collectionStats.sort((a, b) => b.estimatedSize - a.estimatedSize);

    // Display collection stats
    console.log('\nCollection Name               | Documents | Avg Size  | Est. Total Size');
    console.log('------------------------------|-----------|-----------|------------------');

    let totalDocs = 0;
    let totalSize = 0;

    for (const stat of collectionStats) {
      const estSizeMB = (stat.estimatedSize / 1024 / 1024).toFixed(2);
      const avgSizeKB = (stat.avgSize / 1024).toFixed(2);

      console.log(
        `${stat.name.padEnd(29)} | ${String(stat.count).padStart(9)} | ` +
        `${(avgSizeKB + ' KB').padStart(9)} | ${estSizeMB} MB`
      );

      totalDocs += stat.count;
      totalSize += stat.estimatedSize;
    }

    console.log('------------------------------|-----------|-----------|------------------');
    console.log(
      `${'TOTAL'.padEnd(29)} | ${String(totalDocs).padStart(9)} | ` +
      `${' '.padStart(9)}   | ${(totalSize / 1024 / 1024).toFixed(2)} MB`
    );

    console.log('\n=== DETAILED COLLECTION INFO ===');

    for (const stat of collectionStats) {
      if (stat.count > 1000 || stat.estimatedSize > 5 * 1024 * 1024) {
        console.log(`\n📦 ${stat.name}:`);
        console.log(`   Documents: ${stat.count.toLocaleString()}`);
        console.log(`   Estimated Size: ${(stat.estimatedSize / 1024 / 1024).toFixed(2)} MB`);
        console.log(`   Avg Document: ${(stat.avgSize / 1024).toFixed(2)} KB`);

        // Get a sample document to show structure
        const collection = db.collection(stat.name);
        const sample = await collection.findOne();
        if (sample) {
          const keys = Object.keys(sample).filter(k => k !== '_id').slice(0, 10);
          console.log(`   Fields: ${keys.join(', ')}`);
        }
      }
    }

    console.log('\n=== RECOMMENDATIONS ===');

    // Check for sessions
    const sessions = collectionStats.find(s => s.name === 'sessions');
    if (sessions && sessions.count > 100) {
      console.log(`\n⚠️  Sessions: ${sessions.count} documents`);
      console.log('   Consider clearing old sessions to free up space.');
    }

    // Large collections
    const large = collectionStats.filter(s => s.estimatedSize > 50 * 1024 * 1024);
    if (large.length > 0) {
      console.log('\n📦 Largest collections:');
      large.forEach(s => {
        console.log(`   - ${s.name}: ${(s.estimatedSize / 1024 / 1024).toFixed(2)} MB`);
      });
    }

  } catch (error) {
    console.error('Error analyzing database:', error);
  } finally {
    await client.close();
  }
}

analyzeDatabase();
