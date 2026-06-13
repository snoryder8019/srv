import { getDb, connectDB } from '../plugins/mongo/mongo.js';

await connectDB();
const db = getDb();

console.log('🔍 Finding zones with zoneData...\n');

const zones = await db.collection('assets').find({ assetType: 'zone' }).toArray();

console.log(`Found ${zones.length} total zones\n`);

const zonesWithData = zones.filter(z => z.zoneData !== null);
const zonesWithoutData = zones.filter(z => z.zoneData === null);

console.log(`✅ Zones WITH zoneData: ${zonesWithData.length}`);
zonesWithData.forEach(z => {
  console.log(`   - ${z.title} (${z._id})`);
  console.log(`     Width: ${z.zoneData?.width}, Height: ${z.zoneData?.height}`);
  console.log(`     Spawn points: ${z.zoneData?.spawnPoints?.length || 0}`);
});

console.log(`\n❌ Zones WITHOUT zoneData: ${zonesWithoutData.length}`);
zonesWithoutData.forEach(z => {
  console.log(`   - ${z.title} (${z._id})`);
});

process.exit(0);
