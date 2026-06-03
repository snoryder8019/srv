/**
 * Seed all characters with full travel supplies:
 * - 20,000 fuel (Deuterium)
 * - 1,000 oxygen
 * - 100 food rations
 * - 20 medkits
 */

import dotenv from 'dotenv';
import { MongoClient } from 'mongodb';

dotenv.config();

const SUPPLIES = {
  fuelTanks: {
    capacity: 20000,
    remaining: 20000,
    type: 'Deuterium'
  },
  lifeSupport: {
    installed: true,
    type: 'Advanced',
    oxygenCapacity: 1000,
    oxygenRemaining: 1000,
    foodCapacity: 100,
    foodRemaining: 100
  },
  medicalBay: {
    installed: true,
    medKitsCapacity: 20,
    medKitsRemaining: 20,
    autoRevive: true
  }
};

async function seed() {
  const client = new MongoClient(process.env.DB_URL);
  await client.connect();
  const db = client.db(process.env.DB_NAME || 'projectStringborne');
  const characters = db.collection('characters');

  const total = await characters.countDocuments({});
  console.log(`Found ${total} characters`);

  const result = await characters.updateMany(
    {},
    {
      $set: {
        'ship.fittings.fuelTanks': SUPPLIES.fuelTanks,
        'ship.fittings.lifeSupport': SUPPLIES.lifeSupport,
        'ship.fittings.medicalBay': SUPPLIES.medicalBay
      }
    }
  );

  console.log(`Modified ${result.modifiedCount} / ${result.matchedCount} characters`);

  const sample = await characters.findOne(
    {},
    { projection: { name: 1, 'ship.fittings.fuelTanks': 1, 'ship.fittings.lifeSupport': 1, 'ship.fittings.medicalBay': 1 } }
  );
  console.log('\nSample after update:');
  console.log(`  ${sample.name}`);
  console.log(`  fuel:    ${sample.ship.fittings.fuelTanks.remaining}/${sample.ship.fittings.fuelTanks.capacity} ${sample.ship.fittings.fuelTanks.type}`);
  console.log(`  oxygen:  ${sample.ship.fittings.lifeSupport.oxygenRemaining}/${sample.ship.fittings.lifeSupport.oxygenCapacity}`);
  console.log(`  food:    ${sample.ship.fittings.lifeSupport.foodRemaining}/${sample.ship.fittings.lifeSupport.foodCapacity}`);
  console.log(`  medkits: ${sample.ship.fittings.medicalBay.medKitsRemaining}/${sample.ship.fittings.medicalBay.medKitsCapacity}`);

  await client.close();
}

seed()
  .then(() => { console.log('\nDone'); process.exit(0); })
  .catch(err => { console.error('Failed:', err); process.exit(1); });
