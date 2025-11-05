/**
 * Test Map Level System
 * Creates a test starship asset with mapLevel field
 */

import { getDb, connectDB } from '../plugins/mongo/mongo.js';
import { ObjectId } from 'mongodb';

async function testMapLevelSystem() {
  try {
    await connectDB();
    const db = getDb();

    console.log('🧪 MAP LEVEL SYSTEM TEST\n');
    console.log('═'.repeat(60));

    // Test 1: Check if migration added mapLevel to existing assets
    console.log('\n📊 TEST 1: Verify mapLevel field exists on assets');
    console.log('─'.repeat(60));

    const assetsByMapLevel = await db.collection('assets').aggregate([
      { $match: { mapLevel: { $exists: true } } },
      { $group: { _id: '$mapLevel', count: { $sum: 1 } } },
      { $sort: { _id: 1 } }
    ]).toArray();

    console.log('Assets by mapLevel:');
    assetsByMapLevel.forEach(level => {
      console.log(`  ${level._id || 'null'}: ${level.count} assets`);
    });

    // Test 2: Check anomalies have galactic level
    console.log('\n📊 TEST 2: Verify anomalies have galactic mapLevel');
    console.log('─'.repeat(60));

    const anomalies = await db.collection('assets').find({
      assetType: 'anomaly'
    }).toArray();

    console.log(`Found ${anomalies.length} anomalies:`);
    anomalies.forEach(a => {
      console.log(`  ${a.title || a.name}: mapLevel = ${a.mapLevel}, coordinates = (${a.coordinates?.x}, ${a.coordinates?.y}, ${a.coordinates?.z})`);
    });

    // Test 3: Create a test starship asset
    console.log('\n📊 TEST 3: Create test starship asset with mapLevel');
    console.log('─'.repeat(60));

    const starship = {
      userId: new ObjectId(),
      title: 'USS Test Runner',
      description: 'Test starship for map level system',
      assetType: 'starship',
      status: 'approved',
      mapLevel: 'galaxy', // Should appear at galaxy zoom level
      coordinates: {
        x: Math.floor(Math.random() * 2000) - 1000,
        y: Math.floor(Math.random() * 2000) - 1000,
        z: Math.floor(Math.random() * 2000) - 1000
      },
      renderData: {
        color: '#00ffff',
        size: 30,
        glow: true,
        glowColor: '#00ffff',
        model: null // No 3D model yet, will show as cyan orb
      },
      hierarchy: {
        parent: null,
        parentType: null,
        children: [],
        depth: 0,
        path: []
      },
      tags: ['test', 'starship'],
      createdAt: new Date(),
      updatedAt: new Date()
    };

    const result = await db.collection('assets').insertOne(starship);
    console.log(`✅ Created starship: ${result.insertedId}`);
    console.log(`   mapLevel: ${starship.mapLevel}`);
    console.log(`   coordinates: (${starship.coordinates.x}, ${starship.coordinates.y}, ${starship.coordinates.z})`);
    console.log(`   renderData: ${JSON.stringify(starship.renderData)}`);

    // Test 4: Query assets by mapLevel
    console.log('\n📊 TEST 4: Query assets by mapLevel');
    console.log('─'.repeat(60));

    const mapLevels = ['galactic', 'galaxy', 'system', 'orbital'];
    for (const level of mapLevels) {
      const count = await db.collection('assets').countDocuments({ mapLevel: level });
      console.log(`  ${level}: ${count} assets`);
    }

    // Test 5: Check what galactic map should show
    console.log('\n📊 TEST 5: Assets that should appear on galactic map');
    console.log('─'.repeat(60));

    const galacticAssets = await db.collection('assets').find({
      mapLevel: 'galactic',
      coordinates: { $exists: true }
    }).project({
      _id: 1,
      title: 1,
      assetType: 1,
      mapLevel: 1,
      coordinates: 1
    }).limit(10).toArray();

    console.log(`Found ${galacticAssets.length} galactic-level assets (showing first 10):`);
    galacticAssets.forEach(a => {
      console.log(`  🌌 ${a.title}: ${a.assetType} at (${a.coordinates.x}, ${a.coordinates.y}, ${a.coordinates.z})`);
    });

    // Summary
    console.log('\n');
    console.log('═'.repeat(60));
    console.log('✅ MAP LEVEL SYSTEM TEST COMPLETE');
    console.log('═'.repeat(60));
    console.log('\n📋 Summary:');
    console.log(`  - Migration added mapLevel to ${assetsByMapLevel.reduce((sum, l) => sum + l.count, 0)} assets`);
    console.log(`  - Anomalies have galactic mapLevel: ${anomalies.every(a => a.mapLevel === 'galactic') ? 'YES ✅' : 'NO ❌'}`);
    console.log(`  - Created test starship: ${result.insertedId}`);
    console.log(`  - Galactic map will show: ${galacticAssets.length} assets`);
    console.log('\n🎯 Next Steps:');
    console.log('  1. Visit /assets/builder-enhanced to create a starship');
    console.log('  2. Set mapLevel to "galaxy" or "galactic"');
    console.log('  3. Set coordinates and renderData');
    console.log('  4. Visit /universe/galactic-map-3d to see it rendered');
    console.log('  5. Click on the starship to land on it\n');

    process.exit(0);
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

testMapLevelSystem();
