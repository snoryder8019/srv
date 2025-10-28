import { connectDB, getDb } from '../plugins/mongo/mongo.js';

async function checkZones() {
  await connectDB();
  const db = getDb();

  console.log('\n=== Checking Zones ===\n');
  
  const zones = await db.collection('assets').find({ assetType: 'zone' }).toArray();
  
  console.log('Total zones:', zones.length);
  zones.forEach(zone => {
    console.log('\nZone:', zone.title);
    console.log('  Coordinates:', zone.coordinates);
    console.log('  Stats:', zone.stats);
    console.log('  Status:', zone.status);
  });

  console.log('\n=== Non-Galactic Asset Types ===\n');
  
  const nonGalactic = ['weapon', 'armor', 'consumable', 'item', 'module', 'character', 'structure', 'environment'];
  
  for (const type of nonGalactic) {
    const count = await db.collection('assets').countDocuments({ assetType: type });
    if (count > 0) {
      console.log(type + ': ' + count);
    }
  }

  process.exit(0);
}

checkZones();
