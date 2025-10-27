#!/usr/bin/env node
/**
 * Analyze MongoDB database size and collection stats
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

    // Get database stats
    const dbStats = await db.stats();
    console.log('\n=== DATABASE STATS ===');
    console.log(`Database: ${DB_NAME}`);
    console.log(`Total Size: ${(dbStats.dataSize / 1024 / 1024).toFixed(2)} MB`);
    console.log(`Storage Size: ${(dbStats.storageSize / 1024 / 1024).toFixed(2)} MB`);
    console.log(`Index Size: ${(dbStats.indexSize / 1024 / 1024).toFixed(2)} MB`);
    console.log(`Collections: ${dbStats.collections}`);

    // Get all collections
    const collections = await db.listCollections().toArray();

    console.log('\n=== COLLECTION SIZES ===');
    const collectionStats = [];

    for (const collectionInfo of collections) {
      const collectionName = collectionInfo.name;
      const collection = db.collection(collectionName);

      try {
        const stats = await collection.stats();
        const count = await collection.countDocuments();

        collectionStats.push({
          name: collectionName,
          count,
          size: stats.size,
          storageSize: stats.storageSize,
          avgObjSize: stats.avgObjSize || 0,
          indexSize: stats.totalIndexSize || 0
        });
      } catch (err) {
        console.log(`⚠ Could not get stats for ${collectionName}: ${err.message}`);
      }
    }

    // Sort by storage size descending
    collectionStats.sort((a, b) => b.storageSize - a.storageSize);

    // Display collection stats
    console.log('\nCollection Name               | Documents | Data Size | Storage | Indexes | Avg Doc');
    console.log('------------------------------|-----------|-----------|---------|---------|----------');

    for (const stat of collectionStats) {
      const sizeMB = (stat.size / 1024 / 1024).toFixed(2);
      const storageMB = (stat.storageSize / 1024 / 1024).toFixed(2);
      const indexMB = (stat.indexSize / 1024 / 1024).toFixed(2);
      const avgKB = (stat.avgObjSize / 1024).toFixed(2);

      console.log(
        `${stat.name.padEnd(29)} | ${String(stat.count).padStart(9)} | ` +
        `${(sizeMB + ' MB').padStart(9)} | ${(storageMB + ' MB').padStart(7)} | ` +
        `${(indexMB + ' MB').padStart(7)} | ${avgKB} KB`
      );
    }

    // Calculate totals
    const totalDataSize = collectionStats.reduce((sum, s) => sum + s.size, 0);
    const totalStorageSize = collectionStats.reduce((sum, s) => sum + s.storageSize, 0);
    const totalIndexSize = collectionStats.reduce((sum, s) => sum + s.indexSize, 0);
    const totalDocs = collectionStats.reduce((sum, s) => sum + s.count, 0);

    console.log('------------------------------|-----------|-----------|---------|---------|----------');
    console.log(
      `${'TOTAL'.padEnd(29)} | ${String(totalDocs).padStart(9)} | ` +
      `${((totalDataSize / 1024 / 1024).toFixed(2) + ' MB').padStart(9)} | ` +
      `${((totalStorageSize / 1024 / 1024).toFixed(2) + ' MB').padStart(7)} | ` +
      `${((totalIndexSize / 1024 / 1024).toFixed(2) + ' MB').padStart(7)} |`
    );

    console.log('\n=== RECOMMENDATIONS ===');

    // Find collections that might be good candidates for cleanup
    const largeCollections = collectionStats.filter(s => s.storageSize > 10 * 1024 * 1024); // > 10MB
    const manyDocuments = collectionStats.filter(s => s.count > 10000);

    if (largeCollections.length > 0) {
      console.log('\n📦 Large collections (> 10 MB):');
      largeCollections.forEach(s => {
        console.log(`  - ${s.name}: ${(s.storageSize / 1024 / 1024).toFixed(2)} MB (${s.count} docs)`);
      });
    }

    if (manyDocuments.length > 0) {
      console.log('\n📊 Collections with many documents (> 10,000):');
      manyDocuments.forEach(s => {
        console.log(`  - ${s.name}: ${s.count} documents`);
      });
    }

    // Check for sessions collection (often grows large)
    const sessionsCollection = collectionStats.find(s => s.name === 'sessions');
    if (sessionsCollection && sessionsCollection.storageSize > 5 * 1024 * 1024) {
      console.log('\n⚠️  Sessions collection is large. Consider clearing expired sessions.');
      console.log(`   Current size: ${(sessionsCollection.storageSize / 1024 / 1024).toFixed(2)} MB`);
    }

  } catch (error) {
    console.error('Error analyzing database:', error);
  } finally {
    await client.close();
  }
}

analyzeDatabase();
