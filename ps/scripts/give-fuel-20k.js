/**
 * Give all characters 20k fuel
 */

import dotenv from 'dotenv';
import { MongoClient } from 'mongodb';

dotenv.config();

async function giveFuel() {
  const client = new MongoClient(process.env.DB_URL);

  try {
    await client.connect();
    console.log('✅ Connected to MongoDB');

    const db = client.db(process.env.DB_NAME || 'projectStringborne');
    const characters = db.collection('characters');

    // Update all characters to have 20k fuel capacity and remaining
    const result = await characters.updateMany(
      {},
      {
        $set: {
          'ship.fittings.fuelTanks.capacity': 20000,
          'ship.fittings.fuelTanks.remaining': 20000
        }
      }
    );

    console.log(`✅ Updated ${result.modifiedCount} characters with 20k fuel`);

    // Show sample character
    const sample = await characters.findOne({}, { projection: { name: 1, 'ship.fittings.fuelTanks': 1 } });
    console.log('\n📋 Sample character:');
    console.log(`   Name: ${sample.name}`);
    console.log(`   Fuel: ${sample.ship.fittings.fuelTanks.remaining}/${sample.ship.fittings.fuelTanks.capacity}`);

  } catch (error) {
    console.error('❌ Error:', error.message);
    throw error;
  } finally {
    await client.close();
    console.log('\n🔒 Connection closed');
  }
}

giveFuel()
  .then(() => {
    console.log('\n✅ Fuel update complete!');
    process.exit(0);
  })
  .catch(err => {
    console.error('❌ Failed:', err);
    process.exit(1);
  });
