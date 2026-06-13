/**
 * Migration Script: Remove Character Location Offsets
 *
 * This script removes the deprecated offset-based coordinate system
 * from character documents. Characters now use absolute galactic
 * coordinates (x, y, z) instead of galaxy-relative offsets.
 *
 * What it does:
 * - Removes location.offsetX, location.offsetY, location.offsetZ fields
 * - Preserves location.x, location.y, location.z (absolute coordinates)
 * - Preserves location.dockedGalaxyId and location.dockedGalaxyName
 *
 * Run with: node scripts/migrate-remove-character-offsets.js
 */

import { connectDB, getDb } from '../plugins/mongo/mongo.js';
import dotenv from 'dotenv';

dotenv.config();

async function migrateCharacterOffsets() {
  console.log('🚀 Starting character offset migration...');

  try {
    // Connect to database
    await connectDB();
    console.log('✅ Connected to database');

    const db = getDb();
    const charactersCollection = db.collection('characters');

    // Find all characters with offset fields
    const charactersWithOffsets = await charactersCollection.find({
      $or: [
        { 'location.offsetX': { $exists: true } },
        { 'location.offsetY': { $exists: true } },
        { 'location.offsetZ': { $exists: true } }
      ]
    }).toArray();

    console.log(`📊 Found ${charactersWithOffsets.length} characters with offset fields`);

    if (charactersWithOffsets.length === 0) {
      console.log('✅ No characters need migration. All clean!');
      process.exit(0);
    }

    // Show sample before migration
    console.log('\n📋 Sample character before migration:');
    const sample = charactersWithOffsets[0];
    console.log(`   Name: ${sample.name}`);
    console.log(`   Location: x=${sample.location.x}, y=${sample.location.y}, z=${sample.location.z}`);
    console.log(`   OffsetX: ${sample.location.offsetX}`);
    console.log(`   OffsetY: ${sample.location.offsetY}`);
    console.log(`   OffsetZ: ${sample.location.offsetZ}`);
    console.log(`   DockedGalaxyId: ${sample.location.dockedGalaxyId}`);

    // Perform migration
    const result = await charactersCollection.updateMany(
      {
        $or: [
          { 'location.offsetX': { $exists: true } },
          { 'location.offsetY': { $exists: true } },
          { 'location.offsetZ': { $exists: true } }
        ]
      },
      {
        $unset: {
          'location.offsetX': '',
          'location.offsetY': '',
          'location.offsetZ': ''
        }
      }
    );

    console.log(`\n✅ Migration complete!`);
    console.log(`   Modified: ${result.modifiedCount} characters`);
    console.log(`   Matched: ${result.matchedCount} characters`);

    // Verify migration
    const stillHaveOffsets = await charactersCollection.countDocuments({
      $or: [
        { 'location.offsetX': { $exists: true } },
        { 'location.offsetY': { $exists: true } },
        { 'location.offsetZ': { $exists: true } }
      ]
    });

    if (stillHaveOffsets === 0) {
      console.log('\n🎉 Verification passed! All offset fields removed.');
    } else {
      console.warn(`\n⚠️ Warning: ${stillHaveOffsets} characters still have offset fields.`);
    }

    // Show sample after migration
    const updatedSample = await charactersCollection.findOne({ _id: sample._id });
    console.log('\n📋 Sample character after migration:');
    console.log(`   Name: ${updatedSample.name}`);
    console.log(`   Location: x=${updatedSample.location.x}, y=${updatedSample.location.y}, z=${updatedSample.location.z}`);
    console.log(`   OffsetX: ${updatedSample.location.offsetX || 'REMOVED ✓'}`);
    console.log(`   OffsetY: ${updatedSample.location.offsetY || 'REMOVED ✓'}`);
    console.log(`   OffsetZ: ${updatedSample.location.offsetZ || 'REMOVED ✓'}`);
    console.log(`   DockedGalaxyId: ${updatedSample.location.dockedGalaxyId || 'null'}`);

    process.exit(0);
  } catch (error) {
    console.error('❌ Migration failed:', error);
    process.exit(1);
  }
}

// Run migration
migrateCharacterOffsets();
