/**
 * Add Map Levels to Assets
 * Adds mapLevel field to control which zoom level assets appear on
 */

import { getDb, connectDB } from '../plugins/mongo/mongo.js';

async function addMapLevels() {
  try {
    await connectDB();
    const db = getDb();

    console.log('🗺️  ADDING MAP LEVELS TO ASSETS\n');
    console.log('═'.repeat(60));

    // Define default map levels for each asset type
    const mapLevelDefaults = {
      'galaxy': 'galactic',
      'anomaly': 'galactic',
      'localGroup': 'galactic',
      'nebula': 'galactic',

      'star': 'galaxy',
      'station': 'galaxy',  // Large stations show at galaxy level
      'starship': 'galaxy', // Default for starships

      'planet': 'system',
      'orbital': 'system',
      'asteroid': 'system',

      'zone': 'orbital',
      'sprite': null  // Sprites don't appear on maps
    };

    console.log('\n📊 Map Level Defaults:');
    console.log('─'.repeat(60));
    Object.entries(mapLevelDefaults).forEach(([type, level]) => {
      console.log(`  ${type.padEnd(15)} → ${level || 'N/A'}`);
    });

    console.log('\n🔄 Updating assets...\n');

    let totalUpdated = 0;

    for (const [assetType, mapLevel] of Object.entries(mapLevelDefaults)) {
      if (!mapLevel) continue;  // Skip types that don't need mapLevel

      const result = await db.collection('assets').updateMany(
        {
          assetType,
          mapLevel: { $exists: false }  // Only update if not already set
        },
        {
          $set: { mapLevel }
        }
      );

      if (result.modifiedCount > 0) {
        console.log(`  ✅ ${assetType}: ${result.modifiedCount} assets → mapLevel: "${mapLevel}"`);
        totalUpdated += result.modifiedCount;
      }
    }

    console.log('\n' + '─'.repeat(60));
    console.log(`✅ Total assets updated: ${totalUpdated}\n`);

    // Show summary by map level
    console.log('📍 Assets by Map Level:');
    console.log('─'.repeat(60));

    const galacticCount = await db.collection('assets').countDocuments({ mapLevel: 'galactic' });
    const galaxyCount = await db.collection('assets').countDocuments({ mapLevel: 'galaxy' });
    const systemCount = await db.collection('assets').countDocuments({ mapLevel: 'system' });
    const orbitalCount = await db.collection('assets').countDocuments({ mapLevel: 'orbital' });

    console.log(`  Galactic Level: ${galacticCount} assets (galaxies, anomalies, deep space)`);
    console.log(`  Galaxy Level:   ${galaxyCount} assets (stars, stations, starships)`);
    console.log(`  System Level:   ${systemCount} assets (planets, orbitals, asteroids)`);
    console.log(`  Orbital Level:  ${orbitalCount} assets (zones, close objects)`);

    console.log('\n' + '═'.repeat(60));
    console.log('🎯 Map levels configured successfully!');
    console.log('');
    console.log('Now each map zoom level will show appropriate objects:');
    console.log('  - Galactic map: Only galaxies & deep space objects');
    console.log('  - Galaxy view: Stars & stations within that galaxy');
    console.log('  - System view: Planets & ships within that system');
    console.log('  - Orbital view: Zones & close objects near a planet');
    console.log('');

    process.exit(0);
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

addMapLevels();
