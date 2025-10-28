import { connectDB, getDb } from '../plugins/mongo/mongo.js';

async function setupZonesAndCleanup() {
  console.log('🔧 Setting up zones and cleaning non-galactic assets...\n');

  await connectDB();
  const db = getDb();

  // Define the 4 starting zones with proper 3D coordinates
  const zoneSetup = [
    {
      name: 'Crystal Fields',
      coordinates: { x: 500, y: 500, z: 0 },
      color: 0x00ffaa,
      description: 'Resource-rich crystal mining zone'
    },
    {
      name: 'Trade Route Alpha',
      coordinates: { x: -500, y: 500, z: 0 },
      color: 0xffaa00,
      description: 'Major trading hub connecting multiple sectors'
    },
    {
      name: 'Dark Sector',
      coordinates: { x: -500, y: -500, z: 0 },
      color: 0x8800ff,
      description: 'Dangerous lawless zone with high rewards'
    },
    {
      name: 'Nebula Wastes',
      coordinates: { x: 500, y: -500, z: 0 },
      color: 0xff00aa,
      description: 'Vast nebula clouds with hidden dangers'
    }
  ];

  console.log('📍 Step 1: Updating Zones with 3D Coordinates...\n');

  for (const zone of zoneSetup) {
    const result = await db.collection('assets').updateOne(
      { assetType: 'zone', title: zone.name },
      {
        $set: {
          coordinates: zone.coordinates,
          status: 'approved',
          stats: {
            color: zone.color,
            size: 3,
            description: zone.description
          }
        }
      }
    );

    if (result.modifiedCount > 0) {
      console.log('✅ Updated: ' + zone.name + ' at (' + zone.coordinates.x + ', ' + zone.coordinates.y + ', ' + zone.coordinates.z + ')');
    } else {
      console.log('⚠️  Not found: ' + zone.name);
    }
  }

  console.log('\n🗑️  Step 2: Removing Non-Galactic Assets...\n');

  const nonGalacticTypes = [
    'weapon',
    'armor',
    'consumable', 
    'item',
    'module',
    'character',
    'structure',
    'environment'
  ];

  for (const type of nonGalacticTypes) {
    const result = await db.collection('assets').deleteMany({ assetType: type });
    
    if (result.deletedCount > 0) {
      console.log('🗑️  Removed ' + result.deletedCount + ' ' + type + ' assets');
    }
  }

  console.log('\n📊 Step 3: Final Asset Count...\n');

  const galacticTypes = ['galaxy', 'star', 'planet', 'orbital', 'zone', 'anomaly', 'ship', 'station'];
  
  for (const type of galacticTypes) {
    const count = await db.collection('assets').countDocuments({ assetType: type });
    if (count > 0) {
      console.log(type + ': ' + count);
    }
  }

  console.log('\n✅ Zone setup and cleanup complete!\n');
  process.exit(0);
}

setupZonesAndCleanup();
