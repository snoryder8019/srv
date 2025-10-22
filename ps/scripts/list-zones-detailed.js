/**
 * List all zones with detailed information
 */
import { MongoClient } from 'mongodb';
import dotenv from 'dotenv';

dotenv.config();

const MONGODB_URI = process.env.DB_URL;
const DB_NAME = process.env.DB_NAME;

async function listZones() {
  const client = new MongoClient(MONGODB_URI);

  try {
    await client.connect();
    const db = client.db(DB_NAME);

    const zones = await db.collection('zones').find({}).toArray();

    console.log('\n╔════════════════════════════════════════════════════════════╗');
    console.log('║           PLANETARY ZONES - DISCOVER MENU                  ║');
    console.log('╚════════════════════════════════════════════════════════════╝\n');

    const planetaryZones = zones.filter(z => z.type === 'planetary');
    const otherZones = zones.filter(z => z.type !== 'planetary');

    console.log(`Total Zones: ${zones.length} (${planetaryZones.length} planetary, ${otherZones.length} other)\n`);

    // Group by orbital
    const byOrbital = {};
    planetaryZones.forEach(zone => {
      const orbital = zone.orbitalBodyName || 'Unknown';
      if (!byOrbital[orbital]) {
        byOrbital[orbital] = [];
      }
      byOrbital[orbital].push(zone);
    });

    Object.keys(byOrbital).sort().forEach(orbital => {
      console.log(`\n🛰  ${orbital.toUpperCase()}`);
      console.log('─'.repeat(60));

      byOrbital[orbital].forEach(zone => {
        console.log(`\n  🌍 ${zone.displayName}`);
        console.log(`     Type: ${zone.subType?.replace('_', ' ')}`);
        console.log(`     Environment: ${zone.environment.atmosphere}`);
        console.log(`     Climate: ${zone.environment.climate}`);
        console.log(`     Temperature: ${zone.environment.temperature}°C`);
        console.log(`     Gravity: ${zone.environment.gravity}`);
        console.log(`     Safety: ${zone.safetyLevel} | Difficulty: ${zone.difficulty}`);

        if (zone.resources && zone.resources.length > 0) {
          console.log(`     Resources (${zone.resources.length}):`);
          zone.resources.forEach(r => {
            console.log(`       • ${r.name} (${r.rarity}, ${r.yield} yield)`);
          });
        }

        if (zone.tags && zone.tags.length > 0) {
          console.log(`     Tags: ${zone.tags.join(', ')}`);
        }
      });
    });

    if (otherZones.length > 0) {
      console.log('\n\n📍 OTHER ZONES');
      console.log('─'.repeat(60));
      otherZones.forEach(zone => {
        console.log(`\n  ${zone.displayName || zone.zoneName}`);
        console.log(`  Type: ${zone.type}`);
        if (zone.description) console.log(`  ${zone.description}`);
      });
    }

    console.log('\n');

  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  } finally {
    await client.close();
    process.exit(0);
  }
}

listZones();
