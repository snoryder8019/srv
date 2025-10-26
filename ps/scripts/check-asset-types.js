#!/usr/bin/env node

/**
 * Check Asset Types
 * List all asset types and their counts in the database
 */

import { connectDB, closeDB, getDb } from '../plugins/mongo/mongo.js';

async function checkAssetTypes() {
  console.log('Checking asset types in database...\n');

  try {
    await connectDB();
    const db = getDb();

    // Get all distinct asset types
    const assetTypes = await db.collection('assets').distinct('assetType');

    console.log('Asset Types Found:\n');

    for (const type of assetTypes.sort()) {
      const count = await db.collection('assets').countDocuments({ assetType: type });
      const approved = await db.collection('assets').countDocuments({
        assetType: type,
        status: 'approved'
      });

      console.log(`  ${type.padEnd(20)} Total: ${count.toString().padStart(3)}  Approved: ${approved.toString().padStart(3)}`);
    }

    console.log('\n');

    // Show samples of each type
    console.log('Sample Assets by Type:\n');

    for (const type of assetTypes.sort()) {
      const samples = await db.collection('assets')
        .find({ assetType: type })
        .limit(3)
        .toArray();

      console.log(`${type.toUpperCase()}:`);
      samples.forEach(asset => {
        console.log(`  - ${asset.title} (${asset.status})`);
      });
      console.log('');
    }

    await closeDB();
    process.exit(0);
  } catch (error) {
    console.error('Error:', error);
    await closeDB();
    process.exit(1);
  }
}

checkAssetTypes();
